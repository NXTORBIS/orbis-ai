import { ACTIVITIES, planTitle, type ActivityKind, type PlanItem, type StudyPlan } from './coach.ts'
import {
  CALENDAR_RULES, DEFAULT_DAY_RULES, addDays, dayEnd, dayKey, dayLabel, dayStart, mergeEvents, weekStart,
  type ActivityEvent, type DayRules
} from './progress.ts'

/**
 * Goals, challenges, streaks and achievements, with the rules written down (Sections 176-180).
 *
 * ## Everything asks for something that exists
 *
 * A challenge that asks you to do something Chess World has not got is a broken promise dressed as encouragement, so
 * every goal counts `ActivityEvent`s -- sittings at one of the activities in `coach.ts`'s `ACTIVITIES` table -- and
 * nothing else. There is no challenge for a feature that is not there.
 *
 * ## The counting rules are the product
 *
 * A streak is only worth having if it cannot be got cheaply, and the obvious way to get one cheaply is to open
 * yesterday's finished work and let the screen count it as today's. So:
 *
 *   - a sitting counts only when something was **produced** in it (`worked`);
 *   - two records of the same sitting are one sitting;
 *   - a sitting counts on the day it happened, not the day it is looked at;
 *   - a sitting timed in the future is ignored;
 *   - a record written down after the day it claims cannot repair that day's streak, though it still counts in totals.
 *
 * Those five are `STREAK_RULES`, they are shown on the screen, and they are what the tests push against.
 *
 * ## Nothing is stored, so switching it off loses nothing
 *
 * Streaks, goal standing and achievements are all worked out from the sittings every time. There is no streak counter
 * to lose, so turning gamification off and on again shows exactly the number it would have shown -- which is the
 * reason it can be turned off at all without breaking anything else.
 *
 * ## Deterministic
 *
 * Today's challenges come from today's date, through a small written-out hash. There is no random source in this
 * file, so the challenge does not change when the screen is reopened and a test can say which one it will be.
 */

const DAY = 86_400_000

// ---------------------------------------------------------------- periods

export type PeriodKind = 'day' | 'week'

export interface Period {
  kind: PeriodKind
  /** Inclusive. */
  from: number
  /** Exclusive. */
  to: number
  /** The period's identity. `2026-10-16` for a day, `w:2026-10-12` for the week beginning that Monday. */
  key: string
  label: string
}

export const DAY_BOUNDARY_RULES: readonly string[] = CALENDAR_RULES

export function periodOf(kind: PeriodKind, at: number, rules: DayRules = DEFAULT_DAY_RULES): Period {
  if (kind === 'day') {
    return { kind, from: dayStart(at, rules), to: dayEnd(at, rules), key: dayKey(at, rules), label: dayLabel(at, rules) }
  }
  const from = weekStart(at, rules)
  return { kind, from, to: from + 7 * DAY, key: `w:${dayKey(from, rules)}`, label: `the week beginning ${dayLabel(from, rules)}` }
}

/** The period `n` back from the one containing `at`. */
export function periodBack(kind: PeriodKind, at: number, n: number, rules: DayRules = DEFAULT_DAY_RULES): Period {
  return kind === 'day' ? periodOf('day', addDays(at, -n, rules), rules) : periodOf('week', weekStart(at, rules) - n * 7 * DAY, rules)
}

// ---------------------------------------------------------------- what practice means

/**
 * The activities a streak or a practice goal may be built from.
 *
 * Bringing in a PGN file and watching somebody else's game are both real things you did, and both are counted in the
 * progress figures. Neither is you working at chess, so neither can hold a streak up: a run of days kept alive by
 * importing a file every morning would measure nothing at all.
 */
export const PRACTICE: readonly ActivityKind[] = Object.freeze([
  'play', 'analyse-game', 'puzzle', 'calculation', 'blindfold', 'endgame', 'lesson', 'opening-drill'
])

