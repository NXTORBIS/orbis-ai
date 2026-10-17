import type { GameId } from '../offlineGames.ts'
import { GAMES, gameInfo } from '../offlineGames.ts'
import { DEFAULT_DAY_RULES, dayBack, dayOf, hashKey, type Day, type DayRules } from './calendar.ts'
import { creditable, isLate, type ArcadeRecord, type PlayRecord } from './record.ts'

/**
 * The day's challenge: the same one all day, on this machine, worked out from the date and nothing else.
 *
 * ## No clock is read in this file
 *
 * `now` comes in as an argument everywhere, as it does in `src/shared/chess/challenges.ts`, for two reasons. A test
 * can then drive a day boundary and a clock set backwards, which is the only way to know the rules hold. And nothing
 * here can award anything by reading the clock at a convenient moment.
 *
 * ## The same challenge all day, even as you play it
 *
 * Which challenge a day gets comes from a written-out hash of the day's key and this machine's salt, so it is the same
 * every time the screen is opened, different tomorrow, and different on another machine.
 *
 * One of the templates -- "beat your own best" -- can only be offered for a game you already have a record in. If
 * that were worked out from the record as it stands *now*, setting a first record at nine in the morning would change
 * the day's challenge at nine in the morning. So the eligible games are worked out from the runs that were already
 * written down **before the day began**, a set nothing you do today can alter.
 *
 * ## Seeds, and not claiming one that nothing reads
 *
 * A game whose layout comes from a seed can be handed the day's seed and then plays the same board all day. The window
 * passes it as `data-game-seed` on the stage, and a game reads it with `ctx.root.dataset.gameSeed`.
 *
 * `SEEDABLE` is the list of games that really read it. A game not on the list still gets the day's challenge -- the
 * target is the same for everyone on this machine today -- but the challenge says plainly that the layout is fresh
 * each run rather than pretending to a fixed board. `daily.test.ts` reads the game modules off disk and fails if a
 * game is listed here and its module never reads the seed, because that claim is the one thing here a player could
 * not check for themselves.
 */

// ---------------------------------------------------------------- seeds

/** The day's seed for one game: the same all day on this machine, different tomorrow, different elsewhere. */
export function dailySeed(dayKey: string, installId: string, gameId: GameId): number {
  return hashKey(`${dayKey}|${installId}|${gameId}`) || 1
}

/**
 * The games that read the day's seed, so their board is the same all day.
 *
 * A game belongs here only once its module reads `ctx.root.dataset.gameSeed` and uses it for every random choice it
 * makes. The test beside this file checks exactly that.
 */
export const SEEDABLE: readonly GameId[] = Object.freeze(['memory-match', 'number-puzzle', 'snake', 'typing-challenge', 'reaction-test'])

export const takesSeed = (gameId: GameId): boolean => SEEDABLE.includes(gameId)

// ---------------------------------------------------------------- what a challenge asks for

export type Measure =
  /** Runs of one game you finished. */
  | { kind: 'finish'; gameId: GameId; count: number }
  /** Runs of one game you finished with the difficulty set to hard. */
  | { kind: 'finish-hard'; gameId: GameId; count: number }
  /** A run of one game that beat your own record, as the score store measured it. */
  | { kind: 'beat-best'; gameId: GameId }
  /** Different games you finished a run of. */
  | { kind: 'different-games'; count: number }

export const targetOf = (measure: Measure): number => (measure.kind === 'beat-best' ? 1 : measure.count)

export const gameOf = (measure: Measure): GameId | null => (measure.kind === 'different-games' ? null : measure.gameId)

/** What a measure counts, in words. One source for the screen and for the rule written on the challenge. */
export function describeMeasure(measure: Measure): string {
  switch (measure.kind) {
    case 'finish':
      return `runs of ${gameInfo(measure.gameId).name} you finished`
    case 'finish-hard':
      return `runs of ${gameInfo(measure.gameId).name} you finished with the difficulty set to hard`
    case 'beat-best':
      return `a run of ${gameInfo(measure.gameId).name} that beat your own best`
    case 'different-games':
      return 'different games you finished a run of'
  }
}

export function ruleFor(measure: Measure): string {
  return `${targetOf(measure)} ${describeMeasure(measure)}, inside one day. `
    + 'A run counts on the day it was played and only if it finished. A run written down after that day still counts in your totals, and cannot count towards this.'
}

