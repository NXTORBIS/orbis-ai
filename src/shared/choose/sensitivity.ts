/**
 * Whether the answer would survive being wrong.
 *
 * A recommendation is only worth as much as its inputs, and the inputs are usually part guess. So nothing here
 * asks whether the leader is right; it asks **how far the inputs would have to move before the leader changed**,
 * and it finds out by actually moving them and running the arithmetic again.
 *
 * That is the honest version of a confidence figure. "I am 83% confident" is a number with nothing behind it.
 * "Reliability would have to matter about half as much as you said before the other one wins" is a sentence
 * somebody can check against what they actually believe.
 *
 * ## Everything here is deterministic
 *
 * The wobble test jitters the importances and counts how often the leader holds. It uses its own small generator
 * with a fixed starting number rather than `Math.random`, for two reasons: the same decision has to give the same
 * answer twice, and a test cannot assert anything about a number that moves.
 */
import { run, weightsFor, type RunOptions } from './engine.ts'
import type { Decision, Known, Result } from './types.ts'

/** How many times to re-run while looking for the point where the answer changes. Twelve lands within 0.0003. */
const HALVINGS = 12

// ---------------------------------------------------------------- importance

export interface Flip {
  /** The criterion whose importance was moved, or the value that was moved. */
  criterionId: string
  /** For an input: which option's value. Absent when it is an importance that was moved. */
  alternativeId?: string
  /** Where it is now: a share of the whole for an importance, the raw figure for an input. */
  from: number
  /** Where it would have to get to before the answer changes. */
  flipsAt: number
  /** Who would lead then. */
  thenLeads: string
  /** Up or down from where it is now. */
  which: 'up' | 'down'
  /**
   * How big a move that is, as a fraction of where it is now. Small means fragile.
   *
   * This is the number the list is ordered by, because a tenth of a change and a tenfold change are not comparable
   * as absolute amounts but are perfectly comparable as proportions.
   */
  move: number
}

/** Importances with one criterion pinned at `share` and the rest keeping their proportions. */
function pinned(decision: Decision, criterionId: string, share: number): Record<string, number> {
  const base = weightsFor(decision.criteria).share
  const mine = base[criterionId] ?? 0
  const rest = 1 - mine
  const out: Record<string, number> = { [criterionId]: share }
  for (const criterion of decision.criteria) {
    if (criterion.id === criterionId) continue
    // Everything else shares out what is left, in the proportions it already had.
    out[criterion.id] = rest <= 0 ? (1 - share) / Math.max(1, decision.criteria.length - 1) : ((base[criterion.id] ?? 0) / rest) * (1 - share)
  }
  return out
}

const leaderAt = (decision: Decision, options: RunOptions): string | null => run(decision, options).leaderId

/**
 * For each criterion: how much more, or less, it would have to matter before somebody else wins.
 *
 * One at a time, with everything else keeping its relative importance -- which is the only version of this question
 * that has a single answer. Moving two at once has a surface of answers, and the useful thing to tell somebody is
 * "reliability alone would have to drop to about a fifth of what you said".
 */
export function importanceFlips(decision: Decision, base: Result): readonly Flip[] {
  if (base.leaderId === null) return []
  const shares = weightsFor(decision.criteria).share
  const out: Flip[] = []

  for (const criterion of decision.criteria) {
    const now = shares[criterion.id] ?? 0

    for (const which of ['up', 'down'] as const) {
      const end = which === 'up' ? 1 : 0
      const atEnd = leaderAt(decision, { weights: pinned(decision, criterion.id, end) })
      // The answer is the same even at the extreme: nothing this criterion alone can do changes it.
      if (atEnd === base.leaderId || atEnd === null) continue

      let stays = now
      let changes = end
      for (let round = 0; round < HALVINGS; round++) {
        const middle = (stays + changes) / 2
        if (leaderAt(decision, { weights: pinned(decision, criterion.id, middle) }) === base.leaderId) stays = middle
        else changes = middle
      }

      out.push({
        criterionId: criterion.id,
        from: now,
        flipsAt: changes,
        thenLeads: atEnd,
        which,
        move: now === 0 ? (changes === 0 ? 0 : 1) : Math.abs(changes - now) / now
      })
    }
  }

  return out.sort((a, b) => a.move - b.move)
}

// ---------------------------------------------------------------- the numbers themselves

/**
 * For each figure in the table: how far it would have to be wrong before the answer changes.
 *
 * Searched between a quarter and four times what is there now, which covers being badly wrong without pretending a
 * price could go negative. A figure that does not flip the answer anywhere in that range is not reported -- the
 * list is of things that matter, and "this would have to be ten times different" is not one of them.
 */
export function valueFlips(decision: Decision, base: Result, o: { only?: readonly string[] } = {}): readonly Flip[] {
  if (base.leaderId === null) return []
  const out: Flip[] = []
  const looking = o.only ? decision.alternatives.filter((one) => o.only?.includes(one.id)) : decision.alternatives

  for (const alternative of looking) {
    for (const criterion of decision.criteria) {
      const held = alternative.values[criterion.id]
      if (!held || held.value === null || !Number.isFinite(held.value)) continue
      const now = held.value

      for (const which of ['up', 'down'] as const) {
        const span = Math.abs(now) === 0 ? 1 : Math.abs(now)
        const end = which === 'up' ? now + span * 3 : now - span * 3
        const at = (value: number): Known => ({ ...held, value, origin: held.origin })
        const atEnd = leaderAt(decision, { values: { [`${alternative.id}/${criterion.id}`]: at(end) } })
        if (atEnd === base.leaderId || atEnd === null) continue

        let stays = now
        let changes = end
        for (let round = 0; round < HALVINGS; round++) {
          const middle = (stays + changes) / 2
          if (leaderAt(decision, { values: { [`${alternative.id}/${criterion.id}`]: at(middle) } }) === base.leaderId) stays = middle
          else changes = middle
        }

        out.push({
          criterionId: criterion.id,
          alternativeId: alternative.id,
          from: now,
          flipsAt: changes,
          thenLeads: atEnd,
          which,
          move: now === 0 ? 1 : Math.abs(changes - now) / Math.abs(now)
        })
      }
    }
  }

  return out.sort((a, b) => a.move - b.move)
}

