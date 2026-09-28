import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanAlert,
  cleanAlerts,
  consider,
  considerSeries,
  COMPARISONS,
  describeAlert,
  measure,
  type Alert,
  considerTerm,
  measureSubject,
  describeSubject,
  formatSubjectValue,
  type AlertSubject
} from './alerts.ts'
import type { QuoteView } from './instrument.ts'
import type { Candle } from './indicators.ts'

/**
 * When an alert fires.
 *
 * Most of these are about it *not* firing. An alert that fires forty times while a price sits on its threshold gets alerts
 * switched off, and then the one that mattered never arrives either -- so the guards are the feature, and the comparison is
 * the easy part.
 */

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  instrumentId: 'binance:crypto:binance:btcusdt',
  label: '',
  subject: { kind: 'price' },
  comparison: 'above',
  value: 100,
  repeat: 'every-time',
  cooldownMs: 0,
  dailyLimit: 0,
  enabled: true,
  createdAt: 0,
  ...over
})

const quote = (over: Partial<QuoteView> = {}): QuoteView => ({
  instrumentId: 'binance:crypto:binance:btcusdt',
  last: 105,
  previousClose: 100,
  change: 5,
  changePercent: 5,
  bid: null,
  ask: null,
  volume: 1000,
  dayHigh: null,
  dayLow: null,
  timestamp: 1_000_000,
  delayedByMs: 0,
  marketStatus: 'always-open',
  source: 'Fake',
  freshness: 'real-time',
  ageMs: 0,
  ...over
})

const bars = (values: number[]): Candle[] =>
  values.map((close, i) => ({ time: i * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 100 }))

// ---------------------------------------------------------------- the comparisons

test('above and below are about where it is now', () => {
  assert.equal(consider(alert({ comparison: 'above', value: 100 }), 101, 1).fired, true)
  assert.equal(consider(alert({ comparison: 'above', value: 100 }), 100, 1).fired, false)
  assert.equal(consider(alert({ comparison: 'below', value: 100 }), 99, 1).fired, true)
  assert.equal(consider(alert({ comparison: 'at-or-above', value: 100 }), 100, 1).fired, true)
  assert.equal(consider(alert({ comparison: 'at-or-below', value: 100 }), 100, 1).fired, true)
  assert.equal(consider(alert({ comparison: 'equals', value: 100 }), 100, 1).fired, true)
})

test('a crossing does not fire on the first reading, whatever the price is', () => {
  // Otherwise every "above 200" alert fires the instant it is created on anything already above 200 -- which is the
  // complaint that makes people stop using alerts.
  const fresh = alert({ comparison: 'crosses-above', value: 100 })
  assert.equal(consider(fresh, 150, 1).fired, false, 'it has crossed nothing yet')
})

test('a crossing fires once, on the way through', () => {
  let a = alert({ comparison: 'crosses-above', value: 100 })
  a = consider(a, 99, 1).next
  const crossing = consider(a, 101, 2)
  assert.equal(crossing.fired, true)
  // And not again while it stays above.
  a = crossing.next
  assert.equal(consider(a, 105, 3).fired, false)
  assert.equal(consider(a, 200, 4).fired, false)
})

test('a crossing can happen again after it comes back', () => {
  let a = alert({ comparison: 'crosses-above', value: 100 })
  a = consider(a, 99, 1).next
  a = consider(a, 101, 2).next
  a = consider(a, 98, 3).next
  assert.equal(consider(a, 101, 4).fired, true)
})

test('crossing below is the mirror', () => {
  let a = alert({ comparison: 'crosses-below', value: 100 })
  a = consider(a, 101, 1).next
  assert.equal(consider(a, 99, 2).fired, true)
})

test('a range fires on entering it, and separately on leaving it', () => {
  let entering = alert({ comparison: 'enters-range', value: 90, value2: 110 })
  entering = consider(entering, 80, 1).next
  assert.equal(consider(entering, 100, 2).fired, true)

  let leaving = alert({ comparison: 'leaves-range', value: 90, value2: 110 })
  leaving = consider(leaving, 100, 1).next
  assert.equal(consider(leaving, 120, 2).fired, true)
})

