/**
 * Model averaging and stacking.
 *
 * Selecting one model and reporting its uncertainty as if the choice had not
 * been made understates uncertainty, because the choice used the same data.
 * Averaging over the set is almost always the better prediction.
 *
 * There are two families here and they are not the same thing.
 *  - Bayesian model averaging (by posterior model probabilities, or by Akaike
 *    weights as an approximation) assumes the true model is IN the set. When it
 *    is not — always — BMA weights concentrate on the single model closest in
 *    Kullback-Leibler divergence as n grows, which is not the best predictive
 *    mixture.
 *  - Stacking optimises the leave-one-out log score of the MIXTURE over the
 *    simplex. It asks directly which combination predicts best, makes no
 *    assumption that the truth is in the set, and is the better default.
 */
import { logSumExp } from '../core/numeric';
import { EngineError, type Explanation } from '../core/result';
import { Random } from '../random/rng';
import { AVERAGING_CAVEAT, MODEL_SET_CAVEAT } from './types';
import type { ElpdEstimate } from './types';

export interface ModelWeights {
  readonly method: 'stacking' | 'pseudo-bma' | 'pseudo-bma+' | 'akaike' | 'posterior-model-probability';
  readonly names: readonly string[];
  readonly weights: readonly number[];
  /** Mean leave-one-out log score of the weighted mixture, where defined. */
  readonly mixtureLogScore: number | null;
  /** Best single model's mean leave-one-out log score, for contrast. */
  readonly bestSingleLogScore: number | null;
  readonly iterations: number;
  readonly exactness: 'empirical';
  readonly statement: string;
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

interface PointwiseMatrix {
  /** lp[k][i] = log predictive density of observation i under model k, leave-one-out. */
  readonly lp: readonly (readonly number[])[];
  readonly names: readonly string[];
  readonly n: number;
}

function collect(estimates: readonly ElpdEstimate[], label: string): PointwiseMatrix {
  if (estimates.length === 0) {
    throw new EngineError(`${label}: the model set is empty, so there are no weights to compute.`, 'empty');
  }
  const n = estimates[0].pointwise.length;
  if (n < 2) {
    throw new EngineError(`${label}: at least 2 observations are needed; the pointwise terms have length ${n}.`, 'insufficient');
  }
  for (const e of estimates) {
    if (e.pointwise.length !== n) {
      throw new EngineError(
        `${label}: model "${e.name}" has ${e.pointwise.length} pointwise terms but "${estimates[0].name}" has ${n}. Weights can only be formed from the same observations in the same order.`,
        'shape',
      );
    }
    const bad = e.pointwise.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) {
      throw new EngineError(
        `${label}: the pointwise leave-one-out log predictive density of model "${e.name}" is ${String(e.pointwise[bad])} at observation ${bad}. A model with zero predictive density for an observation cannot be given a weight by a log score.`,
        'nonfinite',
      );
    }
  }
  return { lp: estimates.map((e) => e.pointwise), names: estimates.map((e) => e.name), n };
}

/** Mean log score of the mixture Σ_k w_k p_k, in log space. */
function mixtureLogScore(m: PointwiseMatrix, w: readonly number[]): number {
  let total = 0;
  const terms = new Array<number>(w.length);
  for (let i = 0; i < m.n; i++) {
    for (let k = 0; k < w.length; k++) terms[k] = w[k] > 0 ? Math.log(w[k]) + m.lp[k][i] : -Infinity;
    total += logSumExp(terms);
  }
  return total / m.n;
}

/**
 * Stacking of predictive distributions (Yao, Vehtari, Simpson & Gelman 2018).
 *
 * Maximise  Σ_i log Σ_k w_k p(y_i | y_−i, M_k)  subject to w ≥ 0, Σ w = 1.
 *
 * The objective is concave in w, so the constrained maximum is global. It is
 * found here by the EM / multiplicative update for mixture weights,
 *   w_k ← w_k · (1/n) Σ_i p_ik / Σ_j w_j p_ij,
 * which stays on the simplex by construction (no projection step to drift off
 * it) and increases the objective at every iteration. The responsibilities are
 * computed in log space, so a model that is astronomically worse on some
 * observation contributes 0 rather than an underflowed NaN.
 */
