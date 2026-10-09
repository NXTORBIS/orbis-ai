import { daysBetween, dayKey } from './days.ts'

/**
 * Whether somebody actually knows something.
 *
 * ## Why this is not one number
 *
 * Reading a chapter and being able to use it are different, and a single "progress" figure cannot tell them apart.
 * So mastery is seven measured things, each from a different kind of evidence:
 *
 *   exposure       they have met it           -- opening it, reading it
 *   understanding  they followed it           -- an explanation that held together
 *   recall         they can produce it unaided -- answered with nothing in front of them
 *   application    they can use it on something new -- a problem they had not seen
 *   accuracy       they get it right           -- the share of attempts that were correct
 *   retention      it survived time            -- right again after a real gap
 *   consistency    it was not a fluke          -- right across separate days
 *
 * The seventh, **confidence**, is not an eighth dimension of knowing: it is how much evidence there is at all. Two
 * right answers and two hundred right answers can both read as 0.9, and the difference matters more than the score.
 * Everything downstream -- the planner, the revision schedule, Orbi's recommendations -- reads confidence before it
 * reads the score.
 *
 * ## The rule that makes it honest
 *
 * **Exposure never raises recall.** Somebody who read a page and cannot reproduce any of it has high exposure and
 * no recall, and `overall` reflects that. The commonest lie in study software is treating "opened" as "learned",
 * which produces a progress bar that climbs while nothing is being learned.
 *
 * Pure: no storage, no clock of its own.
 */

export type Dimension = 'exposure' | 'understanding' | 'recall' | 'application' | 'accuracy' | 'retention' | 'consistency'

export interface Mastery {
  conceptId: string
  /** Each dimension, 0..1. */
  scores: Readonly<Record<Dimension, number>>
  /** How much evidence there is, 0..1. Low means the scores are guesses. */
  confidence: number
  /** Attempts of each kind, which is what confidence is built from. */
  evidence: Readonly<Record<EvidenceKind, number>>
  correct: number
  attempts: number
  /** Separate days on which something was answered. Consistency comes from this, not from the count. */
  days: readonly string[]
  firstSeenAt: number
  lastSeenAt: number
  /** The longest gap, in days, that this still survived. Retention comes from this. */
  longestGapSurvived: number
  /**
   * How many attempts in a row have gone wrong.
   *
   * This, and not the lifetime share of right answers, is what says something has started slipping. A ratio built
   * over months barely moves when the last three answers were wrong -- which is exactly the moment worth noticing.
   */
  wrongRun: number
  state: MasteryState
}

export type MasteryState = 'new' | 'learning' | 'reviewing' | 'stable' | 'strong' | 'mastered' | 'slipping'

/** What somebody did, which is the only thing that moves a score. */
export type EvidenceKind =
  | 'read'
  | 'explained'
  | 'recalled'
  | 'recall-failed'
  | 'applied'
  | 'application-failed'
  | 'quiz-right'
  | 'quiz-wrong'
  | 'taught-back'
  | 'mistake'
  | 'mistake-fixed'

/** Every kind, so a stored record can be read back without inventing a kind nobody wrote. */
export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'read',
  'explained',
  'recalled',
  'recall-failed',
  'applied',
  'application-failed',
  'quiz-right',
  'quiz-wrong',
  'taught-back',
  'mistake',
  'mistake-fixed'
]

/**
 * Which dimensions each kind of evidence is allowed to touch, and how hard.
 *
 * `accuracy` is deliberately absent: it is not accumulated from events, it is the share of attempts that were
 * right, worked out below. Accumulating it from quiz answers alone meant a student who recalled and applied
 * everything correctly but had answered few quizzes read as inaccurate -- and, because low accuracy is one of the
 * signs of slipping, read as slipping while doing nothing wrong.
 */
const MOVES: Record<EvidenceKind, Partial<Record<Dimension, number>>> = {
  // Reading moves exposure and nothing else. This is the whole honesty of the module.
  read: { exposure: 0.35 },
  explained: { exposure: 0.2, understanding: 0.3 },
  recalled: { recall: 0.3, understanding: 0.1 },
  'recall-failed': { recall: -0.35 },
  applied: { application: 0.32, understanding: 0.12 },
  'application-failed': { application: -0.3 },
  'quiz-right': { recall: 0.12 },
  'quiz-wrong': { recall: -0.1 },
  // Teaching it back is the strongest single piece of evidence there is.
  'taught-back': { understanding: 0.34, recall: 0.2, application: 0.14 },
  mistake: { application: -0.12 },
  'mistake-fixed': { understanding: 0.18, application: 0.14 }
}

