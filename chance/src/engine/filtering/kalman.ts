/**
 * The linear-Gaussian Kalman filter, its smoother, the exact likelihood, and
 * the structural questions that decide whether the filter means anything.
 *
 * EXACTNESS. For a linear model with Gaussian noise the filtered and smoothed
 * distributions are Gaussian in closed form, and the recursions below evaluate
 * those closed forms. The results are therefore labelled `exact` (up to
 * floating point), not `numerical`.
 *
 * WHICH COVARIANCE FORM IS THE DEFAULT, AND WHY. The textbook update
 * P = (I − K C) P is the cheapest and the worst. It is not symmetric in
 * floating point, and the subtraction cancels: with a small measurement noise
 * or a nearly singular prior, the result acquires a negative eigenvalue after
 * a few hundred steps. Nothing announces this. The filter keeps running, the
 * gains go wrong, the intervals shrink to nothing, and the means still look
 * plausible — the exact failure mode this project forbids.
 *
 * The default here is therefore the JOSEPH form,
 *
 *     P = (I − K C) P (I − K C)ᵀ + K R Kᵀ,
 *
 * which is a sum of two positive semi-definite congruences and so is symmetric
 * PSD for any K whatsoever, including a K spoiled by rounding. It costs one
 * extra n×n product per step. A full SQUARE-ROOT filter ('sqrt') is also
 * provided: it propagates a triangular factor U with P = U Uᵀ, using a
 * Householder QR for the prediction and Potter's rank-one update for each
 * whitened measurement, so P is never formed as a difference at all. It is the
 * most robust and about twice the cost; choose it when the measurement noise
 * is many orders of magnitude below the state variance.
 *
 * Regardless of the form, the updated covariance is Cholesky-tested every
 * step. If positive definiteness has been lost the run is REFUSED with the
 * failing pivot and the smallest eigenvalue named, rather than continued.
 */
import { EngineError, type Explanation } from '../core/result';
import {
  addVec,
  backSubstitute,
  choleskyOrThrow,
  cloneMat,
  cols,
  dot,
  forwardSubstitute,
  hstack,
  identity,
  inverseSPD,
  matAdd,
  matMul,
  matSub,
  matVec,
  matrixRank,
  psdCholesky,
  qrR,
  rows,
  solveSPDMat,
  subVec,
  symmetrise,
  symmetricEigenvalues,
  transpose,
  vstack,
  zeros,
  type Mat,
  type Vec,
} from './matrix';
import {
  explainFiltering,
  type CovarianceForm,
  type FilterProgress,
  type FilterStep,
  type KalmanFilterResult,
  type KalmanSmootherResult,
  type LinearGaussianModel,
  type Observation,
  type RunControl,
  type SteadyStateResult,
  type StructuralResult,
  type TimeVarying,
} from './types';

const LOG_2PI = Math.log(2 * Math.PI);

export interface KalmanOptions extends RunControl {
  form?: CovarianceForm;
  /** Control inputs u_t, one per time step, when the model has B. */
  controls?: Vec[];
}

/** Resolved, shape-checked access to a model's matrices at a given time. */
export interface ModelAccess {
  n: number;
  m: number;
  A(t: number): Mat;
  C(t: number): Mat;
  Q(t: number): Mat;
  R(t: number): Mat;
  B(t: number): Mat | null;
  timeVarying: boolean;
}

function pick(mat: TimeVarying, t: number, name: string, T: number): Mat {
  if (Array.isArray(mat) && Array.isArray(mat[0]) && Array.isArray((mat as Mat[])[0][0])) {
    const seq = mat as unknown as Mat[];
    if (seq.length < T) {
      throw new EngineError(
        `${name} was supplied as a time-varying sequence of ${seq.length} matrices but the series has ${T} steps.`,
        'shape',
      );
    }
    return seq[t];
  }
  return mat as Mat;
}

function isSequence(mat: TimeVarying): boolean {
  return Array.isArray(mat) && Array.isArray(mat[0]) && Array.isArray((mat as unknown as Mat[])[0][0]);
}

function checkFinite(a: Mat, name: string): void {
  for (let i = 0; i < rows(a); i++) {
    for (let j = 0; j < cols(a); j++) {
      if (!Number.isFinite(a[i][j])) {
        throw new EngineError(`${name} contains a non-finite entry at [${i}][${j}] (${a[i][j]}).`, 'finite');
      }
    }
  }
}

/**
 * Validate a linear-Gaussian model and return time-indexed access to it.
 * Every dimension failure names the OFFENDING PAIR, because "dimension
 * mismatch" on its own tells the caller nothing about which matrix to fix.
 */
