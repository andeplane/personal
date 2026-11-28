/**
 * The whole data model of the docs app. Server, browser and the AI agent all
 * import this one file; there is no other place where a field's storage,
 * visibility or write rule is stated.
 */

import { defineSchema, LaneError, rid } from '../src/index.ts'

export const schema = defineSchema({
  roles: ['viewer', 'editor', 'owner'],
  write: 'editor',
})

/** Where a participant is in a document. Lives in the ether lane: relayed, never stored. */
export interface Cursor {
  block: string | null
  typing: boolean
}

export const User = schema.model('User', {
  everyone: 'viewer', // anyone signed in can see who exists
  self: 'owner', // and you own your own profile
  write: 'owner',
  fields: f => ({
    name: f.string(),
    color: f.string('#64748b'),
    kind: f.enum(['human', 'ai']),
    // Two fields that never reach the server, on the same object as the ones that do.
    openDoc: f.ref('Doc').session().doc('The document this browser tab is showing'),
    inspector: f.boolean(false).local().doc('Whether this device shows the inspector panel'),
  }),
})

export const Doc = schema.model('Doc', {
  streamRoot: true, // owns a write-ahead log holding its blocks
  create: 'owner',
  delete: 'owner',
  fields: f => ({
    title: f.string('Untitled'),
    // Role sources are fields too: whoever `owner` points at is the owner,
    owner: f.ref('User').grants('owner').write('owner'),
    // and the privacy ladder is one enum that gives everyone a role.
    access: f
      .enum(['private', 'view', 'edit'], 'private')
      .grantsEveryone({ view: 'viewer', edit: 'editor' })
      .write('owner'),
    starred: f.boolean(false).pov().doc('Starred by me. Follows me across tabs and devices; nobody else sees it'),
    cursor: f.json<Cursor | null>(null).ether(),
  }),
})

/** "This person has this role." A grant is an ordinary object under the document. */
export const Share = schema.model('Share', {
  parent: 'Doc',
  via: 'parent',
  read: 'owner', // only owners ever receive these objects
  write: 'owner',
  grant: { to: 'agent', role: 'role' },
  fields: f => ({
    agent: f.ref('User'),
    role: f.enum(['viewer', 'editor', 'owner'], 'viewer'),
  }),
})

/** "Anyone holding this token has this role." The token is a secret only owners receive. */
export const Link = schema.model('Link', {
  parent: 'Doc',
  via: 'parent',
  read: 'owner',
  write: 'owner',
  grant: { proof: 'token', role: 'role' },
  fields: f => ({
    token: f.string(),
    role: f.enum(['viewer', 'editor', 'owner'], 'viewer'),
  }),
})

/** One element of a document. Lives entirely in the document's log, with its own id. */
export const Block = schema.model('Block', {
  home: 'stream',
  parent: 'Doc',
  via: 'parent',
  fields: f => ({
    kind: f.enum(['p', 'h1', 'h2', 'bullet', 'todo'], 'p').doc('p = paragraph, h1/h2 = headings, bullet = list item, todo = checkbox item'),
    text: f.string(),
    done: f.boolean(false).doc('Only meaningful for todo blocks'),
    marked: f.boolean(false).pov().doc('Highlighted by me. A private bookmark on a shared block'),
  }),
})

export type BlockKind = (typeof Block)['_fields']['kind']['_t']

// ───────────────────────────── actions ─────────────────────────────

export const newDoc = schema.action('User.newDoc', {
  on: User,
  role: 'owner', // on your own User object, so: only you
  runs: 'client',
  label: 'New document',
  input: f => ({ title: f.string('Untitled') }),
  run(ctx, me, input) {
    const doc = ctx.create(Doc, { title: input.title, owner: me.id })
    ctx.create(Block, { parent: doc, kind: 'p' })
    // Q is a participant like anyone else. New documents invite it; the owner can remove it.
    const q = ctx.all(User).find(user => user.kind === 'ai')
    if (q) ctx.create(Share, { parent: doc, agent: q.id, role: 'editor' })
    return doc.id
  },
})

export const share = schema.action('Doc.share', {
  on: Doc,
  role: 'owner',
  runs: 'client',
  label: 'Share with a person',
  input: f => ({ agent: f.ref('User'), role: f.enum(['viewer', 'editor', 'owner'], 'viewer') }),
  run(ctx, doc, input) {
    if (!input.agent) throw new LaneError('invalid', 'Choose who to share with')
    const existing = ctx.children(doc, Share).find(s => s.agent === input.agent)
    if (existing) existing.role = input.role
    else ctx.create(Share, { parent: doc, agent: input.agent, role: input.role })
  },
})

export const createLink = schema.action('Doc.createLink', {
  on: Doc,
  role: 'owner',
  runs: 'server', // the token must come from the server's randomness, not the browser's
  label: 'Create share link',
  input: f => ({ role: f.enum(['viewer', 'editor'], 'viewer') }),
  run(ctx, doc, input) {
    return ctx.create(Link, { parent: doc, token: rid(24), role: input.role }).token
  },
})

export const duplicate = schema.action('Doc.duplicate', {
  on: Doc,
  role: 'viewer', // what you can read, you can copy
  runs: 'server',
  label: 'Make a copy',
  doc: 'Create a new document that starts as a copy of this one',
  input: f => ({ upto: f.number(0).doc('Log position to copy up to; 0 means the latest') }),
  run(ctx, doc, input) {
    const copy = ctx.create(Doc, { title: `Copy of ${doc.title}`, owner: ctx.agent })
    ctx.forkStream(doc, copy, input.upto)
    return copy.id
  },
})

export const leave = schema.action('Doc.leave', {
  on: Doc,
  role: 'viewer',
  runs: 'server',
  label: 'Remove me from this document',
  when: (doc, ctx) => doc.owner !== ctx.agent,
  run(ctx, doc) {
    // Non-owners cannot see Share objects, let alone delete one. Stepping
    // outside the caller's own rights has to be spelled out, and is scoped to
    // exactly the caller's own grant.
    ctx.sudo(() => {
      for (const grant of ctx.children(doc, Share)) if (grant.agent === ctx.agent) ctx.remove(grant)
    })
  },
})

export const askQ = schema.action('Doc.askQ', {
  on: Doc,
  role: 'editor',
  runs: 'server',
  label: 'Ask Q',
  input: f => ({ task: f.enum(['summarize', 'draft', 'todos'], 'summarize') }),
  run(ctx, doc, input) {
    const q = ctx.services.q
    if (!q) throw new LaneError('invalid', 'Q is not running on this server')
    if (!q.canEdit(doc.id)) throw new LaneError('forbidden', 'Q cannot edit this document. Share it with Q as an editor first')
    ctx.after(() => q.ask(doc.id, input.task))
  },
})

export const trash = schema.action('Doc.trash', {
  on: Doc,
  role: 'owner',
  runs: 'client',
  label: 'Delete document',
  run(ctx, doc) {
    ctx.remove(doc)
  },
})
