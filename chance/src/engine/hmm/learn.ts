/**
 * Learning HMM parameters: Baum–Welch (EM) from unlabelled sequences,
 * counting MLE from labelled sequences, and model selection over the number
 * of hidden states.
 *
 * EM has one hard mathematical guarantee — the observed-data log-likelihood
 * never decreases — and that guarantee is the only cheap correctness check
 * available for an implementation this fiddly. A decrease therefore means a
 * bug, not a numerical quirk, so this module stops and reports it instead of
 * iterating on quietly.
 */
import { EngineError, type Exactness } from '../core/result';
import type { JobProgress } from '../core/progress';
import { Random } from '../random/rng';
import type { Matrix } from '../stats/linalg';
import { backward, emissionOps, forward, posteriors, validateHmm, validateObservations } from './hmm';
import type { DiscreteEmission, EmissionModel, GaussianEmission, HmmModel } from './types';

const VARIANCE_FLOOR = 1e-6;

export interface BaumWelchOptions {
  maxIterations?: number;
  /** Absolute convergence tolerance on the log-likelihood. */
  tolerance?: number;
  /** Number of random restarts; the best final log-likelihood wins. */
  restarts?: number;
  /** Starting model. With restarts > 1 the remaining starts are random. */
  start?: HmmModel;
  seed?: string | number;
  /** Laplace-style smoothing added to the expected counts. */
  smoothing?: number;
}

export interface BaumWelchRun {
  /** Log-likelihood of the training data at every iteration, in order. */
  history: number[];
  iterations: number;
  converged: boolean;
  finalLogLikelihood: number;
}

export interface BaumWelchResult {
  model: HmmModel;
  logLikelihood: number;
  runs: BaumWelchRun[];
  bestRestart: number;
  converged: boolean;
  iterations: number;
  /** Largest log-likelihood decrease seen across all runs; must be ~0. */
  worstMonotonicityViolation: number;
  exactness: Exactness;
  method: string;
  warnings: string[];
  limitations: string[];
}

function totalLogLikelihood(model: HmmModel, sequences: number[][]): number {
  let total = 0;
  for (const seq of sequences) total += forward(model, seq).logLikelihood;
  return total;
}

function randomStochasticRow(n: number, rng: Random): number[] {
  const row = new Array<number>(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    row[i] = 0.1 + rng.uniform();
    s += row[i];
  }
  for (let i = 0; i < n; i++) row[i] /= s;
  return row;
}

/** A random model of the right shape, used for the restarts. */
export function randomStart(states: number, template: EmissionModel, sequences: number[][], rng: Random): HmmModel {
  const stateNames = Array.from({ length: states }, (_, i) => `State ${i + 1}`);
  const transition: Matrix = Array.from({ length: states }, () => randomStochasticRow(states, rng));
  let emission: EmissionModel;
  if (template.kind === 'discrete') {
    emission = {
      kind: 'discrete',
      symbols: template.symbols,
      matrix: Array.from({ length: states }, () => randomStochasticRow(template.symbols.length, rng)),
    };
  } else {
    const flat = sequences.flat();
    const mean = flat.reduce((a, b) => a + b, 0) / Math.max(1, flat.length);
    const variance = Math.max(VARIANCE_FLOOR, flat.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, flat.length));
    const sd = Math.sqrt(variance);
    emission = {
      kind: 'gaussian',
      mean: Array.from({ length: states }, () => mean + sd * rng.normal()),
      variance: Array.from({ length: states }, () => variance * (0.5 + rng.uniform())),
    };
  }
  return { stateNames, initial: randomStochasticRow(states, rng), transition, emission };
}

interface Accumulators {
  initial: number[];
  transitionNumerator: Matrix;
  transitionDenominator: number[];
  gammaSum: number[];
  /** Discrete: per-state per-symbol expected counts. */
  symbolCounts: Matrix | null;
  /** Gaussian: weighted first and second moments. */
  weightedSum: number[] | null;
  weightedSquareSum: number[] | null;
}