export function accessModel(model: LinearGaussianModel, T: number): ModelAccess {
  const A0 = pick(model.A, 0, 'A', Math.max(T, 1));
  const C0 = pick(model.C, 0, 'C', Math.max(T, 1));
  const Q0 = pick(model.Q, 0, 'Q', Math.max(T, 1));
  const R0 = pick(model.R, 0, 'R', Math.max(T, 1));
  const n = rows(A0);
  if (n === 0) throw new EngineError('The state transition matrix A is empty, so there is no state to filter.', 'shape');
  if (cols(A0) !== n) throw new EngineError(`A must be square; it is ${n}×${cols(A0)}.`, 'shape');
  const m = rows(C0);
  if (m === 0) throw new EngineError('The observation matrix C has no rows, so nothing is measured.', 'shape');
  if (cols(C0) !== n) {
    throw new EngineError(
      `C and A disagree on the state dimension: C is ${m}×${cols(C0)} but A is ${n}×${n}, ` +
        `so C must have ${n} columns.`,
      'shape',
    );
  }
  if (rows(Q0) !== n || cols(Q0) !== n) {
    throw new EngineError(
      `Q and A disagree: the process-noise covariance is ${rows(Q0)}×${cols(Q0)} but A is ${n}×${n}, ` +
        `so Q must be ${n}×${n}.`,
      'shape',
    );
  }
  if (rows(R0) !== m || cols(R0) !== m) {
    throw new EngineError(
      `R and C disagree: the measurement-noise covariance is ${rows(R0)}×${cols(R0)} but C has ${m} rows, ` +
        `so R must be ${m}×${m}.`,
      'shape',
    );
  }
  if (model.mu0.length !== n) {
    throw new EngineError(
      `The prior mean mu0 has ${model.mu0.length} components but A is ${n}×${n}, so mu0 must have ${n}.`,
      'shape',
    );
  }
  if (rows(model.Sigma0) !== n || cols(model.Sigma0) !== n) {
    throw new EngineError(
      `The prior covariance Sigma0 is ${rows(model.Sigma0)}×${cols(model.Sigma0)} but A is ${n}×${n}, ` +
        `so Sigma0 must be ${n}×${n}.`,
      'shape',
    );
  }
  const B0 = model.B === undefined ? null : pick(model.B, 0, 'B', Math.max(T, 1));
  if (B0 !== null && rows(B0) !== n) {
    throw new EngineError(`B and A disagree: B is ${rows(B0)}×${cols(B0)} but A is ${n}×${n}, so B must have ${n} rows.`, 'shape');
  }
  for (const [mat, name] of [
    [A0, 'A'],
    [C0, 'C'],
    [Q0, 'Q'],
    [R0, 'R'],
    [model.Sigma0, 'Sigma0'],
  ] as [Mat, string][]) {
    checkFinite(mat, name);
  }
  model.mu0.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new EngineError(`mu0 component ${i} is not finite (${v}).`, 'finite');
  });
  // Q and R must be genuine covariances. Q may be singular; R may not, because
  // the innovation covariance C P Cᵀ + R has to be invertible.
  psdCholesky(Q0, 'The process-noise covariance Q');
  choleskyOrThrow(R0, 'The measurement-noise covariance R');
  psdCholesky(model.Sigma0, 'The prior covariance Sigma0');

  const Tsafe = Math.max(T, 1);
  const varying = isSequence(model.A) || isSequence(model.C) || isSequence(model.Q) || isSequence(model.R);
  return {
    n,
    m,
    timeVarying: varying,
    A: (t) => pick(model.A, t, 'A', Tsafe),
    C: (t) => pick(model.C, t, 'C', Tsafe),
    Q: (t) => pick(model.Q, t, 'Q', Tsafe),
    R: (t) => pick(model.R, t, 'R', Tsafe),
    B: (t) => (model.B === undefined ? null : pick(model.B, t, 'B', Tsafe)),
  };
}

interface SelectedObservation {
  indices: number[];
  values: Vec;
}

function selectObservation(obs: Observation, t: number, m: number): SelectedObservation {
  if (obs === null) return { indices: [], values: [] };
  if (obs.length !== m) {
    throw new EngineError(
      `Observation ${t} has ${obs.length} components but C has ${m} rows, so it must have ${m}.`,
      'shape',
    );
  }
  const indices: number[] = [];
  const values: number[] = [];
  for (let j = 0; j < m; j++) {
    const v = obs[j];
    if (v === null || v === undefined) continue;
    if (!Number.isFinite(v)) {
      throw new EngineError(
        `Observation ${t}, component ${j} is ${v}, which is not a finite number. ` +
          'Mark a missing measurement as null — it is then skipped properly — rather than passing NaN or Infinity, ' +
          'which would silently poison every later state estimate.',
        'finite',
      );
    }
    indices.push(j);
    values.push(v);
  }
  return { indices, values };
}

