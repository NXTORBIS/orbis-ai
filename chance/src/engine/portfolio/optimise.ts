/**
 * Portfolio optimisation.
 *
 * Sign convention in THIS file: inputs are **returns** (positive = gain), as is
 * conventional for optimisation. A loss is the negative of a return, so the
 * loss-based risk measures elsewhere in this module are applied to −r.
 *
 * The honest headline: mean–variance optimisation is an error maximiser.
 * Expected returns are estimated with enormous uncertainty, and the optimiser
 * concentrates in whatever was most overestimated. `estimationErrorStudy`
 * measures that directly by resampling the inputs and re-optimising, and
 * `ledoitWolfShrinkage` is offered as the standard remedy. A frontier presented
 * without that dispersion is a false precision.
 */
import { EngineError, type Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random, Xoshiro128 } from '../random/rng';
import { solve, type Matrix } from '../stats/linalg';
import { checkCovariance, dot, jacobiEigen, projectBudgetBox, quadraticForm, type CovarianceCheck } from './numerics';
import { quantileIntegralWeights } from './empirical';

export interface WeightConstraints {
  /** Per-asset lower bounds (default 0 when short selling is off, −∞ in effect otherwise). */
  lower?: number[];
  upper?: number[];
  /** Σw, normally 1. */
  budget?: number;
  groups?: { label: string; members: number[]; lower: number; upper: number }[];
}

export interface ResolvedConstraints {
  lower: number[];
  upper: number[];
  budget: number;
  groups: { label: string; members: number[]; lower: number; upper: number }[];
  shortSellingAllowed: boolean;
}

export function resolveConstraints(d: number, c: WeightConstraints | undefined, allowShort: boolean): ResolvedConstraints {
  const budget = c?.budget ?? 1;
  if (!Number.isFinite(budget)) throw new EngineError('The weight budget must be a finite number.', 'finite');
  const defaultLower = allowShort ? -10 : 0;
  const defaultUpper = allowShort ? 10 : 1;
  const lower = c?.lower ? [...c.lower] : new Array<number>(d).fill(defaultLower);
  const upper = c?.upper ? [...c.upper] : new Array<number>(d).fill(defaultUpper);
  if (lower.length !== d || upper.length !== d) {
    throw new EngineError(`Weight bounds must have one entry per asset (${d}); received ${lower.length} lower and ${upper.length} upper.`, 'shape');
  }
  for (let i = 0; i < d; i++) {
    if (!Number.isFinite(lower[i]) || !Number.isFinite(upper[i])) throw new EngineError(`Weight bounds for asset ${i + 1} must be finite.`, 'finite');
    if (lower[i] > upper[i]) throw new EngineError(`Asset ${i + 1} has a lower bound (${lower[i]}) above its upper bound (${upper[i]}).`, 'infeasible');
  }
  const sumLo = stableSum(lower);
  const sumHi = stableSum(upper);
  if (sumLo > budget + 1e-12 || sumHi < budget - 1e-12) {
    throw new EngineError(
      `The weight bounds are infeasible: they allow a total between ${sumLo} and ${sumHi}, which excludes the required budget of ${budget}.`,
      'infeasible',
    );
  }
  const groups = (c?.groups ?? []).map((g) => {
    if (!g.members.length) throw new EngineError(`Group "${g.label}" has no members.`, 'required');
    for (const m of g.members) {
      if (!Number.isInteger(m) || m < 0 || m >= d) throw new EngineError(`Group "${g.label}" refers to asset index ${m}, which does not exist.`, 'range');
    }
    if (g.lower > g.upper) throw new EngineError(`Group "${g.label}" has a lower bound above its upper bound.`, 'infeasible');
    const members = new Set(g.members);
    const outside = Array.from({ length: d }, (_, i) => i).filter((i) => !members.has(i));
    // What the group can actually hold, given its own members' bounds AND the
    // budget left over once the other assets are at their limits.
    const gLo = Math.max(stableSum(g.members.map((m) => lower[m])), budget - stableSum(outside.map((i) => upper[i])));
    const gHi = Math.min(stableSum(g.members.map((m) => upper[m])), budget - stableSum(outside.map((i) => lower[i])));
    if (gLo > g.upper + 1e-12 || gHi < g.lower - 1e-12) {
      throw new EngineError(
        `Group "${g.label}" is infeasible: with the weight bounds and a budget of ${budget}, its members' total can only lie between ${gLo} and ${gHi}, which does not meet the required [${g.lower}, ${g.upper}].`,
        'infeasible',
      );
    }
    return { ...g, members: [...g.members] };
  });
  return { lower, upper, budget, groups, shortSellingAllowed: allowShort };
}

