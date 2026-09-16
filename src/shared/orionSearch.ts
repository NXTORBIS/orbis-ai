import type { SearchResult } from './orbisSearch'

/**
 * An Orion search session: asking, then asking again.
 *
 * Searching is rarely one question. "Research electric cars", then "which has the longest range", then "what about
 * price", then "check the current ones" — each of those leans on the last, and nobody should have to say "electric
 * cars" four times. This is what carries that: the questions asked, the answers given, the sources they came from, the
 * things being talked about and the conditions placed on them.
 *
 * It belongs to Orbis Search and to nothing else. It is not a chat, it never becomes one, and Orbis Chat's
 * conversations are never read into it — a question asked here is answered from what was found here.
 *
 * Pure: no network, no Orion, no storage. It decides what a follow-up means and what Orion needs to be told.
 */

export interface SearchSource extends SearchResult {
  /** Which turn first found it, so a session can say where something came from. */
  turn: number
}

export interface SearchTurn {
  id: string
  question: string
  answer: string
  /** The sources this answer drew on, by their number in the session. */
  used: number[]
  /** Whether the web was searched again for this one. */
  researched: boolean
  at: number
}

export interface OrionSearchSession {
  id: string
  profileId: string
  /** What the session is about now, which a later question can change. */
  topic: string
  turns: SearchTurn[]
  /** Everything found so far, numbered once and kept numbered, so "the third one" means the same thing all session. */
  sources: SearchSource[]
  /** The things being talked about, gathered as they come up. */
  entities: string[]
  /** Conditions the user has added, which stay until they are changed. */
  constraints: string[]
  startedAt: number
  updatedAt: number
}

export function newSearchSession(profileId: string, topic: string, now = Date.now()): OrionSearchSession {
  return { id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, profileId, topic: topic.trim(), turns: [], sources: [], entities: [], constraints: [], startedAt: now, updatedAt: now }
}

// ---------------------------------------------------------------- what a question is asking for

/** Short, and leaning on what came before rather than standing on its own. */
const FOLLOW_UP =
  /^(?:and\s+)?(?:so\s+)?(?:(?:what|which|who|why|how|when|where)\b[\s\S]{0,40}?)?\b(?:about|it|its|they|them|their|that|this|these|those|him|her|one|ones|the (?:first|second|third|fourth|fifth|last|other|same|one|two|three|cheapest|best|longest|shortest|biggest|smallest))\b/i
const IMPERATIVE = /^(?:compare|explain|summari[sz]e|tell me more|go on|continue|expand|elaborate|why|open|show|list|rank|check)\b/i

/**
 * Whether a question continues what was being talked about.
 *
 * A question with no session behind it is never a follow-up, however it is worded: "why?" as the first thing typed is
 * a question about nothing, and pretending otherwise would be inventing a context that does not exist.
 */
export function isFollowUp(question: string, session: OrionSearchSession | null): boolean {
  if (!session || !session.turns.length) return false
  const text = question.trim()
  if (!text) return false
  if (FOLLOW_UP.test(text) || IMPERATIVE.test(text)) return true
  // Very short questions almost always lean on what came before.
  return text.split(/\s+/).length <= 4 && !/^[a-z0-9-]+\.[a-z]{2,}$/i.test(text)
}

/** Whether the question is asking about how things are now, rather than what has already been found. */
const FRESH = /\b(?:latest|newest|current(?:ly)?|now|today|tonight|this (?:week|month|year)|recent(?:ly)?|up[- ]to[- ]date|still|any(?:thing)? new|changed|updated?|price|prices|cost|in stock|available|release[ds]?|news)\b/i

export function wantsFreshResearch(question: string): boolean {
  return FRESH.test(question)
}

/**
 * Which of the numbered things a question is pointing at.
 *
 * "the third one" is the third; "the first two" is both of the first two. Returns positions from zero, and only ones
 * that actually exist — a question about the fifth source when four were found points at nothing.
 */
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1 }
const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, both: 2 }

