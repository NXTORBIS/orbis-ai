/**
 * Designing an experiment, running it, and keeping what it found.
 *
 * ## What this is for
 *
 * The other chemistry modules each answer one question: what does this titration curve look like, what is this
 * rate constant. This is the one that asks whether an answer means anything — you state what you are varying and
 * what you expect, it runs the measurement across the range, and it reports whether the result supports what you
 * said before you looked.
 *
 * ## The honesty rules, which are the whole point
 *
 * - **The expectation is recorded before the run.** A hypothesis written after the data is not a hypothesis, and
 *   this makes that impossible rather than discouraged: `design` returns a sealed plan and `run` will not take a
 *   plan whose expectation was changed.
 * - **"Not supported" is a result.** It is reported as plainly as a confirmation. A workspace that only ever
 *   agreed with you would be worth nothing.
 * - **Noise is declared, not hidden.** A run with scatter says how much, and a trend smaller than the scatter is
 *   reported as "cannot tell from this", never as a weak yes.
 * - **Nothing is invented.** The measurement comes from whatever function is handed in — one of the real
 *   chemistry engines — and if it refuses for some input, that point is recorded as missing rather than filled.
 */

export interface ExperimentProblem {
  problem: string
  fix: string
}

export const isExperimentProblem = (held: unknown): held is ExperimentProblem =>
  typeof held === 'object' && held !== null && 'problem' in held

const no = (problem: string, fix: string): ExperimentProblem => ({ problem, fix })

/** What a run is expected to show. Stated first, which is what makes it a prediction. */
export type Expectation = 'rises' | 'falls' | 'peaks' | 'flattens' | 'no-change' | 'unsure'

export const EXPECTATIONS: readonly { id: Expectation; label: string; about: string }[] = Object.freeze([
  { id: 'rises', label: 'Goes up', about: 'The measurement increases as the variable increases.' },
  { id: 'falls', label: 'Goes down', about: 'The measurement decreases as the variable increases.' },
  { id: 'peaks', label: 'Peaks in the middle', about: 'It rises and then falls, with a maximum somewhere inside the range.' },
  { id: 'flattens', label: 'Levels off', about: 'It changes at first and then stops changing — it saturates.' },
  { id: 'no-change', label: 'No change', about: 'The variable makes no difference to the measurement.' },
  { id: 'unsure', label: 'I do not know', about: 'Recorded as having no prediction. The result is still reported; it simply cannot support or contradict anything.' }
])

export interface Plan {
  /** What is being asked, in the person's own words. */
  question: string
  /** The name of what is varied, and its unit. */
  variable: string
  unit: string
  /** The range, and how many points across it. */
  from: number
  to: number
  points: number
  /** What is measured, and its unit. */
  measures: string
  measureUnit: string
  /** What is expected, recorded before anything runs. */
  expects: Expectation
  /** Why, in the person's own words. Optional, and worth having. */
  because: string
  /** How many times each point is measured. More repeats make a smaller trend visible through scatter. */
  repeats: number
  /** A fingerprint of everything above. `run` checks it, so a plan cannot be edited after the fact. */
  readonly sealed: string
}

export interface PlanRequest {
  question: string
  variable: string
  unit?: string
  from: number
  to: number
  points?: number
  measures: string
  measureUnit?: string
  expects: Expectation
  because?: string
  repeats?: number
}

const clean = (text: unknown, longest: number): string => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, longest)

/** A fingerprint of a plan, so a changed plan cannot be passed off as the original. */
function seal(of: Omit<Plan, 'sealed'>): string {
  const parts = [
    of.question, of.variable, of.unit, of.from, of.to, of.points,
    of.measures, of.measureUnit, of.expects, of.because, of.repeats
  ].join('\u001f')
  // A small non-cryptographic hash. This stops an accident, not an attacker -- there is no adversary here, only
  // the very human temptation to adjust what you predicted once you have seen the answer.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < parts.length; i += 1) {
    const c = parts.charCodeAt(i)
    h1 = (h1 ^ c) * 16777619 >>> 0
    h2 = (h2 + c * (i + 1)) >>> 0
  }
  return `${h1.toString(36)}-${h2.toString(36)}-${parts.length.toString(36)}`
}

