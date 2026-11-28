import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyTool, outline, toolsFor } from '../src/agent/tools.ts'
import { shape as shapeOf } from '../src/core/shape.ts'
import { Q } from '../app/q.ts'
import { askQ, Block, Doc, newDoc, schema, Share, User } from '../app/schema.ts'
import { boot, rejections, tick } from './helpers.ts'

test('the tool list an agent is shown follows its role', async () => {
  const { join } = boot()
  const ada = await join('ada')
  const id = await ada.run(newDoc, ada.get(User, 'ada')!, { title: 'Spec' })
  const doc = ada.get(Doc, id)!
  await ada.settled()

  const q = await join('q')
  const asEditor = toolsFor(q, q.get(Doc, id)!).map(t => t.name)
  assert.deepEqual(asEditor, ['update_doc', 'create_block', 'update_block', 'delete_block', 'run_Doc_duplicate', 'run_Doc_leave', 'run_Doc_askQ'])
  const update = toolsFor(q, q.get(Doc, id)!).find(t => t.name === 'update_block')!
  assert.deepEqual(Object.keys(update.input_schema.properties), ['id', 'kind', 'text', 'done'], 'only shared fields this role may write')

  ada.children(doc, Share)[0].role = 'viewer'
  await ada.settled()
  await tick()
  assert.deepEqual(toolsFor(q, q.get(Doc, id)!).map(t => t.name), ['run_Doc_duplicate', 'run_Doc_leave'])
  assert.throws(() => applyTool(q, q.get(Doc, id)!, 'update_doc', { id, title: 'Hijacked' }), /may not write Doc.title/)
})

test('Q writes through the same path as people, with its name in the log', async () => {
  const services: Record<string, any> = {}
  const { server, join } = boot(undefined, services)
  const q = new Q(server, { user: 'q' }, 0)
  services.q = q
  await q.ready()

  const ada = await join('ada')
  const id = await ada.run(newDoc, ada.get(User, 'ada')!, { title: 'Roadmap' })
  const doc = ada.get(Doc, id)!
  await ada.open(doc)
  ada.children(doc, Block)[0].text = 'We ship the editor first. Then sharing.'
  await ada.settled()

  await ada.run(askQ, doc, { task: 'summarize' })
  await q.ask(id, 'todos') // queued behind the summary
  await tick()
  const blocks = ada.children(doc, Block)
  assert.deepEqual(blocks.map(b => b.kind), ['p', 'h2', 'p', 'bullet', 'h2', 'todo', 'todo', 'todo', 'todo'])
  assert.equal(blocks[3].text, 'We ship the editor first.')
  assert.equal((blocks[1] as any).$meta.by, 'q')
  const authors = new Set((await ada.history(doc)).map(entry => entry.by))
  assert.deepEqual([...authors], ['ada', 'q'])
  assert.match(outline(ada, doc), /^\[doc_\w+\] Doc title="Roadmap"/)

  // Take away Q's grant and the same request is refused, by the server.
  ada.remove(ada.children(doc, Share)[0])
  await ada.settled()
  await tick()
  const refused = rejections(ada)
  await assert.rejects(ada.run(askQ, doc, { task: 'draft' }), /Q cannot edit this document/)
  assert.deepEqual(refused, [])
})

test('the schema describes itself, lanes included', () => {
  const doc = shapeOf(schema).find(model => model.name === 'Doc')!
  assert.deepEqual(
    doc.fields.map(f => [f.name, f.lane, f.write]),
    [
      ['title', 'row', 'editor'],
      ['owner', 'row', 'owner'],
      ['access', 'row', 'owner'],
      ['starred', 'pov', null],
      ['cursor', 'ether', null],
    ],
  )
  assert.equal(shapeOf(schema).find(model => model.name === 'Block')!.fields[1].lane, 'stream')
})