function emptyAccumulators(n: number, emission: EmissionModel): Accumulators {
  return {
    initial: new Array<number>(n).fill(0),
    transitionNumerator: Array.from({ length: n }, () => new Array<number>(n).fill(0)),
    transitionDenominator: new Array<number>(n).fill(0),
    gammaSum: new Array<number>(n).fill(0),
    symbolCounts: emission.kind === 'discrete' ? Array.from({ length: n }, () => new Array<number>(emission.symbols.length).fill(0)) : null,
    weightedSum: emission.kind === 'gaussian' ? new Array<number>(n).fill(0) : null,
    weightedSquareSum: emission.kind === 'gaussian' ? new Array<number>(n).fill(0) : null,
  };
}

function accumulate(acc: Accumulators, model: HmmModel, seq: number[]): void {
  const n = model.stateNames.length;
  const post = posteriors(model, seq);
  const T = seq.length;
  for (let i = 0; i < n; i++) acc.initial[i] += post.gamma[0][i];
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) {
      const g = post.gamma[t][i];
      acc.gammaSum[i] += g;
      if (t < T - 1) acc.transitionDenominator[i] += g;
      if (acc.symbolCounts) acc.symbolCounts[i][seq[t]] += g;
      if (acc.weightedSum && acc.weightedSquareSum) {
        acc.weightedSum[i] += g * seq[t];
        acc.weightedSquareSum[i] += g * seq[t] * seq[t];
      }
    }
  }
  for (let t = 0; t < T - 1; t++) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) acc.transitionNumerator[i][j] += post.xi[t][i][j];
  }
}

function normaliseRow(row: number[], smoothing: number): number[] {
  const out = row.map((v) => v + smoothing);
  const s = out.reduce((a, b) => a + b, 0);
  if (!(s > 0)) {
    // A state with no expected occupancy at all: fall back to uniform rather
    // than dividing by zero and returning NaN.
    return out.map(() => 1 / out.length);
  }
  return out.map((v) => v / s);
}

function reestimate(model: HmmModel, acc: Accumulators, sequences: number[][], smoothing: number): HmmModel {
  const n = model.stateNames.length;
  const initial = normaliseRow(acc.initial, smoothing);
  const transition: Matrix = Array.from({ length: n }, (_, i) => normaliseRow(acc.transitionNumerator[i], smoothing));
  let emission: EmissionModel;
  if (model.emission.kind === 'discrete' && acc.symbolCounts) {
    const prev: DiscreteEmission = model.emission;
    emission = { kind: 'discrete', symbols: prev.symbols, matrix: acc.symbolCounts.map((row) => normaliseRow(row, smoothing)) };
  } else if (model.emission.kind === 'gaussian' && acc.weightedSum && acc.weightedSquareSum) {
    const prev: GaussianEmission = model.emission;
    const mean = new Array<number>(n);
    const variance = new Array<number>(n);
    const flat = sequences.flat();
    const globalVar = Math.max(VARIANCE_FLOOR, flat.reduce((a, b) => a + b * b, 0) / Math.max(1, flat.length));
    for (let i = 0; i < n; i++) {
      const w = acc.gammaSum[i];
      if (!(w > 1e-12)) {
        // A state nothing is assigned to: keep its old parameters rather than
        // inventing a mean of 0/0.
        mean[i] = prev.mean[i];
        variance[i] = prev.variance[i];
        continue;
      }
      mean[i] = acc.weightedSum[i] / w;
      variance[i] = Math.max(VARIANCE_FLOOR, acc.weightedSquareSum[i] / w - mean[i] * mean[i]);
      if (!Number.isFinite(variance[i])) variance[i] = globalVar;
    }
    emission = { kind: 'gaussian', mean, variance };
  } else {
    throw new EngineError('The emission accumulators do not match the emission family; this is an internal inconsistency.', 'internal');
  }
  return { stateNames: model.stateNames, initial, transition, emission };
}