/**
 * Seals a plan, or says what is wrong with it.
 *
 * Refuses rather than tidies. A range of zero width, one point, or no question at all are each a plan that
 * cannot answer anything, and running it would produce a result-shaped thing that means nothing.
 */
export function design(request: PlanRequest): Plan | ExperimentProblem {
  const question = clean(request.question, 240)
  if (question.length < 5) {
    return no('The question is too short to be a question.', 'Write what you are trying to find out, in a sentence.')
  }

  const variable = clean(request.variable, 60)
  if (variable === '') return no('Nothing is named as the thing being varied.', 'Name what you are changing — a temperature, a concentration.')

  const measures = clean(request.measures, 60)
  if (measures === '') return no('Nothing is named as the thing being measured.', 'Name what you are reading off — a rate, a yield, a pH.')

  if (!Number.isFinite(request.from) || !Number.isFinite(request.to)) {
    return no('The range must be two numbers.', 'Give the value to start at and the value to finish at.')
  }
  if (request.from === request.to) {
    return no('The range has no width.', `Vary ${variable} across a range, or there is nothing to see.`)
  }

  const points = Math.round(request.points ?? 12)
  if (!Number.isFinite(points) || points < 3) {
    return no('Three points is the fewest that can show a trend.', 'Two points always look like a straight line.')
  }
  if (points > 500) return no('More than 500 points is not an experiment, it is a plot.', 'Use 500 or fewer.')

  const repeats = Math.round(request.repeats ?? 1)
  if (!Number.isFinite(repeats) || repeats < 1 || repeats > 50) {
    return no('Repeats must be between 1 and 50.', 'More repeats make a smaller trend visible through scatter.')
  }

  if (!EXPECTATIONS.some((one) => one.id === request.expects)) {
    return no('That is not one of the expectations.', `Pick one of: ${EXPECTATIONS.map((one) => one.label).join(', ')}.`)
  }

  const without: Omit<Plan, 'sealed'> = {
    question,
    variable,
    unit: clean(request.unit, 20),
    from: request.from,
    to: request.to,
    points,
    measures,
    measureUnit: clean(request.measureUnit, 20),
    expects: request.expects,
    because: clean(request.because, 400),
    repeats
  }
  return { ...without, sealed: seal(without) }
}

// ---------------------------------------------------------------- running it

/** One point: what was set, and what was read. */
export interface Reading {
  at: number
  /** The mean of the repeats, or null when every repeat refused. */
  value: number | null
  /** The spread across the repeats. Zero when there was only one. */
  spread: number
  /** How many repeats gave a number. */
  got: number
  /** Why a point is missing, when it is. */
  missing?: string
}

export type Measure = (at: number, repeat: number) => number | { refused: string }

export interface Finding {
  plan: Plan
  readings: readonly Reading[]
  /** What the readings actually do, worked out from them. */
  shows: Expectation
  /** Whether that matches what was expected. */
  supports: 'yes' | 'no' | 'cannot-tell'
  /** One sentence saying so, in plain words. */
  says: string
  /** The change from one end to the other, and the typical scatter, so the two can be compared. */
  change: number | null
  noise: number
  /** Where the maximum is, when there is one inside the range. */
  peakAt: number | null
  /** Points that could not be measured. */
  missed: number
}

/**
 * Runs a sealed plan and says what it found.
 *
 * The measurement is whatever function is handed in — one of the real chemistry engines, usually. A point the
 * measurement refuses is recorded as missing with the reason, never filled in, because a filled-in point is a
 * made-up result and this module exists to not do that.
 */
