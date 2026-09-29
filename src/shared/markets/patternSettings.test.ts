import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PATTERN_SETTINGS,
  EMPTY_PATTERN_STATE,
  PATTERN_LIMITS,
  SETTINGS_ASSUMPTIONS,
  WHAT_STOPS,
  cleanPatternFiring,
  cleanPatternFirings,
  cleanPatternMutes,
  cleanPatternRecord,
  cleanPatternRecords,
  cleanPatternRule,
  cleanPatternRules,
  cleanPatternSettings,
  cleanPatternState,
  type PatternSettings
} from './patternSettings.ts'

const NOW = 1_700_000_000_000

describe('the defaults', () => {
  test('detection is on and alerts are off', () => {
    assert.equal(DEFAULT_PATTERN_SETTINGS.enabled, true)
    assert.equal(DEFAULT_PATTERN_SETTINGS.alerts, false)
  })

  test('developing formations are off, so nothing unfinished can alert by default', () => {
    assert.equal(DEFAULT_PATTERN_SETTINGS.developing, false)
  })

  test('retention is bounded by default rather than unlimited', () => {
    assert.notEqual(DEFAULT_PATTERN_SETTINGS.retention, 'forever')
  })

  test('the defaults are frozen so nothing can retune them at runtime', () => {
    assert.equal(Object.isFrozen(DEFAULT_PATTERN_SETTINGS), true)
    assert.equal(Object.isFrozen(EMPTY_PATTERN_STATE), true)
  })
})

describe('every switch says what it stops', () => {
  test('there is an entry for every setting, so no control is decorative', () => {
    for (const key of Object.keys(DEFAULT_PATTERN_SETTINGS) as (keyof PatternSettings)[]) {
      assert.ok(Object.prototype.hasOwnProperty.call(WHAT_STOPS, key), `"${key}" has no description of what it stops`)
      assert.ok(WHAT_STOPS[key].length > 20, `"${key}" has no real description`)
    }
  })

  test('there is no entry for a setting that does not exist', () => {
    for (const key of Object.keys(WHAT_STOPS)) {
      assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_PATTERN_SETTINGS, key), `"${key}" is described but is not a setting`)
    }
  })

  test('the master switch says Markets keeps working', () => {
    assert.match(WHAT_STOPS.enabled, /Prices, charts, watchlists and every other Markets alert keep working/)
  })

  test('turning context off says the context conditions become unsatisfiable rather than ignored', () => {
    assert.match(WHAT_STOPS.context, /counts as unmet/)
  })
})

describe('reading settings back', () => {
  test('a file with none of these keys reads as the defaults, not as everything off', () => {
    assert.deepEqual(cleanPatternSettings({}), DEFAULT_PATTERN_SETTINGS)
    assert.deepEqual(cleanPatternSettings(null), DEFAULT_PATTERN_SETTINGS)
    assert.deepEqual(cleanPatternSettings('nonsense'), DEFAULT_PATTERN_SETTINGS)
  })

  test('a stored value is kept and a nonsense one falls back', () => {
    const read = cleanPatternSettings({ mode: 'strict', minimumMatch: 0.5, markerDetail: 'nonsense' })
    assert.equal(read.mode, 'strict')
    assert.equal(read.minimumMatch, 0.5)
    assert.equal(read.markerDetail, DEFAULT_PATTERN_SETTINGS.markerDetail)
  })

  test('a match outside the allowed range is clamped rather than accepted', () => {
    assert.equal(cleanPatternSettings({ minimumMatch: 5 }).minimumMatch, 0.99)
    assert.equal(cleanPatternSettings({ minimumMatch: -1 }).minimumMatch, 0)
  })

  test('an explicitly empty timeframe list is respected, but an absent one is the default', () => {
    assert.deepEqual(cleanPatternSettings({ timeframes: [] }).timeframes, [])
    assert.deepEqual(cleanPatternSettings({}).timeframes, DEFAULT_PATTERN_SETTINGS.timeframes)
  })

  test('accepting unusable data quality is not possible through the reader', () => {
    assert.notEqual(cleanPatternSettings({ minimumDataQuality: 'unusable' }).minimumDataQuality, 'unusable')
  })

  test('the pattern lists are capped and deduplicated', () => {
    const many = Array.from({ length: PATTERN_LIMITS.patterns + 50 }, (_, i) => `p-${i}`)
    assert.equal(cleanPatternSettings({ onlyPatterns: [...many, 'p-0'] }).onlyPatterns.length, PATTERN_LIMITS.patterns)
  })
})

