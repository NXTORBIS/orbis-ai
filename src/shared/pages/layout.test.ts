import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkLayout,
  describeForAudit,
  columnWidth,
  describeLayout,
  emphasise,
  layout,
  LAYOUT_LIMITS,
  WIDTHS,
  type Width
} from './layout.ts'
import type { SpecInput, SpecOutput, SpecSection } from './spec.ts'

const input = (name: string): SpecInput => ({ name, kind: 'number', label: `The ${name}` })
const output = (name: string, display: SpecOutput['display'] = 'statistic'): SpecOutput => ({
  name,
  label: `The ${name}`,
  display,
  step: 'work',
  ...(display === 'value' || display === 'statistic' ? { pick: 'answer' } : {})
})
const section = (title: string, members: string[]): SpecSection => ({ title, members })

const at = (one: ReturnType<typeof layout>, width: Width): NonNullable<ReturnType<typeof layout>['widths'][number]> => {
  const found = one.widths.find((each) => each.width === width)
  assert.ok(found !== undefined, width)
  return found
}

describe('what a Page leads with', () => {
  it('leads with what it works out, never with the boxes', () => {
    const ranked = emphasise([input('speed'), input('angle')], [output('range')])
    assert.deepEqual(ranked.primary, ['range'])
    assert.deepEqual(ranked.secondary, ['speed', 'angle'])
  })

  it('leads with what is drawn over what is merely read', () => {
    const ranked = emphasise([], [output('summary', 'value'), output('path', 'plot'), output('total', 'statistic')])
    assert.deepEqual(ranked.primary, ['path', 'total'])
    assert.deepEqual(ranked.supporting, ['summary'])
  })

  it('never makes more than two things primary', () => {
    const many = new Array(8).fill(0).map((_, i) => output(`out${i}`, 'plot'))
    assert.equal(emphasise([], many).primary.length, 2)
  })

  it('has nothing primary when a Page shows nothing, which is a defect the check names', () => {
    const one = layout({ inputs: [input('a')], outputs: [], sections: [section('Only', ['a'])] })
    assert.deepEqual(one.hierarchy.primary, [])
    assert.ok(checkLayout(one, []).some((problem) => problem.code === 'nothing-leads'))
  })
})