export function referencedItems(question: string, available: number): number[] {
  if (available <= 0) return []
  const text = question.toLowerCase()
  const found = new Set<number>()

  // "the first two", "the top three", "both"
  const span = /\b(?:first|top|best|last)\s+(two|three|four|five)\b|\bboth\b/.exec(text)
  if (span) {
    const howMany = Math.min(available, COUNTS[span[1] ?? 'two'] ?? 2)
    const fromEnd = /\blast\b/.test(span[0])
    for (let i = 0; i < howMany; i++) found.add(fromEnd ? available - 1 - i : i)
  }

  for (const [word, position] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      const at = position === -1 ? available - 1 : position - 1
      if (at >= 0 && at < available) found.add(at)
    }
  }
  // "source 2", "result 3", "number 4"
  for (const match of text.matchAll(/\b(?:source|result|number|option|item)\s*#?\s*(\d{1,2})\b/g)) {
    const at = Number(match[1]) - 1
    if (at >= 0 && at < available) found.add(at)
  }
  return [...found].sort((a, b) => a - b)
}

/** Whether the user has said to leave the subject behind and search for something else. */
const NEW_TOPIC = /\b(?:forget|never mind|instead|actually,?\s*(?:search|look|find)|new search|different (?:topic|subject|thing)|change (?:the )?(?:topic|subject))\b/i

export function changesTopic(question: string): boolean {
  return NEW_TOPIC.test(question)
}

/**
 * A condition the question adds, when it adds one.
 *
 * "under fifty thousand", "16GB RAM", "in India", "Windows only" are all narrowing what was already being looked for,
 * and they stay in force until the user changes them.
 */
const CONSTRAINT = /^(?:under|below|over|above|less than|more than|only|with|without|in|from|before|after|at least|at most|between)\b/i

export function constraintIn(question: string): string | null {
  const text = question.trim().replace(/[?.]+$/, '')
  if (!text || text.split(/\s+/).length > 8) return null
  return CONSTRAINT.test(text) ? text : null
}

// ---------------------------------------------------------------- the things being talked about

/**
 * Names worth remembering from a question or an answer.
 *
 * Deliberately conservative: proper nouns and the like, never every word. What it is for is so that "which is cheaper"
 * can be answered about NVIDIA and AMD without the user saying so again — not to build a picture of anybody.
 */
const STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'There', 'Here', 'What', 'Which', 'Who', 'Why', 'How', 'When', 'Where',
  'And', 'But', 'For', 'With', 'From', 'About', 'Into', 'Than', 'Then', 'They', 'Their', 'It', 'Its', 'A', 'An',
  'I', 'You', 'We', 'Orion', 'Orbis', 'Search', 'Compare', 'Research', 'Find', 'Tell', 'Show', 'Best', 'Latest'
])

export function entitiesIn(text: string): string[] {
  const found = new Set<string>()
  // Runs of capitalised words on a single line — a run must not cross a line break, or the end of a question and the
  // start of its answer would be read as one name — and words with digits in them like "RTX 4090".
  for (const match of text.matchAll(/\b([A-Z][\w'-]*(?:[ \t]+[A-Z][\w'-]*){0,3})\b/g)) {
    // A sentence beginning "Compare NVIDIA..." would otherwise make "Compare NVIDIA" a thing; the opening word is
    // capitalised because it starts a sentence, not because it is a name.
    const words = match[1].trim().split(/\s+/)
    while (words.length && STOPWORDS.has(words[0])) words.shift()
    while (words.length && STOPWORDS.has(words[words.length - 1])) words.pop()
    const name = words.join(' ')
    if (name.length < 2 || name.length > 60) continue
    found.add(name)
  }
  for (const match of text.matchAll(/\b([A-Za-z]+\s?\d{2,4}[A-Za-z]*)\b/g)) {
    if (match[1].length <= 20) found.add(match[1].trim())
  }
  return [...found]
}

/** Adds what a question and its answer were about, keeping the most recent and not letting the list run away. */
export function rememberEntities(session: OrionSearchSession, text: string, limit = 12): string[] {
  const merged = [...entitiesIn(text), ...session.entities]
  const seen = new Set<string>()
  const kept: string[] = []
  for (const name of merged) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(name)
    if (kept.length >= limit) break
  }
  return kept
}

// ---------------------------------------------------------------- growing the session