function countFor(measure: Measure, plays: readonly PlayRecord[]): number {
  switch (measure.kind) {
    case 'finish':
      return plays.filter((one) => one.gameId === measure.gameId).length
    case 'finish-hard':
      return plays.filter((one) => one.gameId === measure.gameId && one.difficulty === 'hard').length
    case 'beat-best':
      return plays.filter((one) => one.gameId === measure.gameId && one.newBest === true).length
    case 'different-games':
      return new Set(plays.map((one) => one.gameId)).size
  }
}

// ---------------------------------------------------------------- the templates

type Pool = 'any' | 'with-best' | 'none'

interface Template {
  id: string
  pool: Pool
  why: string
  label(name: string): string
  measure(gameId: GameId): Measure
}

/*
 * Written as an annotated array and frozen after, rather than frozen in place.
 *
 * `Object.freeze` over a literal full of methods loses the contextual type, and every `name` and `gameId` below
 * silently becomes `any` -- which is how a template could end up handed the wrong thing and nothing would say so.
 */
const TEMPLATE_LIST: Template[] = [
  {
    id: 'finish-one',
    pool: 'any',
    why: 'Short and specific. Any finished run counts, however badly it went.',
    label: (name) => `Finish a run of ${name}`,
    measure: (gameId) => ({ kind: 'finish', gameId, count: 1 })
  },
  {
    id: 'finish-two',
    pool: 'any',
    why: 'Twice. The second run is the one where you know what the game is doing.',
    label: (name) => `Finish two runs of ${name}`,
    measure: (gameId) => ({ kind: 'finish', gameId, count: 2 })
  },
  {
    id: 'finish-three',
    pool: 'any',
    why: 'Three runs of one game is a sitting rather than a look.',
    label: (name) => `Finish three runs of ${name}`,
    measure: (gameId) => ({ kind: 'finish', gameId, count: 3 })
  },
  {
    id: 'beat-best',
    pool: 'with-best',
    why: 'Only offered for a game you already have a record in, because otherwise there is nothing to beat.',
    label: (name) => `Beat your own best at ${name}`,
    measure: (gameId) => ({ kind: 'beat-best', gameId })
  },
  {
    id: 'on-hard',
    pool: 'any',
    why: 'Hard changes how the game is played, not one number in it. Set the difficulty in the game settings first.',
    label: (name) => `Finish a run of ${name} on hard`,
    measure: (gameId) => ({ kind: 'finish-hard', gameId, count: 1 })
  },
  {
    id: 'three-games',
    pool: 'none',
    why: 'Three different games, not one game three times.',
    label: () => 'Finish a run in three different games',
    measure: () => ({ kind: 'different-games', count: 3 })
  }
]

const TEMPLATES: readonly Template[] = Object.freeze(TEMPLATE_LIST)

export const TEMPLATE_IDS: readonly string[] = Object.freeze(TEMPLATES.map((one) => one.id))

/**
 * What the record said before the day began.
 *
 * Only runs that were both played and written down before the day started, so nothing done today can change which
 * challenge today has.
 */
export function factsBeforeDay(record: ArcadeRecord, day: Day): { withBest: GameId[] } {
  const earlier = record.plays.filter((one) => one.at < day.from && (one.recordedAt ?? one.at) < day.from && one.finished)
  // Runs that were added up are only "from before today" when the roll-up itself ended before today did begin.
  // Somebody who plays four hundred times in one day would otherwise roll today's own runs into it, and the day's
  // challenge would change under them at the moment they set a record.
  const rolled = (record.before && record.before.upTo < day.from ? Object.entries(record.before.games) : []) as [GameId, { best: number | null }][]
  const withBest = new Set<GameId>(rolled.filter(([, summary]) => summary.best !== null).map(([id]) => id))
  for (const one of earlier) withBest.add(one.gameId)
  return { withBest: [...withBest].sort() }
}

// ---------------------------------------------------------------- the challenge

export interface DailyChallenge {
  id: string
  label: string
  why: string
  day: Day
  measure: Measure
  target: number
  /** Exactly how it is counted, in words. Written from the measure, so the words and the arithmetic cannot drift. */
  rule: string
  gameId: GameId | null
  /** The seed to hand the game, when the game reads one. */
  seed: number | null
  /** True when the game plays the same board all day from that seed. */
  fixedLayout: boolean
  says: string
}

