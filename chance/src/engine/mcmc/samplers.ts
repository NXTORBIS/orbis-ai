/**
 * MCMC transition kernels.
 *
 * Every kernel implements the same `Sampler` interface: it owns a position,
 * the log density at that position, and a `step` that advances the chain in
 * place. Adaptation is explicit: a kernel may adapt only while `step` is
 * called with `adapting = true` (the warm-up phase). `freeze()` ends
 * adaptation permanently.
 *
 * Why adaptation is frozen for the sampling phase: a kernel whose transition
 * depends on the chain's own history is not a Markov chain with the posterior
 * as its invariant distribution, so draws taken while adapting are not draws
 * from the target. Haario's adaptive Metropolis has an ergodicity proof under
 * diminishing adaptation, but the honest and simple route — and the one used
 * here, as in Stan — is to adapt during warm-up, discard those iterations,
 * then hold the tuning fixed.
 */
import { EngineError } from '../core/result';
import type { Random } from '../random/rng';
import { choleskyWithCheck, type Matrix } from '../stats/linalg';
import type {
  AdaptiveMetropolisConfig,
  FullConditional,
  GibbsConfig,
  GradLogDensity,
  HmcConfig,
  LogDensity,
  MetropolisConfig,
  SamplerConfig,
  SamplerStats,
  SliceConfig,
  TargetSpec,
} from './types';

export interface Sampler {
  readonly label: string;
  readonly adaptsDuringWarmup: boolean;
  /** Notes appended to the result's limitations (e.g. numerical gradient). */
  readonly limitations: string[];
  readonly position: number[];
  readonly logDensityValue: number;
  readonly stats: SamplerStats;
  step(rng: Random, adapting: boolean): void;
  /** Ends adaptation; called once between warm-up and sampling. */
  freeze(): void;
  tuning(): Record<string, number>;
}

function emptyStats(): SamplerStats {
  return { proposals: 0, accepted: 0, divergences: 0, logDensityEvaluations: 0, gradientEvaluations: 0 };
}

/** Counts evaluations and refuses to let a NaN density pass silently. */
class DensityCounter {
  constructor(
    private readonly fn: LogDensity,
    readonly stats: SamplerStats,
  ) {}

  at(x: readonly number[]): number {
    this.stats.logDensityEvaluations++;
    const v = this.fn(x);
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new EngineError(
        [
          {
            code: 'nonfinite',
            message: `The target log-density returned ${String(v)} at [${x.map((c) => c.toPrecision(6)).join(', ')}]. A log-density must return a number, and -Infinity (not NaN) outside its support.`,
          },
        ],
        'nonfinite',
      );
    }
    return v;
  }
}

/** Default acceptance target: 0.44 in 1-D, 0.234 for d >= 2 (Roberts & Rosenthal 2001). */
export function defaultTargetAcceptance(dimension: number): number {
  return dimension === 1 ? 0.44 : 0.234;
}

function diagonalCholesky(sd: readonly number[]): Matrix {
  const d = sd.length;
  const L: Matrix = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) L[i][i] = sd[i];
  return L;
}

/** x + L·z with z standard normal: a draw from N(x, L·Lᵀ). */
function proposeFrom(position: readonly number[], L: Matrix, scale: number, rng: Random, out: number[]): void {
  const d = position.length;
  const z = new Array<number>(d);
  for (let i = 0; i < d; i++) z[i] = rng.normal();
  for (let i = 0; i < d; i++) {
    let s = 0;
    const row = L[i];
    for (let j = 0; j <= i; j++) s += row[j] * z[j];
    out[i] = position[i] + scale * s;
  }
}

/**
 * Random-walk Metropolis–Hastings. The proposal is symmetric, so the
 * Hastings ratio cancels and the acceptance probability is
 * min(1, exp(logp(proposal) - logp(current))).
 */
