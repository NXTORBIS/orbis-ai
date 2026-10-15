/**
 * Chance-constrained programming: constraints required to hold with a stated
 * probability rather than always.
 *
 * Four routes, which are NOT interchangeable, and the difference between them
 * is the point of this file:
 *
 *  1. EXACT, for a Gaussian coefficient vector. P(a(ξ)ᵀx <= b) >= 1−ε is
 *     equivalent to  āᵀx + z_{1−ε}·‖Σ^{1/2}x‖ <= b, a second-order cone
 *     constraint. Exact given the Gaussian assumption — and that assumption is
 *     doing almost all the work, which `tailSensitivity` quantifies.
 *  2. BONFERRONI, for a joint constraint. Splitting ε equally across m rows is
 *     always safe and usually wasteful; the realised joint reliability is
 *     measured and reported next to the required one so the waste is visible.
 *  3. SCENARIO APPROXIMATION. Enforce the constraint on N independent draws.
 *     Distribution-free, and the Calafiore–Campi bound turns the sample size
 *     into a rigorous confidence statement about the violation probability.
 *  4. CVaR, via Rockafellar–Uryasev. Convex, needs no distributional form, and
 *     is a strictly stronger requirement: CVaR_α(f) <= 0 implies VaR_α(f) <= 0
 *     implies P(f <= 0) >= α. That implication is one-way and is asserted in
 *     the tests, not merely asserted here.
 *
 * The warning this module is obliged to give: a chance constraint at 1−ε with ε
 * small is a statement about the far tail of the assumed distribution, which is
 * exactly the part of it that the data cannot pin down. `tailSensitivity`
 * reports how much the required safety margin moves when the Gaussian tail is
 * swapped for a heavier one of IDENTICAL variance. At 99.9% that factor is
 * substantial, and no amount of optimisation effort recovers it.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import { Random } from '../random/rng';
import type { Seed } from '../random/rng';
import { normalCdf, normalQuantile } from '../special/gamma';
import { choleskyWithCheck, matVec, type Matrix } from '../stats/linalg';
import { quantile as sampleQuantile, sortedCopy, quantileSorted } from '../stats/descriptive';
import { solveConvexLp, requireOptimal, type ConvexConstraint, type ConvexSolution } from './linear';
import type { LpProblem, LpRow, Provenance } from './types';

/* ------------------------------------------------------- validation */

export function checkReliability(level: number, field = 'reliability'): void {
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    throw new EngineError(
      `${field}: a chance-constraint level must lie strictly inside (0, 1); got ${String(level)}. A level of 0 imposes nothing and a level of 1 is a hard constraint, and neither is a chance constraint — state it as one or the other instead.`,
      'range',
    );
  }
}

/** Require a genuinely positive-definite covariance and return its Cholesky factor. */
export function requirePositiveDefinite(sigma: Matrix, n: number, label: string): Matrix {
  if (sigma.length !== n) throw new EngineError(`${label} has ${sigma.length} rows but the problem has ${n} variables.`, 'shape');
  for (const row of sigma) {
    if (row.length !== n) throw new EngineError(`${label} is not square: a row has ${row.length} entries, expected ${n}.`, 'shape');
    for (const v of row) if (!Number.isFinite(v)) throw new EngineError(`${label} contains a non-finite entry.`, 'finite');
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(sigma[i][j] - sigma[j][i]) > 1e-10 * (1 + Math.abs(sigma[i][j]))) {
        throw new EngineError(`${label} is not symmetric: entry (${i + 1},${j + 1}) is ${sigma[i][j]} but (${j + 1},${i + 1}) is ${sigma[j][i]}.`, 'shape');
      }
    }
  }
  const chol = choleskyWithCheck(sigma);
  if (!chol.ok) {
    throw new EngineError(
      `${label} is not positive definite, so it is not a covariance matrix and the quadratic form xᵀΣx it defines can be negative. The square root the reformulation needs does not exist. Repair the matrix (for example by shrinking it towards its diagonal) before using it.`,
      'degenerate',
    );
  }
  return chol.L;
}

/* --------------------------------- 1. the exact Gaussian reformulation */

export interface GaussianChanceSpec {
  name: string;
  /** Mean of the uncertain coefficient vector, ā. */
  meanCoef: number[];
  /** Covariance of the coefficient vector, Σ. Must be positive definite. */
  covariance: Matrix;
  rhs: number;
  /** Required probability that the row holds, 1 − ε, strictly inside (0,1). */
  reliability: number;
}

