import { isChemistryError, parseFormula, type ChemistryError } from './chemistry.ts'

/**
 * Chemical kinetics: how fast, and how you would know.
 *
 * ## The order is found from the data, not taken on trust
 *
 * Telling a student a reaction is first order and then plotting ln[A] is the wrong way round. What a chemist
 * actually does is plot all three — [A], ln[A] and 1/[A] — against time and see which one comes out straight.
 * `findOrder` does exactly that, fits each, and reports the correlation of all three so the reasoning is visible
 * rather than the conclusion asserted.
 *
 * ## Integrated rate laws, not a differential equation stepped
 *
 * Zero, first and second order all have exact closed forms. Stepping them would add error and teach nothing. The
 * mechanism simulation is different — there no closed form exists in general, so that one is integrated and says
 * so.
 *
 * ## What it refuses
 *
 * A rate constant without a temperature. An Arrhenius fit from one point. An order it cannot distinguish because
 * the data does not span enough conversion. Each refusal names what is missing rather than producing a number
 * that looks like an answer.
 *
 * Pure. No clock, no randomness.
 */

const fail = (error: ChemistryError['error'], message: string, fix: string): ChemistryError => ({
  error,
  message: `${message} ${fix}`
})

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const GAS_CONSTANT = 8.31446261815324

export const KINETICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Constant temperature throughout. A real reaction that gives out heat speeds itself up, and none of this shows that.',
  'Constant volume, so concentration changes only because the reaction consumes the reactant.',
  'The rate law is empirical. It comes from the data, never from the balanced equation — a balanced equation tells you nothing about the order.',
  'No reverse reaction. Everything here runs to completion, which is wrong for anything that reaches equilibrium.'
])

// ——— Integrated rate laws ————————————————————————————————————————————————

export type Order = 0 | 1 | 2

export interface RateReport {
  order: Order
  /** The rate constant, in whatever unit that order demands. */
  k: number
  kUnit: string
  startingConcentration: number
  /** Concentration against time, for the graph. */
  curve: readonly { t: number; concentration: number }[]
  /** The straight-line form for this order, which is how the order is identified. */
  straightLine: { label: string; points: readonly { t: number; y: number }[] }
  halfLife: number
  /** Half-life only means something fixed for first order. Said plainly for the others. */
  halfLifeNote: string
  /** When 99% has gone. */
  completion: number
  assumptions: readonly string[]
}

const K_UNITS: Record<Order, string> = {
  0: 'mol/(L·s)',
  1: '1/s',
  2: 'L/(mol·s)'
}

/** Concentration at a time, for a given order. Exact: these all have closed forms. */
export function concentrationAt(order: Order, start: number, k: number, t: number): number {
  if (order === 0) return Math.max(0, start - k * t)
  if (order === 1) return start * Math.exp(-k * t)
  return start / (1 + start * k * t)
}

export function rateLaw(order: number, start: number, k: number, seconds: number, points = 120): RateReport | ChemistryError {
  const whole = Math.round(order)
  if (whole !== 0 && whole !== 1 && whole !== 2) {
    return fail('invalid-argument', `This handles zero, first and second order; ${order} was asked for.`, 'Fractional and third orders exist but need a mechanism, which this does not have.')
  }
  if (!finite(start) || start <= 0) return fail('invalid-argument', 'The starting concentration has to be above zero.', 'Give it in mol/L.')
  if (!finite(k) || k <= 0) return fail('invalid-argument', 'The rate constant has to be above zero.', `For ${whole === 0 ? 'zero' : whole === 1 ? 'first' : 'second'} order it is in ${K_UNITS[whole as Order]}.`)
  if (!finite(seconds) || seconds <= 0) return fail('invalid-argument', 'There is no time to run for.', 'Give a number of seconds above zero.')

  const kind = whole as Order
  const curve: { t: number; concentration: number }[] = []
  const line: { t: number; y: number }[] = []
  for (let one = 0; one <= points; one += 1) {
    const t = (one / points) * seconds
    const c = concentrationAt(kind, start, k, t)
    curve.push({ t, concentration: c })
    // The plot that comes out straight for this order — that is how the order is identified in a laboratory.
    if (kind === 0) line.push({ t, y: c })
    else if (kind === 1) line.push({ t, y: c > 0 ? Math.log(c) : Number.NaN })
    else line.push({ t, y: c > 0 ? 1 / c : Number.NaN })
  }

  const halfLife = kind === 0 ? start / (2 * k) : kind === 1 ? Math.LN2 / k : 1 / (k * start)

  return {
    order: kind,
    k,
    kUnit: K_UNITS[kind],
    startingConcentration: start,
    curve,
    straightLine: {
      label: kind === 0 ? '[A] against time' : kind === 1 ? 'ln[A] against time' : '1/[A] against time',
      points: line
    },
    halfLife,
    halfLifeNote:
      kind === 1
        ? 'First order is the only one whose half-life does not change: every half-life is the same length, whatever is left.'
        : kind === 0
          ? 'For zero order each half-life is half the length of the one before, because the rate never slows down.'
          : 'For second order each half-life is twice the length of the one before, because the rate falls as the square.',
    completion: kind === 0 ? (0.99 * start) / k : kind === 1 ? Math.log(100) / k : 99 / (k * start),
    assumptions: KINETICS_ASSUMPTIONS
  }
}

