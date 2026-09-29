/**
 * Deciding what to do when somebody asks for something a Page could do -- and generating one is the last resort.
 *
 * Generation is the expensive, slow, unreviewed answer. Every other answer is better, so this file is a ladder that
 * only reaches the last rung when the ones above it are genuinely empty:
 *
 * ```
 * open        a Page already does exactly this            no work, no wait, and somebody wrote it
 * configure   a Page does this with its fields filled in  no work, no wait, and somebody wrote it
 * compose     two Pages together do this                  no generation, and both halves were reviewed
 * generate    nothing does this                           slow, and nobody has reviewed the result
 * decline     this was never a Page                       the honest answer
 * ```
 *
 * ## Why `decline` is a rung and not an error
 *
 * The failure this file exists to prevent is a product that answers "what is the weather" by building a weather
 * calculator. Most queries are not Pages. A Page computes something from numbers somebody supplies; a query about
 * news, a place, a web address, or a fact about the world has no inputs and no calculation, and generating something
 * Page-shaped for it produces a form nobody can fill in and an answer nobody asked for.
 *
 * So the test for "should this be generated" is not "could a model write something" -- a model can always write
 * something. It is "is there a calculation here, with inputs somebody would type". That is a much narrower question
 * and it is the right one.
 *
 * ## Why the reuse rungs come first even when generation would be better
 *
 * A generated Page might fit a query more tightly than an existing one. It is still the worse answer, because the
 * existing Page was reviewed, is already indexed, already has its limitations written down, and appears instantly.
 * The bar for generating over reusing is therefore set at "the existing Page does not do this", not "the existing
 * Page does this slightly less well".
 */

import { suggestPages, PAGE_SEARCH_LIMITS, type PageSearchInput, type PageSuggestion, type QueryIntent } from './search.ts'

export const RESOLUTION_LIMITS = Object.freeze({
  queryLength: 400,
  /** How confident an existing Page must be before generating is off the table entirely. */
  reuseFloor: PAGE_SEARCH_LIMITS.floor,
  /** How confident it must be to open without asking. */
  openFloor: PAGE_SEARCH_LIMITS.direct,
  /** The most Pages ever offered as a composition. Two is a pair; three is a workflow, which is a different feature. */
  composeParts: 2
})

/**
 * Intents that could be a Page, and intents that could not.
 *
 * `informational` is deliberately absent. "How tall is Everest" is informational and is not a Page; so is "how do I
 * convert kilograms", which is. The intent alone cannot separate them, so the separation is done below by looking for
 * a calculation rather than by trusting the label.
 */
const COMPUTABLE_INTENTS: ReadonlySet<QueryIntent> = new Set<QueryIntent>(['calculation', 'conversion', 'comparison'])

/** Intents that are never a Page, whatever the words say. */
const NEVER_A_PAGE: ReadonlySet<QueryIntent> = new Set<QueryIntent>(['navigational', 'news', 'local', 'weather', 'shopping', 'entity'])

/**
 * Words that mean a calculation is being asked for.
 *
 * Verbs and comparatives, not nouns. "Compound interest" is a topic; "work out the compound interest" is a request.
 * The distinction matters because the noun appears in every article about the subject and the verb appears when
 * somebody wants the number.
 */
const ASKING_WORDS: readonly string[] = Object.freeze([
  'calculate', 'calculator', 'compute', 'work out', 'figure out', 'solve', 'convert', 'conversion',
  'how much', 'how many', 'how far', 'how long', 'how fast', 'how heavy',
  'what is the', 'find the', 'estimate', 'simulate', 'model', 'compare', 'plot', 'graph of'
])

/** Words that mean something is being *looked up* rather than worked out. */
const LOOKING_UP: readonly string[] = Object.freeze([
  'who is', 'who was', 'when did', 'when was', 'where is', 'where was', 'what happened',
  'news', 'latest', 'today', 'near me', 'reviews', 'buy', 'price of', 'weather', 'forecast',
  'definition of', 'meaning of', 'wiki', 'wikipedia'
])

