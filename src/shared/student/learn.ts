import { dayKey, fromDayKey } from './days.ts'
import type { AgeBand, Difficulty, LearningItem, LearningKind, LearningReview, Mistake, QuizAttempt } from './types.ts'

/**
 * Orbis Learn: what comes back, and when.
 *
 * A review scheduler, a daily rotation and a difficulty that follows how somebody is actually doing. Three small
 * engines, all pure, all driven by what a student has answered rather than by how long they have had the app open.
 *
 * The scheduler is spaced repetition kept deliberately simple: a right answer pushes an item further away, a wrong
 * one brings it back soon, and the gap grows from the run of right answers rather than from a quality score the
 * student has to self-assess. Asking somebody to rate their own recall from one to five is a decision they get wrong
 * and an interface they learn to click past.
 */

/** The gaps, in days, by how many times in a row something has been right. */
const GAPS: readonly number[] = [0.25, 1, 3, 7, 16, 35, 70, 140]

/** Difficulty stretches or shrinks the gaps, because a hard thing forgotten is the point of reviewing it. */
const BY_DIFFICULTY: Record<Difficulty, number> = { beginner: 1.15, intermediate: 1, advanced: 0.8 }

export function newReview(itemId: string, profileId: string, difficulty: Difficulty, at: number): LearningReview {
  return {
    itemId,
    profileId,
    firstSeenAt: at,
    lastSeenAt: at,
    reviews: 0,
    correct: 0,
    confidence: 0.3,
    difficulty,
    dueAt: at,
    streak: 0,
    state: 'learning'
  }
}

export type Answer = 'known' | 'unsure' | 'forgot'

/**
 * One review answered.
 *
 * `unsure` is a real third answer, not a softer wrong: it keeps the run instead of resetting it, but does not let the
 * gap grow. Without it, a student who half-remembers something has to lie in one direction or the other, and the
 * schedule is built on the lie.
 */
export function review(held: LearningReview, answer: Answer, at: number): LearningReview {
  const reviews = held.reviews + 1
  const correct = held.correct + (answer === 'known' ? 1 : 0)
  const streak = answer === 'known' ? held.streak + 1 : answer === 'unsure' ? held.streak : 0
  // Forgotten goes back to the shortest gap. It must come back sooner than it was already due, or forgetting
  // something has no effect on when it is next asked -- which is the one thing the scheduler is for.
  const step = answer === 'known' ? Math.min(streak, GAPS.length - 1) : answer === 'unsure' ? Math.max(1, Math.min(held.streak, GAPS.length - 1)) : 0
  const days = GAPS[step] * BY_DIFFICULTY[held.difficulty]
  const confidence = clamp(
    // A right answer lifts it a little; a forgotten one drops it further than a right one lifts it, because forgetting
    // is the stronger signal about whether something is actually known.
    answer === 'known' ? held.confidence + (1 - held.confidence) * 0.35 : answer === 'unsure' ? held.confidence * 0.95 : held.confidence * 0.5
  )
  return {
    ...held,
    reviews,
    correct,
    streak,
    confidence,
    lastSeenAt: at,
    dueAt: at + Math.max(0.25, days) * 24 * 3600 * 1000,
    state: stateOf(confidence, streak, reviews)
  }
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value))

function stateOf(confidence: number, streak: number, reviews: number): LearningReview['state'] {
  if (reviews >= 3 && confidence < 0.35) return 'struggling'
  if (streak >= 4 && confidence > 0.8) return 'known'
  if (reviews >= 1) return 'reviewing'
  return 'learning'
}

/** What is due, most overdue first. A student should meet the thing they are closest to losing. */
export function dueNow(reviews: readonly LearningReview[], now: number, limit = 20): LearningReview[] {
  return reviews
    .filter((one) => one.dueAt <= now && one.state !== 'known')
    .sort((a, b) => a.dueAt - b.dueAt || a.confidence - b.confidence)
    .slice(0, limit)
}

export function dueCount(reviews: readonly LearningReview[], now: number): number {
  let count = 0
  for (const one of reviews) if (one.dueAt <= now && one.state !== 'known') count += 1
  return count
}

/** What is being forgotten faster than it is being learned. The honest input to "what should I go over". */
export function struggling(reviews: readonly LearningReview[], limit = 10): LearningReview[] {
  return reviews
    .filter((one) => one.state === 'struggling')
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, limit)
}

// ---------------------------------------------------------------- the day's content

/**
 * The item for a given day, chosen so it is the same all day and different tomorrow.
 *
 * Two things this must not do, both of which are what goes wrong in practice:
 *
 *   - give two different words on the same day because a page was refreshed. So the choice is a function of the day
 *     key, not of the moment, and the day key is the student's local day.
 *   - come back round to a word already seen while unseen ones remain. So seen ids are excluded first, and the
 *     rotation only begins again once there is nothing left.
 */
