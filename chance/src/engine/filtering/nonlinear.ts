/**
 * Non-linear filtering by Gaussian approximation: the extended Kalman filter
 * and the unscented Kalman filter.
 *
 * NEITHER IS EXACT, and the difference matters more than the formulas.
 *
 * The EKF linearises f and h about the current estimate and then runs the
 * linear update. When the model is strongly non-linear over the width of the
 * state uncertainty, that linearisation is simply wrong, and the consequence
 * is specific and nasty: the EKF's covariance is computed from the linearised
 * model, so it stays small and confident while the mean drifts away from the
 * truth. The filter diverges and reports no indication whatsoever that it has.
 * The only way to find out is to test the innovations — which is why
 * `innovationWhiteness` and `nees` exist, and why the EKF result carries the
 * caveat in its explanation rather than in a comment.
 *
 * The UKF propagates a deterministic set of sigma points through f and h
 * unchanged and reconstructs mean and covariance from them. It needs no
 * derivatives, is exact for linear models, and captures the second-order
 * behaviour the EKF throws away. It is usually the better choice, and the
 * scaled unscented transform (α, β, κ) implemented here is the standard form:
 *   λ = α²(n + κ) − n,  w₀^m = λ/(n+λ),  w₀^c = λ/(n+λ) + (1 − α² + β),
 *   w_i = 1/(2(n+λ)).
 * Defaults α = 1e-3, β = 2, κ = 0 are the usual recommendation for a Gaussian
 * prior. Note w₀^m can be large and negative; the covariance is still PSD for
 * these weights in practice, and it is Cholesky-checked every step anyway.
 */
import { EngineError } from '../core/result';
import {
  addVec,
  choleskyOrThrow,
  cloneMat,
  cols,
  dot,
  forwardSubstitute,
  identity,
  matAdd,
  matMul,
  matSub,
  matVec,
  psdCholesky,
  rows,
  solveSPDMat,
  subVec,
  symmetrise,
  transpose,
  weightedCovariance,
  weightedCrossCovariance,
  weightedMean,
  zeros,
  type Mat,
  type Vec,
} from './matrix';
import {
  explainFiltering,
  type FilterProgress,
  type FilterStep,
  type NonlinearFilterResult,
  type NonlinearModel,
  type Observation,
  type RunControl,
} from './types';

const LOG_2PI = Math.log(2 * Math.PI);

export interface UnscentedParameters {
  /** Spread of the sigma points; small (1e-3) keeps them close to the mean. */
  alpha?: number;
  /** Prior knowledge of the distribution; 2 is optimal for a Gaussian. */
  beta?: number;
  /** Secondary scaling, usually 0 or 3 − n. */
  kappa?: number;
}

export interface NonlinearOptions extends RunControl {
  controls?: Vec[];
  /** Step used by the finite-difference Jacobian fallback, relative to |x|. */
  jacobianStep?: number;
}

function constMat(m: Mat | Mat[], t: number, name: string): Mat {
  if (Array.isArray(m) && Array.isArray(m[0]) && Array.isArray((m as Mat[])[0][0])) {
    const seq = m as unknown as Mat[];
    if (t >= seq.length) throw new EngineError(`${name} was supplied for ${seq.length} steps but step ${t} was reached.`, 'shape');
    return seq[t];
  }
  return m as Mat;
}

function validateNonlinear(model: NonlinearModel, T: number): void {
  const n = model.stateDim;
  const m = model.obsDim;
  if (!Number.isInteger(n) || n < 1) throw new EngineError(`The state dimension must be a whole number of at least 1; received ${n}.`, 'range');
  if (!Number.isInteger(m) || m < 1) throw new EngineError(`The observation dimension must be a whole number of at least 1; received ${m}.`, 'range');
  if (model.mu0.length !== n) throw new EngineError(`mu0 has ${model.mu0.length} components but the state dimension is ${n}.`, 'shape');
  if (rows(model.Sigma0) !== n || cols(model.Sigma0) !== n) {
    throw new EngineError(`Sigma0 is ${rows(model.Sigma0)}×${cols(model.Sigma0)} but the state dimension is ${n}, so it must be ${n}×${n}.`, 'shape');
  }
  const Q = constMat(model.Q, 0, 'Q');
  const R = constMat(model.R, 0, 'R');
  if (rows(Q) !== n || cols(Q) !== n) throw new EngineError(`Q is ${rows(Q)}×${cols(Q)} but the state dimension is ${n}, so Q must be ${n}×${n}.`, 'shape');
  if (rows(R) !== m || cols(R) !== m) throw new EngineError(`R is ${rows(R)}×${cols(R)} but the observation dimension is ${m}, so R must be ${m}×${m}.`, 'shape');
  psdCholesky(Q, 'The process-noise covariance Q');
  choleskyOrThrow(R, 'The measurement-noise covariance R');
  psdCholesky(symmetrise(model.Sigma0), 'The prior covariance Sigma0');
  if (T < 1) throw new EngineError('A filter needs at least one time step; the observation sequence is empty.', 'required');
  // The first function evaluation is checked here so a broken model is caught
  // before any numbers are reported.
  const fx = model.f(model.mu0, 0);
  if (fx.length !== n) throw new EngineError(`f returned ${fx.length} components but the state dimension is ${n}.`, 'shape');
  const hx = model.h(model.mu0, 0);
  if (hx.length !== m) throw new EngineError(`h returned ${hx.length} components but the observation dimension is ${m}.`, 'shape');
}

