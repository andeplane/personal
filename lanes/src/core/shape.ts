/**
 * The schema described as data. The inspector panel and the AI tool surface
 * are both generated from this, so neither can describe a field differently
 * from how the server treats it.
 */

import type { Kind, Lane, Schema } from './schema.ts'

export interface FieldShape {
  name: string
  kind: Kind
  lane: Lane
  /** Minimum role that receives the field. */
  read: string
  /** Minimum role that may write it; null for lanes holding the viewer's own state. */
  write: string | null
  values?: readonly string[]
  ref?: string
  doc?: string
}

export interface ModelShape {
  name: string
  home: 'row' | 'stream'
  parent: string | null
  fields: FieldShape[]
}

export function shape(schema: Schema<any>): ModelShape[] {
  return [...schema.models.values()].map(model => ({
    name: model.name,
    home: model.home,
    parent: model.parent,
    fields: Object.entries(model.fields).map(([name, spec]) => ({
      name,
      kind: spec.kind,
      lane: model.lane(name),
      read: schema.roleName(model.fieldReadRank(name))!,
      write: spec.scope === 'shared' ? schema.roleName(model.fieldWriteRank(name)) : null,
      values: spec.values,
      ref: spec.ref,
      doc: spec.doc,
    })),
  }))
}