/** The kinds of training, for the achievement that asks for all of them. */
export const TRAINING: readonly ActivityKind[] = Object.freeze(['puzzle', 'calculation', 'blindfold', 'endgame', 'lesson', 'opening-drill'])

// ---------------------------------------------------------------- goals

export type GoalMeasure =
  /** Sittings where something was produced. A repeat of the same thing is a second sitting. */
  | { kind: 'attempts'; activities?: readonly ActivityKind[] }
  /** Sittings that came out right. Only counts the activities where right and wrong apply. */
  | { kind: 'successes'; activities?: readonly ActivityKind[] }
  /** Sittings that came out right with no help at all. */
  | { kind: 'clean-successes'; activities?: readonly ActivityKind[] }
  /** Different things worked on, rather than how many times. */
  | { kind: 'distinct-things'; activities?: readonly ActivityKind[] }
  /** Whole minutes, from recorded times only. */
  | { kind: 'minutes'; activities?: readonly ActivityKind[] }
  /** Different kinds of activity done. */
  | { kind: 'distinct-activities'; activities?: readonly ActivityKind[] }

export const MEASURE_KINDS: readonly GoalMeasure['kind'][] = Object.freeze([
  'attempts', 'successes', 'clean-successes', 'distinct-things', 'minutes', 'distinct-activities'
])

export interface Goal {
  id: string
  label: string
  period: PeriodKind
  target: number
  measure: GoalMeasure
  /** Exactly how it is counted, in words. Written from the measure, so the words and the arithmetic cannot drift. */
  rule: string
}

const where = (activities?: readonly ActivityKind[]): string => {
  if (!activities || activities.length === 0) return 'anything you did'
  if (activities.length === 1) return `"${ACTIVITIES[activities[0]].label}"`
  if (activities.length === PRACTICE.length && PRACTICE.every((one) => activities.includes(one))) return 'anything that counts as practice'
  return activities.map((one) => `"${ACTIVITIES[one].label}"`).join(', ')
}

/** What a measure counts, in words. The one source for both the screen and the rule written on a goal. */
export function describeMeasure(measure: GoalMeasure): string {
  const place = where(measure.activities)
  switch (measure.kind) {
    case 'attempts':
      return `sittings at ${place} where you actually played or answered something`
    case 'successes':
      return `sittings at ${place} that came out right`
    case 'clean-successes':
      return `sittings at ${place} that came out right with no hint and no wrong move`
    case 'distinct-things':
      return `different things worked on at ${place}`
    case 'minutes':
      return `whole minutes recorded at ${place}`
    case 'distinct-activities':
      return `different kinds of activity among ${place}`
  }
}

export function goalRule(period: PeriodKind, target: number, measure: GoalMeasure): string {
  return `${target} ${describeMeasure(measure)}, inside one ${period === 'day' ? 'day' : 'week'}. `
    + 'A sitting where nothing was produced is not counted, and the same sitting is never counted twice.'
}

export function makeGoal(o: { id: string; label: string; period: PeriodKind; target: number; measure: GoalMeasure }): Goal {
  return { ...o, target: Math.max(1, Math.round(o.target)), rule: goalRule(o.period, Math.max(1, Math.round(o.target)), o.measure) }
}

export const DAILY_PRACTICE: Goal = makeGoal({
  id: 'daily-practice',
  label: 'Practise today',
  period: 'day',
  target: 3,
  measure: { kind: 'attempts', activities: PRACTICE }
})

export const WEEKLY_PRACTICE: Goal = makeGoal({
  id: 'weekly-practice',
  label: 'Practise this week',
  period: 'week',
  target: 20,
  measure: { kind: 'attempts', activities: PRACTICE }
})

// ---------------------------------------------------------------- counting a goal

const wanted = (event: ActivityEvent, measure: GoalMeasure): boolean => {
  const list = measure.activities
  return !list || list.length === 0 || list.includes(event.activity)
}

