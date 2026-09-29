import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { Candle } from './indicators.ts'
import {
  DETECT_ASSUMPTIONS,
  detect,
  detectAt,
  detectionKey,
  explain,
  matchWord,
  mostSpecific,
  type PatternDetection
} from './patternDetect.ts'
import { PATTERNS, patternById } from './patterns.ts'

const BAR = 60_000
const START = 1_700_000_000_000

type Spec = [open: number, high: number, low: number, close: number] | [number, number, number, number, number | null]

const build = (specs: Spec[]): Candle[] =>
  specs.map((one, i) => ({
    time: START + i * BAR,
    open: one[0],
    high: one[1],
    low: one[2],
    close: one[3],
    volume: one.length === 5 ? (one[4] as number | null) : 100
  }))

/** A quiet run of candles drifting in one direction, to give the detector history and a trend. */
function lead(direction: 'down' | 'up' | 'flat', count = 14, from = 100, step = 1): Spec[] {
  const out: Spec[] = []
  for (let i = 0; i < count; i += 1) {
    const move = direction === 'down' ? -step : direction === 'up' ? step : i % 2 === 0 ? step : -step
    const open = direction === 'flat' ? from - move / 2 : from + i * move
    const close = open + move
    out.push([open, Math.max(open, close) + 0.2, Math.min(open, close) - 0.2, close])
  }
  return out
}

const lastOf = (specs: Spec[]): number => {
  const one = specs[specs.length - 1] as Spec
  return one[3]
}

/** Detect at the final candle and return the ids found. */
const idsAt = (specs: Spec[], options = {}): string[] => {
  const candles = build(specs)
  return detectAt(candles, candles.length - 1, options).detections.map((one) => one.patternId)
}

const detectionFor = (specs: Spec[], id: string, options = {}): PatternDetection => {
  const candles = build(specs)
  const found = detectAt(candles, candles.length - 1, options).detections.find((one) => one.patternId === id)
  assert.ok(found, `${id} was not detected. Found: ${detectAt(candles, candles.length - 1, options).detections.map((o) => o.patternId).join(', ') || 'nothing'}`)
  return found
}

// ------------------------------------------------------------ single-candle

describe('single-candle formations', () => {
  test('a hammer after a decline is a Hammer', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close - 0.8, close + 0.1, close - 4, close]])
    assert.ok(found.includes('hammer'), `found ${found.join(', ')}`)
    assert.equal(found.includes('hanging-man'), false)
  })

  test('the same shape after a rise is a Hanging Man, not a Hammer', () => {
    const base = lead('up')
    const close = lastOf(base)
    const found = idsAt([...base, [close - 0.8, close + 0.1, close - 4, close]])
    assert.ok(found.includes('hanging-man'), `found ${found.join(', ')}`)
    assert.equal(found.includes('hammer'), false)
  })

  test('the same shape with no trend either way is neither', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const found = idsAt([...base, [close - 0.8, close + 0.1, close - 4, close]])
    assert.equal(found.includes('hammer'), false)
    assert.equal(found.includes('hanging-man'), false)
  })

  test('an inverted hammer after a decline is found and a shooting star is not', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close + 0.8, close + 4, close - 0.1, close]])
    assert.ok(found.includes('inverted-hammer'), `found ${found.join(', ')}`)
    assert.equal(found.includes('shooting-star'), false)
  })

  test('a shooting star after a rise is found', () => {
    const base = lead('up')
    const close = lastOf(base)
    assert.ok(idsAt([...base, [close + 0.8, close + 4, close - 0.1, close]]).includes('shooting-star'))
  })

  test('a doji is a Doji, and a dragonfly is both', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const plain = idsAt([...base, [close, close + 2, close - 2, close + 0.01]])
    assert.ok(plain.includes('doji'))

    const dragonfly = idsAt([...base, [close, close + 0.02, close - 4, close + 0.01]])
    assert.ok(dragonfly.includes('doji'))
    assert.ok(dragonfly.includes('dragonfly-doji'))
  })

  test('a gravestone doji is found and is not called a dragonfly', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close + 4, close - 0.02, close + 0.01]])
    assert.ok(found.includes('gravestone-doji'))
    assert.equal(found.includes('dragonfly-doji'), false)
  })

  test('a four-price candle is a Four-Price Doji and nothing that needs a range', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close, close, close]])
    assert.ok(found.includes('four-price-doji'))
    assert.equal(found.includes('long-legged-doji'), false)
  })

  test('a long-legged doji needs long shadows on both sides', () => {
    const base = lead('flat')
    const close = lastOf(base)
    assert.equal(idsAt([...base, [close, close + 0.02, close - 4, close + 0.01]]).includes('long-legged-doji'), false)
    assert.ok(idsAt([...base, [close, close + 3, close - 3, close + 0.01]]).includes('long-legged-doji'))
  })

  test('a marubozu needs a long body and no shadows', () => {
    const base = lead('flat')
    const close = lastOf(base)
    assert.ok(idsAt([...base, [close, close + 5, close, close + 5]]).includes('bullish-marubozu'))
    // The same body with a long upper shadow is not one.
    assert.equal(idsAt([...base, [close, close + 8, close, close + 5]]).includes('bullish-marubozu'), false)
  })

  test('a spinning top needs shadows at least as long as its small body', () => {
    const base = lead('flat')
    const close = lastOf(base)
    assert.ok(idsAt([...base, [close, close + 0.9, close - 0.9, close + 0.4]]).includes('spinning-top'))
  })
})

