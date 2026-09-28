/**
 * What the query is actually asking for, and which parts of a results page would help.
 *
 * A search engine that shows the same eleven modules for every query has not understood anything; it has just made a
 * longer page. "25 x 48" wants a number. "cafes near me" wants places on a map. "lee chong wei" wants a person, their
 * picture and the questions people ask about them. "typescript satisfies operator" wants documentation and nothing
 * else -- no image strip, no shopping, no knowledge panel about a person who does not exist.
 *
 * So this decides, from the words alone and before anything is fetched:
 *
 *   - what kind of asking it is (a question, a sum, a purchase, a place, a name)
 *   - what kind of thing is being named, if anything
 *   - which modules could earn their place, and how confident we are in each
 *   - what order they should appear in
 *
 * Everything here is pure and offline. It decides what to *ask for*; whether the answer exists is decided later by
 * whether a provider returned anything, and a module with no data is dropped rather than shown empty. Confidence here
 * is confidence about the query, never about facts.
 */

/** What someone is trying to do. A query can look like several of these; the strongest wins, and ties keep order. */
export type SearchIntent =
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

/** The kind of thing a query names, when it names one. */
export type EntityKind = 'person' | 'organization' | 'place' | 'product' | 'media' | 'concept' | 'event'

/** Every module a results page can be made of. Adding one here and giving it a rule is how the page grows (§67). */
export type ModuleName =
  | 'correction'
  | 'answer'
  | 'calculator'
  | 'conversion'
  | 'definition'
  | 'weather'
  | 'knowledge'
  | 'local'
  | 'sports'
  | 'news'
  | 'web'
  | 'images'
  | 'videos'
  | 'peopleAlsoAsk'
  | 'peopleAlsoSearchFor'
  | 'comparison'
  | 'timeline'
  | 'relatedSearches'

export interface QueryShape {
  /** What was typed, tidied of surrounding space but otherwise untouched. */
  raw: string
  /** Lowercased, collapsed whitespace. What the rules read. */
  normal: string
  words: string[]
  /** Anything in double quotes: an exact phrase somebody meant literally, which suppresses correcting it. */
  quoted: string[]
  /** `site:`, `filetype:` and friends, which say the person knows what they are doing. */
  operators: { key: string; value: string }[]
  /** True when the query is a bare address or something that is plainly meant to be one. */
  looksLikeUrl: boolean
  /** True when the query reads as code, an identifier or a model number rather than words. */
  looksTechnical: boolean
  endsWithQuestionMark: boolean
}

export interface Understanding {
  shape: QueryShape
  intent: SearchIntent
  /** Every intent that fired, strongest first, so a page can honour a second reading of an ambiguous query. */
  intents: { intent: SearchIntent; confidence: number }[]
  /** The kind of thing named, when the words suggest one. Never certainty -- a name is only ever a hint. */
  entity: { kind: EntityKind; confidence: number } | null
  /** How much a picture would help (§14). Drives the image pack, not the Images tab. */
  imageRelevance: number
  /** Whether the answer depends on today. Drives news, and whether cached results may be reused. */
  needsFresh: boolean
}