/** Projection onto the feasible set by alternating projections; refuses if it does not converge. */
export function projectFeasible(v: number[], c: ResolvedConstraints, iterations = 500): number[] {
  let w = projectBudgetBox(v, c.lower, c.upper, c.budget);
  if (!c.groups.length) return w;
  for (let it = 0; it < iterations; it++) {
    let worst = 0;
    for (const g of c.groups) {
      const s = stableSum(g.members.map((m) => w[m]));
      const target = s < g.lower ? g.lower : s > g.upper ? g.upper : s;
      const gap = target - s;
      if (Math.abs(gap) > 1e-14) {
        worst = Math.max(worst, Math.abs(gap));
        const per = gap / g.members.length;
        const next = [...w];
        for (const m of g.members) next[m] += per;
        w = projectBudgetBox(next, c.lower, c.upper, c.budget);
      }
    }
    if (worst < 1e-12) return w;
  }
  const residual = Math.max(
    0,
    ...c.groups.map((g) => {
      const s = stableSum(g.members.map((m) => w[m]));
      return Math.max(g.lower - s, s - g.upper, 0);
    }),
  );
  if (residual > 1e-7) {
    throw new EngineError(
      `The constraint set could not be satisfied: the group constraints and the weight bounds together leave a residual violation of ${residual.toExponential(3)}. No weights are returned, because an infeasible portfolio is not an answer.`,
      'infeasible',
    );
  }
  return w;
}

export interface MeanVariancePoint {
  weights: number[];
  expectedReturn: number;
  variance: number;
  standardDeviation: number;
  sharpe: number | null;
}

export interface AnalyticFrontier {
  minimumVariance: MeanVariancePoint;
  tangency: MeanVariancePoint | null;
  points: MeanVariancePoint[];
  /** Frontier coefficients: var(m) = (A·m² − 2B·m + C)/D. */
  coefficients: { a: number; b: number; c: number; d: number };
  capitalMarketLine: { riskFreeRate: number; slope: number; intercept: number } | null;
  covarianceCheck: CovarianceCheck;
  exactness: Exactness;
  method: string;
  notes: string[];
}

function inverseTimes(sigma: Matrix, b: number[]): number[] {
  const x = solve(sigma, b);
  if (!x) throw new EngineError('The covariance matrix is singular to working precision, so the analytic frontier does not exist.', 'singular');
  return x;
}

/**
 * Markowitz frontier with short selling allowed and only the budget
 * constraint. Closed form, therefore exact.
 */
export function analyticEfficientFrontier(mu: number[], sigma: Matrix, opts: { points?: number; riskFreeRate?: number } = {}): AnalyticFrontier {
  const check = checkCovariance(sigma);
  const d = check.n;
  if (mu.length !== d) throw new EngineError(`${mu.length} expected returns were given for a ${d}×${d} covariance matrix.`, 'shape');
  for (const m of mu) if (!Number.isFinite(m)) throw new EngineError('Every expected return must be a finite number.', 'finite');
  const ones = new Array<number>(d).fill(1);
  const invOnes = inverseTimes(sigma, ones);
  const invMu = inverseTimes(sigma, mu);
  const A = dot(ones, invOnes);
  const B = dot(ones, invMu);
  const C = dot(mu, invMu);
  const D = A * C - B * B;
  if (!(A > 0)) throw new EngineError('The covariance matrix gives a non-positive 1ᵀΣ⁻¹1, which is impossible for a valid covariance; the inputs are inconsistent.', 'numerical');
  const point = (w: number[], rf?: number): MeanVariancePoint => {
    const ret = dot(mu, w);
    const varr = quadraticForm(sigma, w);
    const sd = Math.sqrt(Math.max(0, varr));
    return { weights: w, expectedReturn: ret, variance: varr, standardDeviation: sd, sharpe: rf === undefined || sd === 0 ? null : (ret - rf) / sd };
  };
  const rf = opts.riskFreeRate;
  const minVar = point(invOnes.map((v) => v / A), rf);
  let tangency: MeanVariancePoint | null = null;
  let cml: AnalyticFrontier['capitalMarketLine'] = null;
  if (rf !== undefined) {
    const excess = mu.map((m) => m - rf);
    const invExcess = inverseTimes(sigma, excess);
    const norm = stableSum(invExcess);
    if (Math.abs(norm) < 1e-14) {
      throw new EngineError(
        `No tangency portfolio exists for a risk-free rate of ${rf}: the excess returns give 1ᵀΣ⁻¹(μ − rf·1) = 0, so every budget-constrained portfolio has the same expected excess return and the Sharpe ratio has no interior maximum.`,
        'degenerate',
      );
    }
    const w = invExcess.map((v) => v / norm);
    tangency = point(w, rf);
    if (tangency.standardDeviation > 0 && tangency.expectedReturn > rf) {
      cml = { riskFreeRate: rf, slope: (tangency.expectedReturn - rf) / tangency.standardDeviation, intercept: rf };
    }
  }
  const n = opts.points ?? 25;
  if (!Number.isInteger(n) || n < 2) throw new EngineError('The frontier needs at least 2 points.', 'range');
  const lo = minVar.expectedReturn;
  const hi = Math.max(...mu);
  const span = hi - lo;
  const points: MeanVariancePoint[] = [];
  for (let i = 0; i < n; i++) {
    const m = lo + (span * i) / (n - 1);
    if (Math.abs(D) < 1e-18) {
      points.push(minVar);
      continue;
    }
    const lambda = (C - B * m) / D;
    const gamma = (A * m - B) / D;
    const w = invOnes.map((v, j) => lambda * v + gamma * invMu[j]);
    points.push(point(w, rf));
  }
  return {
    minimumVariance: minVar,
    tangency,
    points,
    coefficients: { a: A, b: B, c: C, d: D },
    capitalMarketLine: cml,
    covarianceCheck: check,
    exactness: 'exact',
    method:
      'Closed-form Markowitz solution with the budget constraint only: w(m) = Σ⁻¹(λ·1 + γ·μ) with λ = (C − Bm)/D, γ = (Am − B)/D, A = 1ᵀΣ⁻¹1, B = 1ᵀΣ⁻¹μ, C = μᵀΣ⁻¹μ, D = AC − B². Variance along the frontier is (Am² − 2Bm + C)/D, a convex parabola in the target return.',
    notes: [
      'Short selling is unrestricted here, so weights can be large and negative. That is where mean–variance optimisation is most sensitive to estimation error.',
      'The frontier is exact given μ and Σ. It is NOT exact given the data those were estimated from — see estimationErrorStudy.',
    ],
  };
}