// ---------------------------------------------------------------- how steady the answer is

export type Steadiness =
  /** The same option wins almost however the importances are nudged. */
  | 'steady'
  /** It usually wins, but a reasonable difference of opinion would change it. */
  | 'somewhat-sensitive'
  /** Small changes flip it. The figures are not what should decide this. */
  | 'very-sensitive'
  /** There was no leader to test. */
  | 'no-clear-winner'

export interface Stability {
  steadiness: Steadiness
  /** Out of how many tries the same option led. */
  held: number
  tries: number
  /** Who else led, and how often. */
  others: readonly { alternativeId: string; times: number }[]
  /** How far each importance was nudged, as a fraction. */
  nudge: number
}

/**
 * The same decision with the importances nudged, many times, counting how often the leader holds.
 *
 * The nudge is a quarter either way by default: about the width of a genuine difference of opinion on how much
 * something matters, rather than a scale that would flip anything.
 *
 * Its generator is a plain multiply-and-wrap one with a fixed start. Not for cryptography and not pretending to be;
 * what is wanted is a spread of nudges that is the same spread every time.
 */
export function stability(decision: Decision, base: Result, o: { tries?: number; nudge?: number } = {}): Stability {
  const tries = Math.max(8, Math.min(400, o.tries ?? 96))
  const nudge = Math.max(0.01, Math.min(0.9, o.nudge ?? 0.25))
  if (base.leaderId === null) return { steadiness: 'no-clear-winner', held: 0, tries: 0, others: [], nudge }

  let seed = 1_013_904_223
  const next = (): number => {
    // Numerical Recipes' constants, which are public domain arithmetic rather than anybody's code.
    seed = (1_664_525 * seed + 1_013_904_223) % 4_294_967_296
    return seed / 4_294_967_296
  }

  const counts = new Map<string, number>()
  let held = 0
  for (let round = 0; round < tries; round++) {
    const weights: Record<string, number> = {}
    for (const criterion of decision.criteria) {
      weights[criterion.id] = Math.max(0, criterion.importance * (1 + (next() * 2 - 1) * nudge))
    }
    const who = run(decision, { weights }).leaderId
    if (who === base.leaderId) held += 1
    else if (who !== null) counts.set(who, (counts.get(who) ?? 0) + 1)
  }

  const share = held / tries
  const steadiness: Steadiness = share >= 0.9 ? 'steady' : share >= 0.65 ? 'somewhat-sensitive' : 'very-sensitive'
  return {
    steadiness,
    held,
    tries,
    others: [...counts.entries()].map(([alternativeId, times]) => ({ alternativeId, times })).sort((a, b) => b.times - a.times),
    nudge
  }
}

// ---------------------------------------------------------------- what to say about it

export interface Fragility {
  stability: Stability
  /** The importances most likely to change the answer, least movement first. */
  importances: readonly Flip[]
  /** The figures most likely to change the answer, least movement first. */
  values: readonly Flip[]
  /** True when only the options in contention had their figures swept, because the table was large. */
  narrowed: boolean
}

/** How many figures may be swept before the sweep is narrowed to the options actually in contention. */
const CELLS_BEFORE_NARROWING = 48

/**
 * Everything the sensitivity run found, in one value. Nothing here is written as a sentence yet.
 *
 * Each figure costs about two dozen runs of the arithmetic to pin down, so a big table costs thousands. Past a few
 * dozen figures the sweep is narrowed to the three options actually in contention, which is where every answer that
 * could change the recommendation lives anyway: moving a figure for the option in fifth place does not promote it
 * past four others, and `narrowed` says so rather than the list quietly being shorter.
 */
export function fragility(decision: Decision, base: Result, o: { tries?: number } = {}): Fragility {
  const cells = decision.alternatives.length * decision.criteria.length
  const narrowed = cells > CELLS_BEFORE_NARROWING
  const contenders = [...base.scored]
    .filter((one) => one.feasible === 'meets' || one.feasible === 'conditional')
    .sort((a, b) => a.place - b.place)
    .slice(0, 3)
    .map((one) => one.alternativeId)

  return {
    stability: stability(decision, base, o),
    importances: importanceFlips(decision, base).slice(0, 6),
    values: valueFlips(decision, base, narrowed ? { only: contenders } : {}).slice(0, 6),
    narrowed
  }
}

/**
 * Which single thing is most worth getting right.
 *
 * Taken from the two lists above rather than asserted: whatever needs the smallest proportional change to overturn
 * the answer is the thing the answer rests on. Null when nothing inside the tested range changes it, which is a
 * real and useful answer -- it means the recommendation does not hang on any one figure.
 */
export function mattersMost(found: Fragility): Flip | null {
  const all = [...found.importances, ...found.values]
  if (all.length === 0) return null
  return all.reduce((best, one) => (one.move < best.move ? one : best))
}
