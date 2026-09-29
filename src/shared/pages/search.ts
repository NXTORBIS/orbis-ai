/**
 * Offering a Page as an answer to a search.
 *
 * When somebody types "convert 20 celsius to fahrenheit", the best thing Orbis can do is not a list of websites. It is
 * a Page that does exactly that, already open, with the numbers filled in.
 *
 * ## The rule this file is built around
 *
 * A Page suggestion is only worth showing when it is **better than the results it displaces**. Every search product
 * eventually learns to promote its own features, and the result is a page full of house adverts above the thing
 * somebody actually asked for. So the bar here is deliberately high and deliberately explicit:
 *
 * - A Page appears only when the query matches *what it does*, not merely words it happens to contain.
 * - A weak match is no match. There is a floor, and below it the module is absent rather than thin.
 * - At most a small number are ever shown, because a list of six Pages is a menu, and somebody searching did not ask
 *   for a menu.
 * - Every suggestion carries the reason it was chosen, in words, so a wrong one is debuggable rather than mysterious --
 *   and so the reason can be shown to the person.
 *
 * ## Intent, not keywords
 *
 * Matching on words alone puts the Unit Converter in front of somebody searching for "converter cable". The query's
 * *intent* is what makes the difference, so a Page declaring it handles `convert` is promoted for a conversion query
 * and left alone for a shopping one, whatever words they share.
 *
 * Pure. No network, no clock.
 */

import { listPages, type PageRegistry, type RegisteredPage } from './registry.ts'

export const PAGE_SEARCH_LIMITS = Object.freeze({
  /** The most Pages ever offered for one query. More than three is a menu. */
  shown: 3,
  /**
   * Below this a Page is not worth the space it takes from the results.
   *
   * Set where a Page has to match more than one signal, or one strong one. A single shared tag does not reach it.
   */
  floor: 0.45,
  /** Above this, a Page is confident enough to open straight away rather than being offered. */
  direct: 0.9,
  queryLength: 400
})

/** What a query is for, as Orbis Search decides it. Mirrored here so this file does not depend on the search engine. */
export type QueryIntent =
  | 'calculation'
  | 'conversion'
  | 'definition'
  | 'weather'
  | 'local'
  | 'shopping'
  | 'news'
  | 'howto'
  | 'comparison'
  | 'question'
  | 'navigational'
  | 'entity'
  | 'informational'

export interface PageSuggestion {
  page: RegisteredPage
  /** 0 to 1. How well this Page answers *this* query, not how popular it is. */
  confidence: number
  /** Every signal that contributed, in words. Shown to the person and used to debug a wrong choice. */
  because: readonly string[]
  /** Text to prefill, where the query carried something the Page can start from. */
  prefill: string | null
  /** True when this is confident enough to open rather than offer. */
  direct: boolean
}

export interface PageSearchInput {
  registry: PageRegistry
  query: string
  profileId: string
  /** The intents Orbis Search found, strongest first, each with its own confidence. */
  intents?: readonly { intent: QueryIntent; confidence: number }[]
  /** True when the query looks like a web address, in which case no Page should interrupt. */
  looksLikeUrl?: boolean
  /** Whether the person has opened these Pages before. Nudges, never decides. */
  opened?: Readonly<Record<string, number>>
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((one) => one.length > 1)

/**
 * Words too common to be evidence of anything.
 *
 * A query and a Page sharing "the" is not a match. Without this list, every Page matches every query a little, and
 * "a little" times enough signals clears any floor.
 */
const NOISE = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'what', 'how', 'why',
  'is', 'are', 'was', 'can', 'get', 'use', 'using', 'new', 'all', 'any', 'you', 'your'
])

