import { DISCOVERY_LEVELS, type DiscoveryLevel } from './config.ts'
import { plainly } from '../music.ts'

/**
 * What somebody is trying to listen to, and for how long that holds.
 *
 * Two quite different sources feed this. Something typed or said -- "play something calmer", "no rap tonight" -- is a
 * decision, and it wins. Everything else is inference from what has been happening, which is a guess and is treated
 * as one.
 *
 * ## Temporary unless clearly not
 *
 * "Play sad songs" is not "I like sad music". A request has a scope and an expiry, and when it expires the taste
 * underneath is exactly as it was. The only things that change what somebody likes for good are the ones they state
 * for good -- "never this artist" -- and those are kept in the explicit layer where nothing measured can argue.
 *
 * ## Nothing is parsed that is not there
 *
 * The parser below recognises what it recognises and says what it did not understand. It never fills a constraint
 * with a plausible default: a request Orbis cannot read comes back as "I did not understand that", which is useful,
 * rather than as a confident wrong playlist.
 */

export type ListeningIntent =
  | 'discovery'
  | 'familiar'
  | 'focus'
  | 'study'
  | 'workout'
  | 'running'
  | 'relax'
  | 'sleep'
  | 'travel'
  | 'party'
  | 'background'
  | 'nostalgia'
  | 'energy'
  | 'calm'
  | 'emotional'
  | 'artist-exploration'
  | 'genre-exploration'
  | 'album-exploration'
  | 'unspecified'

/** What a request asks for, as something the engine can act on. */
export interface Constraints {
  /** Only these; nothing else may appear. */
  only?: { dimension: 'artist' | 'album' | 'genre' | 'language' | 'era'; values: string[] }[]
  /** Must not appear. */
  exclude?: { dimension: 'artist' | 'album' | 'genre' | 'language' | 'era'; values: string[] }[]
  /** Leaned towards, not required. */
  prefer?: { dimension: 'artist' | 'album' | 'genre' | 'language' | 'era'; values: string[] }[]
  /** Where energy should sit and which way it should move. */
  energy?: { target?: number; direction?: 'up' | 'down' | 'steady' }
  tempo?: { target?: number; direction?: 'up' | 'down' | 'steady' }
  brightness?: { direction?: 'up' | 'down' }
  /** Only things not heard before, or only things that have been. */
  heard?: 'only-new' | 'only-known'
  /** How much new music. */
  discovery?: number
  /** How long the whole thing should be, in seconds. */
  duration?: number
  /** How many tracks. */
  count?: number
  /** Only what can actually be played on this computer. */
  offlineOnly?: boolean
  /** How much of it should be familiar, 0..1, when a request says so ("mostly songs I know"). */
  familiarShare?: number
}

export interface IntentState {
  intent: ListeningIntent
  /** 0..1: how sure Orbis is that this is what is wanted. Something stated is 1. */
  confidence: number
  source: 'stated' | 'chosen-mode' | 'inferred'
  constraints: Constraints
  /** When this stops applying. Null means until something replaces it. */
  until: number | null
  /** What it was asked for, in the person's own words, for showing back to them. */
  said?: string
}

export const NO_INTENT: IntentState = Object.freeze({ intent: 'unspecified', confidence: 0, source: 'inferred', constraints: {}, until: null })

