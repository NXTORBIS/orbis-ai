/**
 * A uniform interface over risk measures, each carrying the coherence axioms it
 * satisfies and a note on whether it can be backtested.
 *
 * The four coherence axioms (Artzner, Delbaen, Eber & Heath 1999) for a measure
 * ρ on losses:
 *
 *   monotonicity            L₁ ≤ L₂ almost surely ⟹ ρ(L₁) ≤ ρ(L₂)
 *   translation invariance   ρ(L + c) = ρ(L) + c
 *   positive homogeneity     ρ(λL) = λ·ρ(L) for λ ≥ 0
 *   subadditivity            ρ(L₁ + L₂) ≤ ρ(L₁) + ρ(L₂)
 *
 * Subadditivity is the axiom that encodes "diversification cannot increase
 * risk". **Value at Risk fails it.** That is not a technicality: it means a VaR
 * limit can reward concentration and punish diversification, and that two desks
 * each inside their VaR limit can breach the firm's. `findVarSubadditivityViolation`
 * and `constructVarSubadditivityCounterexample` below build an explicit
 * numerical example rather than asserting the fact.
 */
import { EngineError, type Exactness } from '../core/result';
import { normalCdf, normalPdf, normalQuantile } from '../special/gamma';
import { sortedCopy } from '../stats/descriptive';
import {
  applyWeights,
  assertLevel,
  distortionWeights,
  empiricalEntropic,
  empiricalEs,
  empiricalExpectile,
  empiricalMedianShortfall,
  empiricalRangeVar,
  empiricalVar,
  populationSd,
  quantileIntegralWeights,
  sampleMean,
  upperSemideviation,
} from './empirical';
import { convolveLaws, lawEs, lawVar, makeLaw, type DiscreteLaw } from './discrete';
import { parametricNormalRisk } from '../risk/risk';

export interface RiskMeasureAxioms {
  monotone: boolean;
  translationInvariant: boolean;
  positiveHomogeneous: boolean;
  /** The crucial one. */
  subadditive: boolean;
  convex: boolean;
  comonotoneAdditive: boolean;
  /** Coherent = all four of the above axioms. */
  coherent: boolean;
  notes: string[];
}

export interface RiskMeasure {
  id: string;
  name: string;
  /** Parameters actually used, echoed back so a result is self-describing. */
  params: Readonly<Record<string, number>>;
  axioms: RiskMeasureAxioms;
  /** Elicitable = it is the minimiser of some expected scoring function. */
  elicitable: boolean;
  elicitabilityNote: string;
  backtestNote: string;
  /**
   * Weights on ascending order statistics, when the measure is a spectral
   * (distortion) measure; `null` otherwise. A non-null value is what makes the
   * Euler allocation sum exactly to the total.
   */
  spectralWeights(n: number): Float64Array | null;
  /** Evaluate on an **ascending-sorted** array of losses. */
  evaluate(sortedLosses: ArrayLike<number>): number;
}

export interface RiskMeasureParamSpec {
  key: string;
  label: string;
  description: string;
  defaultValue: number;
  min: number;
  max: number;
}

export interface RiskMeasureDef {
  id: string;
  name: string;
  description: string;
  params: RiskMeasureParamSpec[];
  create(params?: Record<string, number>): RiskMeasure;
}

const LEVEL: RiskMeasureParamSpec = {
  key: 'level',
  label: 'Confidence level α',
  description: 'The probability the loss stays at or below Value at Risk.',
  defaultValue: 0.95,
  min: 0,
  max: 1,
};

function readParams(spec: RiskMeasureParamSpec[], given: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of spec) {
    const v = given?.[s.key] ?? s.defaultValue;
    if (!Number.isFinite(v)) throw new EngineError(`${s.label} must be a finite number; received ${v}.`, 'finite');
    if (v < s.min || v > s.max) throw new EngineError(`${s.label} must lie between ${s.min} and ${s.max}; received ${v}.`, 'range');
    out[s.key] = v;
  }
  return out;
}

const coherentAxioms = (notes: string[]): RiskMeasureAxioms => ({
  monotone: true,
  translationInvariant: true,
  positiveHomogeneous: true,
  subadditive: true,
  convex: true,
  comonotoneAdditive: true,
  coherent: true,
  notes,
});

