/**
 * Combining several judges.
 *
 * Two experts who disagree present a choice that is usually made badly. The
 * two standard pools answer different questions and this file keeps them
 * apart:
 *
 *  LINEAR POOL   p̄(x) = Σ wᵢ pᵢ(x). A mixture. It PRESERVES DISAGREEMENT: two
 *                confident experts who disagree produce a wide, often bimodal
 *                result, which is the honest representation of "we do not know
 *                which of them is right". It is externally Bayesian only in
 *                trivial cases — updating the pool on new data is not the same
 *                as pooling the updated opinions — and it is not a
 *                distribution any single coherent agent holds.
 *
 *  LOG POOL      p̄(x) ∝ Π pᵢ(x)^wᵢ. A geometric mean. It is DECISIVE: it
 *                concentrates where the experts overlap and can be far
 *                narrower than any individual expert, which is badly
 *                overconfident whenever the experts are not independent
 *                sources. It IS externally Bayesian (pooling then updating
 *                equals updating then pooling, for weights summing to 1), and
 *                it assigns zero density anywhere an expert does, so one
 *                expert can veto a region.
 *
 * Cooke's classical method weighs experts by their measured performance on
 * seed questions whose answers are known. It is the established protocol in
 * the field. Equal weighting is reported next to it in every case, because
 * equal weighting frequently wins — especially with few seed questions — and
 * pretending otherwise would be exactly the unearned sophistication this
 * engine is supposed to refuse.
 */
import { EngineError, type Explanation } from '../core/result';
import { linspace, stableSum } from '../core/numeric';
import { solve } from '../stats/linalg';
import { getDistribution, summarize } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { judgementBasis, JUDGEMENT_EXACTNESS, type JudgementBasis, type JudgementExactness } from './types';

const CHI_SQUARE = getDistribution('chiSquare');

/* ------------------------------------------------------------------ */
/* Pools of parametric expert distributions                           */
/* ------------------------------------------------------------------ */

export interface ExpertDistribution {
  expert: string;
  distributionId: string;
  params: Params;
}

export type PoolKind = 'linear' | 'logarithmic';

export const POOL_COMPARISON_NOTE: readonly string[] = [
  'A LINEAR pool is a mixture. It preserves disagreement: its spread is at least as wide as the widest expert, and it is multimodal when the experts cluster apart. Its variance includes the between-expert variance, so it answers "what should I believe, not knowing which expert is right".',
  'A LOGARITHMIC pool is a geometric mean. It concentrates on the overlap and can be NARROWER THAN ANY SINGLE EXPERT, which is only justified if the experts are independent sources of evidence. For experts who read the same papers, it fabricates confidence.',
  'The log pool is externally Bayesian (pool-then-update equals update-then-pool) and the linear pool is not. The linear pool satisfies the marginalisation property and the log pool does not. Neither dominates; they answer different questions.',
  'The log pool gives zero density wherever ANY expert gives zero density, so a single expert can veto a region. That is a feature if their support claim is reliable and a catastrophe if it is not.',
  'Both reduce to the common distribution when every expert states the same one, which is the only case in which they agree.',
];

export interface PoolResult {
  kind: PoolKind;
  experts: string[];
  weights: { expert: string; weight: number }[];
  grid: number[];
  density: number[];
  cdf: number[];
  mean: number;
  variance: number;
  sd: number;
  quantiles: { level: number; value: number }[];
  /** Interior local maxima of the pooled density. */
  modes: number[];
  multimodal: boolean;
  /** sd of the pool divided by the largest individual expert sd. > 1 means wider than anyone. */
  spreadRatioToWidestExpert: number;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

export interface PoolOptions {
  /** One weight per expert, in order. Default: equal. */
  weights?: readonly number[];
  grid?: { min: number; max: number; points?: number };
  /** Quantile levels to report. Default 0.05, 0.25, 0.5, 0.75, 0.95. */
  levels?: readonly number[];
}

function validateExperts(experts: readonly ExpertDistribution[]): void {
  if (experts.length === 0) {
    throw new EngineError(
      'No experts were supplied. A pool of zero opinions is not a distribution, and returning a uniform or a ' +
        'point value in its place would invent a judgement nobody made.',
      'empty',
    );
  }
  const names = new Set<string>();
  experts.forEach((e, i) => {
    if (names.has(e.expert)) {
      throw new EngineError(`The expert "${e.expert}" appears twice; counting one opinion twice inflates its weight.`, 'duplicate');
    }
    names.add(e.expert);
    const def = getDistribution(e.distributionId);
    if (def.kind === 'discrete') {
      throw new EngineError(
        `Expert "${e.expert}" (index ${i}) supplied the discrete distribution "${def.id}". These pools operate on ` +
          'densities over a continuous grid; pool discrete judgements as probability vectors instead.',
        'discrete',
      );
    }
  });
}

function resolveWeights(experts: readonly ExpertDistribution[], weights: readonly number[] | undefined): { w: number[]; warnings: string[] } {
  const n = experts.length;
  const warnings: string[] = [];
  if (!weights) return { w: new Array<number>(n).fill(1 / n), warnings };
  if (weights.length !== n) {
    throw new EngineError(`There are ${n} experts but ${weights.length} weights.`, 'length');
  }
  weights.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new EngineError(`Weight ${i} (expert "${experts[i].expert}") is ${String(v)}.`, 'finite');
    if (v < 0) {
      throw new EngineError(
        `Weight ${i} (expert "${experts[i].expert}") is ${v}, which is negative. A negative weight subtracts an ` +
          'opinion and does not produce a distribution.',
        'range',
      );
    }
  });
  const total = stableSum(weights);
  if (total <= 0) {
    throw new EngineError(
      'Every weight is 0, so no expert contributes anything and no pool exists. If the intention was to exclude ' +
        'every expert, there is no aggregate to report.',
      'degenerate',
    );
  }
  if (Math.abs(total - 1) > 1e-12) {
    warnings.push(
      `The supplied weights summed to ${total.toPrecision(10)} and have been divided by that total to sum to 1. ` +
        `The normalised weights are ${weights.map((v, i) => `${experts[i].expert}: ${(v / total).toPrecision(6)}`).join(', ')}.`,
    );
  }
  return { w: weights.map((v) => v / total), warnings };
}

function defaultGrid(experts: readonly ExpertDistribution[], points: number): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of experts) {
    const def = getDistribution(e.distributionId);
    const a = def.quantile(1e-4, e.params);
    const b = def.quantile(1 - 1e-4, e.params);
    if (Number.isFinite(a)) lo = Math.min(lo, a);
    if (Number.isFinite(b)) hi = Math.max(hi, b);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) {
    throw new EngineError(
      'A common grid could not be formed from these experts: their 0.0001 and 0.9999 quantiles are not finite, or ' +
        'coincide. Supply an explicit grid range.',
      'numerical',
    );
  }
  const pad = (hi - lo) * 0.15;
  return linspace(lo - pad, hi + pad, points);
}

/** Trapezoidal integral of y over the (possibly uneven) grid x. */
function trapezoid(x: readonly number[], y: readonly number[]): number {
  const terms: number[] = [];
  for (let i = 1; i < x.length; i++) terms.push(((y[i] + y[i - 1]) / 2) * (x[i] - x[i - 1]));
  return stableSum(terms);
}

function cumulativeTrapezoid(x: readonly number[], y: readonly number[]): number[] {
  const out = new Array<number>(x.length).fill(0);
  for (let i = 1; i < x.length; i++) out[i] = out[i - 1] + ((y[i] + y[i - 1]) / 2) * (x[i] - x[i - 1]);
  return out;
}

function quantileFromGrid(x: readonly number[], cdf: readonly number[], level: number): number {
  if (level <= cdf[0]) return x[0];
  const last = cdf.length - 1;
  if (level >= cdf[last]) return x[last];
  let k = 1;
  while (k <= last && cdf[k] < level) k++;
  const span = cdf[k] - cdf[k - 1];
  const t = span > 0 ? (level - cdf[k - 1]) / span : 0;
  return x[k - 1] + t * (x[k] - x[k - 1]);
}