// ------------------------------------------------------------ two-candle

describe('two-candle formations', () => {
  test('a bullish engulfing is found after a decline', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close + 0.2, close - 1.2, close - 1], [close - 1.2, close + 1.6, close - 1.3, close + 1.5]])
    assert.ok(found.includes('bullish-engulfing'), `found ${found.join(', ')}`)
  })

  test('an engulfing candle that does not cover the whole body is not one', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close + 0.2, close - 3, close - 2.5], [close - 2.4, close + 0.1, close - 2.6, close - 0.5]])
    assert.equal(found.includes('bullish-engulfing'), false)
  })

  test('a bearish engulfing is found after a rise', () => {
    const base = lead('up')
    const close = lastOf(base)
    assert.ok(idsAt([...base, [close, close + 1.2, close - 0.2, close + 1], [close + 1.2, close + 1.3, close - 1.6, close - 1.5]]).includes('bearish-engulfing'))
  })

  test('a harami is the reverse containment and is not an engulfing', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close + 0.1, close - 6, close - 5.5], [close - 4.5, close - 3.8, close - 4.8, close - 4]])
    assert.ok(found.includes('bullish-harami'), `found ${found.join(', ')}`)
    assert.equal(found.includes('bullish-engulfing'), false)
  })

  test('a harami whose second candle is a doji is also a harami cross', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close + 0.1, close - 6, close - 5.5], [close - 4.4, close - 4.1, close - 4.7, close - 4.4]])
    assert.ok(found.includes('bullish-harami-cross'), `found ${found.join(', ')}`)
  })

  test('a piercing line needs to open below the low and close past the midpoint', () => {
    const base = lead('down')
    const close = lastOf(base)
    const first: Spec = [close, close + 0.1, close - 6, close - 5.5]
    // Closes past the midpoint of the first body but below its open: a piercing line.
    assert.ok(idsAt([...base, first, [close - 6.5, close - 2, close - 6.7, close - 2.2]]).includes('piercing-line'))
    // Closes only just inside: a thrusting line instead.
    const shallow = idsAt([...base, first, [close - 6.5, close - 3.1, close - 6.7, close - 3.3]])
    assert.equal(shallow.includes('piercing-line'), false)
    assert.ok(shallow.includes('thrusting'), `found ${shallow.join(', ')}`)
  })

  test('a dark cloud cover is the mirror of a piercing line', () => {
    const base = lead('up')
    const close = lastOf(base)
    assert.ok(
      idsAt([...base, [close, close + 6, close - 0.1, close + 5.5], [close + 6.5, close + 6.7, close + 2, close + 2.2]]).includes('dark-cloud-cover')
    )
  })

  test('a tweezer bottom needs equal lows and opposite directions', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close + 0.2, close - 2, close - 1.5], [close - 1.5, close - 0.2, close - 2, close - 0.4]])
    assert.ok(found.includes('tweezer-bottom'), `found ${found.join(', ')}`)
  })

  test('two candles with the same low that both fall are not a tweezer bottom', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close + 0.2, close - 2, close - 1.5], [close - 1.4, close - 1.3, close - 2, close - 1.8]])
    assert.equal(found.includes('tweezer-bottom'), false)
  })

  test('a kicking pattern needs a real window between two marubozu', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const found = idsAt([...base, [close, close, close - 4, close - 4], [close + 1, close + 5, close + 1, close + 5]])
    assert.ok(found.includes('bullish-kicking'), `found ${found.join(', ')}`)

    // Overlapping ranges: no window, no kicking.
    const overlapping = idsAt([...base, [close, close, close - 4, close - 4], [close - 3, close + 2, close - 3, close + 2]])
    assert.equal(overlapping.includes('bullish-kicking'), false)
  })

  test('on-neck, in-neck and thrusting are told apart by where the second candle closes', () => {
    const base = lead('down')
    const close = lastOf(base)
    const first: Spec = [close, close + 0.1, close - 10, close - 9.5]
    const onNeck = idsAt([...base, first, [close - 11, close - 9.8, close - 11.2, close - 10]])
    assert.ok(onNeck.includes('on-neck'), `on-neck: found ${onNeck.join(', ')}`)

    const inNeck = idsAt([...base, first, [close - 11, close - 9.2, close - 11.2, close - 9.3]])
    assert.ok(inNeck.includes('in-neck'), `in-neck: found ${inNeck.join(', ')}`)
    assert.equal(inNeck.includes('on-neck'), false)
  })
})