const ALL_IDS: readonly GameId[] = Object.freeze(GAMES.map((one) => one.id))

function pickGame(pool: Pool, key: string, facts: { withBest: GameId[] }): GameId | null | undefined {
  if (pool === 'none') return null
  const list = pool === 'any' ? ALL_IDS : facts.withBest
  // Undefined means "this template cannot be offered today", which is different from "it needs no game".
  if (!list.length) return undefined
  return list[hashKey(key) % list.length]
}

function challengeOf(template: Template, gameId: GameId | null, day: Day, installId: string): DailyChallenge {
  const measure = template.measure(gameId ?? ALL_IDS[0])
  const target = targetOf(measure)
  const seed = gameId && takesSeed(gameId) ? dailySeed(day.key, installId, gameId) : null
  return {
    id: `daily:${day.key}:${template.id}${gameId ? `:${gameId}` : ''}`,
    label: template.label(gameId ? gameInfo(gameId).name : ''),
    why: template.why,
    day,
    measure,
    target,
    rule: ruleFor(measure),
    gameId,
    seed,
    fixedLayout: seed !== null,
    says: seed !== null
      ? 'The same board all day: this game takes the day\'s seed, so leaving it and coming back gives you the run you had.'
      : gameId
        ? 'The target is the same all day. This game lays itself out fresh each run.'
        : 'The target is the same all day.'
  }
}

/**
 * The day's challenges.
 *
 * The same ones every time the screen is opened, because they come from the day's key and this machine's salt. A
 * template that cannot be offered today is skipped and the next one in the rotation takes its place, so the list is
 * never short and never asks for something that does not exist.
 */
export function dailyChallenges(o: { record: ArcadeRecord; now: number; rules?: DayRules; count?: number }): DailyChallenge[] {
  const rules = o.rules ?? DEFAULT_DAY_RULES
  const day = dayOf(o.now, rules)
  return challengesForDay(o.record, day, { installId: o.record.installId, count: o.count ?? 1 })
}

/** The same working out for any day, which is what makes an old day's challenge replayable. */
export function challengesForDay(record: ArcadeRecord, day: Day, o: { installId: string; count?: number }): DailyChallenge[] {
  const facts = factsBeforeDay(record, day)
  const start = hashKey(`${day.key}|${o.installId}`) % TEMPLATES.length
  const out: DailyChallenge[] = []
  const want = Math.max(0, Math.min(o.count ?? 1, TEMPLATES.length))
  for (let step = 0; step < TEMPLATES.length && out.length < want; step++) {
    const template = TEMPLATES[(start + step) % TEMPLATES.length]
    const gameId = pickGame(template.pool, `${day.key}|${o.installId}|${template.id}`, facts)
    if (gameId === undefined) continue
    out.push(challengeOf(template, gameId, day, o.installId))
  }
  return out
}

/** The last `days` days' challenges, newest first, for replaying one. Today is included. */
export function recentDailies(o: { record: ArcadeRecord; now: number; rules?: DayRules; days?: number; count?: number }): DailyChallenge[][] {
  const rules = o.rules ?? DEFAULT_DAY_RULES
  const back = Math.max(1, Math.min(60, o.days ?? 7))
  const out: DailyChallenge[][] = []
  for (let n = 0; n < back; n++) {
    out.push(challengesForDay(o.record, dayBack(o.now, n, rules), { installId: o.record.installId, count: o.count ?? 1 }))
  }
  return out
}

/**
 * Five games in a set order, picked by the day's seed.
 *
 * Distinct, because a round that offers the same game twice is a shorter round that does not say so. The walk takes a
 * stride through the library and steps past anything already taken, so the five are always five.
 */
export function mixedRound(day: Day, installId: string, size = 5): GameId[] {
  const n = ALL_IDS.length
  const want = Math.max(1, Math.min(size, n))
  const stride = 1 + (hashKey(`stride|${day.key}|${installId}`) % Math.max(1, n - 1))
  const taken = new Set<number>()
  const out: GameId[] = []
  let at = hashKey(`mixed|${day.key}|${installId}`) % n
  while (out.length < want) {
    while (taken.has(at)) at = (at + 1) % n
    taken.add(at)
    out.push(ALL_IDS[at])
    at = (at + stride) % n
  }
  return out
}

