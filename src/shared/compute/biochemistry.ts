/**
 * Biochemistry: enzymes, proteins, and how tightly things bind.
 *
 * The shared biochemistry engine for Orbis Pages. Every kinetic constant is fitted from the data given rather than
 * read off a graph by eye, every inhibition type is identified by which constant moved rather than asserted, and
 * anything fitted from too few points says so.
 *
 * ## Why the inhibition type is deduced, not declared
 *
 * Competitive, uncompetitive and non-competitive inhibition are told apart by *which* constant changes: competitive
 * raises the half-saturation constant and leaves the maximum rate alone, uncompetitive lowers the maximum and leaves
 * the ratio alone, non-competitive lowers the maximum without touching the constant. Given a control and an
 * inhibited series, that is a measurement rather than a matter of opinion — so this computes both constants for each
 * series and names the type the numbers point to, including "mixed" when they point at neither cleanly.
 *
 * ## Why a fit reports its own quality
 *
 * A Michaelis-Menten fit over three points at low substrate concentration can produce a confident-looking maximum
 * rate that the data cannot support at all — the curve has not begun to level off, so the maximum is an
 * extrapolation. Every fit reports the highest substrate concentration as a multiple of the fitted constant, which
 * is the number that says whether the plateau was actually observed.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * Km              vs  Kd            -- half-saturation of a turning enzyme against equilibrium binding
 * Vmax            vs  kcat          -- a rate depending on how much enzyme against a per-molecule rate
 * kcat/Km         vs  either alone  -- catalytic efficiency, which is what evolution optimises
 * affinity        vs  potency       -- how tightly it binds against how much effect it has
 * cooperative     vs  steep         -- a Hill coefficient above 1 against a curve that merely looks sharp
 * inhibition      vs  denaturation  -- binding that is reversible against protein that is gone
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface BiochemistryError {
  error: 'invalid-argument' | 'out-of-range' | 'insufficient-data' | 'no-solution' | 'bad-sequence'
  message: string
}

export const isBiochemistryError = (value: unknown): value is BiochemistryError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: BiochemistryError['error'], message: string): BiochemistryError => ({ error, message })

export const BIOCHEMISTRY_LIMITS = Object.freeze({ points: 5_000, iterations: 4_000, residues: 20_000 })

const GAS_CONSTANT = 8.314462618 // J/(mol K)

// ---------------------------------------------------------------- enzyme kinetics

export interface KineticsPoint {
  /** Substrate concentration, in whatever unit is consistent across the series. */
  substrate: number
  /** Initial reaction rate at that concentration. */
  rate: number
}

export interface KineticsFit {
  /** The maximum rate the curve approaches. */
  vmax: number
  /** The substrate concentration giving half the maximum rate. */
  km: number
  /** Turnover number, if the enzyme concentration was given. */
  kcat: number | null
  /** kcat/Km — the catalytic efficiency, which is what evolution actually optimises. */
  catalyticEfficiency: number | null
  /** Whether the diffusion limit has effectively been reached. */
  nearDiffusionLimit: boolean
  /** How far the fit agrees with the data. */
  rSquared: number
  /** The highest substrate concentration as a multiple of Km, which says whether the plateau was observed. */
  highestSubstrateOverKm: number
  /** What the fit predicts at each measured point. */
  predicted: readonly { substrate: number; observed: number; fitted: number; residual: number }[]
  /** A curve for drawing, at evenly spaced concentrations. */
  curve: readonly { substrate: number; rate: number }[]
  method: string
  notes: readonly string[]
  warnings: readonly string[]
}

const fitMichaelisMenten = (
  points: readonly KineticsPoint[]
): { vmax: number; km: number; rSquared: number; iterations: number } | BiochemistryError => {
  // A Lineweaver-Burk straight line gives the starting point. It is a bad final answer — inverting the rate
  // inflates the error on the slowest, least reliable measurements — so it is only used as a seed for the real fit.
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  let used = 0
  for (const point of points) {
    if (point.substrate <= 0 || point.rate <= 0) continue
    const x = 1 / point.substrate
    const y = 1 / point.rate
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
    used += 1
  }
  if (used < 2) return fail('insufficient-data', 'At least two points with a positive concentration and a positive rate are needed.')
  const denominator = used * sumXX - sumX * sumX
  let vmax: number
  let km: number
  if (Math.abs(denominator) < 1e-30) {
    vmax = Math.max(...points.map((one) => one.rate)) * 1.2
    km = Math.max(...points.map((one) => one.substrate)) / 2
  } else {
    const slope = (used * sumXY - sumX * sumY) / denominator
    const intercept = (sumY - slope * sumX) / used
    vmax = intercept > 0 ? 1 / intercept : Math.max(...points.map((one) => one.rate)) * 1.2
    km = slope > 0 ? slope * vmax : Math.max(...points.map((one) => one.substrate)) / 2
  }
  if (!Number.isFinite(vmax) || vmax <= 0) vmax = Math.max(...points.map((one) => one.rate)) * 1.2
  if (!Number.isFinite(km) || km <= 0) km = Math.max(...points.map((one) => one.substrate)) / 2

  // Gauss-Newton on the untransformed rate, which is where the errors actually live.
  let iterations = 0
  for (; iterations < 200; iterations += 1) {
    let j11 = 0
    let j12 = 0
    let j22 = 0
    let g1 = 0
    let g2 = 0
    for (const point of points) {
      const bottom = km + point.substrate
      if (bottom <= 0) continue
      const fitted = (vmax * point.substrate) / bottom
      const residual = point.rate - fitted
      const dVmax = point.substrate / bottom
      const dKm = (-vmax * point.substrate) / (bottom * bottom)
      j11 += dVmax * dVmax
      j12 += dVmax * dKm
      j22 += dKm * dKm
      g1 += dVmax * residual
      g2 += dKm * residual
    }
    // Damped, so a poorly conditioned system steps small rather than diverging.
    const lambda = 1e-9 * (j11 + j22 + 1)
    const a = j11 + lambda
    const d = j22 + lambda
    const det = a * d - j12 * j12
    if (Math.abs(det) < 1e-30) break
    const stepVmax = (d * g1 - j12 * g2) / det
    const stepKm = (a * g2 - j12 * g1) / det
    const nextVmax = vmax + stepVmax
    const nextKm = km + stepKm
    vmax = nextVmax > 0 ? nextVmax : vmax / 2
    km = nextKm > 0 ? nextKm : km / 2
    if (Math.abs(stepVmax) < 1e-12 * Math.max(1, vmax) && Math.abs(stepKm) < 1e-12 * Math.max(1, km)) break
  }

  const meanRate = points.reduce((sum, one) => sum + one.rate, 0) / points.length
  let residualSum = 0
  let totalSum = 0
  for (const point of points) {
    const fitted = (vmax * point.substrate) / (km + point.substrate)
    residualSum += Math.pow(point.rate - fitted, 2)
    totalSum += Math.pow(point.rate - meanRate, 2)
  }
  const rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum
  return { vmax, km, rSquared, iterations }
}