/** Standard deviation of a(ξ)ᵀx: sqrt(xᵀΣx). */
export function constraintSd(sigma: Matrix, x: number[]): number {
  const sx = matVec(sigma, x);
  let acc = 0;
  for (let j = 0; j < x.length; j++) acc += x[j] * sx[j];
  return Math.sqrt(Math.max(0, acc));
}

/**
 * The convex constraint  āᵀx + z_{1−ε}·sqrt(xᵀΣx) − b <= 0.
 *
 * At reliability below 1/2 the safety coefficient z is negative and the
 * function is concave, not convex, so the reformulation is no longer tractable
 * and is refused rather than solved as though it were.
 */
export function gaussianChanceConstraint(spec: GaussianChanceSpec, n: number): ConvexConstraint {
  checkReliability(spec.reliability, spec.name);
  if (spec.meanCoef.length !== n) throw new EngineError(`Chance constraint "${spec.name}" has ${spec.meanCoef.length} mean coefficients but the problem has ${n} variables.`, 'shape');
  requirePositiveDefinite(spec.covariance, n, `The covariance of chance constraint "${spec.name}"`);
  const z = normalQuantile(spec.reliability);
  if (z < 0) {
    throw new EngineError(
      `Chance constraint "${spec.name}" is required to hold with probability ${spec.reliability}, which is below 1/2. The quantile reformulation then has a negative safety coefficient (z = ${z.toPrecision(6)}) and becomes concave, so it is not a tractable convex constraint. A requirement weaker than a coin flip is almost certainly not the constraint that was meant.`,
      'degenerate',
    );
  }
  return {
    name: spec.name,
    value: (x) => stableSum(spec.meanCoef.map((a, j) => a * x[j])) + z * constraintSd(spec.covariance, x) - spec.rhs,
    gradient: (x) => {
      const sd = constraintSd(spec.covariance, x);
      const sx = matVec(spec.covariance, x);
      return spec.meanCoef.map((a, j) => a + (sd > 1e-14 ? (z * sx[j]) / sd : 0));
    },
  };
}

export interface ChanceConstraintReport {
  name: string;
  /** Required probability the row holds. */
  required: number;
  /** āᵀx at the solution. */
  mean: number;
  sd: number;
  /** z_{1−ε}, the safety coefficient in standard deviations. */
  safetyCoefficient: number;
  /** b − āᵀx − z·sd; >= 0 means the reformulated constraint holds. */
  slack: number;
  /** Probability the row actually holds at the solution under the Gaussian model. */
  achieved: number;
}

export interface ChanceSolution {
  solution: ConvexSolution;
  constraints: ChanceConstraintReport[];
  provenance: Provenance;
}

/** Solve an LP with individual Gaussian chance constraints by exact reformulation. */
export function solveGaussianChanceLp(lp: LpProblem, specs: GaussianChanceSpec[], options: { residualTolerance?: number } = {}): ChanceSolution {
  if (specs.length === 0) throw new EngineError('No chance constraints were given; solve the program with solveLp instead.', 'empty');
  const n = lp.objective.length;
  const constraints = specs.map((s) => gaussianChanceConstraint(s, n));
  const solution = solveConvexLp(lp, constraints, { residualTolerance: options.residualTolerance ?? 1e-9 });
  if (solution.status !== 'optimal') {
    throw new EngineError(
      `The chance-constrained program ended "${solution.status}". ${
        solution.status === 'infeasible'
          ? `The required reliabilities cannot be met together with the deterministic rows${(solution.witnesses ?? []).length ? `: ${(solution.witnesses ?? []).map((w) => `${w.name} short by ${w.violation.toPrecision(6)}`).join('; ')}` : ''}. Lower a reliability level or relax a row.`
          : 'Bound the decision variables.'
      }`,
      solution.status,
    );
  }
  const reports: ChanceConstraintReport[] = specs.map((s) => {
    const mean = stableSum(s.meanCoef.map((a, j) => a * solution.x[j]));
    const sd = constraintSd(s.covariance, solution.x);
    const z = normalQuantile(s.reliability);
    return {
      name: s.name,
      required: s.reliability,
      mean,
      sd,
      safetyCoefficient: z,
      slack: s.rhs - mean - z * sd,
      achieved: sd > 1e-14 ? normalCdf((s.rhs - mean) / sd) : mean <= s.rhs ? 1 : 0,
    };
  });
  const provenance: Provenance = {
    exactness: 'numerical',
    method: `Exact quantile (second-order cone) reformulation of each individual chance constraint, solved by Kelley cutting planes over the reused simplex (${solution.cuts} cuts, safety margin ${solution.margin.toExponential(2)}, largest remaining constraint residual ${solution.maxViolation.toExponential(2)})`,
    assumedInputs: [
      'The uncertain coefficient vector of each row is multivariate Gaussian with the stated mean and covariance. The reformulation is exact for that assumption and for no other.',
      'The covariances are estimates. A covariance estimated from n observations has relative error of order 1/sqrt(n), which propagates into the safety margin linearly.',
    ],
    limitations: [
      'Labelled numerical rather than exact only because the cone constraint is reached by a finite cutting-plane sequence; the reformulation itself is exact. The residual above is the distance from the cone boundary.',
      'Individual chance constraints say nothing jointly: m rows each holding with probability 0.95 may hold together with probability as low as max(0, 1 − 0.05m).',
      'A high reliability level is a statement about the Gaussian tail. See tailSensitivity for how much the margin moves under an equally plausible heavier-tailed model with the same variance.',
    ],
  };
  return { solution, constraints: reports, provenance };
}

