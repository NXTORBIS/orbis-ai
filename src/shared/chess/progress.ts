import { ACTIVITY_KINDS, ACTIVITY_OF_EXERCISE, ACTIVITIES, EVIDENCE, type ActivityKind, type AnalysedGame, type OpeningRecallRecord, type TrainingRecord } from './coach.ts'
import type { MoveClass } from './evaluation.ts'
import type { StoredGame } from './model.ts'

/**
 * How much you have done, how much of it went right, and what these numbers cannot tell you (Sections 171-175).
 *
 * ## Three kinds of number, kept apart
 *
 * The single most common dishonesty in a progress screen is one number standing in for three. So:
 *
 *   - a **count** is how many times something happened. Fourteen games. Two hundred puzzle attempts.
 *   - a **success rate** is how many attempts went right, out of the attempts that could go right or wrong. A game
 *     has no right or wrong -- you can lose a well played game -- so games are counted and never rated.
 *   - a **completion rate** is how many things started were finished. Finishing a lesson is not the same as getting
 *     it right, and a screen that shows one as the other is lying about what you did.
 *
 * Every rate here carries both of its numbers and a `firm` flag that is false when the denominator is too small to
 * read anything into. A rate with no denominator is `null`, never zero: a week with no attempts is not a week with a
 * nought per cent solve rate.
 *
 * ## A time range is always stated
 *
 * Every measure belongs to a `Range` with a start, an end and a label, and the range is shown with the number. "You
 * have solved 412 puzzles" is not a measurement until it says since when.
 *
 * ## Accuracy, defined in one place
 *
 * `ACCURACY_FORMULA` is the definition, and it is the string the screen shows. The number and the sentence describing
 * it cannot drift apart because there is only one of each.
 *
 * ## Where the calendar lives
 *
 * Day and week boundaries are needed here, to put a measurement in a range and to bucket a chart, and they are needed
 * by `challenges.ts` for goals and streaks. They are written once, here, so a goal's day and a chart's day are the
 * same day.
 *
 * Pure: `now` and the person's time offset come in as arguments.
 */

// ---------------------------------------------------------------- the calendar

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export interface DayRules {
  /**
   * Minutes to add to UTC to get the person's own time. `-new Date().getTimezoneOffset()` gives it.
   *
   * A fixed number rather than a zone name: this file has no time-zone database and will not pretend to one.
   */
  offsetMinutes: number
  /** The hour a day is taken to begin, in the person's own time. 0 is midnight. */
  dayStartHour: number
}

export const DEFAULT_DAY_RULES: DayRules = Object.freeze({ offsetMinutes: 0, dayStartHour: 0 })

/** The rules, in words, to be shown wherever a day or a streak is shown. */
export const CALENDAR_RULES: readonly string[] = Object.freeze([
  'A day runs from the hour you set as the start of the day -- midnight unless it was changed -- to the same hour the next day, in your own time.',
  'A week runs Monday to Sunday, on those same hours.',
  'Your time is a fixed offset handed in by the window. It cannot follow a daylight-saving change, so a day on either side of one may be an hour out of place.',
  'A moment timed later than now is ignored by everything that counts days. A day that has not happened cannot be credited.'
])

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** The moment shifted so that plain UTC arithmetic answers questions about the person's own day. */
const shifted = (at: number, rules: DayRules): number => at + rules.offsetMinutes * MINUTE - rules.dayStartHour * HOUR
const unshifted = (at: number, rules: DayRules): number => at - rules.offsetMinutes * MINUTE + rules.dayStartHour * HOUR

/** The day a moment falls in, as `YYYY-MM-DD`. The identity of a day everywhere in the coach and the goals. */
export function dayKey(at: number, rules: DayRules = DEFAULT_DAY_RULES): string {
  const d = new Date(shifted(at, rules))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The moment the day containing `at` begins. */
export function dayStart(at: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return unshifted(Math.floor(shifted(at, rules) / DAY) * DAY, rules)
}

/** The moment the day containing `at` ends, which is the next day's start and is not part of this day. */
export function dayEnd(at: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return dayStart(at, rules) + DAY
}

/** The Monday of the week containing `at`. */
export function weekStart(at: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  const start = dayStart(at, rules)
  const weekday = new Date(shifted(start, rules)).getUTCDay()
  // getUTCDay is 0 for Sunday, so Monday is reached by going back (weekday + 6) % 7 days.
  return start - ((weekday + 6) % 7) * DAY
}

/** The first of the month containing `at`. */
export function monthStart(at: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  const d = new Date(shifted(dayStart(at, rules), rules))
  return unshifted(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), rules)
}