export function stackingWeights(
  estimates: readonly ElpdEstimate[],
  options: { readonly maxIterations?: number; readonly tolerance?: number } = {},
): ModelWeights {
  const m = collect(estimates, 'Stacking');
  const K = m.names.length;
  if (K < 2) {
    throw new EngineError(
      `Stacking combines at least 2 models; ${K} was supplied. With one model there is no simplex to optimise over and the weight is trivially 1.`,
      'degenerate',
    );
  }
  const maxIterations = options.maxIterations ?? 2000;
  const tolerance = options.tolerance ?? 1e-12;
  let w = new Array<number>(K).fill(1 / K);
  let previous = mixtureLogScore(m, w);
  if (!Number.isFinite(previous)) {
    throw new EngineError(
      'The stacking objective is not finite at equal weights, so the optimisation is degenerate. This happens when every model gives zero predictive density to the same observation.',
      'degenerate',
    );
  }
  let iterations = 0;
  const logTerms = new Array<number>(K);
  for (let it = 0; it < maxIterations; it++) {
    iterations++;
    const next = new Array<number>(K).fill(0);
    for (let i = 0; i < m.n; i++) {
      for (let k = 0; k < K; k++) logTerms[k] = w[k] > 0 ? Math.log(w[k]) + m.lp[k][i] : -Infinity;
      const denom = logSumExp(logTerms);
      if (!Number.isFinite(denom)) {
        throw new EngineError(
          `The stacking objective is degenerate at observation ${i}: every model with positive weight gives it zero predictive density.`,
          'degenerate',
        );
      }
      for (let k = 0; k < K; k++) next[k] += Math.exp(logTerms[k] - denom) / m.n;
    }
    const total = next.reduce((a, b) => a + b, 0);
    if (!(total > 0)) {
      throw new EngineError('The stacking update produced a zero weight vector, so the optimisation is degenerate.', 'degenerate');
    }
    w = next.map((v) => v / total);
    const score = mixtureLogScore(m, w);
    const gain = score - previous;
    previous = score;
    if (gain >= 0 && gain < tolerance) break;
  }
  // Exact simplex: tiny weights are set to 0 and the remainder renormalised so
  // the weights sum to exactly 1 rather than to 1 ± 1e-16.
  w = exactSimplex(w);
  const single = m.lp.map((row) => row.reduce((a, b) => a + b, 0) / m.n);
  const bestSingle = Math.max(...single);
  const score = mixtureLogScore(m, w);
  const bestName = m.names[single.indexOf(bestSingle)];
  const dominant = w.map((v, k) => ({ v, k })).filter((e) => e.v > 0.01);
  const warnings = [
    AVERAGING_CAVEAT,
    'Stacking weights are not posterior model probabilities and do not estimate the chance that a model is true. They are the mixture that predicted best in leave-one-out, and they are themselves estimated, so they carry sampling error that this point estimate does not show.',
    'Stacking inherits every caveat of the leave-one-out estimates it is given: if a Pareto k diagnostic was high for some observation, that observation’s contribution to these weights is unreliable too.',
    MODEL_SET_CAVEAT,
  ];
  if (iterations >= maxIterations) {
    warnings.push(`The stacking optimisation reached the iteration limit (${maxIterations}) without the objective settling; the weights are the best found, not a converged optimum.`);
  }
  return {
    method: 'stacking',
    names: m.names,
    weights: w,
    mixtureLogScore: score,
    bestSingleLogScore: bestSingle,
    iterations,
    exactness: 'empirical',
    statement:
      dominant.length === 1
        ? `Stacking puts essentially all weight (${w[dominant[0].k].toPrecision(3)}) on "${m.names[dominant[0].k]}": the other models add nothing to the mixture’s leave-one-out log score (${score.toFixed(4)} per observation, against ${bestSingle.toFixed(4)} for the best single model, "${bestName}").`
        : `Stacking spreads weight across ${dominant.length} models (${dominant.map((e) => `"${m.names[e.k]}" ${w[e.k].toPrecision(2)}`).join(', ')}). The mixture scores ${score.toFixed(4)} per observation against ${bestSingle.toFixed(4)} for the best single model, "${bestName}": these models are complementary, and selecting one of them would discard the rest of the information.`,
    warnings,
    explanation: {
      method: 'Stacking of predictive distributions (simplex-constrained LOO log score)',
      formula: 'maximise Σ_i log Σ_k w_k p(y_i | y_−i, M_k)  s.t.  w ≥ 0, Σ_k w_k = 1',
      steps: [
        ...m.names.map((name, k) => ({
          label: name,
          expression: `mean LOO log score alone = ${single[k].toFixed(5)}`,
          value: `stacking weight ${w[k].toPrecision(4)}`,
        })),
        { label: 'Mixture mean LOO log score', value: score.toFixed(6) },
        { label: 'Best single model mean LOO log score', value: bestSingle.toFixed(6) },
        { label: 'EM iterations', value: String(iterations) },
      ],
      assumptions: [
        'The pointwise values supplied are leave-one-out log predictive densities for the same observations in the same order.',
        'The objective is concave in the weights, so the EM fixed point is the global constrained maximum.',
      ],
      limitations: warnings,
      exactness: 'empirical',
    },
  };
}