/* ------------------------------------------- 2. joint, via Bonferroni */

export interface JointChanceSolution extends ChanceSolution {
  /** Required probability that ALL rows hold simultaneously. */
  jointRequired: number;
  /** The per-row level Bonferroni allocates: 1 − ε/m. */
  perRowLevel: number;
  /**
   * Lower bound on the joint reliability that Bonferroni guarantees, and the
   * best case: with m rows, the union bound is tight only when the violation
   * events are disjoint, which is the worst possible dependence. Under any
   * other dependence the solution over-satisfies the requirement.
   */
  guaranteedJoint: number;
}

/**
 * Joint chance constraint by the Bonferroni (union) bound.
 *
 * P(all m rows hold) >= 1 − Σ P(row i fails) >= 1 − ε when each row is held at
 * 1 − ε/m. This is CONSERVATIVE, sometimes severely: the bound is tight only if
 * the m violation events never co-occur. `jointSatisfactionProbability`
 * measures the realised joint reliability so the conservatism is a number, not
 * a caveat.
 */
export function solveJointChanceBonferroni(
  lp: LpProblem,
  specs: Omit<GaussianChanceSpec, 'reliability'>[],
  jointReliability: number,
  options: { residualTolerance?: number } = {},
): JointChanceSolution {
  checkReliability(jointReliability, 'joint reliability');
  if (specs.length === 0) throw new EngineError('A joint chance constraint needs at least one row.', 'empty');
  const m = specs.length;
  const epsilon = 1 - jointReliability;
  const perRow = 1 - epsilon / m;
  if (perRow >= 1) throw new EngineError(`Splitting ε = ${epsilon} across ${m} rows leaves a per-row level of ${perRow}, which rounds to a hard constraint. Use hard constraints, or ask for a lower joint reliability.`, 'range');
  const allocated: GaussianChanceSpec[] = specs.map((s) => ({ ...s, reliability: perRow }));
  const base = solveGaussianChanceLp(lp, allocated, options);
  return {
    ...base,
    jointRequired: jointReliability,
    perRowLevel: perRow,
    guaranteedJoint: jointReliability,
    provenance: {
      ...base.provenance,
      method: `${base.provenance.method}; joint level ${jointReliability} enforced by the Bonferroni split to ${perRow} per row across ${m} rows`,
      limitations: [
        ...base.provenance.limitations,
        `Bonferroni is a one-sided bound. It guarantees joint reliability at least ${jointReliability}, and the solution will normally achieve more than that — the gap is wasted objective value. The bound is tight only when the ${m} violation events are mutually exclusive, which is the worst dependence structure rather than a typical one.`,
      ],
    },
  };
}

