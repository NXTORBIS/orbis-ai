/**
 * Diffusions: Brownian motion, geometric Brownian motion, the
 * Ornstein–Uhlenbeck process, Merton jump diffusion, and Euler–Maruyama for a
 * user-supplied SDE.
 *
 * Where an exact transition law exists it is used for simulation, so the
 * simulated marginals are exact at the grid points and only Monte Carlo error
 * remains. Euler–Maruyama is the single exception and is labelled as a
 * discretisation.
 */
import { EngineError, Validator } from '../core/result';
import { normalCdf, normalSf } from '../special/gamma';
import type { Random } from '../random/rng';
import { quantity, type NormalLaw, type ProcessDefinition, type Quantity } from './types';
import { defined, undefinedMoment, type Moment } from '../distributions/types';

/* ------------------------------------------------------------------ *
 * Brownian motion with drift
 * ------------------------------------------------------------------ */

export const brownianMotionDefinition: ProcessDefinition = {
  id: 'brownian-motion',
  name: 'Brownian motion with drift',
  category: 'diffusion',
  description:
    'A continuous path that moves by independent normal increments: a steady trend μ per unit time plus noise whose spread grows with the square root of time.',
  formula: 'dX = μ dt + σ dW;  X(t) = x₀ + μt + σW(t)',
  stateSpaceText: 'X(t) ∈ ℝ, continuous paths, nowhere differentiable',
  params: [
    { key: 'x0', label: 'Start value', symbol: 'x₀', description: 'Value at time 0.', defaultValue: 0 },
    { key: 'drift', label: 'Drift', symbol: 'μ', description: 'Expected change per unit time.', defaultValue: 0 },
    { key: 'volatility', label: 'Volatility', symbol: 'σ', description: 'Standard deviation of the change over one unit of time.', defaultValue: 1, min: 0, minExclusive: true },
  ],
  assumptions: [
    'Increments over disjoint intervals are independent — no momentum and no mean reversion.',
    'Increments are normally distributed, so very large moves are rare in a specific (thin-tailed) way.',
    'The drift and volatility are constant in time and do not depend on the current level.',
  ],
  limitations: [
    'Values can go negative. For a quantity that cannot (a price, a population) use geometric Brownian motion instead.',
    'Real series have fat tails and volatility clustering; normal increments understate the chance of extreme moves.',
    'Variance grows without bound, so over long horizons the model says nothing is anchored. If the quantity is anchored, use Ornstein–Uhlenbeck.',
  ],
  exactResults: [
    'X(t) ~ Normal(x₀ + μt, σ²t)',
    'Cov(X(s), X(t)) = σ²·min(s, t)',
    'Running maximum (reflection principle): P(max_{s≤t} X(s) ≥ a) = Φ((μt−a)/(σ√t)) + e^{2μ(a−x₀)/σ²}·Φ((−a+x₀−μt)/(σ√t))',
    'Driftless case: P(max_{s≤t} X(s) ≥ a) = 2·P(X(t) ≥ a)',
    'First passage to a > x₀ with μ > 0: mean (a−x₀)/μ (infinite when μ ≤ 0)',
  ],
};

export interface BrownianParams {
  x0: number;
  drift: number;
  volatility: number;
}

function validateBrownian(p: BrownianParams): void {
  const v = new Validator();
  v.finite(p.x0, 'x0', 'Start value x₀');
  v.finite(p.drift, 'drift', 'Drift μ');
  v.positive(p.volatility, 'volatility', 'Volatility σ');
  v.throwIfInvalid();
}

function validatePositiveTime(t: number): void {
  const v = new Validator();
  v.positive(t, 't', 'Time t');
  v.throwIfInvalid();
}

/** Exact marginal law X(t) ~ Normal(x₀ + μt, σ²t). */
export function brownianMarginal(p: BrownianParams, t: number): NormalLaw {
  validateBrownian(p);
  const v = new Validator();
  v.nonNegative(t, 't', 'Time t');
  v.throwIfInvalid();
  const variance = p.volatility * p.volatility * t;
  return {
    mean: p.x0 + p.drift * t,
    variance,
    sd: Math.sqrt(variance),
    exactness: 'exact',
    formula: 'X(t) ~ Normal(x₀ + μt, σ²t)',
  };
}

