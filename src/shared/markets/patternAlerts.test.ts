import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ALERT_ASSUMPTIONS,
  DEFAULT_RULE,
  alertText,
  batchFirings,
  checkEligibility,
  checkRule,
  decideFiring,
  digestOf,
  priorityOf,
  type PatternAlertRule,
  type PatternFiring
} from './patternAlerts.ts'
import type { PatternContext } from './patternContext.ts'
import type { PatternDetection } from './patternDetect.ts'
import type { PatternDirection } from './patterns.ts'

const NOW = 1_700_000_000_000

const rule = (over: Partial<PatternAlertRule> = {}): PatternAlertRule => ({
  ...DEFAULT_RULE,
  id: 'r1',
  name: 'A rule',
  createdAt: NOW,
  scope: 'instruments',
  instrumentIds: ['binance-spot-BTCUSDT'],
  ...over
})

const detection = (over: Partial<PatternDetection> = {}): PatternDetection =>
  ({
    key: 'unbound',
    patternId: 'bullish-engulfing',
    patternName: 'Bullish Engulfing',
    patternVersion: 1,
    libraryVersion: 1,
    mode: 'standard',
    category: 'reversal',
    direction: 'bullish',
    index: 40,
    candleTimes: [NOW - 60_000, NOW],
    emphasisTimes: [NOW - 60_000, NOW],
    at: NOW,
    structuralMatch: 0.6,
    dataQuality: { level: 'high', reasons: [], formationValid: true, hasVolume: true, comparisonSample: 20, describe: 'fine' },
    completeness: 'complete',
    status: 'confirmed',
    evidence: { structural: [], context: [], unmetContext: [], unmetPreferences: [] },
    trend: { trend: 'down', drift: -1, lookback: 5, describe: 'a decline' },
    alsoMatches: [],
    describe: 'a bullish engulfing',
    ...over
  }) as PatternDetection

const context = (over: Partial<PatternContext> = {}): PatternContext =>
  ({
    structure: { shape: 'lower-highs-and-lows', swings: [], lastBreak: null, describe: '' },
    levels: { nearestSupport: null, nearestResistance: null, toSupport: null, toResistance: null, placement: 'at-support', describe: '' },
    volume: { reading: 'above-average', relative: 1.8, sample: 20, describe: '' },
    volatility: { reading: 'normal', rangeVsAtr: 1, atr: 1, atrPercent: 1, trend: 'steady', describe: '' },
    momentum: { rsi: 28, rsiReading: 'oversold', macdHistogram: null, macdReading: 'unavailable', adx: 30, adxReading: 'strong', priceVsMovingAverage: null, describe: '' },
    regime: { regime: 'weak-downtrend', volatility: 'normal', describe: '' },
    agreements: ['one', 'two'],
    conflicts: [],
    unavailable: [],
    completeness: 1,
    describe: '',
    ...over
  }) as PatternContext

const base = { instrumentId: 'binance-spot-BTCUSDT', interval: '15m', inScope: true }

// ------------------------------------------------------------ the rule

describe('validating a rule', () => {
  test('a sensible rule has nothing to report', () => {
    assert.deepEqual(checkRule(rule()), [])
  })

  test('a rule watching specific markets and naming none can never fire, and is refused', () => {
    const problems = checkRule(rule({ instrumentIds: [] }))
    assert.ok(problems.some((one) => one.field === 'instrumentIds'))
    assert.match(problems[0]?.describe ?? '', /never fire/)
  })

  test('an empty requirement list is refused, because it looks like no requirement and matches nothing', () => {
    for (const field of ['requireVolume', 'requirePlacement', 'requireTimeframeAgreement'] as const) {
      const problems = checkRule(rule({ [field]: [] } as Partial<PatternAlertRule>))
      assert.ok(problems.some((one) => one.field === field), `${field} was accepted empty`)
      assert.match(problems.find((one) => one.field === field)?.describe ?? '', /nothing can satisfy/)
    }
  })

  test('null is how no requirement is expressed, and is accepted', () => {
    assert.deepEqual(checkRule(rule({ requireVolume: null, requirePlacement: null, requireTimeframeAgreement: null })), [])
  })

  test('accepting unusable data quality is refused', () => {
    assert.ok(checkRule(rule({ minimumDataQuality: 'unusable' })).some((one) => one.field === 'minimumDataQuality'))
  })

  test('a minimum match of 1 is refused as unreachable', () => {
    assert.ok(checkRule(rule({ minimumStructuralMatch: 1 })).some((one) => one.field === 'minimumStructuralMatch'))
  })

  test('a match outside 0 to 1 is refused', () => {
    assert.ok(checkRule(rule({ minimumStructuralMatch: 1.5 })).length > 0)
    assert.ok(checkRule(rule({ minimumStructuralMatch: -1 })).length > 0)
  })

  test('a negative cooldown is refused', () => {
    assert.ok(checkRule(rule({ cooldownMs: -1 })).some((one) => one.field === 'cooldownMs'))
  })

  test('the default rule does not fire on developing candles', () => {
    assert.equal(DEFAULT_RULE.allowDeveloping, false)
  })
})

