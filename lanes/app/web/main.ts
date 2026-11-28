/**
 * The docs UI. Everything it knows about the data comes through `client`:
 * handles for reading and writing, `client.can` for what to enable, and
 * `client.actions()` for what to put in menus.
 */

import { Client, replay, webKV, type Rejection } from '../../src/client/client.ts'
import { wsTransport } from '../../src/client/ws.ts'
import { between, shape, type AnyHandle, type ClientMsg, type Handle, type Rec, type ServerMsg, type WalEntry } from '../../src/index.ts'
import { PEOPLE } from '../people.ts'
import { askQ, Block, createLink, Doc, duplicate, leave, Link, newDoc, schema, share, Share, trash, User, type BlockKind } from '../schema.ts'
import { getSelectionIn, h, region, setCaret, shiftCaret } from './dom.ts'

const app = document.getElementById('app')!
const params = new URLSearchParams(location.search)
const humans = PEOPLE.filter(person => person.kind === 'human')
const who = params.get('as') ?? sessionStorage.getItem('lanes:as')

if (who && humans.some(person => person.id === who)) void start(who)
else pickPerson()

function pickPerson(): void {
  const go = (id: string) => {
    params.set('as', id)
    location.search = params.toString()
  }
  app.className = 'signin'
  app.replaceChildren(
    h(
      'div',
      { class: 'pick' },
      h('h1', null, 'Lanes ', h('span', null, 'Docs')),
      h('p', null, 'Pick who you are in this window. Open a second window as someone else to edit together.'),
      h('div', { class: 'people' }, humans.map(p => h('button', { onclick: () => go(p.id), style: `--c:${p.color}` }, avatar(p), p.name))),
      h('p', { class: 'fine' }, 'This is a demo sign-in. There are no passwords.'),
    ),
  )
}

function avatar(person: { name: string; color: string }, title?: string): HTMLElement {
  return h('span', { class: 'avatar', style: `--c:${person.color}`, title: title ?? person.name }, person.name.slice(0, 1))
}

