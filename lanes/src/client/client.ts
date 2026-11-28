/**
 * The replica. It holds what the server has confirmed, lays the client's own
 * unconfirmed transactions on top, and routes every write by the lane its
 * field was declared in.
 *
 * What you read through a handle is always "confirmed state plus my pending
 * writes". A rejected transaction is simply removed from the overlay, so the
 * view falls back to confirmed state without any hand-written undo.
 */

import { byPos, foldWal, Graph, type NewOp, type Op, type Rec, type SetOp, type WalEntry } from '../core/graph.ts'
import { makeHandle, type HandleHost } from '../core/handle.ts'
import { newId, rid } from '../core/ids.ts'
import { place, POS } from '../core/pos.ts'
import type { ClientMsg, ServerMsg, Transport } from '../core/protocol.ts'
import {
  checkValue,
  LaneError,
  parseInput,
  rootOf,
  type ActionDef,
  type AnyHandle,
  type CreateInit,
  type Ctx,
  type ErrorCode,
  type FieldMap,
  type Fields,
  type Handle,
  type Model,
  type Schema,
  type ValuesOf,
} from '../core/schema.ts'

/** Where the session and local lanes keep their values. */
export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  /** Called when another tab changes a value. */
  subscribe?(cb: () => void): void
}

export function memoryKV(): KV {
  const map = new Map<string, string>()
  return { get: key => map.get(key) ?? null, set: (key, value) => void map.set(key, value) }
}

/** `sessionStorage` for the session lane, `localStorage` for the local lane. */
export function webKV(storage: Storage, prefix = 'lanes:'): KV {
  return {
    get: key => storage.getItem(prefix + key),
    set: (key, value) => storage.setItem(prefix + key, value),
    subscribe: cb => window.addEventListener('storage', event => event.storageArea === storage && cb()),
  }
}

interface CRec extends Rec {
  /** This agent's role, as resolved by the server. */
  role: string | null
  /** This agent's pov-lane values. */
  pov: Fields
}

interface PendingTx {
  n: number
  at: number
  ops: Op[]
  /** For each delete: the descendants it hides while unconfirmed. */
  hidden: Map<string, string[]>
}

export type Status = 'connecting' | 'online' | 'offline' | 'closed'

export interface Rejection {
  code: ErrorCode
  message: string
  ops: Op[]
}

export interface Peer<M extends Model<any> = Model> {
  conn: string
  agent: string
  /** The peer's ether-lane values on this object. */
  state: Partial<ValuesOf<M['_fields']>>
}

interface Events {
  /** Something readable through a handle changed. Coalesced per microtask. */
  change: () => void
  /** The server refused a transaction; its optimistic effects are already gone. */
  rejected: (rejection: Rejection) => void
  status: (status: Status) => void
  /** Every message in or out, for inspection. */
  wire: (direction: 'in' | 'out', msg: ClientMsg | ServerMsg) => void
}

export interface ClientOptions {
  schema: Schema<any>
  connect: () => Transport
  auth: unknown
  /** Value-proofs to present, such as share-link tokens. */
  tokens?: string[]
  session?: KV
  local?: KV
  /** Reconnect after this many ms when the transport closes. Off by default. */
  reconnect?: number
}

export class Client implements Ctx, HandleHost {
  readonly schema: Schema<any>
  readonly side = 'client' as const
  readonly services: Record<string, any> = {}
  agent = ''
  conn = ''
  status: Status = 'connecting'
  /** Increases whenever anything readable changes. */
  version = 0

  private opts: ClientOptions
  private transport: Transport | null = null
  private clientId = rid(12)
  private tokens: Set<string>
  private session: KV
  private local: KV

