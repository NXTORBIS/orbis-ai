import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { checkPreflight, checkRequest } from './auth.ts'
import type { AuthConfig } from './auth.ts'

/**
 * The Orbis helper's server: the local side of what `ipcMain` and `window.api` were in Electron.
 *
 * The panel sends `POST /rpc` with `{ channel, args }`; the reply is one JSON object per line — any number of
 * `{ "event": … }` lines as the handler produces them (a chat answer streaming in), then exactly one
 * `{ "result": … }` or `{ "error": … }`. Plain HTTP with a streamed body, so it needs no library and the panel can
 * use ordinary `fetch`. If the panel goes away (the Stop button, a closed tab), the handler is told and can stop.
 *
 * It listens on 127.0.0.1 only, and every request has to pass auth.ts first.
 */

export interface HandlerContext {
  /** Sends one event to the panel as it happens. */
  emit(event: unknown): void
  /** Aborted when the panel disconnects or asks to stop. */
  signal: AbortSignal
}

export type Handler = (args: unknown[], context: HandlerContext) => Promise<unknown> | unknown

/** A failure the panel should be told about in words, with a code it can act on. */
export class HelperError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'HelperError'
    this.code = code
  }
}

export interface HelperServerOptions {
  token: string
  allowedOrigins: string[]
  handlers: Record<string, Handler>
  /** 0 picks a free port, which is what a real run wants. */
  port?: number
  /** Nothing the panel sends is anywhere near this big; a body past it is refused unread. */
  maxBodyBytes?: number
}

const MAX_BODY = 8 * 1024 * 1024

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | 'too-big'> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > limit) return 'too-big'
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function refuse(response: ServerResponse, status: number, message: string, cors?: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...(cors ? { 'Access-Control-Allow-Origin': cors, Vary: 'Origin' } : {}) })
  response.end(JSON.stringify({ error: { code: `http-${status}`, message } }))
}

export function createHelperServer(options: HelperServerOptions): { listen(): Promise<{ port: number }>; close(): Promise<void> } {
  const limit = options.maxBodyBytes ?? MAX_BODY
  let server: Server | null = null
  let port = 0

  const config = (): AuthConfig => ({ token: options.token, port, allowedOrigins: options.allowedOrigins })

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const facts = { method: request.method ?? '', path: (request.url ?? '').split('?')[0], headers: request.headers }
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    // Only an allowed origin is ever echoed back; a page that is not on the list gets no CORS header at all.
    const cors = origin && options.allowedOrigins.includes(origin) ? origin : undefined

    if (facts.method === 'OPTIONS') {
      const preflight = checkPreflight(facts, config())
      if (!preflight.ok) return refuse(response, preflight.status, preflight.message)
      response.writeHead(204, {
        'Access-Control-Allow-Origin': cors ?? '',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      })
      return void response.end()
    }

    const verdict = checkRequest(facts, config())
    if (!verdict.ok) return refuse(response, verdict.status, verdict.message, cors)

    const body = await readBody(request, limit)
    if (body === 'too-big') return refuse(response, 413, 'That is too large.', cors)

    let call: { channel?: unknown; args?: unknown }
    try {
      call = JSON.parse(body.toString('utf8')) as typeof call
    } catch {
      return refuse(response, 400, 'The request was not valid JSON.', cors)
    }
    if (typeof call.channel !== 'string' || (call.args !== undefined && !Array.isArray(call.args))) return refuse(response, 400, 'Expected { channel, args }.', cors)
    // Own property only: `constructor` and `__proto__` are not channels.
    const handler = Object.prototype.hasOwnProperty.call(options.handlers, call.channel) ? options.handlers[call.channel] : undefined
    if (!handler) return refuse(response, 404, 'No such channel.', cors)

    const controller = new AbortController()
    // A response that closes before it finished means the panel went away.
    response.on('close', () => {
      if (!response.writableFinished) controller.abort()
    })
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', ...(cors ? { 'Access-Control-Allow-Origin': cors, Vary: 'Origin' } : {}) })
    const line = (value: unknown): void => void (!response.destroyed && response.write(`${JSON.stringify(value)}\n`))

    try {
      const result = await handler((call.args as unknown[] | undefined) ?? [], { emit: (event) => line({ event }), signal: controller.signal })
      line({ result: result === undefined ? null : result })
    } catch (err) {
      const known = err instanceof HelperError
      // Only a HelperError's words go back; anything else is a bug in the helper, and its detail stays here.
      line({ error: { code: known ? err.code : 'helper-error', message: known ? err.message : 'The helper could not do that.' } })
    }
    response.end()
  }

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server = createServer((request, response) => {
          handle(request, response).catch(() => {
            if (!response.headersSent) refuse(response, 500, 'The helper could not do that.')
            else response.end()
          })
        })
        server.once('error', reject)
        // 127.0.0.1 and nothing else: never reachable from another computer on the network.
        server.listen(options.port ?? 0, '127.0.0.1', () => {
          port = (server!.address() as { port: number }).port
          resolve({ port })
        })
      }),
    close: () =>
      new Promise((resolve) => {
        if (!server) return resolve()
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}