/** Exact covariance Cov(X(s), X(t)) = σ²·min(s, t). */
export function brownianCovariance(p: BrownianParams, s: number, t: number): Quantity {
  validateBrownian(p);
  const v = new Validator();
  v.nonNegative(s, 's', 'Time s');
  v.nonNegative(t, 't', 'Time t');
  v.throwIfInvalid();
  return quantity('Cov(X(s), X(t))', p.volatility * p.volatility * Math.min(s, t), 'exact', {
    formula: 'σ²·min(s, t)',
    note: 'The drift does not appear: it is deterministic and contributes no covariance.',
  });
}

/**
 * Exact P(max_{s ≤ t} X(s) ≥ a), the reflection-principle result, which is
 * also the probability of first passage to the level a by time t.
 *
 * With drift the formula is
 *   Φ((μt − b)/(σ√t)) + exp(2μb/σ²)·Φ((−b − μt)/(σ√t)),  b = a − x₀ > 0,
 * which reduces to 2Φ(−b/(σ√t)) = 2·P(X(t) ≥ a) when μ = 0 — the clean
 * driftless reflection identity.
 */
export function brownianRunningMaxSf(p: BrownianParams, a: number, t: number): Quantity {
  validateBrownian(p);
  validatePositiveTime(t);
  const v = new Validator();
  v.finite(a, 'a', 'Level a');
  v.throwIfInvalid();
  const b = a - p.x0;
  if (b <= 0) {
    return quantity(`P(max_{s≤${t}} X(s) ≥ ${a})`, 1, 'exact', {
      formula: 'the level is at or below the starting point, so it is attained at time 0',
    });
  }
  const sig = p.volatility;
  const s = sig * Math.sqrt(t);
  const first = normalCdf((p.drift * t - b) / s);
  const expo = (2 * p.drift * b) / (sig * sig);
  // exp(expo)·Φ(z) with z very negative: compute in logs to avoid Inf·0.
  const z = (-b - p.drift * t) / s;
  const logSecond = expo + Math.log(normalCdf(z));
  const second = Number.isFinite(logSecond) ? Math.exp(logSecond) : 0;
  const value = Math.min(1, first + second);
  return quantity(`P(max_{s≤${t}} X(s) ≥ ${a})`, value, 'exact', {
    formula: 'Φ((μt−b)/(σ√t)) + e^{2μb/σ²}·Φ((−b−μt)/(σ√t)), b = a − x₀',
    note:
      p.drift === 0
        ? 'Driftless case: equal to 2·P(X(t) ≥ a) by the reflection principle.'
        : 'Reflection principle with drift (Bachelier–Lévy). Evaluated in logs so the exponential factor cannot overflow.',
  });
}

/** Exact P(X(t) ≥ a) for the marginal, for comparison with the maximum. */
export function brownianMarginalSf(p: BrownianParams, a: number, t: number): Quantity {
  const law = brownianMarginal(p, t);
  validatePositiveTime(t);
  return quantity(`P(X(${t}) ≥ ${a})`, normalSf((a - law.mean) / law.sd), 'exact', {
    formula: '1 − Φ((a − x₀ − μt)/(σ√t))',
  });
}

export interface FirstPassageLaw {
  level: number;
  /** P(T_a ≤ t). */
  cdf(t: number): Quantity;
  mean: Moment;
  /** Density of the first passage time (inverse Gaussian when μ > 0). */
  density(t: number): Quantity;
  distribution: string;
  notes: string[];
}

/**
 * Exact first-passage law to a level a > x₀ for Brownian motion with drift.
 *
 * P(T_a ≤ t) is the running-maximum tail above. The mean is (a−x₀)/μ when
 * μ > 0; when μ ≤ 0 the level is still reached with probability 1 only for
 * μ = 0, and the mean is infinite in both cases — reported as an undefined
 * moment with the reason, never as a number.
 */