/**
 * The seam between two vocabularies.
 *
 * Orbis Search names an intent after the *asking* -- `conversion`, `calculation`. A manifest names it after the
 * *doing* -- `convert`, `calculate`. Both are right for where they live, and neither should be bent to match the other,
 * so the translation is written down here where it can be read and corrected.
 *
 * It is a table rather than a string comparison on purpose. Comparing `"conversion"` to `"convert"` and hoping they
 * line up is how this silently matched nothing at all: every Page declared `convert`, every query said `conversion`,
 * and the entire intent signal was dead while looking like it worked.
 *
 * Intents with no entry deliberately map to nothing. `navigational`, `entity` and `informational` describe what
 * somebody is looking for, not something a Page could do for them.
 */
const INTENT_WORDS: Readonly<Record<QueryIntent, readonly string[]>> = Object.freeze({
  conversion: Object.freeze(['convert', 'conversion']),
  calculation: Object.freeze(['calculate', 'calculation', 'compute', 'solve', 'evaluate']),
  definition: Object.freeze(['define', 'definition', 'explain', 'lookup']),
  comparison: Object.freeze(['compare', 'comparison']),
  howto: Object.freeze(['howto', 'guide', 'walkthrough']),
  question: Object.freeze(['answer', 'explain']),
  shopping: Object.freeze(['shop', 'shopping', 'buy']),
  local: Object.freeze(['local', 'places', 'map']),
  weather: Object.freeze(['weather', 'forecast']),
  news: Object.freeze(['news']),
  navigational: Object.freeze([]),
  entity: Object.freeze([]),
  informational: Object.freeze([])
})

/** The words a Page would use for a query intent. Empty when the intent is not something a Page can do. */
export const wordsForIntent = (intent: QueryIntent): readonly string[] =>
  Object.prototype.hasOwnProperty.call(INTENT_WORDS, intent) ? INTENT_WORDS[intent] : []

/**
 * How much a Page's declared intents overlap the query's.
 *
 * This is the signal that separates "convert 20c to f" from "converter cable". Weighted by the query's own confidence
 * in each intent, so a query that is only vaguely a conversion promotes a converter only vaguely.
 */
function intentMatch(
  page: RegisteredPage,
  intents: readonly { intent: QueryIntent; confidence: number }[]
): { score: number; matched: string[] } {
  const declared = new Set(page.manifest.search.intents.map((one) => one.toLowerCase()))
  if (declared.size === 0) return { score: 0, matched: [] }
  let best = 0
  const matched: string[] = []
  for (const one of intents) {
    const words = wordsForIntent(one.intent)
    const hit = words.find((word) => declared.has(word))
    if (hit === undefined) continue
    if (one.confidence > best) best = one.confidence
    // The Page's own word, not the query's, because that is what the Page says it does.
    matched.push(hit)
  }
  return { score: best, matched }
}

/**
 * Pages worth offering for a query.
 *
 * Scored out of one, from signals that are combined rather than added: each is a fraction of what is left, so no number
 * of weak signals reaches the floor on its own. Adding them would let five tag matches outscore an exact title, which
 * is exactly backwards.
 */