/** Value at Risk. */
export function varMeasure(level = 0.95): RiskMeasure {
  assertLevel(level);
  return {
    id: 'var',
    name: `Value at Risk at ${(level * 100).toPrecision(4)}%`,
    params: { level },
    axioms: {
      monotone: true,
      translationInvariant: true,
      positiveHomogeneous: true,
      subadditive: false,
      convex: false,
      comonotoneAdditive: true,
      coherent: false,
      notes: [
        'Value at Risk is NOT subadditive. VaR(X + Y) can exceed VaR(X) + VaR(Y), so combining two exposures can appear to increase risk and a VaR limit can penalise diversification.',
        'VaR is subadditive in the special case of jointly elliptical (for example jointly normal) losses, which is why the failure is easy to overlook in a Gaussian model.',
        'VaR says nothing about the size of the loss once the threshold is breached.',
      ],
    },
    elicitable: true,
    elicitabilityNote:
      'VaR is elicitable: it is the minimiser of the expected asymmetric piecewise-linear ("tick") loss, so forecasts can be ranked and compared directly.',
    backtestNote:
      'Backtesting VaR is straightforward because an exception is observable: Kupiec (unconditional coverage), Christoffersen (independence, conditional coverage) and the Basel traffic-light test all apply.',
    spectralWeights: () => null,
    evaluate: (sorted) => empiricalVar(sorted, level),
  };
}

/** Expected Shortfall (= CVaR = average value at risk, for a continuous law). */
export function esMeasure(level = 0.95): RiskMeasure {
  assertLevel(level);
  return {
    id: 'es',
    name: `Expected Shortfall at ${(level * 100).toPrecision(4)}%`,
    params: { level },
    axioms: coherentAxioms([
      'Expected Shortfall is coherent: subadditive, so the risk of a combination never exceeds the sum of the parts.',
      'ES is the smallest law-invariant coherent risk measure dominating VaR at the same level.',
      'ES ≥ VaR at the same level, always.',
    ]),
    elicitable: false,
    elicitabilityNote:
      'ES is NOT elicitable on its own (Gneiting 2011); it is only jointly elicitable together with VaR (Fissler & Ziegel 2016). There is no scoring function whose expected value ES alone minimises.',
    backtestNote:
      'Because ES is not elicitable on its own, backtesting it is harder than backtesting VaR: the standard tests (Acerbi–Székely) need the predicted distribution, not just an exception indicator, and they have lower power. This is a real limitation of ES, not a reason to prefer VaR.',
    spectralWeights: (n) => quantileIntegralWeights(n, level, 1),
    evaluate: (sorted) => empiricalEs(sorted, level),
  };
}

/** Entropic risk measure (1/θ)·log E[e^{θL}]. */
export function entropicMeasure(theta = 1): RiskMeasure {
  if (!(theta > 0)) throw new EngineError(`The entropic risk aversion θ must be greater than 0; received ${theta}.`, 'range');
  return {
    id: 'entropic',
    name: `Entropic risk measure (θ = ${theta})`,
    params: { theta },
    axioms: {
      monotone: true,
      translationInvariant: true,
      positiveHomogeneous: false,
      subadditive: false,
      convex: true,
      comonotoneAdditive: false,
      coherent: false,
      notes: [
        'The entropic measure is convex and monotone but not positively homogeneous — doubling an exposure more than doubles the measured risk — so it is a convex risk measure, not a coherent one.',
        'It is additive for independent exposures, which means it credits no diversification benefit for independence and is not subadditive in general.',
        'It is the certainty equivalent of exponential utility with risk aversion θ.',
      ],
    },
    elicitable: false,
    elicitabilityNote: 'Not elicitable (it is not a quantile- or expectile-type functional); it has no consistent scoring function.',
    backtestNote: 'No standard backtest exists. Comparing realised exponential moments against predicted ones is the usual improvisation and is sensitive to θ.',
    spectralWeights: () => null,
    evaluate: (sorted) => empiricalEntropic(sorted, theta),
  };
}

/**
 * A general spectral / distortion risk measure. Supply either a distortion
 * function g on the exceedance probability (coherent iff g is concave) or a
 * spectrum φ on the quantile level (coherent iff φ is non-decreasing).
 */
