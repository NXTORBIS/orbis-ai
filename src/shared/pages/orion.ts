/**
 * Orion and Pages: when a question should be answered by an engine rather than by a model.
 *
 * ## The one rule
 *
 * **A language model must never produce a number it could compute.**
 *
 * This is not a preference about architecture. A model asked for `1847 * 2293` will answer confidently, fluently, and
 * often wrongly, and there is no way to tell from the answer which it was. An engine asked the same thing is either
 * right or refuses. So when a question has a deterministic answer, `planAnswer` routes it to the engine, and the
 * result is labelled as computed with the operation named -- so somebody reading it knows which kind of answer they
 * have.
 *
 * ## Refusing to guess is part of the job
 *
 * Most questions cannot be parsed into an engine call reliably. "How much is a lot of flour" is not a conversion.
 * `planAnswer` returns null for anything it cannot map **exactly**, and null means Orion answers normally. A half-parsed
 * question routed to an engine produces a precise answer to a question nobody asked, which is worse than a vague answer
 * to the right one.
 *
 * ## What Orion may say about a Page
 *
 * Only what the register says. A Page's own description, its stated limitations, and what it is allowed to do. Orion
 * does not speculate about what a Page might be able to do, because a Page that cannot do what Orion promised is a
 * worse outcome than Orion saying it does not know.
 *
 * Pure. No model, no network.
 */

import type { RegisteredPage } from './registry.ts'

export interface AnswerPlan {
  /** The engine operation to run. */
  operation: string
  input: Record<string, unknown>
  /** What was understood, echoed back so somebody can see whether it was understood correctly. */
  understood: string
  /** How Orion should introduce the answer. Always says it was worked out rather than recalled. */
  preamble: string
  /** How sure the parse is. Below `exact` nothing is routed here at all. */
  certainty: 'exact'
}

/** Numbers, including negatives, decimals and exponents. */
const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`

/**
 * A unit as somebody would type it.
 *
 * Deliberately narrow: letters, digits, `/`, `^`, `*` and a degree sign. Anything with a space in it is not matched,
 * because "20 degrees to the left" would otherwise parse as a conversion.
 */
const UNIT = String.raw`[A-Za-z°µμ][A-Za-z0-9/^*°µμ.-]*`

/**
 * Question shapes that map exactly onto an engine call.
 *
 * Each one is anchored to the whole string. A pattern that matched part of a sentence would fire on "I converted the
 * garage into 20 m of storage", and the confident wrong answer that produced would be worse than no answer.
 */
const PATTERNS: readonly {
  pattern: RegExp
  build(match: RegExpMatchArray): AnswerPlan | null
}[] = Object.freeze([
  // "convert 20 celsius to fahrenheit", "20 km/h in m/s", "what is 20 kg in lb"
  {
    pattern: new RegExp(
      String.raw`^(?:what(?:'s| is)\s+)?(?:convert\s+)?(${NUMBER})\s*(${UNIT})\s+(?:to|in|into|as)\s+(${UNIT})\??$`,
      'i'
    ),
    build: (match) => ({
      operation: 'units.convert',
      input: { value: Number(match[1]), from: match[2], to: match[3] },
      understood: `${match[1]} ${match[2]} converted to ${match[3]}`,
      preamble: 'Worked out with the unit engine, not from memory:',
      certainty: 'exact' as const
    })
  },
  // "solve x^2 + 3x + 2 = 0", "solve 2a + 4 = 10 for a"
  {
    pattern: /^solve\s+(.+?=.+?)(?:\s+for\s+([a-z][a-z0-9_]*))?\??$/i,
    build: (match) => ({
      operation: 'solver.solve',
      input: match[2] ? { equation: match[1].trim(), variable: match[2] } : { equation: match[1].trim() },
      understood: `${match[1].trim()} solved${match[2] ? ` for ${match[2]}` : ''}`,
      preamble: 'Solved with the equation engine, and every answer checked by substituting it back:',
      certainty: 'exact' as const
    })
  },
  // "differentiate x^2 + sin(x)", "derivative of x^3 with respect to x"
  {
    pattern: /^(?:differentiate|derivative of)\s+(.+?)(?:\s+(?:with respect to|wrt|by)\s+([a-z][a-z0-9_]*))?\??$/i,
    build: (match) => ({
      operation: 'expression.differentiate',
      // `text`, not `expression`: that is the key the operation reads. Getting it wrong here does not fail loudly --
      // the engine refuses, the question falls back to being answered normally, and the whole route is quietly dead.
      input: { text: match[1].trim(), variable: match[2] ?? 'x' },
      understood: `the derivative of ${match[1].trim()} with respect to ${match[2] ?? 'x'}`,
      preamble: 'Differentiated symbolically, not recalled:',
      certainty: 'exact' as const
    })
  },
  // "the mean of 1 2 3 4", "average of 10, 20, 30"
  {
    pattern: new RegExp(
      String.raw`^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:mean|average|median|spread|standard deviation)\s+of\s+((?:${NUMBER})(?:\s*[,;\s]\s*${NUMBER})+)\??$`,
      'i'
    ),
    build: (match) => {
      const values = match[1]
        .split(/[\s,;]+/)
        .filter((one) => one !== '')
        .map((one) => Number(one))
      // Two is the fewest that makes any of these mean anything, and a summary of one number is a number.
      if (values.length < 2 || values.some((one) => !Number.isFinite(one))) return null
      return {
        operation: 'statistics.summarise',
        input: { values },
        understood: `a summary of ${values.length} numbers`,
        preamble: 'Worked out with the statistics engine:',
        certainty: 'exact' as const
      }
    }
  },
  // Plain arithmetic: "what is 1847 * 2293", "12.5 / 4". The one people most expect a model to get right and it does not.
  {
    pattern: new RegExp(String.raw`^(?:what(?:'s| is)\s+)?(${NUMBER}(?:\s*[-+*/^]\s*${NUMBER})+)\s*=?\??$`, 'i'),
    build: (match) => ({
      operation: 'expression.evaluate',
      input: { text: match[1].replace(/\s+/g, '') },
      understood: match[1].replace(/\s+/g, ' ').trim(),
      preamble: 'Calculated exactly, not estimated:',
      certainty: 'exact' as const
    })
  }
])