export class MetropolisSampler implements Sampler {
  readonly label = 'Random-walk Metropolis–Hastings';
  readonly adaptsDuringWarmup = false;
  readonly limitations: string[] = [];
  readonly position: number[];
  logDensityValue: number;
  readonly stats: SamplerStats = emptyStats();
  private readonly density: DensityCounter;
  private readonly L: Matrix;
  private readonly scale: number;
  private readonly proposal: number[];

  constructor(target: TargetSpec, config: MetropolisConfig, start: readonly number[]) {
    this.density = new DensityCounter(target.logDensity, this.stats);
    this.position = [...start];
    this.proposal = [...start];
    this.scale = config.proposalScale ?? 1;
    const d = target.dimension;
    if (config.proposalCovariance) {
      const chol = choleskyWithCheck(config.proposalCovariance.map((r) => [...r]));
      if (!chol.ok) {
        throw new EngineError(
          'The proposal covariance is not positive definite, so it cannot be factorised. Supply a valid covariance matrix or per-coordinate standard deviations.',
          'not-positive-definite',
        );
      }
      this.L = chol.L;
    } else if (config.proposalSd) {
      if (config.proposalSd.length !== d) {
        throw new EngineError(
          `proposalSd has ${config.proposalSd.length} entries but the target has ${d} parameters.`,
          'shape',
        );
      }
      for (const s of config.proposalSd) {
        if (!(s > 0) || !Number.isFinite(s)) {
          throw new EngineError('Every proposal standard deviation must be a finite positive number.', 'range');
        }
      }
      this.L = diagonalCholesky(config.proposalSd);
    } else {
      this.L = diagonalCholesky(new Array<number>(d).fill(2.38 / Math.sqrt(d)));
    }
    this.logDensityValue = this.density.at(this.position);
  }

  step(rng: Random): void {
    proposeFrom(this.position, this.L, this.scale, rng, this.proposal);
    this.stats.proposals++;
    const lp = this.density.at(this.proposal);
    if (lp === -Infinity) return;
    if (Math.log(rng.uniformOpen()) < lp - this.logDensityValue) {
      for (let i = 0; i < this.position.length; i++) this.position[i] = this.proposal[i];
      this.logDensityValue = lp;
      this.stats.accepted++;
    }
  }

  freeze(): void {
    /* nothing to freeze: this kernel never adapts. */
  }

  tuning(): Record<string, number> {
    return { proposalScale: this.scale };
  }
}

/**
 * Adaptive Metropolis (Haario, Saksman & Tamminen 2001) with Robbins–Monro
 * scale control. During warm-up the empirical covariance of the chain is
 * accumulated and the proposal becomes scale² · (2.38²/d) · (Cov + εI), while
 * log(scale) is nudged by (accepted − target) with a 1/√t gain so the
 * acceptance rate is driven to the target. At the end of warm-up everything
 * is frozen: the covariance, the scale and the Cholesky factor.
 */
export class AdaptiveMetropolisSampler implements Sampler {
  readonly label = 'Adaptive Metropolis (Haario-style, adaptation frozen after warm-up)';
  readonly adaptsDuringWarmup = true;
  readonly limitations = [
    'Proposal adaptation runs during warm-up only and is frozen for the sampling phase; warm-up draws are discarded because a chain that is still adapting does not have the posterior as its invariant distribution.',
  ];
  readonly position: number[];
  logDensityValue: number;
  readonly stats: SamplerStats = emptyStats();
  private readonly density: DensityCounter;
  private readonly d: number;
  private readonly targetAcceptance: number;
  private logScale: number;
  private L: Matrix;
  private readonly mean: number[];
  private readonly cov: Matrix;
  private adaptCount = 0;
  private frozen = false;
  private readonly proposal: number[];
  private warmupProposals = 0;
  private warmupAccepted = 0;

