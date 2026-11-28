import { Client, memoryKV, type ClientOptions, type Rejection } from '../src/client/client.ts'
import { Server } from '../src/server/server.ts'
import { MemoryStorage, type Storage } from '../src/server/storage.ts'
import { schema, User } from '../app/schema.ts'

/** Let every queued message and microtask run. */
export const tick = () => new Promise<void>(resolve => setImmediate(resolve))

export function boot(storage: Storage = new MemoryStorage(), services: Record<string, any> = {}) {
  const server = new Server({
    schema,
    storage,
    services,
    authenticate: auth => (auth as { user?: string })?.user ?? null,
  })
  if (server.graph.size === 0) {
    server.transact(
      'system',
      ctx => {
        ctx.create(User, { id: 'ada', name: 'Ada', kind: 'human' })
        ctx.create(User, { id: 'linus', name: 'Linus', kind: 'human' })
        ctx.create(User, { id: 'grace', name: 'Grace', kind: 'human' })
        ctx.create(User, { id: 'q', name: 'Q', kind: 'ai' })
      },
      { sudo: true },
    )
  }
  const join = async (user: string, opts: Partial<ClientOptions> = {}) => {
    const client = new Client({
      schema,
      connect: () => server.connectLocal(),
      auth: { user },
      session: memoryKV(),
      local: memoryKV(),
      ...opts,
    })
    await client.ready()
    return client
  }
  return { server, storage, join }
}

/** Collect the server's refusals so a test can assert on them. */
export function rejections(client: Client): Rejection[] {
  const seen: Rejection[] = []
  client.on('rejected', rejection => seen.push(rejection))
  return seen
}

/** Send operations without the client's own checks, as a modified client could. */
export function forge(client: Client, ops: unknown[]): void {
  ;(client as any).sendRaw({ t: 'tx', n: 900000 + Math.floor(Math.random() * 99999), ops })
}
