/**
 * The authority. One process holds the live graph in memory, decides every
 * write, and tells each connection exactly what its role allows it to see.
 *
 * Three things here come straight from the schema, with no second copy:
 *   dehydration   which objects and fields a connection receives
 *   validation    which writes are accepted
 *   fan-out       who hears about a change
 *
 * Visibility is live. When a grant, a link or a privacy setting changes, the
 * affected subtree is re-resolved for every connection and objects enter or
 * leave their replicas in the same message as the change itself.
 */

import { applyOp, foldWal, Graph, localize, type NewOp, type Op, type Rec, type SetOp, type WalEntry } from '../core/graph.ts'
import { makeHandle, type HandleHost } from '../core/handle.ts'
import { newId } from '../core/ids.ts'
import { place, POS } from '../core/pos.ts'
import { memoryPair, type ClientMsg, type Hydrated, type PeerState, type ServerMsg, type Transport } from '../core/protocol.ts'
import {
  checkValue,
  isId,
  LaneError,
  parseInput,
  rootOf,
  type AnyHandle,
  type CreateInit,
  type Ctx,
  type Fields,
  type FieldSpec,
  type Handle,
  type Model,
  type Schema,
} from '../core/schema.ts'
import { MemoryStorage, type Storage } from './storage.ts'

/** Who is acting. Roles are always resolved against one of these, never against ambient state. */
export interface Identity {
  agent: string
  /** Value-proofs this identity has presented, such as share-link tokens. */
  tokens: Set<string>
  /** Set only inside an explicit `ctx.sudo()` or a sudo `transact`. */
  sudo?: boolean
}

interface Conn extends Identity {
  id: string
  /** Stable across reconnects of the same client; used to de-duplicate resent transactions. */
  client: string
  transport: Transport
  ready: boolean
  /** Every object this connection currently holds, with the rank it holds it at. */
  visible: Map<string, number>
  /** Stream roots this connection has opened. */
  open: Set<string>
  /** This connection's ether-lane values, per object. Memory only. */
  ether: Map<string, Fields>
}

export interface ServerOptions {
  schema: Schema<any>
  storage?: Storage
  /** Turn whatever the client sent as `auth` into an agent id, or null to refuse. */
  authenticate: (auth: unknown) => string | null
  /** Anything server actions need beyond the graph, exposed as `ctx.services`. */
  services?: Record<string, any>
  now?: () => number
}

class Tx {
  undo: (() => void)[] = []
  created: Rec[] = []
  deleted: Rec[] = []
  sets: { rec: Rec; fields: Fields; pos?: string }[] = []
  pov: { id: string; fields: Fields }[] = []
  ether: { id: string; fields: Fields }[] = []
  /** Objects whose subtree must be re-resolved for every connection. */
  resync = new Set<string>()
  /** Operations to append to each root's log, already root-relative. */
  wal = new Map<string, Op[]>()
  forks: { from: string; dst: string; upto: number }[] = []
  rows = false
  after: (() => void)[] = []

  constructor(readonly at: number) {}

  rollback(): void {
    for (let i = this.undo.length - 1; i >= 0; i--) this.undo[i]()
  }
}

const MAX_OPS = 500

export class Server {
  readonly schema: Schema<any>
  readonly graph = new Graph()
  readonly services: Record<string, any>
  private storage: Storage
  private authenticate: (auth: unknown) => string | null
  private now: () => number
  private conns = new Set<Conn>()
  private nextConn = 1
  /** agent → object → that agent's pov-lane values */
  private pov = new Map<string, Map<string, Fields>>()
  /** Loaded stream roots and the last sequence number in their log. */
  private streams = new Map<string, { seq: number }>()
  /** Replies to recent transactions, so a resend after a reconnect is not applied twice. */
  private seen = new Map<string, ServerMsg>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private top: number

  constructor(opts: ServerOptions) {
    this.schema = opts.schema.seal()
    this.storage = opts.storage ?? new MemoryStorage()
    this.authenticate = opts.authenticate
    this.services = opts.services ?? {}
    this.now = opts.now ?? Date.now
    this.top = this.schema.roles.length - 1

    const snapshot = this.storage.loadSnapshot()
    for (const rec of snapshot?.recs ?? []) {
      if (this.schema.models.has(rec.type)) this.graph.insert(rec)
      else console.warn(`lanes: skipping stored ${rec.id}, model ${rec.type} is no longer in the schema`)
    }
    for (const [agent, objects] of Object.entries(snapshot?.pov ?? {})) {
      this.pov.set(agent, new Map(Object.entries(objects)))
    }
  }