/**
 * Central-difference Jacobian. Labelled explicitly in the result as less
 * accurate than an analytic one: a central difference has O(h²) truncation
 * error and loses roughly half the available digits, and with a badly scaled
 * state it can be wrong enough to destabilise the filter on its own.
 */
export function numericalJacobian(g: (x: Vec) => Vec, x: Vec, outDim: number, relStep = 1e-6): Mat {
  const n = x.length;
  const J = zeros(outDim, n);
  for (let j = 0; j < n; j++) {
    const h = relStep * Math.max(1, Math.abs(x[j]));
    const xp = x.slice();
    const xm = x.slice();
    xp[j] += h;
    xm[j] -= h;
    const gp = g(xp);
    const gm = g(xm);
    if (gp.length !== outDim || gm.length !== outDim) {
      throw new EngineError(`The numerical Jacobian expected ${outDim} outputs but the function returned ${gp.length}.`, 'shape');
    }
    for (let i = 0; i < outDim; i++) {
      const d = (gp[i] - gm[i]) / (2 * h);
      if (!Number.isFinite(d)) {
        throw new EngineError(
          `The numerical Jacobian at output ${i}, input ${j} came out as ${d}. Supply an analytic Jacobian, or check ` +
            'that the model function is finite in a neighbourhood of the current estimate.',
          'finite',
        );
      }
      J[i][j] = d;
    }
  }
  return J;
}

function selectObs(obs: Observation, t: number, m: number): { idx: number[]; values: Vec } {
  if (obs === null) return { idx: [], values: [] };
  if (obs.length !== m) throw new EngineError(`Observation ${t} has ${obs.length} components but the observation dimension is ${m}.`, 'shape');
  const idx: number[] = [];
  const values: number[] = [];
  for (let j = 0; j < m; j++) {
    const v = obs[j];
    if (v === null || v === undefined) continue;
    if (!Number.isFinite(v)) {
      throw new EngineError(
        `Observation ${t}, component ${j} is ${v}, which is not a finite number. Use null to mark a missing measurement.`,
        'finite',
      );
    }
    idx.push(j);
    values.push(v);
  }
  return { idx, values };
}

