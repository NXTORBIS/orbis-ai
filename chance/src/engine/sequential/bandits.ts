/**
 * Multi-armed bandits: the explore/exploit trade-off.
 *
 * Honest reporting is the hard part here, not the algorithms. Regret is a
 * RANDOM quantity: one run of Thompson sampling against one run of UCB1 tells
 * you essentially nothing, and presenting such a comparison as evidence would
 * be misleading. Every result in this module is therefore an average over
 * replications, reported with its Monte Carlo standard error and the spread
 * across runs, and the benchmark is not another algorithm but the Lai–Robbins
 * information-theoretic lower bound, which no algorithm can beat
 * asymptotically.
 *
 * The experiment runs as a GENERATOR that yields between chunks of
 * replications, matching `simulationSteps` in src/engine/simulation/runner.ts,
 * so a long study can be cancelled: a worker blocked in a synchronous loop can
 * never receive a cancel message.
 */
import { brentRoot, clamp } from '../core/numeric';
import { EngineError, type Issue } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import { mean, quantileSorted, sortedCopy, variance } from '../stats/descriptive';
import { solve } from '../stats/linalg';
import type { Provenance } from './types';

export const BANDIT_LIMITS = {
  maxArms: 1000,
  maxHorizon: 2000000,
  maxReplications: 20000,
  /** Replications per yield of the generator. */
  chunkReplications: 4,
};

export type BanditFamily = 'bernoulli' | 'gaussian';

export interface BanditSpec {
  family: BanditFamily;
  /** True mean reward of each arm. */
  means: number[];
  /** Reward standard deviation; Gaussian arms only. */
  sd?: number;
  armLabels?: string[];
}

export type BanditAlgorithmId =
  | 'thompson-beta'
  | 'thompson-gaussian'
  | 'ucb1'
  | 'ucb-tuned'
  | 'kl-ucb'
  | 'epsilon-greedy'
  | 'exp3'
  | 'successive-elimination'
  | 'gittins';

export interface BanditAlgorithmConfig {
  id: BanditAlgorithmId;
  /** epsilon-greedy: the exploration rate. */
  epsilon?: number;
  /** epsilon-greedy: decay the rate as min(1, epsilon·K/t) when true. */
  decay?: boolean;
  /** EXP3: the mixing parameter; defaults to the horizon-tuned value. */
  gamma?: number;
  /** Successive elimination / best-arm identification: failure probability. */
  delta?: number;
  /** Thompson (Gaussian): assumed observation standard deviation. */
  priorSd?: number;
  /** Gittins: the discount factor the index is calibrated for. */
  discount?: number;
  /** Gittins: a precomputed index table from gittinsIndexTable(). */
  indexTable?: number[][];
  label?: string;
}

export function validateBanditSpec(spec: BanditSpec): Issue[] {
  const issues: Issue[] = [];
  if (!spec || !Array.isArray(spec.means) || spec.means.length === 0) {
    issues.push({ code: 'empty', field: 'means', message: 'A bandit needs at least one arm. With zero arms there is nothing to choose between and no regret to report.' });
    return issues;
  }
  if (spec.means.length > BANDIT_LIMITS.maxArms) {
    issues.push({ code: 'limit', field: 'means', message: `At most ${BANDIT_LIMITS.maxArms} arms are supported; ${spec.means.length} were supplied.` });
  }
  for (let a = 0; a < spec.means.length; a++) {
    const m = spec.means[a];
    if (!Number.isFinite(m)) {
      issues.push({ code: 'finite', field: `means[${a}]`, message: `The mean reward of arm ${a} is not a finite number.` });
    } else if (spec.family === 'bernoulli' && (m < 0 || m > 1)) {
      issues.push({ code: 'range', field: `means[${a}]`, message: `Arm ${a} has mean ${m}; a Bernoulli arm's mean must lie in [0, 1].` });
    }
  }
  if (spec.family === 'gaussian') {
    const sd = spec.sd ?? 1;
    if (!Number.isFinite(sd) || sd <= 0) {
      issues.push({ code: 'range', field: 'sd', message: 'Gaussian arms need a reward standard deviation greater than 0.' });
    }
  } else if (spec.family !== 'bernoulli') {
    issues.push({ code: 'unknown', field: 'family', message: `Unknown arm family "${String(spec.family)}"; use "bernoulli" or "gaussian".` });
  }
  if (spec.armLabels && spec.armLabels.length !== spec.means.length) {
    issues.push({ code: 'shape', field: 'armLabels', message: `${spec.means.length} arm labels are required; ${spec.armLabels.length} were supplied.` });
  }
  return issues;
}

/* --------------------------------------------- Lai–Robbins lower bound */

/** Bernoulli KL divergence, in nats, with the boundary cases handled. */
export function klBernoulli(p: number, q: number): number {
  const pp = clamp(p, 0, 1);
  const qq = clamp(q, 0, 1);
  if (qq === 0) return pp === 0 ? 0 : Infinity;
  if (qq === 1) return pp === 1 ? 0 : Infinity;
  let acc = 0;
  if (pp > 0) acc += pp * Math.log(pp / qq);
  if (pp < 1) acc += (1 - pp) * Math.log((1 - pp) / (1 - qq));
  return acc;
}

export interface LaiRobbinsResult {
  /** The constant C with R_T ≳ C·log T. */
  constant: number;
  /** C·log T at the requested horizon. */
  bound: number;
  perArm: { arm: number; gap: number; divergence: number; contribution: number }[];
  provenance: Provenance;
}