  // ───────────────────────────── public surface ─────────────────────────────

  /** Start serving a connection. */
  accept(transport: Transport): void {
    const conn: Conn = {
      id: `c${this.nextConn++}`,
      client: '',
      agent: '',
      tokens: new Set(),
      transport,
      ready: false,
      visible: new Map(),
      open: new Set(),
      ether: new Map(),
    }
    this.conns.add(conn)
    transport.onMessage(msg => this.receive(conn, msg))
    transport.onClose(() => this.drop(conn))
  }

  /** A transport for a client living in this process, such as an AI agent. */
  connectLocal(): Transport {
    const [mine, theirs] = memoryPair()
    this.accept(mine)
    return theirs
  }

  /**
   * Run a transaction from server code. It is bound by `agent`'s roles like
   * any client write unless `sudo` is set.
   */
  transact<T>(agent: string, fn: (ctx: Ctx) => T, opts: { sudo?: boolean } = {}): T {
    const tx = new Tx(this.now())
    const ctx = new ServerCtx(this, { agent, tokens: new Set(), sudo: opts.sudo }, tx)
    let result: T
    try {
      result = fn(ctx)
    } catch (error) {
      tx.rollback()
      throw error
    }
    this.commit(tx, agent)
    this.runAfter(tx)
    return result
  }

  /** Write the row snapshot now. Logs are always written as they commit. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const recs: Rec[] = []
    for (const rec of this.graph.values()) if (this.schema.get(rec.type).home === 'row') recs.push(rec)
    const pov: Record<string, Record<string, Fields>> = {}
    for (const [agent, objects] of this.pov) pov[agent] = Object.fromEntries(objects)
    this.storage.saveSnapshot({ recs, pov })
  }

  close(): void {
    this.flush()
    for (const conn of [...this.conns]) conn.transport.close()
  }

  /** The full log of a root, including the part it inherits from a fork source. */
  history(root: string, depth = 0): WalEntry[] {
    if (depth > 32) throw new Error(`Fork chain of ${root} is too deep`)
    const { header, entries } = this.storage.readWal(root)
    if (!header.fork) return entries
    const upto = header.fork.upto
    return [...this.history(header.fork.from, depth + 1).filter(entry => entry.seq <= upto), ...entries]
  }

  // ───────────────────────────── roles ─────────────────────────────

  /** Rank from the object's own role sources, ignoring inheritance. */
  private ownRole(who: Identity, rec: Rec): number {
    const model = this.schema.get(rec.type)
    let rank = model.everyoneRank
    if (rec.id === who.agent) rank = Math.max(rank, model.selfRank)
    for (const field of model.grantFields) {
      const spec = model.fields[field]
      const value = field in rec.fields ? rec.fields[field] : spec.default
      if (spec.grants && value === who.agent) rank = Math.max(rank, this.schema.rank(spec.grants))
      const forAll = spec.grantsEveryone?.[value as string]
      if (forAll) rank = Math.max(rank, this.schema.rank(forAll))
    }
    for (const grantModel of this.schema.grantModelsOn(model.name)) {
      const rule = grantModel.grant!
      for (const grant of this.graph.children(rec.id, grantModel.name)) {
        const holds =
          'to' in rule
            ? grant.fields[rule.to] === who.agent
            : // A short or empty token must never match, or an unset link would open the object.
              typeof grant.fields[rule.proof] === 'string' &&
              (grant.fields[rule.proof] as string).length >= 16 &&
              who.tokens.has(grant.fields[rule.proof] as string)
        if (holds) rank = Math.max(rank, this.schema.rank(grant.fields[rule.role] ?? grantModel.fields[rule.role].default))
      }
    }
    return rank
  }

  /** The rank `who` holds on `rec`, or -1 for none. */
  roleOf(who: Identity, rec: Rec): number {
    if (who.sudo) return this.top
    let rank = this.ownRole(who, rec)
    if (this.schema.get(rec.type).via) {
      const parent = this.graph.get(rec.parent)
      if (parent) rank = Math.max(rank, this.roleOf(who, parent))
    }
    return rank
  }

  /** The object and `who`'s rank on it, or `not_found` if they may not know it exists. */
  private see(who: Identity, id: unknown): { rec: Rec; role: number; model: Model } {
    if (typeof id === 'string') {
      const root = rootOf(id)
      if (root) this.ensureStream(root)
      const rec = this.graph.get(id)
      if (rec) {
        const model = this.schema.get(rec.type)
        const role = this.roleOf(who, rec)
        if (role >= model.readRank) return { rec, role, model }
      }
    }
    throw new LaneError('not_found', `No object ${String(id)}`)
  }

