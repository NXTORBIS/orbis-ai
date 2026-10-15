/**
 * Gaussian-process classification by the Laplace approximation.
 *
 * With a Bernoulli–logistic likelihood the posterior over the latent function
 * is no longer Gaussian, so there is no exact conditional to report. The
 * Laplace approximation replaces it by the Gaussian centred at the posterior
 * mode with the curvature of the log posterior there. Implemented as
 * Rasmussen & Williams (2006) Algorithm 3.1, which is organised so that only
 * the well-conditioned matrix B = I + W^½·K·W^½ is factorised:
 *
 *     W   = −∇∇ log p(y|f) = diag(πᵢ(1 − πᵢ))
 *     B   = I + W^½·K·W^½,   L = chol(B)
 *     a   = b − W^½·L⁻ᵀ(L⁻¹(W^½·K·b)),  b = W·f + ∇log p(y|f)
 *     f   = K·a
 *
 * Predictions:
 *
 *     E[f*]   = k*ᵀ·∇log p(y|f̂)
 *     Var[f*] = k(x*,x*) − vᵀv,  v = L⁻¹(W^½·k*)
 *     π*      = ∫ σ(z)·N(z; E[f*], Var[f*]) dz        (Gauss–Legendre, 128 nodes)
 *
 * ## What is and is not honest here
 *
 * The class probability is `numerical`: it is the Laplace approximation's
 * answer, not the exact posterior's. The Laplace approximation is known to be
 * over-confident for GP classification relative to expectation propagation
 * (Kuss & Rasmussen, 2005) — it underestimates the posterior variance of the
 * latent function, which pushes probabilities toward 0 and 1. The returned
 * `limitations` say so. Expectation propagation is NOT implemented; a half-
 * correct EP would be worse than an honest Laplace.
 */
import { EngineError } from '../core/result';
import type { Matrix } from '../stats/linalg';
import { choleskyWithJitter, logDetFromCholesky, solveLower, solveLowerTranspose } from './linalg';
import { buildKernel, type KernelSpec } from './kernels';
import { covarianceMatrix } from './regression';
import type { JitterReport } from './types';

export interface GpClassificationRequest {
  readonly X: readonly (readonly number[])[];
  /** Labels as 0/1 or −1/+1. */
  readonly y: readonly number[];
  readonly kernel: KernelSpec;
  readonly kernelValues?: readonly number[];
  readonly maxIterations?: number;
  readonly tolerance?: number;
}

export interface GpClassificationModel {
  readonly X: readonly (readonly number[])[];
  readonly t: readonly number[];
  readonly latentMode: readonly number[];
  readonly gradLogLik: readonly number[];
  readonly sqrtW: readonly number[];
  readonly B: Matrix;
  readonly L: Matrix;
  readonly approximateLogMarginalLikelihood: number;
  readonly iterations: number;
  readonly jitter: JitterReport;
  readonly exactness: 'numerical';
  readonly limitations: readonly string[];
}

export interface ClassPrediction {
  readonly x: readonly number[];
  /** Posterior mean of the latent function (log-odds scale). */
  readonly latentMean: number;
  readonly latentVariance: number;
  /** P(y = 1 | data), averaged over the latent uncertainty. */
  readonly probability: number;
  /**
   * The probability obtained by ignoring the latent variance, σ(E[f*]). It is
   * always further from ½ than the averaged probability; the difference is
   * exactly the effect of the latent uncertainty, and reporting the plug-in
   * value alone would overstate confidence.
   */
  readonly plugInProbability: number;
}

const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

function logSigmoid(z: number): number {
  return z >= 0 ? -Math.log1p(Math.exp(-z)) : z - Math.log1p(Math.exp(z));
}

function normaliseLabels(y: readonly number[]): number[] {
  const t: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (v === 1) t.push(1);
    else if (v === 0 || v === -1) t.push(0);
    else {
      throw new EngineError(
        `Classification label ${i} is ${v}. Labels must be 0/1 or −1/+1; this module will not guess what an intermediate value means.`,
        'invalid',
      );
    }
  }
  return t;
}

