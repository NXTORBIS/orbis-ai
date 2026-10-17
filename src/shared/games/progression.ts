import type { GameId } from '../offlineGames.ts'
import { gameInfo } from '../offlineGames.ts'
import { POINT_RULES, type ArcadeRecord, type GameSummary, summaryFor, totalsOf } from './record.ts'

/**
 * What playing earns you: one level across the whole arcade, and a standing in each game on its own.
 *
 * ## The rule is shown, always
 *
 * Orbis never shows a number whose meaning is private, and a level is the easiest number in the world to make
 * meaningless. So the ladder is arithmetic anybody can check -- every level costs 50 points more than the one before --
 * `LEVEL_RULE` is that sentence, and `POINT_RULES` next to it says where the points came from. A screen showing the
 * level without the rule is showing half of it.
 *
 * ## Two different things, kept apart
 *
 * The **level** is the whole arcade added up, and it only ever goes up. **Mastery** is one game at a time, and it is
 * not a score: it is a short list of counted conditions, each of which you can read, with exactly what is left to do
 * next. There is no mastery figure for a game you have never played -- not nought per cent, not tier zero. "Never
 * played" and "played badly" are different facts and the screen says which one it has.
 */

// ---------------------------------------------------------------- the level

/** Points a level costs over the one before it. Level 2 costs 50, level 3 costs 100, and so on. */
export const STEP = 50

export const LEVEL_RULE =
  `Every level costs ${STEP} points more than the one before: ${STEP} points for level 2, ${STEP * 2} for level 3, ${STEP * 3} for level 4. `
  + 'There is no top level. Points come from runs you finished, by the rules beside this.'

/** The points needed to have reached a level. Level 1 is where everybody starts, at nothing. */
export function pointsForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level))
  return (STEP / 2) * n * (n - 1)
}

/** The level a total of points has reached. */
export function levelAt(points: number): number {
  const clean = Math.max(0, Math.floor(points))
  // From the closed form, then stepped to the answer so rounding can never put the level one past what was earned.
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * clean) / STEP)) / 2))
  while (pointsForLevel(level + 1) <= clean) level += 1
  while (level > 1 && pointsForLevel(level) > clean) level -= 1
  return level
}

export interface Rank {
  /** The level this rank begins at. */
  from: number
  name: string
}

/** Plain names for stretches of the ladder. Nothing is unlocked by a rank; it is a word for where you are. */
export const RANKS: readonly Rank[] = Object.freeze([
  { from: 1, name: 'New here' },
  { from: 2, name: 'Getting the hang of it' },
  { from: 4, name: 'Regular' },
  { from: 7, name: 'Old hand' },
  { from: 11, name: 'Sharp' },
  { from: 16, name: 'Arcade master' }
])

export const rankAt = (level: number): Rank => [...RANKS].reverse().find((one) => level >= one.from) ?? RANKS[0]

export interface LevelStanding {
  points: number
  level: number
  rank: Rank
  /** Points earned inside this level. */
  into: number
  /** Points this level costs in all. */
  costs: number
  /** Points left to the next level. */
  left: number
  /** 0..1, for a bar. */
  fraction: number
  /** The next rank and the level it starts at, or null at the top of the named ranks. */
  nextRank: Rank | null
  rule: string
  pointRules: readonly string[]
  says: string
}

export function levelStanding(points: number): LevelStanding {
  const clean = Math.max(0, Math.floor(points))
  const level = levelAt(clean)
  const floor = pointsForLevel(level)
  const ceiling = pointsForLevel(level + 1)
  const costs = ceiling - floor
  const into = clean - floor
  return {
    points: clean,
    level,
    rank: rankAt(level),
    into,
    costs,
    left: ceiling - clean,
    fraction: costs > 0 ? Math.min(1, into / costs) : 0,
    nextRank: RANKS.find((one) => one.from > level) ?? null,
    rule: LEVEL_RULE,
    pointRules: POINT_RULES,
    says: clean === 0
      ? 'Nothing earned yet. Finish a run and the first points land.'
      : `Level ${level}, ${rankAt(level).name}. ${into} of ${costs} points into this level, ${ceiling - clean} to go.`
  }
}

// ---------------------------------------------------------------- one game at a time

export interface Requirement {
  label: string
  done: number
  target: number
}

export interface Tier {
  tier: number
  label: string
  /** What it asks for, counted. The same list is used to check it and to say what is left. */
  needs(summary: GameSummary): Requirement[]
}

/**
 * The standing in one game, as counted conditions.
 *
 * Every one of them counts something the arcade really wrote down: finished runs, runs that beat your own record at
 * the time, and finished runs on hard. There is no tier for being good at a game, because nothing here can establish
 * that -- a high score in a game nobody else has played is not a measurement of skill.
 */