  private canSee(conn: Conn, rec: Rec, role: number): boolean {
    const model = this.schema.get(rec.type)
    return role >= model.readRank && (model.home === 'row' || conn.open.has(rootOf(rec.id)!))
  }

  // ───────────────────────────── writes ─────────────────────────────

  /** Validate one operation against `who`'s roles and apply it. Throws without partial effects of its own. */
  exec(who: Identity, op: Op, tx: Tx): void {
    if (!op || typeof op !== 'object') throw new LaneError('invalid', 'Malformed operation')
    if (op.op === 'new') this.execNew(who, op, tx)
    else if (op.op === 'set') this.execSet(who, op, tx)
    else if (op.op === 'del') this.execDel(who, op, tx)
    else throw new LaneError('invalid', `Unknown operation "${(op as any).op}"`)
  }

  private execNew(who: Identity, op: NewOp, tx: Tx): void {
    const model = this.schema.get(String(op.type))
    if (!isId(op.id)) throw new LaneError('invalid', `Bad object id "${String(op.id)}"`)
    if (typeof op.pos !== 'string' || !POS.test(op.pos)) throw new LaneError('invalid', `Bad position for ${op.id}`)
    const fields = op.fields ?? {}
    if (typeof fields !== 'object') throw new LaneError('invalid', `Bad fields for ${op.id}`)

    let parent: { rec: Rec; role: number } | null = null
    if (model.parent === null) {
      if (op.parent !== null) throw new LaneError('invalid', `${model.name} is a root model and takes no parent`)
    } else {
      parent = this.see(who, op.parent)
      if (parent.rec.type !== model.parent) {
        throw new LaneError('invalid', `${model.name} must be created under a ${model.parent}, not a ${parent.rec.type}`)
      }
    }
    const expectedRoot = model.home === 'stream' ? (rootOf(parent!.rec.id) ?? parent!.rec.id) : null
    if (rootOf(op.id) !== expectedRoot) throw new LaneError('invalid', `Id "${op.id}" does not fit a ${model.name} here`)
    // Load the root's log first, so the id check sees every object already in it.
    if (expectedRoot) this.ensureStream(expectedRoot)
    if (this.graph.has(op.id)) throw new LaneError('conflict', `Object ${op.id} already exists`)

    for (const [name, value] of Object.entries(fields)) {
      const spec = model.spec(name)
      if (spec.scope !== 'shared') {
        throw new LaneError('invalid', `${model.name}.${name} is in the ${spec.scope} lane; set it after creating the object`)
      }
      checkValue(model.name, name, spec, value)
      this.checkRef(model.name, name, spec, value)
    }

    const clean: NewOp = { op: 'new', id: op.id, type: model.name, parent: op.parent, pos: op.pos, fields }
    tx.undo.push(applyOp(this.graph, clean, who.agent, tx.at))
    const rec = this.graph.get(op.id)!
    // A child needs the create role on its parent. A root has no parent, so the
    // creator must end up holding that role on the object they just described.
    const role = this.roleOf(who, rec)
    if ((parent ? parent.role : role) < model.createRank) {
      throw new LaneError('forbidden', `${who.agent} may not create a ${model.name}${parent ? ` in ${parent.rec.id}` : ''}`)
    }
    for (const name of Object.keys(fields)) {
      if (role < model.fieldWriteRank(name)) throw this.denied(who, role, `write ${model.name}.${name}`)
    }
    tx.created.push(rec)
    if (model.grant) tx.resync.add(rec.parent!)
    this.persist(tx, rec.id, clean)
  }

