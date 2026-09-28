import { readPage } from '../main/research.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'
import { planModules, understand } from '../shared/searchIntent.ts'
import type { ModuleName, Understanding } from '../shared/searchIntent.ts'
import { correctQuery } from '../shared/searchCorrection.ts'
import type { Correction } from '../shared/searchCorrection.ts'
import { calculate, convert } from '../shared/calculate.ts'
import { NO_PLACE, placeFromQuery } from '../shared/searchWeather.ts'
import { readDefinition, wordToDefine } from '../shared/searchDefine.ts'
import { acceptTimeline, splitComparison } from '../shared/searchCompare.ts'
import { rankedResults } from '../shared/searchRank.ts'
import { PLACES_NOTE, readPlace } from '../shared/searchLocal.ts'
import type { Place } from '../shared/searchLocal.ts'
import type { TimelineEntry } from '../shared/searchCompare.ts'
import { buildComparison } from '../shared/tray.ts'
import type { Comparison, Proposal, TrayItem } from '../shared/tray.ts'
import type { Definition } from '../shared/searchDefine.ts'
import type { Weather } from '../shared/widgetData.ts'
import {
  acceptQuestions,
  provenanceFor,
  acceptRelated,
  acceptRelatedSearches,
  answerQuestion,
  buildKnowledge,
  dedupeResults,
  normalizeResult
} from '../shared/searchModules.ts'
import type { AskedQuestion, KnowledgeEntity, NormalizedResult, RelatedEntity } from '../shared/searchModules.ts'

/**
 * Composing a results page (§1, §57, §59).
 *
 * The query is understood first, offline, and that understanding says which modules could earn a place. Then each of
 * those modules is filled from something real, independently, so a slow or broken one costs its own section and
 * nothing else (§59, §64). What comes back with no data is dropped rather than shown empty (§58).
 *
 * The division of labour with the model is deliberate and narrow. Orion is asked what to *look into* -- which
 * questions somebody would have, which related things are worth offering. It is never the reason anything is
 * believed: every answer is checked against the page it cites, every entity needs a source, and anything that fails
 * those checks is discarded rather than shown with a caveat (src/shared/searchModules.ts).
 *
 * Correction works the same way round. Orbis does not decide a query is misspelled; it notices that what was typed is
 * a slip away from something the web itself returned, and says so with the original one click away (§6, §8).
 */

export interface SearchPageDeps {
  /** The web search Orbis already has. Returns whatever its providers returned. */
  web(query: string, signal: AbortSignal): Promise<{ results?: unknown[]; problem?: string }>
  /** One of the specialized verticals (images, videos, news, …). */
  specialized(category: string, query: string, signal: AbortSignal): Promise<{ results?: unknown[]; problem?: string }>
  /** One question to Orion, answered in full. Used to propose what to look into, never to assert. */
  ask(prompt: string, signal: AbortSignal): Promise<string>
  /**
   * The forecast for a named place, from the service Orbis already uses for its weather widget. Absent when this
   * helper has no weather source, which is a missing section rather than a reason to invent one.
   */
  weather?(place: string): Promise<Weather | null>
  fetchFn: typeof fetch
}

/** What the page is made of. Every field is either real or absent; nothing here is a placeholder. */
export interface ComposedPage {
  query: string
  /** What was actually searched, which differs from `query` when a correction was applied. */
  searched: string
  correction: Correction | null
  intent: string
  modules: { module: ModuleName; because: string }[]
  answer: { kind: 'calculation' | 'conversion'; expression: string; value: string } | null
  /** The forecast, when the query asked for one and a place could be found. Real data or nothing (§42, §65). */
  weather: { place: string; forecast: Weather } | null
  /** A dictionary entry, from a real dictionary, when the query asked what a word means (§39). */
  definition: Definition | null
  /** A life or a history in order, every entry from a page that says it (§45). */
  timeline: TimelineEntry[]
  /**
   * Two things side by side (§46), built by the same engine the comparison tray uses: a cell exists only when the
   * words that say it are in the page it cites. Null when the query was not a comparison, or nothing was supported.
   */
  comparison: { left: string; right: string; table: Comparison } | null
  knowledge: KnowledgeEntity | null
  web: NormalizedResult[]
  images: NormalizedResult[]
  videos: NormalizedResult[]
  news: NormalizedResult[]
  /**
   * Reporting about a match or a competition (§43) -- not a scoreboard.
   *
   * Orbis has no scores feed, and a score is exactly the kind of number that must not be guessed. So a sports query is
   * answered with what was actually written about it, from the same news sources as any other current story, and the
   * page says that is what it is.
   */
  sports: NormalizedResult[]
  /**
   * Places, from OpenStreetMap (§37). Name, kind, address and a map link -- and nothing else, because the gazetteer
   * holds nothing else. `placesNote` says which fields are missing, so a gap reads as a gap rather than as a failure.
   */
  places: Place[]
  placesNote: string
  peopleAlsoAsk: AskedQuestion[]
  peopleAlsoSearchFor: RelatedEntity[]
  relatedSearches: string[]
  /** Sections that were wanted but could not be filled, and why. Said out loud rather than silently missing (§64). */
  unavailable: { module: ModuleName; problem: string }[]
  tookMs: number
}