export const TIERS: readonly Tier[] = Object.freeze([
  {
    tier: 1,
    label: 'Tried it',
    needs: (s) => [{ label: 'runs finished', done: s.finished, target: 1 }]
  },
  {
    tier: 2,
    label: 'Played in',
    needs: (s) => [{ label: 'runs finished', done: s.finished, target: 5 }]
  },
  {
    tier: 3,
    label: 'Practised',
    needs: (s) => [
      { label: 'runs finished', done: s.finished, target: 15 },
      { label: 'times you beat your own best', done: s.bests, target: 2 }
    ]
  },
  {
    tier: 4,
    label: 'Good at it',
    needs: (s) => [
      { label: 'runs finished', done: s.finished, target: 30 },
      { label: 'times you beat your own best', done: s.bests, target: 3 },
      { label: 'runs finished on hard', done: s.hardFinished, target: 1 }
    ]
  },
  {
    tier: 5,
    label: 'Know it inside out',
    needs: (s) => [
      { label: 'runs finished', done: s.finished, target: 60 },
      { label: 'times you beat your own best', done: s.bests, target: 5 },
      { label: 'runs finished on hard', done: s.hardFinished, target: 5 }
    ]
  }
])

const met = (needs: Requirement[]): boolean => needs.every((one) => one.done >= one.target)

const conditionOf = (needs: Requirement[]): string => needs.map((one) => `${one.target} ${one.label}`).join(', ')

export interface Mastery {
  gameId: GameId
  summary: GameSummary
  tier: number
  label: string
  /** The conditions of the tier reached, in words. */
  condition: string
  /** The next tier and what is still missing, or null at the top. */
  next: { tier: number; label: string; needs: Requirement[]; condition: string } | null
  says: string
}

/**
 * How a game stands, or null when it has never been played.
 *
 * Null is the honest answer there: a tier of nought, or a bar at nought per cent, reads as a measurement of somebody
 * who tried and failed.
 */
export function masteryOf(record: ArcadeRecord, gameId: GameId): Mastery | null {
  const summary = summaryFor(record, gameId)
  if (!summary) return null
  let reached = 0
  let condition = 'Played, with no run finished yet.'
  for (const tier of TIERS) {
    const needs = tier.needs(summary)
    if (!met(needs)) break
    reached = tier.tier
    condition = `${tier.label}: ${conditionOf(needs)}.`
  }
  const after = TIERS.find((one) => one.tier === reached + 1)
  const next = after ? { tier: after.tier, label: after.label, needs: after.needs(summary), condition: conditionOf(after.needs(summary)) } : null
  const name = gameInfo(gameId).name
  const label = reached === 0 ? 'Played' : TIERS[reached - 1].label
  return {
    gameId,
    summary,
    tier: reached,
    label,
    condition,
    next,
    says: next
      ? `${name}: ${label}. Next is "${next.label}" -- ${next.needs.filter((one) => one.done < one.target).map((one) => `${one.done} of ${one.target} ${one.label}`).join(', ')}.`
      : `${name}: ${label}. Nothing further to reach.`
  }
}

/** Every game that has been played, best standing first. Games never played are left out rather than shown at nought. */
export function masteryBoard(record: ArcadeRecord): Mastery[] {
  const ids = new Set<GameId>([...record.plays.map((one) => one.gameId), ...(Object.keys(record.before?.games ?? {}) as GameId[])])
  return [...ids]
    .map((id) => masteryOf(record, id))
    .filter((one): one is Mastery => one !== null)
    .sort((a, b) => b.tier - a.tier || b.summary.finished - a.summary.finished || gameInfo(a.gameId).name.localeCompare(gameInfo(b.gameId).name))
}

export interface ProgressionView {
  level: LevelStanding
  mastery: Mastery[]
  /** How many of the games in the library have been finished at least once, and how many there are. */
  explored: { finished: number; played: number; games: number }
  says: string
}

export function progressionView(record: ArcadeRecord, libraryGames: number): ProgressionView {
  const totals = totalsOf(record)
  const level = levelStanding(totals.points)
  return {
    level,
    mastery: masteryBoard(record),
    explored: { finished: totals.gamesFinished, played: totals.gamesPlayed, games: libraryGames },
    says: totals.plays === 0
      ? 'Nothing recorded yet. Every figure here fills in from runs you finish.'
      : `${totals.finished} of ${totals.plays} runs finished, across ${totals.gamesPlayed} ${totals.gamesPlayed === 1 ? 'game' : 'games'} of ${libraryGames}.`
  }
}
