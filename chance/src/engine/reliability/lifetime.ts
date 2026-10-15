/**
 * Time-dependent reliability: R(t), hazard, cumulative hazard, MTTF;
 * the bathtub-curve reading of a Weibull shape; availability for repairable
 * items; redundancy (active, cold and warm standby, imperfect switching);
 * common-cause failure via a beta factor; and stress–strength interference.
 */

import { EngineError, Validator, type Exactness } from '../core/result';
import { clamp, linspace } from '../core/numeric';
import { gammaFn, normalCdf } from '../special/gamma';
import { getDistribution } from '../distributions/registry';
import type { DistributionDef, Params } from '../distributions/types';
import {
  INDEPENDENCE_ASSUMED_NOTE,
  INDEPENDENCE_NOT_ASSUMED_NOTE,
  structureReliability,
  type Reliabilities,
  type Structure,
} from './structures';

export type LifetimeFamily = 'exponential' | 'weibull' | 'lognormal' | 'gamma';

const LIFETIME_FAMILIES: readonly LifetimeFamily[] = ['exponential', 'weibull', 'lognormal', 'gamma'];

export interface LifetimeModel {
  family: LifetimeFamily;
  /** Parameters in the engine distribution registry's own parameterisation. */
  params: Params;
  def: DistributionDef;
}

/**
 * Builds a lifetime model from the existing distribution registry.
 * Weibull uses the registry's shape `k` and scale `lambda` (β and η);
 * exponential uses rate `lambda`; gamma uses shape `k` and scale `theta`;
 * log-normal uses `mu` and `sigma` of ln T.
 */
export function lifetimeModel(family: LifetimeFamily, params: Params): LifetimeModel {
  if (!LIFETIME_FAMILIES.includes(family)) {
    throw new EngineError(
      `"${family}" is not a supported lifetime family. Supported: ${LIFETIME_FAMILIES.join(', ')}.`,
      'invalid',
    );
  }
  const def = getDistribution(family);
  const v = new Validator();
  for (const spec of def.params) {
    const value = params[spec.key];
    if (value === undefined) {
      v.add(`Lifetime parameter "${spec.key}" (${spec.label}) is missing.`, spec.key, 'required');
      continue;
    }
    if (!Number.isFinite(value)) v.add(`Lifetime parameter "${spec.key}" must be finite.`, spec.key, 'finite');
  }
  v.throwIfInvalid();
  const issues = def.params.flatMap((spec) => {
    const value = params[spec.key];
    const out: string[] = [];
    if (spec.min !== undefined && (spec.minExclusive ? value <= spec.min : value < spec.min)) {
      out.push(`${spec.label} must be ${spec.minExclusive ? 'greater than' : 'at least'} ${spec.min}; got ${value}.`);
    }
    if (spec.max !== undefined && value > spec.max) out.push(`${spec.label} must be at most ${spec.max}.`);
    return out;
  });
  if (issues.length) throw new EngineError(issues.map((m) => ({ code: 'range', message: m })));
  return { family, params: { ...params }, def };
}

function requireTime(t: number): void {
  if (!Number.isFinite(t) || t < 0) {
    throw new EngineError(`Time must be a finite value of 0 or more; got ${t}.`, 'range');
  }
}

/** R(t) = P(T > t). */
export function reliabilityAt(model: LifetimeModel, t: number): number {
  requireTime(t);
  return clamp(model.def.sf(t, model.params), 0, 1);
}

/** Cumulative hazard H(t) = −ln R(t). */
export function cumulativeHazard(model: LifetimeModel, t: number): number {
  const r = reliabilityAt(model, t);
  if (r <= 0) {
    throw new EngineError(
      `R(${t}) has underflowed to 0 for this model, so the cumulative hazard is not representable. ` +
        'Evaluate at an earlier time.',
      'numerical',
    );
  }
  return -Math.log(r);
}