/** Zero out negligible weights and renormalise so the weights sum to exactly 1. */
function exactSimplex(w: readonly number[]): number[] {
  const cleaned = w.map((v) => (v < 1e-12 ? 0 : v));
  const total = cleaned.reduce((a, b) => a + b, 0);
  const out = cleaned.map((v) => v / total);
  // Put the residual on the largest entry so the sum is exactly 1.
  let largest = 0;
  for (let i = 1; i < out.length; i++) if (out[i] > out[largest]) largest = i;
  let rest = 0;
  for (let i = 0; i < out.length; i++) if (i !== largest) rest += out[i];
  out[largest] = 1 - rest;
  return out;
}

/**
 * Pseudo-BMA weights: exp(elpd_k) normalised, i.e. Akaike-style weights built
 * from a cross-validation estimate instead of a plug-in criterion.
 *
 * Without the Bayesian bootstrap these ignore the uncertainty in the elpd
 * estimates and are badly overconfident: a difference of 2 in elpd with a
 * standard error of 5 still produces weights of 0.73 / 0.27. Use
 * `bayesianBootstrap: true` (pseudo-BMA+), or stacking.
 */
export function pseudoBmaWeights(
  estimates: readonly ElpdEstimate[],
  options: { readonly bayesianBootstrap?: boolean; readonly replicates?: number; readonly seed?: string } = {},
): ModelWeights {
  const m = collect(estimates, 'Pseudo-BMA');
  const K = m.names.length;
  const useBootstrap = options.bayesianBootstrap ?? false;
  const warnings = [
    AVERAGING_CAVEAT,
    MODEL_SET_CAVEAT,
    'Pseudo-BMA weights are not posterior model probabilities. They are an exp(elpd) rule applied to a cross-validation estimate.',
  ];
  let weights: number[];
  let replicates = 0;
  if (!useBootstrap) {
    const elpd = m.lp.map((row) => row.reduce((a, b) => a + b, 0));
    const norm = logSumExp(elpd);
    weights = exactSimplex(elpd.map((e) => Math.exp(e - norm)));
    warnings.push(
      'Without the Bayesian bootstrap these weights ignore the standard error of each elpd estimate and are overconfident: they can concentrate on one model when the elpd difference is well inside its own noise. Pass bayesianBootstrap: true, or use stacking.',
    );
  } else {
    if (options.seed === undefined) {
      throw new EngineError('The Bayesian bootstrap needs an explicit seed so the weights can be reproduced.', 'required');
    }
    replicates = options.replicates ?? 1000;
    if (!Number.isInteger(replicates) || replicates < 100) {
      throw new EngineError(`The Bayesian bootstrap needs at least 100 replicates; ${String(replicates)} was requested.`, 'range');
    }
    const rng = new Random(options.seed);
    const accumulated = new Array<number>(K).fill(0);
    const alpha = new Array<number>(m.n);
    const logTerms = new Array<number>(K);
    for (let b = 0; b < replicates; b++) {
      // Dirichlet(1,…,1) weights over observations, via normalised exponentials.
      let total = 0;
      for (let i = 0; i < m.n; i++) {
        alpha[i] = rng.exponential(1);
        total += alpha[i];
      }
      for (let k = 0; k < K; k++) {
        let s = 0;
        for (let i = 0; i < m.n; i++) s += (alpha[i] / total) * m.lp[k][i];
        logTerms[k] = m.n * s; // elpd on the n-observation scale
      }
      const norm = logSumExp(logTerms);
      for (let k = 0; k < K; k++) accumulated[k] += Math.exp(logTerms[k] - norm) / replicates;
    }
    weights = exactSimplex(accumulated);
    warnings.push(
      `Pseudo-BMA+ averaged the weights over ${replicates} Bayesian bootstrap replicates of the observation weights, which propagates the uncertainty in each elpd estimate. The weights are therefore less concentrated than plain pseudo-BMA, and that is the point, not a defect.`,
    );
  }
  const single = m.lp.map((row) => row.reduce((a, b) => a + b, 0) / m.n);
  const bestSingle = Math.max(...single);
  const top = weights.indexOf(Math.max(...weights));
  return {
    method: useBootstrap ? 'pseudo-bma+' : 'pseudo-bma',
    names: m.names,
    weights,
    mixtureLogScore: mixtureLogScore(m, weights),
    bestSingleLogScore: bestSingle,
    iterations: replicates,
    exactness: 'empirical',
    statement: `${useBootstrap ? 'Pseudo-BMA+' : 'Pseudo-BMA'} gives "${m.names[top]}" the largest weight (${weights[top].toPrecision(3)}). ${useBootstrap ? 'The Bayesian bootstrap has spread these weights to reflect the uncertainty in the elpd estimates.' : 'These weights take the elpd estimates at face value and are overconfident.'}`,
    warnings,
    explanation: {
      method: useBootstrap ? 'Pseudo-BMA+ (Bayesian bootstrap)' : 'Pseudo-BMA',
      formula: useBootstrap
        ? 'w_k = mean over bootstrap replicates of exp(elpd_k^(b)) / Σ_j exp(elpd_j^(b)),  elpd^(b) from Dirichlet(1) observation weights'
        : 'w_k = exp(elpd_k) / Σ_j exp(elpd_j)',
      steps: m.names.map((name, k) => ({
        label: name,
        expression: `mean LOO log score = ${single[k].toFixed(5)}`,
        value: `weight ${weights[k].toPrecision(4)}`,
      })),
      assumptions: ['The pointwise values are leave-one-out log predictive densities for the same observations.'],
      limitations: warnings,
      exactness: 'empirical',
    },
  };
}

