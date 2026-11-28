/**
 * Order keys. Siblings sort by `pos` (plain string comparison), so inserting
 * between two objects never rewrites the others: you pick a key between theirs.
 *
 * Keys are base-62 fractions with no trailing "0", so there is always room
 * below any key. Appending and prepending step by one digit instead of
 * bisecting, which keeps keys short for the common case of typing downwards.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const MID = 'V'
const LAST = DIGITS[DIGITS.length - 1]

export const POS = /^[0-9A-Za-z]{1,128}$/

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA] + midpoint(a.slice(1), null)
}

/** A key strictly between `a` and `b`. Null means "no neighbour on that side". */
export function between(a: string | null, b: string | null): string {
  if (!a && !b) return MID
  if (!b) {
    const last = a![a!.length - 1]
    return last === LAST ? a + MID : a!.slice(0, -1) + DIGITS[DIGITS.indexOf(last) + 1]
  }
  if (!a) {
    const last = b[b.length - 1]
    const head = b.slice(0, -1)
    return last === '1' ? head + '0' + MID : head + DIGITS[DIGITS.indexOf(last) - 1]
  }
  // Two writers can pick the same key at the same time; ids break the tie when
  // sorting, and the next insert between them lands just after both.
  if (a >= b) return a + MID
  return midpoint(a, b)
}

/** The key for a new sibling: after `after`, else before `before`, else at the end. */
export function place(
  siblings: { id: string; pos: string }[],
  after?: string | null,
  before?: string | null,
): string {
  if (after) {
    const i = siblings.findIndex(s => s.id === after)
    if (i >= 0) return between(siblings[i].pos, siblings[i + 1]?.pos ?? null)
  }
  if (before) {
    const i = siblings.findIndex(s => s.id === before)
    if (i >= 0) return between(siblings[i - 1]?.pos ?? null, siblings[i].pos)
  }
  return between(siblings[siblings.length - 1]?.pos ?? null, null)
}