export function distortionMeasure(opts: {
  id: string;
  name: string;
  /** g(0) = 0, g(1) = 1, increasing. */
  g: (t: number) => number;
  concave: boolean;
  params?: Record<string, number>;
  notes?: string[];
}): RiskMeasure {
  const g0 = opts.g(0);
  const g1 = opts.g(1);
  if (Math.abs(g0) > 1e-9 || Math.abs(g1 - 1) > 1e-9) {
    throw new EngineError(`A distortion function must satisfy g(0) = 0 and g(1) = 1; received g(0) = ${g0}, g(1) = ${g1}.`, 'domain');
  }
  // Check monotonicity on a grid; a decreasing distortion is not a risk measure
  // at all, so this is refused rather than silently used.
  let prev = 0;
  for (let i = 1; i <= 2000; i++) {
    const t = i / 2000;
    const v = opts.g(t);
    if (!Number.isFinite(v)) throw new EngineError(`The distortion function is not finite at t = ${t}.`, 'finite');
    if (v < prev - 1e-10) {
      throw new EngineError(`The distortion function must be non-decreasing; it decreases near t = ${t}.`, 'domain');
    }
    prev = v;
  }
  const axioms: RiskMeasureAxioms = opts.concave
    ? coherentAxioms([
        'A distortion risk measure with a concave distortion (equivalently a non-decreasing spectrum) is coherent and comonotone additive.',
        ...(opts.notes ?? []),
      ])
    : {
        monotone: true,
        translationInvariant: true,
        positiveHomogeneous: true,
        subadditive: false,
        convex: false,
        comonotoneAdditive: true,
        coherent: false,
        notes: [
          'This distortion is not concave, so the measure is not subadditive and therefore not coherent. VaR is the extreme case of a non-concave distortion (a step).',
          ...(opts.notes ?? []),
        ],
      };
  return {
    id: opts.id,
    name: opts.name,
    params: opts.params ?? {},
    axioms,
    elicitable: false,
    elicitabilityNote:
      'Spectral measures other than the mean are not elicitable on their own; like ES they admit only joint elicitability with the quantiles they average.',
    backtestNote: 'Backtesting requires the predicted distribution, as for ES. An exception-count test is not available because there is no single threshold.',
    spectralWeights: (n) => distortionWeights(n, opts.g),
    evaluate: (sorted) => applyWeights(sorted, distortionWeights(sorted.length, opts.g)),
  };
}

/** Wang transform: g(t) = Φ(Φ⁻¹(t) + λ), concave (hence coherent) for λ > 0. */
export function wangTransformMeasure(lambda = 0.5): RiskMeasure {
  if (!(lambda > 0)) throw new EngineError(`The Wang transform parameter λ must be greater than 0 for a coherent measure; received ${lambda}.`, 'range');
  return distortionMeasure({
    id: 'wang',
    name: `Wang transform (λ = ${lambda})`,
    params: { lambda },
    concave: true,
    g: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : normalCdf(normalQuantile(t) + lambda)),
    notes: [
      'The Wang transform shifts the whole distribution in the normal quantile scale, so it loads every part of the distribution rather than only the tail beyond a threshold.',
      'λ is interpretable as a market price of risk in standard-deviation units.',
    ],
  });
}

/** Proportional hazards transform: g(t) = t^{1/ρ}, concave for ρ ≥ 1. */
export function proportionalHazardsMeasure(rho = 2): RiskMeasure {
  if (!(rho >= 1)) throw new EngineError(`The proportional-hazards parameter ρ must be at least 1 for a coherent measure; received ${rho}.`, 'range');
  return distortionMeasure({
    id: 'ph',
    name: `Proportional hazards transform (ρ = ${rho})`,
    params: { rho },
    concave: true,
    g: (t) => Math.pow(t, 1 / rho),
    notes: ['The hazard rate of the loss is multiplied by ρ, which is why the measure is used for insurance pricing (Wang 1995).'],
  });
}