export function itemForDay(items: readonly LearningItem[], kind: LearningKind, day: string, seen: ReadonlySet<string>, band: AgeBand, difficulty: Difficulty): LearningItem | null {
  const fitting = items.filter((one) => one.kind === kind && appropriate(one, band) && near(one.difficulty, difficulty))
  if (fitting.length === 0) return null
  const fresh = fitting.filter((one) => !seen.has(one.id))
  const pool = fresh.length > 0 ? fresh : fitting
  const at = fromDayKey(day)
  // A stable index from the date, so the same day always gives the same item without storing a choice.
  const index = at === null ? 0 : Math.floor(at / (24 * 3600 * 1000)) % pool.length
  return pool[Math.abs(index)] ?? pool[0]
}

/** Whether a piece of content may be shown to somebody of a given age. Unlisted means not shown. */
export function appropriate(item: LearningItem, band: AgeBand): boolean {
  return item.bands.includes(band)
}

/** Within one step of the chosen difficulty, so a setting narrows the pool without emptying it. */
function near(a: Difficulty, b: Difficulty): boolean {
  const order: Difficulty[] = ['beginner', 'intermediate', 'advanced']
  return Math.abs(order.indexOf(a) - order.indexOf(b)) <= 1
}

/** Several items for a day, for a learning page rather than a single card. */
export function dayMix(items: readonly LearningItem[], day: string, seen: ReadonlySet<string>, band: AgeBand, difficulty: Difficulty): LearningItem[] {
  const kinds: LearningKind[] = ['word', 'concept', 'fact', 'teaser', 'quiz']
  const out: LearningItem[] = []
  for (const kind of kinds) {
    const picked = itemForDay(items, kind, day, new Set([...seen, ...out.map((one) => one.id)]), band, difficulty)
    if (picked) out.push(picked)
  }
  return out
}

// ---------------------------------------------------------------- how hard the questions should be

/**
 * The difficulty to ask at next, from the last few answers.
 *
 * Moves one step at a time and never past the ends, so a bad afternoon cannot make the whole thing unanswerable and a
 * good one cannot skip a student past what they actually know. Needs five answers before it moves at all.
 */
export function nextDifficulty(attempts: readonly QuizAttempt[], current: Difficulty): Difficulty {
  const recent = [...attempts].sort((a, b) => b.at - a.at).slice(0, 8)
  if (recent.length < 5) return current
  const right = recent.filter((one) => one.correct).length / recent.length
  const order: Difficulty[] = ['beginner', 'intermediate', 'advanced']
  const index = order.indexOf(current)
  if (right >= 0.85 && index < 2) return order[index + 1]
  if (right <= 0.4 && index > 0) return order[index - 1]
  return current
}

/** How somebody is doing, as the numbers and nothing more. */
export function quizSummary(attempts: readonly QuizAttempt[]): { answered: number; right: number; share: number | null } {
  const answered = attempts.length
  const right = attempts.filter((one) => one.correct).length
  return { answered, right, share: answered >= 5 ? right / answered : null }
}

// ---------------------------------------------------------------- mistakes

/** Mistakes worth going back over: the ones never reviewed, oldest first. */
export function mistakesToReview(mistakes: readonly Mistake[], limit = 10): Mistake[] {
  return mistakes.filter((one) => one.reviewedAt === null).sort((a, b) => a.at - b.at).slice(0, limit)
}

/**
 * What kind of mistake keeps happening, if one does.
 *
 * A count, with its own name attached, and nothing said about the person. "Eleven of your recent mistakes were
 * calculation" is a fact a student can act on; "you are careless" is not, and is not Orbis's to say.
 */
export function mistakePattern(mistakes: readonly Mistake[]): { kind: Mistake['kind']; count: number; share: number } | null {
  const recent = [...mistakes].sort((a, b) => b.at - a.at).slice(0, 20)
  if (recent.length < 8) return null
  const counts = new Map<Mistake['kind'], number>()
  for (const one of recent) counts.set(one.kind, (counts.get(one.kind) ?? 0) + 1)
  const [kind, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const share = count / recent.length
  return share >= 0.4 ? { kind, count, share } : null
}

export const MISTAKE_LABELS: Record<Mistake['kind'], string> = {
  concept: 'the idea itself',
  calculation: 'working it out',
  recall: 'remembering it',
  application: 'using it on a new problem',
  careless: 'slips'
}

// ---------------------------------------------------------------- what a day of learning was

/** Whether a day counts for the learning streak: something was genuinely answered, not merely opened. */
export function learningDayCounts(reviews: readonly LearningReview[], attempts: readonly QuizAttempt[], day: string): boolean {
  if (attempts.some((one) => dayKey(one.at) === day)) return true
  return reviews.some((one) => one.reviews > 0 && dayKey(one.lastSeenAt) === day)
}

/** How many pieces of learning were touched on a day. */
export function learningOnDay(reviews: readonly LearningReview[], attempts: readonly QuizAttempt[], day: string): number {
  const ids = new Set<string>()
  for (const one of reviews) if (one.reviews > 0 && dayKey(one.lastSeenAt) === day) ids.add(one.itemId)
  for (const one of attempts) if (dayKey(one.at) === day) ids.add(one.itemId)
  return ids.size
}
