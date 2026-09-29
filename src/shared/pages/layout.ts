/**
 * Where everything on a Page sits, at every width.
 *
 * The compiler used to put each section in a group and stop, which is a layout in the sense that a list is a layout.
 * It produces the failures that make a generated Page look generated: a chart squeezed into a third of a column, a
 * form of twelve identical boxes with no sense of which one matters, a row that works on a laptop and runs off the
 * side of a phone.
 *
 * ## It is computed, not described
 *
 * Nothing here comes from the model. A layout asked for by a model is a layout in pixels somebody invented, and it is
 * wrong on the first screen that is not the one they imagined. What this reads is the Page itself -- how many things
 * there are, what kind each one is, what it is for -- and everything else follows from the width available.
 *
 * That is also why a spec has no layout field. There is nowhere to put one, so there is nothing to disagree with.
 *
 * ## Hierarchy is the part that is not arithmetic
 *
 * Columns and spans fall out of counting. What makes a Page readable is that the thing it exists to tell you is the
 * thing you see first, and everything else is visibly not that. A Page with twelve equal cards has no hierarchy and
 * reads as a dump, whatever its spacing. So `emphasise` decides what the Page is *for* -- from what it computes and
 * how that is shown -- and the layout gives that room at every width while the rest gets less.
 *
 * ## What it refuses
 *
 * `checkLayout` is not advice. A Page whose chart would render 90 pixels wide, or whose every element claims to be
 * the important one, has a layout defect that no amount of rendering will reveal to somebody who was not looking for
 * it -- and a generated Page has nobody looking. Those come back as problems, and `healing.ts` attributes them here.
 */

import type { SpecDisplay, SpecInput, SpecOutput, SpecSection } from './spec.ts'

/** The widths a Page is laid out for. Four, because a fifth would be a difference nothing acts on. */
export type Width = 'phone' | 'tablet' | 'desktop' | 'wide'

export const WIDTHS: readonly { name: Width; px: number }[] = Object.freeze([
  Object.freeze({ name: 'phone' as const, px: 380 }),
  Object.freeze({ name: 'tablet' as const, px: 760 }),
  Object.freeze({ name: 'desktop' as const, px: 1100 }),
  Object.freeze({ name: 'wide' as const, px: 1600 })
])

export const LAYOUT_LIMITS = Object.freeze({
  /**
   * The narrowest a column may be.
   *
   * A number box, its label and a unit need this much before the label starts wrapping onto three lines. It is what
   * stops a wide screen being divided into six useless slivers.
   */
  columnPx: 240,
  /** The narrowest anything drawn may be before it stops being readable rather than merely small. */
  plotPx: 320,
  /** The most columns any width gets. Past this a row reads as a table nobody can follow across. */
  columns: 3,
  /** Above this many things in one section, it wants splitting rather than laying out. */
  perSection: 12,
  /** The side gutter, subtracted before anything is divided up. */
  gutterPx: 32,
  /** The gap between columns. */
  gapPx: 16
})

/**
 * How much of the Page's point one thing carries.
 *
 * Three, not five. A scale with more steps than the eye can tell apart is a scale that was not applied.
 */
export type Emphasis = 'primary' | 'secondary' | 'supporting'

export interface Placed {
  name: string
  emphasis: Emphasis
  /**
   * How many columns it takes at this width.
   *
   * Never more than the width has. A thing that is drawn takes the whole row rather than a share, because a chart in
   * a third of a column is not a smaller chart -- it is an unreadable one.
   */
  span: number
}

export interface PlacedSection {
  title: string
  columns: number
  items: readonly Placed[]
}

export interface WidthLayout {
  width: Width
  px: number
  columns: number
  sections: readonly PlacedSection[]
}

export interface Layout {
  /** One arrangement per width, all from the same Page. */
  widths: readonly WidthLayout[]
  /** What the Page is for, and what merely supports it. */
  hierarchy: Readonly<Record<Emphasis, readonly string[]>>
  /**
   * How tightly things are packed.
   *
   * From how much there is rather than from taste: a Page of four things has room to breathe and a Page of twenty
   * does not, and pretending otherwise gives the second one a scroll bar instead of a layout.
   */
  density: 'comfortable' | 'compact'
}

export interface LayoutProblem {
  at: string
  severity: 'error' | 'warning'
  code: string
  message: string
}