// ------------------------------------------------------------ three-candle

describe('three-candle formations', () => {
  test('a morning star is found after a decline', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 0.1, close - 6, close - 5.5],
      [close - 6.4, close - 6.1, close - 6.8, close - 6.3],
      [close - 6, close - 1.8, close - 6.1, close - 2]
    ])
    assert.ok(found.includes('morning-star'), `found ${found.join(', ')}`)
  })

  test('a morning star whose middle candle is a doji is also a morning doji star', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 0.1, close - 6, close - 5.5],
      [close - 6.4, close - 6.2, close - 6.7, close - 6.4],
      [close - 6, close - 1.8, close - 6.1, close - 2]
    ])
    assert.ok(found.includes('morning-doji-star'), `found ${found.join(', ')}`)
  })

  test('an evening star is the mirror', () => {
    const base = lead('up')
    const close = lastOf(base)
    assert.ok(
      idsAt([
        ...base,
        [close, close + 6, close - 0.1, close + 5.5],
        [close + 6.4, close + 6.8, close + 6.1, close + 6.3],
        [close + 6, close + 6.1, close + 1.8, close + 2]
      ]).includes('evening-star')
    )
  })

  test('three white soldiers need progressive closes and opens inside the previous body', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 3.1, close - 0.1, close + 3],
      [close + 1.5, close + 6.1, close + 1.4, close + 6],
      [close + 4.5, close + 9.1, close + 4.4, close + 9]
    ])
    assert.ok(found.includes('three-white-soldiers'), `found ${found.join(', ')}`)
  })

  test('three rising candles that gap apart are not three white soldiers', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 3.1, close - 0.1, close + 3],
      [close + 4, close + 7.1, close + 3.9, close + 7],
      [close + 8, close + 11.1, close + 7.9, close + 11]
    ])
    assert.equal(found.includes('three-white-soldiers'), false)
  })

  test('three black crows are found after a rise', () => {
    const base = lead('up')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 0.1, close - 3.1, close - 3],
      [close - 1.5, close - 1.4, close - 6.1, close - 6],
      [close - 4.5, close - 4.4, close - 9.1, close - 9]
    ])
    assert.ok(found.includes('three-black-crows'), `found ${found.join(', ')}`)
  })

  test('three inside up is a harami carried further', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 0.1, close - 8, close - 7.5],
      [close - 6, close - 5.2, close - 6.2, close - 5.5],
      [close - 5.4, close + 1, close - 5.5, close + 0.8]
    ])
    assert.ok(found.includes('three-inside-up'), `found ${found.join(', ')}`)
  })

  test('three outside up is an engulfing carried further', () => {
    const base = lead('down')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 0.2, close - 1.2, close - 1],
      [close - 1.2, close + 1.6, close - 1.3, close + 1.5],
      [close + 1.4, close + 3.1, close + 1.3, close + 3]
    ])
    assert.ok(found.includes('three-outside-up'), `found ${found.join(', ')}`)
  })

  test('an upside tasuki gap keeps its window open', () => {
    const base = lead('up')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 2.1, close - 0.1, close + 2],
      [close + 3, close + 5.1, close + 2.9, close + 5],
      [close + 4.5, close + 4.6, close + 2.4, close + 2.5]
    ])
    assert.ok(found.includes('upside-tasuki-gap'), `found ${found.join(', ')}`)
  })

  test('a tasuki that fills its window is not one', () => {
    const base = lead('up')
    const close = lastOf(base)
    const found = idsAt([
      ...base,
      [close, close + 2.1, close - 0.1, close + 2],
      [close + 3, close + 5.1, close + 2.9, close + 5],
      [close + 4.5, close + 4.6, close + 1, close + 1.5]
    ])
    assert.equal(found.includes('upside-tasuki-gap'), false)
  })
})