  /** Confirmed by the server. */
  private base = new Map<string, CRec>()
  /** Confirmed plus pending: what handles read. */
  private view = new Map<string, CRec>()
  private pending: PendingTx[] = []
  private openTx: PendingTx | null = null
  private afterTx: (() => void)[] = []
  private kids: Map<string, CRec[]> | null = null
  private handles = new Map<string, AnyHandle>()
  private peersBy = new Map<string, Map<string, { agent: string; fields: Fields }>>()
  private myEther = new Map<string, Fields>()
  private opened = new Set<string>()
  private calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private nextN = 1
  private listeners: { [K in keyof Events]: Set<Events[K]> } = {
    change: new Set(),
    rejected: new Set(),
    status: new Set(),
    wire: new Set(),
  }
  private notifyQueued = false
  private synced = false
  private readyWaiters: (() => void)[] = []
  private settleWaiters: (() => void)[] = []

  constructor(opts: ClientOptions) {
    this.opts = opts
    this.schema = opts.schema.seal()
    this.tokens = new Set(opts.tokens)
    this.session = opts.session ?? memoryKV()
    this.local = opts.local ?? memoryKV()
    this.local.subscribe?.(() => this.bump())
    this.connect()
  }

  // ───────────────────────────── connection ─────────────────────────────

  private connect(): void {
    const transport = (this.transport = this.opts.connect())
    transport.onMessage(msg => transport === this.transport && this.receive(msg))
    transport.onClose(() => transport === this.transport && this.disconnected())
    this.setStatus('connecting')
    this.sendRaw({ t: 'hello', auth: this.opts.auth, tokens: [...this.tokens], client: this.clientId })
  }

  private disconnected(): void {
    this.transport = null
    if (this.status === 'closed') return
    this.setStatus('offline')
    for (const call of this.calls.values()) call.reject(new LaneError('conflict', 'Disconnected before the server answered'))
    this.calls.clear()
    if (this.opts.reconnect) setTimeout(() => this.status === 'offline' && this.connect(), this.opts.reconnect)
  }

  close(): void {
    this.setStatus('closed')
    this.transport?.close()
    this.transport = null
  }

  private setStatus(status: Status): void {
    if (this.status === status) return
    this.status = status
    for (const cb of this.listeners.status) cb(status)
  }

  private sendRaw(msg: ClientMsg): void {
    if (!this.transport) return
    for (const cb of this.listeners.wire) cb('out', msg)
    this.transport.send(msg)
  }

  /** Resolves once the first full sync has arrived. */
  ready(): Promise<this> {
    if (this.synced) return Promise.resolve(this)
    return new Promise(resolve => this.readyWaiters.push(() => resolve(this)))
  }

  /** Resolves once every transaction and call has been answered by the server. */
  settled(): Promise<void> {
    if (this.pending.length === 0 && this.calls.size === 0) return Promise.resolve()
    return new Promise(resolve => this.settleWaiters.push(resolve))
  }

  /** Number of transactions the server has not answered yet. */
  get pendingCount(): number {
    return this.pending.length
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): () => void {
    this.listeners[event].add(cb)
    return () => void this.listeners[event].delete(cb)
  }

  /** Present a value-proof, such as a share-link token. Objects it unlocks arrive like any other change. */
  prove(token: string): void {
    this.tokens.add(token)
    this.sendRaw({ t: 'proof', token })
  }

  // ───────────────────────────── inbound ─────────────────────────────

  private receive(msg: ServerMsg): void {
    for (const cb of this.listeners.wire) cb('in', msg)
    switch (msg.t) {
      case 'welcome': {
        this.agent = msg.agent
        this.conn = msg.conn
        this.setStatus('online')
        // After a reconnect: reopen streams, resend what was never answered (the
        // server ignores transactions it already applied), restore presence.
        for (const root of this.opened) this.sendRaw({ t: 'open', n: this.nextN++, root })
        for (const tx of this.pending) if (tx !== this.openTx) this.sendRaw({ t: 'tx', n: tx.n, ops: tx.ops })
        for (const [id, fields] of this.myEther) this.sendRaw({ t: 'tx', n: this.nextN++, ops: [{ op: 'set', id, fields }] })
        return
      }
      case 'change':
        return this.applyChange(msg)
      case 'ether': {
        let peers = this.peersBy.get(msg.id)
        if (!peers) this.peersBy.set(msg.id, (peers = new Map()))
        if (msg.fields) peers.set(msg.conn, { agent: msg.agent, fields: msg.fields })
        else peers.delete(msg.conn)
        return this.bump()
      }
      case 'ack':
        return this.settle(msg.n, null)
      case 'nack':
        return this.settle(msg.n, new LaneError(msg.code, msg.error))
      case 'result': {
        const call = this.calls.get(msg.n)
        if (!call) return
        this.calls.delete(msg.n)
        if (msg.ok) call.resolve(msg.value)
        else call.reject(new LaneError(msg.code, msg.error))
        return this.checkSettled()
      }
      case 'fatal':
        console.error(`lanes: server closed the connection: ${msg.error}`)
        this.opts.reconnect = undefined
        return
    }
  }