/**
 * The Lai–Robbins asymptotic lower bound on the regret of any consistent
 * bandit algorithm:
 *
 *     liminf_{T→∞} R_T / log T ≥ Σ_{a : Δ_a > 0} Δ_a / KL(θ_a, θ*)
 *
 * This is the benchmark every algorithm must be compared against. It is an
 * information-theoretic limit, not a property of a particular algorithm: an
 * algorithm that appears to beat it asymptotically is not clever, it is
 * buggy — or it is not consistent, meaning it fails badly on some other
 * problem instance. Note that the bound is ASYMPTOTIC: at small T a good
 * algorithm's regret can sit below C·log T, because the bound holds in the
 * limit and ignores lower-order terms.
 */
export function laiRobbinsBound(spec: BanditSpec, horizon: number): LaiRobbinsResult {
  const issues = validateBanditSpec(spec);
  if (issues.length) throw new EngineError(issues);
  if (!Number.isFinite(horizon) || horizon < 1) throw new EngineError('The horizon for the Lai–Robbins bound must be at least 1.', 'range');
  const best = Math.max(...spec.means);
  const perArm: LaiRobbinsResult['perArm'] = [];
  let constant = 0;
  for (let a = 0; a < spec.means.length; a++) {
    const gap = best - spec.means[a];
    if (gap <= 0) continue;
    const divergence =
      spec.family === 'bernoulli'
        ? klBernoulli(spec.means[a], best)
        : Math.pow(gap, 2) / (2 * Math.pow(spec.sd ?? 1, 2));
    if (!(divergence > 0) || !Number.isFinite(divergence)) {
      throw new EngineError(
        `Arm ${a} is suboptimal by ${gap} but its Kullback–Leibler divergence from the best arm is ${divergence}, so the Lai–Robbins constant is not finite. This happens when an arm's reward distribution cannot be confused with the best arm's at all (for example a Bernoulli arm with mean exactly 0 or 1), in which case no sampling is needed to tell them apart and the bound does not apply.`,
        'degenerate',
      );
    }
    const contribution = gap / divergence;
    constant += contribution;
    perArm.push({ arm: a, gap, divergence, contribution });
  }
  return {
    constant,
    bound: constant * Math.log(horizon),
    perArm,
    provenance: {
      exactness: 'exact',
      method: 'Lai–Robbins asymptotic lower bound Σ Δ_a / KL(θ_a, θ*)',
      assumedInputs: ['The true arm means are known here because this is a benchmark computation; an algorithm facing the bandit does not know them.'],
      limitations: [
        'ASYMPTOTIC: the bound constrains liminf R_T/log T. At a finite horizon the regret of a good algorithm may be below C·log T, and that is not a contradiction.',
        'The bound applies to CONSISTENT algorithms — those with sub-linear regret on every instance in the family. An algorithm that always pulls arm 0 has zero regret on the instance where arm 0 is best and linear regret elsewhere; it beats the bound on one instance by failing everywhere else.',
      ],
    },
  };
}

/* ---------------------------------------------------------- the algorithms */

interface ArmState {
  pulls: number[];
  sums: number[];
  sumSquares: number[];
}

interface Agent {
  select(t: number): number;
  update(arm: number, reward: number, t: number): void;
}

function klUcbUpper(phat: number, n: number, budget: number): number {
  // Largest q ≥ p̂ with n·KL(p̂, q) ≤ budget, by bisection (monotone in q).
  if (budget <= 0 || n <= 0) return 1;
  let lo = clamp(phat, 0, 1);
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (n * klBernoulli(phat, mid) > budget) hi = mid;
    else lo = mid;
  }
  return lo;
}