export interface ConstrainedSolution {
  weights: number[];
  expectedReturn: number;
  variance: number;
  standardDeviation: number;
  objective: number;
  iterations: number;
  converged: boolean;
  exactness: Exactness;
  method: string;
}

/**
 * Minimise ½wᵀΣw − λ·μᵀw over the feasible set, by accelerated projected
 * gradient descent (FISTA). Used whenever the constraints make the closed form
 * inapplicable — a no-short constraint, box bounds or group limits.
 */
export function constrainedMeanVariance(
  mu: number[],
  sigma: Matrix,
  lambda: number,
  constraints: ResolvedConstraints,
  opts: { maxIterations?: number; tolerance?: number; start?: number[] } = {},
): ConstrainedSolution {
  const check = checkCovariance(sigma);
  const d = check.n;
  if (mu.length !== d) throw new EngineError(`${mu.length} expected returns were given for ${d} assets.`, 'shape');
  if (!(lambda >= 0)) throw new EngineError(`The risk-aversion parameter λ must be 0 or greater; received ${lambda}.`, 'range');
  const L = Math.max(check.eigenvalues[d - 1], 1e-12);
  const step = 1 / L;
  const maxIter = opts.maxIterations ?? 20000;
  const tol = opts.tolerance ?? 1e-14;
  let w = projectFeasible(opts.start ?? new Array<number>(d).fill(constraints.budget / d), constraints);
  let y = [...w];
  let t = 1;
  const grad = (v: number[]): number[] => sigma.map((row, i) => row.reduce((a, s, j) => a + s * v[j], 0) - lambda * mu[i]);
  const obj = (v: number[]): number => 0.5 * quadraticForm(sigma, v) - lambda * dot(mu, v);
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    const g = grad(y);
    const next = projectFeasible(
      y.map((v, i) => v - step * g[i]),
      constraints,
    );
    const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
    const momentum = (t - 1) / tNext;
    const yNext = next.map((v, i) => v + momentum * (v - w[i]));
    let diff = 0;
    for (let i = 0; i < d; i++) diff = Math.max(diff, Math.abs(next[i] - w[i]));
    w = next;
    y = projectFeasible(yNext, constraints);
    t = tNext;
    if (diff < tol) {
      converged = true;
      break;
    }
  }
  const ret = dot(mu, w);
  const varr = quadraticForm(sigma, w);
  return {
    weights: w,
    expectedReturn: ret,
    variance: varr,
    standardDeviation: Math.sqrt(Math.max(0, varr)),
    objective: obj(w),
    iterations,
    converged,
    exactness: 'numerical',
    method: `Accelerated projected gradient descent (FISTA) with step 1/λ_max(Σ) = ${step.toExponential(3)}, projecting onto the budget, box and group constraints at every step. The problem is convex, so the limit is the global optimum.`,
  };
}

export interface ConstrainedFrontier {
  points: ConstrainedSolution[];
  minimumVariance: ConstrainedSolution;
  maximumSharpe: { point: ConstrainedSolution; sharpe: number; riskFreeRate: number } | null;
  constraints: ResolvedConstraints;
  exactness: Exactness;
  notes: string[];
}

