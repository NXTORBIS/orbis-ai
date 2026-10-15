/**
 * Quasi-Monte Carlo: low-discrepancy point sets and the integration they buy.
 *
 * Three things this screen is careful about, because they are the three things
 * QMC interfaces usually get wrong:
 *
 *  1. An unrandomised QMC estimate has NO probabilistic error bar. The engine
 *     returns `standardError: null` with a reason, and this screen shows that
 *     reason instead of inventing an interval. Only the randomised variant
 *     (`randomisedQmcIntegrate`, R independent randomisations) gets one, and it
 *     is labelled as a spread across randomisations.
 *  2. Discrepancy is quadratic in the point count and the lattice generator
 *     search is a search. Both are opt-in, behind a button, exactly as the
 *     rolling-origin backtest is in the time-series screen — two screens here
 *     once froze the tab for fourteen seconds and shipped that way.
 *  3. Nothing on this screen is a plausible-looking substitute for a failed
 *     computation. Every engine failure is shown as its own message.
 */
import { useMemo } from 'react';
import {
  allocateStrata,
  antitheticVariates,
  centredDiscrepancyL2,
  compareConvergence,
  CONVERGENCE_WORK_LIMIT,
  convergenceWork,
  controlVariates,
  equalStrata,
  expectedRandomStarDiscrepancy,
  faureSequence,
  fitLogLogSlope,
  haltonSequence,
  integrate,
  integrationWork,
  LATTICE_SEARCH_WORK_LIMIT,
  latticeRule,
  materialise,
  maxAbsPairCorrelation,
  randomisedQmcIntegrate,
  RQMC_WORK_LIMIT,
  searchLatticeGenerator,
  plainMonteCarlo,
  plainNormalTailProbability,
  starDiscrepancyL2,
  stratifiedSample,
  TEST_INTEGRANDS,
  tiltedNormalTailProbability,
  type AllocationResult,
  type ConvergenceComparison,
  type ErrorBasis,
  type IntegrationResult,
  type PointSequence,
  type PointSet,
  type RqmcResult,
  type SamplerSpec,
} from '../../engine/qmc';
import { attempt, type EngineResult, type Explanation } from '../../engine/core/result';
import { getDistribution } from '../../engine/distributions/registry';
import { tConfidenceInterval, variance, type Interval } from '../../engine/stats/descriptive';
import { Badge, Button, Card, Checkbox, DataTable, KeyValueList, Notice, NumberField, SelectField, SliderField, TextField } from '../../ui/primitives';
import { formatValue } from '../../ui/charts/scale';
import { LineChart, ScatterChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';
import { downloadText, toCsv } from '../../persistence/store';

type SequenceId = 'halton' | 'faure' | 'lattice';
type IntegrandId = 'product' | 'genz-continuous' | 'genz-product-peak';

export interface QuasiMonteCarloConfig {
  /** Which low-discrepancy construction to build and integrate with. */
  sequence: SequenceId;
  dimension: number;
  /** Points materialised for the projection plot and the diagnostics. */
  pointCount: number;
  seed: string;
  /** Halton: random digit permutation per coordinate. */
  haltonScramble: boolean;
  /** Halton: take every leap-th index, and skip the first `haltonSkip`. */
  haltonLeap: number;
  haltonSkip: number;
  /** Faure: random digit shift modulo the base. */
  faureRandomise: boolean;
  /** Lattice: Cranley–Patterson random shift. */
  latticeRandomShift: boolean;
  /** 1-based coordinate indices shown in the 2-D projection. */
  projectionX: number;
  projectionY: number;
  integrand: IntegrandId;
  /** Evaluations spent on the integration estimate. */
  samples: number;
  /**
   * Use the randomised variant and estimate the error across independent
   * randomisations. With this off there is no error bar at all, by design.
   */
  useRandomisation: boolean;
  replications: number;
  /**
   * Quadratic in the point count (every pair of points). Opt-in.
   */
  runDiscrepancy: boolean;
  /**
   * Component-by-component search over multipliers coprime to N. Opt-in.
   */
  runLatticeSearch: boolean;
  latticeSearchCandidates: number;
  /**
   * Re-integrates every method at every sample size, replicated. Opt-in.
   */
  runConvergence: boolean;
  convergenceReplications: number;
  /** Sample sizes for the convergence ladder; powers of two suit QMC. */
  convergenceSizes: number[];
  /**
   * Variance reduction. Runs four estimators R times each, so it is the most
   * expensive thing on this screen per unit of N. Opt-in.
   */
  runVarianceReduction: boolean;
  vrIntegrand: VrIntegrandId;
  /** Integrand evaluations each estimator is allowed per replication. */
  vrSamples: number;
  /** Independent replications; the variance ratio is estimated from these. */
  vrReplications: number;
  vrControl: VrControlId;
  /** Fraction of the sample held out to fit β; 0 reuses everything and is biased. */
  vrSplitFraction: number;
  /** Importance sampling: the tail threshold a in P(Z > a). */
  isThreshold: number;
  isSamples: number;
  /** Ignored unless the optimal tilt is switched off. */
  isTilt: number;
  isUseOptimalTilt: boolean;
  /** Stratified allocation. */
  strataCount: number;
  strataPilot: number;
  strataTotal: number;
}

export const QUASI_MONTE_CARLO_DEFAULT: QuasiMonteCarloConfig = {
  sequence: 'halton',
  dimension: 4,
  pointCount: 512,
  seed: 'qmc-demo-1',
  haltonScramble: false,
  haltonLeap: 1,
  haltonSkip: 0,
  faureRandomise: false,
  latticeRandomShift: false,
  projectionX: 1,
  projectionY: 2,
  integrand: 'genz-continuous',
  samples: 4096,
  useRandomisation: false,
  replications: 16,
  runDiscrepancy: false,
  runLatticeSearch: false,
  latticeSearchCandidates: 256,
  runConvergence: false,
  convergenceReplications: 8,
  convergenceSizes: [256, 512, 1024, 2048, 4096],
  runVarianceReduction: false,
  vrIntegrand: 'pi-1d',
  vrSamples: 4096,
  vrReplications: 16,
  vrControl: 'coordinate-mean',
  vrSplitFraction: 0,
  isThreshold: 4.5,
  isSamples: 20000,
  isTilt: 9,
  isUseOptimalTilt: true,
  strataCount: 8,
  strataPilot: 64,
  strataTotal: 400,
};

const SEQUENCES: { value: SequenceId; label: string }[] = [
  { value: 'halton', label: 'Halton (radical inverse in prime bases)' },
  { value: 'faure', label: 'Faure (permuted digits in one prime base)' },
  { value: 'lattice', label: 'Rank-1 lattice rule' },
];

const INTEGRANDS: { value: IntegrandId; label: string }[] = [
  { value: 'product', label: 'Product of coordinates — Π xᵢ' },
  { value: 'genz-continuous', label: 'Genz continuous — Π exp(−5|xᵢ − ½|)' },
  { value: 'genz-product-peak', label: 'Genz product peak — Π 1/(a⁻² + (xᵢ − ½)²)' },
];

interface Integrand {
  f(x: Float64Array): number;
  exact: number;
  name: string;
}

function integrandFor(id: IntegrandId, d: number): Integrand {
  switch (id) {
    case 'product':
      return TEST_INTEGRANDS.product(d);
    case 'genz-continuous':
      return TEST_INTEGRANDS.genzContinuous(d);
    case 'genz-product-peak':
      return TEST_INTEGRANDS.genzProductPeak(d);
  }
}

/* ------------------------------------------------------------------ *
 * Variance reduction
 *
 * The deliverable of every technique below is a VARIANCE RATIO against plain
 * Monte Carlo at the same number of integrand evaluations, measured on this
 * run. Two ratios are reported for each technique and they are different
 * things:
 *
 *  - the engine's own factor, computed inside a single replication from the
 *    variance decomposition that technique affords (for antithetic variates
 *    that is 1/(1 + ρ)); precise, but it is one run's number;
 *  - a ratio of the variances of R INDEPENDENT replicate estimates, which is
 *    an estimate from R numbers and carries an F interval accordingly. With
 *    R = 12 that interval spans roughly a factor of twelve, and saying so is
 *    the point: a variance reduction factor is not a measured speed-up, it is
 *    an estimate of one.
 * ------------------------------------------------------------------ */

type VrIntegrandId = 'linear-1d' | 'pi-1d' | 'symmetric-1d' | 'product' | 'genz-continuous';
type VrControlId = 'coordinate-mean' | 'first-squared';

const VR_INTEGRANDS: { value: VrIntegrandId; label: string }[] = [
  { value: 'linear-1d', label: 'x on [0,1] — monotone and linear' },
  { value: 'pi-1d', label: '4/(1+x²) on [0,1] — monotone decreasing' },
  { value: 'symmetric-1d', label: '(x − ½)² on [0,1] — symmetric, where antithetic variates FAIL' },
  { value: 'product', label: 'Π xⱼ at the chosen dimension — monotone in every coordinate' },
  { value: 'genz-continuous', label: 'Π exp(−5|xⱼ − ½|) — symmetric about ½ in every coordinate' },
];

const VR_CONTROLS: { value: VrControlId; label: string }[] = [
  { value: 'coordinate-mean', label: 'Mean of the coordinates, (1/d)·Σ xⱼ — mean exactly ½' },
  { value: 'first-squared', label: 'Square of the first coordinate, x₁² — mean exactly ⅓' },
];

interface VrTarget {
  f(x: Float64Array): number;
  exact: number;
  name: string;
  dimension: number;
  /** What antithetic variates should do here, and why — stated before the run. */
  antitheticNote: string;
}

function vrTargetFor(id: VrIntegrandId, d: number): VrTarget {
  switch (id) {
    case 'linear-1d':
      return {
        ...TEST_INTEGRANDS.linear,
        antitheticNote:
          'f is linear, so f(U) + f(1−U) is a constant: the antithetic estimator is exactly right on every pair and its variance is zero. The reduction factor is therefore infinite. That is the correct answer here, not a formatting accident, and it is the only case on this menu where it happens.',
      };
    case 'pi-1d':
      return {
        ...TEST_INTEGRANDS.pi,
        antitheticNote:
          'f is monotone decreasing on [0,1], so f(U) and f(1−U) are strongly negatively correlated and antithetic sampling should help substantially. The measured correlation below is what decides it.',
      };
    case 'symmetric-1d':
      return {
        ...TEST_INTEGRANDS.symmetric,
        antitheticNote:
          'f is symmetric about ½, so f(U) = f(1−U) exactly, the induced correlation is +1, and antithetic sampling is TWICE AS BAD as plain Monte Carlo at the same number of evaluations. This integrand is on the menu deliberately: a variance-reduction screen that only ever demonstrates success is not telling you how to use these techniques.',
      };
    case 'product':
      return {
        ...TEST_INTEGRANDS.product(d),
        antitheticNote:
          'The product is monotone increasing in every coordinate, so antithetic sampling should help — but less as the dimension rises, because the integrand becomes dominated by interactions rather than by the additive main effects the antithetic pairing exploits.',
      };
    case 'genz-continuous':
      return {
        ...TEST_INTEGRANDS.genzContinuous(d),
        antitheticNote:
          'Every factor is symmetric about xⱼ = ½, so the monotone component that antithetic sampling exploits is largely absent and little or no gain should be expected.',
      };
  }
}

interface VrControl {
  c(x: Float64Array): number;
  /** Exactly known expectation of the control. A wrong value here biases the estimate. */
  mean: number;
  name: string;
  meanText: string;
}

function vrControlFor(id: VrControlId, d: number): VrControl {
  if (id === 'first-squared') {
    return {
      c: (x) => x[0] * x[0],
      mean: 1 / 3,
      name: 'c(x) = x₁²',
      meanText: 'E[c] = ∫₀¹ x² dx = 1/3, known in closed form',
    };
  }
  return {
    c: (x) => {
      let s = 0;
      for (let k = 0; k < d; k++) s += x[k];
      return s / d;
    },
    mean: 0.5,
    name: `c(x) = (1/d)·Σ xⱼ with d = ${d}`,
    meanText: 'E[c] = 1/2, known in closed form for every d',
  };
}

/** A measured variance ratio together with the uncertainty of the measurement. */
interface VrRatio {
  /** Baseline variance ÷ this estimator's variance, both across replications. */
  factor: number;
  low: number;
  high: number;
  replications: number;
}

interface VrMethodReport {
  label: string;
  /** Mean of the replicate estimates. */
  estimate: number;
  /** Confidence interval FOR THE INTEGRAL, from the spread across replications. */
  interval: Interval;
  /** Standard deviation of the individual replicate estimates — not an interval. */
  replicateSd: number;
  replicateMin: number;
  replicateMax: number;
  replicates: number[];
  evaluationsPerReplicate: number;
  /** null for the baseline, which is the thing the others are measured against. */
  ratio: VrRatio | null;
  /** The engine's own single-replication factor, where it reports one. */
  engineFactor: number | null;
  engineFactorNote: string | null;
  diagnostics: { label: string; value: string }[];
  errorBasis: string;
  warnings: string[];
}

interface VrComparison {
  target: VrTarget;
  controlName: string;
  controlMeanText: string;
  replications: number;
  budget: number;
  methods: VrMethodReport[];
  elapsedMs: number;
}

function basisText(basis: ErrorBasis): string {
  return basis.kind === 'unavailable' ? basis.reason : basis.note;
}

/**
 * Interval for a ratio of two variances estimated from R independent replicate
 * estimates each: (S₁²/σ₁²)/(S₂²/σ₂²) is F(R−1, R−1), so the ratio divided by
 * the F quantiles brackets σ₁²/σ₂². The two samples are independent because
 * every replication of every estimator uses its own seed.
 */
function ratioInterval(baselineVariance: number, methodVariance: number, replications: number): VrRatio {
  const df = replications - 1;
  const f = getDistribution('fDistribution');
  const upper = f.quantile(0.975, { d1: df, d2: df });
  const lower = f.quantile(0.025, { d1: df, d2: df });
  const factor = methodVariance > 0 ? baselineVariance / methodVariance : Infinity;
  return { factor, low: factor / upper, high: factor / lower, replications };
}

function runVarianceReduction(opts: {
  target: VrTarget;
  control: VrControl;
  /** Integrand evaluations each estimator is allowed per replication. */
  budget: number;
  replications: number;
  splitFraction: number;
  seed: string;
}): VrComparison {
  const { target, control, budget: n, replications: R, splitFraction } = opts;
  // Antithetic variates spend two evaluations per pair, and a control variate
  // spends one on f and one on c, so both get half the sample count to keep the
  // EVALUATION budget equal. A ratio at equal sample count would flatter them.
  const half = Math.floor(n / 2);
  const started = Date.now();
  const runOne = (seed: string) => ({
    plain: plainMonteCarlo({ integrand: target.f, dimension: target.dimension, samples: n, seed }),
    anti: antitheticVariates({ integrand: target.f, dimension: target.dimension, pairs: half, seed }),
    ctrl: controlVariates({
      integrand: target.f,
      control: control.c,
      controlMean: control.mean,
      dimension: target.dimension,
      samples: half,
      seed,
      splitFraction: splitFraction > 0 ? splitFraction : undefined,
    }),
    lhs: integrate({ dimension: target.dimension, samples: n, integrand: target.f, sampler: { kind: 'lhs' }, seed }),
  });

  const first = runOne(`${opts.seed}#vr0`);
  const plain = [first.plain.estimate];
  const anti = [first.anti.estimate];
  const ctrl = [first.ctrl.estimate];
  const lhs = [first.lhs.estimate];
  for (let r = 1; r < R; r++) {
    const x = runOne(`${opts.seed}#vr${r}`);
    plain.push(x.plain.estimate);
    anti.push(x.anti.estimate);
    ctrl.push(x.ctrl.estimate);
    lhs.push(x.lhs.estimate);
  }

  const baselineVariance = variance(plain);
  const report = (
    label: string,
    estimates: number[],
    evaluationsPerReplicate: number,
    ratio: VrRatio | null,
    engineFactor: number | null,
    engineFactorNote: string | null,
    diagnostics: { label: string; value: string }[],
    errorBasis: string,
    warnings: string[],
  ): VrMethodReport => {
    const m = estimates.reduce((a, b) => a + b, 0) / estimates.length;
    const sd = Math.sqrt(variance(estimates));
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of estimates) {
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
    return {
      label,
      estimate: m,
      interval: tConfidenceInterval(m, sd, estimates.length),
      replicateSd: sd,
      replicateMin: lo,
      replicateMax: hi,
      replicates: estimates,
      evaluationsPerReplicate,
      ratio,
      engineFactor,
      engineFactorNote,
      diagnostics,
      errorBasis,
      warnings,
    };
  };

  const methods: VrMethodReport[] = [
    report(
      first.plain.method,
      plain,
      first.plain.evaluations,
      null,
      null,
      null,
      [{ label: 'Sample variance of f within one replication', value: formatValue(first.plain.diagnostics.sampleVariance, 6) }],
      basisText(first.plain.errorBasis),
      first.plain.warnings,
    ),
    report(
      first.anti.method,
      anti,
      first.anti.evaluations,
      ratioInterval(baselineVariance, variance(anti), R),
      first.anti.efficiency.varianceReductionFactor,
      'Measured inside one replication as 1/(1 + ρ) with ρ the induced correlation between f(U) and f(1−U), at an equal EVALUATION budget — the engine counts both halves of every pair.',
      [
        { label: 'Induced correlation ρ = corr(f(U), f(1−U))', value: formatValue(first.anti.diagnostics.inducedCorrelation, 5) },
        { label: 'Variance of the pair averages', value: formatValue(first.anti.diagnostics.pairVariance, 6) },
        { label: 'Pooled variance of the individual evaluations', value: formatValue(first.anti.diagnostics.pooledVariance, 6) },
      ],
      basisText(first.anti.errorBasis),
      first.anti.warnings,
    ),
    report(
      first.ctrl.method,
      ctrl,
      first.ctrl.evaluations,
      ratioInterval(baselineVariance, variance(ctrl), R),
      first.ctrl.efficiency.varianceReductionFactor,
      'The engine computes this one PER SAMPLE as 1/(1 − r²); it does not charge the control for the second evaluation it costs at every sample. The replication column does charge it, so it is the smaller of the two and it is the one to quote at a fixed evaluation budget.',
      [
        { label: 'Fitted coefficient β', value: formatValue(first.ctrl.diagnostics.beta, 6) },
        { label: 'Correlation r = corr(f, c)', value: formatValue(first.ctrl.diagnostics.controlCorrelation, 5) },
        { label: 'Variance of the adjusted values', value: formatValue(first.ctrl.diagnostics.adjustedVariance, 6) },
        { label: 'Variance of the unadjusted values', value: formatValue(first.ctrl.diagnostics.rawVariance, 6) },
      ],
      basisText(first.ctrl.errorBasis),
      first.ctrl.warnings,
    ),
    report(
      first.lhs.method,
      lhs,
      first.lhs.samples,
      ratioInterval(baselineVariance, variance(lhs), R),
      null,
      null,
      [{ label: 'Within-design sample variance (descriptive only)', value: formatValue(first.lhs.sampleVariance, 6) }],
      basisText(first.lhs.errorBasis),
      first.lhs.warnings,
    ),
  ];

  return {
    target,
    controlName: control.name,
    controlMeanText: control.meanText,
    replications: R,
    budget: n,
    methods,
    elapsedMs: Date.now() - started,
  };
}

/** Pilot standard deviations per stratum, and the two allocations they imply. */
interface StrataReport {
  strata: number;
  pilot: number;
  total: number;
  sds: number[];
  proportional: AllocationResult;
  neyman: AllocationResult;
  /** The engine's refusal when no σ_h is supplied, shown rather than paraphrased. */
  neymanWithoutSigma: EngineResult<AllocationResult>;
  sliceNote: string;
}

function runStrataAllocation(opts: { target: VrTarget; strata: number; pilot: number; total: number; seed: string }): StrataReport {
  const strata = equalStrata(opts.strata);
  const buf = new Float64Array(opts.target.dimension);
  for (let k = 1; k < buf.length; k++) buf[k] = 0.5;
  const sds = strata.map((s, h) => {
    const sample = stratifiedSample([s], [opts.pilot], `${opts.seed}#pilot${h}`);
    const values = new Float64Array(opts.pilot);
    for (let i = 0; i < opts.pilot; i++) {
      buf[0] = sample.values[i];
      values[i] = opts.target.f(buf);
    }
    return Math.sqrt(variance(values));
  });
  return {
    strata: opts.strata,
    pilot: opts.pilot,
    total: opts.total,
    sds,
    proportional: allocateStrata(strata, opts.total, 'proportional'),
    neyman: allocateStrata(
      strata.map((s, h) => ({ ...s, sd: sds[h] })),
      opts.total,
      'neyman',
    ),
    neymanWithoutSigma: attempt(() => allocateStrata(strata, opts.total, 'neyman')),
    sliceNote:
      opts.target.dimension === 1
        ? 'The strata partition [0,1), the whole domain of this integrand.'
        : `The strata partition the FIRST coordinate only, with the remaining ${opts.target.dimension - 1} coordinate(s) held at ½. The σ_h below are therefore those of a one-dimensional slice of the integrand, not of the integrand itself, and the allocation is the one for stratifying that coordinate.`,
  };
}

/** A ratio rendered as what it is, including when it is infinite. */
function ratioText(ratio: VrRatio): string {
  if (!Number.isFinite(ratio.factor)) {
    return 'infinite — the variance across replications was exactly zero';
  }
  return `${formatValue(ratio.factor, 4)}× (95% interval ${formatValue(ratio.low, 3)}× to ${formatValue(ratio.high, 3)}×)`;
}

function samplerFor(config: QuasiMonteCarloConfig): SamplerSpec {
  switch (config.sequence) {
    case 'halton':
      return { kind: 'halton', scramble: config.haltonScramble, leap: config.haltonLeap, skip: config.haltonSkip };
    case 'faure':
      return { kind: 'faure', randomise: config.faureRandomise };
    case 'lattice':
      return { kind: 'lattice', randomShift: config.latticeRandomShift };
  }
}

function sequenceFor(config: QuasiMonteCarloConfig): PointSequence {
  switch (config.sequence) {
    case 'halton':
      return haltonSequence({
        dimension: config.dimension,
        scramble: config.haltonScramble,
        leap: config.haltonLeap,
        skip: config.haltonSkip,
        seed: config.seed,
      });
    case 'faure':
      return faureSequence({ dimension: config.dimension, randomise: config.faureRandomise, seed: config.seed });
    case 'lattice':
      return latticeRule({
        dimension: config.dimension,
        count: config.pointCount,
        randomShift: config.latticeRandomShift,
        seed: config.seed,
      });
  }
}

function isRandomised(config: QuasiMonteCarloConfig): boolean {
  switch (config.sequence) {
    case 'halton':
      return config.haltonScramble;
    case 'faure':
      return config.faureRandomise;
    case 'lattice':
      return config.latticeRandomShift;
  }
}

/** Errors are rendered as the engine wrote them, never summarised away. */
function messagesOf(result: EngineResult<unknown>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.message);
}

