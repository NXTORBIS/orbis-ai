/**
 * Differential entropy of continuous distributions, and maximum-entropy
 * distributions under moment constraints.
 *
 * THE CAVEAT, stated once here and repeated in every returned explanation:
 * differential entropy h(X) = −∫ f ln f dx is NOT the limiting value of the
 * discrete entropy of a finer and finer discretisation. Binning X at width Δ
 * gives H_Δ ≈ h(X) − log Δ, which diverges as Δ → 0. Consequently h(X)
 *   • can be negative (any density concentrated enough that f > 1 somewhere),
 *   • is not invariant under a change of variable: for Y = g(X),
 *     h(Y) = h(X) + E[log|g′(X)|], so rescaling in metres versus kilometres
 *     changes the answer,
 *   • is not an amount of information in the way the discrete entropy is.
 * Differences of differential entropies — mutual information, KL divergence —
 * do not suffer from any of this, because the Δ terms cancel.
 */
import { EngineError } from '../core/result';
import type { Explanation } from '../core/result';
import { linspace, stableSum } from '../core/numeric';
import { digamma, logBeta, logGamma } from '../special/gamma';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { solve } from '../stats/linalg';
import { BASE_LABEL, fromNats, resolveBase, type BaseOptions, type LogBase } from './types';

/** Euler–Mascheroni constant, needed for the Weibull entropy. */
const EULER_GAMMA = 0.5772156649015329;

export interface DifferentialEntropyResult {
  /** h(X) in the requested unit. May be negative — that is correct, not an error. */
  value: number;
  base: LogBase;
  baseLabel: string;
  exactness: 'exact' | 'numerical';
  /** The closed-form expression used, when one exists. */
  formula: string;
  /** The numerical value from quadrature, when it was computed as a cross-check. */
  quadrature?: number;
  negative: boolean;
  explanation: Explanation;
}

const DIFFERENTIAL_CAVEATS = [
  'Differential entropy is NOT the limit of the discrete entropy of a finer and finer binning: binning at width Δ gives H ≈ h(X) − log Δ, which diverges as Δ → 0.',
  'Differential entropy CAN BE NEGATIVE. A negative value is a correct answer, not an error: it means the density exceeds 1 over a region, e.g. a uniform on an interval shorter than one unit.',
  'Differential entropy is NOT invariant under reparameterisation. For Y = g(X), h(Y) = h(X) + E[log|g′(X)|], so changing units changes the number. Only differences of differential entropies (mutual information, KL divergence) are invariant.',
  'It is therefore not comparable with a discrete entropy, and the two must never be put on the same axis.',
];

/** Closed-form differential entropy in nats, or null if no closed form is implemented. */
function closedFormNats(id: string, p: Params): { nats: number; formula: string } | null {
  switch (id) {
    case 'uniform': {
      const w = p.b - p.a;
      if (!(w > 0)) throw new EngineError(`A uniform distribution needs b > a; got a = ${p.a}, b = ${p.b}.`, 'range');
      return { nats: Math.log(w), formula: 'h = ln(b − a)' };
    }
    case 'normal':
      return { nats: 0.5 * Math.log(2 * Math.PI * Math.E * p.sigma * p.sigma), formula: 'h = ½ln(2πeσ²)' };
    case 'exponential':
      return { nats: 1 - Math.log(p.lambda), formula: 'h = 1 − ln λ' };
    case 'gamma':
      return {
        nats: p.k + Math.log(p.theta) + logGamma(p.k) + (1 - p.k) * digamma(p.k),
        formula: 'h = k + lnθ + lnΓ(k) + (1−k)ψ(k)',
      };
    case 'beta':
      return {
        nats:
          logBeta(p.alpha, p.beta) -
          (p.alpha - 1) * digamma(p.alpha) -
          (p.beta - 1) * digamma(p.beta) +
          (p.alpha + p.beta - 2) * digamma(p.alpha + p.beta),
        formula: 'h = lnB(α,β) − (α−1)ψ(α) − (β−1)ψ(β) + (α+β−2)ψ(α+β)',
      };
    case 'lognormal':
      return { nats: p.mu + 0.5 * Math.log(2 * Math.PI * Math.E * p.sigma * p.sigma), formula: 'h = μ + ½ln(2πeσ²)' };
    case 'weibull':
      return {
        nats: EULER_GAMMA * (1 - 1 / p.k) + Math.log(p.lambda / p.k) + 1,
        formula: 'h = γ(1 − 1/k) + ln(λ/k) + 1',
      };
    case 'cauchy':
      return { nats: Math.log(4 * Math.PI * p.gamma), formula: 'h = ln(4πγ)' };
    case 'pareto':
      return { nats: Math.log(p.xm / p.alpha) + 1 + 1 / p.alpha, formula: 'h = ln(x_m/α) + 1 + 1/α' };
    case 'chiSquare': {
      const k2 = p.k / 2;
      return {
        nats: k2 + Math.LN2 + logGamma(k2) + (1 - k2) * digamma(k2),
        formula: 'h = k/2 + ln2 + lnΓ(k/2) + (1 − k/2)ψ(k/2)',
      };
    }
    case 'triangular':
      return { nats: 0.5 + Math.log((p.b - p.a) / 2), formula: 'h = ½ + ln[(b − a)/2]' };
    case 'studentT': {
      const nu = p.nu;
      return {
        nats:
          ((nu + 1) / 2) * (digamma((nu + 1) / 2) - digamma(nu / 2)) +
          Math.log(Math.sqrt(nu)) +
          logBeta(nu / 2, 0.5) +
          Math.log(p.sigma),
        formula: 'h = ((ν+1)/2)[ψ((ν+1)/2) − ψ(ν/2)] + ln(√ν B(ν/2, ½)) + ln σ',
      };
    }
    default:
      return null;
  }
}

