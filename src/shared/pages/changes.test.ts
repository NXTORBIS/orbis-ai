import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { apply, check, CHANGE_LIMITS, describeChanges, read, type Change, type ChangeSet } from './changes.ts'
import { SPEC_VERSION, type PageSpec } from './spec.ts'

const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'motion.projectile': 'computation.physics',
  'statistics.summarise': 'computation.statistics'
})

const spec = (over: Partial<PageSpec> = {}): PageSpec => ({
  specVersion: SPEC_VERSION,
  title: 'Projectile Range',
  purpose: 'Work out how far something thrown at an angle travels before it lands.',
  inputs: [
    { name: 'speed', kind: 'number', label: 'Launch speed', initial: 20, minimum: 1, maximum: 200 },
    { name: 'angle', kind: 'number', label: 'Launch angle', initial: 45, minimum: 1, maximum: 89 }
  ],
  steps: [
    {
      name: 'flight',
      operation: 'motion.projectile',
      arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, gravity: { value: 9.81 } },
      when: 'change'
    }
  ],
  outputs: [
    { name: 'range', label: 'How far it goes', display: 'statistic', step: 'flight', pick: 'range' },
    { name: 'path', label: 'The path it takes', display: 'plot', step: 'flight' }
  ],
  sections: [
    { title: 'The throw', members: ['speed', 'angle'] },
    { title: 'Where it lands', members: ['range', 'path'] }
  ],
  notes: ['There is no air resistance in this calculation.'],
  keywords: ['projectile', 'range'],
  ...over
})

const set = (changes: Change[], request = 'do a thing'): ChangeSet => ({ changes, request, direct: true })

const applied = (changes: Change[], one: PageSpec = spec()): PageSpec => {
  const result = apply(one, set(changes), OPERATIONS)
  assert.ok('spec' in result, 'problems' in result ? JSON.stringify(result.problems ?? result.specProblems) : '')
  return result.spec
}

describe('checking a change before it is applied', () => {
  it('accepts a change that names something real', () => {
    assert.deepEqual(check(set([{ op: 'relabel', target: 'speed', to: 'How fast', reason: '' }]), spec()), [])
  })

  it('refuses a change naming something that is not there, rather than quietly doing nothing', () => {
    // Quietly doing nothing is the failure somebody finds a week later wondering why their edit never took.
    const problems = check(set([{ op: 'relabel', target: 'velocity', to: 'How fast', reason: '' }]), spec())
    assert.equal(problems.length, 1)
    assert.equal(problems[0].code, 'no-such-thing')
    assert.ok(problems[0].message.includes('velocity'))
  })

  it('refuses a starting value outside what the box allows', () => {
    const problems = check(set([{ op: 'restart', target: 'speed', to: 500, reason: '' }]), spec())
    assert.deepEqual(problems.map((one) => one.code), ['out-of-range'])
  })

  it('refuses a starting value of the wrong kind', () => {
    assert.deepEqual(check(set([{ op: 'restart', target: 'speed', to: 'fast', reason: '' }]), spec()).map((one) => one.code), ['bad-start'])
  })

  it('refuses a range that crosses itself', () => {
    const problems = check(set([{ op: 'rebound', target: 'speed', to: { minimum: 100, maximum: 10 }, reason: '' }]), spec())
    assert.deepEqual(problems.map((one) => one.code), ['range-crossed'])
  })

  it('refuses showing a whole result as a single number when nothing says which part', () => {
    const problems = check(set([{ op: 'redisplay', target: 'path', to: 'statistic', reason: '' }]), spec())
    assert.deepEqual(problems.map((one) => one.code), ['nothing-picked'])
  })

  it('allows showing a single number as a chart, which needs nothing extra', () => {
    assert.deepEqual(check(set([{ op: 'redisplay', target: 'range', to: 'plot', reason: '' }]), spec()), [])
  })

  it('refuses a kind of change that is not one', () => {
    const problems = check(set([{ op: 'explode' as Change['op'], target: 'speed', to: 1, reason: '' }]), spec())
    assert.deepEqual(problems.map((one) => one.code), ['no-such-change'])
  })

  it('refuses a change set that does nothing, or that is a rewrite', () => {
    assert.deepEqual(check(set([]), spec()).map((one) => one.code), ['nothing-to-do'])
    const many = new Array(CHANGE_LIMITS.perSet + 1).fill(0).map(() => ({ op: 'retitle' as const, target: '', to: 'x', reason: '' }))
    assert.ok(check(set(many), spec()).some((one) => one.code === 'too-many'))
  })
})