  private execSet(who: Identity, op: SetOp, tx: Tx): void {
    const { rec, role, model } = this.see(who, op.id)
    const shared: Fields = {}
    const pov: Fields = {}
    const ether: Fields = {}
    const given = op.fields ?? {}
    if (typeof given !== 'object') throw new LaneError('invalid', `Bad fields for ${op.id}`)

    // The lane is always looked up from the schema. A client cannot choose where a value goes.
    for (const [name, value] of Object.entries(given)) {
      const spec = model.spec(name)
      checkValue(model.name, name, spec, value)
      const lane = model.lane(name)
      if (lane === 'session' || lane === 'local') {
        throw new LaneError('invalid', `${model.name}.${name} is in the ${lane} lane and never leaves the client`)
      } else if (lane === 'pov') {
        pov[name] = value
      } else if (lane === 'ether') {
        ether[name] = value
      } else {
        if (role < model.fieldWriteRank(name)) throw this.denied(who, role, `write ${model.name}.${name}`)
        this.checkRef(model.name, name, spec, value)
        shared[name] = value
      }
    }
    if (op.pos !== undefined) {
      if (typeof op.pos !== 'string' || !POS.test(op.pos)) throw new LaneError('invalid', `Bad position for ${op.id}`)
      if (role < model.writeRank) throw this.denied(who, role, `move ${rec.id}`)
    }

    if (Object.keys(shared).length > 0 || op.pos !== undefined) {
      const clean: SetOp = { op: 'set', id: rec.id, fields: shared }
      if (op.pos !== undefined) clean.pos = op.pos
      tx.undo.push(applyOp(this.graph, clean, who.agent, tx.at))
      tx.sets.push({ rec, fields: shared, pos: op.pos })
      if (model.grantFields.some(field => field in shared)) tx.resync.add(rec.id)
      if (model.grant) tx.resync.add(rec.parent!)
      this.persist(tx, rec.id, clean)
    }
    if (Object.keys(pov).length > 0) {
      let mine = this.pov.get(who.agent)
      if (!mine) this.pov.set(who.agent, (mine = new Map()))
      const before = mine.get(rec.id)
      mine.set(rec.id, { ...before, ...pov })
      tx.undo.push(() => (before ? mine.set(rec.id, before) : mine.delete(rec.id)))
      tx.pov.push({ id: rec.id, fields: pov })
      tx.rows = true
    }
    if (Object.keys(ether).length > 0) tx.ether.push({ id: rec.id, fields: ether })
  }

  private execDel(who: Identity, op: { id: string }, tx: Tx): void {
    const { rec, role, model } = this.see(who, op.id)
    if (role < model.deleteRank) throw this.denied(who, role, `delete ${rec.id}`)
    const clean: Op = { op: 'del', id: rec.id }
    tx.deleted.push(...this.graph.subtree(rec.id))
    tx.undo.push(applyOp(this.graph, clean, who.agent, tx.at))
    if (model.grant) tx.resync.add(rec.parent!)
    this.persist(tx, rec.id, clean)
  }

  private denied(who: Identity, role: number, what: string): LaneError {
    return new LaneError('forbidden', `${who.agent} (${this.schema.roleName(role) ?? 'no role'}) may not ${what}`)
  }

  private checkRef(model: string, field: string, spec: FieldSpec, value: unknown): void {
    if (spec.kind !== 'ref' || value === null) return
    if (this.graph.get(value as string)?.type !== spec.ref) {
      throw new LaneError('invalid', `${model}.${field}: ${String(value)} is not an existing ${spec.ref}`)
    }
  }

  /** Route a committed shared operation to its lane's storage. */
  private persist(tx: Tx, id: string, op: Op): void {
    const root = rootOf(id)
    if (!root) {
      tx.rows = true
      return
    }
    if (tx.forks.some(fork => fork.dst === root)) {
      throw new LaneError('invalid', `${root} is being forked in this transaction; write to it in the next one`)
    }
    const ops = tx.wal.get(root) ?? []
    ops.push(localize(root, op))
    tx.wal.set(root, ops)
  }

  forkStream(who: Identity, sourceId: string, targetId: string, upto: number | undefined, tx: Tx): void {
    const source = this.see(who, sourceId)
    const target = this.see(who, targetId)
    if (!source.model.streamRoot) throw new LaneError('invalid', `${sourceId} is not a stream root`)
    if (target.rec.type !== source.rec.type || sourceId === targetId) {
      throw new LaneError('invalid', `Cannot fork ${sourceId} into ${targetId}`)
    }
    // The fork shares every byte of the source log, so the caller must be
    // allowed to read everything that can be in it.
    if (source.role < Math.max(source.model.readRank, this.schema.streamCeiling)) {
      throw this.denied(who, source.role, `fork ${sourceId}`)
    }
    if (target.role < target.model.writeRank) throw this.denied(who, target.role, `fork into ${targetId}`)
    this.ensureStream(sourceId)
    const existing = this.storage.readWal(targetId)
    if (existing.entries.length > 0 || existing.header.fork || tx.wal.has(targetId) || tx.forks.some(f => f.dst === targetId)) {
      throw new LaneError('conflict', `${targetId} already has content`)
    }
    const latest = this.streams.get(sourceId)!.seq
    tx.forks.push({ from: sourceId, dst: targetId, upto: upto && upto > 0 ? Math.min(upto, latest) : latest })
  }

  /** Load a root's log into the graph on first use. */
  ensureStream(root: string): boolean {
    if (this.streams.has(root)) return true
    const rec = this.graph.get(root)
    if (!rec || !this.schema.get(rec.type).streamRoot) return false
    const entries = this.history(root)
    foldWal(this.graph, root, entries)
    this.streams.set(root, { seq: entries.length > 0 ? entries[entries.length - 1].seq : 0 })
    return true
  }