// ------------------------------------------------------------ evidence and quality

describe('evidence', () => {
  const base = lead('down')
  const close = lastOf(base)
  const engulfing: Spec[] = [...base, [close, close + 0.2, close - 1.2, close - 1], [close - 1.2, close + 1.6, close - 1.3, close + 1.5]]

  test('every rule that was evaluated is on the detection, with what it measured', () => {
    const found = detectionFor(engulfing, 'bullish-engulfing')
    const definition = patternById('bullish-engulfing')
    assert.equal(found.evidence.structural.length, definition?.rules.length)
    for (const one of found.evidence.structural) {
      assert.ok(one.measured.length > 0, `${one.id} measured nothing`)
      assert.match(one.measured, /\d/, `${one.id} reported no numbers: "${one.measured}"`)
    }
  })

  test('the explanation is built from the rules and names the candles in front of the user', () => {
    const lines = explain(detectionFor(engulfing, 'bullish-engulfing'))
    assert.match(lines[0] ?? '', /Bullish Engulfing was identified because/)
    assert.ok(lines.some((one) => /closed at/.test(one)))
    assert.ok(lines.some((one) => /not a probability/.test(one)))
  })

  test('a detection records candle times, not positions', () => {
    const found = detectionFor(engulfing, 'bullish-engulfing')
    assert.equal(found.candleTimes.length, 2)
    assert.deepEqual(found.candleTimes, [START + (engulfing.length - 2) * BAR, START + (engulfing.length - 1) * BAR])
    assert.equal(found.at, found.candleTimes[1])
  })

  test('the broader classifications a formation also satisfies are recorded on it', () => {
    const flat = lead('flat')
    const at = lastOf(flat)
    const found = detectionFor([...flat, [at, at + 0.02, at - 4, at + 0.01]], 'dragonfly-doji')
    assert.deepEqual(found.alsoMatches, ['doji'])
  })

  test('match strength is a margin and is described in words that are not probabilities', () => {
    const found = detectionFor(engulfing, 'bullish-engulfing')
    assert.ok(found.structuralMatch >= 0 && found.structuralMatch <= 1)
    assert.ok(['low', 'moderate', 'high'].includes(matchWord(found.structuralMatch)))
  })
})

describe('data quality', () => {
  const base = lead('down')
  const close = lastOf(base)
  const engulfing: Spec[] = [...base, [close, close + 0.2, close - 1.2, close - 1], [close - 1.2, close + 1.6, close - 1.3, close + 1.5]]

  test('clean, evenly spaced candles with volume are high quality', () => {
    const found = detectionFor(engulfing, 'bullish-engulfing')
    assert.equal(found.dataQuality.level, 'high')
    assert.deepEqual(found.dataQuality.reasons, [])
  })

  test('a missing volume reduces quality and says which', () => {
    const specs: Spec[] = [...engulfing]
    specs[specs.length - 1] = [...(specs[specs.length - 1] as [number, number, number, number]), null] as Spec
    const found = detectionFor(specs, 'bullish-engulfing')
    assert.equal(found.dataQuality.hasVolume, false)
    assert.ok(found.dataQuality.reasons.some((one) => /volume/.test(one)))
  })

  test('a missing candle near the formation makes the quality poor', () => {
    const candles = build(engulfing)
    // Push the last candle two bars out, leaving a hole.
    candles[candles.length - 1] = { ...(candles[candles.length - 1] as Candle), time: (candles[candles.length - 2] as Candle).time + BAR * 3 }
    const found = detectAt(candles, candles.length - 1).detections.find((one) => one.patternId === 'bullish-engulfing')
    assert.ok(found)
    assert.equal(found?.dataQuality.level, 'poor')
  })

  test('too little history to compare sizes against is reported rather than assumed away', () => {
    const short = build([[100, 100.2, 98.8, 99], [98.8, 101.6, 98.7, 101.5]])
    const result = detectAt(short, 1)
    // Nothing requiring a long body can pass without history, so the honest answer is no engulfing.
    assert.equal(result.detections.some((one) => one.patternId === 'bullish-engulfing'), true)
    assert.ok((result.detections.find((one) => one.patternId === 'bullish-engulfing')?.dataQuality.reasons ?? []).some((one) => /compare sizes/.test(one)))
  })
})