/**
 * The Explanation shown to the reader, assembled only from fields the engine
 * returned: its own method name, its own exactness, its own assumptions, its
 * own error-basis reason. Nothing here is written by this screen about numbers
 * it did not receive.
 */
function explanationFromIntegration(result: IntegrationResult, integrand: Integrand): Explanation {
  const steps = [
    { label: 'Integrand', expression: integrand.name, value: `Exact value ${formatValue(integrand.exact, 10)}` },
    { label: 'Point set', expression: result.method, value: `${result.samples.toLocaleString('en-US')} evaluations in ${result.dimension} dimension(s)` },
    { label: 'Estimate', value: formatValue(result.estimate, 10) },
    { label: 'Signed error against the exact value', value: formatValue(result.estimate - integrand.exact, 10) },
    {
      label: 'Error bar',
      value:
        result.standardError === null
          ? 'None exists for this estimate (see the limitations below).'
          : `Standard error ${formatValue(result.standardError, 8)}`,
    },
  ];
  return {
    method: result.method,
    steps,
    assumptions: result.assumptions,
    limitations: [
      result.errorBasis.kind === 'unavailable' ? result.errorBasis.reason : result.errorBasis.note,
      ...result.warnings,
    ],
    exactness: result.exactness,
  };
}

function explanationFromRqmc(result: RqmcResult, integrand: Integrand): Explanation {
  return {
    method: result.method,
    steps: [
      { label: 'Integrand', expression: integrand.name, value: `Exact value ${formatValue(integrand.exact, 10)}` },
      { label: 'Independent randomisations', value: String(result.replications) },
      { label: 'Evaluations per randomisation', value: result.samplesPerReplication.toLocaleString('en-US') },
      { label: 'Mean of the replicate estimates', value: formatValue(result.estimate, 10) },
      { label: 'Standard error across randomisations', value: formatValue(result.standardError, 8) },
      { label: 'Signed error against the exact value', value: formatValue(result.estimate - integrand.exact, 10) },
    ],
    assumptions: [
      'The replicate estimates are independent because each randomisation uses its own seed; the standard error is their sample standard deviation over √R.',
    ],
    limitations: [
      result.errorBasis.kind === 'replications' ? result.errorBasis.note : 'No replication-based error basis was reported.',
      ...result.warnings,
    ],
    exactness: result.exactness,
  };
}