/** What a measure makes of a set of sittings. Every sitting handed in here has already passed the rules above. */
export function countFor(measure: GoalMeasure, events: readonly ActivityEvent[]): number {
  const mine = events.filter((one) => one.worked && wanted(one, measure))
  switch (measure.kind) {
    case 'attempts':
      return mine.length
    case 'successes':
      return mine.filter((one) => one.succeeded === true).length
    case 'clean-successes':
      return mine.filter((one) => one.clean === true).length
    case 'distinct-things':
      return new Set(mine.map((one) => `${one.activity}:${one.thing}`)).size
    case 'minutes':
      return Math.floor(mine.reduce((sum, one) => sum + (one.seconds ?? 0), 0) / 60)
    case 'distinct-activities':
      return new Set(mine.map((one) => one.activity)).size
  }
}

export interface Ignored {
  /** Timed later than now. */
  future: number
  /** Nothing was produced: something finished, opened again. */
  noWork: number
  /** Belongs to another period. */
  otherPeriod: number
  /** Not one of the activities this goal is about. */
  otherActivity: number
  /** The same sitting reported more than once. */
  duplicate: number
}

export interface GoalStanding {
  goal: Goal
  period: Period
  done: number
  target: number
  complete: boolean
  /** 0..1, for a bar. Capped at 1 so going past the target does not draw past the end. */
  fraction: number
  /** Sittings that counted. */
  counted: number
  ignored: Ignored
  says: string
}

/**
 * How a goal stands in the period containing `now`, or in a period you name.
 *
 * `ignored` is reported rather than discarded, because "you did four things and the goal says one" is the kind of
 * disagreement a person has to be able to see the reason for.
 */
export function goalStanding(
  goal: Goal,
  events: readonly ActivityEvent[],
  now: number,
  rules: DayRules = DEFAULT_DAY_RULES,
  period?: Period
): GoalStanding {
  const when = period ?? periodOf(goal.period, now, rules)
  const unique = mergeEvents(events)
  const ignored: Ignored = { future: 0, noWork: 0, otherPeriod: 0, otherActivity: 0, duplicate: events.length - unique.length }
  const counting: ActivityEvent[] = []
  for (const event of unique) {
    if (event.at > now) { ignored.future += 1; continue }
    if (event.at < when.from || event.at >= when.to) { ignored.otherPeriod += 1; continue }
    if (!event.worked) { ignored.noWork += 1; continue }
    if (!wanted(event, goal.measure)) { ignored.otherActivity += 1; continue }
    counting.push(event)
  }
  const done = countFor(goal.measure, counting)
  const complete = done >= goal.target
  return {
    goal,
    period: when,
    done,
    target: goal.target,
    complete,
    fraction: Math.min(1, goal.target > 0 ? done / goal.target : 0),
    counted: counting.length,
    ignored,
    says: complete
      ? `Done: ${done} of ${goal.target} ${describeMeasure(goal.measure)} in ${when.label}.`
      : `${done} of ${goal.target} ${describeMeasure(goal.measure)} in ${when.label}.`
        + (ignored.noWork > 0 ? ` ${ignored.noWork} ${ignored.noWork === 1 ? 'sitting produced' : 'sittings produced'} nothing and ${ignored.noWork === 1 ? 'is' : 'are'} not counted.` : '')
  }
}

// ---------------------------------------------------------------- streaks

export const STREAK_RULES: readonly string[] = Object.freeze([
  'Only a sitting where you produced something counts. Opening a puzzle or a lesson you have already finished, and answering nothing, is not a day of work.',
  'The same sitting counts once. Two records with one id are one sitting, and the earlier time is the one kept.',
  'A sitting counts on the day it happened, from its own time. Today is never credited with yesterday\'s work.',
  'A sitting timed later than now is ignored. A day that has not happened cannot be credited.',
  'A record written down on a later day than the one it claims does not credit that day. It still counts in your totals; it cannot repair a streak.',
  'Today does not break a run until it is over. Until the goal is met today, the run is counted up to yesterday and today is shown as still open.'
])