/** Adds sources to the session, numbered once and keeping their numbers. Returns the numbers the new ones were given. */
export function addSources(session: OrionSearchSession, results: SearchResult[], turn: number): { sources: SearchSource[]; added: number[] } {
  const sources = [...session.sources]
  const added: number[] = []
  for (const result of results) {
    const key = result.url.replace(/[#?].*$/, '').toLowerCase()
    const already = sources.findIndex((s) => s.url.replace(/[#?].*$/, '').toLowerCase() === key)
    if (already >= 0) {
      added.push(already)
      continue
    }
    sources.push({ ...result, turn })
    added.push(sources.length - 1)
  }
  return { sources, added }
}

export function addTurn(session: OrionSearchSession, turn: SearchTurn, now = Date.now()): OrionSearchSession {
  return {
    ...session,
    turns: [...session.turns, turn],
    entities: rememberEntities(session, `${turn.question}\n${turn.answer}`),
    updatedAt: now
  }
}

export function withConstraint(session: OrionSearchSession, constraint: string): OrionSearchSession {
  return { ...session, constraints: [...session.constraints.filter((c) => c.toLowerCase() !== constraint.toLowerCase()), constraint].slice(-6) }
}

export function withTopic(session: OrionSearchSession, topic: string): OrionSearchSession {
  // A new subject leaves the old conditions behind: they were about something else.
  return { ...session, topic: topic.trim(), constraints: [], entities: [] }
}

// ---------------------------------------------------------------- what Orion is told

export interface AskContext {
  /** The words sent to Orion. */
  prompt: string
  /** Which sources it was given, by their number in the session. */
  offered: number[]
  /** Whether this question needs the web searched again. */
  fresh: boolean
}

const RECENT_TURNS = 4
const OFFERED_SOURCES = 8

/**
 * What Orion needs to answer this question, and nothing more.
 *
 * Not the whole session: the last few exchanges, the things being talked about, the conditions in force, and the
 * sources — numbered as they have been all along, so a citation means the same thing in the tenth answer as in the
 * first. Sending everything every time would grow without limit and make the later answers worse, not better.
 */
export function buildAsk(session: OrionSearchSession, question: string, options: { fresh?: boolean; newResults?: SearchResult[] } = {}): AskContext {
  const fresh = options.fresh ?? wantsFreshResearch(question)
  const pointedAt = referencedItems(question, session.sources.length)

  // The ones pointed at come first, then the most recent, up to a sensible number.
  const order = [...pointedAt, ...session.sources.map((_, i) => i).reverse()]
  const offered: number[] = []
  for (const i of order) {
    if (!offered.includes(i)) offered.push(i)
    if (offered.length >= OFFERED_SOURCES) break
  }
  offered.sort((a, b) => a - b)

  const lines: string[] = [
    'You are answering inside Orbis Search. This is a search session, not a chat: answer from the sources below and the',
    'exchanges in this session, and from nothing else.',
    ''
  ]

  if (session.topic) lines.push(`The session is about: ${session.topic}`)
  if (session.entities.length) lines.push(`Being talked about: ${session.entities.slice(0, 8).join(', ')}`)
  if (session.constraints.length) lines.push(`Conditions the user has set, all of which still apply: ${session.constraints.join('; ')}`)

  const recent = session.turns.slice(-RECENT_TURNS)
  if (recent.length) {
    lines.push('', 'Earlier in this session:')
    for (const turn of recent) lines.push(`Q: ${turn.question}`, `A: ${turn.answer.slice(0, 700)}`)
  }

  if (offered.length) {
    lines.push('', 'Sources found in this session, numbered:')
    for (const i of offered) {
      const source = session.sources[i]
      lines.push(`[${i + 1}] ${source.title} — ${source.site}`, source.snippet.slice(0, 300))
    }
  }

  if (pointedAt.length) {
    lines.push('', `The question points at ${pointedAt.map((i) => `[${i + 1}]`).join(' and ')}. Answer about those.`)
  }

  lines.push(
    '',
    `Question: ${question.trim()}`,
    '',
    'Answer in two to four sentences, in plain words.',
    'Put the number of the source you used in square brackets after each claim, like [2].',
    'If the sources do not answer it, say so plainly and say what would. Do not invent anything.',
    'Never claim to remember something that is not written above.'
  )

  return { prompt: lines.join('\n'), offered, fresh }
}

/** A short name for the session, for a list of past searches. */
export function sessionTitle(session: OrionSearchSession): string {
  return (session.topic || session.turns[0]?.question || 'Search').replace(/\s+/g, ' ').trim().slice(0, 60)
}