/** τ-expectile: the only risk measure that is both coherent (τ ≥ ½) and elicitable. */
export function expectileMeasure(tau = 0.95): RiskMeasure {
  if (!(tau > 0 && tau < 1)) throw new EngineError(`The expectile level τ must be strictly between 0 and 1; received ${tau}.`, 'range');
  const coherent = tau >= 0.5;
  return {
    id: 'expectile',
    name: `Expectile at τ = ${tau}`,
    params: { tau },
    axioms: coherent
      ? coherentAxioms([
          'For τ ≥ ½ the expectile is coherent. It is the only coherent risk measure that is also elicitable, which is why it is the natural candidate when forecasts must be compared and ranked.',
          'The expectile is not comonotone additive (unlike VaR and ES), so it does not treat perfectly dependent exposures as simply additive.',
        ])
      : {
          monotone: true,
          translationInvariant: true,
          positiveHomogeneous: true,
          subadditive: false,
          convex: false,
          comonotoneAdditive: false,
          coherent: false,
          notes: ['For τ < ½ the expectile is superadditive rather than subadditive, so it is not coherent.'],
        },
    elicitable: true,
    elicitabilityNote:
      'Expectiles are elicitable: e_τ minimises the expected asymmetric *squared* loss (the quantile uses asymmetric absolute loss). e_{1/2} is the mean.',
    backtestNote:
      'Expectiles can be backtested with the same machinery as a conditional mean forecast, using their identification function — the practical reason to prefer them to ES when backtesting matters.',
    // An expectile is not a spectral measure at any τ: it is not comonotone additive.
    spectralWeights: () => null,
    evaluate: (sorted) => empiricalExpectile(sorted, tau),
  };
}

/** Range Value at Risk: the average quantile between two levels. */
export function rangeVarMeasure(alpha = 0.95, beta = 0.995): RiskMeasure {
  if (!(alpha >= 0 && beta <= 1 && beta > alpha)) {
    throw new EngineError(`Range VaR needs 0 ≤ α < β ≤ 1; received α = ${alpha}, β = ${beta}.`, 'range');
  }
  return {
    id: 'rvar',
    name: `Range Value at Risk (${alpha}, ${beta})`,
    params: { alpha, beta },
    axioms: {
      monotone: true,
      translationInvariant: true,
      positiveHomogeneous: true,
      subadditive: beta >= 1,
      convex: beta >= 1,
      comonotoneAdditive: true,
      coherent: beta >= 1,
      notes:
        beta >= 1
          ? ['With β = 1 Range VaR is exactly ES, and is therefore coherent.']
          : [
              'Range VaR interpolates between VaR (β → α) and ES (β = 1). For β < 1 it is NOT subadditive, so it is not coherent — it trades coherence for robustness, because ignoring the most extreme β-tail makes it insensitive to the worst and least reliable scenarios.',
            ],
    },
    elicitable: false,
    elicitabilityNote: 'Range VaR is not elicitable for α < β < 1 (it is a trimmed mean of quantiles).',
    backtestNote: 'No standard exception-count backtest; like ES it requires the predicted distribution. Its appeal is robustness to the extreme tail, not backtestability.',
    spectralWeights: (n) => quantileIntegralWeights(n, alpha, beta),
    evaluate: (sorted) => empiricalRangeVar(sorted, alpha, beta),
  };
}

/** Median shortfall: VaR at level (1 + α)/2 — the median of the tail. */
export function medianShortfallMeasure(level = 0.95): RiskMeasure {
  assertLevel(level);
  return {
    id: 'medianShortfall',
    name: `Median shortfall at ${(level * 100).toPrecision(4)}%`,
    params: { level },
    axioms: {
      monotone: true,
      translationInvariant: true,
      positiveHomogeneous: true,
      subadditive: false,
      convex: false,
      comonotoneAdditive: true,
      coherent: false,
      notes: [
        `Median shortfall equals VaR at level ${(1 + level) / 2}, so it inherits VaR's failure of subadditivity and is not coherent.`,
        'It is more robust than ES (a median rather than a mean of the tail) and, being a quantile, it is elicitable — the usual reason for proposing it.',
      ],
    },
    elicitable: true,
    elicitabilityNote: 'Elicitable, because it is a quantile.',
    backtestNote: 'Backtestable with the VaR machinery at the shifted level (1 + α)/2.',
    spectralWeights: () => null,
    evaluate: (sorted) => empiricalMedianShortfall(sorted, level),
  };
}

