/**
 * Channel capacity, Fisher information and Bayesian experimental design.
 *
 * These are the "which measurement should I take?" tools. Channel capacity
 * bounds what any measurement through a noisy process can tell you; Fisher
 * information bounds how precisely a parameter can be estimated from it
 * (Cramér–Rao); expected information gain says which of several proposed
 * experiments is worth doing.
 */
import { EngineError } from '../core/result';
import type { Explanation } from '../core/result';
import { stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { BASE_LABEL, fromNats, resolveBase, type BaseOptions, type LogBase } from './types';
import { entropyNats } from './entropy';
import { validateDistribution } from './distribution';

/* ------------------------------------------------------------------ */
/* Blahut–Arimoto                                                     */
/* ------------------------------------------------------------------ */

export interface CapacityResult {
  /** Channel capacity in the requested unit. */
  capacity: number;
  base: LogBase;
  baseLabel: string;
  /** The capacity-achieving input distribution. */
  optimalInput: number[];
  iterations: number;
  /** Blahut–Arimoto's own upper/lower bound gap at the final iterate, in nats. */
  boundGap: number;
  tolerance: number;
  converged: boolean;
  exactness: 'numerical';
  explanation: Explanation;
}

/**
 * Capacity of a discrete memoryless channel by the Blahut–Arimoto algorithm.
 *
 * `channel[x][y] = P(Y = y | X = x)`; each row must be a probability vector.
 * The algorithm alternates between the optimal "reverse" channel and the input
 * distribution, and is guaranteed to converge monotonically to the capacity.
 * It also supplies its own certificate: at every iterate the quantities
 *   max_x D(W(·|x) ‖ q)  and  Σ r(x) D(W(·|x) ‖ q)
 * bracket the capacity. The gap between them is returned, and if it has not
 * been driven below the tolerance the function REFUSES rather than returning
 * the current iterate as though it were the answer.
 */
export function channelCapacity(
  channel: readonly ArrayLike<number>[],
  options: BaseOptions & { tolerance?: number; maxIterations?: number } = {},
): CapacityResult {
  const base = resolveBase(options);
  const tol = options.tolerance ?? 1e-12;
  const maxIter = options.maxIterations ?? 20000;
  if (!(tol > 0)) throw new EngineError(`tolerance must be > 0; got ${tol}.`, 'range');
  if (!Number.isInteger(maxIter) || maxIter < 1) throw new EngineError(`maxIterations must be a positive whole number; got ${maxIter}.`, 'integer');
  const nx = channel.length;
  if (nx === 0) throw new EngineError('The channel has no inputs.', 'empty');
  const ny = channel[0].length;
  if (ny === 0) throw new EngineError('The channel has no outputs.', 'empty');
  const W: number[][] = [];
  for (let x = 0; x < nx; x++) {
    if (channel[x].length !== ny) {
      throw new EngineError(`Channel row ${x} has ${channel[x].length} outputs but row 0 has ${ny}. Every row must list the same outputs.`, 'shape');
    }
    // Each row is a conditional distribution over the outputs; a row that does
    // not sum to 1 is a specification error, reported with its actual sum.
    W.push(validateDistribution(channel[x], { field: `channel row ${x} (P(Y|X=${x}))` }).p);
  }
  // Uniform start: the algorithm converges from any strictly positive input.
  let r = new Array<number>(nx).fill(1 / nx);
  let iterations = 0;
  let boundGap = Infinity;
  let lower = 0;
  for (; iterations < maxIter; iterations++) {
    // q(y) = Σ r(x) W(y|x)
    const q = new Array<number>(ny).fill(0);
    for (let x = 0; x < nx; x++) {
      if (r[x] === 0) continue;
      for (let y = 0; y < ny; y++) q[y] += r[x] * W[x][y];
    }
    // d(x) = D(W(·|x) ‖ q) in nats.
    const d = new Array<number>(nx).fill(0);
    for (let x = 0; x < nx; x++) {
      const terms: number[] = [];
      for (let y = 0; y < ny; y++) {
        const w = W[x][y];
        if (w === 0) continue; // 0·log0 = 0
        if (q[y] === 0) {
          // Only reachable if r(x) = 0 for every x that can emit y; the input
          // update below will restore positive mass, so treat as a large but
          // finite pull rather than Infinity.
          terms.push(w * 700);
          continue;
        }
        terms.push(w * (Math.log(w) - Math.log(q[y])));
      }
      d[x] = stableSum(terms);
    }
    lower = stableSum(r.map((rx, x) => rx * d[x]));
    const upper = Math.max(...d);
    boundGap = upper - lower;
    if (boundGap <= tol) break;
    // r(x) ∝ r(x)·exp(d(x)), done with a log-sum-exp shift.
    const logits = r.map((rx, x) => (rx > 0 ? Math.log(rx) + d[x] : -Infinity));
    let mx = -Infinity;
    for (const v of logits) if (v > mx) mx = v;
    if (!Number.isFinite(mx)) {
      throw new EngineError('The Blahut–Arimoto iteration collapsed: every input weight underflowed to zero. Check the channel matrix.', 'numerical');
    }
    let z = 0;
    const next = new Array<number>(nx);
    for (let x = 0; x < nx; x++) {
      next[x] = Math.exp(logits[x] - mx);
      z += next[x];
    }
    for (let x = 0; x < nx; x++) next[x] /= z;
    r = next;
  }
  const converged = boundGap <= tol;
  if (!converged) {
    throw new EngineError(
      `The Blahut–Arimoto algorithm did not converge in ${maxIter} iterations: the gap between its own upper and lower bounds on the ` +
        `capacity is still ${boundGap.toExponential(3)} nats, which exceeds the tolerance ${tol.toExponential(3)}. ` +
        'No capacity is reported — the current iterate is a lower bound only, not the capacity.',
      'numerical',
    );
  }
  return {
    capacity: fromNats(lower, base),
    base,
    baseLabel: BASE_LABEL[base],
    optimalInput: r,
    iterations,
    boundGap,
    tolerance: tol,
    converged,
    exactness: 'numerical',
    explanation: {
      method: 'Channel capacity by the Blahut–Arimoto algorithm',
      formula: 'C = max_r I(X;Y);  alternate q(y) = Σ r(x)W(y|x) and r(x) ∝ r(x)exp D(W(·|x)‖q)',
      steps: [
        { label: 'Inputs × outputs', value: `${nx} × ${ny}` },
        { label: 'Iterations', value: String(iterations) },
        { label: 'Capacity', value: `${fromNats(lower, base).toPrecision(12)} ${base}` },
        { label: 'Final bound gap (nats)', value: boundGap.toExponential(3) },
      ],
      assumptions: ['The channel is discrete, memoryless, and used without feedback; each row is the conditional distribution of the output given that input.'],
      limitations: [
        'The capacity is the supremum over input distributions of the mutual information. It is an asymptotic limit achievable only with arbitrarily long codes, not a rate achievable per symbol with a simple scheme.',
        'The value is NUMERICAL: the algorithm converges monotonically but not in finitely many steps. The returned bound gap is the certificate; non-convergence is refused rather than reported as a capacity.',
        'The capacity-achieving input distribution need not be unique.',
      ],
      exactness: 'numerical',
    },
  };
}

/** Exact capacity of the binary symmetric channel: C = 1 − H(p) bits. */
export function binarySymmetricCapacity(crossover: number, options: BaseOptions = {}): { capacity: number; base: LogBase; exactness: 'exact'; formula: string } {
  const base = resolveBase(options);
  if (!Number.isFinite(crossover) || crossover < 0 || crossover > 1) {
    throw new EngineError(`The crossover probability must lie in [0, 1]; got ${String(crossover)}.`, 'range');
  }
  const hNats = entropyNats([crossover, 1 - crossover]);
  return {
    capacity: fromNats(Math.LN2 - hNats, base),
    base,
    exactness: 'exact',
    formula: 'C = 1 − H(p) bits, with H the binary entropy function',
  };
}

/** Channel matrix of a binary symmetric channel with the given crossover probability. */
export function binarySymmetricChannel(crossover: number): number[][] {
  if (!Number.isFinite(crossover) || crossover < 0 || crossover > 1) {
    throw new EngineError(`The crossover probability must lie in [0, 1]; got ${String(crossover)}.`, 'range');
  }
  return [
    [1 - crossover, crossover],
    [crossover, 1 - crossover],
  ];
}

/* ------------------------------------------------------------------ */
/* Fisher information                                                 */
/* ------------------------------------------------------------------ */

export interface FisherResult {
  /** I(θ) for one observation. */
  fisherInformation: number;
  parameter: string;
  distribution: string;
  exactness: 'exact' | 'numerical';
  formula: string;
  /** The numerical value, as a cross-check when a closed form was used. */
  numerical?: number;
  /** Cramér–Rao lower bound on the variance of any unbiased estimator from n observations. */
  cramerRaoBound: (n: number) => number;
  /** √I(θ) — the unnormalised Jeffreys prior density at θ. */
  jeffreysDensity: number;
  explanation: Explanation;
}

/** Analytic Fisher information for one observation, where it is known. */
function analyticFisher(id: string, param: string, p: Params): { value: number; formula: string } | null {
  switch (`${id}.${param}`) {
    case 'normal.mu':
      return { value: 1 / (p.sigma * p.sigma), formula: 'I(μ) = 1/σ²' };
    case 'normal.sigma':
      return { value: 2 / (p.sigma * p.sigma), formula: 'I(σ) = 2/σ²' };
    case 'bernoulli.p':
      return { value: 1 / (p.p * (1 - p.p)), formula: 'I(p) = 1/[p(1−p)]' };
    case 'binomial.p':
      return { value: p.n / (p.p * (1 - p.p)), formula: 'I(p) = n/[p(1−p)]' };
    case 'poisson.lambda':
      return { value: 1 / p.lambda, formula: 'I(λ) = 1/λ' };
    case 'exponential.lambda':
      return { value: 1 / (p.lambda * p.lambda), formula: 'I(λ) = 1/λ²' };
    case 'geometric.p':
      return { value: 1 / (p.p * p.p * (1 - p.p)), formula: 'I(p) = 1/[p²(1−p)]' };
    default:
      return null;
  }
}

/**
 * Fisher information I(θ) = E[(∂ log f(X;θ)/∂θ)²] for one observation of a
 * registry distribution, analytic where known and by numerical
 * differentiation plus summation/quadrature otherwise.
 */
export function fisherInformation(
  id: string,
  param: string,
  params: Params,
  options: { step?: number; crossCheck?: boolean; quadraturePoints?: number } = {},
): FisherResult {
  const def = getDistribution(id);
  if (!def.params.some((s) => s.key === param)) {
    throw new EngineError(
      `"${param}" is not a parameter of the ${def.name} distribution. Its parameters are: ${def.params.map((s) => s.key).join(', ')}.`,
      'unknown',
    );
  }
  const theta = params[param];
  if (!Number.isFinite(theta)) throw new EngineError(`Parameter "${param}" must be a finite number.`, 'finite');

  // Central difference of the log density in θ. The step is scaled to θ so the
  // relative truncation and rounding errors balance near h ≈ ε^(1/3)|θ|.
  const h = options.step ?? Math.max(1e-6, Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(theta)));
  const scoreSq = (x: number): number => {
    const up = { ...params, [param]: theta + h };
    const dn = { ...params, [param]: theta - h };
    const lu = def.logPdf(x, up);
    const ld = def.logPdf(x, dn);
    if (!Number.isFinite(lu) || !Number.isFinite(ld)) return 0;
    const s = (lu - ld) / (2 * h);
    return s * s;
  };

  let numerical: number;
  if (def.kind === 'discrete') {
    const s = def.support(params);
    const lo = Math.max(s.min, def.quantile(1e-12, params));
    const hi = Math.min(s.max, def.quantile(1 - 1e-12, params));
    const terms: number[] = [];
    for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) {
      const pk = def.pdf(k, params);
      if (!(pk > 0)) continue;
      terms.push(pk * scoreSq(k));
    }
    numerical = stableSum(terms);
  } else {
    // Quantile-space average: E[g(X)] = ∫₀¹ g(Q(u)) du, which needs no
    // truncation decision and handles heavy tails.
    const m = options.quadraturePoints ?? 20000;
    const terms = new Array<number>(m);
    for (let i = 0; i < m; i++) {
      const u = (i + 0.5) / m;
      terms[i] = scoreSq(def.quantile(u, params)) / m;
    }
    numerical = stableSum(terms);
  }

  const analytic = analyticFisher(id, param, params);
  const value = analytic ? analytic.value : numerical;
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new EngineError(
      `The Fisher information for ${def.name}.${param} evaluated to ${String(value)}, which cannot be used: the Cramér–Rao bound would be ` +
        'infinite or undefined. The parameter is probably at a boundary of its range (for example p = 0 or p = 1).',
      'numerical',
    );
  }
  return {
    fisherInformation: value,
    parameter: param,
    distribution: def.name,
    exactness: analytic ? 'exact' : 'numerical',
    formula: analytic ? analytic.formula : 'I(θ) = E[(∂ log f(X;θ)/∂θ)²], central difference in θ with numerical expectation',
    numerical: options.crossCheck === false && analytic ? undefined : numerical,
    cramerRaoBound: (n: number) => {
      if (!Number.isInteger(n) || n < 1) throw new EngineError(`The sample size must be a positive whole number; got ${n}.`, 'integer');
      return 1 / (n * value);
    },
    jeffreysDensity: Math.sqrt(value),
    explanation: {
      method: analytic ? `Fisher information for ${def.name} (${param}), analytic` : `Fisher information for ${def.name} (${param}), numerical`,
      formula: analytic ? analytic.formula : 'I(θ) = E[(∂/∂θ log f(X;θ))²]',
      steps: [
        { label: 'I(θ) per observation', value: value.toPrecision(10) },
        ...(analytic ? [{ label: 'Numerical cross-check', value: numerical.toPrecision(10) }] : []),
        { label: 'Cramér–Rao bound, n = 1', value: (1 / value).toPrecision(10) },
        { label: 'Jeffreys prior density √I(θ)', value: Math.sqrt(value).toPrecision(10) },
      ],
      assumptions: [
        'The observations are independent and identically distributed, and the usual regularity conditions hold (the support does not depend on θ, and differentiation under the integral is valid).',
      ],
      limitations: [
        'The Cramér–Rao bound applies to UNBIASED estimators. A biased estimator can have smaller variance, and for small samples a biased estimator often has smaller mean squared error.',
        'The bound is a lower bound on variance, not an achievable one: only efficient estimators attain it, and in finite samples most do not.',
        'Where the regularity conditions fail — a support that moves with θ, such as the uniform upper bound — the bound does not hold at all.',
        'The Jeffreys prior derived from √I(θ) is improper for many models (it does not integrate to 1 over an unbounded range) and must be normalised over a stated range before use.',
      ],
      exactness: analytic ? 'exact' : 'numerical',
    },
  };
}

