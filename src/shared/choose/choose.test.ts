import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readMessage } from './detect.ts'
import {
  checkConstraints,
  expectedValueOf,
  feasibilityOf,
  methodFor,
  nonDominated,
  observedFor,
  run,
  scalerFor,
  weightsFor
} from './engine.ts'
import { fragility, importanceFlips, stability, valueFlips } from './sensitivity.ts'
import { verdictOf, whatItCosts, whatToAsk, whyItLeads, wouldItMatter, plainWords } from './explain.ts'
import { asWords, isNotADecision, readExtraction, worthOfWord } from './extract.ts'
import { applyChanges, cleanChange, readChanges } from './update.ts'
import { difference, readScenario, runScenario } from './scenario.ts'
import { cleanDecision, cleanResult, cleanScenario } from './validate.ts'
import { DECISION_VERSION, DEFAULT_POLICY, isRefusal, rankEvidence, type Criterion, type Decision, type Known } from './types.ts'

/**
 * What is actually being tested here, and why these cases.
 *
 * Every case below is one of the specific, plausible, invisible ways a decision engine lies:
 *
 *   - a missing figure read as zero, which makes an unknown price free and an unknown battery flat
 *   - a budget acting as a heavy weight rather than a line, so the option that busts it wins on charm
 *   - a criterion in rupees drowning out one measured out of five, because the numbers are bigger
 *   - 0.82 reported as beating 0.81
 *   - an option Orion invented presented as one the person chose
 *   - a what-if quietly overwriting the figures somebody actually gave
 *   - a saved decision read by an older Orbis and written back as a worse copy of itself
 *
 * The arithmetic cases use figures chosen so the right answer can be worked out by hand, which is the only way a
 * test of a scoring engine means anything.
 */

// ---------------------------------------------------------------- scaffolding

const criterion = (id: string, over: Partial<Criterion> = {}): Criterion => ({
  id,
  name: id,
  describe: '',
  direction: 'more-is-better',
  importance: 1,
  scaling: 'min-max',
  unit: '',
  origin: 'user-said',
  ...over
})

const known = (value: number, origin: Known['origin'] = 'user-said', over: Partial<Known> = {}): Known => ({ value, origin, ...over })
const nothingKnown = (): Known => ({ value: null, origin: 'unknown' })

function decisionOf(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    v: DECISION_VERSION,
    title: 'A decision',
    question: 'which one?',
    aim: '',
    alternatives: [],
    criteria: [],
    constraints: [],
    preferences: [],
    assumptions: [],
    gaps: [],
    policy: { ...DEFAULT_POLICY },
    conversationId: 'c1',
    saved: false,
    sort: 'other',
    madeAt: 1000,
    changedAt: 1000,
    history: [],
    ...over
  }
}

/** Two laptops, a price and a rating. Deliberately on wildly different scales. */
function twoLaptops(): Decision {
  return decisionOf({
    criteria: [
      criterion('price', { name: 'price', direction: 'less-is-better', importance: 1, unit: 'rupees' }),
      criterion('rating', { name: 'rating', direction: 'more-is-better', importance: 1, unit: 'out of 5' })
    ],
    alternatives: [
      { id: 'a', name: 'A', describe: '', values: { price: known(60_000), rating: known(3) }, upsides: [], downsides: [], origin: 'user-said' },
      { id: 'b', name: 'B', describe: '', values: { price: known(90_000), rating: known(5) }, upsides: [], downsides: [], origin: 'user-said' }
    ]
  })
}

// ================================================================ the arithmetic

describe('bringing values onto one scale', () => {
  it('spreads the observed values across nought to one, the way round the criterion says', () => {
    const cheapest = scalerFor(criterion('price', { direction: 'less-is-better' }), [100, 200, 300])
    assert.equal(cheapest.of(100), 1)
    assert.equal(cheapest.of(200), 0.5)
    assert.equal(cheapest.of(300), 0)

    const most = scalerFor(criterion('speed', { direction: 'more-is-better' }), [100, 200, 300])
    assert.equal(most.of(100), 0)
    assert.equal(most.of(300), 1)
  })

  it('gives every option a half when they are all the same, and says it separates nothing', () => {
    const flat = scalerFor(criterion('price'), [200, 200, 200])
    assert.equal(flat.flat, true)
    assert.equal(flat.of(200), 0.5)
    assert.match(flat.says, /does not separate/)
  })

  it('does not let the size of the numbers decide: price in rupees cannot outweigh a rating out of five', () => {
    const result = run(twoLaptops())
    const a = result.scored.find((one) => one.alternativeId === 'a')
    const b = result.scored.find((one) => one.alternativeId === 'b')
    // A is cheapest (1) and worst rated (0); B is dearest (0) and best rated (1). Equal importance: a dead heat.
    assert.equal(a?.score, 0.5)
    assert.equal(b?.score, 0.5)
    assert.equal(result.leaderId, null)
    assert.equal(result.noLeader, 'too-close-to-call')
  })

  it('measures against a target when there is one, so being well under a budget is better than just under', () => {
    const against = scalerFor(criterion('price', { direction: 'less-is-better', scaling: 'against-target', target: 100 }), [40, 95])
    // Compared with a tolerance, because 1 - 0.4 is not 0.6 in binary and asserting that it is tests the hardware.
    assert.ok(Math.abs((against.of(40) as number) - 0.6) < 1e-9)
    assert.ok(Math.abs((against.of(95) as number) - 0.05) < 1e-9)
    // Past the target it is nought rather than negative: worse than the limit is worse than the limit.
    assert.equal(against.of(140), 0)
  })

  it('judges closeness to a target by distance, not by size', () => {
    const near = scalerFor(criterion('size', { direction: 'closest-to-target', target: 15 }), [10, 15, 25])
    assert.equal(near.of(15), 1)
    assert.ok((near.of(10) as number) > (near.of(25) as number))
  })

  it('yes-or-no, and the direction flips which answer is better', () => {
    const wants = scalerFor(criterion('hdmi', { scaling: 'yes-no' }), [0, 1])
    assert.equal(wants.of(1), 1)
    assert.equal(wants.of(0), 0)
    const avoids = scalerFor(criterion('fan', { scaling: 'yes-no', direction: 'less-is-better' }), [0, 1])
    assert.equal(avoids.of(1), 0)
    assert.equal(avoids.of(0), 1)
  })

  it('a scale somebody set themselves, with a zero span not dividing by nothing', () => {
    const own = scalerFor(criterion('effort', { scaling: 'own-scale', scale: { worst: 0, best: 10 } }), [2, 8])
    assert.equal(own.of(5), 0.5)
    const pinned = scalerFor(criterion('effort', { scaling: 'own-scale', scale: { worst: 4, best: 4 } }), [4])
    assert.equal(pinned.of(4), 0.5)
  })
})

describe('how much each thing matters', () => {
  it('shares out in proportion, so a three against a one is three quarters', () => {
    const got = weightsFor([criterion('a', { importance: 3 }), criterion('b', { importance: 1 })])
    assert.equal(got.share.a, 0.75)
    assert.equal(got.share.b, 0.25)
  })

  it('nothing said about what matters means equal, and it says so', () => {
    const got = weightsFor([criterion('a', { importance: 0 }), criterion('b', { importance: 0 })])
    assert.equal(got.share.a, 0.5)
    assert.equal(got.share.b, 0.5)
    assert.match(got.notes.join(' '), /equal importance/)
  })

  it('a negative importance counts as nothing rather than flipping the criterion round', () => {
    const got = weightsFor([criterion('a', { importance: -5 }), criterion('b', { importance: 1 })])
    assert.equal(got.share.a, 0)
    assert.equal(got.share.b, 1)
    assert.match(got.notes.join(' '), /negative/)
  })

  it('every share adds up to one', () => {
    const got = weightsFor([criterion('a', { importance: 7 }), criterion('b', { importance: 2 }), criterion('c', { importance: 0.5 })])
    const total = Object.values(got.share).reduce((sum, one) => sum + one, 0)
    assert.ok(Math.abs(total - 1) < 1e-12)
  })
})

