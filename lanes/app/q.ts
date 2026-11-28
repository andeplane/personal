/**
 * Q, the AI participant.
 *
 * Q connects to the server the way a browser does, as the agent "q". It sees
 * only documents shared with it, shows up in presence while it works, and its
 * writes are refused if its role does not allow them. What it writes comes
 * from the scripted `PLANS` below, not from a language model: the point here
 * is the plumbing. To use a real model, give it `toolsFor()` and `outline()`
 * and pass its tool calls to `applyTool()` exactly as this file does.
 */

import { applyTool } from '../src/agent/tools.ts'
import { Client } from '../src/client/client.ts'
import type { Server } from '../src/server/server.ts'
import { Block, Doc, schema, type BlockKind } from './schema.ts'

export type Task = 'summarize' | 'draft' | 'todos'
interface Line {
  kind: BlockKind
  text: string
}

const firstSentence = (text: string) => (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim()
const clip = (text: string, max = 60) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text)

const PLANS: Record<Task, (title: string, blocks: Line[]) => Line[]> = {
  summarize(title, blocks) {
    const body = blocks.filter(b => b.text.trim())
    const words = body.reduce((sum, b) => sum + b.text.trim().split(/\s+/).length, 0)
    const headings = body.filter(b => b.kind === 'h1' || b.kind === 'h2')
    const longest = body.filter(b => b.kind === 'p').sort((a, b) => b.text.length - a.text.length).slice(0, 3)
    return [
      { kind: 'h2', text: 'Summary' },
      { kind: 'p', text: `“${title}” has ${body.length} non-empty blocks and about ${words} words${headings.length ? `, in ${headings.length} sections` : ''}.` },
      ...longest.map(b => ({ kind: 'bullet' as const, text: firstSentence(b.text) })),
    ]
  },
  draft(title) {
    return [
      { kind: 'h2', text: 'Draft' },
      { kind: 'p', text: `Here is a starting point for “${title}”. State the goal in one sentence, then say who it is for and what changes for them once it is done.` },
      { kind: 'p', text: 'List what is already decided, what is still open, and who decides. Keep each point short enough to disagree with.' },
    ]
  },
  todos(_title, blocks) {
    const open = blocks.filter(b => b.kind !== 'todo' && b.text.trim()).slice(0, 4)
    return [{ kind: 'h2', text: 'Next steps' }, ...open.map(b => ({ kind: 'todo' as const, text: `Review “${clip(b.text, 40)}”` }))]
  },
}

export class Q {
  private client: Client
  private busy = new Map<string, Promise<void>>()

  constructor(
    server: Server,
    auth: unknown,
    /** Pause between words while "typing". */
    private pace = 45,
  ) {
    this.client = new Client({ schema, connect: () => server.connectLocal(), auth })
  }

  ready(): Promise<unknown> {
    return this.client.ready()
  }

  /** Whether Q's own role lets it add blocks to this document. */
  canEdit(docId: string): boolean {
    const doc = this.client.get(Doc, docId)
    return !!doc && this.client.can.create(Block, doc)
  }

  /** Queue a task. Tasks on the same document run one after another. */
  ask(docId: string, task: Task): Promise<void> {
    const next = (this.busy.get(docId) ?? Promise.resolve())
      .then(() => this.work(docId, task))
      .catch(error => console.error(`Q stopped working on ${docId}: ${error.message}`))
    this.busy.set(docId, next)
    return next
  }

  private async work(docId: string, task: Task): Promise<void> {
    const client = this.client
    const doc = client.get(Doc, docId)
    if (!doc) return
    await client.open(doc)
    try {
      doc.cursor = { block: null, typing: true }
      const blocks = client.children(doc, Block)
      let after = blocks[blocks.length - 1]?.id
      for (const line of PLANS[task](doc.title, blocks.map(b => ({ kind: b.kind, text: b.text })))) {
        const { id } = applyTool(client, doc, 'create_block', { parent: doc.id, after, kind: line.kind, text: '' }) as { id: string }
        doc.cursor = { block: id, typing: true }
        // Stream the text in word by word; each step is an ordinary write.
        let text = ''
        for (const word of line.text.split(/(?<=\s)/)) {
          text += word
          applyTool(client, doc, 'update_block', { id, text })
          await new Promise(resolve => setTimeout(resolve, this.pace))
        }
        after = id
      }
      await client.settled()
    } finally {
      if (doc.$alive) doc.cursor = null
      client.shut(doc)
    }
  }
}