export function suggestPages(input: PageSearchInput): PageSuggestion[] {
  const query = String(input.query ?? '').trim()
  if (query === '' || query.length > PAGE_SEARCH_LIMITS.queryLength) return []
  // Somebody typing an address wants that address. Nothing here should interrupt that.
  if (input.looksLikeUrl === true) return []

  const lower = query.toLowerCase()
  const terms = words(lower).filter((one) => !NOISE.has(one))
  if (terms.length === 0) return []

  const intents = input.intents ?? []
  const candidates = listPages(input.registry, { profileId: input.profileId })

  const suggestions: PageSuggestion[] = []
  for (const page of candidates) {
    // A Page that cannot open is not an answer, whatever it matches.
    if (page.status !== 'available') continue

    const manifest = page.manifest
    const title = manifest.title.toLowerCase()
    const because: string[] = []

    /** Signals combine as fractions of what is left, so weak ones can never stack up to a strong one. */
    let confidence = 0
    const add = (weight: number, reason: string): void => {
      if (weight <= 0) return
      confidence += (1 - confidence) * Math.min(1, weight)
      because.push(reason)
    }

    // --- the name
    if (title === lower) {
      add(0.95, `"${manifest.title}" is exactly what you searched for`)
    } else if (lower.startsWith(title) || title.startsWith(lower)) {
      add(0.7, `"${manifest.title}" matches the start of what you searched for`)
    } else {
      const alias = manifest.search.aliases.find((one) => one.toLowerCase() === lower)
      if (alias) add(0.75, `"${alias}" is another name for ${manifest.title}`)
    }

    // --- intent, the signal that matters most for a query that is not a name
    const intent = intentMatch(page, intents)
    if (intent.score > 0) {
      add(intent.score * 0.8, `you are trying to ${intent.matched[0]}, which is what ${manifest.title} does`)
    }

    // --- keywords the Page declared it handles
    const keywords = new Set(manifest.search.keywords.map((one) => one.toLowerCase()))
    const hits = terms.filter((one) => keywords.has(one))
    if (hits.length > 0) {
      // Capped: matching four keywords is not four times as good as matching one.
      add(Math.min(0.5, hits.length * 0.22), `it handles ${hits.slice(0, 3).join(', ')}`)
    }

    // --- tags, the weakest signal there is, and deliberately not enough on its own
    const tags = new Set(manifest.tags.map((one) => one.toLowerCase()))
    const tagged = terms.filter((one) => tags.has(one))
    if (tagged.length > 0 && confidence > 0) {
      // Only counted when something else already matched. A shared tag alone is not evidence.
      add(0.15, `it is about ${tagged[0]}`)
    }

    if (confidence <= 0) continue

    // --- having used it before nudges, and only between Pages that already qualified
    const opens = input.opened?.[page.identity.pageId] ?? 0
    if (opens > 0 && confidence >= PAGE_SEARCH_LIMITS.floor) {
      add(Math.min(0.1, opens * 0.02), 'you have used it before')
    }

    if (confidence < PAGE_SEARCH_LIMITS.floor) continue

    suggestions.push({
      page,
      confidence,
      because: Object.freeze(because),
      prefill: prefillFor(manifest.search.intents, query),
      direct: confidence >= PAGE_SEARCH_LIMITS.direct
    })
  }

  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, PAGE_SEARCH_LIMITS.shown)
}

/**
 * What to put into the Page when it opens.
 *
 * Only the query itself, and only when the Page handles the kind of thing the query is. Nothing here parses the query
 * into fields: a Page knows its own fields and this does not, and a prefill that guesses wrong is worse than an empty
 * Page because somebody has to notice it was wrong before correcting it.
 */
function prefillFor(intents: readonly string[], query: string): string | null {
  const useful = new Set(['calculate', 'convert', 'solve', 'plot', 'compare'])
  return intents.some((one) => useful.has(one.toLowerCase())) ? query : null
}

/**
 * Orbis Pages as ordinary search results.
 *
 * Deliberately the same shape as a web result, and drawn the same way, because a Page *is* an ordinary result: it has
 * an address, a title and a description, and somebody looking for a unit converter does not care whether the thing
 * that converts units arrived over a network. Giving Pages their own card, badge or logo would be Orbis advertising
 * itself inside its own results, which is the one thing this whole module was written to avoid.
 *
 * This is the Pages tab, so the bar is different from `suggestPages`. That function decides whether a Page is worth
 * taking space from the web on the All tab, and is deliberately hard to satisfy. Here somebody has asked for Pages,
 * so everything that matches at all belongs -- and an empty query lists them, the way an empty folder listing does.
 */