/**
 * One EM run from a given starting model, as a generator that yields the
 * number of completed iterations after each one. Yielding between iterations
 * is what lets a caller (the worker, or the main-thread fallback) interleave
 * its message queue and stop a long fit.
 */
function* runEmSteps(start: HmmModel, sequences: number[][], maxIterations: number, tolerance: number, smoothing: number): Generator<number, { model: HmmModel; run: BaumWelchRun; violation: number }, void> {
  let model = start;
  const history: number[] = [];
  let previous = -Infinity;
  let converged = false;
  let violation = 0;
  let iterations = 0;
  for (let it = 0; it < maxIterations; it++) {
    iterations = it + 1;
    const ll = totalLogLikelihood(model, sequences);
    if (!Number.isFinite(ll)) {
      throw new EngineError(
        `Baum–Welch stopped at iteration ${iterations}: the current parameters assign probability zero to the training data, so the log-likelihood is not a number that can be improved. This usually means a symbol that no state can emit; add smoothing or remove the symbol.`,
        'impossible',
      );
    }
    history.push(ll);
    if (it > 0) {
      const drop = previous - ll;
      if (drop > violation) violation = drop;
      // A tiny negative step is floating-point noise; anything larger is a bug
      // in the E or M step, because EM cannot decrease this quantity.
      if (drop > 1e-6 * Math.max(1, Math.abs(previous))) {
        throw new EngineError(
          `Baum–Welch log-likelihood decreased at iteration ${iterations}, from ${previous.toPrecision(12)} to ${ll.toPrecision(12)} (a drop of ${drop.toPrecision(6)}). EM is mathematically guaranteed never to decrease the log-likelihood, so this is a defect in the implementation, not a property of the data. No parameters are returned.`,
          'monotonicity',
        );
      }
      if (Math.abs(ll - previous) < tolerance) {
        converged = true;
        previous = ll;
        break;
      }
    }
    previous = ll;
    const acc = emptyAccumulators(model.stateNames.length, model.emission);
    for (const seq of sequences) accumulate(acc, model, seq);
    const next = reestimate(model, acc, sequences, smoothing);
    validateHmm(next);
    model = next;
    yield iterations;
  }
  return { model, run: { history, iterations, converged, finalLogLikelihood: previous }, violation };
}

/**
 * Baum–Welch with random restarts.
 *
 * `template` fixes the emission family and, for discrete emissions, the
 * alphabet. `states` fixes the number of hidden states, which EM cannot learn.
 */
