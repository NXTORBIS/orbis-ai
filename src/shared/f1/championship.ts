/**
 * Championship rules by season, and what can still happen under them.
 *
 * The rules are versioned by season because they changed: the points scale, the extra point for the fastest lap
 * (2019 to 2024), and sprint races with their own points (2021 onward). Calculating with today's table over an old
 * season would give wrong answers, so a season with no recorded rule set is refused rather than approximated.
 */

export interface RuleSet {
  /** First season these rules apply to, inclusive. */
  from: number
  /** Last season, inclusive; null while still in force. */
  to: number | null
  /** Points for a race by finishing position, index 0 = first. */
  race: number[]
  /** Points for a sprint by finishing position; empty when the season had no sprints. */
  sprint: number[]
  /** Whether the fastest lap carried a point (only for a driver finishing in the top ten). */
  fastestLapPoint: boolean
  note: string
}

export const RULESETS: RuleSet[] = [
  { from: 2010, to: 2018, race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprint: [], fastestLapPoint: false, note: 'Top ten score. No sprint races.' },
  { from: 2019, to: 2020, race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprint: [], fastestLapPoint: true, note: 'One extra point for the fastest lap if in the top ten.' },
  { from: 2021, to: 2021, race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprint: [3, 2, 1], fastestLapPoint: true, note: 'Sprint points 3-2-1; fastest-lap point.' },
  { from: 2022, to: 2024, race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprint: [8, 7, 6, 5, 4, 3, 2, 1], fastestLapPoint: true, note: 'Sprint points to eighth; fastest-lap point.' },
  { from: 2025, to: null, race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprint: [8, 7, 6, 5, 4, 3, 2, 1], fastestLapPoint: false, note: 'The fastest-lap point was removed from 2025.' }
]

export function rulesFor(season: number): RuleSet | null {
  return RULESETS.find((r) => season >= r.from && (r.to === null || season <= r.to)) ?? null
}

/** The most one round can give a driver: a win, plus a sprint win if the weekend has one, plus the fastest-lap point. */
export function maxPerRound(rules: RuleSet, hasSprint: boolean): number {
  return rules.race[0] + (hasSprint ? (rules.sprint[0] ?? 0) : 0) + (rules.fastestLapPoint ? 1 : 0)
}

export interface Contender {
  id: string
  name: string
  points: number
  wins: number
  /** Count of finishes in each place so far (index 0 = wins), for the official tie-break. */
  finishes: number[]
}

export interface RemainingRound {
  round: number
  name: string
  hasSprint: boolean
}

export type Possibility = 'champion' | 'possible' | 'only-on-tiebreak' | 'out'

/**
 * Can this contender still finish first, ignoring what the others do? That is the question "mathematically alive" asks:
 * their points plus everything left, against the leader's points as they stand.
 *
 *  - 'champion': already ahead of what anyone else could reach;
 *  - 'possible': could pass the leader on points alone;
 *  - 'only-on-tiebreak': could only level the leader, so it would come down to wins and then results;
 *  - 'out': cannot reach the leader's present total.
 *
 * The leader's own future points are not counted against anyone here, which is what makes "out" certain.
 */
export function possibility(me: Contender, all: Contender[], remaining: RemainingRound[], rules: RuleSet): Possibility {
  const maxLeft = remaining.reduce((t, r) => t + maxPerRound(rules, r.hasSprint), 0)
  const others = all.filter((c) => c.id !== me.id)
  const bestOther = others.reduce((m, c) => Math.max(m, c.points), -Infinity)
  if (me.points > bestOther + maxLeft) return 'champion'
  const reach = me.points + maxLeft
  if (reach > bestOther) return 'possible'
  if (reach === bestOther) return 'only-on-tiebreak'
  return 'out'
}

export interface ScenarioResult {
  rows: { id: string; name: string; points: number; wins: number; position: number; tied: boolean }[]
  /** Contenders whose points were left level and could not be separated with the data held. */
  unresolvedTies: string[][]
}