export interface JeffreysPrior {
  /** Grid of parameter values. */
  theta: number[];
  /** Normalised density √I(θ)/∫√I on the grid. */
  density: number[];
  /** The normalising integral ∫√I(θ)dθ over the grid range. */
  normalisingConstant: number;
  range: { lower: number; upper: number };
  /** True when the integral is finite over the given range; the prior is improper on an unbounded range for many models. */
  proper: boolean;
  exactness: 'numerical';
  explanation: Explanation;
}

/**
 * Jeffreys prior π(θ) ∝ √I(θ), evaluated on a grid and normalised over the
 * given range. This is the information-geometric answer to "what is an
 * uninformative prior?": it is the unique prior invariant under
 * reparameterisation, which is why it is the principled default where one is
 * wanted.
 */
export function jeffreysPrior(
  id: string,
  param: string,
  baseParams: Params,
  range: { lower: number; upper: number },
  options: { points?: number } = {},
): JeffreysPrior {
  const { lower, upper } = range;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !(upper > lower)) {
    throw new EngineError(
      `The Jeffreys prior must be normalised over a finite range with upper > lower; got [${String(lower)}, ${String(upper)}]. ` +
        'For an unbounded parameter the prior is usually improper, so a range must be chosen and stated.',
      'range',
    );
  }
  const m = options.points ?? 401;
  if (!Number.isInteger(m) || m < 3) throw new EngineError(`points must be a whole number ≥ 3; got ${m}.`, 'integer');
  const h = (upper - lower) / (m - 1);
  const theta: number[] = [];
  const root: number[] = [];
  for (let i = 0; i < m; i++) {
    const t = lower + i * h;
    theta.push(t);
    let v: number;
    try {
      v = fisherInformation(id, param, { ...baseParams, [param]: t }, { crossCheck: false, quadraturePoints: 2000 }).jeffreysDensity;
    } catch {
      // At a boundary the information diverges; mark it and interpolate from
      // the neighbours rather than inventing a value.
      v = NaN;
    }
    root.push(v);
  }
  for (let i = 0; i < m; i++) {
    if (Number.isNaN(root[i])) {
      const prev = i > 0 ? root[i - 1] : NaN;
      const next = i + 1 < m ? root[i + 1] : NaN;
      root[i] = Number.isFinite(prev) && Number.isFinite(next) ? (prev + next) / 2 : Number.isFinite(prev) ? prev : Number.isFinite(next) ? next : 0;
    }
  }
  // Trapezoidal rule.
  let z = 0;
  for (let i = 0; i < m - 1; i++) z += ((root[i] + root[i + 1]) / 2) * h;
  const proper = Number.isFinite(z) && z > 0;
  if (!proper) {
    throw new EngineError(
      `The Jeffreys prior could not be normalised over [${lower}, ${upper}]: the integral of √I(θ) evaluated to ${String(z)}. ` +
        'Choose a range where the Fisher information is finite and positive.',
      'numerical',
    );
  }
  return {
    theta,
    density: root.map((v) => v / z),
    normalisingConstant: z,
    range: { lower, upper },
    proper,
    exactness: 'numerical',
    explanation: {
      method: 'Jeffreys prior from the Fisher information',
      formula: 'π(θ) ∝ √I(θ)',
      steps: [
        { label: 'Range', value: `[${lower}, ${upper}]` },
        { label: 'Grid points', value: String(m) },
        { label: '∫√I(θ) dθ', value: z.toPrecision(10) },
      ],
      assumptions: ['The remaining parameters of the distribution are held at the supplied values.'],
      limitations: [
        'The Jeffreys prior is invariant under reparameterisation, which is its whole justification, but it is NOT "no information": it is a specific, sometimes surprising, distribution. For a Bernoulli p it is Beta(½,½), which concentrates near 0 and 1.',
        'It is improper for many models over their natural range, so the range used for normalisation is part of the answer and is reported above.',
        'In more than one dimension the Jeffreys prior is often considered a poor choice; reference priors are preferred.',
      ],
      exactness: 'numerical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Expected information gain                                          */
/* ------------------------------------------------------------------ */

export interface DesignOption {
  name: string;
  /**
   * likelihood[i][j] = P(outcome j | θ = θ_i) for this design. Each row must be
   * a probability vector over the design's possible outcomes.
   */
  likelihood: readonly ArrayLike<number>[];
}

export interface DesignEvaluation {
  name: string;
  /** EIG = I(θ; Y) = E_Y[ D_KL(posterior ‖ prior) ]. */
  expectedInformationGain: number;
  /** Prior entropy H(θ). */
  priorEntropy: number;
  /** Expected posterior entropy E_Y[H(θ|Y)] — always ≤ prior entropy. */
  expectedPosteriorEntropy: number;
  /** EIG / H(θ): the share of the prior uncertainty the experiment is expected to remove. */
  fractionOfPriorEntropy: number;
  /** Per-outcome breakdown. */
  outcomes: { index: number; probability: number; posterior: number[]; klFromPrior: number }[];
}

export interface DesignResult {
  base: LogBase;
  baseLabel: string;
  priorEntropy: number;
  evaluations: DesignEvaluation[];
  best: string;
  exactness: 'exact';
  explanation: Explanation;
}

/**
 * Bayesian experimental design: the expected information gain of each proposed
 * experiment, EIG = E_Y[D_KL(p(θ|Y) ‖ p(θ))] = I(θ; Y).
 *
 * This is the rigorous version of "which measurement should I take next?". The
 * expectation is over the outcomes the design could produce, weighted by the
 * prior predictive — so it is computable BEFORE the experiment is run, which is
 * the point.
 */
export function expectedInformationGain(
  prior: ArrayLike<number>,
  designs: readonly DesignOption[],
  options: BaseOptions = {},
): DesignResult {
  const base = resolveBase(options);
  const pr = validateDistribution(prior, { field: 'prior over θ' }).p;
  if (designs.length === 0) throw new EngineError('No designs were supplied to evaluate.', 'empty');
  const priorEntropyNats = entropyNats(pr);
  const evaluations: DesignEvaluation[] = [];
  for (const design of designs) {
    if (design.likelihood.length !== pr.length) {
      throw new EngineError(
        `Design "${design.name}" gives ${design.likelihood.length} likelihood rows but the prior has ${pr.length} values of θ. ` +
          'There must be one row per possible θ.',
        'shape',
      );
    }
    const ny = design.likelihood[0].length;
    const L: number[][] = [];
    for (let i = 0; i < pr.length; i++) {
      if (design.likelihood[i].length !== ny) {
        throw new EngineError(`Design "${design.name}" row ${i} has ${design.likelihood[i].length} outcomes but row 0 has ${ny}.`, 'shape');
      }
      L.push(validateDistribution(design.likelihood[i], { field: `design "${design.name}" row ${i} (P(Y|θ))` }).p);
    }
    // Prior predictive p(y) = Σ π(θ)P(y|θ).
    const py = new Array<number>(ny).fill(0);
    for (let i = 0; i < pr.length; i++) for (let j = 0; j < ny; j++) py[j] += pr[i] * L[i][j];
    const outcomes: DesignEvaluation['outcomes'] = [];
    const postEntropyTerms: number[] = [];
    const klTerms: number[] = [];
    for (let j = 0; j < ny; j++) {
      if (py[j] === 0) {
        outcomes.push({ index: j, probability: 0, posterior: new Array<number>(pr.length).fill(0), klFromPrior: 0 });
        continue; // an impossible outcome contributes nothing
      }
      const post = pr.map((v, i) => (v * L[i][j]) / py[j]);
      const hPost = entropyNats(post);
      postEntropyTerms.push(py[j] * hPost);
      const klTerm = stableSum(
        post.map((v, i) => (v === 0 || pr[i] === 0 ? 0 : v * (Math.log(v) - Math.log(pr[i])))),
      );
      klTerms.push(py[j] * klTerm);
      outcomes.push({ index: j, probability: py[j], posterior: post, klFromPrior: fromNats(Math.max(0, klTerm), base) });
    }
    const expectedPosterior = stableSum(postEntropyTerms);
    const eig = Math.max(0, stableSum(klTerms));
    evaluations.push({
      name: design.name,
      expectedInformationGain: fromNats(eig, base),
      priorEntropy: fromNats(priorEntropyNats, base),
      expectedPosteriorEntropy: fromNats(expectedPosterior, base),
      fractionOfPriorEntropy: priorEntropyNats > 0 ? eig / priorEntropyNats : 0,
      outcomes,
    });
  }
  evaluations.sort((a, b) => b.expectedInformationGain - a.expectedInformationGain);
  return {
    base,
    baseLabel: BASE_LABEL[base],
    priorEntropy: fromNats(priorEntropyNats, base),
    evaluations,
    best: evaluations[0].name,
    exactness: 'exact',
    explanation: {
      method: 'Expected information gain (Bayesian experimental design)',
      formula: 'EIG = E_Y[D_KL(p(θ|Y) ‖ p(θ))] = I(θ; Y) = H(θ) − E_Y[H(θ|Y)]',
      steps: [
        { label: 'Prior entropy H(θ)', value: `${fromNats(priorEntropyNats, base).toPrecision(10)} ${base}` },
        ...evaluations.map((e) => ({ label: e.name, value: `${e.expectedInformationGain.toPrecision(8)} ${base} expected gain` })),
        { label: 'Best design', value: evaluations[0].name },
      ],
      assumptions: [
        'The prior over θ and the likelihood of each design are both taken as given. The ranking is only as good as they are.',
        'The experiment is evaluated in isolation — a second experiment’s gain depends on the first one’s result.',
      ],
      limitations: [
        'Information gain is not utility. The design that tells you most is not always the one worth running: cost, time and the decision the answer feeds into are not represented here.',
        'The expectation is over the PRIOR predictive. If the prior is wrong the ranking can be wrong.',
        'Expected information gain is always ≥ 0 — on average an experiment cannot increase uncertainty — but a particular OUTCOME can raise the posterior entropy above the prior entropy. The per-outcome breakdown shows this.',
      ],
      exactness: 'exact',
    },
  };
}