const NEWLINE = String.fromCharCode(10)
const MAX_QUERY = 300
const PAGE_CHARS = 12_000
/** How much of a page is shown when pulling facts out of it. The check afterwards is against the same text. */
const SHOWN = 12_000

/** JSON out of an answer that may be fenced or wrapped in prose. Nothing rather than a guess. */
function jsonFrom(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer)?.[1]
  for (const candidate of [fenced, answer]) {
    if (!candidate) continue
    const start = candidate.search(/[[{]/)
    if (start < 0) continue
    const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'))
    if (end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      // Not JSON; try the next candidate, and produce nothing if neither parses.
    }
  }
  return null
}

/** A page as text, for checking a claim against the page that supposedly made it. Empty when it cannot be read. */
async function pageText(url: string, fetchFn: typeof fetch): Promise<string> {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000), redirect: 'follow', headers: { accept: 'text/html,*/*' } })
    if (!response.ok) return ''
    const type = response.headers.get('content-type') ?? ''
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return ''
    const body = await response.arrayBuffer()
    if (body.byteLength > 2_000_000) return ''
    return readPage(new TextDecoder().decode(body)).text.slice(0, PAGE_CHARS)
  } catch {
    return ''
  }
}

/** The categories worth fetching for this page, from what the modules asked for. Nothing speculative. */
function categoriesFor(modules: Set<ModuleName>): string[] {
  const wanted: string[] = []
  if (modules.has('images')) wanted.push('images')
  if (modules.has('videos')) wanted.push('videos')
  if (modules.has('news') || modules.has('sports')) wanted.push('news')
  if (modules.has('local')) wanted.push('maps')
  return wanted
}

/**
 * Questions somebody would actually have (§15, §16).
 *
 * Generated from the query and from what the web returned, so they are about this search rather than about the shape
 * of a search. They are only questions at this point; nothing is asserted until each one is answered from a page.
 */
async function proposeQuestions(query: string, results: NormalizedResult[], ask: SearchPageDeps['ask'], signal: AbortSignal): Promise<AskedQuestion[]> {
  const context = results.slice(0, 8).map((r) => `- ${r.title}: ${r.description}`.slice(0, 220)).join(NEWLINE)
  const prompt = [
    `Somebody searched for: ${query}`,
    '',
    'These came back:',
    context || '(nothing)',
    '',
    'What would they most likely want to know next? Give 4 to 6 real questions about this exact subject.',
    'Each must be answerable from a web page. Do not answer them. Do not ask about anything else.',
    '',
    'Reply with only a JSON array of strings.'
  ].join(NEWLINE)
  const parsed = jsonFrom(await ask(prompt, signal).catch(() => ''))
  return acceptQuestions(parsed, query)
}

/**
 * Answers a question from a page that was really fetched (§17, §18).
 *
 * The page is chosen from the results already in hand, read, and Orion is asked to answer *from that text*. The answer
 * is then checked against the same text; one that is not supported becomes no answer at all, which the page shows as
 * "Information unavailable" rather than as a sentence somebody might believe.
 */