export function* baumWelchSteps(
  sequences: number[][],
  states: number,
  template: EmissionModel,
  options: BaumWelchOptions = {},
): Generator<JobProgress, BaumWelchResult, void> {
  if (!sequences.length) throw new EngineError('Baum–Welch needs at least one observation sequence.', 'required');
  if (!Number.isInteger(states) || states < 1) throw new EngineError('The number of hidden states must be a whole number of 1 or more.', 'range');
  const maxIterations = options.maxIterations ?? 200;
  const tolerance = options.tolerance ?? 1e-8;
  const restarts = Math.max(1, options.restarts ?? 1);
  const smoothing = options.smoothing ?? 0;
  if (smoothing < 0) throw new EngineError('Smoothing must be 0 or greater.', 'range');
  const rng = new Random(options.seed ?? 'baum-welch');
  // Validate the data against the template before any iteration, so an unknown
  // symbol is named rather than silently given probability zero.
  const probe: HmmModel = options.start ?? randomStart(states, template, sequences, rng);
  validateHmm(probe);
  for (let s = 0; s < sequences.length; s++) {
    try {
      validateObservations(probe, sequences[s]);
    } catch (e) {
      if (e instanceof EngineError) throw new EngineError(e.issues.map((i) => ({ ...i, message: `Sequence ${s + 1}: ${i.message}` })));
      throw e;
    }
  }
  const runs: BaumWelchRun[] = [];
  let best: HmmModel | null = null;
  let bestLl = -Infinity;
  let bestRestart = 0;
  let worst = 0;
  const totalIterations = restarts * maxIterations;
  let doneIterations = 0;
  for (let r = 0; r < restarts; r++) {
    const start = r === 0 && options.start ? options.start : randomStart(states, template, sequences, rng);
    const inner = runEmSteps(start, sequences, maxIterations, tolerance, smoothing);
    let step = inner.next();
    while (!step.done) {
      yield { completed: doneIterations + step.value, total: totalIterations, label: `Restart ${r + 1} of ${restarts}, iteration ${step.value}` };
      step = inner.next();
    }
    const out = step.value;
    doneIterations += out.run.iterations;
    runs.push(out.run);
    if (out.violation > worst) worst = out.violation;
    if (out.run.finalLogLikelihood > bestLl) {
      bestLl = out.run.finalLogLikelihood;
      best = out.model;
      bestRestart = r;
    }
  }
  if (!best || !Number.isFinite(bestLl)) {
    throw new EngineError('No Baum–Welch restart produced a usable model: every run ended with a non-finite log-likelihood.', 'numerical');
  }
  const bestRun = runs[bestRestart];
  const warnings: string[] = [];
  if (!bestRun.converged) {
    warnings.push(
      `The best restart did not converge: after ${bestRun.iterations} iterations the log-likelihood was still moving by more than the tolerance of ${tolerance}. The parameters returned are the last iterate, not a converged solution — raise maxIterations before using them.`,
    );
  }
  const spread = Math.max(...runs.map((r) => r.finalLogLikelihood)) - Math.min(...runs.map((r) => r.finalLogLikelihood));
  if (restarts > 1 && spread > 1e-4) {
    warnings.push(
      `The ${restarts} restarts ended at log-likelihoods spanning ${spread.toPrecision(4)}, so this likelihood surface has multiple local optima. The reported model is the best one found, which is not necessarily the global optimum.`,
    );
  }
  return {
    model: best,
    logLikelihood: bestLl,
    runs,
    bestRestart,
    converged: bestRun.converged,
    iterations: bestRun.iterations,
    worstMonotonicityViolation: worst,
    exactness: 'numerical',
    method: `Baum–Welch (EM) with scaled forward–backward in log space, ${restarts} random restart(s), up to ${maxIterations} iterations, convergence tolerance ${tolerance}. The log-likelihood is checked for monotonic increase at every iteration.`,
    warnings,
    limitations: [
      'Label switching: the hidden states have no inherent identity. Any permutation of the states, applied consistently to the initial distribution, the transition matrix and the emissions, gives exactly the same likelihood. "State 1" in this fit has no relationship to "State 1" in another fit of the same data, and the names are arbitrary labels, not findings.',
      'The number of hidden states is not identifiable from the data alone. The likelihood can always be increased by adding states, so the model order has to come from subject knowledge or from a criterion that penalises complexity — and those criteria are weak guidance here.',
      'EM converges to a local optimum of the likelihood. Restarts reduce but do not eliminate the risk of reporting a poor one.',
      'These parameters are point estimates with no interval attached. Their uncertainty is not reported here, and it is often large when sequences are short.',
    ],
  };
}

/**
 * Baum–Welch with random restarts, driven to completion on the calling thread.
 * Prefer `baumWelchSteps` (or the `hmm.baum-welch` engine job) on the main
 * thread: this blocks until the fit finishes.
 */
export function baumWelch(
  sequences: number[][],
  states: number,
  template: EmissionModel,
  options: BaumWelchOptions = {},
): BaumWelchResult {
  const steps = baumWelchSteps(sequences, states, template, options);
  let s = steps.next();
  while (!s.done) s = steps.next();
  return s.value;
}

export interface SupervisedResult {
  model: HmmModel;
  /** Raw observed transition counts, before smoothing. */
  transitionCounts: Matrix;
  /** Total transitions observed out of each state. */
  transitionRowTotals: number[];
  /** Raw observed emission counts (discrete) or occupancy counts (Gaussian). */
  emissionCounts: Matrix | null;
  stateCounts: number[];
  initialCounts: number[];
  smoothing: number;
  /** Rows estimated from so little data that the estimate means little. */
  sparseRows: { state: number; name: string; total: number }[];
  exactness: Exactness;
  method: string;
  limitations: string[];
}