export function fitGpClassifier(req: GpClassificationRequest): GpClassificationModel {
  const X = req.X.map((r) => Array.from(r));
  const n = X.length;
  if (n === 0) throw new EngineError('The training set is empty, so no classifier can be fitted.', 'required');
  if (req.y.length !== n) throw new EngineError(`${n} inputs but ${req.y.length} labels.`, 'length');
  const t = normaliseLabels(req.y);
  const positives = t.reduce((s, v) => s + v, 0);
  if (positives === 0 || positives === n) {
    throw new EngineError(
      `All ${n} labels belong to one class. The latent function is then unbounded in one direction, the Laplace mode runs off to infinity, and no finite probability model is identified. Supply examples of both classes.`,
      'identifiability',
    );
  }
  const k = buildKernel(req.kernel, X[0].length, req.kernelValues);
  const K = covarianceMatrix(k, X);
  const maxIter = req.maxIterations ?? 100;
  const tol = req.tolerance ?? 1e-10;

  let f = new Array<number>(n).fill(0);
  let objective = -Infinity;
  let L: Matrix = [];
  let B: Matrix = [];
  let sqrtW = new Array<number>(n).fill(0);
  let grad = new Array<number>(n).fill(0);
  let jitter: JitterReport = { added: 0, attempts: [], needed: false, note: 'No jitter was needed.' };
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const pi = f.map(sigmoid);
    const W = pi.map((p) => p * (1 - p));
    sqrtW = W.map((w) => Math.sqrt(Math.max(w, 1e-12)));
    grad = t.map((ti, i) => ti - pi[i]);
    B = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) + sqrtW[i] * K[i][j] * sqrtW[j]),
    );
    const fac = choleskyWithJitter(B, { baseScale: 1 });
    L = fac.L;
    jitter = fac.jitter;
    const b = f.map((fi, i) => W[i] * fi + grad[i]);
    const Kb = K.map((row) => row.reduce((s, kij, j) => s + kij * b[j], 0));
    const inner = solveLower(L, Kb.map((v, i) => sqrtW[i] * v));
    const outer = solveLowerTranspose(L, inner);
    const a = b.map((bi, i) => bi - sqrtW[i] * outer[i]);
    const fNew = K.map((row) => row.reduce((s, kij, j) => s + kij * a[j], 0));
    let logLik = 0;
    for (let i = 0; i < n; i++) logLik += logSigmoid(t[i] === 1 ? fNew[i] : -fNew[i]);
    let quad = 0;
    for (let i = 0; i < n; i++) quad += a[i] * fNew[i];
    const next = -0.5 * quad + logLik - 0.5 * logDetFromCholesky(L);
    const improvement = next - objective;
    f = fNew;
    objective = next;
    if (Math.abs(improvement) < tol * (Math.abs(objective) + 1)) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw new EngineError(
      `The Laplace approximation did not converge in ${maxIter} Newton iterations (last objective ${objective.toExponential(4)}). ` +
        'An unconverged mode is not a posterior approximation, so no probabilities are returned. A very large signal ' +
        'variance or a near-separable dataset is the usual cause: the latent function then runs toward infinity and ' +
        'the mode does not exist.',
      'non-convergence',
    );
  }
  // Recompute the final W/grad at the converged mode.
  const pi = f.map(sigmoid);
  grad = t.map((ti, i) => ti - pi[i]);
  sqrtW = pi.map((p) => Math.sqrt(Math.max(p * (1 - p), 1e-12)));
  B = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) + sqrtW[i] * K[i][j] * sqrtW[j]),
  );
  const finalFac = choleskyWithJitter(B, { baseScale: 1 });
  L = finalFac.L;
  if (finalFac.jitter.needed) jitter = finalFac.jitter;

  return {
    X,
    t,
    latentMode: f,
    gradLogLik: grad,
    sqrtW,
    B,
    L,
    approximateLogMarginalLikelihood: objective,
    iterations,
    jitter,
    exactness: 'numerical',
    limitations: [
      'The posterior over the latent function is NOT Gaussian for a Bernoulli likelihood. These numbers come from the Laplace approximation to it, so they are numerical, not exact.',
      'The Laplace approximation is known to be over-confident for GP classification (Kuss & Rasmussen, 2005): it underestimates the latent variance, pushing probabilities toward 0 and 1. Treat extreme probabilities with suspicion.',
      'The reported log marginal likelihood is the Laplace approximation to it, and is the quantity to use for choosing hyperparameters here — but it is biased, so model comparisons on it are weaker than for regression.',
      'Expectation propagation, which is more accurate, is not implemented.',
    ],
  };
}

/** 128-node Gauss–Legendre nodes on [−1, 1], built once by Newton iteration. */
const GL = (() => {
  const m = 128;
  const nodes: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < m; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (m + 0.5));
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let j = 2; j <= m; j++) {
        const p2 = ((2 * j - 1) * x * p1 - (j - 1) * p0) / j;
        p0 = p1;
        p1 = p2;
      }
      const dp = (m * (x * p1 - p0)) / (x * x - 1);
      const dx = -p1 / dp;
      x += dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    let p0 = 1;
    let p1 = x;
    for (let j = 2; j <= m; j++) {
      const p2 = ((2 * j - 1) * x * p1 - (j - 1) * p0) / j;
      p0 = p1;
      p1 = p2;
    }
    const dp = (m * (x * p1 - p0)) / (x * x - 1);
    nodes.push(x);
    weights.push(2 / ((1 - x * x) * dp * dp));
  }
  return { nodes, weights };
})();

/** ∫ σ(z)·N(z; μ, σ²) dz by Gauss–Legendre quadrature over μ ± 8σ. */
function averagedProbability(mu: number, variance: number): number {
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return sigmoid(mu);
  const half = 8 * sd;
  let acc = 0;
  let mass = 0;
  for (let i = 0; i < GL.nodes.length; i++) {
    const z = mu + half * GL.nodes[i];
    const w = GL.weights[i] * half * Math.exp(-0.5 * ((z - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
    acc += w * sigmoid(z);
    mass += w;
  }
  // Renormalise by the quadrature's own mass so the truncation at ±8σ cannot
  // push the result outside [0, 1].
  return acc / mass;
}

export function predictGpClassifier(
  model: GpClassificationModel,
  Xstar: readonly (readonly number[])[],
  kernelSpec: KernelSpec,
  kernelValues?: readonly number[],
): { readonly predictions: readonly ClassPrediction[]; readonly exactness: 'numerical'; readonly limitations: readonly string[] } {
  const k = buildKernel(kernelSpec, model.X[0].length, kernelValues);
  const predictions = Xstar.map((xs) => {
    const kstar = model.X.map((xi) => k.k(xi, xs));
    let latentMean = 0;
    for (let i = 0; i < kstar.length; i++) latentMean += kstar[i] * model.gradLogLik[i];
    const v = solveLower(model.L, kstar.map((kk, i) => model.sqrtW[i] * kk));
    let vv = 0;
    for (let i = 0; i < v.length; i++) vv += v[i] * v[i];
    const latentVariance = Math.max(k.k(xs, xs) - vv, 0);
    return {
      x: xs,
      latentMean,
      latentVariance,
      probability: averagedProbability(latentMean, latentVariance),
      plugInProbability: sigmoid(latentMean),
    };
  });
  return { predictions, exactness: 'numerical', limitations: model.limitations };
}