function makeAgent(cfg: BanditAlgorithmConfig, spec: BanditSpec, horizon: number, rng: Random, state: ArmState): Agent {
  const K = spec.means.length;
  const mean_ = (a: number): number => (state.pulls[a] > 0 ? state.sums[a] / state.pulls[a] : 0);
  switch (cfg.id) {
    case 'thompson-beta': {
      return {
        select: () => {
          let best = 0;
          let bestDraw = -Infinity;
          for (let a = 0; a < K; a++) {
            // Beta(1,1) prior updated by successes and failures.
            const s = state.sums[a];
            const f = state.pulls[a] - s;
            const draw = rng.beta(1 + s, 1 + f);
            if (draw > bestDraw) {
              bestDraw = draw;
              best = a;
            }
          }
          return best;
        },
        update: () => undefined,
      };
    }
    case 'thompson-gaussian': {
      const sd = cfg.priorSd ?? spec.sd ?? 1;
      return {
        select: () => {
          let best = 0;
          let bestDraw = -Infinity;
          for (let a = 0; a < K; a++) {
            // N(0, 1) prior on the mean with known observation variance sd².
            const n = state.pulls[a];
            const postVar = 1 / (1 + n / (sd * sd));
            const postMean = (state.sums[a] / (sd * sd)) * postVar;
            const draw = postMean + Math.sqrt(postVar) * rng.normal();
            if (draw > bestDraw) {
              bestDraw = draw;
              best = a;
            }
          }
          return best;
        },
        update: () => undefined,
      };
    }
    case 'ucb1': {
      return {
        select: (t) => {
          for (let a = 0; a < K; a++) if (state.pulls[a] === 0) return a;
          let best = 0;
          let bestIdx = -Infinity;
          for (let a = 0; a < K; a++) {
            const idx = mean_(a) + Math.sqrt((2 * Math.log(t)) / state.pulls[a]);
            if (idx > bestIdx) {
              bestIdx = idx;
              best = a;
            }
          }
          return best;
        },
        update: () => undefined,
      };
    }
    case 'ucb-tuned': {
      return {
        select: (t) => {
          for (let a = 0; a < K; a++) if (state.pulls[a] === 0) return a;
          let best = 0;
          let bestIdx = -Infinity;
          const logT = Math.log(t);
          for (let a = 0; a < K; a++) {
            const n = state.pulls[a];
            const m = mean_(a);
            const v = Math.max(0, state.sumSquares[a] / n - m * m) + Math.sqrt((2 * logT) / n);
            const idx = m + Math.sqrt((logT / n) * Math.min(0.25, v));
            if (idx > bestIdx) {
              bestIdx = idx;
              best = a;
            }
          }
          return best;
        },
        update: () => undefined,
      };
    }
    case 'kl-ucb': {
      if (spec.family !== 'bernoulli') {
        throw new EngineError('KL-UCB as implemented here uses the Bernoulli divergence and applies to Bernoulli arms only. Use UCB1 or Thompson sampling for Gaussian arms.', 'unsupported');
      }
      return {
        select: (t) => {
          for (let a = 0; a < K; a++) if (state.pulls[a] === 0) return a;
          const budget = Math.log(t) + 3 * Math.log(Math.max(Math.log(t), 1));
          let best = 0;
          let bestIdx = -Infinity;
          for (let a = 0; a < K; a++) {
            const idx = klUcbUpper(mean_(a), state.pulls[a], budget);
            if (idx > bestIdx) {
              bestIdx = idx;
              best = a;
            }
          }
          return best;
        },
        update: () => undefined,
      };
    }
    case 'epsilon-greedy': {
      const eps = cfg.epsilon ?? 0.1;
      if (!Number.isFinite(eps) || eps < 0 || eps > 1) throw new EngineError('The ε of ε-greedy must lie in [0, 1].', 'range');
      const decay = cfg.decay ?? false;
      return {
        select: (t) => {
          for (let a = 0; a < K; a++) if (state.pulls[a] === 0) return a;
          const rate = decay ? Math.min(1, (eps * K) / t) : eps;
          if (rng.uniform() < rate) return rng.int(0, K - 1);
          let best = 0;
          for (let a = 1; a < K; a++) if (mean_(a) > mean_(best)) best = a;
          return best;
        },
        update: () => undefined,
      };
    }
    case 'exp3': {
      // Adversarial case: rewards are assumed to lie in [0, 1].
      const gammaTuned = Math.min(1, Math.sqrt((K * Math.log(K)) / ((Math.E - 1) * horizon)));
      const g = cfg.gamma ?? gammaTuned;
      if (!Number.isFinite(g) || g <= 0 || g > 1) throw new EngineError('The γ of EXP3 must lie in (0, 1].', 'range');
      const logW = new Array<number>(K).fill(0);
      let probs = new Array<number>(K).fill(1 / K);
      const recompute = (): void => {
        const maxLog = Math.max(...logW);
        const w = logW.map((x) => Math.exp(x - maxLog));
        const total = w.reduce((p, q) => p + q, 0);
        probs = w.map((x) => (1 - g) * (x / total) + g / K);
      };
      return {
        select: () => {
          const u = rng.uniform();
          let acc = 0;
          for (let a = 0; a < K; a++) {
            acc += probs[a];
            if (u < acc) return a;
          }
          return K - 1;
        },
        update: (arm, reward) => {
          const scaled = clamp(reward, 0, 1);
          logW[arm] += (g * scaled) / (K * probs[arm]);
          recompute();
        },
      };
    }
    case 'successive-elimination': {
      const delta = cfg.delta ?? 0.05;
      if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) throw new EngineError('The δ of successive elimination must lie in (0, 1).', 'range');
      let active = Array.from({ length: K }, (_, a) => a);
      let cursor = 0;
      const radius = (n: number): number => Math.sqrt(Math.log((4 * K * horizon) / delta) / (2 * Math.max(n, 1)));
      return {
        select: () => {
          const arm = active[cursor % active.length];
          return arm;
        },
        update: () => {
          cursor++;
          if (cursor % active.length !== 0 || active.length <= 1) return;
          // End of a round: eliminate arms that cannot be the best.
          let bestLower = -Infinity;
          for (const a of active) bestLower = Math.max(bestLower, mean_(a) - radius(state.pulls[a]));
          const survivors = active.filter((a) => mean_(a) + radius(state.pulls[a]) >= bestLower);
          if (survivors.length >= 1) active = survivors;
          cursor = 0;
        },
      };
    }
    case 'gittins': {
      if (spec.family !== 'bernoulli') {
        throw new EngineError('The Gittins index implemented here is for Beta–Bernoulli arms. For other families no exact index is available in this module.', 'unsupported');
      }
      const table = cfg.indexTable;
      if (!table) {
        throw new EngineError('The Gittins policy needs a precomputed index table; call gittinsIndexTable(discount, maxPulls) and pass it as indexTable.', 'required');
      }
      return {
        select: () => {
          let best = 0;
          let bestIdx = -Infinity;
          for (let a = 0; a < K; a++) {
            const s = Math.round(state.sums[a]);
            const f = state.pulls[a] - s;
            if (s >= table.length || f >= table.length - s) {
              throw new EngineError(
                `The Gittins index table was built for at most ${table.length - 1} pulls per arm, but arm ${a} has been pulled ${state.pulls[a]} times. Rebuild the table with a larger maxPulls.`,
                'limit',
              );
            }
            const idx = table[s][f];
            if (idx > bestIdx) {
              bestIdx = idx;
              best = a;
            }
          }
          return best;
        },
        update: () => undefined,
      };
    }
    default:
      throw new EngineError(`Unknown bandit algorithm "${String(cfg.id)}".`, 'unknown');
  }
}

/* ------------------------------------------------------- the experiment */

export interface BanditRequest {
  spec: BanditSpec;
  horizon: number;
  replications: number;
  algorithms: BanditAlgorithmConfig[];
  seed: string;
  /** Cumulative regret is recorded at these horizons (default: geometric). */
  checkpoints?: number[];
  /** Per-step discount factor for the discounted-reward objective. */
  discount?: number;
}

export interface RegretPoint {
  t: number;
  /** Mean cumulative pseudo-regret across replications. */
  meanRegret: number;
  /** Monte Carlo standard error of that mean. */
  standardError: number;
  /** Spread across replications, not sampling error of the mean. */
  p05: number;
  p50: number;
  p95: number;
}