  constructor(target: TargetSpec, config: AdaptiveMetropolisConfig, start: readonly number[]) {
    this.density = new DensityCounter(target.logDensity, this.stats);
    this.d = target.dimension;
    this.position = [...start];
    this.proposal = [...start];
    this.targetAcceptance = config.targetAcceptance ?? defaultTargetAcceptance(this.d);
    if (!(this.targetAcceptance > 0 && this.targetAcceptance < 1)) {
      throw new EngineError('The target acceptance rate must lie strictly between 0 and 1.', 'range');
    }
    const initial = config.initialScale ?? 1;
    if (!(initial > 0) || !Number.isFinite(initial)) {
      throw new EngineError('The initial proposal scale must be a finite positive number.', 'range');
    }
    this.logScale = Math.log(initial);
    this.mean = [...start];
    this.cov = Array.from({ length: this.d }, (_, i) =>
      Array.from({ length: this.d }, (_, j) => (i === j ? 1 : 0)),
    );
    this.L = diagonalCholesky(new Array<number>(this.d).fill(1));
    this.logDensityValue = this.density.at(this.position);
  }

  private scale(): number {
    return Math.exp(this.logScale) * (2.38 / Math.sqrt(this.d));
  }

  step(rng: Random, adapting: boolean): void {
    const adapt = adapting && !this.frozen;
    proposeFrom(this.position, this.L, this.scale(), rng, this.proposal);
    this.stats.proposals++;
    if (adapt) this.warmupProposals++;
    const lp = this.density.at(this.proposal);
    let accepted = false;
    if (lp !== -Infinity && Math.log(rng.uniformOpen()) < lp - this.logDensityValue) {
      for (let i = 0; i < this.d; i++) this.position[i] = this.proposal[i];
      this.logDensityValue = lp;
      this.stats.accepted++;
      accepted = true;
      if (adapt) this.warmupAccepted++;
    }
    if (!adapt) return;

    this.adaptCount++;
    const gain = 1 / Math.sqrt(this.adaptCount + 1);
    this.logScale += gain * ((accepted ? 1 : 0) - this.targetAcceptance);
    this.logScale = Math.max(-12, Math.min(6, this.logScale));

    // Recursive mean and covariance of the visited states.
    const n = this.adaptCount;
    const delta = new Array<number>(this.d);
    for (let i = 0; i < this.d; i++) delta[i] = this.position[i] - this.mean[i];
    for (let i = 0; i < this.d; i++) this.mean[i] += delta[i] / (n + 1);
    for (let i = 0; i < this.d; i++) {
      for (let j = 0; j < this.d; j++) {
        this.cov[i][j] = ((n - 1 > 0 ? n - 1 : 0) * this.cov[i][j] + delta[i] * delta[j]) / n;
      }
    }
    // Refactor periodically: the Cholesky is O(d³) and the covariance moves slowly.
    if (n >= 2 * this.d + 20 && n % 25 === 0) this.refactor();
  }

  private refactor(): void {
    const eps = 1e-8;
    const shrunk: Matrix = this.cov.map((row, i) => row.map((v, j) => (i === j ? v + eps : v)));
    const chol = choleskyWithCheck(shrunk);
    if (chol.ok) this.L = chol.L;
    // If the empirical covariance is not yet positive definite the previous
    // factor is kept; no NaN is allowed to enter the proposal.
  }

  freeze(): void {
    if (!this.frozen) this.refactor();
    this.frozen = true;
  }

  warmupAcceptance(): number {
    return this.warmupProposals ? this.warmupAccepted / this.warmupProposals : 0;
  }

  tuning(): Record<string, number> {
    const scale = this.scale();
    const sds: Record<string, number> = { proposalScale: scale, targetAcceptance: this.targetAcceptance };
    for (let i = 0; i < this.d; i++) sds[`proposalSd[${i}]`] = scale * Math.sqrt(Math.max(0, this.cov[i][i] + 1e-8));
    return sds;
  }
}

/** Central-difference gradient. Clearly labelled: slower and less accurate. */
export function numericalGradient(logDensity: LogDensity, h: number): GradLogDensity {
  return (x: readonly number[]): number[] => {
    const d = x.length;
    const g = new Array<number>(d).fill(0);
    const probe = [...x];
    for (let i = 0; i < d; i++) {
      const xi = x[i];
      const step = h * Math.max(1, Math.abs(xi));
      probe[i] = xi + step;
      const up = logDensity(probe);
      probe[i] = xi - step;
      const down = logDensity(probe);
      probe[i] = xi;
      g[i] = Number.isFinite(up) && Number.isFinite(down) ? (up - down) / (2 * step) : NaN;
    }
    return g;
  };
}

