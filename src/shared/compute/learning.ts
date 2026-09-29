/**
 * Learning: when to review, how much is retained, and what a run of answers says about what is known.
 *
 * The shared learning engine for Orbis Pages. Review schedules come from a named algorithm, retention estimates say
 * what curve they assume, and a mastery estimate from four answers is reported with an interval wide enough to be
 * honest about how little four answers say.
 *
 * ## Why the scheduling algorithm is named
 *
 * SM-2 was published in 1987 and is what most flashcard software still implements. FSRS is a fitted model with
 * separate stability and difficulty terms and it beats SM-2 on real review logs. They give different intervals for
 * the same card, and a schedule without its algorithm attached cannot be compared with another one or reproduced.
 *
 * ## Why retention estimates carry their curve
 *
 * The forgetting curve is exponential in some models, a power law in others, and the two disagree about the long
 * tail — which is precisely where a study plan lives. Ebbinghaus measured nonsense syllables on one subject, and
 * the numbers everyone quotes from him do not transfer to meaningful material. Every estimate here states which
 * curve it used and that it is a model rather than a measurement of the learner.
 *
 * ## What this engine will not do
 *
 * It will not grade an answer, judge understanding, or predict an exam result. It schedules, it tracks, and it
 * estimates from answers the caller supplies. Whether an answer was right is the caller's judgement.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * interval         vs  retention        -- when to review against how much is remembered
 * difficulty       vs  stability        -- how hard a card is against how long it lasts
 * recall           vs  recognition      -- producing it against knowing it when you see it
 * study time       vs  retrieval        -- rereading against being tested, which is the effective one
 * accuracy         vs  mastery          -- what happened against what is known, which needs an interval
 * ```
 *
 * Pure. No network, no clock, no storage. Every time and date is supplied.
 */

export interface LearningError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'too-few' | 'too-many' | 'no-solution'
  message: string
}

export const isLearningError = (value: unknown): value is LearningError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: LearningError['error'], message: string): LearningError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const LEARNING_LIMITS = Object.freeze({ reviews: 10_000, cards: 20_000, days: 3650, samples: 2000 })

// ---------------------------------------------------------------- scheduling

export type Scheduler = 'sm2' | 'fsrs-like' | 'leitner' | 'fixed-interval'

export const SCHEDULERS: readonly Scheduler[] = Object.freeze(['sm2', 'fsrs-like', 'leitner', 'fixed-interval'])

export const SCHEDULER_FACTS: Readonly<
  Record<Scheduler, { label: string; origin: string; tracks: string; limitation: string }>
> = Object.freeze({
  sm2: {
    label: 'SM-2',
    origin: 'Piotr Wozniak, 1987. What most flashcard software still implements.',
    tracks: 'One number per card, the ease factor, plus the current interval.',
    limitation:
      'It cannot separate how hard a card is from how long it lasts, so a hard card that is nonetheless well learned gets treated as if it were forgotten easily.'
  },
  'fsrs-like': {
    label: 'FSRS-style (stability and difficulty)',
    origin: 'The family of models behind the Free Spaced Repetition Scheduler, fitted to large review logs.',
    tracks: 'Stability — how long the memory lasts — and difficulty, separately.',
    limitation:
      'The published parameters were fitted on other people’s review logs. Without fitting to your own they are a good default and not a personal model.'
  },
  leitner: {
    label: 'Leitner boxes',
    origin: 'Sebastian Leitner, 1972, for physical index cards.',
    tracks: 'Which box a card is in, and nothing else.',
    limitation: 'Crude, and its great virtue: it needs no arithmetic and works with a shoebox.'
  },
  'fixed-interval': {
    label: 'Fixed interval',
    origin: 'No algorithm — review everything on the same cycle.',
    tracks: 'Nothing.',
    limitation:
      'Wastes time on what is known and under-reviews what is not. It is the baseline the others are measured against, and worth keeping for that reason.'
  }
})

export interface ReviewState {
  /** Days until the next review, from the last one. */
  interval: number
  /** SM-2's ease factor, 1.3 upward. */
  ease?: number
  /** FSRS-style stability, in days. */
  stability?: number
  /** FSRS-style difficulty, 1 to 10. */
  difficulty?: number
  /** How many times this card has been reviewed. */
  repetitions?: number
  /** Which Leitner box. */
  box?: number
  /** How many times it has been forgotten. */
  lapses?: number
}