export interface ScenarioRound {
  round: number
  hasSprint: boolean
  /** Finishing position of a contender in the Grand Prix; absent or 0 means the contender scores nothing there. */
  race: Record<string, number>
  sprint: Record<string, number>
  /** Contender who set the fastest lap, when the rules award it. */
  fastestLap?: string
}

/**
 * Adds a set of hypothetical results to the standings as they stand and ranks the outcome. Ties on points are
 * broken the official way (most wins, then most second places, and so on); a tie that those counts do not separate is
 * reported unresolved rather than settled by guessing.
 */
export function applyScenario(base: Contender[], rounds: ScenarioRound[], rules: RuleSet): ScenarioResult {
  const state = base.map((c) => ({ ...c, finishes: c.finishes.slice() }))
  const find = (id: string) => state.find((c) => c.id === id)
  const bump = (c: Contender, place: number): void => {
    while (c.finishes.length < place) c.finishes.push(0)
    c.finishes[place - 1] += 1
  }
  for (const r of rounds) {
    for (const [id, place] of Object.entries(r.race)) {
      const c = find(id)
      if (!c || !Number.isInteger(place) || place < 1) continue
      c.points += rules.race[place - 1] ?? 0
      bump(c, place)
      if (place === 1) c.wins += 1
    }
    if (r.hasSprint) {
      for (const [id, place] of Object.entries(r.sprint)) {
        const c = find(id)
        if (!c || !Number.isInteger(place) || place < 1) continue
        c.points += rules.sprint[place - 1] ?? 0
      }
    }
    if (rules.fastestLapPoint && r.fastestLap) {
      const c = find(r.fastestLap)
      const place = c ? r.race[c.id] : undefined
      // The point only goes to a driver who finished in the top ten.
      if (c && place !== undefined && place >= 1 && place <= 10) c.points += 1
    }
  }
  const cmp = (a: Contender, b: Contender): number => {
    if (b.points !== a.points) return b.points - a.points
    const n = Math.max(a.finishes.length, b.finishes.length)
    for (let i = 0; i < n; i++) {
      const d = (b.finishes[i] ?? 0) - (a.finishes[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  const sorted = state.slice().sort(cmp)
  const rows: ScenarioResult['rows'] = []
  const unresolved: string[][] = []
  sorted.forEach((c, i) => {
    const prev = sorted[i - 1]
    const next = sorted[i + 1]
    const tied = (prev && cmp(prev, c) === 0) || (next && cmp(c, next) === 0) || false
    rows.push({ id: c.id, name: c.name, points: c.points, wins: c.wins, position: i + 1, tied: !!tied })
  })
  let group: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && cmp(sorted[i - 1], sorted[i]) === 0) group.push(sorted[i].id)
    else {
      if (group.length > 1) unresolved.push(group)
      group = [sorted[i].id]
    }
  }
  if (group.length > 1) unresolved.push(group)
  return { rows, unresolvedTies: unresolved }
}

/** Standings from result rows: points, wins and finish counts per contender. */
export function contendersFrom(
  rows: { driverId: string; driverName: string; constructorId: string; constructorName: string; points: number; position: number | null; sprint: boolean; classified: boolean }[],
  by: 'driver' | 'constructor'
): Contender[] {
  const map = new Map<string, Contender>()
  for (const r of rows) {
    const id = by === 'driver' ? r.driverId : r.constructorId
    const c = map.get(id) ?? { id, name: by === 'driver' ? r.driverName : r.constructorName, points: 0, wins: 0, finishes: [] }
    c.points += r.points
    if (!r.sprint && r.position !== null && r.classified) {
      while (c.finishes.length < r.position) c.finishes.push(0)
      c.finishes[r.position - 1] += 1
      if (r.position === 1) c.wins += 1
    }
    map.set(id, c)
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins)
}