export function brownianFirstPassage(p: BrownianParams, a: number): FirstPassageLaw {
  validateBrownian(p);
  const v = new Validator();
  v.finite(a, 'a', 'Level a');
  if (v.valid && a <= p.x0) {
    v.add(`The level a = ${a} is at or below the starting value x₀ = ${p.x0}, so first passage happens at time 0. Choose a level above the start (or use the mirrored process for a level below).`, 'a', 'range');
  }
  v.throwIfInvalid();
  const b = a - p.x0;
  const sig2 = p.volatility * p.volatility;
  const mean: Moment =
    p.drift > 0
      ? defined(b / p.drift)
      : undefinedMoment(
          p.drift === 0
            ? 'With zero drift the level is reached with probability 1, but the expected time to reach it is infinite (the first-passage law has a 1/t^{3/2} tail).'
            : 'With negative drift the level is reached with probability only exp(2μ(a−x₀)/σ²) < 1, so the expected first-passage time is infinite.',
        );
  return {
    level: a,
    distribution:
      p.drift > 0
        ? `Inverse Gaussian(mean ${b / p.drift}, shape ${(b * b) / sig2})`
        : 'Defective (improper) first-passage law: the level is not reached with probability 1',
    cdf: (t: number) => {
      const q = brownianRunningMaxSf(p, a, t);
      return quantity(`P(T_${a} ≤ ${t})`, q.value, 'exact', { formula: q.formula, note: q.note });
    },
    mean,
    density: (t: number) => {
      validatePositiveTime(t);
      const value =
        (b / (p.volatility * Math.sqrt(2 * Math.PI * t * t * t))) *
        Math.exp(-((b - p.drift * t) * (b - p.drift * t)) / (2 * sig2 * t));
      return quantity(`f_{T_${a}}(${t})`, value, 'exact', {
        formula: '(b/(σ√(2πt³)))·exp(−(b−μt)²/(2σ²t)), b = a − x₀',
      });
    },
    notes: [
      'This is the law of the crossing TIME; the running-maximum tail at a fixed t is the same statement read the other way round.',
      p.drift < 0
        ? `Total crossing probability over an infinite horizon is exp(2μ(a−x₀)/σ²) = ${Math.exp((2 * p.drift * b) / sig2).toPrecision(6)}, so the law is defective and the remaining mass never crosses.`
        : 'The level is crossed with probability 1 over an infinite horizon.',
    ],
  };
}

/**
 * Exact simulation on a grid: increments are independent
 * Normal(μΔ, σ²Δ), which is the law of the process, not a discretisation.
 */