function subRows(a: Mat, idx: number[]): Mat {
  return idx.map((i) => [...a[i]]);
}

function subSquare(a: Mat, idx: number[]): Mat {
  return idx.map((i) => idx.map((j) => a[i][j]));
}

/**
 * Drive the Kalman filter chunk by chunk.
 *
 * Exposed as a generator, matching `simulationSteps` in
 * `simulation/runner.ts`: a worker executing a long synchronous loop can never
 * receive a `cancel` message, so the loop yields between chunks and the caller
 * decides when the next one runs. A cancelled run returns what it has with
 * `partial: true`; it never pads the remainder with made-up states.
 */
export function* kalmanFilterSteps(
  model: LinearGaussianModel,
  observations: Observation[],
  options: KalmanOptions = {},
): Generator<FilterProgress, KalmanFilterResult, void> {
  const T = observations.length;
  if (T === 0) {
    throw new EngineError('A filter needs at least one time step; the observation sequence is empty.', 'required');
  }
  const acc = accessModel(model, T);
  const form: CovarianceForm = options.form ?? 'joseph';
  const chunk = Math.max(1, options.chunk ?? 256);
  const controls = options.controls;
  if (model.B !== undefined && controls === undefined) {
    throw new EngineError(
      'The model has a control gain B but no control inputs were supplied, so B x u cannot be evaluated.',
      'required',
    );
  }
  if (controls !== undefined && controls.length < T) {
    throw new EngineError(`Only ${controls.length} control inputs were supplied for ${T} time steps.`, 'shape');
  }

  const { n } = acc;
  const warnings: string[] = [];
  const steps: FilterStep[] = [];
  let mean = model.mu0.slice();
  let cov = symmetrise(model.Sigma0);
  // Square-root form carries a triangular factor instead of the covariance.
  let factor: Mat | null = form === 'sqrt' ? transpose(qrR(transpose(psdCholesky(cov, 'Sigma0')))) : null;
  let logLikelihood = 0;
  let observedCount = 0;
  let partial = false;
  let t = 0;

  while (t < T) {
    const stop = Math.min(T, t + chunk);
    for (; t < stop; t++) {
      const A = acc.A(t);
      const C = acc.C(t);
      const Q = acc.Q(t);
      const R = acc.R(t);
      if (acc.timeVarying) {
        if (rows(A) !== n || cols(A) !== n) throw new EngineError(`A at time ${t} is ${rows(A)}×${cols(A)}; it must be ${n}×${n}.`, 'shape');
        if (cols(C) !== n) throw new EngineError(`C at time ${t} has ${cols(C)} columns; it must have ${n}.`, 'shape');
        if (rows(R) !== rows(C)) throw new EngineError(`R at time ${t} is ${rows(R)}×${cols(R)} but C has ${rows(C)} rows.`, 'shape');
      }

      // ---- predict ----
      let predMean = matVec(A, mean);
      const B = acc.B(t);
      if (B !== null && controls !== undefined) {
        const u = controls[t];
        if (u.length !== cols(B)) {
          throw new EngineError(`Control input ${t} has ${u.length} components but B has ${cols(B)} columns.`, 'shape');
        }
        predMean = addVec(predMean, matVec(B, u));
      }
      let predCov: Mat;
      if (form === 'sqrt' && factor !== null) {
        // [ (A U)ᵀ ; Lqᵀ ] → QR → R, with Uₚ = Rᵀ and P = Uₚ Uₚᵀ.
        const au = matMul(A, factor);
        const lq = psdCholesky(Q, `Q at time ${t}`);
        const stacked = vstack([transpose(au), transpose(lq)]);
        factor = transpose(qrR(stacked));
        predCov = symmetrise(matMul(factor, transpose(factor)));
      } else {
        predCov = symmetrise(matAdd(matMul(matMul(A, cov), transpose(A)), Q));
      }

      const sel = selectObservation(observations[t], t, rows(C));
      if (sel.indices.length === 0) {
        // Missing observation: keep the prediction, skip the update. Nothing is
        // imputed, and no likelihood term is contributed.
        mean = predMean;
        cov = predCov;
        steps.push({
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
        });
        continue;
      }

      const Cs = subRows(C, sel.indices);
      const Rs = subSquare(R, sel.indices);
      const k = sel.indices.length;
      const CP = matMul(Cs, predCov); // k×n
      const S = symmetrise(matAdd(matMul(CP, transpose(Cs)), Rs));
      const Sl = choleskyOrThrow(S, `The innovation covariance at time ${t}`);
      const obsPredMean = matVec(Cs, predMean);
      const innovation = subVec(sel.values, obsPredMean);
      const K = transpose(solveSPDMat(S, CP, `The innovation covariance at time ${t}`)); // n×k
      const z = forwardSubstitute(Sl, innovation);
      let logDetS = 0;
      for (let i = 0; i < k; i++) logDetS += Math.log(Sl[i][i]);
      const term = -0.5 * (k * LOG_2PI + 2 * logDetS + dot(z, z));
      logLikelihood += term;
      observedCount += k;

      mean = addVec(predMean, matVec(K, innovation));

      if (form === 'sqrt' && factor !== null) {
        // Whiten the measurement so the noise is the identity, then apply
        // Potter's rank-one square-root update once per scalar measurement.
        const Lr = choleskyOrThrow(Rs, `R at time ${t}`);
        let u = factor;
        let xm = predMean.slice();
        const rowsWhite: Mat = [];
        const yWhite: number[] = [];
        for (let i = 0; i < k; i++) {
          const ei = new Array<number>(k).fill(0);
          ei[i] = 1;
          // eᵢᵀ Lr⁻¹ = (Lr⁻ᵀ eᵢ)ᵀ
          const w = backSubstitute(Lr, ei);
          const rowW = new Array<number>(n).fill(0);
          for (let p = 0; p < k; p++) {
            if (w[p] === 0) continue;
            for (let j = 0; j < n; j++) rowW[j] += w[p] * Cs[p][j];
          }
          rowsWhite.push(rowW);
          yWhite.push(dot(w, sel.values));
        }
        for (let i = 0; i < k; i++) {
          const c = rowsWhite[i];
          const phi = matVec(transpose(u), c); // n-vector
          const alpha = 1 / (dot(phi, phi) + 1);
          const gamma = 1 / (1 + Math.sqrt(alpha));
          const uphi = matVec(u, phi);
          const gain = uphi.map((v) => alpha * v);
          const next = zeros(n, n);
          for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) next[r][cc] = u[r][cc] - gamma * gain[r] * phi[cc];
          u = next;
          const resid = yWhite[i] - dot(c, xm);
          xm = addVec(xm, gain.map((v) => v * resid));
        }
        factor = u;
        mean = xm;
        cov = symmetrise(matMul(u, transpose(u)));
      } else if (form === 'joseph') {
        const ImKC = matSub(identity(n), matMul(K, Cs));
        cov = symmetrise(matAdd(matMul(matMul(ImKC, predCov), transpose(ImKC)), matMul(matMul(K, Rs), transpose(K))));
      } else {
        // Naive short form, kept only so its failure can be demonstrated.
        cov = matMul(matSub(identity(n), matMul(K, Cs)), predCov);
      }

      // Positive definiteness is checked every step. Losing it is the silent
      // failure this filter must never pass on.
      assertCovariance(cov, t, form);

      steps.push({
        predictedMean: predMean,
        predictedCov: predCov,
        filteredMean: mean.slice(),
        filteredCov: cloneMat(cov),
        observationPredMean: obsPredMean,
        observationPredCov: cloneMat(S),
        innovation,
        innovationCov: cloneMat(S),
        standardisedInnovation: z,
        gain: K,
        logLikelihoodTerm: term,
        missing: false,
      });
    }
    if (t < T) {
      yield { completed: t, total: T };
      if (options.isCancelled?.()) {
        partial = true;
        warnings.push(
          `The run was cancelled after ${t} of ${T} steps. The results cover those steps only; ` +
            'the remaining states were not estimated and have not been filled in.',
        );
        break;
      }
    } else {
      yield { completed: t, total: T };
    }
  }

  const missingCount = steps.filter((s) => s.missing).length;
  if (missingCount > 0) {
    warnings.push(
      `${missingCount} of ${steps.length} time steps had no usable measurement. The prediction was carried forward ` +
        'unchanged at those steps and the state uncertainty grew; nothing was imputed.',
    );
  }

  return {
    steps,
    logLikelihood,
    observedCount,
    form,
    stateDim: n,
    obsDim: acc.m,
    exactness: 'exact',
    explanation: filterExplanation(form, steps.length, missingCount, logLikelihood, partial),
    warnings,
    partial,
  };
}

