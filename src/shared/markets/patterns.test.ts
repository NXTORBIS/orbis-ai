import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { geometryOf, rollingStats } from './candleGeometry.ts'
import type { Candle } from './indicators.ts'
import {
  ancestorsOf,
  descendantsOf,
  filterPatterns,
  patternById,
  PATTERNS,
  PATTERN_ASSUMPTIONS,
  PATTERN_LIBRARY_VERSION,
  priorTrend,
  searchPatterns,
  TOLERANCES
} from './patterns.ts'

const c = (open: number, high: number, low: number, close: number, volume: number | null = 100): Omit<Candle, 'time'> => ({
  open,
  high,
  low,
  close,
  volume
})

const run = (specs: Omit<Candle, 'time'>[], barMs = 60_000): Candle[] =>
  specs.map((one, i) => ({ ...one, time: 1_700_000_000_000 + i * barMs }))

describe('the library itself', () => {
  test('every pattern has a stable id, a name and at least one rule', () => {
    for (const one of PATTERNS) {
      assert.match(one.id, /^[a-z][a-z0-9-]*$/, `"${one.id}" is not a usable id`)
      assert.ok(one.name.length > 0, `${one.id} has no name`)
      assert.ok(one.rules.length > 0, `${one.id} has no rules`)
      assert.ok(one.formationLength >= 1 && one.formationLength <= 5, `${one.id} has an implausible formation length`)
      assert.ok(one.describe.length > 20, `${one.id} has no real description`)
    }
  })

  test('no two patterns share an id', () => {
    const ids = PATTERNS.map((one) => one.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('every rule inside a pattern has a distinct id', () => {
    for (const one of PATTERNS) {
      const ids = [...one.rules, ...one.contextRules].map((r) => r.id)
      assert.equal(new Set(ids).size, ids.length, `${one.id} has two rules with the same id`)
    }
  })

  test('every rule reads as a sentence about the formation', () => {
    for (const one of PATTERNS) {
      for (const r of [...one.rules, ...one.contextRules]) {
        assert.ok(r.describe.length > 10, `${one.id}/${r.id} has no readable description`)
        assert.equal(r.describe[0], r.describe[0]?.toLowerCase(), `${one.id}/${r.id} should read as a clause, not a sentence`)
      }
    }
  })

  test('every rule only refers to candles inside its own formation', () => {
    for (const one of PATTERNS) {
      for (const r of one.rules) {
        const referenced = [...r.id.matchAll(/candle-(\d+)|body-(\d+)|close-(\d+)|open-(\d+)|window-(\d+)/g)]
          .flatMap((m) => m.slice(1))
          .filter((x): x is string => x !== undefined)
          .map(Number)
        for (const index of referenced) {
          assert.ok(index < one.formationLength, `${one.id}/${r.id} refers to candle ${index} but the formation is ${one.formationLength} long`)
        }
      }
    }
  })

  test('everything a pattern specialises or relates to exists', () => {
    for (const one of PATTERNS) {
      for (const id of [...one.specialises, ...one.related]) {
        assert.ok(patternById(id) !== undefined, `${one.id} refers to "${id}", which is not a pattern`)
      }
    }
  })

  test('nothing specialises itself, directly or through a chain', () => {
    for (const one of PATTERNS) {
      assert.equal(ancestorsOf(one.id).includes(one.id), false, `${one.id} is its own ancestor`)
    }
  })

  test('emphasis indexes fall inside the formation', () => {
    for (const one of PATTERNS) {
      for (const i of one.emphasis) assert.ok(i >= 0 && i < one.formationLength, `${one.id} emphasises candle ${i}`)
    }
  })

  test('a pattern is found by id, and a prototype key is not', () => {
    assert.equal(patternById('hammer')?.name, 'Hammer')
    assert.equal(patternById('constructor'), undefined)
    assert.equal(patternById('__proto__'), undefined)
    assert.equal(patternById('toString'), undefined)
  })

  test('the ancestry chain runs all the way up', () => {
    assert.deepEqual(ancestorsOf('rickshaw-man').sort(), ['doji', 'long-legged-doji'])
    assert.ok(descendantsOf('doji').includes('dragonfly-doji'))
  })

  test('search finds a pattern by name, alias and category', () => {
    assert.ok(searchPatterns('hammer').some((one) => one.id === 'hammer'))
    assert.ok(searchPatterns('White Marubozu').some((one) => one.id === 'bullish-marubozu'))
    assert.ok(searchPatterns('continuation').every((one) => one.category === 'continuation'))
  })

  test('filtering narrows by category, direction and length', () => {
    assert.ok(filterPatterns({ formationLength: 3 }).every((one) => one.formationLength === 3))
    assert.ok(filterPatterns({ direction: 'bullish', category: 'reversal' }).every((one) => one.direction === 'bullish' && one.category === 'reversal'))
  })

  test('the library covers single, two and three candle formations', () => {
    for (const length of [1, 2, 3]) {
      assert.ok(filterPatterns({ formationLength: length }).length >= 5, `too few ${length}-candle patterns`)
    }
  })

  test('the library has a version, and every pattern has one', () => {
    assert.equal(typeof PATTERN_LIBRARY_VERSION, 'number')
    for (const one of PATTERNS) assert.ok(one.version >= 1)
  })

  test('the patterns that are the same shape in different situations exist as separate names', () => {
    const hammer = patternById('hammer')
    const hangingMan = patternById('hanging-man')
    assert.ok(hammer && hangingMan)
    // Same structural rules, different required context. That is the entire distinction.
    assert.deepEqual(hammer?.rules.map((r) => r.id), hangingMan?.rules.map((r) => r.id))
    assert.notDeepEqual(hammer?.contextRules.map((r) => r.id), hangingMan?.contextRules.map((r) => r.id))
  })
})

describe('tolerance modes', () => {
  test('strict is tighter than standard, and research looser, on every threshold that has a direction', () => {
    const { strict, standard, research } = TOLERANCES
    assert.ok(strict.dojiBodyRatio < standard.dojiBodyRatio && standard.dojiBodyRatio < research.dojiBodyRatio)
    assert.ok(strict.longWickRatio > standard.longWickRatio && standard.longWickRatio > research.longWickRatio)
    assert.ok(strict.equality < standard.equality && standard.equality < research.equality)
    assert.ok(strict.longBodyMultiple > standard.longBodyMultiple && standard.longBodyMultiple > research.longBodyMultiple)
  })

  test('the tolerance table is frozen so a caller cannot retune the detector by accident', () => {
    assert.equal(Object.isFrozen(TOLERANCES), true)
    assert.equal(Object.isFrozen(TOLERANCES.standard), true)
  })
})

describe('reading the prior trend', () => {
  const facts = (specs: Omit<Candle, 'time'>[]) => run(specs).map(geometryOf)

  test('a steady decline reads as a decline', () => {
    const candles = run(Array.from({ length: 30 }, (_, i) => c(100 - i, 100.5 - i, 99.5 - i, 99.5 - i)))
    const reading = priorTrend(candles.map(geometryOf), rollingStats(candles, candles.length), TOLERANCES.standard)
    assert.equal(reading.trend, 'down')
  })

  test('a steady rise reads as a rise', () => {
    const candles = run(Array.from({ length: 30 }, (_, i) => c(100 + i, 101 + i, 99.8 + i, 100.8 + i)))
    const reading = priorTrend(candles.map(geometryOf), rollingStats(candles, candles.length), TOLERANCES.standard)
    assert.equal(reading.trend, 'up')
  })

  test('noise around a level is flat, not a trend', () => {
    const candles = run(Array.from({ length: 30 }, (_, i) => {
      const drift = i % 2 === 0 ? 0.3 : -0.3
      return c(100 + drift, 101, 99, 100 - drift)
    }))
    const reading = priorTrend(candles.map(geometryOf), rollingStats(candles, candles.length), TOLERANCES.standard)
    assert.equal(reading.trend, 'flat')
  })

  test('too little history is unknown, which is not the same as flat', () => {
    const reading = priorTrend(facts([c(1, 2, 1, 2), c(2, 3, 2, 3)]), rollingStats(run([c(1, 2, 1, 2)]), 1), TOLERANCES.standard)
    assert.equal(reading.trend, 'unknown')
    assert.match(reading.describe, /needed to call a trend/)
  })

  test('the same move is a trend on a quiet market and noise on a wild one', () => {
    const move = (volatility: number) => {
      const base = (i: number) => 100 + i * 0.2
      return run(
        Array.from({ length: 30 }, (_, i) =>
          c(base(i), Math.max(base(i), base(i) + 0.1) + volatility, Math.min(base(i), base(i) + 0.1) - volatility, base(i) + 0.1)
        )
      )
    }
    const quiet = move(0.05)
    const wild = move(5)
    assert.equal(priorTrend(quiet.map(geometryOf), rollingStats(quiet, quiet.length), TOLERANCES.standard).trend, 'up')
    assert.equal(priorTrend(wild.map(geometryOf), rollingStats(wild, wild.length), TOLERANCES.standard).trend, 'flat')
  })

  test('with no measure of recent movement the trend is unknown rather than guessed', () => {
    const flat = run(Array.from({ length: 30 }, () => c(100, 100, 100, 100)))
    assert.equal(priorTrend(flat.map(geometryOf), rollingStats(flat, flat.length), TOLERANCES.standard).trend, 'unknown')
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and refuse to call a detection a forecast', () => {
    assert.equal(Object.isFrozen(PATTERN_ASSUMPTIONS), true)
    assert.ok(PATTERN_ASSUMPTIONS.some((one) => /not a forecast/.test(one)))
    assert.ok(PATTERN_ASSUMPTIONS.some((one) => /definitions vary/i.test(one)))
  })
})