/**
 * Maximum-likelihood estimation from labelled state sequences: just counting,
 * with Laplace smoothing. The per-row counts are reported because a row
 * estimated from three transitions looks exactly like a row estimated from
 * thirty thousand once it has been normalised.
 */
export function supervisedFit(
  stateSequences: number[][],
  observationSequences: number[][],
  states: number,
  template: EmissionModel,
  options: { smoothing?: number; stateNames?: string[]; sparseThreshold?: number } = {},
): SupervisedResult {
  const smoothing = options.smoothing ?? 1;
  if (smoothing < 0) throw new EngineError('Smoothing must be 0 or greater.', 'range');
  if (!Number.isInteger(states) || states < 1) throw new EngineError('The number of hidden states must be a whole number of 1 or more.', 'range');
  if (stateSequences.length !== observationSequences.length) {
    throw new EngineError(`There are ${stateSequences.length} labelled state sequences but ${observationSequences.length} observation sequences; they must correspond one to one.`, 'shape');
  }
  if (!stateSequences.length) throw new EngineError('Supervised fitting needs at least one labelled sequence.', 'required');
  const stateNames = options.stateNames ?? Array.from({ length: states }, (_, i) => `State ${i + 1}`);
  const symbols = template.kind === 'discrete' ? template.symbols.length : 0;
  const transitionCounts: Matrix = Array.from({ length: states }, () => new Array<number>(states).fill(0));
  const emissionCounts: Matrix | null = template.kind === 'discrete' ? Array.from({ length: states }, () => new Array<number>(symbols).fill(0)) : null;
  const stateCounts = new Array<number>(states).fill(0);
  const initialCounts = new Array<number>(states).fill(0);
  const sum = new Array<number>(states).fill(0);
  const sumSq = new Array<number>(states).fill(0);
  for (let s = 0; s < stateSequences.length; s++) {
    const q = stateSequences[s];
    const o = observationSequences[s];
    if (q.length !== o.length) {
      throw new EngineError(`Sequence ${s + 1} has ${q.length} state labels but ${o.length} observations.`, 'shape');
    }
    if (!q.length) throw new EngineError(`Sequence ${s + 1} is empty.`, 'required');
    for (let t = 0; t < q.length; t++) {
      const st = q[t];
      if (!Number.isInteger(st) || st < 0 || st >= states) {
        throw new EngineError(`Sequence ${s + 1} has state label ${st} at index ${t}, which is not one of the ${states} hidden states.`, 'range');
      }
      if (template.kind === 'discrete') {
        const ob = o[t];
        if (!Number.isInteger(ob) || ob < 0 || ob >= symbols) {
          throw new EngineError(`Sequence ${s + 1} has observation ${ob} at index ${t}, which is not one of the ${symbols} symbols in the alphabet.`, 'alphabet');
        }
        emissionCounts![st][ob] += 1;
      } else {
        if (!Number.isFinite(o[t])) throw new EngineError(`Sequence ${s + 1} has observation ${o[t]} at index ${t}, which is not a finite number.`, 'range');
        sum[st] += o[t];
        sumSq[st] += o[t] * o[t];
      }
      stateCounts[st] += 1;
      if (t === 0) initialCounts[st] += 1;
      if (t + 1 < q.length) transitionCounts[st][q[t + 1]] += 1;
    }
  }
  const smooth = (row: number[]): number[] => {
    const out = row.map((v) => v + smoothing);
    const total = out.reduce((a, b) => a + b, 0);
    if (!(total > 0)) {
      throw new EngineError('A transition row has no observed transitions and no smoothing, so its probabilities are undefined. Use smoothing greater than 0, or supply more data.', 'undefined');
    }
    return out.map((v) => v / total);
  };
  let emission: EmissionModel;
  if (template.kind === 'discrete' && emissionCounts) {
    emission = { kind: 'discrete', symbols: template.symbols, matrix: emissionCounts.map(smooth) };
  } else {
    const mean = new Array<number>(states);
    const variance = new Array<number>(states);
    for (let i = 0; i < states; i++) {
      const c = stateCounts[i];
      if (c < 2) {
        throw new EngineError(`State ${i + 1} ("${stateNames[i]}") was observed ${c} time(s), which is not enough to estimate a Gaussian mean and variance. Smoothing cannot substitute for data here.`, 'insufficient');
      }
      mean[i] = sum[i] / c;
      variance[i] = Math.max(VARIANCE_FLOOR, sumSq[i] / c - mean[i] * mean[i]);
    }
    emission = { kind: 'gaussian', mean, variance };
  }
  const model: HmmModel = { stateNames, initial: smooth(initialCounts), transition: transitionCounts.map(smooth), emission };
  validateHmm(model);
  const threshold = options.sparseThreshold ?? 10 * states;
  const transitionRowTotals = transitionCounts.map((r) => r.reduce((a, b) => a + b, 0));
  const sparseRows = transitionRowTotals
    .map((total, i) => ({ state: i, name: stateNames[i], total }))
    .filter((r) => r.total < threshold);
  return {
    model,
    transitionCounts,
    transitionRowTotals,
    emissionCounts,
    stateCounts,
    initialCounts,
    smoothing,
    sparseRows,
    exactness: 'empirical',
    method: `Maximum likelihood by counting observed transitions and emissions, with Laplace smoothing of ${smoothing} added to every cell. Every probability below is an observed frequency, not a theoretical value.`,
    limitations: [
      'These are empirical estimates. Their sampling error is governed by the per-row counts, which are reported alongside: a row with a handful of transitions carries almost no information once it has been normalised into probabilities that look just as definite as the well-estimated rows.',
      sparseRows.length
        ? `${sparseRows.length} transition row(s) were estimated from fewer than ${threshold} observed transitions: ${sparseRows.map((r) => `${r.name} (${r.total})`).join(', ')}. Treat those rows as essentially unknown.`
        : 'Every transition row has a reasonable number of observed transitions behind it.',
      `Smoothing of ${smoothing} pulls every estimate towards uniform. It prevents a zero probability for an event that simply has not been seen yet, at the cost of biasing the estimates — with little data that bias is substantial.`,
      'This fit assumes the labels are correct. Mislabelled states bias the transition matrix in ways this procedure cannot detect.',
    ],
  };
}