export function run(plan: Plan, measure: Measure): Finding | ExperimentProblem {
  if (seal(plan) !== plan.sealed) {
    return no(
      'This plan has been changed since it was designed.',
      'The expectation is recorded before the run on purpose. Design it again to run the changed version.'
    )
  }
  if (typeof measure !== 'function') return no('There is nothing to measure with.', 'A measurement function is needed.')

  const readings: Reading[] = []
  let missed = 0

  for (let i = 0; i < plan.points; i += 1) {
    const at = plan.from + ((plan.to - plan.from) * i) / (plan.points - 1)
    const got: number[] = []
    let refusal: string | null = null
    for (let r = 0; r < plan.repeats; r += 1) {
      let one: number | { refused: string }
      try {
        one = measure(at, r)
      } catch (error) {
        one = { refused: error instanceof Error ? error.message : 'the measurement threw' }
      }
      if (typeof one === 'number' && Number.isFinite(one)) got.push(one)
      else if (typeof one === 'object' && one !== null && 'refused' in one) refusal = refusal ?? one.refused
      else refusal = refusal ?? 'the measurement gave something that is not a number'
    }
    if (got.length === 0) {
      missed += 1
      readings.push({ at, value: null, spread: 0, got: 0, missing: refusal ?? 'no reading' })
      continue
    }
    const mean = got.reduce((a, b) => a + b, 0) / got.length
    const spread =
      got.length < 2 ? 0 : Math.sqrt(got.reduce((sum, one) => sum + (one - mean) ** 2, 0) / (got.length - 1))
    readings.push({ at, value: mean, spread, got: got.length })
  }

  const real = readings.filter((one): one is Reading & { value: number } => one.value !== null)
  if (real.length < 3) {
    return no(
      `Only ${real.length} of ${plan.points} points could be measured.`,
      'Three is the fewest that can show a trend. Check the range is one the measurement accepts.'
    )
  }

  /*
   * The typical scatter.
   *
   * From the repeats where there are repeats, and from how much the curve wanders point to point where there are
   * not. Something is needed either way: a trend has to be compared against something to be called a trend.
   */
  const spreads = real.map((one) => one.spread).filter((one) => one > 0)
  const noise =
    spreads.length > 0
      ? spreads.reduce((a, b) => a + b, 0) / spreads.length
      : wobble(real.map((one) => one.value))

  const first = real[0].value
  const last = real[real.length - 1].value
  const change = last - first

  let highest = 0
  let lowest = 0
  for (let i = 1; i < real.length; i += 1) {
    if (real[i].value > real[highest].value) highest = i
    if (real[i].value < real[lowest].value) lowest = i
  }
  const span = real[highest].value - real[lowest].value

  const shows = readAs(real.map((one) => one.value), noise)
  const peakAt =
    shows === 'peaks' && highest > 0 && highest < real.length - 1 ? real[highest].at : null

  /*
   * Whether the readings support the expectation.
   *
   * "Cannot tell" is a first-class answer: when the whole span is inside the scatter there is no trend to agree
   * or disagree with, and calling that a weak yes is how a null result becomes a claim.
   */
  let supports: Finding['supports']
  if (plan.expects === 'unsure') supports = 'cannot-tell'
  else if (span <= noise * 2 && plan.expects !== 'no-change') supports = 'cannot-tell'
  else supports = shows === plan.expects ? 'yes' : 'no'

  const named = (what: Expectation): string => EXPECTATIONS.find((one) => one.id === what)?.label ?? what

  const says =
    supports === 'cannot-tell' && plan.expects === 'unsure'
      ? `No prediction was recorded, so there is nothing to support. The readings ${named(shows).toLowerCase()}.`
      : supports === 'cannot-tell'
        ? `Cannot tell from this run: ${plan.measures} varies by ${fmt(span)} across the range and the scatter is about ${fmt(noise)}, so there is no trend to see. More repeats, or a wider range.`
        : supports === 'yes'
          ? `The readings support it: ${plan.measures} ${named(shows).toLowerCase()} as ${plan.variable} increases, which is what was expected.`
          : `The readings do not support it: ${named(plan.expects).toLowerCase()} was expected, and ${plan.measures} ${named(shows).toLowerCase()} instead.`

  return { plan, readings, shows, supports, says, change, noise, peakAt, missed }
}

/** How much a series wanders point to point, as a stand-in for scatter when there are no repeats. */
function wobble(values: readonly number[]): number {
  if (values.length < 3) return 0
  /*
   * The second difference, not the first.
   *
   * The first difference includes the trend itself, so a strong clean trend would be reported as enormous noise
   * and every result would come back "cannot tell". The second difference is flat for a straight line, which is
   * what makes it a measure of roughness rather than of slope.
   */
  let total = 0
  for (let i = 2; i < values.length; i += 1) {
    total += Math.abs(values[i] - 2 * values[i - 1] + values[i - 2])
  }
  return total / (values.length - 2) / 2
}