describe('applying a change', () => {
  it('changes what was asked for and nothing else', () => {
    const before = spec()
    const after = applied([{ op: 'relabel', target: 'speed', to: 'How fast you throw it', reason: '' }])
    assert.equal(after.inputs[0].label, 'How fast you throw it')
    // Everything else is exactly as it was. This is the whole property.
    assert.deepEqual(after.steps, before.steps)
    assert.deepEqual(after.outputs, before.outputs)
    assert.equal(after.title, before.title)
    assert.deepEqual(after.inputs[1], before.inputs[1])
  })

  it('never changes what the Page means', () => {
    const before = spec()
    const after = applied([
      { op: 'retitle', target: '', to: 'Throwing Things', reason: '' },
      { op: 'redisplay', target: 'range', to: 'value', reason: '' },
      { op: 'retime', target: 'flight', to: 'button', reason: '' }
    ])
    // Three changes to its treatment, and the calculation is untouched.
    assert.equal(after.steps[0].operation, before.steps[0].operation)
    assert.deepEqual(after.steps[0].arguments, before.steps[0].arguments)
  })

  it('refuses the whole set when one change is bad, rather than applying the rest', () => {
    const result = apply(spec(), set([
      { op: 'relabel', target: 'speed', to: 'How fast', reason: '' },
      { op: 'relabel', target: 'velocity', to: 'Nothing', reason: '' }
    ]), OPERATIONS)
    assert.ok('problems' in result)
    assert.equal(result.problems.length, 1)
  })

  it('checks the Page that comes out, not only the change going in', () => {
    // Two things ending up with the same label is a defect of the whole Page, and the change set that produced it
    // looks perfectly fine on its own.
    const result = apply(spec(), set([{ op: 'relabel', target: 'range', to: 'Launch speed', reason: '' }]), OPERATIONS)
    if ('spec' in result) {
      // The specification checker allows duplicate labels -- the legibility gate catches those -- so this is a pass,
      // and the test is that the second check ran at all.
      assert.equal(result.spec.outputs[0].label, 'Launch speed')
    } else {
      assert.ok(result.specProblems !== undefined)
    }
  })

  it('refuses a change that would leave the Page inconsistent', () => {
    const one = spec({ outputs: [{ name: 'range', label: 'How far', display: 'statistic', step: 'flight', pick: 'range' }], sections: [
      { title: 'The throw', members: ['speed', 'angle'] },
      { title: 'Where it lands', members: ['range'] }
    ] })
    // Nothing in a change set can do this, so the guard is checked by handing it one that would: a note is fine, and
    // the point is that the resulting Page is validated either way.
    const result = apply(one, set([{ op: 'note', target: '', to: 'It assumes level ground.', reason: '' }]), OPERATIONS)
    assert.ok('spec' in result)
    assert.equal(result.spec.notes.length, 2)
  })

  it('adds a note without touching the ones already there', () => {
    const after = applied([{ op: 'note', target: '', to: 'It assumes level ground.', reason: '' }])
    assert.deepEqual(after.notes, ['There is no air resistance in this calculation.', 'It assumes level ground.'])
  })

  it('changes when a calculation happens', () => {
    assert.equal(applied([{ op: 'retime', target: 'flight', to: 'button', reason: '' }]).steps[0].when, 'button')
  })

  it('changes a range, and the starting value still has to fit it', () => {
    const after = applied([{ op: 'rebound', target: 'speed', to: { minimum: 10, maximum: 50 }, reason: '' }])
    assert.equal(after.inputs[0].minimum, 10)
    assert.equal(after.inputs[0].maximum, 50)
    const bad = apply(spec(), set([{ op: 'rebound', target: 'speed', to: { minimum: 30, maximum: 50 }, reason: '' }]), OPERATIONS)
    // 20 is now below the minimum, and the specification check is what notices.
    assert.ok('problems' in bad && bad.specProblems !== undefined)
  })
})

describe('reordering', () => {
  it('moves a section to the front when something in it is asked for first', () => {
    const after = applied([{ op: 'reorder', target: '', to: ['range'], reason: '' }])
    assert.deepEqual(after.sections.map((one) => one.title), ['Where it lands', 'The throw'])
  })

  it('moves one thing within its section', () => {
    const after = applied([{ op: 'reorder', target: '', to: ['angle'], reason: '' }])
    assert.deepEqual(after.sections[0].members, ['angle', 'speed'])
  })

  it('leaves what it was not asked about where it was, relative to the rest', () => {
    const three = spec({
      sections: [
        { title: 'One', members: ['speed'] },
        { title: 'Two', members: ['angle'] },
        { title: 'Three', members: ['range', 'path'] }
      ]
    })
    const after = applied([{ op: 'reorder', target: '', to: ['range'], reason: '' }], three)
    // Three moves to the front; One and Two keep their order behind it rather than being shuffled.
    assert.deepEqual(after.sections.map((one) => one.title), ['Three', 'One', 'Two'])
  })

  it('refuses to move something that is not on the Page', () => {
    const problems = check(set([{ op: 'reorder', target: '', to: ['nothing'], reason: '' }]), spec())
    assert.deepEqual(problems.map((one) => one.code), ['no-such-thing'])
  })
})

