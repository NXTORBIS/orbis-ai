/**
 * Model library.
 *
 * Each entry is built from a small serialisable configuration, so the same
 * definition can be constructed on the main thread, inside the simulation
 * worker and in tests — the same discipline as `simulation/registry.ts`.
 *
 * The library deliberately spans the range of difficulty, because a filtering
 * interface that only ever shows a well-behaved linear example teaches the
 * wrong lesson:
 *  - constant-velocity tracker: linear, position-only measurement; the Kalman
 *    filter is exact and the smoother visibly beats it.
 *  - noisy pendulum: strongly non-linear, where the EKF can and does diverge
 *    and the UKF does not.
 *  - local level and local linear trend: the structural time-series models
 *    behind exponential smoothing, with the signal-to-noise ratio exposed.
 *  - stochastic volatility: the latent state enters the OBSERVATION VARIANCE,
 *    so no Gaussian filter applies at all and a particle filter is required.
 *  - univariate growth: logistic growth with a saturating non-linearity.
 */
import { EngineError, Validator } from '../core/result';
import { normalPdf } from '../special/gamma';
import { identity, inverseSPD, psdCholesky, type Mat, type Vec } from './matrix';
import type { LinearGaussianModel, NonlinearModel, ParticleModel } from './types';
import { accessModel } from './kalman';

const LOG_2PI = Math.log(2 * Math.PI);

export interface ConstantVelocityConfig {
  /** Time between measurements. */
  dt: number;
  /** Standard deviation of the acceleration driving the velocity. */
  accelerationNoise: number;
  /** Standard deviation of the position measurement. */
  measurementNoise: number;
  /** Initial position and velocity guess. */
  initialPosition?: number;
  initialVelocity?: number;
  /** Prior standard deviations for position and velocity. */
  priorPositionSd?: number;
  priorVelocitySd?: number;
}

/**
 * Constant-velocity tracker with a position-only measurement.
 *
 * The velocity is never measured. It is estimated only because the dynamics
 * couple it to the position — which is exactly why the observability check
 * matters, and the state here IS observable: [C; CA] = [[1,0],[1,dt]] has rank 2
 * for any dt ≠ 0.
 *
 * Q is the exact integral of a continuous white-noise acceleration over one
 * step, σ_a²·[[dt³/3, dt²/2], [dt²/2, dt]], not an ad-hoc diagonal.
 */
export function constantVelocityTracker(config: ConstantVelocityConfig): LinearGaussianModel {
  const v = new Validator();
  v.positive(config.dt, 'dt', 'The time step');
  v.positive(config.accelerationNoise, 'accelerationNoise', 'The acceleration noise');
  v.positive(config.measurementNoise, 'measurementNoise', 'The measurement noise');
  v.throwIfInvalid();
  const { dt } = config;
  const sa2 = config.accelerationNoise * config.accelerationNoise;
  const model: LinearGaussianModel = {
    A: [
      [1, dt],
      [0, 1],
    ],
    C: [[1, 0]],
    Q: [
      [(sa2 * dt * dt * dt) / 3, (sa2 * dt * dt) / 2],
      [(sa2 * dt * dt) / 2, sa2 * dt],
    ],
    R: [[config.measurementNoise * config.measurementNoise]],
    mu0: [config.initialPosition ?? 0, config.initialVelocity ?? 0],
    Sigma0: [
      [(config.priorPositionSd ?? 10) ** 2, 0],
      [0, (config.priorVelocitySd ?? 10) ** 2],
    ],
    stateNames: ['position', 'velocity'],
    observationNames: ['measured position'],
  };
  accessModel(model, 1);
  return model;
}

export interface LocalLevelConfig {
  /** Standard deviation of the level's random walk. */
  levelNoise: number;
  /** Standard deviation of the measurement. */
  measurementNoise: number;
  initialLevel?: number;
  priorLevelSd?: number;
}

/**
 * Local level model (random walk plus noise): x_t = x_{t−1} + w, y_t = x_t + v.
 *
 * The filter on this model is exponential smoothing, and its steady-state gain
 * is the smoothing constant. The signal-to-noise ratio q = σ_w²/σ_v² decides
 * everything: large q tracks, small q smooths.
 */
export function localLevel(config: LocalLevelConfig): LinearGaussianModel {
  const v = new Validator();
  v.positive(config.levelNoise, 'levelNoise', 'The level noise');
  v.positive(config.measurementNoise, 'measurementNoise', 'The measurement noise');
  v.throwIfInvalid();
  return {
    A: [[1]],
    C: [[1]],
    Q: [[config.levelNoise * config.levelNoise]],
    R: [[config.measurementNoise * config.measurementNoise]],
    mu0: [config.initialLevel ?? 0],
    Sigma0: [[(config.priorLevelSd ?? 100) ** 2]],
    stateNames: ['level'],
    observationNames: ['observation'],
  };
}

