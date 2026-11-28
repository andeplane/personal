/**
 * The object graph and the three operations that change its shared state.
 *
 * The server's authoritative graph, the client's confirmed replica and a
 * replayed history snapshot are all this same structure folded from the same
 * operations, which is why time travel and forks cost almost nothing extra.
 */

import type { Fields } from './schema.ts'

/** Who last touched an object and each of its fields, derived as operations apply. */
export interface Meta {
  /** Creator. */
  by: string
  /** Creation time, ms since epoch. */
  at: number
  /** Per field: last writer and when. */
  f: Record<string, [by: string, at: number]>
}

export interface Rec {
  id: string
  type: string
  parent: string | null
  pos: string
  fields: Fields
  meta: Meta
}

export interface NewOp {
  op: 'new'
  id: string
  type: string
  parent: string | null
  pos: string
  fields: Fields
}
export interface SetOp {
  op: 'set'
  id: string
  fields: Fields
  pos?: string
}
export interface DelOp {
  op: 'del'
  id: string
}
export type Op = NewOp | SetOp | DelOp

/** One committed transaction in a root's write-ahead log. Ids inside are root-relative. */
export interface WalEntry {
  seq: number
  at: number
  by: string
  ops: Op[]
}

export function byPos(a: { pos: string; id: string }, b: { pos: string; id: string }): number {
  return a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export class Graph {
  private recs = new Map<string, Rec>()
  /** parent id ('' for roots) → type → child ids */
  private kids = new Map<string, Map<string, Set<string>>>()

  get size(): number {
    return this.recs.size
  }

  get(id: string | null | undefined): Rec | undefined {
    return id ? this.recs.get(id) : undefined
  }

  has(id: string): boolean {
    return this.recs.has(id)
  }

  values(): IterableIterator<Rec> {
    return this.recs.values()
  }

  insert(rec: Rec): void {
    if (this.recs.has(rec.id)) throw new Error(`Object ${rec.id} already exists`)
    this.recs.set(rec.id, rec)
    const key = rec.parent ?? ''
    let byType = this.kids.get(key)
    if (!byType) this.kids.set(key, (byType = new Map()))
    let ids = byType.get(rec.type)
    if (!ids) byType.set(rec.type, (ids = new Set()))
    ids.add(rec.id)
  }

  /** Remove an object and everything under it. Returns what was removed, parents first. */
  delete(id: string): Rec[] {
    const removed = this.subtree(id)
    for (const rec of removed) {
      this.recs.delete(rec.id)
      this.kids.delete(rec.id)
      const ids = this.kids.get(rec.parent ?? '')?.get(rec.type)
      ids?.delete(rec.id)
    }
    return removed
  }

  /** Children of `parent` (null for roots), in order. */
  children(parent: string | null, type?: string): Rec[] {
    const byType = this.kids.get(parent ?? '')
    if (!byType) return []
    const out: Rec[] = []
    for (const [name, ids] of byType) {
      if (type !== undefined && name !== type) continue
      for (const id of ids) out.push(this.recs.get(id)!)
    }
    return out.sort(byPos)
  }

  /** The object and all its descendants, parents before children. */
  subtree(id: string): Rec[] {
    const top = this.recs.get(id)
    if (!top) return []
    const out = [top]
    for (let i = 0; i < out.length; i++) {
      const byType = this.kids.get(out[i].id)
      if (!byType) continue
      for (const ids of byType.values()) for (const kid of ids) out.push(this.recs.get(kid)!)
    }
    return out
  }
}

/**
 * Apply one already-validated operation. Returns a function that undoes it, so
 * a transaction that fails halfway can be rolled back exactly.
 * Operations on objects that are not there are skipped, never invented.
 */
export function applyOp(graph: Graph, op: Op, by: string, at: number): () => void {
  if (op.op === 'new') {
    if (graph.has(op.id)) return () => {}
    const meta: Meta = { by, at, f: {} }
    for (const field of Object.keys(op.fields)) meta.f[field] = [by, at]
    graph.insert({ id: op.id, type: op.type, parent: op.parent, pos: op.pos, fields: { ...op.fields }, meta })
    return () => void graph.delete(op.id)
  }
  if (op.op === 'set') {
    const rec = graph.get(op.id)
    if (!rec) return () => {}
    const before = { fields: { ...rec.fields }, pos: rec.pos, f: { ...rec.meta.f } }
    for (const [field, value] of Object.entries(op.fields)) {
      rec.fields[field] = value
      rec.meta.f[field] = [by, at]
    }
    if (op.pos !== undefined) rec.pos = op.pos
    return () => {
      rec.fields = before.fields
      rec.pos = before.pos
      rec.meta.f = before.f
    }
  }
  const removed = graph.delete(op.id)
  return () => {
    for (const rec of removed) graph.insert(rec)
  }
}

/**
 * Log entries store ids relative to their root: `x` for `root/x`, and '' for
 * the root itself as a parent. That is what lets a fork reuse another
 * document's log bytes unchanged under a new root id.
 */
export function localize(root: string, op: Op): Op {
  const cut = (id: string) => id.slice(root.length + 1)
  if (op.op === 'new') return { ...op, id: cut(op.id), parent: op.parent === root ? '' : cut(op.parent!) }
  return { ...op, id: cut(op.id) }
}

export function globalize(root: string, op: Op): Op {
  const add = (id: string) => `${root}/${id}`
  if (op.op === 'new') return { ...op, id: add(op.id), parent: op.parent ? add(op.parent) : root }
  return { ...op, id: add(op.id) }
}

/** Replay a log into a graph, optionally stopping at a sequence number. */
export function foldWal(graph: Graph, root: string, entries: WalEntry[], upto = Infinity): void {
  for (const entry of entries) {
    if (entry.seq > upto) break
    for (const op of entry.ops) applyOp(graph, globalize(root, op), entry.by, entry.at)
  }
}
