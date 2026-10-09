import { test } from 'node:test'
import assert from 'node:assert/strict'
import { design, isExperimentProblem, readRecord, run, toRecord, type Plan } from './experiments.ts'

/**
 * The rules this module exists for, checked.
 *
 * The honesty rules are the feature: a prediction recorded before the run, a null result reported as a null
 * result, nothing filled in. Each of those is a thing that could silently stop being true, so each is a test.
 */

const plan = (over: Partial<Parameters<typeof design>[0]> = {}): Plan => {
  const got = design({
    question: 'Does the rate go up with temperature?',
    variable: 'temperature',
    unit: 'K',
    from: 280,
    to: 360,
    points: 9,
    measures: 'rate',
    measureUnit: '1/s',
    expects: 'rises',
    because: 'Arrhenius says the rate constant grows with temperature.',
    ...over
  })
  assert.ok(!isExperimentProblem(got), `the plan was refused: ${JSON.stringify(got)}`)
  return got
}

test('a plan that cannot answer anything is refused, and says why', () => {
  for (const [over, because] of [
    [{ question: 'eh' }, /in a sentence/],
    [{ variable: '' }, /what you are changing/],
    [{ measures: '' }, /what you are reading off/],
    [{ from: 300, to: 300 }, /no width/],
    [{ points: 2 }, /Two points always look/],
    [{ points: 900 }, /500 or fewer/],
    [{ repeats: 0 }, /between 1 and 50/],
    [{ expects: 'sideways' as never }, /Pick one of/]
  ] as const) {
    const got = design({
      question: 'Does the rate go up with temperature?',
      variable: 'temperature',
      from: 280,
      to: 360,
      measures: 'rate',
      expects: 'rises',
      ...over
    })
    assert.ok(isExperimentProblem(got), `${JSON.stringify(over)} should be refused`)
    assert.match(`${got.problem} ${got.fix}`, because)
  }
})

test('a plan changed after it was designed cannot be run as the original', () => {
  // The whole point of the module. Changing the expectation after seeing nothing must not be possible.
  const sealed = plan()
  const tampered: Plan = { ...sealed, expects: 'falls' }
  const got = run(tampered, (at) => at * 2)
  assert.ok(isExperimentProblem(got), 'a changed plan must be refused')
  assert.match(got.problem, /changed since it was designed/)
})

test('an unchanged plan runs', () => {
  const got = run(plan(), (at) => Math.exp(-5000 / at))
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.readings.length, 9)
  assert.equal(got.missed, 0)
})

test('a rise that was predicted is supported', () => {
  const got = run(plan(), (at) => at * 3)
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.shows, 'rises')
  assert.equal(got.supports, 'yes')
  assert.match(got.says, /support it/)
})

test('a fall when a rise was predicted is reported as not supported, not hedged', () => {
  const got = run(plan(), (at) => -at * 3)
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.shows, 'falls')
  assert.equal(got.supports, 'no')
  assert.match(got.says, /do not support it/)
})

test('a flat result is not read as a weak trend', () => {
  // Pure scatter around a constant. This must come back "cannot tell", never "rises a little".
  let seed = 7
  const noisy = (): number => {
    // A fixed sequence, so the test is the same every run. Nothing here reads the clock or Math.random.
    seed = (seed * 1103515245 + 12345) % 2147483648
    return 100 + ((seed / 2147483648) - 0.5) * 4
  }
  const got = run(plan({ repeats: 6 }), noisy)
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.supports, 'cannot-tell')
  assert.match(got.says, /Cannot tell from this run/)
})

test('a trend smaller than the scatter is not a trend', () => {
  // Rises by 1 across the range, with scatter of about 10. It must not be called a rise.
  let seed = 11
  const got = run(plan({ repeats: 8 }), (at) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return at * 0.0125 + ((seed / 2147483648) - 0.5) * 20
  })
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.supports, 'cannot-tell', `it claimed ${got.shows} with noise ${got.noise}`)
})

test('a clean trend is not drowned by its own slope', () => {
  // The opposite failure: with no repeats, the scatter has to be judged from the curve's roughness. A straight
  // line is perfectly smooth, so this must come back as a rise, not as "cannot tell".
  const got = run(plan({ repeats: 1 }), (at) => at * 3)
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.shows, 'rises')
  assert.equal(got.supports, 'yes')
})

