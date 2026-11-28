/** Wire messages. JSON over any ordered, reliable transport. */

import type { ErrorCode, Fields } from './schema.ts'
import type { Meta, Op, SetOp } from './graph.ts'

/** One connection's ether-lane values on an object. Null means the peer left. */
export interface PeerState {
  conn: string
  agent: string
  fields: Fields | null
}

/** An object as one particular connection is allowed to see it. */
export interface Hydrated {
  id: string
  type: string
  parent: string | null
  pos: string
  /** The receiving agent's role, computed by the server. Clients never recompute it. */
  role: string
  /** Shared fields this role may read. */
  fields: Fields
  /** The receiving agent's own pov-lane values. */
  pov?: Fields
  meta: Meta
  /** Ether-lane values of other connections currently on this object. */
  ether?: PeerState[]
}

export type ClientMsg =
  | { t: 'hello'; auth: unknown; tokens: string[]; client: string }
  /** An atomic transaction. `n` is the client's own counter, used to match the reply. */
  | { t: 'tx'; n: number; ops: Op[] }
  | { t: 'open'; n: number; root: string }
  | { t: 'close'; root: string }
  | { t: 'call'; n: number; action: string; target: string; input: Fields }
  | { t: 'history'; n: number; root: string }
  /** Present a value-proof (for example a share-link token). */
  | { t: 'proof'; token: string }

export type ServerMsg =
  | { t: 'welcome'; agent: string; conn: string }
  | {
      t: 'change'
      /** Drop everything confirmed so far; `enter` is the complete visible set. */
      reset?: boolean
      by?: string
      at?: number
      /** Objects that became visible, or whose role changed. Replaces any earlier copy. */
      enter?: Hydrated[]
      /** Objects that are deleted or no longer visible. */
      leave?: string[]
      /** Field changes on objects the connection already holds. */
      ops?: SetOp[]
      /** Changes to the agent's own pov-lane values, made on another connection. */
      pov?: { id: string; fields: Fields }[]
    }
  | ({ t: 'ether'; id: string } & PeerState)
  | { t: 'ack'; n: number }
  | { t: 'nack'; n: number; code: ErrorCode; error: string }
  | { t: 'result'; n: number; ok: true; value: unknown }
  | { t: 'result'; n: number; ok: false; code: ErrorCode; error: string }
  | { t: 'fatal'; error: string }

export interface Transport {
  send(msg: unknown): void
  onMessage(cb: (msg: any) => void): void
  onClose(cb: () => void): void
  close(): void
}

/**
 * Two connected in-process transports. Delivery is asynchronous and messages
 * are copied, so code on either end behaves as it would across a network.
 */
export function memoryPair(): [Transport, Transport] {
  interface End {
    onMessage?: (msg: any) => void
    onClose?: () => void
    inbox: string[]
  }
  const ends: End[] = [{ inbox: [] }, { inbox: [] }]
  let closed = false
  const drain = (i: number) => {
    const end = ends[i]
    while (!closed && end.onMessage && end.inbox.length > 0) end.onMessage(JSON.parse(end.inbox.shift()!))
  }
  const make = (i: number): Transport => ({
    send(msg) {
      if (closed) return
      ends[1 - i].inbox.push(JSON.stringify(msg))
      queueMicrotask(() => drain(1 - i))
    },
    onMessage(cb) {
      ends[i].onMessage = cb
      queueMicrotask(() => drain(i))
    },
    onClose(cb) {
      ends[i].onClose = cb
    },
    close() {
      if (closed) return
      closed = true
      queueMicrotask(() => {
        ends[0].onClose?.()
        ends[1].onClose?.()
      })
    },
  })
  return [make(0), make(1)]
}