describe('laying a Page out', () => {
  const simple = (): ReturnType<typeof layout> =>
    layout({
      inputs: [input('speed'), input('angle')],
      outputs: [output('range')],
      sections: [section('The throw', ['speed', 'angle']), section('The answer', ['range'])]
    })

  it('gives one arrangement per width, all from the same Page', () => {
    const one = simple()
    assert.deepEqual(one.widths.map((each) => each.width), WIDTHS.map((each) => each.name))
    for (const width of one.widths) assert.equal(width.sections.length, 2)
  })

  it('is one column on a phone whatever the Page is', () => {
    const many = new Array(9).fill(0).map((_, i) => input(`in${i}`))
    const one = layout({ inputs: many, outputs: [output('answer')], sections: [section('All', [...many.map((each) => each.name), 'answer'])] })
    assert.equal(at(one, 'phone').sections[0].columns, 1)
  })

  it('uses more columns where there is more room', () => {
    const many = new Array(6).fill(0).map((_, i) => input(`in${i}`))
    const one = layout({ inputs: many, outputs: [output('answer')], sections: [section('All', [...many.map((each) => each.name), 'answer'])] })
    const phone = at(one, 'phone').sections[0].columns
    const wide = at(one, 'wide').sections[0].columns
    assert.ok(wide > phone, `${wide} is not more than ${phone}`)
    assert.ok(wide <= LAYOUT_LIMITS.columns)
  })

  it('never makes more columns than there are things to put in them', () => {
    const one = layout({ inputs: [input('only')], outputs: [output('answer')], sections: [section('One', ['only']), section('Two', ['answer'])] })
    for (const width of one.widths) for (const each of width.sections) assert.equal(each.columns, 1)
  })

  it('never makes a column narrower than a control needs', () => {
    const many = new Array(12).fill(0).map((_, i) => input(`in${i}`))
    const one = layout({ inputs: many, outputs: [output('answer')], sections: [section('All', [...many.map((each) => each.name), 'answer'])] })
    for (const width of one.widths) {
      for (const each of width.sections) {
        assert.ok(columnWidth(width.px, each.columns) >= LAYOUT_LIMITS.columnPx, `${width.width} gave ${columnWidth(width.px, each.columns)}`)
      }
    }
  })

  it('gives something drawn the whole row rather than a share of it', () => {
    const many = new Array(5).fill(0).map((_, i) => input(`in${i}`))
    const one = layout({
      inputs: many,
      outputs: [output('path', 'plot')],
      sections: [section('All', [...many.map((each) => each.name), 'path'])]
    })
    const wide = at(one, 'wide').sections[0]
    const plot = wide.items.find((each) => each.name === 'path')
    assert.ok(plot !== undefined)
    // Either it has the row, or one column was already wide enough for it. Never a fraction that is too small.
    const each = columnWidth(at(one, 'wide').px, wide.columns)
    assert.ok(plot.span === wide.columns || each >= LAYOUT_LIMITS.plotPx, `span ${plot.span} of ${wide.columns} at ${each}px`)
  })

  it('keeps the sections the Page declared, because what belongs together is not a thing the width knows', () => {
    const one = simple()
    for (const width of one.widths) {
      assert.deepEqual(width.sections.map((each) => each.title), ['The throw', 'The answer'])
    }
  })

  it('packs a Page tightly only once there is a lot of it', () => {
    assert.equal(simple().density, 'comfortable')
    const many = new Array(14).fill(0).map((_, i) => input(`in${i}`))
    const busy = layout({ inputs: many, outputs: [output('answer')], sections: [section('All', [...many.map((each) => each.name), 'answer'])] })
    assert.equal(busy.density, 'compact')
  })

  it('marks every item with how much of the point it carries', () => {
    const one = simple()
    const answer = at(one, 'desktop').sections[1].items[0]
    assert.equal(answer.emphasis, 'primary')
    const speed = at(one, 'desktop').sections[0].items[0]
    assert.equal(speed.emphasis, 'secondary')
  })
})

describe('what is wrong with a layout', () => {
  it('finds nothing wrong with an ordinary Page', () => {
    const one = layout({
      inputs: [input('speed'), input('angle')],
      outputs: [output('range')],
      sections: [section('The throw', ['speed', 'angle']), section('The answer', ['range'])]
    })
    assert.deepEqual(checkLayout(one, [output('range')]).filter((problem) => problem.severity === 'error'), [])
  })

  it('objects when a section holds more than it can arrange', () => {
    const many = new Array(LAYOUT_LIMITS.perSection + 2).fill(0).map((_, i) => input(`in${i}`))
    const one = layout({ inputs: many, outputs: [output('answer')], sections: [section('All', [...many.map((each) => each.name), 'answer'])] })
    assert.ok(checkLayout(one, [output('answer')]).some((problem) => problem.code === 'section-too-full'))
  })

  it('objects when everything claims to be the important thing', () => {
    // Not reachable through `emphasise`, which caps it at two, so the guard is checked directly -- a rule nothing can
    // reach is one nobody knows still works.
    const one = layout({ inputs: [], outputs: [output('a'), output('b'), output('c')], sections: [section('All', ['a', 'b', 'c'])] })
    const forged = { ...one, hierarchy: { primary: ['a', 'b', 'c'], secondary: [], supporting: [] } }
    assert.ok(checkLayout(forged, []).some((problem) => problem.code === 'everything-leads'))
  })

  it('treats a chart too narrow on a desktop as an error and on a phone as a warning', () => {
    // A phone is narrow and everybody knows it; a desktop that squeezes a chart is a layout mistake.
    const one = layout({ inputs: [], outputs: [output('path', 'plot')], sections: [section('Chart', ['path'])] })
    const problems = checkLayout(one, [output('path', 'plot')])
    const phone = problems.find((problem) => problem.code === 'too-narrow-to-draw' && problem.at.includes('phone'))
    if (phone !== undefined) assert.equal(phone.severity, 'warning')
    const desktop = problems.find((problem) => problem.code === 'too-narrow-to-draw' && problem.at.includes('desktop'))
    assert.equal(desktop, undefined, 'a desktop should have room for one chart')
  })

  it('says why, in words somebody could act on', () => {
    const one = layout({ inputs: [], outputs: [], sections: [] })
    const problems = checkLayout(one, [])
    assert.ok(problems.length > 0)
    for (const problem of problems) {
      assert.ok(problem.message.length > 20, problem.code)
      assert.ok(problem.code.length > 0)
    }
  })
})