export interface LocalLinearTrendConfig {
  levelNoise: number;
  slopeNoise: number;
  measurementNoise: number;
  initialLevel?: number;
  initialSlope?: number;
  priorLevelSd?: number;
  priorSlopeSd?: number;
}

/**
 * Local linear trend: level and slope, each a random walk, with the level
 * measured. This is the structural model behind Holt's linear method.
 *
 * Note that the slope is NOT measured, and with slopeNoise at 0 the model
 * degenerates to a fixed slope — the observability check still passes, but the
 * process noise then does not excite the slope direction, which the structural
 * analysis reports as uncontrollable.
 */
export function localLinearTrend(config: LocalLinearTrendConfig): LinearGaussianModel {
  const v = new Validator();
  v.positive(config.levelNoise, 'levelNoise', 'The level noise');
  v.nonNegative(config.slopeNoise, 'slopeNoise', 'The slope noise');
  v.positive(config.measurementNoise, 'measurementNoise', 'The measurement noise');
  v.throwIfInvalid();
  return {
    A: [
      [1, 1],
      [0, 1],
    ],
    C: [[1, 0]],
    Q: [
      [config.levelNoise * config.levelNoise, 0],
      [0, config.slopeNoise * config.slopeNoise],
    ],
    R: [[config.measurementNoise * config.measurementNoise]],
    mu0: [config.initialLevel ?? 0, config.initialSlope ?? 0],
    Sigma0: [
      [(config.priorLevelSd ?? 100) ** 2, 0],
      [0, (config.priorSlopeSd ?? 10) ** 2],
    ],
    stateNames: ['level', 'slope'],
    observationNames: ['observation'],
  };
}

export interface PendulumConfig {
  /** Integration and measurement interval. */
  dt: number;
  /** Gravitational acceleration. */
  gravity?: number;
  /** Pendulum length. */
  length?: number;
  /** Standard deviation of the angular-acceleration disturbance per step. */
  processNoise: number;
  /** Standard deviation of the measurement. */
  measurementNoise: number;
  /**
   * What is measured. 'angle' is mildly non-linear through the dynamics only;
   * 'sine' (the horizontal displacement) adds a non-linear measurement and is
   * the setting where the EKF gets into real trouble.
   */
  measure?: 'angle' | 'sine';
  initialAngle?: number;
  initialRate?: number;
  priorAngleSd?: number;
  priorRateSd?: number;
}

/**
 * Noisy pendulum, the standard strongly non-linear test case.
 *
 *   θ_{t} = θ_{t−1} + dt·ω_{t−1}
 *   ω_{t} = ω_{t−1} − dt·(g/L)·sin(θ_{t−1}) + w
 *
 * At large amplitude sin θ is nowhere near θ, so the EKF's linearisation about
 * the current estimate is poor, and its covariance — computed from that
 * linearisation — does not know it. This is the model the test suite uses to
 * show the UKF beating the EKF and the EKF's divergence showing up in the
 * innovation diagnostics rather than in its own covariance.
 */
export function noisyPendulum(config: PendulumConfig): NonlinearModel {
  const v = new Validator();
  v.positive(config.dt, 'dt', 'The time step');
  v.positive(config.processNoise, 'processNoise', 'The process noise');
  v.positive(config.measurementNoise, 'measurementNoise', 'The measurement noise');
  v.throwIfInvalid();
  const dt = config.dt;
  const g = config.gravity ?? 9.81;
  const L = config.length ?? 1;
  if (!(L > 0)) throw new EngineError(`The pendulum length must be positive; received ${L}.`, 'range');
  const k = g / L;
  const measure = config.measure ?? 'sine';
  const q = config.processNoise * config.processNoise;
  return {
    stateDim: 2,
    obsDim: 1,
    f: (x) => [x[0] + dt * x[1], x[1] - dt * k * Math.sin(x[0])],
    h: (x) => (measure === 'sine' ? [Math.sin(x[0])] : [x[0]]),
    jacobianF: (x) => [
      [1, dt],
      [-dt * k * Math.cos(x[0]), 1],
    ],
    jacobianH: (x) => (measure === 'sine' ? [[Math.cos(x[0]), 0]] : [[1, 0]]),
    // The disturbance enters the angular rate; the angle inherits it through dt.
    Q: [
      [q * dt * dt * dt / 3, (q * dt * dt) / 2],
      [(q * dt * dt) / 2, q * dt],
    ],
    R: [[config.measurementNoise * config.measurementNoise]],
    mu0: [config.initialAngle ?? 0, config.initialRate ?? 0],
    Sigma0: [
      [(config.priorAngleSd ?? 0.5) ** 2, 0],
      [0, (config.priorRateSd ?? 0.5) ** 2],
    ],
    stateNames: ['angle', 'angular rate'],
    observationNames: [measure === 'sine' ? 'horizontal displacement' : 'angle'],
  };
}