test('a range does not care which way round its ends were given', () => {
  let a = alert({ comparison: 'enters-range', value: 110, value2: 90 })
  a = consider(a, 80, 1).next
  assert.equal(consider(a, 100, 2).fired, true)
})

test('"moves by" is either direction, because that is what people mean', () => {
  const a = alert({ comparison: 'changes-by', value: 5, subject: { kind: 'change-percent' } })
  assert.equal(consider(a, 6, 1).fired, true)
  assert.equal(consider(a, -6, 1).fired, true)
  assert.equal(consider(a, 4, 1).fired, false)
})

// ---------------------------------------------------------------- not firing

test('a switched-off alert never fires, however true it is', () => {
  assert.equal(consider(alert({ enabled: false }), 1000, 1).fired, false)
})

test('no value never fires', () => {
  // An alert that fired because a number was missing would be worse than one that never fired.
  assert.equal(consider(alert(), null, 1).fired, false)
  assert.equal(consider(alert(), Number.NaN, 1).fired, false)
})

test('a missing value does not overwrite what the alert last saw', () => {
  // Otherwise one gap in the feed forgets where the price was, and the next crossing is missed.
  let a = alert({ comparison: 'crosses-above', value: 100 })
  a = consider(a, 99, 1).next
  a = consider(a, null, 2).next
  assert.equal(a.lastValue, 99, 'it still remembers 99')
  assert.equal(consider(a, 101, 3).fired, true)
})

test('"once" fires once and then never again', () => {
  let a = alert({ repeat: 'once' })
  const first = consider(a, 101, 1)
  assert.equal(first.fired, true)
  a = first.next
  assert.equal(consider(a, 200, 2).fired, false)
  assert.match(consider(a, 200, 2).reason, /only fires once/)
})

test('"daily" fires once a day and again the next day', () => {
  const monday = Date.UTC(2026, 0, 5, 10)
  const alsoMonday = Date.UTC(2026, 0, 5, 20)
  const tuesday = Date.UTC(2026, 0, 6, 10)
  let a = alert({ repeat: 'daily' })
  a = consider(a, 101, monday).next
  assert.equal(consider(a, 101, alsoMonday).fired, false)
  assert.equal(consider(a, 101, tuesday).fired, true)
})

test('a cooldown holds it off, and says for how long', () => {
  let a = alert({ cooldownMs: 60_000 })
  a = consider(a, 101, 1_000_000).next
  const tooSoon = consider(a, 102, 1_030_000)
  assert.equal(tooSoon.fired, false)
  assert.match(tooSoon.reason, /30s to wait/)
  assert.equal(consider(a, 102, 1_061_000).fired, true)
})

test('a daily cap holds, and resets the next day', () => {
  const monday = Date.UTC(2026, 0, 5, 10)
  let a = alert({ dailyLimit: 2 })
  a = consider(a, 101, monday).next
  a = consider(a, 102, monday + 1000).next
  const third = consider(a, 103, monday + 2000)
  assert.equal(third.fired, false)
  assert.match(third.reason, /2 times today/)
  assert.equal(consider(a, 103, Date.UTC(2026, 0, 6, 10)).fired, true)
})

test('a cap of zero is no cap', () => {
  let a = alert({ dailyLimit: 0 })
  for (let i = 0; i < 10; i++) a = consider(a, 101 + i, 1_000_000 + i).next
  assert.equal(a.firedToday, 10)
})

// ---------------------------------------------------------------- the memory

test('the memory advances whether or not it fired', () => {
  // An implementation that only saved a fired alert would never detect a crossing again: the value it compares against
  // would be stuck wherever it last fired.
  const a = alert({ comparison: 'above', value: 1000 })
  const outcome = consider(a, 50, 1)
  assert.equal(outcome.fired, false)
  assert.equal(outcome.next.lastValue, 50)
})