  // ───────────────────────────── commit and fan-out ─────────────────────────────

  private commit(tx: Tx, by: string, origin?: Conn): void {
    for (const [root, ops] of tx.wal) {
      const stream = this.streams.get(root)
      if (!stream || !this.graph.has(root)) continue // the root itself was deleted in this transaction
      this.storage.appendWal(root, { seq: ++stream.seq, at: tx.at, by, ops })
    }
    for (const fork of tx.forks) {
      if (!this.graph.has(fork.dst)) continue
      this.storage.createWal(fork.dst, { fork: { from: fork.from, upto: fork.upto } })
      this.streams.delete(fork.dst)
      this.ensureStream(fork.dst)
      tx.resync.add(fork.dst)
    }
    for (const rec of tx.deleted) {
      // The log file stays: another root may have forked from it.
      this.streams.delete(rec.id)
      for (const objects of this.pov.values()) objects.delete(rec.id)
    }
    if (tx.rows || tx.deleted.length > 0) this.scheduleSave()

    for (const conn of this.conns) if (conn.ready) this.fanOut(conn, tx, by, conn === origin)

    if (origin) {
      for (const { id, fields } of tx.ether) {
        if (!origin.visible.has(id)) continue
        const merged = { ...origin.ether.get(id), ...fields }
        origin.ether.set(id, merged)
        this.relayEther(origin, id, merged)
      }
    }
  }

  /** Tell one connection what a committed transaction means for its replica. */
  private fanOut(conn: Conn, tx: Tx, by: string, isOrigin: boolean): void {
    const enter: Hydrated[] = []
    const leave: string[] = []
    const entered = new Set<string>()

    for (const rec of tx.deleted) {
      if (!conn.visible.has(rec.id)) continue
      this.evict(conn, rec.id, false)
      leave.push(rec.id)
    }
    for (const rec of tx.created) {
      if (this.graph.get(rec.id) !== rec) continue
      const role = this.roleOf(conn, rec)
      if (!this.canSee(conn, rec, role)) continue
      conn.visible.set(rec.id, role)
      enter.push(this.hydrate(conn, rec, role))
      entered.add(rec.id)
    }
    for (const id of tx.resync) {
      const rec = this.graph.get(id)
      if (rec) this.resync(conn, rec, enter, leave, entered)
    }

    // The origin already shows its own writes; everyone else gets the fields their role may read.
    const ops: SetOp[] = []
    const pov: { id: string; fields: Fields }[] = []
    if (!isOrigin) {
      for (const set of tx.sets) {
        if (entered.has(set.rec.id)) continue
        const role = conn.visible.get(set.rec.id)
        if (role === undefined) continue
        const model = this.schema.get(set.rec.type)
        const fields: Fields = {}
        for (const [name, value] of Object.entries(set.fields)) {
          if (role >= model.fieldReadRank(name)) fields[name] = value
        }
        if (Object.keys(fields).length === 0 && set.pos === undefined) continue
        const op: SetOp = { op: 'set', id: set.rec.id, fields }
        if (set.pos !== undefined) op.pos = set.pos
        ops.push(op)
      }
      if (conn.agent === by) {
        for (const change of tx.pov) if (conn.visible.has(change.id) && !entered.has(change.id)) pov.push(change)
      }
    }

    if (enter.length + leave.length + ops.length + pov.length === 0) return
    const msg: ServerMsg = { t: 'change', by, at: tx.at }
    if (enter.length > 0) msg.enter = enter
    if (leave.length > 0) msg.leave = leave
    if (ops.length > 0) msg.ops = ops
    if (pov.length > 0) msg.pov = pov
    this.send(conn, msg)
  }

  /**
   * Re-resolve one subtree for one connection: hydrate what became visible or
   * changed role, evict what is no longer visible.
   */
  private resync(conn: Conn, top: Rec, enter: Hydrated[], leave: string[], entered: Set<string>): void {
    const walk = (rec: Rec, parentRole: number) => {
      const role = Math.max(this.ownRole(conn, rec), this.schema.get(rec.type).via ? parentRole : -1)
      const see = this.canSee(conn, rec, role)
      const before = conn.visible.get(rec.id)
      if (see && before !== role) {
        conn.visible.set(rec.id, role)
        enter.push(this.hydrate(conn, rec, role))
        entered.add(rec.id)
      } else if (!see && before !== undefined) {
        this.evict(conn, rec.id, true)
        leave.push(rec.id)
      }
      for (const child of this.graph.children(rec.id)) walk(child, role)
    }
    const parent = this.graph.get(top.parent)
    walk(top, parent ? this.roleOf(conn, parent) : -1)
  }

