import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { arrange, count, shapeById, shapeFor, shapeOf, SHAPES, shouldWait } from './shapes.ts'
import { SPEC_VERSION, type PageSpec, type SpecDisplay } from './spec.ts'

const input = (name: string): PageSpec['inputs'][number] => ({ name, kind: 'number', label: `The ${name}` })
const output = (name: string, display: SpecDisplay = 'statistic'): PageSpec['outputs'][number] => ({
  name,
  label: `The ${name}`,
  display,
  step: 'work',
  ...(display === 'value' || display === 'statistic' ? { pick: 'answer' } : {})
})

const spec = (over: Partial<PageSpec> = {}): PageSpec => ({
  specVersion: SPEC_VERSION,
  title: 'A Page',
  purpose: 'Work something out.',
  inputs: [input('speed'), input('angle')],
  steps: [{ name: 'work', operation: 'motion.projectile', arguments: { speed: { input: 'speed' } }, when: 'change' }],
  outputs: [output('range')],
  sections: [
    { title: 'Inputs', members: ['speed', 'angle'] },
    { title: 'Results', members: ['range'] }
  ],
  notes: ['It assumes a vacuum.'],
  keywords: ['throw'],
  ...over
})

describe('which shape a Page is', () => {
  it('calls a Page with numbers in and an answer out a calculator', () => {
    assert.equal(shapeOf(spec()).id, 'calculator')
  })

  it('calls a Page with a chart and something to move an explorer', () => {
    assert.equal(shapeOf(spec({ outputs: [output('path', 'plot')] })).id, 'explorer')
  })

  it('calls a Page with nothing to type a reference', () => {
    assert.equal(shapeOf(spec({ inputs: [], outputs: [output('c'), output('g')] })).id, 'reference')
  })

  it('calls a Page of several figures a report', () => {
    assert.equal(shapeOf(spec({ outputs: [output('a'), output('b'), output('c'), output('d')] })).id, 'report')
  })

  it('calls a Page holding two things against each other a comparison', () => {
    const one = spec({
      inputs: [input('a1'), input('a2'), input('b1'), input('b2')],
      outputs: [output('x'), output('y'), output('z')]
    })
    assert.equal(shapeOf(one).id, 'comparison')
  })

  it('always finds one, because the last fits anything', () => {
    assert.equal(shapeOf({ inputs: [], outputs: [] }).id, 'calculator')
    assert.ok(SHAPES[SHAPES.length - 1].fits({ inputs: 0, outputs: 0, drawn: 0, tables: 0 }))
  })

  it('tries the specific ones before the one that fits everything', () => {
    // A shape that fits anything, tried first, would claim every Page before a better one was reached.
    assert.equal(SHAPES[SHAPES.length - 1].id, 'calculator')
    for (const shape of SHAPES.slice(0, -1)) {
      assert.equal(shape.fits({ inputs: 2, outputs: 1, drawn: 0, tables: 0 }), false, shape.id)
    }
  })

  it('counts what it chooses by', () => {
    const counted = count(spec({ outputs: [output('a'), output('b', 'plot'), output('c', 'table')] }))
    assert.deepEqual(counted, { inputs: 2, outputs: 3, drawn: 1, tables: 1 })
  })
})

describe('guessing a shape from what was asked for', () => {
  it('hears a comparison', () => {
    for (const said of ['compare two loans', 'petrol versus electric', 'the difference between them']) {
      assert.equal(shapeFor(said).id, 'comparison', said)
    }
  })

  it('hears something to explore', () => {
    for (const said of ['plot the trajectory', 'a graph of the curve', 'let me explore the range']) {
      assert.equal(shapeFor(said).id, 'explorer', said)
    }
  })

  it('hears a report and a reference', () => {
    assert.equal(shapeFor('a summary of the numbers').id, 'report')
    assert.equal(shapeFor('look up the constants').id, 'reference')
  })

  it('falls back to a calculator rather than guessing', () => {
    assert.equal(shapeFor('work out the range of a projectile').id, 'calculator')
    assert.equal(shapeFor('').id, 'calculator')
  })

  it('gives every shape guidance that says nothing about arrangement', () => {
    // Arrangement is decided here, afterwards. Telling a model about it gets the one it felt like.
    for (const shape of SHAPES) {
      assert.ok(shape.guidance.length > 20, shape.id)
      assert.equal(/section/i.test(shape.guidance), false, shape.id)
    }
  })

  it('finds a shape by its id, and nothing on Object.prototype', () => {
    assert.equal(shapeById('explorer')?.id, 'explorer')
    for (const sneaky of ['constructor', 'toString', '__proto__']) assert.equal(shapeById(sneaky), null, sneaky)
  })
})