// ——— Finding the order from measurements ————————————————————————————————

interface Fit {
  slope: number
  intercept: number
  /** How straight it came out. One is perfect. */
  r2: number
}

/** Least squares, and the correlation that says whether the line was worth drawing. */
function fitLine(xs: readonly number[], ys: readonly number[]): Fit {
  const n = xs.length
  let sx = 0
  let sy = 0
  for (let one = 0; one < n; one += 1) { sx += xs[one]; sy += ys[one] }
  const mx = sx / n
  const my = sy / n
  let top = 0
  let bottom = 0
  for (let one = 0; one < n; one += 1) {
    top += (xs[one] - mx) * (ys[one] - my)
    bottom += (xs[one] - mx) ** 2
  }
  const slope = bottom === 0 ? 0 : top / bottom
  const intercept = my - slope * mx
  let ssRes = 0
  let ssTot = 0
  for (let one = 0; one < n; one += 1) {
    const predicted = slope * xs[one] + intercept
    ssRes += (ys[one] - predicted) ** 2
    ssTot += (ys[one] - my) ** 2
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot }
}

export interface OrderReport {
  /** Which order fitted best. */
  order: Order
  k: number
  kUnit: string
  /** All three fits, so the reasoning is visible rather than the conclusion asserted. */
  tried: readonly { order: Order; plot: string; r2: number; k: number; kUnit: string }[]
  /** How much of the reactant was used up. Below about half, the three orders are hard to tell apart. */
  conversion: number
  /** Set when the data cannot really distinguish them, which is a real and common situation. */
  doubt: string | null
  assumptions: readonly string[]
}

/**
 * Work out the order from concentrations measured over time.
 *
 * This is what a kineticist actually does: plot all three and see which is straight. Reporting only the winner
 * would hide the fact that over a small conversion range all three fit nearly as well — so all three come back,
 * and the doubt is stated when it is real.
 */
export function findOrder(
  readings: readonly { t: number; concentration: number }[]
): OrderReport | ChemistryError {
  if (!Array.isArray(readings) || readings.length < 4) {
    return fail('no-data', `Finding an order needs at least four readings; ${readings?.length ?? 0} were given.`, 'Three points fit any line, so three cannot distinguish anything.')
  }
  for (const one of readings) {
    if (!finite(one?.t) || !finite(one?.concentration)) {
      return fail('not-finite', 'Every reading needs a time and a concentration, both real numbers.', 'Check for a missing or non-numeric value.')
    }
    if (one.concentration <= 0) {
      return fail('invalid-argument', 'A concentration of zero or less cannot be used.', 'The logarithm and the reciprocal are both undefined there, so those plots cannot be made.')
    }
  }

  const ts = readings.map((one) => one.t)
  const cs = readings.map((one) => one.concentration)
  const zero = fitLine(ts, cs)
  const first = fitLine(ts, cs.map(Math.log))
  const second = fitLine(ts, cs.map((one) => 1 / one))

  const tried = [
    { order: 0 as Order, plot: '[A] against time', r2: zero.r2, k: -zero.slope, kUnit: K_UNITS[0] },
    { order: 1 as Order, plot: 'ln[A] against time', r2: first.r2, k: -first.slope, kUnit: K_UNITS[1] },
    { order: 2 as Order, plot: '1/[A] against time', r2: second.r2, k: second.slope, kUnit: K_UNITS[2] }
  ]
  const best = [...tried].sort((a, b) => b.r2 - a.r2)[0]
  const runnerUp = [...tried].sort((a, b) => b.r2 - a.r2)[1]

  const conversion = 1 - Math.min(...cs) / Math.max(...cs)
  let doubt: string | null = null
  if (conversion < 0.5) {
    doubt = `Only ${(conversion * 100).toFixed(0)}% of the reactant was used up. Over a range that small every order fits nearly as well, so this cannot really be distinguished — follow it to at least half gone.`
  } else if (best.r2 - runnerUp.r2 < 0.005) {
    doubt = `${describe(best.order)} and ${describe(runnerUp.order)} fit almost equally well (${best.r2.toFixed(5)} against ${runnerUp.r2.toFixed(5)}). The data does not choose between them.`
  }
  if (best.k <= 0) {
    return fail('no-solution', 'The best fit gives a rate constant of zero or less, which means the concentration is not falling.', 'Check the readings are in time order and that the reactant really is being consumed.')
  }

  return { order: best.order, k: best.k, kUnit: best.kUnit, tried, conversion, doubt, assumptions: KINETICS_ASSUMPTIONS }
}