/** Hazard (instantaneous failure) rate h(t) = f(t)/R(t). */
export function hazardAt(model: LifetimeModel, t: number): number {
  requireTime(t);
  const r = model.def.sf(t, model.params);
  if (r <= 0) {
    throw new EngineError(
      `R(${t}) is 0 for this model, so the hazard rate f(t)/R(t) is undefined at that time ` +
        '(no units remain at risk). Evaluate at an earlier time.',
      'numerical',
    );
  }
  const f = model.def.pdf(t, model.params);
  if (!Number.isFinite(f)) {
    throw new EngineError(
      `The density is not finite at t = ${t} for this model, so the hazard rate is undefined there.`,
      'numerical',
    );
  }
  return f / r;
}

export interface MttfResult {
  mttf: number;
  exactness: Exactness;
  formula: string;
}

/** Mean time to failure, from the distribution's closed-form mean. */
export function mttf(model: LifetimeModel): MttfResult {
  const m = model.def.mean(model.params);
  if (!m.defined) throw new EngineError(`MTTF is undefined for this model: ${m.reason}`, 'undefined');
  const formula =
    model.family === 'exponential'
      ? 'MTTF = 1/λ'
      : model.family === 'weibull'
        ? 'MTTF = η · Γ(1 + 1/β)'
        : model.family === 'gamma'
          ? 'MTTF = k · θ'
          : 'MTTF = exp(μ + σ²/2)';
  return { mttf: m.value, exactness: 'exact', formula };
}

// ---------------------------------------------------------------------------
// Bathtub curve
// ---------------------------------------------------------------------------

export type BathtubRegime = 'infant-mortality' | 'constant-random' | 'wear-out';

export interface BathtubReading {
  shape: number;
  regime: BathtubRegime;
  /** Sign of dh/dt. */
  hazardTrend: 'decreasing' | 'constant' | 'increasing';
  headline: string;
  interpretation: string;
  maintenanceImplication: string;
  exactness: Exactness;
}

/**
 * The bathtub-curve reading of a Weibull shape parameter β.
 * β < 1 infant mortality, β = 1 constant random failure, β > 1 wear-out.
 */
