# Lanes

A small TypeScript library built around one idea: there is **one typed object graph, and each field declares where it lives and who may see it**. Storage, sync, permissions, UI gating and the AI tool surface are all read from that one declaration instead of being written as separate layers.

It comes with a Google-Docs-style demo: several documents, live editing between people, and documents made of blocks that each have their own id.

This is a study of the architecture described in a written review of OP, a private framework written in Imba. I have not seen OP's code. Names, API shape and every implementation detail here are my own reading of that description.

## Run it

```bash
cd lanes
```

```bash
npm install
```

```bash
npm start
```

Open http://localhost:4747, pick a person, then open a second window as someone else. State is kept in `lanes/.data/`; delete that folder to start over.

```bash
npm test
```

runs 21 tests in-process (server and several clients over an in-memory transport).

```bash
npm run e2e
```

drives the real server with three browser sessions. It needs the `playwright` package and a Chromium for it, which are not in `package.json`.

## The idea, in the demo's own schema

All of this is from [`app/schema.ts`](app/schema.ts). Server, browser and AI agent import that one file.

```ts
export const Doc = schema.model('Doc', {
  streamRoot: true,                      // owns a write-ahead log holding its blocks
  fields: f => ({
    title:   f.string('Untitled'),                         // row: one value for everyone
    owner:   f.ref('User').grants('owner').write('owner'), // row, and a source of roles
    access:  f.enum(['private', 'view', 'edit'], 'private')
              .grantsEveryone({ view: 'viewer', edit: 'editor' })
              .write('owner'),                             // the privacy ladder
    starred: f.boolean(false).pov(),                       // per viewer
    cursor:  f.json<Cursor | null>(null).ether(),          // live presence, never stored
  }),
})

export const Block = schema.model('Block', {
  home: 'stream', parent: 'Doc', via: 'parent',            // lives in the document's log
  fields: f => ({
    kind:   f.enum(['p', 'h1', 'h2', 'bullet', 'todo'], 'p'),
    text:   f.string(),
    done:   f.boolean(false),
    marked: f.boolean(false).pov(),                        // my private highlight on a shared block
  }),
})
```

Application code then reads and writes through typed handles. The lane decides what a write does:

```ts
doc.title = 'Plan'      // optimistic, sent to the server, fanned out to everyone who may read it
doc.starred = true      // sent to the server, synced to my other tabs only
me.openDoc = doc.id     // sessionStorage; never leaves this tab
doc.cursor = { block: id, typing: true }  // relayed to peers, stored nowhere
```

## The six lanes

| Lane | Declared with | Stored | Who gets it | In the demo |
| --- | --- | --- | --- | --- |
| `row` | default, on a row model | server row store (`rows.json`) | everyone whose role may read the field | document title, owner, access; shares and links |
| `stream` | default, on a `home: 'stream'` model | the root's append-only log | everyone who opened the root | blocks: kind, text, done |
| `pov` | `.pov()` | server, per agent | that agent's own connections | star on a document, highlight on a block |
| `session` | `.session()` | `sessionStorage` | this tab | which document the tab has open |
| `local` | `.local()` | `localStorage` | this device | whether the inspector is shown |
| `ether` | `.ether()` | nowhere | other live connections | cursor position and typing indicator |

The inspector panel in the demo shows these per field for the focused block, the document and your own user, next to the messages on the wire.

## What is derived from the declarations

| Derived thing | Where |
| --- | --- |
| Which objects and fields a connection receives | `hydrate` and `resync` in [`src/server/server.ts`](src/server/server.ts) |
| Which writes are accepted | `execNew`, `execSet`, `execDel` in the same file |
| Who hears about a change | `fanOut` in the same file |
| What the UI enables | `client.can` and `client.actions()` in [`src/client/client.ts`](src/client/client.ts) |
| Runtime validation of values and action inputs | `checkValue`, used by both sides, in [`src/core/schema.ts`](src/core/schema.ts) |
| The tool list an AI agent is shown | [`src/agent/tools.ts`](src/agent/tools.ts) |
| The inspector | `shape()` in [`src/core/shape.ts`](src/core/shape.ts) |

## Permissions live in the graph