describe('reading a rule back', () => {
  const stored = { id: 'r1', name: 'Hammers', scope: 'instruments', instrumentIds: ['i'], cooldownMs: 60_000 }

  test('a stored rule comes back', () => {
    const rule = cleanPatternRule(stored, NOW)
    assert.equal(rule?.id, 'r1')
    assert.equal(rule?.cooldownMs, 60_000)
  })

  test('a record without an id is refused rather than given one', () => {
    assert.equal(cleanPatternRule({ ...stored, id: undefined }, NOW), null)
    assert.equal(cleanPatternRule({ ...stored, id: '' }, NOW), null)
  })

  test('an absent requirement becomes null and never an empty array', () => {
    const rule = cleanPatternRule(stored, NOW)
    assert.equal(rule?.requireVolume, null)
    assert.equal(rule?.requirePlacement, null)
    assert.equal(rule?.requireTimeframeAgreement, null)
  })

  test('a stored empty requirement array also becomes null, because it could never match', () => {
    const rule = cleanPatternRule({ ...stored, requireVolume: [] }, NOW)
    assert.equal(rule?.requireVolume, null)
  })

  test('a stored non-empty requirement is kept', () => {
    assert.deepEqual(cleanPatternRule({ ...stored, requireVolume: ['above-average'] }, NOW)?.requireVolume, ['above-average'])
  })

  test('a nonsense category is dropped rather than kept', () => {
    assert.deepEqual(cleanPatternRule({ ...stored, categories: ['reversal', 'nonsense'] }, NOW)?.categories, ['reversal'])
  })

  test('rules are deduplicated by id and capped', () => {
    const many = Array.from({ length: PATTERN_LIMITS.rules + 20 }, (_, i) => ({ ...stored, id: `r-${i}` }))
    assert.equal(cleanPatternRules([...many, stored, stored], NOW).length, PATTERN_LIMITS.rules)
    assert.equal(cleanPatternRules([stored, { ...stored, name: 'Again' }], NOW).length, 1)
  })

  test('a rule never reads back as allowing developing candles unless it said so', () => {
    assert.equal(cleanPatternRule(stored, NOW)?.allowDeveloping, false)
    assert.equal(cleanPatternRule({ ...stored, allowDeveloping: true }, NOW)?.allowDeveloping, true)
  })
})

describe('reading a record back', () => {
  const stored = {
    key: 'k1',
    instrumentId: 'i',
    patternId: 'hammer',
    candleTime: NOW,
    patternVersion: 2,
    structuralMatch: 0.7,
    context: { regime: 'range', volume: 'above-average', volatility: 'normal', placement: 'at-support', agreements: 1, conflicts: 0 }
  }

  test('a stored record comes back with its definition version', () => {
    const record = cleanPatternRecord(stored)
    assert.equal(record?.patternVersion, 2)
    assert.equal(record?.context?.regime, 'range')
  })

  test('a record missing what identifies it is refused', () => {
    assert.equal(cleanPatternRecord({ ...stored, key: '' }), null)
    assert.equal(cleanPatternRecord({ ...stored, patternId: undefined }), null)
    assert.equal(cleanPatternRecord({ ...stored, candleTime: 'soon' }), null)
  })

  test('a record with no context reads back with null context, not an invented one', () => {
    assert.equal(cleanPatternRecord({ ...stored, context: undefined })?.context, null)
  })

  test('a nonsense regime falls back to unknown rather than to a real one', () => {
    assert.equal(cleanPatternRecord({ ...stored, context: { ...stored.context, regime: 'nonsense' } })?.context?.regime, 'unknown')
  })

  test('records are deduplicated by key and bounded', () => {
    const many = Array.from({ length: PATTERN_LIMITS.history + 100 }, (_, i) => ({ ...stored, key: `k-${i}`, recordedAt: NOW + i }))
    assert.equal(cleanPatternRecords(many).length, PATTERN_LIMITS.history)
    assert.equal(cleanPatternRecords([stored, stored]).length, 1)
  })

  test('the newest records are the ones kept when the bound is hit', () => {
    const many = Array.from({ length: PATTERN_LIMITS.history + 10 }, (_, i) => ({ ...stored, key: `k-${i}`, recordedAt: NOW + i }))
    const kept = cleanPatternRecords(many)
    assert.equal(kept[kept.length - 1]?.recordedAt, NOW + PATTERN_LIMITS.history + 9)
  })
})