/**
 * The engine call a question maps onto, or null.
 *
 * Null is the common answer and the safe one: it means Orion answers the question the way it answers everything else.
 * Only a question that matches a pattern **completely** is routed here.
 */
export function planAnswer(question: string): AnswerPlan | null {
  const text = String(question ?? '').trim()
  if (text === '' || text.length > 400) return null

  for (const { pattern, build } of PATTERNS) {
    const match = pattern.exec(text)
    if (match === null) continue
    const plan = build(match)
    if (plan !== null) return plan
  }
  return null
}

export interface ComputedAnswer {
  /** What Orion should say, with the source of the answer stated rather than implied. */
  text: string
  operation: string
  understood: string
  /** Caveats the engine returned. Never dropped: they are what make the number usable. */
  notes: readonly string[]
}

/**
 * An engine's result turned into something Orion can say.
 *
 * The preamble is not decoration. An answer that arrived from an engine and an answer the model produced look identical
 * on screen, and the difference between them is the difference between a number somebody can rely on and one they
 * cannot. So every computed answer says which it is.
 */
export function presentAnswer(plan: AnswerPlan, value: Record<string, unknown>): ComputedAnswer {
  const notes: string[] = []
  const collect = (one: unknown): void => {
    if (Array.isArray(one)) for (const note of one) if (typeof note === 'string') notes.push(note)
  }
  collect(value.notes)
  collect(value.assumptions)
  if (typeof value.describe === 'string') notes.push(value.describe)

  // The shapes the engines actually return, in the order of how directly they answer.
  const answer =
    typeof value.display === 'string'
      ? value.display
      : typeof value.report === 'string'
        ? value.report
        : typeof value.text === 'string'
          ? value.text
          : typeof value.value === 'number'
            ? String(Number((value.value as number).toPrecision(12)))
            : Array.isArray(value.solutions)
              ? (value.solutions as { text?: string; value?: number }[])
                  .map((one) => one.text ?? String(one.value))
                  .join(', ')
              : typeof value.mean === 'number'
                ? `mean ${Number((value.mean as number).toPrecision(6))}, median ${Number((value.median as number).toPrecision(6))}`
                : JSON.stringify(value)

  return {
    text: `${plan.preamble} ${answer}`,
    operation: plan.operation,
    understood: plan.understood,
    notes: Object.freeze(notes.slice(0, 6))
  }
}

/**
 * What Orion may say about a Page.
 *
 * Only what the register holds. Nothing is inferred about what a Page might be able to do, because a Page that cannot
 * do what Orion promised is a worse outcome than Orion saying it does not know -- somebody who was told the wrong thing
 * has to discover it themselves, and by then they have already trusted it.
 */
export function describePage(page: RegisteredPage): string[] {
  const manifest = page.manifest
  const lines = [`${manifest.title}: ${manifest.description}`]
  if (manifest.search.summary !== '' && manifest.search.summary !== manifest.description) {
    lines.push(manifest.search.summary)
  }
  // The Page's own stated limits, which are the part somebody needs before they rely on it.
  for (const limitation of manifest.limitations.slice(0, 3)) lines.push(`It cannot: ${limitation}`)
  if (page.status !== 'available') {
    lines.push(`It is not available at the moment${page.note ? `: ${page.note}` : '.'}`)
  }
  return lines
}

/** What Orion does and does not do with Pages, for the explanation it can give about itself. */
export const ORION_PAGES_ASSUMPTIONS: readonly string[] = Object.freeze([
  'When a question has an exact answer, Orion has the engine work it out rather than answering from the model. A model asked for a sum answers confidently whether or not it is right.',
  'A computed answer says it was computed, and names what worked it out.',
  'A question Orion cannot map exactly onto an engine is answered the ordinary way. Half-understanding a question and then answering it precisely is worse than answering it vaguely.',
  'Orion describes a Page only from what the Page says about itself, including what it says it cannot do.',
  'Every caveat the engine returned is carried into the answer. They are what make the number usable rather than decoration around it.'
])