/** Constrained frontier by sweeping the risk-aversion parameter. */
export function constrainedEfficientFrontier(
  mu: number[],
  sigma: Matrix,
  opts: { points?: number; constraints?: WeightConstraints; allowShort?: boolean; riskFreeRate?: number; lambdaMax?: number } = {},
): ConstrainedFrontier {
  const d = mu.length;
  const c = resolveConstraints(d, opts.constraints, opts.allowShort ?? false);
  const n = opts.points ?? 20;
  if (!Number.isInteger(n) || n < 2) throw new EngineError('The frontier needs at least 2 points.', 'range');
  const spread = Math.max(...mu) - Math.min(...mu);
  const scale = spread > 0 ? quadraticForm(sigma, new Array<number>(d).fill(1 / d)) / spread : 1;
  const lambdaMax = opts.lambdaMax ?? Math.max(1e-6, 50 * scale);
  const points: ConstrainedSolution[] = [];
  for (let i = 0; i < n; i++) {
    const lambda = (lambdaMax * i) / (n - 1);
    points.push(constrainedMeanVariance(mu, sigma, lambda, c));
  }
  const minVar = points.reduce((a, b) => (b.variance < a.variance ? b : a));
  let maxSharpe: ConstrainedFrontier['maximumSharpe'] = null;
  if (opts.riskFreeRate !== undefined) {
    const rf = opts.riskFreeRate;
    let best: { point: ConstrainedSolution; sharpe: number } | null = null;
    for (const p of points) {
      if (p.standardDeviation <= 0) continue;
      const s = (p.expectedReturn - rf) / p.standardDeviation;
      if (!best || s > best.sharpe) best = { point: p, sharpe: s };
    }
    if (best) maxSharpe = { ...best, riskFreeRate: rf };
  }
  return {
    points,
    minimumVariance: minVar,
    maximumSharpe: maxSharpe,
    constraints: c,
    exactness: 'numerical',
    notes: [
      'The frontier is traced by varying risk aversion rather than by fixing target returns, because with box and group constraints not every target return is attainable and a fabricated point would be worse than none.',
      'A constrained optimum can never beat the unconstrained one on the same objective: constraints only remove options. Use that as a sanity check.',
    ],
  };
}

/**
 * The minimum-variance portfolio at a given target return under constraints.
 * Bisects risk aversion; refuses when the target cannot be reached.
 */
export function targetReturnPortfolio(
  mu: number[],
  sigma: Matrix,
  targetReturn: number,
  opts: { constraints?: WeightConstraints; allowShort?: boolean } = {},
): ConstrainedSolution & { targetReturn: number } {
  const d = mu.length;
  const c = resolveConstraints(d, opts.constraints, opts.allowShort ?? false);
  // Relaxed bound on attainable return: ignore group constraints (a relaxation,
  // so a target outside it is certainly infeasible).
  const order = Array.from({ length: d }, (_, i) => i).sort((a, b) => mu[b] - mu[a]);
  const greedy = (asc: boolean): number => {
    const idx = asc ? [...order].reverse() : order;
    const w = [...c.lower];
    let remaining = c.budget - stableSum(w);
    for (const i of idx) {
      const room = Math.min(c.upper[i] - w[i], Math.max(0, remaining));
      w[i] += room;
      remaining -= room;
    }
    return dot(mu, w);
  };
  const maxRet = greedy(false);
  const minRet = greedy(true);
  if (targetReturn > maxRet + 1e-10 || targetReturn < minRet - 1e-10) {
    throw new EngineError(
      `A target return of ${targetReturn} is not attainable under these constraints: the feasible range of expected return is [${minRet}, ${maxRet}] even before any group constraints are applied.`,
      'infeasible',
    );
  }
  const minimumVariance = constrainedMeanVariance(mu, sigma, 0, c);
  if (targetReturn < minimumVariance.expectedReturn - 1e-9) {
    throw new EngineError(
      `A target return of ${targetReturn} is below the minimum-variance portfolio's return of ${minimumVariance.expectedReturn}, so no efficient portfolio has it: every portfolio with that return is dominated by the minimum-variance portfolio, which has a higher return AND a lower variance. Use the minimum-variance portfolio instead.`,
      'infeasible',
    );
  }
  let lo = 0;
  let hi = 1;
  const spread = Math.max(...mu) - Math.min(...mu);
  const scale = spread > 0 ? quadraticForm(sigma, new Array<number>(d).fill(1 / d)) / spread : 1;
  hi = Math.max(1e-6, scale);
  for (let k = 0; k < 60 && constrainedMeanVariance(mu, sigma, hi, c).expectedReturn < targetReturn; k++) hi *= 2;
  let best = constrainedMeanVariance(mu, sigma, hi, c);
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi);
    const sol = constrainedMeanVariance(mu, sigma, mid, c);
    if (sol.expectedReturn < targetReturn) lo = mid;
    else {
      hi = mid;
      best = sol;
    }
  }
  if (Math.abs(best.expectedReturn - targetReturn) > 1e-6 * Math.max(1, Math.abs(targetReturn))) {
    throw new EngineError(
      `The target return of ${targetReturn} could not be matched under these constraints; the closest attainable efficient portfolio returns ${best.expectedReturn}. No portfolio is returned rather than one that misses the target.`,
      'infeasible',
    );
  }
  return { ...best, targetReturn };
}

/* ------------------------------------------------------------------ *
 * Mean–ES (CVaR) optimisation — Rockafellar & Uryasev                 *
 * ------------------------------------------------------------------ */