/**
 * Hamiltonian Monte Carlo with leapfrog integration and dual-averaging
 * step-size adaptation (Hoffman & Gelman 2014, equations 5–6), run during
 * warm-up only and then frozen at the averaged step size.
 *
 * A divergence is a trajectory whose Hamiltonian error exceeds 1000 nats or
 * becomes non-finite: the integrator has left the region where it is stable,
 * and the draws around it are not trustworthy. Divergences are counted and
 * reported, never hidden.
 */
export class HmcSampler implements Sampler {
  readonly label: string;
  readonly adaptsDuringWarmup = true;
  readonly limitations: string[] = [
    'Step-size adaptation (dual averaging) runs during warm-up only and is frozen for the sampling phase.',
    'The leapfrog step size is jittered by +/-20% each iteration to avoid the resonance that a fixed trajectory length causes on near-Gaussian targets. This is a fixed-length HMC, not NUTS: the trajectory length is a setting, and a poor choice costs effective sample size rather than correctness.',
  ];
  readonly position: number[];
  logDensityValue: number;
  readonly stats: SamplerStats = emptyStats();
  private readonly density: DensityCounter;
  private readonly grad: GradLogDensity;
  private readonly d: number;
  private readonly steps: number;
  private readonly targetAcceptance: number;
  private logStepSize: number;
  private logStepSizeBar = 0;
  private hBar = 0;
  private mu: number;
  private adaptCount = 0;
  private frozen = false;
  private gradient: number[];
  private warmupProposals = 0;
  private warmupAccepted = 0;

  constructor(target: TargetSpec, config: HmcConfig, start: readonly number[]) {
    this.density = new DensityCounter(target.logDensity, this.stats);
    this.d = target.dimension;
    this.position = [...start];
    this.steps = config.leapfrogSteps ?? 10;
    if (!Number.isInteger(this.steps) || this.steps < 1) {
      throw new EngineError('The number of leapfrog steps must be a whole number of at least 1.', 'range');
    }
    this.targetAcceptance = config.targetAcceptance ?? 0.8;
    if (!(this.targetAcceptance > 0 && this.targetAcceptance < 1)) {
      throw new EngineError('The HMC target acceptance rate must lie strictly between 0 and 1.', 'range');
    }
    const step = config.stepSize ?? 0.25;
    if (!(step > 0) || !Number.isFinite(step)) {
      throw new EngineError('The HMC step size must be a finite positive number.', 'range');
    }
    this.logStepSize = Math.log(step);
    this.mu = Math.log(10 * step);
    const useNumeric = config.useNumericalGradient === true || !target.gradLogDensity;
    const analytic = target.gradLogDensity;
    if (useNumeric || !analytic) {
      const h = config.finiteDifferenceStep ?? 1e-5;
      const numeric = numericalGradient(target.logDensity, h);
      this.grad = (x) => {
        this.stats.gradientEvaluations++;
        this.stats.logDensityEvaluations += 2 * this.d;
        return numeric(x);
      };
      this.label = 'Hamiltonian Monte Carlo (finite-difference gradient)';
      this.limitations.push(
        `No analytic gradient was supplied, so the gradient is estimated by central differences with step ${h}. This is slower (${2 * this.d} extra log-density evaluations per leapfrog step) and less accurate than an analytic gradient; near the edge of the support it can be badly wrong, which shows up as divergences.`,
      );
    } else {
      this.grad = (x) => {
        this.stats.gradientEvaluations++;
        return analytic(x);
      };
      this.label = 'Hamiltonian Monte Carlo (analytic gradient)';
    }
    this.logDensityValue = this.density.at(this.position);
    this.gradient = this.grad(this.position);
  }

