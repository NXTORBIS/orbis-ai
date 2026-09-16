import { PROVIDER_CATEGORY, readOutcome } from '../../shared/searchProviders.ts'
import type { SpecializedCategory, SpecializedOutcome } from '../../shared/searchProviders'

/**
 * Orbis's specialized search provider.
 *
 * Images, videos, news, maps, music, science, files and social media are not web search with a different word tacked
 * on the end: each wants a source that actually holds that kind of thing. They go to an aggregation service Orbis
 * runs, which queries a reviewed set of engines — an image API for images, scholarly APIs for papers, a map service
 * for places — and answers over a JSON API. Orbis never parses its pages.
 *
 * Ordinary web search does not come through here. It stays on its own provider, and the two are deliberately separate:
 * this one can be swapped, or be down, without web search noticing.
 *
 * Nothing about who is asking leaves this machine. A search sends the words and the category, and nothing else.
 */

export interface SpecializedProvider {
  readonly name: string
  search(category: SpecializedCategory, query: string, options?: { signal?: AbortSignal }): Promise<SpecializedOutcome>
  /** Whether it answered recently, so the interface can say a category is unavailable instead of hanging. */
  healthy(): boolean
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface SearxngOptions {
  /** Where Orbis's search service is. Never a public instance: this is infrastructure Orbis runs. */
  endpoint: string
  fetchFn: FetchFn
  /** Sent when the service asks Orbis to identify itself. */
  token?: string
  timeoutMs?: number
  now?: () => number
}

const DEFAULT_TIMEOUT = 9_000
/** After this many refusals in a row the service is treated as down, and asked again only occasionally. */
const FAILURES_BEFORE_RESTING = 3
const REST_MS = 60_000
const MAX_QUERY = 300

export class SearxngProvider implements SpecializedProvider {
  readonly name = 'searxng'
  private readonly o: Required<Pick<SearxngOptions, 'endpoint' | 'fetchFn' | 'timeoutMs' | 'now'>> & { token?: string }
  private failures = 0
  private restingUntil = 0

  constructor(options: SearxngOptions) {
    this.o = {
      endpoint: options.endpoint.replace(/\/+$/, ''),
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
      now: options.now ?? Date.now,
      ...(options.token ? { token: options.token } : {})
    }
  }

  healthy(): boolean {
    return this.o.now() >= this.restingUntil
  }

  /** Whether the service is answering at all, without running a search. */
  async check(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await this.request('/healthz', signal, 3_000)
      const ok = res.ok
      this.record(ok)
      return ok
    } catch {
      this.record(false)
      return false
    }
  }

  async search(category: SpecializedCategory, query: string, options: { signal?: AbortSignal } = {}): Promise<SpecializedOutcome> {
    const words = query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
    const started = this.o.now()
    const nothing = (problem: string): SpecializedOutcome => ({ category, query: words, results: [], unavailable: [], problem, tookMs: this.o.now() - started })

    if (!words) return nothing('Nothing was searched for.')
    // Down a moment ago: say so now rather than making somebody wait to be told.
    if (!this.healthy()) return nothing('Specialized search is unavailable at the moment. Web search still works.')

    const params = new URLSearchParams({ q: words, categories: PROVIDER_CATEGORY[category], format: 'json', safesearch: '1' })
    try {
      const res = await this.request(`/search?${params.toString()}`, options.signal)
      if (!res.ok) {
        this.record(false)
        // Being asked to slow down is not the same as being broken, and is worth saying plainly.
        return nothing(res.status === 429 ? 'Too many searches at once. Try again in a moment.' : `Specialized search answered with ${res.status}.`)
      }
      const payload: unknown = await res.json()
      this.record(true)
      return readOutcome(payload, category, words, this.o.now() - started)
    } catch (err) {
      if (options.signal?.aborted) return nothing('The search was stopped.')
      this.record(false)
      const why = err instanceof Error && err.name === 'TimeoutError' ? 'took too long to answer' : 'could not be reached'
      return nothing(`Specialized search ${why}. Web search still works.`)
    }
  }

  private request(path: string, signal?: AbortSignal, timeoutMs = this.o.timeoutMs): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs)
    return this.o.fetchFn(`${this.o.endpoint}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(this.o.token ? { Authorization: `Bearer ${this.o.token}` } : {})
      },
      // The caller's abort and the timeout both end the request.
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'follow'
    })
  }

  /** One category failing must not take the rest down with it, and a service that is down is rested rather than hammered. */
  private record(ok: boolean): void {
    if (ok) {
      this.failures = 0
      this.restingUntil = 0
      return
    }
    this.failures += 1
    if (this.failures >= FAILURES_BEFORE_RESTING) this.restingUntil = this.o.now() + REST_MS
  }
}

/**
 * Where Orbis's specialized search lives.
 *
 * A developer running the service locally points at it with ORBIS_SEARCH_ENDPOINT; a built Orbis uses the service
 * Orbis operates. Nobody using Orbis has to obtain a key for any of this: the engines are configured on the service,
 * not in the app.
 */
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8888'

export function endpointFromEnvironment(env: Record<string, string | undefined> = process.env): string {
  const set = env.ORBIS_SEARCH_ENDPOINT?.trim()
  return set && /^https?:\/\//i.test(set) ? set.replace(/\/+$/, '') : DEFAULT_ENDPOINT
}