/** 16-node Gauss–Legendre nodes/weights on [−1, 1]. */
const GL16_X = [
  -0.9894009349916499, -0.9445750230732326, -0.8656312023878318, -0.755404408355003, -0.6178762444026438,
  -0.45801677765722737, -0.2816035507792589, -0.09501250983763744, 0.09501250983763744, 0.2816035507792589,
  0.45801677765722737, 0.6178762444026438, 0.755404408355003, 0.8656312023878318, 0.9445750230732326,
  0.9894009349916499,
];
const GL16_W = [
  0.027152459411754096, 0.06225352393864789, 0.09515851168249279, 0.12462897125553388, 0.14959598881657674,
  0.16915651939500254, 0.18260341504492358, 0.1894506104550685, 0.1894506104550685, 0.18260341504492358,
  0.16915651939500254, 0.14959598881657674, 0.12462897125553388, 0.09515851168249279, 0.06225352393864789,
  0.027152459411754096,
];

/** Composite 16-node Gauss–Legendre quadrature of g over [a, b] with `panels` panels. */
export function gaussLegendre(g: (x: number) => number, a: number, b: number, panels = 64): number {
  const edges = linspace(a, b, panels + 1);
  const parts: number[] = [];
  for (let k = 0; k < panels; k++) {
    const lo = edges[k];
    const hi = edges[k + 1];
    const half = (hi - lo) / 2;
    const mid = (hi + lo) / 2;
    for (let i = 0; i < GL16_X.length; i++) {
      parts.push(half * GL16_W[i] * g(mid + half * GL16_X[i]));
    }
  }
  return stableSum(parts);
}

/**
 * Differential entropy by quadrature, in nats.
 *
 * Two substitutions are composed. First x = Q(u) turns −∫ f ln f dx into
 * −∫₀¹ ln f(Q(u)) du, which needs no truncation decision and so handles heavy
 * tails without a choice of cut-off. Then u = (1 + tanh t)/2 maps the unit
 * interval to the whole line with a sech²(t)/2 weight that decays doubly
 * exponentially, which tames the logarithmic blow-up of ln f at the ends of
 * the quantile range. Composite 16-node Gauss–Legendre over t then reaches
 * about 1e-14 on the standard densities, which is why the closed forms can be
 * cross-checked against it to 1e-9 rather than merely to plotting accuracy.
 */
