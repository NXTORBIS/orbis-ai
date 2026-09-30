import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * What the browser's own market surfaces may ask Orbis.
 *
 * The strip along the bottom of the browser is a page, and pages reach Orbis through the helper. So these are the
 * channels that page uses -- and, deliberately, only those: reading what to show, waiting for the next change, and the
 * three actions the preview offers.
 *
 * Nothing here writes a watchlist, edits an alert or changes a setting, with one exception: the strip may switch
 * *itself off*. That is here because the close control is on the strip -- hiding something has to be possible from the
 * thing being hidden, or the only way to get rid of a band across the bottom of your browser is to go and find a
 * setting for it. It is deliberately one-way: a page can turn the strip off and can never turn it on, so this cannot
 * be used to put a band on somebody's browser, only to take one away.
 */

export interface MarketsHelperDeps {
  /** Everything the strip needs to draw itself. */
  tickerState(): Promise<unknown>
  /** Waits for the next change, answering empty after a while so the page can tell a silent market from a lost one. */
  nextBatch(): Promise<unknown>
  /** Asks for fresh prices for anything that has none. */
  prime(): Promise<void>
  /** One of the preview's actions. Returns whether it happened. */
  act(what: string, instrumentId: string): Promise<boolean>
  /** Opens the group chooser in the Orbis window, because the groups are edited there. */
  openGroups(): Promise<void>
  /** Switches the strip off. One-way: there is deliberately no matching way to switch it on from a page. */
  hideStrip(): Promise<void>
}

const instrumentId = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new HelperError('bad-request', 'That is not an instrument.')
  }
  return value
}

const ACTIONS = new Set(['chart', 'watch', 'alert'])

export function createMarketsHandlers(getDeps: () => MarketsHelperDeps | null | undefined): Record<string, Handler> {
  const need = (): MarketsHelperDeps => {
    const d = getDeps()
    if (!d) throw new HelperError('unavailable', 'Markets are not ready yet.')
    return d
  }

  const guarded =
    (run: (a: unknown[]) => Promise<unknown> | unknown): Handler =>
    async (a) => {
      try {
        return await run(a)
      } catch (err) {
        if (err instanceof HelperError) throw err
        // Never the underlying message: it could carry a provider's URL or a key from somewhere it should not have been.
        throw new HelperError('failed', 'Market data could not be read.')
      }
    }

  return {
    'markets:ticker': guarded(async () => {
      const deps = need()
      // Primed first, so a strip that has just opened shows prices rather than dashes while it waits for a stream.
      await deps.prime().catch(() => undefined)
      return deps.tickerState()
    }),

    /**
     * Waits for the next change.
     *
     * Held open rather than answered at once. A strip that polled would be several requests a second for a market that
     * moved once a minute; this costs one held request and arrives as fast as the price does.
     */
    'markets:quotes-since': guarded(async () => need().nextBatch()),

    /**
     * What the strip is showing, so Orbis subscribes to that and nothing else.
     *
     * Accepted and ignored beyond its shape: the engine already knows what the profile is watching, and a page naming its
     * own subscriptions would be a page that could hold one open after it had gone. It is here so the page can say "I have
     * stopped", which is worth knowing.
     */
    'markets:watch': guarded(async (a) => {
      const ids = Array.isArray(a[0]) ? a[0].filter((v): v is string => typeof v === 'string').slice(0, 500) : []
      return { watching: ids.length }
    }),

    'markets:act': guarded(async (a) => {
      const what = typeof a[0] === 'string' ? a[0] : ''
      if (!ACTIONS.has(what)) throw new HelperError('bad-request', 'That is not something Orbis can do here.')
      return { ok: await need().act(what, instrumentId(a[1])) }
    }),

    'markets:ticker-groups-open': guarded(async () => {
      await need().openGroups()
      return { ok: true }
    }),

    /**
     * The close control on the strip.
     *
     * Takes nothing, so there is no argument to get wrong and nothing to authorise beyond the request itself, and it
     * can only ever mean "off". Switching the strip back on is the Orbis window's to do.
     */
    'markets:ticker-off': guarded(async () => {
      await need().hideStrip()
      return { ok: true }
    })
  }
}