async function answerOne(question: AskedQuestion, results: NormalizedResult[], deps: SearchPageDeps, signal: AbortSignal): Promise<AskedQuestion> {
  for (const candidate of results.slice(0, 3)) {
    const text = await pageText(candidate.url, deps.fetchFn)
    if (!text) continue
    const prompt = [
      `This is the text of ${candidate.title}:`,
      '"""',
      text,
      '"""',
      '',
      `Question: ${question.question}`,
      '',
      'Answer in one or two sentences using only what this text says. Copy its wording where you can.',
      'If this text does not answer the question, reply with exactly: none',
      '',
      'Reply with the answer and nothing else.'
    ].join(NEWLINE)
    const said = (await deps.ask(prompt, signal).catch(() => '')).trim()
    if (!said || /^none\b/i.test(said)) continue
    const answered = answerQuestion(question, { text: said, source: { url: candidate.url, title: candidate.title } }, text, 'web')
    if (answered.answer) return answered
  }
  return { ...question, answered: true, answer: null }
}

/** Things like this one, each with a stated reason and a page behind it (§19, §20). */
async function proposeRelated(query: string, results: NormalizedResult[], ask: SearchPageDeps['ask'], signal: AbortSignal): Promise<RelatedEntity[]> {
  const context = results.slice(0, 8).map((r) => `- ${r.title} (${r.url})`).join(NEWLINE)
  const prompt = [
    `Somebody searched for: ${query}`,
    '',
    'These came back:',
    context || '(nothing)',
    '',
    'Name up to 6 other things somebody looking at this would plausibly look at next -- the same kind of thing, in the',
    'same field, connected for a stated reason. Not merely famous. If you cannot name a real connection, give fewer.',
    '',
    'Each needs: name, kind (person/organization/place/product/media/concept/event), a short description,',
    'relationship (why it is connected to the search), and url (a real page about it, from the list above or a',
    'Wikipedia article you are confident exists).',
    '',
    'Reply with only a JSON array of {"name","kind","description","relationship","url"}.'
  ].join(NEWLINE)
  const parsed = jsonFrom(await ask(prompt, signal).catch(() => ''))
  return acceptRelated(parsed, query, 'orion')
}

/** Nearby searches (§23). Queries, not claims, so these need no source -- only to be about the same thing. */
async function proposeRelatedSearches(query: string, ask: SearchPageDeps['ask'], signal: AbortSignal): Promise<string[]> {
  const prompt = [
    `Somebody searched for: ${query}`,
    '',
    'Give 6 short searches somebody would plausibly run next about this same subject. Each 2 to 6 words.',
    'Do not repeat the search itself.',
    '',
    'Reply with only a JSON array of strings.'
  ].join(NEWLINE)
  return acceptRelatedSearches(jsonFrom(await ask(prompt, signal).catch(() => '')), query)
}

/**
 * The knowledge panel, built from one page that was read (§9, §10, §11).
 *
 * A reference page is chosen from the results, fetched, and the facts are pulled from its text and checked against it.
 * Every fact carries that page. If nothing survives, there is no panel -- which is the common and correct outcome.
 */
async function buildPanel(query: string, u: Understanding, results: NormalizedResult[], deps: SearchPageDeps, signal: AbortSignal): Promise<KnowledgeEntity | null> {
  const reference = results.find((r) => /wikipedia\.org|britannica\.com|\.gov\b|\.edu\b/i.test(r.url)) ?? results[0]
  if (!reference) return null
  const text = await pageText(reference.url, deps.fetchFn)
  if (!text) return null

  const prompt = [
    `This is the text of ${reference.title}:`,
    '"""',
    text,
    '"""',
    '',
    `Somebody searched for "${query}", which looks like a ${u.entity?.kind ?? 'thing'}.`,
    'If this page is about that subject, pull out what a reference panel would show.',
    'Use only what this text states. Leave out anything it does not say. Do not calculate or infer.',
    'Do not include private information about a living person beyond what a public profile would carry.',
    '',
    'Reply with only JSON: {"name","kind","description","about","facts":[{"key","label","value"}]}',
    'where "description" is one short line and "about" is one or two sentences from the text.',
    'If this page is not about that subject, reply with exactly: none'
  ].join(NEWLINE)

  const said = await deps.ask(prompt, signal).catch(() => '')
  if (/^\s*none\b/i.test(said)) return null
  const parsed = jsonFrom(said)
  if (!parsed || typeof parsed !== 'object') return null

  // Facts are kept only when the page really says them, exactly as the tray checks its cells.
  const haystack = text.toLowerCase()
  const o = parsed as Record<string, unknown>
  const facts = (Array.isArray(o.facts) ? o.facts : []).filter((f) => {
    const value = String((f as Record<string, unknown>)?.value ?? '').trim().toLowerCase()
    return value.length > 0 && haystack.includes(value)
  })
  const about = String(o.about ?? '')
  const aboutWords = about.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)
  const aboutGrounded = aboutWords.length > 0 && aboutWords.filter((w) => haystack.includes(w)).length / aboutWords.length >= 0.75

  return buildKnowledge(
    {
      ...o,
      about: aboutGrounded ? about : '',
      url: reference.url,
      title: reference.title,
      image: results.find((r) => r.type === 'image')?.image,
      facts: facts.map((f) => ({ ...(f as object), source: { url: reference.url, title: reference.title } })),
      official: []
    },
    'web'
  )
}

