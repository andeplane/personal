import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replay } from '../src/client/client.ts'
import { between, defineSchema, LaneError } from '../src/index.ts'
import { MemoryStorage } from '../src/server/storage.ts'
import { Block, createLink, Doc, duplicate, leave, Link, newDoc, share, Share, User } from '../app/schema.ts'
import { boot, forge, rejections, tick } from './helpers.ts'

/** Ada creates a document with two blocks and opens it. */
async function withDoc() {
  const world = boot()
  const ada = await world.join('ada')
  const id = await ada.run(newDoc, ada.get(User, 'ada')!, { title: 'Plan' })
  const doc = ada.get(Doc, id)!
  await ada.open(doc)
  const [first] = ada.children(doc, Block)
  first.text = 'First'
  const second = ada.create(Block, { parent: doc, after: first, text: 'Second' })
  await ada.settled()
  return { ...world, ada, doc, first, second }
}

test('the schema refuses declarations it does not understand', () => {
  const s = defineSchema({ roles: ['viewer', 'editor'], write: 'editor' })
  assert.throws(() => s.model('A', { read: 'admin' as any, fields: () => ({}) }), /unknown role "admin"/)
  assert.throws(() => s.model('B', { fields: f => ({ x: f.string().pov().local() }) }), /exactly one lane/)
  assert.throws(() => s.model('C', { fields: f => ({ x: f.string().pov().write('editor') }) }), /no meaning in the pov lane/)
  assert.throws(() => s.model('D', { fields: f => ({ id: f.string() }) }), /reserved field name/)
  // And the type system refuses them before that:
  // @ts-expect-error unknown role
  assert.throws(() => s.model('E', { fields: f => ({ x: f.string().write('admin') }) }))
  // @ts-expect-error unknown modifier
  assert.throws(() => s.model('F', { fields: f => ({ x: f.string().everywhere() }) }))
})

test('order keys always sort between their neighbours', () => {
  const keys: string[] = [between(null, null)]
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 3000; i++) {
    const at = Math.floor(random() ** 2 * (keys.length + 1)) // skewed towards the front
    const key = between(keys[at - 1] ?? null, keys[at] ?? null)
    assert.ok((at === 0 || keys[at - 1] < key) && (at === keys.length || key < keys[at]), `bad key ${key} at ${at}`)
    assert.ok(!key.endsWith('0'))
    keys.splice(at, 0, key)
  }
  let tail = between(null, null)
  for (let i = 0; i < 1000; i++) tail = between(tail, null)
  assert.ok(tail.length < 40, `appending 1000 times gave a ${tail.length}-char key`)
})

test('row lane: a document is invisible until a grant makes it appear, live', async () => {
  const { join, ada, doc } = await withDoc()
  const linus = await join('linus')
  assert.equal(linus.get(Doc, doc.id), undefined)

  await ada.run(share, doc, { agent: 'linus', role: 'viewer' })
  await ada.settled()
  await tick()
  const seen = linus.get(Doc, doc.id)!
  assert.equal(seen.title, 'Plan')
  assert.equal(seen.$role, 'viewer')

  doc.title = 'Plan B'
  await ada.settled()
  await tick()
  assert.equal(seen.title, 'Plan B')

  // Removing the grant removes the document from Linus's replica.
  ada.remove(ada.children(doc, Share).find(s => s.agent === 'linus')!)
  await ada.settled()
  await tick()
  assert.equal(linus.get(Doc, doc.id), undefined)
  assert.equal(seen.$alive, false)
})