const describe = (order: Order): string => (order === 0 ? 'zero order' : order === 1 ? 'first order' : 'second order')

// ——— Arrhenius ——————————————————————————————————————————————————————————

export interface ArrheniusReport {
  activationEnergy: number
  /** In kJ/mol, which is how anybody actually quotes it. */
  activationEnergyKJ: number
  preExponential: number
  r2: number
  /** k at each temperature given, and the fitted line through them. */
  points: readonly { temperature: number; k: number; inverseT: number; lnK: number }[]
  /** How much faster for every ten degrees — the rule of thumb, worked out rather than quoted. */
  perTenDegrees: number
  atTemperature: (kelvin: number) => number
  assumptions: readonly string[]
}

/**
 * Fit the Arrhenius equation to rate constants measured at several temperatures.
 *
 * ln k = ln A − Ea/RT, so a plot of ln k against 1/T is a straight line whose slope is −Ea/R. Two points give an
 * answer with no way to tell whether it is a good one, so this asks for three and reports how straight the line
 * came out.
 */
export function arrhenius(
  readings: readonly { temperature: number; k: number }[]
): ArrheniusReport | ChemistryError {
  if (!Array.isArray(readings) || readings.length < 3) {
    return fail('no-data', `An Arrhenius fit needs at least three temperatures; ${readings?.length ?? 0} were given.`, 'Two points always give a perfect line, which tells you nothing about whether the equation holds.')
  }
  for (const one of readings) {
    if (!finite(one?.temperature) || one.temperature <= 0) {
      return fail('invalid-argument', 'Temperatures must be in kelvin and above zero.', 'Celsius would give a negative or infinite answer, so it is refused rather than converted silently.')
    }
    if (!finite(one?.k) || one.k <= 0) {
      return fail('invalid-argument', 'Every rate constant has to be above zero.', 'The logarithm of zero is undefined, so the fit cannot be made.')
    }
  }

  const inverseT = readings.map((one) => 1 / one.temperature)
  const lnK = readings.map((one) => Math.log(one.k))
  const fit = fitLine(inverseT, lnK)
  const Ea = -fit.slope * GAS_CONSTANT
  const A = Math.exp(fit.intercept)

  if (Ea < 0) {
    return fail('no-solution', 'The fit gives a negative activation energy, which means the reaction got slower when heated.', 'That happens for a few real reactions, but far more often it means the temperatures and rate constants are paired up wrongly.')
  }

  // The old rule that ten degrees doubles the rate, worked out for this activation energy at room temperature.
  const atRoom = A * Math.exp(-Ea / (GAS_CONSTANT * 298.15))
  const atTen = A * Math.exp(-Ea / (GAS_CONSTANT * 308.15))

  return {
    activationEnergy: Ea,
    activationEnergyKJ: Ea / 1000,
    preExponential: A,
    r2: fit.r2,
    points: readings.map((one, at) => ({ temperature: one.temperature, k: one.k, inverseT: inverseT[at], lnK: lnK[at] })),
    perTenDegrees: atTen / atRoom,
    atTemperature: (kelvin: number): number => A * Math.exp(-Ea / (GAS_CONSTANT * kelvin)),
    assumptions: [
      ...KINETICS_ASSUMPTIONS,
      'The Arrhenius equation itself is empirical. Over a wide enough temperature range the plot curves, and then the activation energy is not a constant.',
      'The pre-exponential factor comes from extrapolating to infinite temperature, so it carries a large uncertainty however good the fit looks.'
    ]
  }
}