const QUESTION_WORDS = ['who', 'what', 'when', 'where', 'why', 'how', 'which', 'whose', 'is', 'are', 'was', 'were', 'does', 'do', 'did', 'can', 'should', 'will']
const HOWTO = /^(how (to|do i|do you|can i)|steps to|guide to|tutorial)\b/
const COMPARE = /\b(vs\.?|versus|compared? (to|with)|difference between|better than)\b/
const DEFINE = /^(define|definition of|meaning of|what (is|does) the (meaning|definition) of|what does .+ mean)\b/
const WEATHER = /\b(weather|forecast|temperature|rain|snow|humidity|sunrise|sunset)\b/
const LOCAL = /\b(near me|nearby|near by|around me|close to me|in my area|directions to|open now)\b/
const LOCAL_PREP = /\b(restaurants?|cafes?|coffee|hotels?|hospitals?|pharmac(y|ies)|bars?|shops?|stores?|gyms?|clinics?|dentists?|mechanics?|salons?|banks?|atms?)\b.*\b(in|near|around)\b/
const SHOPPING = /\b(buy|price|prices|cheap|cheapest|deal|deals|discount|coupon|for sale|shop|order online|best .* (under|below)|review|reviews)\b/
/** Asking about a match or a competition. Answered with reporting, because Orbis has no scores feed. */
const SPORTS = /\b(scores?|scorecard|fixtures?|standings?|league table|world cup|olympics|premier league|la liga|nba|nfl|mlb|ipl|test match|odi|t20|grand prix|formula 1|tournament|semi.?final|quarter.?final|playoffs?|kick.?off|full.?time)\b/
const NEWS = /\b(news|latest|breaking|today|yesterday|this (week|morning|evening)|update|updates|announced|live score|results? (today|yesterday))\b/
const CURRENT = /\b(today|tonight|now|current|currently|latest|this (week|month|year)|20\d\d|live)\b/
/** A sum, not a sentence: digits and operators, with at most a word like "of" or a percent sign. */
const CALCULATION = /^[\d\s().,+\-*/^%×÷]+$|^\s*\d[\d\s.,]*\s*%\s*of\s*\d[\d\s.,]*\s*$|^(sqrt|log|ln|sin|cos|tan|abs|round)\s*\(/i
const CONVERSION = /\b\d+(\.\d+)?\s*[a-z°$€£¥]+\s+(to|in)\s+[a-z°$€£¥]+\b|\b(convert|how many)\b.*\b(to|in)\b/i
/** Things that are identifiers, not misspelled words (§7). */
const TECHNICAL = /[_/\\<>{}[\]|`~]|::|=>|\)\(|^[a-z]+\.[a-z]+\(|\b[a-z]+[A-Z][a-z]|\b[a-z]+-[a-z]+-[a-z]+\b|\b\d+[a-z]+\d+\b|\bv?\d+\.\d+(\.\d+)?\b/
const URLISH = /^(https?:\/\/|www\.)|^[a-z0-9-]+\.(com|org|net|io|dev|ai|co|edu|gov|uk|in|de|jp)(\/|$)/i

/** Words that, next to a capitalised name, suggest what kind of name it is. Hints, weighted, never conclusions. */
const KIND_HINTS: { kind: EntityKind; words: RegExp; weight: number }[] = [
  { kind: 'person', words: /\b(born|age|wife|husband|biography|bio|net worth|player|actor|actress|singer|author|scientist|founder|ceo|president|minister|athlete|director|artist|rapper|coach)\b/, weight: 0.5 },
  { kind: 'organization', words: /\b(company|corporation|inc|ltd|llc|gmbh|university|college|institute|agency|foundation|organization|organisation|startup|headquarters|founded)\b/, weight: 0.5 },
  { kind: 'place', words: /\b(city|country|capital|population|located|map|travel|tourism|attractions|weather in|state of|district|island|mountain|river)\b/, weight: 0.5 },
  { kind: 'product', words: /\b(price|specs?|specifications?|review|buy|model|release date|battery|camera|processor|ram|storage|edition|pro|max|ultra|plus)\b/, weight: 0.45 },
  { kind: 'media', words: /\b(movie|film|series|season|episode|album|song|book|novel|game|soundtrack|cast|trailer|release date|imdb)\b/, weight: 0.5 },
  { kind: 'event', words: /\b(tournament|championship|cup|olympics|festival|conference|summit|election|war|battle|ceremony|final|20\d\d)\b/, weight: 0.4 },
  { kind: 'concept', words: /\b(theory|principle|law of|equation|algorithm|language|framework|protocol|method|process|syndrome|disease|effect|phenomenon)\b/, weight: 0.4 }
]

/** Subjects where a picture is most of the answer, and subjects where it is noise (§14). */
const VISUAL = /\b(photo|photos|picture|pictures|image|images|wallpaper|logo|poster|design|art|painting|architecture|fashion|outfit|hairstyle|tattoo|car|cars|bike|dress|shoes|animal|bird|flower|plant|landscape|map|chart|diagram|look(s)? like|colou?r)\b/
const NOT_VISUAL = /\b(error|exception|stack trace|syntax|install|command|npm|pip|regex|sql|api|typeerror|undefined|null pointer|compile|definition|meaning|synonym|antonym)\b/

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim()

/** Reads a query into the parts every later step needs. Nothing is judged here; this only looks. */
export function parseQuery(input: string): QueryShape {
  const raw = clean(String(input ?? ''))
  const quoted = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter(Boolean)
  const operators = [...raw.matchAll(/\b(site|filetype|ext|intitle|inurl|before|after|lang|loc):\s*(\S+)/gi)].map((m) => ({ key: m[1].toLowerCase(), value: m[2] }))
  const normal = raw.toLowerCase()
  return {
    raw,
    normal,
    words: normal.split(/\s+/).filter(Boolean),
    quoted,
    operators,
    looksLikeUrl: URLISH.test(raw),
    looksTechnical: TECHNICAL.test(raw) || operators.length > 0,
    endsWithQuestionMark: raw.endsWith('?')
  }
}

/**
 * The run of capitalised words a query opens with: the shape a name usually has.
 *
 * Counted from the front and stopped at the first ordinary word, because a name is nearly always followed by what is
 * wanted about it -- "Albert Einstein biography", "Chennai population", "NASA headquarters". Requiring the whole query
 * to be capitalised would miss every one of those, which are the queries a knowledge panel is actually for.
 */
function capitalisedRun(raw: string): number {
  const small = new Set(['of', 'the', 'and', 'de', 'van', 'der', 'bin', 'al'])
  let run = 0
  for (const word of raw.split(/\s+/).filter(Boolean)) {
    const isName = /^[A-Z][A-Za-z'’.-]*$/.test(word)
    const isJoiner = run > 0 && small.has(word.toLowerCase())
    if (!isName && !isJoiner) break
    run += 1
  }
  return run
}

const looksLikeName = (raw: string): boolean => {
  const run = capitalisedRun(raw)
  return run >= 1 && run <= 5
}

/**
 * What kind of thing is named, if any.
 *
 * Two signals: the shape of the words (a short run of capitals looks like a name) and words around them that say what
 * kind of name it is. Neither alone is much, which is why the confidence stays low without both -- and why a knowledge
 * panel needs more than this before it is shown (§9: only when confidence is sufficient).
 */
export function guessEntity(shape: QueryShape): { kind: EntityKind; confidence: number } | null {
  if (shape.looksLikeUrl || shape.operators.length) return null
  let best: { kind: EntityKind; confidence: number } | null = null
  for (const hint of KIND_HINTS) {
    if (!hint.words.test(shape.normal)) continue
    if (!best || hint.weight > best.confidence) best = { kind: hint.kind, confidence: hint.weight }
  }
  const named = looksLikeName(shape.raw) && !shape.looksTechnical
  if (named) {
    // A name with a word saying what kind of name it is, is the strong case. A bare name is a guess worth carrying,
    // but not one worth drawing a panel from on its own.
    if (best) return { kind: best.kind, confidence: Math.min(0.9, best.confidence + 0.35) }
    return { kind: 'person', confidence: 0.35 }
  }
  return best
}

/** How much a picture would help. Not whether images exist -- that is the provider's answer, later. */
export function imageRelevance(shape: QueryShape, entity: { kind: EntityKind; confidence: number } | null): number {
  if (NOT_VISUAL.test(shape.normal) || shape.looksTechnical || shape.looksLikeUrl) return 0.05
  if (VISUAL.test(shape.normal)) return 0.9
  if (entity && entity.confidence >= 0.5) {
    if (entity.kind === 'person' || entity.kind === 'place' || entity.kind === 'product' || entity.kind === 'media') return 0.75
    if (entity.kind === 'event') return 0.6
    return 0.3
  }
  if (entity) return 0.45
  return 0.25
}

/** Everything the words say, strongest first. A query is often two of these at once, and both readings are kept. */
export function detectIntents(shape: QueryShape): { intent: SearchIntent; confidence: number }[] {
  const q = shape.normal
  const found: { intent: SearchIntent; confidence: number }[] = []
  const add = (intent: SearchIntent, confidence: number): void => void found.push({ intent, confidence })

  if (shape.looksLikeUrl) add('navigational', 0.95)
  // A sum is a sum: deterministic, and it must not be handed to a model (§40).
  if (CALCULATION.test(shape.raw) && /\d/.test(shape.raw)) add('calculation', 0.95)
  if (CONVERSION.test(q)) add('conversion', 0.85)
  if (DEFINE.test(q)) add('definition', 0.9)
  if (WEATHER.test(q)) add('weather', 0.8)
  if (LOCAL.test(q)) add('local', 0.9)
  else if (LOCAL_PREP.test(q)) add('local', 0.7)
  if (SHOPPING.test(q)) add('shopping', 0.7)
  if (NEWS.test(q)) add('news', 0.7)
  if (HOWTO.test(q)) add('howto', 0.85)
  if (COMPARE.test(q)) add('comparison', 0.85)
  if (shape.endsWithQuestionMark || QUESTION_WORDS.includes(shape.words[0] ?? '')) add('question', 0.6)

  const entity = guessEntity(shape)
  if (entity) add('entity', entity.confidence)
  add('informational', 0.2)

  return found.sort((a, b) => b.confidence - a.confidence)
}

export function understand(input: string): Understanding {
  const shape = parseQuery(input)
  const intents = detectIntents(shape)
  const entity = guessEntity(shape)
  return {
    shape,
    intent: intents[0]?.intent ?? 'informational',
    intents,
    entity,
    imageRelevance: imageRelevance(shape, entity),
    needsFresh: CURRENT.test(shape.normal) || NEWS.test(shape.normal)
  }
}

// ---------------------------------------------------------------- which modules, and in what order

/** A module the page could show, with how sure we are it belongs and where it goes. */
export interface ModulePlan {
  module: ModuleName
  confidence: number
  /** Lower comes first. Set from what the query is for, so a sum leads with the sum and a name leads with the person. */
  rank: number
  /** Said plainly so the choice can be explained, and so a wrong choice is debuggable rather than mysterious. */
  because: string
}

/** Below this a module is not worth the space, and showing it anyway is the thing this file exists to prevent. */
const FLOOR = 0.3

/**
 * Chooses the page (§57, §58).
 *
 * Modules are proposed with a confidence and a rank, filtered by confidence, and ordered by rank. The ordering is not
 * a fixed layout: a calculation puts the answer first and barely anything after it, a person puts the knowledge panel
 * and pictures high, a how-to puts the web results first because the answer is on a page rather than in a box.
 *
 * Web results are always present and always cheap to justify: whatever else the page decides, somebody searched for
 * something, and the list of pages is the one thing that always answers that.
 */
export function planModules(u: Understanding): ModulePlan[] {
  const plans: ModulePlan[] = []
  const at = (module: ModuleName, confidence: number, rank: number, because: string): void => {
    if (confidence >= FLOOR) plans.push({ module, confidence, rank, because })
  }
  const strength = (intent: SearchIntent): number => u.intents.find((i) => i.intent === intent)?.confidence ?? 0

  // A correction, when one was found, sits above everything: it changes what the rest of the page is about (§6).
  at('correction', 1, 0, 'A likely correction was found for this query')

  at('calculator', strength('calculation'), 1, 'This is arithmetic, which is answered exactly rather than searched')
  at('conversion', strength('conversion'), 1, 'This asks to convert one unit into another')
  at('definition', strength('definition'), 1, 'This asks what a word means')
  at('weather', strength('weather'), 1, 'This asks about the weather')
  // An answer box for a plain factual question, but not when a deterministic module already answers it.
  const deterministic = Math.max(strength('calculation'), strength('conversion'), strength('definition'), strength('weather'))
  at('answer', deterministic >= 0.8 ? 0 : strength('question') * 0.9, 2, 'This is a question with a short factual answer')

  at('local', strength('local'), 3, 'This asks about places nearby')
  // Coverage, not a scoreboard: Orbis has no scores feed, so a sports query is answered with real reporting about the
  // match rather than with numbers nobody sourced. The module says plainly which of the two it is.
  at('sports', SPORTS.test(u.shape.normal) ? 0.7 : 0, 3, 'This is about a match or a competition')
  at('news', Math.max(strength('news'), u.needsFresh ? 0.5 : 0), 3, 'This is about something current')

  // The knowledge panel needs a real entity, not a guess (§9). A bare capitalised name does not reach this.
  const known = u.entity && u.entity.confidence >= 0.55 ? u.entity.confidence : 0
  at('knowledge', known, 4, u.entity ? `This names a ${u.entity.kind}` : '')
  at('timeline', known >= 0.7 && (u.entity?.kind === 'person' || u.entity?.kind === 'organization' || u.entity?.kind === 'event') ? known * 0.8 : 0, 8, 'A life or a history has an order worth showing')

  at('comparison', strength('comparison'), 5, 'This compares two things')

  // Always. Whatever else is on the page, the pages themselves are what was searched for.
  at('web', 1, 6, 'Somebody searched for something')

  at('images', u.imageRelevance >= 0.55 ? u.imageRelevance : 0, 7, 'Pictures would help with this')
  // Questions worth asking exist for anything with a subject; they are useless for a sum or an address.
  const hasSubject = deterministic < 0.8 && !u.shape.looksLikeUrl
  at('peopleAlsoAsk', hasSubject ? Math.max(strength('question'), known, strength('howto'), 0.45) : 0, 9, 'There are follow-on questions worth answering')
  at('videos', Math.max(strength('howto') * 0.9, u.imageRelevance >= 0.7 ? 0.5 : 0, strength('media' as SearchIntent)), 10, 'This is the kind of thing people show rather than write')
  at('peopleAlsoSearchFor', known >= 0.55 ? known : 0, 11, 'Things like this one are worth reaching')
  at('relatedSearches', u.shape.looksLikeUrl ? 0 : 0.8, 12, 'Nearby searches are worth offering')

  return plans.sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
}

/** Just the names, in order. What the page iterates over. */
export const moduleOrder = (u: Understanding): ModuleName[] => planModules(u).map((p) => p.module)