/** What a series of readings actually does. */
function readAs(values: readonly number[], noise: number): Expectation {
  let highest = 0
  let lowest = 0
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[highest]) highest = i
    if (values[i] < values[lowest]) lowest = i
  }
  const span = values[highest] - values[lowest]
  if (span <= noise * 2) return 'no-change'

  const first = values[0]
  const last = values[values.length - 1]
  const inside = highest > 0 && highest < values.length - 1
  const insideLow = lowest > 0 && lowest < values.length - 1

  // A maximum inside the range, standing clear of both ends, is a peak.
  if (inside && values[highest] - Math.max(first, last) > noise * 2) return 'peaks'
  // The same the other way up still reads as a peak in shape; say so rather than calling it a rise.
  if (insideLow && Math.min(first, last) - values[lowest] > noise * 2) return 'peaks'

  /*
   * Levelling off: the second half of the range changes much less than the first.
   *
   * Checked before the direction, because a curve that saturates also rises, and "levels off" is the more
   * specific and more useful of the two answers.
   */
  const middle = Math.floor(values.length / 2)
  const early = Math.abs(values[middle] - first)
  const late = Math.abs(last - values[middle])
  if (early > noise * 2 && late < early * 0.35) return 'flattens'

  return last > first ? 'rises' : 'falls'
}

const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const size = Math.abs(value)
  if (size === 0) return '0'
  if (size >= 1e-3 && size < 1e6) return String(Number(value.toPrecision(3)))
  return value.toExponential(2)
}

// ---------------------------------------------------------------- keeping it

export interface Record {
  id: string
  /** When it was run, as an ISO string. Supplied, so nothing here reads the clock. */
  at: string
  plan: Plan
  shows: Expectation
  supports: Finding['supports']
  says: string
  /** The readings, so the record can be plotted again without re-running. */
  readings: readonly Reading[]
}

/** A finding as a record to keep. Nothing is recomputed, so what is kept is what was seen. */
export function toRecord(finding: Finding, id: string, at: string): Record {
  return {
    id,
    at,
    plan: finding.plan,
    shows: finding.shows,
    supports: finding.supports,
    says: finding.says,
    readings: finding.readings
  }
}

/**
 * Reads a record back, returning null for anything that is not one.
 *
 * Unreadable is not the same as absent: a caller that cannot read a row should leave it alone rather than write
 * a default over it. Returning null says "this one could not be read", and the caller decides.
 */
export function readRecord(held: unknown): Record | null {
  if (typeof held !== 'object' || held === null) return null
  const row = held as Partial<Record>
  if (typeof row.id !== 'string' || typeof row.at !== 'string') return null
  if (typeof row.plan !== 'object' || row.plan === null) return null
  const plan = row.plan as Partial<Plan>
  if (typeof plan.question !== 'string' || typeof plan.variable !== 'string') return null
  if (!Array.isArray(row.readings)) return null
  return {
    id: row.id,
    at: row.at,
    plan: row.plan as Plan,
    shows: (EXPECTATIONS.some((one) => one.id === row.shows) ? row.shows : 'unsure') as Expectation,
    supports: row.supports === 'yes' || row.supports === 'no' ? row.supports : 'cannot-tell',
    says: typeof row.says === 'string' ? row.says : '',
    readings: row.readings as Reading[]
  }
}

/** What this module is and is not, for a screen to show rather than a manual. */
export const aboutThis: readonly string[] = Object.freeze([
  'The expectation is recorded before the run, and a plan cannot be edited afterwards and re-run as though it were the original. That is the one rule the whole module exists for.',
  '"Does not support it" is reported as plainly as a confirmation, and "cannot tell from this" as plainly as either. A workspace that always agreed with you would be worth nothing.',
  'A trend smaller than the scatter is reported as no trend. Add repeats or widen the range rather than reading a slope out of noise.',
  'The measurement comes from whichever chemistry module you point it at. A point that module refuses is recorded as missing, with the reason — never filled in.',
  'This is a model, not a bench. It tells you what the model says under the conditions you set, which is a different thing from what a real experiment would measure.'
])
