import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { enginesFor } from './engines.ts'
import type { Engine, FetchFn } from './engines.ts'

/**
 * Orbis's specialized search service.
 *
 * The browser's Images, Videos, News, Maps, Music, Science, Files and Social tabs ask this; it asks the engines in
 * src/search-service/engines.ts and answers in the shape src/shared/searchProviders.ts reads. It is Orbis's own code
 * calling open APIs — not SearXNG, which is AGPL and would take its licence with it.
 *
 * It binds to the loopback interface only. Nothing about who is asking is sent anywhere: an engine receives the words
 * and nothing else — no address, no identifier, no history.
 *
 * An engine that fails is named in `unresponsive_engines` rather than swallowed, so the interface can say which source
 * was quiet instead of showing an empty page and leaving somebody to wonder.
 */

const DEFAULT_PORT = 8888
// Openverse and OpenAlex are often slower than eight seconds under load, and an engine
// cut off mid-answer is reported as quiet — which reads as broken rather than slow.
const ENGINE_TIMEOUT_MS = 14_000
const MAX_QUERY = 300

export interface ServiceOptions {
  port?: number
  fetchFn?: FetchFn
  /** Required when set: the same token Orbis sends. Left unset, loopback is the only guard. */
  token?: string
}

export interface RunningService {
  readonly port: number
  close(): Promise<void>
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    // Nothing here is for a web page to read.
    'Cache-Control': 'no-store'
  })
  res.end(text)
}

/** Runs the engines for a category together, keeping whatever answers and naming whatever does not. */
async function gather(engines: Engine[], query: string): Promise<{ results: unknown[]; unresponsive: string[] }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS)
  try {
    const settled = await Promise.allSettled(engines.map((engine) => engine.search(query, controller.signal)))
    const results: unknown[] = []
    const unresponsive: string[] = []
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        results.push(...outcome.value)
      } else {
        unresponsive.push(engines[index].name)
      }
    })
    return { results, unresponsive }
  } finally {
    clearTimeout(timeout)
  }
}

export function createSearchService(options: ServiceOptions = {}): { listen(): Promise<RunningService> } {
  const fetchFn: FetchFn = options.fetchFn ?? ((url, init) => fetch(url, init))

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method !== 'GET') return send(res, 405, { error: 'Only GET.' })

    if (options.token) {
      const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
      if (given !== options.token) return send(res, 401, { error: 'Not for you.' })
    }

    if (url.pathname === '/healthz') return send(res, 200, { ok: true })

    if (url.pathname !== '/search') return send(res, 404, { error: 'No such thing here.' })

    const query = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
    const category = url.searchParams.get('categories') ?? ''
    if (!query) return send(res, 200, { results: [], unresponsive_engines: [] })

    const engines = enginesFor(category, fetchFn)
    if (engines.length === 0) {
      // A category with nothing behind it says so. It does not answer with web results
      // pretending to be pictures, papers or places.
      return send(res, 200, { results: [], unresponsive_engines: [category || 'unknown category'] })
    }

    void gather(engines, query)
      .then(({ results, unresponsive }) => send(res, 200, { results, unresponsive_engines: unresponsive }))
      .catch(() => send(res, 200, { results: [], unresponsive_engines: engines.map((e) => e.name) }))
  })

  return {
    listen: () =>
      new Promise<RunningService>((resolve, reject) => {
        server.once('error', reject)
        // Loopback only. This service is never reachable from the network.
        server.listen(options.port ?? DEFAULT_PORT, '127.0.0.1', () => {
          const address = server.address()
          const port = typeof address === 'object' && address ? address.port : (options.port ?? DEFAULT_PORT)
          resolve({
            port,
            close: () => new Promise<void>((done) => server.close(() => done()))
          })
        })
      })
  }
}

// Started directly: `node --experimental-strip-types src/search-service/server.ts`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  const port = Number(process.env.ORBIS_SEARCH_PORT) || DEFAULT_PORT
  void createSearchService({ port })
    .listen()
    .then((running) => console.log(`Orbis search service on http://127.0.0.1:${running.port}`))
}
