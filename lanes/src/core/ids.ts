const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** A random lowercase id segment. Also used for share-link tokens, at a longer length. */
export function rid(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}

/** Row objects get `<model>_<random>`; stream objects get `<root>/<random>`. */
export function newId(model: { name: string; home: 'row' | 'stream' }, parentId: string | null): string {
  if (model.home === 'row') return `${model.name.toLowerCase()}_${rid()}`
  const slash = parentId!.indexOf('/')
  return `${slash < 0 ? parentId : parentId!.slice(0, slash)}/${rid()}`
}