export function differentialEntropyQuadrature(
  id: string,
  params: Params,
  options: { panels?: number; halfWidth?: number } = {},
): { nats: number; halfWidth: number; panels: number } {
  const def = getDistribution(id);
  if (def.kind !== 'continuous') {
    throw new EngineError(
      `Differential entropy applies to continuous distributions; "${id}" is discrete. Use the Shannon entropy of its probability mass function instead.`,
      'kind',
    );
  }
  const T = options.halfWidth ?? 30;
  const panels = options.panels ?? 300;
  const g = (t: number): number => {
    // u = (1 + tanh t)/2, written so that neither tail underflows to 0 or 1.
    const e = Math.exp(-2 * Math.abs(t));
    const u = t >= 0 ? 1 / (1 + e) : e / (1 + e);
    const weight = (2 * e) / ((1 + e) * (1 + e)); // = sech²(t)/2 = du/dt
    if (!(u > 0) || !(u < 1) || weight === 0) return 0;
    const x = def.quantile(u, params);
    const lf = def.logPdf(x, params);
    // A zero-density edge contributes nothing in the limit (0·log0 = 0).
    if (!Number.isFinite(lf) || !Number.isFinite(x)) return 0;
    return -lf * weight;
  };
  const nats = gaussLegendre(g, -T, T, panels);
  if (!Number.isFinite(nats)) {
    throw new EngineError(
      `Numerical differential entropy for "${id}" did not converge to a finite value with the given parameters.`,
      'numerical',
    );
  }
  return { nats, halfWidth: T, panels };
}

/**
 * Differential entropy of a registry distribution: the closed form where one is
 * known, otherwise quadrature. When a closed form exists the quadrature value
 * is also returned so the two routes can be compared.
 */
