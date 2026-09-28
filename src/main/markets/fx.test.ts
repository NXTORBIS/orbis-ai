import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FxRates } from './fx.ts'

/**
 * Exchange rates from a real source.
 *
 * Against a scripted server rather than the network, so the awkward answers can be made to happen on purpose. Every test
 * here is about the same thing: when a rate cannot be had, the answer is nothing — never a guess, and never the last
 * rate presented as though it were current.
 */

const DAY = '2026-09-25'
const DAY_MS = Date.parse(`${DAY}T16:00:00Z`)
const NOW = DAY_MS + 3600_000

/** A fetch that answers from a script and counts what it was asked. */
const server = (
  body: unknown,
  options: { status?: number; throws?: boolean; garbage?: boolean } = {}
): { fetchFn: typeof fetch; asked: string[] } => {
  const asked: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    asked.push(String(input))
    if (options.throws) throw new Error('no route to host')
    if (options.status && options.status !== 200) return new Response('', { status: options.status })
    if (options.garbage) return new Response('not json', { status: 200 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchFn, asked }
}

const rates = (over: Record<string, number> = {}) => ({
  base: 'USD',
  date: DAY,
  rates: { INR: 88.5, EUR: 0.92, GBP: 0.79, JPY: 155.2, ...over }
})

// ---------------------------------------------------------------- getting one

test('a rate comes back with the provider’s own date, not the moment it was fetched', async () => {
  // The age of a conversion has to be the age of the rate. Stamping it with now would make yesterday's rate look live.
  const { fetchFn } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  const rate = await fx.rate('USD', 'INR')
  assert.equal(rate?.rate, 88.5)
  assert.equal(rate?.at, DAY_MS)
  assert.equal(rate?.source, 'European Central Bank')
})

test('the same currency needs no rate', async () => {
  const { fetchFn, asked } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  const rate = await fx.rate('USD', 'USD')
  assert.equal(rate?.rate, 1)
  // And no request: asking a provider what a dollar is worth in dollars is a request with a known answer.
  assert.equal(asked.length, 0)
})

test('a currency Orbis does not offer is not asked about', async () => {
  const { fetchFn, asked } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'XYZ'), null)
  assert.equal(await fx.rate('', 'INR'), null)
  assert.equal(asked.length, 0)
})

test('a target the provider did not quote gives nothing rather than a guess', async () => {
  const { fetchFn } = server({ base: 'USD', date: DAY, rates: { EUR: 0.92 } })
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'INR'), null)
})

test('an impossible rate is refused', async () => {
  const { fetchFn } = server({ base: 'USD', date: DAY, rates: { INR: 0, EUR: -1, GBP: 'x' } })
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'INR'), null)
  assert.equal(await fx.rate('USD', 'EUR'), null)
  assert.equal(await fx.rate('USD', 'GBP'), null)
})

// ---------------------------------------------------------------- not asking too often

test('one request answers a whole watchlist', async () => {
  const { fetchFn, asked } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  const out = await fx.rates('USD', ['INR', 'EUR', 'GBP', 'JPY', 'USD'])
  assert.equal(out.size, 5)
  assert.equal(out.get('INR')?.rate, 88.5)
  assert.equal(out.get('USD')?.rate, 1)
  assert.equal(asked.length, 1)
})

test('rates are reused until they go out of date', async () => {
  let clock = NOW
  const { fetchFn, asked } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => clock, ttlMs: 60_000 })
  await fx.rate('USD', 'INR')
  await fx.rate('USD', 'EUR')
  assert.equal(asked.length, 1, 'it asked twice for one set of rates')
  clock += 61_000
  await fx.rate('USD', 'GBP')
  assert.equal(asked.length, 2)
})

test('several screens opening at once make one request', async () => {
  // A watchlist of forty opening together should not become forty requests.
  const { fetchFn, asked } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  await Promise.all([fx.rate('USD', 'INR'), fx.rate('USD', 'EUR'), fx.rate('USD', 'GBP'), fx.rates('USD', ['JPY'])])
  assert.equal(asked.length, 1)
})