  /**
   * One leapfrog trajectory from the current state with a fresh momentum
   * draw. Returns the end point and the log acceptance ratio
   * log(exp(H0 - H1)) = (logp1 - K1) - (logp0 - K0), or a divergence.
   */
  private trajectory(eps: number, rng: Random): {
    q: number[];
    grad: number[];
    logP: number;
    logAccept: number;
    divergent: boolean;
  } {
    const d = this.d;
    const q = [...this.position];
    const p = new Array<number>(d);
    for (let i = 0; i < d; i++) p[i] = rng.normal();
    let kinetic0 = 0;
    for (let i = 0; i < d; i++) kinetic0 += 0.5 * p[i] * p[i];
    let grad = [...this.gradient];
    let logP = this.logDensityValue;
    let broken = !grad.every((g) => Number.isFinite(g));

    if (!broken) {
      // Half momentum kick, then alternating full position drift and kick,
      // ending on a half kick: the standard leapfrog scheme, which is
      // volume-preserving and reversible, so no Jacobian term is needed.
      for (let i = 0; i < d; i++) p[i] += 0.5 * eps * grad[i];
      for (let st = 0; st < this.steps; st++) {
        for (let i = 0; i < d; i++) q[i] += eps * p[i];
        logP = this.density.at(q);
        if (!Number.isFinite(logP)) {
          broken = true;
          break;
        }
        grad = this.grad(q);
        if (!grad.every((g) => Number.isFinite(g))) {
          broken = true;
          break;
        }
        const half = st === this.steps - 1 ? 0.5 : 1;
        for (let i = 0; i < d; i++) p[i] += half * eps * grad[i];
      }
    }

    if (broken) return { q, grad, logP, logAccept: -Infinity, divergent: true };
    let kinetic1 = 0;
    for (let i = 0; i < d; i++) kinetic1 += 0.5 * p[i] * p[i];
    let logAccept = logP - kinetic1 - (this.logDensityValue - kinetic0);
    let divergent = false;
    if (!Number.isFinite(logAccept) || logAccept < -1000) {
      divergent = true;
      logAccept = -Infinity;
    }
    return { q, grad, logP, logAccept, divergent };
  }

  /**
   * Stan's find-reasonable-epsilon heuristic (Hoffman & Gelman 2014,
   * algorithm 4): double or halve the step size until the acceptance
   * probability of a single trajectory crosses 0.5. Dual averaging is then
   * anchored at log(10·eps) around a step size that is at least stable;
   * anchoring at an arbitrary multiple of the user's guess is what makes the
   * adaptation oscillate between divergence and a crawl.
   */
  private findReasonableStep(rng: Random): void {
    let eps = Math.exp(this.logStepSize);
    const threshold = Math.log(0.5);
    let { logAccept } = this.trajectory(eps, rng);
    const direction = logAccept > threshold ? 1 : -1;
    for (let i = 0; i < 60; i++) {
      const next = eps * Math.pow(2, direction);
      if (!(next > 0) || !Number.isFinite(next)) break;
      const probe = this.trajectory(next, rng);
      eps = next;
      logAccept = probe.logAccept;
      if (direction * (logAccept - threshold) <= 0) break;
    }
    this.logStepSize = Math.log(eps);
    this.mu = Math.log(10 * eps);
  }

