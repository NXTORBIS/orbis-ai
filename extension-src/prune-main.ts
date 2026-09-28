import { pruneValue, ruleForHost, matchesSignature } from '../src/shared/adblockPrune.ts'
import type { PruneRule } from '../src/shared/adblockPrune.ts'

/**
 * The response-pruning layer, running in the page's own world.
 *
 * Why it has to be here and not in Orbis's ordinary content script: an extension content script runs *isolated*. Its
 * `window` is not the page's `window` and its `JSON.parse` is not the page's `JSON.parse`, so it can neither see
 * `ytInitialPlayerResponse` nor intercept the parse that turns a player response into an object. That isolation is
 * exactly why the existing content script -- which does the element hiding -- could never have blocked a video
 * advertisement, and why this is a second, deliberately tiny script rather than more code in that one.
 *
 * What it does is entirely described by the rules in src/shared/adblockPrune.ts. This file is the mechanism: four
 * places to stand, and nothing site-specific anywhere in it.
 *
 * Every interception fails open. If a response is not JSON, or is a stream, or anything at all goes wrong, the real
 * response is returned untouched. Failing open costs an advertisement; failing closed costs the video, and the video
 * is what somebody came for.
 */

const rule: PruneRule | null = ruleForHost(location.hostname)

/**
 * The page's own `JSON.parse`, captured before this file replaces it.
 *
 * This matters more than it looks. The fetch and XHR guards below parse a *copy* of a response to decide whether to
 * rewrite it. If they used the patched `JSON.parse`, that parse would prune the copy -- and the guard would then find
 * nothing left to remove, conclude there was nothing to do, and hand the page back the original, unpruned response.
 *
 * That is not hypothetical: it is what happened. The trace read `fetch: nothing to prune .../youtubei/v1/player`
 * while advertisements played, because the pruning had been spent on a throwaway object. Every internal parse uses
 * this one.
 */
const rawParse = JSON.parse

/** Counted only when a field was really removed, so the number means what it says. */
let pruned = 0
/**
 * A bounded record of what this layer saw and decided, for diagnosing why an advertisement got through (§52, §55).
 *
 * Development diagnosis only: it holds endpoint paths and field names, never page content, never a query string.
 */
const trace: { at: number; what: string; url: string; fields: string[] }[] = []
const note = (what: string, url: string, fields: string[] = []): void => {
  try {
    trace.push({ at: Date.now(), what, url: String(url).split('?')[0].slice(-80), fields })
    if (trace.length > 120) trace.shift()
  } catch {
    /* diagnosis must never be the thing that breaks */
  }
}
const report = (fields: string[]): void => {
  if (!fields.length) return
  pruned += 1
  try {
    // To the extension, which owns the statistics. Nothing is counted in the page.
    window.postMessage({ source: 'orbis-adblock', kind: 'pruned', fields, host: location.hostname }, location.origin)
  } catch {
    /* a page that refuses postMessage still gets the pruning */
  }
}

function prune<T>(value: T): T {
  if (!rule) return value
  try {
    const result = pruneValue(value, rule)
    if (result.changed) report(result.fields)
  } catch {
    /* pruning must never break a parse */
  }
  return value
}

/**
 * A global the page assigns to, pruned on the way in.
 *
 * The document arrives in an inline script, so there is no request to intercept and no event to wait for. A property
 * that prunes on assignment is the only place to stand. Readers afterwards see an ordinary object.
 */
function guardGlobal(name: string): void {
  let held: unknown
  try {
    const existing = Object.getOwnPropertyDescriptor(window, name)
    if (existing && !existing.configurable) {
      // Already fixed in place: prune what is there and leave the property alone rather than throwing.
      if (existing.value !== undefined) prune(existing.value)
      return
    }
    if (existing && 'value' in existing && existing.value !== undefined) held = prune(existing.value)
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => held,
      set: (value) => {
        held = prune(value)
      }
    })
  } catch {
    /* the response-level guards below still apply */
  }
}

/** The player's own request for what to play, for every navigation after the first. */
function guardFetch(): void {
  const original = window.fetch
  if (typeof original !== 'function' || !rule) return
  window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
    const response = await original.apply(this as never, args)
    try {
      const first = args[0]
      const url = typeof first === 'string' ? first : first instanceof Request ? first.url : String(first ?? '')
      if (!rule.endpoints.test(url)) return response
      // The clone is read, so the caller's body is never consumed out from under it.
      const parsed = rawParse(await response.clone().text())
      const result = pruneValue(parsed, rule)
      if (!result.changed) {
        note('fetch: nothing to prune', url)
        return response
      }
      note('fetch: pruned', url, result.fields)
      report(result.fields)
      return new Response(JSON.stringify(parsed), { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch {
      return response
    }
  } as typeof window.fetch
}

/** The same for XMLHttpRequest, which the player still uses in places. */
function guardXhr(): void {
  const XHR = window.XMLHttpRequest
  if (typeof XHR !== 'function' || !rule) return
  type Marked = XMLHttpRequest & { __orbisPrune?: boolean }

  const open = XHR.prototype.open
  XHR.prototype.open = function (this: Marked, method: string, url: string | URL) {
    try {
      this.__orbisPrune = rule.endpoints.test(String(url))
    } catch {
      /* a subclass that will not take a property simply is not watched */
    }
    // eslint-disable-next-line prefer-rest-params
    return open.apply(this, arguments as never)
  } as typeof XHR.prototype.open

  for (const name of ['response', 'responseText'] as const) {
    const own = Object.getOwnPropertyDescriptor(XHR.prototype, name)
    if (!own?.get) continue
    const get = own.get
    Object.defineProperty(XHR.prototype, name, {
      configurable: true,
      enumerable: own.enumerable,
      get(this: Marked) {
        const value = get.call(this)
        if (!this.__orbisPrune || typeof value !== 'string') return value
        try {
          const parsed = rawParse(value)
          const result = pruneValue(parsed, rule)
          if (!result.changed) return value
          report(result.fields)
          return JSON.stringify(parsed)
        } catch {
          return value
        }
      }
    })
  }
}

/**
 * The backstop, and the reason this survives redesigns.
 *
 * However the document arrives, the player must parse it before it can act on it. This is cheap because anything that
 * is not the document the rule describes is recognised by its signature and handed straight back.
 */
function guardJsonParse(): void {
  if (!rule) return
  const original = JSON.parse
  JSON.parse = function (this: unknown, text: string, reviver?: Parameters<typeof JSON.parse>[1]) {
    const value = original.call(JSON, text, reviver as never)
    try {
      if (matchesSignature(value, rule)) {
        const result = pruneValue(value, rule)
        if (result.changed) {
          note('JSON.parse: pruned', 'inline', result.fields)
          report(result.fields)
        }
      }
    } catch {
      /* never let pruning break a parse */
    }
    return value
  } as typeof JSON.parse
}

// Only on a site a rule actually covers, and only once per world.
const FLAG = '__orbisPruneInstalled'
const w = window as unknown as Record<string, unknown>
if (rule && !w[FLAG]) {
  w[FLAG] = true
  for (const name of rule.globals) guardGlobal(name)
  guardJsonParse()
  guardFetch()
  guardXhr()
  Object.defineProperty(w, '__orbisPrunedCount', { configurable: true, get: () => pruned })
  Object.defineProperty(w, '__orbisPruneTrace', { configurable: true, get: () => trace.slice() })
}