/** Which displays want the whole row. */
const WIDE_DISPLAYS: ReadonlySet<SpecDisplay> = new Set<SpecDisplay>(['plot', 'table'])

/**
 * How much of the Page's point each display carries, before anything else is considered.
 *
 * A drawing is what somebody looks at; a single number is what they read; a table is what they consult. That order is
 * about attention rather than importance, and it is the order the layout gives room in.
 */
const DISPLAY_WEIGHT: Readonly<Record<SpecDisplay, number>> = Object.freeze({
  plot: 4,
  statistic: 3,
  table: 2,
  value: 1
})

/**
 * What the Page is for, and what is merely how you tell it.
 *
 * Outputs carry the point: a calculator exists for its answer, not for its boxes. Among them the ones shown most
 * prominently come first, and at most two are primary -- a Page where everything is primary has said nothing about
 * what matters, which is the same as a Page that said nothing at all.
 *
 * Inputs are secondary without exception. They are how somebody asks the question; they are not the answer, and a
 * layout that leads with them makes a form out of a tool.
 */
export function emphasise(inputs: readonly SpecInput[], outputs: readonly SpecOutput[]): Record<Emphasis, string[]> {
  const ranked = [...outputs].sort((a, b) => DISPLAY_WEIGHT[b.display] - DISPLAY_WEIGHT[a.display])
  const primary = ranked.slice(0, Math.min(2, ranked.length)).map((one) => one.name)
  const secondary = inputs.map((one) => one.name)
  const supporting = ranked.slice(primary.length).map((one) => one.name)
  return { primary, secondary, supporting }
}

/** How many columns a width has, given what the Page holds. */
function columnsAt(px: number, items: number): number {
  // A phone is one column whatever the Page is. Everything else follows from the room there actually is.
  const usable = px - LAYOUT_LIMITS.gutterPx
  const fit = Math.floor((usable + LAYOUT_LIMITS.gapPx) / (LAYOUT_LIMITS.columnPx + LAYOUT_LIMITS.gapPx))
  // Never more columns than there are things, or the last row is mostly gap.
  return Math.max(1, Math.min(LAYOUT_LIMITS.columns, fit, items))
}

/** The width one column gets, once the gutter and the gaps are taken out. */
export const columnWidth = (px: number, columns: number): number =>
  Math.floor((px - LAYOUT_LIMITS.gutterPx - LAYOUT_LIMITS.gapPx * (columns - 1)) / columns)

/**
 * A Page laid out.
 *
 * The sections are the author's grouping and are kept: what belongs together is a thing the Page knows and the width
 * does not. What changes with the width is how many columns each section is divided into and what takes a whole row.
 */
export function layout(parts: {
  inputs: readonly SpecInput[]
  outputs: readonly SpecOutput[]
  sections: readonly SpecSection[]
}): Layout {
  const hierarchy = emphasise(parts.inputs, parts.outputs)
  const emphasisOf = (name: string): Emphasis =>
    hierarchy.primary.includes(name) ? 'primary' : hierarchy.secondary.includes(name) ? 'secondary' : 'supporting'
  const displayOf = new Map(parts.outputs.map((one) => [one.name, one.display]))
  const total = parts.inputs.length + parts.outputs.length

  const widths = WIDTHS.map(({ name, px }) => {
    const sections = parts.sections.map((section) => {
      const columns = columnsAt(px, section.members.length)
      const each = columnWidth(px, columns)
      const items = section.members.map((member) => {
        const display = displayOf.get(member)
        // Something drawn takes the whole row unless a single column is already wide enough for it, which is the
        // only case where sharing does not make it unreadable.
        const wide = display !== undefined && WIDE_DISPLAYS.has(display) && each < LAYOUT_LIMITS.plotPx
        return { name: member, emphasis: emphasisOf(member), span: wide ? columns : 1 }
      })
      return { title: section.title, columns, items: Object.freeze(items) }
    })
    return { width: name, px, columns: columnsAt(px, total), sections: Object.freeze(sections) }
  })

  return {
    widths: Object.freeze(widths),
    hierarchy: Object.freeze({
      primary: Object.freeze(hierarchy.primary),
      secondary: Object.freeze(hierarchy.secondary),
      supporting: Object.freeze(hierarchy.supporting)
    }),
    // Twelve is where a comfortable Page stops fitting on a laptop without scrolling past the answer.
    density: total > 12 ? 'compact' : 'comfortable'
  }
}

