/**
 * The shapes a Page comes in, and what each one does to a specification.
 *
 * Every generated Page is arranged by whoever wrote it, which means every generated Page is arranged differently. Two
 * calculators built a minute apart end up with different section names, different orders, different decisions about
 * what waits for a button -- not because the Pages differ but because nothing decided. That is the single most
 * visible way a generated Page announces that nobody thought about it.
 *
 * ## A shape is not a template, and the difference matters
 *
 * A template is a Page with the details left out, and Orbis already has thirty-seven Pages -- a template library
 * would duplicate them, which the discovery ladder exists to prevent. A **shape** carries no calculations and no
 * subject. It is the arrangement a kind of Page wants: what the sections are called, what leads, what goes beside
 * what, and what is heavy enough to wait for a button.
 *
 * So a shape never competes with an existing Page. It decides how whatever was built is laid out, and two Pages of
 * the same shape look like two Pages from the same application.
 *
 * ## Arranging is deterministic and happens after
 *
 * The model produces a specification and `arrange` rearranges it. Nothing is added, nothing is removed, no label is
 * rewritten -- the sections are rebuilt from what is there. That ordering is deliberate: telling a model the
 * arrangement it should use gets the arrangement it felt like, while doing it afterwards gets the arrangement every
 * time.
 *
 * ## The fast path
 *
 * A shape also says how much pipeline a Page needs. A reference Page of three constants needs no layout deliberation
 * and no visual check; a report of twenty figures needs both. That is §44's fast path, and it falls out of having
 * named the shapes rather than being a second mechanism.
 */

import type { PageSpec, SpecDisplay, SpecSection } from './spec.ts'

export type ShapeId = 'calculator' | 'explorer' | 'comparison' | 'reference' | 'report'

/** What a specification amounts to, in the terms the shapes are chosen by. */
export interface Counted {
  inputs: number
  outputs: number
  /** Outputs shown as a chart. */
  drawn: number
  tables: number
}

export interface Shape {
  id: ShapeId
  name: string
  /** One sentence, for somebody being told what was built. */
  describe: string
  /** What to tell a model about the kind of Page this is. Never about arrangement, which is decided here. */
  guidance: string
  /** True when a Page of this size and kind is this shape. */
  fits(counted: Counted): boolean
  /** What the sections are called. Two, unless the shape wants otherwise. */
  sections: { forInputs: string; forOutputs: string }
  /**
   * Whether a Page of this shape needs the whole pipeline.
   *
   * A reference Page has three figures and no arrangement worth deliberating over; a report has twenty and does.
   */
  thorough: boolean
}

/**
 * The shapes, most specific first.
 *
 * `calculator` is last because it fits almost anything, and a shape that fits everything would claim every Page
 * before a better-fitting one was tried.
 */
export const SHAPES: readonly Shape[] = Object.freeze([
  Object.freeze({
    id: 'reference' as const,
    name: 'Reference',
    describe: 'figures to look up rather than work out',
    guidance: 'This Page mostly shows figures that do not depend on anything typed in. Keep the inputs to a minimum.',
    fits: (counted: Counted) => counted.inputs === 0 && counted.outputs > 0,
    sections: { forInputs: 'Settings', forOutputs: 'The figures' },
    thorough: false
  }),
  Object.freeze({
    id: 'explorer' as const,
    name: 'Explorer',
    describe: 'something to move and watch change',
    guidance: 'This Page is for moving a control and watching a chart change. Give the numbers ranges so they can be dragged.',
    fits: (counted: Counted) => counted.drawn > 0 && counted.inputs > 0,
    sections: { forInputs: 'What you set', forOutputs: 'What happens' },
    thorough: true
  }),
  Object.freeze({
    id: 'comparison' as const,
    name: 'Comparison',
    describe: 'two things held against each other',
    guidance: 'This Page puts two things side by side. Work out the same figures for each so they can be compared.',
    fits: (counted: Counted) => counted.inputs >= 4 && counted.outputs >= 3 && counted.drawn === 0,
    sections: { forInputs: 'What you are comparing', forOutputs: 'How they differ' },
    thorough: true
  }),
  Object.freeze({
    id: 'report' as const,
    name: 'Report',
    describe: 'a set of figures worked out together',
    guidance: 'This Page works out several related figures at once. A table is often the clearest way to show them.',
    fits: (counted: Counted) => counted.outputs >= 4 || counted.tables > 0,
    sections: { forInputs: 'What you know', forOutputs: 'What that gives you' },
    thorough: true
  }),
  Object.freeze({
    id: 'calculator' as const,
    name: 'Calculator',
    describe: 'numbers in, an answer out',
    guidance: 'This Page takes a few numbers and works out an answer. Keep it to the answer somebody asked for.',
    fits: () => true,
    sections: { forInputs: 'What you know', forOutputs: 'The answer' },
    thorough: false
  })
])

const WIDE: ReadonlySet<SpecDisplay> = new Set<SpecDisplay>(['plot', 'table'])

/** What a specification amounts to, in the terms the shapes are chosen by. */
export function count(spec: Pick<PageSpec, 'inputs' | 'outputs'>): Counted {
  return {
    inputs: spec.inputs.length,
    outputs: spec.outputs.length,
    drawn: spec.outputs.filter((one) => one.display === 'plot').length,
    tables: spec.outputs.filter((one) => one.display === 'table').length
  }
}

/** The shape a Page is. Never null: `calculator` fits anything, which is why it is last. */
export function shapeOf(spec: Pick<PageSpec, 'inputs' | 'outputs'>): Shape {
  const counted = count(spec)
  return SHAPES.find((one) => one.fits(counted)) ?? SHAPES[SHAPES.length - 1]
}