// ------------------------------------------------------------ eligibility

describe('eligibility', () => {
  test('a matching detection is eligible and every condition is reported', () => {
    const result = checkEligibility({ rule: rule(), detection: detection(), ...base })
    assert.equal(result.eligible, true)
    assert.ok(result.checks.length > 0)
    assert.deepEqual(result.blocked, [])
  })

  test('a market the rule does not watch is blocked, and says so', () => {
    const result = checkEligibility({ rule: rule(), detection: detection(), ...base, instrumentId: 'binance-spot-ETHUSDT' })
    assert.equal(result.eligible, false)
    assert.match(result.blocked.join(' '), /not one of the markets/)
  })

  test('a switched-off rule is blocked before anything else is considered', () => {
    const result = checkEligibility({ rule: rule({ enabled: false }), detection: detection(), ...base })
    assert.equal(result.eligible, false)
    assert.equal(result.checks.length, 1)
  })

  test('a developing formation is blocked unless the rule allows it', () => {
    const developing = detection({ completeness: 'developing', status: 'candidate' })
    assert.equal(checkEligibility({ rule: rule(), detection: developing, ...base }).eligible, false)
    assert.equal(checkEligibility({ rule: rule({ allowDeveloping: true }), detection: developing, ...base }).eligible, true)
  })

  test('a match below the minimum is blocked and both numbers are named', () => {
    const result = checkEligibility({ rule: rule({ minimumStructuralMatch: 0.8 }), detection: detection({ structuralMatch: 0.3 }), ...base })
    assert.equal(result.eligible, false)
    assert.match(result.blocked.join(' '), /30% against the 80%/)
  })

  test('data quality below the minimum is blocked', () => {
    const poor = detection({ dataQuality: { level: 'poor', reasons: ['a candle is missing'], formationValid: true, hasVolume: true, comparisonSample: 20, describe: '' } })
    assert.equal(checkEligibility({ rule: rule({ minimumDataQuality: 'high' }), detection: poor, ...base }).eligible, false)
  })

  test('a broader classification the formation also satisfies counts as the pattern asked for', () => {
    const dragonfly = detection({ patternId: 'dragonfly-doji', patternName: 'Dragonfly Doji', alsoMatches: ['doji'] })
    assert.equal(checkEligibility({ rule: rule({ patternIds: ['doji'] }), detection: dragonfly, ...base }).eligible, true)
  })

  test('a volume requirement with no context gathered is unmet, not assumed satisfied', () => {
    const result = checkEligibility({ rule: rule({ requireVolume: ['above-average'] }), detection: detection(), ...base })
    assert.equal(result.eligible, false)
    assert.match(result.blocked.join(' '), /no context was gathered/)
  })

  test('a volume requirement with context is judged on the reading', () => {
    assert.equal(checkEligibility({ rule: rule({ requireVolume: ['above-average'] }), detection: detection(), context: context(), ...base }).eligible, true)
    assert.equal(
      checkEligibility({ rule: rule({ requireVolume: ['above-average'] }), detection: detection(), context: context({ volume: { reading: 'average', relative: 1, sample: 20, describe: '' } }), ...base }).eligible,
      false
    )
  })

  test('a timeframe requirement with no other timeframes examined is unmet', () => {
    const result = checkEligibility({ rule: rule({ requireTimeframeAgreement: ['aligned'] }), detection: detection(), context: context(), ...base })
    assert.equal(result.eligible, false)
    assert.match(result.blocked.join(' '), /none were examined/)
  })

  test('excluding conflicted formations blocks one with a conflict and passes one without', () => {
    const conflicted = context({ conflicts: ['under resistance'] })
    assert.equal(checkEligibility({ rule: rule({ excludeWhenConflicted: true }), detection: detection(), context: conflicted, ...base }).eligible, false)
    assert.equal(checkEligibility({ rule: rule({ excludeWhenConflicted: true }), detection: detection(), context: context(), ...base }).eligible, true)
  })

  test('excluding conflicted formations with no context to check is unmet rather than passed', () => {
    assert.equal(checkEligibility({ rule: rule({ excludeWhenConflicted: true }), detection: detection(), ...base }).eligible, false)
  })

  test('a watchlist rule needs the market to be in the list, and an unknown list is not in scope', () => {
    const watchlist = rule({ scope: 'watchlist', instrumentIds: [] })
    assert.equal(checkEligibility({ rule: watchlist, detection: detection(), ...base, inScope: true }).eligible, true)
    assert.equal(checkEligibility({ rule: watchlist, detection: detection(), ...base, inScope: false }).eligible, false)
    assert.equal(checkEligibility({ rule: watchlist, detection: detection(), instrumentId: base.instrumentId, interval: base.interval }).eligible, false)
  })

  test('how much of what the rule asked for was present is reported as a share of its own conditions', () => {
    const result = checkEligibility({ rule: rule(), detection: detection(), ...base })
    assert.equal(result.satisfied, 1)
  })
})