export interface AlgorithmOutcome {
  id: BanditAlgorithmId;
  label: string;
  regretCurve: RegretPoint[];
  finalRegret: RegretPoint;
  /** Mean number of pulls of each arm, with its Monte Carlo error. */
  armPulls: { arm: number; meanPulls: number; standardError: number }[];
  /** Δ_a · E[N_a(T)] per arm: the decomposition of the final regret. */
  regretDecomposition: { arm: number; gap: number; contribution: number }[];
  /** Mean expected discounted reward, when a discount was requested. */
  discountedReward?: { mean: number; standardError: number };
  /** Simple regret: the gap of the arm with the highest empirical mean. */
  simpleRegret: { mean: number; standardError: number };
  /** Fitted slope of log(cumulative regret) against log(t). */
  regretLogLogSlope: number;
}

export interface BanditExperimentResult {
  horizon: number;
  replications: number;
  algorithms: AlgorithmOutcome[];
  laiRobbins: LaiRobbinsResult;
  provenance: Provenance;
}

export function validateBanditRequest(req: BanditRequest): Issue[] {
  const issues = validateBanditSpec(req.spec);
  if (!Number.isInteger(req.horizon) || req.horizon < 1) {
    issues.push({ code: 'range', field: 'horizon', message: `The horizon must be a whole number of at least 1; ${req.horizon} was supplied.` });
  } else if (req.horizon > BANDIT_LIMITS.maxHorizon) {
    issues.push({ code: 'limit', field: 'horizon', message: `The horizon exceeds the supported maximum of ${BANDIT_LIMITS.maxHorizon}.` });
  }
  if (!Number.isInteger(req.replications) || req.replications < 2) {
    issues.push({
      code: 'range',
      field: 'replications',
      message: `At least 2 replications are required; ${req.replications} was supplied. Regret is a random quantity, and a single run cannot be reported as a comparison between algorithms.`,
    });
  } else if (req.replications > BANDIT_LIMITS.maxReplications) {
    issues.push({ code: 'limit', field: 'replications', message: `The replication count exceeds the supported maximum of ${BANDIT_LIMITS.maxReplications}.` });
  }
  if (!Array.isArray(req.algorithms) || req.algorithms.length === 0) {
    issues.push({ code: 'empty', field: 'algorithms', message: 'At least one algorithm must be named.' });
  }
  if (typeof req.seed !== 'string' || !req.seed.length) {
    issues.push({ code: 'required', field: 'seed', message: 'A seed is required so the experiment can be reproduced.' });
  }
  if (req.discount !== undefined && (!Number.isFinite(req.discount) || req.discount <= 0 || req.discount > 1)) {
    issues.push({ code: 'range', field: 'discount', message: 'The per-step discount factor must lie in (0, 1].' });
  }
  return issues;
}

function defaultCheckpoints(horizon: number): number[] {
  const out: number[] = [];
  let t = 10;
  while (t < horizon) {
    out.push(Math.floor(t));
    t *= Math.SQRT2;
  }
  out.push(horizon);
  return out.filter((x, i, arr) => x >= 1 && (i === 0 || x > arr[i - 1]));
}

/** Ordinary least squares slope of y on x. */
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += Math.pow(xs[i] - mx, 2);
  }
  return sxx === 0 ? NaN : sxy / sxx;
}

/**
 * Run a bandit study as a generator, yielding the fraction of replications
 * completed between chunks. The yield is what makes cancellation possible, so
 * it must be kept if this loop is ever restructured.
 */