test('the same declaration gates the UI, the client write and the server', async () => {
  const { join, ada, doc, first } = await withDoc()
  await ada.run(share, doc, { agent: 'linus', role: 'viewer' })
  await ada.settled()
  const linus = await join('linus')
  const theirs = linus.get(Doc, doc.id)!
  await linus.open(theirs)

  // UI gating
  assert.equal(linus.can.write(theirs, 'title'), false)
  assert.equal(ada.can.write(doc, 'title'), true)
  assert.deepEqual(linus.actions(theirs).map(a => a.name), ['Doc.duplicate', 'Doc.leave'])
  // Client write
  assert.throws(() => (theirs.title = 'Mine now'), (e: LaneError) => e.code === 'forbidden')
  // Server, for a client that skips its own checks
  const refused = rejections(linus)
  forge(linus, [{ op: 'set', id: doc.id, fields: { title: 'Mine now' } }])
  forge(linus, [{ op: 'set', id: first.id, fields: { text: 'Mine now' } }])
  forge(linus, [{ op: 'set', id: doc.id, fields: { owner: 'linus' } }])
  forge(linus, [{ op: 'del', id: doc.id }])
  await tick()
  assert.deepEqual(refused.map(r => r.code), ['forbidden', 'forbidden', 'forbidden', 'forbidden'])
  assert.equal(doc.title, 'Plan')
  assert.equal(first.text, 'First')
})

test('dehydration: grants and link tokens only ever reach owners', async () => {
  const { join, ada, doc } = await withDoc()
  await ada.run(share, doc, { agent: 'linus', role: 'editor' })
  const token = await ada.run(createLink, doc, { role: 'viewer' })
  await ada.settled()
  assert.equal(ada.children(doc, Share).length, 2) // Q and Linus
  assert.equal(ada.children(doc, Link)[0].token, token)

  const linus = await join('linus')
  const theirs = linus.get(Doc, doc.id)!
  assert.equal(theirs.$role, 'editor')
  assert.equal(linus.children(theirs, Share).length, 0)
  assert.equal(linus.children(theirs, Link).length, 0)
  // An editor asking for the grant by id is told it does not exist.
  const refused = rejections(linus)
  forge(linus, [{ op: 'set', id: ada.children(doc, Share)[0].id, fields: { role: 'owner' } }])
  await tick()
  assert.equal(refused[0].code, 'not_found')
})

test('privacy ladder: one enum field gives everyone a role', async () => {
  const { join, ada, doc } = await withDoc()
  const grace = await join('grace')
  assert.equal(grace.get(Doc, doc.id), undefined)

  doc.access = 'view'
  await ada.settled()
  await tick()
  assert.equal(grace.get(Doc, doc.id)!.$role, 'viewer')

  doc.access = 'edit'
  await ada.settled()
  await tick()
  assert.equal(grace.get(Doc, doc.id)!.$role, 'editor')
  assert.equal(grace.can.write(grace.get(Doc, doc.id)!, 'title'), true)
  assert.equal(grace.can.write(grace.get(Doc, doc.id)!, 'access'), false)

  doc.access = 'private'
  await ada.settled()
  await tick()
  assert.equal(grace.get(Doc, doc.id), undefined)
})

test('value-proof: presenting a link token grants the role, revoking the link removes it', async () => {
  const { join, ada, doc } = await withDoc()
  const token = await ada.run(createLink, doc, { role: 'editor' })
  const grace = await join('grace')
  assert.equal(grace.get(Doc, doc.id), undefined)

  grace.prove('not-the-token-not-the-token')
  await tick()
  assert.equal(grace.get(Doc, doc.id), undefined)

  grace.prove(token)
  await tick()
  assert.equal(grace.get(Doc, doc.id)!.$role, 'editor')

  ada.remove(ada.children(doc, Link)[0])
  await ada.settled()
  await tick()
  assert.equal(grace.get(Doc, doc.id), undefined)
})