  step(rng: Random, adapting: boolean): void {
    const adapt = adapting && !this.frozen;
    if (adapt && this.adaptCount === 0) this.findReasonableStep(rng);
    // Jitter the step size by +/-20% so the trajectory length varies. With a
    // fixed trajectory length T, HMC on a near-Gaussian target has lag-1
    // correlation cos(T): when T lands near a multiple of 2*pi the chain
    // returns almost to where it started every iteration and mixes terribly,
    // a resonance that no amount of step-size adaptation detects (the
    // acceptance rate is excellent throughout). The jitter is drawn
    // independently of the current state, so detailed balance is preserved.
    const eps = Math.exp(this.logStepSize) * (0.8 + 0.4 * rng.uniform());
    const outcome = this.trajectory(eps, rng);

    this.stats.proposals++;
    if (adapt) this.warmupProposals++;
    if (outcome.divergent) this.stats.divergences++;

    const { logAccept } = outcome;
    if (logAccept >= 0 || (logAccept > -Infinity && Math.log(rng.uniformOpen()) < logAccept)) {
      for (let i = 0; i < this.d; i++) this.position[i] = outcome.q[i];
      this.logDensityValue = outcome.logP;
      this.gradient = outcome.grad;
      this.stats.accepted++;
      if (adapt) this.warmupAccepted++;
    }

    if (!adapt) return;
    // Dual averaging on the acceptance statistic alpha = min(1, exp(logAccept)).
    const alpha = logAccept === -Infinity ? 0 : Math.min(1, Math.exp(logAccept));
    this.adaptCount++;
    const m = this.adaptCount;
    const gamma = 0.05;
    const t0 = 10;
    const kappa = 0.75;
    this.hBar = (1 - 1 / (m + t0)) * this.hBar + (this.targetAcceptance - alpha) / (m + t0);
    this.logStepSize = this.mu - (Math.sqrt(m) / gamma) * this.hBar;
    this.logStepSize = Math.max(-14, Math.min(4, this.logStepSize));
    const eta = Math.pow(m, -kappa);
    this.logStepSizeBar = eta * this.logStepSize + (1 - eta) * this.logStepSizeBar;
  }

  freeze(): void {
    if (!this.frozen && this.adaptCount > 0) this.logStepSize = this.logStepSizeBar;
    this.frozen = true;
  }

  warmupAcceptance(): number {
    return this.warmupProposals ? this.warmupAccepted / this.warmupProposals : 0;
  }

  tuning(): Record<string, number> {
    return {
      stepSize: Math.exp(this.logStepSize),
      leapfrogSteps: this.steps,
      targetAcceptance: this.targetAcceptance,
    };
  }
}

/**
 * Univariate slice sampling with stepping-out and shrinkage (Neal 2003),
 * applied to each coordinate in turn. Attractive because it is nearly
 * tuning-free: the width only affects efficiency, never correctness, and
 * every iteration is accepted by construction, so there is no acceptance
 * rate to tune (it is reported as 1 for that reason).
 */
export class SliceSampler implements Sampler {
  readonly label = 'Slice sampling (stepping-out and shrinkage)';
  readonly adaptsDuringWarmup = false;
  readonly limitations = [
    'Slice sampling accepts every iteration by construction, so its acceptance rate is 1 and carries no information about mixing. Judge it by effective sample size instead.',
  ];
  readonly position: number[];
  logDensityValue: number;
  readonly stats: SamplerStats = emptyStats();
  private readonly density: DensityCounter;
  private readonly width: number;
  private readonly maxStepOut: number;

  constructor(target: TargetSpec, config: SliceConfig, start: readonly number[]) {
    this.density = new DensityCounter(target.logDensity, this.stats);
    this.position = [...start];
    this.width = config.width ?? 1;
    if (!(this.width > 0) || !Number.isFinite(this.width)) {
      throw new EngineError('The slice sampling width must be a finite positive number.', 'range');
    }
    this.maxStepOut = config.maxStepOut ?? 64;
    if (!Number.isInteger(this.maxStepOut) || this.maxStepOut < 1) {
      throw new EngineError('maxStepOut must be a whole number of at least 1.', 'range');
    }
    this.logDensityValue = this.density.at(this.position);
  }