export function QuasiMonteCarloTool({ config }: { config: QuasiMonteCarloConfig }) {
  const app = useApp();
  const set = (patch: Partial<QuasiMonteCarloConfig>) => app.updateConfig({ ...config, ...patch });

  // Every hook below is unconditional. A conditional hook was a real shipped
  // bug on another screen here; the guards live inside the callbacks instead.
  const integrand = useMemo(() => integrandFor(config.integrand, config.dimension), [config.integrand, config.dimension]);

  const pointSet = useMemo<EngineResult<PointSet>>(
    () => attempt(() => materialise(sequenceFor(config), config.pointCount)),
    [config],
  );

  const projection = useMemo(() => {
    if (!pointSet.ok) return [];
    const { values, dimension, count } = pointSet.value;
    const a = Math.min(Math.max(1, config.projectionX), dimension) - 1;
    const b = Math.min(Math.max(1, config.projectionY), dimension) - 1;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) out.push({ x: values[i * dimension + a], y: values[i * dimension + b] });
    return out;
  }, [pointSet, config.projectionX, config.projectionY]);

  /*
   * Both the single estimate and the randomised one recompute on every change,
   * with no button in front of them, so their field maxima are derived from
   * the engine's work budget rather than being fixed numbers. `RQMC_WORK_LIMIT`
   * counts coordinates produced: R x N x d.
   */
  const samplerSpec = samplerFor(config);
  const perSampleWork = Math.max(1, integrationWork(samplerSpec, config.dimension, config.samples) / Math.max(1, config.samples));
  const maxSamples = Math.max(2, Math.min(262144, Math.floor(RQMC_WORK_LIMIT / perSampleWork)));
  const maxReplications = Math.max(
    2,
    Math.min(64, Math.floor(RQMC_WORK_LIMIT / Math.max(1, integrationWork(samplerSpec, config.dimension, config.samples)))),
  );

  const estimate = useMemo<EngineResult<IntegrationResult>>(
    () =>
      attempt(() =>
        integrate({
          dimension: config.dimension,
          samples: config.samples,
          integrand: integrand.f,
          sampler: samplerFor(config),
          seed: config.seed,
        }),
      ),
    [config, integrand],
  );

  const rqmc = useMemo<EngineResult<RqmcResult> | null>(
    () =>
      config.useRandomisation
        ? attempt(() =>
            randomisedQmcIntegrate(
              {
                dimension: config.dimension,
                samples: config.samples,
                integrand: integrand.f,
                sampler: samplerFor(config),
                seed: config.seed,
              },
              config.replications,
            ),
          )
        : null,
    [config, integrand],
  );

  // --- gated: quadratic in the point count ---------------------------------
  const discrepancy = useMemo(() => {
    if (!config.runDiscrepancy || !pointSet.ok) return null;
    const points = pointSet.value;
    return {
      star: attempt(() => starDiscrepancyL2(points)),
      centred: attempt(() => centredDiscrepancyL2(points)),
      expected: attempt(() => expectedRandomStarDiscrepancy(points.count, points.dimension)),
      correlation: attempt(() => maxAbsPairCorrelation(points)),
    };
  }, [config.runDiscrepancy, pointSet]);

  // --- gated: a search over multipliers coprime to N -----------------------
  const latticeSearch = useMemo(() => {
    if (!config.runLatticeSearch) return null;
    return attempt(() => {
      const weights = Array.from({ length: config.dimension }, (_, j) => 0.9 ** (j + 1));
      return searchLatticeGenerator(config.dimension, config.pointCount, weights, config.latticeSearchCandidates);
    });
  }, [config.runLatticeSearch, config.dimension, config.pointCount, config.latticeSearchCandidates]);

  /**
   * The coordinate count `compareConvergence` budgets, repeated here so the
   * field can state it before the run rather than after a freeze. Three of the
   * four methods are randomised; the fourth is this screen's own point set.
   */
  const convergenceWorkEstimate = convergenceWork(
    config.convergenceSizes,
    [
      { sampler: { kind: 'monte-carlo' } },
      { sampler: { kind: 'lhs' } },
      { sampler: { kind: 'sobol', randomisation: 'digital-shift' } },
      { sampler: samplerFor(config) },
    ],
    config.convergenceReplications,
    config.dimension,
  );

  // --- gated: re-integrates every method at every sample size --------------
  const convergence = useMemo<EngineResult<ConvergenceComparison> | null>(() => {
    if (!config.runConvergence) return null;
    return attempt(() =>
      compareConvergence({
        dimension: config.dimension,
        integrand: integrand.f,
        exactValue: integrand.exact,
        sampleSizes: config.convergenceSizes,
        seed: config.seed,
        replications: config.convergenceReplications,
        methods: [
          { label: 'Plain Monte Carlo', sampler: { kind: 'monte-carlo' } },
          { label: 'Latin hypercube', sampler: { kind: 'lhs' } },
          { label: 'Sobol (randomised, digital shift)', sampler: { kind: 'sobol', randomisation: 'digital-shift' } },
          { label: `This point set: ${SEQUENCES.find((s) => s.value === config.sequence)?.label ?? config.sequence}`, sampler: samplerFor(config) },
        ],
      }),
    );
  }, [config, integrand]);

  /**
   * Log-log curves for the plot, plus an independently fitted slope over the
   * upper half of each ladder. The fit comes from `fitLogLogSlope`; the chart
   * receives finished numbers and computes nothing.
   */
  const convergenceCurves = useMemo(() => {
    if (!convergence?.ok) return null;
    return convergence.value.methods.map((m) => {
      const usable = m.curve.filter((p) => p.error > 0 && Number.isFinite(p.error));
      const tail = usable.slice(Math.floor(usable.length / 2));
      const tailFit = attempt(() => fitLogLogSlope(tail));
      return {
        label: m.label,
        randomised: m.randomised,
        fit: m.fit,
        tailFit,
        warnings: m.warnings,
        points: usable.map((p) => ({ x: Math.log10(p.samples), y: Math.log10(p.error) })),
        curve: m.curve,
      };
    });
  }, [convergence]);


  // --- variance reduction --------------------------------------------------
  const vrTarget = useMemo(() => vrTargetFor(config.vrIntegrand, config.dimension), [config.vrIntegrand, config.dimension]);

  // Gated: four estimators × R replications × N evaluations, on this thread.
  const varianceReduction = useMemo<EngineResult<VrComparison> | null>(() => {
    if (!config.runVarianceReduction) return null;
    return attempt(() =>
      runVarianceReduction({
        target: vrTarget,
        control: vrControlFor(config.vrControl, vrTarget.dimension),
        budget: config.vrSamples,
        replications: config.vrReplications,
        splitFraction: config.vrSplitFraction,
        seed: config.seed,
      }),
    );
  }, [
    config.runVarianceReduction,
    config.vrControl,
    config.vrSamples,
    config.vrReplications,
    config.vrSplitFraction,
    config.seed,
    vrTarget,
  ]);

  // The tilted estimator and the plain one are attempted separately, so that a
  // refusal of either (an unobserved event, a weight that overflows) still
  // leaves the other visible. Both are cheap enough not to need a button.
  const tiltedTail = useMemo(
    () =>
      attempt(() =>
        tiltedNormalTailProbability({
          threshold: config.isThreshold,
          samples: config.isSamples,
          seed: config.seed,
          tilt: config.isUseOptimalTilt ? undefined : config.isTilt,
        }),
      ),
    [config.isThreshold, config.isSamples, config.seed, config.isUseOptimalTilt, config.isTilt],
  );

  const plainTail = useMemo(
    () => attempt(() => plainNormalTailProbability({ threshold: config.isThreshold, samples: config.isSamples, seed: config.seed })),
    [config.isThreshold, config.isSamples, config.seed],
  );

  const strata = useMemo(
    () =>
      attempt(() =>
        runStrataAllocation({
          target: vrTarget,
          strata: config.strataCount,
          pilot: config.strataPilot,
          total: config.strataTotal,
          seed: config.seed,
        }),
      ),
    [vrTarget, config.strataCount, config.strataPilot, config.strataTotal, config.seed],
  );

  const randomised = isRandomised(config);
  const sequenceLabel = SEQUENCES.find((s) => s.value === config.sequence)?.label ?? config.sequence;

  return (
    <>
      <ToolHeader toolId="quasi-monte-carlo" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Point set">
            <SelectField
              label="Construction"
              value={config.sequence}
              onChange={(sequence) => set({ sequence })}
              options={SEQUENCES}
              hint="A quasi-random point set is not a random stream: its points are deliberately correlated, and that correlation is what makes it fill the cube evenly."
            />
            <NumberField label="Dimension" symbol="d" value={config.dimension} onChange={(dimension) => set({ dimension, projectionX: Math.min(config.projectionX, dimension), projectionY: Math.min(config.projectionY, dimension) })} min={1} max={64} integer />
            <NumberField
              label="Points to build"
              symbol="N"
              value={config.pointCount}
              onChange={(pointCount) => set({ pointCount })}
              min={2}
              max={16384}
              integer
              hint={
                config.sequence === 'lattice'
                  ? 'Used for the projection plot and the diagnostics below. A lattice rule is defined for exactly N points and its generating vector is searched when the set is built, so N and the dimension together set the cost of building it; past the search budget the engine refuses instead of stopping the page.'
                  : 'Used for the projection plot and the diagnostics below. Kept modest by default because the discrepancy measures are quadratic in it.'
              }
            />
            <TextField label="Seed" value={config.seed} onChange={(seed) => set({ seed })} monospace hint="Randomised constructions need a seed so the randomisation can be reproduced." />

            {config.sequence === 'halton' && (
              <>
                <Checkbox checked={config.haltonScramble} onChange={(haltonScramble) => set({ haltonScramble })} label="Scramble the digits" description="A random digit permutation per coordinate. This is what makes the set randomised, and only a randomised set can carry an error estimate." />
                <NumberField label="Leap" value={config.haltonLeap} onChange={(haltonLeap) => set({ haltonLeap })} min={1} max={1000} integer hint="Take every leap-th index. Primes are best; 1 takes every index." />
                <NumberField label="Skip" value={config.haltonSkip} onChange={(haltonSkip) => set({ haltonSkip })} min={0} max={100000} integer hint="Discard the first few indices, including the origin at index 0." />
              </>
            )}
            {config.sequence === 'faure' && (
              <Checkbox checked={config.faureRandomise} onChange={(faureRandomise) => set({ faureRandomise })} label="Random digit shift" description="A random shift modulo the prime base, which randomises the set without destroying its structure." />
            )}
            {config.sequence === 'lattice' && (
              <Checkbox checked={config.latticeRandomShift} onChange={(latticeRandomShift) => set({ latticeRandomShift })} label="Cranley–Patterson random shift" description="Adds one uniform shift modulo 1 to every point. The lattice is defined for exactly N points, so changing N changes the rule." />
            )}
          </Card>

          <Card title="Projection to plot" hint="Only two coordinates can be shown at a time, and bad pairs are where weak constructions show themselves.">
            <SliderField label="Horizontal coordinate" value={config.projectionX} onChange={(projectionX) => set({ projectionX })} min={1} max={config.dimension} step={1} integer />
            <SliderField label="Vertical coordinate" value={config.projectionY} onChange={(projectionY) => set({ projectionY })} min={1} max={config.dimension} step={1} integer />
          </Card>

          <Card title="Integration">
            <SelectField label="Integrand over the unit cube" value={config.integrand} onChange={(v) => set({ integrand: v })} options={INTEGRANDS} hint="Each of these has an exact value derived analytically, so the error shown is a true error and not a spread." />
            <NumberField
              label="Evaluations"
              symbol="N"
              value={config.samples}
              onChange={(samples) => set({ samples })}
              min={2}
              max={maxSamples}
              integer
              hint={`This estimate is not behind a button: it recomputes on every change. Each evaluation costs ${config.dimension} coordinate(s), so in ${config.dimension} dimension(s) N is capped at ${maxSamples.toLocaleString('en-US')} to keep the recomputation under a second.`}
            />
            <Checkbox
              checked={config.useRandomisation}
              onChange={(useRandomisation) => set({ useRandomisation })}
              label="Also estimate the error across independent randomisations"
              description="Randomised QMC. This is the only way to put an error bar on a QMC estimate; without it the result below has none, and none is shown."
            />
            {config.useRandomisation && (
              <NumberField
                label="Independent randomisations"
                symbol="R"
                value={config.replications}
                onChange={(replications) => set({ replications })}
                min={2}
                max={maxReplications}
                integer
                hint={`At least 8; 16 to 32 is usual. Costs R times the evaluations, and it is not behind a button either: R x N x d coordinates are produced on every change. At N = ${config.samples.toLocaleString('en-US')} in ${config.dimension} dimension(s) that caps R at ${maxReplications.toLocaleString('en-US')} here; 64 randomisations of 65,536 points in 64 dimensions froze the page for 24 seconds.`}
              />
            )}
          </Card>


          <Card title="Variance reduction" hint="Change the estimator rather than the points: antithetic variates, control variates and a Latin hypercube, all against plain Monte Carlo.">
            <SelectField
              label="Integrand for these estimators"
              value={config.vrIntegrand}
              onChange={(vrIntegrand) => set({ vrIntegrand })}
              options={VR_INTEGRANDS}
              hint="Two of these are symmetric about ½, where antithetic variates increase the variance rather than reduce it. They are on the menu on purpose."
            />
            <NumberField
              label="Evaluations per estimator per replication"
              symbol="N"
              value={config.vrSamples}
              onChange={(vrSamples) => set({ vrSamples })}
              min={16}
              max={8192}
              integer
              hint="The antithetic and control-variate estimators get half the sample count, because each of their samples costs two integrand evaluations. What is held equal is evaluations, not samples. The maximum is 8,192 because 8,192 × 24 replications × four estimators was measured at 1.4 s on the costliest integrand here, and the next step up took 3.8 s."
            />
            <NumberField
              label="Independent replications"
              symbol="R"
              value={config.vrReplications}
              onChange={(vrReplications) => set({ vrReplications })}
              min={3}
              max={24}
              integer
              hint="Each variance ratio is estimated from R numbers per estimator. Below about 10 its interval spans more than an order of magnitude, and the table says so."
            />
            <SelectField
              label="Control variate"
              value={config.vrControl}
              onChange={(vrControl) => set({ vrControl })}
              options={VR_CONTROLS}
              hint="A control variate is only usable if its expectation is known in closed form. Both of these have one, and the result states which value was used."
            />
            <SliderField
              label="Fraction of the sample held out to fit β"
              value={config.vrSplitFraction}
              onChange={(vrSplitFraction) => set({ vrSplitFraction })}
              min={0}
              max={0.5}
              step={0.05}
              hint="0 reuses every sample for both β and the mean, which biases the control-variate estimator by O(1/N). A positive fraction removes that bias exactly, at the cost of a noisier β."
            />
          </Card>

          <Card title="Importance sampling" hint="A normal tail probability, by an exponentially tilted proposal and by plain Monte Carlo at the same cost.">
            <NumberField
              label="Threshold a, for P(Z > a)"
              value={config.isThreshold}
              onChange={(isThreshold) => set({ isThreshold })}
              min={0}
              max={8}
              step={0.25}
              hint="At a = 4.5 the probability is about 3.4 × 10⁻⁶, so plain Monte Carlo needs of the order of 300,000 draws merely to see the event once."
            />
            <NumberField
              label="Draws"
              value={config.isSamples}
              onChange={(isSamples) => set({ isSamples })}
              min={2}
              max={200000}
              integer
              hint="Plain Monte Carlo is run at the same number of draws so the two are directly comparable. 200,000 draws of both measured about 115 ms here, which is why this one is not behind a button."
            />
            <Checkbox
              checked={config.isUseOptimalTilt}
              onChange={(isUseOptimalTilt) => set({ isUseOptimalTilt })}
              label="Use the asymptotically optimal tilt, θ = a"
              description="Turn this off to choose the tilt yourself, including values that make the weights degenerate and the estimate quietly wrong."
            />
            {!config.isUseOptimalTilt && (
              <NumberField
                label="Tilt θ — the proposal is N(θ, 1)"
                value={config.isTilt}
                onChange={(isTilt) => set({ isTilt })}
                min={-4}
                max={16}
                step={0.5}
                hint="θ = 0 is the target itself, which for a large threshold cannot observe the event at all and is refused rather than answered with zero. A θ well above a is the interesting failure: the weights become degenerate, the estimate is driven by one or two draws, and it still looks plausible."
              />
            )}
          </Card>

          <Card title="Stratification" hint="Equal-width strata on one coordinate, with proportional and Neyman allocation of a fixed total sample.">
            <NumberField label="Strata" symbol="H" value={config.strataCount} onChange={(strataCount) => set({ strataCount })} min={2} max={64} integer />
            <NumberField
              label="Pilot draws per stratum"
              value={config.strataPilot}
              onChange={(strataPilot) => set({ strataPilot })}
              min={2}
              max={2048}
              integer
              hint="Neyman allocation needs a within-stratum standard deviation for every stratum. These pilot draws supply them, so the optimality is conditional on the pilot."
            />
            <NumberField
              label="Total sample to allocate"
              value={config.strataTotal}
              onChange={(strataTotal) => set({ strataTotal })}
              min={config.strataCount}
              max={100000}
              integer
              hint="At least one per stratum; the engine refuses less."
            />
          </Card>

          <AiAssistPanel capability="suggestFollowUps" context="Raise the dimension and look at the last pair of coordinates: Halton's higher bases align into stripes long before the first coordinates do. The projection plot and the pairwise correlation both show it." />
        </div>

        <div className="oc-stack">
          {!pointSet.ok && <Notice tone="error" title="The point set could not be built" items={messagesOf(pointSet)} />}

          {pointSet.ok && (
            <Card title="Projection of the point set" actions={<Badge variant="exact">{pointSet.value.randomised ? 'Randomised construction' : 'Deterministic construction'}</Badge>}>
              <ScatterChart
                title={`Coordinates ${config.projectionX} and ${config.projectionY} of ${pointSet.value.name}`}
                description={`A two-dimensional projection of ${pointSet.value.count.toLocaleString('en-US')} points from a ${pointSet.value.dimension}-dimensional construction. Even coverage in this projection does not imply even coverage in others.`}
                points={projection}
                xLabel={`Coordinate ${config.projectionX}`}
                yLabel={`Coordinate ${config.projectionY}`}
                note="Gaps and stripes here are real structure, not sampling noise: the points are deterministic (or a single randomisation of a deterministic set), so this picture is the same every time for a given seed."
                onExport={() => downloadText('qmc-projection.csv', toCsv([`coordinate-${config.projectionX}`, `coordinate-${config.projectionY}`], projection.map((p) => [p.x, p.y])))}
              />
            </Card>
          )}

          {!estimate.ok && <Notice tone="error" title="The integration failed" items={messagesOf(estimate)} />}

          {estimate.ok && (
            <Card title="Integration estimate" actions={<Badge variant={estimate.value.exactness}>{estimate.value.exactness === 'numerical' ? 'Numerical approximation' : 'Empirical estimate'}</Badge>}>
              <KeyValueList
                items={[
                  { label: 'Method', value: estimate.value.method },
                  { label: 'Estimate', value: formatValue(estimate.value.estimate, 10) },
                  { label: 'Exact value of this integrand', value: formatValue(integrand.exact, 10) },
                  { label: 'Signed error', value: formatValue(estimate.value.estimate - integrand.exact, 10) },
                  { label: 'Evaluations', value: estimate.value.samples.toLocaleString('en-US') },
                  {
                    label: 'Error bar',
                    value:
                      estimate.value.standardError === null
                        ? 'None — see below'
                        : `${formatValue(estimate.value.standardError, 8)} (standard error)`,
                  },
                ]}
              />
              {estimate.value.standardError === null && estimate.value.errorBasis.kind === 'unavailable' && (
                <Notice tone="warning" title="This estimate has no confidence interval, and none is shown">
                  <p style={{ marginTop: 0 }}>{estimate.value.errorBasis.reason}</p>
                  <p style={{ marginBottom: 0 }}>
                    What this construction does carry instead is a deterministic bound: the error is at most the variation of the integrand times the
                    discrepancy of the point set (Koksma–Hlawka). That is a worst-case guarantee about this one point set, not a probability statement, and it
                    cannot be turned into a 95% interval. The discrepancy half of it is measurable below.
                  </p>
                </Notice>
              )}
              {estimate.value.warnings.length > 0 && <Notice tone="warning" title="Warnings from the computation" items={estimate.value.warnings} />}
              <ExplanationPanel explanation={explanationFromIntegration(estimate.value, integrand)} defaultOpen />
            </Card>
          )}

          {rqmc && !rqmc.ok && <Notice tone="error" title="Randomised QMC failed" items={messagesOf(rqmc)} />}

          {rqmc?.ok && (
            <Card title="Randomised QMC: the error bar that does exist" actions={<Badge variant="numerical">Numerical approximation</Badge>}>
              <KeyValueList
                items={[
                  { label: 'Method', value: rqmc.value.method },
                  { label: 'Estimate (mean over randomisations)', value: formatValue(rqmc.value.estimate, 10) },
                  { label: 'Standard error across randomisations', value: formatValue(rqmc.value.standardError, 8) },
                  { label: 'Randomisations', value: String(rqmc.value.replications) },
                  { label: 'Evaluations per randomisation', value: rqmc.value.samplesPerReplication.toLocaleString('en-US') },
                  { label: 'Signed error', value: formatValue(rqmc.value.estimate - integrand.exact, 10) },
                ]}
              />
              <Notice tone="info" title="What this interval is a statement about">
                <p style={{ margin: 0 }}>
                  It is the spread of the estimate across independent randomisations of the same point set — a confidence interval for the integral, computed
                  from {rqmc.value.replications} replicate estimates. It is not a set of percentiles of simulated outcomes, and it says nothing about the spread
                  of the integrand itself.
                </p>
              </Notice>
              {rqmc.value.warnings.length > 0 && <Notice tone="warning" items={rqmc.value.warnings} />}
              <DataTable
                caption="Replicate estimates"
                maxHeight={220}
                columns={[
                  { key: 'r', header: 'Randomisation', numeric: true, render: (_r, i) => String(i + 1) },
                  { key: 'e', header: 'Estimate', numeric: true, render: (r) => formatValue(r.value, 10) },
                ]}
                rows={rqmc.value.replicateEstimates.map((value) => ({ value }))}
              />
              <ExplanationPanel explanation={explanationFromRqmc(rqmc.value, integrand)} />
            </Card>
          )}

          {/* ------------------------------------------------ discrepancy */}
          <Card title="Discrepancy of the point set" hint="How far the point set departs from perfectly even coverage.">
            {!config.runDiscrepancy ? (
              <>
                <Notice tone="info" title="Discrepancy is not computed automatically">
                  <p style={{ marginTop: 0 }}>
                    The L₂ star and centred discrepancies sum over every pair of points, so the work grows as N². At the current N ={' '}
                    {config.pointCount.toLocaleString('en-US')} that is about {((config.pointCount * config.pointCount) / 1e6).toFixed(2)} million pair terms in{' '}
                    {config.dimension} dimension(s). It is run only when you ask for it, so that opening this screen never blocks the page.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    It is also the measurable half of the Koksma–Hlawka bound, which is the only error guarantee an unrandomised point set has.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runDiscrepancy: true })} disabled={!pointSet.ok}>
                    Compute the discrepancy
                  </Button>
                </div>
                {!pointSet.ok && <p className="oc-muted">There is no point set, so there is nothing to measure.</p>}
              </>
            ) : !discrepancy ? (
              <Notice tone="info">There is no point set, so there is nothing to measure.</Notice>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="reset" variant="ghost" onClick={() => set({ runDiscrepancy: false })}>
                    Stop computing it
                  </Button>
                </div>
                {!discrepancy.star.ok && <Notice tone="error" title="L₂ star discrepancy failed" items={messagesOf(discrepancy.star)} />}
                {!discrepancy.centred.ok && <Notice tone="error" title="Centred L₂ discrepancy failed" items={messagesOf(discrepancy.centred)} />}
                {!discrepancy.expected.ok && <Notice tone="error" title="The random-point reference failed" items={messagesOf(discrepancy.expected)} />}
                {!discrepancy.correlation.ok && <Notice tone="error" title="Pairwise correlation failed" items={messagesOf(discrepancy.correlation)} />}
                <KeyValueList
                  items={[
                    ...(discrepancy.star.ok ? [{ label: 'L₂ star discrepancy', value: formatValue(discrepancy.star.value, 8) }] : []),
                    ...(discrepancy.centred.ok ? [{ label: 'Centred L₂ discrepancy', value: formatValue(discrepancy.centred.value, 8) }] : []),
                    ...(discrepancy.expected.ok
                      ? [{ label: 'Expected L₂ star discrepancy of N independent uniform points', value: formatValue(discrepancy.expected.value, 8) }]
                      : []),
                    ...(discrepancy.star.ok && discrepancy.expected.ok
                      ? [{ label: 'Ratio to independent uniform points', value: `${formatValue(discrepancy.star.value / discrepancy.expected.value, 5)}×` }]
                      : []),
                    ...(discrepancy.correlation.ok
                      ? [
                          {
                            label: 'Largest absolute pairwise correlation',
                            value: `${formatValue(discrepancy.correlation.value.value, 5)} between coordinates ${discrepancy.correlation.value.i + 1} and ${discrepancy.correlation.value.j + 1}`,
                          },
                        ]
                      : []),
                  ]}
                />
                <Notice tone="info" title="Reading these numbers">
                  <p style={{ margin: 0 }}>
                    Smaller discrepancy is more even coverage. The reference line is the expected discrepancy of the same number of independent uniform points,
                    so a ratio below 1 is the whole point of the construction. A large pairwise correlation means two coordinates are not behaving
                    independently of one another in this point set — the classic failure of high-dimensional Halton.
                  </p>
                </Notice>
              </>
            )}
          </Card>

          {/* -------------------------------------------- lattice search */}
          <Card title="Search for a lattice generating vector" hint="Component-by-component search over the multipliers coprime to N.">
            {!config.runLatticeSearch ? (
              <>
                <Notice tone="info" title="The generator search is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    This examines up to {config.latticeSearchCandidates.toLocaleString('en-US')} candidate multipliers per coordinate, scoring each over all N ={' '}
                    {config.pointCount.toLocaleString('en-US')} points, for each of {config.dimension} coordinate(s). It is a search, and it is run only when
                    you ask for it.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    The figure of merit depends on the product weights γⱼ = 0.9ʲ, which assert that later coordinates matter less. A different weighting gives a
                    different vector, so the weights are stated with the result.
                  </p>
                </Notice>
                <NumberField
                  label="Candidate multipliers per coordinate"
                  value={config.latticeSearchCandidates}
                  onChange={(latticeSearchCandidates) => set({ latticeSearchCandidates })}
                  min={8}
                  max={1024}
                  integer
                  hint={`The search costs d × candidates × N products and runs on this thread, so the engine refuses any setting above ${LATTICE_SEARCH_WORK_LIMIT.toExponential(0)} of them rather than stopping the page for seconds. These settings ask for ${(config.dimension * Math.min(config.latticeSearchCandidates, config.pointCount) * config.pointCount).toExponential(2)}.`}
                />
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runLatticeSearch: true })}>
                    Run the search
                  </Button>
                </div>
              </>
            ) : !latticeSearch ? (
              <Notice tone="info">The search has not been started.</Notice>
            ) : !latticeSearch.ok ? (
              <>
                <Notice tone="error" title="The search failed" items={messagesOf(latticeSearch)} />
                <div className="oc-btn-row">
                  <Button icon="reset" variant="ghost" onClick={() => set({ runLatticeSearch: false })}>
                    Clear
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="reset" variant="ghost" onClick={() => set({ runLatticeSearch: false })}>
                    Stop running it
                  </Button>
                </div>
                <KeyValueList
                  items={[
                    { label: 'Generating vector z', value: <code>({[...latticeSearch.value.generator].join(', ')})</code> },
                    { label: 'Shift-averaged worst-case error ê(z)', value: formatValue(latticeSearch.value.figureOfMerit, 8) },
                    { label: 'Product weights γⱼ', value: latticeSearch.value.weights.map((w) => formatValue(w, 4)).join(', ') },
                    { label: 'Points this vector is for', value: config.pointCount.toLocaleString('en-US') },
                  ]}
                />
                <Notice tone="warning" title="This vector is for exactly this N">
                  <p style={{ margin: 0 }}>
                    A rank-1 lattice rule is defined for one point count. Changing N invalidates the vector above: the search has to be repeated. That is
                    unlike a digital net, where a prefix of the sequence is still a usable point set.
                  </p>
                </Notice>
              </>
            )}
          </Card>

          {/* ---------------------------------------------- convergence */}
          <Card title="Convergence: error against sample size" hint="The same integrand through several samplers at a ladder of sample sizes.">
            {!config.runConvergence ? (
              <>
                <Notice tone="info" title="The convergence comparison is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    It integrates four methods at {config.convergenceSizes.length} sample sizes, replicating each randomised method{' '}
                    {config.convergenceReplications} times: roughly{' '}
                    {(
                      config.convergenceSizes.reduce((a, b) => a + b, 0) *
                      (3 * config.convergenceReplications + (randomised ? config.convergenceReplications : 1))
                    ).toLocaleString('en-US')}{' '}
                    integrand evaluations in all, on the main thread. It is run only when you ask for it.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    The error at each N is the root-mean-square error across randomisations for a randomised method, and a single deterministic absolute error
                    for an unrandomised one. Those are different quantities and the table says which is which.
                  </p>
                </Notice>
                <NumberField
                  label="Replications per randomised method"
                  value={config.convergenceReplications}
                  onChange={(convergenceReplications) => set({ convergenceReplications })}
                  min={2}
                  max={32}
                  integer
                  hint={`Replications and the dimension multiply: the harness has to produce ${convergenceWorkEstimate.toExponential(2)} coordinates at these settings, and the engine refuses above ${CONVERGENCE_WORK_LIMIT.toExponential(0)} rather than stopping the page for seconds. Reduce the dimension if this is over the limit.`}
                />
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runConvergence: true })}>
                    Run the comparison
                  </Button>
                </div>
              </>
            ) : !convergence ? (
              <Notice tone="info">The comparison has not been started.</Notice>
            ) : !convergence.ok ? (
              <>
                <Notice tone="error" title="The comparison failed" items={messagesOf(convergence)} />
                <div className="oc-btn-row">
                  <Button icon="reset" variant="ghost" onClick={() => set({ runConvergence: false })}>
                    Clear
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="reset" variant="ghost" onClick={() => set({ runConvergence: false })}>
                    Stop running it
                  </Button>
                </div>
                {convergenceCurves && (
                  <LineChart
                    title="Error against sample size, both on log₁₀ scales"
                    description="Each curve is log₁₀ of the error against log₁₀ of the sample size. A straight line means a power law, and its slope is the observed convergence rate."
                    series={convergenceCurves.map((m) => ({ label: m.label, points: m.points, dashed: !m.randomised }))}
                    xLabel="log₁₀ sample size"
                    yLabel="log₁₀ error"
                    yDomain={(() => {
                      const ys = convergenceCurves.flatMap((m) => m.points.map((p) => p.y));
                      if (!ys.length) return undefined;
                      const lo = Math.min(...ys);
                      const hi = Math.max(...ys);
                      const pad = (hi - lo) * 0.1 || 0.5;
                      return [lo - pad, hi + pad] as [number, number];
                    })()}
                    valueFormatter={(v) => `10^${formatValue(v, 3)}`}
                    note="Dashed curves are unrandomised samplers: each of their points is one deterministic number with no error bar of its own. Solid curves are root-mean-square errors across replications."
                    onExport={() =>
                      downloadText(
                        'qmc-convergence.csv',
                        toCsv(
                          ['method', 'samples', 'error', 'mean_estimate', 'replications'],
                          convergenceCurves.flatMap((m) => m.curve.map((p) => [m.label, p.samples, p.error, p.estimate, p.replications])),
                        ),
                      )
                    }
                  />
                )}
                <DataTable
                  caption="Observed convergence rates"
                  columns={[
                    { key: 'm', header: 'Method', render: (r) => r.label },
                    { key: 's', header: 'Slope (all N)', numeric: true, render: (r) => formatValue(r.fit.slope, 4) },
                    { key: 'r2', header: 'R² of the log–log fit', numeric: true, render: (r) => formatValue(r.fit.rSquared, 4) },
                    { key: 't', header: 'Slope (upper half of the ladder)', numeric: true, render: (r) => (r.tailFit.ok ? formatValue(r.tailFit.value.slope, 4) : r.tailFit.errors[0].message) },
                    { key: 'e', header: 'Error basis', render: (r) => (r.randomised ? `RMSE over ${config.convergenceReplications} randomisations` : 'Single deterministic error') },
                  ]}
                  rows={convergenceCurves ?? []}
                />
                <KeyValueList
                  items={[
                    { label: 'Exact value of the integrand', value: formatValue(convergence.value.exactValue, 10) },
                    { label: 'Dimension', value: String(convergence.value.dimension) },
                    {
                      label: `Error relative to plain Monte Carlo at N = ${convergence.value.sampleSizes[convergence.value.sampleSizes.length - 1].toLocaleString('en-US')}`,
                      value: Object.entries(convergence.value.errorRatioAtLargestN)
                        .map(([label, ratio]) => `${label}: ${Number.isFinite(ratio) ? `${formatValue(ratio, 4)}×` : 'not available'}`)
                        .join(' · '),
                    },
                  ]}
                />
                {convergenceCurves?.some((m) => m.warnings.length > 0) && (
                  <Notice tone="warning" title="Warnings from the comparison" items={convergenceCurves.flatMap((m) => m.warnings.map((w) => `${m.label}: ${w}`))} />
                )}
                <Notice tone="info" title="These slopes are measurements, not textbook rates">
                  <p style={{ margin: 0 }}>
                    Plain Monte Carlo should land near −0.5 and will wander by a few hundredths on any single run. A low-discrepancy set on a smooth integrand of
                    low effective dimension typically lands between −0.8 and −1.0. A flat slope is the honest answer for an integrand that is not smooth or whose
                    effective dimension is high — {sequenceLabel} is not exempt from that.
                  </p>
                </Notice>
              </>
            )}
          </Card>

          {/* --------------------------------- variance reduction */}
          <Card title="Variance reduction: what each technique actually bought" hint="Four estimators of the same integral at the same evaluation budget, ranked by measured variance.">
            {!config.runVarianceReduction ? (
              <>
                <Notice tone="info" title="The comparison is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    It runs four estimators {config.vrReplications} times each at {config.vrSamples.toLocaleString('en-US')} evaluations apiece — about{' '}
                    {(4 * config.vrSamples * config.vrReplications).toLocaleString('en-US')} integrand evaluations on this thread, and it reports the
                    wall-clock time it took. Measured in this browser: 0.11&nbsp;s at the defaults, 0.29&nbsp;s at the largest permitted settings
                    (N = 8,192, R = 24) on the one-dimensional integrands, and 1.4&nbsp;s at those same settings on the Genz integrand in sixteen dimensions,
                    which is the most expensive combination the fields allow. The maxima come from those measurements rather than from what looks tidy: at
                    N = 32,768 and R = 24 the comparison took 3.8&nbsp;s on the main thread, which is too long to hold the page for, so it is not offered.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    Without a plain Monte Carlo estimator beside them at the same cost, none of these techniques says anything, so the baseline is always run
                    and always shown.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runVarianceReduction: true })}>
                    Run the comparison
                  </Button>
                </div>
              </>
            ) : !varianceReduction ? (
              <Notice tone="info">The comparison has not been started.</Notice>
            ) : !varianceReduction.ok ? (
              <>
                <Notice tone="error" title="The comparison failed" items={messagesOf(varianceReduction)} />
                <div className="oc-btn-row">
                  <Button icon="reset" variant="ghost" onClick={() => set({ runVarianceReduction: false })}>
                    Clear
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="reset" variant="ghost" onClick={() => set({ runVarianceReduction: false })}>
                    Stop running it
                  </Button>
                </div>
                <KeyValueList
                  items={[
                    { label: 'Integrand', value: varianceReduction.value.target.name },
                    { label: 'Exact value', value: formatValue(varianceReduction.value.target.exact, 10) },
                    { label: 'Dimension', value: String(varianceReduction.value.target.dimension) },
                    { label: 'Evaluations per estimator per replication', value: varianceReduction.value.budget.toLocaleString('en-US') },
                    { label: 'Independent replications', value: String(varianceReduction.value.replications) },
                    { label: 'Control variate', value: `${varianceReduction.value.controlName} — ${varianceReduction.value.controlMeanText}` },
                    { label: 'Wall-clock time for the whole comparison', value: `${varianceReduction.value.elapsedMs.toLocaleString('en-US')} ms` },
                  ]}
                />
                <DataTable
                  caption="Measured variance ratios against plain Monte Carlo at an equal evaluation budget"
                  columns={[
                    { key: 'm', header: 'Estimator', render: (r) => r.label },
                    { key: 'e', header: 'Estimate', numeric: true, render: (r) => formatValue(r.estimate, 8) },
                    {
                      key: 'err',
                      header: 'Signed error',
                      numeric: true,
                      render: (r) => formatValue(r.estimate - varianceReduction.value.target.exact, 6),
                    },
                    {
                      key: 'ratio',
                      header: 'Variance ratio vs plain MC',
                      title: 'Ratio of the variances of the replicate estimates, with a 95% F interval. Above 1 helped; below 1 hurt.',
                      render: (r) => (r.ratio ? ratioText(r.ratio) : 'baseline, by definition 1×'),
                    },
                    {
                      key: 'single',
                      header: "Engine's single-run factor",
                      numeric: true,
                      render: (r) => (r.engineFactor === null ? 'not reported for this estimator' : formatValue(r.engineFactor, 5)),
                    },
                    { key: 'n', header: 'Evaluations', numeric: true, render: (r) => r.evaluationsPerReplicate.toLocaleString('en-US') },
                  ]}
                  rows={varianceReduction.value.methods}
                />
                <Notice tone="warning" title="A variance reduction factor is an estimate, not a speed-up you have been given">
                  <p style={{ marginTop: 0 }}>
                    Every ratio above is a ratio of two sample variances, each computed from {varianceReduction.value.replications} independent replicate
                    estimates. Its 95% interval comes from the F({varianceReduction.value.replications - 1}, {varianceReduction.value.replications - 1})
                    distribution, and with R this small it is wide: at R = 12 it spans about a factor of twelve, at R = 16 about a factor of eight. A single run
                    that reports &ldquo;46× faster&rdquo; from a dozen replications is reporting a number that could as easily have come out 15× or 150×.
                    Raising R is the only thing that narrows it.
                  </p>
                  <p>
                    The interval is a 95% interval, so about one run in twenty it will not contain the truth, and at a small R the two ratio columns can
                    disagree by more than it allows. When they do, that disagreement is the finding: neither column is a speed-up anyone has been handed. Run
                    the same settings at R = 24 and watch the replication ratio move towards the single-run factor.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    The two ratio columns measure different things on purpose, and each row says which. They are not expected to agree closely.
                  </p>
                </Notice>
                <DataTable
                  caption="Confidence interval for the integral, kept separate from the spread of the individual replications"
                  columns={[
                    { key: 'm', header: 'Estimator', render: (r) => r.label },
                    {
                      key: 'ci',
                      header: '95% confidence interval for the integral',
                      title: 'A statement about where the integral is, computed from the replicate estimates.',
                      render: (r) => `${formatValue(r.interval.low, 8)} to ${formatValue(r.interval.high, 8)}`,
                    },
                    {
                      key: 'sd',
                      header: 'SD of one replicate estimate',
                      numeric: true,
                      title: 'The spread of individual replications. This is not a confidence interval and is √R times wider than one.',
                      render: (r) => formatValue(r.replicateSd, 6),
                    },
                    {
                      key: 'range',
                      header: 'Range over the replications',
                      render: (r) => `${formatValue(r.replicateMin, 8)} to ${formatValue(r.replicateMax, 8)}`,
                    },
                  ]}
                  rows={varianceReduction.value.methods}
                />
                <Notice tone="info" title="Two different statements, deliberately in two different tables">
                  <p style={{ margin: 0 }}>
                    The interval in this second table is a confidence interval for the integral: mean of the replicate estimates ± t·s/√R. The column beside it
                    is the standard deviation of one replicate estimate — the spread you would see if you ran the estimator once more. The second is √R times
                    the standard error, and reporting it as an interval for the integral would overstate the uncertainty by that factor.
                  </p>
                </Notice>
                <LineChart
                  title="Replicate estimates, by replication"
                  description={`Each series is one estimator's ${varianceReduction.value.replications} independent estimates of the same integral. A tighter band is a lower-variance estimator; the exact value is ${formatValue(varianceReduction.value.target.exact, 8)}.`}
                  series={varianceReduction.value.methods.map((m) => ({
                    label: m.label,
                    points: m.replicates.map((y, i) => ({ x: i + 1, y })),
                  }))}
                  xLabel="Replication"
                  yLabel="Estimate"
                  note="All four estimators spend the same number of integrand evaluations per replication, so the vertical scatter of each band is the whole comparison."
                  onExport={() =>
                    downloadText(
                      'qmc-variance-reduction.csv',
                      toCsv(
                        ['estimator', 'replication', 'estimate', 'evaluations'],
                        varianceReduction.value.methods.flatMap((m) =>
                          m.replicates.map((e, i) => [m.label, i + 1, e, m.evaluationsPerReplicate]),
                        ),
                      ),
                    )
                  }
                />
                <DataTable
                  caption="Measured diagnostics, from the first replication"
                  maxHeight={300}
                  columns={[
                    { key: 'm', header: 'Estimator', render: (r) => r.method },
                    { key: 'd', header: 'Diagnostic', render: (r) => r.label },
                    { key: 'v', header: 'Value', numeric: true, render: (r) => r.value },
                  ]}
                  rows={varianceReduction.value.methods.flatMap((m) => m.diagnostics.map((d) => ({ method: m.label, label: d.label, value: d.value })))}
                />
                {varianceReduction.value.target.dimension === 1 && (
                  <Notice tone="warning" title="The Latin hypercube row is at its absolute best here">
                    <p style={{ margin: 0 }}>
                      In one dimension a Latin hypercube IS exact stratification into N equal intervals, and for a smooth integrand its variance falls like
                      N⁻³ rather than N⁻¹. The factor of millions above is real and reproducible, and it is also the best case that exists for the technique: it
                      comes from the integrand being entirely an additive main effect of one coordinate. Choose one of the multi-dimensional integrands to see
                      what the same design buys when there are interactions for it to miss.
                    </p>
                  </Notice>
                )}
                <Notice tone="info" title={`What antithetic variates should do on ${varianceReduction.value.target.name}`}>
                  <p style={{ margin: 0 }}>{varianceReduction.value.target.antitheticNote}</p>
                </Notice>
                {varianceReduction.value.methods.some((m) => m.warnings.length > 0) && (
                  <Notice
                    tone="warning"
                    title="Warnings from the estimators themselves"
                    items={varianceReduction.value.methods.flatMap((m) => m.warnings.map((w) => `${m.label}: ${w}`))}
                  />
                )}
                <DataTable
                  caption="What each error bar is a statement about"
                  columns={[
                    { key: 'm', header: 'Estimator', render: (r) => r.label },
                    { key: 'b', header: 'Error basis as the engine reported it', render: (r) => r.errorBasis },
                  ]}
                  rows={varianceReduction.value.methods}
                />
              </>
            )}
          </Card>

          {/* ---------------------------- importance sampling */}
          <Card
            title="Importance sampling: a probability plain Monte Carlo cannot see"
            hint="P(Z > a) for a standard normal Z, by an exponentially tilted proposal N(θ, 1) and by plain Monte Carlo at the same number of draws."
          >
            {!tiltedTail.ok && (
              <Notice tone="error" title="The tilted estimator was refused, and that refusal is the result" items={messagesOf(tiltedTail)} />
            )}
            {tiltedTail.ok && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Method', value: tiltedTail.value.method },
                    { label: 'Estimate', value: formatValue(tiltedTail.value.estimate, 8) },
                    { label: 'Exact value Φ(−a)', value: formatValue(tiltedTail.value.exactValue, 8) },
                    {
                      label: 'Relative error against the exact value',
                      value: Number.isFinite(tiltedTail.value.relativeError)
                        ? `${formatValue(100 * tiltedTail.value.relativeError, 4)}%`
                        : 'not defined, because the exact value is zero',
                    },
                    { label: 'Standard error', value: formatValue(tiltedTail.value.standardError ?? 0, 6) },
                    {
                      label: 'Measured variance ratio against plain Monte Carlo per draw',
                      value: Number.isFinite(tiltedTail.value.efficiency.varianceReductionFactor)
                        ? `${formatValue(tiltedTail.value.efficiency.varianceReductionFactor, 5)}×`
                        : 'infinite — the weighted estimator had zero measured variance',
                    },
                    { label: 'Draws', value: tiltedTail.value.evaluations.toLocaleString('en-US') },
                  ]}
                />
                <Notice tone={tiltedTail.value.degenerate ? 'error' : 'info'} title="Weight diagnostics — the only thing standing between you and a confident wrong answer">
                  <KeyValueList
                    items={[
                      {
                        label: 'Effective sample size of the contributions w·h',
                        value: `${formatValue(tiltedTail.value.contributionEffectiveSampleSize, 6)} of ${tiltedTail.value.evaluations.toLocaleString('en-US')} draws`,
                      },
                      { label: 'As a fraction of the draws', value: `${formatValue(100 * tiltedTail.value.weightEfficiency, 4)}%` },
                      { label: 'Effective sample size of the weights alone', value: formatValue(tiltedTail.value.effectiveWeightSampleSize, 6) },
                      { label: 'Share of the total contribution carried by the single largest draw', value: `${formatValue(100 * tiltedTail.value.maxWeightShare, 4)}%` },
                      { label: 'Degenerate by the engine’s test', value: tiltedTail.value.degenerate ? 'YES — do not report this estimate' : 'no' },
                    ]}
                  />
                  <p style={{ marginBottom: 0 }}>
                    This is the failure mode to fear: with a badly chosen proposal the estimator has infinite variance, and the sample variance will not reveal
                    it. The standard error above is computed from the draws that were seen; if the heavy tail of the weight distribution was not sampled, it can
                    understate the true error by orders of magnitude while the estimate itself still looks entirely plausible. The effective sample size of the
                    contributions is what detects that, not the standard error and not the effective sample size of the weights — a good rare-event tilt makes
                    the latter small on purpose.
                  </p>
                </Notice>
                {tiltedTail.value.warnings.length > 0 && <Notice tone="warning" title="Warnings from the estimator" items={tiltedTail.value.warnings} />}
              </>
            )}
            {!plainTail.ok ? (
              <Notice tone="error" title="The plain Monte Carlo comparison failed" items={messagesOf(plainTail)} />
            ) : plainTail.value.observed ? (
              <Notice tone="info" title="Plain Monte Carlo at the same number of draws">
                <KeyValueList
                  items={[
                    { label: 'Estimate', value: formatValue(plainTail.value.estimate, 8) },
                    { label: 'Exceedances observed', value: `${plainTail.value.successes.toLocaleString('en-US')} of ${plainTail.value.samples.toLocaleString('en-US')}` },
                    { label: 'Standard error', value: formatValue(plainTail.value.standardError, 6) },
                  ]}
                />
              </Notice>
            ) : (
              <Notice tone="warning" title="Plain Monte Carlo did not observe the event at all, and that is not an estimate of zero">
                <p style={{ margin: 0 }}>{plainTail.value.message}</p>
              </Notice>
            )}
          </Card>

          {/* ----------------------------------- stratification */}
          <Card title="Stratified allocation: where the samples should go" hint="Equal-width strata, and the two allocation rules the engine will defend.">
            {!strata.ok ? (
              <Notice tone="error" title="The allocation failed" items={messagesOf(strata)} />
            ) : (
              <>
                <KeyValueList
                  items={[
                    { label: 'Integrand being stratified', value: vrTarget.name },
                    { label: 'Strata', value: String(strata.value.strata) },
                    { label: 'Pilot draws per stratum, used only for σ_h', value: strata.value.pilot.toLocaleString('en-US') },
                    { label: 'Total sample allocated', value: strata.value.total.toLocaleString('en-US') },
                  ]}
                />
                <Notice tone="info" title="What these strata cover">
                  <p style={{ margin: 0 }}>{strata.value.sliceNote}</p>
                </Notice>
                <DataTable
                  caption="Allocation per stratum under both rules"
                  maxHeight={300}
                  columns={[
                    { key: 'h', header: 'Stratum', numeric: true, render: (_r, i) => String(i + 1) },
                    { key: 'w', header: 'Weight W_h', numeric: true, render: (r) => formatValue(r.weight, 5) },
                    { key: 's', header: 'Pilot σ_h', numeric: true, render: (r) => formatValue(r.sd, 5) },
                    { key: 'p', header: 'Proportional n_h', numeric: true, render: (r) => r.proportional.toLocaleString('en-US') },
                    { key: 'n', header: 'Neyman n_h', numeric: true, render: (r) => r.neyman.toLocaleString('en-US') },
                  ]}
                  rows={strata.value.sds.map((sd, h) => ({
                    sd,
                    weight: strata.value.proportional.weights[h],
                    proportional: strata.value.proportional.counts[h],
                    neyman: strata.value.neyman.counts[h],
                  }))}
                />
                <Notice tone="info" title="What each rule assumed" items={[strata.value.proportional.note, strata.value.neyman.note]} />
                {!strata.value.neymanWithoutSigma.ok && (
                  <Notice tone="warning" title="Asked for Neyman allocation without within-stratum standard deviations, the engine refuses" items={messagesOf(strata.value.neymanWithoutSigma)} />
                )}
                <Notice tone="info" title="How this relates to Latin hypercube sampling above">
                  <p style={{ margin: 0 }}>
                    Stratifying one coordinate removes the sampling variance of the part of the integrand that depends on that coordinate alone. A Latin
                    hypercube does that to every coordinate at once, which is why it appears in the comparison above and why its gain comes from the additive
                    main effects and not from interactions. The σ_h here are pilot estimates from {strata.value.pilot} draws per stratum, so the Neyman
                    allocation is optimal only conditional on them being right.
                  </p>
                </Notice>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