/**
 * Reject a covariance that has acquired a NEGATIVE direction.
 *
 * The criterion is negativity, not near-singularity. A filtered covariance can
 * legitimately be almost singular — measure the sum of two states with tiny
 * noise and the sum's variance really is tiny next to the difference's — and
 * refusing that would be refusing a correct answer. What cannot happen is a
 * negative variance in some direction, which is precisely what the naive
 * short-form update produces once cancellation bites.
 */
function assertCovariance(cov: Mat, t: number, form: CovarianceForm): void {
  const sym = symmetrise(cov);
  let scale = 0;
  for (let i = 0; i < rows(sym); i++) scale = Math.max(scale, Math.abs(sym[i][i]));
  const tol = scale > 0 ? 1e-11 * rows(sym) * scale : 0;
  let failing = -1;
  let failingValue = 0;
  try {
    psdCholesky(sym, 'covariance');
  } catch {
    failing = -2;
  }
  const eigs = symmetricEigenvalues(sym);
  if (eigs[0] >= -tol && failing !== -2) return;
  for (let i = 0; i < rows(sym); i++) {
    if (sym[i][i] < -tol) {
      failing = i;
      failingValue = sym[i][i];
      break;
    }
  }
  throw new EngineError(
    `The filtered state covariance stopped being positive definite at time ${t} using the '${form}' update: ` +
      `its smallest eigenvalue is ${eigs[0].toExponential(3)}` +
      (failing >= 0 ? `, and diagonal entry ${failing} is ${failingValue.toExponential(3)}` : '') +
      '. A negative variance in some direction makes every gain, interval and likelihood computed from here on ' +
      'meaningless, so the run is refused. ' +
      (form === 'naive'
        ? "Use the default 'joseph' form, or 'sqrt' when the measurement noise is far below the state variance."
        : 'Try form: "sqrt", or check that R is not far smaller than the numerical scale of the state.'),
    'not-positive-definite',
  );
}