/** What each mode is for, as weights the ranker understands. Named modes are not labels: they change the maths. */
export const MODE_SHAPE: Record<ListeningIntent, { energy?: { target?: number; direction?: 'up' | 'down' | 'steady' }; discovery?: number; familiarity?: number; vocalness?: number; smoothness?: number }> = {
  focus: { energy: { target: 0.42, direction: 'steady' }, discovery: 0.15, familiarity: 0.7, vocalness: 0.25, smoothness: 0.9 },
  study: { energy: { target: 0.35, direction: 'steady' }, discovery: 0.12, familiarity: 0.75, vocalness: 0.2, smoothness: 0.9 },
  workout: { energy: { target: 0.82, direction: 'up' }, discovery: 0.25, familiarity: 0.55, smoothness: 0.5 },
  running: { energy: { target: 0.78, direction: 'steady' }, discovery: 0.2, familiarity: 0.6, smoothness: 0.6 },
  relax: { energy: { target: 0.3, direction: 'down' }, discovery: 0.25, familiarity: 0.6, smoothness: 0.85 },
  sleep: { energy: { target: 0.12, direction: 'down' }, discovery: 0.05, familiarity: 0.85, vocalness: 0.15, smoothness: 1 },
  travel: { energy: { target: 0.6 }, discovery: 0.4, familiarity: 0.5, smoothness: 0.6 },
  party: { energy: { target: 0.85, direction: 'steady' }, discovery: 0.1, familiarity: 0.9, smoothness: 0.6 },
  background: { energy: { target: 0.4, direction: 'steady' }, discovery: 0.2, familiarity: 0.65, smoothness: 0.8 },
  discovery: { discovery: 0.7, familiarity: 0.25, smoothness: 0.5 },
  familiar: { discovery: 0.03, familiarity: 0.95, smoothness: 0.5 },
  nostalgia: { discovery: 0.08, familiarity: 0.9, smoothness: 0.6 },
  energy: { energy: { target: 0.8, direction: 'up' }, discovery: 0.25, smoothness: 0.5 },
  calm: { energy: { target: 0.25, direction: 'down' }, discovery: 0.2, smoothness: 0.9 },
  emotional: { energy: { target: 0.4 }, discovery: 0.2, familiarity: 0.7, smoothness: 0.8 },
  'artist-exploration': { discovery: 0.5, familiarity: 0.4, smoothness: 0.5 },
  'genre-exploration': { discovery: 0.6, familiarity: 0.3, smoothness: 0.5 },
  'album-exploration': { discovery: 0.2, familiarity: 0.6, smoothness: 0.7 },
  unspecified: {}
}

// ---------------------------------------------------------------- reading a request

/** Phrases that name a way of listening. Longest first, so "wind down" is not read as "down". */
const INTENT_WORDS: [RegExp, ListeningIntent][] = [
  [/\b(deep focus|focus|concentrat\w*)\b/, 'focus'],
  [/\b(study|studying|revis\w*|homework)\b/, 'study'],
  [/\b(gym|workout|work out|lifting|exercise|training)\b/, 'workout'],
  [/\b(run|running|jog\w*|cardio)\b/, 'running'],
  [/\b(sleep|sleeping|bedtime|fall asleep)\b/, 'sleep'],
  [/\b(relax\w*|chill|unwind|wind down|calm down)\b/, 'relax'],
  [/\b(drive|driving|road trip|travel\w*|commut\w*|flight)\b/, 'travel'],
  [/\b(party|dance|club|celebrat\w*)\b/, 'party'],
  [/\b(background|while i work|something on)\b/, 'background'],
  [/\b(discover|something new|new music|surprise me|take me somewhere)\b/, 'discovery'],
  [/\b(familiar|my favourites|my favorites|stuff i know|songs i know)\b/, 'familiar'],
  [/\b(nostalg\w*|old favourites|old favorites|take me back|throwback)\b/, 'nostalgia'],
  [/\b(energetic|energy|hype|pumped|upbeat|intense)\b/, 'energy'],
  [/\b(calm\w*|peaceful|quiet|gentle|soft|mellow)\b/, 'calm'],
  [/\b(sad|emotional|melanchol\w*|heartbreak)\b/, 'emotional'],
  [/\b(explore this artist|more by this artist|this artist)\b/, 'artist-exploration'],
  [/\b(this genre|more of this genre)\b/, 'genre-exploration'],
  [/\b(this album|rest of the album)\b/, 'album-exploration']
]

const LANGUAGES = ['tamil', 'hindi', 'telugu', 'malayalam', 'kannada', 'punjabi', 'bengali', 'marathi', 'korean', 'japanese', 'spanish', 'french', 'german', 'portuguese', 'arabic', 'turkish', 'english']