function findModes(x: readonly number[], y: readonly number[]): number[] {
  const peak = Math.max(...y);
  if (!(peak > 0)) return [];
  const modes: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    // A local maximum, at least 2% of the peak so that numerical ripple in the
    // far tail is not reported as a mode.
    if (y[i] >= y[i - 1] && y[i] > y[i + 1] && y[i] > peak * 0.02) modes.push(x[i]);
  }
  // Merge peaks closer together than 1% of the grid span: one bump sampled on
  // a fine grid can register as several.
  const minGap = (x[x.length - 1] - x[0]) * 0.01;
  const merged: number[] = [];
  for (const m of modes) {
    if (merged.length === 0 || m - merged[merged.length - 1] > minGap) merged.push(m);
  }
  return merged;
}

function buildPool(
  kind: PoolKind,
  experts: readonly ExpertDistribution[],
  options: PoolOptions,
): PoolResult {
  validateExperts(experts);
  const { w, warnings: weightWarnings } = resolveWeights(experts, options.weights);
  const points = options.grid?.points ?? 2001;
  if (!Number.isInteger(points) || points < 51) {
    throw new EngineError(`The grid needs a whole number of at least 51 points; got ${points}.`, 'integer');
  }
  let grid: number[];
  if (options.grid) {
    if (!Number.isFinite(options.grid.min) || !Number.isFinite(options.grid.max)) {
      throw new EngineError('An explicit grid needs finite min and max.', 'finite');
    }
    if (!(options.grid.max > options.grid.min)) {
      throw new EngineError(`The grid range [${options.grid.min}, ${options.grid.max}] is empty.`, 'range');
    }
    grid = linspace(options.grid.min, options.grid.max, points);
  } else {
    grid = defaultGrid(experts, points);
  }
  const defs = experts.map((e) => getDistribution(e.distributionId));
  const densities = experts.map((e, i) => grid.map((x) => {
    const d = defs[i].pdf(x, e.params);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }));

  let raw: number[];
  if (kind === 'linear') {
    raw = grid.map((_x, j) => stableSum(densities.map((d, i) => w[i] * d[j])));
  } else {
    raw = grid.map((_x, j) => {
      let logSum = 0;
      for (let i = 0; i < experts.length; i++) {
        if (w[i] === 0) continue;
        const d = densities[i][j];
        if (!(d > 0)) return 0;
        logSum += w[i] * Math.log(d);
      }
      return Math.exp(logSum);
    });
  }
  const mass = trapezoid(grid, raw);
  if (!(mass > 0) || !Number.isFinite(mass)) {
    throw new EngineError(
      kind === 'logarithmic'
        ? 'The logarithmic pool is undefined: there is no point on the grid where EVERY expert places positive ' +
          'density, so the geometric mean is 0 everywhere. The experts’ supports are effectively disjoint, which ' +
          'means they disagree about what is possible, not merely about what is likely. A linear pool is the ' +
          'appropriate aggregate for that disagreement.'
        : 'The pooled density integrates to 0 over the grid, so it cannot be normalised. Widen the grid range.',
      'degenerate',
    );
  }
  const density = raw.map((v) => v / mass);
  const cdf = cumulativeTrapezoid(grid, density);
  const mean = trapezoid(grid, grid.map((x, j) => x * density[j]));
  const variance = trapezoid(grid, grid.map((x, j) => (x - mean) ** 2 * density[j]));
  const levels = options.levels ?? [0.05, 0.25, 0.5, 0.75, 0.95];
  levels.forEach((l) => {
    if (!(l > 0 && l < 1)) throw new EngineError(`Quantile level ${l} is outside (0, 1).`, 'range');
  });
  const modes = findModes(grid, density);
  const expertSds = experts.map((e, i) => {
    const s = summarize(defs[i], e.params);
    return s.sd.defined ? s.sd.value : NaN;
  });
  const widest = Math.max(...expertSds.filter((v) => Number.isFinite(v)));
  const sd = Math.sqrt(variance);

  const warnings = [...weightWarnings];
  const tailMass = 1 - cdf[cdf.length - 1];
  if (Math.abs(tailMass) > 1e-6) {
    warnings.push(
      `The grid captures ${(cdf[cdf.length - 1] * 100).toPrecision(6)}% of the pooled density after normalisation; ` +
        `${Math.abs(tailMass).toPrecision(3)} is outside it. Every quantile below is conditional on that truncation.`,
    );
  }
  if (kind === 'logarithmic') {
    if (Number.isFinite(widest) && sd < Math.min(...expertSds.filter((v) => Number.isFinite(v)))) {
      warnings.push(
        `The logarithmic pool (sd ${sd.toPrecision(5)}) is NARROWER THAN EVERY INDIVIDUAL EXPERT (narrowest ` +
          `${Math.min(...expertSds.filter((v) => Number.isFinite(v))).toPrecision(5)}). That is only defensible if the ` +
          'experts are independent sources of evidence. If they share data, training or literature, this ' +
          'confidence is fabricated — use a linear pool or model the correlation explicitly.',
      );
    }
    const zeroes = density.filter((v) => v === 0).length;
    if (zeroes > 0) {
      warnings.push(
        `${zeroes} of ${grid.length} grid points received zero density because at least one expert excluded them. ` +
          'In a logarithmic pool a single expert can veto a region, which is a very strong consequence of one ' +
          'opinion about the support.',
      );
    }
  }
  if (kind === 'linear' && modes.length > 1) {
    warnings.push(
      `The linear pool is multimodal with ${modes.length} modes (at ${modes.map((m) => m.toPrecision(5)).join(', ')}). ` +
        'That is the correct representation of experts who disagree: the mean of this pool falls between the modes, ' +
        'in a region every expert considers unlikely, and should not be reported as "the answer".',
    );
  }

  return {
    kind,
    experts: experts.map((e) => e.expert),
    weights: experts.map((e, i) => ({ expert: e.expert, weight: w[i] })),
    grid,
    density,
    cdf,
    mean,
    variance,
    sd,
    quantiles: levels.map((level) => ({ level, value: quantileFromGrid(grid, cdf, level) })),
    modes,
    multimodal: modes.length > 1,
    spreadRatioToWidestExpert: Number.isFinite(widest) && widest > 0 ? sd / widest : NaN,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      kind === 'linear' ? 'Linear opinion pool (weighted mixture of the experts’ densities)' : 'Logarithmic opinion pool (weighted geometric mean of the experts’ densities)',
      `${experts.length} distributions asserted by ${experts.length} judges: ${experts.map((e) => `${e.expert} → ${e.distributionId}`).join(', ')}`,
      [
        ...POOL_COMPARISON_NOTE,
        `Weights used: ${experts.map((e, i) => `${e.expert} ${w[i].toPrecision(4)}`).join(', ')}${options.weights ? '' : ' (equal, because none were supplied)'}.`,
      ],
    ),
    explanation: {
      method: kind === 'linear' ? 'Linear opinion pool' : 'Logarithmic opinion pool',
      formula: kind === 'linear' ? 'p̄(x) = Σ wᵢ pᵢ(x)' : 'p̄(x) ∝ Π pᵢ(x)^wᵢ, normalised numerically over the grid',
      steps: [
        { label: 'Experts', value: experts.map((e) => `${e.expert} (${e.distributionId})`).join('; ') },
        { label: 'Weights', value: experts.map((e, i) => `${e.expert} = ${w[i].toPrecision(6)}`).join('; ') },
        { label: 'Grid', value: `${grid.length} points over [${grid[0].toPrecision(6)}, ${grid[grid.length - 1].toPrecision(6)}]` },
        { label: 'Normalising constant', value: mass.toPrecision(10) },
        { label: 'Pooled mean', value: mean.toPrecision(8) },
        { label: 'Pooled sd', value: sd.toPrecision(8) },
        { label: 'Individual expert sds', value: experts.map((e, i) => `${e.expert} = ${Number.isFinite(expertSds[i]) ? expertSds[i].toPrecision(6) : 'undefined'}`).join('; ') },
        { label: 'Modes', value: modes.length ? modes.map((m) => m.toPrecision(6)).join(', ') : 'one or none detected' },
      ],
      assumptions: [
        kind === 'linear'
          ? 'The weights are the probability that each expert is the one to listen to, or a judgement of relative credibility. A mixture is not a distribution any single expert holds.'
          : 'The experts are treated as independent sources of evidence, which is what makes a geometric mean appropriate and is almost never true of experts in one field.',
      ],
      limitations: [
        'The pool is computed on a finite grid, so the far tails are truncated and the quantiles are accurate to the grid resolution.',
        'Aggregation cannot create information. A confident pool from two guesses is still two guesses.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/** Linear opinion pool: a weighted mixture, which preserves disagreement. */
export function linearPool(experts: readonly ExpertDistribution[], options: PoolOptions = {}): PoolResult {
  return buildPool('linear', experts, options);
}

/** Logarithmic opinion pool: a weighted geometric mean, which is decisive and can be overconfident. */
export function logarithmicPool(experts: readonly ExpertDistribution[], options: PoolOptions = {}): PoolResult {
  return buildPool('logarithmic', experts, options);
}

export interface PoolComparison {
  linear: PoolResult;
  logarithmic: PoolResult;
  /** sd of the linear pool divided by sd of the log pool. > 1 means the linear pool is wider. */
  sdRatio: number;
  /** True when the two pools differ enough that the choice between them matters. */
  choiceMatters: boolean;
  note: readonly string[];
  exactness: JudgementExactness;
  basis: JudgementBasis;
  warnings: string[];
}

/**
 * Both pools of the same experts, side by side.
 *
 * The right one to report depends on a question the arithmetic cannot answer:
 * are these experts independent sources of evidence, or several readings of the
 * same evidence? The comparison makes the size of that decision visible.
 */
export function comparePools(experts: readonly ExpertDistribution[], options: PoolOptions = {}): PoolComparison {
  const linear = linearPool(experts, options);
  const logarithmic = logarithmicPool(experts, options);
  const sdRatio = logarithmic.sd > 0 ? linear.sd / logarithmic.sd : Infinity;
  const choiceMatters = !Number.isFinite(sdRatio) || sdRatio > 1.1 || Math.abs(linear.mean - logarithmic.mean) > 0.1 * linear.sd;
  const warnings = [...linear.warnings, ...logarithmic.warnings];
  if (choiceMatters) {
    warnings.push(
      `The two pools differ materially: the linear pool has sd ${linear.sd.toPrecision(5)} and the logarithmic pool ` +
        `${logarithmic.sd.toPrecision(5)}, a ratio of ${Number.isFinite(sdRatio) ? sdRatio.toPrecision(4) : '∞'}. ` +
        'The choice between them is a substantive assumption about whether the experts are independent sources, ' +
        'not a technical detail.',
    );
  }
  return {
    linear,
    logarithmic,
    sdRatio,
    choiceMatters,
    note: POOL_COMPARISON_NOTE,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Linear and logarithmic opinion pools of the same experts, compared',
      `${experts.length} distributions asserted by ${experts.length} judges`,
      POOL_COMPARISON_NOTE,
    ),
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Cooke's classical method                                           */
/* ------------------------------------------------------------------ */

/** A piecewise-uniform density on a finite range: Cooke's minimally-informative expert. */
interface PiecewiseUniform {
  /** m+1 breakpoints, strictly increasing. */
  edges: number[];
  /** m probabilities, summing to 1. */
  probs: number[];
}

function pwDensity(pw: PiecewiseUniform, x: number): number {
  for (let i = 0; i < pw.probs.length; i++) {
    if (x >= pw.edges[i] && x <= pw.edges[i + 1]) {
      const w = pw.edges[i + 1] - pw.edges[i];
      return w > 0 ? pw.probs[i] / w : 0;
    }
  }
  return 0;
}

function pwQuantile(pw: PiecewiseUniform, p: number): number {
  let acc = 0;
  for (let i = 0; i < pw.probs.length; i++) {
    if (acc + pw.probs[i] >= p) {
      const w = pw.edges[i + 1] - pw.edges[i];
      const share = pw.probs[i] > 0 ? (p - acc) / pw.probs[i] : 0;
      return pw.edges[i] + share * w;
    }
    acc += pw.probs[i];
  }
  return pw.edges[pw.edges.length - 1];
}

/** Relative information of a piecewise-uniform density against the uniform on the same range. */
function pwRelativeInformation(pw: PiecewiseUniform): number {
  const total = pw.edges[pw.edges.length - 1] - pw.edges[0];
  const terms: number[] = [];
  for (let i = 0; i < pw.probs.length; i++) {
    const p = pw.probs[i];
    if (p <= 0) continue;
    const background = (pw.edges[i + 1] - pw.edges[i]) / total;
    terms.push(p * Math.log(p / background));
  }
  return stableSum(terms);
}

/** Weighted linear pool of piecewise-uniform densities, itself piecewise uniform. */
function pwLinearPool(parts: readonly PiecewiseUniform[], weights: readonly number[]): PiecewiseUniform {
  const edgeSet = new Set<number>();
  for (const p of parts) for (const e of p.edges) edgeSet.add(e);
  const edges = [...edgeSet].sort((a, b) => a - b);
  const probs: number[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const mid = (edges[i] + edges[i + 1]) / 2;
    const width = edges[i + 1] - edges[i];
    probs.push(stableSum(parts.map((p, k) => weights[k] * pwDensity(p, mid))) * width);
  }
  const total = stableSum(probs);
  return { edges, probs: total > 0 ? probs.map((v) => v / total) : probs };
}

export interface SeedAssessment {
  question: string;
  /** The expert's stated quantiles for this seed question, at the common levels. */
  values: readonly number[];
}

export interface ExpertSeedRecord {
  expert: string;
  assessments: readonly SeedAssessment[];
}

export interface CookeExpertScore {
  expert: string;
  /**
   * Calibration score: the p-value of a likelihood-ratio test that the
   * realisations fall into the inter-quantile bins at the stated rates. In
   * [0, 1]; higher is better, and it is NOT a probability that the expert is
   * good.
   */
  calibration: number;
  /** 2·N·I(s, p): the test statistic the calibration score is the tail of. */
  calibrationStatistic: number;
  /** Realised fraction of seeds falling in each inter-quantile bin. */
  realisedBinFractions: number[];
  /** The rates the stated quantiles imply for those bins. */
  nominalBinProbabilities: number[];
  /** Mean relative information against a uniform background, in nats. Higher is sharper. */
  information: number;
  /** calibration × information, before normalisation. */
  unnormalisedWeight: number;
  /** Normalised performance weight. */
  performanceWeight: number;
  /** 1/number-of-experts, the benchmark. */
  equalWeight: number;
  /** Set when the expert was excluded by the significance cutoff. */
  excludedBy?: string;
}

export interface CookeResult {
  experts: CookeExpertScore[];
  levels: number[];
  seedQuestions: string[];
  /** The intrinsic (background) range used per seed question. */
  backgroundRanges: { question: string; lower: number; upper: number }[];
  /** Cooke's own score for the performance-weighted decision maker, treated as a virtual expert. */
  performanceWeightedDecisionMaker: { calibration: number; information: number; combined: number };
  /** The same for the equally-weighted decision maker: the benchmark. */
  equallyWeightedDecisionMaker: { calibration: number; information: number; combined: number };
  /** Which decision maker scored better on the SEED questions (in-sample). */
  inSampleWinner: 'performance' | 'equal' | 'tie';
  significanceLevel: number;
  overshoot: number;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

interface CookeInternals {
  levels: number[];
  binProbabilities: number[];
  perQuestion: {
    question: string;
    lower: number;
    upper: number;
    realisation: number;
    byExpert: PiecewiseUniform[];
  }[];
}

function binProbabilitiesFor(levels: readonly number[]): number[] {
  const p: number[] = [levels[0]];
  for (let i = 1; i < levels.length; i++) p.push(levels[i] - levels[i - 1]);
  p.push(1 - levels[levels.length - 1]);
  return p;
}

function prepareCooke(
  experts: readonly ExpertSeedRecord[],
  realisations: readonly { question: string; value: number }[],
  levels: readonly number[],
  overshoot: number,
): CookeInternals {
  if (experts.length === 0) {
    throw new EngineError(
      'No experts were supplied, so there is nothing to weigh. Cooke’s method requires at least one expert.',
      'empty',
    );
  }
  if (realisations.length === 0) {
    throw new EngineError(
      'No seed questions were supplied. Performance weighting is defined ONLY against questions whose answers are ' +
        'known: without seeds there is nothing to measure, and falling back to equal weights silently would hide ' +
        'that the "performance" weighting measured no performance. Supply seed questions, or use equal weights ' +
        'deliberately.',
      'no-seeds',
    );
  }
  levels.forEach((l, i) => {
    if (!(l > 0 && l < 1)) throw new EngineError(`Quantile level ${l} is outside (0, 1).`, 'range');
    if (i > 0 && !(l > levels[i - 1])) {
      throw new EngineError(`The quantile levels must be strictly increasing; ${levels[i - 1]} is followed by ${l}.`, 'non-monotone');
    }
  });
  if (levels.length < 2) {
    throw new EngineError(
      `Cooke's method needs at least 2 quantile levels per question to form inter-quantile bins; got ${levels.length}.`,
      'too-few',
    );
  }
  const names = new Set<string>();
  for (const e of experts) {
    if (names.has(e.expert)) throw new EngineError(`The expert "${e.expert}" appears twice.`, 'duplicate');
    names.add(e.expert);
  }
  const realisationMap = new Map(realisations.map((r) => [r.question, r.value]));
  if (realisationMap.size !== realisations.length) {
    throw new EngineError('A seed question appears twice in the realisations.', 'duplicate');
  }
  const questions = realisations.map((r) => r.question);
  const perQuestion: CookeInternals['perQuestion'] = [];
  for (const q of questions) {
    const realisation = realisationMap.get(q) as number;
    if (!Number.isFinite(realisation)) {
      throw new EngineError(`The realisation for seed question "${q}" is ${String(realisation)}.`, 'finite');
    }
    const stated: number[][] = [];
    for (const e of experts) {
      const a = e.assessments.find((x) => x.question === q);
      if (!a) {
        throw new EngineError(
          `Expert "${e.expert}" gave no assessment for the seed question "${q}". Cooke's method needs every expert ` +
            'to answer every seed question; a partial record makes the calibration scores incomparable.',
          'missing',
        );
      }
      if (a.values.length !== levels.length) {
        throw new EngineError(
          `Expert "${e.expert}" gave ${a.values.length} values for "${q}" but there are ${levels.length} quantile levels.`,
          'length',
        );
      }
      a.values.forEach((v, i) => {
        if (!Number.isFinite(v)) {
          throw new EngineError(`Expert "${e.expert}" gave the non-finite value ${String(v)} at level ${levels[i]} for "${q}".`, 'finite');
        }
        if (i > 0 && v < a.values[i - 1]) {
          throw new EngineError(
            `Expert "${e.expert}" is non-monotone on "${q}": level ${levels[i - 1]} was given ${a.values[i - 1]} but ` +
              `the higher level ${levels[i]} was given the smaller value ${v}. That pair must be corrected.`,
            'non-monotone',
          );
        }
      });
      stated.push([...a.values]);
    }
    const all = [...stated.flat(), realisation];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    if (!(hi > lo)) {
      throw new EngineError(
        `On seed question "${q}" every expert and the realisation give the same value ${lo}. The intrinsic range has ` +
          'zero width, so no background measure exists and no information score can be formed for this question.',
        'zero-width',
      );
    }
    const pad = (hi - lo) * overshoot;
    const lower = lo - pad;
    const upper = hi + pad;
    const binProbabilities = binProbabilitiesFor(levels);
    const byExpert = stated.map((values, k) => {
      const edges = [lower, ...values, upper];
      for (let i = 1; i < edges.length; i++) {
        if (!(edges[i] > edges[i - 1])) {
          // Two stated quantiles coincide: the expert asserts a point mass,
          // which has infinite density and no finite information score.
          throw new EngineError(
            `Expert "${experts[k].expert}" gave the same value ${edges[i]} at two adjacent quantile levels on "${q}", ` +
              'so the inter-quantile interval has zero width. That asserts a point mass, whose density is infinite ' +
              'and whose information score is undefined. Re-elicit that question.',
            'zero-width',
          );
        }
      }
      return { edges, probs: [...binProbabilities] };
    });
    perQuestion.push({ question: q, lower, upper, realisation, byExpert });
  }
  return { levels: [...levels], binProbabilities: binProbabilitiesFor(levels), perQuestion };
}

function scoreVirtualExpert(
  distributions: readonly PiecewiseUniform[],
  realisations: readonly number[],
  levels: readonly number[],
  binProbabilities: readonly number[],
): { calibration: number; statistic: number; realisedBinFractions: number[]; information: number } {
  const n = distributions.length;
  const bins = binProbabilities.length;
  const counts = new Array<number>(bins).fill(0);
  for (let k = 0; k < n; k++) {
    const pw = distributions[k];
    const y = realisations[k];
    const edges = [pw.edges[0], ...levels.map((l) => pwQuantile(pw, l)), pw.edges[pw.edges.length - 1]];
    let bin = bins - 1;
    for (let j = 0; j < bins; j++) {
      if (y <= edges[j + 1]) {
        bin = j;
        break;
      }
    }
    counts[bin] += 1;
  }
  const s = counts.map((c) => c / n);
  // I(s ‖ p) in nats; the 0 ln 0 term is 0.
  const relative = stableSum(s.map((v, j) => (v > 0 ? v * Math.log(v / binProbabilities[j]) : 0)));
  const statistic = 2 * n * relative;
  const calibrationScore = CHI_SQUARE.sf(statistic, { k: bins - 1 });
  const information = stableSum(distributions.map(pwRelativeInformation)) / n;
  return { calibration: calibrationScore, statistic, realisedBinFractions: s, information };
}

export interface CookeOptions {
  /** The quantile levels every expert answered at. Default [0.05, 0.5, 0.95]. */
  levels?: readonly number[];
  /** Experts with a calibration score below this get zero weight. Default 0 (nobody excluded). */
  significanceLevel?: number;
  /** Fraction of the intrinsic span added at each end for the background measure. Default 0.1. */
  overshoot?: number;
}

/**
 * Cooke's classical model: weigh experts by their measured calibration and
 * informativeness on seed questions whose answers are known.
 *
 * The calibration score is the p-value of a likelihood-ratio test that the
 * realisations fall into the expert's inter-quantile bins at the stated rates
 * (statistic 2·N·I(s‖p), compared with χ² on bins−1 degrees of freedom). The
 * information score is the mean relative information of the expert's
 * minimally-informative (piecewise-uniform) distribution against a uniform
 * background over each question's intrinsic range. The weight is their product,
 * which is a strictly proper scoring rule for the expert as a whole.
 *
 * EQUAL WEIGHTS ARE REPORTED ALONGSIDE, ALWAYS. Performance weighting does not
 * reliably beat equal weighting, and with few seed questions it reliably loses,
 * because the calibration score is then estimated from a handful of hits and
 * misses. `crossValidateWeighting` measures that directly.
 */
export function cookeClassicalMethod(
  experts: readonly ExpertSeedRecord[],
  realisations: readonly { question: string; value: number }[],
  options: CookeOptions = {},
): CookeResult {
  const levels = options.levels ?? [0.05, 0.5, 0.95];
  const significanceLevel = options.significanceLevel ?? 0;
  if (!(significanceLevel >= 0 && significanceLevel < 1)) {
    throw new EngineError(`significanceLevel must lie in [0, 1); got ${significanceLevel}.`, 'range');
  }
  const overshoot = options.overshoot ?? 0.1;
  if (!(overshoot >= 0 && overshoot <= 1)) {
    throw new EngineError(`overshoot must lie in [0, 1]; got ${overshoot}.`, 'range');
  }
  const internals = prepareCooke(experts, realisations, levels, overshoot);
  const n = internals.perQuestion.length;
  const realisationValues = internals.perQuestion.map((q) => q.realisation);

  const scores: CookeExpertScore[] = experts.map((e, i) => {
    const dists = internals.perQuestion.map((q) => q.byExpert[i]);
    const s = scoreVirtualExpert(dists, realisationValues, internals.levels, internals.binProbabilities);
    const excluded = s.calibration < significanceLevel;
    return {
      expert: e.expert,
      calibration: s.calibration,
      calibrationStatistic: s.statistic,
      realisedBinFractions: s.realisedBinFractions,
      nominalBinProbabilities: [...internals.binProbabilities],
      information: s.information,
      unnormalisedWeight: excluded ? 0 : s.calibration * s.information,
      performanceWeight: 0,
      equalWeight: 1 / experts.length,
      excludedBy: excluded
        ? `Calibration score ${s.calibration.toPrecision(4)} is below the significance cutoff ${significanceLevel}, so this expert receives zero weight.`
        : undefined,
    };
  });
  const totalWeight = stableSum(scores.map((s) => s.unnormalisedWeight));
  const warnings: string[] = [];
  if (!(totalWeight > 0)) {
    throw new EngineError(
      `Every expert's performance weight is 0: ${scores
        .map((s) => `${s.expert} has calibration ${s.calibration.toExponential(3)} and information ${s.information.toPrecision(4)}`)
        .join('; ')}. No performance-weighted combination exists. Either every expert is statistically rejected at ` +
        `the significance level ${significanceLevel}, or the information scores are 0. Use equal weights ` +
        'deliberately and say so, rather than letting a degenerate weighting pass as a performance weighting.',
      'degenerate',
    );
  }
  scores.forEach((s) => {
    s.performanceWeight = s.unnormalisedWeight / totalWeight;
  });

  const perfWeights = scores.map((s) => s.performanceWeight);
  const equalWeights = scores.map(() => 1 / experts.length);
  const perfDm = internals.perQuestion.map((q) => pwLinearPool(q.byExpert, perfWeights));
  const equalDm = internals.perQuestion.map((q) => pwLinearPool(q.byExpert, equalWeights));
  const perfScore = scoreVirtualExpert(perfDm, realisationValues, internals.levels, internals.binProbabilities);
  const equalScore = scoreVirtualExpert(equalDm, realisationValues, internals.levels, internals.binProbabilities);
  const perfCombined = perfScore.calibration * perfScore.information;
  const equalCombined = equalScore.calibration * equalScore.information;
  const inSampleWinner: CookeResult['inSampleWinner'] =
    Math.abs(perfCombined - equalCombined) < 1e-12 ? 'tie' : perfCombined > equalCombined ? 'performance' : 'equal';

  if (n < 8) {
    warnings.push(
      `Only ${n} seed question${n === 1 ? '' : 's'} were used. A calibration score from ${n} realisations spread over ` +
        `${internals.binProbabilities.length} bins is almost pure noise: with a 5%/45%/45%/5% bin structure the two ` +
        'outer bins expect ' +
        `${(n * internals.binProbabilities[0]).toPrecision(3)} and ${(n * internals.binProbabilities[internals.binProbabilities.length - 1]).toPrecision(3)} ` +
        'realisations respectively, so one lucky or unlucky question moves an expert’s weight enormously. Cooke’s ' +
        'own practice uses on the order of 10 seed questions as a minimum and more where possible. Prefer equal ' +
        'weights at this seed count unless cross-validation says otherwise.',
    );
  }
  warnings.push(
    `In-sample on the seed questions the ${inSampleWinner === 'tie' ? 'two decision makers scored equally' : `${inSampleWinner}-weighted decision maker scored better`} ` +
      `(performance ${perfCombined.toPrecision(4)} vs equal ${equalCombined.toPrecision(4)}). THIS IS IN-SAMPLE: the ` +
      'performance weights were chosen using these same realisations, so they are favoured by construction. Use ' +
      'crossValidateWeighting for the comparison that means something.',
  );
  const excluded = scores.filter((s) => s.excludedBy);
  if (excluded.length) {
    warnings.push(
      `${excluded.length} expert(s) received zero weight at the significance cutoff ${significanceLevel}: ` +
        `${excluded.map((s) => s.expert).join(', ')}. Excluding an expert on ${n} seed questions is a strong act on weak evidence.`,
    );
  }

  return {
    experts: scores,
    levels: internals.levels,
    seedQuestions: internals.perQuestion.map((q) => q.question),
    backgroundRanges: internals.perQuestion.map((q) => ({ question: q.question, lower: q.lower, upper: q.upper })),
    performanceWeightedDecisionMaker: { calibration: perfScore.calibration, information: perfScore.information, combined: perfCombined },
    equallyWeightedDecisionMaker: { calibration: equalScore.calibration, information: equalScore.information, combined: equalCombined },
    inSampleWinner,
    significanceLevel,
    overshoot,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Cooke’s classical method: performance weights from calibration and information on seed questions',
      `${experts.length} experts' quantile judgements on ${n} seed questions whose answers are known, at the levels ${internals.levels.join(', ')}`,
      [
        'The weights are measured on the seed questions and assumed to transfer to the questions of interest. That assumption is the method’s main weakness and cannot be checked from the seeds.',
        'A calibration score is a p-value, not a probability that the expert is good. An expert with a score of 0.3 has not been shown to be miscalibrated; they have not been shown to be calibrated either.',
        'EQUAL WEIGHTING IS THE BENCHMARK and frequently beats performance weighting. Both are reported here for that reason.',
        `Seed count: ${n}. Below about 10 seeds the calibration score is dominated by noise.`,
      ],
    ),
    explanation: {
      method: 'Cooke’s classical model (performance-based linear pooling)',
      formula: 'weight_i ∝ C_i · I_i, with C_i = P(χ²_{B−1} > 2N·I(s_i ‖ p)) and I_i = mean relative information against the uniform background',
      steps: [
        { label: 'Seed questions', value: `${n}: ${internals.perQuestion.map((q) => q.question).join(', ')}` },
        { label: 'Quantile levels', value: internals.levels.join(', ') },
        { label: 'Inter-quantile bin probabilities', value: internals.binProbabilities.map((p) => p.toPrecision(4)).join(', ') },
        ...scores.map((s) => ({
          label: s.expert,
          value:
            `calibration ${s.calibration.toPrecision(5)} (statistic ${s.calibrationStatistic.toPrecision(5)}, realised ` +
            `bins ${s.realisedBinFractions.map((v) => v.toPrecision(3)).join('/')}), information ${s.information.toPrecision(5)} nats, ` +
            `performance weight ${s.performanceWeight.toPrecision(5)} vs equal weight ${s.equalWeight.toPrecision(5)}`,
        })),
        { label: 'Performance-weighted decision maker', value: `calibration ${perfScore.calibration.toPrecision(5)}, information ${perfScore.information.toPrecision(5)}, combined ${perfCombined.toPrecision(5)}` },
        { label: 'Equally-weighted decision maker (benchmark)', value: `calibration ${equalScore.calibration.toPrecision(5)}, information ${equalScore.information.toPrecision(5)}, combined ${equalCombined.toPrecision(5)}` },
        { label: 'In-sample winner', value: inSampleWinner },
      ],
      assumptions: [
        'Every expert answered every seed question at the same quantile levels.',
        'Each expert’s distribution is the minimally-informative one consistent with their stated quantiles: piecewise uniform between them.',
        'The seed questions are representative of the questions of interest, so that measured performance transfers.',
      ],
      limitations: [
        'The calibration score is a p-value from a χ² approximation that is poor when the expected bin counts are small, which is exactly the situation with few seeds.',
        'The intrinsic range depends on the overshoot parameter, and the information scores move with it. It is reported for that reason.',
        'In-sample comparison of the two decision makers favours performance weighting by construction.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

export interface CrossValidationResult {
  /** Mean out-of-sample logarithmic score (lower is better) of each scheme, in nats. */
  performanceWeighted: number;
  equalWeighted: number;
  /** Per-expert mean out-of-sample log score, so a single good expert is visible. */
  individualExperts: { expert: string; meanLogScore: number }[];
  /** Which scheme generalised better. */
  winner: 'performance' | 'equal' | 'tie';
  /** equalWeighted − performanceWeighted. Positive means performance weighting won. */
  advantage: number;
  folds: number;
  verdict: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Leave-one-seed-out comparison of performance weighting against equal
 * weighting.
 *
 * For each seed question in turn, the performance weights are computed from the
 * OTHER seeds and the resulting decision maker is scored on the held-out one by
 * the logarithmic score (−ln of the pooled density at what actually happened).
 * Equal weighting needs no fitting and so is scored on the same held-out
 * questions directly.
 *
 * This is the comparison that matters. In-sample, performance weighting wins by
 * construction; out of sample, with few seeds, it frequently loses, because the
 * weights are fitted to a handful of hits and misses. Reporting only the
 * in-sample comparison is how performance weighting acquired a better
 * reputation than it has earned.
 */
export function crossValidateWeighting(
  experts: readonly ExpertSeedRecord[],
  realisations: readonly { question: string; value: number }[],
  options: CookeOptions = {},
): CrossValidationResult {
  const levels = options.levels ?? [0.05, 0.5, 0.95];
  const overshoot = options.overshoot ?? 0.1;
  const significanceLevel = options.significanceLevel ?? 0;
  if (realisations.length < 2) {
    throw new EngineError(
      `Leave-one-out cross-validation needs at least 2 seed questions; got ${realisations.length}. With one seed ` +
        'there is no training set left after holding it out.',
      'too-few',
    );
  }
  const internals = prepareCooke(experts, realisations, levels, overshoot);
  const n = internals.perQuestion.length;
  const perfScores: number[] = [];
  const equalScores: number[] = [];
  const individual: number[][] = experts.map(() => []);
  const equalWeights = experts.map(() => 1 / experts.length);
  let degenerateFolds = 0;

  for (let held = 0; held < n; held++) {
    const trainIndices = internals.perQuestion.map((_q, i) => i).filter((i) => i !== held);
    const trainRealisations = trainIndices.map((i) => internals.perQuestion[i].realisation);
    const unnormalised = experts.map((_e, k) => {
      const dists = trainIndices.map((i) => internals.perQuestion[i].byExpert[k]);
      const s = scoreVirtualExpert(dists, trainRealisations, internals.levels, internals.binProbabilities);
      return s.calibration < significanceLevel ? 0 : s.calibration * s.information;
    });
    const total = stableSum(unnormalised);
    let weights: number[];
    if (total > 0) weights = unnormalised.map((v) => v / total);
    else {
      // Every trained weight is 0 on this fold. Falling back to equal weights
      // here would make the two schemes identical on this fold and bias the
      // comparison, so the fold is counted and skipped for the performance
      // scheme only.
      degenerateFolds++;
      weights = [];
    }
    const q = internals.perQuestion[held];
    const y = q.realisation;
    const equalPool = pwLinearPool(q.byExpert, equalWeights);
    const equalDensity = pwDensity(equalPool, y);
    if (!(equalDensity > 0)) {
      throw new EngineError(
        `On the held-out seed question "${q.question}" the equally weighted pool gives zero density at the ` +
          `realisation ${y}. The logarithmic score is infinite and no comparison can be made. This happens when the ` +
          'realisation falls outside every expert’s stated range AND outside the overshoot; raise `overshoot`.',
        'degenerate',
      );
    }
    equalScores.push(-Math.log(equalDensity));
    if (weights.length) {
      const perfPool = pwLinearPool(q.byExpert, weights);
      const perfDensity = pwDensity(perfPool, y);
      if (perfDensity > 0) perfScores.push(-Math.log(perfDensity));
      else {
        // One expert carries all the weight and excludes the realisation.
        perfScores.push(Infinity);
      }
    }
    experts.forEach((_e, k) => {
      const d = pwDensity(q.byExpert[k], y);
      individual[k].push(d > 0 ? -Math.log(d) : Infinity);
    });
  }
  if (perfScores.length === 0) {
    throw new EngineError(
      'Every cross-validation fold produced a degenerate performance weighting (all weights 0), so performance ' +
        'weighting could not be evaluated out of sample at all. That is itself the finding: with this many seed ' +
        'questions the method has nothing to work with.',
      'degenerate',
    );
  }
  const meanOf = (xs: readonly number[]): number =>
    xs.some((v) => !Number.isFinite(v)) ? Infinity : stableSum(xs) / xs.length;
  const performanceWeighted = meanOf(perfScores);
  const equalWeighted = meanOf(equalScores);
  const advantage = equalWeighted - performanceWeighted;
  const winner: CrossValidationResult['winner'] =
    Math.abs(advantage) < 1e-12 ? 'tie' : advantage > 0 ? 'performance' : 'equal';
  const individualExperts = experts.map((e, k) => ({ expert: e.expert, meanLogScore: meanOf(individual[k]) }));

  const warnings: string[] = [];
  if (degenerateFolds) {
    warnings.push(
      `${degenerateFolds} of ${n} folds produced an all-zero performance weighting and were excluded from the ` +
        'performance mean. The comparison below therefore rests on fewer folds for that scheme.',
    );
  }
  if (n < 8) {
    warnings.push(
      `${n} folds is very few. The difference of ${advantage.toPrecision(4)} nats between the schemes is itself ` +
        'estimated with enormous uncertainty; a single fold can reverse it. Read the direction, not the magnitude.',
    );
  }
  if (winner === 'equal') {
    warnings.push(
      `EQUAL WEIGHTING WON out of sample (${equalWeighted.toPrecision(5)} against ${performanceWeighted.toPrecision(5)} ` +
        'nats; lower is better). This is the documented and common outcome with few seed questions: the performance ' +
        'weights were fitted to a handful of realisations and did not generalise. Use equal weights here.',
    );
  }
  const verdict =
    winner === 'tie'
      ? 'The two schemes scored identically out of sample. Prefer equal weighting: it is simpler and requires no seed questions.'
      : winner === 'performance'
        ? `Performance weighting generalised better by ${advantage.toPrecision(5)} nats per question. That is evidence ` +
          'for it on THESE seeds; it does not establish that it will transfer to the questions of interest.'
        : `Equal weighting generalised better by ${(-advantage).toPrecision(5)} nats per question. The sophisticated ` +
          'method lost, which is a common result and the reason equal weighting is the benchmark rather than the fallback.';

  return {
    performanceWeighted,
    equalWeighted,
    individualExperts,
    winner,
    advantage,
    folds: n,
    verdict,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Leave-one-seed-out comparison of performance weighting against equal weighting',
      `${experts.length} experts' quantile judgements on ${n} seed questions with known answers`,
      [
        'The out-of-sample comparison is the honest one. In-sample, performance weighting wins by construction because the weights were chosen using those realisations.',
        'Leave-one-out with few seeds is itself high-variance. The direction of the result is more trustworthy than its size.',
      ],
    ),
    explanation: {
      method: 'Leave-one-out cross-validation of expert weighting schemes, scored by the logarithmic score',
      formula: 'score = −ln p̄_{−k}(y_k) averaged over held-out seed questions k',
      steps: [
        { label: 'Folds', value: String(n) },
        { label: 'Performance-weighted mean log score (nats, lower better)', value: Number.isFinite(performanceWeighted) ? performanceWeighted.toPrecision(8) : 'infinite' },
        { label: 'Equally-weighted mean log score', value: Number.isFinite(equalWeighted) ? equalWeighted.toPrecision(8) : 'infinite' },
        ...individualExperts.map((e) => ({ label: `${e.expert} alone`, value: Number.isFinite(e.meanLogScore) ? e.meanLogScore.toPrecision(8) : 'infinite' })),
        { label: 'Out-of-sample winner', value: winner },
        { label: 'Advantage of performance weighting (nats)', value: advantage.toPrecision(8) },
      ],
      assumptions: ['The seed questions are exchangeable, which is what makes leave-one-out meaningful.'],
      limitations: [
        'Leave-one-out on a handful of questions has very high variance.',
        'The logarithmic score rewards density at one point and is sensitive to the piecewise-uniform construction near the realisation.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Correlated experts: the supra-Bayesian aggregate                   */
/* ------------------------------------------------------------------ */

export interface ExpertEstimate {
  expert: string;
  /** The expert's central estimate of the quantity. */
  mean: number;
  /** The standard deviation of their own stated uncertainty. */
  sd: number;
}

export interface CorrelatedAggregateResult {
  experts: ExpertEstimate[];
  mean: number;
  sd: number;
  variance: number;
  /** The implicit weight each expert received, which can be NEGATIVE under strong correlation. */
  weights: { expert: string; weight: number }[];
  /** The sd that would be reported by wrongly treating the experts as independent. */
  sdIfIndependent: number;
  /** sd / sdIfIndependent. Greater than 1 is the confidence the independence assumption fabricates. */
  inflationFactor: number;
  /**
   * How many independent experts this correlated set is worth. With ρ = 0 it is
   * the expert count; as ρ → 1 it falls toward 1.
   */
  effectiveNumberOfExperts: number;
  correlationDescription: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Supra-Bayesian aggregation of point estimates with an explicit correlation
 * structure between the experts' errors.
 *
 * The model: each expert reports mᵢ = θ + εᵢ with Cov(εᵢ, εⱼ) = ρᵢⱼ sᵢ sⱼ. With
 * a flat prior on θ the posterior precision is 1′Σ⁻¹1 and the posterior mean is
 * (1′Σ⁻¹m)/(1′Σ⁻¹1).
 *
 * WHY THIS EXISTS: with ρ = 0 the precisions add, so ten experts with sd 10
 * give an aggregate sd of about 3.2. If those ten experts read the same three
 * papers, ρ is high and the true aggregate sd is close to 10. Treating
 * correlated experts as independent manufactures a factor-of-three confidence
 * out of nothing, and it is the single most common error in expert
 * aggregation.
 */
export function correlatedExpertAggregate(
  experts: readonly ExpertEstimate[],
  correlation: number | readonly (readonly number[])[],
): CorrelatedAggregateResult {
  const n = experts.length;
  if (n === 0) {
    throw new EngineError(
      'No experts were supplied, so there is no aggregate. A default value here would be a judgement nobody made.',
      'empty',
    );
  }
  const names = new Set<string>();
  experts.forEach((e, i) => {
    if (names.has(e.expert)) throw new EngineError(`The expert "${e.expert}" appears twice.`, 'duplicate');
    names.add(e.expert);
    if (!Number.isFinite(e.mean)) throw new EngineError(`Expert "${e.expert}" (index ${i}) has the non-finite estimate ${String(e.mean)}.`, 'finite');
    if (!Number.isFinite(e.sd) || e.sd <= 0) {
      throw new EngineError(
        `Expert "${e.expert}" states the standard deviation ${String(e.sd)}, which must be greater than 0. An sd of ` +
          '0 claims certainty, which would give that expert infinite weight and silence everybody else.',
        'range',
      );
    }
  });
  // Build the correlation matrix.
  let R: number[][];
  let correlationDescription: string;
  if (typeof correlation === 'number') {
    if (!Number.isFinite(correlation)) throw new EngineError(`The correlation ${String(correlation)} is not finite.`, 'finite');
    const minAllowed = n > 1 ? -1 / (n - 1) : -1;
    if (correlation >= 1) {
      throw new EngineError(
        `An exchangeable correlation of ${correlation} is at or above 1, which makes the covariance matrix singular: ` +
          'the experts would be literally the same source and no aggregate is defined. Use a value strictly below 1.',
        'range',
      );
    }
    if (correlation <= minAllowed && n > 1) {
      throw new EngineError(
        `An exchangeable correlation of ${correlation} across ${n} experts is at or below the smallest value a valid ` +
          `correlation matrix allows (−1/(n−1) = ${minAllowed.toPrecision(6)}). No such joint distribution exists.`,
        'range',
      );
    }
    R = Array.from({ length: n }, (_r, i) => Array.from({ length: n }, (_c, j) => (i === j ? 1 : correlation)));
    correlationDescription = `Exchangeable: every pair of experts has correlation ${correlation}.`;
  } else {
    if (correlation.length !== n) {
      throw new EngineError(`The correlation matrix is ${correlation.length}×? but there are ${n} experts.`, 'shape');
    }
    R = correlation.map((row, i) => {
      if (row.length !== n) throw new EngineError(`Row ${i} of the correlation matrix has ${row.length} entries, not ${n}.`, 'shape');
      return [...row];
    });
    for (let i = 0; i < n; i++) {
      if (Math.abs(R[i][i] - 1) > 1e-12) {
        throw new EngineError(`The correlation matrix has ${R[i][i]} on the diagonal at index ${i}; it must be exactly 1.`, 'range');
      }
      for (let j = 0; j < n; j++) {
        if (!Number.isFinite(R[i][j])) throw new EngineError(`Correlation entry (${i}, ${j}) is ${String(R[i][j])}.`, 'finite');
        if (Math.abs(R[i][j]) > 1) throw new EngineError(`Correlation entry (${i}, ${j}) is ${R[i][j]}, outside [−1, 1].`, 'range');
        if (Math.abs(R[i][j] - R[j][i]) > 1e-12) {
          throw new EngineError(`The correlation matrix is not symmetric: (${i}, ${j}) = ${R[i][j]} but (${j}, ${i}) = ${R[j][i]}.`, 'asymmetric');
        }
      }
    }
    correlationDescription = 'Supplied pairwise correlation matrix between the experts’ errors.';
  }
  const sds = experts.map((e) => e.sd);
  const sigma = R.map((row, i) => row.map((r, j) => r * sds[i] * sds[j]));
  const ones = new Array<number>(n).fill(1);
  const sigmaInvOnes = solve(sigma, ones);
  const means = experts.map((e) => e.mean);
  const sigmaInvMeans = solve(sigma, means);
  if (!sigmaInvOnes || !sigmaInvMeans || sigmaInvOnes.some((v) => !Number.isFinite(v)) || sigmaInvMeans.some((v) => !Number.isFinite(v))) {
    throw new EngineError(
      'The experts’ covariance matrix is singular or not positive definite, so no aggregate exists. That means the ' +
        'stated correlation structure describes no possible set of random errors — commonly a correlation of exactly ' +
        '1 between two experts, or a matrix that is not positive definite. Check the matrix rather than adjusting it here.',
      'singular',
    );
  }
  const precision = stableSum(sigmaInvOnes);
  if (!(precision > 0)) {
    throw new EngineError(
      `The implied posterior precision is ${precision.toPrecision(6)}, which is not positive. The stated correlation ` +
        'structure is not a valid covariance matrix for these standard deviations.',
      'degenerate',
    );
  }
  const mean = stableSum(sigmaInvMeans) / precision;
  const variance = 1 / precision;
  const sd = Math.sqrt(variance);
  const weights = sigmaInvOnes.map((v) => v / precision);
  const independentPrecision = stableSum(sds.map((s) => 1 / (s * s)));
  const sdIfIndependent = Math.sqrt(1 / independentPrecision);
  const inflationFactor = sd / sdIfIndependent;
  // With equal sds s, precision = n/s² under independence; the effective count
  // is the precision expressed in those units.
  const meanVariance = stableSum(sds.map((s) => s * s)) / n;
  const effectiveNumberOfExperts = precision * meanVariance;

  const warnings: string[] = [];
  if (inflationFactor > 1.2) {
    warnings.push(
      `Treating these experts as independent would report an sd of ${sdIfIndependent.toPrecision(5)} where the ` +
        `correlation-aware answer is ${sd.toPrecision(5)} — a factor of ${inflationFactor.toPrecision(4)} of ` +
        `FABRICATED CONFIDENCE. The ${n} experts are worth about ${effectiveNumberOfExperts.toPrecision(3)} ` +
        'independent ones.',
    );
  }
  const negative = weights.filter((w) => w < 0).length;
  if (negative) {
    warnings.push(
      `${negative} expert(s) received a NEGATIVE weight (${experts
        .map((e, i) => `${e.expert}: ${weights[i].toPrecision(4)}`)
        .join(', ')}). This is a correct consequence of the stated correlation structure — a strongly correlated ` +
        'expert can be informative by how they differ from the others — but it means the aggregate can fall outside ' +
        'the range of the individual estimates, which usually indicates the correlation matrix is not believed.',
    );
  }
  warnings.push(
    'The correlation between the experts is an assumption, and it is doing most of the work here. It cannot be ' +
      'estimated from the estimates themselves; it has to come from knowing how the experts formed their views.',
  );
  return {
    experts: experts.map((e) => ({ ...e })),
    mean,
    sd,
    variance,
    weights: experts.map((e, i) => ({ expert: e.expert, weight: weights[i] })),
    sdIfIndependent,
    inflationFactor,
    effectiveNumberOfExperts,
    correlationDescription,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Supra-Bayesian aggregation of expert estimates with an explicit error correlation structure',
      `${n} point estimates with stated uncertainties: ${experts.map((e) => `${e.expert} = ${e.mean} ± ${e.sd}`).join(', ')}`,
      [
        'The correlation between the experts is itself an assumption, supplied by the analyst, and it dominates the width of the answer.',
        'Treating correlated experts as independent is the most common way expert aggregation manufactures confidence.',
        'The normal error model means the result is a location and a scale; it cannot represent an expert who is simply wrong in a different way.',
      ],
    ),
    explanation: {
      method: 'Supra-Bayesian normal aggregation with correlated expert errors',
      formula: 'Σ_ij = ρ_ij s_i s_j; posterior precision = 1′Σ⁻¹1; posterior mean = (1′Σ⁻¹m)/(1′Σ⁻¹1)',
      steps: [
        { label: 'Experts', value: experts.map((e) => `${e.expert} = ${e.mean} ± ${e.sd}`).join('; ') },
        { label: 'Correlation structure', value: correlationDescription },
        { label: 'Aggregate mean', value: mean.toPrecision(8) },
        { label: 'Aggregate sd (correlation-aware)', value: sd.toPrecision(8) },
        { label: 'Aggregate sd if treated as independent', value: sdIfIndependent.toPrecision(8) },
        { label: 'Inflation factor (aware / independent)', value: inflationFactor.toPrecision(8) },
        { label: 'Effective number of independent experts', value: effectiveNumberOfExperts.toPrecision(6) },
        { label: 'Implied weights', value: experts.map((e, i) => `${e.expert} = ${weights[i].toPrecision(6)}`).join('; ') },
      ],
      assumptions: [
        'Each expert’s error is normal with the standard deviation they stated, and they are all estimating the same quantity.',
        'A flat prior on the quantity, so the aggregate is driven entirely by the experts.',
        'The correlation matrix is correct. It is not estimated here.',
      ],
      limitations: [
        'A normal error model cannot express an expert who is biased in a direction the others are not.',
        'Negative weights are a correct consequence of the model and an uncomfortable one; they signal that the correlation structure deserves scrutiny.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Disagreement                                                       */
/* ------------------------------------------------------------------ */

export interface DisagreementResult {
  experts: { expert: string; mean: number; variance: number; sd: number }[];
  /** Variance of the experts' means: uncertainty about WHO IS RIGHT. */
  betweenExpertVariance: number;
  /** Mean of the experts' variances: the uncertainty each expert reports. */
  withinExpertVariance: number;
  /** between + within: the variance of the equal-weight linear pool. */
  totalVariance: number;
  /** between / total. High means the disagreement dominates. */
  betweenShare: number;
  /** Range of the experts' means. */
  meanRange: number;
  /** The largest gap between any two experts' means, in units of the smaller expert's sd. */
  largestStandardisedGap: { experts: [string, string]; gap: number };
  interpretation: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * How much the experts disagree, and whether the disagreement or their own
 * stated uncertainty dominates.
 *
 * The law of total variance splits the equal-weight mixture's variance into a
 * BETWEEN-expert part and a WITHIN-expert part. A high between share means the
 * uncertainty is about which expert is right, which is a different problem
 * from the uncertainty each of them reports and calls for different action:
 * more uncertainty within means the question is hard, more uncertainty between
 * means the experts should be made to argue.
 */
export function disagreementMeasures(experts: readonly ExpertDistribution[]): DisagreementResult {
  validateExperts(experts);
  if (experts.length < 2) {
    throw new EngineError(
      `Disagreement needs at least 2 experts; got ${experts.length}. One expert does not disagree with anybody.`,
      'too-few',
    );
  }
  const rows = experts.map((e) => {
    const def = getDistribution(e.distributionId);
    const s = summarize(def, e.params);
    if (!s.mean.defined) {
      throw new EngineError(
        `Expert "${e.expert}" stated a ${def.name} distribution whose mean is undefined (${s.mean.reason}). A ` +
          'between-expert variance cannot be formed from it, and substituting any finite value would invent a ' +
          'judgement. Use a quantile-based disagreement measure for heavy-tailed judgements.',
        'undefined-moment',
      );
    }
    if (!s.variance.defined) {
      throw new EngineError(
        `Expert "${e.expert}" stated a ${def.name} distribution whose variance is undefined (${s.variance.reason}). ` +
          'The within-expert variance cannot be formed from it.',
        'undefined-moment',
      );
    }
    return { expert: e.expert, mean: s.mean.value, variance: s.variance.value, sd: Math.sqrt(s.variance.value) };
  });
  const n = rows.length;
  const grandMean = stableSum(rows.map((r) => r.mean)) / n;
  const betweenExpertVariance = stableSum(rows.map((r) => (r.mean - grandMean) ** 2)) / n;
  const withinExpertVariance = stableSum(rows.map((r) => r.variance)) / n;
  const totalVariance = betweenExpertVariance + withinExpertVariance;
  const betweenShare = totalVariance > 0 ? betweenExpertVariance / totalVariance : 0;
  const means = rows.map((r) => r.mean);
  const meanRange = Math.max(...means) - Math.min(...means);
  let worst: { experts: [string, string]; gap: number } = { experts: [rows[0].expert, rows[1].expert], gap: 0 };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const scale = Math.min(rows[i].sd, rows[j].sd);
      const gap = scale > 0 ? Math.abs(rows[i].mean - rows[j].mean) / scale : Infinity;
      if (gap > worst.gap) worst = { experts: [rows[i].expert, rows[j].expert], gap };
    }
  }
  const interpretation =
    betweenShare > 0.5
      ? `${(betweenShare * 100).toPrecision(3)}% of the total variance is BETWEEN the experts. The dominant ` +
        'uncertainty is about which expert is right, not about the quantity as any of them sees it. A pooled ' +
        'distribution will be wide and probably multimodal, and its mean will sit in a region every expert ' +
        'considers unlikely. The useful next step is to find out why they disagree, not to average them.'
      : `${(betweenShare * 100).toPrecision(3)}% of the total variance is between the experts and ` +
        `${((1 - betweenShare) * 100).toPrecision(3)}% is within them. The experts broadly agree and the question ` +
        'is simply uncertain; pooling is reasonable and the width of the pool is close to the width each expert reports.';
  const warnings: string[] = [];
  if (worst.gap > 3) {
    warnings.push(
      `"${worst.experts[0]}" and "${worst.experts[1]}" differ by ${worst.gap.toPrecision(3)} of the narrower ` +
        'expert’s own standard deviations. At that separation at least one of them is confidently wrong, and ' +
        'averaging them produces a number neither would endorse.',
    );
  }
  if (betweenShare > 0.5) warnings.push(interpretation);
  if (n < 3) {
    warnings.push(
      `A between-expert variance from ${n} experts is estimated from ${n} numbers and is extremely noisy. It shows ` +
        'that they disagree; it does not measure how much experts in general disagree.',
    );
  }
  return {
    experts: rows,
    betweenExpertVariance,
    withinExpertVariance,
    totalVariance,
    betweenShare,
    meanRange,
    largestStandardisedGap: worst,
    interpretation,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Between- and within-expert variance decomposition of a set of stated distributions',
      `${n} distributions asserted by ${n} judges: ${experts.map((e) => `${e.expert} → ${e.distributionId}`).join(', ')}`,
      [
        'Between-expert variance is uncertainty about who is right. Within-expert variance is uncertainty about the quantity. They call for different responses.',
        'The decomposition is that of the EQUAL-WEIGHT mixture. Different weights give a different split.',
      ],
    ),
    explanation: {
      method: 'Law of total variance applied to an equal-weight expert mixture',
      formula: 'Var(mixture) = Var_experts(E[X|expert]) + E_experts(Var[X|expert])',
      steps: [
        ...rows.map((r) => ({ label: r.expert, value: `mean ${r.mean.toPrecision(6)}, sd ${r.sd.toPrecision(6)}` })),
        { label: 'Between-expert variance', value: betweenExpertVariance.toPrecision(8) },
        { label: 'Within-expert variance', value: withinExpertVariance.toPrecision(8) },
        { label: 'Total (equal-weight mixture) variance', value: totalVariance.toPrecision(8) },
        { label: 'Between share', value: betweenShare.toPrecision(6) },
        { label: 'Range of the experts’ means', value: meanRange.toPrecision(8) },
        { label: 'Largest standardised gap', value: `${worst.experts[0]} vs ${worst.experts[1]}: ${Number.isFinite(worst.gap) ? worst.gap.toPrecision(5) : '∞'} sd` },
      ],
      assumptions: ['Every expert is describing the same quantity, so their means are comparable.'],
      limitations: [
        'Means and variances exist only for some families; a heavy-tailed judgement cannot be decomposed this way and is refused rather than approximated.',
        'A few experts give a very noisy between-expert variance.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}