/** Extended Kalman filter. Generator-based so long runs can be cancelled. */
export function* extendedKalmanSteps(
  model: NonlinearModel,
  observations: Observation[],
  options: NonlinearOptions = {},
): Generator<FilterProgress, NonlinearFilterResult, void> {
  const T = observations.length;
  validateNonlinear(model, T);
  const n = model.stateDim;
  const chunk = Math.max(1, options.chunk ?? 256);
  const relStep = options.jacobianStep ?? 1e-6;
  let usedNumerical = false;
  let mean = model.mu0.slice();
  let cov = symmetrise(model.Sigma0);
  let loglik = 0;
  let observed = 0;
  let partial = false;
  const steps: FilterStep[] = [];
  const warnings: string[] = [];
  let t = 0;
  while (t < T) {
    const stop = Math.min(T, t + chunk);
    for (; t < stop; t++) {
      const u = options.controls?.[t];
      const Q = constMat(model.Q, t, 'Q');
      const R = constMat(model.R, t, 'R');
      const F =
        model.jacobianF !== undefined
          ? model.jacobianF(mean, t, u)
          : ((usedNumerical = true), numericalJacobian((x) => model.f(x, t, u), mean, n, relStep));
      if (rows(F) !== n || cols(F) !== n) throw new EngineError(`The state Jacobian at time ${t} is ${rows(F)}×${cols(F)}; it must be ${n}×${n}.`, 'shape');
      const predMean = model.f(mean, t, u);
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(predMean[i])) {
          throw new EngineError(
            `The state prediction at time ${t}, component ${i}, came out as ${predMean[i]}. The EKF has left the ` +
              'region where the model is defined — a classic symptom of divergence — so the run is refused rather than continued.',
            'finite',
          );
        }
      }
      const predCov = symmetrise(matAdd(matMul(matMul(F, cov), transpose(F)), Q));
      const sel = selectObs(observations[t], t, model.obsDim);
      if (sel.idx.length === 0) {
        mean = predMean;
        cov = predCov;
        steps.push(missingStep(predMean, predCov));
        continue;
      }
      const Hfull =
        model.jacobianH !== undefined
          ? model.jacobianH(predMean, t)
          : ((usedNumerical = true), numericalJacobian((x) => model.h(x, t), predMean, model.obsDim, relStep));
      if (rows(Hfull) !== model.obsDim || cols(Hfull) !== n) {
        throw new EngineError(`The observation Jacobian at time ${t} is ${rows(Hfull)}×${cols(Hfull)}; it must be ${model.obsDim}×${n}.`, 'shape');
      }
      const H = sel.idx.map((i) => [...Hfull[i]]);
      const Rs = sel.idx.map((i) => sel.idx.map((j) => R[i][j]));
      const hFull = model.h(predMean, t);
      const hPred = sel.idx.map((i) => hFull[i]);
      const HP = matMul(H, predCov);
      const S = symmetrise(matAdd(matMul(HP, transpose(H)), Rs));
      const Sl = choleskyOrThrow(S, `The innovation covariance at time ${t}`);
      const innovation = subVec(sel.values, hPred);
      const K = transpose(solveSPDMat(S, HP, `The innovation covariance at time ${t}`));
      const z = forwardSubstitute(Sl, innovation);
      let logDet = 0;
      for (let i = 0; i < Sl.length; i++) logDet += Math.log(Sl[i][i]);
      const term = -0.5 * (sel.idx.length * LOG_2PI + 2 * logDet + dot(z, z));
      loglik += term;
      observed += sel.idx.length;
      mean = addVec(predMean, matVec(K, innovation));
      const ImKH = matSub(identity(n), matMul(K, H));
      cov = symmetrise(matAdd(matMul(matMul(ImKH, predCov), transpose(ImKH)), matMul(matMul(K, Rs), transpose(K))));
      choleskyOrThrow(cov, `The filtered covariance at time ${t}`);
      steps.push({
        predictedMean: predMean,
        predictedCov: predCov,
        filteredMean: mean.slice(),
        filteredCov: cloneMat(cov),
        observationPredMean: hPred,
        observationPredCov: cloneMat(S),
        innovation,
        innovationCov: cloneMat(S),
        standardisedInnovation: z,
        gain: K,
        logLikelihoodTerm: term,
        missing: false,
      });
    }
    yield { completed: t, total: T };
    if (t < T && options.isCancelled?.()) {
      partial = true;
      warnings.push(`The run was cancelled after ${t} of ${T} steps; the remaining states were not estimated.`);
      break;
    }
  }
  if (usedNumerical) {
    warnings.push(
      'At least one Jacobian was obtained by finite differences rather than analytically. A central difference has ' +
        'truncation error of order h² and loses about half the available precision, so the linearisation — and ' +
        'therefore the reported covariance — is less accurate than it would be with an analytic Jacobian.',
    );
  }
  warnings.push(
    'The extended Kalman filter is a linearised approximation. On a strongly non-linear model it can diverge while ' +
      'continuing to report a small covariance, and it gives no internal indication that this has happened. Check the ' +
      'innovation whiteness diagnostic, and prefer the unscented filter unless the model is nearly linear over the ' +
      'width of the state uncertainty.',
  );
  return {
    steps,
    approximateLogLikelihood: loglik,
    observedCount: observed,
    stateDim: n,
    obsDim: model.obsDim,
    method: 'ekf',
    numericalJacobian: usedNumerical,
    exactness: 'numerical',
    explanation: explainFiltering(
      'Extended Kalman filter (first-order linearisation)',
      'numerical',
      [
        { label: 'Steps filtered', value: String(steps.length) },
        { label: 'Linearisation', expression: 'F = ∂f/∂x at x_{t−1|t−1},  H = ∂h/∂x at x_{t|t−1}' },
        { label: 'Jacobians', value: usedNumerical ? 'finite differences (less accurate)' : 'analytic' },
        { label: 'Approximate log-likelihood', value: loglik.toFixed(6) },
      ],
      ['The posterior is approximated by a Gaussian and f, h are approximated by their first-order expansions about the current estimate.'],
      [
        'The log-likelihood is the Gaussian approximation, not the exact value: it cannot be compared with an exact likelihood from a linear model.',
        'Divergence on a strongly non-linear model is silent in the filter output and must be detected with the innovation diagnostics.',
      ],
      'x_t ≈ f(x̂) + F(x − x̂) + w,  y_t ≈ h(x̂) + H(x − x̂) + v',
    ),
    warnings,
    partial,
  };
}