test('stream lane: blocks sync in order between people who opened the document', async () => {
  const { join, ada, doc, first, second } = await withDoc()
  await ada.run(share, doc, { agent: 'linus', role: 'editor' })
  await ada.settled()
  const linus = await join('linus')
  const theirs = linus.get(Doc, doc.id)!
  assert.equal(linus.children(theirs, Block).length, 0, 'content is not sent before the stream is opened')
  await linus.open(theirs)
  assert.deepEqual(linus.children(theirs, Block).map(b => b.text), ['First', 'Second'])

  // Different fields of one block, edited at the same time, both survive.
  const mineOfSecond = linus.get(Block, second.id)!
  second.kind = 'todo'
  mineOfSecond.text = 'Second, edited'
  // A block inserted between two others lands between them for everyone.
  linus.create(Block, { parent: theirs, after: linus.get(Block, first.id)!, text: 'Between' })
  await Promise.all([ada.settled(), linus.settled()])
  await tick()
  for (const client of [ada, linus]) {
    const blocks = client.children(client.get(Doc, doc.id)!, Block)
    assert.deepEqual(blocks.map(b => [b.kind, b.text]), [['p', 'First'], ['p', 'Between'], ['todo', 'Second, edited']])
  }

  // The same field edited at the same time: the server's order decides, and both converge.
  first.text = 'Ada wins?'
  linus.get(Block, first.id)!.text = 'Linus wins?'
  await Promise.all([ada.settled(), linus.settled()])
  await tick()
  assert.equal(first.text, linus.get(Block, first.id)!.text)

  linus.shut(theirs)
  assert.equal(linus.children(theirs, Block).length, 0)
})

test('optimistic writes show at once and vanish if the server refuses the transaction', async () => {
  const { ada, doc, first } = await withDoc()
  doc.title = 'Instant'
  assert.equal(doc.title, 'Instant')
  assert.equal((doc as any).$pending, true)
  await ada.settled()
  assert.equal((doc as any).$pending, false)

  // One bad operation sinks the whole transaction, including the good ones.
  const refused = rejections(ada)
  ada.tx(() => {
    first.text = 'Changed'
    ada.create(Block, { parent: doc, text: 'New' })
    ;(ada as any).push({ op: 'set', id: doc.id, fields: { owner: 'nobody' } })
  })
  assert.equal(first.text, 'Changed')
  assert.equal(ada.children(doc, Block).length, 3)
  await ada.settled()
  assert.equal(refused.length, 1)
  assert.match(refused[0].message, /not an existing User/)
  assert.equal(first.text, 'First')
  assert.equal(ada.children(doc, Block).length, 2)
})

test('pov lane: my star follows me to my other tabs and nobody else', async () => {
  const storage = new MemoryStorage()
  const { server, join } = boot(storage)
  const ada = await join('ada')
  const id = await ada.run(newDoc, ada.get(User, 'ada')!, {})
  const doc = ada.get(Doc, id)!
  doc.access = 'view'
  const adaPhone = await join('ada')
  const linus = await join('linus')
  await ada.settled()
  await tick()

  doc.starred = true
  await ada.settled()
  await tick()
  assert.equal(adaPhone.get(Doc, id)!.starred, true)
  assert.equal(linus.get(Doc, id)!.starred, false)

  // A viewer may set their own pov value on a document they cannot edit.
  linus.get(Doc, id)!.starred = true
  await linus.settled()
  await tick()
  assert.equal(linus.get(Doc, id)!.starred, true)

  // It is stored: a fresh server on the same storage still has it.
  server.close()
  const again = boot(storage)
  assert.equal((await again.join('ada')).get(Doc, id)!.starred, true)
  assert.equal((await again.join('grace')).get(Doc, id)!.starred, false)
})

test('session and local lanes never touch the wire', async () => {
  const { join } = boot()
  const session = { get: () => null as string | null, set: () => {} }
  const tab1 = await join('ada')
  const tab2 = await join('ada', { session })
  const sent: unknown[] = []
  tab1.on('wire', (direction, msg) => direction === 'out' && sent.push(msg))

  const me = tab1.get(User, 'ada')!
  me.openDoc = 'doc_x'
  me.inspector = true
  await tick()
  assert.deepEqual(sent, [])
  assert.equal(me.openDoc, 'doc_x')
  assert.equal(me.inspector, true)
  assert.equal(tab2.get(User, 'ada')!.openDoc, null)

  // And the server refuses them if a client sends them anyway.
  const refused = rejections(tab1)
  forge(tab1, [{ op: 'set', id: 'ada', fields: { openDoc: null } }])
  await tick()
  assert.match(refused[0].message, /session lane and never leaves the client/)
})