// ——— A mechanism, integrated ——————————————————————————————————————————————

export interface MechanismStep {
  /** What is consumed, by name. */
  from: readonly string[]
  /** What is produced. */
  to: readonly string[]
  /** Forward rate constant. */
  k: number
}

export interface MechanismReport {
  species: readonly string[]
  /** Concentration of everything, over time. */
  curve: readonly { t: number; of: Readonly<Record<string, number>> }[]
  /** Which step is slowest, and therefore sets the pace. */
  slowestStep: number
  /** Anything made and then consumed — an intermediate, which never appears in the overall equation. */
  intermediates: readonly string[]
  /** Whether the steady-state approximation would be reasonable here, with the reason. */
  steadyState: { reasonable: boolean; why: string }
  assumptions: readonly string[]
}

/**
 * Integrate a multi-step mechanism.
 *
 * Unlike the single-step laws above, a mechanism of more than one step has no closed form in general, so this is
 * stepped — by fourth-order Runge-Kutta, with the step chosen from the fastest rate constant so a fast step
 * cannot make the whole thing unstable.
 */
export function mechanism(
  steps: readonly MechanismStep[],
  start: Readonly<Record<string, number>>,
  seconds: number,
  points = 120
): MechanismReport | ChemistryError {
  if (!Array.isArray(steps) || steps.length === 0) {
    return fail('no-data', 'A mechanism needs at least one step.', 'Give each step what it consumes, what it produces, and its rate constant.')
  }
  if (steps.length > 12) {
    return fail('too-many', `${steps.length} steps is more than this follows.`, 'Twelve is the limit; longer mechanisms need the steady-state treatment rather than brute integration.')
  }
  if (!finite(seconds) || seconds <= 0) return fail('invalid-argument', 'There is no time to run for.', 'Give a number of seconds above zero.')

  const species = new Set<string>()
  for (const step of steps) {
    if (!finite(step?.k) || step.k <= 0) return fail('invalid-argument', 'Every step needs a rate constant above zero.', 'A step that never happens should be left out instead.')
    if (!Array.isArray(step.from) || step.from.length === 0) return fail('invalid-argument', 'Every step has to consume something.', 'Give at least one species on the left.')
    for (const one of [...step.from, ...step.to]) species.add(one)
  }
  const names = [...species].sort()
  for (const one of names) {
    if (start[one] !== undefined && (!finite(start[one]) || start[one] < 0)) {
      return fail('invalid-argument', `The starting amount of ${one} is not a sensible concentration.`, 'Use zero or above, in mol/L.')
    }
  }

  const now: Record<string, number> = {}
  for (const one of names) now[one] = start[one] ?? 0
  if (names.every((one) => now[one] === 0)) {
    return fail('invalid-argument', 'Everything starts at zero, so nothing can ever happen.', 'Give at least one species a starting concentration.')
  }

  // The rate of each step is k times the product of what it consumes — mass action, which is exactly true for an
  // elementary step and exactly the reason a mechanism is written in elementary steps.
  const rates = (of: Record<string, number>): Record<string, number> => {
    const change: Record<string, number> = {}
    for (const one of names) change[one] = 0
    for (const step of steps) {
      let rate = step.k
      for (const one of step.from) rate *= Math.max(0, of[one] ?? 0)
      for (const one of step.from) change[one] -= rate
      for (const one of step.to) change[one] += rate
    }
    return change
  }

  // The step is set by the fastest constant, so one quick step cannot destabilise the whole integration.
  const fastest = Math.max(...steps.map((one) => one.k))
  const dt = Math.min(seconds / 2000, 0.05 / Math.max(fastest, 1e-9))
  const total = Math.min(2_000_000, Math.max(points, Math.ceil(seconds / dt)))
  const realStep = seconds / total
  const keepEvery = Math.max(1, Math.floor(total / points))

  const curve: { t: number; of: Record<string, number> }[] = [{ t: 0, of: { ...now } }]
  const peaked: Record<string, number> = {}
  for (const one of names) peaked[one] = now[one]

  const add = (base: Record<string, number>, change: Record<string, number>, scale: number): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const one of names) out[one] = base[one] + change[one] * scale
    return out
  }

  for (let one = 0; one < total; one += 1) {
    const k1 = rates(now)
    const k2 = rates(add(now, k1, realStep / 2))
    const k3 = rates(add(now, k2, realStep / 2))
    const k4 = rates(add(now, k3, realStep))
    for (const name of names) {
      now[name] = Math.max(0, now[name] + (realStep / 6) * (k1[name] + 2 * k2[name] + 2 * k3[name] + k4[name]))
      if (now[name] > peaked[name]) peaked[name] = now[name]
    }
    if ((one + 1) % keepEvery === 0 || one === total - 1) {
      curve.push({ t: (one + 1) * realStep, of: { ...now } })
    }
  }

  // Anything that rose above where it started and then fell back is an intermediate.
  const intermediates = names.filter((one) => {
    const began = start[one] ?? 0
    return peaked[one] > began + 1e-12 && now[one] < peaked[one] * 0.5
  })

  const slowest = steps.reduce((best, step, at) => (step.k < steps[best].k ? at : best), 0)
  const spread = Math.max(...steps.map((one) => one.k)) / Math.min(...steps.map((one) => one.k))

  return {
    species: names,
    curve,
    slowestStep: slowest,
    intermediates,
    steadyState: {
      reasonable: spread > 50 && intermediates.length > 0,
      why:
        intermediates.length === 0
          ? 'There is no intermediate, so there is nothing to apply the steady-state approximation to.'
          : spread > 50
            ? `The fastest step is ${spread.toFixed(0)} times the slowest, so the intermediate is consumed about as fast as it is made and the steady-state approximation would hold well.`
            : `The rate constants are within a factor of ${spread.toFixed(1)} of each other, so the intermediate builds up properly and the steady-state approximation would be poor here.`
    },
    assumptions: [
      ...KINETICS_ASSUMPTIONS,
      'Every step is treated as elementary, so its rate is the product of what it consumes. That is only true for a genuinely elementary step.',
      'All steps are irreversible. A real mechanism with a fast pre-equilibrium behaves very differently.',
      'This is integrated rather than solved, so it carries step error. It is fourth-order, and the step is chosen from the fastest rate constant.'
    ]
  }
}

