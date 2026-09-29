import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { blameFor, examine, examineWidths, VISUAL_LIMITS, type Rendered, type VisualCode } from './visual.ts'

const box = (over: Partial<Rendered> & { id: string }): Rendered => ({
  kind: 'value',
  x: 16,
  y: 16,
  width: 300,
  height: 40,
  text: '42',
  visible: true,
  ...over
})

const codes = (elements: readonly Rendered[], width = 1100): VisualCode[] =>
  examine(elements, width).problems.map((one) => one.code)

describe('a Page that rendered properly', () => {
  const good: Rendered[] = [
    box({ id: 'in_speed', kind: 'number-input', y: 16, text: '20' }),
    box({ id: 'out_range', kind: 'statistic', y: 80, text: '40.8', bound: { field: 'result_flight', hasValue: true }, emphasis: 'primary' })
  ]

  it('finds nothing wrong with it', () => {
    const result = examine(good, 1100)
    assert.deepEqual(result.problems, [])
    assert.ok(result.looksRight)
    assert.equal(result.examined, 2)
  })

  it('counts what it looked at, so a pass says how much it covered', () => {
    assert.equal(examine([...good, box({ id: 'hidden', visible: false })], 1100).examined, 2)
  })
})

describe('the defect this was written for', () => {
  it('objects to a box that exists to show an answer and has none', () => {
    // A Page can pass its specification, its capabilities, its layout arithmetic and its trial run, and still render
    // "nothing yet" where the answer goes. This is the only check that sees it.
    const result = examine(
      [box({ id: 'out_total', kind: 'statistic', text: 'nothing yet', bound: { field: 'result_count', hasValue: false } })],
      1100
    )
    assert.deepEqual(result.problems.map((one) => one.code), ['no-answer'])
    assert.equal(result.looksRight, false)
    assert.ok(result.problems[0].message.includes('without working anything out'))
  })

  it('objects for every kind that shows an answer', () => {
    for (const kind of ['statistic', 'value', 'plot', 'table']) {
      assert.deepEqual(codes([box({ id: 'out', kind, bound: { field: 'r', hasValue: false } })]), ['no-answer'], kind)
    }
  })

  it('says nothing about a box somebody types into, which has no answer to show', () => {
    for (const kind of ['number-input', 'text-input', 'choice', 'button']) {
      assert.deepEqual(codes([box({ id: 'in', kind, bound: { field: 'speed', hasValue: false } })]), [], kind)
    }
  })

  it('says nothing when the renderer could not tell, rather than inventing a failure', () => {
    // No `bound` means the renderer did not report. Treating that as a missing answer would fail every Page whenever
    // the renderer was the older kind.
    assert.deepEqual(codes([box({ id: 'out', kind: 'statistic' })]), [])
  })
})

describe('things off the side, on top of each other, or cut off', () => {
  it('objects to something running past the edge', () => {
    assert.deepEqual(codes([box({ id: 'wide', x: 900, width: 400 })], 1100), ['off-screen'])
    assert.deepEqual(codes([box({ id: 'left', x: -50 })], 1100), ['off-screen'])
  })

  it('does not object to something that just reaches the edge', () => {
    assert.deepEqual(codes([box({ id: 'exact', x: 800, width: 300 })], 1100), [])
  })

  it('objects to text that does not fit in its box', () => {
    assert.deepEqual(codes([box({ id: 'long', width: 100, contentWidth: 260 })]), ['clipped'])
    assert.deepEqual(codes([box({ id: 'tall', height: 40, contentHeight: 90 })]), ['clipped'])
  })

  it('ignores sub-pixel rounding, which is not clipping', () => {
    assert.deepEqual(codes([box({ id: 'rounded', width: 300, contentWidth: 301 })]), [])
  })

  it('objects to two things drawn on top of each other', () => {
    const result = codes([box({ id: 'a', x: 10, y: 10, width: 100, height: 40 }), box({ id: 'b', x: 50, y: 20, width: 100, height: 40 })])
    assert.deepEqual(result, ['overlapping'])
  })

  it('does not call a group holding its children a collision', () => {
    // Every group's box covers its children by construction. Reporting it would bury every real collision in noise.
    const result = codes([
      box({ id: 'group', kind: 'group', x: 0, y: 0, width: 600, height: 400, text: '' }),
      box({ id: 'child', x: 20, y: 20, width: 200, height: 40 })
    ])
    assert.deepEqual(result, [])
  })

  it('does not object to boxes that merely touch', () => {
    const result = codes([box({ id: 'a', x: 0, y: 0, width: 100, height: 40 }), box({ id: 'b', x: 100, y: 0, width: 100, height: 40 })])
    assert.deepEqual(result, [])
  })
})