/** Mean–standard-deviation functional E[L] + c·σ(L). */
export function meanVarianceMeasure(c = 2): RiskMeasure {
  if (!(c >= 0)) throw new EngineError(`The mean–variance multiplier c must be 0 or greater; received ${c}.`, 'range');
  return {
    id: 'meanSd',
    name: `Mean + ${c}·standard deviation`,
    params: { c },
    axioms: {
      monotone: false,
      translationInvariant: true,
      positiveHomogeneous: true,
      subadditive: true,
      convex: true,
      comonotoneAdditive: false,
      coherent: false,
      notes: [
        'The mean–standard-deviation functional is subadditive (standard deviation is) and positively homogeneous, but it is NOT monotone: a loss that is smaller in every scenario can be assigned a larger figure if it is more variable. It is therefore not coherent.',
        'It penalises favourable dispersion exactly as much as unfavourable dispersion, which is the usual objection for skewed losses.',
      ],
    },
    elicitable: false,
    elicitabilityNote: 'Not elicitable as a single functional, though the mean and the variance are each elicitable separately.',
    backtestNote: 'There is no tail-exception test; the mean and variance forecasts can be tested separately.',
    spectralWeights: () => null,
    evaluate: (sorted) => sampleMean(sorted) + c * populationSd(sorted),
  };
}

/** Mean–semideviation functional E[L] + c·√E[((L − E L)₊)²]. */
export function meanSemideviationMeasure(c = 2): RiskMeasure {
  if (!(c >= 0)) throw new EngineError(`The semideviation multiplier c must be 0 or greater; received ${c}.`, 'range');
  return {
    id: 'meanSemideviation',
    name: `Mean + ${c}·upper semideviation`,
    params: { c },
    axioms: {
      monotone: c <= 1,
      translationInvariant: true,
      positiveHomogeneous: true,
      subadditive: true,
      convex: true,
      comonotoneAdditive: false,
      coherent: c <= 1,
      notes:
        c <= 1
          ? ['With 0 ≤ c ≤ 1 the mean–upper-semideviation functional is a coherent risk measure (Ogryczak & Ruszczyński): it penalises only dispersion above the mean.']
          : [`With c = ${c} > 1 monotonicity fails, so the functional is subadditive and convex but not coherent. Keep c ≤ 1 for coherence.`],
    },
    elicitable: false,
    elicitabilityNote: 'Not elicitable as a single functional.',
    backtestNote: 'No standard backtest; it is a dispersion functional rather than a tail quantile.',
    spectralWeights: () => null,
    evaluate: (sorted) => sampleMean(sorted) + c * upperSemideviation(sorted),
  };
}