/** `n` whole days from the start of the day containing `at`. Negative goes back. */
export function addDays(at: number, n: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return dayStart(at, rules) + n * DAY
}

/** Whole days from one moment's day to another's. */
export function daysBetween(from: number, to: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return Math.round((dayStart(to, rules) - dayStart(from, rules)) / DAY)
}

const MONTHS: readonly string[] = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
])
const SHORT_MONTHS: readonly string[] = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])

/** '16 October 2026'. Written out rather than left to a locale, so a test and a screen agree. */
export function dayLabel(at: number, rules: DayRules = DEFAULT_DAY_RULES): string {
  const d = new Date(shifted(at, rules))
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** '16 Oct', for an axis where there is no room for more. */
export function shortDayLabel(at: number, rules: DayRules = DEFAULT_DAY_RULES): string {
  const d = new Date(shifted(at, rules))
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`
}

export function monthLabel(at: number, rules: DayRules = DEFAULT_DAY_RULES): string {
  const d = new Date(shifted(at, rules))
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// ---------------------------------------------------------------- the range

export interface Range {
  /** Inclusive. */
  from: number
  /** Exclusive. */
  to: number
  /** Said plainly, with the dates in it. */
  label: string
  /** Whole days covered. */
  days: number
}

export type Window = 'week' | 'fortnight' | 'month' | 'quarter' | 'year' | 'all'

export const WINDOW_DAYS: Readonly<Record<Exclude<Window, 'all'>, number>> = Object.freeze({
  week: 7, fortnight: 14, month: 30, quarter: 90, year: 365
})

export const WINDOW_LABEL: Readonly<Record<Window, string>> = Object.freeze({
  week: 'the last 7 days',
  fortnight: 'the last 14 days',
  month: 'the last 30 days',
  quarter: 'the last 90 days',
  year: 'the last 365 days',
  all: 'everything recorded'
})

/**
 * A range ending at the end of today.
 *
 * It ends at the end of today rather than at `now`, so a chart's last bar is today's bar and does not shrink as the
 * day goes on. `earliest` is the first thing on record, for the `all` window; without one, `all` starts at the epoch
 * and the label says so rather than naming a date nobody recognises.
 */
export function rangeOf(now: number, window: Window, rules: DayRules = DEFAULT_DAY_RULES, earliest?: number): Range {
  const to = dayEnd(now, rules)
  const from = window === 'all'
    ? (earliest === undefined ? 0 : dayStart(Math.min(earliest, now), rules))
    : addDays(now, -(WINDOW_DAYS[window] - 1), rules)
  const days = Math.max(1, Math.round((to - from) / DAY))
  const label = window === 'all' && earliest === undefined
    ? 'everything recorded'
    : `${WINDOW_LABEL[window]}, ${dayLabel(from, rules)} to ${dayLabel(to - DAY, rules)}`
  return { from, to, label, days }
}

/** A range given by two moments, for a range the person chose. */
export function rangeBetween(from: number, to: number, rules: DayRules = DEFAULT_DAY_RULES): Range {
  const a = dayStart(Math.min(from, to), rules)
  const b = dayEnd(Math.max(from, to), rules)
  return { from: a, to: b, label: `${dayLabel(a, rules)} to ${dayLabel(b - DAY, rules)}`, days: Math.max(1, Math.round((b - a) / DAY)) }
}

const inRange = (at: number, range: Range): boolean => at >= range.from && at < range.to

// ---------------------------------------------------------------- what happened

/**
 * One sitting at one thing.
 *
 * The normal form everything in here counts. It is deliberately not "a puzzle solved" or "a lesson finished": it is a
 * sitting, with two facts that keep the counting honest.
 *
 * `worked` is whether anything was actually produced -- a move played, an answer given, a line entered. Opening a
 * finished lesson to read it again is a sitting with `worked: false`, and nothing counts it as activity. That one
 * field is what stops a streak being extended by clicking through yesterday's work.
 *
 * `succeeded` is `null` where the question does not apply. A game is not passed or failed, so a game's events carry
 * null and are never folded into a success rate.
 */
export interface ActivityEvent {
  /** This sitting's own id. Two sittings at the same exercise are two events. */
  id: string
  activity: ActivityKind
  /** What was worked on: an exercise, a game, a lesson, an opening line. Tells a repeat from a second thing. */
  thing: string
  at: number
  /** Whether anything was produced this sitting. */
  worked: boolean
  /** Whether it came out right, where that is a meaningful question. Null where it is not. */
  succeeded: boolean | null
  /** Whether it came out right with no help at all. Null where help is not a notion that applies. */
  clean: boolean | null
  /** Seconds of attention, when the activity measured it. Absent when it did not. */
  seconds?: number
  /** True when this `thing` had already been finished before this sitting. */
  repeat?: boolean
  /**
   * When the record was written, when that is known and may differ from `at`.
   *
   * It exists for one reason: a record entered for a day after that day has passed must not be able to repair a
   * streak. `challenges.ts` uses it for exactly that and nothing else.
   */
  recordedAt?: number
}

/** Training attempts as sittings. One attempt is one sitting; a second go at the same exercise is a second sitting. */
export function eventsFromTraining(records: readonly TrainingRecord[]): ActivityEvent[] {
  return records.map((record, index) => ({
    id: `training:${record.performance.exerciseId}:${record.performance.at}:${index}`,
    activity: ACTIVITY_OF_EXERCISE[record.kind],
    thing: record.performance.exerciseId,
    at: record.performance.at,
    // An attempt that was given up still produced moves and still took time; it is work that did not come off.
    worked: true,
    succeeded: record.performance.solved,
    // `worth` is the hint ladder: nought means the move itself had been shown, which is not a clean solve.
    clean: record.performance.solved && record.performance.worth >= 1 && record.performance.wrongMoves === 0,
    seconds: record.performance.seconds
  }))
}

export function eventsFromOpenings(records: readonly OpeningRecallRecord[]): ActivityEvent[] {
  return records.map((record, index) => ({
    id: `opening:${record.name}:${record.at}:${index}`,
    activity: 'opening-drill',
    thing: record.name,
    at: record.at,
    worked: true,
    succeeded: record.complete,
    clean: record.complete && record.correct >= record.length
  }))
}

/** A game having been analysed is itself an activity, separate from the game having been played. */
export function eventsFromAnalyses(games: readonly AnalysedGame[]): ActivityEvent[] {
  return games.map((game) => ({
    id: `analysis:${game.gameId}:${game.analysedAt}`,
    activity: 'analyse-game',
    thing: game.gameId,
    at: game.analysedAt,
    worked: game.moves.length > 0,
    succeeded: null,
    clean: null
  }))
}

/** Which activity a stored game came out of. The game record says where it came from, so nothing is guessed. */
const ACTIVITY_OF_SOURCE: Readonly<Record<StoredGame['source']['kind'], ActivityKind>> = Object.freeze({
  'local-engine': 'play',
  'custom-position': 'play',
  study: 'play',
  import: 'import-game',
  broadcast: 'watch-broadcast'
})

/**
 * Stored games as sittings.
 *
 * `succeeded` is null for every one of them: a result is not a pass. `worked` is whether the game has any moves,
 * which is what tells a game you played from a board you opened and left.
 */
export function eventsFromGames(games: readonly StoredGame[]): ActivityEvent[] {
  return games.map((game) => ({
    id: `game:${game.id}`,
    activity: ACTIVITY_OF_SOURCE[game.source.kind],
    thing: game.id,
    at: game.createdAt,
    worked: game.moves.length > 0,
    succeeded: null,
    clean: null
  }))
}

/** Everything, with duplicates by id removed and the earliest timestamp kept for each. */
export function mergeEvents(...lists: readonly (readonly ActivityEvent[])[]): ActivityEvent[] {
  const held = new Map<string, ActivityEvent>()
  for (const list of lists) {
    for (const event of list) {
      const have = held.get(event.id)
      if (have === undefined || event.at < have.at) held.set(event.id, event)
    }
  }
  return [...held.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------- counts

export interface ActivityCounts {
  range: Range
  /** Sittings where something was produced, per activity. */
  byActivity: Readonly<Record<ActivityKind, number>>
  /** All of them together. */
  attempts: number
  /** Sittings where nothing was produced. Counted apart and never as activity. */
  reopened: number
  /** Minutes, from recorded seconds only. Activities that do not measure time contribute nothing. */
  minutes: number
  /** How many of the sittings had a time recorded, so the minutes figure can be read honestly. */
  timed: number
  /** Days with at least one sitting where something was produced. */
  daysActive: number
  /** Distinct things worked on. */
  things: number
  says: string
}

export function countsIn(events: readonly ActivityEvent[], range: Range, rules: DayRules = DEFAULT_DAY_RULES): ActivityCounts {
  const byActivity: Record<ActivityKind, number> = Object.fromEntries(ACTIVITY_KINDS.map((one) => [one, 0])) as Record<ActivityKind, number>
  const days = new Set<string>()
  const things = new Set<string>()
  let attempts = 0
  let reopened = 0
  let seconds = 0
  let timed = 0
  for (const event of events) {
    if (!inRange(event.at, range)) continue
    if (!event.worked) { reopened += 1; continue }
    byActivity[event.activity] += 1
    attempts += 1
    days.add(dayKey(event.at, rules))
    things.add(`${event.activity}:${event.thing}`)
    if (event.seconds !== undefined) { seconds += event.seconds; timed += 1 }
  }
  return {
    range,
    byActivity,
    attempts,
    reopened,
    minutes: Math.round(seconds / 60),
    timed,
    daysActive: days.size,
    things: things.size,
    says: attempts === 0
      ? `Nothing recorded in ${range.label}.`
      : `${attempts} ${attempts === 1 ? 'sitting' : 'sittings'} over ${days.size} ${days.size === 1 ? 'day' : 'days'} in ${range.label}`
        + `${timed > 0 ? `, ${Math.round(seconds / 60)} minutes of it timed` : ', none of it timed'}`
        + `${reopened > 0 ? `. ${reopened} ${reopened === 1 ? 'time something finished was opened again, which is not counted as activity' : 'times something finished was opened again, which is not counted as activity'}` : ''}.`
  }
}

// ---------------------------------------------------------------- rates

/** How many rates it takes before a rate is worth reading. Written down, and shown beside the number. */
export const FIRM_AT = Object.freeze({ success: 20, completion: 5, accuracy: 50 })

export interface Rate {
  /** How many went the way the rate is about. */
  hits: number
  /** Out of how many. */
  of: number
  /** hits / of, or null when `of` is nought. Never nought: nothing happened is not a failure. */
  value: number | null
  /** False when `of` is below `firmAt`. */
  firm: boolean
  firmAt: number
  /** What the numerator is. */
  what: string
  /** What the denominator is. */
  outOf: string
  says: string
}

export function rate(hits: number, of: number, o: { what: string; outOf: string; firmAt?: number }): Rate {
  const firmAt = o.firmAt ?? FIRM_AT.success
  const value = of > 0 ? hits / of : null
  return {
    hits,
    of,
    value,
    firm: of >= firmAt,
    firmAt,
    what: o.what,
    outOf: o.outOf,
    says: of === 0
      ? `No ${o.outOf} yet, so there is no rate to give.`
      : `${hits} of ${of} ${o.outOf} ${o.what} (${Math.round((value as number) * 100)} per cent)`
        + (of >= firmAt ? '.' : ` -- ${of} is few, and one more result moves this a long way. ${firmAt} is where it starts to mean something.`)
  }
}

export interface SuccessRates {
  range: Range
  /** Attempts that came out right, out of the attempts where right and wrong apply. */
  overall: Rate
  /** The same, with no help taken at all. */
  clean: Rate
  byActivity: readonly { activity: ActivityKind; label: string; rate: Rate }[]
  /** Sittings left out because success is not a question for them -- games, imports, broadcasts. */
  notRateable: number
  says: string
}

export function successIn(events: readonly ActivityEvent[], range: Range): SuccessRates {
  const here = events.filter((one) => inRange(one.at, range) && one.worked)
  const rateable = here.filter((one) => one.succeeded !== null)
  const overall = rate(rateable.filter((one) => one.succeeded === true).length, rateable.length, { what: 'came out right', outOf: 'attempts' })
  const cleanable = here.filter((one) => one.clean !== null)
  const clean = rate(cleanable.filter((one) => one.clean === true).length, cleanable.length, { what: 'came out right with no help at all', outOf: 'attempts' })
  const byActivity: { activity: ActivityKind; label: string; rate: Rate }[] = []
  for (const activity of ACTIVITY_KINDS) {
    const mine = rateable.filter((one) => one.activity === activity)
    if (mine.length === 0) continue
    byActivity.push({
      activity,
      label: ACTIVITIES[activity].label,
      rate: rate(mine.filter((one) => one.succeeded === true).length, mine.length, { what: 'came out right', outOf: 'attempts' })
    })
  }
  return {
    range,
    overall,
    clean,
    byActivity,
    notRateable: here.length - rateable.length,
    says: rateable.length === 0
      ? `Nothing in ${range.label} was the kind of thing that comes out right or wrong.`
      : `${overall.says} ${here.length - rateable.length} other ${here.length - rateable.length === 1 ? 'sitting is' : 'sittings are'} `
        + 'not counted here, because a game is not passed or failed.'
  }
}

export interface CompletionRecord {
  kind: 'lesson' | 'course' | 'plan-item' | 'challenge'
  id: string
  startedAt: number
  /** Null while it is still going. */
  completedAt: number | null
}

export interface CompletionRates {
  range: Range
  /** Of the things started inside the range, how many were finished by the end of it. */
  overall: Rate
  byKind: readonly { kind: CompletionRecord['kind']; rate: Rate }[]
  /** How it is counted, in words, because there is more than one defensible way. */
  rule: string
  says: string
}

export const COMPLETION_RULE =
  'Of the things you started inside this range, how many were finished by the end of it. Something started earlier is '
  + 'not counted either way, so finishing a long course does not land as a hundred per cent in the week you finished it.'

export function completionIn(records: readonly CompletionRecord[], range: Range): CompletionRates {
  const started = records.filter((one) => inRange(one.startedAt, range))
  const done = (list: readonly CompletionRecord[]): number => list.filter((one) => one.completedAt !== null && (one.completedAt as number) < range.to).length
  const overall = rate(done(started), started.length, { what: 'were finished', outOf: 'things started', firmAt: FIRM_AT.completion })
  const kinds: CompletionRecord['kind'][] = ['lesson', 'course', 'plan-item', 'challenge']
  const byKind: { kind: CompletionRecord['kind']; rate: Rate }[] = []
  for (const kind of kinds) {
    const mine = started.filter((one) => one.kind === kind)
    if (mine.length === 0) continue
    byKind.push({ kind, rate: rate(done(mine), mine.length, { what: 'were finished', outOf: `${kind === 'plan-item' ? 'plan lines' : `${kind}s`} started`, firmAt: FIRM_AT.completion }) })
  }
  return {
    range,
    overall,
    byKind,
    rule: COMPLETION_RULE,
    says: started.length === 0 ? `Nothing was started inside ${range.label}.` : overall.says
  }
}

// ---------------------------------------------------------------- accuracy

/** The move classes that count as the engine agreeing with you. */
export const GOOD_CLASSES: readonly MoveClass[] = Object.freeze(['best', 'excellent', 'good'])

/**
 * The definition. This exact string is what the screen shows beside the number.
 *
 * Accuracy = G / J, where G is the number of your own moves the engine called best, excellent or good, and J is the
 * number of your own moves it was able to judge at all. A move it could not judge -- no score, or a change between a
 * mate score and an ordinary one that no centipawn figure describes -- is in neither G nor J, and is counted
 * separately as `unjudged`.
 */
export const ACCURACY_FORMULA =
  'Accuracy is the number of your own moves the engine called best, excellent or good, divided by the number of your '
  + 'own moves it was able to judge at all, as a percentage.'

export const ACCURACY_NOTES: readonly string[] = Object.freeze([
  'Moves the engine could not judge are left out of both halves of the division and counted separately, rather than being treated as mistakes.',
  'It is a share of moves, not a measure of strength. A quiet game of obvious moves scores higher than a hard one played well.',
  'It can only be compared with your own other games analysed by the same engine to the same depth. It is not the same number any other program calls accuracy.',
  `Games analysed shallower than depth ${EVIDENCE.minDepth} are left out altogether, and games that do not record which side you played cannot contribute.`
])

export interface Accuracy {
  range: Range
  /** 0..1, or null when nothing could be judged. */
  value: number | null
  good: number
  judged: number
  unjudged: number
  /** The games that contributed. */
  games: number
  /** Left out, and why. */
  skipped: { tooShallow: number; noSide: number; outOfRange: number }
  /** The depths of the games that contributed. More than one means the number mixes two measurements. */
  depths: readonly number[]
  formula: string
  notes: readonly string[]
  firm: boolean
  says: string
}

export function accuracyIn(games: readonly AnalysedGame[], range: Range): Accuracy {
  let good = 0
  let judged = 0
  let unjudged = 0
  let used = 0
  const skipped = { tooShallow: 0, noSide: 0, outOfRange: 0 }
  const depths = new Set<number>()
  for (const game of games) {
    if (!inRange(game.analysedAt, range)) { skipped.outOfRange += 1; continue }
    if (game.you === null) { skipped.noSide += 1; continue }
    if (game.depth < EVIDENCE.minDepth) { skipped.tooShallow += 1; continue }
    used += 1
    depths.add(game.depth)
    for (const move of game.moves) {
      if (move.side !== game.you) continue
      if (move.klass === 'unclear') { unjudged += 1; continue }
      judged += 1
      if (GOOD_CLASSES.includes(move.klass)) good += 1
    }
  }
  const value = judged > 0 ? good / judged : null
  const mixed = depths.size > 1
  return {
    range,
    value,
    good,
    judged,
    unjudged,
    games: used,
    skipped,
    depths: [...depths].sort((a, b) => a - b),
    formula: ACCURACY_FORMULA,
    notes: ACCURACY_NOTES,
    firm: judged >= FIRM_AT.accuracy,
    says: value === null
      ? `No moves of yours could be judged in ${range.label}, so there is no accuracy figure.`
      : `${Math.round(value * 100)} per cent: ${good} of ${judged} judged moves, over ${used} ${used === 1 ? 'game' : 'games'} in ${range.label}.`
        + ` ${unjudged} ${unjudged === 1 ? 'move was' : 'moves were'} left out because the engine could not judge ${unjudged === 1 ? 'it' : 'them'}.`
        + (judged < FIRM_AT.accuracy ? ` ${judged} judged moves is few; ${FIRM_AT.accuracy} is where this starts to mean something.` : '')
        + (mixed ? ` These games were analysed at different depths (${[...depths].sort((a, b) => a - b).join(', ')}), so the figure mixes two measurements.` : '')
  }
}

// ---------------------------------------------------------------- series, for charts

export type Bucket = 'day' | 'week' | 'month'
export type SeriesUnit = 'count' | 'share' | 'minutes'

export const BUCKET_LABEL: Readonly<Record<Bucket, string>> = Object.freeze({ day: 'Day', week: 'Week beginning', month: 'Month' })

export interface Point {
  from: number
  /** Exclusive. */
  to: number
  label: string
  /** The value, or null when there was nothing in this bucket to work one out from. A gap is not a nought. */
  value: number | null
  /** How many things the value rests on. */
  n: number
}

export interface Series {
  key: string
  title: string
  axisX: string
  axisY: string
  unit: SeriesUnit
  range: Range
  bucket: Bucket
  points: readonly Point[]
  /** The largest value, for drawing. Null when nothing has a value. */
  max: number | null
  /** Buckets with nothing in them. Shown as gaps, not as noughts. */
  gaps: number
  says: string
}

/** How many buckets a chart will take before it stops being a chart. */
export const MOST_POINTS = 400

/** The coarsest bucket that keeps a range inside `MOST_POINTS`, so nobody asks for a thousand bars. */
export function bestBucket(range: Range): Bucket {
  if (range.days <= 62) return 'day'
  if (range.days <= 400) return 'week'
  return 'month'
}

function bucketsOf(range: Range, bucket: Bucket, rules: DayRules): { from: number; to: number; label: string }[] {
  const out: { from: number; to: number; label: string }[] = []
  let at = bucket === 'day' ? dayStart(range.from, rules) : bucket === 'week' ? weekStart(range.from, rules) : monthStart(range.from, rules)
  while (at < range.to && out.length < MOST_POINTS) {
    const next = bucket === 'day' ? at + DAY : bucket === 'week' ? at + 7 * DAY : monthStart(at + 32 * DAY, rules)
    out.push({
      from: at,
      to: next,
      label: bucket === 'day' ? shortDayLabel(at, rules) : bucket === 'week' ? `w/b ${shortDayLabel(at, rules)}` : monthLabel(at, rules)
    })
    at = next
  }
  return out
}

export interface SeriesInput {
  key: string
  title: string
  axisY: string
  unit: SeriesUnit
  range: Range
  bucket?: Bucket
  rules?: DayRules
  /**
   * Each thing that happened. `hit` is for a share; `amount` is for anything summed.
   *
   * A share bucket with no items has no value, not a nought -- that distinction is the whole reason this takes items
   * rather than numbers already added up.
   */
  items: readonly { at: number; hit?: boolean; amount?: number }[]
}

export function series(input: SeriesInput): Series {
  const rules = input.rules ?? DEFAULT_DAY_RULES
  const bucket = input.bucket ?? bestBucket(input.range)
  const shells = bucketsOf(input.range, bucket, rules)
  const points: Point[] = shells.map((shell) => {
    const mine = input.items.filter((one) => one.at >= shell.from && one.at < shell.to)
    if (input.unit === 'count') return { ...shell, value: mine.length, n: mine.length }
    if (input.unit === 'minutes') {
      const seconds = mine.reduce((sum, one) => sum + (one.amount ?? 0), 0)
      return { ...shell, value: mine.length === 0 ? null : Math.round(seconds / 60), n: mine.length }
    }
    const hits = mine.filter((one) => one.hit === true).length
    return { ...shell, value: mine.length === 0 ? null : hits / mine.length, n: mine.length }
  })
  const values = points.map((one) => one.value).filter((one): one is number => one !== null)
  const gaps = points.filter((one) => one.value === null).length
  return {
    key: input.key,
    title: input.title,
    axisX: BUCKET_LABEL[bucket],
    axisY: input.axisY,
    unit: input.unit,
    range: input.range,
    bucket,
    points,
    max: values.length > 0 ? Math.max(...values) : null,
    gaps,
    says: points.length === 0
      ? 'There is nothing to draw.'
      : `${points.length} ${BUCKET_LABEL[bucket].toLowerCase()}${points.length === 1 ? '' : 's'} across ${input.range.label}`
        + (gaps > 0 ? `, ${gaps} of ${input.unit === 'count' ? 'them empty' : 'them with nothing to work a value out from, shown as gaps'}` : '')
        + '.'
  }
}

// ---------------------------------------------------------------- comparing two stretches

export interface Change {
  earlier: Rate
  later: Rate
  /** The difference in percentage points, or null when either side is too thin to put beside the other. */
  points: number | null
  comparable: boolean
  says: string
}

/**
 * Two rates side by side.
 *
 * It is a difference between two stretches, and it says so. Calling it a trend would be a claim about where the next
 * stretch lands, which two numbers cannot support -- and refusing the comparison outright when either side is thin is
 * the only honest answer, because a rate over six attempts moves twenty points on one result.
 */
export function changeBetween(earlier: Rate, later: Rate, o: { minEach?: number } = {}): Change {
  const minEach = o.minEach ?? earlier.firmAt
  const comparable = earlier.of >= minEach && later.of >= minEach && earlier.value !== null && later.value !== null
  const points = comparable ? Math.round(((later.value as number) - (earlier.value as number)) * 100) : null
  return {
    earlier,
    later,
    points,
    comparable,
    says: !comparable
      ? `These two stretches cannot be put beside each other: ${minEach} attempts are needed in each and there are `
        + `${earlier.of} in the earlier one and ${later.of} in the later.`
      : `${Math.abs(points as number)} percentage ${Math.abs(points as number) === 1 ? 'point' : 'points'} `
        + `${(points as number) > 0 ? 'higher' : (points as number) < 0 ? 'lower' : 'the same'} `
        + `(${earlier.hits} of ${earlier.of}, then ${later.hits} of ${later.of}). This is a difference between two `
        + 'stretches of your own record. It is not a trend and says nothing about the next one.'
  }
}

// ---------------------------------------------------------------- the whole report

export const WHAT_THESE_ARE: readonly string[] = Object.freeze([
  'A count is how many times something happened. Nothing here turns a count into a rate.',
  'A success rate is how many attempts came out right, out of the attempts where right and wrong apply. Games are counted, never rated: you can lose a well played game.',
  'A completion rate is how many things you started were finished. Finishing is not the same as getting it right.',
  'Accuracy is a share of moves, defined in full beside the number.'
])

export const CANNOT_ESTABLISH: readonly string[] = Object.freeze([
  'Whether you are getting stronger. Nothing here plays a rated game, so there is no measure of strength to move.',
  'How you compare with anybody else. The puzzles, the engine and the depth are all yours, and nobody else is measured the same way.',
  'Why a number moved. A better week may be an easier week; the record does not hold which.',
  'Anything about a stretch with nothing in it. A quiet fortnight shows as a gap, and nothing fills a value in for it.'
])

export interface ProgressInput {
  games?: readonly AnalysedGame[]
  training?: readonly TrainingRecord[]
  openings?: readonly OpeningRecallRecord[]
  /** Stored games, for the count of games played and brought in. */
  played?: readonly StoredGame[]
  completions?: readonly CompletionRecord[]
  /** Sittings already in normal form, when the caller has them. Merged with whatever the records above produce. */
  events?: readonly ActivityEvent[]
}

export interface ProgressReport {
  range: Range
  window: Window
  counts: ActivityCounts
  success: SuccessRates
  completion: CompletionRates
  accuracy: Accuracy
  series: readonly Series[]
  /** Every sitting in normal form, for anything else that wants to count them. */
  events: readonly ActivityEvent[]
  whatTheseAre: readonly string[]
  cannotEstablish: readonly string[]
  calendarRules: readonly string[]
  says: string
  at: number
}

/** All the sittings the input describes, in one list. */
export function eventsOf(input: ProgressInput): ActivityEvent[] {
  return mergeEvents(
    eventsFromTraining(input.training ?? []),
    eventsFromOpenings(input.openings ?? []),
    eventsFromAnalyses(input.games ?? []),
    eventsFromGames(input.played ?? []),
    input.events ?? []
  )
}

/**
 * Everything, for one range.
 *
 * The charts included are the ones the records can actually support: how much was done, how much of it came out
 * right, and accuracy over the games that were analysed deeply enough. A chart nothing can fill is not drawn empty --
 * it is not drawn, and the counts above it say why.
 */
export function progressReport(input: ProgressInput, now: number, o: { window?: Window; rules?: DayRules; bucket?: Bucket } = {}): ProgressReport {
  const rules = o.rules ?? DEFAULT_DAY_RULES
  const window = o.window ?? 'month'
  const events = eventsOf(input)
  const earliest = events.length > 0 ? events[0].at : undefined
  const range = rangeOf(now, window, rules, earliest)
  const counts = countsIn(events, range, rules)
  const success = successIn(events, range)
  const completion = completionIn(input.completions ?? [], range)
  const accuracy = accuracyIn(input.games ?? [], range)
  const bucket = o.bucket ?? bestBucket(range)

  const worked = events.filter((one) => one.worked && one.at >= range.from && one.at < range.to)
  const rateable = worked.filter((one) => one.succeeded !== null)
  const timed = worked.filter((one) => one.seconds !== undefined)

  const charts: Series[] = []
  if (worked.length > 0) {
    charts.push(series({
      key: 'sittings',
      title: 'How much you did',
      axisY: 'Sittings',
      unit: 'count',
      range,
      bucket,
      rules,
      items: worked.map((one) => ({ at: one.at }))
    }))
  }
  if (rateable.length > 0) {
    charts.push(series({
      key: 'success',
      title: 'How much of it came out right',
      axisY: 'Share of attempts',
      unit: 'share',
      range,
      bucket,
      rules,
      items: rateable.map((one) => ({ at: one.at, hit: one.succeeded === true }))
    }))
  }
  if (timed.length > 0) {
    charts.push(series({
      key: 'minutes',
      title: 'Time at it, where it was measured',
      axisY: 'Minutes',
      unit: 'minutes',
      range,
      bucket,
      rules,
      items: timed.map((one) => ({ at: one.at, amount: one.seconds }))
    }))
  }
  const judgedMoves = (input.games ?? [])
    .filter((game) => game.you !== null && game.depth >= EVIDENCE.minDepth && game.analysedAt >= range.from && game.analysedAt < range.to)
    .flatMap((game) => game.moves.filter((move) => move.side === game.you && move.klass !== 'unclear').map((move) => ({ at: game.analysedAt, hit: GOOD_CLASSES.includes(move.klass) })))
  if (judgedMoves.length > 0) {
    charts.push(series({
      key: 'accuracy',
      title: 'Accuracy of your moves, by when the game was analysed',
      axisY: 'Share of judged moves',
      unit: 'share',
      range,
      bucket,
      rules,
      items: judgedMoves
    }))
  }

  return {
    range,
    window,
    counts,
    success,
    completion,
    accuracy,
    series: charts,
    events,
    whatTheseAre: WHAT_THESE_ARE,
    cannotEstablish: CANNOT_ESTABLISH,
    calendarRules: CALENDAR_RULES,
    says: events.length === 0
      ? 'Nothing has been recorded yet, so there is nothing to measure.'
      : counts.attempts === 0
        ? `Nothing was recorded in ${range.label}, though there is ${events.length === 1 ? 'a record' : 'a record'} from outside it.`
        : counts.says,
    at: now
  }
}