  private hydrate(conn: Conn, rec: Rec, role: number): Hydrated {
    const model = this.schema.get(rec.type)
    const out: Hydrated = {
      id: rec.id,
      type: rec.type,
      parent: rec.parent,
      pos: rec.pos,
      role: this.schema.roleName(role)!,
      fields: {},
      meta: { by: rec.meta.by, at: rec.meta.at, f: {} },
    }
    for (const [name, value] of Object.entries(rec.fields)) {
      if (model.fields[name]?.scope !== 'shared' || role < model.fieldReadRank(name)) continue
      out.fields[name] = value
      if (rec.meta.f[name]) out.meta.f[name] = rec.meta.f[name]
    }
    const pov = this.pov.get(conn.agent)?.get(rec.id)
    if (pov) out.pov = pov
    const peers: PeerState[] = []
    for (const other of this.conns) {
      const fields = other !== conn && other.ether.get(rec.id)
      if (fields) peers.push({ conn: other.id, agent: other.agent, fields: this.readable(model, role, fields) })
    }
    if (peers.length > 0) out.ether = peers
    return out
  }

  private readable(model: Model, role: number, fields: Fields): Fields {
    const out: Fields = {}
    for (const [name, value] of Object.entries(fields)) if (role >= model.fieldReadRank(name)) out[name] = value
    return out
  }

  private evict(conn: Conn, id: string, announce: boolean): void {
    conn.visible.delete(id)
    conn.open.delete(id)
    if (conn.ether.delete(id) && announce) this.relayEther(conn, id, null)
  }

  private relayEther(from: Conn, id: string, fields: Fields | null): void {
    const rec = this.graph.get(id)
    if (!rec) return
    const model = this.schema.get(rec.type)
    for (const conn of this.conns) {
      const role = conn.visible.get(id)
      if (conn === from || role === undefined) continue
      this.send(conn, { t: 'ether', id, conn: from.id, agent: from.agent, fields: fields && this.readable(model, role, fields) })
    }
  }

  // ───────────────────────────── connections ─────────────────────────────

  private send(conn: Conn, msg: ServerMsg): void {
    conn.transport.send(msg)
  }

  private drop(conn: Conn): void {
    if (!this.conns.delete(conn)) return
    for (const id of conn.ether.keys()) this.relayEther(conn, id, null)
  }

  private receive(conn: Conn, msg: ClientMsg): void {
    try {
      if (!msg || typeof msg !== 'object') throw new LaneError('invalid', 'Malformed message')
      if (msg.t === 'hello') return this.onHello(conn, msg)
      if (!conn.ready) throw new LaneError('forbidden', 'Say hello first')
      switch (msg.t) {
        case 'tx':
          return this.onTx(conn, msg)
        case 'open':
          return this.reply(conn, msg.n, () => this.onOpen(conn, msg.root))
        case 'close':
          return this.onCloseStream(conn, msg.root)
        case 'history':
          return this.reply(conn, msg.n, () => this.onHistory(conn, msg.root))
        case 'call':
          return this.onCall(conn, msg)
        case 'proof':
          if (typeof msg.token === 'string') conn.tokens.add(msg.token)
          return this.fullSync(conn, false)
        default:
          throw new LaneError('invalid', `Unknown message "${(msg as any).t}"`)
      }
    } catch (error) {
      // Anything that reaches here has no request to attach the error to.
      this.send(conn, { t: 'fatal', error: error instanceof Error ? error.message : String(error) })
      conn.transport.close()
    }
  }