/** Every measure, as a registry so the interface can enumerate them. */
export const RISK_MEASURES: RiskMeasureDef[] = [
  {
    id: 'var',
    name: 'Value at Risk',
    description: 'The loss threshold exceeded with probability 1 − α. Not subadditive.',
    params: [LEVEL],
    create: (p) => varMeasure(readParams([LEVEL], p).level),
  },
  {
    id: 'es',
    name: 'Expected Shortfall (CVaR)',
    description: 'The average loss in the worst (1 − α) share of outcomes. Coherent.',
    params: [LEVEL],
    create: (p) => esMeasure(readParams([LEVEL], p).level),
  },
  {
    id: 'entropic',
    name: 'Entropic risk measure',
    description: 'Certainty equivalent of exponential utility: (1/θ)·log E[e^{θL}]. Convex, not coherent.',
    params: [{ key: 'theta', label: 'Risk aversion θ', description: 'Larger θ weights large losses more heavily.', defaultValue: 1, min: 1e-12, max: 1e6 }],
    create: (p) => entropicMeasure(readParams([{ key: 'theta', label: 'Risk aversion θ', description: '', defaultValue: 1, min: 1e-12, max: 1e6 }], p).theta),
  },
  {
    id: 'wang',
    name: 'Wang transform',
    description: 'Distortion g(t) = Φ(Φ⁻¹(t) + λ). Coherent for λ > 0.',
    params: [{ key: 'lambda', label: 'Market price of risk λ', description: 'Shift in normal quantile units.', defaultValue: 0.5, min: 1e-12, max: 10 }],
    create: (p) => wangTransformMeasure(readParams([{ key: 'lambda', label: 'λ', description: '', defaultValue: 0.5, min: 1e-12, max: 10 }], p).lambda),
  },
  {
    id: 'ph',
    name: 'Proportional hazards transform',
    description: 'Distortion g(t) = t^{1/ρ}. Coherent for ρ ≥ 1.',
    params: [{ key: 'rho', label: 'Hazard multiplier ρ', description: 'Multiplies the hazard rate of the loss.', defaultValue: 2, min: 1, max: 100 }],
    create: (p) => proportionalHazardsMeasure(readParams([{ key: 'rho', label: 'ρ', description: '', defaultValue: 2, min: 1, max: 100 }], p).rho),
  },
  {
    id: 'expectile',
    name: 'Expectile',
    description: 'The only coherent risk measure that is also elicitable (for τ ≥ ½).',
    params: [{ key: 'tau', label: 'Level τ', description: 'τ = ½ gives the mean.', defaultValue: 0.95, min: 1e-12, max: 1 - 1e-12 }],
    create: (p) => expectileMeasure(readParams([{ key: 'tau', label: 'τ', description: '', defaultValue: 0.95, min: 1e-12, max: 1 - 1e-12 }], p).tau),
  },
  {
    id: 'rvar',
    name: 'Range Value at Risk',
    description: 'Average quantile between α and β; interpolates VaR and ES. Robust but not coherent for β < 1.',
    params: [
      { key: 'alpha', label: 'Lower level α', description: '', defaultValue: 0.95, min: 0, max: 1 },
      { key: 'beta', label: 'Upper level β', description: '', defaultValue: 0.995, min: 0, max: 1 },
    ],
    create: (p) => {
      const spec = [
        { key: 'alpha', label: 'Lower level α', description: '', defaultValue: 0.95, min: 0, max: 1 },
        { key: 'beta', label: 'Upper level β', description: '', defaultValue: 0.995, min: 0, max: 1 },
      ];
      const q = readParams(spec, p);
      return rangeVarMeasure(q.alpha, q.beta);
    },
  },
  {
    id: 'medianShortfall',
    name: 'Median shortfall',
    description: 'Median of the losses beyond VaR_α; equals VaR at (1 + α)/2. Elicitable, not coherent.',
    params: [LEVEL],
    create: (p) => medianShortfallMeasure(readParams([LEVEL], p).level),
  },
  {
    id: 'meanSd',
    name: 'Mean–variance functional',
    description: 'E[L] + c·σ(L). Subadditive but not monotone, so not coherent.',
    params: [{ key: 'c', label: 'Multiplier c', description: 'Standard deviations added to the mean.', defaultValue: 2, min: 0, max: 100 }],
    create: (p) => meanVarianceMeasure(readParams([{ key: 'c', label: 'c', description: '', defaultValue: 2, min: 0, max: 100 }], p).c),
  },
  {
    id: 'meanSemideviation',
    name: 'Mean–semideviation functional',
    description: 'E[L] + c·upper semideviation. Coherent for 0 ≤ c ≤ 1.',
    params: [{ key: 'c', label: 'Multiplier c', description: 'Semideviations added to the mean.', defaultValue: 1, min: 0, max: 100 }],
    create: (p) => meanSemideviationMeasure(readParams([{ key: 'c', label: 'c', description: '', defaultValue: 1, min: 0, max: 100 }], p).c),
  },
];

export function getRiskMeasure(id: string, params?: Record<string, number>): RiskMeasure {
  const def = RISK_MEASURES.find((d) => d.id === id);
  if (!def) {
    throw new EngineError(`Unknown risk measure "${id}". Available: ${RISK_MEASURES.map((d) => d.id).join(', ')}.`, 'unknown');
  }
  return def.create(params);
}

/* ------------------------------------------------------------------ *
 * Closed-form normal risk measures (exact)                            *
 * ------------------------------------------------------------------ */

export interface ClosedFormNormalRisk {
  level: number;
  mu: number;
  sigma: number;
  valueAtRisk: number;
  expectedShortfall: number;
  leftTailVar: number;
  exactness: Exactness;
  formula: string;
}

/**
 * Exact VaR and ES for a normal loss distribution.
 *   VaR_α = μ + σ·Φ⁻¹(α),  ES_α = μ + σ·φ(Φ⁻¹(α))/(1 − α)
 * (The same formulas as `parametricNormalRisk` in engine/risk, extended with
 * the left-tail counterpart used by the Fréchet–Hoeffding bounds.)
 */