/** Measure the realised joint reliability of a decision by Monte Carlo. */
export function jointSatisfactionProbability(
  x: number[],
  specs: Omit<GaussianChanceSpec, 'reliability'>[],
  options: { seed: Seed; draws?: number },
): { probability: number; standardError: number; draws: number; perRow: number[] } {
  const draws = options.draws ?? 20000;
  if (!Number.isInteger(draws) || draws < 100) throw new EngineError('Measuring a joint reliability needs at least 100 draws.', 'range');
  const rng = new Random(options.seed);
  const n = x.length;
  const factors = specs.map((s) => requirePositiveDefinite(s.covariance, n, `The covariance of "${s.name}"`));
  let allHold = 0;
  const rowHolds = new Array<number>(specs.length).fill(0);
  const z = new Array<number>(n).fill(0);
  for (let d = 0; d < draws; d++) {
    let ok = true;
    for (let i = 0; i < specs.length; i++) {
      for (let j = 0; j < n; j++) z[j] = rng.normal();
      let lhs = 0;
      for (let j = 0; j < n; j++) {
        let a = specs[i].meanCoef[j];
        for (let k = 0; k <= j; k++) a += factors[i][j][k] * z[k];
        lhs += a * x[j];
      }
      if (lhs <= specs[i].rhs) rowHolds[i]++;
      else ok = false;
    }
    if (ok) allHold++;
  }
  const p = allHold / draws;
  return { probability: p, standardError: Math.sqrt((p * (1 - p)) / draws), draws, perRow: rowHolds.map((c) => c / draws) };
}

/* ------------------------------- 3. the scenario approximation route */

/**
 * The Calafiore–Campi sample size: with
 *
 *     N >= (2/ε)·( ln(1/β) + d )
 *
 * independent draws, the optimal solution of the scenario program violates the
 * chance constraint with probability at most ε, with confidence at least 1−β.
 * The guarantee is distribution-free: it needs only that the draws are i.i.d.
 * from the same distribution the constraint refers to.
 */
export function calafioreCampiSampleSize(epsilon: number, beta: number, dimension: number): number {
  checkReliability(epsilon, 'violation level ε');
  checkReliability(beta, 'confidence parameter β');
  if (!Number.isInteger(dimension) || dimension < 1) throw new EngineError('The decision dimension must be a whole number of at least 1.', 'range');
  return Math.ceil((2 / epsilon) * (Math.log(1 / beta) + dimension));
}

export interface ScenarioApproximationResult {
  solution: ReturnType<typeof requireOptimal>;
  /** Number of sampled constraint sets enforced. */
  draws: number;
  requiredDraws: number;
  epsilon: number;
  beta: number;
  /** True only if `draws >= requiredDraws`; otherwise the guarantee does NOT hold. */
  guaranteeHolds: boolean;
  provenance: Provenance;
}

/**
 * Solve the scenario program: the deterministic rows plus every sampled row,
 * all enforced. Reports whether the sample size earns the Calafiore–Campi
 * guarantee; if it does not, the result says so instead of implying otherwise.
 */
export function solveScenarioApproximation(
  lp: LpProblem,
  sampledRows: LpRow[][],
  options: { epsilon: number; beta: number },
): ScenarioApproximationResult {
  if (sampledRows.length === 0) throw new EngineError('The scenario approximation needs at least one sampled constraint set.', 'empty');
  const d = lp.objective.length;
  const requiredDraws = calafioreCampiSampleSize(options.epsilon, options.beta, d);
  const rows: LpRow[] = [...lp.rows];
  sampledRows.forEach((set, i) => {
    set.forEach((r, k) => rows.push({ ...r, name: `sample ${i + 1}: ${r.name ?? `row ${k + 1}`}` }));
  });
  const solution = requireOptimal({ ...lp, rows }, 'The scenario approximation');
  const guaranteeHolds = sampledRows.length >= requiredDraws;
  const provenance: Provenance = {
    exactness: 'numerical',
    method: `Scenario approximation: ${sampledRows.length} sampled constraint sets enforced exactly, solved as one linear program (${rows.length} rows)`,
    assumedInputs: [
      'The sampled constraint sets are independent draws from the same distribution the chance constraint refers to. The guarantee rests on that and on nothing else about the distribution.',
    ],
    limitations: guaranteeHolds
      ? [
          `With ${sampledRows.length} draws (the Calafiore–Campi requirement is ${requiredDraws} for ε = ${options.epsilon}, β = ${options.beta}, d = ${d}), the solution violates the constraint with probability at most ${options.epsilon} with confidence at least ${1 - options.beta}.`,
          'The bound is distribution-free and therefore loose: the realised violation probability is usually far below ε.',
        ]
      : [
          `ONLY ${sampledRows.length} draws were given, below the Calafiore–Campi requirement of ${requiredDraws} for ε = ${options.epsilon}, β = ${options.beta}, d = ${d}. The solution is feasible for the sample but NO confidence guarantee about its violation probability follows.`,
        ],
  };
  return { solution, draws: sampledRows.length, requiredDraws, epsilon: options.epsilon, beta: options.beta, guaranteeHolds, provenance };
}

