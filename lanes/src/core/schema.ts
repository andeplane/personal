/**
 * The schema is the single declaration everything else is derived from.
 *
 * Each field says where it lives (its lane) and who may read or write it.
 * Storage, sync fan-out, write validation, UI gating and the AI tool surface
 * all read these same declarations. Nothing here is optional sugar: a
 * modifier the schema does not know is a compile error, and a role or field
 * name it does not know throws when the model is defined.
 */

/** Where a field's value lives, as written by the field modifiers. */
export type Scope = 'shared' | 'pov' | 'session' | 'local' | 'ether'

/**
 * The resolved lane. A `shared` field becomes `row` or `stream` depending on
 * the home of its model.
 *
 *  row      one value for everyone, in the server's row store, last writer wins
 *  stream   one value for everyone, appended to the root's write-ahead log
 *  pov      one value per viewer, stored on the server, synced to that viewer only
 *  session  one value per browser tab, never leaves the tab
 *  local    one value per device, never leaves the device
 *  ether    one value per live connection, relayed to peers, never stored
 */
export type Lane = 'row' | 'stream' | 'pov' | 'session' | 'local' | 'ether'

export type Kind = 'string' | 'number' | 'boolean' | 'enum' | 'ref' | 'json'
export type Fields = Record<string, unknown>

export type ErrorCode = 'forbidden' | 'invalid' | 'not_found' | 'conflict'

export class LaneError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'LaneError'
    this.code = code
  }
}

export interface FieldSpec {
  kind: Kind
  scope: Scope
  default: unknown
  /** Allowed values of an enum field. */
  values?: readonly string[]
  /** Target model name of a ref field. */
  ref?: string
  read?: string
  write?: string
  /** Role given to the agent this ref field points at. */
  grants?: string
  /** Role given to every agent, chosen by this enum field's value. */
  grantsEveryone?: Record<string, string>
  doc?: string
}

export class Field<T, R extends string = string> {
  /** Type-only carrier for the field's value type. */
  declare readonly _t: T
  readonly spec: FieldSpec

  constructor(spec: FieldSpec) {
    this.spec = spec
  }

  /** One value per viewer, synced to that viewer's own tabs and devices only. */
  pov(): this {
    return this.setScope('pov')
  }
  /** One value per browser tab. Never sent to the server. */
  session(): this {
    return this.setScope('session')
  }
  /** One value per device. Never sent to the server. */
  local(): this {
    return this.setScope('local')
  }
  /** One value per live connection, relayed to peers and never stored. */
  ether(): this {
    return this.setScope('ether')
  }
  /** Minimum role that receives this field. */
  read(role: R): this {
    this.spec.read = role
    return this
  }
  /** Minimum role whose writes to this field are accepted. */
  write(role: R): this {
    this.spec.write = role
    return this
  }
  /** Description shown to people and to AI agents. */
  doc(text: string): this {
    this.spec.doc = text
    return this
  }

  private setScope(scope: Scope): this {
    if (this.spec.scope !== 'shared') {
      throw new Error(`Field is already in the "${this.spec.scope}" lane; a field lives in exactly one lane`)
    }
    this.spec.scope = scope
    return this
  }
}

export class RefField<R extends string = string> extends Field<string | null, R> {
  /** The agent this field points at holds `role` on the object. */
  grants(role: R): this {
    this.spec.grants = role
    return this
  }
}

export class EnumField<V extends string, R extends string = string> extends Field<V, R> {
  /** Every agent holds the role mapped from this field's current value. */
  grantsEveryone(map: Partial<Record<V, R>>): this {
    this.spec.grantsEveryone = map as Record<string, string>
    return this
  }
}

export interface FieldFactory<R extends string> {
  string(def?: string): Field<string, R>
  number(def?: number): Field<number, R>
  boolean(def?: boolean): Field<boolean, R>
  enum<const V extends string>(values: readonly V[], def?: V): EnumField<V, R>
  ref(model: string): RefField<R>
  json<T>(def: T): Field<T, R>
}