test('ether lane: presence is relayed to peers, never stored, and cleared on disconnect', async () => {
  const { server, storage, join, ada, doc, first } = await withDoc()
  doc.access = 'edit'
  await ada.settled()
  const linus = await join('linus')
  const theirs = linus.get(Doc, doc.id)!

  doc.cursor = { block: first.id, typing: true }
  await tick()
  assert.deepEqual(linus.peers(theirs).map(p => [p.agent, p.state.cursor]), [['ada', { block: first.id, typing: true }]])
  assert.deepEqual(doc.cursor, { block: first.id, typing: true })
  assert.deepEqual(ada.peers(doc), [], 'you are not your own peer')

  // Someone who arrives later still learns who is here.
  const grace = await join('grace')
  assert.equal(grace.peers(grace.get(Doc, doc.id)!)[0].agent, 'ada')

  server.flush()
  assert.ok(!JSON.stringify(storage.loadSnapshot()).includes('typing'))
  assert.ok(!JSON.stringify(storage.readWal(doc.id)).includes('typing'))

  ada.close()
  await tick()
  assert.deepEqual(linus.peers(theirs), [])
})

test('the log gives history, authorship and time travel for free', async () => {
  const { join, ada, doc, first, second } = await withDoc()
  doc.access = 'edit'
  await ada.settled()
  const linus = await join('linus')
  await linus.open(linus.get(Doc, doc.id)!)
  linus.get(Block, second.id)!.text = 'Second, by Linus'
  await linus.settled()
  await tick()

  const meta = (second as any).$meta
  assert.equal(meta.by, 'ada', 'created by')
  assert.equal(meta.f.text[0], 'linus', 'text last written by')

  const entries = await ada.history(doc)
  assert.deepEqual(entries.map(e => [e.seq, e.by]), [[1, 'ada'], [2, 'ada'], [3, 'ada'], [4, 'linus']])
  assert.deepEqual(replay(doc.id, entries, 1).map(b => b.fields.text ?? ''), [''])
  assert.deepEqual(replay(doc.id, entries, 3).map(b => b.fields.text), ['First', 'Second'])
  assert.deepEqual(replay(doc.id, entries).map(b => b.fields.text), ['First', 'Second, by Linus'])
  assert.equal(first.text, 'First')
})

test('a restarted server rebuilds documents from their logs', async () => {
  const storage = new MemoryStorage()
  const world = boot(storage)
  const ada = await world.join('ada')
  const id = await ada.run(newDoc, ada.get(User, 'ada')!, { title: 'Durable' })
  const doc = ada.get(Doc, id)!
  await ada.open(doc)
  ada.children(doc, Block)[0].text = 'Still here'
  ada.create(Block, { parent: doc, kind: 'todo', text: 'And this', done: true })
  await ada.settled()
  world.server.close()

  const again = await boot(storage).join('ada')
  const reopened = again.get(Doc, id)!
  assert.equal(reopened.title, 'Durable')
  await again.open(reopened)
  assert.deepEqual(again.children(reopened, Block).map(b => [b.kind, b.text, b.done]), [['p', 'Still here', false], ['todo', 'And this', true]])
})