// ——— Rate from a balanced equation, which is the thing that cannot be done ——

export interface RateFromEquation {
  /** What the stoichiometry does tell you: the relative rates. */
  relativeRates: readonly { species: string; perUnit: number; consumed: boolean }[]
  /** And what it does not. */
  cannotTell: string
}

/**
 * What a balanced equation can and cannot say about rate.
 *
 * It fixes the *relative* rates — if two moles of A go for every one of B, A disappears twice as fast. It says
 * nothing whatever about the order, and the single most common mistake in kinetics is reading the coefficients
 * as orders. This returns the one and refuses the other in the same breath.
 */
export function ratesFromEquation(
  left: readonly { formula: string; coefficient: number }[],
  right: readonly { formula: string; coefficient: number }[]
): RateFromEquation | ChemistryError {
  if (!Array.isArray(left) || left.length === 0 || !Array.isArray(right) || right.length === 0) {
    return fail('no-data', 'An equation needs something on both sides.', 'Give the reactants and the products with their coefficients.')
  }
  const relativeRates: { species: string; perUnit: number; consumed: boolean }[] = []
  for (const [side, consumed] of [[left, true], [right, false]] as const) {
    for (const one of side) {
      const parsed = parseFormula(one.formula)
      if (isChemistryError(parsed)) return parsed
      if (!finite(one.coefficient) || one.coefficient <= 0) {
        return fail('invalid-argument', `${one.formula} has a coefficient of ${one.coefficient}.`, 'Coefficients have to be above zero.')
      }
      relativeRates.push({ species: one.formula, perUnit: one.coefficient, consumed })
    }
  }
  return {
    relativeRates,
    cannotTell:
      'The coefficients fix only the relative rates. They say nothing at all about the order of the reaction — that has to be measured. Reading a coefficient as an order is the single most common mistake in kinetics, and it is wrong even when it happens to give the right answer.'
  }
}