// ---------------------------------------------------------------- how it stands

export interface Ignored {
  /** Timed later than now. */
  future: number
  /** The run was left rather than finished. */
  unfinished: number
  /** Played on another day. */
  otherDay: number
  /** Another game, or a game this challenge is not about. */
  otherGame: number
  /** Written down on a later day than the one it claims. */
  lateRecord: number
}

export interface ChallengeStanding {
  challenge: DailyChallenge
  done: number
  target: number
  complete: boolean
  /** 0..1, capped so going past the target does not draw past the end. */
  fraction: number
  /** Runs that counted. */
  counted: number
  ignored: Ignored
  says: string
}

/**
 * How a challenge stands.
 *
 * The runs set aside are reported rather than thrown away, because "I played that four times and it says nought" is
 * the kind of disagreement a person has to be able to see the reason for.
 */
export function challengeStanding(challenge: DailyChallenge, record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES): ChallengeStanding {
  const ignored: Ignored = { future: 0, unfinished: 0, otherDay: 0, otherGame: 0, lateRecord: 0 }
  const wanted = gameOf(challenge.measure)
  const counting: PlayRecord[] = []
  for (const one of record.plays) {
    if (one.at > now) { ignored.future += 1; continue }
    if (one.at < challenge.day.from || one.at >= challenge.day.to) { ignored.otherDay += 1; continue }
    if (!one.finished) { ignored.unfinished += 1; continue }
    if (isLate(one, rules)) { ignored.lateRecord += 1; continue }
    if (wanted && one.gameId !== wanted) { ignored.otherGame += 1; continue }
    counting.push(one)
  }
  const done = countFor(challenge.measure, counting)
  const complete = done >= challenge.target
  return {
    challenge,
    done,
    target: challenge.target,
    complete,
    fraction: challenge.target > 0 ? Math.min(1, done / challenge.target) : 0,
    counted: counting.length,
    ignored,
    says: complete
      ? `Done: ${done} of ${challenge.target} ${describeMeasure(challenge.measure)}.`
      : `${done} of ${challenge.target} ${describeMeasure(challenge.measure)} on ${challenge.day.label}.`
        + (ignored.unfinished > 0 ? ` ${ignored.unfinished} ${ignored.unfinished === 1 ? 'run was' : 'runs were'} left before the end and ${ignored.unfinished === 1 ? 'is' : 'are'} not counted.` : '')
        + (ignored.lateRecord > 0 ? ` ${ignored.lateRecord} ${ignored.lateRecord === 1 ? 'run was' : 'runs were'} written down after that day, so ${ignored.lateRecord === 1 ? 'it cannot' : 'they cannot'} count towards it.` : '')
  }
}

export const challengeStandings = (challenges: readonly DailyChallenge[], record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES): ChallengeStanding[] =>
  challenges.map((one) => challengeStanding(one, record, now, rules))

/**
 * Whether this run is the one that completes the challenge.
 *
 * The window asks before writing the run down, so the bonus is written on the run that earned it. It is deliberately
 * a comparison of before and after: a run played after the challenge was already done earns nothing more, which is
 * what "once for each challenge" has to mean.
 */
export function completesChallenge(challenge: DailyChallenge, record: ArcadeRecord, play: PlayRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES): boolean {
  if (challengeStanding(challenge, record, now, rules).complete) return false
  const after: ArcadeRecord = { ...record, plays: [play, ...record.plays] }
  return challengeStanding(challenge, after, now, rules).complete
}

/** Day challenges completed on a day, from the record alone. Used by the streak and the unlocks. */
export function challengesDoneOn(record: ArcadeRecord, day: Day, now: number, rules: DayRules = DEFAULT_DAY_RULES, count = 1): number {
  const challenges = challengesForDay(record, day, { installId: record.installId, count })
  return challengeStandings(challenges, record, now, rules).filter((one) => one.complete).length
}

/** Runs played on a day that may credit it: finished, not timed in the future, not written down afterwards. */
export const playsOn = (record: ArcadeRecord, day: Day, now: number, rules: DayRules = DEFAULT_DAY_RULES): PlayRecord[] =>
  creditable(record.plays, now, rules).filter((one) => one.at >= day.from && one.at < day.to)
