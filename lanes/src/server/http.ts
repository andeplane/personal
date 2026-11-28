/** Serve the graph over WebSocket next to an ordinary HTTP handler. */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Transport } from '../core/protocol.ts'
import type { Server } from './server.ts'

function socketTransport(socket: WebSocket): Transport {
  return {
    send: msg => socket.readyState === socket.OPEN && socket.send(JSON.stringify(msg)),
    onMessage: cb =>
      socket.on('message', data => {
        let msg: unknown
        try {
          msg = JSON.parse(String(data))
        } catch {
          return socket.close()
        }
        cb(msg)
      }),
    onClose: cb => socket.on('close', cb),
    close: () => socket.close(),
  }
}

export interface ListenOptions {
  port: number
  host?: string
  /** WebSocket path. Everything else goes to `handler`. */
  path?: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

export function listen(server: Server, opts: ListenOptions): Promise<HttpServer> {
  const http = createServer(opts.handler)
  const sockets = new WebSocketServer({ server: http, path: opts.path ?? '/ws', maxPayload: 1 << 20 })
  sockets.on('connection', socket => server.accept(socketTransport(socket)))
  return new Promise(resolve => http.listen(opts.port, opts.host ?? '127.0.0.1', () => resolve(http)))
}
