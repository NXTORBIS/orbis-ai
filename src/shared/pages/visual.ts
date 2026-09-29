/**
 * Looking at what a Page actually rendered as, rather than at what it was supposed to render as.
 *
 * Everything else about a generated Page is checked before it runs: the specification, the capabilities, the layout
 * arithmetic, the calculations. All of that can pass while the thing on screen is wrong, and this file exists because
 * that is not hypothetical -- it happened here. A Page was specified correctly, compiled correctly, passed every
 * gate, ran its calculation correctly during generation, and rendered with the word "nothing yet" where its answer
 * should have been, because the preview reached a door the Page was not yet through. Nothing in the pipeline could
 * see that, because nothing in the pipeline was looking at the Page.
 *
 * So the first check in this file is: **does every place an answer should appear have one?**
 *
 * ## This is not vision
 *
 * There is no image here and no model looking at one. What is judged is a description of what the renderer produced:
 * where each element ended up, how big it is, what text is in it, whether its content fits inside it. The renderer
 * can say all of that about itself precisely, and precisely beats approximately for every defect worth catching.
 *
 * The defects it cannot catch are the ones of taste. A Page can be ugly and pass everything here. That is the right
 * division: ugly is a judgement and somebody has to make it, while a control off the side of the screen is a fact.
 *
 * ## Why the observations come from outside
 *
 * This module judges and does not measure. Measuring means a live document, which means a window, which would make
 * all of this untestable without one. The renderer measures and hands the numbers here.
 */

import { checkContrast, isColourError } from './accessibility.ts'

export const VISUAL_LIMITS = Object.freeze({
  /** The smallest anything a person clicks may be, in CSS pixels. Matches the accessibility floor. */
  targetPx: 24,
  /** How much two boxes may overlap before it is a defect rather than a border touching. */
  overlapPx: 2,
  /** How far past its box text may run before it counts as clipped. Sub-pixel rounding is not clipping. */
  clipPx: 2,
  /** How far below the top of the page the thing it is for may sit before somebody has to hunt for it. */
  foldPx: 900
})

/**
 * What a Page rendered as, as the renderer can describe it.
 *
 * Every field is something a document can be asked about directly. Nothing here is inferred, and nothing needs a
 * screenshot.
 */
export interface Rendered {
  /** The component's id, so a finding points at the thing rather than describing it. */
  id: string
  /** What it is: `statistic`, `plot`, `number-input`, `button`, `group`. */
  kind: string
  /** Its box, in CSS pixels, relative to the top left of the Page. */
  x: number
  y: number
  width: number
  height: number
  /** The text a person can read in it. Empty when there is none. */
  text: string
  /**
   * How wide and tall the content actually is.
   *
   * Larger than the box means the content is cut off. This is the only reliable way to know: text that is clipped
   * looks exactly like text that happened to be that length.
   */
  contentWidth?: number
  contentHeight?: number
  /** True when it is on screen at all. Something `display: none` is not a defect, it is hidden on purpose. */
  visible: boolean
  foreground?: string
  background?: string
  fontPixels?: number
  /** For a component bound to a field: whether it is showing a value yet. */
  bound?: { field: string; hasValue: boolean }
  /** How much of the Page's point it carries, from the layout. */
  emphasis?: 'primary' | 'secondary' | 'supporting'
}

export type VisualCode =
  | 'no-answer'
  | 'clipped'
  | 'overlapping'
  | 'off-screen'
  | 'too-small'
  | 'invisible'
  | 'buried'
  | 'unreadable'
  | 'empty-page'

export interface VisualProblem {
  at: string
  severity: 'error' | 'warning'
  code: VisualCode
  message: string
}

export interface VisualResult {
  problems: readonly VisualProblem[]
  /** True when nothing is an error. */
  looksRight: boolean
  /** What was looked at, so a pass says how much it covered rather than only that it passed. */
  examined: number
}

/** The kinds that exist to show an answer. An empty one of these is the defect this file was written for. */
const SHOWS_AN_ANSWER: ReadonlySet<string> = new Set(['statistic', 'value', 'plot', 'table'])

/** The kinds a person operates, which have a minimum size. */
const OPERATED: ReadonlySet<string> = new Set([
  'button',
  'number-input',
  'text-input',
  'checkbox',
  'choice',
  'slider',
  'quantity-input'
])

const overlaps = (a: Rendered, b: Rendered): boolean => {
  const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return across > VISUAL_LIMITS.overlapPx && down > VISUAL_LIMITS.overlapPx
}

/** True when one box is entirely inside another, which is a group holding its children rather than a collision. */
const contains = (outer: Rendered, inner: Rendered): boolean =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height

/**
 * A rendered Page, examined.
 *
 * `viewportWidth` is what it was rendered at, so "off the side" means something rather than being a guess.
 */