test('the outcome always carries the alert to keep', () => {
  for (const comparison of COMPARISONS) {
    const outcome = consider(alert({ comparison, value: 100, value2: 110 }), 105, 1)
    assert.ok(outcome.next, `${comparison} returned no alert`)
    assert.equal(outcome.next.id, 'a1')
  }
})

// ---------------------------------------------------------------- what is measured

test('a price alert reads the price, and a change alert the change', () => {
  assert.equal(measure(alert({ subject: { kind: 'price' } }), quote()).value, 105)
  assert.equal(measure(alert({ subject: { kind: 'change-percent' } }), quote()).value, 5)
  assert.equal(measure(alert({ subject: { kind: 'volume' } }), quote()).value, 1000)
})

test('a volume alert on a feed with no volume has no value, and so never fires', () => {
  const noVolume = measure(alert({ subject: { kind: 'volume' } }), quote({ volume: null }))
  assert.equal(noVolume.value, null)
  assert.equal(consider(alert({ subject: { kind: 'volume' } }), noVolume.value, 1).fired, false)
})

test('an alert with no quote at all has no value', () => {
  assert.equal(measure(alert(), null).value, null)
})

test('an indicator alert reads the indicator from real candles', () => {
  const rising = bars(Array.from({ length: 40 }, (_v, i) => 100 + i))
  const a = alert({ subject: { kind: 'indicator', indicator: 'rsi', interval: '1h' }, comparison: 'above', value: 70 })
  const { value } = measure(a, quote(), rising)
  assert.ok(value !== null && value > 70, `RSI was ${value}`)
  assert.equal(consider(a, value, 1).fired, true)
})

test('an indicator with too few candles has no value rather than a guess', () => {
  const a = alert({ subject: { kind: 'indicator', indicator: 'rsi', interval: '1h' } })
  assert.equal(measure(a, quote(), bars([1, 2, 3])).value, null)
  assert.equal(measure(a, quote(), []).value, null)
})

test('an indicator alert can name which of its lines it means', () => {
  const candles = bars(Array.from({ length: 80 }, (_v, i) => 100 + Math.sin(i / 4) * 10))
  const onSignal = measure(
    alert({ subject: { kind: 'indicator', indicator: 'macd', series: 'signal', interval: '1h' } }),
    quote(),
    candles
  )
  const onLine = measure(
    alert({ subject: { kind: 'indicator', indicator: 'macd', series: 'macd', interval: '1h' } }),
    quote(),
    candles
  )
  assert.ok(onSignal.value !== null && onLine.value !== null)
  assert.notEqual(onSignal.value, onLine.value)
})

// ---------------------------------------------------------------- indicator crossings

test('an indicator crossing is judged on the line, not only its last value', () => {
  // Rising through 50: the previous bar is below and this one above.
  const series = [40, 45, 49, 51]
  const a = alert({ comparison: 'crosses-above', value: 50, subject: { kind: 'indicator', indicator: 'rsi', interval: '1h' } })
  assert.equal(considerSeries(a, series, 1).fired, true)
  // Already above for two bars: no crossing.
  assert.equal(considerSeries(a, [51, 52, 53, 54], 1).fired, false)
})

test('an indicator crossing still obeys the cooldown', () => {
  const a = alert({
    comparison: 'crosses-above',
    value: 50,
    cooldownMs: 60_000,
    subject: { kind: 'indicator', indicator: 'rsi', interval: '1h' }
  })
  const first = considerSeries(a, [49, 51], 1_000_000)
  assert.equal(first.fired, true)
  const again = considerSeries(first.next, [49, 51], 1_010_000)
  assert.equal(again.fired, false)
})

test('a series alert that is not a crossing falls back to comparing the last value', () => {
  const a = alert({ comparison: 'above', value: 50, subject: { kind: 'indicator', indicator: 'rsi', interval: '1h' } })
  assert.equal(considerSeries(a, [10, 20, 60], 1).fired, true)
  assert.equal(considerSeries(a, [10, 20, 40], 1).fired, false)
})