export interface StreakDay {
  key: string
  label: string
  from: number
  to: number
  done: number
  met: boolean
  /** True for the period `now` is in, which is still open. */
  current: boolean
}

export interface Streak {
  goal: Goal
  /** Periods in a row, up to and including the current one when it is already met. */
  current: number
  /** The longest run inside the window that was looked at. */
  longest: number
  /** How many periods back were looked at, because `longest` is only about those. */
  looked: number
  /** The last period the goal was met in. */
  lastMet: string | null
  /** True when the current period is already met. */
  nowMet: boolean
  /** Newest first. */
  periods: readonly StreakDay[]
  /** Sittings that were set aside, and why. */
  ignored: Ignored & { lateRecord: number }
  rules: readonly string[]
  says: string
}

/**
 * The run of periods the goal was met in.
 *
 * The sittings are filtered once, by the rules above, and the periods are then counted from that one filtered list --
 * so a sitting that cannot credit a day cannot credit it through any route.
 */
export function streakOf(
  goal: Goal,
  events: readonly ActivityEvent[],
  now: number,
  rules: DayRules = DEFAULT_DAY_RULES,
  o: { look?: number } = {}
): Streak {
  const look = Math.max(1, Math.min(400, o.look ?? 120))
  const unique = mergeEvents(events)
  const ignored: Ignored & { lateRecord: number } = {
    future: 0, noWork: 0, otherPeriod: 0, otherActivity: 0, duplicate: events.length - unique.length, lateRecord: 0
  }
  const usable: ActivityEvent[] = []
  for (const event of unique) {
    if (event.at > now) { ignored.future += 1; continue }
    if (!event.worked) { ignored.noWork += 1; continue }
    if (!wanted(event, goal.measure)) { ignored.otherActivity += 1; continue }
    // The anti-repair rule: a record entered after its own period had closed may not credit that period.
    if (event.recordedAt !== undefined && periodOf(goal.period, event.recordedAt, rules).key !== periodOf(goal.period, event.at, rules).key) {
      ignored.lateRecord += 1
      continue
    }
    usable.push(event)
  }

  const periods: StreakDay[] = []
  for (let back = 0; back < look; back++) {
    const when = periodBack(goal.period, now, back, rules)
    const inside = usable.filter((one) => one.at >= when.from && one.at < when.to)
    const done = countFor(goal.measure, inside)
    periods.push({ key: when.key, label: when.label, from: when.from, to: when.to, done, met: done >= goal.target, current: back === 0 })
  }

  const nowMet = periods[0]?.met ?? false
  // Today is open until it ends: a run is counted from today when today is already met, and from yesterday when it
  // is not. Otherwise every streak would read nought every morning.
  let current = 0
  for (let i = nowMet ? 0 : 1; i < periods.length; i++) {
    if (!periods[i].met) break
    current += 1
  }
  let longest = 0
  let run = 0
  for (const one of periods) {
    run = one.met ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  const lastMet = periods.find((one) => one.met)?.key ?? null
  const unit = goal.period === 'day' ? 'day' : 'week'

  return {
    goal,
    current,
    longest,
    looked: look,
    lastMet,
    nowMet,
    periods,
    ignored,
    rules: STREAK_RULES,
    says: current === 0
      ? lastMet === null
        ? `No ${unit} yet has met "${goal.label}".`
        : `No run at the moment. The last ${unit} that met "${goal.label}" was ${periods.find((one) => one.met)?.label ?? lastMet}.`
      : `${current} ${current === 1 ? unit : `${unit}s`} in a row`
        + (nowMet ? `, including ${goal.period === 'day' ? 'today' : 'this week'}.` : `, up to ${goal.period === 'day' ? 'yesterday' : 'last week'}. ${goal.period === 'day' ? 'Today' : 'This week'} is still open: ${periods[0]?.done ?? 0} of ${goal.target}.`)
  }
}

// ---------------------------------------------------------------- challenges

export interface ChallengeTemplate {
  id: string
  label: string
  period: PeriodKind
  target: number
  measure: GoalMeasure
  /** Why this one is worth doing, in a person's words. */
  why: string
}

export const DAILY_TEMPLATES: readonly ChallengeTemplate[] = Object.freeze([
  { id: 'five-puzzles', label: 'Five puzzles', period: 'day', target: 5, measure: { kind: 'attempts', activities: ['puzzle'] }, why: 'Short and specific. Attempts count whether or not they come off.' },
  { id: 'three-clean', label: 'Three clean solves', period: 'day', target: 3, measure: { kind: 'clean-successes', activities: ['puzzle', 'endgame'] }, why: 'No hint, no wrong move. Harder than it sounds and worth more than five guesses.' },
  { id: 'one-analysis', label: 'Go through one of your games', period: 'day', target: 1, measure: { kind: 'attempts', activities: ['analyse-game'] }, why: 'The most direct evidence about your own play there is.' },
  { id: 'calculate-three', label: 'Calculate three lines', period: 'day', target: 3, measure: { kind: 'attempts', activities: ['calculation'] }, why: 'Working a line out without moving the pieces is the thing games are actually made of.' },
  { id: 'blind-five', label: 'Five in your head', period: 'day', target: 5, measure: { kind: 'attempts', activities: ['blindfold'] }, why: 'Board sense, with nothing to look at.' },
  { id: 'endgame-three', label: 'Three endgames', period: 'day', target: 3, measure: { kind: 'attempts', activities: ['endgame'] }, why: 'The part of the game that is knowledge rather than invention.' },
  { id: 'two-openings', label: 'Two opening lines from memory', period: 'day', target: 2, measure: { kind: 'attempts', activities: ['opening-drill'] }, why: 'Short, and it finds the move you never actually learned.' },
  { id: 'twenty-minutes', label: 'Twenty measured minutes', period: 'day', target: 20, measure: { kind: 'minutes', activities: PRACTICE }, why: 'Only counts time the activity measured, so it cannot be filled by leaving a screen open.' },
  { id: 'three-kinds', label: 'Three kinds of practice', period: 'day', target: 3, measure: { kind: 'distinct-activities', activities: PRACTICE }, why: 'Variety, counted as variety rather than as volume.' },
  { id: 'play-one', label: 'Play a game through', period: 'day', target: 1, measure: { kind: 'attempts', activities: ['play'] }, why: 'A game with moves in it. A board opened and left does not count.' }
])

export const WEEKLY_TEMPLATES: readonly ChallengeTemplate[] = Object.freeze([
  { id: 'week-thirty-puzzles', label: 'Thirty puzzles this week', period: 'week', target: 30, measure: { kind: 'attempts', activities: ['puzzle'] }, why: 'Enough attempts that the solve rate over them starts to mean something.' },
  { id: 'week-three-games', label: 'Three games gone through', period: 'week', target: 3, measure: { kind: 'attempts', activities: ['analyse-game'] }, why: 'Three analysed games is where the per-phase numbers begin to fill in.' },
  { id: 'week-fifteen-different', label: 'Fifteen different exercises', period: 'week', target: 15, measure: { kind: 'distinct-things', activities: TRAINING }, why: 'Different ones, not the same one fifteen times.' },
  { id: 'week-five-kinds', label: 'Five kinds of practice', period: 'week', target: 5, measure: { kind: 'distinct-activities', activities: PRACTICE }, why: 'Across the week, not in one sitting.' },
  { id: 'week-ten-clean', label: 'Ten clean solves', period: 'week', target: 10, measure: { kind: 'clean-successes', activities: TRAINING }, why: 'No hints and no wrong moves in any of the ten.' },
  { id: 'week-two-hours', label: 'Two measured hours', period: 'week', target: 120, measure: { kind: 'minutes', activities: PRACTICE }, why: 'Measured time only, from the activities that record it.' }
])

export interface Challenge {
  id: string
  label: string
  /** Why it is worth doing. */
  why: string
  goal: Goal
  period: Period
  /** Where it came from. */
  from: 'daily' | 'weekly' | 'coach'
  /** The plan line it came from, for a coach challenge. */
  planItemId?: string
}

/**
 * A small, written-out hash of the period's own key.
 *
 * It exists so that today's challenges come from today's date and nothing else: the same day always gives the same
 * ones, there is no random source in this file, and a test can say in advance which challenge a given date produces.
 */
function hashKey(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
  return h
}

function pick(templates: readonly ChallengeTemplate[], key: string, count: number): ChallengeTemplate[] {
  const want = Math.max(0, Math.min(count, templates.length))
  const start = hashKey(key) % templates.length
  const out: ChallengeTemplate[] = []
  for (let i = 0; i < want; i++) out.push(templates[(start + i) % templates.length])
  return out
}

function challengeOf(template: ChallengeTemplate, period: Period, from: 'daily' | 'weekly'): Challenge {
  return {
    id: `${from}:${period.key}:${template.id}`,
    label: template.label,
    why: template.why,
    goal: makeGoal({ id: `${from}:${period.key}:${template.id}`, label: template.label, period: template.period, target: template.target, measure: template.measure }),
    period,
    from
  }
}

/** Today's challenges, from today's date. The same every time the screen is opened. */
export function dailyChallenges(now: number, rules: DayRules = DEFAULT_DAY_RULES, o: { count?: number; templates?: readonly ChallengeTemplate[] } = {}): Challenge[] {
  const period = periodOf('day', now, rules)
  return pick(o.templates ?? DAILY_TEMPLATES, period.key, o.count ?? 3).map((one) => challengeOf(one, period, 'daily'))
}

/** This week's challenges, from the week's own Monday. */
export function weeklyChallenges(now: number, rules: DayRules = DEFAULT_DAY_RULES, o: { count?: number; templates?: readonly ChallengeTemplate[] } = {}): Challenge[] {
  const period = periodOf('week', now, rules)
  return pick(o.templates ?? WEEKLY_TEMPLATES, period.key, o.count ?? 2).map((one) => challengeOf(one, period, 'weekly'))
}

/**
 * Challenges from the person's own study plan.
 *
 * Only from lines that are showing: a dismissed line does not come back as a challenge, which would be the dismissal
 * undone by another route.
 */
export function coachChallenges(plan: StudyPlan | readonly PlanItem[], now: number, rules: DayRules = DEFAULT_DAY_RULES, o: { count?: number; target?: number } = {}): Challenge[] {
  const items = (Array.isArray(plan) ? plan : (plan as StudyPlan).items)
    .filter((one) => !one.dismissed)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, o.count ?? 2))
  const period = periodOf('day', now, rules)
  const target = Math.max(1, o.target ?? 2)
  return items.map((item) => ({
    id: `coach:${period.key}:${item.id}`,
    label: planTitle(item),
    why: 'This is on your study plan.',
    goal: makeGoal({
      id: `coach:${period.key}:${item.id}`,
      label: planTitle(item),
      period: 'day',
      target,
      measure: { kind: 'attempts', activities: [item.activity] }
    }),
    period,
    from: 'coach',
    planItemId: item.id
  }))
}