// ------------------------------------------------------------ priority

describe('priority', () => {
  test('a strong clean match with agreeing context is notable', () => {
    assert.equal(priorityOf(detection({ structuralMatch: 0.7 }), context()), 'notable')
  })

  test('a conflict pulls it down to informational, however strong the match', () => {
    assert.equal(priorityOf(detection({ structuralMatch: 0.95 }), context({ conflicts: ['under resistance'] })), 'informational')
  })

  test('a weak match is informational', () => {
    assert.equal(priorityOf(detection({ structuralMatch: 0.1 }), context()), 'informational')
  })

  test('there is nothing above notable', () => {
    const levels = new Set([
      priorityOf(detection({ structuralMatch: 1 }), context({ agreements: ['a', 'b', 'c', 'd'] })),
      priorityOf(detection({ structuralMatch: 0.7 }), context())
    ])
    assert.deepEqual([...levels], ['notable'])
  })

  test('with no context it is normal rather than notable', () => {
    assert.equal(priorityOf(detection({ structuralMatch: 0.9 })), 'normal')
  })
})

// ------------------------------------------------------------ firing

const fired = (over: Partial<PatternFiring> = {}): PatternFiring => ({
  key: 'r1|binance-spot-BTCUSDT|15m|bullish-engulfing|v1|1700000000000',
  ruleId: 'r1',
  instrumentId: 'binance-spot-BTCUSDT',
  interval: '15m',
  patternId: 'bullish-engulfing',
  patternVersion: 1,
  candleTime: NOW,
  firedAt: NOW,
  priority: 'normal',
  delivered: true,
  deliveryNote: '',
  ...over
})