export interface ComputableSignal {
  /** Whether this query is the sort of thing a Page could be built for. */
  computable: boolean
  /** Every reason, in words, so a wrong answer can be argued with rather than guessed at. */
  because: readonly string[]
  /** A number is in the query. Strong evidence: somebody typing 20 celsius wants it converted. */
  hasNumber: boolean
}

/**
 * Whether a query asks for something to be worked out.
 *
 * Deliberately conservative, and the asymmetry is deliberate too: a query wrongly called computable wastes a
 * generation and shows somebody a form they did not want, while a query wrongly called not computable falls through
 * to ordinary search, which is what would have happened anyway. The second mistake costs almost nothing.
 */
export function looksComputable(query: string, intents: readonly { intent: QueryIntent; confidence: number }[] = []): ComputableSignal {
  const text = query.toLowerCase().trim()
  const because: string[] = []

  const strongest = intents.length > 0 ? intents[0] : null
  if (strongest !== null && NEVER_A_PAGE.has(strongest.intent) && strongest.confidence >= 0.6) {
    return { computable: false, because: [`This is a ${strongest.intent} query, which is a thing to look up rather than work out.`], hasNumber: false }
  }
  for (const phrase of LOOKING_UP) {
    if (text.includes(phrase)) {
      return { computable: false, because: [`"${phrase}" asks for something to be looked up rather than worked out.`], hasNumber: false }
    }
  }

  // A bare number is not evidence on its own -- a year, a model number and a street number are all numbers -- so it
  // counts only alongside a word that asks for something.
  const hasNumber = /(?:^|[^a-z0-9.])\d+(?:\.\d+)?(?:$|[^a-z0-9.])/.test(` ${text} `)
  const asking = ASKING_WORDS.filter((phrase) => text.includes(phrase))
  if (asking.length > 0) because.push(`"${asking[0]}" asks for something to be worked out.`)
  if (strongest !== null && COMPUTABLE_INTENTS.has(strongest.intent)) {
    because.push(`Orbis Search read this as a ${strongest.intent}.`)
  }
  if (hasNumber && because.length > 0) because.push('There is a number in it to work from.')

  return { computable: because.length > 0, because: Object.freeze(because), hasNumber }
}

/** The words of a query worth matching on. Short words carry no evidence, so they are not counted either way. */
const queryWords = (query: string): Set<string> =>
  new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((one) => one.length > 3)
  )

/**
 * Which of the query's words a Page actually covers.
 *
 * Read from the manifest's own searchable text rather than from the suggestion's confidence, because a confidence is
 * one number and this question is about *which* words -- two Pages can score the same and cover different halves.
 */
function covered(asked: ReadonlySet<string>, suggestion: PageSuggestion): Set<string> {
  const manifest = suggestion.page.manifest
  const haystack = [manifest.title, manifest.description, ...manifest.tags, ...manifest.search.keywords].join(' ').toLowerCase()
  const out = new Set<string>()
  for (const word of asked) if (haystack.includes(word)) out.add(word)
  return out
}

// ---------------------------------------------------------------- the ladder

export type Resolution =
  | {
      /** A Page already does exactly this. Open it. */
      action: 'open'
      suggestion: PageSuggestion
      because: readonly string[]
    }
  | {
      /** A Page does this once its fields are filled in from the query. Offer it, prefilled. */
      action: 'configure'
      suggestion: PageSuggestion
      /** What to put in it. Null when the query carried nothing to start from. */
      prefill: string | null
      because: readonly string[]
    }
  | {
      /** Two Pages together cover this. Offer both rather than building a third. */
      action: 'compose'
      parts: readonly PageSuggestion[]
      because: readonly string[]
    }
  | {
      /** Nothing does this and it is the sort of thing a Page could do. */
      action: 'generate'
      /** The query, trimmed, as the thing to build from. */
      request: string
      /** Pages that were close but not close enough, so whoever is about to wait can decide not to. */
      near: readonly PageSuggestion[]
      because: readonly string[]
    }
  | {
      /** This was never a Page. */
      action: 'decline'
      because: readonly string[]
    }