export function* banditSteps(req: BanditRequest): Generator<number, BanditExperimentResult, void> {
  const issues = validateBanditRequest(req);
  if (issues.length) throw new EngineError(issues);
  const { spec, horizon, replications } = req;
  const K = spec.means.length;
  const best = Math.max(...spec.means);
  const bestArm = spec.means.indexOf(best);
  const checkpoints = (req.checkpoints ?? defaultCheckpoints(horizon)).slice().sort((a, b) => a - b);
  for (const c of checkpoints) {
    if (!Number.isInteger(c) || c < 1 || c > horizon) {
      throw new EngineError(`Checkpoint ${c} is not a whole number in 1..${horizon}.`, 'range');
    }
  }
  const nAlg = req.algorithms.length;
  // regret[alg][checkpoint][replication]
  const regret: Float64Array[][] = req.algorithms.map(() => checkpoints.map(() => new Float64Array(replications)));
  const pulls: Float64Array[][] = req.algorithms.map(() => Array.from({ length: K }, () => new Float64Array(replications)));
  const discounted: Float64Array[] = req.algorithms.map(() => new Float64Array(replications));
  const simple: Float64Array[] = req.algorithms.map(() => new Float64Array(replications));
  const sd = spec.sd ?? 1;

  let rep = 0;
  while (rep < replications) {
    const chunkEnd = Math.min(replications, rep + BANDIT_LIMITS.chunkReplications);
    for (; rep < chunkEnd; rep++) {
      for (let g = 0; g < nAlg; g++) {
        // One RNG stream per (algorithm, replication) so that adding an
        // algorithm does not change another's draws: comparisons stay paired.
        const rng = new Random(new Xoshiro128(`${req.seed}|${req.algorithms[g].id}|${req.algorithms[g].label ?? ''}|${rep}`));
        const state: ArmState = { pulls: new Array<number>(K).fill(0), sums: new Array<number>(K).fill(0), sumSquares: new Array<number>(K).fill(0) };
        const agent = makeAgent(req.algorithms[g], spec, horizon, rng, state);
        let cumRegret = 0;
        let cumDiscounted = 0;
        let discountPower = 1;
        let nextCheckpoint = 0;
        for (let t = 1; t <= horizon; t++) {
          const arm = agent.select(t);
          if (!Number.isInteger(arm) || arm < 0 || arm >= K) {
            throw new EngineError(`Algorithm "${req.algorithms[g].id}" selected arm ${arm}, which does not exist.`, 'internal');
          }
          const reward = spec.family === 'bernoulli' ? (rng.uniform() < spec.means[arm] ? 1 : 0) : spec.means[arm] + sd * rng.normal();
          state.pulls[arm]++;
          state.sums[arm] += reward;
          state.sumSquares[arm] += reward * reward;
          agent.update(arm, reward, t);
          // Pseudo-regret: the gap in EXPECTED reward, which is the quantity the
          // theory bounds. Realised regret would add reward noise and nothing else.
          cumRegret += best - spec.means[arm];
          if (req.discount !== undefined) {
            cumDiscounted += discountPower * reward;
            discountPower *= req.discount;
          }
          while (nextCheckpoint < checkpoints.length && t === checkpoints[nextCheckpoint]) {
            regret[g][nextCheckpoint][rep] = cumRegret;
            nextCheckpoint++;
          }
        }
        for (let a = 0; a < K; a++) pulls[g][a][rep] = state.pulls[a];
        discounted[g][rep] = cumDiscounted;
        let empiricalBest = 0;
        for (let a = 1; a < K; a++) {
          const ma = state.pulls[a] > 0 ? state.sums[a] / state.pulls[a] : -Infinity;
          const mb = state.pulls[empiricalBest] > 0 ? state.sums[empiricalBest] / state.pulls[empiricalBest] : -Infinity;
          if (ma > mb) empiricalBest = a;
        }
        simple[g][rep] = best - spec.means[empiricalBest];
      }
    }
    yield rep / replications;
  }

  const summarise = (xs: Float64Array): { mean: number; standardError: number } => {
    const m = mean(xs);
    const v = variance(xs, 1);
    return { mean: m, standardError: Math.sqrt(v / xs.length) };
  };

  const algorithms: AlgorithmOutcome[] = req.algorithms.map((cfg, g) => {
    const curve: RegretPoint[] = checkpoints.map((t, i) => {
      const col = regret[g][i];
      const s = summarise(col);
      const sorted = sortedCopy(col);
      return {
        t,
        meanRegret: s.mean,
        standardError: s.standardError,
        p05: quantileSorted(sorted, 0.05),
        p50: quantileSorted(sorted, 0.5),
        p95: quantileSorted(sorted, 0.95),
      };
    });
    const armPulls = Array.from({ length: K }, (_, a) => {
      const s = summarise(pulls[g][a]);
      return { arm: a, meanPulls: s.mean, standardError: s.standardError };
    });
    // Fit the log–log slope over the second half of the checkpoints, where the
    // asymptotic rate shows: the early points are dominated by the forced
    // initial exploration of every arm.
    const half = Math.max(0, Math.floor(curve.length / 2) - 1);
    const fitPoints = curve.slice(half).filter((p) => p.meanRegret > 0);
    const logLogSlope = slope(fitPoints.map((p) => Math.log(p.t)), fitPoints.map((p) => Math.log(p.meanRegret)));
    return {
      id: cfg.id,
      label: cfg.label ?? cfg.id,
      regretCurve: curve,
      finalRegret: curve[curve.length - 1],
      armPulls,
      regretDecomposition: armPulls.map(({ arm, meanPulls }) => ({ arm, gap: best - spec.means[arm], contribution: (best - spec.means[arm]) * meanPulls })),
      discountedReward: req.discount === undefined ? undefined : summarise(discounted[g]),
      simpleRegret: summarise(simple[g]),
      regretLogLogSlope: logLogSlope,
    };
  });

  return {
    horizon,
    replications,
    algorithms,
    laiRobbins: laiRobbinsBound(spec, horizon),
    provenance: {
      exactness: 'empirical',
      method: `${replications} independent replications per algorithm over a horizon of ${horizon}, arm ${bestArm} optimal`,
      assumedInputs: ['The true arm means are an assumption of the study; the algorithms do not see them, but every regret figure is computed against them.'],
      limitations: [
        'REGRET IS RANDOM. Every figure here is a mean over replications with its Monte Carlo standard error, and the 5th/50th/95th percentiles describe the spread across runs — which is wide. Two algorithms whose mean regrets differ by less than a couple of standard errors have not been distinguished by this study.',
        'The comparison is on ONE problem instance. Bandit algorithms trade performance across instances: a conclusion here does not transfer to different gaps or a different number of arms.',
        'Pseudo-regret (the gap in expected reward) is reported, not realised regret. Realised regret differs by reward noise, which is zero-mean and only adds variance.',
        'The log–log slope of the regret curve is a crude diagnostic of the rate, fitted over the later checkpoints only; a slope clearly below 1 indicates sub-linear regret but does not establish a logarithmic rate.',
      ],
    },
  };
}