test('a switched-off indicator alert does not fire either', () => {
  const a = alert({
    enabled: false,
    comparison: 'crosses-above',
    value: 50,
    subject: { kind: 'indicator', indicator: 'rsi', interval: '1h' }
  })
  assert.equal(considerSeries(a, [49, 51], 1).fired, false)
})

// ---------------------------------------------------------------- what it is called

test('every comparison has a sentence', () => {
  for (const comparison of COMPARISONS) {
    const said = describeAlert(alert({ comparison, value: 100, value2: 110 }), 'BTC')
    assert.ok(said.includes('BTC'), `${comparison} does not name the instrument`)
    assert.ok(said.length > 10, `${comparison} says too little: ${said}`)
  }
})

test('a change alert is described in per cent', () => {
  const said = describeAlert(alert({ subject: { kind: 'change-percent' }, comparison: 'above', value: 5 }), 'BTC')
  assert.match(said, /5%/)
})

test('an indicator alert names the indicator and its interval', () => {
  const said = describeAlert(
    alert({ subject: { kind: 'indicator', indicator: 'rsi', interval: '4h' }, comparison: 'below', value: 30 }),
    'NVDA'
  )
  assert.match(said, /RSI/)
  assert.match(said, /4h/)
  assert.match(said, /30/)
})

// ---------------------------------------------------------------- reading one back

test('an alert from a file keeps what it can', () => {
  const read = cleanAlert({
    id: 'x',
    instrumentId: 'binance:crypto:binance:btcusdt',
    comparison: 'crosses-above',
    value: 110000,
    repeat: 'daily',
    cooldownMs: 60_000,
    dailyLimit: 3,
    lastValue: 105000,
    lastFiredAt: 999
  })
  assert.equal(read?.comparison, 'crosses-above')
  assert.equal(read?.value, 110000)
  assert.equal(read?.repeat, 'daily')
  assert.equal(read?.lastValue, 105000)
  assert.equal(read?.lastFiredAt, 999)
})

test('an alert without the parts that make it one is not an alert', () => {
  assert.equal(cleanAlert(null), null)
  assert.equal(cleanAlert({ id: 'x' }), null)
  assert.equal(cleanAlert({ id: 'x', instrumentId: 'a:b:c:d', comparison: 'nope', value: 1 }), null)
  assert.equal(cleanAlert({ id: 'x', instrumentId: 'a:b:c:d', comparison: 'above' }), null)
  assert.equal(cleanAlert({ id: 'x', instrumentId: 'a:b:c:d', comparison: 'above', value: 'lots' }), null)
})

test('a nonsense cooldown or cap is clamped rather than honoured', () => {
  const read = cleanAlert({
    id: 'x',
    instrumentId: 'a:b:c:d',
    comparison: 'above',
    value: 1,
    cooldownMs: -5,
    dailyLimit: 99999
  })
  assert.equal(read?.cooldownMs, 0)
  assert.equal(read?.dailyLimit, 500)
})

test('an unknown subject falls back to price rather than to nothing', () => {
  const read = cleanAlert({ id: 'x', instrumentId: 'a:b:c:d', comparison: 'above', value: 1, subject: { kind: 'vibes' } })
  assert.deepEqual(read?.subject, { kind: 'price' })
})

test('a list drops what is not an alert and de-duplicates by id', () => {
  const list = cleanAlerts([
    { id: 'a', instrumentId: 'a:b:c:d', comparison: 'above', value: 1 },
    { id: 'a', instrumentId: 'a:b:c:d', comparison: 'below', value: 2 },
    null,
    'nope',
    { id: 'b', instrumentId: 'a:b:c:d', comparison: 'above', value: 3 }
  ])
  assert.deepEqual(
    list.map((a) => a.id),
    ['a', 'b']
  )
  assert.equal(list[0].comparison, 'above', 'the first one won')
})

