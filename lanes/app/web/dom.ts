/** The few DOM helpers the demo needs. No framework: the library is the subject here. */

export type Child = Node | string | number | false | null | undefined | Child[]

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (Array.isArray(child)) append(el, child)
    else if (child !== false && child !== null && child !== undefined) el.append(typeof child === 'number' ? String(child) : child)
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === false || value === null || value === undefined) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value as EventListener)
    else if (key === 'class') el.className = String(value)
    else if (key === 'style') el.style.cssText = String(value)
    else if (key in el) (el as any)[key] = value
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  append(el, children)
  return el
}

/**
 * Rebuild a region only when the data it shows has changed. Without this, a
 * collaborator typing would replace buttons under your pointer mid-click.
 */
export function region(el: HTMLElement, key: unknown, build: () => Child): void {
  const signature = JSON.stringify(key)
  if (el.dataset.key === signature) return
  el.dataset.key = signature
  el.replaceChildren()
  append(el, [build()])
}

/** Selection inside `el` as character offsets, or null if the selection is elsewhere. */
export function getSelectionIn(el: HTMLElement): [start: number, end: number] | null {
  const selection = getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null
  const before = document.createRange()
  before.selectNodeContents(el)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  return [start, start + range.toString().length]
}

export function setCaret(el: HTMLElement, offset: number): void {
  el.focus()
  const selection = getSelection()!
  const range = document.createRange()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent!.length
    if (left <= length) {
      range.setStart(node, left)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    left -= length
  }
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Where a caret at `caret` in `before` should sit once the text has become `after`. */
export function shiftCaret(before: string, after: string, caret: number): number {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  if (caret <= prefix) return caret
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  if (caret >= before.length - suffix) return caret + after.length - before.length
  return after.length - suffix
}