// ---------------------------------------------------------------- when it cannot be reached

test('an unreachable provider converts nothing', async () => {
  const { fetchFn } = server(null, { throws: true })
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'INR'), null)
  assert.ok(fx.status('USD').failing.includes('could not be reached'))
})

test('a refusal from the provider converts nothing', async () => {
  const { fetchFn } = server(null, { status: 503 })
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'INR'), null)
  assert.ok(fx.status('USD').failing.includes('503'))
})

test('something that is not rates converts nothing', async () => {
  const { fetchFn } = server(null, { garbage: true })
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'INR'), null)
})

test('an empty set of rates is a failure, not a set of no rates', async () => {
  const { fetchFn } = server({ base: 'USD', date: DAY, rates: {} })
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'INR'), null)
  assert.ok(fx.status('USD').failing.length > 0)
})

test('after a failure it backs off rather than asking every time', async () => {
  let clock = NOW
  let fail = true
  const asked: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    asked.push(String(input))
    if (fail) throw new Error('down')
    return new Response(JSON.stringify(rates()), { status: 200 })
  }) as unknown as typeof fetch

  const fx = new FxRates({ fetchFn, now: () => clock })
  await fx.rate('USD', 'INR')
  await fx.rate('USD', 'EUR')
  await fx.rate('USD', 'GBP')
  // An outage must not be met with a request per tick.
  assert.equal(asked.length, 1)

  fail = false
  clock += 6 * 60_000
  assert.equal((await fx.rate('USD', 'INR'))?.rate, 88.5)
  assert.equal(asked.length, 2)
})

test('a provider that goes down keeps serving the last rates, with their real age', async () => {
  let clock = NOW
  let fail = false
  const fetchFn = (async () => {
    if (fail) throw new Error('down')
    return new Response(JSON.stringify(rates()), { status: 200 })
  }) as unknown as typeof fetch

  const fx = new FxRates({ fetchFn, now: () => clock, ttlMs: 1_000 })
  assert.equal((await fx.rate('USD', 'INR'))?.rate, 88.5)

  fail = true
  clock += 10 * 24 * 3600_000
  const later = await fx.rate('USD', 'INR')
  assert.equal(later?.rate, 88.5)
  // Still the day it was published, which is what lets a screen say "converted using an older rate" instead of
  // claiming the conversion is current.
  assert.equal(later?.at, DAY_MS)
})

test('with nothing ever fetched, a failure converts nothing rather than serving a stale nothing', async () => {
  const { fetchFn } = server(null, { throws: true })
  const fx = new FxRates({ fetchFn, now: () => NOW })
  assert.equal(await fx.rate('USD', 'INR'), null)
  assert.equal(fx.status('USD').at, null)
})

// ---------------------------------------------------------------- what it says about itself

test('the status says where rates come from and how old they are', async () => {
  const { fetchFn } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  await fx.rate('USD', 'INR')
  const status = fx.status('USD')
  assert.equal(status.source, 'European Central Bank')
  assert.equal(status.at, DAY_MS)
  assert.equal(status.fetchedAt, NOW)
  assert.equal(status.failing, '')
})

test('there is nowhere in this provider to put a credential', async () => {
  // Same reason as the price feed: the simplest way to be sure none is ever sent.
  const { fetchFn, asked } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  await fx.rate('USD', 'INR')
  assert.ok(!/key|token|secret|auth/i.test(asked[0]), asked[0])
  assert.ok(!('apiKey' in (fx as unknown as Record<string, unknown>)))
})

test('resetting forgets everything, so the next ask fetches', async () => {
  const { fetchFn, asked } = server(rates())
  const fx = new FxRates({ fetchFn, now: () => NOW })
  await fx.rate('USD', 'INR')
  fx.reset()
  await fx.rate('USD', 'INR')
  assert.equal(asked.length, 2)
})