function fieldFactory<R extends string>(): FieldFactory<R> {
  return {
    string: (def = '') => new Field({ kind: 'string', scope: 'shared', default: def }),
    number: (def = 0) => new Field({ kind: 'number', scope: 'shared', default: def }),
    boolean: (def = false) => new Field({ kind: 'boolean', scope: 'shared', default: def }),
    enum: (values, def) => new EnumField({ kind: 'enum', scope: 'shared', default: def ?? values[0], values }),
    ref: model => new RefField({ kind: 'ref', scope: 'shared', default: null, ref: model }),
    json: def => new Field({ kind: 'json', scope: 'shared', default: def }),
  }
}

export type FieldMap = Record<string, Field<any, any>>
export type ValuesOf<F> = { -readonly [K in keyof F]: F[K] extends Field<infer T, any> ? T : never }

/** How an object of a "grant" model gives a role on its parent. */
export type GrantRule =
  /** The agent in field `to` holds the role in field `role`. */
  | { to: string; role: string }
  /** Any connection that presents the value of field `proof` holds the role in field `role`. */
  | { proof: string; role: string }

export interface ModelOptions<R extends string, F extends FieldMap> {
  /**
   * `row` objects live in the row store and sync to everyone who may see them.
   * `stream` objects exist only in the write-ahead log of their root and sync
   * to connections that have opened that root.
   */
  home?: 'row' | 'stream'
  /** Model name of the required parent. Omit for root objects. */
  parent?: string
  /** Objects of this model own a write-ahead log for their `stream` descendants. */
  streamRoot?: boolean
  /** Inherit the role held on the parent object. */
  via?: 'parent'
  /** Every agent holds at least this role. */
  everyone?: R
  /** The agent whose id equals the object's id holds this role. */
  self?: R
  /** Minimum role to receive the object at all. Defaults to the lowest role. */
  read?: R
  /** Default minimum role for writing shared fields. Defaults to the schema's `write`. */
  write?: R
  /** Role needed on the parent (or, for roots, held on the new object itself) to create one. */
  create?: R
  delete?: R
  /** Objects of this model grant a role on their parent. */
  grant?: GrantRule
  fields: (f: FieldFactory<R>) => F
}

const RESERVED = new Set(['id', 'parent', 'after', 'before', 'then', 'toJSON', 'constructor'])

export class Model<F extends FieldMap = FieldMap> {
  /** Type-only carrier for the field map. */
  declare readonly _fields: F
  readonly fields: Record<string, FieldSpec> = {}
  /** Shared fields whose value is a source of roles. */
  readonly grantFields: string[] = []
  readonly home: 'row' | 'stream'
  readonly parent: string | null
  readonly streamRoot: boolean
  readonly via: boolean
  readonly grant: GrantRule | null
  readonly everyoneRank: number
  readonly selfRank: number
  readonly readRank: number
  readonly writeRank: number
  readonly createRank: number
  readonly deleteRank: number

