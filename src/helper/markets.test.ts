import assert from 'node:assert/strict'
import test from 'node:test'
import { createMarketsHandlers, type MarketsHelperDeps } from './markets.ts'

/**
 * What the browser's market strip may ask Orbis.
 *
 * The point of these is the shape of the surface rather than the answers. The strip is a page, and a page can be
 * anything -- a site that got a script in, a version of the page from before the last update, something driven by
 * whoever is at the keyboard. So what matters is that the list of things it can ask is short, that it cannot ask for
 * anything that writes, and in particular that it can switch itself *off* and never on.
 */

const deps = (over: Partial<MarketsHelperDeps> = {}): { deps: MarketsHelperDeps; hidden: () => number } => {
  let hides = 0
  return {
    hidden: () => hides,
    deps: {
      tickerState: async () => ({ config: {}, items: [], connection: 'connected' }),
      nextBatch: async () => ({ quotes: [], alerts: [] }),
      prime: async () => undefined,
      act: async () => true,
      openGroups: async () => undefined,
      hideStrip: async () => {
        hides += 1
      },
      ...over
    }
  }
}

const handlersFor = (d: MarketsHelperDeps) => createMarketsHandlers(() => d)

/** What the helper gives a handler besides its arguments. Nothing here uses it; it exists so the shapes match. */
const context = { emit: () => undefined, signal: new AbortController().signal }

test('the strip can switch itself off', async () => {
  const { deps: d, hidden } = deps()
  const handlers = handlersFor(d)
  const answer = await handlers['markets:ticker-off']([], context)
  assert.deepEqual(answer, { ok: true })
  assert.equal(hidden(), 1, 'the setting was actually changed, not merely reported as changed')
})

test('switching it off takes no arguments at all', async () => {
  // Nothing to get wrong and nothing to authorise beyond the request itself. Whatever a page passes is ignored, so a
  // page cannot widen this by passing something.
  const { deps: d, hidden } = deps()
  const handlers = handlersFor(d)
  await handlers['markets:ticker-off'](['someone-elses-profile', true, { enabled: true }], context)
  assert.equal(hidden(), 1)
})

test('there is no channel here that switches the strip on', () => {
  /**
   * The one that matters.
   *
   * A page that could turn the strip on could put a band across the bottom of somebody's browser without being asked,
   * and could do it from any site that managed to talk to this surface. Hiding has to be possible from the thing being
   * hidden; showing does not, and belongs to the Orbis window, which is the half a person actually drives.
   */
  const handlers = handlersFor(deps().deps)
  for (const name of Object.keys(handlers)) {
    assert.ok(
      !/(^|[:-])(on|show|enable|ticker-on)$/.test(name),
      `${name} looks like it turns the strip on, which no page may do`
    )
  }
  assert.equal(Object.hasOwn(handlers, 'markets:ticker-on'), false)
})

test('nothing here writes a watchlist, an alert or any other setting', () => {
  // The whole surface, named. A new channel has to be added here deliberately, which is the point: this list growing
  // is a decision somebody makes rather than something that happens.
  assert.deepEqual(Object.keys(handlersFor(deps().deps)).sort(), [
    'markets:act',
    'markets:quotes-since',
    'markets:ticker',
    'markets:ticker-groups-open',
    'markets:ticker-off',
    'markets:watch'
  ])
})

test('a request made before Orbis is ready is refused rather than answered emptily', async () => {
  const handlers = createMarketsHandlers(() => {
    throw new Error('not ready')
  })
  await assert.rejects(
    async () => await handlers['markets:ticker-off']([], context),
    (err: unknown) => {
      // Never the underlying message: it could carry something from where it should not have been.
      assert.ok(err instanceof Error)
      assert.ok(!String((err as Error).message).includes('not ready'))
      return true
    }
  )
})