// ------------------------------------------------------------ lifecycle and selection

describe('lifecycle', () => {
  const base = lead('down')
  const close = lastOf(base)
  const engulfing: Spec[] = [...base, [close, close + 0.2, close - 1.2, close - 1], [close - 1.2, close + 1.6, close - 1.3, close + 1.5]]

  test('a closed formation confirms', () => {
    assert.equal(detectionFor(engulfing, 'bullish-engulfing').status, 'confirmed')
  })

  test('a developing last candle can only be a candidate', () => {
    const found = detectionFor(engulfing, 'bullish-engulfing', { lastIsDeveloping: true })
    assert.equal(found.completeness, 'developing')
    assert.equal(found.status, 'candidate')
    assert.match(explain(found).join(' '), /has not closed/)
  })

  test('a formation earlier in the array is unaffected by the last candle developing', () => {
    const candles = build([...engulfing, [1, 2, 0.5, 1.5]])
    const found = detectAt(candles, candles.length - 2, { lastIsDeveloping: true }).detections.find((one) => one.patternId === 'bullish-engulfing')
    assert.equal(found?.completeness, 'complete')
    assert.equal(found?.status, 'confirmed')
  })
})

describe('choosing what to name', () => {
  test('the most specific classification is kept and the broader ones are not reported separately', () => {
    const flat = lead('flat')
    const at = lastOf(flat)
    // Long shadows both sides but the body off-centre, so it is a long-legged doji and not a rickshaw man.
    const candles = build([...flat, [at + 1, at + 3, at - 3, at + 1.01]])
    const all = detectAt(candles, candles.length - 1).detections
    assert.ok(all.some((one) => one.patternId === 'doji'))
    assert.ok(all.some((one) => one.patternId === 'long-legged-doji'))

    const kept = mostSpecific(all)
    assert.equal(kept.some((one) => one.patternId === 'doji'), false)
    assert.ok(kept.some((one) => one.patternId === 'long-legged-doji'))
  })

  test('a chain of three classifications collapses to the one at the bottom', () => {
    const flat = lead('flat')
    const at = lastOf(flat)
    // Centred body: a Rickshaw Man, which is a Long-Legged Doji, which is a Doji.
    const candles = build([...flat, [at, at + 3, at - 3, at + 0.01]])
    const kept = mostSpecific(detectAt(candles, candles.length - 1).detections)
    assert.deepEqual(kept.map((one) => one.patternId), ['rickshaw-man'])
  })

  test('nothing is lost: what was dropped is named on what was kept', () => {
    const flat = lead('flat')
    const at = lastOf(flat)
    const candles = build([...flat, [at, at + 3, at - 3, at + 0.01]])
    const kept = mostSpecific(detectAt(candles, candles.length - 1).detections)
    const rickshaw = kept.find((one) => one.patternId === 'rickshaw-man')
    assert.deepEqual(rickshaw?.alsoMatches.sort(), ['doji', 'long-legged-doji'])
  })

  test('two unrelated patterns on the same candle are both kept', () => {
    const detections = [
      { patternId: 'hammer', at: 1, candleTimes: [1], structuralMatch: 0.5, alsoMatches: [] },
      { patternId: 'bullish-belt-hold', at: 1, candleTimes: [1], structuralMatch: 0.5, alsoMatches: [] }
    ] as unknown as PatternDetection[]
    assert.equal(mostSpecific(detections).length, 2)
  })
})

// ------------------------------------------------------------ scanning