/**
 * Fit the Michaelis-Menten equation to an initial-rate series.
 *
 * The fit is done on the untransformed rate by damped Gauss-Newton. A Lineweaver-Burk straight line seeds it and is
 * not the answer: inverting the rate inflates the error on the slowest measurements, which is why a double-
 * reciprocal plot gives a confident line through points that barely constrain the maximum.
 *
 * The highest substrate concentration as a multiple of the fitted constant is the number to look at. Below about
 * twice Km the curve has not begun to level off, so the maximum rate is an extrapolation rather than a measurement,
 * and this says so plainly.
 */
export function enzymeKinetics(input: {
  points: readonly KineticsPoint[]
  /** Total enzyme concentration, which turns the maximum rate into a turnover number. */
  enzymeConcentration?: number
}): KineticsFit | BiochemistryError {
  const points = input.points
  if (!Array.isArray(points) || points.length === 0) return fail('invalid-argument', 'Give a series of substrate concentrations and rates.')
  if (points.length > BIOCHEMISTRY_LIMITS.points) {
    return fail('invalid-argument', `That is ${points.length} points; this handles up to ${BIOCHEMISTRY_LIMITS.points}.`)
  }
  if (points.length < 3) {
    return fail(
      'insufficient-data',
      `Two constants are being fitted from ${points.length} point${points.length === 1 ? '' : 's'}. Three is the bare minimum and five or more spanning the half-saturation point is what makes the fit mean anything.`
    )
  }
  for (const [i, point] of points.entries()) {
    if (!Number.isFinite(point.substrate) || !Number.isFinite(point.rate)) {
      return fail('invalid-argument', `Point ${i + 1} has a value that is not a number.`)
    }
    if (point.substrate < 0) return fail('out-of-range', `Point ${i + 1} has a negative concentration.`)
    if (point.rate < 0) {
      return fail(
        'out-of-range',
        `Point ${i + 1} has a negative rate. An initial rate is a rate of product appearance and cannot be negative — a negative value usually means the blank was subtracted the wrong way round.`
      )
    }
  }

  const fitted = fitMichaelisMenten(points)
  if (isBiochemistryError(fitted)) return fitted

  const highest = Math.max(...points.map((one) => one.substrate))
  const ratio = fitted.km === 0 ? Number.POSITIVE_INFINITY : highest / fitted.km
  const warnings: string[] = []
  if (ratio < 2) {
    warnings.push(
      `The highest concentration is only ${ratio.toFixed(2)} times the fitted half-saturation constant, so the curve never began to level off. The maximum rate of ${fitted.vmax.toPrecision(4)} is an extrapolation, not a measurement — to pin it down, measure at concentrations several times Km.`
    )
  }
  if (ratio > 200) {
    warnings.push(
      `Every point is far above the half-saturation constant, so the rising part of the curve was never sampled. The maximum rate is well determined and the constant of ${fitted.km.toPrecision(4)} rests on little data.`
    )
  }
  if (fitted.rSquared < 0.9) {
    warnings.push(
      `The fit explains only ${(fitted.rSquared * 100).toFixed(1)}% of the variation. Substrate inhibition, cooperativity or enzyme losing activity during the assay all produce a series Michaelis-Menten cannot describe.`
    )
  }
  // Substrate inhibition shows as a rate that falls at the top of the range, which this equation cannot represent.
  const sorted = [...points].sort((a, b) => a.substrate - b.substrate)
  if (sorted.length >= 4) {
    const last = sorted[sorted.length - 1]
    const peak = sorted.reduce((best, one) => (one.rate > best.rate ? one : best), sorted[0])
    if (peak.substrate < last.substrate && last.rate < peak.rate * 0.85) {
      warnings.push(
        `The rate peaks at ${peak.substrate.toPrecision(4)} and falls to ${last.rate.toPrecision(4)} by ${last.substrate.toPrecision(4)}. That is substrate inhibition, and the Michaelis-Menten equation cannot produce a falling rate — the fitted constants are being forced onto the wrong model.`
      )
    }
  }

  const kcat = input.enzymeConcentration !== undefined && input.enzymeConcentration > 0 ? fitted.vmax / input.enzymeConcentration : null
  const efficiency = kcat !== null && fitted.km > 0 ? kcat / fitted.km : null
  if (input.enzymeConcentration !== undefined && input.enzymeConcentration <= 0) {
    warnings.push('The enzyme concentration has to be positive to give a turnover number, so kcat was not computed.')
  }

  const curve: { substrate: number; rate: number }[] = []
  const top = Math.max(highest, fitted.km * 5)
  for (let i = 0; i <= 60; i += 1) {
    const substrate = (top * i) / 60
    curve.push({ substrate, rate: (fitted.vmax * substrate) / (fitted.km + substrate) })
  }

  return {
    vmax: fitted.vmax,
    km: fitted.km,
    kcat,
    catalyticEfficiency: efficiency,
    nearDiffusionLimit: efficiency !== null && efficiency > 1e8,
    rSquared: fitted.rSquared,
    highestSubstrateOverKm: ratio,
    predicted: Object.freeze(
      points.map((point) => {
        const value = (fitted.vmax * point.substrate) / (fitted.km + point.substrate)
        return { substrate: point.substrate, observed: point.rate, fitted: value, residual: point.rate - value }
      })
    ),
    curve: Object.freeze(curve),
    method:
      'Damped Gauss-Newton on the untransformed rate, seeded from a Lineweaver-Burk line. The reciprocal plot is only the seed because inverting the rate inflates the error on the slowest, least reliable points.',
    notes: Object.freeze([
      `Vmax ${fitted.vmax.toPrecision(5)}, Km ${fitted.km.toPrecision(5)}, R-squared ${fitted.rSquared.toFixed(5)} over ${points.length} points.`,
      kcat === null
        ? 'No enzyme concentration was given, so only Vmax is available. Vmax depends on how much enzyme is present; kcat does not, which is why kcat is the number that can be compared between laboratories.'
        : `kcat ${kcat.toPrecision(5)} per unit time, catalytic efficiency ${(efficiency as number).toPrecision(5)}. Efficiency is what evolution optimises, because it governs the rate at the low substrate concentrations cells actually work at.`,
      efficiency !== null && efficiency > 1e8
        ? 'A catalytic efficiency above about 10^8 is at the diffusion limit: the enzyme reacts with essentially every substrate molecule that reaches it, and no amount of further catalysis can help.'
        : 'Km is a concentration, not a rate. A low Km means the enzyme saturates early, which is not the same as being fast.',
      `The highest concentration is ${ratio === Number.POSITIVE_INFINITY ? 'far' : ratio.toFixed(2) + ' times'} the half-saturation constant. Below about 2 the plateau was never observed and Vmax is an extrapolation.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export type InhibitionType = 'competitive' | 'uncompetitive' | 'non-competitive' | 'mixed' | 'none detected'

export interface InhibitionReport {
  /** The type the numbers point to, with how confidently. */
  type: InhibitionType
  confidence: 'clear' | 'suggestive' | 'unclear'
  /** The uninhibited fit. */
  control: { vmax: number; km: number; rSquared: number }
  /** The inhibited fit. */
  inhibited: { vmax: number; km: number; rSquared: number }
  /** How much each constant moved, as a ratio. */
  vmaxRatio: number
  kmRatio: number
  /** The inhibition constant, where the type allows one to be computed. */
  ki: number | null
  /** kcat/Km for both, which falls under every inhibition type. */
  efficiencyRatio: number
  reasoning: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Identify an inhibition type by fitting both series and seeing which constant moved.
 *
 * This is a deduction from two fits, not a classification asserted from a label. Competitive inhibition raises the
 * apparent half-saturation constant and leaves the maximum rate alone; uncompetitive lowers the maximum and the
 * constant together, leaving the ratio unchanged; non-competitive lowers the maximum alone. Anything else is mixed,
 * and saying "mixed" is more honest than forcing one of the three.
 *
 * The efficiency ratio is reported because it falls under every type — so it says how much inhibition there is
 * without saying which kind, and the two questions are separate.
 */
export function inhibition(input: {
  control: readonly KineticsPoint[]
  inhibited: readonly KineticsPoint[]
  /** The inhibitor concentration, which is needed for an inhibition constant. */
  inhibitorConcentration?: number
}): InhibitionReport | BiochemistryError {
  if (!Array.isArray(input.control) || input.control.length < 3) {
    return fail('insufficient-data', 'The control series needs at least three points.')
  }
  if (!Array.isArray(input.inhibited) || input.inhibited.length < 3) {
    return fail('insufficient-data', 'The inhibited series needs at least three points.')
  }
  const control = fitMichaelisMenten(input.control)
  if (isBiochemistryError(control)) return control
  const inhibited = fitMichaelisMenten(input.inhibited)
  if (isBiochemistryError(inhibited)) return inhibited

  const vmaxRatio = control.vmax === 0 ? Number.NaN : inhibited.vmax / control.vmax
  const kmRatio = control.km === 0 ? Number.NaN : inhibited.km / control.km
  const warnings: string[] = []
  if (!Number.isFinite(vmaxRatio) || !Number.isFinite(kmRatio)) {
    return fail('no-solution', 'One of the fitted constants came out as zero, so the ratios cannot be formed. That usually means a series with no signal.')
  }

  // A 15% band is the honest threshold: fitted constants from a typical assay are not more precise than that.
  const band = 0.15
  const vmaxFell = vmaxRatio < 1 - band
  const vmaxHeld = Math.abs(vmaxRatio - 1) <= band
  const kmRose = kmRatio > 1 + band
  const kmHeld = Math.abs(kmRatio - 1) <= band
  const kmFell = kmRatio < 1 - band

  let type: InhibitionType
  let confidence: InhibitionReport['confidence']
  const reasoning: string[] = []

  if (vmaxHeld && kmRose) {
    type = 'competitive'
    confidence = 'clear'
    reasoning.push(
      `The maximum rate held at ${(vmaxRatio * 100).toFixed(1)}% of the control while the half-saturation constant rose ${kmRatio.toFixed(2)}-fold. That is competitive inhibition: the inhibitor competes for the active site, so more substrate outcompetes it and the same maximum is reached — it just takes more substrate.`
    )
  } else if (vmaxFell && kmFell && Math.abs(vmaxRatio - kmRatio) < band) {
    type = 'uncompetitive'
    confidence = 'clear'
    reasoning.push(
      `The maximum rate and the half-saturation constant both fell by about the same factor (${vmaxRatio.toFixed(2)} and ${kmRatio.toFixed(2)}), leaving their ratio unchanged. That is uncompetitive inhibition: the inhibitor binds only the enzyme-substrate complex, so more substrate makes it worse rather than better.`
    )
  } else if (vmaxFell && kmHeld) {
    type = 'non-competitive'
    confidence = 'clear'
    reasoning.push(
      `The maximum rate fell to ${(vmaxRatio * 100).toFixed(1)}% while the half-saturation constant held at ${kmRatio.toFixed(2)}-fold. That is non-competitive inhibition: the inhibitor binds somewhere else with equal affinity either way, so it removes enzyme from service and no amount of substrate helps.`
    )
  } else if (vmaxHeld && kmHeld) {
    type = 'none detected'
    confidence = 'clear'
    reasoning.push(
      `Neither constant moved by more than ${(band * 100).toFixed(0)}%. Either the inhibitor is not inhibiting at this concentration, or the two series are of the same thing.`
    )
  } else {
    type = 'mixed'
    confidence = vmaxFell && kmRose ? 'clear' : 'suggestive'
    reasoning.push(
      `The maximum rate went to ${vmaxRatio.toFixed(3)} of control and the half-saturation constant to ${kmRatio.toFixed(3)}. That fits none of the three textbook patterns cleanly, which makes it mixed inhibition — the inhibitor binds both the free enzyme and the complex, with different affinities. Forcing one of the three names on this would be the wrong answer stated confidently.`
    )
  }

  if (control.rSquared < 0.9 || inhibited.rSquared < 0.9) {
    confidence = 'unclear'
    warnings.push(
      `The fits explain ${(control.rSquared * 100).toFixed(1)}% and ${(inhibited.rSquared * 100).toFixed(1)}% of the variation. With fits that poor the constants are not solid enough to tell inhibition types apart, so treat the classification as a guess.`
    )
  }

  let ki: number | null = null
  const concentration = input.inhibitorConcentration
  if (concentration !== undefined && Number.isFinite(concentration) && concentration > 0) {
    if (type === 'competitive' && kmRatio > 1) ki = concentration / (kmRatio - 1)
    else if (type === 'non-competitive' && vmaxRatio < 1 && vmaxRatio > 0) ki = concentration / (1 / vmaxRatio - 1)
    else if (type === 'uncompetitive' && vmaxRatio < 1 && vmaxRatio > 0) ki = concentration / (1 / vmaxRatio - 1)
    else {
      warnings.push(
        'An inhibition constant needs a single binding mode. Mixed inhibition has two of them and they cannot be separated from one inhibitor concentration — that needs a series of concentrations.'
      )
    }
  } else if (concentration === undefined) {
    warnings.push('No inhibitor concentration was given, so no inhibition constant could be computed. The type is still identifiable without it.')
  }

  const controlEfficiency = control.km === 0 ? Number.NaN : control.vmax / control.km
  const inhibitedEfficiency = inhibited.km === 0 ? Number.NaN : inhibited.vmax / inhibited.km

  return {
    type,
    confidence,
    control: { vmax: control.vmax, km: control.km, rSquared: control.rSquared },
    inhibited: { vmax: inhibited.vmax, km: inhibited.km, rSquared: inhibited.rSquared },
    vmaxRatio,
    kmRatio,
    ki,
    efficiencyRatio: inhibitedEfficiency / controlEfficiency,
    reasoning: Object.freeze(reasoning),
    notes: Object.freeze([
      `Control: Vmax ${control.vmax.toPrecision(4)}, Km ${control.km.toPrecision(4)}. Inhibited: Vmax ${inhibited.vmax.toPrecision(4)}, Km ${inhibited.km.toPrecision(4)}.`,
      `Identified as ${type} (${confidence}). The type was deduced from which constant moved, not asserted.`,
      ki === null ? 'No inhibition constant was computed.' : `Inhibition constant about ${ki.toPrecision(4)} in the same units as the inhibitor concentration.`,
      `Catalytic efficiency fell to ${(inhibitedEfficiency / controlEfficiency).toFixed(4)} of control. Efficiency falls under every inhibition type, so it measures how much inhibition there is and says nothing about which kind — they are separate questions.`,
      'A 15% band is used to decide whether a constant moved, because fitted constants from a normal assay are not more precise than that. A smaller threshold would manufacture confident classifications out of noise.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface BindingReport {
  /** The dissociation constant fitted from the data. */
  kd: number
  /** The Hill coefficient: above 1 is cooperative, below 1 is negatively cooperative. */
  hillCoefficient: number
  /** How many sites the coefficient implies, which is a floor rather than a count. */
  impliedSites: number
  cooperative: boolean
  /** How far the fit agrees. */
  rSquared: number
  /** The concentration range over which occupancy goes from 10% to 90%, which is what steepness means. */
  dynamicRange: { from: number; to: number; decades: number }
  /** A curve for drawing. */
  curve: readonly { ligand: number; occupancy: number }[]
  predicted: readonly { ligand: number; observed: number; fitted: number }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Fit a Hill binding curve, giving the dissociation constant and the cooperativity.
 *
 * The Hill coefficient is reported as what it is: a shape parameter, not a site count. A coefficient of 2.8 for
 * haemoglobin does not mean 2.8 binding sites — haemoglobin has four — it means the four sites interact strongly but
 * not perfectly. The coefficient is a lower bound on the number of interacting sites and never an estimate of it.
 *
 * The dynamic range is the practically useful output: non-cooperative binding needs an 81-fold concentration change
 * to go from a tenth occupied to nine tenths, and that is a hard consequence of the equation. Cooperativity is
 * precisely what narrows that range, which is why it exists in oxygen transport and in gene regulation.
 */
export function binding(input: {
  points: readonly { ligand: number; occupancy: number }[]
  /** Whether the occupancies are fractions (0 to 1) or a signal to be scaled. */
  normalised?: boolean
}): BindingReport | BiochemistryError {
  const points = input.points
  if (!Array.isArray(points) || points.length < 3) {
    return fail('insufficient-data', 'Fitting a dissociation constant and a Hill coefficient needs at least three points, and five spanning the half-occupancy point to mean much.')
  }
  for (const [i, point] of points.entries()) {
    if (!Number.isFinite(point.ligand) || !Number.isFinite(point.occupancy)) {
      return fail('invalid-argument', `Point ${i + 1} has a value that is not a number.`)
    }
    if (point.ligand < 0) return fail('out-of-range', `Point ${i + 1} has a negative ligand concentration.`)
  }

  const warnings: string[] = []
  const maxOccupancy = Math.max(...points.map((one) => one.occupancy))
  let scale = 1
  if (input.normalised === false || maxOccupancy > 1.5) {
    if (maxOccupancy <= 0) return fail('invalid-argument', 'Every occupancy is zero or negative, so there is no binding to fit.')
    scale = maxOccupancy
    warnings.push(
      `The highest reading was ${maxOccupancy.toPrecision(4)}, so the values were treated as a signal and scaled by it. That assumes the highest point is saturated — if it is not, the fitted dissociation constant is too low.`
    )
  } else if (maxOccupancy > 1.05) {
    warnings.push(`An occupancy of ${maxOccupancy.toPrecision(4)} is above 1, which a fraction cannot be. Check whether these are fractions or raw signal.`)
  }
  const fractions = points.map((one) => ({ ligand: one.ligand, occupancy: one.occupancy / scale }))

  // A Hill plot gives the seed: log(y/(1-y)) against log(ligand) is a straight line of slope n.
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  let used = 0
  for (const point of fractions) {
    if (point.ligand <= 0 || point.occupancy <= 0.02 || point.occupancy >= 0.98) continue
    const x = Math.log(point.ligand)
    const y = Math.log(point.occupancy / (1 - point.occupancy))
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
    used += 1
  }
  let hill = 1
  let kd = fractions.reduce((sum, one) => sum + one.ligand, 0) / fractions.length
  if (used >= 2) {
    const denominator = used * sumXX - sumX * sumX
    if (Math.abs(denominator) > 1e-30) {
      hill = (used * sumXY - sumX * sumY) / denominator
      const intercept = (sumY - hill * sumX) / used
      if (hill > 0) kd = Math.exp(-intercept / hill)
    }
  } else {
    warnings.push(
      `Only ${used} point${used === 1 ? ' lies' : 's lie'} between 2% and 98% occupancy, which is where the curve carries information about cooperativity. The Hill coefficient rests on almost nothing.`
    )
  }
  if (!Number.isFinite(hill) || hill <= 0) hill = 1
  if (!Number.isFinite(kd) || kd <= 0) kd = Math.max(1e-12, fractions.reduce((sum, one) => sum + one.ligand, 0) / fractions.length)

  // Refine both on the untransformed occupancy.
  for (let step = 0; step < 300; step += 1) {
    let j11 = 0
    let j12 = 0
    let j22 = 0
    let g1 = 0
    let g2 = 0
    for (const point of fractions) {
      if (point.ligand <= 0) continue
      const powered = Math.pow(point.ligand, hill)
      const kdPowered = Math.pow(kd, hill)
      const bottom = powered + kdPowered
      if (bottom <= 0) continue
      const fitted = powered / bottom
      const residual = point.occupancy - fitted
      // Derivatives of L^n/(L^n + Kd^n) with respect to n and Kd.
      const dHill = (powered * kdPowered * (Math.log(point.ligand) - Math.log(kd))) / (bottom * bottom)
      const dKd = (-powered * hill * Math.pow(kd, hill - 1)) / (bottom * bottom)
      j11 += dHill * dHill
      j12 += dHill * dKd
      j22 += dKd * dKd
      g1 += dHill * residual
      g2 += dKd * residual
    }
    const lambda = 1e-9 * (j11 + j22 + 1)
    const a = j11 + lambda
    const d = j22 + lambda
    const det = a * d - j12 * j12
    if (Math.abs(det) < 1e-30) break
    const stepHill = (d * g1 - j12 * g2) / det
    const stepKd = (a * g2 - j12 * g1) / det
    const nextHill = hill + stepHill
    const nextKd = kd + stepKd
    hill = nextHill > 0.01 ? nextHill : hill / 2
    kd = nextKd > 0 ? nextKd : kd / 2
    if (Math.abs(stepHill) < 1e-12 && Math.abs(stepKd) < 1e-12 * Math.max(1, kd)) break
  }

  const meanOccupancy = fractions.reduce((sum, one) => sum + one.occupancy, 0) / fractions.length
  let residualSum = 0
  let totalSum = 0
  for (const point of fractions) {
    const powered = Math.pow(point.ligand, hill)
    const fitted = powered / (powered + Math.pow(kd, hill))
    residualSum += Math.pow(point.occupancy - fitted, 2)
    totalSum += Math.pow(point.occupancy - meanOccupancy, 2)
  }
  const rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum

  // The 10-to-90 range, which is what steepness means in practice.
  const at = (fraction: number): number => kd * Math.pow(fraction / (1 - fraction), 1 / hill)
  const from = at(0.1)
  const to = at(0.9)

  if (Math.abs(hill - 1) < 0.15) {
    warnings.push(
      'The Hill coefficient is within 0.15 of 1, which is indistinguishable from independent, non-cooperative binding at normal data quality.'
    )
  }
  if (hill > 1.15) {
    warnings.push(
      `A Hill coefficient of ${hill.toFixed(3)} is a shape parameter, not a site count. It is a floor on the number of interacting sites — haemoglobin has four sites and a coefficient near 2.8, because the sites interact strongly but not perfectly.`
    )
  }
  if (rSquared < 0.9) {
    warnings.push(`The fit explains only ${(rSquared * 100).toFixed(1)}% of the variation, so the constants are not well determined.`)
  }

  const curve: { ligand: number; occupancy: number }[] = []
  const lowest = Math.max(kd / 1000, 1e-15)
  const highest = kd * 1000
  for (let i = 0; i <= 80; i += 1) {
    const ligand = lowest * Math.pow(highest / lowest, i / 80)
    const powered = Math.pow(ligand, hill)
    curve.push({ ligand, occupancy: powered / (powered + Math.pow(kd, hill)) })
  }

  return {
    kd,
    hillCoefficient: hill,
    impliedSites: Math.max(1, Math.ceil(hill)),
    cooperative: hill > 1.15,
    rSquared,
    dynamicRange: { from, to, decades: Math.log10(to / from) },
    curve: Object.freeze(curve),
    predicted: Object.freeze(
      points.map((point, i) => {
        const powered = Math.pow(fractions[i].ligand, hill)
        return { ligand: point.ligand, observed: fractions[i].occupancy, fitted: powered / (powered + Math.pow(kd, hill)) }
      })
    ),
    notes: Object.freeze([
      `Dissociation constant ${kd.toPrecision(5)}, Hill coefficient ${hill.toFixed(4)}, R-squared ${rSquared.toFixed(5)}.`,
      `Occupancy goes from 10% to 90% between ${from.toPrecision(4)} and ${to.toPrecision(4)} — a range of ${(to / from).toFixed(1)}-fold, or ${Math.log10(to / from).toFixed(2)} decades.`,
      'Non-cooperative binding always needs an 81-fold concentration change for that 10-to-90 span. Cooperativity is what narrows it, which is the whole reason it exists in oxygen transport and gene regulation.',
      'A dissociation constant is an equilibrium binding constant. It is not a half-saturation constant for a turning enzyme, and the two are only equal when catalysis is much slower than release.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- proteins

export interface ProteinReport {
  /** The sequence, cleaned. */
  sequence: string
  length: number
  /** Daltons, from the residue weights less one water per bond. */
  molecularWeight: number
  /** The pH at which the net charge is zero, found by bisection on the charge curve. */
  isoelectricPoint: number
  /** Net charge at the pH asked about. */
  netChargeAtPh: number
  atPh: number
  /** Composition by chemical character, which is what predicts behaviour. */
  composition: readonly { group: string; count: number; fraction: number; residues: string }[]
  /** Average hydrophobicity on the Kyte-Doolittle scale. */
  hydropathy: number
  /** Extinction coefficient at 280 nm, from tryptophan, tyrosine and cystine. */
  extinctionCoefficient: number
  /** Absorbance of a 1 mg/mL solution, which is what a spectrophotometer reading converts through. */
  absorbance01Percent: number
  /** Each charged residue and its count. */
  charged: { positive: number; negative: number }
  notes: readonly string[]
  warnings: readonly string[]
}

// pKa values for the ionisable groups. Model-compound values, which is the honest caveat: a real protein's
// groups sit in a structure that shifts them, sometimes by two units or more.
const PKA = Object.freeze({
  cTerminus: 3.65,
  nTerminus: 8.2,
  D: 3.9,
  E: 4.07,
  C: 8.18,
  Y: 10.46,
  H: 6.04,
  K: 10.54,
  R: 12.48
})

const KYTE_DOOLITTLE: Readonly<Record<string, number>> = Object.freeze({
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4, H: -3.2, I: 4.5,
  L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2
})

const RESIDUE_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  A: 89.09, R: 174.2, N: 132.12, D: 133.1, C: 121.16, E: 147.13, Q: 146.15, G: 75.07,
  H: 155.16, I: 131.17, L: 131.17, K: 146.19, M: 149.21, F: 165.19, P: 115.13, S: 105.09,
  T: 119.12, W: 204.23, Y: 181.19, V: 117.15
})

/**
 * Properties of a protein computed from its sequence.
 *
 * The isoelectric point is found by bisection on the full charge curve rather than by any counting rule, because a
 * charge curve is not linear and a rule of thumb gets it wrong by a unit or more for a protein with many histidines.
 *
 * The pKa values are model-compound values, and that is the caveat that matters: a real ionisable group sits inside a
 * structure that shifts its pKa, sometimes by two units. So a computed isoelectric point is a starting point for
 * choosing a buffer, not a measurement — and a protein that will not focus where predicted is usually behaving
 * correctly.
 */
export function proteinProperties(input: { sequence: string; ph?: number; disulfideBonds?: number }): ProteinReport | BiochemistryError {
  if (typeof input.sequence !== 'string') return fail('invalid-argument', 'A sequence has to be text.')
  const cleaned = input.sequence.replace(/[\s\d>*-]/g, '').toUpperCase()
  if (cleaned.length === 0) return fail('bad-sequence', 'There is no sequence here.')
  if (cleaned.length > BIOCHEMISTRY_LIMITS.residues) {
    return fail('invalid-argument', `That is ${cleaned.length} residues; this handles up to ${BIOCHEMISTRY_LIMITS.residues}.`)
  }
  const warnings: string[] = []
  const counts = new Map<string, number>()
  let unknown = 0
  for (let i = 0; i < cleaned.length; i += 1) {
    const one = cleaned[i]
    if (!Object.prototype.hasOwnProperty.call(RESIDUE_WEIGHTS, one)) {
      if (one === 'X' || one === 'B' || one === 'Z' || one === 'J' || one === 'U' || one === 'O') {
        unknown += 1
        continue
      }
      return fail(
        'bad-sequence',
        `"${one}" at position ${i + 1} is not an amino acid. Valid letters are the twenty standard single-letter codes, plus X, B, Z, J for ambiguity. A nucleotide sequence passed here by mistake is the usual cause.`
      )
    }
    counts.set(one, (counts.get(one) ?? 0) + 1)
  }
  const known = cleaned.length - unknown
  if (known === 0) return fail('bad-sequence', 'Every position is an ambiguity code, so nothing can be computed.')
  if (unknown > 0) {
    warnings.push(`${unknown} of ${cleaned.length} positions are ambiguity codes and were left out of every calculation, so the figures are for ${known} residues.`)
  }
  if (/^[ACGTU]+$/.test(cleaned) && cleaned.length > 20) {
    warnings.push(
      'This sequence uses only A, C, G, T and U, which are all valid amino acid codes but are also exactly a nucleotide sequence. If this is DNA, translate it first — treating it as protein gives confident nonsense.'
    )
  }

  const ph = input.ph ?? 7
  if (!Number.isFinite(ph) || ph < 0 || ph > 14) return fail('out-of-range', 'A pH is between 0 and 14.')

  const chargeAt = (value: number): number => {
    // Each group's protonated fraction from Henderson-Hasselbalch, summed as a net charge.
    const positive = (pka: number, count: number): number => count * (1 / (1 + Math.pow(10, value - pka)))
    const negative = (pka: number, count: number): number => -count * (1 / (1 + Math.pow(10, pka - value)))
    let charge = positive(PKA.nTerminus, 1) + negative(PKA.cTerminus, 1)
    charge += positive(PKA.K, counts.get('K') ?? 0)
    charge += positive(PKA.R, counts.get('R') ?? 0)
    charge += positive(PKA.H, counts.get('H') ?? 0)
    charge += negative(PKA.D, counts.get('D') ?? 0)
    charge += negative(PKA.E, counts.get('E') ?? 0)
    charge += negative(PKA.C, counts.get('C') ?? 0)
    charge += negative(PKA.Y, counts.get('Y') ?? 0)
    return charge
  }

  // Bisection on the charge curve. No counting rule, because the curve is not linear.
  let low = 0
  let high = 14
  if (chargeAt(low) < 0) {
    warnings.push('The net charge is negative even at pH 0, so the isoelectric point is below the range this can report.')
  }
  for (let i = 0; i < 200; i += 1) {
    const middle = (low + high) / 2
    if (chargeAt(middle) > 0) low = middle
    else high = middle
  }
  const isoelectric = (low + high) / 2

  const weightBase = [...counts.entries()].reduce((sum, [one, count]) => sum + RESIDUE_WEIGHTS[one] * count, 0)
  const weight = known === 0 ? 0 : weightBase - (known - 1) * 18.015

  const groups: { group: string; residues: string }[] = [
    { group: 'nonpolar', residues: 'AVLIMFWPG' },
    { group: 'polar', residues: 'STCYNQ' },
    { group: 'acidic', residues: 'DE' },
    { group: 'basic', residues: 'KRH' }
  ]
  const composition = groups.map((group) => {
    const count = [...group.residues].reduce((sum, one) => sum + (counts.get(one) ?? 0), 0)
    return { group: group.group, count, fraction: count / known, residues: group.residues }
  })

  const hydropathy = [...counts.entries()].reduce((sum, [one, count]) => sum + KYTE_DOOLITTLE[one] * count, 0) / known

  const tryptophan = counts.get('W') ?? 0
  const tyrosine = counts.get('Y') ?? 0
  const cysteine = counts.get('C') ?? 0
  const bonds = input.disulfideBonds ?? 0
  if (!Number.isFinite(bonds) || bonds < 0) return fail('invalid-argument', 'The number of disulfide bonds cannot be negative.')
  if (bonds * 2 > cysteine) {
    return fail(
      'invalid-argument',
      `${bonds} disulfide bond${bonds === 1 ? '' : 's'} needs ${bonds * 2} cysteines and the sequence has ${cysteine}.`
    )
  }
  // Extinction coefficients at 280 nm, from Pace: tryptophan 5500, tyrosine 1490, cystine 125.
  const extinction = tryptophan * 5500 + tyrosine * 1490 + bonds * 125
  if (extinction === 0) {
    warnings.push(
      'This protein has no tryptophan or tyrosine, so it does not absorb meaningfully at 280 nm and its concentration cannot be measured that way. A Bradford or BCA assay is needed instead.'
    )
  }

  const positive = (counts.get('K') ?? 0) + (counts.get('R') ?? 0) + (counts.get('H') ?? 0)
  const negative = (counts.get('D') ?? 0) + (counts.get('E') ?? 0)

  if (Math.abs(ph - isoelectric) < 0.5) {
    warnings.push(
      `The pH asked about (${ph}) is within half a unit of the isoelectric point (${isoelectric.toFixed(2)}). A protein at its isoelectric point carries no net charge, nothing keeps molecules apart, and it is at its least soluble — which is either a purification step or a precipitated sample, depending on what was intended.`
    )
  }

  return {
    sequence: cleaned,
    length: cleaned.length,
    molecularWeight: weight,
    isoelectricPoint: isoelectric,
    netChargeAtPh: chargeAt(ph),
    atPh: ph,
    composition: Object.freeze(composition),
    hydropathy,
    extinctionCoefficient: extinction,
    absorbance01Percent: weight === 0 ? 0 : extinction / weight,
    charged: { positive, negative },
    notes: Object.freeze([
      `${known} residues, about ${weight.toFixed(1)} Da, isoelectric point ${isoelectric.toFixed(2)}, net charge ${chargeAt(ph).toFixed(2)} at pH ${ph}.`,
      'The isoelectric point was found by bisection on the full charge curve. A counting rule gets it wrong by a unit or more for a protein rich in histidine, because the curve is not linear.',
      'The pKa values are model-compound values. A real ionisable group sits in a structure that shifts its pKa, sometimes by two units, so this is a starting point for choosing a buffer and not a measurement.',
      extinction === 0
        ? 'No absorbance at 280 nm to work from.'
        : `A 1 mg/mL solution absorbs about ${(extinction / weight).toFixed(3)} at 280 nm in a 1 cm cell, which is how a spectrophotometer reading becomes a concentration.`,
      `Average hydropathy ${hydropathy.toFixed(3)} on the Kyte-Doolittle scale. Positive means hydrophobic overall, which for a whole protein usually means a membrane protein — a soluble one buries its hydrophobic residues and averages negative.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface ThermodynamicsReport {
  /** kJ/mol. */
  deltaG: number
  /** The equilibrium constant that corresponds to it. */
  equilibriumConstant: number
  /** Whether the reaction runs as written. */
  favourable: boolean
  /** The same reaction under cellular conditions, when concentrations were given. */
  underConditions: { deltaG: number; favourable: boolean; quotient: number } | null
  /** How many ATP hydrolyses it would take to drive it, if it is unfavourable. */
  atpEquivalents: number | null
  temperature: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Free energy, the equilibrium constant, and what it takes under real concentrations.
 *
 * The standard free energy change and the actual one are different quantities and confusing them is the most common
 * error in bioenergetics. A reaction with an unfavourable standard change runs perfectly well in a cell that keeps
 * the product concentration low — which is how most of glycolysis works. This computes both and never reports one
 * as the other.
 *
 * ATP equivalents are given as a count because that is how a cell pays for an unfavourable step, but the count is
 * honest about being an idealisation: coupling is never perfectly efficient, so the real cost is higher.
 */
export function bioenergetics(input: {
  /** Give one of these. */
  deltaG?: number
  equilibriumConstant?: number
  /** Kelvin. Defaults to 310.15, which is body temperature — stated rather than assumed silently. */
  temperature?: number
  /** Actual concentrations, to get the real free energy change rather than the standard one. */
  products?: readonly number[]
  reactants?: readonly number[]
}): ThermodynamicsReport | BiochemistryError {
  const temperature = input.temperature ?? 310.15
  if (!Number.isFinite(temperature) || temperature <= 0) return fail('out-of-range', 'A temperature in kelvin has to be above zero.')
  if (temperature < 200) {
    return fail(
      'out-of-range',
      `${temperature} K is ${(temperature - 273.15).toFixed(1)} C. If a temperature in Celsius was meant, add 273.15 — biochemistry at 37 K is not a thing.`
    )
  }

  let deltaG: number
  if (input.deltaG !== undefined) {
    if (!Number.isFinite(input.deltaG)) return fail('invalid-argument', 'The free energy change has to be a number.')
    deltaG = input.deltaG
  } else if (input.equilibriumConstant !== undefined) {
    if (!Number.isFinite(input.equilibriumConstant) || input.equilibriumConstant <= 0) {
      return fail('out-of-range', 'An equilibrium constant has to be positive.')
    }
    deltaG = (-GAS_CONSTANT * temperature * Math.log(input.equilibriumConstant)) / 1000
  } else {
    return fail('invalid-argument', 'Give either a standard free energy change in kJ/mol or an equilibrium constant.')
  }

  const equilibrium = Math.exp((-deltaG * 1000) / (GAS_CONSTANT * temperature))
  const warnings: string[] = []

  let underConditions: ThermodynamicsReport['underConditions'] = null
  if (input.products !== undefined || input.reactants !== undefined) {
    const products = input.products ?? []
    const reactants = input.reactants ?? []
    if (products.length === 0 || reactants.length === 0) {
      return fail('invalid-argument', 'To get the free energy change under real conditions, give both the product and the reactant concentrations.')
    }
    for (const value of [...products, ...reactants]) {
      if (!Number.isFinite(value) || value <= 0) {
        return fail('out-of-range', 'Every concentration has to be positive. A concentration of exactly zero makes the free energy change infinite, which is a statement about the model rather than about the reaction.')
      }
    }
    const quotient = products.reduce((product, one) => product * one, 1) / reactants.reduce((product, one) => product * one, 1)
    const actual = deltaG + (GAS_CONSTANT * temperature * Math.log(quotient)) / 1000
    underConditions = { deltaG: actual, favourable: actual < 0, quotient }
    if (deltaG > 0 && actual < 0) {
      warnings.push(
        `The standard free energy change is ${deltaG.toFixed(2)} kJ/mol, which is unfavourable, but under these concentrations it is ${actual.toFixed(2)} kJ/mol, which runs. That is not a contradiction — it is how most of glycolysis works, by keeping the product concentration low. The standard value describes 1 M everything, which no cell resembles.`
      )
    }
    if (deltaG < 0 && actual > 0) {
      warnings.push(
        `The standard change is favourable at ${deltaG.toFixed(2)} kJ/mol but under these concentrations the reaction runs backwards, at ${actual.toFixed(2)} kJ/mol. Product has accumulated past the equilibrium point.`
      )
    }
  }

  // ATP hydrolysis under cellular conditions is about -50 kJ/mol, not the -30.5 standard value.
  const atpUnderConditions = 50
  const effective = underConditions?.deltaG ?? deltaG
  const atpEquivalents = effective > 0 ? effective / atpUnderConditions : null
  if (atpEquivalents !== null) {
    warnings.push(
      `Driving this needs at least ${atpEquivalents.toFixed(2)} ATP hydrolyses, taking ATP as about -50 kJ/mol under cellular conditions rather than its -30.5 standard value. That is a floor: coupling is never perfectly efficient, so the real cost is higher.`
    )
  }

  return {
    deltaG,
    equilibriumConstant: equilibrium,
    favourable: deltaG < 0,
    underConditions,
    atpEquivalents,
    temperature,
    notes: Object.freeze([
      `Standard free energy change ${deltaG.toFixed(3)} kJ/mol at ${temperature} K, giving an equilibrium constant of ${equilibrium.toPrecision(5)}.`,
      underConditions === null
        ? 'No concentrations were given, so this is the standard change only — the value at 1 M of everything, which no cell resembles.'
        : `Under the concentrations given the quotient is ${underConditions.quotient.toPrecision(4)} and the actual change is ${underConditions.deltaG.toFixed(3)} kJ/mol.`,
      'Favourable means it runs, not that it runs quickly. Free energy says nothing about rate — a reaction can be strongly favourable and take a geological age without a catalyst.',
      'Every 5.9 kJ/mol at body temperature is a factor of ten in the equilibrium constant, which is why small energy differences move equilibria so far.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const BIOCHEMISTRY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Kinetic constants are fitted by damped Gauss-Newton on the untransformed rate. A Lineweaver-Burk line is only the seed, because inverting the rate inflates the error on the least reliable points.',
  'Every fit reports the highest substrate concentration as a multiple of the fitted constant, which is what says whether the plateau was observed or extrapolated.',
  'A series whose rate falls at high substrate is flagged as substrate inhibition, which the Michaelis-Menten equation cannot represent.',
  'Inhibition types are deduced from which constant moved, with a 15% band, and reported as "mixed" rather than forced into one of the three textbook patterns.',
  'A Hill coefficient is reported as a shape parameter and a floor on the number of interacting sites, never as a site count.',
  'The isoelectric point is found by bisection on the full charge curve rather than by a counting rule, because the curve is not linear.',
  'Protein pKa values are model-compound values; a group inside a structure can differ by two units, so a computed isoelectric point is a starting point and not a measurement.',
  'Standard and actual free energy changes are computed and reported separately, because a reaction with an unfavourable standard change runs fine in a cell that keeps the product low.',
  'ATP equivalents use -50 kJ/mol for cellular conditions rather than the -30.5 standard value, and are stated as a floor because coupling is never perfectly efficient.',
  'Favourable means it runs, not that it runs quickly. Nothing here says anything about rate.'
])