export interface GrowthConfig {
  /** Intrinsic growth rate per step. */
  rate: number;
  /** Carrying capacity. */
  capacity: number;
  /** Standard deviation of the disturbance to the level. */
  processNoise: number;
  measurementNoise: number;
  initialLevel?: number;
  priorSd?: number;
}

/**
 * Univariate logistic growth with noise:
 *   x_t = x_{t−1} + r·x_{t−1}(1 − x_{t−1}/K) + w,   y_t = x_t + v.
 *
 * Non-linear in the state and saturating, so the filter's uncertainty is
 * strongly state dependent: near the capacity the dynamics are contracting and
 * the estimate is sharp; in the exponential phase they are expanding and it is
 * not. A linear filter cannot express that at all.
 */
export function univariateGrowth(config: GrowthConfig): NonlinearModel {
  const v = new Validator();
  v.positive(config.capacity, 'capacity', 'The carrying capacity');
  v.finite(config.rate, 'rate', 'The growth rate');
  v.positive(config.processNoise, 'processNoise', 'The process noise');
  v.positive(config.measurementNoise, 'measurementNoise', 'The measurement noise');
  v.throwIfInvalid();
  const { rate: r, capacity: K } = config;
  return {
    stateDim: 1,
    obsDim: 1,
    f: (x) => [x[0] + r * x[0] * (1 - x[0] / K)],
    h: (x) => [x[0]],
    jacobianF: (x) => [[1 + r - (2 * r * x[0]) / K]],
    jacobianH: () => [[1]],
    Q: [[config.processNoise * config.processNoise]],
    R: [[config.measurementNoise * config.measurementNoise]],
    mu0: [config.initialLevel ?? K / 100],
    Sigma0: [[(config.priorSd ?? K / 20) ** 2]],
    stateNames: ['level'],
    observationNames: ['observation'],
  };
}

export interface StochasticVolatilityConfig {
  /** Long-run mean of the log variance. */
  mu: number;
  /** Persistence of the log variance; |phi| < 1 for stationarity. */
  phi: number;
  /** Standard deviation of the log-variance innovation. */
  sigma: number;
}

/**
 * Stochastic volatility:
 *   h_t = μ + φ(h_{t−1} − μ) + σ η_t,    y_t = exp(h_t / 2) ε_t.
 *
 * The latent state enters the observation's VARIANCE rather than its mean, so
 * p(y | h) is Gaussian in y but the model is not a Gaussian state-space model
 * in h at all: no Kalman, EKF or UKF applies without first transforming the
 * data and accepting a non-Gaussian error. A particle filter handles it
 * directly, which is why this model is in the library.
 */
export function stochasticVolatility(config: StochasticVolatilityConfig): ParticleModel {
  const v = new Validator();
  v.finite(config.mu, 'mu', 'The mean log variance');
  v.positive(config.sigma, 'sigma', 'The log-variance innovation standard deviation');
  v.throwIfInvalid();
  if (!(Math.abs(config.phi) < 1)) {
    throw new EngineError(
      `The persistence phi must satisfy |phi| < 1 for the log variance to be stationary; received ${config.phi}. ` +
        'At |phi| ≥ 1 the volatility has no stationary distribution and the prior below would be meaningless.',
      'range',
    );
  }
  const { mu, phi, sigma } = config;
  const stationarySd = sigma / Math.sqrt(1 - phi * phi);
  return {
    stateDim: 1,
    obsDim: 1,
    sampleInitial: (normal) => [mu + stationarySd * normal()],
    samplePropagate: (x, _t, normal) => [mu + phi * (x[0] - mu) + sigma * normal()],
    propagateMean: (x) => [mu + phi * (x[0] - mu)],
    logObservationDensity: (y, x) => {
      const h = x[0];
      if (!Number.isFinite(h)) return -Infinity;
      // log N(y | 0, exp(h)) = −½log(2π) − h/2 − y²/(2 e^h)
      return -0.5 * LOG_2PI - h / 2 - (y[0] * y[0]) / (2 * Math.exp(h));
    },
    logTransitionDensity: (xNext, x) => {
      const m = mu + phi * (x[0] - mu);
      const z = (xNext[0] - m) / sigma;
      return -0.5 * LOG_2PI - Math.log(sigma) - 0.5 * z * z;
    },
    stateNames: ['log variance'],
  };
}

/**
 * Wrap a linear-Gaussian model as a particle model.
 *
 * Its purpose is testing: on a linear-Gaussian model the exact answer is known,
 * so running a particle filter on one is the only particle test with a
 * reference value — the filtered mean must converge to the Kalman mean as the
 * particle count grows. It is also occasionally useful in production, when a
 * linear model acquires a non-Gaussian observation.
 */