/**
 * A life or a history in order (§45).
 *
 * Read from the same page the knowledge panel came from, so the timeline and the panel agree, and checked the same
 * way: the page has to say the date and has to say what happened. A model that invents an event gets neither past it.
 */
async function buildTimeline(subject: string, text: string, url: string, title: string, deps: SearchPageDeps, signal: AbortSignal): Promise<TimelineEntry[]> {
  if (!text) return []
  const prompt = [
    `This is the text of ${title}:`,
    '"""',
    text,
    '"""',
    '',
    `List the dated moments this text gives for ${subject}, in the order they happened.`,
    'Copy each date exactly as the text writes it. Describe each moment in the text’s own words.',
    'Only what this text states. If it gives no dated moments, reply with an empty array.',
    '',
    'Reply with only a JSON array of {"when","what"}.'
  ].join(NEWLINE)
  const parsed = jsonFrom(await deps.ask(prompt, signal).catch(() => ''))
  const where = provenanceFor({ url, title }, 'web')
  return where ? acceptTimeline(parsed, text, where) : []
}

/**
 * Two things compared (§46).
 *
 * Each side is searched, its best page is read, and the facts are pulled from that page and checked against it. The
 * checking is the tray's, not a second implementation of the same idea: whatever a page did not say is a gap in the
 * table rather than a number somebody filled in.
 */
async function buildSideBySide(sides: { left: string; right: string }, deps: SearchPageDeps, signal: AbortSignal): Promise<ComposedPage['comparison']> {
  const items: TrayItem[] = []
  for (const side of [sides.left, sides.right]) {
    const found = await deps.web(side, signal).catch(() => ({ results: [] as unknown[] }))
    const best = (found.results ?? []).map((r) => normalizeResult(r, 'web', 'searxng')).find((r): r is NormalizedResult => r !== null)
    if (!best) continue
    const text = await pageText(best.url, deps.fetchFn)
    items.push({
      id: side,
      url: best.url,
      title: side,
      site: best.domain,
      vertical: 'all',
      addedAt: 0,
      ...(text ? { text } : { problem: `${side} could not be read.` })
    })
  }
  // One side is not a comparison. Saying nothing beats a table with a column of blanks.
  if (items.filter((i) => i.text).length < 2) return null

  const wanted = [sides.left, sides.right].join(' and ')
  const proposals: Proposal[] = []
  for (const item of items) {
    if (!item.text) continue
    const prompt = [
      `This is the text of ${item.title}:`,
      '"""',
      item.text.slice(0, SHOWN),
      '"""',
      '',
      `Somebody is comparing ${wanted}. Pull out the facts about ${item.title} that would help.`,
      'Only what this page states. "quote" must be copied exactly from the text above and must contain the value.',
      'Do not calculate, convert or infer anything.',
      '',
      'Reply with only a JSON array of {"key","label","value","quote"}.'
    ].join(NEWLINE)
    const parsed = jsonFrom(await deps.ask(prompt, signal).catch(() => ''))
    proposals.push({
      itemId: item.id,
      fields: (Array.isArray(parsed) ? parsed : []).map((f) => {
        const o = (f ?? {}) as Record<string, unknown>
        return { key: String(o.key ?? ''), label: String(o.label ?? ''), value: String(o.value ?? ''), quote: String(o.quote ?? '') }
      })
    })
  }

  const table = buildComparison(items, proposals)
  return table.columns.length ? { left: sides.left, right: sides.right, table } : null
}