/** The shape a request is likely to want, before anything has been built. */
export function shapeFor(request: string): Shape {
  const said = request.toLowerCase()
  if (/\b(compare|versus|against|side by side|difference between)\b/.test(said)) {
    return SHAPES.find((one) => one.id === 'comparison') as Shape
  }
  if (/\b(chart|graph|plot|curve|visuali[sz]e|watch|explore)\b/.test(said)) {
    return SHAPES.find((one) => one.id === 'explorer') as Shape
  }
  if (/\b(table|report|summary|breakdown|all the)\b/.test(said)) {
    return SHAPES.find((one) => one.id === 'report') as Shape
  }
  if (/\b(look up|reference|constants?|values? of)\b/.test(said)) {
    return SHAPES.find((one) => one.id === 'reference') as Shape
  }
  return SHAPES.find((one) => one.id === 'calculator') as Shape
}

export const shapeById = (id: string): Shape | null =>
  SHAPES.find((one) => one.id === id) ?? null

/**
 * A specification arranged to its shape.
 *
 * Nothing is added, removed or renamed. The sections are rebuilt from what is already there, in an order that is the
 * same for every Page of the same shape:
 *
 * - what somebody sets, first, because that is where their hands go;
 * - what the Page works out, after, with anything drawn leading it.
 *
 * A Page whose own sections already say something more specific keeps them. The purpose is consistency where there
 * was none, not overruling an author who had a reason -- and a model that named its sections after the subject
 * ("The throw", "Where it lands") has told somebody more than "What you know" would.
 */
export function arrange(spec: PageSpec, shape: Shape = shapeOf(spec)): PageSpec {
  const inputs = spec.inputs.map((one) => one.name)
  const outputs = [...spec.outputs]
    // Anything drawn leads, then single figures, then the rest. Within each, the order the author chose.
    .map((one, i) => ({ one, i, rank: WIDE.has(one.display) ? 0 : one.display === 'statistic' ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((each) => each.one.name)

  // Sections the author named are kept when they are about the subject rather than about the mechanics. A section
  // called "Inputs" says nothing; one called "The throw" says what the numbers are for.
  const generic = /^(inputs?|outputs?|results?|values?|settings?|controls?|parameters?|answers?|data)$/i
  const named = spec.sections.filter((one) => !generic.test(one.title.trim()))
  const keepTheirs = named.length === spec.sections.length && spec.sections.length >= 2

  if (keepTheirs) {
    // Their titles, this shape's order: inputs before outputs, and within a section the same ranking.
    const rank = new Map([...inputs, ...outputs].map((name, i) => [name, i]))
    const sections = spec.sections
      .map((section, i) => ({
        section,
        i,
        rank: Math.min(...section.members.map((one) => rank.get(one) ?? Number.POSITIVE_INFINITY))
      }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map(({ section }) => ({
        ...section,
        members: [...section.members]
          .map((name, i) => ({ name, i, rank: rank.get(name) ?? Number.POSITIVE_INFINITY }))
          .sort((a, b) => a.rank - b.rank || a.i - b.i)
          .map((each) => each.name)
      }))
    return { ...spec, sections }
  }

  const sections: SpecSection[] = []
  if (inputs.length > 0) sections.push({ title: shape.sections.forInputs, members: inputs })
  if (outputs.length > 0) sections.push({ title: shape.sections.forOutputs, members: outputs })
  // A Page with neither keeps whatever it had, which `checkSpec` will then refuse on its own terms rather than this
  // silently producing a Page with no sections at all.
  return sections.length === 0 ? spec : { ...spec, sections }
}

/**
 * Which calculations should wait for a button.
 *
 * Read from how much one keystroke would set off rather than from the shape: a Page of three calculations fed by
 * three separate boxes is fine, and a Page of three all fed by one box is not. The heaviest are moved first, because
 * moving the cheap ones leaves the expensive one still firing on every character.
 */
export function shouldWait(spec: PageSpec, perKeystroke: number): string[] {
  const byInput = new Map<string, string[]>()
  for (const step of spec.steps) {
    if (step.when !== 'change') continue
    for (const source of Object.values(step.arguments)) {
      if (!('input' in source)) continue
      byInput.set(source.input, [...(byInput.get(source.input) ?? []), step.name])
    }
  }
  const worst = [...byInput.values()].reduce((most, one) => (one.length > most.length ? one : most), [] as string[])
  if (worst.length <= perKeystroke) return []

  // The ones that take the most arguments are the ones most likely to be doing the most, which is the best guess
  // available without running them. Everything above the limit moves.
  const heaviness = new Map(spec.steps.map((one) => [one.name, Object.keys(one.arguments).length]))
  return [...worst]
    .sort((a, b) => (heaviness.get(b) ?? 0) - (heaviness.get(a) ?? 0))
    .slice(0, worst.length - perKeystroke)
}

export const SHAPES_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A shape carries no calculations and no subject, so it never competes with a Page that already exists. It decides arrangement only.',
  'Arranging happens after the specification is written, not before. Telling a model the arrangement gets the one it felt like; doing it afterwards gets it every time.',
  'Nothing is added, removed or renamed by arranging. The sections are rebuilt from what is there.',
  'A Page whose sections are named after its subject keeps them. "The throw" tells somebody more than "What you know", and consistency is not worth overruling that.',
  'What somebody sets comes before what the Page works out, because that is where their hands go. Anything drawn leads what it works out.',
  'Which calculations wait for a button is read from how much one keystroke sets off, not from the shape.',
  'The shape also says how much pipeline a Page needs, so the fast path is a consequence of naming the shapes rather than a second mechanism.'
])