export interface ResolveInput extends PageSearchInput {
  /**
   * Whether generating is available at all.
   *
   * False when a model is not configured, when the person has turned generation off, or when Orbis is offline. The
   * ladder then stops at `compose`, and `decline` says why -- which is better than an option that does nothing.
   */
  canGenerate?: boolean
}

/**
 * What to do about a query.
 *
 * The existing-Page search runs first and unconditionally, including for queries that are about to be declined,
 * because a Page that matches is evidence the query was computable after all -- somebody registered a Page for it.
 */
export function resolve(input: ResolveInput): Resolution {
  const query = input.query.trim()
  if (query.length === 0) return { action: 'decline', because: ['There is nothing to work out.'] }
  if (query.length > RESOLUTION_LIMITS.queryLength) {
    return { action: 'decline', because: [`This is ${query.length} characters. A request for a Page is a sentence, not a document.`] }
  }
  if (input.looksLikeUrl === true) {
    return { action: 'decline', because: ['This is a web address, and nothing should interrupt going to one.'] }
  }

  const suggestions = suggestPages(input)
  const best = suggestions.length > 0 ? suggestions[0] : null

  // ---- open: a Page already does this
  if (best !== null && best.direct) {
    return { action: 'open', suggestion: best, because: best.because }
  }

  const solid = suggestions.filter((one) => one.confidence >= RESOLUTION_LIMITS.reuseFloor)

  // ---- compose: two Pages between them cover more of the query than either alone
  //
  // This rung has to be tested *before* `configure`, or it is unreachable: whenever two Pages clear the floor the
  // best of them clears it too, and `configure` would have returned already.
  //
  // And "two Pages matched" is not enough to be a composition. Two Pages that match the same words are two answers to
  // the same question, and the better one is the answer. A composition is two Pages that match *different* words --
  // "convert 20 kg to pounds and work out the shipping" is two halves, and neither Page is the answer on its own.
  if (solid.length >= RESOLUTION_LIMITS.composeParts) {
    const asked = queryWords(query)
    const first = covered(asked, solid[0])
    const second = solid.slice(1).find((one) => {
      const also = covered(asked, one)
      return [...also].some((word) => !first.has(word))
    })
    if (second !== undefined) {
      const extra = [...covered(asked, second)].filter((word) => !first.has(word))
      return {
        action: 'compose',
        parts: [solid[0], second],
        because: [
          `"${solid[0].page.manifest.title}" covers part of this, and "${second.page.manifest.title}" covers ${extra.join(' and ')}.`,
          'Two Pages that already exist cover this between them, which is better than building a third.'
        ]
      }
    }
  }

  // ---- configure: a Page does this, given what the query carried
  if (best !== null && best.confidence >= RESOLUTION_LIMITS.reuseFloor) {
    return {
      action: 'configure',
      suggestion: best,
      prefill: best.prefill,
      because: [...best.because, 'This Page already exists and somebody wrote it, so it is a better answer than building one.']
    }
  }

  const signal = looksComputable(query, input.intents ?? [])
  if (!signal.computable) {
    return { action: 'decline', because: signal.because }
  }

  if (input.canGenerate === false) {
    return {
      action: 'decline',
      because: [...signal.because, 'Nothing here does this, and building a Page is not available at the moment.']
    }
  }

  return {
    action: 'generate',
    request: query,
    near: suggestions,
    because: [...signal.because, 'Nothing in the library does this.']
  }
}

export const RESOLUTION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Generating is the last resort. A Page that already exists was reviewed, is already indexed, and appears instantly, and those beat a closer fit.',
  'Most queries are not Pages. A Page computes something from numbers somebody types; a question about the world has no inputs and no calculation.',
  'A number in a query is not evidence on its own. A year, a model number and a street number are all numbers.',
  'Calling a query computable when it is not costs a wait and a form nobody wanted. Calling it not computable costs nothing, because ordinary search is what would have happened anyway.',
  'Two weak matches are not a composition. Offering them as a pair dresses up a failure as an answer.'
])