export interface ModelSelectionRow {
  states: number;
  logLikelihood: number;
  freeParameters: number;
  aic: number;
  bic: number;
  converged: boolean;
}

export interface ModelSelectionResult {
  rows: ModelSelectionRow[];
  bestByAic: number;
  bestByBic: number;
  /** Number of observations used for the BIC sample-size term. */
  observationCount: number;
  exactness: Exactness;
  method: string;
  warnings: string[];
}

/** Free parameters of an HMM: π, A and the emission model. */
export function freeParameterCount(model: HmmModel): number {
  const n = model.stateNames.length;
  return n - 1 + n * (n - 1) + emissionOps(model.emission).freeParameters();
}

/**
 * Fit a range of state counts and tabulate AIC and BIC.
 *
 * The caveat is the whole point: the log-likelihood rises monotonically with
 * the number of states, so "the fit got better" is not evidence of anything.
 * AIC and BIC penalise that, but their regularity conditions do not hold for
 * HMMs (the boundary of the parameter space is reachable, and states can be
 * duplicated), so the penalties are heuristic here rather than justified.
 */
export function selectStateCount(
  sequences: number[][],
  candidates: number[],
  template: EmissionModel,
  options: BaumWelchOptions = {},
): ModelSelectionResult {
  if (!candidates.length) throw new EngineError('Model selection needs at least one candidate number of states.', 'required');
  const observationCount = sequences.reduce((a, s) => a + s.length, 0);
  if (!observationCount) throw new EngineError('Model selection needs at least one observation.', 'required');
  const rows: ModelSelectionRow[] = [];
  for (const k of candidates) {
    const fit = baumWelch(sequences, k, template, { ...options, seed: `${options.seed ?? 'select'}-${k}` });
    const p = freeParameterCount(fit.model);
    rows.push({
      states: k,
      logLikelihood: fit.logLikelihood,
      freeParameters: p,
      aic: 2 * p - 2 * fit.logLikelihood,
      bic: p * Math.log(observationCount) - 2 * fit.logLikelihood,
      converged: fit.converged,
    });
  }
  const bestByAic = rows.reduce((a, b) => (b.aic < a.aic ? b : a)).states;
  const bestByBic = rows.reduce((a, b) => (b.bic < a.bic ? b : a)).states;
  const warnings = [
    'The log-likelihood always improves as states are added, because a larger model contains the smaller one. Comparing likelihoods alone will always pick the largest candidate and tells you nothing.',
    'AIC and BIC are weak guidance for hidden Markov models. Their derivations assume the maximum likelihood estimate sits in the interior of the parameter space and that the parameters are identifiable; with hidden states, neither holds — a redundant state can sit on the boundary or duplicate another. Treat the ranking as a hint, not a decision.',
    'AIC and BIC disagree systematically: BIC penalises parameters more as the sample grows, so it usually chooses fewer states. If they disagree here, that disagreement is the honest answer.',
    'Each candidate is a separate EM fit that may have landed in a different local optimum, which adds noise to the comparison that has nothing to do with model order. Use several restarts.',
  ];
  if (bestByAic !== bestByBic) warnings.push(`AIC chooses ${bestByAic} states and BIC chooses ${bestByBic}. There is no basis in the data for preferring one of these answers.`);
  if (!rows.every((r) => r.converged)) warnings.push('At least one candidate fit did not converge, so its likelihood — and therefore its criterion value — is not the maximum for that model order.');
  return {
    rows,
    bestByAic,
    bestByBic,
    observationCount,
    exactness: 'numerical',
    method: 'Baum–Welch fit for each candidate number of states; AIC = 2p − 2logL and BIC = p·log(n) − 2logL, with p counting the free parameters of π, A and the emission model.',
    warnings,
  };
}