export function differentialEntropy(
  id: string,
  params: Params,
  options: BaseOptions & { panels?: number; crossCheck?: boolean } = {},
): DifferentialEntropyResult {
  const base = resolveBase(options);
  const def = getDistribution(id);
  if (def.kind !== 'continuous') {
    throw new EngineError(
      `Differential entropy applies to continuous distributions; "${id}" is discrete. Use the Shannon entropy of its probability mass function instead.`,
      'kind',
    );
  }
  const closed = closedFormNats(id, params);
  let nats: number;
  let exactness: 'exact' | 'numerical';
  let formula: string;
  let quadrature: number | undefined;
  if (closed) {
    nats = closed.nats;
    exactness = 'exact';
    formula = closed.formula;
    if (options.crossCheck !== false) {
      quadrature = fromNats(differentialEntropyQuadrature(id, params, { panels: options.panels }).nats, base);
    }
  } else {
    nats = differentialEntropyQuadrature(id, params, { panels: options.panels }).nats;
    exactness = 'numerical';
    formula = 'h = −∫ ln f(Q(u(t))) · sech²(t)/2 dt, composite 16-node Gauss–Legendre quadrature';
    quadrature = fromNats(nats, base);
  }
  if (!Number.isFinite(nats)) {
    throw new EngineError(`The differential entropy of "${id}" with these parameters is not finite.`, 'numerical');
  }
  const value = fromNats(nats, base);
  return {
    value,
    base,
    baseLabel: BASE_LABEL[base],
    exactness,
    formula,
    quadrature,
    negative: value < 0,
    explanation: {
      method: closed ? `Closed-form differential entropy (${def.name})` : `Differential entropy by quadrature (${def.name})`,
      formula,
      steps: [
        { label: 'h(X)', value: `${value.toPrecision(10)} ${base}` },
        ...(quadrature !== undefined ? [{ label: 'Quadrature cross-check', value: `${quadrature.toPrecision(10)} ${base}` }] : []),
        ...(value < 0 ? [{ label: 'Sign', value: 'Negative — see the limitations; this is a valid value.' }] : []),
      ],
      assumptions: ['The parameters define the density on its natural support.'],
      limitations: [...DIFFERENTIAL_CAVEATS, `Reported in ${BASE_LABEL[base]}.`],
      exactness,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Maximum entropy under moment constraints                           */
/* ------------------------------------------------------------------ */

export interface MomentConstraint {
  /** Label, e.g. "mean" or "second moment". */
  name: string;
  /** The statistic whose expectation is constrained. */
  f: (x: number) => number;
  /** The required expected value. */
  target: number;
}

export interface MaxEntropySupport {
  /** Support points. For a continuous problem these are quadrature midpoints. */
  points: number[];
  /** Width attached to each point (1 for a genuinely discrete support). */
  weights: number[];
  /** Whether the support discretises a continuum (affects how the result is read). */
  continuous: boolean;
}

/** Equally spaced midpoint grid on [a, b] — second-order accurate for a continuum. */
export function midpointGrid(a: number, b: number, n: number): MaxEntropySupport {
  if (!(b > a)) throw new EngineError(`A max-entropy grid needs b > a; got a = ${a}, b = ${b}.`, 'range');
  if (!Number.isInteger(n) || n < 2) throw new EngineError(`The grid needs at least 2 points; got ${n}.`, 'range');
  const h = (b - a) / n;
  const points = new Array<number>(n);
  const weights = new Array<number>(n).fill(h);
  for (let i = 0; i < n; i++) points[i] = a + (i + 0.5) * h;
  return { points, weights, continuous: true };
}

/** A finite set of outcomes with no underlying continuum. */
export function discreteSupport(points: readonly number[]): MaxEntropySupport {
  return { points: [...points], weights: new Array<number>(points.length).fill(1), continuous: false };
}

export interface MaxEntropyResult {
  /** Probabilities on the support points (sum 1). */
  probabilities: number[];
  /** probabilities / weight — the density, when the support discretises a continuum. */
  density: number[];
  support: number[];
  /** Lagrange multipliers, one per constraint. */
  lambdas: number[];
  /** Log of the normalising constant of the exponential family. */
  logPartition: number;
  /** Achieved moments, for comparison with the targets. */
  achieved: number[];
  targets: number[];
  /** Largest absolute moment mismatch. */
  maxMomentError: number;
  /** Entropy of the solution in the requested unit (discrete entropy of the grid). */
  entropy: number;
  base: LogBase;
  iterations: number;
  converged: boolean;
  exactness: 'numerical';
  explanation: Explanation;
}

/**
 * Maximum-entropy distribution on a given support subject to moment
 * constraints E[f_k(X)] = m_k.
 *
 * The solution is always of exponential-family form
 *   p(x) ∝ w(x)·exp(Σ λ_k f_k(x)),
 * and the multipliers λ are found by minimising the convex dual
 *   Ψ(λ) = log Σ w(x)exp(Σ λ_k f_k(x)) − Σ λ_k m_k,
 * whose gradient is (E_λ[f_k] − m_k) and whose Hessian is Cov_λ(f). Newton's
 * method with a backtracking line search is used; the partition function is
 * evaluated with a log-sum-exp shift so nothing overflows.
 *
 * This is the principled answer to "I only know the mean and the variance":
 * on (−∞, ∞) with those two constraints the solution is exactly the normal, on
 * [0, ∞) with a mean constraint it is exactly the exponential, and with no
 * constraints at all it is the uniform.
 */
export function maximumEntropyDistribution(
  support: MaxEntropySupport,
  constraints: readonly MomentConstraint[],
  options: BaseOptions & { tolerance?: number; maxIterations?: number } = {},
): MaxEntropyResult {
  const base = resolveBase(options);
  const tol = options.tolerance ?? 1e-12;
  const maxIter = options.maxIterations ?? 200;
  const n = support.points.length;
  if (n === 0) throw new EngineError('The max-entropy support is empty.', 'empty');
  if (support.weights.length !== n) {
    throw new EngineError(`The support has ${n} points but ${support.weights.length} weights.`, 'shape');
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(support.points[i])) throw new EngineError(`Support point ${i} is not finite.`, 'finite');
    if (!(support.weights[i] > 0)) throw new EngineError(`Support weight ${i} must be > 0; got ${support.weights[i]}.`, 'range');
  }
  const m = constraints.length;
  const logW = support.weights.map((w) => Math.log(w));
  // F[k][i] = f_k(x_i)
  const F: number[][] = constraints.map((c) =>
    support.points.map((x) => {
      const v = c.f(x);
      if (!Number.isFinite(v)) {
        throw new EngineError(`Constraint "${c.name}" produced the non-finite value ${String(v)} at x = ${x}.`, 'finite');
      }
      return v;
    }),
  );
  for (const c of constraints) {
    if (!Number.isFinite(c.target)) {
      throw new EngineError(`The target for constraint "${c.name}" must be a finite number; got ${String(c.target)}.`, 'finite');
    }
  }
  // Feasibility: a moment target outside the range of f_k on the support can
  // never be matched, however long we iterate. Refuse immediately.
  for (let k = 0; k < m; k++) {
    const lo = Math.min(...F[k]);
    const hi = Math.max(...F[k]);
    if (constraints[k].target < lo - 1e-12 || constraints[k].target > hi + 1e-12) {
      throw new EngineError(
        `Constraint "${constraints[k].name}" is infeasible: it asks for E[f] = ${constraints[k].target}, but f ranges only over ` +
          `[${lo}, ${hi}] on the given support. No distribution on this support can satisfy it.`,
        'infeasible',
      );
    }
  }
  const lambdas = new Array<number>(m).fill(0);

  const evaluate = (lam: readonly number[]): { logZ: number; p: number[] } => {
    const logits = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let s = logW[i];
      for (let k = 0; k < m; k++) s += lam[k] * F[k][i];
      logits[i] = s;
    }
    let mx = -Infinity;
    for (const v of logits) if (v > mx) mx = v;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.exp(logits[i] - mx);
    const logZ = mx + Math.log(sum);
    const p = new Array<number>(n);
    for (let i = 0; i < n; i++) p[i] = Math.exp(logits[i] - logZ);
    return { logZ, p };
  };
  const dual = (lam: readonly number[]): number => {
    const { logZ } = evaluate(lam);
    let d = logZ;
    for (let k = 0; k < m; k++) d -= lam[k] * constraints[k].target;
    return d;
  };

  let iterations = 0;
  let converged = m === 0;
  let state = evaluate(lambdas);
  if (m > 0) {
    for (; iterations < maxIter; iterations++) {
      state = evaluate(lambdas);
      const ef = new Array<number>(m).fill(0);
      for (let k = 0; k < m; k++) {
        const terms = new Array<number>(n);
        for (let i = 0; i < n; i++) terms[i] = state.p[i] * F[k][i];
        ef[k] = stableSum(terms);
      }
      const grad = ef.map((v, k) => v - constraints[k].target);
      const gnorm = Math.max(...grad.map(Math.abs));
      if (gnorm < tol) {
        converged = true;
        break;
      }
      // Hessian = Cov(f) under the current p.
      const H: number[][] = [];
      for (let k = 0; k < m; k++) {
        const row = new Array<number>(m).fill(0);
        for (let l = 0; l < m; l++) {
          const terms = new Array<number>(n);
          for (let i = 0; i < n; i++) terms[i] = state.p[i] * F[k][i] * F[l][i];
          row[l] = stableSum(terms) - ef[k] * ef[l];
        }
        // Ridge for numerical safety when two constraints are near-collinear.
        row[k] += 1e-14;
        H.push(row);
      }
      const step = solve(H, grad.map((g) => -g));
      if (!step || step.some((s) => !Number.isFinite(s))) {
        throw new EngineError(
          'The maximum-entropy solver could not take a Newton step: the constraint covariance matrix is singular, which means ' +
            'the constraints are redundant or collinear on this support. Remove the duplicated constraint.',
          'numerical',
        );
      }
      // Backtracking line search on the convex dual.
      const d0 = dual(lambdas);
      let t = 1;
      let accepted = false;
      for (let bt = 0; bt < 60; bt++) {
        const trial = lambdas.map((v, k) => v + t * step[k]);
        const dt = dual(trial);
        if (Number.isFinite(dt) && dt <= d0) {
          for (let k = 0; k < m; k++) lambdas[k] = trial[k];
          accepted = true;
          break;
        }
        t /= 2;
      }
      if (!accepted) {
        // The dual could not be decreased: we are at the optimum to within
        // floating point, or the problem is degenerate. Distinguish by gradient.
        if (gnorm < 1e-7) {
          converged = true;
          break;
        }
        throw new EngineError(
          `The maximum-entropy solver stalled after ${iterations} iterations with a largest moment mismatch of ` +
            `${gnorm.toExponential(3)}. The constraints are probably not satisfiable on this support.`,
          'numerical',
        );
      }
    }
    state = evaluate(lambdas);
  }
  const achieved = constraints.map((_, k) => {
    const terms = new Array<number>(n);
    for (let i = 0; i < n; i++) terms[i] = state.p[i] * F[k][i];
    return stableSum(terms);
  });
  const maxMomentError = m === 0 ? 0 : Math.max(...achieved.map((v, k) => Math.abs(v - constraints[k].target)));
  if (!converged) {
    throw new EngineError(
      `The maximum-entropy solver did not converge in ${maxIter} iterations; the largest remaining moment mismatch is ` +
        `${maxMomentError.toExponential(3)}. No distribution is returned.`,
      'numerical',
    );
  }
  const natsTerms = state.p.map((v) => (v === 0 ? 0 : -v * Math.log(v)));
  const entropyNatsValue = stableSum(natsTerms);
  return {
    probabilities: state.p,
    density: state.p.map((v, i) => v / support.weights[i]),
    support: [...support.points],
    lambdas: [...lambdas],
    logPartition: state.logZ,
    achieved,
    targets: constraints.map((c) => c.target),
    maxMomentError,
    entropy: fromNats(entropyNatsValue, base),
    base,
    iterations,
    converged,
    exactness: 'numerical',
    explanation: {
      method: 'Maximum-entropy distribution under moment constraints (exponential family, Newton on the convex dual)',
      formula: 'p(x) ∝ w(x)·exp(Σ λ_k f_k(x)),  λ minimising Ψ(λ) = log Σ w(x)e^{Σλ_k f_k(x)} − Σ λ_k m_k',
      steps: [
        { label: 'Support points', value: String(n) },
        { label: 'Constraints', value: constraints.map((c) => `${c.name} = ${c.target}`).join('; ') || 'none' },
        { label: 'Newton iterations', value: String(iterations) },
        { label: 'Largest moment mismatch', value: maxMomentError.toExponential(3) },
        ...constraints.map((c, k) => ({ label: `λ (${c.name})`, value: lambdas[k].toPrecision(10) })),
      ],
      assumptions: [
        'The constraints are the ONLY information available about the distribution. Maximum entropy is the least-committal choice consistent with them, not a claim about reality.',
        support.continuous
          ? 'The continuum is discretised on a midpoint grid; the returned density is second-order accurate in the grid width.'
          : 'The support is a genuinely finite set of outcomes.',
      ],
      limitations: [
        'The maximum-entropy answer depends on the support and, for a continuum, on the measure with respect to which entropy is taken — it is not reparameterisation-invariant.',
        'Known closed forms this reproduces: mean constraint on [0,∞) → exponential; mean and variance on (−∞,∞) → normal; no constraint on a finite set → uniform.',
        'Discretising a continuum truncates the tails at the grid edges; for the exponential and normal cases the grid must extend far enough that the omitted mass is negligible.',
      ],
      exactness: 'numerical',
    },
  };
}

/**
 * The textbook closed-form maximum-entropy answer for the common constraint
 * sets, returned as a named registry distribution. Exact, and a reference for
 * the numerical solver above.
 */
export function maximumEntropyClosedForm(
  constraintSet: 'mean-on-positive-halfline' | 'mean-and-variance-on-reals' | 'none-on-bounded-interval' | 'none-on-finite-set',
  spec: { mean?: number; variance?: number; a?: number; b?: number; outcomes?: number },
): { distributionId: string; params: Params; reason: string; exactness: 'exact' } | { outcomes: number; probability: number; reason: string; exactness: 'exact' } {
  switch (constraintSet) {
    case 'mean-on-positive-halfline': {
      if (!(spec.mean !== undefined && spec.mean > 0)) {
        throw new EngineError('A mean constraint on [0, ∞) needs a positive mean.', 'range');
      }
      return {
        distributionId: 'exponential',
        params: { lambda: 1 / spec.mean },
        reason: 'On [0, ∞) the only information being the mean μ, the maximum-entropy density is exponential with rate 1/μ.',
        exactness: 'exact',
      };
    }
    case 'mean-and-variance-on-reals': {
      if (spec.mean === undefined || !Number.isFinite(spec.mean)) throw new EngineError('A mean is required.', 'finite');
      if (!(spec.variance !== undefined && spec.variance > 0)) throw new EngineError('A positive variance is required.', 'range');
      return {
        distributionId: 'normal',
        params: { mu: spec.mean, sigma: Math.sqrt(spec.variance) },
        reason: 'On (−∞, ∞) the only information being the mean and variance, the maximum-entropy density is the normal — this is the honest justification for assuming normality, and it applies only when nothing else is known.',
        exactness: 'exact',
      };
    }
    case 'none-on-bounded-interval': {
      if (spec.a === undefined || spec.b === undefined || !(spec.b > spec.a)) {
        throw new EngineError('A bounded interval needs finite a < b.', 'range');
      }
      return {
        distributionId: 'uniform',
        params: { a: spec.a, b: spec.b },
        reason: 'With no constraint beyond the bounds, the maximum-entropy density on [a, b] is uniform.',
        exactness: 'exact',
      };
    }
    case 'none-on-finite-set': {
      const k = spec.outcomes;
      if (!(k !== undefined && Number.isInteger(k) && k >= 1)) {
        throw new EngineError('A finite set needs an integer number of outcomes ≥ 1.', 'range');
      }
      return {
        outcomes: k,
        probability: 1 / k,
        reason: `With no constraint, the maximum-entropy distribution on ${k} outcomes is uniform, with entropy log ${k}, and it is the unique maximiser.`,
        exactness: 'exact',
      };
    }
    default:
      throw new EngineError(`Unknown constraint set "${String(constraintSet)}".`, 'unknown');
  }
}
