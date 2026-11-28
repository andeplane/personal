// Browser test of the docs demo: real server, real WebSockets, three people.
//
//   npm run e2e                 needs the `playwright` package and a Chromium for it
//   SHOTS=some/dir npm run e2e  also writes screenshots there
//
// It starts its own server on a spare port with a throwaway data folder.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = 4800 + Math.floor(Math.random() * 400)
const base = `http://127.0.0.1:${port}`
const data = mkdtempSync(join(tmpdir(), 'lanes-e2e-'))
const shots = process.env.SHOTS

const server = spawn(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'app/server.ts')], {
  env: { ...process.env, PORT: String(port), LANES_DATA: data },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => String(chunk).includes('Lanes docs demo') && resolve())
  server.on('exit', code => reject(new Error(`server exited with ${code}`)))
})

const browser = await chromium.launch()
const steps = []
const step = async (name, fn) => {
  await fn()
  steps.push(name)
  console.log(`ok - ${name}`)
}

try {
  const open = async (who, extra = '') => {
    const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: Number(process.env.SCALE ?? (shots ? 2 : 1)) })
    const page = await context.newPage()
    page.on('pageerror', error => {
      throw error
    })
    await page.goto(`${base}/?as=${who}${extra}`)
    await page.waitForSelector('.side nav')
    return page
  }
  const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${name}.png`) })
  const blockTexts = page => page.locator('.blocks:not(.snapshot) .block .text').allTextContents()
  const openDoc = (page, title) => page.locator('.doc .open').filter({ has: page.locator(`.t:text-is("${title}")`) }).click()

  const ada = await open('ada')
  const linus = await open('linus')

  await step('both people see the shared welcome document and its blocks', async () => {
    await openDoc(ada, 'Welcome to Lanes')
    await openDoc(linus, 'Welcome to Lanes')
    await ada.waitForSelector('.block.k-h1')
    assert.equal((await blockTexts(linus))[0], 'One graph, six lanes')
    assert.equal(await ada.locator('.role').textContent(), 'owner')
    assert.equal(await linus.locator('.role').textContent(), 'editor')
  })

  await step('typing appears in the other window, with a cursor flag', async () => {
    await ada.locator('.add').click()
    await ada.keyboard.type('Hello from Ada')
    await linus.waitForSelector('.block .text:text-is("Hello from Ada")')
    await linus.waitForSelector('.block:has(.text:text-is("Hello from Ada")) .flag:text-is("Ada")')
    assert.equal(await linus.locator('.presence .avatar').count(), 1)
  })

  await step('Enter splits a block and a markdown prefix changes its type', async () => {
    await linus.locator('.block .text:text-is("Hello from Ada")').click()
    await linus.keyboard.press('End')
    await linus.keyboard.press('Enter')
    await linus.keyboard.type('# And Linus')
    await ada.waitForSelector('.block.k-h1 .text:text-is("And Linus")')
    const texts = await blockTexts(ada)
    assert.deepEqual(texts.slice(-2), ['Hello from Ada', 'And Linus'])
  })

  await step('two people typing in different blocks do not disturb each other', async () => {
    await ada.locator('.block .text:text-is("Hello from Ada")').click()
    await ada.keyboard.press('End')
    await Promise.all([ada.keyboard.type(', still typing here', { delay: 8 }), linus.keyboard.type(' was here too', { delay: 8 })])
    await ada.waitForSelector('.block .text:text-is("And Linus was here too")')
    await linus.waitForSelector('.block .text:text-is("Hello from Ada, still typing here")')
  })

  await step('a star is per person and follows that person to another tab', async () => {
    await ada.locator('.doc .star').first().click()
    await ada.waitForSelector('.doc .star.on')
    const adaTab2 = await open('ada')
    await adaTab2.waitForSelector('.doc .star.on')
    assert.equal(await linus.locator('.doc .star.on').count(), 0)
    await adaTab2.context().close()
  })

  await step('a new document is private until shared, then appears live', async () => {
    await ada.locator('button.primary').click()
    await ada.locator('.title').fill('Private plan')
    await ada.locator('.block .text').first().click()
    await ada.keyboard.type('Ship the editor first. Then sharing.')
    await ada.keyboard.press('Enter')
    await ada.keyboard.type('[] Write the launch note')
    await ada.waitForSelector('.block.k-todo')
    assert.equal(await linus.locator('.doc .open', { hasText: 'Private plan' }).count(), 0)

    await ada.locator('.tools button', { hasText: 'Share' }).click()
    await ada.locator('.add-grant select').first().selectOption('linus')
    await ada.locator('.add-grant select').nth(1).selectOption('viewer')
    await ada.locator('.add-grant button', { hasText: 'Add' }).click()
    await linus.waitForSelector('.doc .open:has-text("Private plan")')
    await shot(ada, 'share')
  })

  await step('a viewer can read but not edit; promoting them takes effect live', async () => {
    await openDoc(linus, 'Private plan')
    await linus.waitForSelector('.block .text:text-is("Write the launch note")')
    assert.equal(await linus.locator('.role').textContent(), 'viewer')
    assert.equal(await linus.locator('.block .text').first().getAttribute('contenteditable'), 'false')
    assert.match(await linus.locator('.notice').textContent(), /read this document but not change it/)
    assert.equal(await linus.locator('.tools button', { hasText: 'Share' }).count(), 0)

    await ada.locator('.grant:has-text("Linus") select').selectOption('editor')
    await linus.waitForSelector('.role:text-is("editor")')
    assert.equal(await linus.locator('.block .text').first().getAttribute('contenteditable'), 'plaintext-only')
    await ada.keyboard.press('Escape')
  })

  await step('Q joins as a participant and its text streams into both windows', async () => {
    await ada.locator('.tools button', { hasText: 'Ask Q' }).click()
    await ada.locator('.pop .row', { hasText: 'Summarize' }).click()
    await linus.waitForSelector('.block.k-h2 .text:text-is("Summary")')
    await linus.waitForSelector('.block.k-bullet .text:text-is("Ship the editor first.")')
    const dot = linus.locator('.block.k-bullet .dot')
    assert.match(await dot.getAttribute('title'), /Created by Q/)
  })

  await step('history replays the log and an earlier point can be copied', async () => {
    await ada.locator('.tools button', { hasText: 'History' }).click()
    await ada.waitForSelector('.scrub input')
    const total = Number(await ada.locator('.scrub input').getAttribute('max'))
    assert.ok(total > 10, `expected a real history, got ${total} entries`)
    await ada.locator('.scrub input').fill('3')
    await ada.waitForSelector('.snapshot .block')
    assert.ok((await ada.locator('.snapshot .block').count()) < 5)
    await shot(ada, 'history')
    await ada.locator('.scrub button', { hasText: 'Copy from here' }).click()
    await ada.waitForFunction(() => document.querySelector('.title')?.value === 'Copy of Private plan')
    await ada.waitForSelector('.blocks:not(.snapshot) .block')
    assert.ok((await blockTexts(ada)).length < 5)
    assert.equal(await linus.locator('.doc .open', { hasText: 'Copy of' }).count(), 0)
  })

  await step('a share link gives its role to whoever opens it, until revoked', async () => {
    await openDoc(ada, 'Private plan')
    await ada.locator('.tools button', { hasText: 'Share' }).click()
    await ada.locator('.add-grant button', { hasText: 'Create' }).click()
    const url = await ada.locator('.grant input').inputValue()
    const grace = await open('grace', '&' + url.split('?')[1])
    await grace.waitForSelector('.block.k-h2 .text:text-is("Summary")')
    assert.equal(await grace.locator('.role').textContent(), 'viewer')

    await ada.locator('.grant:has(input) .x').click()
    await grace.waitForSelector('.empty h2:text-is("This document is not available")')
    await grace.context().close()
  })

  await step('removing a grant removes the document from the other window', async () => {
    await ada.locator('.grant:has-text("Linus") .x').click()
    await linus.waitForSelector('.empty h2:text-is("This document is not available")')
    assert.equal(await linus.locator('.doc .open', { hasText: 'Private plan' }).count(), 0)
    await ada.keyboard.press('Escape')
  })

  await step('the inspector shows each field with its lane', async () => {
    await openDoc(ada, 'Welcome to Lanes')
    await openDoc(linus, 'Welcome to Lanes')
    await ada.locator('.tools button', { hasText: 'Inspector' }).click()
    await ada.locator('.block .text:text-is("Hello from Ada, still typing here")').click()
    await linus.locator('.block .text:text-is("And Linus was here too")').click()
    await ada.locator('.block:has(.text:has-text("Star this document")) .mark').click({ force: true })
    await ada.waitForSelector('.block.marked')
    await ada.waitForSelector('.inspector .lane.stream')
    const lanes = await ada.locator('.inspector .lane').allTextContents()
    for (const lane of ['row', 'stream', 'pov', 'session', 'local', 'ether']) assert.ok(lanes.includes(lane), `missing ${lane}`)
    assert.equal(await linus.locator('.block.marked').count(), 0, 'a highlight is private')
    await ada.waitForSelector('.block .flag:text-is("Linus")')
    await shot(ada, 'editor')
  })

  console.log(`\n${steps.length} browser steps passed`)
} finally {
  await browser.close()
  const exited = new Promise(resolve => server.on('exit', resolve))
  server.kill()
  await exited
  rmSync(data, { recursive: true, force: true })
}