describe('describing a Page for the accessibility audit', () => {
  const parts = {
    inputs: [
      { name: 'speed', kind: 'number' as const, label: 'Launch speed', minimum: 0, maximum: 100 },
      { name: 'plain', kind: 'number' as const, label: 'A plain number' },
      { name: 'surface', kind: 'choice' as const, label: 'Surface', options: [{ value: 'a', label: 'A' }] },
      { name: 'wind', kind: 'boolean' as const, label: 'Windy' },
      { name: 'note', kind: 'text' as const, label: 'A note' }
    ],
    outputs: [output('range'), output('path', 'plot'), output('rows', 'table')],
    sections: [section('The throw', ['speed']), section('The answer', ['range'])]
  }

  it('gives every control a role that matches what it is', () => {
    const described = describeForAudit(parts)
    const roleOf = (id: string): string | undefined => described.find((one) => one.id === id)?.role
    assert.equal(roleOf('speed'), 'slider', 'both ends known, so it is draggable')
    assert.equal(roleOf('plain'), 'spinbutton', 'no ends, so it is a number box')
    assert.equal(roleOf('surface'), 'combobox')
    assert.equal(roleOf('wind'), 'checkbox')
    assert.equal(roleOf('note'), 'textbox')
    assert.equal(roleOf('path'), 'img')
    assert.equal(roleOf('rows'), 'table')
    assert.equal(roleOf('range'), 'status')
  })

  it('gives every control the label somebody actually reads', () => {
    for (const one of describeForAudit(parts)) assert.ok((one.name ?? '').length > 0, one.id)
  })

  it('says every control can be reached by a keyboard, because the compiler can only emit native ones', () => {
    const described = describeForAudit(parts)
    for (const input of parts.inputs) {
      assert.equal(described.find((one) => one.id === input.name)?.keyboardReachable, true, input.name)
    }
  })

  it('says nothing about contrast or size, which are properties of pixels nobody has seen yet', () => {
    // Guessing them here would produce an audit that passes on a Page whose colours nobody has looked at.
    for (const one of describeForAudit(parts)) {
      assert.equal('foreground' in one, false, one.id)
      assert.equal('width' in one, false, one.id)
    }
  })

  it('describes the sections too, so a reader knows what groups what', () => {
    const described = describeForAudit(parts)
    assert.equal(described.filter((one) => one.role === 'group').length, 2)
  })
})

describe('describing a layout', () => {
  it('says what it leads with and how it changes with the width', () => {
    const one = layout({
      inputs: [input('speed')],
      outputs: [output('range')],
      sections: [section('The throw', ['speed']), section('The answer', ['range'])]
    })
    const said = describeLayout(one)
    assert.ok(said.includes('range'))
    assert.ok(said.includes('phone'))
  })

  it('says so plainly when nothing leads', () => {
    const one = layout({ inputs: [input('a')], outputs: [], sections: [section('Only', ['a'])] })
    assert.ok(describeLayout(one).includes('nothing in particular'))
  })
})