/** How much each kind of evidence is worth towards confidence. */
const WEIGHT: Record<EvidenceKind, number> = {
  read: 0.3,
  explained: 0.8,
  recalled: 1.4,
  'recall-failed': 1.2,
  applied: 1.6,
  'application-failed': 1.3,
  'quiz-right': 1,
  'quiz-wrong': 1,
  'taught-back': 2,
  mistake: 1.1,
  'mistake-fixed': 1.2
}

/** Evidence worth this much, in total, is roughly where the scores stop being guesses. */
const ENOUGH = 14

export const DIMENSIONS: readonly Dimension[] = ['exposure', 'understanding', 'recall', 'application', 'accuracy', 'retention', 'consistency']

const clamp = (value: number): number => Math.max(0, Math.min(1, value))

export function newMastery(conceptId: string, at: number): Mastery {
  return {
    conceptId,
    scores: { exposure: 0, understanding: 0, recall: 0, application: 0, accuracy: 0, retention: 0, consistency: 0 },
    confidence: 0,
    evidence: {
      read: 0,
      explained: 0,
      recalled: 0,
      'recall-failed': 0,
      applied: 0,
      'application-failed': 0,
      'quiz-right': 0,
      'quiz-wrong': 0,
      'taught-back': 0,
      mistake: 0,
      'mistake-fixed': 0
    },
    correct: 0,
    attempts: 0,
    days: [],
    firstSeenAt: at,
    lastSeenAt: at,
    longestGapSurvived: 0,
    wrongRun: 0,
    state: 'new'
  }
}

const RIGHT: readonly EvidenceKind[] = ['recalled', 'applied', 'quiz-right', 'taught-back', 'mistake-fixed']
const WRONG: readonly EvidenceKind[] = ['recall-failed', 'application-failed', 'quiz-wrong', 'mistake']

/**
 * One thing that happened, recorded.
 *
 * Scores move towards their target rather than being set: a right answer closes some of the distance to 1, a wrong
 * one opens distance back up. That makes a single event unable to declare mastery, and a single bad day unable to
 * erase it.
 */
export function record(held: Mastery, kind: EvidenceKind, at: number): Mastery {
  const moves = MOVES[kind]
  const scores: Record<Dimension, number> = { ...held.scores }

  for (const [dimension, amount] of Object.entries(moves) as [Dimension, number][]) {
    const current = scores[dimension]
    // Towards 1 when positive, towards 0 when negative. Never a straight addition.
    scores[dimension] = clamp(amount > 0 ? current + (1 - current) * amount : current + current * amount)
  }

  const right = RIGHT.includes(kind)
  const wrong = WRONG.includes(kind)
  const day = dayKey(at)
  const days = right || wrong ? [...new Set([...held.days, day])].sort().slice(-200) : held.days

  /*
   * Retention: being right again after a real gap.
   *
   * A gap only counts when the answer was right -- surviving a week and then failing is not retention. The longest
   * gap survived is kept, so retention reflects the hardest test time has set rather than the most recent one.
   */
  const gap = right ? (daysBetween(dayKey(held.lastSeenAt), day) ?? 0) : 0
  const longestGapSurvived = Math.max(held.longestGapSurvived, gap)
  scores.retention = clamp(longestGapSurvived >= 30 ? 1 : longestGapSurvived >= 14 ? 0.8 : longestGapSurvived >= 7 ? 0.6 : longestGapSurvived >= 3 ? 0.4 : longestGapSurvived >= 1 ? 0.2 : 0)

  // Consistency: separate days, not separate attempts. Ten answers in one sitting is one day.
  scores.consistency = clamp(days.length >= 6 ? 1 : days.length / 6)

  /*
   * Accuracy: the share of attempts that were right.
   *
   * Held at the middle until there are a few attempts, so one wrong answer out of one does not read as 0% accurate
   * -- which would then read as slipping, from a single event.
   */
  const correct = held.correct + (right ? 1 : 0)
  const attempts = held.attempts + (right || wrong ? 1 : 0)
  scores.accuracy = attempts >= 3 ? clamp(correct / attempts) : attempts === 0 ? 0 : 0.5

  const evidence = { ...held.evidence, [kind]: held.evidence[kind] + 1 }
  const weight = (Object.entries(evidence) as [EvidenceKind, number][]).reduce((sum, [one, count]) => sum + WEIGHT[one] * count, 0)
  const confidence = clamp(weight / ENOUGH)

  const next: Mastery = {
    ...held,
    scores,
    confidence,
    evidence,
    correct,
    attempts,
    wrongRun: wrong ? held.wrongRun + 1 : right ? 0 : held.wrongRun,
    days,
    lastSeenAt: at,
    longestGapSurvived,
    state: held.state
  }
  return { ...next, state: stateOf(next) }
}