  private applyChange(msg: Extract<ServerMsg, { t: 'change' }>): void {
    const touched = new Set<string>()
    if (msg.reset) {
      for (const id of this.base.keys()) touched.add(id)
      this.base.clear()
      this.peersBy.clear()
    }
    for (const id of msg.leave ?? []) this.dropBase(id, touched)
    for (const h of msg.enter ?? []) {
      if (!this.schema.models.has(h.type)) {
        console.warn(`lanes: server sent ${h.id} of unknown model ${h.type}; is the client built from an older schema?`)
        continue
      }
      this.base.set(h.id, { id: h.id, type: h.type, parent: h.parent, pos: h.pos, fields: h.fields, meta: h.meta, role: h.role, pov: h.pov ?? {} })
      const peers = new Map<string, { agent: string; fields: Fields }>()
      for (const peer of h.ether ?? []) if (peer.fields) peers.set(peer.conn, { agent: peer.agent, fields: peer.fields })
      if (peers.size > 0) this.peersBy.set(h.id, peers)
      else this.peersBy.delete(h.id)
      touched.add(h.id)
    }
    for (const op of msg.ops ?? []) {
      const rec = this.base.get(op.id)
      if (!rec) continue
      for (const [field, value] of Object.entries(op.fields)) {
        rec.fields[field] = value
        rec.meta.f[field] = [msg.by ?? '', msg.at ?? 0]
      }
      if (op.pos !== undefined) rec.pos = op.pos
      touched.add(op.id)
    }
    for (const change of msg.pov ?? []) {
      const rec = this.base.get(change.id)
      if (rec) Object.assign(rec.pov, change.fields)
      touched.add(change.id)
    }
    if (msg.reset) for (const tx of this.pending) for (const id of this.idsOf(tx)) touched.add(id)
    for (const id of touched) this.rebuild(id)
    this.bump()
    if (msg.reset && !this.synced) {
      this.synced = true
      for (const resolve of this.readyWaiters.splice(0)) resolve()
    }
  }

  /** Remove a confirmed object and everything confirmed beneath it. */
  private dropBase(id: string, touched: Set<string>): void {
    const gone = new Set([id])
    for (let grew = true; grew; ) {
      grew = false
      for (const rec of this.base.values()) {
        if (!gone.has(rec.id) && rec.parent !== null && gone.has(rec.parent)) {
          gone.add(rec.id)
          grew = true
        }
      }
    }
    for (const each of gone) {
      this.base.delete(each)
      this.peersBy.delete(each)
      this.myEther.delete(each)
      this.opened.delete(each)
      touched.add(each)
    }
  }

  private settle(n: number, error: LaneError | null): void {
    const index = this.pending.findIndex(tx => tx.n === n)
    if (index < 0) {
      // Not a tracked transaction: an ether write. A refusal is still reported, never swallowed.
      if (error) for (const cb of this.listeners.rejected) cb({ code: error.code, message: error.message, ops: [] })
      return
    }
    const [tx] = this.pending.splice(index, 1)
    if (!error) {
      const touched = new Set<string>()
      for (const op of tx.ops) this.confirm(op, tx, touched)
      for (const id of touched) this.rebuild(id)
    }
    for (const id of this.idsOf(tx)) this.rebuild(id)
    this.bump()
    if (error) for (const cb of this.listeners.rejected) cb({ code: error.code, message: error.message, ops: tx.ops })
    this.checkSettled()
  }