function filterExplanation(
  form: CovarianceForm,
  T: number,
  missing: number,
  loglik: number,
  partial: boolean,
): Explanation {
  const formNote =
    form === 'joseph'
      ? 'Joseph form P = (I−KC)P(I−KC)ᵀ + KRKᵀ — symmetric and positive semi-definite for any gain.'
      : form === 'sqrt'
        ? 'Square-root filter: a triangular factor U with P = UUᵀ is propagated, so P is never formed as a difference.'
        : 'Naive short form P = (I−KC)P — provided for comparison only; it can lose positive definiteness.';
  return explainFiltering(
    'Kalman filter (prediction-error decomposition)',
    'exact',
    [
      { label: 'Steps filtered', value: String(T) },
      { label: 'Steps with no measurement', value: String(missing) },
      { label: 'Covariance update', value: formNote },
      { label: 'Log-likelihood', expression: 'Σ log N(y_t | C x_{t|t−1}, S_t)', value: loglik.toFixed(6) },
    ],
    [
      'The dynamics are linear and the process and measurement noise are Gaussian, independent of each other and across time.',
      'The model matrices A, B, C, Q, R and the prior are taken as given, not estimated.',
    ],
    [
      'The filtered covariance is the uncertainty in the STATE. The spread of future observations is wider by R and is reported separately as the predictive observation covariance.',
      'A misspecified model still produces confident-looking estimates; check the innovation whiteness diagnostic before trusting them.',
      ...(partial ? ['The run was cancelled early, so these results are partial.'] : []),
    ],
    'x_t = A x_{t−1} + B u_t + w_t,  y_t = C x_t + v_t',
  );
}