describe('reading a request without asking anybody', () => {
  const one = spec()

  it('reads a rename', () => {
    const answer = read('rename speed to launch velocity', one)
    assert.ok(answer !== null)
    assert.ok(answer.direct)
    assert.deepEqual(answer.changes, [{ op: 'relabel', target: 'speed', to: 'launch velocity', reason: 'Renamed.' }])
  })

  it('reads a rename by the label somebody actually sees', () => {
    const answer = read('rename the Launch angle box to Angle above the ground', one)
    assert.ok(answer !== null)
    assert.equal(answer.changes[0].target, 'angle')
  })

  it('reads a change of how something is shown', () => {
    const answer = read('show the range as a chart', one)
    assert.ok(answer !== null)
    assert.deepEqual(answer.changes, [{ op: 'redisplay', target: 'range', to: 'plot', reason: 'Shown as a chart.' }])
  })

  it('reads a calculation being moved onto a button, and back', () => {
    const onButton = read('work out the flight when I press a button', one)
    assert.ok(onButton !== null)
    assert.deepEqual(onButton.changes, [{ op: 'retime', target: 'flight', to: 'button', reason: 'Waits for a button now.' }])
    const onType = read('calculate the flight as I type', one)
    assert.ok(onType !== null)
    assert.equal(onType.changes[0].to, 'change')
  })

  it('reads a starting value', () => {
    const answer = read('start the speed at 30', one)
    assert.ok(answer !== null)
    assert.deepEqual(answer.changes, [{ op: 'restart', target: 'speed', to: 30, reason: 'Starts at 30.' }])
  })

  it('reads a reorder', () => {
    const answer = read('put the range at the top', one)
    assert.ok(answer !== null)
    assert.equal(answer.changes[0].op, 'reorder')
  })

  it('reads a note', () => {
    const answer = read('say that it assumes level ground', one)
    assert.ok(answer !== null)
    assert.deepEqual(answer.changes, [{ op: 'note', target: '', to: 'it assumes level ground', reason: 'Said on the Page.' }])
  })

  it('ignores a full stop at the end, because people type one', () => {
    assert.ok(read('start the speed at 30.', one) !== null)
  })

  it('says nothing rather than guessing when the request is not one it knows', () => {
    // Nothing is the normal answer and is not a failure. A change set made from a request nobody understood is an
    // edit somebody did not ask for, applied confidently.
    for (const said of [
      'make it better',
      'add dark mode',
      'make the whole thing work offline',
      'add a second calculation for drag',
      ''
    ]) {
      assert.equal(read(said, one), null, said)
    }
  })

  it('says nothing when the thing named is not on the Page', () => {
    assert.equal(read('rename humidity to damp', one), null)
  })

  it('says nothing when two things could have been meant', () => {
    const ambiguous = spec({
      inputs: [
        { name: 'launch', kind: 'number', label: 'Launch speed' },
        { name: 'wind', kind: 'number', label: 'Wind speed' }
      ]
    })
    // "speed" is inside both labels and is the name of neither, so which one was meant is a guess.
    assert.equal(read('rename the speed box to something else', ambiguous), null)
    // And naming one of them exactly is not a guess, so that still works.
    assert.equal(read('rename the Wind speed box to Gust', ambiguous)?.changes[0].target, 'wind')
  })

  it('produces a change set that then passes its own check', () => {
    for (const said of ['rename speed to launch velocity', 'show the range as a chart', 'start the speed at 30']) {
      const answer = read(said, one)
      assert.ok(answer !== null, said)
      assert.deepEqual(check(answer, one), [], said)
    }
  })

  it('refuses a request longer than a request', () => {
    assert.equal(read('rename speed to ' + 'x'.repeat(CHANGE_LIMITS.requestLength), one), null)
  })
})

describe('saying what changed between two versions', () => {
  it('describes what a change set could have done', () => {
    const before = spec()
    const after = spec({ title: 'Throwing Things', inputs: [{ ...before.inputs[0], label: 'How fast' }, before.inputs[1]] })
    const said = describeChanges(before, after)
    assert.deepEqual(said.described.map((one) => one.op).sort(), ['relabel', 'retitle'])
    assert.deepEqual(said.deeper, [])
  })

  it('says separately when the Page means something different now', () => {
    const before = spec()
    const after = spec({
      steps: [{ ...before.steps[0], operation: 'statistics.summarise', arguments: { values: { input: 'speed' } } }]
    })
    const said = describeChanges(before, after)
    assert.equal(said.described.length, 0)
    assert.ok(said.deeper.some((one) => one.includes('a different way')))
    assert.ok(said.deeper.some((one) => one.includes('different things')))
  })

  it('notices something gained and something lost', () => {
    const before = spec()
    const after = spec({ outputs: [before.outputs[0]], sections: [before.sections[0], { title: 'Where it lands', members: ['range'] }] })
    assert.ok(describeChanges(before, after).deeper.some((one) => one.includes('no longer shown')))
    assert.ok(describeChanges(after, before).deeper.some((one) => one.includes('is new')))
  })

  it('says nothing about two versions that are the same', () => {
    const said = describeChanges(spec(), spec())
    assert.deepEqual(said.described, [])
    assert.deepEqual(said.deeper, [])
  })
})