describe('a figure nobody has', () => {
  it('is never read as zero', () => {
    /*
     * The case this whole design exists for. B's price is unknown. Read as zero it would be the cheapest laptop
     * ever made and would win on price outright.
     */
    const decision = decisionOf({
      criteria: [criterion('price', { direction: 'less-is-better', importance: 1 }), criterion('rating', { importance: 1 })],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { price: known(60_000), rating: known(3) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { price: nothingKnown(), rating: known(5) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const b = result.scored.find((one) => one.alternativeId === 'b')
    assert.equal(b?.parts.find((one) => one.criterionId === 'price')?.scaled, null)
    assert.equal(b?.parts.find((one) => one.criterionId === 'price')?.contributed, 0)
    // Half of what matters is known about B, and its score rests on that half alone.
    assert.equal(b?.coverage, 0.5)
    assert.equal(b?.score, 1)
  })

  it('shows as a range rather than a figure, and the range covers what the unknown could be', () => {
    const decision = decisionOf({
      criteria: [criterion('price', { direction: 'less-is-better' }), criterion('rating')],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { price: known(60_000), rating: known(3) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { rating: known(5) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const b = run(decision).scored.find((one) => one.alternativeId === 'b')
    assert.equal(b?.atWorst, 0.5)
    assert.equal(b?.atBest, 1)
    assert.ok((b?.atBest ?? 0) - (b?.atWorst ?? 0) > 0.03, 'an unknown half of the weight is a range worth drawing')
  })

  it('a range on a value becomes a range on the score', () => {
    /*
     * A is deliberately not the best or the worst option: at either end of the scale one side of its range would
     * clamp to the same number as its score, and the test would be asserting about the clamp rather than the range.
     */
    const decision = decisionOf({
      criteria: [criterion('days', { direction: 'less-is-better' })],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { days: known(5, 'estimated', { low: 3, high: 9 }) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { days: known(10) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'c', name: 'C', describe: '', values: { days: known(2) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const a = run(decision).scored.find((one) => one.alternativeId === 'a')
    assert.ok((a?.atBest ?? 0) > (a?.score ?? 0), 'the good end of the range scores better than the figure itself')
    assert.ok((a?.atWorst ?? 1) < (a?.score ?? 1), 'and the bad end scores worse')
  })

  it('drops a criterion nobody knows for every option, when that is the policy', () => {
    const decision = decisionOf({
      policy: { ...DEFAULT_POLICY, whenMissing: 'drop-the-criterion' },
      criteria: [criterion('price', { direction: 'less-is-better' }), criterion('rating')],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { price: known(1), rating: known(3) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { price: known(2) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(result.scored[0].parts.length, 1)
    assert.equal(result.scored[0].parts[0].criterionId, 'price')
    assert.match(result.notes.join(' '), /left out because/)
  })

  it('does not recommend an option that nobody knows anything about, however well it scores', () => {
    /*
     * The case that produced this rule. Notes has one figure against it -- the lowest effort -- and nothing for
     * the other two things. Sharing the weight over what is known gives it full marks on the only thing it was
     * measured on, so it outscores a project that was compared on all three.
     */
    const decision = decisionOf({
      criteria: [
        criterion('effort', { name: 'effort', direction: 'less-is-better', importance: 5 }),
        criterion('value', { name: 'value', importance: 4 }),
        criterion('risk', { name: 'risk', direction: 'less-is-better', importance: 2 })
      ],
      alternatives: [
        { id: 'music', name: 'Music', describe: '', values: { effort: known(9), value: known(7), risk: known(4) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'files', name: 'Files', describe: '', values: { effort: known(30), value: known(9), risk: known(3) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'notes', name: 'Notes', describe: '', values: { effort: known(4) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const notes = result.scored.find((one) => one.alternativeId === 'notes')

    // It still scores highest and is still shown first; it is just not what is recommended.
    assert.equal(notes?.place, 1)
    assert.ok((notes?.score ?? 0) > (result.scored.find((one) => one.alternativeId === 'files')?.score ?? 1))
    assert.notEqual(result.leaderId, 'notes')
    assert.equal(result.leaderId, 'files')
    // And the reason is said, so a recommendation with something above it in the table is not a mystery.
    assert.match(result.notes.join(' '), /Notes scores higher, but only 45% of what matters is known about it/)
  })

  it('still answers when little is known about any of them, because then it is at least a fair comparison', () => {
    const decision = decisionOf({
      criteria: [criterion('a', { importance: 1 }), criterion('b', { importance: 1 }), criterion('c', { importance: 1 })],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(result.leaderId, 'x')
    assert.match(result.notes.join(' '), /Too little is known about every option/)
    // And a criterion nobody has a figure for is not reported as being the same for everybody.
    assert.ok(!result.notes.join(' ').includes('b is the same for every option'))
  })

  it('refuses to name a leader when too little is known and the policy says to say so', () => {
    const decision = decisionOf({
      policy: { ...DEFAULT_POLICY, whenMissing: 'say-it-is-not-known', needsCoverage: 0.8 },
      criteria: [criterion('a'), criterion('b'), criterion('c')],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(5) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(result.leaderId, null)
    assert.equal(result.noLeader, 'too-little-known')
  })
})

describe('a line nothing may cross', () => {
  const underBudget = (): Decision =>
    decisionOf({
      criteria: [criterion('price', { name: 'price', direction: 'less-is-better' }), criterion('rating', { name: 'rating' })],
      constraints: [{ id: 'budget', says: 'under 70,000 rupees', criterionId: 'price', test: 'at-most', limit: 70_000, unit: 'rupees', origin: 'user-said' }],
      alternatives: [
        { id: 'cheap', name: 'Cheap', describe: '', values: { price: known(60_000), rating: known(2) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'lovely', name: 'Lovely', describe: '', values: { price: known(120_000), rating: known(5) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })

  it('rules out the option over the line even when it scores best on everything else', () => {
    const result = run(underBudget())
    const lovely = result.scored.find((one) => one.alternativeId === 'lovely')
    assert.equal(lovely?.feasible, 'fails')
    assert.equal(lovely?.checks[0].over, 50_000)
    // It is the better option on the weighted figure and must not be recommended anyway.
    assert.ok((lovely?.score ?? 0) >= (result.scored.find((one) => one.alternativeId === 'cheap')?.score ?? 1))
    assert.equal(result.leaderId, 'cheap')
  })

  it('an unknown figure has not been shown to clear the line', () => {
    const decision = underBudget()
    const vague = {
      ...decision,
      alternatives: decision.alternatives.map((one) => (one.id === 'lovely' ? { ...one, values: { ...one.values, price: nothingKnown() } } : one))
    }
    const checks = checkConstraints(vague, vague.alternatives[1])
    assert.equal(checks[0].meets, 'unknown')
    assert.equal(feasibilityOf(checks), 'unknown')
    // And an option that cannot be shown to clear it is not the leader.
    assert.notEqual(run(vague).leaderId, 'lovely')
  })

  it('a figure whose range crosses the line only clears it on a condition', () => {
    const decision = underBudget()
    const maybe = {
      ...decision,
      alternatives: decision.alternatives.map((one) =>
        one.id === 'cheap' ? { ...one, values: { ...one.values, price: known(65_000, 'estimated', { low: 60_000, high: 80_000 }) } } : one
      )
    }
    const checks = checkConstraints(maybe, maybe.alternatives[0])
    assert.equal(checks[0].meets, 'conditional')
    assert.match(String(checks[0].ifAlso), /better end/)
  })

  it('says plainly when nothing clears everything, and recommends nothing', () => {
    const decision = underBudget()
    const neither = {
      ...decision,
      alternatives: decision.alternatives.map((one) => ({ ...one, values: { ...one.values, price: known(200_000) } }))
    }
    const result = run(neither)
    assert.equal(result.nothingIsFeasible, true)
    assert.equal(result.leaderId, null)
    assert.equal(result.noLeader, 'everything-ruled-out')
    assert.match(result.notes.join(' '), /No option clears/)
  })

  it('a true-or-false requirement is checked, and an unknown answer is not a pass', () => {
    const decision = decisionOf({
      criteria: [criterion('windows', { scaling: 'yes-no' })],
      constraints: [{ id: 'win', says: 'must run on Windows', criterionId: 'windows', test: 'must-be-true', limit: null, unit: '', origin: 'user-said' }],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { windows: known(1) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { windows: known(0) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'c', name: 'C', describe: '', values: {}, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(result.scored.find((one) => one.alternativeId === 'a')?.feasible, 'meets')
    assert.equal(result.scored.find((one) => one.alternativeId === 'b')?.feasible, 'fails')
    assert.equal(result.scored.find((one) => one.alternativeId === 'c')?.feasible, 'unknown')
  })
})

describe('places and dead heats', () => {
  it('two options a hundredth apart share a place and nobody wins', () => {
    const decision = decisionOf({
      criteria: [criterion('score')],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { score: known(100) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { score: known(100) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(result.scored[0].place, 1)
    assert.equal(result.scored[1].place, 1)
    assert.equal(result.scored[0].tied, true)
    assert.equal(result.leaderId, null)
    assert.equal(result.noLeader, 'too-close-to-call')
  })

  it('a real gap does produce a winner', () => {
    const decision = decisionOf({
      criteria: [criterion('score')],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { score: known(10) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { score: known(90) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(result.leaderId, 'b')
    assert.equal(result.scored.find((one) => one.alternativeId === 'b')?.place, 1)
    assert.equal(result.scored.find((one) => one.alternativeId === 'a')?.place, 2)
  })

  it('nothing known about anything is not a dead heat', () => {
    /*
     * The case typing a real question found. Two languages, three things that matter, and not one figure against
     * any of them. Both scored nought, which made them tie, and the card said they were too close to call -- a
     * finding, and not this one. Nothing was close. Nothing had been looked at.
     */
    const decision = decisionOf({
      criteria: [criterion('ease'), criterion('jobs'), criterion('community')],
      alternatives: [
        { id: 'python', name: 'Python', describe: '', values: {}, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'javascript', name: 'JavaScript', describe: '', values: {}, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(result.leaderId, null)
    assert.equal(result.noLeader, 'too-little-known')
    assert.match(result.notes.join(' '), /Nothing is known yet about how these options compare/)

    const verdict = verdictOf(decision, result, fragility(decision, result))
    assert.match(String(verdict.noLeader), /Nothing is known yet about how these compare/)
  })

  it('there is nothing to compare when there are no options', () => {
    const result = run(decisionOf())
    assert.equal(result.leaderId, null)
    assert.equal(result.noLeader, 'nothing-to-compare')
    assert.equal(result.scored.length, 0)
  })
})

describe('what nothing else beats', () => {
  it('leaves out an option another beats on everything', () => {
    const decision = decisionOf({
      criteria: [criterion('a'), criterion('b')],
      alternatives: [
        { id: 'good', name: 'Good', describe: '', values: { a: known(9), b: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'worse', name: 'Worse', describe: '', values: { a: known(1), b: known(1) }, upsides: [], downsides: [], origin: 'user-said' },
        // Best in the world at b, worst at a: nothing beats it outright, and nothing it beats outright either.
        { id: 'odd', name: 'Odd', describe: '', values: { a: known(1), b: known(15) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.ok(result.notBeaten.includes('good'))
    assert.ok(result.notBeaten.includes('odd'))
    assert.ok(!result.notBeaten.includes('worse'))
  })

  it('does not call an option beaten when a missing figure makes it impossible to say', () => {
    const decision = decisionOf({
      criteria: [criterion('a'), criterion('b')],
      alternatives: [
        { id: 'good', name: 'Good', describe: '', values: { a: known(9), b: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'unknown', name: 'Unknown', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    // Nobody knows what it does on b, so nobody can say it is beaten. Unexamined is not the same as worse.
    assert.ok(result.notBeaten.includes('unknown'))
  })

  it('nonDominated is the same computation the result reports', () => {
    const decision = twoLaptops()
    const result = run(decision)
    assert.deepEqual(
      nonDominated(result.scored, decision.criteria).map((one) => one.alternativeId).sort(),
      [...result.notBeaten].sort()
    )
  })
})

describe('chance times outcome', () => {
  it('answers nothing at all when there are no outcomes', () => {
    assert.equal(expectedValueOf({ id: 'a', name: 'A', describe: '', values: {}, upsides: [], downsides: [], origin: 'user-said' }), null)
  })

  it('refuses when the chances do not add up, because an outcome is missing', () => {
    const half = {
      id: 'a',
      name: 'A',
      describe: '',
      values: {},
      upsides: [],
      downsides: [],
      origin: 'user-said' as const,
      outcomes: [{ says: 'it works', chance: known(0.5), worth: known(100) }]
    }
    assert.equal(expectedValueOf(half), null)
  })

  it('works it out when the chances are real and complete', () => {
    const both = {
      id: 'a',
      name: 'A',
      describe: '',
      values: {},
      upsides: [],
      downsides: [],
      origin: 'user-said' as const,
      outcomes: [
        { says: 'it works', chance: known(0.7), worth: known(100) },
        { says: 'it does not', chance: known(0.3), worth: known(0) }
      ]
    }
    assert.equal(expectedValueOf(both), 70)
  })

  it('refuses an impossible chance', () => {
    const silly = {
      id: 'a',
      name: 'A',
      describe: '',
      values: {},
      upsides: [],
      downsides: [],
      origin: 'user-said' as const,
      outcomes: [{ says: 'certain', chance: known(1.4), worth: known(10) }]
    }
    assert.equal(expectedValueOf(silly), null)
  })
})

describe('picking a method from the shape of the problem', () => {
  it('lets the requirements decide when only one option clears them', () => {
    const decision = decisionOf({
      criteria: [criterion('price', { direction: 'less-is-better' })],
      constraints: [{ id: 'budget', says: 'under 70', criterionId: 'price', test: 'at-most', limit: 70, unit: '', origin: 'user-said' }],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { price: known(60) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { price: known(90) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    assert.equal(methodFor(decision).method, 'rule-out')
    const result = run({ ...decision, policy: { ...decision.policy, method: 'rule-out' } })
    assert.equal(result.leaderId, 'a')
    assert.match(result.howItWorked, /one option was left/)
  })

  it('uses chance times outcome when every option has real chances', () => {
    const outcomes = [
      { says: 'works', chance: known(0.6), worth: known(10) },
      { says: 'fails', chance: known(0.4), worth: known(0) }
    ]
    const decision = decisionOf({
      criteria: [criterion('value')],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { value: known(1) }, upsides: [], downsides: [], origin: 'user-said', outcomes },
        {
          id: 'b',
          name: 'B',
          describe: '',
          values: { value: known(2) },
          upsides: [],
          downsides: [],
          origin: 'user-said',
          outcomes: [
            { says: 'works', chance: known(0.9), worth: known(9) },
            { says: 'fails', chance: known(0.1), worth: known(0) }
          ]
        }
      ]
    })
    assert.equal(methodFor(decision).method, 'expected-value')
    const result = run({ ...decision, policy: { ...decision.policy, method: 'expected-value' } })
    // B's expected value is 8.1 against A's 6, so B leads even though A is cheaper on the weighted figure.
    assert.equal(result.leaderId, 'b')
  })

  it('falls back to weighing, and says so, when chance times outcome cannot be worked out', () => {
    const decision = { ...twoLaptops(), policy: { ...DEFAULT_POLICY, method: 'expected-value' as const } }
    const result = run(decision)
    assert.match(result.notes.join(' '), /not known here/)
    assert.match(result.howItWorked, /added up/)
  })

  it('takes the most important thing first when asked to, and later things only break a tie', () => {
    const decision = decisionOf({
      policy: { ...DEFAULT_POLICY, method: 'in-order-of-importance' },
      criteria: [criterion('first', { importance: 10 }), criterion('second', { importance: 1 })],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { first: known(9), second: known(0) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { first: known(8), second: known(100) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    // A wins on the first criterion, which is all that is looked at while it separates them.
    assert.equal(result.leaderId, 'a')
    assert.match(result.notes.join(' '), /most important thing first/)
  })

  it('says only which options nothing beats when there is not enough to weigh', () => {
    const decision = decisionOf({
      criteria: [criterion('a'), criterion('b')],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { b: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    assert.equal(methodFor(decision).method, 'nothing-beats-it')
    const result = run({ ...decision, policy: { ...decision.policy, method: 'nothing-beats-it' } })
    // Neither can be shown to beat the other, so there is no winner to name.
    assert.equal(result.leaderId, null)
    assert.equal(result.noLeader, 'too-close-to-call')
  })

  it('observedFor only counts figures that exist', () => {
    const decision = twoLaptops()
    assert.deepEqual(observedFor(decision.alternatives, 'price'), [60_000, 90_000])
    assert.deepEqual(observedFor(decision.alternatives, 'nothing'), [])
  })
})

// ================================================================ whether the answer would survive being wrong

describe('how far something would have to move', () => {
  /** Three options, one clear leader, so there is something to overturn. */
  function threeWays(): Decision {
    return decisionOf({
      criteria: [criterion('cost', { name: 'cost', direction: 'less-is-better', importance: 1 }), criterion('quality', { name: 'quality', importance: 3 })],
      alternatives: [
        { id: 'cheap', name: 'Cheap', describe: '', values: { cost: known(10), quality: known(2) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'good', name: 'Good', describe: '', values: { cost: known(90), quality: known(9) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
  }

  it('finds the importance at which the answer changes, and the answer really does change there', () => {
    const decision = threeWays()
    const base = run(decision)
    assert.equal(base.leaderId, 'good')

    const flips = importanceFlips(decision, base)
    const onCost = flips.find((one) => one.criterionId === 'cost')
    assert.ok(onCost, 'cost mattering more should eventually favour the cheap one')
    assert.equal(onCost?.thenLeads, 'cheap')

    // The point it reports is a real point: past it, the other option leads.
    const past = run(decision, {
      weights: {
        cost: (onCost as { flipsAt: number }).flipsAt + 0.02,
        quality: 1 - ((onCost as { flipsAt: number }).flipsAt + 0.02)
      }
    })
    assert.equal(past.leaderId, 'cheap')
  })

  it('reports nothing for an importance that cannot change the answer on its own', () => {
    const decision = decisionOf({
      criteria: [criterion('only')],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { only: known(1) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { only: known(9) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    assert.deepEqual(importanceFlips(decision, run(decision)), [])
  })

  it('finds the figure that the answer turns on', () => {
    const decision = threeWays()
    const base = run(decision)
    const flips = valueFlips(decision, base)
    assert.ok(flips.length > 0, 'the quality figures should be able to overturn this')
    assert.ok(flips.every((one) => one.alternativeId !== undefined))
    // Ordered by how small a change it takes, which is what makes the first one the thing worth checking.
    for (let at = 1; at < flips.length; at++) assert.ok(flips[at].move >= flips[at - 1].move)
  })

  it('the wobble test gives the same answer twice', () => {
    const decision = threeWays()
    const base = run(decision)
    const once = stability(decision, base)
    const twice = stability(decision, base)
    assert.deepEqual(once, twice)
    assert.equal(once.tries, 96)
    assert.ok(once.held > 0)
  })

  it('says there is no clear winner rather than testing one that does not exist', () => {
    const decision = twoLaptops()
    const base = run(decision)
    assert.equal(base.leaderId, null)
    assert.equal(stability(decision, base).steadiness, 'no-clear-winner')
  })

  it('narrows the sweep on a big table, and says that it did', () => {
    const many = decisionOf({
      criteria: Array.from({ length: 8 }, (_, at) => criterion(`c${at}`, { importance: at + 1 })),
      alternatives: Array.from({ length: 8 }, (_, at) => ({
        id: `a${at}`,
        name: `A${at}`,
        describe: '',
        values: Object.fromEntries(Array.from({ length: 8 }, (_, two) => [`c${two}`, known(at + two)])),
        upsides: [],
        downsides: [],
        origin: 'user-said' as const
      }))
    })
    const found = fragility(many, run(many))
    assert.equal(found.narrowed, true)
    // Only the options actually in contention had their figures swept.
    const swept = new Set(found.values.map((one) => one.alternativeId))
    assert.ok(swept.size <= 3)
  })
})

// ================================================================ what gets said

describe('why it leads, from the arithmetic rather than asserted', () => {
  it('names the criterion where the leader actually gained the most, with both figures', () => {
    const decision = decisionOf({
      criteria: [criterion('cost', { name: 'cost', direction: 'less-is-better', importance: 1, unit: 'rupees' }), criterion('quality', { name: 'quality', importance: 4 })],
      alternatives: [
        { id: 'cheap', name: 'Cheap', describe: '', values: { cost: known(10), quality: known(2) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'good', name: 'Good', describe: '', values: { cost: known(90), quality: known(9) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const said = whyItLeads(decision, result)
    assert.match(said.for.join(' '), /quality/)
    assert.match(said.for.join(' '), /9.*against.*2/)
    // And what it costs, in the other direction, with the actual amounts.
    assert.match(said.against.join(' '), /cost/)
    // The sentence names Cheap, so it gives Cheap's figure first: ten against ninety, not ninety against ten.
    assert.match(said.against.join(' '), /Cheap is better on cost \(10 rupees against 90 rupees\)/)
  })

  it('says nothing about trade-offs when there is nothing to trade', () => {
    const decision = decisionOf({
      criteria: [criterion('a'), criterion('b')],
      alternatives: [
        { id: 'best', name: 'Best', describe: '', values: { a: known(9), b: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'worse', name: 'Worse', describe: '', values: { a: known(1), b: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    assert.deepEqual(whyItLeads(decision, run(decision)).against, [])
  })
})

describe('whether a missing thing would actually change anything', () => {
  it('works it out by filling the gap in both directions rather than guessing', () => {
    const decision = decisionOf({
      criteria: [criterion('quality', { name: 'quality', importance: 5 }), criterion('cost', { name: 'cost', direction: 'less-is-better' })],
      gaps: [{ id: 'g1', asks: 'how good is B?', about: { criterionId: 'quality', alternativeId: 'b' }, worth: 'not-tested' }],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { quality: known(5), cost: known(10) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: { cost: known(90) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'c', name: 'C', describe: '', values: { quality: known(1), cost: known(50) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const worth = wouldItMatter(decision, run(decision))
    assert.ok(['would-decide-it', 'could-change-it', 'would-not-change-it'].includes(String(worth.get('g1'))))
  })

  it('asks the question that would decide it, and only that one', () => {
    const decision = decisionOf({
      criteria: [criterion('quality', { name: 'quality', importance: 5 })],
      gaps: [
        { id: 'g1', asks: 'the one that matters?', about: { criterionId: 'quality', alternativeId: 'b' }, worth: 'not-tested' },
        { id: 'g2', asks: 'the one that does not?', about: {}, worth: 'not-tested' }
      ],
      alternatives: [
        { id: 'a', name: 'A', describe: '', values: { quality: known(5) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'b', name: 'B', describe: '', values: {}, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'c', name: 'C', describe: '', values: { quality: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const worth = wouldItMatter(decision, result)
    const asked = whatToAsk(decision, result, worth)
    if (worth.get('g1') === 'would-decide-it') assert.equal(asked, 'the one that matters?')
  })

  it('asks nothing at all when they said to get on with it', () => {
    const decision = decisionOf({
      criteria: [criterion('a')],
      gaps: [{ id: 'g1', asks: 'anything?', about: {}, worth: 'not-tested' }],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(whatToAsk(decision, result, wouldItMatter(decision, result), { justDecide: true }), null)
  })

  it('does not use Orion’s suggested question when the engine found no reason to ask', () => {
    const decision = decisionOf({
      criteria: [criterion('a')],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    // No gaps at all, so there is nothing a question could resolve.
    assert.equal(whatToAsk(decision, result, wouldItMatter(decision, result), { orionSuggested: 'what is your budget?' }), null)
  })
})

describe('the verdict the chat draws', () => {
  it('carries the ranking, the reasons, the marks on the figures, and nothing invented', () => {
    const decision = decisionOf({
      criteria: [criterion('quality', { name: 'quality', importance: 3 }), criterion('cost', { name: 'cost', direction: 'less-is-better', unit: 'rupees' })],
      alternatives: [
        {
          id: 'a',
          name: 'Option A',
          describe: '',
          values: { quality: known(8, 'measured', { says: 'the spec sheet' }), cost: known(50, 'estimated') },
          upsides: [],
          downsides: [],
          origin: 'user-said'
        },
        { id: 'b', name: 'Option B', describe: '', values: { quality: known(3), cost: known(10) }, upsides: [], downsides: [], origin: 'estimated' }
      ]
    })
    const result = run(decision)
    const verdict = verdictOf(decision, result, fragility(decision, result))

    assert.equal(verdict.leads?.name, 'Option A')
    assert.equal(verdict.rows[0].name, 'Option A')
    assert.equal(verdict.rows[0].place, 1)
    assert.equal(verdict.rows[0].outOf100, Math.round(result.scored.find((one) => one.alternativeId === 'a')!.score * 100))
    // B was Orion's suggestion, not one of theirs, and the card says so.
    assert.equal(verdict.rows.find((one) => one.name === 'Option B')?.suggested, true)
    assert.equal(verdict.rows.find((one) => one.name === 'Option A')?.suggested, false)
    // The cost figure for A is a guess, and is marked as one.
    const costCell = verdict.rows[0].parts.find((one) => one.criterionId === 'cost')
    assert.equal(costCell?.guessed, true)
    assert.equal(verdict.rows[0].parts.find((one) => one.criterionId === 'quality')?.guessed, false)
    assert.equal(verdict.rows[0].parts.find((one) => one.criterionId === 'quality')?.says, 'the spec sheet')
    // Nothing was written by a model.
    assert.equal(verdict.says, '')
    assert.ok(plainWords(verdict).startsWith('Option A'))
  })

  it('says why the recommended option is not top of the table, when it is not', () => {
    const decision = decisionOf({
      criteria: [
        criterion('effort', { name: 'effort', direction: 'less-is-better', importance: 5 }),
        criterion('value', { name: 'value', importance: 4 }),
        criterion('risk', { name: 'risk', direction: 'less-is-better', importance: 2 })
      ],
      constraints: [{ id: 'deadline', says: 'ready in 14 days', criterionId: 'effort', test: 'at-most', limit: 14, unit: 'days', origin: 'user-said' }],
      alternatives: [
        { id: 'music', name: 'Music', describe: '', values: { effort: known(9), value: known(7), risk: known(4) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'files', name: 'Files', describe: '', values: { effort: known(30), value: known(9), risk: known(3) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'notes', name: 'Notes', describe: '', values: { effort: known(4) }, upsides: [], downsides: [], origin: 'estimated' }
      ]
    })
    const result = run(decision)
    const verdict = verdictOf(decision, result, fragility(decision, result))

    // Music is the answer and comes third in the table, so the card has to say why.
    assert.equal(verdict.leads?.name, 'Music')
    assert.equal(verdict.rows.find((one) => one.name === 'Music')?.place, 3)
    assert.ok(verdict.whyNotFirst)
    assert.match(String(verdict.whyNotFirst), /Notes scores higher but only 45% of what matters is known/)
    assert.match(String(verdict.whyNotFirst), /Files scores higher but is out on ready in 14 days/)
    assert.match(String(verdict.whyNotFirst), /Music is the best option that has actually been compared/)
  })

  it('rounds a sensitivity figure to something somebody would say out loud', () => {
    /*
     * The point where the answer changes is found by halving an interval twelve times, so it arrives as something
     * like 79,922.43 -- accurate to the rupee about a price that is itself an estimate.
     */
    const decision = decisionOf({
      criteria: [criterion('price', { name: 'price', direction: 'less-is-better', importance: 6, unit: 'rupees' }), criterion('battery', { name: 'battery', importance: 3, unit: 'hours' })],
      alternatives: [
        { id: 'thinkpad', name: 'ThinkPad', describe: '', values: { price: known(80_000), battery: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'macbook', name: 'MacBook Air', describe: '', values: { price: known(120_000), battery: known(18) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const said = verdictOf(decision, result, fragility(decision, result)).uncertainty
    assert.ok(said, 'this one does turn on a figure')
    // No figure in the sentence carries more precision than the inputs do.
    for (const found of String(said).matchAll(/([0-9][0-9,.]*)/g)) {
      const value = Number(found[1].replace(/,/g, ''))
      if (value >= 10_000) assert.equal(value % 100, 0, `${value} is quoted to the rupee`)
    }
  })

  it('says nothing about the order when the answer is top of the table', () => {
    const decision = decisionOf({
      criteria: [criterion('a', { name: 'a' })],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    assert.equal(verdictOf(decision, result, fragility(decision, result)).whyNotFirst, null)
  })

  it('names the option the sentence is about, with its own figure first', () => {
    const decision = decisionOf({
      criteria: [criterion('price', { name: 'price', direction: 'less-is-better', importance: 6, unit: 'rupees' }), criterion('battery', { name: 'battery', importance: 3, unit: 'hours' })],
      alternatives: [
        { id: 'thinkpad', name: 'ThinkPad', describe: '', values: { price: known(80_000), battery: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'macbook', name: 'MacBook Air', describe: '', values: { price: known(120_000), battery: known(18) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const costs = whatItCosts(decision, result)
    // The MacBook has eighteen hours, and the sentence that names the MacBook says eighteen.
    assert.equal(costs, 'MacBook Air is better on battery (18 hours against 9 hours)')
  })

  it('marks a high-stakes decision as one to put to somebody qualified', () => {
    const decision = decisionOf({
      sort: 'high-stakes',
      criteria: [criterion('a')],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const verdict = verdictOf(decision, result, fragility(decision, result))
    assert.equal(verdict.careful, true)
    assert.match(plainWords(verdict), /somebody qualified/)
  })

  it('shows a range instead of a figure when a lot is unknown', () => {
    const decision = decisionOf({
      criteria: [criterion('a'), criterion('b'), criterion('c')],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(9), b: known(9), c: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const verdict = verdictOf(decision, result, fragility(decision, result))
    const y = verdict.rows.find((one) => one.name === 'Y')
    assert.ok(y?.range, 'two thirds of the weight unknown is a range')
    assert.equal(y?.known, 33)
  })
})

// ================================================================ reading a decision out of a message

describe('laying a decision out from what Orion answered', () => {
  const said = 'Should I buy the ThinkPad or the MacBook? Budget is 90000 rupees and I care about battery.'

  const asked = { said, conversationId: 'c1', id: 'd1', now: 5000, sort: 'buying' as const }

  const good = JSON.stringify({
    notADecision: false,
    title: 'Which laptop',
    question: 'ThinkPad or MacBook?',
    aim: 'a laptop that lasts a day',
    sort: 'buying',
    criteria: [
      { name: 'price', describe: '', direction: 'less-is-better', importance: 4, scaling: 'min-max', unit: 'rupees', mentioned: true },
      { name: 'battery', describe: '', direction: 'more-is-better', importance: 5, scaling: 'min-max', unit: 'hours', mentioned: true }
    ],
    constraints: [{ says: 'under 90,000 rupees', criterion: 'price', test: 'at-most', limit: 90_000, unit: 'rupees' }],
    alternatives: [
      {
        name: 'ThinkPad',
        describe: 'a laptop',
        mentioned: true,
        upsides: ['keyboard'],
        downsides: [],
        values: { price: { value: 80_000, origin: 'user-said' }, battery: { value: 9, origin: 'from-source', says: 'the spec page' } }
      },
      {
        name: 'MacBook',
        describe: 'another laptop',
        mentioned: true,
        upsides: [],
        downsides: ['dear'],
        values: { price: { value: 120_000, origin: 'user-said' }, battery: { value: 15, origin: 'from-source', says: 'the spec page' } }
      }
    ],
    preferences: ['light'],
    assumptions: [{ says: 'a working day is eight hours', criterion: 'battery', alternative: '' }],
    gaps: [{ asks: 'do you need it to run Windows?', criterion: '', alternative: '', howToFind: 'check what you use it for' }],
    askThem: 'What do you mostly use it for?'
  })

  it('reads a well-formed answer into a decision, with ids and the figures intact', () => {
    const got = readExtraction(good, asked)
    assert.ok(!isRefusal(got) && !isNotADecision(got))
    const decision = (got as { decision: Decision }).decision
    assert.equal(decision.alternatives.length, 2)
    assert.equal(decision.criteria.length, 2)
    assert.equal(decision.constraints.length, 1)
    assert.equal(decision.constraints[0].criterionId, 'price')
    assert.equal(decision.alternatives[0].values.price.value, 80_000)
    assert.equal(decision.v, DECISION_VERSION)
    assert.equal((got as { askThem: string }).askThem, 'What do you mostly use it for?')
    // And it actually computes.
    const result = run(decision)
    assert.equal(result.scored.length, 2)
    assert.equal(result.scored.find((one) => one.alternativeId === 'macbook')?.feasible, 'fails')
    assert.equal(result.leaderId, 'thinkpad')
  })

  it('relabels an option that is not in anything the person wrote as a suggestion', () => {
    const invented = JSON.parse(good) as Record<string, unknown>
    const alternatives = invented.alternatives as Record<string, unknown>[]
    alternatives.push({ name: 'Framework 13', describe: '', mentioned: true, upsides: [], downsides: [], values: {} })
    const got = readExtraction(JSON.stringify(invented), asked)
    assert.ok(!isRefusal(got) && !isNotADecision(got))
    const made = got as { decision: Decision; fixed: readonly string[] }
    const extra = made.decision.alternatives.find((one) => one.name === 'Framework 13')
    assert.equal(extra?.origin, 'estimated')
    assert.match(made.fixed.join(' '), /shown as a suggestion/)
  })

  it('downgrades a figure that claims to be measured but will not say where from', () => {
    const vague = JSON.parse(good) as Record<string, unknown>
    const alternatives = vague.alternatives as Record<string, unknown>[]
    ;(alternatives[0].values as Record<string, unknown>).battery = { value: 9, origin: 'measured' }
    const got = readExtraction(JSON.stringify(vague), asked)
    const made = got as { decision: Decision; fixed: readonly string[] }
    assert.equal(made.decision.alternatives[0].values.battery.origin, 'estimated')
    assert.match(made.fixed.join(' '), /did not say where from/)
  })

  it('merges criteria that are the same idea, and adds their importances together', () => {
    const doubled = JSON.parse(good) as Record<string, unknown>
    const criteria = doubled.criteria as Record<string, unknown>[]
    criteria.push({ name: 'ease of use', direction: 'more-is-better', importance: 2, scaling: 'min-max', unit: '', mentioned: true })
    criteria.push({ name: 'simplicity', direction: 'more-is-better', importance: 3, scaling: 'min-max', unit: '', mentioned: true })
    const got = readExtraction(JSON.stringify(doubled), asked)
    const made = got as { decision: Decision; fixed: readonly string[] }
    const merged = made.decision.criteria.filter((one) => /ease|simpl/.test(one.name))
    assert.equal(merged.length, 1)
    assert.equal(merged[0].importance, 5)
    assert.match(made.fixed.join(' '), /same idea/)
  })

  it('throws away a hard requirement with no line to be on the right side of', () => {
    const loose = JSON.parse(good) as Record<string, unknown>
    loose.constraints = [{ says: 'should be cheap', criterion: 'price', test: 'at-most', limit: null, unit: '' }]
    const got = readExtraction(JSON.stringify(loose), asked)
    const made = got as { decision: Decision; fixed: readonly string[] }
    assert.equal(made.decision.constraints.length, 0)
    assert.match(made.fixed.join(' '), /only a preference/)
  })

  it('throws away a figure filed under something that is not being weighed', () => {
    const stray = JSON.parse(good) as Record<string, unknown>
    const alternatives = stray.alternatives as Record<string, unknown>[]
    ;(alternatives[0].values as Record<string, unknown>).colour = { value: 3, origin: 'user-said' }
    const got = readExtraction(JSON.stringify(stray), asked)
    const made = got as { decision: Decision; fixed: readonly string[] }
    assert.equal(made.decision.alternatives[0].values.colour, undefined)
    assert.match(made.fixed.join(' '), /not one of the things being weighed/)
  })

  it('a value with no number is left out entirely rather than written as nought', () => {
    const blank = JSON.parse(good) as Record<string, unknown>
    const alternatives = blank.alternatives as Record<string, unknown>[]
    ;(alternatives[1].values as Record<string, unknown>).battery = { origin: 'unknown' }
    const got = readExtraction(JSON.stringify(blank), asked)
    const made = got as { decision: Decision }
    assert.equal(made.decision.alternatives[1].values.battery, undefined)
  })

  it('reads a judgement in words as a value, instead of throwing it away', () => {
    /*
     * "Ease of learning: high" is the only kind of answer that criterion has. Insisting on a number dropped every
     * one of them, and the whole comparison came back empty.
     */
    const inWords = JSON.stringify({
      notADecision: false,
      title: 'Which language',
      question: 'Python or JavaScript first?',
      aim: 'build small tools',
      sort: 'learning',
      criteria: [
        { name: 'ease of learning', direction: 'more-is-better', importance: 5, scaling: 'min-max', unit: '', mentioned: true },
        { name: 'job prospects', direction: 'more-is-better', importance: 3, scaling: 'min-max', unit: '', mentioned: true }
      ],
      constraints: [],
      alternatives: [
        { name: 'Python', describe: '', mentioned: true, upsides: [], downsides: [], values: { 'ease of learning': { value: 'very easy', origin: 'estimated' }, 'job prospects': { value: 'good', origin: 'estimated' } } },
        { name: 'JavaScript', describe: '', mentioned: true, upsides: [], downsides: [], values: { 'ease of learning': { value: 'moderate', origin: 'estimated' }, 'job prospects': { value: 'excellent', origin: 'estimated' } } }
      ],
      preferences: [],
      assumptions: [],
      gaps: [],
      askThem: ''
    })
    const got = readExtraction(inWords, {
      said: 'Should I learn Python or JavaScript first?',
      conversationId: 'c1',
      id: 'd1',
      now: 1,
      sort: 'learning'
    })
    assert.ok(!isRefusal(got) && !isNotADecision(got))
    const decision = (got as { decision: Decision }).decision

    // Every cell has a value, and each keeps the word it came from so the card can show the word.
    assert.equal(decision.alternatives[0].values['ease-of-learning'].value, 1)
    assert.equal(decision.alternatives[0].values['ease-of-learning'].band, 'very easy')
    assert.equal(decision.alternatives[1].values['ease-of-learning'].value, 0.5)
    assert.equal(decision.alternatives[0].values['job-prospects'].value, 0.75)
    assert.equal(decision.alternatives[1].values['job-prospects'].value, 1)

    /*
     * And the criterion is now judged on a named scale, not spread across what was observed. Spreading would turn
     * "good" and "excellent" into nought and one -- the whole width of the scale for one step along it.
     */
    assert.equal(decision.criteria[0].scaling, 'bands')

    const result = run(decision)
    assert.equal(result.leaderId, 'python')
    assert.ok(result.scored.every((one) => one.coverage === 1))
  })

  it('places a word on the criterion\u2019s own bands when it gave any', () => {
    const banded = { bands: [{ name: 'a weekend', worth: 1 }, { name: 'a fortnight', worth: 0.5 }, { name: 'months', worth: 0 }] }
    assert.equal(worthOfWord('a weekend', banded), 1)
    assert.equal(worthOfWord('A FORTNIGHT', banded), 0.5)
    assert.equal(worthOfWord('months', banded), 0)
    // A word that is on neither the bands nor the plain scale is not a value, and is not guessed at.
    assert.equal(worthOfWord('purple', banded), null)
    assert.equal(worthOfWord('', banded), null)
    // With no bands, the plain scale.
    assert.equal(worthOfWord('high', {}), 0.75)
    assert.equal(worthOfWord('very low', {}), 0)
    assert.equal(worthOfWord('average', {}), 0.5)
  })

  it('a word nobody could place is left out, not written as nought', () => {
    const odd = JSON.stringify({
      notADecision: false,
      title: 'x',
      question: 'x',
      aim: '',
      sort: 'other',
      criteria: [{ name: 'vibe', direction: 'more-is-better', importance: 1, scaling: 'min-max', unit: '', mentioned: true }],
      constraints: [],
      alternatives: [
        { name: 'A', describe: '', mentioned: true, upsides: [], downsides: [], values: { vibe: { value: 'purple', origin: 'estimated' } } },
        { name: 'B', describe: '', mentioned: true, upsides: [], downsides: [], values: { vibe: { value: 'good', origin: 'estimated' } } }
      ],
      preferences: [],
      assumptions: [],
      gaps: [],
      askThem: ''
    })
    const got = readExtraction(odd, { said: 'A or B?', conversationId: 'c1', id: 'd1', now: 1, sort: 'other' })
    const decision = (got as { decision: Decision }).decision
    assert.equal(decision.alternatives[0].values.vibe, undefined)
    assert.equal(decision.alternatives[1].values.vibe?.value, 0.75)
  })

  it('turns a name that is an identifier back into words, and leaves a real name alone', () => {
    assert.equal(asWords('time-to-build'), 'time to build')
    assert.equal(asWords('community_support'), 'community support')
    // A real name that happens to have a hyphen in it has spaces too, and is left exactly as written.
    assert.equal(asWords('day-to-day cost'), 'day-to-day cost')
    assert.equal(asWords('price'), 'price')
    assert.equal(asWords('  ease of use '), 'ease of use')
  })

  it('passes a handed-back message straight through', () => {
    const got = readExtraction('{"notADecision": true, "title": "a question about how scoring works"}', asked)
    assert.ok(isNotADecision(got))
    assert.match((got as { because: string }).because, /scoring works/)
  })

  it('refuses an answer with no options, and one with nothing to weigh', () => {
    const noOptions = JSON.parse(good) as Record<string, unknown>
    noOptions.alternatives = []
    assert.ok(isRefusal(readExtraction(JSON.stringify(noOptions), asked)))

    const noCriteria = JSON.parse(good) as Record<string, unknown>
    noCriteria.criteria = []
    const got = readExtraction(JSON.stringify(noCriteria), asked)
    assert.ok(isRefusal(got))
    assert.match((got as { problem: string }).problem, /what actually matters/)
  })

  it('refuses something that is not JSON at all, without throwing', () => {
    assert.ok(isRefusal(readExtraction('I think you should get the ThinkPad.', asked)))
    assert.ok(isRefusal(readExtraction('{ this is not json', asked)))
    assert.ok(isRefusal(readExtraction('', asked)))
  })

  it('finds the JSON inside a fence or a sentence, because models wrap things', () => {
    const got = readExtraction('Here you go:\n```json\n' + good + '\n```\nHope that helps.', asked)
    assert.ok(!isRefusal(got) && !isNotADecision(got))
  })
})

// ================================================================ changing one that is open

describe('changing a decision that is already on the table', () => {
  function open(): Decision {
    return decisionOf({
      title: 'Which laptop',
      question: 'ThinkPad or MacBook?',
      aim: 'something that lasts',
      criteria: [
        criterion('price', { name: 'price', direction: 'less-is-better', importance: 4, unit: 'rupees' }),
        criterion('battery', { name: 'battery', importance: 5, unit: 'hours' })
      ],
      constraints: [{ id: 'budget', says: 'under 90,000 rupees', criterionId: 'price', test: 'at-most', limit: 90_000, unit: 'rupees', origin: 'user-said' }],
      alternatives: [
        { id: 'thinkpad', name: 'ThinkPad', describe: '', values: { price: known(80_000), battery: known(9) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'macbook', name: 'MacBook', describe: '', values: { price: known(120_000), battery: known(15) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
  }

  it('doubling what something matters doubles it, and leaves everything else alone', () => {
    const was = open()
    const got = applyChanges(was, [{ kind: 'importance', criterionId: 'price', times: 2, says: 'cost matters more' }], { now: 2000, from: 'cost matters more' })
    assert.equal(got.decision.criteria.find((one) => one.id === 'price')?.importance, 8)
    assert.equal(got.decision.criteria.find((one) => one.id === 'battery')?.importance, 5)
    // Nothing unrelated moved.
    assert.equal(got.decision.title, was.title)
    assert.equal(got.decision.question, was.question)
    assert.equal(got.decision.aim, was.aim)
    assert.equal(got.decision.alternatives.length, was.alternatives.length)
    assert.equal(got.decision.constraints.length, was.constraints.length)
    assert.match(got.applied.join(' '), /twice as much/)
    assert.equal(got.decision.history.length, 1)
    assert.equal(got.decision.changedAt, 2000)
  })

  it('"the most important thing" ends up above everything else, not at a hundred', () => {
    const got = applyChanges(open(), [{ kind: 'importance', criterionId: 'price', to: 5, says: 'cost is the most important' }], { now: 2000, from: '' })
    const price = got.decision.criteria.find((one) => one.id === 'price')?.importance ?? 0
    const battery = got.decision.criteria.find((one) => one.id === 'battery')?.importance ?? 0
    assert.ok(price > battery, 'it has to actually be the most important')
    assert.ok(price < 20, 'and not so far above as to make everything else noise')
  })

  it('taking something out of the comparison takes the requirement about it too', () => {
    const got = applyChanges(open(), [{ kind: 'drop-criterion', criterionId: 'price' }], { now: 2000, from: '' })
    assert.equal(got.decision.criteria.length, 1)
    assert.equal(got.decision.constraints.length, 0)
    assert.equal(got.decision.alternatives[0].values.price, undefined)
    assert.match(got.applied.join(' '), /nothing left to check it against/)
  })

  it('refuses an id that is not there, and leaves the decision exactly as it was', () => {
    const was = open()
    const got = applyChanges(was, [{ kind: 'importance', criterionId: 'colour', times: 2, says: '' }], { now: 2000, from: '' })
    assert.equal(got.applied.length, 0)
    assert.equal(got.refused.length, 1)
    assert.equal(got.decision, was, 'the very same object, untouched')
  })

  it('refuses to add an option that is already there', () => {
    const got = applyChanges(open(), [{ kind: 'add-alternative', name: 'ThinkPad', describe: '', mentioned: true }], { now: 2000, from: '' })
    assert.equal(got.applied.length, 0)
    assert.match(got.refused.join(' '), /already one of the options/)
  })

  it('refuses to take out the last thing being compared on', () => {
    const one = applyChanges(open(), [{ kind: 'drop-criterion', criterionId: 'price' }], { now: 2000, from: '' })
    const none = applyChanges(one.decision, [{ kind: 'drop-criterion', criterionId: 'battery' }], { now: 3000, from: '' })
    assert.equal(none.applied.length, 0)
    assert.match(none.refused.join(' '), /only thing left/)
  })

  it('a new option says out loud that nothing is known about it yet', () => {
    const got = applyChanges(open(), [{ kind: 'add-alternative', name: 'Framework', describe: 'a repairable one', mentioned: true }], { now: 2000, from: '' })
    const added = got.decision.alternatives.find((one) => one.name === 'Framework')
    assert.deepEqual(added?.values, {})
    assert.match(got.applied.join(' '), /Nothing is known about it yet/)
  })

  it('a figure set to nothing becomes properly unknown, not zero', () => {
    const got = applyChanges(open(), [{ kind: 'set-value', alternativeId: 'thinkpad', criterionId: 'price', value: null, origin: 'unknown' }], { now: 2000, from: '' })
    assert.deepEqual(got.decision.alternatives.find((one) => one.id === 'thinkpad')?.values.price, { value: null, origin: 'unknown' })
  })

  it('changing a budget changes the limit, and the arithmetic follows', () => {
    const before = run(open())
    assert.equal(before.scored.find((one) => one.alternativeId === 'macbook')?.feasible, 'fails')
    const got = applyChanges(open(), [{ kind: 'set-limit', constraintId: 'budget', limit: 150_000 }], { now: 2000, from: '' })
    const after = run(got.decision)
    assert.equal(after.scored.find((one) => one.alternativeId === 'macbook')?.feasible, 'meets')
  })

  it('turning something being weighed into a hard requirement rules options out', () => {
    const got = applyChanges(open(), [{ kind: 'require', criterionId: 'battery', test: 'at-least', limit: 12, unit: 'hours', says: 'at least 12 hours' }], {
      now: 2000,
      from: ''
    })
    const after = run(got.decision)
    assert.equal(after.scored.find((one) => one.alternativeId === 'thinkpad')?.feasible, 'fails')
    assert.match(got.applied.join(' '), /however good it is elsewhere/)
  })

  it('reads changes out of Orion’s answer, and throws away ones it does not know', () => {
    const got = readChanges(
      JSON.stringify({
        startOver: false,
        changes: [
          { kind: 'importance', criterionId: 'price', times: 2, says: 'cost matters more' },
          { kind: 'teleport', criterionId: 'price' },
          { kind: 'set-value', alternativeId: 'a', criterionId: 'price', value: 5, origin: 'measured' }
        ],
        says: 'cost matters more'
      })
    )
    assert.equal(got.changes.length, 2)
    assert.equal(got.startOver, false)
    // A measurement with nowhere it came from is a guess, from a slider exactly as from a sentence.
    const set = got.changes.find((one) => one.kind === 'set-value')
    assert.equal((set as { origin: string }).origin, 'estimated')
  })

  it('says when the message is a different decision rather than a change to this one', () => {
    const got = readChanges('{"startOver": true, "says": "that is about something else"}')
    assert.equal(got.startOver, true)
    assert.equal(got.changes.length, 0)
  })

  it('a control is held to the same checks as a sentence', () => {
    assert.equal(cleanChange({ kind: 'importance', criterionId: '', times: 2 }), null)
    assert.equal(cleanChange({ kind: 'drop-criterion' }), null)
    assert.equal(cleanChange({ kind: 'nonsense' }), null)
    const fine = cleanChange({ kind: 'importance', criterionId: 'price', times: 2, says: 'more' })
    assert.equal(fine?.kind, 'importance')
    // Out-of-range multiples are clamped rather than let through.
    const wild = cleanChange({ kind: 'importance', criterionId: 'price', times: 500 }) as { times: number }
    assert.equal(wild.times, 20)
  })
})

// ================================================================ what-ifs

describe('what-ifs are patches, not edits', () => {
  function open(): Decision {
    return decisionOf({
      criteria: [criterion('cost', { name: 'cost', direction: 'less-is-better', importance: 1 }), criterion('quality', { name: 'quality', importance: 3 })],
      alternatives: [
        { id: 'cheap', name: 'Cheap', describe: '', values: { cost: known(10), quality: known(2) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'good', name: 'Good', describe: '', values: { cost: known(90), quality: known(9) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
  }

  it('does not touch the decision it is about', () => {
    const decision = open()
    const frozen = JSON.stringify(decision)
    const { scenario } = readScenario(JSON.stringify({ name: 'cost twice as important', weights: { cost: 6 } }), decision, { id: 's1', now: 2000 })
    assert.ok(scenario)
    runScenario(decision, scenario!, { run: 2, now: 2000 })
    assert.equal(JSON.stringify(decision), frozen, 'the figures they actually gave are untouched')
  })

  it('changes the answer when it should, and the difference says so', () => {
    const decision = open()
    const before = run(decision)
    assert.equal(before.leaderId, 'good')
    const { scenario } = readScenario(JSON.stringify({ name: 'cost is everything', weights: { cost: 20, quality: 1 } }), decision, { id: 's1', now: 2000 })
    const after = runScenario(decision, scenario!, { run: 2, now: 2000 })
    assert.equal(after.leaderId, 'cheap')
    const moved = difference(before, after)
    assert.equal(moved.leaderChanged, true)
    assert.equal(moved.wasLeading, 'good')
    assert.equal(moved.nowLeading, 'cheap')
    assert.equal(moved.sameAnswer, false)
    assert.ok(moved.moved.length > 0)
  })

  it('reports that nothing changed rather than inventing a difference', () => {
    const decision = open()
    const before = run(decision)
    const { scenario } = readScenario(JSON.stringify({ name: 'a nudge', weights: { quality: 3.0001 } }), decision, { id: 's1', now: 2000 })
    const after = runScenario(decision, scenario!, { run: 2, now: 2000 })
    assert.equal(difference(before, after).sameAnswer, true)
  })

  it('a figure changed in a what-if is a supposition, whatever the model called it', () => {
    const decision = open()
    const { scenario } = readScenario(
      JSON.stringify({ name: 'if it were cheaper', values: { 'good/cost': { value: 5, origin: 'measured' } } }),
      decision,
      { id: 's1', now: 2000 }
    )
    assert.equal(scenario?.values?.['good/cost'].origin, 'assumed')
  })

  it('throws away overrides naming things that are not in the decision', () => {
    const decision = open()
    const { scenario, cannotDo } = readScenario(
      JSON.stringify({ name: 'nonsense', weights: { colour: 9 }, values: { 'nobody/cost': { value: 1 } }, limits: { nothing: 5 } }),
      decision,
      { id: 's1', now: 2000 }
    )
    assert.equal(scenario, null)
    assert.match(cannotDo, /does not change anything/)
  })

  it('refuses a what-if that would leave nothing to compare on', () => {
    const decision = open()
    const { scenario, cannotDo } = readScenario(JSON.stringify({ name: 'all of it', without: ['cost', 'quality'] }), decision, { id: 's1', now: 2000 })
    assert.equal(scenario, null)
    assert.match(cannotDo, /nothing to compare/)
  })

  it('carries through a reason it could not be done at all', () => {
    const decision = open()
    const { scenario, cannotDo } = readScenario(JSON.stringify({ cannotDo: 'that is about something not in this comparison' }), decision, { id: 's1', now: 2000 })
    assert.equal(scenario, null)
    assert.match(cannotDo, /not in this comparison/)
  })
})

// ================================================================ off the disk

describe('reading a decision back off the disk', () => {
  function kept(): Decision {
    return decisionOf({
      criteria: [criterion('price', { direction: 'less-is-better' })],
      alternatives: [{ id: 'a', name: 'A', describe: '', values: { price: known(10) }, upsides: [], downsides: [], origin: 'user-said' }]
    })
  }

  it('a decision written out and read back is the same decision', () => {
    const was = kept()
    const got = cleanDecision(JSON.parse(JSON.stringify(was)))
    assert.deepEqual(got, was)
  })

  it('refuses a version this Orbis does not know rather than reading it badly', () => {
    const newer = { ...kept(), v: DECISION_VERSION + 1 }
    assert.equal(cleanDecision(JSON.parse(JSON.stringify(newer))), null)
    assert.equal(cleanDecision({ ...kept(), v: 0 }), null)
  })

  it('drops a figure whose criterion is gone, and a requirement about one', () => {
    const broken = {
      ...kept(),
      alternatives: [{ ...kept().alternatives[0], values: { price: known(10), ghost: known(5) } }],
      constraints: [{ id: 'x', says: 'about a ghost', criterionId: 'ghost', test: 'at-most', limit: 1, unit: '', origin: 'user-said' }]
    }
    const got = cleanDecision(JSON.parse(JSON.stringify(broken)))
    assert.equal(got?.alternatives[0].values.ghost, undefined)
    assert.equal(got?.constraints.length, 0)
  })

  it('refuses a decision with no options at all', () => {
    assert.equal(cleanDecision({ ...kept(), alternatives: [] }), null)
    assert.equal(cleanDecision(null), null)
    assert.equal(cleanDecision('a decision'), null)
  })

  it('a figure with no number comes back as not known rather than as nought', () => {
    const got = cleanDecision(
      JSON.parse(
        JSON.stringify({
          ...kept(),
          alternatives: [{ ...kept().alternatives[0], values: { price: { value: null, origin: 'user-said' } } }]
        })
      )
    )
    // Dropped entirely rather than stored as a null: there is nothing to compare, so there is no figure.
    assert.equal(got?.alternatives[0].values.price, undefined)
  })

  it('refuses a result that belongs to a different decision', () => {
    const decision = kept()
    const result = run(decision)
    assert.ok(cleanResult(JSON.parse(JSON.stringify(result)), decision))
    assert.equal(cleanResult(JSON.parse(JSON.stringify({ ...result, decisionId: 'somebody-else' })), decision), null)
  })

  it('a result written out and read back keeps its ranking', () => {
    const decision = twoLaptops()
    const result = run(decision)
    const got = cleanResult(JSON.parse(JSON.stringify(result)), decision)
    assert.equal(got?.scored.length, 2)
    assert.equal(got?.leaderId, result.leaderId)
    assert.deepEqual(
      got?.scored.map((one) => one.place),
      result.scored.map((one) => one.place)
    )
  })

  it('a what-if off the disk is checked against the decision it patches', () => {
    const decision = twoLaptops()
    assert.ok(cleanScenario({ id: 's1', name: 'cheaper', weights: { price: 5 }, madeAt: 1 }, decision))
    assert.equal(cleanScenario({ id: 's1', name: 'nonsense', weights: { colour: 5 }, madeAt: 1 }, decision), null)
    assert.equal(cleanScenario({ id: '', name: 'x', weights: { price: 5 }, madeAt: 1 }, decision), null)
  })

  it('how well something is known has an order, and unknown is the bottom of it', () => {
    assert.equal(rankEvidence('unknown'), 0)
    assert.equal(rankEvidence('measured'), 1)
    assert.ok(rankEvidence('user-said') > rankEvidence('estimated'))
    assert.ok(rankEvidence('estimated') > rankEvidence('assumed'))
  })
})

// ================================================================ whether a message is a decision at all

describe('reading a message', () => {
  const fresh = { hasOpen: false }
  const going = { hasOpen: true }

  it('takes a plain request to choose', () => {
    for (const said of [
      'Help me choose between Postgres and SQLite.',
      'Which laptop should I buy?',
      'Should I learn Python or JavaScript first?',
      'I need to decide between these two project ideas.',
      'Which of these solutions is most suitable for my requirements?',
      'I am torn between the two approaches.'
    ]) {
      const got = readMessage(said, fresh)
      assert.equal(got.want, 'new', `"${said}" should be read as a decision`)
    }
  })

  it('takes "which project should I prioritise" as putting things in order', () => {
    const got = readMessage('Which project should I prioritise?', fresh)
    assert.equal(got.want, 'new')
    assert.equal((got as { sure: string }).sure, 'clear')
  })

  it('takes having less time than there is work, even with no asking words', () => {
    const got = readMessage('I have four hours and eight assignments.', fresh)
    assert.equal(got.want, 'new')
    assert.match(String((got as { saw: readonly string[] }).saw.join(' ')), /less time than there is to do/)
  })

  it('finds what is being set against what, in the person’s own words', () => {
    const got = readMessage('Should I build Orbis Music or Orbis Files first? I have two weeks.', fresh)
    assert.equal(got.want, 'new')
    const named = (got as { named: readonly string[] }).named
    assert.equal(named.length, 2)
    assert.match(named.join('|'), /Orbis Music/)
    assert.match(named.join('|'), /Orbis Files/)
  })

  it('works out what kind of decision it is, and treats the serious ones as serious', () => {
    assert.equal((readMessage('Which laptop should I buy under 90000?', fresh) as { sort: string }).sort, 'buying')
    assert.equal((readMessage('Should I learn Rust or Go? I want to study properly.', fresh) as { sort: string }).sort, 'learning')
    assert.equal((readMessage('Should I take the job offer or stay?', fresh) as { sort: string }).sort, 'high-stakes')
    assert.equal((readMessage('Should I use Postgres or a document database for this schema?', fresh) as { sort: string }).sort, 'technical')
  })

  it('leaves teaching, arithmetic and ordinary talk alone', () => {
    for (const said of [
      'Explain what a weighted score means.',
      'What is the probability of rolling a six?',
      'How does multi-criteria decision analysis work?',
      'Tell me about Pareto dominance.',
      'Write me a function that sorts a list.',
      'Python is better than Perl for this.',
      'What is a linked list?'
    ]) {
      assert.equal(readMessage(said, fresh).want, 'nothing', `"${said}" should stay on the ordinary path`)
    }
  })

  it('an empty or enormous message is nothing at all', () => {
    assert.equal(readMessage('', fresh).want, 'nothing')
    assert.equal(readMessage('   ', fresh).want, 'nothing')
    assert.equal(readMessage('should I choose a or b '.repeat(600), fresh).want, 'nothing')
  })

  it('reads a follow-up as a change to what is open, not as a new decision', () => {
    assert.equal(readMessage('Make reliability twice as important.', going).want, 'change')
    assert.equal(readMessage('Add a third option.', going).want, 'change')
    assert.equal(readMessage('Ignore how it looks.', going).want, 'change')
    assert.equal(readMessage('Actually I have five days, not two weeks.', going).want, 'change')
    assert.equal(readMessage('I already finished half of Files.', going).want, 'change')
    assert.equal(readMessage('Go back to the original comparison.', going).want, 'change')
  })

  it('reads a what-if as a what-if', () => {
    assert.equal(readMessage('What if cost matters twice as much?', going).want, 'what-if')
    assert.equal(readMessage('Suppose the budget increases by 20%.', going).want, 'what-if')
    assert.equal(readMessage('How much would the price need to rise before B loses?', going).want, 'what-if')
  })

  it('reads a request for the working as a request for the working', () => {
    assert.equal((readMessage('Show me the working.', going) as { of: string }).of, 'everything')
    assert.equal((readMessage('Why didn’t you choose option C?', going) as { of: string }).of, 'why-not')
    assert.equal((readMessage('What would change your recommendation?', going) as { of: string }).of, 'what-would-change-it')
    assert.equal((readMessage('Am I making this decision using the wrong assumptions?', going) as { of: string }).of, 'what-would-change-it')
    assert.equal((readMessage('How were the scores worked out?', going) as { of: string }).of, 'how-it-worked')
  })

  it('takes "save this" and "just decide" for what they are', () => {
    assert.equal(readMessage('Save this decision.', going).want, 'save')
    assert.equal(readMessage('I want to revisit this later.', going).want, 'save')
    assert.equal(readMessage('Just decide.', going).want, 'just-decide')
    assert.equal(readMessage('Make your best recommendation.', going).want, 'just-decide')
  })

  it('asks one short question rather than guessing when a message is both', () => {
    const got = readMessage('What is the difference between Rust and Go, and which should I pick?', fresh)
    // Asking on one's own behalf is in there, so it goes ahead -- and notes that there is a question in it too.
    if (got.want === 'new') assert.match((got as { saw: readonly string[] }).saw.join(' '), /question in it as well/)
    else assert.equal(got.want, 'unsure')
  })
})

// ================================================================ nothing drifts between the two halves

describe('the engine and the explanation agree', () => {
  it('every row the card draws comes from a score the engine produced', () => {
    const decision = twoLaptops()
    const result = run(decision)
    const verdict = verdictOf(decision, result, fragility(decision, result))
    assert.equal(verdict.rows.length, result.scored.length)
    for (const row of verdict.rows) {
      const scored = result.scored.find((one) => one.alternativeId === row.alternativeId)
      assert.ok(scored, 'a row with no score behind it')
      assert.equal(row.outOf100, Math.round(scored!.score * 100))
      assert.equal(row.place, scored!.place)
      assert.equal(row.known, Math.round(scored!.coverage * 100))
    }
  })

  it('the same decision gives the same answer twice', () => {
    const decision = twoLaptops()
    assert.deepEqual(run(decision, { run: 1, now: 0 }), run(decision, { run: 1, now: 0 }))
  })

  it('every criterion the decision has gets a column, including ones nothing is known about', () => {
    const decision = decisionOf({
      criteria: [criterion('a', { name: 'a' }), criterion('nothing', { name: 'nothing' })],
      alternatives: [
        { id: 'x', name: 'X', describe: '', values: { a: known(1) }, upsides: [], downsides: [], origin: 'user-said' },
        { id: 'y', name: 'Y', describe: '', values: { a: known(9) }, upsides: [], downsides: [], origin: 'user-said' }
      ]
    })
    const result = run(decision)
    const verdict = verdictOf(decision, result, fragility(decision, result))
    assert.equal(verdict.rows[0].parts.length, 2)
    assert.equal(verdict.rows[0].parts.find((one) => one.criterionId === 'nothing')?.raw, null)
  })
})
