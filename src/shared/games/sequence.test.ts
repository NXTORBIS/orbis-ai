import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPresses, growBy, growPattern, PANEL_COUNT, PANEL_NAMES, PANEL_TONES, playbackTiming, roundScore, SEQUENCE_LEVELS } from './sequence.ts'

const rng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

test('the pattern grows one panel at a time and never lights the same one three times running', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = rng(seed * 2654435761)
    let pattern: number[] = []
    for (let round = 1; round <= 40; round++) {
      pattern = growPattern(pattern, random)
      assert.equal(pattern.length, round)
      for (const panel of pattern) assert.ok(Number.isInteger(panel) && panel >= 0 && panel < PANEL_COUNT, `panel ${panel} does not exist`)
      for (let i = 2; i < pattern.length; i++)
        assert.ok(!(pattern[i] === pattern[i - 1] && pattern[i] === pattern[i - 2]), `seed ${seed} lit panel ${pattern[i]} three times running`)
    }
    // Over forty rounds every panel should have come up.
    assert.equal(new Set(pattern).size, PANEL_COUNT, `seed ${seed} never used one of the panels`)
  }
  // What came before is never changed, only added to.
  const random = rng(5)
  const start = growPattern([], random, 3)
  const longer = growPattern(start, random, 2)
  assert.deepEqual(longer.slice(0, 3), start)
  assert.equal(longer.length, 5)
})

test('pressing the panels back is judged one press at a time', () => {
  const pattern = [0, 3, 1, 1]
  assert.equal(checkPresses(pattern, []), 'unfinished')
  assert.equal(checkPresses(pattern, [0]), 'unfinished')
  assert.equal(checkPresses(pattern, [0, 3, 1]), 'unfinished')
  assert.equal(checkPresses(pattern, [0, 3, 1, 1]), 'correct')
  assert.equal(checkPresses(pattern, [1]), 'wrong')
  assert.equal(checkPresses(pattern, [0, 3, 2]), 'wrong')
  assert.equal(checkPresses(pattern, [0, 3, 1, 1, 1]), 'wrong', 'one press too many is a mistake')
})

test('the pattern speeds up as it grows, but never past a floor', () => {
  for (const name of ['easy', 'normal', 'hard'] as const) {
    const level = SEQUENCE_LEVELS[name]
    let last = playbackTiming(level, 1)
    assert.equal(last.lit, level.lit, 'the first round plays at the stated speed')
    for (let length = 2; length <= 60; length++) {
      const now = playbackTiming(level, length)
      assert.ok(now.lit <= last.lit && now.gap <= last.gap, 'it never slows back down')
      assert.ok(now.lit >= 150, `a panel lit for ${now.lit}ms is too quick to watch`)
      assert.ok(now.gap >= 60, 'and the gap always shows where one panel ends and the next begins')
      last = now
    }
    assert.ok(playbackTiming(level, 12).lit < level.lit, 'a long pattern really is quicker')
  }
  assert.ok(playbackTiming(SEQUENCE_LEVELS.hard, 5).lit < playbackTiming(SEQUENCE_LEVELS.easy, 5).lit)
})

test('the three settings are really three different games', () => {
  const { easy, normal, hard } = SEQUENCE_LEVELS
  assert.ok(easy.mistakes > normal.mistakes && normal.mistakes > hard.mistakes)
  assert.equal(easy.pressLimit, 0, 'on easy you can take as long as you like')
  assert.ok(normal.pressLimit > hard.pressLimit, 'and the clock is tighter on hard')
  assert.ok(easy.lit > normal.lit && normal.lit > hard.lit)
  assert.equal(growBy(easy, 20), 1, 'easy always grows by one')
  assert.equal(growBy(hard, 5), 1)
  assert.equal(growBy(hard, 6), 2, 'hard adds two at a time once you are going')
})

test('points reward a long pattern played back briskly', () => {
  assert.ok(roundScore(10, 'normal', 3000, 10) > roundScore(3, 'normal', 3000, 3), 'a longer pattern is worth more')
  assert.ok(roundScore(10, 'normal', 2000, 10) > roundScore(10, 'normal', 13000, 10), 'hesitating costs you')
  assert.ok(roundScore(10, 'hard', 3000, 10) > roundScore(10, 'easy', 3000, 10), 'the harder setting counts for more')
  assert.ok(roundScore(1, 'easy', 999999, 1) > 0, 'a round finished always counts for something')
  assert.equal(PANEL_TONES.length, PANEL_COUNT, 'every panel has its own tone')
  assert.equal(new Set(PANEL_TONES).size, PANEL_COUNT, 'and no two are the same')
  assert.equal(PANEL_NAMES.length, PANEL_COUNT)
})