export function classifyWeibullShape(beta: number): BathtubReading {
  if (!Number.isFinite(beta) || beta <= 0) {
    throw new EngineError(`The Weibull shape β must be a finite positive number; got ${beta}.`, 'range');
  }
  if (beta < 1) {
    return {
      shape: beta,
      regime: 'infant-mortality',
      hazardTrend: 'decreasing',
      headline: `β = ${beta} < 1: infant mortality — the failure rate is falling with age.`,
      interpretation:
        'Units that survive longer are less likely to fail next. This signals manufacturing defects, ' +
        'installation or assembly errors, or a weak sub-population rather than wear.',
      maintenanceImplication:
        'Burn-in / screening removes the weak units. Scheduled replacement is counter-productive here: ' +
        'replacing an aged unit with a new one raises the failure rate.',
      exactness: 'exact',
    };
  }
  if (beta === 1) {
    return {
      shape: beta,
      regime: 'constant-random',
      hazardTrend: 'constant',
      headline: 'β = 1: constant random failure — the failure rate does not change with age.',
      interpretation:
        'The lifetime is exponential and memoryless: an old unit is exactly as likely to fail next as a new one. ' +
        'Failures are externally driven (shocks, overloads, random events).',
      maintenanceImplication:
        'Age-based preventive replacement gains nothing. Spend on redundancy, protection against the ' +
        'external shocks, and fast repair instead.',
      exactness: 'exact',
    };
  }
  return {
    shape: beta,
    regime: 'wear-out',
    hazardTrend: 'increasing',
    headline: `β = ${beta} > 1: wear-out — the failure rate is rising with age.`,
    interpretation:
      'Older units are more likely to fail next: fatigue, erosion, corrosion or depletion is accumulating.' +
      (beta >= 3 ? ' A shape this steep means failures cluster tightly around a characteristic age.' : ''),
    maintenanceImplication:
      'Age- or usage-based preventive replacement pays off, and an optimal replacement interval exists.',
    exactness: 'exact',
  };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface AvailabilityResult {
  steadyState: number;
  /** A(t) for the requested time, when one was given. */
  atTime: number | null;
  failureRate: number;
  repairRate: number;
  exactness: Exactness;
  formula: string;
  assumptions: string[];
}

/**
 * Steady-state availability MTBF/(MTBF+MTTR) and, for a time t, the exact
 * time-dependent availability of a single repairable item with exponential
 * failure and repair times.
 */
export function availability(mtbf: number, mttr: number, t?: number): AvailabilityResult {
  const v = new Validator();
  v.positive(mtbf, 'mtbf', 'MTBF (mean time between failures)');
  v.positive(mttr, 'mttr', 'MTTR (mean time to repair)');
  if (t !== undefined) v.nonNegative(t, 't', 'Time');
  v.throwIfInvalid();
  const lambda = 1 / mtbf;
  const mu = 1 / mttr;
  const steadyState = mtbf / (mtbf + mttr);
  let atTime: number | null = null;
  if (t !== undefined) {
    const s = lambda + mu;
    atTime = clamp(mu / s + (lambda / s) * Math.exp(-s * t), 0, 1);
  }
  return {
    steadyState,
    atTime,
    failureRate: lambda,
    repairRate: mu,
    exactness: 'exact',
    formula: 'A = MTBF/(MTBF+MTTR);  A(t) = μ/(λ+μ) + λ/(λ+μ)·e^{−(λ+μ)t}, starting from a working item',
    assumptions: [
      'Failure and repair times are exponential, so the item is a two-state Markov process.',
      'Repair starts immediately on failure; there is no logistic delay and no repair queue.',
      'The item is as good as new after repair.',
    ],
  };
}

export interface SystemAvailabilityResult {
  availability: number;
  componentAvailabilities: Reliabilities;
  exactness: Exactness;
  independenceAssumed: boolean;
  independenceNote: string;
  note: string;
}

/**
 * System availability for a structure, substituting each component's
 * steady-state availability for its reliability. Valid in steady state
 * because the structure function is the same function of the up/down states.
 */
export function systemAvailability(
  structure: Structure,
  components: Readonly<Record<string, { mtbf: number; mttr: number }>>,
): SystemAvailabilityResult {
  const avail: Record<string, number> = {};
  for (const [id, spec] of Object.entries(components)) {
    if (!spec || !Number.isFinite(spec.mtbf) || !Number.isFinite(spec.mttr)) {
      throw new EngineError(`Component "${id}" needs finite MTBF and MTTR values.`, 'finite');
    }
    if (spec.mtbf <= 0) throw new EngineError(`Component "${id}" has MTBF ${spec.mtbf}; it must be positive.`, 'range');
    if (spec.mttr <= 0) throw new EngineError(`Component "${id}" has MTTR ${spec.mttr}; it must be positive.`, 'range');
    avail[id] = spec.mtbf / (spec.mtbf + spec.mttr);
  }
  const value = structureReliability(structure, avail);
  return {
    availability: value,
    componentAvailabilities: avail,
    exactness: 'exact',
    independenceAssumed: true,
    independenceNote: INDEPENDENCE_ASSUMED_NOTE,
    note:
      'Steady-state system availability: each component contributes its own steady-state availability ' +
      'Aᵢ = MTBFᵢ/(MTBFᵢ+MTTRᵢ) to the structure function. This assumes unlimited repair resources — ' +
      'one repair crew shared between components would couple the down states and lower the answer.',
  };
}

// ---------------------------------------------------------------------------
// Redundancy
// ---------------------------------------------------------------------------

export type RedundancyMode = 'active' | 'cold-standby' | 'warm-standby';

export interface RedundancyResult {
  mode: RedundancyMode;
  units: number;
  reliability: number;
  /** Reliability of a single unit at the same time, for comparison. */
  singleUnit: number;
  exactness: Exactness;
  formula: string;
  switchSuccessProbability: number;
  assumptions: string[];
  independenceAssumed: boolean;
  independenceNote: string;
}

export interface RedundancyInput {
  mode: RedundancyMode;
  /** Number of identical units in total (1 active + n−1 standby for standby modes). */
  units: number;
  /** Active failure rate per unit time. */
  failureRate: number;
  /** Mission time. */
  time: number;
  /** Probability the switch to a standby unit succeeds; 1 = perfect switching. */
  switchSuccessProbability?: number;
  /** Dormant failure rate of a standby unit; 0 = perfect cold standby. */
  standbyFailureRate?: number;
}

/**
 * Redundancy reliability at a mission time.
 *  - active:        all units powered; R = 1 − (1 − e^{−λt})ⁿ
 *  - cold standby:  perfect dormancy; the exact Erlang/Poisson result
 *                   R = e^{−λt} Σ_{i<n} (p_s λ t)^i / i!  (p_s = 1 ⇒ Erlang)
 *  - warm standby:  a dormant unit fails at λ_s while waiting (2 units, exact)
 */
export function redundancyReliability(input: RedundancyInput): RedundancyResult {
  const v = new Validator();
  v.integer(input.units, 'units', 'Number of units', 1, 10000);
  v.positive(input.failureRate, 'failureRate', 'Failure rate λ');
  v.nonNegative(input.time, 'time', 'Mission time');
  const ps = input.switchSuccessProbability ?? 1;
  v.probability(ps, 'switchSuccessProbability', 'Switch success probability');
  const ls = input.standbyFailureRate ?? 0;
  v.nonNegative(ls, 'standbyFailureRate', 'Standby (dormant) failure rate');
  if (input.mode !== 'active' && input.mode !== 'cold-standby' && input.mode !== 'warm-standby') {
    v.add(`Unknown redundancy mode "${String(input.mode)}".`, 'mode', 'invalid');
  }
  v.throwIfInvalid();

  const { units: n, failureRate: lambda, time: t, mode } = input;
  const single = Math.exp(-lambda * t);
  const assumptions: string[] = [
    'All units are identical with the same constant failure rate (exponential lifetimes).',
    INDEPENDENCE_ASSUMED_NOTE,
  ];
  let reliability: number;
  let formula: string;

  if (mode === 'active') {
    reliability = 1 - Math.pow(1 - single, n);
    formula = 'R(t) = 1 − (1 − e^{−λt})ⁿ';
    assumptions.push('Every unit is powered and ages from t = 0; there is no load sharing effect.');
    if (ps < 1) {
      assumptions.push('Active redundancy needs no switching, so the switch success probability was not used.');
    }
  } else if (mode === 'cold-standby') {
    if (ls > 0) {
      throw new EngineError(
        'A non-zero dormant failure rate is warm standby, not cold standby. Use mode "warm-standby".',
        'invalid',
      );
    }
    const x = ps * lambda * t;
    // Σ_{i=0}^{n−1} x^i / i! built up term by term, so x = 0 gives exactly 1.
    let term = 1;
    let sum = 1;
    for (let i = 1; i < n; i += 1) {
      term *= x / i;
      sum += term;
    }
    reliability = clamp(single * sum, 0, 1);
    formula =
      ps === 1
        ? 'R(t) = e^{−λt} Σ_{i=0}^{n−1} (λt)^i / i!   (Erlang; for n = 2, (1+λt)e^{−λt})'
        : 'R(t) = e^{−λt} Σ_{i=0}^{n−1} (p_s λt)^i / i!';
    assumptions.push('Standby units do not age or fail while dormant (perfect cold standby).');
    if (ps < 1) assumptions.push(`Each switch-over succeeds with probability ${ps}; a failed switch loses the mission.`);
  } else {
    if (n !== 2) {
      throw new EngineError(
        `The exact warm-standby result implemented here covers 2 units; ${n} were given. ` +
          'No approximation is substituted.',
        'unsupported',
      );
    }
    // R(t) = e^{−λt}[1 + p_s·λ·(1 − e^{−λ_s t})/λ_s], → (1 + p_s λ t)e^{−λt} as λ_s → 0.
    const factor = ls === 0 ? ps * lambda * t : (ps * lambda * -Math.expm1(-ls * t)) / ls;
    reliability = clamp(single * (1 + factor), 0, 1);
    formula = 'R(t) = e^{−λt}·[1 + p_s·(λ/λ_s)·(1 − e^{−λ_s t})]';
    assumptions.push(
      `The dormant unit fails at rate λ_s = ${ls} while waiting, then at λ = ${lambda} once it takes over.`,
    );
    if (ps < 1) assumptions.push(`Switch-over succeeds with probability ${ps}.`);
  }

  return {
    mode,
    units: n,
    reliability,
    singleUnit: single,
    exactness: 'exact',
    formula,
    switchSuccessProbability: ps,
    assumptions,
    independenceAssumed: true,
    independenceNote: INDEPENDENCE_ASSUMED_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Common-cause failure (beta factor)
// ---------------------------------------------------------------------------

export interface CommonCauseResult {
  beta: number;
  /** Reliability under the usual — and usually wrong — independence assumption. */
  independentReliability: number;
  /** Reliability with the beta-factor common-cause contribution included. */
  withCommonCauseReliability: number;
  /** withCommonCause − independent; negative, because shared causes only hurt. */
  difference: number;
  /** Failure probability ratio: how many times more likely failure becomes. */
  failureProbabilityRatio: number;
  exactness: Exactness;
  independenceAssumed: boolean;
  independenceNote: string;
  headline: string;
  assumptions: string[];
}

/**
 * Beta-factor common-cause model for n identical redundant units in parallel.
 * The total failure rate splits into an independent part (1−β)λ and a common
 * part βλ that takes every unit out at once:
 *     R = e^{−βλt} · [1 − (1 − e^{−(1−β)λt})ⁿ]
 * The independence answer (β = 0) is reported alongside, because the contrast
 * is the insight: redundancy cannot buy more reliability than 1/β.
 */
export function betaFactorCommonCause(input: {
  units: number;
  failureRate: number;
  time: number;
  beta: number;
}): CommonCauseResult {
  const v = new Validator();
  v.integer(input.units, 'units', 'Number of redundant units', 1, 10000);
  v.positive(input.failureRate, 'failureRate', 'Total failure rate λ');
  v.nonNegative(input.time, 'time', 'Mission time');
  v.range(input.beta, 'beta', 'Common-cause fraction β', 0, 1);
  v.throwIfInvalid();
  const { units: n, failureRate: lambda, time: t, beta } = input;

  const independent = 1 - Math.pow(-Math.expm1(-lambda * t), n);
  const rIndep = Math.exp(-(1 - beta) * lambda * t);
  const rCommon = Math.exp(-beta * lambda * t);
  const withCcf = clamp(rCommon * (1 - Math.pow(1 - rIndep, n)), 0, 1);
  const qIndep = 1 - independent;
  const qCcf = 1 - withCcf;
  const ratio = qIndep > 0 ? qCcf / qIndep : Number.POSITIVE_INFINITY;

  return {
    beta,
    independentReliability: clamp(independent, 0, 1),
    withCommonCauseReliability: withCcf,
    difference: withCcf - independent,
    failureProbabilityRatio: ratio,
    exactness: 'exact',
    independenceAssumed: beta === 0,
    independenceNote: beta === 0 ? INDEPENDENCE_ASSUMED_NOTE : INDEPENDENCE_NOT_ASSUMED_NOTE,
    headline:
      beta === 0
        ? `With β = 0 the units are assumed fully independent: R = ${independent.toPrecision(8)}. ` +
          'That assumption is almost always optimistic — re-run with a non-zero β to see by how much.'
        : `A common-cause fraction β = ${beta} makes system failure ${
            Number.isFinite(ratio) ? `${ratio.toPrecision(4)}×` : 'infinitely'
          } more likely than the independence assumption suggests ` +
          `(R falls from ${independent.toPrecision(8)} to ${withCcf.toPrecision(8)}). ` +
          `No amount of redundancy can push the failure probability below the common-cause floor ` +
          `1 − e^{−βλt} = ${(-Math.expm1(-beta * lambda * t)).toPrecision(6)}.`,
    assumptions: [
      'Units are identical, in active parallel redundancy, with exponential lifetimes.',
      'A share β of the total failure rate acts on all units simultaneously; the remaining (1−β) acts independently.',
      'β is an engineering judgement (typically 0.01–0.2); it is an assumed input, not an estimate from these data.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Stress–strength interference
// ---------------------------------------------------------------------------

export interface StressStrengthResult {
  /** P(strength > stress) — the reliability against this load. */
  reliability: number;
  exactness: Exactness;
  method: 'closed form (normal–normal)' | 'numerical integration';
  /** Estimated absolute accuracy of the numerical route; null when exact. */
  estimatedError: number | null;
  safetyMargin: number | null;
  independenceAssumed: boolean;
  independenceNote: string;
  formula: string;
}

export interface StressStrengthInput {
  stress: { family: string; params: Params };
  strength: { family: string; params: Params };
  /**
   * Forces the numerical integral even where a closed form exists. Only useful
   * for cross-checking the quadrature against an analytic answer.
   */
  forceNumerical?: boolean;
}

/**
 * P(strength > stress). Exact closed form for normal–normal:
 *     Φ((μ_strength − μ_stress) / √(σ_strength² + σ_stress²)).
 * Otherwise a composite Simpson integral of f_stress(x)·R_strength(x).
 */
export function stressStrengthReliability(input: StressStrengthInput): StressStrengthResult {
  const stressDef = getDistribution(input.stress.family);
  const strengthDef = getDistribution(input.strength.family);
  if (stressDef.kind !== 'continuous' || strengthDef.kind !== 'continuous') {
    throw new EngineError(
      'Stress–strength interference is defined here for continuous stress and strength distributions only.',
      'invalid',
    );
  }
  const sp = input.stress.params;
  const gp = input.strength.params;

  if (!input.forceNumerical && input.stress.family === 'normal' && input.strength.family === 'normal') {
    const num = gp.mu - sp.mu;
    const den = Math.sqrt(gp.sigma * gp.sigma + sp.sigma * sp.sigma);
    if (!Number.isFinite(den) || den <= 0) {
      throw new EngineError('Both standard deviations are zero, so the comparison is degenerate.', 'range');
    }
    const z = num / den;
    return {
      reliability: clamp(normalCdf(z), 0, 1),
      exactness: 'exact',
      method: 'closed form (normal–normal)',
      estimatedError: null,
      safetyMargin: z,
      independenceAssumed: true,
      independenceNote:
        'Stress and strength were treated as statistically independent. A shared driver (temperature, ' +
        'duty cycle, batch) correlates them and changes this number in either direction.',
      formula: 'R = Φ((μ_strength − μ_stress) / √(σ_strength² + σ_stress²))',
    };
  }

  // Integrate ∫ f_stress(x) · P(strength > x) dx over the stress's effective range.
  const lo = Math.min(stressDef.quantile(1e-12, sp), strengthDef.quantile(1e-12, gp));
  const hi = Math.max(stressDef.quantile(1 - 1e-12, sp), strengthDef.quantile(1 - 1e-12, gp));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    throw new EngineError(
      'Could not establish a finite integration range for these distributions; ' +
        'the numerical stress–strength integral is not available.',
      'numerical',
    );
  }
  const simpson = (n: number): number => {
    const xs = linspace(lo, hi, n + 1);
    const h = (hi - lo) / n;
    let total = 0;
    for (let i = 0; i <= n; i += 1) {
      const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
      total += w * stressDef.pdf(xs[i], sp) * strengthDef.sf(xs[i], gp);
    }
    return (total * h) / 3;
  };
  const coarse = simpson(4000);
  const fine = simpson(8000);
  if (!Number.isFinite(fine)) {
    throw new EngineError('The stress–strength integral did not converge to a finite value.', 'numerical');
  }
  const error = Math.abs(fine - coarse) / 15;
  if (error > 1e-6) {
    throw new EngineError(
      `The stress–strength integral has not converged: Richardson error estimate ${error.toExponential(2)} ` +
        'exceeds 1e-6. No number is returned in its place.',
      'numerical',
    );
  }
  return {
    reliability: clamp(fine, 0, 1),
    exactness: 'numerical',
    method: 'numerical integration',
    estimatedError: error,
    safetyMargin: null,
    independenceAssumed: true,
    independenceNote:
      'Stress and strength were treated as statistically independent. A shared driver correlates them.',
    formula: 'R = ∫ f_stress(x) · P(strength > x) dx, composite Simpson',
  };
}

/** η·Γ(1+1/β) — exposed so callers can state the Weibull MTTF directly. */
export function weibullMttf(beta: number, eta: number): number {
  if (!Number.isFinite(beta) || beta <= 0) throw new EngineError(`Weibull shape β must be positive; got ${beta}.`, 'range');
  if (!Number.isFinite(eta) || eta <= 0) throw new EngineError(`Weibull scale η must be positive; got ${eta}.`, 'range');
  return eta * gammaFn(1 + 1 / beta);
}