/**
 * Overall mastery, as one number for a bar.
 *
 * Weighted towards being able to *use* the thing. Exposure is worth the least of anything, deliberately: it is the
 * cheapest evidence and the easiest to accumulate without learning.
 */
export function overall(one: Mastery): number {
  const w: Record<Dimension, number> = { exposure: 0.05, understanding: 0.18, recall: 0.24, application: 0.24, accuracy: 0.13, retention: 0.1, consistency: 0.06 }
  let sum = 0
  for (const dimension of DIMENSIONS) sum += one.scores[dimension] * w[dimension]
  return clamp(sum)
}

/**
 * What state something is in.
 *
 * `slipping` is the one worth naming: it was known and the recent evidence has gone the other way. Without it, a
 * concept decays silently and only reappears when an exam finds it.
 */
export function stateOf(one: Mastery): MasteryState {
  const score = overall(one)
  if (one.attempts === 0 && one.evidence.read === 0) return 'new'
  /*
   * Low confidence can never reach the confident states, whatever the score says -- but it is no longer "new"
   * either. Something read once has been started, and calling it "not started" is wrong in the direction that
   * matters: it hides the thing from every list that filters on having begun.
   */
  if (one.confidence < 0.25) return 'learning'
  /*
   * Slipping: it was good, and the last few attempts have gone wrong.
   *
   * A run of wrong answers rather than a lifetime average, because an average built over months hardly moves on
   * three bad answers -- and three bad answers in a row is precisely the thing worth saying something about. Two
   * is a wobble; three is a pattern.
   *
   * The gate is "this was once answered right", not "the score is still high". Three wrong answers drag the score
   * down themselves, so gating on the score meant the state flipped to plain "reviewing" at exactly the moment the
   * run became worth mentioning -- which hid the one thing the student needed to see.
   */
  if (one.correct >= 3 && one.wrongRun >= 3) return 'slipping'
  /*
   * Mastered: a good score, plenty of evidence, and it survived a real gap.
   *
   * The three gates together are the bar; the score alone is not. 0.85 across seven dimensions -- one of which is
   * capped by how much reading happened -- was effectively unreachable, and an unreachable state is a label
   * nothing ever wears.
   */
  if (score >= 0.78 && one.confidence >= 0.7 && one.scores.retention >= 0.6 && one.wrongRun === 0) return 'mastered'
  if (score >= 0.7) return 'strong'
  if (score >= 0.5) return 'stable'
  if (score >= 0.25) return 'reviewing'
  return 'learning'
}

/** How long since this was touched, in days. */
export function staleness(one: Mastery, now: number): number {
  return Math.max(0, daysBetween(dayKey(one.lastSeenAt), dayKey(now)) ?? 0)
}

/**
 * Whether mastery has decayed enough to be worth revisiting.
 *
 * Something strong can sit for a month; something barely learned cannot sit for three days. The gap allowed grows
 * with the score and with retention, which is the whole point of measuring retention separately.
 */
export function decayed(one: Mastery, now: number): { due: boolean; days: number; allowed: number } {
  const days = staleness(one, now)
  const score = overall(one)
  const allowed = Math.round(1 + score * 10 + one.scores.retention * 20)
  return { due: days >= allowed, days, allowed }
}

// ---------------------------------------------------------------- what is weak, and what is not

export interface Weakness {
  conceptId: string
  /** 0..1, how much attention this needs. */
  need: number
  /** The dimension that is holding it back, so the fix can be the right kind of work. */
  weakest: Dimension
  /** One sentence, in the student's terms. */
  why: string
  state: MasteryState
}

const WHY: Record<Dimension, string> = {
  exposure: 'You have barely met this one yet.',
  understanding: 'The idea itself has not settled.',
  recall: 'You can follow it, but not produce it from memory.',
  application: 'You know it, but using it on a new problem is not there yet.',
  accuracy: 'You get this one wrong more often than not.',
  retention: 'It has not survived a real gap yet.',
  consistency: 'It has only worked on one day so far.'
}