describe('things too small, invisible or buried', () => {
  it('objects to a control nobody could hit', () => {
    assert.deepEqual(codes([box({ id: 'tiny', kind: 'button', width: 18, height: 18 })]), ['too-small'])
    assert.ok(VISUAL_LIMITS.targetPx > 18)
  })

  it('does not hold a read-only box to a target size, because nobody aims at it', () => {
    assert.deepEqual(codes([box({ id: 'small', kind: 'value', width: 18, height: 18 })]), [])
  })

  it('objects to something on the Page with no size at all', () => {
    assert.deepEqual(codes([box({ id: 'gone', width: 0, height: 40 })]), ['invisible'])
  })

  it('stops looking at something with no size rather than piling findings on it', () => {
    // A zero-size element is off-screen, clipped and too small as well. One finding is the useful one.
    assert.deepEqual(codes([box({ id: 'gone', kind: 'button', width: 0, height: 0, contentWidth: 200 })]), ['invisible'])
  })

  it('warns when the thing the Page is for is a long way down', () => {
    const result = examine([box({ id: 'answer', kind: 'statistic', y: VISUAL_LIMITS.foldPx + 100, emphasis: 'primary', bound: { field: 'r', hasValue: true } })], 1100)
    assert.deepEqual(result.problems.map((one) => one.code), ['buried'])
    // A warning: it is still there, and a long Page is sometimes right.
    assert.equal(result.problems[0].severity, 'warning')
    assert.ok(result.looksRight)
  })

  it('does not mind something supporting being a long way down', () => {
    assert.deepEqual(codes([box({ id: 'note', y: 2000, emphasis: 'supporting' })]), [])
  })

  it('says nothing rendered at all, rather than saying nothing', () => {
    const result = examine([box({ id: 'a', visible: false })], 1100)
    assert.deepEqual(result.problems.map((one) => one.code), ['empty-page'])
    assert.equal(result.looksRight, false)
  })
})

describe('text nobody can read', () => {
  it('objects to text that does not stand out from what is behind it', () => {
    assert.deepEqual(codes([box({ id: 'faint', foreground: '#777777', background: '#808080', text: 'result' })]), ['unreadable'])
  })

  it('accepts text that does', () => {
    assert.deepEqual(codes([box({ id: 'clear', foreground: '#ffffff', background: '#101010', text: 'result' })]), [])
  })

  it('says nothing about an empty box, which has no text to read', () => {
    assert.deepEqual(codes([box({ id: 'blank', foreground: '#777777', background: '#808080', text: '' })]), [])
  })

  it('says nothing when the colours could not be read rather than inventing a failure', () => {
    assert.deepEqual(codes([box({ id: 'odd', foreground: 'not a colour', background: '#101010', text: 'result' })]), [])
  })
})

describe('the same Page at several widths', () => {
  it('reports each width separately, because broken on a phone is not broken', () => {
    const answer = examineWidths([
      { width: 'phone', viewportWidth: 380, elements: [box({ id: 'wide', x: 16, width: 500 })] },
      { width: 'desktop', viewportWidth: 1100, elements: [box({ id: 'wide', x: 16, width: 500 })] }
    ])
    assert.equal(answer.byWidth.phone.looksRight, false)
    assert.ok(answer.byWidth.desktop.looksRight)
    assert.equal(answer.looksRight, false)
  })

  it('says which width each problem was at', () => {
    const answer = examineWidths([{ width: 'phone', viewportWidth: 380, elements: [box({ id: 'wide', x: 16, width: 500 })] }])
    assert.ok(answer.problems[0].at.startsWith('phone:'))
  })

  it('is right about a Page that works everywhere', () => {
    const fine = [box({ id: 'out', kind: 'statistic', width: 300, bound: { field: 'r', hasValue: true } })]
    const answer = examineWidths([
      { width: 'phone', viewportWidth: 380, elements: fine },
      { width: 'wide', viewportWidth: 1600, elements: fine }
    ])
    assert.ok(answer.looksRight)
    assert.deepEqual(answer.problems, [])
  })
})

describe('who is answerable for a defect', () => {
  it('blames the runtime for an answer that never arrived', () => {
    assert.equal(blameFor('no-answer'), 'runtime')
  })

  it('blames the layout for where things ended up', () => {
    for (const code of ['off-screen', 'overlapping', 'clipped', 'buried'] as VisualCode[]) {
      assert.equal(blameFor(code), 'layout', code)
    }
  })

  it('blames the component for how one looks', () => {
    for (const code of ['too-small', 'invisible', 'unreadable'] as VisualCode[]) {
      assert.equal(blameFor(code), 'component', code)
    }
  })

  it('has an answer for every code it can produce', () => {
    const every: VisualCode[] = ['no-answer', 'clipped', 'overlapping', 'off-screen', 'too-small', 'invisible', 'buried', 'unreadable', 'empty-page']
    for (const code of every) assert.ok(blameFor(code).length > 0, code)
  })
})