/* ------------------------------------------------------------ 4. CVaR */

export interface LossScenario {
  name: string;
  probability: number;
  /** Loss is coefᵀx − rhs; the constraint of interest is loss <= 0. */
  coef: number[];
  rhs: number;
}

/** Empirical VaR at level α of a weighted loss sample: the α-quantile. */
export function discreteVar(losses: number[], probabilities: number[], level: number): number {
  checkReliability(level, 'VaR level');
  if (losses.length !== probabilities.length) throw new EngineError('VaR needs one probability per loss.', 'shape');
  const order = losses.map((_, i) => i).sort((a, b) => losses[a] - losses[b]);
  let acc = 0;
  for (const i of order) {
    acc += probabilities[i];
    if (acc >= level - 1e-12) return losses[i];
  }
  return losses[order[order.length - 1]];
}

/**
 * Empirical CVaR at level α: the Rockafellar–Uryasev value
 * min_t { t + E[(L − t)⁺]/(1−α) }, evaluated at t = VaR so the identity holds
 * exactly on a discrete distribution including when an atom straddles the
 * quantile.
 */
export function discreteCvar(losses: number[], probabilities: number[], level: number): number {
  const t = discreteVar(losses, probabilities, level);
  let excess = 0;
  for (let i = 0; i < losses.length; i++) excess += probabilities[i] * Math.max(0, losses[i] - t);
  return t + excess / (1 - level);
}

export interface CvarConstrainedSolution {
  x: number[];
  objective: number;
  /** The optimal t in the Rockafellar–Uryasev form; the VaR of the loss at x. */
  varAtLevel: number;
  cvarAtLevel: number;
  level: number;
  /** Probability that the loss is <= 0 at the solution, which CVaR <= 0 forces to be >= level. */
  satisfactionProbability: number;
  provenance: Provenance;
}

/**
 * min cᵀx s.t. deterministic rows and CVaR_α(loss(x, ξ)) <= `bound`.
 *
 * The Rockafellar–Uryasev reformulation adds one free variable t and one
 * non-negative variable per scenario, keeping the whole thing a linear program.
 * CVaR is convex in x where a probability constraint is not, which is the
 * entire reason to prefer it — at the price of being a strictly stronger
 * requirement.
 */