describe('deciding whether to fire', () => {
  const input = { rule: rule({ cooldownMs: 0 }), detection: detection(), ...base, alreadyFired: [], mutes: [], now: NOW }

  test('an eligible detection nothing has fired for fires', () => {
    const result = decideFiring(input)
    assert.equal(result.fire, true)
    assert.equal(result.reason, 'eligible')
  })

  test('the key is built from the parts that identify the formation', () => {
    assert.equal(decideFiring(input).key, 'r1|binance-spot-BTCUSDT|15m|bullish-engulfing|v1|1700000000000')
  })

  test('the same formation twice fires once, because a refreshed candle is not a new one', () => {
    const first = decideFiring(input)
    const second = decideFiring({ ...input, alreadyFired: [fired({ key: first.key })] })
    assert.equal(second.fire, false)
    assert.equal(second.reason, 'already-fired')
    assert.match(second.describe, /being refreshed does not make it a new one/)
  })

  test('a later candle is a new formation and fires again', () => {
    const first = decideFiring(input)
    const later = decideFiring({ ...input, detection: detection({ at: NOW + 900_000 }), alreadyFired: [fired({ key: first.key })], now: NOW + 900_000 })
    assert.equal(later.fire, true)
  })

  test('a cooldown blocks a different formation on the same market and says how long is left', () => {
    const result = decideFiring({
      ...input,
      rule: rule({ cooldownMs: 600_000 }),
      detection: detection({ at: NOW + 60_000, patternId: 'hammer' }),
      alreadyFired: [fired({ firedAt: NOW })],
      now: NOW + 60_000
    })
    assert.equal(result.fire, false)
    assert.equal(result.reason, 'cooling-down')
    assert.match(result.describe, /of its cooldown remain/)
  })

  test('identity is checked before the cooldown, so the two reasons are not confused', () => {
    const first = decideFiring({ ...input, rule: rule({ cooldownMs: 600_000 }) })
    const again = decideFiring({
      ...input,
      rule: rule({ cooldownMs: 600_000 }),
      alreadyFired: [fired({ key: first.key, firedAt: NOW })],
      now: NOW + 1000
    })
    assert.equal(again.reason, 'already-fired')
  })

  test('a cooldown on another market does not block this one', () => {
    const result = decideFiring({
      ...input,
      rule: rule({ cooldownMs: 600_000 }),
      alreadyFired: [fired({ key: 'r1|binance-spot-ETHUSDT|15m|bullish-engulfing|v1|1700000000000', instrumentId: 'binance-spot-ETHUSDT', firedAt: NOW })],
      now: NOW + 1000
    })
    assert.equal(result.fire, true)
  })

  test('a mute stops it before any reasoning about eligibility', () => {
    const result = decideFiring({ ...input, mutes: [{ instrumentId: 'binance-spot-BTCUSDT', until: NOW + 60_000, reason: 'too noisy' }] })
    assert.equal(result.fire, false)
    assert.equal(result.reason, 'muted')
    assert.match(result.describe, /too noisy/)
  })

  test('an expired mute stops muting', () => {
    const result = decideFiring({ ...input, mutes: [{ instrumentId: 'binance-spot-BTCUSDT', until: NOW - 1, reason: '' }] })
    assert.equal(result.fire, true)
  })

  test('a mute with a field omitted matches everything for that field', () => {
    assert.equal(decideFiring({ ...input, mutes: [{ until: NOW + 1000, reason: 'all quiet' }] }).reason, 'muted')
    assert.equal(decideFiring({ ...input, mutes: [{ patternId: 'hammer', until: NOW + 1000, reason: '' }] }).fire, true)
  })

  test('an ineligible detection reports why rather than a bare refusal', () => {
    const result = decideFiring({ ...input, detection: detection({ structuralMatch: 0 }), rule: rule({ minimumStructuralMatch: 0.5, cooldownMs: 0 }) })
    assert.equal(result.reason, 'not-eligible')
    assert.ok(result.describe.length > 0)
  })
})

// ------------------------------------------------------------ batching and digests

const NAMES = new Map<string, { name: string; direction: PatternDirection }>([
  ['bullish-engulfing', { name: 'Bullish Engulfing', direction: 'bullish' }],
  ['hammer', { name: 'Hammer', direction: 'bullish' }],
  ['shooting-star', { name: 'Shooting Star', direction: 'bearish' }],
  ['doji', { name: 'Doji', direction: 'neutral' }]
])