There is one role ladder (`viewer < editor < owner` in the demo). A role on an object comes from data in the graph:

- a ref field marked `.grants(role)`: whoever it points at holds the role (`Doc.owner`);
- an enum field marked `.grantsEveryone({...})`: its value gives everyone a role (`Doc.access`);
- child objects of a grant model: `Share` gives one agent a role, `Link` gives it to whoever presents its token;
- `via: 'parent'`: blocks, shares and links inherit the role held on their document.

The server resolves the role and sends it with each object. The client never recomputes it, so it cannot disagree with the server about what is allowed.

Visibility is live. When a share is added, a link is revoked or `access` changes, the server re-resolves that subtree for every connection, and objects enter or leave replicas in the same message as the change. `Share` and `Link` are declared `read: 'owner'`, so editors and viewers never receive them, including the link tokens.

## The log

Each document has its own log, one JSON line per committed transaction with its author and time. A document's blocks are that log folded from the start. From the same structure the demo gets:

- **History**: the History button fetches the log and replays it locally to any point, with the code the server uses.
- **Authorship**: each block knows who created it and who last wrote each field. The dot beside a block is the last author's colour, Q included.
- **Forks without copying**: ids inside a log are relative to their root, so "Make a copy" creates a document whose log is one line pointing at the source log and a position. The copy gets its own entries only when it is edited.

## Actions

A domain verb is declared once with its label, required role, typed input and where it runs:

```ts
export const createLink = schema.action('Doc.createLink', {
  on: Doc, role: 'owner', runs: 'server', label: 'Create share link',
  input: f => ({ role: f.enum(['viewer', 'editor'], 'viewer') }),
  run: (ctx, doc, input) => ctx.create(Link, { parent: doc, token: rid(24), role: input.role }).token,
})
```

`runs: 'client'` executes the body as one optimistic transaction; `runs: 'server'` makes it an RPC. The body sees the same `ctx` either way. Menus are built from `client.actions(doc)`, which returns what this person may run here.

## Q, the AI participant

Q connects the way a browser does, as its own agent. It sees only documents shared with it, appears in presence while it works, and its writes go through the same checks as anyone's and land in the log under its name. `toolsFor()` generates its tool list from the schema, filtered by its role.

Q's text is scripted (`PLANS` in [`app/q.ts`](app/q.ts)), not produced by a language model. To use a real model, pass it `toolsFor()` and `outline()` and feed its tool calls to `applyTool()`.

## Where this departs from what the review describes

The review listed costs of the original design. Three of them are addressed here on purpose:

- **Unknown modifiers failing silently.** Here a modifier or role the schema does not know is a compile error, and the same mistake made dynamically throws when the model is defined. Writing an unknown field throws.
- **A permission check that passes vacuously inside RPCs.** A server action here runs as the caller and is refused whatever the caller would be refused. Going beyond that takes an explicit `ctx.sudo(...)`; the demo uses it once, in `Doc.leave`.
- **The split between the initial snapshot and live updates.** Here there is one mechanism: the visible set is recomputed when anything that grants a role changes.

## What it does not do

- **No merging inside a field.** Last writer wins per field. Two people typing in different blocks, or changing different fields of one block, never conflict. Two people typing in the *same* block at the same moment can lose characters, because each keystroke writes the whole text. This is the same trade-off the review describes.
- **One server process.** The live graph is in memory, rows are a JSON snapshot rather than Postgres, and nothing here scales past one instance.
- **Every keystroke is a log entry.** There is no compaction, logs are never deleted, and loaded documents are never unloaded.
- **Not safe to expose.** Sign-in is a name picker, and there is no rate limiting.
- Not built: detached sub-streams, pov values inherited from a parent, moving an object to a new parent, device-hosted documents, and peer-to-peer presence (ether is relayed through the server).

## Layout

```
src/core/      schema, graph and operations, order keys, wire protocol, handles
src/server/    the authority, storage, HTTP + WebSocket
src/client/    the replica, WebSocket transport
src/agent/     tool generation for AI agents
app/           the docs demo: schema, server, Q, and the browser UI in app/web/
test/          lane, permission, log and agent tests; e2e.mjs for the browser
```

This folder is not part of the published personal site: it needs a server, and the Pages workflow leaves it out.