test('a list that is not a list is an empty one', () => {
  assert.deepEqual(cleanAlerts(null), [])
  assert.deepEqual(cleanAlerts({ alerts: [] }), [])
})

// ---------------------------------------------------------------- hysteresis

test('a reset stops one event firing an alert over and over', () => {
  // The bug this exists to prevent: "above 100" on a price oscillating between 99.99 and 100.01 fires every cooldown for
  // ever, about the same event.
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'price' },
    comparison: 'above',
    value: 100,
    reset: 99.5,
    cooldownMs: 0
  })
  assert.ok(alert)

  const first = consider(alert, 100.01, 1000)
  assert.equal(first.fired, true)
  assert.equal(first.next.armed, false)

  // Back below the threshold but not through the reset: still disarmed.
  const wobble = consider(first.next, 99.99, 2000)
  assert.equal(wobble.fired, false)
  const again = consider(wobble.next, 100.01, 3000)
  assert.equal(again.fired, false)
  assert.match(again.reason, /come back through/)

  // Genuinely back through the reset, and it arms again.
  const back = consider(again.next, 99.4, 4000)
  assert.equal(back.next.armed, true)
  assert.equal(consider(back.next, 100.01, 5000).fired, true)
})

test('a reset above the threshold works the same way for a condition that points down', () => {
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'price' },
    comparison: 'below',
    value: 100,
    reset: 100.5,
    cooldownMs: 0
  })
  assert.ok(alert)
  const first = consider(alert, 99.9, 1000)
  assert.equal(first.fired, true)
  assert.equal(consider(first.next, 99.9, 2000).fired, false)
  const back = consider(first.next, 100.6, 3000)
  assert.equal(back.next.armed, true)
  assert.equal(consider(back.next, 99.9, 4000).fired, true)
})

test('an alert with no reset behaves exactly as it always did', () => {
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'price' },
    comparison: 'above',
    value: 100,
    cooldownMs: 0
  })
  assert.ok(alert)
  const first = consider(alert, 101, 1000)
  assert.equal(first.fired, true)
  assert.equal(first.next.armed, undefined)
  assert.equal(consider(first.next, 101, 2000).fired, true)
})

// ---------------------------------------------------------------- several conditions

test('with all, every condition has to hold', () => {
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'price' },
    comparison: 'above',
    value: 100,
    match: 'all',
    extra: [{ subject: { kind: 'volume' }, comparison: 'above', value: 1000 }],
    cooldownMs: 0
  })
  assert.ok(alert)
  assert.equal(consider(alert, 101, 1000, [false]).fired, false)
  assert.equal(consider(alert, 101, 1000, [true]).fired, true)
  // And this one's own condition still has to hold.
  assert.equal(consider(alert, 99, 1000, [true]).fired, false)
})

test('with any, one holding is enough', () => {
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'price' },
    comparison: 'above',
    value: 100,
    match: 'any',
    extra: [{ subject: { kind: 'volume' }, comparison: 'above', value: 1000 }],
    cooldownMs: 0
  })
  assert.ok(alert)
  assert.equal(consider(alert, 99, 1000, [true]).fired, true)
  assert.equal(consider(alert, 101, 1000, [false]).fired, true)
  assert.equal(consider(alert, 99, 1000, [false]).fired, false)
})

test('an extra term is judged with the same rules as the condition it sits beside', () => {
  const term = { subject: { kind: 'price' } as const, comparison: 'crosses-above' as const, value: 100 }
  const quote = (last: number): never => ({ last, freshness: 'real-time' }) as never

  // A first reading has crossed nothing -- the same rule the alert's own crossing uses.
  const first = considerTerm(term, quote(101), [], {})
  assert.equal(first.holds, false)
  const second = considerTerm(first.next, quote(102), [], {})
  assert.equal(second.holds, false)
  const under = considerTerm(second.next, quote(99), [], {})
  assert.equal(under.holds, false)
  const crossed = considerTerm(under.next, quote(101), [], {})
  assert.equal(crossed.holds, true)
})