const DISCOVERY_WORDS: [RegExp, DiscoveryLevel][] = [
  [/\b(only|just) (stuff|songs|music) i know\b/, 'familiar'],
  [/\bexperimental\b/, 'experimental'],
  [/\badventurous\b/, 'adventurous'],
  [/\bexplor\w*\b/, 'explore'],
  [/\bbalanced\b/, 'balanced'],
  [/\bfamiliar\b/, 'familiar']
]

export interface ParsedRequest {
  intent: IntentState
  /** What of the request was not understood. Empty when all of it was. */
  notUnderstood: string[]
}

/**
 * Turns what somebody said into constraints, and says what it could not read.
 *
 * Deliberately literal. It recognises the shapes people actually use -- a length, a count, a decade, a language, a
 * direction, a "no X", a share -- and reports the rest as not understood so the caller can hand it to Orion instead
 * of guessing. Nothing here invents a constraint.
 */
/** Numbers people write as words. "the next five songs" is a count, and has to be read as one. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  ninety: 90
}

export function parseRequest(said: string, now: number): ParsedRequest {
  const words = plainly(said)
  /*
   * The raw text as well as the tidied text.
   *
   * `plainly` strips punctuation, which is right for comparing names and wrong for reading a request: it turns
   * "70%" into "70" and the percentage disappears. Anything that depends on a symbol is read from the raw text.
   */
  const raw = said.toLowerCase()
  /** A number, written either way, and how to read it. */
  const number = '(\\d+|' + Object.keys(WORD_NUMBERS).join('|') + ')'
  const asNumber = (text: string): number => (WORD_NUMBERS[text] !== undefined ? WORD_NUMBERS[text] : Number(text))
  const constraints: Constraints = {}
  const notUnderstood: string[] = []
  let intent: ListeningIntent = 'unspecified'
  let found = false

  for (const [pattern, which] of INTENT_WORDS) {
    if (pattern.test(words)) {
      intent = which
      found = true
      break
    }
  }

  // A length: "for two hours", "45 minutes", "90 mins".
  const hours = /\b(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs)\b/.exec(words)
  const minutes = /\b(\d+)\s*(minute|minutes|min|mins)\b/.exec(words)
  if (hours) constraints.duration = Math.round(Number(hours[1]) * 3600)
  else if (minutes) constraints.duration = Number(minutes[1]) * 60
  const wordMinutes = new RegExp('\\b' + number + '\\s*(?:minute|minutes|min|mins)\\b').exec(words)
  if (!constraints.duration && wordMinutes) constraints.duration = asNumber(wordMinutes[1]) * 60
  const spelled = /\b(an hour|two hours|half an hour)\b/.exec(words)
  if (!constraints.duration && spelled) constraints.duration = spelled[1] === 'half an hour' ? 1800 : spelled[1] === 'two hours' ? 7200 : 3600

  // A count: "five songs", "10 tracks".
  const count = new RegExp('\\b' + number + '\\s*(?:song|songs|track|tracks)\\b').exec(words)
  if (count) constraints.count = Math.min(200, asNumber(count[1]))
  const nextFew = new RegExp('\\bnext ' + number + '\\b').exec(words)
  if (nextFew) constraints.count = Math.min(50, asNumber(nextFew[1]))

  // A decade: "2010s", "from the 90s", "eighties".
  const decade = /\b(19|20)(\d)0s\b/.exec(words)
  if (decade) {
    const era = Number(`${decade[1]}${decade[2]}0`)
    constraints.prefer = [...(constraints.prefer ?? []), { dimension: 'era', values: [String(era)] }]
  } else {
    const short = /\b(60s|70s|80s|90s)\b/.exec(words)
    if (short) {
      const era = 1900 + Number(short[1].slice(0, 2))
      constraints.prefer = [...(constraints.prefer ?? []), { dimension: 'era', values: [String(era)] }]
    }
  }

  // A language, either wanted or not wanted.
  for (const language of LANGUAGES) {
    if (!words.includes(language)) continue
    const refused = new RegExp(`\\b(no|not|without|except) ${language}\\b`).test(words)
    const list = refused ? 'exclude' : 'only'
    constraints[list] = [...(constraints[list] ?? []), { dimension: 'language', values: [language] }]
    found = true
  }

  // "no rap", "nothing heavy", "don't play X".
  const refusal = /\b(?:no|not|nothing|without|avoid|don.?t play|stop playing)\s+([a-z][a-z \-]{2,30}?)(?:\s+(?:tonight|today|right now|for now|please)|$)/.exec(words)
  if (refusal) {
    const what = refusal[1].trim()
    if (what && !LANGUAGES.includes(what)) {
      constraints.exclude = [...(constraints.exclude ?? []), { dimension: 'genre', values: [what] }]
      found = true
    }
  }

  // Which way to move: calmer, more energetic, darker, brighter, faster, slower.
  if (/\b(calmer|quieter|softer|less energetic|chill\w* out|bring it down|mellower)\b/.test(words)) {
    constraints.energy = { direction: 'down' }
    found = true
  }
  if (/\b(more energetic|harder|louder|build (the )?energy|pick it up|more intense|hype it up)\b/.test(words)) {
    constraints.energy = { direction: 'up' }
    found = true
  }
  if (/\b(keep it steady|same energy|steady)\b/.test(words)) constraints.energy = { direction: 'steady' }
  if (/\b(darker|moodier)\b/.test(words)) {
    constraints.brightness = { direction: 'down' }
    found = true
  }
  if (/\b(brighter|happier|more upbeat)\b/.test(words)) {
    constraints.brightness = { direction: 'up' }
    found = true
  }
  if (/\b(faster|quicker)\b/.test(words)) constraints.tempo = { direction: 'up' }
  if (/\b(slower)\b/.test(words)) constraints.tempo = { direction: 'down' }

  // Heard or not heard.
  if (/\b(haven.?t heard|not heard|never heard|new to me|nothing i.?ve heard)\b/.test(words)) {
    constraints.heard = 'only-new'
    found = true
  }
  if (/\b(songs i know|stuff i know|already know|heard before)\b/.test(words)) {
    constraints.heard = 'only-known'
    found = true
  }

  // A share: "70% familiar", "mostly songs I know, at least five new".
  const percent = /\b(\d{1,3})\s*(?:%|percent)\s*(?:of\s+)?(familiar|known|new|discover\w*)/.exec(raw)
  if (percent) {
    const share = Math.min(100, Number(percent[1])) / 100
    const about = percent[2]
    constraints.familiarShare = about.startsWith('new') || about.startsWith('discover') ? 1 - share : share
    found = true
  } else if (/\bmostly (songs|stuff|music) i know\b/.test(words)) constraints.familiarShare = 0.8
  else if (/\bmostly new\b/.test(words)) constraints.familiarShare = 0.25

  for (const [pattern, level] of DISCOVERY_WORDS) {
    if (pattern.test(words)) {
      constraints.discovery = DISCOVERY_LEVELS[level]
      found = true
      break
    }
  }
  if (constraints.discovery === undefined && intent !== 'unspecified') {
    const shape = MODE_SHAPE[intent]
    if (shape.discovery !== undefined) constraints.discovery = shape.discovery
  }
  if (constraints.energy === undefined && intent !== 'unspecified' && MODE_SHAPE[intent].energy) constraints.energy = MODE_SHAPE[intent].energy

  if (/\b(offline|no internet|without internet|on this computer)\b/.test(words)) constraints.offlineOnly = true

  if (!found && Object.keys(constraints).length === 0) notUnderstood.push(said.trim().slice(0, 200))

  // How long it holds: tonight, today, for an hour, or until something replaces it.
  const until = /\b(tonight|today|for now|right now)\b/.test(words)
    ? now + (/tonight/.test(words) ? 8 : 4) * 60 * 60 * 1000
    : constraints.duration
      ? now + constraints.duration * 1000
      : null

  return {
    intent: {
      intent,
      confidence: found ? 1 : 0,
      source: found ? 'stated' : 'inferred',
      constraints,
      until,
      said: said.trim().slice(0, 200)
    },
    notUnderstood
  }
}

