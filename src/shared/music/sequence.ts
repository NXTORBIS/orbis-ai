import type { MusicTuning } from './config.ts'
import { similarity, transitionScore, type TrackFeatures } from './features.ts'
import type { IntentState } from './intent.ts'
import { MODE_SHAPE } from './intent.ts'
import type { Scored } from './ranking.ts'

/**
 * Arranging the next few tracks, rather than picking the next one.
 *
 * The best single track and the best next track are different questions. Four songs that are each the strongest
 * available choice can make a terrible run: the same artist twice, a jump from quiet to loud, the energy sawing up
 * and down. So the sequencer searches over short runs and scores the run, not the song.
 *
 * ## What a good run is
 *
 * It goes where the request asked it to go (up for a workout, down for sleep, level for focus), it joins smoothly
 * unless a jolt was asked for, it does not repeat an artist or a sound too soon, and it puts something familiar in
 * among the new so discovery does not feel like a test.
 *
 * ## Why a beam and not every combination
 *
 * Five from forty is ninety million orderings. A beam keeps the best few partial runs at each step, which is a few
 * hundred evaluations and in practice indistinguishable from the best answer -- and it is bounded, so planning
 * cannot take an unpredictable amount of time while somebody waits for the next track.
 */

/** The shape a run should take. */
export interface Curve {
  /** Where energy should start and end, 0..1. Null means wherever it lands. */
  energyFrom: number | null
  energyTo: number | null
  /** How much energy may move between neighbours. Small means smooth. */
  maxStep: number
  /** How much of the run should be things already known, 0..1. */
  familiarShare: number
  /** Whether a run may repeat an artist at all. */
  artistGap: number
}

/** The curve a request implies. Named modes become actual numbers here. */
export function curveFor(intent: IntentState, tuning: MusicTuning, startingEnergy: number | null): Curve {
  const shape = MODE_SHAPE[intent.intent] ?? {}
  const asked = intent.constraints.energy
  const target = asked?.target ?? shape.energy?.target ?? null
  const direction = asked?.direction ?? shape.energy?.direction
  const smooth = shape.smoothness ?? tuning.transitionCare.value
  const discovery = intent.constraints.discovery ?? tuning.discovery.value
  const familiar = intent.constraints.familiarShare ?? shape.familiarity ?? 1 - discovery

  let from = startingEnergy
  let to = target
  if (direction === 'up') {
    from = startingEnergy ?? (target !== null ? Math.max(0, target - 0.3) : 0.4)
    to = target !== null ? target : Math.min(1, (startingEnergy ?? 0.5) + 0.35)
  } else if (direction === 'down') {
    from = startingEnergy ?? (target !== null ? Math.min(1, target + 0.3) : 0.6)
    to = target !== null ? target : Math.max(0, (startingEnergy ?? 0.5) - 0.35)
  } else if (direction === 'steady') {
    from = startingEnergy ?? target
    to = from
  }
  return {
    energyFrom: from,
    energyTo: to,
    // Smoothness is how big a step is allowed between neighbours: a sleep run may move very little.
    maxStep: 0.08 + (1 - smooth) * 0.5,
    familiarShare: Math.max(0, Math.min(1, familiar)),
    artistGap: tuning.artistGap.value
  }
}

/** Where energy should be at each step of a run, from the curve. */
export function energyPlan(curve: Curve, steps: number): (number | null)[] {
  if (curve.energyFrom === null || curve.energyTo === null) return Array.from({ length: steps }, () => null)
  if (steps === 1) return [curve.energyTo]
  return Array.from({ length: steps }, (_unused, index) => curve.energyFrom! + ((curve.energyTo! - curve.energyFrom!) * index) / (steps - 1))
}

export interface RunScore {
  score: number
  /** What was good and bad about it, for the inspector. */
  notes: string[]
}

/**
 * How good a whole run is.
 *
 * Each track's own score still counts -- a run of mediocre songs that flows beautifully is not the answer -- but the
 * run is judged on how it moves: whether it follows the curve, whether the joins work, whether it repeats itself,
 * and whether the familiar and the new are mixed rather than clumped.
 */