test('a term that cannot be measured does not hold and does not advance its memory', () => {
  const term = { subject: { kind: 'funding' } as const, comparison: 'above' as const, value: 0, lastValue: 0.5 }
  const result = considerTerm(term, null, [], {})
  assert.equal(result.holds, false)
  assert.equal(result.value, null)
  // Memory unchanged, so a gap in the data cannot manufacture a crossing when it comes back.
  assert.equal(result.next.lastValue, 0.5)
})

// ---------------------------------------------------------------- derivatives subjects

test('the derivatives subjects measure what the caller supplies, and nothing when it does not', () => {
  const context = {
    spreadFraction: 0.0002,
    fundingRate: 0.0001,
    openInterest: 82_000,
    openInterestChange: (ms: number): number | null => (ms === 3_600_000 ? 0.05 : null),
    liquidations: (_ms: number, side: string): number | null => (side === 'long' ? 1_000_000 : 250_000),
    available: true
  }
  const of = (subject: AlertSubject): number | null => measureSubject(subject, null, [], context).value
  assert.equal(of({ kind: 'spread' }), 0.0002)
  assert.equal(of({ kind: 'funding' }), 0.0001)
  assert.equal(of({ kind: 'open-interest' }), 82_000)
  assert.equal(of({ kind: 'open-interest-change', windowMs: 3_600_000 }), 0.05)
  assert.equal(of({ kind: 'liquidations', windowMs: 3_600_000, side: 'long' }), 1_000_000)
  assert.equal(of({ kind: 'availability' }), 1)
})

test('a derivatives condition on a market with no derivatives never fires', () => {
  // Nothing supplied means null, and null never fires. A funding alert on a spot pair is silent rather than wrong.
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'funding' },
    comparison: 'above',
    value: 0,
    cooldownMs: 0
  })
  assert.ok(alert)
  const { value } = measure(alert, null, [], {})
  assert.equal(value, null)
  assert.equal(consider(alert, value, 1000).fired, false)
})

test('availability is a condition about the feed, measured as one and zero', () => {
  assert.equal(measureSubject({ kind: 'availability' }, null, [], { available: false }).value, 0)
  assert.equal(measureSubject({ kind: 'availability' }, null, [], {}).value, null)
})

test('every subject can be described and its threshold formatted in its own units', () => {
  const subjects: AlertSubject[] = [
    { kind: 'price' },
    { kind: 'change-percent' },
    { kind: 'volume' },
    { kind: 'spread' },
    { kind: 'funding' },
    { kind: 'open-interest' },
    { kind: 'open-interest-change', windowMs: 3_600_000 },
    { kind: 'liquidations', windowMs: 3_600_000, side: 'long' },
    { kind: 'availability' },
    { kind: 'indicator', indicator: 'rsi', interval: '1h' }
  ]
  for (const subject of subjects) {
    assert.ok(describeSubject(subject).length > 2, JSON.stringify(subject))
    assert.ok(formatSubjectValue(subject, 0.0001).length > 0)
  }
  // Funding is held as a fraction and read as a percentage: 0.0001 is one basis point, not one per cent.
  assert.equal(formatSubjectValue({ kind: 'funding' }, 0.0001), '0.0100%')
})

test('a window read from a file is clamped to something a window could be', () => {
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'liquidations', windowMs: -5 },
    comparison: 'above',
    value: 1
  })
  assert.equal((alert?.subject as { windowMs: number }).windowMs, 60_000)
})

test('a malformed extra term is dropped, and the alert fires on fewer things rather than more', () => {
  const alert = cleanAlert({
    id: 'a',
    instrumentId: 'x:1:2:3',
    subject: { kind: 'price' },
    comparison: 'above',
    value: 100,
    extra: [{ subject: { kind: 'volume' }, comparison: 'nonsense', value: 1 }, 'not a term']
  })
  assert.equal(alert?.extra, undefined)
})