  constructor(
    readonly schema: Schema<any>,
    readonly name: string,
    opts: ModelOptions<any, F>,
  ) {
    const rank = (role: string | undefined, fallback: number, what: string) =>
      role === undefined ? fallback : schema.rankOrThrow(role, `${name}: ${what}`)
    this.home = opts.home ?? 'row'
    this.parent = opts.parent ?? null
    this.streamRoot = opts.streamRoot ?? false
    this.via = opts.via === 'parent'
    this.grant = opts.grant ?? null
    this.everyoneRank = rank(opts.everyone, -1, 'everyone')
    this.selfRank = rank(opts.self, -1, 'self')
    this.readRank = rank(opts.read, 0, 'read')
    this.writeRank = rank(opts.write, schema.defaultWriteRank, 'write')
    this.createRank = rank(opts.create, this.writeRank, 'create')
    this.deleteRank = rank(opts.delete, this.writeRank, 'delete')

    if (this.home === 'stream' && !this.parent) throw new Error(`${name}: a stream model needs a parent`)
    if (this.home === 'stream' && this.streamRoot) throw new Error(`${name}: a stream model cannot be a stream root`)
    if (this.via && !this.parent) throw new Error(`${name}: via "parent" needs a parent model`)
    if (this.grant && !this.parent) throw new Error(`${name}: a grant model needs a parent to grant on`)

    const built = opts.fields(fieldFactory())
    for (const [field, def] of Object.entries(built)) {
      const spec = def.spec
      const where = `${name}.${field}`
      if (field.startsWith('$') || RESERVED.has(field)) throw new Error(`${where}: reserved field name`)
      if (spec.read !== undefined) schema.rankOrThrow(spec.read, `${where}: read`)
      if (spec.write !== undefined) schema.rankOrThrow(spec.write, `${where}: write`)
      if (spec.scope !== 'shared') {
        // These lanes hold the viewer's own state, so there is nobody to restrict.
        if (spec.write !== undefined) throw new Error(`${where}: write() has no meaning in the ${spec.scope} lane`)
        if (spec.read !== undefined && spec.scope !== 'ether') {
          throw new Error(`${where}: read() has no meaning in the ${spec.scope} lane`)
        }
        if (spec.grants || spec.grantsEveryone) throw new Error(`${where}: only shared fields can grant roles`)
      }
      if (spec.grants) schema.rankOrThrow(spec.grants, `${where}: grants`)
      for (const [value, role] of Object.entries(spec.grantsEveryone ?? {})) {
        if (!spec.values!.includes(value)) throw new Error(`${where}: grantsEveryone maps unknown value "${value}"`)
        schema.rankOrThrow(role, `${where}: grantsEveryone`)
      }
      checkValue(name, field, spec, spec.default)
      this.fields[field] = spec
      if (spec.grants || spec.grantsEveryone) this.grantFields.push(field)
    }

    if (this.grant) {
      const roleSpec = this.fields[this.grant.role]
      if (roleSpec?.kind !== 'enum' || roleSpec.scope !== 'shared') {
        throw new Error(`${name}: grant.role must name a shared enum field`)
      }
      for (const value of roleSpec.values!) schema.rankOrThrow(value, `${name}.${this.grant.role}`)
      const subject = 'to' in this.grant ? this.grant.to : this.grant.proof
      const want = 'to' in this.grant ? 'ref' : 'string'
      if (this.fields[subject]?.kind !== want || this.fields[subject].scope !== 'shared') {
        throw new Error(`${name}: grant subject "${subject}" must be a shared ${want} field`)
      }
    }
  }

  spec(field: string): FieldSpec {
    const spec = this.fields[field]
    if (!spec) throw new LaneError('invalid', `Unknown field ${this.name}.${field}`)
    return spec
  }

  lane(field: string): Lane {
    const scope = this.spec(field).scope
    return scope === 'shared' ? this.home : scope
  }

  /** Minimum rank that receives the field. */
  fieldReadRank(field: string): number {
    const spec = this.spec(field)
    return spec.read === undefined ? this.readRank : this.schema.rank(spec.read)
  }

  /** Minimum rank that may write the field. Own-state lanes only need visibility. */
  fieldWriteRank(field: string): number {
    const spec = this.spec(field)
    if (spec.scope !== 'shared') return this.readRank
    return spec.write === undefined ? this.writeRank : this.schema.rank(spec.write)
  }
}

interface HandleBase {
  readonly id: string
  readonly $type: string
  readonly $parent: string | null
  /** Order key among siblings. Assign to move the object. */
  $pos: string
  /** The role the current agent holds on this object, or null. */
  readonly $role: string | null
  /** False once the object is deleted or no longer visible. */
  readonly $alive: boolean
  readonly $model: Model
}

/** A live, typed view of one object. Reads are always current; assignments are writes. */
export type Handle<M extends Model<any> = Model> = HandleBase & ValuesOf<M['_fields']>
export type AnyHandle = HandleBase

export type CreateInit<M extends Model<any>> = Partial<ValuesOf<M['_fields']>> & {
  id?: string
  parent?: AnyHandle | null
  /** Place the new object right after this sibling. */
  after?: AnyHandle | null
  /** Place the new object right before this sibling. */
  before?: AnyHandle | null
}

/**
 * What an action body may do. Client and server both implement it, so moving
 * an action between them is a one-word change to `runs`.
 */