export interface ChallengeStanding {
  challenge: Challenge
  standing: GoalStanding
}

export function challengeStandings(challenges: readonly Challenge[], events: readonly ActivityEvent[], now: number, rules: DayRules = DEFAULT_DAY_RULES): ChallengeStanding[] {
  return challenges.map((challenge) => ({ challenge, standing: goalStanding(challenge.goal, events, now, rules, challenge.period) }))
}

// ---------------------------------------------------------------- achievements

export interface AchievementView {
  /** Deduplicated, with nothing timed later than `now`. */
  events: readonly ActivityEvent[]
  now: number
  rules: DayRules
}

export function achievementView(events: readonly ActivityEvent[], now: number, rules: DayRules = DEFAULT_DAY_RULES): AchievementView {
  return { events: mergeEvents(events).filter((one) => one.at <= now), now, rules }
}

export interface Achievement {
  id: string
  label: string
  /** The condition in words, saying exactly what is counted. Nothing is awarded for anything vaguer than this. */
  condition: string
  check: (view: AchievementView) => { done: number; target: number }
}

const worked = (view: AchievementView, activities: readonly ActivityKind[]): ActivityEvent[] =>
  view.events.filter((one) => one.worked && activities.includes(one.activity))

/**
 * The achievements, each with the condition it is checked by.
 *
 * Every one of them is a count over recorded sittings. There is no achievement for being good at chess, because
 * nothing here can establish that, and there is none for a thing Chess World cannot record.
 */