describe('arranging a Page to its shape', () => {
  it('puts what somebody sets before what the Page works out', () => {
    const after = arrange(spec())
    assert.deepEqual(after.sections.map((one) => one.title), ['What you know', 'The answer'])
    assert.deepEqual(after.sections[0].members, ['speed', 'angle'])
    assert.deepEqual(after.sections[1].members, ['range'])
  })

  it('adds nothing, removes nothing and renames nothing', () => {
    const before = spec()
    const after = arrange(before)
    assert.deepEqual(after.inputs, before.inputs)
    assert.deepEqual(after.outputs, before.outputs)
    assert.deepEqual(after.steps, before.steps)
    assert.equal(after.title, before.title)
    assert.deepEqual(after.notes, before.notes)
    // Everything that was placed is still placed, exactly once.
    const placed = after.sections.flatMap((one) => one.members)
    assert.deepEqual([...placed].sort(), [...before.sections.flatMap((one) => one.members)].sort())
  })

  it('leads the results with anything drawn', () => {
    const one = spec({
      outputs: [output('total'), output('path', 'plot'), output('rows', 'table')],
      sections: [
        { title: 'Inputs', members: ['speed', 'angle'] },
        { title: 'Results', members: ['total', 'path', 'rows'] }
      ]
    })
    const after = arrange(one)
    const results = after.sections[after.sections.length - 1].members
    // The drawn ones first, in the order they were written; the single figure after.
    assert.deepEqual(results, ['path', 'rows', 'total'])
  })

  it('keeps sections that are named after the subject', () => {
    // "The throw" tells somebody more than "What you know", and consistency is not worth overruling that.
    const one = spec({
      sections: [
        { title: 'The throw', members: ['speed', 'angle'] },
        { title: 'Where it lands', members: ['range'] }
      ]
    })
    assert.deepEqual(arrange(one).sections.map((each) => each.title), ['The throw', 'Where it lands'])
  })

  it('still orders the ones it keeps, so inputs come first', () => {
    const one = spec({
      sections: [
        { title: 'Where it lands', members: ['range'] },
        { title: 'The throw', members: ['speed', 'angle'] }
      ]
    })
    assert.deepEqual(arrange(one).sections.map((each) => each.title), ['The throw', 'Where it lands'])
  })

  it('replaces a section whose name says nothing', () => {
    for (const title of ['Inputs', 'results', 'Values', 'Parameters', 'Data']) {
      const one = spec({ sections: [{ title, members: ['speed', 'angle'] }, { title: 'Answer', members: ['range'] }] })
      const after = arrange(one)
      assert.equal(after.sections.some((each) => each.title === title), false, title)
    }
  })

  it('uses the shape’s own words', () => {
    const explorer = spec({
      outputs: [output('path', 'plot')],
      sections: [
        { title: 'Inputs', members: ['speed', 'angle'] },
        { title: 'Results', members: ['path'] }
      ]
    })
    assert.deepEqual(arrange(explorer).sections.map((one) => one.title), ['What you set', 'What happens'])
  })

  it('leaves a Page with nothing in it alone rather than producing no sections', () => {
    const empty = spec({ inputs: [], outputs: [], sections: [] })
    assert.deepEqual(arrange(empty).sections, [])
  })

  it('arranges the same Page the same way every time', () => {
    const one = spec()
    assert.deepEqual(arrange(one), arrange(arrange(one)))
  })
})

describe('what should wait for a button', () => {
  const withSteps = (names: string[], readsInput: string, args = 1): PageSpec =>
    spec({
      inputs: [input('speed')],
      steps: names.map((name) => ({
        name,
        operation: 'statistics.summarise',
        arguments: Object.fromEntries(
          new Array(args).fill(0).map((_, i) => [`a${i}`, i === 0 ? { input: readsInput } : { value: i }])
        ),
        when: 'change' as const
      })),
      outputs: names.map((name) => ({ name: `out_${name}`, label: name, display: 'statistic' as const, step: name, pick: 'mean' })),
      sections: [{ title: 'All', members: ['speed', ...names.map((name) => `out_${name}`)] }]
    })

  it('moves nothing when one keystroke sets off little enough', () => {
    assert.deepEqual(shouldWait(withSteps(['a', 'b'], 'speed'), 6), [])
  })

  it('moves only as many as it has to', () => {
    const moved = shouldWait(withSteps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'speed'), 6)
    assert.equal(moved.length, 2)
  })

  it('moves the heaviest first, because moving the cheap ones leaves the expensive one firing', () => {
    const one = spec({
      inputs: [input('speed')],
      steps: [
        { name: 'light', operation: 'statistics.summarise', arguments: { a: { input: 'speed' } }, when: 'change' },
        {
          name: 'heavy',
          operation: 'statistics.summarise',
          arguments: { a: { input: 'speed' }, b: { value: 1 }, c: { value: 2 }, d: { value: 3 } },
          when: 'change'
        }
      ],
      outputs: [
        { name: 'o1', label: 'One', display: 'statistic', step: 'light', pick: 'mean' },
        { name: 'o2', label: 'Two', display: 'statistic', step: 'heavy', pick: 'mean' }
      ],
      sections: [{ title: 'All', members: ['speed', 'o1', 'o2'] }]
    })
    assert.deepEqual(shouldWait(one, 1), ['heavy'])
  })

  it('counts per box, not in total', () => {
    // Six calculations each fed by its own box sets off one per keystroke, which is fine.
    const one = spec({
      inputs: new Array(6).fill(0).map((_, i) => input(`in${i}`)),
      steps: new Array(6).fill(0).map((_, i) => ({
        name: `step${i}`,
        operation: 'statistics.summarise',
        arguments: { a: { input: `in${i}` } },
        when: 'change' as const
      })),
      outputs: new Array(6).fill(0).map((_, i) => ({
        name: `out${i}`,
        label: `Out ${i}`,
        display: 'statistic' as const,
        step: `step${i}`,
        pick: 'mean'
      })),
      sections: [{ title: 'All', members: [] }]
    })
    assert.deepEqual(shouldWait(one, 2), [])
  })

  it('ignores what already waits for a button', () => {
    const one = withSteps(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'speed')
    const allWaiting = { ...one, steps: one.steps.map((each) => ({ ...each, when: 'button' as const })) }
    assert.deepEqual(shouldWait(allWaiting, 1), [])
  })
})
