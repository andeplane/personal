import type { Transport } from '../core/protocol.ts'

/** A browser WebSocket as a transport. Messages sent before it opens are queued. */
export function wsTransport(url: string): Transport {
  const socket = new WebSocket(url)
  const queue: string[] = []
  socket.addEventListener('open', () => {
    for (const data of queue.splice(0)) socket.send(data)
  })
  return {
    send(msg) {
      const data = JSON.stringify(msg)
      if (socket.readyState === WebSocket.OPEN) socket.send(data)
      else if (socket.readyState === WebSocket.CONNECTING) queue.push(data)
    },
    onMessage: cb => socket.addEventListener('message', event => cb(JSON.parse(event.data))),
    onClose: cb => socket.addEventListener('close', () => cb()),
    close: () => socket.close(),
  }
}
