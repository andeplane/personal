/**
 * Persistence for the two durable shared lanes.
 *
 * Rows are a snapshot of the row-home objects plus everyone's pov values (the
 * part OP keeps in Postgres). Each stream root has its own append-only log.
 * A log is never rewritten, which is what makes forks zero-copy: a fork's log
 * starts with a pointer into another log instead of a copy of it.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Rec, WalEntry } from '../core/graph.ts'
import type { Fields } from '../core/schema.ts'

export interface WalHeader {
  /** This log continues from another root's log, up to and including `upto`. */
  fork?: { from: string; upto: number }
}

export interface Snapshot {
  recs: Rec[]
  /** agent → object → pov fields */
  pov: Record<string, Record<string, Fields>>
}

export interface Storage {
  loadSnapshot(): Snapshot | null
  saveSnapshot(snapshot: Snapshot): void
  /** A root's own entries, without the entries it inherits from a fork source. */
  readWal(root: string): { header: WalHeader; entries: WalEntry[] }
  createWal(root: string, header: WalHeader): void
  appendWal(root: string, entry: WalEntry): void
}

export class MemoryStorage implements Storage {
  private snapshot: string | null = null
  private wals = new Map<string, { header: WalHeader; entries: string[] }>()

  loadSnapshot(): Snapshot | null {
    return this.snapshot ? JSON.parse(this.snapshot) : null
  }
  saveSnapshot(snapshot: Snapshot): void {
    this.snapshot = JSON.stringify(snapshot)
  }
  readWal(root: string): { header: WalHeader; entries: WalEntry[] } {
    const wal = this.wals.get(root)
    return { header: wal?.header ?? {}, entries: (wal?.entries ?? []).map(line => JSON.parse(line)) }
  }
  createWal(root: string, header: WalHeader): void {
    if (this.wals.has(root)) throw new Error(`Log for ${root} already exists`)
    this.wals.set(root, { header, entries: [] })
  }
  appendWal(root: string, entry: WalEntry): void {
    if (!this.wals.has(root)) this.wals.set(root, { header: {}, entries: [] })
    this.wals.get(root)!.entries.push(JSON.stringify(entry))
  }
}

/**
 * `<dir>/rows.json` and one `<dir>/wal/<root>.log` per stream root, as JSON
 * lines: an optional header line, then one line per committed transaction.
 * Root ids are validated before they reach this class, so they are safe as
 * file names.
 */
export class FileStorage implements Storage {
  private walDir: string

  constructor(private dir: string) {
    this.walDir = join(dir, 'wal')
    mkdirSync(this.walDir, { recursive: true })
  }

  private walPath(root: string): string {
    return join(this.walDir, `${root}.log`)
  }

  loadSnapshot(): Snapshot | null {
    const path = join(this.dir, 'rows.json')
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  }

  saveSnapshot(snapshot: Snapshot): void {
    const path = join(this.dir, 'rows.json')
    writeFileSync(`${path}.tmp`, JSON.stringify(snapshot))
    renameSync(`${path}.tmp`, path)
  }

  readWal(root: string): { header: WalHeader; entries: WalEntry[] } {
    const path = this.walPath(root)
    if (!existsSync(path)) return { header: {}, entries: [] }
    let header: WalHeader = {}
    const entries: WalEntry[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue
      const parsed = JSON.parse(line)
      if (typeof parsed.seq === 'number') entries.push(parsed)
      else header = parsed
    }
    return { header, entries }
  }

  createWal(root: string, header: WalHeader): void {
    const path = this.walPath(root)
    if (existsSync(path)) throw new Error(`Log for ${root} already exists`)
    writeFileSync(path, JSON.stringify(header) + '\n')
  }

  appendWal(root: string, entry: WalEntry): void {
    appendFileSync(this.walPath(root), JSON.stringify(entry) + '\n')
  }
}