export function closedFormNormalRisk(mu: number, sigma: number, level: number): ClosedFormNormalRisk {
  if (!Number.isFinite(mu)) throw new EngineError('The mean must be a finite number.', 'finite');
  if (!(sigma > 0)) throw new EngineError(`The standard deviation must be greater than 0; received ${sigma}.`, 'range');
  assertLevel(level);
  const z = normalQuantile(level);
  const phi = normalPdf(z);
  // The VaR/ES pair is taken from engine/risk so the two modules cannot drift
  // apart; the left-tail counterpart is added here.
  const shared = parametricNormalRisk(mu, sigma, level);
  return {
    level,
    mu,
    sigma,
    valueAtRisk: shared.valueAtRisk,
    expectedShortfall: shared.expectedShortfall,
    leftTailVar: mu - (sigma * phi) / level,
    exactness: 'exact',
    formula: 'VaR_α = μ + σ·Φ⁻¹(α); ES_α = μ + σ·φ(Φ⁻¹(α))/(1 − α); LTVaR_α = μ − σ·φ(Φ⁻¹(α))/α',
  };
}

/* ------------------------------------------------------------------ *
 * Subadditivity violation finder                                      *
 * ------------------------------------------------------------------ */

export interface SubadditivityCheck {
  level: number;
  riskX: number;
  riskY: number;
  riskSum: number;
  sumOfRisks: number;
  /** riskSum − sumOfRisks. Positive means subadditivity is violated. */
  excess: number;
  violated: boolean;
}

export interface SubadditivityReport {
  measureId: string;
  measureName: string;
  dependenceAssumption: string;
  checks: SubadditivityCheck[];
  worst: SubadditivityCheck | null;
  violationFound: boolean;
  /** The same check performed with Expected Shortfall, for contrast. */
  esChecks: SubadditivityCheck[];
  esViolationFound: boolean;
  explanation: string;
  exactness: Exactness;
}

function checkPair(measure: RiskMeasure, x: ArrayLike<number>, y: ArrayLike<number>, sum: ArrayLike<number>, level: number): SubadditivityCheck {
  const rx = measure.evaluate(sortedCopy(x));
  const ry = measure.evaluate(sortedCopy(y));
  const rs = measure.evaluate(sortedCopy(sum));
  return { level, riskX: rx, riskY: ry, riskSum: rs, sumOfRisks: rx + ry, excess: rs - (rx + ry), violated: rs > rx + ry + 1e-12 };
}

/**
 * Search a user's own two loss samples for a confidence level at which VaR is
 * superadditive, and verify that ES is not. The two samples are combined under
 * the stated coupling: `paired` keeps the observed joint sample (row i with row
 * i), `independent` forms every pairwise sum, which is the exact independent
 * coupling of the two empirical marginals.
 */
export function findVarSubadditivityViolation(opts: {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  levels?: number[];
  coupling?: 'paired' | 'independent';
  maxIndependentPairs?: number;
}): SubadditivityReport {
  const { x, y } = opts;
  const coupling = opts.coupling ?? 'independent';
  if (x.length < 2 || y.length < 2) throw new EngineError('Each sample needs at least 2 observations.', 'insufficient');
  if (coupling === 'paired' && x.length !== y.length) {
    throw new EngineError(`A paired coupling needs samples of equal length; received ${x.length} and ${y.length}.`, 'shape');
  }
  let sum: Float64Array;
  if (coupling === 'paired') {
    sum = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) sum[i] = x[i] + y[i];
  } else {
    const maxPairs = opts.maxIndependentPairs ?? 4_000_000;
    if (x.length * y.length > maxPairs) {
      throw new EngineError(
        `Forming the exact independent coupling would need ${x.length * y.length} pairs, above the limit of ${maxPairs}. Thin the samples or use the paired coupling.`,
        'limit',
      );
    }
    sum = new Float64Array(x.length * y.length);
    let k = 0;
    for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) sum[k++] = x[i] + y[j];
  }
  const levels = opts.levels ?? defaultLevelGrid(Math.min(x.length, y.length));
  const checks: SubadditivityCheck[] = [];
  const esChecks: SubadditivityCheck[] = [];
  for (const level of levels) {
    assertLevel(level);
    checks.push(checkPair(varMeasure(level), x, y, sum, level));
    esChecks.push(checkPair(esMeasure(level), x, y, sum, level));
  }
  const violations = checks.filter((c) => c.violated);
  const worst = violations.length ? violations.reduce((a, b) => (b.excess > a.excess ? b : a)) : null;
  return {
    measureId: 'var',
    measureName: 'Value at Risk',
    dependenceAssumption:
      coupling === 'paired'
        ? 'The two exposures are combined as observed (the joint sample you supplied), so the dependence is whatever is in the data.'
        : 'The two exposures are combined under the exact independent coupling of their empirical marginals (every pairwise sum, equally weighted).',
    checks,
    worst,
    violationFound: violations.length > 0,
    esChecks,
    esViolationFound: esChecks.some((c) => c.violated),
    explanation: violations.length
      ? `At α = ${worst!.level}, VaR(X + Y) = ${worst!.riskSum} exceeds VaR(X) + VaR(Y) = ${worst!.sumOfRisks} by ${worst!.excess}. Combining the two exposures *increases* measured VaR, so a VaR limit would prefer the concentrated position. Expected Shortfall shows no violation at any level checked, as subadditivity guarantees.`
      : 'No level in the grid produced a VaR violation for these two samples. That does not mean VaR is subadditive — it is not — only that this particular pair and level grid did not expose it. Try a loss profile with a probability mass just outside the level (see constructVarSubadditivityCounterexample).',
    exactness: 'empirical',
  };
}