export interface Ctx {
  readonly agent: string
  readonly side: 'client' | 'server'
  get<M extends Model<any>>(model: M, id: string | null | undefined): Handle<M> | undefined
  all<M extends Model<any>>(model: M): Handle<M>[]
  children<M extends Model<any>>(parent: AnyHandle, model: M): Handle<M>[]
  create<M extends Model<any>>(model: M, init: CreateInit<M>): Handle<M>
  remove(target: AnyHandle): void
  /**
   * Run `fn` without role checks. Server only, and the only way to exceed the
   * caller's own rights: nothing is elevated implicitly.
   */
  sudo<T>(fn: () => T): T
  /** Run a side effect once the surrounding transaction has committed. */
  after(fn: () => void): void
  /** Make `target`'s log start as a zero-copy fork of `source`'s log. Server only. */
  forkStream(source: AnyHandle, target: AnyHandle, upto?: number): void
  readonly services: Record<string, any>
}

export interface ActionDef<M extends Model<any> = Model<any>, I extends FieldMap = FieldMap, O = unknown> {
  readonly name: string
  readonly on: M
  /** Minimum role on the target. */
  readonly role: string
  /** Where the body executes. Client actions are optimistic; server actions are RPCs. */
  readonly runs: 'client' | 'server'
  readonly label: string
  readonly doc?: string
  readonly input: Record<string, FieldSpec>
  readonly when?: (target: Handle<M>, ctx: Ctx) => boolean
  readonly run: (ctx: Ctx, target: Handle<M>, input: ValuesOf<I>) => O
}

export interface ActionOptions<R extends string, M extends Model<any>, I extends FieldMap, O> {
  on: M
  role: R
  runs: 'client' | 'server'
  label: string
  doc?: string
  input?: (f: FieldFactory<R>) => I
  when?: (target: Handle<M>, ctx: Ctx) => boolean
  run: (ctx: Ctx, target: Handle<M>, input: ValuesOf<I>) => O
}

export interface SchemaOptions<R extends string> {
  /** Role ladder, weakest first. A role includes every role before it. */
  roles: readonly R[]
  /** Default minimum role for writing shared fields. */
  write: R
}

export class Schema<R extends string = string> {
  readonly roles: readonly R[]
  readonly defaultWriteRank: number
  readonly models = new Map<string, Model<any>>()
  readonly actions = new Map<string, ActionDef<any, any, any>>()
  /** Grant models keyed by the model they grant on. */
  private grantsOn = new Map<string, Model[]>()
  private sealed = false
  /** Highest read rank of anything stored in a stream; a fork shares the whole log. */
  streamCeiling = 0

  constructor(opts: SchemaOptions<R>) {
    if (opts.roles.length === 0) throw new Error('A schema needs at least one role')
    this.roles = opts.roles
    this.defaultWriteRank = this.rankOrThrow(opts.write, 'schema write')
  }

  /** Rank of a role name, or -1 for no role. */
  rank(role: unknown): number {
    return typeof role === 'string' ? this.roles.indexOf(role as R) : -1
  }

  rankOrThrow(role: string, where: string): number {
    const rank = this.rank(role)
    if (rank < 0) throw new Error(`${where}: unknown role "${role}" (roles are ${this.roles.join(', ')})`)
    return rank
  }

  roleName(rank: number): R | null {
    return rank >= 0 ? this.roles[rank] : null
  }

  model<const F extends FieldMap>(name: string, opts: ModelOptions<R, F>): Model<F> {
    if (this.sealed) throw new Error('Schema is sealed; define all models before creating a server or client')
    if (this.models.has(name)) throw new Error(`Model ${name} is already defined`)
    const model = new Model<F>(this, name, opts)
    this.models.set(name, model)
    return model
  }

  action<M extends Model<any>, I extends FieldMap = {}, O = void>(
    name: string,
    opts: ActionOptions<R, M, I, O>,
  ): ActionDef<M, I, O> {
    if (this.actions.has(name)) throw new Error(`Action ${name} is already defined`)
    this.rankOrThrow(opts.role, `action ${name}`)
    const input: Record<string, FieldSpec> = {}
    for (const [key, field] of Object.entries(opts.input?.(fieldFactory()) ?? {})) input[key] = field.spec
    const def: ActionDef<M, I, O> = {
      name,
      on: opts.on,
      role: opts.role,
      runs: opts.runs,
      label: opts.label,
      doc: opts.doc,
      input,
      when: opts.when,
      run: opts.run,
    }
    this.actions.set(name, def)
    return def
  }