export interface ScheduleReport {
  scheduler: Scheduler
  label: string
  /** The state to store for next time. */
  next: ReviewState
  /** Days until the next review. */
  interval: number
  /** How much the interval grew or shrank. */
  intervalChange: number
  /** What the scheduler expects the recall probability to be at that point. */
  targetRetention: number
  /** Whether this counts as a lapse, which resets progress in most schedulers. */
  lapsed: boolean
  origin: string
  limitation: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The next review interval for a card, from a named scheduler.
 *
 * A grade of 0 to 5 is SM-2's own scale, and its meaning matters: 3 is "recalled with serious difficulty", which
 * SM-2 treats as a pass that barely extends the interval, while 2 is a failure that resets it. The boundary between
 * 2 and 3 carries almost all of the algorithm's behaviour, which is why it is stated rather than left to be
 * discovered.
 */
export function scheduleReview(input: {
  scheduler?: Scheduler
  state?: ReviewState
  /** 0 to 5 on SM-2's scale: 0-2 is a failure, 3 is a struggle, 4 is a pass, 5 is easy. */
  grade: number
  /** Days actually elapsed since the last review, which FSRS-style scheduling needs. */
  elapsedDays?: number
  /** The retention the schedule aims at. Lower means longer intervals and more forgetting. */
  targetRetention?: number
  /** Days. Nothing is scheduled beyond this. */
  maximumInterval?: number
}): ScheduleReport | LearningError {
  const scheduler = input.scheduler ?? 'sm2'
  const facts = SCHEDULER_FACTS[scheduler]
  if (!facts) return fail('invalid-argument', `"${scheduler}" is not one of: ${SCHEDULERS.join(', ')}.`)

  const { grade } = input
  if (!finite(grade)) return fail('not-finite', 'The grade has to be a finite number.')
  if (grade < 0 || grade > 5) return fail('out-of-range', "The grade runs 0 to 5 on SM-2's scale: 0-2 is a failure, 3 is a struggle, 4 is a pass, 5 is easy.")

  const state = input.state ?? { interval: 0 }
  if (!finite(state.interval) || state.interval < 0) return fail('invalid-argument', 'The current interval cannot be negative.')
  const target = input.targetRetention ?? 0.9
  if (!finite(target) || target <= 0 || target >= 1) return fail('out-of-range', 'The target retention is a fraction between 0 and 1.')
  const maximum = input.maximumInterval ?? 36500
  if (!finite(maximum) || maximum <= 0) return fail('invalid-argument', 'The maximum interval has to be greater than zero.')

  const lapsed = grade < 3
  const warnings: string[] = []
  let next: ReviewState
  let interval: number

  if (scheduler === 'fixed-interval') {
    interval = Math.min(state.interval > 0 ? state.interval : 1, maximum)
    next = { interval, repetitions: (state.repetitions ?? 0) + 1, lapses: (state.lapses ?? 0) + (lapsed ? 1 : 0) }
    warnings.push('A fixed interval ignores the grade entirely. It is the baseline the other schedulers are measured against, not a schedule to use.')
  } else if (scheduler === 'leitner') {
    const box = state.box ?? 1
    if (!Number.isInteger(box) || box < 1) return fail('invalid-argument', 'A Leitner box is a whole number from 1 upward.')
    const nextBox = lapsed ? 1 : box + 1
    // Boxes double: 1, 2, 4, 8 days and so on.
    interval = Math.min(Math.pow(2, nextBox - 1), maximum)
    next = { interval, box: nextBox, repetitions: (state.repetitions ?? 0) + 1, lapses: (state.lapses ?? 0) + (lapsed ? 1 : 0) }
  } else if (scheduler === 'sm2') {
    let ease = state.ease ?? 2.5
    if (!finite(ease)) return fail('not-finite', 'The ease factor has to be a finite number.')
    // The SM-2 ease adjustment, exactly as published.
    ease = ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    if (ease < 1.3) ease = 1.3
    const repetitions = lapsed ? 0 : (state.repetitions ?? 0) + 1

    if (lapsed) {
      interval = 1
    } else if (repetitions === 1) {
      interval = 1
    } else if (repetitions === 2) {
      interval = 6
    } else {
      interval = Math.round(state.interval * ease)
    }
    interval = Math.min(interval, maximum)
    next = { interval, ease, repetitions, lapses: (state.lapses ?? 0) + (lapsed ? 1 : 0) }

    if (ease <= 1.3) {
      warnings.push(
        'The ease factor has hit its floor of 1.3, so intervals will now grow by only 30% each time however well this card is answered. In SM-2 that floor is permanent, and a card stuck at it is usually one that should be rewritten rather than reviewed harder.'
      )
    }
  } else {
    // FSRS-style: stability and difficulty tracked separately, with the standard shape and published-style
    // coefficients. These were fitted on other people's review logs, which the result says.
    const elapsed = input.elapsedDays ?? state.interval
    if (!finite(elapsed) || elapsed < 0) return fail('invalid-argument', 'The elapsed days cannot be negative.')
    let difficulty = state.difficulty ?? 5
    let stability = state.stability ?? 1
    if (!finite(difficulty) || difficulty < 1 || difficulty > 10) return fail('out-of-range', 'Difficulty runs from 1 to 10.')
    if (!finite(stability) || stability <= 0) return fail('invalid-argument', 'Stability has to be greater than zero.')

    // Difficulty moves toward its mean, driven by the grade.
    difficulty = Math.max(1, Math.min(10, difficulty - 0.1 * (grade - 3)))

    // Retrievability at the moment of review, on the power-law curve FSRS uses.
    const retrievability = Math.pow(1 + elapsed / (9 * stability), -1)

    if (lapsed) {
      // A lapse cuts stability rather than resetting it to nothing, which is the main way this differs from SM-2.
      stability = Math.max(0.1, 2 * Math.pow(difficulty, -0.5) * Math.pow(stability, 0.3))
    } else {
      const easeBonus = grade === 5 ? 1.3 : grade === 4 ? 1 : 0.8
      stability =
        stability *
        (1 +
          Math.exp(1.5) *
            (11 - difficulty) *
            Math.pow(stability, -0.3) *
            (Math.exp(0.6 * (1 - retrievability)) - 1) *
            easeBonus)
    }

    // The interval that lands on the target retention, inverting the same power law.
    interval = Math.min(Math.max(1, Math.round(9 * stability * (1 / target - 1))), maximum)
    next = {
      interval,
      stability,
      difficulty,
      repetitions: (state.repetitions ?? 0) + 1,
      lapses: (state.lapses ?? 0) + (lapsed ? 1 : 0)
    }

    if (elapsed > stability * 20) {
      warnings.push(
        `This card was left ${elapsed} days when its stability was ${stability.toFixed(1)}. Answering it correctly after that long is worth more than the schedule can credit, and answering it wrong says less than usual.`
      )
    }
  }

  if (interval >= maximum) {
    warnings.push(`The interval hit the ${maximum}-day ceiling. Beyond about a year the schedule is guessing — there is very little review data at those intervals to fit anything on.`)
  }

  return {
    scheduler,
    label: facts.label,
    next,
    interval,
    intervalChange: state.interval === 0 ? interval : interval - state.interval,
    targetRetention: target,
    lapsed,
    origin: facts.origin,
    limitation: facts.limitation,
    notes: Object.freeze([
      `${facts.label}. ${facts.origin} It tracks ${facts.tracks}`,
      `Next review in ${interval} day${interval === 1 ? '' : 's'}${lapsed ? ', after a lapse' : ''}.`,
      `Limitation: ${facts.limitation}`,
      'Grade 2 and grade 3 are on either side of the pass boundary, and almost all of a scheduler’s behaviour turns on which side an answer falls. "Recalled with serious difficulty" is a 3 and a pass; "wrong but it felt familiar" is a 2 and a lapse.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- retention

export type ForgettingCurve = 'exponential' | 'power-law'

export const FORGETTING_CURVES: readonly ForgettingCurve[] = Object.freeze(['exponential', 'power-law'])

export const CURVE_FACTS: Readonly<Record<ForgettingCurve, { label: string; shape: string; evidence: string }>> =
  Object.freeze({
    exponential: {
      label: 'Exponential decay',
      shape: 'R = 0.9^(t/S). A constant proportion is lost per unit time.',
      evidence:
        'What most spaced-repetition software assumes. Simple, and it under-predicts long-term retention because real forgetting slows down.'
    },
    'power-law': {
      label: 'Power law',
      shape: 'R = (1 + t/(9S))^-1. Forgetting slows as time passes.',
      evidence:
        'Fits large review datasets better than exponential decay, especially past a few weeks. That is where the two curves disagree, and where study plans live.'
    }
  })

export interface RetentionReport {
  curve: ForgettingCurve
  /** The probability of recall now. */
  retention: number
  /** Days. How long until recall falls to the threshold. */
  daysUntilThreshold: number | null
  threshold: number
  /** The curve over time, for drawing. */
  samples: readonly { day: number; retention: number }[]
  /** What the other curve would say, since they disagree most where it matters. */
  otherCurve: { curve: ForgettingCurve; retention: number; daysUntilThreshold: number | null }
  shape: string
  evidence: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Estimated retention over time, with the other curve's answer alongside.
 *
 * The two curves are reported together because they disagree exactly where a study plan is decided. At a week they
 * differ by a few percent; at six months the exponential curve says the material is gone and the power law says a
 * third of it is still there. Neither is a measurement of the learner — both are models, and which one is right
 * depends on the material and the person.
 */
export function retention(input: {
  curve?: ForgettingCurve
  /** Days since the material was learned or last reviewed. */
  elapsedDays: number
  /**
   * Days. The memory's strength, defined the same way for both curves: the time at which recall falls to 90%.
   * Parameterising them identically is what makes the two comparable — with different definitions of S they would
   * disagree at every point, including ones where they actually agree.
   */
  stability: number
  /** The recall probability to find the time for. */
  threshold?: number
  /** Days to plot over. */
  duration?: number
  samples?: number
}): RetentionReport | LearningError {
  const curve = input.curve ?? 'power-law'
  const facts = CURVE_FACTS[curve]
  if (!facts) return fail('invalid-argument', `"${curve}" is not one of: ${FORGETTING_CURVES.join(', ')}.`)
  const { elapsedDays, stability } = input
  if (!finite(elapsedDays) || elapsedDays < 0) return fail('invalid-argument', 'The elapsed days cannot be negative.')
  if (!finite(stability) || stability <= 0) return fail('invalid-argument', 'Stability has to be greater than zero days.')
  const threshold = input.threshold ?? 0.9
  if (!finite(threshold) || threshold <= 0 || threshold >= 1) return fail('out-of-range', 'The threshold is a fraction between 0 and 1.')

  // Both curves are parameterised so that recall is 0.9 at t = stability. Without that the two would disagree
  // everywhere, including at the short intervals where they genuinely agree, and the comparison would be worthless.
  const retentionAt = (days: number, which: ForgettingCurve): number =>
    which === 'exponential' ? Math.pow(0.9, days / stability) : Math.pow(1 + days / (9 * stability), -1)
  const daysFor = (which: ForgettingCurve): number =>
    which === 'exponential'
      ? (stability * Math.log(threshold)) / Math.log(0.9)
      : 9 * stability * (1 / threshold - 1)

  const duration = input.duration ?? Math.max(daysFor(curve) * 4, 30)
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be greater than zero days.')
  const count = Math.round(input.samples ?? 120)
  if (!Number.isInteger(count) || count < 2 || count > LEARNING_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${LEARNING_LIMITS.samples}.`)
  }

  const samples: RetentionReport['samples'][number][] = []
  for (let i = 0; i < count; i += 1) {
    const day = (duration * i) / (count - 1)
    samples.push({ day, retention: retentionAt(day, curve) })
  }

  const other: ForgettingCurve = curve === 'exponential' ? 'power-law' : 'exponential'
  const now = retentionAt(elapsedDays, curve)
  const otherNow = retentionAt(elapsedDays, other)

  const warnings: string[] = []
  if (Math.abs(now - otherNow) > 0.1) {
    warnings.push(
      `The two curves disagree by ${(Math.abs(now - otherNow) * 100).toFixed(1)} percentage points at ${elapsedDays} days: ${(now * 100).toFixed(1)}% on the ${facts.label.toLowerCase()} and ${(otherNow * 100).toFixed(1)}% on the other. Past a few weeks that gap widens, and a study plan built on one rather than the other will differ substantially.`
    )
  }

  return {
    curve,
    retention: now,
    daysUntilThreshold: elapsedDays >= daysFor(curve) ? null : daysFor(curve),
    threshold,
    samples: Object.freeze(samples),
    otherCurve: { curve: other, retention: otherNow, daysUntilThreshold: daysFor(other) },
    shape: facts.shape,
    evidence: facts.evidence,
    notes: Object.freeze([
      `${facts.label}: ${facts.shape} ${facts.evidence}`,
      `Estimated recall after ${elapsedDays} days: ${(now * 100).toFixed(1)}%.`,
      `Recall falls to ${(threshold * 100).toFixed(0)}% at about ${daysFor(curve).toFixed(1)} days on this curve, and ${daysFor(other).toFixed(1)} on the other.`,
      'Both curves are scaled so that recall is 90% at the stability figure given. That is what makes them comparable — they agree at short intervals and part company later, which is the whole point of showing both.',
      'This is a model, not a measurement of the learner. Ebbinghaus measured nonsense syllables on one person, and the figures everybody quotes from him do not transfer to meaningful material.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- mastery

export interface MasteryReport {
  /** The estimated probability of a correct answer on the next attempt. */
  estimate: number
  /** A 95% interval. Wide when there are few attempts, which is the point. */
  interval: { low: number; high: number }
  attempts: number
  correct: number
  /** The raw proportion, which is what people quote and which ignores how few attempts there were. */
  rawAccuracy: number
  /** How much the estimate is pulled toward the prior by the shortage of data. */
  shrinkage: number
  /** Whether there is enough evidence to distinguish this from a coin flip. */
  distinguishableFromGuessing: boolean
  /** The recent trend, if the order of answers was given. */
  trend: 'improving' | 'declining' | 'steady' | 'unknown'
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * What a run of answers says about what is known, with an interval wide enough to be honest.
 *
 * The raw proportion is what people quote and it is badly misleading on small numbers: four out of four is 100%
 * accuracy and is perfectly consistent with a 60% chance of getting the next one right. The estimate here is
 * shrunk toward a neutral prior and the interval is reported, so "three out of three" does not read as mastery.
 */
export function mastery(input: {
  attempts?: number
  correct?: number
  /** In order, oldest first, so a trend can be reported. */
  sequence?: readonly boolean[]
  /** The chance of getting it right by guessing — 0.25 for four-option multiple choice. */
  guessRate?: number
}): MasteryReport | LearningError {
  let attempts: number
  let correct: number
  let sequence: readonly boolean[] | null = null

  if (input.sequence !== undefined) {
    sequence = input.sequence
    if (sequence.length === 0) return fail('too-few', 'There are no answers.')
    if (sequence.length > LEARNING_LIMITS.reviews) return fail('too-many', `That is more than the ${LEARNING_LIMITS.reviews} answers this handles.`)
    attempts = sequence.length
    correct = sequence.filter((one) => one).length
  } else {
    if (input.attempts === undefined || input.correct === undefined) {
      return fail('invalid-argument', 'Give a sequence of answers, or a count of attempts and how many were correct.')
    }
    attempts = input.attempts
    correct = input.correct
    if (!Number.isInteger(attempts) || attempts < 1) return fail('invalid-argument', 'The attempt count has to be a whole number of at least 1.')
    if (!Number.isInteger(correct) || correct < 0 || correct > attempts) {
      return fail('invalid-argument', `Correct answers have to be a whole number between 0 and ${attempts}.`)
    }
  }

  const guessRate = input.guessRate ?? 0
  if (!finite(guessRate) || guessRate < 0 || guessRate >= 1) return fail('out-of-range', 'The guess rate is a fraction between 0 and 1.')

  // A Beta(1,1) posterior mean, which is the Laplace rule of succession: it never returns a flat 0 or 1 from a
  // handful of answers, because a handful of answers does not support one.
  const estimate = (correct + 1) / (attempts + 2)
  const rawAccuracy = correct / attempts

  // The Wilson interval, which stays inside 0 and 1 and does not collapse at the extremes the way the normal
  // approximation does.
  const z = 1.96
  const centre = (correct + (z * z) / 2) / (attempts + z * z)
  const spread = (z / (attempts + z * z)) * Math.sqrt((correct * (attempts - correct)) / attempts + (z * z) / 4)
  const interval = { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) }

  const distinguishable = guessRate > 0 ? interval.low > guessRate : interval.low > 0.5

  let trend: MasteryReport['trend'] = 'unknown'
  if (sequence !== null && sequence.length >= 6) {
    const half = Math.floor(sequence.length / 2)
    const early = sequence.slice(0, half).filter((one) => one).length / half
    const late = sequence.slice(sequence.length - half).filter((one) => one).length / half
    trend = late > early + 0.15 ? 'improving' : late < early - 0.15 ? 'declining' : 'steady'
  }

  const warnings: string[] = []
  if (attempts < 5) {
    warnings.push(
      `Only ${attempts} attempt${attempts === 1 ? '' : 's'}. The interval runs from ${(interval.low * 100).toFixed(0)}% to ${(interval.high * 100).toFixed(0)}%, which is most of the range — this says very little yet, whatever the raw figure looks like.`
    )
  }
  if (correct === attempts && attempts < 10) {
    warnings.push(
      `${correct} out of ${correct} is a raw accuracy of 100%, and it is consistent with a true rate as low as ${(interval.low * 100).toFixed(0)}%. A perfect short run is not mastery.`
    )
  }
  if (guessRate > 0 && !distinguishable) {
    warnings.push(
      `With a guess rate of ${(guessRate * 100).toFixed(0)}%, this performance is not distinguishable from guessing — the interval still includes it.`
    )
  }

  return {
    estimate,
    interval,
    attempts,
    correct,
    rawAccuracy,
    shrinkage: Math.abs(estimate - rawAccuracy),
    distinguishableFromGuessing: distinguishable,
    trend,
    notes: Object.freeze([
      `${correct} of ${attempts} correct. Raw accuracy ${(rawAccuracy * 100).toFixed(1)}%, estimate ${(estimate * 100).toFixed(1)}%, interval ${(interval.low * 100).toFixed(1)}% to ${(interval.high * 100).toFixed(1)}%.`,
      'The estimate is shrunk toward the middle by the shortage of data, which is why it does not read as 100% from a short perfect run.',
      'The interval is a Wilson interval, which stays inside 0 and 1 rather than collapsing at the extremes the way the usual normal approximation does.',
      trend === 'unknown'
        ? 'Give the answers in order for a trend. A count alone cannot show whether things are getting better.'
        : `The recent half is ${trend} against the earlier half.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- study planning

export interface StudyPlanReport {
  /** What to do on each day. */
  days: readonly { day: number; minutes: number; topics: readonly { topic: string; minutes: number; reason: string }[] }[]
  totalMinutes: number
  /** Minutes per topic over the whole plan. */
  perTopic: readonly { topic: string; minutes: number; share: number; weight: number }[]
  /** Whether every topic got some time. */
  everyTopicCovered: boolean
  /** How many days the plan spans. */
  days_: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Divide available study time across topics by weight, spread over days.
 *
 * The weight is the caller's judgement, not this engine's: it cannot know which topic matters or which is weakest.
 * What it does is divide honestly, spread each topic across days rather than blocking it into one, and refuse to
 * pretend that fifteen topics fit into an hour.
 *
 * Interleaving rather than blocking is deliberate and is the one pedagogical choice this makes: studying three
 * topics in rotation beats studying them one after another on every test of later retention, even though it feels
 * worse while doing it.
 */
export function studyPlan(input: {
  topics: readonly { topic: string; weight?: number; minimumMinutes?: number }[]
  /** Minutes available each day. */
  minutesPerDay: number
  days: number
  /** The shortest useful block. Below this, switching costs more than the time is worth. */
  minimumBlock?: number
}): StudyPlanReport | LearningError {
  const { topics, minutesPerDay, days } = input
  if (topics.length === 0) return fail('too-few', 'There are no topics.')
  if (topics.length > 500) return fail('too-many', 'That is more than the 500 topics this plans for.')
  if (!finite(minutesPerDay) || minutesPerDay <= 0) return fail('invalid-argument', 'The minutes per day has to be greater than zero.')
  if (!Number.isInteger(days) || days < 1 || days > LEARNING_LIMITS.days) {
    return fail('invalid-argument', `The number of days has to be a whole number from 1 to ${LEARNING_LIMITS.days}.`)
  }
  const minimumBlock = input.minimumBlock ?? 10
  if (!finite(minimumBlock) || minimumBlock <= 0) return fail('invalid-argument', 'The minimum block has to be greater than zero minutes.')

  // Validated in a loop that returns rather than throws: every failure in this engine is a value the caller can
  // read, and a throw from inside a map would escape that contract.
  const weights: number[] = []
  for (const [i, one] of topics.entries()) {
    if (typeof one.topic !== 'string' || one.topic.trim().length === 0) {
      return fail('invalid-argument', `Topic ${i + 1} has no name.`)
    }
    const weight = one.weight ?? 1
    if (!finite(weight) || weight <= 0) return fail('invalid-argument', `"${one.topic}" has a weight that is not greater than zero.`)
    const minimum = one.minimumMinutes ?? 0
    if (!finite(minimum) || minimum < 0) return fail('invalid-argument', `"${one.topic}" has a negative minimum.`)
    weights.push(weight)
  }

  const totalWeight = weights.reduce((sum, one) => sum + one, 0)
  const totalMinutes = minutesPerDay * days
  const perTopicTarget = topics.map((one, i) => ({
    topic: one.topic,
    weight: weights[i],
    target: (weights[i] / totalWeight) * totalMinutes,
    minimum: one.minimumMinutes ?? 0
  }))

  const warnings: string[] = []
  const shortfall = perTopicTarget.filter((one) => one.target < one.minimum)
  if (shortfall.length > 0) {
    warnings.push(
      `${shortfall.map((one) => `"${one.topic}"`).join(', ')} would get less time than the minimum asked for. The plan below divides by weight and does not steal from other topics to meet a minimum — that is a decision for whoever set the weights.`
    )
  }

  // How many topics fit in a day at the minimum block size.
  const perDay = Math.max(1, Math.floor(minutesPerDay / minimumBlock))
  if (perDay < topics.length) {
    warnings.push(
      `${minutesPerDay} minutes a day fits ${perDay} block${perDay === 1 ? '' : 's'} of ${minimumBlock} minutes, and there are ${topics.length} topics. They are rotated across days rather than crammed into one — interleaving is better for retention anyway, but a topic will not appear every day.`
    )
  }

  // Rotate topics across days, so each is interleaved rather than blocked.
  const spent = new Map<string, number>()
  const plan: StudyPlanReport['days'][number][] = []
  let rotation = 0
  for (let day = 1; day <= days; day += 1) {
    const todaysTopics: { topic: string; minutes: number; reason: string }[] = []
    const chosen: typeof perTopicTarget = []
    for (let i = 0; i < Math.min(perDay, topics.length); i += 1) {
      chosen.push(perTopicTarget[(rotation + i) % topics.length])
    }
    rotation = (rotation + Math.min(perDay, topics.length)) % topics.length
    const chosenWeight = chosen.reduce((sum, one) => sum + one.weight, 0)
    for (const one of chosen) {
      const minutes = Math.round((one.weight / chosenWeight) * minutesPerDay)
      todaysTopics.push({
        topic: one.topic,
        minutes,
        reason: `weight ${one.weight} of ${chosenWeight} today`
      })
      spent.set(one.topic, (spent.get(one.topic) ?? 0) + minutes)
    }
    plan.push({ day, minutes: todaysTopics.reduce((sum, one) => sum + one.minutes, 0), topics: Object.freeze(todaysTopics) })
  }

  const perTopic = perTopicTarget.map((one) => ({
    topic: one.topic,
    minutes: spent.get(one.topic) ?? 0,
    share: totalMinutes === 0 ? 0 : (spent.get(one.topic) ?? 0) / totalMinutes,
    weight: one.weight
  }))
  const uncovered = perTopic.filter((one) => one.minutes === 0)
  if (uncovered.length > 0) {
    warnings.push(`${uncovered.map((one) => `"${one.topic}"`).join(', ')} got no time at all: there are more topics than the rotation reaches in ${days} day${days === 1 ? '' : 's'}.`)
  }

  return {
    days: Object.freeze(plan),
    totalMinutes,
    perTopic: Object.freeze(perTopic),
    everyTopicCovered: uncovered.length === 0,
    days_: days,
    notes: Object.freeze([
      `${totalMinutes} minutes over ${days} day${days === 1 ? '' : 's'}, divided across ${topics.length} topic${topics.length === 1 ? '' : 's'} by weight.`,
      'Topics are rotated across days rather than blocked into one each. Interleaving beats blocking on every test of later retention, even though it feels worse while doing it — that is the one pedagogical choice this plan makes.',
      'The weights are yours. This engine cannot know which topic matters most or which you are weakest at, and it does not pretend to.',
      `Blocks are at least ${minimumBlock} minutes, because below that the cost of switching subject outweighs the time spent on it.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface WorkloadReport {
  /** Total reviews due on each day. */
  days: readonly { day: number; due: number; minutes: number }[]
  /** The busiest day, which is what makes a schedule collapse. */
  peak: { day: number; due: number; minutes: number }
  averagePerDay: number
  /** How uneven the load is: the peak over the average. */
  peakRatio: number
  totalReviews: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * How much review work a set of cards will generate, day by day.
 *
 * The peak matters more than the average, which is the point of this calculation. A deck averaging thirty reviews a
 * day with a peak of four hundred is unusable, and the peak arrives from cards added on the same day coming due
 * together — which is invisible until it happens.
 */
export function reviewWorkload(input: {
  /** Each card with the day its next review falls and how its interval grows. */
  cards: readonly { dueDay: number; interval: number; growth?: number }[]
  days: number
  /** Seconds per review, for the minute figures. */
  secondsPerReview?: number
}): WorkloadReport | LearningError {
  const { cards, days } = input
  if (cards.length === 0) return fail('too-few', 'There are no cards.')
  if (cards.length > LEARNING_LIMITS.cards) return fail('too-many', `That is ${cards.length} cards; this handles up to ${LEARNING_LIMITS.cards}.`)
  if (!Number.isInteger(days) || days < 1 || days > LEARNING_LIMITS.days) {
    return fail('invalid-argument', `The number of days has to be a whole number from 1 to ${LEARNING_LIMITS.days}.`)
  }
  const seconds = input.secondsPerReview ?? 10
  if (!finite(seconds) || seconds <= 0) return fail('invalid-argument', 'The seconds per review has to be greater than zero.')

  const due = new Array<number>(days + 1).fill(0)
  for (const [i, card] of cards.entries()) {
    if (!finite(card.dueDay) || !finite(card.interval)) return fail('not-finite', `Card ${i + 1} has a value that is not finite.`)
    if (card.interval <= 0) return fail('invalid-argument', `Card ${i + 1} has an interval of ${card.interval}; it has to be greater than zero.`)
    const growth = card.growth ?? 2.5
    if (!finite(growth) || growth < 1) return fail('invalid-argument', `Card ${i + 1} has a growth factor below 1, which would shorten its interval for ever.`)
    let day = Math.round(card.dueDay)
    let interval = card.interval
    let guard = 0
    while (day <= days && guard < LEARNING_LIMITS.days) {
      if (day >= 1) due[day] += 1
      interval *= growth
      day += Math.max(1, Math.round(interval))
      guard += 1
    }
  }

  const list = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    due: due[i + 1],
    minutes: (due[i + 1] * seconds) / 60
  }))
  const peak = list.reduce((best, one) => (one.due > best.due ? one : best))
  const total = list.reduce((sum, one) => sum + one.due, 0)
  const average = total / days

  const warnings: string[] = []
  const ratio = average === 0 ? 0 : peak.due / average
  if (ratio > 3) {
    warnings.push(
      `The busiest day has ${peak.due} reviews against an average of ${average.toFixed(1)} — ${ratio.toFixed(1)} times. Cards added on the same day come due together, and a peak like this is what makes a schedule get abandoned. Spreading the additions out fixes it and nothing else does.`
    )
  }
  if (peak.minutes > 90) {
    warnings.push(`The busiest day is ${peak.minutes.toFixed(0)} minutes of reviews. Anything past about an hour tends not to get done.`)
  }

  return {
    days: Object.freeze(list),
    peak,
    averagePerDay: average,
    peakRatio: ratio,
    totalReviews: total,
    notes: Object.freeze([
      `${total} reviews over ${days} days, averaging ${average.toFixed(1)} a day and peaking at ${peak.due} on day ${peak.day}.`,
      'The peak matters more than the average. A deck averaging half an hour a day with a four-hour peak is not a deck anybody keeps up with.',
      `Time figures assume ${seconds} seconds a review, which is a guess about you rather than a fact about the cards.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const LEARNING_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every schedule names its algorithm and states its limitation. SM-2 and FSRS-style scheduling give different intervals for the same card.',
  'The grade scale is SM-2’s: 0-2 is a lapse and 3 is a difficult pass. Almost all of a scheduler’s behaviour turns on that boundary.',
  'Retention estimates name the forgetting curve they assume and report what the other curve would say, because the two disagree most past a few weeks.',
  'A forgetting curve is a model, not a measurement of the learner. The often-quoted Ebbinghaus figures came from nonsense syllables and one subject.',
  'Mastery estimates are shrunk toward a neutral prior and reported with an interval. A perfect run of three is not mastery.',
  'Study plans divide time by weights the caller sets. This engine cannot know which topic matters or which is weakest.',
  'Topics are interleaved rather than blocked, which is better for retention and feels worse while doing it.',
  'Workload projections report the peak as well as the average, because the peak is what makes a schedule collapse.',
  'This engine does not grade answers, judge understanding or predict exam results.'
])