  private onHello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (conn.ready) throw new LaneError('invalid', 'Already said hello')
    const agent = this.authenticate(msg.auth)
    if (!agent) throw new LaneError('forbidden', 'Not signed in')
    conn.agent = agent
    conn.client = String(msg.client)
    for (const token of Array.isArray(msg.tokens) ? msg.tokens : []) if (typeof token === 'string') conn.tokens.add(token)
    conn.ready = true
    this.send(conn, { t: 'welcome', agent, conn: conn.id })
    this.fullSync(conn, true)
  }

  private fullSync(conn: Conn, reset: boolean): void {
    const enter: Hydrated[] = []
    const leave: string[] = []
    for (const root of this.graph.children(null)) this.resync(conn, root, enter, leave, new Set())
    if (reset || enter.length + leave.length > 0) this.send(conn, { t: 'change', reset: reset || undefined, enter, leave })
  }

  private onTx(conn: Conn, msg: Extract<ClientMsg, { t: 'tx' }>): void {
    const key = `${conn.client}:${msg.n}`
    const earlier = this.seen.get(key)
    if (earlier) return this.send(conn, earlier)

    const tx = new Tx(this.now())
    let reply: ServerMsg
    try {
      if (!Array.isArray(msg.ops) || msg.ops.length > MAX_OPS) throw new LaneError('invalid', 'Bad transaction')
      for (const op of msg.ops) this.exec(conn, op, tx)
      this.commit(tx, conn.agent, conn)
      reply = { t: 'ack', n: msg.n }
    } catch (error) {
      tx.rollback()
      reply = { t: 'nack', n: msg.n, ...this.describe(error) }
    }
    this.seen.set(key, reply)
    if (this.seen.size > 5000) this.seen.delete(this.seen.keys().next().value!)
    this.send(conn, reply)
  }

  private reply(conn: Conn, n: number, fn: () => unknown): void {
    try {
      this.send(conn, { t: 'result', n, ok: true, value: fn() })
    } catch (error) {
      this.send(conn, { t: 'result', n, ok: false, ...this.describe(error) })
    }
  }

  private describe(error: unknown): { code: LaneError['code']; error: string } {
    if (error instanceof LaneError) return { code: error.code, error: error.message }
    console.error('lanes: unexpected error', error)
    return { code: 'invalid', error: 'Internal error' }
  }

  private onOpen(conn: Conn, root: string): { seq: number } {
    const { rec, model } = this.see(conn, root)
    if (!model.streamRoot || !conn.visible.has(rec.id)) throw new LaneError('invalid', `${root} is not a stream you can open`)
    this.ensureStream(rec.id)
    conn.open.add(rec.id)
    const enter: Hydrated[] = []
    this.resync(conn, rec, enter, [], new Set())
    if (enter.length > 0) this.send(conn, { t: 'change', enter })
    return { seq: this.streams.get(rec.id)!.seq }
  }

  private onCloseStream(conn: Conn, root: string): void {
    if (typeof root !== 'string' || !conn.open.delete(root)) return
    for (const rec of this.graph.subtree(root)) if (rootOf(rec.id) === root) this.evict(conn, rec.id, true)
  }

  private onHistory(conn: Conn, root: string): { entries: WalEntry[] } {
    const { rec, role, model } = this.see(conn, root)
    if (!model.streamRoot) throw new LaneError('invalid', `${root} is not a stream root`)
    const entries = this.history(rec.id)
    if (role >= this.schema.streamCeiling) return { entries }
    // Below the ceiling, strip fields this role may not read. `set` carries no type, so track it.
    const types = new Map<string, Model>()
    return {
      entries: entries.map(entry => ({
        ...entry,
        ops: entry.ops.map(op => {
          if (op.op === 'new') types.set(op.id, this.schema.get(op.type))
          const type = types.get(op.id)
          if (op.op === 'del' || !type) return op.op === 'del' ? op : { ...op, fields: {} }
          return { ...op, fields: this.readable(type, role, op.fields) }
        }),
      })),
    }
  }

  private onCall(conn: Conn, msg: Extract<ClientMsg, { t: 'call' }>): void {
    const tx = new Tx(this.now())
    let value: unknown
    try {
      const def = this.schema.actions.get(msg.action)
      if (!def) throw new LaneError('invalid', `Unknown action ${String(msg.action)}`)
      if (def.runs !== 'server') throw new LaneError('invalid', `${def.name} runs on the client`)
      const { rec, role } = this.see(conn, msg.target)
      if (rec.type !== def.on.name) throw new LaneError('invalid', `${def.name} applies to ${def.on.name}, not ${rec.type}`)
      if (role < this.schema.rank(def.role)) throw this.denied(conn, role, `run ${def.name}`)
      const input = parseInput(def, msg.input)
      // The body runs as the caller. It gets no rights the caller does not hold.
      const ctx = new ServerCtx(this, conn, tx)
      const target = ctx.handle(rec)
      if (def.when && !def.when(target, ctx)) throw new LaneError('forbidden', `${def.name} is not available here`)
      value = def.run(ctx, target, input)
      this.commit(tx, conn.agent)
    } catch (error) {
      tx.rollback()
      return this.send(conn, { t: 'result', n: msg.n, ok: false, ...this.describe(error) })
    }
    this.send(conn, { t: 'result', n: msg.n, ok: true, value: value ?? null })
    this.runAfter(tx)
  }

  private runAfter(tx: Tx): void {
    for (const fn of tx.after) {
      try {
        fn()
      } catch (error) {
        console.error('lanes: after-commit hook failed', error)
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), 25)
    ;(this.saveTimer as any).unref?.()
  }

  /** @internal */
  povOf(agent: string, id: string): Fields | undefined {
    return this.pov.get(agent)?.get(id)
  }
}