/**
 * Canonical state ordering, for comparing two fits of the same data.
 *
 * EM cannot distinguish a model from a relabelling of its states, so two fits
 * are only comparable after both have been put in a fixed order. Sorting by
 * the emission parameters is the usual convention.
 */
export function canonicaliseStates(model: HmmModel): { model: HmmModel; permutation: number[] } {
  const n = model.stateNames.length;
  const key = (i: number): number => {
    const e = model.emission;
    if (e.kind === 'gaussian') return e.mean[i];
    // Discrete: order by the expected symbol index under the state's emissions.
    let s = 0;
    for (let k = 0; k < e.symbols.length; k++) s += k * e.matrix[i][k];
    return s;
  };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => key(a) - key(b));
  const emission: EmissionModel =
    model.emission.kind === 'discrete'
      ? { kind: 'discrete', symbols: model.emission.symbols, matrix: order.map((i) => (model.emission as DiscreteEmission).matrix[i].slice()) }
      : { kind: 'gaussian', mean: order.map((i) => (model.emission as GaussianEmission).mean[i]), variance: order.map((i) => (model.emission as GaussianEmission).variance[i]) };
  return {
    model: {
      stateNames: order.map((i) => model.stateNames[i]),
      initial: order.map((i) => model.initial[i]),
      transition: order.map((i) => order.map((j) => model.transition[i][j])),
      emission,
    },
    permutation: order,
  };
}

/** Log-likelihood of data under a fixed model, summed over sequences. */
export function sequenceLogLikelihood(model: HmmModel, sequences: number[][]): number {
  return totalLogLikelihood(model, sequences);
}

/** Backward pass exposed for callers that want β without γ. */
export { backward };