/**
 * What needs attention, hardest first.
 *
 * Need is built from how low the score is, how little retention there is, and how long it has been left -- but is
 * scaled down when there is not much evidence, because "weak" and "barely tried" are different things and only one
 * of them is worth a recommendation.
 */
export function weaknesses(all: readonly Mastery[], now: number, limit = 8): Weakness[] {
  return all
    .map((one) => {
      const score = overall(one)
      const stale = decayed(one, now)
      const lowest = DIMENSIONS.filter((d) => d !== 'exposure').reduce((worst, d) => (one.scores[d] < one.scores[worst] ? d : worst), 'understanding' as Dimension)
      const need = clamp((1 - score) * 0.6 + (stale.due ? 0.25 : 0) + (one.state === 'slipping' ? 0.3 : 0)) * clamp(0.35 + one.confidence)
      return { conceptId: one.conceptId, need, weakest: lowest, why: one.state === 'slipping' ? 'This was solid and has started slipping.' : WHY[lowest], state: one.state }
    })
    .filter((one) => one.need > 0.25)
    .sort((a, b) => b.need - a.need)
    .slice(0, limit)
}

/** What is going well. Shown because a list of only weaknesses is a demoralising picture of real progress. */
export function strengths(all: readonly Mastery[], limit = 5): { conceptId: string; score: number; state: MasteryState }[] {
  return all
    .filter((one) => one.confidence >= 0.5 && overall(one) >= 0.7)
    .map((one) => ({ conceptId: one.conceptId, score: overall(one), state: one.state }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Where understanding is inconsistent rather than absent.
 *
 * The signature is a decent score with answers going both ways -- right sometimes, wrong sometimes. That is a
 * different problem from not knowing it, and it needs a different fix: the shaky part has to be found rather than
 * the whole thing repeated.
 */
export function confusions(all: readonly Mastery[], limit = 5): { conceptId: string; score: number; swing: number }[] {
  return all
    .filter((one) => one.attempts >= 4 && one.confidence >= 0.35)
    .map((one) => {
      const share = one.attempts > 0 ? one.correct / one.attempts : 0
      // Nearest to half-right is the most inconsistent.
      const swing = 1 - Math.abs(share - 0.5) * 2
      return { conceptId: one.conceptId, score: overall(one), swing }
    })
    .filter((one) => one.swing > 0.55)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, limit)
}

// ---------------------------------------------------------------- proving it

export interface Proof {
  /** What has to be shown, and whether it has been. */
  steps: readonly { kind: EvidenceKind; label: string; done: boolean }[]
  passed: boolean
  /** What is still missing, in words. */
  missing: string
}

/**
 * What it takes to claim mastery of something.
 *
 * Deliberately a mixture, and deliberately not satisfiable by one lucky answer: recall it, use it on something new,
 * and explain it. A system that awards mastery for a single right answer is a system whose mastery figure means
 * nothing.
 */
export function proof(one: Mastery): Proof {
  const steps = [
    { kind: 'recalled' as EvidenceKind, label: 'Recall it with nothing in front of you', done: one.evidence.recalled >= 2 && one.scores.recall >= 0.6 },
    { kind: 'applied' as EvidenceKind, label: 'Use it on a problem you have not seen', done: one.evidence.applied >= 2 && one.scores.application >= 0.6 },
    { kind: 'taught-back' as EvidenceKind, label: 'Explain it as if teaching somebody', done: one.evidence['taught-back'] >= 1 && one.scores.understanding >= 0.6 }
  ]
  const left = steps.filter((step) => !step.done)
  return {
    steps,
    passed: left.length === 0 && one.confidence >= 0.5,
    missing: left.length === 0 ? (one.confidence >= 0.5 ? '' : 'A little more practice, so this is not resting on a handful of answers.') : left.map((step) => step.label).join('; ')
  }
}

/** Mastery as a sentence, for anywhere that needs to say it rather than draw it. */
export function describe(one: Mastery): string {
  const score = Math.round(overall(one) * 100)
  switch (one.state) {
    case 'new':
      return 'Not started.'
    case 'learning':
      return `Early days — ${score}%.`
    case 'reviewing':
      return `Coming along — ${score}%.`
    case 'stable':
      return `Holding — ${score}%.`
    case 'strong':
      return `Strong — ${score}%.`
    case 'mastered':
      return `Mastered — ${score}%.`
    case 'slipping':
      return `Was solid, slipping — ${score}%.`
  }
}