  step(rng: Random): void {
    const x = this.position;
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i];
      // Vertical level: log(y) = logp(x) + log(u), u ~ U(0,1).
      const logY = this.logDensityValue + Math.log(rng.uniformOpen());
      // Step out: randomly placed initial interval, expanded until both ends
      // are below the level.
      let lo = x0 - this.width * rng.uniform();
      let hi = lo + this.width;
      let budgetLo = Math.floor(this.maxStepOut * rng.uniform());
      let budgetHi = this.maxStepOut - 1 - budgetLo;
      const evalAt = (v: number): number => {
        x[i] = v;
        const lp = this.density.at(x);
        x[i] = x0;
        return lp;
      };
      while (budgetLo > 0 && evalAt(lo) > logY) {
        lo -= this.width;
        budgetLo--;
      }
      while (budgetHi > 0 && evalAt(hi) > logY) {
        hi += this.width;
        budgetHi--;
      }
      // Shrinkage: sample uniformly in the interval, contracting on rejection.
      let accepted = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const candidate = lo + (hi - lo) * rng.uniform();
        const lp = evalAt(candidate);
        this.stats.proposals++;
        if (lp > logY) {
          x[i] = candidate;
          this.logDensityValue = lp;
          this.stats.accepted++;
          accepted = true;
          break;
        }
        if (candidate < x0) lo = candidate;
        else hi = candidate;
      }
      if (!accepted) {
        // The interval collapsed onto the current point: keep it. This is the
        // correct degenerate outcome (the chain stays put), not a silent zero.
        x[i] = x0;
        this.stats.proposals++;
        this.stats.accepted++;
      }
    }
  }

  freeze(): void {
    /* nothing to freeze. */
  }

  tuning(): Record<string, number> {
    return { width: this.width, maxStepOut: this.maxStepOut };
  }
}

/**
 * Gibbs sampling scaffolding. The engine cannot derive full conditionals, so
 * the caller supplies one draw function per coordinate; each is called in
 * sequence with the current state. Every draw is accepted by construction.
 */
export class GibbsSampler implements Sampler {
  readonly label = 'Gibbs sampling (caller-supplied full conditionals)';
  readonly adaptsDuringWarmup = false;
  readonly limitations = [
    'Gibbs sampling draws from full conditionals supplied by the model, so its correctness depends entirely on those conditionals being the right ones; the engine cannot verify them.',
  ];
  readonly position: number[];
  logDensityValue: number;
  readonly stats: SamplerStats = emptyStats();
  private readonly density: DensityCounter;
  private readonly conditionals: readonly FullConditional[];

  constructor(target: TargetSpec, config: GibbsConfig, start: readonly number[]) {
    this.density = new DensityCounter(target.logDensity, this.stats);
    this.position = [...start];
    const conditionals = config.conditionals ?? target.fullConditionals;
    if (!conditionals || conditionals.length !== target.dimension) {
      throw new EngineError(
        `Gibbs sampling needs one full conditional per parameter: ${target.dimension} expected, ${conditionals ? conditionals.length : 0} supplied. Use Metropolis, slice sampling or HMC when the full conditionals are not available in closed form.`,
        'required',
      );
    }
    this.conditionals = conditionals;
    this.logDensityValue = this.density.at(this.position);
  }

  step(rng: Random): void {
    for (let i = 0; i < this.conditionals.length; i++) {
      const v = this.conditionals[i](this.position, rng);
      if (!Number.isFinite(v)) {
        throw new EngineError(
          `The full conditional for parameter ${i} returned ${String(v)}. A conditional draw must be a finite number.`,
          'nonfinite',
        );
      }
      this.position[i] = v;
      this.stats.proposals++;
      this.stats.accepted++;
    }
    this.logDensityValue = this.density.at(this.position);
  }

  freeze(): void {
    /* nothing to freeze. */
  }

  tuning(): Record<string, number> {
    return { parameters: this.conditionals.length };
  }
}

export function createSampler(target: TargetSpec, config: SamplerConfig, start: readonly number[]): Sampler {
  switch (config.kind) {
    case 'metropolis':
      return new MetropolisSampler(target, config, start);
    case 'adaptive-metropolis':
      return new AdaptiveMetropolisSampler(target, config, start);
    case 'hmc':
      return new HmcSampler(target, config, start);
    case 'slice':
      return new SliceSampler(target, config, start);
    case 'gibbs':
      return new GibbsSampler(target, config, start);
  }
}