export const ACHIEVEMENTS: readonly Achievement[] = Object.freeze([
  {
    id: 'first-game',
    label: 'First game on the board',
    condition: 'One game saved with at least one move played in it.',
    check: (view) => ({ done: Math.min(1, worked(view, ['play']).length), target: 1 })
  },
  {
    id: 'ten-games',
    label: 'Ten games played',
    condition: 'Ten saved games with at least one move played in each.',
    check: (view) => ({ done: worked(view, ['play']).length, target: 10 })
  },
  {
    id: 'ten-analysed',
    label: 'Ten games gone through',
    condition: 'The engine has been through ten of your games, each with moves in it.',
    check: (view) => ({ done: worked(view, ['analyse-game']).length, target: 10 })
  },
  {
    id: 'hundred-attempts',
    label: 'A hundred attempts',
    condition: 'A hundred training sittings where you played or answered something. Attempts, not solves.',
    check: (view) => ({ done: worked(view, TRAINING).length, target: 100 })
  },
  {
    id: 'fifty-clean',
    label: 'Fifty clean solves',
    condition: 'Fifty training sittings that came out right with no hint taken and no wrong move.',
    check: (view) => ({ done: worked(view, TRAINING).filter((one) => one.clean === true).length, target: 50 })
  },
  {
    id: 'twenty-different',
    label: 'Twenty different exercises',
    condition: 'Twenty distinct exercises worked on, counted once each however many times they came back.',
    check: (view) => ({ done: new Set(worked(view, TRAINING).map((one) => `${one.activity}:${one.thing}`)).size, target: 20 })
  },
  {
    id: 'every-kind',
    label: 'Every kind of practice',
    condition: 'At least one sitting at each of the six kinds of training.',
    check: (view) => ({ done: new Set(worked(view, TRAINING).map((one) => one.activity)).size, target: TRAINING.length })
  },
  {
    id: 'five-openings-whole',
    label: 'Five opening lines by heart',
    condition: 'Five different opening lines played back from memory whole, at least once each.',
    check: (view) => ({
      done: new Set(worked(view, ['opening-drill']).filter((one) => one.succeeded === true).map((one) => one.thing)).size,
      target: 5
    })
  },
  {
    id: 'week-of-practice',
    label: 'A week of practice',
    condition: `Seven days in a row meeting "${DAILY_PRACTICE.label}": ${DAILY_PRACTICE.rule}`,
    check: (view) => ({ done: streakOf(DAILY_PRACTICE, view.events, view.now, view.rules).longest, target: 7 })
  },
  {
    id: 'month-of-practice',
    label: 'Thirty days of practice',
    condition: `Thirty days in a row meeting "${DAILY_PRACTICE.label}": ${DAILY_PRACTICE.rule}`,
    check: (view) => ({ done: streakOf(DAILY_PRACTICE, view.events, view.now, view.rules).longest, target: 30 })
  }
])