const KINDS: [BlockKind, string][] = [
  ['p', 'Text'],
  ['h1', 'H1'],
  ['h2', 'H2'],
  ['bullet', 'List'],
  ['todo', 'To-do'],
]
const SHORTCUTS: [RegExp, BlockKind][] = [
  [/^#[  ]/, 'h1'],
  [/^##[  ]/, 'h2'],
  [/^[-*][  ]/, 'bullet'],
  [/^\[\][  ]/, 'todo'],
]
const ACCESS: [Handle<typeof Doc>['access'], string][] = [
  ['private', 'Only people added below'],
  ['view', 'Everyone can view'],
  ['edit', 'Everyone can edit'],
]

async function start(who: string): Promise<void> {
  sessionStorage.setItem('lanes:as', who)
  const tokens: string[] = JSON.parse(sessionStorage.getItem('lanes:tokens') ?? '[]')
  const link = params.get('link')
  if (link && !tokens.includes(link)) tokens.push(link)
  sessionStorage.setItem('lanes:tokens', JSON.stringify(tokens))

  const client = new Client({
    schema,
    connect: () => wsTransport(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`),
    auth: { user: who },
    tokens,
    session: webKV(sessionStorage, `lanes:${who}:`),
    local: webKV(localStorage, `lanes:${who}:`),
    reconnect: 1000,
  })
  await client.ready()
  const me = client.get(User, who)!
  if (params.get('doc')) me.openDoc = params.get('doc')
  else if (!client.get(Doc, me.openDoc)) me.openDoc = client.all(Doc)[0]?.id ?? null
  history.replaceState(null, '', `?as=${who}`)

  // ───────────────────────────── view state ─────────────────────────────

  const ui = {
    pop: null as null | 'share' | 'more' | 'q',
    history: null as null | { doc: string; entries: WalEntry[]; at: number },
    /** Where to put the caret after the next render. */
    wantFocus: null as null | { id: string; offset: number },
    wire: [] as string[],
    toasts: [] as { id: number; text: string }[],
  }
  let focused: string | null = null
  let composing = false
  let typingTimer = 0
  let streamOf: string | null = null

  const person = (id: string | null | undefined) => {
    const user = client.get(User, id)
    return user ? { name: user.name, color: user.color } : { name: id ?? 'Nobody', color: '#94a3b8' }
  }
  const toast = (text: string) => {
    const id = Date.now() + Math.random()
    ui.toasts.push({ id, text })
    setTimeout(() => {
      ui.toasts = ui.toasts.filter(t => t.id !== id)
      render()
    }, 4500)
    render()
  }
  const fail = (error: unknown) => toast(error instanceof Error ? error.message : String(error))
  const openDoc = (id: string | null) => {
    ui.history = null
    ui.pop = null
    focused = null
    me.openDoc = id
    render()
  }

  // ───────────────────────────── skeleton ─────────────────────────────

  const side = h('aside', { class: 'side' })
  const title = h('input', {
    class: 'title',
    'aria-label': 'Document title',
    oninput: () => {
      const doc = client.get(Doc, me.openDoc)
      if (doc) doc.title = title.value
    },
  })
  const badge = h('span', { class: 'role' })
  const presence = h('div', { class: 'presence' })
  const tools = h('div', { class: 'tools' })
  const pop = h('div', { class: 'pop' })
  const notice = h('div', { class: 'notice' })
  const blocks = h('div', { class: 'blocks' })
  const snapshot = h('div', { class: 'blocks snapshot' })
  const addBlock = h('button', { class: 'add', onclick: () => appendBlock() }, '+ Add a block')
  const empty = h('div', { class: 'empty' })
  const page = h('section', { class: 'page', onclick: (event: Event) => event.target === page && focusLast() }, blocks, snapshot, addBlock)
  const main = h('main', { class: 'main' }, h('header', { class: 'bar' }, title, badge, presence, tools, pop), notice, page, empty)
  const inspector = h('aside', { class: 'inspector' })
  const toasts = h('div', { class: 'toasts', role: 'status' })
  app.replaceChildren(side, main, inspector, toasts)

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (ui.pop) ui.pop = null
    else if (ui.history) ui.history = null
    render()
  })
  document.addEventListener('mousedown', event => {
    if (ui.pop && !pop.contains(event.target as Node) && !tools.contains(event.target as Node)) {
      ui.pop = null
      render()
    }
  })

  client.on('change', render)
  client.on('status', render)
  client.on('rejected', (rejection: Rejection) => toast(`The server refused that change: ${rejection.message}`))
  client.on('wire', (direction, msg) => {
    ui.wire.push(describeWire(direction, msg))
    if (ui.wire.length > 14) ui.wire.shift()
    if (me.inspector) queueMicrotask(render)
  })
  render()

  // ───────────────────────────── render ─────────────────────────────

  function render(): void {
    const doc = client.get(Doc, me.openDoc)
    // Keep exactly the open document's stream open. Its blocks arrive like any other change.
    if (doc && !client.isOpen(doc)) client.open(doc).catch(() => {})
    if (streamOf && streamOf !== doc?.id) {
      const old = client.get(Doc, streamOf)
      if (old) client.shut(old)
    }
    streamOf = doc?.id ?? null
    if (ui.history && ui.history.doc !== doc?.id) ui.history = null

    app.classList.toggle('with-inspector', me.inspector)
    renderSide(doc)
    main.classList.toggle('no-doc', !doc)
    if (doc) {
      renderBar(doc)
      renderNotice(doc)
      if (ui.history) renderSnapshot(doc)
      else renderBlocks(doc)
      blocks.hidden = !!ui.history
      snapshot.hidden = !ui.history
      addBlock.hidden = !!ui.history || !client.can.create(Block, doc)
    } else {
      region(empty, [me.openDoc], () =>
        me.openDoc
          ? [h('h2', null, 'This document is not available'), h('p', null, 'It was deleted, or it is no longer shared with you.')]
          : [h('h2', null, 'No document open'), h('p', null, 'Pick one on the left, or create a new one.')],
      )
    }
    renderInspector(doc)
    region(toasts, ui.toasts, () => ui.toasts.map(t => h('div', { class: 'toast' }, t.text)))
  }

  function renderSide(current: Handle<typeof Doc> | undefined): void {
    const docs = client.all(Doc).sort((a, b) => Number(b.starred) - Number(a.starred))
    const key = [client.status, current?.id, docs.map(d => [d.id, d.title, d.starred, d.$role, d.owner])]
    region(side, key, () => [
      h('div', { class: 'brand' }, 'Lanes ', h('span', null, 'Docs')),
      h(
        'button',
        { class: 'primary', onclick: () => client.run(newDoc, me, {}).then(openDoc, fail) },
        'New document',
      ),
      h(
        'nav',
        { 'aria-label': 'Documents' },
        docs.length === 0 && h('p', { class: 'fine' }, 'Nothing is shared with you yet.'),
        docs.map(doc =>
          h(
            'div',
            { class: `doc${doc.id === current?.id ? ' current' : ''}` },
            h(
              'button',
              {
                class: `star${doc.starred ? ' on' : ''}`,
                title: 'Star. Only you see your stars',
                'aria-pressed': String(doc.starred),
                onclick: () => (doc.starred = !doc.starred),
              },
              doc.starred ? '★' : '☆',
            ),
            h(
              'button',
              { class: 'open', onclick: () => openDoc(doc.id) },
              h('span', { class: 't' }, doc.title || 'Untitled'),
              h('span', { class: 'm' }, doc.owner === who ? 'Yours' : `${person(doc.owner).name} · ${doc.$role}`),
            ),
          ),
        ),
      ),
      h(
        'footer',
        null,
        h('div', { class: 'me' }, avatar(person(who)), h('b', null, person(who).name), h('span', { class: `status ${client.status}` }, client.status)),
        h(
          'p',
          { class: 'fine' },
          'Open a window as ',
          humans.filter(p => p.id !== who).map((p, i) => [i > 0 && ' or ', h('a', { href: `?as=${p.id}`, target: '_blank' }, p.name)]),
        ),
      ),
    ])
  }

  function renderBar(doc: Handle<typeof Doc>): void {
    if (title.value !== doc.title) title.value = doc.title
    title.readOnly = !client.can.write(doc, 'title')
    badge.textContent = doc.$role
    badge.title = `You are ${doc.$role === 'owner' ? 'the' : 'a'}${doc.$role === 'editor' ? 'n' : ''} ${doc.$role} of this document`

    // Presence is the ether lane: one entry per live connection, gone when it closes.
    const here = new Map<string, boolean>()
    for (const peer of client.peers(doc)) {
      if (peer.state.cursor) here.set(peer.agent, (here.get(peer.agent) ?? false) || peer.state.cursor.typing)
    }
    region(presence, [...here], () =>
      [...here].map(([agent, typing]) => {
        const p = person(agent)
        return h('span', { class: `peer${typing ? ' typing' : ''}` }, avatar(p, `${p.name}${typing ? ' is typing' : ' is here'}`))
      }),
    )

    const can = { q: client.can.run(askQ, doc), share: client.can.run(share, doc) }
    const toggle = (name: typeof ui.pop) => () => {
      ui.pop = ui.pop === name ? null : name
      render()
    }
    region(tools, [can, ui.pop, !!ui.history, me.inspector], () => [
      can.q && h('button', { class: ui.pop === 'q' ? 'on' : '', onclick: toggle('q') }, 'Ask Q'),
      can.share && h('button', { class: ui.pop === 'share' ? 'on' : '', onclick: toggle('share') }, 'Share'),
      h('button', { class: ui.history ? 'on' : '', onclick: () => toggleHistory(doc) }, 'History'),
      h('button', { class: me.inspector ? 'on' : '', onclick: () => ((me.inspector = !me.inspector), render()) }, 'Inspector'),
      h('button', { class: ui.pop === 'more' ? 'on' : '', 'aria-label': 'More actions', onclick: toggle('more') }, '⋯'),
    ])
    renderPop(doc)
  }

  function renderPop(doc: Handle<typeof Doc>): void {
    pop.hidden = !ui.pop
    if (ui.pop === 'q') {
      region(pop, ['q', doc.id], () => [
        h('h3', null, 'Ask Q'),
        h('p', { class: 'fine' }, 'Q joins the document as its own participant and writes with its own role. Its text is scripted in this demo, not generated.'),
        // The choices are the action's declared input, not a list kept in the UI.
        askQ.input.task.values!.map(task =>
          h(
            'button',
            {
              class: 'row',
              onclick: () => {
                ui.pop = null
                client.run(askQ, doc, { task: task as 'summarize' }).catch(fail)
                render()
              },
            },
            ({ summarize: 'Summarize this document', draft: 'Draft a section', todos: 'Propose next steps' } as Record<string, string>)[task] ?? task,
          ),
        ),
      ])
    } else if (ui.pop === 'more') {
      // Everything the schema says this person may do here, minus what has its own button.
      const rest = client.actions(doc).filter(action => !([askQ, share, createLink] as unknown[]).includes(action))
      region(pop, ['more', doc.id, rest.map(a => a.name)], () =>
        rest.map(action => h('button', { class: `row${action === trash ? ' danger' : ''}`, onclick: () => runMenu(doc, action.name) }, action.label)),
      )
    } else if (ui.pop === 'share') {
      renderShare(doc)
    }
  }

  function runMenu(doc: Handle<typeof Doc>, name: string): void {
    ui.pop = null
    if (name === duplicate.name) client.run(duplicate, doc, {}).then(openDoc, fail)
    else if (name === leave.name) client.run(leave, doc).catch(fail)
    else if (name === trash.name && confirm(`Delete “${doc.title}” for everyone?`)) client.run(trash, doc).catch(fail)
    render()
  }

  function renderShare(doc: Handle<typeof Doc>): void {
    // Share and Link objects exist in this replica only because we are an owner.
    const grants = client.children(doc, Share)
    const links = client.children(doc, Link)
    const candidates = client.all(User).filter(u => u.id !== doc.owner && !grants.some(g => g.agent === u.id))
    const roleSelect = (value: string, onchange: (role: any) => void, roles: readonly string[] = schema.roles) =>
      h('select', { onchange: (event: Event) => onchange((event.target as HTMLSelectElement).value) }, roles.map(role => h('option', { value: role, selected: role === value }, role)))
    const key = ['share', doc.id, doc.access, doc.owner, grants.map(g => [g.id, g.agent, g.role]), links.map(l => [l.id, l.role]), candidates.map(u => u.id)]
    region(pop, key, () => {
      const addWho = h('select', null, candidates.map(u => h('option', { value: u.id }, u.name + (u.kind === 'ai' ? ' (AI)' : ''))))
      const addRole = roleSelect('editor', () => {}, ['viewer', 'editor'])
      const linkRole = roleSelect('viewer', () => {}, ['viewer', 'editor'])
      return [
        h('h3', null, 'Share “', doc.title, '”'),
        h('label', { class: 'field' }, 'General access', h('select', { onchange: (event: Event) => (doc.access = (event.target as HTMLSelectElement).value as typeof doc.access) }, ACCESS.map(([value, label]) => h('option', { value, selected: value === doc.access }, label)))),
        h('h4', null, 'People'),
        h('div', { class: 'grant' }, avatar(person(doc.owner)), h('span', null, person(doc.owner).name), h('em', null, 'owner')),
        grants.map(grant =>
          h(
            'div',
            { class: 'grant' },
            avatar(person(grant.agent)),
            h('span', null, person(grant.agent).name),
            roleSelect(grant.role, role => (grant.role = role)),
            h('button', { class: 'x', 'aria-label': `Remove ${person(grant.agent).name}`, onclick: () => client.remove(grant) }, '×'),
          ),
        ),
        candidates.length > 0 &&
          h('div', { class: 'grant add-grant' }, addWho, addRole, h('button', { onclick: () => client.run(share, doc, { agent: addWho.value, role: addRole.value as 'viewer' }).catch(fail) }, 'Add')),
        h('h4', null, 'Links'),
        h('p', { class: 'fine' }, 'Anyone who opens a link gets its role for as long as the link exists.'),
        links.map(item => {
          const url = `${location.origin}/?doc=${doc.id}&link=${item.token}`
          return h(
            'div',
            { class: 'grant' },
            h('input', { readOnly: true, value: url, 'aria-label': `${item.role} link`, onfocus: (event: Event) => (event.target as HTMLInputElement).select() }),
            h('em', null, item.role),
            h('button', { onclick: () => navigator.clipboard?.writeText(url).then(() => toast('Link copied')) }, 'Copy'),
            h('button', { class: 'x', 'aria-label': 'Revoke link', onclick: () => client.remove(item) }, '×'),
          )
        }),
        h('div', { class: 'grant add-grant' }, h('span', null, 'New link for a'), linkRole, h('button', { onclick: () => client.run(createLink, doc, { role: linkRole.value as 'viewer' }).catch(fail) }, 'Create')),
      ]
    })
  }

  // ───────────────────────────── editor ─────────────────────────────

  function renderNotice(doc: Handle<typeof Doc>): void {
    if (ui.history) return // the history bar owns this element while it is open
    const readOnly = !client.can.create(Block, doc)
    region(notice, ['live', readOnly], () => readOnly && h('p', null, 'You can read this document but not change it.'))
  }

  function renderBlocks(doc: Handle<typeof Doc>): void {
    const list = client.children(doc, Block)
    const known = new Map<string, HTMLElement>()
    for (const el of blocks.children) known.set((el as HTMLElement).dataset.id!, el as HTMLElement)
    const peers = client.peers(doc)
    const active = blocks.contains(document.activeElement) && document.activeElement!.matches('.text') ? (document.activeElement as HTMLElement) : null
    const selection = active && getSelectionIn(active)

    let previous: Element | null = null
    for (const block of list) {
      const el = known.get(block.id) ?? blockElement(block.id)
      known.delete(block.id)
      const wanted: ChildNode | null = previous ? previous.nextSibling : blocks.firstChild
      if (el !== wanted) blocks.insertBefore(el, wanted)
      updateBlock(el, block, peers.filter(peer => peer.state.cursor?.block === block.id).map(peer => peer.agent))
      previous = el
    }
    for (const el of known.values()) el.remove()

    // Moving a focused node blurs it: put the caret back where it was.
    if (active && active.isConnected && document.activeElement !== active && !ui.wantFocus) setCaret(active, selection?.[1] ?? 0)
    const want = ui.wantFocus
    ui.wantFocus = null
    if (want) {
      const text = blocks.querySelector<HTMLElement>(`[data-id="${want.id}"] .text`)
      if (text?.isContentEditable) setCaret(text, want.offset < 0 ? text.textContent!.length : want.offset)
    }
  }

  function blockElement(id: string): HTMLElement {
    const live = () => client.get(Block, id)
    const text = h('div', {
      class: 'text',
      spellcheck: true,
      'data-placeholder': 'Type here. Try “# ”, “- ” or “[] ” at the start',
      oninput: () => onInput(id, text),
      onkeydown: (event: KeyboardEvent) => onKey(event, id, text),
      onpaste: (event: ClipboardEvent) => onPaste(event, id, text),
      oncompositionstart: () => (composing = true),
      oncompositionend: () => ((composing = false), onInput(id, text)),
      onfocus: () => setFocus(id),
      // Wait a moment: a blur caused by re-ordering the list is followed by a refocus.
      onblur: () => setTimeout(() => blocks.contains(document.activeElement) || setFocus(null)),
    })
    return h(
      'div',
      { class: 'block', 'data-id': id },
      h('span', { class: 'dot' }),
      h('span', { class: 'lead' }, h('input', { type: 'checkbox', 'aria-label': 'Done', onchange: (event: Event) => live() && (live()!.done = (event.target as HTMLInputElement).checked) })),
      text,
      h('span', { class: 'flags' }),
      h(
        'span',
        { class: 'side-tools' },
        h('button', { class: 'mark', title: 'Highlight for yourself. Nobody else sees it', onclick: () => live() && (live()!.marked = !live()!.marked) }, '◆'),
        h('select', { class: 'kind', 'aria-label': 'Block type', onchange: (event: Event) => live() && (live()!.kind = (event.target as HTMLSelectElement).value as BlockKind) }, KINDS.map(([value, label]) => h('option', { value }, label))),
      ),
    )
  }

  function updateBlock(el: HTMLElement, block: Handle<typeof Block>, cursors: string[]): void {
    const editable = client.can.write(block, 'text')
    el.className = `block k-${block.kind}${block.marked ? ' marked' : ''}${block.done && block.kind === 'todo' ? ' done' : ''}`

    const text = el.querySelector<HTMLElement>('.text')!
    const mode = editable ? 'plaintext-only' : 'false'
    if (text.getAttribute('contenteditable') !== mode) text.setAttribute('contenteditable', mode)
    const shown = text.textContent ?? ''
    if (shown !== block.text && !(composing && document.activeElement === text)) {
      // Someone else changed the block under us (or the server refused our edit): keep the caret in place.
      const selection = document.activeElement === text ? getSelectionIn(text) : null
      text.textContent = block.text
      if (selection) setCaret(text, shiftCaret(shown, block.text, selection[1]))
    } else if (block.text === '' && text.firstChild && !composing) {
      // Browsers leave a <br> in an emptied editable; clear it so the placeholder shows.
      const wasActive = document.activeElement === text
      text.replaceChildren()
      if (wasActive) setCaret(text, 0)
    }

    const check = el.querySelector<HTMLInputElement>('.lead input')!
    check.checked = block.done
    check.disabled = !editable
    const kind = el.querySelector<HTMLSelectElement>('.kind')!
    if (kind.value !== block.kind) kind.value = block.kind
    kind.disabled = !editable

    // Authorship comes from the log: who created the block, who last wrote its text.
    const meta = (block as any).$meta as Rec['meta']
    const author = meta.f.text?.[0] ?? meta.by
    const dot = el.querySelector<HTMLElement>('.dot')!
    dot.style.setProperty('--c', person(author).color)
    dot.title = `Created by ${person(meta.by).name}. Text last edited by ${person(author).name}${(block as any).$pending ? ' (saving…)' : ''}`

    region(el.querySelector<HTMLElement>('.flags')!, cursors, () =>
      cursors.map(agent => h('span', { class: 'flag', style: `--c:${person(agent).color}` }, person(agent).name)),
    )
  }

  function setFocus(id: string | null): void {
    const doc = client.get(Doc, me.openDoc)
    if (id) focused = id // stays as "last focused" for the inspector
    if (doc) doc.cursor = { block: id, typing: false }
    if (me.inspector) render()
  }

  function onInput(id: string, text: HTMLElement): void {
    const block = client.get(Block, id)
    const doc = client.get(Doc, me.openDoc)
    if (!block || !doc || composing) return
    const value = (text.textContent ?? '').replace(/\n/g, ' ')
    const shortcut = block.kind === 'p' && SHORTCUTS.find(([pattern]) => pattern.test(value))
    if (shortcut) {
      client.tx(() => {
        block.kind = shortcut[1]
        block.text = value.replace(shortcut[0], '')
      })
      ui.wantFocus = { id, offset: 0 }
      render()
    } else {
      block.text = value
    }
    doc.cursor = { block: id, typing: true }
    clearTimeout(typingTimer)
    typingTimer = window.setTimeout(() => doc.$alive && focused === id && (doc.cursor = { block: id, typing: false }), 1200)
  }

  function onKey(event: KeyboardEvent, id: string, text: HTMLElement): void {
    const doc = client.get(Doc, me.openDoc)
    const block = client.get(Block, id)
    if (!doc || !block || composing || event.isComposing) return
    const list = client.children(doc, Block)
    const index = list.findIndex(b => b.id === id)
    const value = text.textContent ?? ''
    const [start, end] = getSelectionIn(text) ?? [value.length, value.length]
    const go = (to: Handle<typeof Block> | undefined, offset: number) => {
      if (!to) return
      event.preventDefault()
      ui.wantFocus = { id: to.id, offset }
      render()
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (!value && block.kind !== 'p') return void (block.kind = 'p') // an empty list item ends the list
      const created = client.tx(() => {
        block.text = value.slice(0, start)
        const kind = block.kind === 'bullet' || block.kind === 'todo' ? block.kind : 'p'
        return client.create(Block, { parent: doc, after: block, kind, text: value.slice(end) })
      })
      go(created, 0)
    } else if (event.key === 'Backspace' && start === 0 && end === 0) {
      event.preventDefault()
      const above = list[index - 1]
      if (block.kind !== 'p') {
        block.kind = 'p'
      } else if (above && client.can.write(above, 'text')) {
        const joinAt = above.text.length
        client.tx(() => {
          above.text += value
          client.remove(block)
        })
        go(above, joinAt)
      }
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // Moving a block is one write to its order key. No other block changes.
      event.preventDefault()
      const up = event.key === 'ArrowUp'
      const over = list[up ? index - 1 : index + 1]
      if (!over) return
      const beyond = list[up ? index - 2 : index + 2]
      block.$pos = up ? between(beyond?.$pos ?? null, over.$pos) : between(over.$pos, beyond?.$pos ?? null)
      ui.wantFocus = { id, offset: start }
      render()
    } else if (event.key === 'ArrowUp' && start === 0 && end === 0) {
      go(list[index - 1], -1)
    } else if (event.key === 'ArrowDown' && start === value.length) {
      go(list[index + 1], 0)
    }
  }

  function onPaste(event: ClipboardEvent, id: string, text: HTMLElement): void {
    const doc = client.get(Doc, me.openDoc)
    const block = client.get(Block, id)
    const pasted = event.clipboardData?.getData('text/plain')
    if (!doc || !block || pasted === undefined) return
    event.preventDefault()
    const lines = pasted.split(/\r?\n/).filter((line, i, all) => line.trim() || all.length === 1)
    if (lines.length === 0) return
    const value = text.textContent ?? ''
    const [start, end] = getSelectionIn(text) ?? [value.length, value.length]
    // One line goes into this block; more lines become more blocks, in one transaction.
    let last: AnyHandle = block
    client.tx(() => {
      block.text = value.slice(0, start) + lines[0] + (lines.length === 1 ? value.slice(end) : '')
      for (const [i, line] of lines.slice(1).entries()) {
        last = client.create(Block, { parent: doc, after: last, kind: block.kind, text: line + (i === lines.length - 2 ? value.slice(end) : '') })
      }
    })
    ui.wantFocus = { id: last.id, offset: lines.length === 1 ? start + lines[0].length : lines[lines.length - 1].length }
    render()
  }

  function appendBlock(): void {
    const doc = client.get(Doc, me.openDoc)
    if (!doc) return
    ui.wantFocus = { id: client.create(Block, { parent: doc }).id, offset: 0 }
    render()
  }

  function focusLast(): void {
    const doc = client.get(Doc, me.openDoc)
    const last = doc && client.children(doc, Block).at(-1)
    if (!last) return
    ui.wantFocus = { id: last.id, offset: -1 }
    render()
  }

  // ───────────────────────────── history ─────────────────────────────

  function toggleHistory(doc: Handle<typeof Doc>): void {
    if (ui.history) {
      ui.history = null
      return render()
    }
    client.history(doc).then(entries => {
      if (entries.length === 0) return toast('This document has no history yet')
      ui.history = { doc: doc.id, entries, at: entries.length }
      const view = ui.history
      const label = h('span', { class: 'when' })
      const describe = () => {
        const entry = view.entries[view.at - 1]
        const counts = { new: 0, set: 0, del: 0 }
        for (const op of entry.ops) counts[op.op]++
        const what = [counts.new && `added ${counts.new}`, counts.set && `edited ${counts.set}`, counts.del && `removed ${counts.del}`].filter(Boolean).join(', ')
        label.textContent = `Change ${view.at} of ${view.entries.length} · ${person(entry.by).name} ${what} · ${new Date(entry.at).toLocaleTimeString()}`
      }
      describe()
      // Built once per opening, so dragging the slider never rebuilds the slider.
      notice.dataset.key = 'history'
      notice.replaceChildren(
        h(
          'div',
          { class: 'scrub' },
          h('input', {
            type: 'range',
            min: 1,
            max: entries.length,
            value: entries.length,
            'aria-label': 'Position in history',
            oninput: (event: Event) => {
              view.at = Number((event.target as HTMLInputElement).value)
              describe()
              render()
            },
          }),
          label,
          h('button', { onclick: () => client.run(duplicate, doc, { upto: view.entries[view.at - 1].seq }).then(openDoc, fail) }, 'Copy from here'),
          h('button', { onclick: () => ((ui.history = null), render()) }, 'Back to now'),
        ),
      )
      render()
    }, fail)
  }

  function renderSnapshot(doc: Handle<typeof Doc>): void {
    const view = ui.history!
    const entry = view.entries[view.at - 1]
    // The past is the same log folded up to an earlier entry, by the same code the server uses.
    region(snapshot, [doc.id, view.at], () => {
      const touched = new Set(entry.ops.map(op => `${doc.id}/${op.id}`))
      return replay(doc.id, view.entries, entry.seq).map(rec => {
        const author = rec.meta.f.text?.[0] ?? rec.meta.by
        return h(
          'div',
          { class: `block k-${rec.fields.kind ?? 'p'}${touched.has(rec.id) ? ' touched' : ''}${rec.fields.done ? ' done' : ''}` },
          h('span', { class: 'dot', style: `--c:${person(author).color}`, title: `Text by ${person(author).name}` }),
          h('span', { class: 'lead' }, h('input', { type: 'checkbox', checked: !!rec.fields.done, disabled: true })),
          h('div', { class: 'text' }, String(rec.fields.text ?? '')),
        )
      })
    })
  }

  // ───────────────────────────── inspector ─────────────────────────────

  function renderInspector(doc: Handle<typeof Doc> | undefined): void {
    inspector.hidden = !me.inspector
    if (!me.inspector) return
    const block = client.get(Block, focused)
    const targets: [string, AnyHandle][] = [['Me', me]]
    if (doc) targets.push(['Document', doc])
    if (block) targets.push(['Focused block', block])

    const rows = targets.map(([label, target]) => {
      const model = shape(schema).find(m => m.name === target.$type)!
      const meta = (target as any).$meta as Rec['meta'] | undefined
      return {
        label,
        id: target.id,
        role: target.$role,
        fields: model.fields.map(field => ({
          ...field,
          value: JSON.stringify((target as any)[field.name]),
          note:
            field.lane === 'row' || field.lane === 'stream'
              ? `${client.can.write(target, field.name) ? 'you can write' : `needs ${field.write}`}${meta?.f[field.name] ? ` · last ${person(meta.f[field.name][0]).name}` : ''}`
              : { pov: 'yours, on every device', session: 'this tab only', local: 'this device only', ether: 'live, never stored' }[field.lane],
        })),
      }
    })
    region(inspector, [rows, ui.wire], () => [
      h('h3', null, 'Inspector'),
      h('p', { class: 'fine' }, 'One object, several lanes. Each field below lives where its declaration in app/schema.ts says.'),
      rows.map(row => [
        h('h4', null, row.label, ' ', h('code', null, row.id), ' ', h('em', null, row.role)),
        h(
          'table',
          null,
          row.fields.map(field =>
            h('tr', null, h('th', null, field.name), h('td', null, h('span', { class: `lane ${field.lane}` }, field.lane)), h('td', { class: 'v', title: field.value }, field.value), h('td', { class: 'n' }, field.note)),
          ),
        ),
      ]),
      h('h4', null, 'Wire'),
      h('p', { class: 'fine' }, 'Session and local writes never appear here. Ether writes do, but are not stored.'),
      h('ol', { class: 'wire' }, ui.wire.map(line => h('li', { class: line.startsWith('→') ? 'out' : 'in' }, line))),
    ])
  }

  function describeWire(direction: 'in' | 'out', msg: ClientMsg | ServerMsg): string {
    const arrow = direction === 'out' ? '→' : '←'
    const typeOf = (id: string) => client.find(id)?.$type ?? (id.includes('/') ? 'Block' : '?')
    switch (msg.t) {
      case 'tx':
        return `${arrow} tx ${msg.ops.map(op => `${op.op} ${typeOf(op.id)}${op.op === 'set' ? '.' + [...Object.keys(op.fields), ...(op.pos ? ['$pos'] : [])].join(',') : ''}`).join('; ')}`
      case 'change':
        return `${arrow} change${msg.by ? ` by ${msg.by}` : ''}: ${[msg.enter?.length && `${msg.enter.length} enter`, msg.leave?.length && `${msg.leave.length} leave`, msg.ops?.length && `${msg.ops.length} set`, msg.pov?.length && `${msg.pov.length} pov`].filter(Boolean).join(', ') || 'in sync'}`
      case 'ether':
        return `${arrow} ether ${msg.agent} ${msg.fields ? JSON.stringify(msg.fields) : 'left'}`
      case 'call':
        return `${arrow} call ${msg.action}`
      case 'nack':
        return `${arrow} nack ${msg.error}`
      case 'result':
        return `${arrow} result ${msg.ok ? 'ok' : msg.error}`
      default:
        return `${arrow} ${msg.t}`
    }
  }
}