describe('batching', () => {
  const many: PatternFiring[] = [
    fired({ key: 'a', patternId: 'bullish-engulfing', instrumentId: 'BTC', interval: '15m', priority: 'notable' }),
    fired({ key: 'b', patternId: 'hammer', instrumentId: 'ETH', interval: '1h' }),
    fired({ key: 'c', patternId: 'shooting-star', instrumentId: 'SOL', interval: '15m', priority: 'informational' }),
    fired({ key: 'd', patternId: 'doji', instrumentId: 'BTC', interval: '15m' })
  ]

  test('a batch keeps every firing, each still pointing at its own detection', () => {
    const batch = batchFirings(many, NAMES)
    assert.equal(batch.firings.length, 4)
    assert.deepEqual(batch.firings.map((one) => one.key), ['a', 'b', 'c', 'd'])
  })

  test('it counts by priority, direction and interval', () => {
    const batch = batchFirings(many, NAMES)
    assert.deepEqual(batch.counts, { informational: 1, normal: 2, notable: 1 })
    assert.deepEqual(batch.byDirection, { bullish: 2, bearish: 1, neutral: 1 })
    assert.deepEqual(batch.intervals[0], { interval: '15m', count: 3 })
  })

  test('the headline counts markets, not firings alone', () => {
    assert.match(batchFirings(many, NAMES).headline, /4 candlestick patterns detected across 3 markets/)
  })

  test('the direction counts are said to be counts of formations, not a market reading', () => {
    assert.match(batchFirings(many, NAMES).describe, /not a reading of the market/)
  })

  test('a pattern the name table does not know is still counted in the batch', () => {
    const batch = batchFirings([fired({ key: 'x', patternId: 'unknown-thing' })], new Map())
    assert.equal(batch.firings.length, 1)
    assert.deepEqual(batch.byDirection, { bullish: 0, bearish: 0, neutral: 0 })
  })
})

describe('digests', () => {
  const firings: PatternFiring[] = [
    fired({ key: 'a', patternId: 'hammer', instrumentId: 'BTC', firedAt: NOW + 1000, interval: '15m' }),
    fired({ key: 'b', patternId: 'hammer', instrumentId: 'ETH', firedAt: NOW + 2000, interval: '15m' }),
    fired({ key: 'c', patternId: 'doji', instrumentId: 'BTC', firedAt: NOW + 3000, interval: '1h' }),
    fired({ key: 'd', patternId: 'doji', instrumentId: 'BTC', firedAt: NOW + 999_999, interval: '1h' })
  ]

  test('only firings inside the period are counted', () => {
    const digest = digestOf(firings, 'hour', NOW, NOW + 10_000, NAMES)
    assert.equal(digest.total, 3)
  })

  test('it groups by pattern and by market, most frequent first', () => {
    const digest = digestOf(firings, 'hour', NOW, NOW + 10_000, NAMES)
    assert.deepEqual(digest.byPattern[0], { patternId: 'hammer', count: 2 })
    assert.deepEqual(digest.byMarket[0], { instrumentId: 'BTC', count: 2 })
  })

  test('the busiest interval is the one with the most firings', () => {
    assert.equal(digestOf(firings, 'hour', NOW, NOW + 10_000, NAMES).busiestInterval, '15m')
  })

  test('an empty period says nothing was detected rather than reaching for something', () => {
    const digest = digestOf(firings, 'day', NOW - 10_000_000, NOW - 1, NAMES)
    assert.equal(digest.total, 0)
    assert.match(digest.describe, /Nothing was detected/)
    assert.equal(digest.busiestInterval, null)
  })

  test('a digest says it describes what was found, not what is coming', () => {
    assert.match(digestOf(firings, 'hour', NOW, NOW + 10_000, NAMES).describe, /not what the market is about to do/)
  })
})

describe('the text equivalent', () => {
  test('it names the pattern, market, interval and time, and refuses to imply a direction of price', () => {
    const text = alertText(fired(), 'Bullish Engulfing', 'BTC/USDT', '10:45 PM')
    assert.match(text, /Bullish Engulfing detected on BTC\/USDT, 15m timeframe, at 10:45 PM/)
    assert.match(text, /does not indicate what the price will do next/)
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and rule out a priority above notable', () => {
    assert.equal(Object.isFrozen(ALERT_ASSUMPTIONS), true)
    assert.ok(ALERT_ASSUMPTIONS.some((one) => /no priority above notable/.test(one)))
    assert.ok(ALERT_ASSUMPTIONS.some((one) => /cannot fire twice/.test(one)))
    assert.ok(ALERT_ASSUMPTIONS.some((one) => /counts as unmet/.test(one)))
  })
})