  get(name: string): Model {
    const model = this.models.get(name)
    if (!model) throw new LaneError('invalid', `Unknown model ${name}`)
    return model
  }

  grantModelsOn(model: string): Model[] {
    return this.grantsOn.get(model) ?? []
  }

  /** Cross-model checks. Called by the server and client constructors. */
  seal(): this {
    if (this.sealed) return this
    for (const model of this.models.values()) {
      const parent = model.parent ? this.models.get(model.parent) : null
      if (model.parent && !parent) throw new Error(`${model.name}: unknown parent model "${model.parent}"`)
      if (model.home === 'stream') {
        if (!parent!.streamRoot && parent!.home !== 'stream') {
          throw new Error(`${model.name}: a stream model's parent must be a stream root or another stream model`)
        }
        this.streamCeiling = Math.max(this.streamCeiling, model.readRank)
      }
      for (const [field, spec] of Object.entries(model.fields)) {
        if (spec.kind === 'ref' && !this.models.has(spec.ref!)) {
          throw new Error(`${model.name}.${field}: unknown ref target "${spec.ref}"`)
        }
        if (model.home === 'stream' && spec.scope === 'shared') {
          this.streamCeiling = Math.max(this.streamCeiling, model.fieldReadRank(field))
        }
      }
      if (model.grant) {
        if (model.home !== 'row') throw new Error(`${model.name}: grant models must be row models`)
        const list = this.grantsOn.get(model.parent!) ?? []
        list.push(model)
        this.grantsOn.set(model.parent!, list)
      }
    }
    this.sealed = true
    return this
  }
}

export function defineSchema<const R extends string>(opts: SchemaOptions<R>): Schema<R> {
  return new Schema(opts)
}

const ID = /^[A-Za-z0-9_-]{1,48}$/

/** `abc` for row objects, `root/abc` for objects that live in root's stream. */
export function isId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const slash = value.indexOf('/')
  if (slash < 0) return ID.test(value)
  return ID.test(value.slice(0, slash)) && ID.test(value.slice(slash + 1))
}

/** Id of the stream root an object lives in, or null for row objects. */
export function rootOf(id: string): string | null {
  const slash = id.indexOf('/')
  return slash < 0 ? null : id.slice(0, slash)
}

/** The one value validator. Client writes, server writes and action inputs all use it. */
export function checkValue(model: string, field: string, spec: FieldSpec, value: unknown): void {
  const bad = (why: string): never => {
    throw new LaneError('invalid', `${model}.${field}: ${why}`)
  }
  switch (spec.kind) {
    case 'string':
      if (typeof value !== 'string') bad('expected a string')
      else if (value.length > 100_000) bad('string is too long')
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) bad('expected a finite number')
      return
    case 'boolean':
      if (typeof value !== 'boolean') bad('expected a boolean')
      return
    case 'enum':
      if (typeof value !== 'string' || !spec.values!.includes(value)) bad(`expected one of ${spec.values!.join(', ')}`)
      return
    case 'ref':
      if (value !== null && !isId(value)) bad('expected an object id or null')
      return
    case 'json': {
      let size = -1
      try {
        size = JSON.stringify(value)?.length ?? -1
      } catch {
        size = -1
      }
      if (size < 0) bad('expected a JSON value')
      else if (size > 20_000) bad('JSON value is too large')
      return
    }
  }
}

/** Validate an action's input against its declared fields, filling defaults. */
export function parseInput(def: ActionDef<any, any, any>, raw: unknown): Fields {
  const given = (raw ?? {}) as Fields
  if (typeof given !== 'object' || Array.isArray(given)) throw new LaneError('invalid', `${def.name}: input must be an object`)
  for (const key of Object.keys(given)) {
    if (!(key in def.input)) throw new LaneError('invalid', `${def.name}: unknown input "${key}"`)
  }
  const out: Fields = {}
  for (const [key, spec] of Object.entries(def.input)) {
    out[key] = given[key] === undefined ? spec.default : given[key]
    checkValue(def.name, key, spec, out[key])
  }
  return out
}
