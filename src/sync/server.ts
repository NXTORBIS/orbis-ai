import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { CONTENTS, COMMIT_RESULT, ERROR, readRequest, writeCommitResponse, writeError, writeGetUpdatesResponse } from './protocol.ts'
import { SyncStore } from './store.ts'

/**
 * A sync server for the Orbis browser.
 *
 * Chromium's sync engine is built in and its server is redirectable (--sync-url), so sync that is not Google's is this:
 * a server that speaks the same protocol. The browser sends one POST per sync cycle, either a commit or a request for
 * what changed, and this answers it from a store of its own.
 *
 * Who the account is, is deliberately not decided here. The browser sends whatever bearer token its identity gave it,
 * and `resolveAccount` turns that into an account id — a Google token verified upstream, an Orbis account, or one fixed
 * token for a single person's own machine. The protocol and the store are the same underneath all three, so that
 * decision can be made later without any of this changing.
 */

export interface SyncServerOptions {
  /** Where accounts are kept. */
  dir: string
  /**
   * The account this bearer token belongs to, or null to refuse. Called on every request: a token that has expired or
   * been withdrawn stops working on the next sync cycle rather than at some cached interval.
   */
  resolveAccount(token: string): Promise<string | null> | string | null
  /** Loopback only by default: a sync server reachable from the network is an account's whole history reachable from the network. */
  host?: string
  port?: number
  /** One response's worth of entities; the rest is reported as remaining and fetched by the next request. */
  batch?: number
  maxBodyBytes?: number
}

const MAX_BODY = 32 * 1024 * 1024

async function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) return null
    chunks.push(chunk as Buffer)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

const bearer = (req: IncomingMessage): string => {
  const header = req.headers.authorization ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)
  return m ? m[1].trim() : ''
}

export interface RunningSyncServer {
  port: number
  url: string
  store: SyncStore
  close(): Promise<void>
}

export function createSyncServer(options: SyncServerOptions): { listen(): Promise<RunningSyncServer>; server: Server } {
  const store = new SyncStore(options.dir)
  const batch = options.batch ?? 500
  const limit = options.maxBodyBytes ?? MAX_BODY

  const send = (res: ServerResponse, status: number, body: Uint8Array): void => {
    res.writeHead(status, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      // Nothing here is for a browser page to read, and saying so costs one header.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(Buffer.from(body))
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        // The sync engine posts to /command/; anything else is not this protocol.
        const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '')
        if (req.method !== 'POST' || (path !== '/command' && path !== '')) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          return void res.end('Not found.')
        }

        const token = bearer(req)
        const account = token ? await options.resolveAccount(token) : null
        if (!account) {
          // 401 is what the engine understands as "get a new token and try again".
          res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer' })
          return void res.end('Unauthorized.')
        }

        const body = await readBody(req, limit)
        if (!body) return send(res, 413, writeError(ERROR.TRANSIENT_ERROR, 'That was too large to take at once.'))

        let request
        try {
          request = readRequest(body)
        } catch {
          return send(res, 400, writeError(ERROR.TRANSIENT_ERROR, 'That was not a sync request.'))
        }

        const birthday = await store.birthday(account)
        // A client quoting an older birthday is quoting versions from data that no longer exists. Telling it so is what
        // makes it drop its local sync state instead of writing on top of a stranger's numbering.
        if (request.storeBirthday && request.storeBirthday !== birthday) {
          return send(res, 200, writeError(ERROR.NOT_MY_BIRTHDAY, 'This account was reset.', birthday))
        }

        if (request.contents === CONTENTS.COMMIT) {
          const outcomes = await store.commit(account, request.entries)
          return send(
            res,
            200,
            writeCommitResponse(
              birthday,
              outcomes.map((o) => ({
                idString: o.idString,
                version: o.version,
                responseType: o.conflict ? COMMIT_RESULT.CONFLICT : COMMIT_RESULT.SUCCESS,
                ...(o.conflict ? { errorMessage: o.conflict } : {})
              }))
            )
          )
        }

        if (request.contents === CONTENTS.GET_UPDATES) {
          const updates = await store.updatesSince(account, request.markers, batch)
          return send(res, 200, writeGetUpdatesResponse(birthday, updates.entries, updates.markers, updates.remaining))
        }

        if (request.contents === CONTENTS.CLEAR_SERVER_DATA) {
          const fresh = await store.clear(account)
          return send(res, 200, writeError(ERROR.SUCCESS, '', fresh))
        }

        return send(res, 200, writeError(ERROR.TRANSIENT_ERROR, 'That request is not one this server answers.', birthday))
      } catch {
        // Nothing of what went wrong goes back over the wire: an error here is about an account's data.
        if (!res.headersSent) send(res, 500, writeError(ERROR.TRANSIENT_ERROR, 'The sync server could not answer that.'))
        else res.end()
      }
    })()
  })

  return {
    server,
    listen: () =>
      new Promise<RunningSyncServer>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
          const address = server.address()
          const port = typeof address === 'object' && address ? address.port : 0
          resolve({
            port,
            url: `http://${options.host ?? '127.0.0.1'}:${port}/command/`,
            store,
            close: () => new Promise<void>((done) => server.close(() => done()))
          })
        })
      })
  }
}