/** Run a bandit study to completion. Prefer banditSteps() for cancellation. */
export function runBanditExperiment(req: BanditRequest): BanditExperimentResult {
  const steps = banditSteps(req);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/* ------------------------------------------------------------ Gittins index */

/**
 * The Gittins index for a Beta–Bernoulli arm with s successes and f failures
 * under geometric discounting, by calibration: the index is the retirement
 * reward λ at which continuing to pull the arm and retiring for λ per period
 * are exactly indifferent. For the DISCOUNTED Bayesian bandit the index policy
 * (pull the arm of highest index) is EXACTLY OPTIMAL — Gittins' theorem — so no
 * other algorithm can beat it on that objective, which makes it the right thing
 * to benchmark Thompson sampling and UCB against when the objective is
 * discounted reward rather than regret.
 *
 * The one-armed problem is solved by backward induction over the truncated
 * belief lattice; the truncation error is of order discount^maxPulls, which is
 * reported. The index is then found by Brent's method on the indifference
 * equation.
 */
export function gittinsIndex(successes: number, failures: number, discount: number, opts: { maxPulls?: number } = {}): { index: number; truncationError: number; provenance: Provenance } {
  if (!Number.isInteger(successes) || successes < 0 || !Number.isInteger(failures) || failures < 0) {
    throw new EngineError('The success and failure counts must be whole numbers of at least 0.', 'range');
  }
  if (!Number.isFinite(discount) || discount <= 0 || discount >= 1) {
    throw new EngineError(`The Gittins index is defined for a discount factor in (0, 1); ${discount} was supplied. At discount 1 the index problem has no finite value.`, 'range');
  }
  const maxPulls = opts.maxPulls ?? Math.max(60, Math.ceil(Math.log(1e-10) / Math.log(discount)));
  const start = successes + failures;
  if (maxPulls <= start + 1) throw new EngineError(`maxPulls must exceed the ${start} pulls already made.`, 'range');
  const size = maxPulls + 2;

  /** Continuation value of the one-armed bandit at (successes, failures). */
  const continuationAt = (lambda: number): number => {
    const retire = lambda / (1 - discount);
    // V indexed by [s] with f = level − s at each level of total pulls.
    let level = new Float64Array(size);
    const total = maxPulls;
    for (let s = 0; s <= total; s++) {
      const f = total - s;
      const a = successes + s;
      const b = failures + f;
      const p = (a + 1) / (a + b + 2);
      // At the truncation boundary, approximate by acting on the posterior mean
      // forever, which is the best possible continuation and therefore an upper
      // bound; the error it introduces is O(discount^maxPulls).
      level[s] = Math.max(p / (1 - discount), retire);
    }
    for (let t = total - 1; t >= 0; t--) {
      const next = new Float64Array(size);
      for (let s = 0; s <= t; s++) {
        const f = t - s;
        const a = successes + s;
        const b = failures + f;
        const p = (a + 1) / (a + b + 2);
        const cont = p * (1 + discount * level[s + 1]) + (1 - p) * (0 + discount * level[s]);
        next[s] = t === 0 ? cont : Math.max(cont, retire);
      }
      level = next;
    }
    return level[0];
  };

  const f = (lambda: number): number => continuationAt(lambda) - lambda / (1 - discount);
  const flo = f(0);
  const fhi = f(1);
  if (!(flo >= 0) || !(fhi <= 0)) {
    throw new EngineError(`The Gittins indifference equation is not bracketed on [0, 1] (residuals ${flo.toExponential(3)}, ${fhi.toExponential(3)}).`, 'numerical');
  }
  const index = flo === 0 ? 0 : fhi === 0 ? 1 : brentRoot(f, 0, 1, { tol: 1e-10 });
  return {
    index,
    truncationError: Math.pow(discount, maxPulls) / (1 - discount),
    provenance: {
      exactness: 'numerical',
      method: `Gittins index by calibration (indifference to retirement), backward induction truncated at ${maxPulls} pulls`,
      assumedInputs: [`A Beta(${successes + 1}, ${failures + 1}) posterior on the arm's success probability, i.e. a uniform prior updated by the observed counts.`],
      limitations: [
        `The belief lattice is truncated at ${maxPulls} pulls, bounding the value error by discount^${maxPulls}/(1−discount) ≈ ${(Math.pow(discount, maxPulls) / (1 - discount)).toExponential(2)}.`,
        'The index policy is exactly optimal for the DISCOUNTED Bayesian bandit with independent arms that do not change while unpulled. It is not optimal for the finite-horizon undiscounted problem, and it is not a regret-minimising algorithm.',
        'The index depends on the prior. A different prior gives different indices and a different policy.',
      ],
    },
  };
}

/**
 * A table of Gittins indices for all (successes, failures) with
 * successes + failures ≤ maxPulls, computed on a λ grid: for each candidate λ
 * one backward induction decides, for EVERY state at once, whether retiring
 * beats continuing, and the index of a state is the λ at which that flips.
 * The grid resolution is reported as the accuracy.
 */
export function gittinsIndexTable(
  discount: number,
  maxPulls: number,
  opts: { lambdaGrid?: number; truncation?: number } = {},
): number[][] {
  if (!Number.isFinite(discount) || discount <= 0 || discount >= 1) {
    throw new EngineError(`The Gittins index table needs a discount factor in (0, 1); ${discount} was supplied.`, 'range');
  }
  if (!Number.isInteger(maxPulls) || maxPulls < 1 || maxPulls > 400) {
    throw new EngineError(`maxPulls must be a whole number in 1..400; ${maxPulls} was supplied.`, 'range');
  }
  const grid = opts.lambdaGrid ?? 600;
  if (!Number.isInteger(grid) || grid < 20) throw new EngineError('lambdaGrid must be a whole number of at least 20.', 'range');
  const horizon = opts.truncation ?? Math.max(maxPulls + 60, Math.ceil(Math.log(1e-8) / Math.log(discount)));
  const table: number[][] = Array.from({ length: maxPulls + 1 }, (_, s) => new Array<number>(maxPulls + 1 - s).fill(0));

  // The stopping region grows with λ, so sweeping λ upwards and recording the
  // first λ at which a state prefers retirement gives that state's index.
  for (let g = 1; g <= grid; g++) {
    const lambda = g / grid;
    const retire = lambda / (1 - discount);
    // Value over the lattice at total pulls = horizon, then induct backwards.
    let level = new Float64Array(horizon + 2);
    for (let s = 0; s <= horizon; s++) {
      const p = (s + 1) / (horizon + 2);
      level[s] = Math.max(p / (1 - discount), retire);
    }
    for (let t = horizon - 1; t >= 0; t--) {
      const next = new Float64Array(horizon + 2);
      for (let s = 0; s <= t; s++) {
        const f = t - s;
        const p = (s + 1) / (t + 2);
        const cont = p * (1 + discount * level[s + 1]) + (1 - p) * discount * level[s];
        next[s] = Math.max(cont, retire);
        if (t <= maxPulls && f <= maxPulls - s && table[s][f] === 0 && cont <= retire) {
          table[s][f] = lambda;
        }
      }
      level = next;
    }
  }
  for (let s = 0; s <= maxPulls; s++) {
    for (let f = 0; f <= maxPulls - s; f++) {
      // A state that never prefers retirement up to λ = 1 has index 1.
      if (table[s][f] === 0) table[s][f] = 1;
    }
  }
  return table;
}

/* ------------------------------------------- best-arm identification */

export interface BestArmResult {
  delta: number;
  /** Empirical probability the returned arm was the best one. */
  correctProbability: number;
  correctProbabilityStandardError: number;
  /** Mean number of pulls used before stopping. */
  meanSampleSize: number;
  sampleSizeStandardError: number;
  /** Replications that hit the pull budget without isolating an arm. */
  budgetExhausted: number;
  provenance: Provenance;
}

/**
 * Fixed-confidence best-arm identification by successive elimination with
 * Hoeffding confidence intervals: pull every surviving arm once per round and
 * drop an arm when its upper confidence bound falls below the best lower bound.
 * The guarantee is that the surviving arm is the best with probability at least
 * 1 − δ; the empirical rate is measured here and reported with its Monte Carlo
 * error, because a guarantee and a realised rate are different claims.
 */
export function bestArmIdentification(
  spec: BanditSpec,
  delta: number,
  opts: { budget?: number; replications?: number; seed?: string } = {},
): BestArmResult {
  const issues = validateBanditSpec(spec);
  if (issues.length) throw new EngineError(issues);
  if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) throw new EngineError(`The failure probability δ must lie in (0, 1); ${delta} was supplied.`, 'range');
  const K = spec.means.length;
  if (K < 2) throw new EngineError('Best-arm identification needs at least two arms.', 'range');
  const budget = opts.budget ?? 200000;
  const replications = opts.replications ?? 200;
  if (!Number.isInteger(budget) || budget < K) throw new EngineError(`The pull budget must be a whole number of at least ${K}.`, 'range');
  if (!Number.isInteger(replications) || replications < 2) throw new EngineError('At least 2 replications are required to report a success rate.', 'range');
  const seed = opts.seed ?? 'best-arm';
  const best = Math.max(...spec.means);
  const tiedBest = spec.means.filter((m) => m === best).length;
  if (tiedBest > 1) {
    throw new EngineError(`${tiedBest} arms share the best mean ${best}, so "the best arm" is not identifiable. No amount of sampling resolves a tie.`, 'degenerate');
  }
  const sd = spec.sd ?? 1;
  const range = spec.family === 'bernoulli' ? 1 : 4 * sd;

  const correct = new Float64Array(replications);
  const used = new Float64Array(replications);
  let exhausted = 0;
  for (let rep = 0; rep < replications; rep++) {
    const rng = new Random(new Xoshiro128(`${seed}|${rep}`));
    const pulls = new Array<number>(K).fill(0);
    const sums = new Array<number>(K).fill(0);
    let active = Array.from({ length: K }, (_, a) => a);
    let total = 0;
    while (active.length > 1 && total + active.length <= budget) {
      for (const a of active) {
        const reward = spec.family === 'bernoulli' ? (rng.uniform() < spec.means[a] ? 1 : 0) : spec.means[a] + sd * rng.normal();
        pulls[a]++;
        sums[a] += reward;
        total++;
      }
      const radius = (n: number): number => range * Math.sqrt(Math.log((4 * K * n * n) / delta) / (2 * n));
      const mean_ = (a: number): number => sums[a] / pulls[a];
      let bestLower = -Infinity;
      for (const a of active) bestLower = Math.max(bestLower, mean_(a) - radius(pulls[a]));
      active = active.filter((a) => mean_(a) + radius(pulls[a]) >= bestLower);
      if (active.length === 0) {
        throw new EngineError('Successive elimination removed every arm, which indicates an internal error in the confidence bounds.', 'internal');
      }
    }
    if (active.length > 1) exhausted++;
    let winner = active[0];
    for (const a of active) if (sums[a] / pulls[a] > sums[winner] / pulls[winner]) winner = a;
    correct[rep] = spec.means[winner] === best ? 1 : 0;
    used[rep] = total;
  }
  const p = mean(correct);
  return {
    delta,
    correctProbability: p,
    correctProbabilityStandardError: Math.sqrt((p * (1 - p)) / replications),
    meanSampleSize: mean(used),
    sampleSizeStandardError: Math.sqrt(variance(used, 1) / replications),
    budgetExhausted: exhausted,
    provenance: {
      exactness: 'empirical',
      method: `Successive elimination with Hoeffding bounds, ${replications} replications`,
      assumedInputs: ['The rewards are bounded (Bernoulli) or sub-Gaussian with the stated standard deviation; the confidence radius depends on that assumption.'],
      limitations: [
        `The guarantee is a success probability of at least 1 − δ = ${(1 - delta).toFixed(4)}; the measured rate is ${p.toFixed(4)} ± ${(Math.sqrt((p * (1 - p)) / replications) * 1.96).toFixed(4)} (95%). Hoeffding bounds are loose, so the realised rate is normally far above the guarantee and the sample size far above what is strictly necessary.`,
        'Pure exploration optimises SIMPLE regret: it deliberately spends pulls on arms it already believes are bad, so its cumulative regret is much worse than a regret-minimising algorithm\'s. The two objectives are not compatible.',
        exhausted > 0
          ? `${exhausted} of ${replications} replications hit the pull budget without isolating a single arm; those are counted as correct only if the surviving arm with the best empirical mean happens to be the best, and the exhaustion count is reported so the figure can be discounted.`
          : 'Every replication isolated a single arm within the budget.',
      ],
    },
  };
}