/** The graph as one identity may see and change it, inside one transaction. */
class ServerCtx implements Ctx, HandleHost {
  readonly side = 'server' as const
  private handles = new Map<string, AnyHandle>()

  constructor(
    private server: Server,
    private who: Identity,
    private tx: Tx,
  ) {}

  get agent(): string {
    return this.who.agent
  }
  get services(): Record<string, any> {
    return this.server.services
  }

  handle<M extends Model<any>>(rec: Rec): Handle<M> {
    let handle = this.handles.get(rec.id)
    if (!handle) this.handles.set(rec.id, (handle = makeHandle(this, rec.id, this.server.schema.get(rec.type))))
    return handle as Handle<M>
  }

  private visible(rec: Rec | undefined, model: Model): rec is Rec {
    return !!rec && rec.type === model.name && this.server.roleOf(this.who, rec) >= model.readRank
  }

  get<M extends Model<any>>(model: M, id: string | null | undefined): Handle<M> | undefined {
    if (!id) return undefined
    const root = rootOf(id)
    if (root) this.server.ensureStream(root)
    const rec = this.server.graph.get(id)
    return this.visible(rec, model) ? this.handle(rec) : undefined
  }

  /** Every loaded object of a model that the caller may see. */
  all<M extends Model<any>>(model: M): Handle<M>[] {
    const out: Handle<M>[] = []
    for (const rec of this.server.graph.values()) if (this.visible(rec, model)) out.push(this.handle(rec))
    return out
  }

  children<M extends Model<any>>(parent: AnyHandle, model: M): Handle<M>[] {
    if (model.home === 'stream') this.server.ensureStream(rootOf(parent.id) ?? parent.id)
    return this.server.graph
      .children(parent.id, model.name)
      .filter(rec => this.visible(rec, model))
      .map(rec => this.handle<M>(rec))
  }

  create<M extends Model<any>>(model: M, init: CreateInit<M>): Handle<M> {
    const { id, parent, after, before, ...values } = init as CreateInit<Model> & Fields
    const parentId = parent?.id ?? null
    if (model.home === 'stream' && parentId) this.server.ensureStream(rootOf(parentId) ?? parentId)
    const newObjectId = id ?? newId(model, parentId)
    const shared: Fields = {}
    const rest: Fields = {}
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) continue
      ;(model.spec(name).scope === 'shared' ? shared : rest)[name] = value
    }
    const pos = place(this.server.graph.children(parentId), after?.id, before?.id)
    this.server.exec(this.who, { op: 'new', id: newObjectId, type: model.name, parent: parentId, pos, fields: shared }, this.tx)
    if (Object.keys(rest).length > 0) this.server.exec(this.who, { op: 'set', id: newObjectId, fields: rest }, this.tx)
    return this.handle(this.server.graph.get(newObjectId)!)
  }

  remove(target: AnyHandle): void {
    this.server.exec(this.who, { op: 'del', id: target.id }, this.tx)
  }

  sudo<T>(fn: () => T): T {
    const before = this.who
    this.who = { agent: before.agent, tokens: before.tokens, sudo: true }
    try {
      return fn()
    } finally {
      this.who = before
    }
  }

  after(fn: () => void): void {
    this.tx.after.push(fn)
  }

  forkStream(source: AnyHandle, target: AnyHandle, upto?: number): void {
    this.server.forkStream(this.who, source.id, target.id, upto, this.tx)
  }

  // HandleHost

  look(id: string): Rec | undefined {
    return this.server.graph.get(id)
  }

  read(id: string, model: Model, field: string): unknown {
    const spec = model.fields[field]
    const lane = model.lane(field)
    const rec = this.server.graph.get(id)!
    if (lane === 'row' || lane === 'stream') return field in rec.fields ? rec.fields[field] : spec.default
    if (lane === 'pov') return this.server.povOf(this.who.agent, id)?.[field] ?? spec.default
    return spec.default
  }

  write(id: string, fields: Fields, pos?: string): void {
    const op: SetOp = { op: 'set', id, fields }
    if (pos !== undefined) op.pos = pos
    this.server.exec(this.who, op, this.tx)
  }

  role(id: string): string | null {
    const rec = this.server.graph.get(id)
    return rec ? this.server.schema.roleName(this.server.roleOf(this.who, rec)) : null
  }
}