export function sampleBrownianPath(rng: Random, p: BrownianParams, times: number[]): number[] {
  validateBrownian(p);
  const out = new Array<number>(times.length);
  let x = p.x0;
  let prev = 0;
  for (let j = 0; j < times.length; j++) {
    const dt = times[j] - prev;
    if (dt > 0) x += p.drift * dt + p.volatility * Math.sqrt(dt) * rng.normal();
    out[j] = x;
    prev = times[j];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Geometric Brownian motion
 * ------------------------------------------------------------------ */

/**
 * PARAMETERISATION — read this before using any number below.
 *
 * The SDE is
 *
 *     dS = μ S dt + σ S dW,
 *
 * so μ is the instantaneous EXPECTED RETURN of S (the drift of dS/S), not the
 * drift of log S. By Itô's lemma
 *
 *     d(log S) = (μ − σ²/2) dt + σ dW,
 *
 * hence
 *
 *     log(S(t)/S₀) ~ Normal((μ − σ²/2)t, σ²t)     ← the −σ²/2 is the Itô correction
 *     E[S(t)] = S₀·e^{μt}
 *     median S(t) = S₀·e^{(μ−σ²/2)t}              ← strictly below the mean
 *
 * The expected value and the typical (median) path therefore diverge: with
 * σ² > 2μ the median falls while the mean rises. Quoting e^{μt} as "what the
 * process does" is the usual mistake. If your μ is instead a log-return drift
 * m (so log S has drift m), then μ = m + σ²/2 and E[S(t)] = S₀e^{(m+σ²/2)t};
 * use `gbmFromLogDrift` to convert rather than reinterpreting the field.
 */
export const geometricBrownianDefinition: ProcessDefinition = {
  id: 'gbm',
  name: 'Geometric Brownian motion',
  category: 'diffusion',
  description:
    'A positive quantity whose proportional changes are independent and normal: the standard model for prices and for anything that grows multiplicatively.',
  formula: 'dS = μ S dt + σ S dW;  S(t) = S₀·exp((μ − σ²/2)t + σW(t))',
  stateSpaceText: 'S(t) > 0, continuous paths; log S is Brownian motion with drift μ − σ²/2',
  params: [
    { key: 's0', label: 'Start value', symbol: 'S₀', description: 'Value at time 0, must be positive.', defaultValue: 100, min: 0, minExclusive: true },
    { key: 'drift', label: 'Expected return', symbol: 'μ', description: 'Instantaneous expected return per unit time — the drift of dS/S, NOT the drift of log S. E[S(t)] = S₀e^{μt}.', defaultValue: 0.05 },
    { key: 'volatility', label: 'Volatility', symbol: 'σ', description: 'Standard deviation of the log return over one unit of time.', defaultValue: 0.2, min: 0, minExclusive: true },
  ],
  assumptions: [
    'Log returns over disjoint intervals are independent and normal — no trends in volatility, no mean reversion in returns.',
    'μ and σ are constant.',
    'The quantity is strictly positive and can never reach zero in finite time.',
    'μ is the expected return of S itself; the drift of log S is μ − σ²/2 (Itô correction).',
  ],
  limitations: [
    'Observed returns are fat-tailed and volatility clusters; this model cannot produce either.',
    'Zero is unreachable, so default, bankruptcy and total loss cannot be modelled.',
    'The mean and the median diverge exponentially. Reporting E[S(t)] alone is misleading for a single realised path; report the median and path quantiles too.',
  ],
  exactResults: [
    'log(S(t)/S₀) ~ Normal((μ − σ²/2)t, σ²t)',
    'E[S(t)] = S₀e^{μt}',
    'Var[S(t)] = S₀²e^{2μt}(e^{σ²t} − 1)',
    'median S(t) = S₀e^{(μ−σ²/2)t}',
    'First passage to a level via the log process, by the reflection principle',
  ],
};

export interface GbmParams {
  s0: number;
  /** Instantaneous expected return (drift of dS/S). See the module note. */
  drift: number;
  volatility: number;
}

/** Build GBM parameters from a LOG drift m (drift of log S): μ = m + σ²/2. */
export function gbmFromLogDrift(s0: number, logDrift: number, volatility: number): GbmParams {
  const v = new Validator();
  v.positive(s0, 's0', 'Start value S₀');
  v.finite(logDrift, 'logDrift', 'Log drift m');
  v.positive(volatility, 'volatility', 'Volatility σ');
  v.throwIfInvalid();
  return { s0, drift: logDrift + (volatility * volatility) / 2, volatility };
}

function validateGbm(p: GbmParams): void {
  const v = new Validator();
  v.positive(p.s0, 's0', 'Start value S₀');
  v.finite(p.drift, 'drift', 'Expected return μ');
  v.positive(p.volatility, 'volatility', 'Volatility σ');
  v.throwIfInvalid();
}

export interface GbmMarginal {
  /** Law of log(S(t)/S₀). */
  logLaw: NormalLaw;
  mean: Quantity;
  variance: Quantity;
  median: Quantity;
  itoCorrection: Quantity;
  parameterisation: string;
  exactness: 'exact';
}

export function gbmMarginal(p: GbmParams, t: number): GbmMarginal {
  validateGbm(p);
  const v = new Validator();
  v.nonNegative(t, 't', 'Time t');
  v.throwIfInvalid();
  const sig2 = p.volatility * p.volatility;
  const logMean = (p.drift - sig2 / 2) * t;
  const logVar = sig2 * t;
  const mean = p.s0 * Math.exp(p.drift * t);
  return {
    logLaw: {
      mean: logMean,
      variance: logVar,
      sd: Math.sqrt(logVar),
      exactness: 'exact',
      formula: 'log(S(t)/S₀) ~ Normal((μ − σ²/2)t, σ²t)',
    },
    mean: quantity('E[S(t)]', mean, 'exact', { formula: 'S₀·e^{μt}' }),
    variance: quantity('Var[S(t)]', p.s0 * p.s0 * Math.exp(2 * p.drift * t) * (Math.exp(logVar) - 1), 'exact', {
      formula: 'S₀²e^{2μt}(e^{σ²t} − 1)',
    }),
    median: quantity('median S(t)', p.s0 * Math.exp(logMean), 'exact', {
      formula: 'S₀·e^{(μ−σ²/2)t}',
      note: 'Below the mean whenever σ > 0. More than half of all paths end below E[S(t)].',
    }),
    itoCorrection: quantity('Itô correction', -sig2 / 2, 'exact', {
      formula: '−σ²/2, the gap between the drift of log S and μ',
      note: 'log S drifts at μ − σ²/2 while S has expected growth rate μ. Dropping this term is the single most common error in this formula; its sign is negative.',
    }),
    parameterisation:
      'μ is the instantaneous expected return of S (drift of dS/S), so E[S(t)] = S₀e^{μt} and log S drifts at μ − σ²/2. If your μ is a log-return drift, convert with gbmFromLogDrift.',
    exactness: 'exact',
  };
}

/** Exact P(S(t) ≥ a) via the log transform. */
export function gbmMarginalSf(p: GbmParams, a: number, t: number): Quantity {
  const m = gbmMarginal(p, t);
  const v = new Validator();
  v.positive(a, 'a', 'Level a');
  v.positive(t, 't', 'Time t');
  v.throwIfInvalid();
  const z = (Math.log(a / p.s0) - m.logLaw.mean) / m.logLaw.sd;
  return quantity(`P(S(${t}) ≥ ${a})`, normalSf(z), 'exact', {
    formula: '1 − Φ((log(a/S₀) − (μ−σ²/2)t)/(σ√t))',
  });
}

/**
 * Exact first-passage probability for GBM to a level a, by applying the
 * Brownian reflection principle to log S (a monotone transform, so the
 * crossing times coincide exactly).
 */
export function gbmFirstPassageProbability(p: GbmParams, a: number, t: number): Quantity {
  validateGbm(p);
  const v = new Validator();
  v.positive(a, 'a', 'Level a');
  v.positive(t, 't', 'Time t');
  v.throwIfInvalid();
  const sig2 = p.volatility * p.volatility;
  const logParams: BrownianParams = { x0: 0, drift: p.drift - sig2 / 2, volatility: p.volatility };
  const b = Math.log(a / p.s0);
  if (b <= 0) {
    return quantity(`P(max_{s≤${t}} S(s) ≥ ${a})`, 1, 'exact', { formula: 'the level is at or below S₀' });
  }
  const q = brownianRunningMaxSf(logParams, b, t);
  return quantity(`P(max_{s≤${t}} S(s) ≥ ${a})`, q.value, 'exact', {
    formula: 'reflection principle applied to log S, which drifts at μ − σ²/2',
    note: 'log is strictly increasing, so S crosses a exactly when log S crosses log(a/S₀). The Itô-corrected drift must be used here.',
  });
}

/** Exact simulation: the log increments are exactly normal. */
export function sampleGbmPath(rng: Random, p: GbmParams, times: number[]): number[] {
  validateGbm(p);
  const sig2 = p.volatility * p.volatility;
  const out = new Array<number>(times.length);
  let logS = Math.log(p.s0);
  let prev = 0;
  for (let j = 0; j < times.length; j++) {
    const dt = times[j] - prev;
    if (dt > 0) logS += (p.drift - sig2 / 2) * dt + p.volatility * Math.sqrt(dt) * rng.normal();
    out[j] = Math.exp(logS);
    prev = times[j];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Ornstein–Uhlenbeck
 * ------------------------------------------------------------------ */

export const ornsteinUhlenbeckDefinition: ProcessDefinition = {
  id: 'ornstein-uhlenbeck',
  name: 'Ornstein–Uhlenbeck process',
  category: 'diffusion',
  description:
    'A mean-reverting continuous process: it is pulled back towards a long-run level θ at a speed κ, with noise σ. Models interest-rate spreads, temperatures, inventory levels and anything anchored.',
  formula: 'dX = κ(θ − X) dt + σ dW',
  stateSpaceText: 'X(t) ∈ ℝ, continuous paths, stationary in the long run',
  params: [
    { key: 'x0', label: 'Start value', symbol: 'x₀', description: 'Value at time 0.', defaultValue: 0 },
    { key: 'meanLevel', label: 'Long-run level', symbol: 'θ', description: 'Level the process reverts to.', defaultValue: 0 },
    { key: 'reversionRate', label: 'Reversion speed', symbol: 'κ', description: 'How fast the gap to θ decays; the half-life is ln2/κ.', defaultValue: 1, min: 0, minExclusive: true },
    { key: 'volatility', label: 'Volatility', symbol: 'σ', description: 'Instantaneous noise scale (not the stationary SD, which is σ/√(2κ)).', defaultValue: 1, min: 0, minExclusive: true },
  ],
  assumptions: [
    'Reversion is linear in the gap to θ and the speed κ is constant.',
    'Noise is Gaussian with constant σ, independent of the level.',
    'θ, κ and σ do not change over time.',
  ],
  limitations: [
    'Values can go negative. For a rate or a spread that cannot, use a square-root (CIR) process instead.',
    'A single realisation makes κ hard to estimate; estimates of mean reversion from short samples are badly biased upwards.',
    'Real anchoring levels drift. If θ itself moves, this model will mistake that drift for slow reversion.',
  ],
  exactResults: [
    'Transition: X(t+Δ) | X(t)=x ~ Normal(θ + (x−θ)e^{−κΔ}, σ²(1−e^{−2κΔ})/(2κ))',
    'Stationary law: Normal(θ, σ²/(2κ))',
    'Stationary autocorrelation: ρ(lag) = e^{−κ·lag}',
    'Half-life of a deviation: ln2/κ',
  ],
};

export interface OuParams {
  x0: number;
  meanLevel: number;
  reversionRate: number;
  volatility: number;
}

function validateOu(p: OuParams): void {
  const v = new Validator();
  v.finite(p.x0, 'x0', 'Start value x₀');
  v.finite(p.meanLevel, 'meanLevel', 'Long-run level θ');
  v.positive(p.reversionRate, 'reversionRate', 'Reversion speed κ');
  v.positive(p.volatility, 'volatility', 'Volatility σ');
  v.throwIfInvalid();
}

/** Exact transition law over a lag Δ from a given current value. */
export function ouTransition(p: OuParams, x: number, dt: number): NormalLaw {
  validateOu(p);
  const v = new Validator();
  v.finite(x, 'x', 'Current value');
  v.nonNegative(dt, 'dt', 'Lag Δ');
  v.throwIfInvalid();
  const e = Math.exp(-p.reversionRate * dt);
  const variance = ((p.volatility * p.volatility) * (1 - e * e)) / (2 * p.reversionRate);
  return {
    mean: p.meanLevel + (x - p.meanLevel) * e,
    variance,
    sd: Math.sqrt(variance),
    exactness: 'exact',
    formula: 'Normal(θ + (x−θ)e^{−κΔ}, σ²(1−e^{−2κΔ})/(2κ))',
  };
}

/** Exact marginal from the deterministic start x₀. */
export function ouMarginal(p: OuParams, t: number): NormalLaw {
  return ouTransition(p, p.x0, t);
}

export interface OuStationary {
  law: NormalLaw;
  halfLife: Quantity;
  autocorrelation(lag: number): Quantity;
}

export function ouStationary(p: OuParams): OuStationary {
  validateOu(p);
  const variance = (p.volatility * p.volatility) / (2 * p.reversionRate);
  return {
    law: {
      mean: p.meanLevel,
      variance,
      sd: Math.sqrt(variance),
      exactness: 'exact',
      formula: 'Normal(θ, σ²/(2κ))',
    },
    halfLife: quantity('Half-life of a deviation', Math.LN2 / p.reversionRate, 'exact', {
      formula: 'ln2/κ',
      note: 'Time for the expected gap to θ to halve. It does not depend on σ.',
    }),
    autocorrelation: (lag: number) => {
      const v = new Validator();
      v.nonNegative(lag, 'lag', 'Lag');
      v.throwIfInvalid();
      return quantity(`ρ(${lag})`, Math.exp(-p.reversionRate * lag), 'exact', {
        formula: 'e^{−κ·lag}',
        note: 'Valid in the stationary regime; from a fixed start it holds only after several half-lives.',
      });
    },
  };
}

/**
 * Simulate with the EXACT transition law, not Euler–Maruyama: the exact
 * conditional distribution is Gaussian and known, so there is no reason to
 * accept a discretisation error. Grid points are exactly distributed whatever
 * the step size.
 */
export function sampleOuPath(rng: Random, p: OuParams, times: number[]): number[] {
  validateOu(p);
  const out = new Array<number>(times.length);
  let x = p.x0;
  let prev = 0;
  for (let j = 0; j < times.length; j++) {
    const dt = times[j] - prev;
    if (dt > 0) {
      const e = Math.exp(-p.reversionRate * dt);
      const sd = Math.sqrt(((p.volatility * p.volatility) * (1 - e * e)) / (2 * p.reversionRate));
      x = p.meanLevel + (x - p.meanLevel) * e + sd * rng.normal();
    }
    out[j] = x;
    prev = times[j];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Merton jump diffusion
 * ------------------------------------------------------------------ */

export const jumpDiffusionDefinition: ProcessDefinition = {
  id: 'merton-jump-diffusion',
  name: 'Merton jump diffusion',
  category: 'diffusion',
  description:
    'Geometric Brownian motion plus sudden jumps arriving as a Poisson process, with normally distributed jump sizes in log space. Produces the fat tails and discontinuities that pure diffusion cannot.',
  formula:
    'log S(t) = log S₀ + (μ − σ²/2)t + σW(t) + Σ_{i=1}^{N(t)} Y_i,  N ~ Poisson(λt),  Y_i ~ Normal(a, b²)',
  stateSpaceText: 'S(t) > 0, right-continuous with jumps',
  params: [
    { key: 's0', label: 'Start value', symbol: 'S₀', description: 'Value at time 0.', defaultValue: 100, min: 0, minExclusive: true },
    { key: 'drift', label: 'Diffusive drift', symbol: 'μ', description: 'Drift of the continuous part in the same convention as GBM (dS/S), BEFORE jumps. The total expected growth includes the jump term.', defaultValue: 0.05 },
    { key: 'volatility', label: 'Diffusive volatility', symbol: 'σ', description: 'Volatility of the continuous part.', defaultValue: 0.2, min: 0, minExclusive: true },
    { key: 'jumpRate', label: 'Jump rate', symbol: 'λ', description: 'Expected number of jumps per unit time.', defaultValue: 0.5, min: 0 },
    { key: 'jumpLogMean', label: 'Mean log jump', symbol: 'a', description: 'Mean of the normal jump size in log space (negative for crashes).', defaultValue: -0.1 },
    { key: 'jumpLogSd', label: 'Log jump SD', symbol: 'b', description: 'Standard deviation of the jump size in log space.', defaultValue: 0.15, min: 0 },
  ],
  assumptions: [
    'Jump times are a homogeneous Poisson process, independent of the diffusion.',
    'Jump sizes are i.i.d. normal in log space, so the multiplicative jump factor is log-normal and strictly positive.',
    'All parameters are constant.',
  ],
  limitations: [
    'Jumps are independent of each other and of the diffusion. Real crashes cluster and raise volatility afterwards; this model cannot do that.',
    'Separating λ, a, b and σ from one realised path is badly identified: many combinations fit the same data.',
    'The convention matters: μ here is the drift of the continuous part only. The total expected growth rate is μ + λ(e^{a+b²/2} − 1).',
  ],
  exactResults: [
    'E[S(t)] = S₀·exp(μt + λt(e^{a+b²/2} − 1))',
    'log S(t) is a Poisson mixture of normals (exact, conditional on the jump count)',
  ],
};

export interface JumpDiffusionParams {
  s0: number;
  drift: number;
  volatility: number;
  jumpRate: number;
  jumpLogMean: number;
  jumpLogSd: number;
}

function validateJumpDiffusion(p: JumpDiffusionParams): void {
  const v = new Validator();
  v.positive(p.s0, 's0', 'Start value S₀');
  v.finite(p.drift, 'drift', 'Diffusive drift μ');
  v.positive(p.volatility, 'volatility', 'Diffusive volatility σ');
  v.nonNegative(p.jumpRate, 'jumpRate', 'Jump rate λ');
  v.finite(p.jumpLogMean, 'jumpLogMean', 'Mean log jump a');
  v.nonNegative(p.jumpLogSd, 'jumpLogSd', 'Log jump SD b');
  v.throwIfInvalid();
}

/** Exact E[S(t)] for the stated parameterisation. */
export function jumpDiffusionMean(p: JumpDiffusionParams, t: number): Quantity {
  validateJumpDiffusion(p);
  const v = new Validator();
  v.nonNegative(t, 't', 'Time t');
  v.throwIfInvalid();
  const jumpFactor = Math.exp(p.jumpLogMean + (p.jumpLogSd * p.jumpLogSd) / 2) - 1;
  return quantity('E[S(t)]', p.s0 * Math.exp(p.drift * t + p.jumpRate * t * jumpFactor), 'exact', {
    formula: 'S₀·exp(μt + λt(e^{a+b²/2} − 1))',
    note: 'μ is the drift of the continuous part alone; the second term is the expected contribution of the jumps. The whole expected growth rate is μ + λ(e^{a+b²/2} − 1).',
  });
}

/**
 * Exact simulation on a grid: within each step the diffusive increment is
 * normal and the number of jumps is Poisson, both sampled exactly.
 */
export function sampleJumpDiffusionPath(rng: Random, p: JumpDiffusionParams, times: number[]): number[] {
  validateJumpDiffusion(p);
  const sig2 = p.volatility * p.volatility;
  const out = new Array<number>(times.length);
  let logS = Math.log(p.s0);
  let prev = 0;
  for (let j = 0; j < times.length; j++) {
    const dt = times[j] - prev;
    if (dt > 0) {
      logS += (p.drift - sig2 / 2) * dt + p.volatility * Math.sqrt(dt) * rng.normal();
      const jumps = rng.poisson(p.jumpRate * dt);
      for (let i = 0; i < jumps; i++) logS += p.jumpLogMean + p.jumpLogSd * rng.normal();
    }
    out[j] = Math.exp(logS);
    prev = times[j];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Euler–Maruyama for an arbitrary SDE
 * ------------------------------------------------------------------ */

export interface SdeSpec {
  /** a(t, x) in dX = a dt + b dW. */
  drift(t: number, x: number): number;
  /** b(t, x) in dX = a dt + b dW. */
  diffusion(t: number, x: number): number;
  x0: number;
}

export const eulerMaruyamaNote =
  'Euler–Maruyama is a DISCRETISATION, not the process. Its error depends on the step size h: strong order 1/2 (pathwise error O(√h)) and weak order 1 (error in expectations O(h)). Halving the step reduces the error in an expectation by about half and the pathwise error by about 30%. Where an exact transition exists (Brownian motion, geometric Brownian motion, Ornstein–Uhlenbeck) this module simulates exactly instead and you should not use this function for them. The scheme can also leave the natural domain of the process — it can make a positive quantity negative — and no reflection or truncation is applied here because that would change the law silently.';

export interface EulerPathResult {
  times: number[];
  values: number[];
  stepSize: number;
  exactness: 'numerical';
  method: string;
  limitations: string[];
}

/**
 * One Euler–Maruyama path on a uniform grid of `steps` steps over [0, horizon].
 */
export function sampleEulerMaruyamaPath(
  rng: Random,
  sde: SdeSpec,
  horizon: number,
  steps: number,
): EulerPathResult {
  const v = new Validator();
  v.positive(horizon, 'horizon', 'Horizon');
  v.integer(steps, 'steps', 'Number of steps', 1);
  v.finite(sde.x0, 'x0', 'Start value');
  v.throwIfInvalid();
  const h = horizon / steps;
  const sqrtH = Math.sqrt(h);
  const times = new Array<number>(steps + 1);
  const values = new Array<number>(steps + 1);
  let x = sde.x0;
  times[0] = 0;
  values[0] = x;
  for (let i = 1; i <= steps; i++) {
    const t = (i - 1) * h;
    const a = sde.drift(t, x);
    const b = sde.diffusion(t, x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new EngineError(
        `The SDE coefficients are not finite at t=${t}, x=${x} (drift ${a}, diffusion ${b}). The path was abandoned rather than continued with a made-up value.`,
        'finite',
      );
    }
    x = x + a * h + b * sqrtH * rng.normal();
    if (!Number.isFinite(x)) {
      throw new EngineError(
        `The Euler–Maruyama path diverged to ${x} at step ${i} (t=${i * h}). This usually means the step size is too large for the drift, or the SDE has no solution from this start. Reduce the step size.`,
        'diverged',
      );
    }
    times[i] = i * h;
    values[i] = x;
  }
  return {
    times,
    values,
    stepSize: h,
    exactness: 'numerical',
    method: 'Euler–Maruyama, X_{n+1} = X_n + a(t_n,X_n)h + b(t_n,X_n)√h·Z_n',
    limitations: [eulerMaruyamaNote],
  };
}

/** Euler–Maruyama sampler on a caller-supplied grid, for use in an ensemble. */
export function eulerMaruyamaSampler(sde: SdeSpec, substepsPerInterval = 10): (rng: Random, times: number[]) => number[] {
  const v = new Validator();
  v.integer(substepsPerInterval, 'substepsPerInterval', 'Substeps per grid interval', 1);
  v.throwIfInvalid();
  return (rng: Random, times: number[]) => {
    const out = new Array<number>(times.length);
    let x = sde.x0;
    let t = 0;
    for (let j = 0; j < times.length; j++) {
      const span = times[j] - t;
      if (span > 0) {
        const h = span / substepsPerInterval;
        const sqrtH = Math.sqrt(h);
        for (let i = 0; i < substepsPerInterval; i++) {
          const a = sde.drift(t, x);
          const b = sde.diffusion(t, x);
          if (!Number.isFinite(a) || !Number.isFinite(b)) {
            throw new EngineError(`The SDE coefficients are not finite at t=${t}, x=${x}.`, 'finite');
          }
          x = x + a * h + b * sqrtH * rng.normal();
          t += h;
        }
      }
      t = times[j];
      out[j] = x;
    }
    return out;
  };
}