describe('reading a firing back', () => {
  test('a firing is never read back as delivered unless it was recorded as delivered', () => {
    assert.equal(cleanPatternFiring({ key: 'k' })?.delivered, false)
    assert.equal(cleanPatternFiring({ key: 'k', delivered: true })?.delivered, true)
  })

  test('a firing without a key is refused, because the key is what stops it firing twice', () => {
    assert.equal(cleanPatternFiring({ ruleId: 'r' }), null)
  })

  test('firings are deduplicated by key and bounded', () => {
    const many = Array.from({ length: PATTERN_LIMITS.firings + 50 }, (_, i) => ({ key: `k-${i}`, firedAt: NOW + i }))
    assert.equal(cleanPatternFirings(many).length, PATTERN_LIMITS.firings)
  })

  test('a nonsense priority falls back to normal rather than to notable', () => {
    assert.equal(cleanPatternFiring({ key: 'k', priority: 'urgent' })?.priority, 'normal')
  })
})

describe('reading mutes back', () => {
  test('a mute with no expiry is refused', () => {
    assert.deepEqual(cleanPatternMutes([{ instrumentId: 'i' }]), [])
  })

  test('an omitted field stays omitted rather than becoming an empty string', () => {
    const mutes = cleanPatternMutes([{ until: NOW + 1000, reason: 'x' }])
    assert.equal(mutes[0]?.instrumentId, undefined)
    assert.equal(mutes[0]?.patternId, undefined)
  })

  test('expired mutes are dropped when the whole state is read', () => {
    const state = cleanPatternState({ mutes: [{ until: NOW - 1, reason: 'old' }, { until: NOW + 1000, reason: 'current' }] }, NOW)
    assert.equal(state.mutes.length, 1)
    assert.equal(state.mutes[0]?.reason, 'current')
  })
})

describe('reading the whole state back', () => {
  test('an absent section reads as the defaults with nothing in it', () => {
    const state = cleanPatternState(undefined, NOW)
    assert.deepEqual(state.settings, DEFAULT_PATTERN_SETTINGS)
    assert.deepEqual(state.rules, [])
    assert.deepEqual(state.records, [])
  })

  test('a stored section round-trips', () => {
    const state = cleanPatternState(
      {
        settings: { alerts: true, mode: 'research' },
        rules: [{ id: 'r1', name: 'One', scope: 'watchlist' }],
        records: [{ key: 'k1', instrumentId: 'i', patternId: 'hammer', candleTime: NOW }],
        firings: [{ key: 'f1', firedAt: NOW }]
      },
      NOW
    )
    assert.equal(state.settings.alerts, true)
    assert.equal(state.settings.mode, 'research')
    assert.equal(state.rules.length, 1)
    assert.equal(state.records.length, 1)
    assert.equal(state.firings.length, 1)
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and name the switch-not-reset rule', () => {
    assert.equal(Object.isFrozen(SETTINGS_ASSUMPTIONS), true)
    assert.ok(SETTINGS_ASSUMPTIONS.some((one) => /leaves prices, charts, watchlists/.test(one)))
    assert.ok(SETTINGS_ASSUMPTIONS.some((one) => /reads as the defaults/.test(one)))
    assert.ok(SETTINGS_ASSUMPTIONS.some((one) => /never an empty array/.test(one)))
  })
})