function defaultLevelGrid(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 99; i++) out.push(i / 100);
  return out.filter((l) => l * n >= 1 && l < 1);
}

export interface ConstructedCounterexample {
  description: string;
  lossProbability: number;
  lossSize: number;
  level: number;
  marginal: DiscreteLaw;
  sum: DiscreteLaw;
  varX: number;
  varY: number;
  varSum: number;
  varExcess: number;
  esX: number;
  esY: number;
  esSum: number;
  esSlack: number;
  verified: boolean;
  exactness: Exactness;
  notes: string[];
}

/**
 * Construct an explicit, exactly computed counterexample to the subadditivity
 * of VaR: two independent exposures that each pay a large loss with small
 * probability p. Each has VaR_α = 0 whenever 1 − p > α, but the sum exceeds the
 * threshold with probability 2p(1 − p) > 1 − α, so VaR of the sum is the full
 * loss. The numbers are computed by exact convolution, not simulated.
 */
export function constructVarSubadditivityCounterexample(
  opts: { lossProbability?: number; lossSize?: number; level?: number } = {},
): ConstructedCounterexample {
  const p = opts.lossProbability ?? 0.03;
  const size = opts.lossSize ?? 100;
  const level = opts.level ?? 0.96;
  if (!(p > 0 && p < 1)) throw new EngineError(`The loss probability must be strictly between 0 and 1; received ${p}.`, 'range');
  if (!(size > 0)) throw new EngineError(`The loss size must be greater than 0; received ${size}.`, 'range');
  assertLevel(level);
  if (!(1 - p >= level)) {
    throw new EngineError(
      `This construction needs 1 − p ≥ α so that each individual VaR is 0; with p = ${p} and α = ${level} it is not (1 − p = ${1 - p}). Lower p or lower α.`,
      'range',
    );
  }
  const q = 1 - p;
  if (!(q * q < level)) {
    throw new EngineError(
      `This construction needs (1 − p)² < α so that the sum breaches the threshold; with p = ${p} and α = ${level} it is not ((1 − p)² = ${q * q}). Raise p or raise α.`,
      'range',
    );
  }
  const marginal = makeLaw([0, size], [q, p]);
  const sum = convolveLaws(marginal, marginal);
  const varX = lawVar(marginal, level);
  const varSum = lawVar(sum, level);
  const esX = lawEs(marginal, level);
  const esSum = lawEs(sum, level);
  return {
    description:
      `Two independent exposures, each losing ${size} with probability ${p} and nothing otherwise, at α = ${level}. ` +
      `Each has P(loss = 0) = ${q} ≥ α, so each VaR is 0; the sum has P(sum = 0) = ${q * q} < α, so VaR of the sum is ${varSum}.`,
    lossProbability: p,
    lossSize: size,
    level,
    marginal,
    sum,
    varX,
    varY: varX,
    varSum,
    varExcess: varSum - 2 * varX,
    esX,
    esY: esX,
    esSum,
    esSlack: esX + esX - esSum,
    verified: varSum > 2 * varX && esSum <= 2 * esX + 1e-12,
    exactness: 'exact',
    notes: [
      'Computed by exact convolution of two two-point laws: no simulation and no approximation is involved.',
      'VaR is superadditive here, so diversifying across the two exposures *raises* measured VaR from 0 to the full single loss.',
      'Expected Shortfall of the sum is at most the sum of the individual Expected Shortfalls, as subadditivity requires.',
      'Every independent pair of exposures with a small enough loss probability does this; the example is generic, not contrived to a single parameter choice.',
    ],
  };
}