  private checkSettled(): void {
    if (this.pending.length === 0 && this.calls.size === 0) for (const resolve of this.settleWaiters.splice(0)) resolve()
  }

  /** Fold one of our own acknowledged operations into confirmed state. */
  private confirm(op: Op, tx: PendingTx, touched: Set<string>): void {
    if (op.op === 'new') {
      if (!this.base.has(op.id)) this.base.set(op.id, this.fresh(op, tx.at))
    } else if (op.op === 'set') {
      const rec = this.base.get(op.id)
      if (rec) this.overlay(rec, op, tx.at)
    } else {
      this.dropBase(op.id, touched)
    }
  }

  private fresh(op: NewOp, at: number): CRec {
    const model = this.schema.get(op.type)
    const meta = { by: this.agent, at, f: {} as Record<string, [string, number]> }
    for (const field of Object.keys(op.fields)) meta.f[field] = [this.agent, at]
    // Until the server says otherwise, assume what the schema implies: a child
    // shares its parent's role, and you hold the top role on a root you made.
    const role = model.via && op.parent ? (this.view.get(op.parent)?.role ?? null) : this.schema.roles[this.schema.roles.length - 1]
    return { id: op.id, type: op.type, parent: op.parent, pos: op.pos, fields: { ...op.fields }, meta, role, pov: {} }
  }

  private overlay(rec: CRec, op: SetOp, at: number): void {
    const model = this.schema.get(rec.type)
    for (const [field, value] of Object.entries(op.fields)) {
      if (model.fields[field]?.scope === 'pov') {
        rec.pov[field] = value
      } else {
        rec.fields[field] = value
        rec.meta.f[field] = [this.agent, at]
      }
    }
    if (op.pos !== undefined) rec.pos = op.pos
  }

  private idsOf(tx: PendingTx): Set<string> {
    const ids = new Set<string>()
    for (const op of tx.ops) ids.add(op.id)
    for (const hidden of tx.hidden.values()) for (const id of hidden) ids.add(id)
    return ids
  }

  /** Recompute what handles read for one object: confirmed state, then each pending transaction in order. */
  private rebuild(id: string): void {
    const confirmed = this.base.get(id)
    let rec: CRec | undefined = confirmed && {
      ...confirmed,
      fields: { ...confirmed.fields },
      pov: { ...confirmed.pov },
      meta: { ...confirmed.meta, f: { ...confirmed.meta.f } },
    }
    for (const tx of this.pending) {
      for (const op of tx.ops) {
        if (op.op === 'del') {
          if (op.id === id || tx.hidden.get(op.id)?.includes(id)) rec = undefined
        } else if (op.id !== id) {
          continue
        } else if (op.op === 'new') {
          if (rec) Object.assign(rec.fields, op.fields)
          else rec = this.fresh(op, tx.at)
        } else if (rec) {
          this.overlay(rec, op, tx.at)
        }
      }
    }
    if (rec) this.view.set(id, rec)
    else this.view.delete(id)
  }