export function solveCvarConstrainedLp(
  lp: LpProblem,
  scenarios: LossScenario[],
  level: number,
  options: { bound?: number } = {},
): CvarConstrainedSolution {
  checkReliability(level, 'CVaR level');
  if (scenarios.length === 0) throw new EngineError('A CVaR constraint needs at least one loss scenario.', 'empty');
  const sum = stableSum(scenarios.map((s) => s.probability));
  if (Math.abs(sum - 1) > 1e-9) throw new EngineError(`The loss-scenario probabilities sum to ${sum.toPrecision(12)}, not 1.`, 'sum');
  const n = lp.objective.length;
  for (const s of scenarios) {
    if (s.coef.length !== n) throw new EngineError(`Loss scenario "${s.name}" has ${s.coef.length} coefficients but the program has ${n} variables.`, 'shape');
  }
  const S = scenarios.length;
  const bound = options.bound ?? 0;
  const total = n + 1 + S; // x, t, u_s
  const objective = new Array<number>(total).fill(0);
  for (let j = 0; j < n; j++) objective[j] = lp.objective[j];
  const rows: LpRow[] = lp.rows.map((r, i) => {
    const coef = new Array<number>(total).fill(0);
    for (let j = 0; j < n; j++) coef[j] = r.coef[j];
    return { coef, sense: r.sense, rhs: r.rhs, name: r.name ?? `row ${i + 1}` };
  });
  // u_s >= loss_s(x) − t
  scenarios.forEach((s, i) => {
    const coef = new Array<number>(total).fill(0);
    for (let j = 0; j < n; j++) coef[j] = -s.coef[j];
    coef[n] = 1; // t
    coef[n + 1 + i] = 1; // u_s
    rows.push({ coef, sense: '>=', rhs: -s.rhs, name: `CVaR excess for ${s.name}` });
  });
  // t + Σ p_s u_s / (1−α) <= bound
  {
    const coef = new Array<number>(total).fill(0);
    coef[n] = 1;
    scenarios.forEach((s, i) => {
      coef[n + 1 + i] = s.probability / (1 - level);
    });
    rows.push({ coef, sense: '<=', rhs: bound, name: `CVaR at level ${level} within ${bound}` });
  }
  const lower = new Array<number>(total).fill(0);
  const upper = new Array<number>(total).fill(Infinity);
  for (let j = 0; j < n; j++) {
    lower[j] = lp.lower?.[j] ?? 0;
    upper[j] = lp.upper?.[j] ?? Infinity;
  }
  lower[n] = -Infinity; // t is free
  const sol = requireOptimal({ sense: lp.sense, objective, rows, lower, upper, constant: lp.constant }, `The CVaR-constrained program at level ${level}`);
  const x = sol.x.slice(0, n);
  const losses = scenarios.map((s) => stableSum(s.coef.map((a, j) => a * x[j])) - s.rhs);
  const probs = scenarios.map((s) => s.probability);
  const cvar = discreteCvar(losses, probs, level);
  const varValue = discreteVar(losses, probs, level);
  let satisfied = 0;
  for (let i = 0; i < S; i++) if (losses[i] <= 1e-9) satisfied += probs[i];
  return {
    x,
    objective: sol.objective,
    varAtLevel: varValue,
    cvarAtLevel: cvar,
    level,
    satisfactionProbability: satisfied,
    provenance: {
      exactness: 'exact',
      method: `Rockafellar–Uryasev linear reformulation of CVaR_${level} over ${S} loss scenarios: ${total} variables, ${rows.length} rows, solved to optimality`,
      assumedInputs: [
        'The loss scenarios and their probabilities are the user\'s model of the uncertainty. CVaR is exact for that discrete distribution.',
      ],
      limitations: [
        `CVaR_${level}(L) <= ${bound} implies VaR_${level}(L) <= ${bound}, hence P(L <= ${bound}) >= ${level}. The implication is one-way: this solution is at least as safe as the corresponding chance constraint requires, and generally more expensive than the chance constraint's optimum.`,
        'CVaR averages the worst tail, so it responds to how bad the bad cases are, not only to how often they happen. That is usually what is wanted and is a different requirement from a probability.',
      ],
    },
  };
}

/* -------------------------------------------------- the honest warning */

export interface TailSensitivityReport {
  reliability: number;
  /** z_{1−ε} under the Gaussian model. */
  gaussian: number;
  /** The same quantile for unit-variance Laplace and logistic laws. */
  laplace: number;
  logistic: number;
  /** Largest alternative margin divided by the Gaussian one. */
  worstRatio: number;
  message: string;
}

/**
 * How much of the safety margin is the Gaussian assumption rather than the
 * data? Each comparison law is standardised to variance 1, so the mean and the
 * variance — the only things an estimate really pins down — are held fixed and
 * ONLY the tail shape changes.
 */
export function tailSensitivity(reliability: number): TailSensitivityReport {
  checkReliability(reliability, 'reliability');
  const z = normalQuantile(reliability);
  const laplaceDef = getDistribution('laplace');
  const logisticDef = getDistribution('logistic');
  const laplace = laplaceDef.quantile(reliability, { mu: 0, b: Math.SQRT1_2 });
  const logistic = logisticDef.quantile(reliability, { mu: 0, s: Math.sqrt(3) / Math.PI });
  const worst = Math.max(laplace, logistic);
  const ratio = z > 0 ? worst / z : Infinity;
  return {
    reliability,
    gaussian: z,
    laplace,
    logistic,
    worstRatio: ratio,
    message:
      `At reliability ${reliability} the Gaussian model asks for a margin of ${z.toPrecision(4)} standard deviations. A Laplace law with the SAME variance asks for ${laplace.toPrecision(4)} and a logistic one for ${logistic.toPrecision(4)} — up to ${((ratio - 1) * 100).toPrecision(3)}% more, from changing only the tail shape, which is the part of the distribution the data determines least well. ` +
      (reliability >= 0.99
        ? 'At this level the constraint is a statement about an event seen at most once in a hundred observations; the sample that calibrated it almost certainly contains too few such events to distinguish these laws.'
        : 'The sensitivity grows quickly with the level: re-run this at 0.99 and 0.999 before committing to a high reliability.'),
  };
}

/** Sample quantile helpers re-exported so a caller need not reach into stats. */
export { sampleQuantile, sortedCopy, quantileSorted };