test('a fork shares the source log instead of copying it', async () => {
  const { storage, join, ada, doc, first } = await withDoc()
  doc.access = 'view'
  await ada.settled()
  const grace = await join('grace')
  const source = grace.get(Doc, doc.id)!
  const copyId = await grace.run(duplicate, source, {})
  await tick()
  const copy = grace.get(Doc, copyId)!
  assert.equal(copy.$role, 'owner')
  assert.equal(copy.title, 'Copy of Plan')
  await grace.open(copy)
  const blocks = grace.children(copy, Block)
  assert.deepEqual(blocks.map(b => b.text), ['First', 'Second'])
  assert.ok(blocks.every(b => b.id.startsWith(copyId + '/')), 'forked blocks have ids under the new root')

  // The copy's own log holds a pointer and nothing else until it is edited.
  assert.deepEqual(storage.readWal(copyId), { header: { fork: { from: doc.id, upto: 3 } }, entries: [] })
  blocks[0].text = 'Diverged'
  await grace.settled()
  assert.equal(storage.readWal(copyId).entries.length, 1)
  assert.equal(first.text, 'First', 'the source is untouched')
  assert.equal(ada.get(Doc, copyId), undefined, 'and the copy is private to Grace')

  // A fork from an earlier point in history.
  const earlier = await ada.run(duplicate, doc, { upto: 2 })
  await tick()
  await ada.open(ada.get(Doc, earlier)!)
  assert.deepEqual(ada.children(ada.get(Doc, earlier)!, Block).map(b => b.text), ['First'])
})

test('server actions run as the caller; exceeding that takes an explicit sudo', async () => {
  const s = defineSchema({ roles: ['viewer', 'owner'], write: 'owner' })
  const Note = s.model('Note', {
    everyone: 'viewer',
    create: 'viewer',
    fields: f => ({ owner: f.ref('Note').grants('owner'), text: f.string() }),
  })
  const plain = s.action('Note.plain', { on: Note, role: 'viewer', runs: 'server', label: 'x', run: (_ctx, note) => void (note.text = 'changed') })
  const elevated = s.action('Note.elevated', {
    on: Note,
    role: 'viewer',
    runs: 'server',
    label: 'x',
    run: (ctx, note) => ctx.sudo(() => void (note.text = 'changed')),
  })
  const { Server } = await import('../src/server/server.ts')
  const { Client } = await import('../src/client/client.ts')
  const server = new Server({ schema: s, authenticate: auth => auth as string })
  const noteId = server.transact('root', ctx => ctx.create(Note, { text: 'original' }).id, { sudo: true })
  const client = await new Client({ schema: s, connect: () => server.connectLocal(), auth: 'someone' }).ready()
  const note = client.get(Note, noteId)!

  await assert.rejects(client.run(plain, note), (e: LaneError) => e.code === 'forbidden')
  assert.equal(note.text, 'original')
  await client.run(elevated, note)
  await tick()
  assert.equal(note.text, 'changed')
})

test('Doc.leave removes only the caller\'s own grant', async () => {
  const { join, ada, doc } = await withDoc()
  await ada.run(share, doc, { agent: 'linus', role: 'editor' })
  await ada.run(share, doc, { agent: 'grace', role: 'editor' })
  await ada.settled()
  const linus = await join('linus')
  const grace = await join('grace')
  await linus.run(leave, linus.get(Doc, doc.id)!)
  await tick()
  assert.equal(linus.get(Doc, doc.id), undefined)
  assert.equal(grace.get(Doc, doc.id)!.$role, 'editor')
  assert.deepEqual(ada.children(doc, Share).map(s => s.agent).sort(), ['grace', 'q'])
})

test('a resent transaction after a reconnect is applied once', async () => {
  const { ada, doc } = await withDoc()
  const before = (await ada.history(doc)).length
  const block = ada.create(Block, { parent: doc, text: 'Once' })
  const tx = (ada as any).pending[0]
  ;(ada as any).sendRaw({ t: 'tx', n: tx.n, ops: tx.ops }) // what a reconnect does
  await ada.settled()
  await tick()
  assert.equal(block.$alive, true)
  assert.equal((await ada.history(doc)).length, before + 1)
})
