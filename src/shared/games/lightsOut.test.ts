import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allOff, generateRound, isLightsSave, pressAll, pressAt, roundPlan, roundScore, solveLights } from './lightsOut.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const off = (size: number): boolean[] => new Array<boolean>(size * size).fill(false)

test('pressing a light flips it and the four beside it, and pressing it again undoes that', () => {
  const size = 4
  const middle = pressAt(off(size), size, 5)
  assert.deepEqual(middle.map((on, i) => (on ? i : -1)).filter((i) => i >= 0), [1, 4, 5, 6, 9])
  assert.equal(allOff(pressAt(middle, size, 5)), true)
  // A light in the corner has only two neighbours, so three lights flip rather than five.
  assert.equal(pressAt(off(size), size, 0).filter(Boolean).length, 3)
  assert.equal(pressAt(off(size), size, size - 1).filter(Boolean).length, 3)
  assert.equal(pressAt(off(size), size, 1).filter(Boolean).length, 4, 'an edge has three neighbours')
})

test('the order you press in makes no difference', () => {
  const size = 5
  const presses = [0, 7, 13, 24, 11]
  const forwards = pressAll(off(size), size, presses)
  const backwards = pressAll(off(size), size, [...presses].reverse())
  assert.deepEqual(forwards, backwards)
  // And pressing the same light twice is the same as not pressing it.
  assert.deepEqual(pressAll(off(size), size, [...presses, 7, 7]), forwards)
})

test('every board this game makes can be cleared, and the answer it gives really clears it', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (const plan of roundPlan(difficulty)) {
      for (let seed = 1; seed <= 25; seed++) {
        const round = generateRound(plan.size, plan.scramble, seeded(seed * 7919 + plan.size))
        assert.equal(round.lights.length, plan.size * plan.size)
        assert.equal(allOff(round.lights), false, 'a board that starts clear is not a puzzle')
        const answer = solveLights(round.lights, round.size)
        assert.ok(answer, `${difficulty} ${plan.size}x${plan.size} seed ${seed} cannot be cleared`)
        assert.equal(allOff(pressAll(round.lights, round.size, answer!)), true)
        assert.equal(round.par, answer!.length)
        assert.ok(round.par >= 1 && round.par <= round.size * round.size)
        // The same board twice gives the same answer, so par is a fact rather than a mood.
        assert.deepEqual(solveLights(round.lights, round.size), answer)
      }
    }
  }
})

test('the answer is the shortest one there is', () => {
  const size = 4
  // Made by pressing three lights, so it can certainly be cleared in three -- and never in more.
  const made = pressAll(off(size), size, [0, 6, 11])
  const answer = solveLights(made, size)
  assert.ok(answer && answer.length <= 3)
  assert.equal(allOff(pressAll(made, size, answer!)), true)
  // A four by four has sixteen different ways to clear any board it can clear; the shortest is the one returned.
  const everyWay: number[][] = []
  for (let mask = 0; mask < 1 << (size * size); mask++) {
    const presses = Array.from({ length: size * size }, (_, i) => i).filter((i) => (mask >> i) & 1)
    if (allOff(pressAll(made, size, presses))) everyWay.push(presses)
  }
  for (const way of everyWay) assert.ok(answer!.length <= way.length)
})

test('a board that cannot be cleared is refused rather than guessed at', () => {
  const size = 5
  const singles = Array.from({ length: size * size }, (_, i) => {
    const lights = off(size)
    lights[i] = true
    return lights
  })
  const refused = singles.filter((lights) => solveLights(lights, size) === null)
  assert.ok(refused.length > 0, 'on five by five, most scattered boards cannot be cleared at all')
  for (const lights of singles) {
    const answer = solveLights(lights, size)
    if (answer) assert.equal(allOff(pressAll(lights, size, answer)), true)
  }
  // Which is the whole reason boards are made by pressing instead.
  const madeByPressing = pressAll(off(size), size, [3, 9, 17])
  assert.ok(solveLights(madeByPressing, size))
})

test('the boards in a run grow, and hard starts where normal gives up', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const plan = roundPlan(difficulty)
    assert.ok(plan.length >= 5)
    for (let i = 1; i < plan.length; i++) assert.ok(plan[i].size >= plan[i - 1].size)
    for (const round of plan) assert.ok(round.scramble >= 3 && round.scramble <= round.size * round.size)
  }
  assert.ok(roundPlan('hard')[0].size > roundPlan('easy')[0].size)
  assert.ok(roundPlan('hard')[0].scramble > roundPlan('normal')[0].scramble)
})

test('clearing a board in par pays most; extra presses and hints cost', () => {
  assert.ok(roundScore(8, 8, 0) > roundScore(8, 14, 0))
  assert.ok(roundScore(8, 8, 0) > roundScore(8, 8, 1))
  assert.ok(roundScore(12, 12, 0) > roundScore(6, 6, 0), 'a harder board is worth more')
  assert.equal(roundScore(1, 400, 9), 20)
})

test('a saved run is only loaded when it is really one', () => {
  const save = { round: 2, size: 4, lights: off(4), par: 3, presses: 1, hints: 0, score: 120 }
  save.lights[0] = true
  assert.equal(isLightsSave(save), true)
  assert.equal(isLightsSave({ ...save, lights: [true] }), false)
  assert.equal(isLightsSave({ ...save, size: 99 }), false)
  assert.equal(isLightsSave({ ...save, round: -1 }), false)
  assert.equal(isLightsSave(null), false)
})