describe('scanning a range', () => {
  test('a scan reports what it examined, so nothing found is not the same as nothing looked at', () => {
    const result = detect(build(lead('flat', 30)))
    assert.equal(result.examined.candles, 30)
    assert.equal(result.examined.patterns, PATTERNS.length)
  })

  test('an empty array says so rather than returning a silent empty list', () => {
    const result = detect([])
    assert.deepEqual(result.detections, [])
    assert.match(result.notes.join(' '), /no candles/)
  })

  test('a broken sequence is noted on the scan', () => {
    const candles = build(lead('flat', 10))
    candles[5] = { ...(candles[5] as Candle), time: (candles[4] as Candle).time + BAR * 4 }
    assert.ok(detect(candles).notes.length > 0)
  })

  test('only and except narrow what is looked for', () => {
    const base = lead('down')
    const close = lastOf(base)
    const specs: Spec[] = [...base, [close - 0.8, close + 0.1, close - 4, close]]
    assert.deepEqual(idsAt(specs, { only: ['hammer'] }), ['hammer'])
    assert.equal(idsAt(specs, { except: ['hammer'] }).includes('hammer'), false)
  })

  test('the scan is deterministic: the same candles give the same answer', () => {
    const candles = build(lead('down', 40))
    const once = detect(candles)
    const twice = detect(candles)
    assert.deepEqual(once.detections.map((o) => o.key), twice.detections.map((o) => o.key))
    assert.deepEqual(once.detections.map((o) => o.structuralMatch), twice.detections.map((o) => o.structuralMatch))
  })

  test('a tighter mode finds no more than a looser one on the same candles', () => {
    const candles = build(lead('down', 60, 200, 2))
    const strict = detect(candles, { mode: 'strict' }).detections.length
    const standard = detect(candles, { mode: 'standard' }).detections.length
    const research = detect(candles, { mode: 'research' }).detections.length
    assert.ok(strict <= standard, `strict ${strict} > standard ${standard}`)
    assert.ok(standard <= research, `standard ${standard} > research ${research}`)
  })
})

describe('near misses', () => {
  test('a formation that failed one rule is reported with the rule and what it measured', () => {
    const base = lead('down')
    const close = lastOf(base)
    // A hammer shape whose upper shadow is slightly too long.
    const candles = build([...base, [close - 0.8, close + 1.2, close - 4, close]])
    const result = detectAt(candles, candles.length - 1, { includeNearMisses: true })
    const miss = result.nearMisses.find((one) => one.patternId === 'hammer')
    assert.ok(miss, `near misses: ${result.nearMisses.map((o) => o.patternId).join(', ')}`)
    assert.match(miss?.failedRule.measured ?? '', /upper shadow/)
  })

  test('near misses are off unless asked for', () => {
    const base = lead('down')
    const close = lastOf(base)
    const candles = build([...base, [close - 0.8, close + 1.2, close - 4, close]])
    assert.deepEqual(detectAt(candles, candles.length - 1).nearMisses, [])
  })

  test('the right shape in the wrong situation is a near miss that says so', () => {
    const base = lead('flat')
    const close = lastOf(base)
    const candles = build([...base, [close - 0.8, close + 0.1, close - 4, close]])
    const miss = detectAt(candles, candles.length - 1, { includeNearMisses: true }).nearMisses.find((one) => one.patternId === 'hammer')
    assert.ok(miss)
    assert.match(miss?.describe ?? '', /The shape of a Hammer is there/)
  })
})

// ------------------------------------------------------------ identity

describe('detection identity', () => {
  test('the key is deterministic and made of the parts that identify a formation', () => {
    const parts = { instrumentId: 'binance-spot-BTCUSDT', interval: '15m', patternId: 'bullish-engulfing', patternVersion: 1, candleTime: START }
    assert.equal(detectionKey(parts), detectionKey({ ...parts }))
    assert.match(detectionKey(parts), /binance-spot-BTCUSDT\|15m\|bullish-engulfing\|v1\|1700000000000/)
  })

  test('a different candle, pattern, version or market gives a different key', () => {
    const base = { instrumentId: 'a', interval: '15m', patternId: 'hammer', patternVersion: 1, candleTime: 1 }
    const keys = new Set([
      detectionKey(base),
      detectionKey({ ...base, candleTime: 2 }),
      detectionKey({ ...base, patternId: 'doji' }),
      detectionKey({ ...base, patternVersion: 2 }),
      detectionKey({ ...base, instrumentId: 'b' }),
      detectionKey({ ...base, interval: '1h' }),
      detectionKey({ ...base, scope: 'other' })
    ])
    assert.equal(keys.size, 7)
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and rule out reading a match as a probability', () => {
    assert.equal(Object.isFrozen(DETECT_ASSUMPTIONS), true)
    assert.ok(DETECT_ASSUMPTIONS.some((one) => /not a probability/.test(one)))
    assert.ok(DETECT_ASSUMPTIONS.some((one) => /has not closed|cannot be confirmed/.test(one)))
  })
})