  private bump(): void {
    this.version++
    this.kids = null
    if (this.notifyQueued) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const cb of this.listeners.change) cb()
    })
  }

  // ───────────────────────────── reading ─────────────────────────────

  private handleOf<M extends Model<any>>(rec: CRec): Handle<M> {
    let handle = this.handles.get(rec.id)
    if (!handle) this.handles.set(rec.id, (handle = makeHandle(this, rec.id, this.schema.get(rec.type))))
    return handle as Handle<M>
  }

  get<M extends Model<any>>(model: M, id: string | null | undefined): Handle<M> | undefined {
    const rec = id ? this.view.get(id) : undefined
    return rec && rec.type === model.name ? this.handleOf(rec) : undefined
  }

  /** Any visible object by id, when the caller does not know its model. */
  find(id: string | null | undefined): AnyHandle | undefined {
    const rec = id ? this.view.get(id) : undefined
    return rec && this.handleOf(rec)
  }

  /** Every visible object of a model, in sibling order. */
  all<M extends Model<any>>(model: M): Handle<M>[] {
    const recs: CRec[] = []
    for (const rec of this.view.values()) if (rec.type === model.name) recs.push(rec)
    return recs.sort(byPos).map(rec => this.handleOf<M>(rec))
  }

  private siblings(parent: string | null): CRec[] {
    if (!this.kids) {
      this.kids = new Map()
      for (const rec of this.view.values()) {
        const key = rec.parent ?? ''
        const list = this.kids.get(key)
        if (list) list.push(rec)
        else this.kids.set(key, [rec])
      }
      for (const list of this.kids.values()) list.sort(byPos)
    }
    return this.kids.get(parent ?? '') ?? []
  }

  children<M extends Model<any>>(parent: AnyHandle, model: M): Handle<M>[] {
    return this.siblings(parent.id)
      .filter(rec => rec.type === model.name)
      .map(rec => this.handleOf<M>(rec))
  }

  /** Other connections' ether-lane values on an object: who else is here, and what they are doing. */
  peers<M extends Model<any>>(target: Handle<M>): Peer<M>[] {
    const peers = this.peersBy.get(target.id)
    if (!peers) return []
    return [...peers].map(([conn, peer]) => ({ conn, agent: peer.agent, state: peer.fields as Peer<M>['state'] }))
  }

  /** What the current agent may do, from the same declarations the server enforces. */
  readonly can = {
    write: (target: AnyHandle, field: string): boolean => {
      const rec = this.view.get(target.id)
      return !!rec && this.schema.rank(rec.role) >= target.$model.fieldWriteRank(field)
    },
    move: (target: AnyHandle): boolean => {
      const rec = this.view.get(target.id)
      return !!rec && this.schema.rank(rec.role) >= target.$model.writeRank
    },
    create: (model: Model<any>, parent: AnyHandle | null): boolean => {
      if (!parent) return model.parent === null
      const rec = this.view.get(parent.id)
      return !!rec && rec.type === model.parent && this.schema.rank(rec.role) >= model.createRank
    },
    remove: (target: AnyHandle): boolean => {
      const rec = this.view.get(target.id)
      return !!rec && this.schema.rank(rec.role) >= target.$model.deleteRank
    },
    run: (action: ActionDef<any, any, any>, target: AnyHandle): boolean => {
      const rec = this.view.get(target.id)
      if (!rec || rec.type !== action.on.name || this.schema.rank(rec.role) < this.schema.rank(action.role)) return false
      return !action.when || action.when(target as Handle<any>, this)
    },
  }

  // HandleHost

  look(id: string): CRec | undefined {
    return this.view.get(id)
  }

  read(id: string, model: Model, field: string): unknown {
    const spec = model.fields[field]
    const rec = this.view.get(id)!
    switch (model.lane(field)) {
      case 'row':
      case 'stream':
        return field in rec.fields ? rec.fields[field] : spec.default
      case 'pov':
        return field in rec.pov ? rec.pov[field] : spec.default
      case 'ether':
        return this.myEther.get(id)?.[field] ?? spec.default
      case 'session':
      case 'local': {
        const raw = (spec.scope === 'session' ? this.session : this.local).get(`${id}:${field}`)
        if (raw === null) return spec.default
        try {
          const value = JSON.parse(raw)
          checkValue(model.name, field, spec, value)
          return value
        } catch {
          return spec.default // stored by an older schema
        }
      }
    }
  }

  role(id: string): string | null {
    return this.view.get(id)?.role ?? null
  }

  extra(id: string, key: string): unknown {
    if (key === '$pending') return this.pending.some(tx => tx.ops.some(op => op.id === id))
    if (key === '$meta') return this.view.get(id)?.meta
    return undefined
  }

  // ───────────────────────────── writing ─────────────────────────────

  /** Route a write by lane. This is what `handle.field = value` calls. */
  write(id: string, fields: Fields, pos?: string): void {
    const rec = this.view.get(id)
    if (!rec) throw new LaneError('not_found', `No object ${id}`)
    const model = this.schema.get(rec.type)
    const rank = this.schema.rank(rec.role)
    const durable: Fields = {}
    const ether: Fields = {}
    let changedHere = false

    for (const [field, value] of Object.entries(fields)) {
      const spec = model.spec(field)
      checkValue(model.name, field, spec, value)
      const lane = model.lane(field)
      const current = this.read(id, model, field)
      if (current === value || (spec.kind === 'json' && JSON.stringify(current) === JSON.stringify(value))) continue
      if (lane === 'row' || lane === 'stream') {
        if (rank < model.fieldWriteRank(field)) {
          throw new LaneError('forbidden', `${this.agent} (${rec.role ?? 'no role'}) may not write ${model.name}.${field}`)
        }
        durable[field] = value
      } else if (lane === 'pov') {
        durable[field] = value
      } else if (lane === 'ether') {
        ether[field] = value
      } else {
        ;(lane === 'session' ? this.session : this.local).set(`${id}:${field}`, JSON.stringify(value))
        changedHere = true
      }
    }
    if (pos !== undefined) {
      if (!POS.test(pos)) throw new LaneError('invalid', `Bad position for ${id}`)
      if (rank < model.writeRank) throw new LaneError('forbidden', `${this.agent} may not move ${id}`)
      if (pos === rec.pos) pos = undefined
    }

    if (Object.keys(durable).length > 0 || pos !== undefined) {
      const op: SetOp = { op: 'set', id, fields: durable }
      if (pos !== undefined) op.pos = pos
      this.push(op)
    }
    if (Object.keys(ether).length > 0) {
      this.myEther.set(id, { ...this.myEther.get(id), ...ether })
      // Presence is not worth tracking or retrying: send it and move on.
      this.sendRaw({ t: 'tx', n: this.nextN++, ops: [{ op: 'set', id, fields: ether }] })
      changedHere = true
    }
    if (changedHere) this.bump()
  }

  /** Group several writes into one atomic transaction: the server applies all of them or none. */
  tx<T>(fn: () => T): T {
    if (this.openTx) return fn()
    const tx: PendingTx = { n: this.nextN++, at: Date.now(), ops: [], hidden: new Map() }
    this.openTx = tx
    this.pending.push(tx)
    let result: T
    try {
      result = fn()
    } catch (error) {
      this.openTx = null
      this.afterTx = []
      this.pending.splice(this.pending.indexOf(tx), 1)
      for (const id of this.idsOf(tx)) this.rebuild(id)
      this.bump()
      throw error
    }
    this.openTx = null
    if (tx.ops.length === 0) this.pending.splice(this.pending.indexOf(tx), 1)
    else this.sendRaw({ t: 'tx', n: tx.n, ops: tx.ops })
    for (const hook of this.afterTx.splice(0)) hook()
    return result
  }

  private push(op: Op): void {
    this.tx(() => {
      const tx = this.openTx!
      if (op.op === 'del') {
        const hidden: string[] = []
        const walk = (id: string) => {
          for (const kid of this.siblings(id)) {
            hidden.push(kid.id)
            walk(kid.id)
          }
        }
        walk(op.id)
        tx.hidden.set(op.id, hidden)
      }
      tx.ops.push(op)
      this.rebuild(op.id)
      for (const id of tx.hidden.get(op.id) ?? []) this.rebuild(id)
      this.bump()
    })
  }

  create<M extends Model<any>>(model: M, init: CreateInit<M>): Handle<M> {
    const { id, parent, after, before, ...values } = init as CreateInit<Model> & Fields
    const parentId = parent?.id ?? null
    if (!this.can.create(model, parent ?? null)) {
      throw new LaneError('forbidden', `${this.agent} may not create a ${model.name}${parentId ? ` in ${parentId}` : ''}`)
    }
    const newObjectId = id ?? newId(model, parentId)
    const shared: Fields = {}
    const rest: Fields = {}
    for (const [field, value] of Object.entries(values)) {
      if (value === undefined) continue
      const spec = model.spec(field)
      checkValue(model.name, field, spec, value)
      ;(spec.scope === 'shared' ? shared : rest)[field] = value
    }
    const pos = place(this.siblings(parentId), after?.id, before?.id)
    this.tx(() => {
      this.push({ op: 'new', id: newObjectId, type: model.name, parent: parentId, pos, fields: shared })
      if (Object.keys(rest).length > 0) this.write(newObjectId, rest)
    })
    return this.handleOf(this.view.get(newObjectId)!)
  }

  remove(target: AnyHandle): void {
    if (!this.can.remove(target)) throw new LaneError('forbidden', `${this.agent} may not delete ${target.id}`)
    this.push({ op: 'del', id: target.id })
  }

  sudo<T>(_fn: () => T): T {
    throw new LaneError('forbidden', 'sudo exists only in server actions')
  }

  forkStream(): void {
    throw new LaneError('forbidden', 'forkStream exists only in server actions')
  }

  after(fn: () => void): void {
    if (this.openTx) this.afterTx.push(fn)
    else fn()
  }

  // ───────────────────────────── actions, streams, history ─────────────────────────────

  /** The actions the current agent may run on an object right now. Menus are built from this. */
  actions(target: AnyHandle): ActionDef<any, any, any>[] {
    return [...this.schema.actions.values()].filter(action => this.can.run(action, target))
  }

  /** Run an action wherever it is declared to run. */
  run<M extends Model<any>, I extends FieldMap, O>(
    action: ActionDef<M, I, O>,
    target: Handle<M>,
    input?: Partial<ValuesOf<I>>,
  ): Promise<O> {
    try {
      if (!this.can.run(action, target)) throw new LaneError('forbidden', `${this.agent} may not run ${action.name} here`)
      const parsed = parseInput(action, input)
      if (action.runs === 'server') return this.request({ t: 'call', action: action.name, target: target.id, input: parsed })
      return Promise.resolve(this.tx(() => action.run(this, target, parsed as ValuesOf<I>)))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private request<T>(msg: { t: 'call'; action: string; target: string; input: Fields } | { t: 'open' | 'history'; root: string }): Promise<T> {
    const n = this.nextN++
    return new Promise<T>((resolve, reject) => {
      if (!this.transport) return reject(new LaneError('conflict', 'Not connected'))
      this.calls.set(n, { resolve, reject })
      this.sendRaw({ ...msg, n } as ClientMsg)
    })
  }

  /** Start receiving the objects that live in a root's stream. */
  async open(root: AnyHandle): Promise<void> {
    this.opened.add(root.id)
    await this.request({ t: 'open', root: root.id })
  }

  /** Stop receiving a root's stream and forget its objects. */
  shut(root: AnyHandle): void {
    if (!this.opened.delete(root.id)) return
    this.sendRaw({ t: 'close', root: root.id })
    const touched = new Set<string>()
    for (const rec of [...this.base.values()]) if (rootOf(rec.id) === root.id) this.dropBase(rec.id, touched)
    for (const id of touched) this.rebuild(id)
    this.bump()
  }

  isOpen(root: AnyHandle): boolean {
    return this.opened.has(root.id)
  }

  /** The root's whole log, oldest first. Each entry is one committed transaction with its author. */
  async history(root: AnyHandle): Promise<WalEntry[]> {
    const { entries } = await this.request<{ entries: WalEntry[] }>({ t: 'history', root: root.id })
    return entries
  }
}

/** The stream objects of a root as they were after log entry `upto`, in order. */
export function replay(rootId: string, entries: WalEntry[], upto = Infinity): Rec[] {
  const graph = new Graph()
  foldWal(graph, rootId, entries, upto)
  return graph.children(rootId)
}
