/**
 * The docs demo server: `npm start`, then open http://localhost:4747.
 * State lives in `.data/` (rows.json plus one log per document); delete the
 * folder to start over.
 */

import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rid } from '../src/index.ts'
import { listen } from '../src/server/http.ts'
import { Server } from '../src/server/server.ts'
import { FileStorage } from '../src/server/storage.ts'
import { PEOPLE } from './people.ts'
import { Q } from './q.ts'
import { Block, Doc, schema, Share, User } from './schema.ts'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 4747)
const dataDir = process.env.LANES_DATA ?? join(here, '..', '.data')

// Q signs in with a secret made at boot, so a browser cannot pose as it.
const qSecret = rid(32)
const services: Record<string, any> = {}

const server = new Server({
  schema,
  storage: new FileStorage(dataDir),
  services,
  // DEMO ONLY. Anyone can be any person by naming them. A real deployment
  // verifies a session here and returns the agent id it belongs to.
  authenticate(auth) {
    const { user, secret } = (auth ?? {}) as { user?: string; secret?: string }
    const person = PEOPLE.find(p => p.id === user)
    if (!person) return null
    return person.kind === 'human' || secret === qSecret ? person.id : null
  },
})

if (server.graph.size === 0) {
  server.transact('system', ctx => PEOPLE.forEach(person => ctx.create(User, { ...person })), { sudo: true })
  // Seeded as Ada, under Ada's own rights.
  server.transact('ada', ctx => {
    const doc = ctx.create(Doc, { title: 'Welcome to Lanes', owner: 'ada', access: 'edit' })
    ctx.create(Share, { parent: doc, agent: 'q', role: 'editor' })
    const lines: [(typeof Block)['_fields']['kind']['_t'], string][] = [
      ['h1', 'One graph, six lanes'],
      ['p', 'Every paragraph here is a Block object with its own id, stored as entries in this document’s log. Open this page in a second window as someone else and type: you will see each other’s edits and cursors.'],
      ['h2', 'Things to try'],
      ['todo', 'Star this document. The star is yours alone and follows you across tabs (pov lane).'],
      ['todo', 'Open the inspector to see which lane each field lives in, and the messages on the wire.'],
      ['todo', 'Create a document, share it with Linus as a viewer, and watch it appear in his sidebar.'],
      ['todo', 'Open History and drag the slider. Then make a copy from an earlier point.'],
      ['todo', 'Ask Q for a summary. Then remove Q from the share list and ask again.'],
    ]
    for (const [kind, text] of lines) ctx.create(Block, { parent: doc, kind, text })
  })
}

const q = new Q(server, { user: 'q', secret: qSecret })
services.q = q
await q.ready()

const bundle = await build({
  entryPoints: [join(here, 'web/main.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  target: 'es2022',
  sourcemap: 'inline',
})
const script = bundle.outputFiles[0].contents

const files: Record<string, [type: string, body: () => Uint8Array | string]> = {
  '/': ['text/html; charset=utf-8', () => readFileSync(join(here, 'web/index.html'))],
  '/style.css': ['text/css; charset=utf-8', () => readFileSync(join(here, 'web/style.css'))],
  '/main.js': ['text/javascript; charset=utf-8', () => script],
}

await listen(server, {
  port,
  handler(req, res) {
    const file = files[new URL(req.url ?? '/', 'http://x').pathname]
    if (!file) return void res.writeHead(404).end('Not found')
    res.writeHead(200, { 'content-type': file[0], 'cache-control': 'no-store' }).end(file[1]())
  },
})
console.log(`Lanes docs demo on http://localhost:${port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close()
    process.exit(0)
  })
}