export function pageResults(
  registry: PageRegistry,
  query: string,
  profileId: string | null,
  limit = 30
): { title: string; url: string; snippet: string; site: string }[] {
  const asked = query.trim().toLowerCase()
  const words = asked.split(/[^a-z0-9]+/).filter((one) => one.length > 1 && !NOISE.has(one))

  const ranked = listPages(registry, { profileId })
    .map((page) => {
      const manifest = page.manifest
      const title = manifest.title.toLowerCase()
      const rest = [manifest.description, ...manifest.tags, ...manifest.search.keywords, ...manifest.search.aliases]
        .join(' ')
        .toLowerCase()
      // A title match is worth far more than a mention somewhere in the text. Somebody typing "unit converter" wants
      // the Page called that, not the nine Pages whose description happens to contain the word "unit".
      let rank = 0
      if (asked !== '' && title === asked) rank += 100
      else if (asked !== '' && title.includes(asked)) rank += 50
      for (const word of words) {
        if (title.includes(word)) rank += 10
        else if (rest.includes(word)) rank += 1
      }
      // How often it has been opened breaks a tie and never makes one: a popular Page that does not match stays out.
      return { page, rank: rank === 0 ? 0 : rank + Math.min(5, page.openCount) / 10 }
    })
    .filter((one) => asked === '' || one.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.page.manifest.title.localeCompare(b.page.manifest.title))
    .slice(0, limit)

  return ranked.map(({ page }) => ({
    title: page.manifest.title,
    url: page.identity.canonicalUrl,
    snippet: page.manifest.search.summary || page.manifest.description,
    // The address somebody reads, exactly as one is read for a website. `pages/unit-converter` says where it is as
    // plainly as `en.wikipedia.org` does, and it is the real address rather than a label for one.
    site: page.identity.canonicalUrl.replace(/^orbis:\/\//, '')
  }))
}

export interface PagesModule {
  /** Whether the module should appear at all. */
  show: boolean
  suggestions: readonly PageSuggestion[]
  /** Where in the results page this belongs. Lower is higher up. */
  rank: number
  /** Why the module is here, for the same reason every other module says so. */
  because: string
  /** The heading to show above it. */
  heading: string
}

/**
 * Whether, and where, a Pages module belongs on a results page.
 *
 * The rank is the interesting part. A Page that does exactly what was asked belongs above the web results, because it
 * *is* the answer. A Page that is merely related belongs below them, because the web results are still what somebody
 * asked for. Putting the second kind at the top is the thing that turns a search engine into a shop window.
 */
export function pagesModule(input: PageSearchInput): PagesModule {
  const suggestions = suggestPages(input)
  if (suggestions.length === 0) {
    return { show: false, suggestions: Object.freeze([]), rank: 99, because: 'No Page does what this asks for', heading: '' }
  }

  const best = suggestions[0].confidence
  // Rank 1 puts it above the web results; 7 puts it below them and the images.
  const rank = best >= 0.75 ? 1 : 7
  return {
    show: true,
    suggestions: Object.freeze(suggestions),
    rank,
    because:
      rank === 1
        ? `${suggestions[0].page.manifest.title} does exactly this`
        : 'A Page in Orbis is related to this',
    heading: rank === 1 ? 'Do this in Orbis' : 'Related Pages in Orbis'
  }
}

/**
 * The Page to open straight away, if any.
 *
 * Only for a query that named a Page, and only when nothing else is nearly as good. Opening something on somebody's
 * behalf when they meant to search is far more annoying than making them click once, so the gap between first and
 * second matters as much as the score itself.
 */
export function directPage(input: PageSearchInput): PageSuggestion | null {
  const suggestions = suggestPages(input)
  const best = suggestions[0]
  if (best === undefined || !best.direct) return null
  const second = suggestions[1]
  // A clear winner, or nothing. An ambiguous match gets offered rather than acted on.
  if (second !== undefined && best.confidence - second.confidence < 0.2) return null
  return best
}

/** How Pages appear in search, for the settings screen that turns it off. */
export const PAGE_SEARCH_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A Page is offered only when it does what the search asks for, not when it merely shares words with it.',
  'A weak match shows nothing. Orbis does not fill space with its own features above what you searched for.',
  'At most three Pages are ever offered, because a longer list is a menu you did not ask for.',
  'Every suggestion says why it was chosen, so a wrong one can be seen to be wrong.',
  'A Page appears above the web results only when it does exactly what was asked. Otherwise it goes below them.',
  'Having used a Page before nudges it up slightly, and only among Pages that already matched.',
  'Typing a web address never brings up a Page.'
])