/**
 * What is wrong with a layout.
 *
 * Each of these is a defect somebody would notice immediately and nobody is looking for, because a generated Page has
 * no author reviewing it. They are found by arithmetic on the layout rather than by rendering, which means they are
 * found before anything is built rather than after.
 */
export function checkLayout(one: Layout, outputs: readonly SpecOutput[]): LayoutProblem[] {
  const problems: LayoutProblem[] = []
  const add = (at: string, code: string, message: string, severity: 'error' | 'warning' = 'error'): void => {
    problems.push({ at, code, message, severity })
  }

  if (one.hierarchy.primary.length === 0) {
    add('hierarchy', 'nothing-leads', 'Nothing on this Page is the thing it is for, so a reader has nowhere to look first.')
  }
  const everything = one.hierarchy.primary.length + one.hierarchy.secondary.length + one.hierarchy.supporting.length
  if (everything > 2 && one.hierarchy.primary.length === everything) {
    add('hierarchy', 'everything-leads', 'Everything here is the important thing, which says the same as nothing being it.')
  }

  const drawn = new Set(outputs.filter((output) => WIDE_DISPLAYS.has(output.display)).map((output) => output.name))
  for (const width of one.widths) {
    for (const section of width.sections) {
      if (section.items.length > LAYOUT_LIMITS.perSection) {
        add(
          `widths.${width.width}.${section.title}`,
          'section-too-full',
          `"${section.title}" holds ${section.items.length} things. Past ${LAYOUT_LIMITS.perSection} it wants splitting rather than arranging.`
        )
      }
      const each = columnWidth(width.px, section.columns)
      for (const item of section.items) {
        if (item.span > section.columns) {
          add(
            `widths.${width.width}.${section.title}.${item.name}`,
            'wider-than-the-row',
            `"${item.name}" takes ${item.span} columns of ${section.columns}, so it would run off the side.`
          )
        }
        if (drawn.has(item.name)) {
          const given = each * item.span + LAYOUT_LIMITS.gapPx * (item.span - 1)
          if (given < LAYOUT_LIMITS.plotPx) {
            add(
              `widths.${width.width}.${section.title}.${item.name}`,
              'too-narrow-to-draw',
              `"${item.name}" is drawn, and at ${width.width} it would get ${given} pixels. Below ${LAYOUT_LIMITS.plotPx} it is not a smaller chart, it is an unreadable one.`,
              width.width === 'phone' ? 'warning' : 'error'
            )
          }
        }
        if (each < LAYOUT_LIMITS.columnPx) {
          add(
            `widths.${width.width}.${section.title}`,
            'columns-too-narrow',
            `At ${width.width} this section divides into ${section.columns} columns of ${each} pixels, and a control needs ${LAYOUT_LIMITS.columnPx}.`
          )
          break
        }
      }
    }
  }
  return problems
}

/**
 * The layout as a sentence, for somebody reading what was decided.
 *
 * Worth having because a layout that cannot be explained is one nobody can argue with, and the arrangement of a
 * generated Page is exactly the kind of thing somebody wants to argue with.
 */
export function describeLayout(one: Layout): string {
  const phone = one.widths.find((width) => width.width === 'phone')
  const wide = one.widths.find((width) => width.width === 'wide')
  const leads = one.hierarchy.primary.length === 0 ? 'nothing in particular' : one.hierarchy.primary.join(' and ')
  return (
    `It leads with ${leads}. ` +
    `On a phone it is ${phone?.columns ?? 1} column and on a wide screen ${wide?.columns ?? 1}, ` +
    `laid out ${one.density === 'compact' ? 'tightly, because there is a lot of it' : 'with room to breathe'}.`
  )
}

export const LAYOUT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A layout is computed from what the Page holds, never described by a model. A layout asked for is a layout in pixels somebody imagined, and it is wrong on the first screen that is not theirs.',
  'A specification has no layout field, so there is nothing for a model to disagree with.',
  'Outputs carry the point of a Page and inputs never do. A layout that leads with the boxes makes a form out of a tool.',
  'At most two things are primary. A Page where everything is important has said the same as one that said nothing.',
  'Something drawn takes the whole row unless one column is already wide enough. A chart in a third of a column is not a smaller chart.',
  'A phone is one column whatever the Page is, and everything else follows from the room there actually is.'
])