export function extendedKalmanFilter(
  model: NonlinearModel,
  observations: Observation[],
  options: NonlinearOptions = {},
): NonlinearFilterResult {
  const it = extendedKalmanSteps(model, observations, options);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

interface SigmaWeights {
  wm: number[];
  wc: number[];
  lambda: number;
}

function sigmaWeights(n: number, p: UnscentedParameters): SigmaWeights {
  const alpha = p.alpha ?? 1e-3;
  const beta = p.beta ?? 2;
  const kappa = p.kappa ?? 0;
  if (!(alpha > 0)) throw new EngineError(`The unscented spread parameter alpha must be positive; received ${alpha}.`, 'range');
  const lambda = alpha * alpha * (n + kappa) - n;
  if (n + lambda === 0) {
    throw new EngineError(
      `The unscented parameters give n + λ = 0 (alpha=${alpha}, kappa=${kappa}), which makes the sigma-point weights ` +
        'infinite. Choose kappa = 0 or 3 − n with alpha near 1e-3.',
      'range',
    );
  }
  const wm = new Array<number>(2 * n + 1).fill(1 / (2 * (n + lambda)));
  const wc = wm.slice();
  wm[0] = lambda / (n + lambda);
  wc[0] = lambda / (n + lambda) + (1 - alpha * alpha + beta);
  return { wm, wc, lambda };
}

/** Unscented Kalman filter with the scaled unscented transform. */
export function* unscentedKalmanSteps(
  model: NonlinearModel,
  observations: Observation[],
  options: NonlinearOptions & UnscentedParameters = {},
): Generator<FilterProgress, NonlinearFilterResult, void> {
  const T = observations.length;
  validateNonlinear(model, T);
  const n = model.stateDim;
  const chunk = Math.max(1, options.chunk ?? 256);
  const { wm, wc, lambda } = sigmaWeights(n, options);
  let mean = model.mu0.slice();
  let cov = symmetrise(model.Sigma0);
  let loglik = 0;
  let observed = 0;
  let partial = false;
  const steps: FilterStep[] = [];
  const warnings: string[] = [];
  let t = 0;

  const makeSigma = (m: Vec, P: Mat, label: string): Vec[] => {
    const L = choleskyOrThrow(P, label);
    const scale = Math.sqrt(n + lambda);
    const pts: Vec[] = [m.slice()];
    for (let i = 0; i < n; i++) {
      const colI = L.map((r) => r[i] * scale);
      pts.push(addVec(m, colI));
    }
    for (let i = 0; i < n; i++) {
      const colI = L.map((r) => r[i] * scale);
      pts.push(subVec(m, colI));
    }
    return pts;
  };

  while (t < T) {
    const stop = Math.min(T, t + chunk);
    for (; t < stop; t++) {
      const u = options.controls?.[t];
      const Q = constMat(model.Q, t, 'Q');
      const R = constMat(model.R, t, 'R');
      const pts = makeSigma(mean, cov, `The state covariance at time ${t}`);
      const propagated = pts.map((p) => {
        const v = model.f(p, t, u);
        for (let i = 0; i < v.length; i++) {
          if (!Number.isFinite(v[i])) {
            throw new EngineError(
              `Propagating sigma point through f at time ${t} produced ${v[i]} in component ${i}. The sigma points ` +
                'have left the region where the model is defined, so no estimate is reported.',
              'finite',
            );
          }
        }
        return v;
      });
      const predMean = weightedMean(propagated, wm);
      const predCov = symmetrise(matAdd(weightedCovariance(propagated, wc, predMean), Q));
      const sel = selectObs(observations[t], t, model.obsDim);
      if (sel.idx.length === 0) {
        mean = predMean;
        cov = predCov;
        steps.push(missingStep(predMean, predCov));
        continue;
      }
      // Re-draw sigma points about the prediction so the measurement update
      // uses the predicted covariance rather than the propagated one.
      const predPts = makeSigma(predMean, predCov, `The predicted covariance at time ${t}`);
      const obsPts = predPts.map((p) => {
        const full = model.h(p, t);
        return sel.idx.map((i) => full[i]);
      });
      const yMean = weightedMean(obsPts, wm);
      const Rs = sel.idx.map((i) => sel.idx.map((j) => R[i][j]));
      const S = symmetrise(matAdd(weightedCovariance(obsPts, wc, yMean), Rs));
      const Sl = choleskyOrThrow(S, `The innovation covariance at time ${t}`);
      const Cxy = weightedCrossCovariance(predPts, obsPts, wc, predMean, yMean);
      const K = transpose(solveSPDMat(S, transpose(Cxy), `The innovation covariance at time ${t}`));
      const innovation = subVec(sel.values, yMean);
      const z = forwardSubstitute(Sl, innovation);
      let logDet = 0;
      for (let i = 0; i < Sl.length; i++) logDet += Math.log(Sl[i][i]);
      const term = -0.5 * (sel.idx.length * LOG_2PI + 2 * logDet + dot(z, z));
      loglik += term;
      observed += sel.idx.length;
      mean = addVec(predMean, matVec(K, innovation));
      cov = symmetrise(matSub(predCov, matMul(matMul(K, S), transpose(K))));
      choleskyOrThrow(cov, `The filtered covariance at time ${t}`);
      steps.push({
        predictedMean: predMean,
        predictedCov: predCov,
        filteredMean: mean.slice(),
        filteredCov: cloneMat(cov),
        observationPredMean: yMean,
        observationPredCov: cloneMat(S),
        innovation,
        innovationCov: cloneMat(S),
        standardisedInnovation: z,
        gain: K,
        logLikelihoodTerm: term,
        missing: false,
      });
    }
    yield { completed: t, total: T };
    if (t < T && options.isCancelled?.()) {
      partial = true;
      warnings.push(`The run was cancelled after ${t} of ${T} steps; the remaining states were not estimated.`);
      break;
    }
  }
  warnings.push(
    'The unscented filter is derivative-free and captures the non-linearity to second order, but the posterior is ' +
      'still approximated by a Gaussian. For a strongly multi-modal posterior use a particle filter instead.',
  );
  return {
    steps,
    approximateLogLikelihood: loglik,
    observedCount: observed,
    stateDim: n,
    obsDim: model.obsDim,
    method: 'ukf',
    numericalJacobian: false,
    exactness: 'numerical',
    explanation: explainFiltering(
      'Unscented Kalman filter (scaled unscented transform)',
      'numerical',
      [
        { label: 'Steps filtered', value: String(steps.length) },
        { label: 'Sigma points', value: String(2 * n + 1) },
        { label: 'Scaling', expression: 'λ = α²(n + κ) − n', value: lambda.toExponential(3) },
        { label: 'Approximate log-likelihood', value: loglik.toFixed(6) },
      ],
      ['The posterior is approximated by a Gaussian matched to the propagated sigma points; no derivatives are used.'],
      [
        'Exact for a linear model, approximate otherwise; the log-likelihood is the Gaussian approximation, not the exact value.',
        'A multi-modal posterior cannot be represented by a single Gaussian however the sigma points are placed.',
      ],
    ),
    warnings,
    partial,
  };
}

export function unscentedKalmanFilter(
  model: NonlinearModel,
  observations: Observation[],
  options: NonlinearOptions & UnscentedParameters = {},
): NonlinearFilterResult {
  const it = unscentedKalmanSteps(model, observations, options);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

function missingStep(predMean: Vec, predCov: Mat): FilterStep {
  return {
    predictedMean: predMean,
    predictedCov: predCov,
    filteredMean: predMean.slice(),
    filteredCov: cloneMat(predCov),
    observationPredMean: null,
    observationPredCov: null,
    innovation: null,
    innovationCov: null,
    standardisedInnovation: null,
    gain: null,
    logLikelihoodTerm: 0,
    missing: true,
  };
}