export function scoreRun(run: readonly Scored[], previous: TrackFeatures | null, curve: Curve, known: ReadonlySet<string>): RunScore {
  if (run.length === 0) return { score: 0, notes: [] }
  const notes: string[] = []
  let total = run.reduce((sum, one) => sum + one.score, 0) / run.length

  // The joins, including the one out of what is already playing.
  let joins = 0
  let joinCount = 0
  let before = previous
  for (const one of run) {
    if (before) {
      joins += transitionScore(before, one.features).score
      joinCount += 1
    }
    before = one.features
  }
  if (joinCount > 0) {
    const average = joins / joinCount
    total += (average - 0.5) * 0.8
    if (average > 0.75) notes.push('the tracks join well')
    if (average < 0.4) notes.push('some joins are rough')
  }

  // Following the curve.
  const plan = energyPlan(curve, run.length)
  let drift = 0
  let measured = 0
  for (const [index, one] of run.entries()) {
    const wanted = plan[index]
    if (wanted === null || !one.features.audio) continue
    drift += Math.abs(one.features.audio.energy - wanted)
    measured += 1
  }
  if (measured > 0) {
    const average = drift / measured
    total -= average * 1.2
    if (average < 0.12) notes.push('it follows the shape that was asked for')
    else if (average > 0.3) notes.push('it wanders from the shape that was asked for')
  }

  // Steps between neighbours.
  let jumps = 0
  for (let index = 1; index < run.length; index += 1) {
    const a = run[index - 1].features.audio
    const b = run[index].features.audio
    if (!a || !b) continue
    const step = Math.abs(b.energy - a.energy)
    if (step > curve.maxStep) jumps += step - curve.maxStep
  }
  total -= jumps * 1.5
  if (jumps > 0.3) notes.push('the energy jumps about')

  // Repeating itself: the same artist too soon, or two tracks that are nearly the same.
  const artists: string[] = []
  let repeats = 0
  for (const one of run) {
    const seen = artists.lastIndexOf(one.features.artistKey)
    if (seen >= 0 && artists.length - seen <= curve.artistGap) repeats += 1
    artists.push(one.features.artistKey)
  }
  total -= repeats * 0.6
  if (repeats > 0) notes.push('an artist comes round again quickly')

  let sameness = 0
  for (let index = 1; index < run.length; index += 1) {
    const match = similarity(run[index - 1].features, run[index].features, 'overall')
    if (match.score > 0.9 && match.confidence > 0.4) sameness += 1
  }
  total -= sameness * 0.5

  // The mix of familiar and new, clumping included: three new in a row is harder work than three spread out.
  const familiarCount = run.filter((one) => known.has(one.trackId)).length
  const share = familiarCount / run.length
  total -= Math.abs(share - curve.familiarShare) * 0.9
  let streak = 0
  let worstStreak = 0
  for (const one of run) {
    streak = known.has(one.trackId) ? 0 : streak + 1
    worstStreak = Math.max(worstStreak, streak)
  }
  if (worstStreak >= 3 && curve.familiarShare > 0.3) {
    total -= 0.4
    notes.push('several unfamiliar tracks in a row')
  }
  return { score: total, notes }
}

export interface PlannedRun {
  run: Scored[]
  score: number
  notes: string[]
  /** Where energy is planned to go, for showing the shape of the session. */
  energy: (number | null)[]
}

/**
 * Picks the best short run out of the scored candidates.
 *
 * A beam search: keep the best few partial runs, extend each by the best few next tracks, repeat. Bounded in both
 * directions, so planning five tracks out of a thousand candidates costs the same every time.
 */
export function planRun(candidates: readonly Scored[], o: { previous: TrackFeatures | null; curve: Curve; known: ReadonlySet<string>; length: number; beam?: number; branch?: number }): PlannedRun {
  const length = Math.max(1, Math.min(o.length, 12))
  const beam = o.beam ?? 6
  const branch = o.branch ?? 8
  if (candidates.length === 0) return { run: [], score: 0, notes: ['nothing to choose from'], energy: [] }

  let paths: { run: Scored[]; used: Set<string> }[] = [{ run: [], used: new Set() }]
  for (let step = 0; step < length; step += 1) {
    const next: { run: Scored[]; used: Set<string>; score: number; notes: string[] }[] = []
    for (const path of paths) {
      // Only the strongest few extensions of each path, which is what keeps this bounded.
      const options = candidates.filter((one) => !path.used.has(one.trackId)).slice(0, branch * 3)
      for (const option of options.slice(0, branch)) {
        const run = [...path.run, option]
        const scored = scoreRun(run, o.previous, o.curve, o.known)
        next.push({ run, used: new Set([...path.used, option.trackId]), score: scored.score, notes: scored.notes })
      }
    }
    if (next.length === 0) break
    next.sort((a, b) => b.score - a.score)
    paths = next.slice(0, beam).map((one) => ({ run: one.run, used: one.used }))
  }
  const best = paths[0]
  if (!best || best.run.length === 0) return { run: [], score: 0, notes: ['nothing to choose from'], energy: [] }
  const scored = scoreRun(best.run, o.previous, o.curve, o.known)
  return { run: best.run, score: scored.score, notes: scored.notes, energy: best.run.map((one) => one.features.audio?.energy ?? null) }
}

// ---------------------------------------------------------------- the queue, with what somebody has pinned

export type QueueOrigin = 'locked' | 'manual' | 'orbis' | 'discovery'

export interface QueueEntry {
  trackId: string
  origin: QueueOrigin
  /** Why it is there, when Orbis put it there. */
  because?: readonly string[]
}

/**
 * Rebuilds the part of the queue Orbis is allowed to touch.
 *
 * Everything somebody put there by hand, and everything they pinned, stays exactly where it is. Only what Orbis
 * chose is replaced. This is the rule that makes an adaptive queue bearable: it may improve its own suggestions
 * freely and it may never move a decision somebody made.
 */
export function reflow(queue: readonly QueueEntry[], replacement: readonly QueueEntry[], from = 0): QueueEntry[] {
  const out: QueueEntry[] = []
  const spare = [...replacement]
  for (const [index, entry] of queue.entries()) {
    if (index < from || entry.origin === 'locked' || entry.origin === 'manual') {
      out.push(entry)
      continue
    }
    const next = spare.shift()
    if (next) out.push(next)
    // An Orbis entry with nothing to replace it is dropped rather than kept out of politeness.
  }
  // Anything left over goes on the end.
  out.push(...spare)
  // The same track twice in a row is never wanted, however it got there.
  return out.filter((entry, index) => index === 0 || entry.trackId !== out[index - 1].trackId)
}

/** Whether anything in the queue may be changed at all. */
export const canReflow = (queue: readonly QueueEntry[]): boolean => queue.some((one) => one.origin === 'orbis' || one.origin === 'discovery')