export function linearGaussianAsParticleModel(model: LinearGaussianModel): ParticleModel {
  const acc = accessModel(model, 1);
  const A = acc.A(0);
  const C = acc.C(0);
  const Q = acc.Q(0);
  const R = acc.R(0);
  const n = acc.n;
  const m = acc.m;
  const lq = psdCholesky(Q, 'Q');
  const lr = psdCholesky(R, 'R');
  const rInv = inverseSPD(R);
  let logDetR = 0;
  for (let i = 0; i < m; i++) logDetR += Math.log(lr[i][i]);
  const l0 = psdCholesky(model.Sigma0, 'Sigma0');
  const qInv = isZeroMatrix(Q) ? null : inverseSPD(Q);
  let logDetQ = 0;
  for (let i = 0; i < n; i++) logDetQ += Math.log(Math.max(lq[i][i], Number.MIN_VALUE));

  const draw = (mean: Vec, L: Mat, normal: () => number): Vec => {
    const z = Array.from({ length: mean.length }, () => normal());
    return mean.map((mv, i) => {
      let s = 0;
      for (let j = 0; j <= i; j++) s += L[i][j] * z[j];
      return mv + s;
    });
  };

  return {
    stateDim: n,
    obsDim: m,
    sampleInitial: (normal) => draw(model.mu0, l0, normal),
    samplePropagate: (x, _t, normal) => draw(mul(A, x), lq, normal),
    propagateMean: (x) => mul(A, x),
    logObservationDensity: (y, x) => {
      const d = y.map((yv, i) => yv - dotRow(C[i], x));
      let s = 0;
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) s += d[i] * rInv[i][j] * d[j];
      return -0.5 * (m * LOG_2PI + 2 * logDetR + s);
    },
    logTransitionDensity:
      qInv === null
        ? undefined
        : (xNext, x) => {
            const d = xNext.map((v, i) => v - dotRow(A[i], x));
            let s = 0;
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += d[i] * qInv[i][j] * d[j];
            return -0.5 * (n * LOG_2PI + 2 * logDetQ + s);
          },
    stateNames: model.stateNames,
  };
}

function mul(a: Mat, x: Vec): Vec {
  return a.map((row) => dotRow(row, x));
}

function dotRow(row: number[], x: Vec): number {
  let s = 0;
  for (let i = 0; i < row.length; i++) s += row[i] * x[i];
  return s;
}

function isZeroMatrix(a: Mat): boolean {
  return a.every((r) => r.every((v) => v === 0));
}

/** A one-dimensional Gaussian observation density, for callers building models. */
export function gaussianObservationLogDensity(y: number, mean: number, sd: number): number {
  if (!(sd > 0)) throw new EngineError(`A Gaussian observation density needs a positive standard deviation; received ${sd}.`, 'range');
  const p = normalPdf((y - mean) / sd) / sd;
  return Math.log(p);
}

/** Catalogue entry for a user interface. */
export interface FilteringModelEntry {
  id: string;
  name: string;
  /** Which family of filter the model belongs to. */
  kind: 'linear-gaussian' | 'nonlinear' | 'particle-only';
  description: string;
}

export const FILTERING_MODELS: FilteringModelEntry[] = [
  {
    id: 'constant-velocity',
    name: 'Constant-velocity tracker',
    kind: 'linear-gaussian',
    description:
      'Position and velocity, with only the position measured. The Kalman filter is exact here, and the velocity is ' +
      'recovered purely through the dynamics.',
  },
  {
    id: 'local-level',
    name: 'Local level (random walk plus noise)',
    kind: 'linear-gaussian',
    description: 'The structural model behind exponential smoothing; its steady-state gain is the smoothing constant.',
  },
  {
    id: 'local-linear-trend',
    name: 'Local linear trend',
    kind: 'linear-gaussian',
    description: 'Level and slope as random walks, with the level measured. The slope is inferred, never observed.',
  },
  {
    id: 'noisy-pendulum',
    name: 'Noisy pendulum',
    kind: 'nonlinear',
    description:
      'Strongly non-linear. The extended Kalman filter can diverge on it while still reporting a small covariance; the ' +
      'unscented filter does not.',
  },
  {
    id: 'univariate-growth',
    name: 'Logistic growth',
    kind: 'nonlinear',
    description: 'Saturating growth, where the filter uncertainty depends strongly on where the state currently is.',
  },
  {
    id: 'stochastic-volatility',
    name: 'Stochastic volatility',
    kind: 'particle-only',
    description:
      'The latent state enters the observation variance, not its mean, so no Gaussian filter applies and a particle ' +
      'filter is required.',
  },
];

/** The identity model, occasionally useful as a baseline. */
export function identityModel(n: number): Mat {
  return identity(n);
}