/* --------------------------------------------------- contextual: LinUCB */

export interface LinUCBResult {
  /** Mean cumulative regret against the best action per context. */
  meanRegret: number;
  standardError: number;
  /** Final estimated coefficient vector per arm, averaged over replications. */
  coefficients: number[][];
  provenance: Provenance;
}

/**
 * LinUCB (disjoint model) for contextual bandits: each arm a carries its own
 * coefficient vector θ_a, the expected reward of arm a in context x is xᵀθ_a,
 * and the arm chosen maximises xᵀθ̂_a + α·√(xᵀA_a⁻¹x).
 *
 * Contexts are drawn by the supplied sampler. Regret is measured against the
 * best arm FOR EACH CONTEXT, which is the right benchmark here: the best fixed
 * arm is a much weaker one and would flatter the algorithm.
 */
export function linUCB(
  thetas: number[][],
  contextSampler: (rng: Random) => number[],
  opts: { horizon?: number; replications?: number; alpha?: number; noiseSd?: number; seed?: string } = {},
): LinUCBResult {
  if (!Array.isArray(thetas) || thetas.length < 2) throw new EngineError('LinUCB needs at least two arms, each with a coefficient vector.', 'range');
  const d = thetas[0].length;
  for (const th of thetas) {
    if (th.length !== d) throw new EngineError('Every arm\'s coefficient vector must have the same dimension.', 'shape');
    for (const v of th) if (!Number.isFinite(v)) throw new EngineError('Coefficient vectors must contain finite numbers.', 'finite');
  }
  const horizon = opts.horizon ?? 2000;
  const replications = opts.replications ?? 20;
  const alpha = opts.alpha ?? 1;
  const noiseSd = opts.noiseSd ?? 0.1;
  if (!Number.isInteger(horizon) || horizon < 1) throw new EngineError('The horizon must be a whole number of at least 1.', 'range');
  if (!Number.isInteger(replications) || replications < 2) throw new EngineError('At least 2 replications are required; a single contextual-bandit run is not evidence.', 'range');
  if (!Number.isFinite(alpha) || alpha < 0) throw new EngineError('The LinUCB exploration parameter α must be at least 0.', 'range');
  if (!Number.isFinite(noiseSd) || noiseSd < 0) throw new EngineError('The noise standard deviation must be at least 0.', 'range');
  const K = thetas.length;
  const seed = opts.seed ?? 'linucb';
  const regrets = new Float64Array(replications);
  const coefSum: number[][] = Array.from({ length: K }, () => new Array<number>(d).fill(0));

  for (let rep = 0; rep < replications; rep++) {
    const rng = new Random(new Xoshiro128(`${seed}|${rep}`));
    // A_a = I + Σ x xᵀ, b_a = Σ r x.
    const A: number[][][] = Array.from({ length: K }, () => Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : 0))));
    const b: number[][] = Array.from({ length: K }, () => new Array<number>(d).fill(0));
    let cumRegret = 0;
    for (let t = 1; t <= horizon; t++) {
      const x = contextSampler(rng);
      if (x.length !== d) throw new EngineError(`The context sampler returned ${x.length} features; ${d} were expected.`, 'shape');
      let chosen = 0;
      let bestScore = -Infinity;
      const thetaHats: number[][] = [];
      for (let a = 0; a < K; a++) {
        const theta = solve(A[a], b[a]);
        if (!theta) throw new EngineError(`The LinUCB design matrix for arm ${a} became singular; no action can be chosen.`, 'singular');
        thetaHats.push(theta);
        const Ainvx = solve(A[a], x);
        if (!Ainvx) throw new EngineError(`The LinUCB design matrix for arm ${a} became singular; no confidence width can be computed.`, 'singular');
        let widthSq = 0;
        let point = 0;
        for (let i = 0; i < d; i++) {
          widthSq += x[i] * Ainvx[i];
          point += x[i] * theta[i];
        }
        const score = point + alpha * Math.sqrt(Math.max(0, widthSq));
        if (score > bestScore) {
          bestScore = score;
          chosen = a;
        }
      }
      let bestTrue = -Infinity;
      let chosenTrue = 0;
      for (let a = 0; a < K; a++) {
        let v = 0;
        for (let i = 0; i < d; i++) v += x[i] * thetas[a][i];
        if (v > bestTrue) bestTrue = v;
        if (a === chosen) chosenTrue = v;
      }
      cumRegret += bestTrue - chosenTrue;
      const reward = chosenTrue + noiseSd * rng.normal();
      for (let i = 0; i < d; i++) {
        b[chosen][i] += reward * x[i];
        for (let j = 0; j < d; j++) A[chosen][i][j] += x[i] * x[j];
      }
      if (t === horizon) {
        for (let a = 0; a < K; a++) for (let i = 0; i < d; i++) coefSum[a][i] += thetaHats[a][i];
      }
    }
    regrets[rep] = cumRegret;
  }
  return {
    meanRegret: mean(regrets),
    standardError: Math.sqrt(variance(regrets, 1) / replications),
    coefficients: coefSum.map((row) => row.map((v) => v / replications)),
    provenance: {
      exactness: 'empirical',
      method: `LinUCB (disjoint linear model, α = ${alpha}), ${replications} replications over a horizon of ${horizon}`,
      assumedInputs: [
        'The expected reward is assumed LINEAR in the context features. That assumption is doing most of the work: when it fails, LinUCB converges confidently to the wrong arm and the confidence widths shrink anyway.',
        'The noise is assumed zero-mean and independent across rounds.',
      ],
      limitations: [
        'Regret is measured against the best arm for each context, which is the correct and demanding benchmark.',
        'The confidence widths come from the ridge-regularised design matrix with regularisation 1; a different regularisation changes the exploration behaviour.',
        'Reported as a mean over replications with Monte Carlo error. A single contextual-bandit run is not evidence of anything.',
      ],
    },
  };
}