test('a peak inside the range is found, and where it is', () => {
  const got = run(plan({ expects: 'peaks', from: 0, to: 10, points: 21 }), (at) => -((at - 5) ** 2) + 30)
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.shows, 'peaks')
  assert.equal(got.supports, 'yes')
  assert.ok(got.peakAt !== null && Math.abs(got.peakAt - 5) < 0.6, `the peak came out at ${got.peakAt}`)
})

test('saturation is reported as levelling off, not as a rise', () => {
  // Both are true of the curve; "levels off" is the more specific and more useful answer.
  const got = run(plan({ expects: 'flattens', from: 0, to: 20, points: 21 }), (at) => 100 * (1 - Math.exp(-at)))
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.shows, 'flattens')
  assert.equal(got.supports, 'yes')
})

test('a point the measurement refuses is recorded as missing, with the reason', () => {
  const got = run(plan({ from: -10, to: 70, points: 9 }), (at) =>
    at < 0 ? { refused: 'a temperature below absolute zero is not a temperature' } : at * 2
  )
  assert.ok(!isExperimentProblem(got))
  assert.ok(got.missed > 0, 'some points should be missing')
  const gap = got.readings.find((one) => one.value === null)
  assert.ok(gap, 'there should be a missing reading')
  assert.match(String(gap.missing), /absolute zero/)
  // And nothing was filled in for it.
  assert.equal(gap.value, null)
})

test('a measurement that throws is caught and recorded, not allowed to stop the run', () => {
  const got = run(plan({ points: 5 }), (at) => {
    if (at > 320) throw new Error('the solver did not converge')
    return at
  })
  assert.ok(!isExperimentProblem(got))
  const gap = got.readings.find((one) => one.value === null)
  assert.ok(gap)
  assert.match(String(gap.missing), /did not converge/)
})

test('a run where almost nothing could be measured is refused rather than reported', () => {
  const got = run(plan({ points: 9 }), (at) => (at < 350 ? { refused: 'out of range' } : at))
  assert.ok(isExperimentProblem(got))
  assert.match(got.problem, /could be measured/)
})

test('repeats are averaged, and their spread is reported', () => {
  const got = run(plan({ repeats: 4 }), (at, repeat) => at + repeat)
  assert.ok(!isExperimentProblem(got))
  const first = got.readings[0]
  // 280, 281, 282, 283 -> mean 281.5, and a real spread.
  assert.ok(Math.abs((first.value ?? 0) - 281.5) < 1e-9)
  assert.ok(first.spread > 1, `the spread was ${first.spread}`)
  assert.equal(first.got, 4)
})

test('no prediction means nothing is supported, and it says so', () => {
  const got = run(plan({ expects: 'unsure' }), (at) => at * 2)
  assert.ok(!isExperimentProblem(got))
  assert.equal(got.supports, 'cannot-tell')
  assert.match(got.says, /No prediction was recorded/)
  // The readings are still reported.
  assert.equal(got.shows, 'rises')
})

test('a record keeps what was seen, and reads back', () => {
  const finding = run(plan(), (at) => at * 3)
  assert.ok(!isExperimentProblem(finding))
  const kept = toRecord(finding, 'one', '2026-10-08T00:00:00.000Z')
  assert.equal(kept.id, 'one')
  assert.equal(kept.supports, 'yes')
  assert.equal(kept.readings.length, 9)

  const back = readRecord(JSON.parse(JSON.stringify(kept)))
  assert.ok(back, 'a record it just wrote must read back')
  assert.equal(back.plan.question, finding.plan.question)
  assert.equal(back.supports, 'yes')
})

test('something that is not a record reads back as null, not as a default', () => {
  // Unreadable is not absent. A caller that gets null must leave the row alone, not write over it.
  for (const not of [null, 42, 'a string', {}, { id: 'x' }, { id: 'x', at: 'y' }]) {
    assert.equal(readRecord(not), null, `${JSON.stringify(not)} is not a record`)
  }
})