/**
 * Bayesian model averaging weights from Akaike (or BIC) weights, or from
 * posterior model probabilities.
 *
 * BMA weights answer "which model is true", and they are consistent for that
 * question only if one of them is. When the truth is outside the set — the
 * usual case — they concentrate on the single nearest model as n grows, where
 * stacking would keep a mixture that predicts better.
 */
export function bayesianModelAverage(input: {
  readonly names: readonly string[];
  readonly weights: readonly number[];
  readonly source: 'akaike' | 'posterior-model-probability';
}): ModelWeights {
  if (input.names.length === 0) {
    throw new EngineError('The model set is empty, so there is nothing to average.', 'empty');
  }
  if (input.names.length !== input.weights.length) {
    throw new EngineError(
      `${input.weights.length} weights were supplied for ${input.names.length} models; there must be one per model.`,
      'shape',
    );
  }
  if (input.weights.some((w) => !(w >= 0) || !Number.isFinite(w))) {
    throw new EngineError('Model averaging weights must be finite and non-negative.', 'range');
  }
  const total = input.weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) {
    throw new EngineError('The model averaging weights are all zero, so no average is defined.', 'degenerate');
  }
  const w = exactSimplex(input.weights.map((v) => v / total));
  const top = w.indexOf(Math.max(...w));
  const warnings = [
    AVERAGING_CAVEAT,
    input.source === 'akaike'
      ? 'Akaike weights are a relative-likelihood rule, not probabilities of truth. Averaging predictions with them is a reasonable heuristic, and nothing more.'
      : 'Posterior model probabilities are conditional on the model set containing the true model. It does not, so these weights answer a question whose premise is false.',
    'Bayesian model averaging converges on the single model closest in Kullback-Leibler divergence when the truth is outside the set. Where predictive performance is what matters, stacking is the better-behaved alternative.',
    MODEL_SET_CAVEAT,
  ];
  return {
    method: input.source,
    names: input.names,
    weights: w,
    mixtureLogScore: null,
    bestSingleLogScore: null,
    iterations: 0,
    exactness: 'empirical',
    statement: `Model averaging by ${input.source === 'akaike' ? 'Akaike weights' : 'posterior model probabilities'} puts weight ${w[top].toPrecision(3)} on "${input.names[top]}". Predictions should be the weighted mixture of the models’ predictive distributions, not the predictions of the top model.`,
    warnings,
    explanation: {
      method: input.source === 'akaike' ? 'Bayesian model averaging by Akaike weights' : 'Bayesian model averaging by posterior model probabilities',
      formula: 'p(ỹ | y) = Σ_k w_k p(ỹ | y, M_k)',
      steps: input.names.map((name, k) => ({ label: name, value: `weight ${w[k].toPrecision(4)}` })),
      assumptions: ['The weights supplied correspond to the models named, in order.'],
      limitations: warnings,
      exactness: 'empirical',
    },
  };
}