export interface AchievementStanding {
  achievement: Achievement
  met: boolean
  done: number
  target: number
  says: string
}

export function achievementStandings(view: AchievementView): AchievementStanding[] {
  return ACHIEVEMENTS.map((achievement) => {
    const { done, target } = achievement.check(view)
    const met = done >= target
    return {
      achievement,
      met,
      done: Math.min(done, target),
      target,
      says: met ? `Done. ${achievement.condition}` : `${Math.min(done, target)} of ${target}. ${achievement.condition}`
    }
  })
}

// ---------------------------------------------------------------- gamification, and switching it off

export const GAMIFICATION_OFF_MEANS: readonly string[] = Object.freeze([
  'Goals, challenges, streaks and achievements are not shown and not worked out.',
  'Nothing is lost. None of it is stored -- it is all counted from what you did each time it is shown -- so turning it back on shows the numbers it would have shown anyway.',
  'Weaknesses, the study plan and the progress measures are untouched. They are not part of this.'
])

export interface ChallengeBoard {
  on: boolean
  today: Period
  thisWeek: Period
  daily: readonly ChallengeStanding[]
  weekly: readonly ChallengeStanding[]
  fromPlan: readonly ChallengeStanding[]
  /** The two standing goals. */
  goals: readonly GoalStanding[]
  streak: Streak | null
  achievements: readonly AchievementStanding[]
  dayRules: readonly string[]
  streakRules: readonly string[]
  offMeans: readonly string[]
  says: string
}