export function createSearchPageHandlers(deps: SearchPageDeps): Record<string, Handler> {
  return {
    /**
     * One query, one page. Streams `status` as each section fills so nothing waits on everything (§59), and reports
     * what could not be filled rather than leaving a gap somebody has to interpret (§64).
     */
    /**
     * The related searches on their own, for a page that wants the chips and nothing else.
     *
     * The Images board needs these and needs nothing else `search:page` builds -- no knowledge panel, no questions, no
     * comparison, none of the fetching those involve. Composing the whole page to read one field off it would make a
     * strip of chips cost as much as the page it sits on.
     */
    'search:related': async ([raw], { signal }): Promise<string[]> => {
      const q = typeof raw === 'string' ? raw.trim().slice(0, MAX_QUERY) : ''
      if (!q) throw new HelperError('bad-request', 'Search for something.')
      return proposeRelatedSearches(q, deps.ask, signal)
    },

    'search:page': async ([raw], { emit, signal }): Promise<ComposedPage> => {
      const started = Date.now()
      const query = typeof raw === 'string' ? raw.trim().slice(0, MAX_QUERY) : ''
      if (!query) throw new HelperError('bad-request', 'Search for something.')

      const u = understand(query)
      const plans = planModules(u)
      const wanted = new Set(plans.map((p) => p.module))
      const unavailable: ComposedPage['unavailable'] = []

      // ---- what can be answered exactly, is, without asking anything (§38, §40, §41)
      let answer: ComposedPage['answer'] = null
      if (wanted.has('calculator')) {
        const sum = calculate(query)
        if (sum) answer = { kind: 'calculation', expression: sum.expression, value: sum.display }
      }
      if (!answer && wanted.has('conversion')) {
        const converted = convert(query)
        if (converted) answer = { kind: 'conversion', expression: `${converted.from.value} ${converted.from.unit}`, value: converted.display }
      }

      // ---- what a word means, from Wiktionary rather than from a model asked to sound like a dictionary (§39)
      let definition: Definition | null = null
      if (wanted.has('definition')) {
        const word = wordToDefine(query)
        if (word) {
          try {
            const response = await deps.fetchFn(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
              signal: AbortSignal.timeout(8000),
              headers: { accept: 'application/json' }
            })
            if (response.ok) definition = readDefinition(await response.json(), word)
            else if (response.status === 404) unavailable.push({ module: 'definition', problem: `No dictionary entry for “${word}”.` })
          } catch {
            unavailable.push({ module: 'definition', problem: 'The dictionary could not be reached.' })
          }
        }
      }

      // ---- the weather, from the real forecast service rather than from a sentence a model wrote (§42)
      let weather: ComposedPage['weather'] = null
      if (wanted.has('weather') && deps.weather) {
        const place = placeFromQuery(query)
        if (!place) unavailable.push({ module: 'weather', problem: NO_PLACE })
        else {
          try {
            const forecast = await deps.weather(place)
            if (forecast) weather = { place, forecast }
            else unavailable.push({ module: 'weather', problem: `No forecast was found for ${place}.` })
          } catch (error) {
            unavailable.push({ module: 'weather', problem: (error as Error)?.message || 'The weather service could not be reached.' })
          }
        }
      }

      // ---- the web, which everything else is built from
      emit({ type: 'status', message: 'Searching…' })
      const webRaw: { results?: unknown[]; problem?: string } = await deps
        .web(query, signal)
        .catch((error: Error) => ({ problem: error?.message || 'The search did not work.' }))
      if (webRaw.problem) unavailable.push({ module: 'web', problem: webRaw.problem })
      const web = dedupeResults((webRaw.results ?? []).map((r) => normalizeResult(r, 'web', 'searxng', started)).filter((r): r is NormalizedResult => r !== null))

      // ---- a correction, evidenced by what the web returned rather than decided about the words (§6, §7)
      const correction = correctQuery(query, web.slice(0, 8).map((r) => r.title))
      let searched = query
      let results = web
      if (correction && correction.confidence >= 0.6) {
        searched = correction.corrected
        emit({ type: 'status', message: `Searching for ${correction.corrected}…` })
        const again = await deps.web(correction.corrected, signal).catch(() => ({ results: [] as unknown[] }))
        const better = dedupeResults((again.results ?? []).map((r) => normalizeResult(r, 'web', 'searxng', started)).filter((r): r is NormalizedResult => r !== null))
        if (better.length) results = better
      }

      // ---- the packs, each on its own, so one failing is one missing section (§59, §64)
      const packs: Record<string, NormalizedResult[]> = { images: [], videos: [], news: [], maps: [] }
      await Promise.all(
        categoriesFor(wanted).map(async (category) => {
          try {
            const outcome = await deps.specialized(category, searched, signal)
            if (outcome.problem) unavailable.push({ module: category as ModuleName, problem: outcome.problem })
            const kind = category === 'maps' ? 'local' : (category as NormalizedResult['type'])
            packs[category] = dedupeResults((outcome.results ?? []).map((r) => normalizeResult(r, kind, category, started)).filter((r): r is NormalizedResult => r !== null))
          } catch (error) {
            unavailable.push({ module: category as ModuleName, problem: (error as Error)?.message || 'That section could not be loaded.' })
          }
        })
      )

      // ---- two things side by side, when that is what was asked (§46)
      const sides = wanted.has('comparison') ? splitComparison(searched) : null
      const comparisonPromise = sides ? buildSideBySide(sides, deps, signal).catch(() => null) : Promise.resolve(null)

      // ---- the parts that need reading and asking. Each guarded so one failure is one section.
      const [knowledge, questions, related, relatedSearches, comparison] = await Promise.all([
        wanted.has('knowledge') ? buildPanel(searched, u, results, deps, signal).catch(() => null) : Promise.resolve(null),
        wanted.has('peopleAlsoAsk') ? proposeQuestions(searched, results, deps.ask, signal).catch(() => []) : Promise.resolve([]),
        wanted.has('peopleAlsoSearchFor') ? proposeRelated(searched, results, deps.ask, signal).catch(() => []) : Promise.resolve([]),
        wanted.has('relatedSearches') ? proposeRelatedSearches(searched, deps.ask, signal).catch(() => []) : Promise.resolve([]),
        comparisonPromise
      ])

      // ---- the timeline, from the page the panel was built from, so the two cannot disagree (§45)
      let timeline: TimelineEntry[] = []
      if (wanted.has('timeline') && knowledge) {
        const from = knowledge.provenance
        const text = await pageText(from.url, deps.fetchFn)
        timeline = await buildTimeline(knowledge.name, text, from.url, from.title ?? knowledge.name, deps, signal).catch(() => [])
      }

      return {
        query,
        searched,
        correction: correction && correction.confidence >= 0.6 ? correction : null,
        intent: u.intent,
        modules: plans.map((p) => ({ module: p.module, because: p.because })),
        answer,
        definition,
        weather,
        timeline,
        comparison,
        knowledge,
        // Ranked before they are sent: official documentation first for a how-to, the maker's own page not first for
        // a review, freshness only where the question was about now (§47, §55).
        web: rankedResults(results, u, started),
        images: packs.images,
        videos: packs.videos,
        news: packs.news,
        places: packs.maps.map((r) => readPlace({ title: r.title, content: r.description, url: r.url })).filter((p): p is Place => p !== null),
        placesNote: PLACES_NOTE,
        // The same reporting, offered under the heading that says what it is. Nothing is fetched twice for this.
        sports: wanted.has('sports') ? packs.news : [],
        peopleAlsoAsk: questions,
        peopleAlsoSearchFor: related,
        relatedSearches,
        unavailable,
        tookMs: Date.now() - started
      }
    },

    /**
     * One question from People also ask, answered when somebody opens it (§17).
     *
     * Answered on demand rather than in advance: reading three pages for each of six questions nobody expanded would
     * be most of a page load spent on nothing.
     */
    'search:answer-question': async ([rawQuestion, rawResults], { signal }): Promise<AskedQuestion> => {
      const text = typeof rawQuestion === 'string' ? rawQuestion.trim().slice(0, 200) : ''
      if (!text) throw new HelperError('bad-request', 'Which question?')
      const results = (Array.isArray(rawResults) ? rawResults : [])
        .map((r) => normalizeResult(r, 'web', 'web'))
        .filter((r): r is NormalizedResult => r !== null)
      if (!results.length) return { id: 'q', question: text, answer: null, answered: true }
      return answerOne({ id: 'q', question: text, answer: null, answered: false }, results, deps, signal)
    }
  }
}