/** Run the filter to completion. */
export function kalmanFilter(
  model: LinearGaussianModel,
  observations: Observation[],
  options: KalmanOptions = {},
): KalmanFilterResult {
  const it = kalmanFilterSteps(model, observations, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/** The exact log-likelihood on its own. */
export function kalmanLogLikelihood(
  model: LinearGaussianModel,
  observations: Observation[],
  options: KalmanOptions = {},
): number {
  return kalmanFilter(model, observations, options).logLikelihood;
}

/**
 * Rauch-Tung-Striebel smoother, plus the lag-one smoothed covariance
 * Cov(x_t, x_{t−1} | y_{1..T}) that EM's M-step needs.
 *
 * The lag-one term is computed from the recursion
 *   Cov(x_t, x_{t−1}) = P_{t|t} J_{t−1}ᵀ + J_t (Cov(x_{t+1}, x_t) − A P_{t|t}) J_{t−1}ᵀ,
 * which is the standard result and avoids forming any joint covariance.
 */
export function* kalmanSmootherSteps(
  model: LinearGaussianModel,
  observations: Observation[],
  options: KalmanOptions = {},
): Generator<FilterProgress, KalmanSmootherResult, void> {
  const fwdIt = kalmanFilterSteps(model, observations, options);
  let fwd = fwdIt.next();
  while (!fwd.done) {
    yield fwd.value;
    fwd = fwdIt.next();
  }
  const filtered = fwd.value;
  const T = filtered.steps.length;
  if (T === 0) throw new EngineError('The smoother needs at least one filtered step.', 'required');
  const acc = accessModel(model, Math.max(observations.length, 1));
  const n = acc.n;
  const warnings = [...filtered.warnings];

  const sMean: Vec[] = new Array<Vec>(T);
  const sCov: Mat[] = new Array<Mat>(T);
  const gains: Mat[] = new Array<Mat>(T);
  sMean[T - 1] = filtered.steps[T - 1].filteredMean.slice();
  sCov[T - 1] = cloneMat(filtered.steps[T - 1].filteredCov);

  for (let t = T - 2; t >= 0; t--) {
    const A = acc.A(t + 1);
    const Pf = filtered.steps[t].filteredCov;
    const Pp = filtered.steps[t + 1].predictedCov;
    // J_t = P_{t|t} Aᵀ P_{t+1|t}⁻¹, solved rather than inverted where possible.
    const J = transpose(solveSPDMat(Pp, matMul(A, Pf), `The predicted covariance at time ${t + 1}`));
    gains[t] = J;
    sMean[t] = addVec(filtered.steps[t].filteredMean, matVec(J, subVec(sMean[t + 1], filtered.steps[t + 1].predictedMean)));
    sCov[t] = symmetrise(matAdd(Pf, matMul(matMul(J, matSub(sCov[t + 1], Pp)), transpose(J))));
    choleskyOrThrow(sCov[t], `The smoothed covariance at time ${t}`);
  }

  // Smoothed initial state, needed by EM for mu0 and Sigma0.
  const A0 = acc.A(0);
  const J0 = transpose(solveSPDMat(filtered.steps[0].predictedCov, matMul(A0, symmetrise(model.Sigma0)), 'The predicted covariance at time 0'));
  gains[T - 1] = identity(n);
  const initialMean = addVec(model.mu0, matVec(J0, subVec(sMean[0], filtered.steps[0].predictedMean)));
  const initialCov = symmetrise(
    matAdd(symmetrise(model.Sigma0), matMul(matMul(J0, matSub(sCov[0], filtered.steps[0].predictedCov)), transpose(J0))),
  );

  // Lag-one covariances. lagOneCov[t] = Cov(x_t, x_{t−1} | y), for t = 1..T−1,
  // stored at index t; index 0 holds Cov(x_0, x_{−1}) = Cov(x_0, initial state).
  const lagOne: Mat[] = new Array<Mat>(T);
  const KT = filtered.steps[T - 1].gain;
  const CT = acc.C(T - 1);
  const ImKC = KT === null ? identity(n) : matSub(identity(n), matMul(KT, selMatrixRows(CT, filtered.steps[T - 1])));
  if (T >= 2) {
    lagOne[T - 1] = symmetriseCross(matMul(matMul(ImKC, acc.A(T - 1)), filtered.steps[T - 2].filteredCov));
    for (let t = T - 2; t >= 1; t--) {
      const Jt = gains[t];
      const Jprev = gains[t - 1];
      const A = acc.A(t + 1);
      const inner = matSub(lagOne[t + 1], matMul(A, filtered.steps[t].filteredCov));
      lagOne[t] = matAdd(matMul(filtered.steps[t].filteredCov, transpose(Jprev)), matMul(matMul(Jt, inner), transpose(Jprev)));
    }
  }
  lagOne[0] = matMul(sCov[0], transpose(J0));

  return {
    smoothedMean: sMean,
    smoothedCov: sCov,
    lagOneCov: lagOne,
    gains,
    initialMean,
    initialCov,
    logLikelihood: filtered.logLikelihood,
    exactness: 'exact',
    explanation: explainFiltering(
      'Rauch-Tung-Striebel smoother',
      'exact',
      [
        { label: 'Steps smoothed', value: String(T) },
        { label: 'Backward gain', expression: 'J_t = P_{t|t} Aᵀ P_{t+1|t}⁻¹' },
        { label: 'Smoothed mean', expression: 'x_{t|T} = x_{t|t} + J_t (x_{t+1|T} − x_{t+1|t})' },
      ],
      ['The same linear-Gaussian assumptions as the filter.'],
      [
        'A smoothed estimate uses measurements from AFTER time t. It is not available in real time and is not comparable with a filtered estimate for forecasting.',
        'The smoothed covariance is the uncertainty in the state given the whole series, and is smaller than the filtered one.',
      ],
    ),
    warnings,
    partial: filtered.partial,
  };
}

function selMatrixRows(c: Mat, step: FilterStep): Mat {
  // The final step's gain has as many columns as there were usable channels.
  const k = step.gain === null ? rows(c) : cols(step.gain);
  return c.slice(0, k).map((r) => [...r]);
}

function symmetriseCross(a: Mat): Mat {
  return a.map((r) => [...r]);
}

export function kalmanSmoother(
  model: LinearGaussianModel,
  observations: Observation[],
  options: KalmanOptions = {},
): KalmanSmootherResult {
  const it = kalmanSmootherSteps(model, observations, options);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

/**
 * Observability and controllability.
 *
 * A state direction that does not appear in any measurement, directly or
 * through the dynamics, is never estimated: the filter reports a covariance
 * for it that simply reflects the prior and the process noise, and a user
 * reading that number believes something has been learned. So the test is
 * mandatory before asking for a steady-state gain, and the answer is reported
 * even when it is fine.
 *
 * Observability: rank [C; CA; …; CA^{n−1}] = n (Kalman's rank condition).
 * Controllability (of the noise): rank [G; AG; …; A^{n−1}G] = n with Q = GGᵀ.
 * An uncontrollable-but-stable direction is harmless; an unobservable one is not.
 */
export function structuralAnalysis(model: LinearGaussianModel, options: { inputs?: Mat } = {}): StructuralResult {
  const acc = accessModel(model, 1);
  const n = acc.n;
  const A = acc.A(0);
  const C = acc.C(0);
  const obsBlocks: Mat[] = [];
  let power = identity(n);
  for (let i = 0; i < n; i++) {
    obsBlocks.push(matMul(C, power));
    power = matMul(power, A);
  }
  const observabilityRank = matrixRank(vstack(obsBlocks));
  const G = options.inputs ?? psdCholesky(acc.Q(0), 'Q');
  const ctrlBlocks: Mat[] = [];
  power = identity(n);
  for (let i = 0; i < n; i++) {
    ctrlBlocks.push(matMul(power, G));
    power = matMul(power, A);
  }
  const controllabilityRank = matrixRank(hstack(ctrlBlocks));
  const observable = observabilityRank === n;
  const warnings: string[] = [];
  if (!observable) {
    warnings.push(
      `The state is NOT observable: the observability matrix has rank ${observabilityRank} out of ${n}, so ` +
        `${n - observabilityRank} state direction(s) never influence any measurement. Estimates and intervals for ` +
        'those directions reflect the prior and the process noise only — no information about them is being gathered.',
    );
  }
  if (controllabilityRank < n) {
    warnings.push(
      `The process noise does not excite the whole state space (rank ${controllabilityRank} of ${n}). ` +
        'This is not an error, but the steady-state covariance may be singular in the unexcited directions.',
    );
  }
  return {
    observabilityRank,
    observable,
    controllabilityRank,
    controllable: controllabilityRank === n,
    stateDim: n,
    unobservableDimensions: n - observabilityRank,
    explanation: explainFiltering(
      'Kalman rank conditions',
      'exact',
      [
        { label: 'Observability matrix rank', expression: 'rank [C; CA; …; CA^{n−1}]', value: `${observabilityRank} of ${n}` },
        { label: 'Controllability matrix rank', expression: 'rank [G; AG; …; A^{n−1}G], Q = GGᵀ', value: `${controllabilityRank} of ${n}` },
      ],
      ['The model matrices are time-invariant for the purpose of this test.'],
      [
        'The rank test is a yes/no answer at the numerical tolerance used; a nearly-unobservable system passes it and is still estimated very poorly.',
      ],
    ),
    warnings,
  };
}

/**
 * Steady-state (asymptotic) gain, by solving the discrete algebraic Riccati
 * equation
 *
 *   P = A P Aᵀ + Q − A P Cᵀ (C P Cᵀ + R)⁻¹ C P Aᵀ
 *
 * by the iteration from P = Sigma0, which converges to the stabilising
 * solution whenever the system is detectable. The iteration is the honest
 * choice here: a structure-preserving doubling scheme is faster but harder to
 * verify, and this is not in an inner loop.
 *
 * REFUSES on an unobservable state. The asymptotic covariance in an
 * unobservable direction does not converge to anything the gain can use, and
 * reporting a gain for it would be a plausible number with no meaning.
 */
export function steadyStateGain(
  model: LinearGaussianModel,
  options: { tolerance?: number; maxIterations?: number } = {},
): SteadyStateResult {
  const structural = structuralAnalysis(model);
  if (!structural.observable) {
    throw new EngineError(
      `A steady-state Kalman gain was requested for a state that is not observable: the observability matrix has ` +
        `rank ${structural.observabilityRank} of ${structural.stateDim}. ${structural.stateDim - structural.observabilityRank} ` +
        'state direction(s) are invisible to the measurements, so no asymptotic gain exists for them and the ' +
        'Riccati iteration would either diverge or converge to a value that says nothing. Reduce the state, or add a ' +
        'measurement that sees the missing direction.',
      'unobservable',
    );
  }
  const acc = accessModel(model, 1);
  if (acc.timeVarying) {
    throw new EngineError(
      'A steady-state gain is only defined for a time-invariant model, but A, C, Q or R was supplied as a ' +
        'time-varying sequence. Filter the series directly instead.',
      'invalid',
    );
  }
  const A = acc.A(0);
  const C = acc.C(0);
  const Q = acc.Q(0);
  const R = acc.R(0);
  const n = acc.n;
  const tol = options.tolerance ?? 1e-13;
  const maxIter = options.maxIterations ?? 20000;
  let P = symmetrise(model.Sigma0);
  let residual = Infinity;
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const CP = matMul(C, P);
    const S = symmetrise(matAdd(matMul(CP, transpose(C)), R));
    const K = transpose(solveSPDMat(S, CP, 'The steady-state innovation covariance'));
    const ImKC = matSub(identity(n), matMul(K, C));
    const Pf = symmetrise(matAdd(matMul(matMul(ImKC, P), transpose(ImKC)), matMul(matMul(K, R), transpose(K))));
    const next = symmetrise(matAdd(matMul(matMul(A, Pf), transpose(A)), Q));
    residual = 0;
    const scale = Math.max(1e-300, maxAbs(next));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) residual = Math.max(residual, Math.abs(next[i][j] - P[i][j]));
    P = next;
    if (residual / scale < tol) {
      iterations++;
      break;
    }
  }
  const scale = Math.max(1e-300, maxAbs(P));
  if (!(residual / scale < tol)) {
    throw new EngineError(
      `The Riccati iteration for the steady-state gain did not converge in ${maxIter} iterations; the last change ` +
        `was ${residual.toExponential(3)} against a matrix scale of ${scale.toExponential(3)}. No steady-state gain is ` +
        'reported, because a non-converged iterate is not a solution. Check that A has no unstable unobservable modes.',
      'no-convergence',
    );
  }
  const CP = matMul(C, P);
  const S = symmetrise(matAdd(matMul(CP, transpose(C)), R));
  const K = transpose(solveSPDMat(S, CP, 'The steady-state innovation covariance'));
  const ImKC = matSub(identity(n), matMul(K, C));
  const Pf = symmetrise(matAdd(matMul(matMul(ImKC, P), transpose(ImKC)), matMul(matMul(K, R), transpose(K))));
  return {
    predictedCov: P,
    filteredCov: Pf,
    gain: K,
    innovationCov: S,
    iterations,
    residual,
    exactness: 'numerical',
    explanation: explainFiltering(
      'Discrete algebraic Riccati equation (fixed-point iteration)',
      'numerical',
      [
        { label: 'Iterations to convergence', value: String(iterations) },
        { label: 'Final change in P', value: residual.toExponential(3) },
        { label: 'Riccati equation', expression: 'P = A P Aᵀ + Q − A P Cᵀ (C P Cᵀ + R)⁻¹ C P Aᵀ' },
      ],
      ['The model is time-invariant and the state is observable (checked, not assumed).'],
      [
        'This is the asymptotic covariance. A filter started from a different prior takes a transient to reach it, and the early steps are genuinely more uncertain than this value says.',
        'Converged to a fixed point of the iteration, so the value is numerical rather than closed-form.',
      ],
    ),
    warnings: structural.warnings,
  };
}

function maxAbs(a: Mat): number {
  let s = 0;
  for (const row of a) for (const v of row) s = Math.max(s, Math.abs(v));
  return s;
}

/** The information-form inverse of a covariance, exposed for callers that need it. */
export function informationMatrix(cov: Mat): Mat {
  return inverseSPD(cov, 'The covariance');
}