/**
 * The whole board, or nothing at all.
 *
 * With `on: false` nothing is computed: the lists come back empty, the streak comes back null, and `says` explains
 * what that means. Everything else in the coach -- weaknesses, the plan, the progress measures -- is computed
 * elsewhere and does not see this flag, which is what "switches off without breaking anything else" has to mean.
 */
export function challengeBoard(o: {
  events: readonly ActivityEvent[]
  now: number
  rules?: DayRules
  on?: boolean
  plan?: StudyPlan | readonly PlanItem[]
  streakGoal?: Goal
  goals?: readonly Goal[]
  dailyCount?: number
  weeklyCount?: number
}): ChallengeBoard {
  const rules = o.rules ?? DEFAULT_DAY_RULES
  const today = periodOf('day', o.now, rules)
  const thisWeek = periodOf('week', o.now, rules)
  if (o.on === false) {
    return {
      on: false,
      today,
      thisWeek,
      daily: [],
      weekly: [],
      fromPlan: [],
      goals: [],
      streak: null,
      achievements: [],
      dayRules: DAY_BOUNDARY_RULES,
      streakRules: STREAK_RULES,
      offMeans: GAMIFICATION_OFF_MEANS,
      says: 'Goals and challenges are switched off. Nothing is being counted for them, and nothing has been lost: turn them back on and they are worked out again from what you did.'
    }
  }
  const events = o.events
  const daily = challengeStandings(dailyChallenges(o.now, rules, { count: o.dailyCount }), events, o.now, rules)
  const weekly = challengeStandings(weeklyChallenges(o.now, rules, { count: o.weeklyCount }), events, o.now, rules)
  const fromPlan = o.plan ? challengeStandings(coachChallenges(o.plan, o.now, rules), events, o.now, rules) : []
  const goals = (o.goals ?? [DAILY_PRACTICE, WEEKLY_PRACTICE]).map((goal) => goalStanding(goal, events, o.now, rules))
  const streak = streakOf(o.streakGoal ?? DAILY_PRACTICE, events, o.now, rules)
  const achievements = achievementStandings(achievementView(events, o.now, rules))
  const forToday = [...daily, ...fromPlan]
  const doneToday = forToday.filter((one) => one.standing.complete).length
  return {
    on: true,
    today,
    thisWeek,
    daily,
    weekly,
    fromPlan,
    goals,
    streak,
    achievements,
    dayRules: DAY_BOUNDARY_RULES,
    streakRules: STREAK_RULES,
    offMeans: GAMIFICATION_OFF_MEANS,
    // The streak says its own sentence beside the run; repeating it here would print it twice on one screen.
    says: events.length === 0
      ? 'Nothing has been recorded yet, so every one of these is at nought. They fill in from what you do.'
      : `${doneToday} of the ${forToday.length} ${forToday.length === 1 ? 'challenge' : 'challenges'} for today done.`
  }
}