/**
 * Combine predictive draws (or any predictive sample) from several models
 * under a weight vector, by picking a model per draw in proportion to its
 * weight. The result is a sample from the mixture predictive distribution.
 */
export function averagePredictiveDraws(input: {
  readonly draws: readonly (readonly number[])[];
  readonly weights: readonly number[];
  readonly size: number;
  readonly seed: string;
}): number[] {
  const { draws, weights, size } = input;
  if (draws.length !== weights.length) {
    throw new EngineError(`${draws.length} predictive samples were supplied for ${weights.length} weights.`, 'shape');
  }
  if (draws.length === 0) throw new EngineError('There are no models to average predictions over.', 'empty');
  if (!Number.isInteger(size) || size < 1) throw new EngineError(`The requested sample size must be a positive whole number; got ${String(size)}.`, 'range');
  draws.forEach((d, k) => {
    if (d.length === 0) throw new EngineError(`Model ${k} supplied no predictive draws.`, 'empty');
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new EngineError('The averaging weights are all zero.', 'degenerate');
  const cumulative: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w / total;
    cumulative.push(acc);
  }
  const rng = new Random(input.seed);
  const out = new Array<number>(size);
  for (let i = 0; i < size; i++) {
    const u = rng.uniform();
    let k = 0;
    while (k < cumulative.length - 1 && u > cumulative[k]) k++;
    out[i] = draws[k][rng.int(0, draws[k].length - 1)];
  }
  return out;
}