export interface CvarSolution {
  weights: number[];
  /** ES of the portfolio LOSS (−return) at the chosen level. */
  expectedShortfall: number;
  /** The optimal auxiliary variable of the RU formulation, which is VaR. */
  valueAtRisk: number;
  expectedReturn: number;
  level: number;
  tailScenarioCount: number;
  iterations: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Minimise ES_α of the portfolio loss (optionally minus λ times expected
 * return) on a scenario matrix of returns.
 *
 * Rockafellar & Uryasev (2000) showed that
 *     ES_α(w) = min_t { t + 1/((1−α)n) Σ_s (L_s(w) − t)₊ },
 * which is a linear programme in (w, t). Minimising over t first leaves a
 * convex, piecewise-linear function of w alone whose subgradient is the tail
 * average of the scenario returns — that is what is minimised here by projected
 * subgradient descent followed by a pairwise refinement, with the optimal
 * t recovered as VaR. The optimum is the same; only the algorithm differs
 * from a simplex solve.
 */
export function minimumCvarPortfolio(
  scenarioReturns: number[][],
  level: number,
  opts: { constraints?: WeightConstraints; allowShort?: boolean; returnAversion?: number; iterations?: number; starts?: number[][] } = {},
): CvarSolution {
  if (!scenarioReturns.length) throw new EngineError('At least one scenario is required.', 'required');
  const n = scenarioReturns.length;
  const d = scenarioReturns[0].length;
  for (const row of scenarioReturns) {
    if (row.length !== d) throw new EngineError('Every scenario must cover the same number of assets.', 'shape');
    for (const v of row) if (!Number.isFinite(v)) throw new EngineError('Every scenario return must be a finite number.', 'finite');
  }
  if (!(level > 0 && level < 1)) throw new EngineError(`The confidence level must be strictly between 0 and 1; received ${level}.`, 'range');
  const tailFraction = (1 - level) * n;
  if (tailFraction < 5) {
    throw new EngineError(
      `At level ${level} only ${tailFraction.toFixed(2)} of the ${n} scenarios lie in the tail. Expected Shortfall cannot be optimised from fewer than 5 effective tail scenarios; use a lower level or supply more scenarios.`,
      'insufficient',
    );
  }
  const c = resolveConstraints(d, opts.constraints, opts.allowShort ?? false);
  const lambda = opts.returnAversion ?? 0;
  if (!(lambda >= 0)) throw new EngineError('The return-aversion parameter must be 0 or greater.', 'range');
  const mu = new Array<number>(d).fill(0);
  for (const row of scenarioReturns) for (let i = 0; i < d; i++) mu[i] += row[i] / n;
  const spec = quantileIntegralWeights(n, level, 1);

  const evaluate = (w: number[]): { es: number; grad: number[]; varValue: number; tailCount: number } => {
    const losses = new Float64Array(n);
    for (let s = 0; s < n; s++) {
      let acc = 0;
      for (let i = 0; i < d; i++) acc -= w[i] * scenarioReturns[s][i];
      losses[s] = acc;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => losses[a] - losses[b]);
    let es = 0;
    const grad = new Array<number>(d).fill(0);
    let tailCount = 0;
    for (let r = 0; r < n; r++) {
      const wr = spec[r];
      if (wr === 0) continue;
      tailCount++;
      es += wr * losses[order[r]];
      const row = scenarioReturns[order[r]];
      for (let i = 0; i < d; i++) grad[i] -= wr * row[i];
    }
    const k = Math.min(n - 1, Math.max(0, Math.ceil(level * n) - 1));
    return { es, grad, varValue: losses[order[k]], tailCount };
  };
  const objective = (w: number[]): number => evaluate(w).es - lambda * dot(mu, w);

  const starts: number[][] = [];
  starts.push(projectFeasible(new Array<number>(d).fill(c.budget / d), c));
  for (const s of opts.starts ?? []) starts.push(projectFeasible(s, c));
  for (let i = 0; i < d; i++) {
    const v = new Array<number>(d).fill(0);
    v[i] = c.budget;
    try {
      starts.push(projectFeasible(v, c));
    } catch {
      // A corner that the constraints exclude is simply not used as a start.
    }
  }
  const maxIter = opts.iterations ?? 400;
  let bestW = starts[0];
  let bestObj = objective(bestW);
  const scale = Math.max(1e-12, Math.abs(bestObj));
  for (const start of starts) {
    let w = start;
    let f = objective(w);
    if (f < bestObj) {
      bestObj = f;
      bestW = w;
    }
    for (let it = 1; it <= maxIter; it++) {
      const ev = evaluate(w);
      const g = ev.grad.map((gi, i) => gi - lambda * mu[i]);
      const norm = Math.sqrt(dot(g, g)) || 1;
      const stepSize = (2 * scale) / (norm * Math.sqrt(it));
      const cand = projectFeasible(
        w.map((v, i) => v - stepSize * g[i]),
        c,
      );
      const fc = objective(cand);
      if (fc < f) {
        w = cand;
        f = fc;
      }
      if (f < bestObj) {
        bestObj = f;
        bestW = w;
      }
    }
    // Pairwise refinement: shift weight between pairs of assets. This is a
    // descent method on the simplex that polishes the subgradient solution.
    let delta = c.budget / 4;
    while (delta > 1e-12) {
      let improved = false;
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) {
          if (i === j) continue;
          const cand = [...w];
          cand[i] += delta;
          cand[j] -= delta;
          let proj: number[];
          try {
            proj = projectFeasible(cand, c);
          } catch {
            continue;
          }
          const fc = objective(proj);
          if (fc < f - 1e-15) {
            w = proj;
            f = fc;
            improved = true;
          }
        }
      }
      if (!improved) delta /= 2;
    }
    if (f < bestObj) {
      bestObj = f;
      bestW = w;
    }
  }
  const final = evaluate(bestW);
  return {
    weights: bestW,
    expectedShortfall: final.es,
    valueAtRisk: final.varValue,
    expectedReturn: dot(mu, bestW),
    level,
    tailScenarioCount: final.tailCount,
    iterations: maxIter,
    exactness: 'numerical',
    method:
      'Rockafellar–Uryasev formulation with the auxiliary variable eliminated (its optimum is VaR), minimised by multi-start projected subgradient descent and a pairwise weight-shift refinement. The objective is convex and piecewise linear, so the result is the global optimum up to the refinement tolerance.',
    notes: [
      'ES optimisation uses the scenarios directly, so it responds to skewness and to tail shape, which variance cannot see.',
      'On normally distributed scenarios the minimum-ES and minimum-variance portfolios coincide in theory, and nearly so in a finite sample — a useful cross-check on both.',
      `The optimum is driven by the ${final.tailCount} scenarios in the tail. With few tail scenarios the weights are unstable even when the objective value looks precise.`,
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Risk parity                                                         *
 * ------------------------------------------------------------------ */

export interface RiskParitySolution {
  weights: number[];
  riskContributions: number[];
  riskContributionShares: number[];
  portfolioSd: number;
  maximumShareDeviation: number;
  iterations: number;
  converged: boolean;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Equal-risk-contribution ("risk parity") portfolio: long-only weights for
 * which every asset's component standard deviation wᵢ(Σw)ᵢ/σ is equal.
 *
 * Solved through the equivalent convex problem
 *     min ½xᵀΣx − (1/d)·Σ log xᵢ,  x > 0,
 * whose unique solution normalises to the ERC portfolio, by cyclical coordinate
 * descent (each coordinate step is a quadratic with a closed-form positive root).
 */
export function riskParityPortfolio(sigma: Matrix, opts: { tolerance?: number; maxIterations?: number } = {}): RiskParitySolution {
  const check = checkCovariance(sigma);
  const d = check.n;
  const tol = opts.tolerance ?? 1e-14;
  const maxIter = opts.maxIterations ?? 10000;
  const x = sigma.map((row, i) => 1 / Math.sqrt(row[i] * d));
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    let maxChange = 0;
    for (let i = 0; i < d; i++) {
      let b = 0;
      for (let j = 0; j < d; j++) if (j !== i) b += sigma[i][j] * x[j];
      const a = sigma[i][i];
      const next = (-b + Math.sqrt(b * b + (4 * a) / d)) / (2 * a);
      if (!(next > 0) || !Number.isFinite(next)) {
        throw new EngineError(`The risk-parity iteration produced a non-positive weight for asset ${i + 1}; the covariance matrix is too ill-conditioned for an equal-risk-contribution solution.`, 'numerical');
      }
      maxChange = Math.max(maxChange, Math.abs(next - x[i]));
      x[i] = next;
    }
    if (maxChange < tol) {
      converged = true;
      break;
    }
  }
  const total = stableSum(x);
  const w = x.map((v) => v / total);
  const sd = Math.sqrt(quadraticForm(sigma, w));
  const contributions = sigma.map((row, i) => (w[i] * row.reduce((acc, v, j) => acc + v * w[j], 0)) / sd);
  const shares = contributions.map((cv) => cv / sd);
  return {
    weights: w,
    riskContributions: contributions,
    riskContributionShares: shares,
    portfolioSd: sd,
    maximumShareDeviation: Math.max(...shares.map((s) => Math.abs(s - 1 / d))),
    iterations,
    converged,
    exactness: 'numerical',
    method: 'Cyclical coordinate descent on ½xᵀΣx − (1/d)Σ log xᵢ, whose unique positive solution normalises to the equal-risk-contribution portfolio.',
    notes: [
      'Risk parity equalises each asset\'s contribution to portfolio standard deviation. It uses no expected returns at all, which is its main attraction: the input that is estimated worst is not used.',
      'For uncorrelated assets the solution is exactly wᵢ ∝ 1/σᵢ.',
      'Equal risk contribution is not equal risk: a highly correlated pair still moves together, and the measure used is standard deviation, which ignores tail shape.',
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Estimation error: shrinkage and resampling                          *
 * ------------------------------------------------------------------ */

export interface MomentEstimates {
  mean: number[];
  covariance: Matrix;
  observations: number;
}

export function estimateMoments(returns: number[][]): MomentEstimates {
  const n = returns.length;
  if (n < 2) throw new EngineError('At least 2 observations are needed to estimate a covariance matrix.', 'insufficient');
  const d = returns[0].length;
  for (const row of returns) {
    if (row.length !== d) throw new EngineError('Every observation must cover the same number of assets.', 'shape');
    for (const v of row) if (!Number.isFinite(v)) throw new EngineError('Every return must be a finite number.', 'finite');
  }
  if (n <= d) {
    // Not an error — but the sample covariance is singular, and the caller must know.
  }
  const mean = new Array<number>(d).fill(0);
  for (const row of returns) for (let i = 0; i < d; i++) mean[i] += row[i] / n;
  const cov: Matrix = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const row of returns) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j <= i; j++) {
        cov[i][j] += ((row[i] - mean[i]) * (row[j] - mean[j])) / (n - 1);
      }
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) cov[j][i] = cov[i][j];
  return { mean, covariance: cov, observations: n };
}

export interface ShrinkageResult {
  shrunk: Matrix;
  sample: Matrix;
  target: Matrix;
  /** Shrinkage intensity in [0, 1]: 0 = sample covariance, 1 = the target. */
  intensity: number;
  averageVariance: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Ledoit–Wolf shrinkage towards a scaled identity (the "well-conditioned
 * estimator", Ledoit & Wolf 2004). The intensity is estimated from the data,
 * not chosen.
 */
export function ledoitWolfShrinkage(returns: number[][]): ShrinkageResult {
  const { mean, covariance, observations: n } = estimateMoments(returns);
  const d = mean.length;
  const m = stableSum(covariance.map((row, i) => row[i])) / d;
  const target: Matrix = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? m : 0)));
  let d2 = 0;
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) d2 += (covariance[i][j] - target[i][j]) ** 2;
  let b2bar = 0;
  for (const row of returns) {
    const dev = row.map((v, i) => v - mean[i]);
    let acc = 0;
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) acc += (dev[i] * dev[j] - covariance[i][j]) ** 2;
    b2bar += acc / (n * n);
  }
  const b2 = Math.min(b2bar, d2);
  const intensity = d2 > 0 ? b2 / d2 : 1;
  const shrunk: Matrix = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => intensity * target[i][j] + (1 - intensity) * covariance[i][j]),
  );
  return {
    shrunk,
    sample: covariance,
    target,
    intensity,
    averageVariance: m,
    exactness: 'numerical',
    method: 'Ledoit–Wolf (2004) shrinkage towards (trace(S)/d)·I with the asymptotically optimal intensity ρ = min(b̄², d²)/d², estimated from the same sample.',
    notes: [
      `The estimated intensity is ${intensity.toPrecision(4)}: that share of the matrix comes from the structured target rather than the sample. A high value means the sample covariance carries little usable information at this sample size (${n} observations for ${d} assets).`,
      'Shrinkage trades a little bias for a large reduction in variance. It makes the optimiser\'s output far more stable; it does not make the expected-return estimates any better.',
    ],
  };
}