export function examine(elements: readonly Rendered[], viewportWidth: number): VisualResult {
  const problems: VisualProblem[] = []
  const add = (at: string, code: VisualCode, message: string, severity: 'error' | 'warning' = 'error'): void => {
    problems.push({ at, code, message, severity })
  }

  const shown = elements.filter((one) => one.visible)
  if (shown.length === 0) {
    add('', 'empty-page', 'Nothing rendered at all.')
    return { problems: Object.freeze(problems), looksRight: false, examined: elements.length }
  }

  for (const one of shown) {
    // ---- the defect this file was written for
    //
    // A box that exists to show an answer and has none. Everything upstream can pass while this is true, because
    // everything upstream checks that the Page *would* produce an answer rather than that it *did*.
    if (SHOWS_AN_ANSWER.has(one.kind) && one.bound !== undefined && !one.bound.hasValue) {
      add(
        one.id,
        'no-answer',
        `"${one.id}" is where an answer goes and there is none in it. The Page opened without working anything out.`
      )
    }

    if (one.width === 0 || one.height === 0) {
      add(one.id, 'invisible', `"${one.id}" is on the Page and has no size, so nobody can see or use it.`)
      continue
    }

    if (one.x < -VISUAL_LIMITS.clipPx || one.x + one.width > viewportWidth + VISUAL_LIMITS.clipPx) {
      add(
        one.id,
        'off-screen',
        `"${one.id}" runs from ${Math.round(one.x)} to ${Math.round(one.x + one.width)} across a ${viewportWidth} pixel screen, so part of it cannot be reached.`
      )
    }

    if (one.contentWidth !== undefined && one.contentWidth > one.width + VISUAL_LIMITS.clipPx) {
      add(one.id, 'clipped', `The text in "${one.id}" needs ${Math.round(one.contentWidth)} pixels and has ${Math.round(one.width)}, so it is cut off.`)
    }
    if (one.contentHeight !== undefined && one.contentHeight > one.height + VISUAL_LIMITS.clipPx) {
      add(one.id, 'clipped', `The content of "${one.id}" is taller than the space it has, so the end of it is hidden.`)
    }

    if (OPERATED.has(one.kind) && (one.width < VISUAL_LIMITS.targetPx || one.height < VISUAL_LIMITS.targetPx)) {
      add(
        one.id,
        'too-small',
        `"${one.id}" is ${Math.round(one.width)} by ${Math.round(one.height)} and something somebody has to hit needs ${VISUAL_LIMITS.targetPx} each way.`
      )
    }

    if (one.emphasis === 'primary' && one.y > VISUAL_LIMITS.foldPx) {
      add(
        one.id,
        'buried',
        `"${one.id}" is what this Page is for and it sits ${Math.round(one.y)} pixels down, so somebody has to go looking for it.`,
        'warning'
      )
    }

    if (one.foreground !== undefined && one.background !== undefined && one.text.length > 0) {
      const contrast = checkContrast(one.foreground, one.background, one.fontPixels ?? 16)
      if (!isColourError(contrast) && !contrast.passesAA) {
        // The contrast module's own sentence, which already says what would fix it. Rewriting it here would be a
        // second opinion about a number that has exactly one correct explanation.
        add(one.id, 'unreadable', `The text in "${one.id}" is hard to read. ${contrast.describe}`)
      }
    }
  }

  // ---- collisions
  //
  // Only between things neither of which holds the other. A group's box covers its children by construction, and
  // reporting that would bury every real collision in noise.
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i]
      const b = shown[j]
      if (contains(a, b) || contains(b, a)) continue
      if (!overlaps(a, b)) continue
      add(`${a.id}`, 'overlapping', `"${a.id}" and "${b.id}" are drawn on top of each other.`)
    }
  }

  return {
    problems: Object.freeze(problems),
    looksRight: !problems.some((one) => one.severity === 'error'),
    examined: shown.length
  }
}

/**
 * The same Page at several widths.
 *
 * A Page is not laid out for one screen, so it is not examined at one either. Each width is reported separately,
 * because "it is fine on a desktop and broken on a phone" is a different thing from "it is broken".
 */
export function examineWidths(
  runs: readonly { width: string; viewportWidth: number; elements: readonly Rendered[] }[]
): { byWidth: Readonly<Record<string, VisualResult>>; looksRight: boolean; problems: readonly VisualProblem[] } {
  const byWidth: Record<string, VisualResult> = {}
  const problems: VisualProblem[] = []
  for (const run of runs) {
    const result = examine(run.elements, run.viewportWidth)
    byWidth[run.width] = result
    for (const one of result.problems) problems.push({ ...one, at: `${run.width}:${one.at}` })
  }
  return {
    byWidth: Object.freeze(byWidth),
    looksRight: !problems.some((one) => one.severity === 'error'),
    problems: Object.freeze(problems)
  }
}

/**
 * Which engine is answerable for a visual defect.
 *
 * The attribution `healing.ts` repairs against. A chart off the side of the screen is the layout engine's; a box with
 * no answer in it is the runtime's, because the Page was specified to produce one and did not.
 */
export const blameFor = (code: VisualCode): 'layout' | 'runtime' | 'component' | 'compiler' => {
  switch (code) {
    case 'no-answer':
      return 'runtime'
    case 'off-screen':
    case 'overlapping':
    case 'clipped':
    case 'buried':
      return 'layout'
    case 'too-small':
    case 'invisible':
    case 'unreadable':
      return 'component'
    case 'empty-page':
      return 'compiler'
  }
}

export const VISUAL_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Everything else checks that a Page *would* work. This checks that it *did*, which is a different question and the one that was being missed.',
  'There is no image and no model looking at one. The renderer describes what it produced, and precise beats approximate for every defect worth catching.',
  'A Page can be ugly and pass all of this. Ugly is a judgement somebody has to make; a control off the side of the screen is a fact.',
  'A box that exists to show an answer and has none is an error, not a loading state. Nothing upstream can see it, because nothing upstream looks at the Page.',
  'A group covering its children is not a collision. Reporting it would bury every real one.',
  'A Page is examined at every width it is laid out for, because "broken on a phone" is not the same as "broken".'
])
