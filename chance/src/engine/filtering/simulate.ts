/**
 * Simulating from a state-space model, so that a filter can be checked against
 * a known truth. This is the only way covariance calibration can be tested at
 * all: a filter with a wrong covariance still produces plausible means.
 */
import { EngineError } from '../core/result';
import type { Random } from '../random/rng';
import { addVec, matVec, psdCholesky, sampleMvn, symmetrise, type Mat, type Vec } from './matrix';
import { accessModel } from './kalman';
import type { LinearGaussianModel, NonlinearModel, Observation } from './types';

export interface SimulatedSeries {
  /** True states x_1..x_T. */
  states: Vec[];
  /** Observations y_1..y_T, in the form the filters accept. */
  observations: Observation[];
  /** The raw observation values, without the null wrapper. */
  values: Vec[];
}

/** Draw a path and its measurements from a linear-Gaussian model. */
export function simulateLinearGaussian(
  model: LinearGaussianModel,
  T: number,
  rng: Random,
  options: { controls?: Vec[] } = {},
): SimulatedSeries {
  if (!Number.isInteger(T) || T < 1) throw new EngineError(`The number of steps must be a whole number of at least 1; received ${T}.`, 'range');
  const acc = accessModel(model, T);
  const normal = () => rng.normal();
  const l0 = psdCholesky(symmetrise(model.Sigma0), 'Sigma0');
  let x = sampleMvn(model.mu0, l0, normal);
  const states: Vec[] = [];
  const values: Vec[] = [];
  const observations: Observation[] = [];
  for (let t = 0; t < T; t++) {
    const A = acc.A(t);
    const Q = acc.Q(t);
    const C = acc.C(t);
    const R = acc.R(t);
    const lq = psdCholesky(Q, `Q at time ${t}`);
    const lr = psdCholesky(R, `R at time ${t}`);
    let mean = matVec(A, x);
    const B = acc.B(t);
    if (B !== null && options.controls) mean = addVec(mean, matVec(B, options.controls[t]));
    x = sampleMvn(mean, lq, normal);
    const y = sampleMvn(matVec(C, x), lr, normal);
    states.push(x.slice());
    values.push(y);
    observations.push(y.slice());
  }
  return { states, observations, values };
}

/** Draw a path and its measurements from a non-linear additive-noise model. */
export function simulateNonlinear(model: NonlinearModel, T: number, rng: Random): SimulatedSeries {
  if (!Number.isInteger(T) || T < 1) throw new EngineError(`The number of steps must be a whole number of at least 1; received ${T}.`, 'range');
  const normal = () => rng.normal();
  const Q = pickConst(model.Q, 'Q');
  const R = pickConst(model.R, 'R');
  const lq = psdCholesky(Q, 'Q');
  const lr = psdCholesky(R, 'R');
  let x = sampleMvn(model.mu0, psdCholesky(symmetrise(model.Sigma0), 'Sigma0'), normal);
  const states: Vec[] = [];
  const values: Vec[] = [];
  const observations: Observation[] = [];
  for (let t = 0; t < T; t++) {
    x = sampleMvn(model.f(x, t), lq, normal);
    const y = sampleMvn(model.h(x, t), lr, normal);
    states.push(x.slice());
    values.push(y);
    observations.push(y.slice());
  }
  return { states, observations, values };
}

function pickConst(mat: Mat | Mat[], name: string): Mat {
  if (Array.isArray(mat) && Array.isArray(mat[0]) && Array.isArray((mat as Mat[])[0][0])) {
    throw new EngineError(`${name} must be constant for this simulation helper; a time-varying sequence was supplied.`, 'invalid');
  }
  return mat as Mat;
}