export interface EstimationErrorStudy {
  resamples: number;
  skipped: number;
  observations: number;
  assets: number;
  /** Weights of the optimum computed on the full sample. */
  baseWeights: number[];
  /** Mean of the resampled optimal weights (the "resampled"/Michaud portfolio). */
  meanWeights: number[];
  /** Per-asset standard deviation of the optimal weight across resamples. */
  weightStandardDeviation: number[];
  /** Mean total absolute deviation of a resampled weight vector from the base. */
  meanAbsoluteDeviation: number;
  /** 5th and 95th percentile of each weight across resamples. */
  weightInterval: { low: number; high: number }[];
  /** The same study with Ledoit–Wolf shrinkage applied in every resample. */
  shrunk: {
    meanWeights: number[];
    weightStandardDeviation: number[];
    meanAbsoluteDeviation: number;
    averageIntensity: number;
  } | null;
  dispersionReduction: number | null;
  exactness: Exactness;
  method: string;
  verdict: string;
  notes: string[];
}

/**
 * The error-maximiser demonstration. Resample the return history, re-estimate
 * μ and Σ, re-optimise, and report how far the "optimal" weights move. If they
 * move a lot, the optimal portfolio is not identifiable from the data, and that
 * is the single most important thing to tell the user.
 */
export function estimationErrorStudy(
  returns: number[][],
  opts: { resamples?: number; seed?: string; riskFreeRate?: number; objective?: 'tangency' | 'minimumVariance'; withShrinkage?: boolean } = {},
): EstimationErrorStudy {
  const base = estimateMoments(returns);
  const d = base.mean.length;
  const n = base.observations;
  const resamples = opts.resamples ?? 200;
  if (!Number.isInteger(resamples) || resamples < 10) throw new EngineError('At least 10 resamples are needed to describe the dispersion.', 'range');
  const rf = opts.riskFreeRate ?? 0;
  const objective = opts.objective ?? 'tangency';
  const optimum = (mu: number[], sigma: Matrix): number[] | null => {
    try {
      const fr = analyticEfficientFrontier(mu, sigma, { points: 2, riskFreeRate: rf });
      if (objective === 'minimumVariance') return fr.minimumVariance.weights;
      return fr.tangency ? fr.tangency.weights : null;
    } catch {
      return null;
    }
  };
  const baseWeights = optimum(base.mean, base.covariance);
  if (!baseWeights) {
    throw new EngineError(
      'The optimum could not be computed on the full sample: the sample covariance matrix is singular or no tangency portfolio exists. With this many assets and this few observations, mean–variance optimisation has no unique answer at all.',
      'singular',
    );
  }
  const rng = new Random(new Xoshiro128(opts.seed ?? 'portfolio-estimation-error'));
  const collect: number[][] = [];
  const collectShrunk: number[][] = [];
  const intensities: number[] = [];
  let skipped = 0;
  const withShrinkage = opts.withShrinkage ?? true;
  for (let r = 0; r < resamples; r++) {
    const sample: number[][] = [];
    for (let i = 0; i < n; i++) sample.push(returns[rng.int(0, n - 1)]);
    let moments: MomentEstimates;
    try {
      moments = estimateMoments(sample);
    } catch {
      skipped++;
      continue;
    }
    const w = optimum(moments.mean, moments.covariance);
    if (!w) {
      skipped++;
      continue;
    }
    collect.push(w);
    if (withShrinkage) {
      try {
        const sh = ledoitWolfShrinkage(sample);
        const ws = optimum(moments.mean, sh.shrunk);
        if (ws) {
          collectShrunk.push(ws);
          intensities.push(sh.intensity);
        }
      } catch {
        // A resample whose shrinkage cannot be computed is simply not counted.
      }
    }
  }
  if (collect.length < 5) {
    throw new EngineError(`Only ${collect.length} of ${resamples} resamples produced a well-defined optimum, which is too few to describe the dispersion. The optimisation is not identifiable from this data.`, 'insufficient');
  }
  const summarise = (weights: number[][]) => {
    const k = weights.length;
    const meanW = new Array<number>(d).fill(0);
    for (const w of weights) for (let i = 0; i < d; i++) meanW[i] += w[i] / k;
    const sd = new Array<number>(d).fill(0);
    for (const w of weights) for (let i = 0; i < d; i++) sd[i] += (w[i] - meanW[i]) ** 2 / Math.max(1, k - 1);
    const mad = stableSum(weights.map((w) => stableSum(w.map((v, i) => Math.abs(v - baseWeights[i]))))) / k;
    return { meanWeights: meanW, weightStandardDeviation: sd.map(Math.sqrt), meanAbsoluteDeviation: mad };
  };
  const plain = summarise(collect);
  const interval = Array.from({ length: d }, (_, i) => {
    const col = collect.map((w) => w[i]).sort((a, b) => a - b);
    const q = (p: number): number => col[Math.min(col.length - 1, Math.max(0, Math.ceil(p * col.length) - 1))];
    return { low: q(0.05), high: q(0.95) };
  });
  const shrunkSummary = collectShrunk.length >= 5 ? summarise(collectShrunk) : null;
  const totalDispersion = stableSum(plain.weightStandardDeviation);
  const shrunkDispersion = shrunkSummary ? stableSum(shrunkSummary.weightStandardDeviation) : null;
  return {
    resamples: collect.length,
    skipped,
    observations: n,
    assets: d,
    baseWeights,
    ...plain,
    weightInterval: interval,
    shrunk: shrunkSummary ? { ...shrunkSummary, averageIntensity: stableSum(intensities) / intensities.length } : null,
    dispersionReduction: shrunkDispersion === null ? null : (totalDispersion - shrunkDispersion) / totalDispersion,
    exactness: 'empirical',
    method: `${collect.length} bootstrap resamples of the ${n} observations; μ and Σ re-estimated and the ${objective === 'tangency' ? 'maximum-Sharpe' : 'minimum-variance'} portfolio recomputed in each.`,
    verdict:
      totalDispersion > 0.5
        ? `The optimal weights are not identifiable from this data: across resamples the weights move by ${plain.meanAbsoluteDeviation.toPrecision(3)} in total absolute terms, against a budget of 1. Any single "optimal" portfolio from this sample is one draw from a wide distribution, and reporting it alone would be false precision.`
        : `The optimal weights are moderately stable across resamples (total absolute movement ${plain.meanAbsoluteDeviation.toPrecision(3)} against a budget of 1), but the dispersion shown here is the honest uncertainty in the "optimal" portfolio.`,
    notes: [
      'Mean–variance optimisation is an error maximiser: it allocates most to whatever had the highest estimated return, and estimated returns are the least reliable inputs there are. The dispersion above is that effect measured, not asserted.',
      'Shrinkage of the covariance matrix reduces the dispersion of the weights. It cannot repair the expected-return estimates, which are the larger problem.',
      'The resampled (mean) weights are more diversified than the single-sample optimum, which is the practical argument for resampled optimisation.',
      'Bootstrap resampling assumes the observations are independent draws from a fixed distribution. If returns are autocorrelated or the regime changed, the true uncertainty is larger than this.',
    ],
  };
}

/** Largest eigenvalue, exposed because the optimiser step size depends on it. */
export function largestEigenvalue(sigma: Matrix): number {
  return jacobiEigen(sigma).values[sigma.length - 1];
}