// ---------------------------------------------------------------- working it out from behaviour

export interface SessionSignals {
  /** How many tracks have been played this sitting. */
  played: number
  skips: number
  completions: number
  replays: number
  /** The average energy of what has been played, when it is known. */
  energy: number | null
  /** How many different artists. */
  artists: number
  /** How long the sitting has been going, in minutes. */
  minutes: number
  /** The hour of the day, 0-23, for the little it is worth. */
  hour: number
  /** Whether tracks have been chosen by hand or left to Orbis. */
  manualChoices: number
}

/**
 * A guess at what somebody wants, from what they have been doing.
 *
 * Always a guess, and `confidence` says so -- which is what keeps it from overruling anything stated. Three things
 * are read: whether they are skipping (so the current idea is wrong), whether they are choosing by hand (so they
 * know what they want and Orbis should stay out of the way), and where the energy has settled.
 *
 * The hour of the day is used only as a tie-break, and never as a stereotype: there is no rule here that says
 * mornings are for upbeat music.
 */
export function inferIntent(signals: SessionSignals, now: number): IntentState {
  const constraints: Constraints = {}
  let intent: ListeningIntent = 'unspecified'
  let confidence = 0

  const skipRate = signals.played > 0 ? signals.skips / signals.played : 0
  const completionRate = signals.played > 0 ? signals.completions / signals.played : 0

  if (signals.played >= 4 && skipRate > 0.5) {
    // Lots of skipping: whatever is being offered is wrong. Nothing is claimed about what is right.
    intent = 'unspecified'
    confidence = 0.2
    constraints.discovery = 0.12
  } else if (signals.played >= 5 && completionRate > 0.7 && signals.minutes > 20) {
    // Long sitting, little skipping: this is working, and something in the background is the likeliest reason.
    intent = 'background'
    confidence = 0.35
  }

  if (signals.manualChoices >= 3 && signals.played >= 4) {
    // They are driving. Orbis should follow rather than lead.
    constraints.discovery = Math.min(constraints.discovery ?? 0.2, 0.12)
    confidence = Math.max(confidence, 0.3)
  }

  if (signals.energy !== null && signals.played >= 3) {
    constraints.energy = { target: signals.energy, direction: 'steady' }
    confidence = Math.max(confidence, 0.25)
    if (signals.energy > 0.7) intent = intent === 'unspecified' ? 'energy' : intent
    if (signals.energy < 0.3) intent = intent === 'unspecified' ? 'calm' : intent
  }

  if (signals.replays >= 2) {
    constraints.discovery = Math.min(constraints.discovery ?? 0.2, 0.1)
    confidence = Math.max(confidence, 0.3)
  }

  return { intent, confidence, source: 'inferred', constraints, until: now + 30 * 60 * 1000 }
}

/**
 * What to act on: what was stated, then the mode they chose, then the guess.
 *
 * Constraints from the weaker source are kept only where the stronger one is silent, which is what lets "no rap
 * tonight" sit on top of a focus mode without cancelling it.
 */
export function resolveIntent(stated: IntentState | null, mode: IntentState | null, inferred: IntentState, now: number): IntentState {
  const live = (one: IntentState | null): IntentState | null => (one && (one.until === null || one.until > now) ? one : null)
  const strong = live(stated)
  const chosen = live(mode)
  const parts = [strong, chosen, inferred].filter((one): one is IntentState => one !== null)
  if (parts.length === 0) return NO_INTENT
  const winner = parts[0]
  const constraints: Constraints = { ...winner.constraints }
  for (const weaker of parts.slice(1)) {
    for (const [key, value] of Object.entries(weaker.constraints)) {
      if (constraints[key as keyof Constraints] === undefined) (constraints as Record<string, unknown>)[key] = value
    }
  }
  // Exclusions are the one thing that add up rather than being replaced: every refusal still counts.
  const excludes = parts.flatMap((one) => one.constraints.exclude ?? [])
  if (excludes.length > 0) constraints.exclude = excludes
  return { ...winner, constraints }
}
