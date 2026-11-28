/**
 * Handles are how application code touches the graph: `doc.title` reads the
 * live value, `doc.title = 'x'` is a write routed by the field's lane.
 * The same proxy backs client handles and the handles a server action gets.
 */

import { LaneError, type AnyHandle, type Fields, type Model } from './schema.ts'

export interface HandleHost {
  /** Current type/parent/pos of the object, or undefined when it is gone. */
  look(id: string): { type: string; parent: string | null; pos: string } | undefined
  read(id: string, model: Model, field: string): unknown
  write(id: string, fields: Fields, pos?: string): void
  role(id: string): string | null
  /** Host-specific `$` properties such as `$pending` and `$meta`. */
  extra?(id: string, key: string): unknown
}

export function makeHandle(host: HandleHost, id: string, model: Model): AnyHandle {
  return new Proxy({} as AnyHandle, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (key === 'id') return id
      if (key === '$model') return model
      const rec = host.look(id)
      switch (key) {
        case '$alive':
          return rec !== undefined
        case '$type':
          return model.name
        case '$parent':
          return rec?.parent ?? null
        case '$pos':
          return rec?.pos ?? ''
        case '$role':
          return rec ? host.role(id) : null
      }
      if (!rec) return undefined
      if (key in model.fields) return host.read(id, model, key)
      return key.startsWith('$') ? host.extra?.(id, key) : undefined
    },
    set(_target, key, value) {
      if (key === '$pos') host.write(id, {}, value)
      else if (typeof key === 'string' && key in model.fields) host.write(id, { [key]: value })
      // Reads of unknown keys are harmless; a write to one is always a bug.
      else throw new LaneError('invalid', `Unknown field ${model.name}.${String(key)}`)
      return true
    },
    has(_target, key) {
      return typeof key === 'string' && (key === 'id' || key in model.fields)
    },
  })
}
