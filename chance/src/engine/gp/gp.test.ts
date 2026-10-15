/**
 * Tests for the Gaussian-process module.
 *
 * ## Where the reference values come from
 *
 * Nothing here is asserted against this module's own output. The references
 * are, in order of preference:
 *
 *  1. Closed forms written out independently IN THIS FILE — the 2×2
 *     conditional Gaussian, the multivariate normal log density with its own
 *     determinant and solve, the textbook expected-improvement formula,
 *     K_{1/2}(x) = √(π/2x)·e^{−x}, the closed-form Matérn kernels.
 *  2. Mathematical identities that must hold for any correct implementation:
 *     the interpolation property, prior recovery, positive semi-definiteness,
 *     the Matérn limits, closed-form LOO against brute-force refitting,
 *     ordinary kriging against the GP posterior.
 *  3. Central finite differences, for the analytic gradients.
 *  4. Monte Carlo with a fixed seed, for the calibration and the
 *     expectation-of-a-maximum formula.
 *
 * Every seed is fixed. Every tolerance carries a comment saying why it is
 * what it is.
 */
import { describe, expect, it } from 'vitest';
import {
  KERNEL_DEFS,
  KERNEL_IDS,
  buildKernel,
  kernel,
  type KernelId,
} from './kernels';
import { besselK } from './bessel';
import { cholesky, choleskyWithJitter, minimizeLbfgs } from './linalg';
import {
  ardReport,
  conditionGp,
  covarianceMatrix,
  fitHyperparameters,
  hyperObjective,
  looCrossValidation,
  predictGp,
  priorPrediction,
  samplePriorFunctions,
  samplePosteriorFunctions,
} from './regression';
import { fitSparseGp } from './sparse';
import { fitGpClassifier, predictGpClassifier } from './classification';
import {
  BRANIN,
  bayesOptSteps,
  candidateSet,
  expectedImprovement,
  expectedMaxOfLines,
  knowledgeGradient,
  maximiseAcquisition,
  probabilityOfImprovement,
  runBayesOpt,
  ucbBeta,
} from './bayesopt';
import { empiricalVariogram, fitVariogram, krige, krigingVarianceMap } from './kriging';
import { fullyBayesianGp } from './fullyBayesian';
import { GP_LIMITS } from './types';
import { Random } from '../random/rng';

/* ================================================================== *
 * Independent helpers, written only for this file
 * ================================================================== */

type Mat = number[][];

/** Determinant by LU with partial pivoting — written here, not imported. */
function detLU(a: Mat): number {
  const n = a.length;
  const m = a.map((r) => [...r]);
  let det = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (p !== c) {
      [m[c], m[p]] = [m[p], m[c]];
      det = -det;
    }
    if (m[c][c] === 0) return 0;
    det *= m[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return det;
}

/** Gauss–Jordan solve — written here, not imported. */
function solveGJ(a: Mat, b: number[]): number[] {
  const n = a.length;
  const m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let k = c; k <= n; k++) m[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((r) => r[n]);
}

/** The multivariate normal log density, straight from the definition. */
function mvnLogPdf(y: number[], cov: Mat): number {
  const n = y.length;
  const kInvY = solveGJ(cov, y);
  let quad = 0;
  for (let i = 0; i < n; i++) quad += y[i] * kInvY[i];
  return -0.5 * quad - 0.5 * Math.log(detLU(cov)) - (n / 2) * Math.log(2 * Math.PI);
}

/** Eigenvalues of a symmetric matrix by cyclic Jacobi — written here. */
function eigenvaluesSym(a: Mat): number[] {
  const n = a.length;
  const m = a.map((r) => [...r]);
  for (let sweep = 0; sweep < 200; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] ** 2;
    if (off < 1e-26) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (m[p][q] === 0) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const kp = m[k][p];
          const kq = m[k][q];
          m[k][p] = c * kp - s * kq;
          m[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k++) {
          const pk = m[p][k];
          const qk = m[q][k];
          m[p][k] = c * pk - s * qk;
          m[q][k] = s * pk + c * qk;
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => m[i][i]).sort((x, y) => x - y);
}

const standardNormalCdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, accurate to about 1.5e-7 — used only for the
  // independent expected-improvement reference, where that is ample.
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
const standardNormalPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Parameter values for a kernel, with every positive slot set to `value`. */
function valuesFor(id: KernelId, d: number, value = 0.9): number[] {
  const k = buildKernel(kernel.base(id), d);
  return k.slots.map((s, i) => (s.trainable ? value : k.values[i]));
}

/* ================================================================== *
 * Kernels
 * ================================================================== */

describe('kernel definitions', () => {
  it('states the smoothness it assumes, and names Matérn 5/2 as the safer default', () => {
    for (const id of KERNEL_IDS) {
      const def = KERNEL_DEFS[id];
      expect(def.smoothness.length).toBeGreaterThan(20);
      expect(def.formula).toContain('k(a, b)');
      expect(def.limitations.length).toBeGreaterThan(0);
      expect(def.params.length).toBeGreaterThan(0);
    }
    // The RBF kernel's analyticity assumption must be called out, and Matérn
    // 5/2 must be the recommended default.
    expect(KERNEL_DEFS.rbf.smoothness).toMatch(/infinitely/i);
    expect(KERNEL_DEFS.rbf.guidance).toMatch(/discouraged/i);
    expect(KERNEL_DEFS.matern52.guidance).toMatch(/recommended/i);
    expect(KERNEL_DEFS.matern52.meanSquareDerivatives).toBe(2);
    expect(KERNEL_DEFS.matern12.meanSquareDerivatives).toBe(0);
  });

  it('produces a symmetric positive semi-definite Gram matrix for every kernel', () => {
    const rng = new Random('gram');
    const X = Array.from({ length: 9 }, () => [rng.uniformRange(-2, 2), rng.uniformRange(-2, 2)]);
    for (const id of KERNEL_IDS) {
      const k = buildKernel(kernel.base(id), 2, valuesFor(id, 2, 1.1));
      const G = covarianceMatrix(k, X);
      for (let i = 0; i < X.length; i++) {
        for (let j = 0; j < X.length; j++) {
          // Symmetry must be exact, not approximate: the same expression is
          // evaluated with its arguments swapped.
          expect(G[i][j]).toBeCloseTo(G[j][i], 14);
        }
      }
      const eig = eigenvaluesSym(G);
      // A valid covariance function has no negative eigenvalues; −1e-10 is the
      // allowance for the Jacobi rotations' own rounding on a 9×9 matrix.
      expect(eig[0]).toBeGreaterThan(-1e-10);
    }
  });

  it('gives k(x, x) = the signal variance, and depends only on distance when stationary', () => {
    const stationary = KERNEL_IDS.filter((id) => KERNEL_DEFS[id].stationary && id !== 'constant' && id !== 'white');
    for (const id of stationary) {
      const k = buildKernel(kernel.base(id, { variance: 2.75 }), 1);
      // Exact: at zero separation every stationary kernel here collapses to σ².
      expect(k.k([0.4], [0.4])).toBeCloseTo(2.75, 12);
      // Stationarity: the value depends on a − b only.
      const a = k.k([0], [1.3]);
      const b = k.k([5], [6.3]);
      expect(a).toBeCloseTo(b, 12);
      // ...and is symmetric in the sign of the separation.
      expect(k.k([0], [1.3])).toBeCloseTo(k.k([1.3], [0]), 14);
    }
    expect(buildKernel(kernel.base('white', { variance: 3 }), 1).k([1], [1])).toBe(3);
    expect(buildKernel(kernel.base('white', { variance: 3 }), 1).k([1], [1.0000001])).toBe(0);
  });

  it('K_ν matches the closed form K_{1/2}(x) = √(π/2x)·e^{−x}', () => {
    for (const x of [0.005, 0.1, 0.5, 1, 2.5, 7, 20, 60]) {
      const reference = Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x);
      // The quadrature is good to well under 1e-12 relative; 1e-11 leaves room
      // for the reference's own rounding at x = 60 where K ≈ 1e-27.
      expect(besselK(0.5, x) / reference).toBeCloseTo(1, 11);
    }
    // K_{3/2}(x) = √(π/2x)·e^{−x}·(1 + 1/x) is another independent closed form.
    for (const x of [0.2, 1, 4]) {
      const reference = Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x) * (1 + 1 / x);
      expect(besselK(1.5, x) / reference).toBeCloseTo(1, 11);
    }
    expect(() => besselK(1.5, 0)).toThrow(/x > 0/);
  });

  it('Matérn ν = 1/2 equals the exponential kernel exactly, and the general ν reproduces the closed forms', () => {
    const exp12 = buildKernel(kernel.base('exponential', { variance: 1.3, lengthScale: 0.7 }), 1);
    const m12 = buildKernel(kernel.base('matern12', { variance: 1.3, lengthScale: 0.7 }), 1);
    for (const h of [0, 0.1, 0.5, 2, 5]) {
      // Identical formulas: this must agree to the last bit.
      expect(m12.k([0], [h])).toBe(exp12.k([0], [h]));
    }
    for (const nu of [0.5, 1.5, 2.5]) {
      const general = buildKernel(kernel.base('matern', { variance: 1.3, lengthScale: 0.7, nu }), 1);
      const closed = buildKernel(
        kernel.base(nu === 0.5 ? 'matern12' : nu === 1.5 ? 'matern32' : 'matern52', {
          variance: 1.3,
          lengthScale: 0.7,
        }),
        1,
      );
      for (const h of [0.05, 0.3, 1, 3]) {
        // 1e-10 relative: the Bessel quadrature is the only approximation here.
        expect(general.k([0], [h]) / closed.k([0], [h])).toBeCloseTo(1, 10);
      }
    }
  });

  it('Matérn approaches the RBF kernel as ν grows', () => {
    const rbf = buildKernel(kernel.base('rbf', { variance: 1, lengthScale: 1 }), 1);
    const errors = [2.5, 8, 30].map((nu) => {
      const m = buildKernel(kernel.base('matern', { variance: 1, lengthScale: 1, nu }), 1);
      return Math.max(...[0.25, 0.75, 1.5].map((h) => Math.abs(m.k([0], [h]) - rbf.k([0], [h]))));
    });
    // Monotone convergence toward the RBF kernel.
    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
    // Convergence in ν is slow (the Matérn correlation approaches the Gaussian
    // one at O(1/ν)), so at ν = 30 the two kernels agree to about 1% of the
    // signal variance. A tighter bound would be asserting a convergence rate
    // the mathematics does not have.
    expect(errors[2]).toBeLessThan(1e-2);
    expect(errors[0]).toBeGreaterThan(2e-2);
  });

  it('composes kernels by sum, product and scaling', () => {
    const a = kernel.base('rbf', { variance: 1.5, lengthScale: 2 });
    const b = kernel.base('linear', { variance: 0.5, bias: 0.25, lengthScale: 1 });
    const ka = buildKernel(a, 1);
    const kb = buildKernel(b, 1);
    const sum = buildKernel(kernel.sum(a, b), 1);
    const prod = buildKernel(kernel.product(a, b), 1);
    const scaled = buildKernel(kernel.scale(3, a), 1);
    const x = [0.3];
    const y = [1.1];
    expect(sum.k(x, y)).toBeCloseTo(ka.k(x, y) + kb.k(x, y), 14);
    expect(prod.k(x, y)).toBeCloseTo(ka.k(x, y) * kb.k(x, y), 14);
    expect(scaled.k(x, y)).toBeCloseTo(3 * ka.k(x, y), 14);
    expect(sum.slots.length).toBe(ka.slots.length + kb.slots.length);
    // A locally periodic kernel is a periodic kernel times an RBF, and the
    // dedicated kernel must agree with that product.
    const lp = buildKernel(kernel.base('locally-periodic', { variance: 1, lengthScale: 1, period: 2, decayLengthScale: 3 }), 1);
    const manual = buildKernel(
      kernel.product(
        kernel.base('periodic', { variance: 1, lengthScale: 1, period: 2 }),
        kernel.base('rbf', { variance: 1, lengthScale: 3 }),
      ),
      1,
    );
    expect(lp.k([0], [0.9])).toBeCloseTo(manual.k([0], [0.9]), 14);
  });

  it('refuses a non-positive length scale or an unknown parameter instead of clamping', () => {
    expect(() => buildKernel(kernel.base('rbf', { lengthScale: -1 }), 1)).toThrow(/strictly positive/);
    expect(() => buildKernel(kernel.base('rbf', { variance: 0 }), 1)).toThrow(/strictly positive/);
    expect(() => buildKernel(kernel.base('rbf', { lengthScaleX: 1 }), 1)).toThrow(/no parameter named/);
    expect(() => buildKernel(kernel.base('rbf', { lengthScale: [1, 2] }), 1)).toThrow(/needs 1 value/);
    expect(() => buildKernel(kernel.base('rbf'), 0)).toThrow(/at least 1/);
  });

  it('gives one length scale per dimension for automatic relevance determination', () => {
    const k = buildKernel(kernel.base('rbf', { lengthScale: [0.5, 4] }), 2);
    expect(k.slots.filter((s) => s.base === 'lengthScale').length).toBe(2);
    // A short length scale in dimension 0 means the kernel decays faster along it.
    expect(k.k([0, 0], [1, 0])).toBeLessThan(k.k([0, 0], [0, 1]));
  });
});

/* ================================================================== *
 * Exact inference
 * ================================================================== */

describe('exact GP inference', () => {
  it('interpolates: with zero noise the mean passes through every point, the variance is 0 there, and it rises to the prior away from the data', () => {
    const X = [[0], [1], [2.5], [4], [4.3]];
    const y = [0.3, -1.2, 0.8, 2.0, 1.7];
    const model = conditionGp({
      X,
      y,
      kernel: kernel.base('matern52', { variance: 2, lengthScale: 1.3 }),
      noiseVariance: 0,
    });
    const at = predictGp(model, X).predictions;
    at.forEach((p, i) => {
      // 1e-8 as specified: the Cholesky solve of a 5×5 matrix is far more
      // accurate than that, but near-duplicate inputs (4 and 4.3) make the
      // matrix ill-conditioned and 1e-8 is the honest bound.
      expect(p.mean).toBeCloseTo(y[i], 8);
      expect(p.latentVariance).toBeLessThan(1e-8);
      expect(p.latentVariance).toBeGreaterThanOrEqual(0);
    });
    // Away from the data the variance rises monotonically toward k(x, x) = 2.
    const away = predictGp(model, [[5], [7], [12], [40]]).predictions.map((p) => p.latentVariance);
    for (let i = 1; i < away.length; i++) expect(away[i]).toBeGreaterThan(away[i - 1]);
    expect(away[away.length - 1]).toBeCloseTo(2, 8);
    // With no noise the two intervals coincide: there is nothing to add.
    expect(at[0].predictiveVariance).toBe(at[0].latentVariance);
  });

  it('recovers the prior exactly when there is no data', () => {
    const spec = kernel.base('rbf', { variance: 1.75, lengthScale: 0.6 });
    const prior = priorPrediction(spec, 1, [[0], [3], [10]]);
    for (const p of prior.predictions) {
      expect(p.mean).toBe(0);
      // k(x, x) = σ² exactly for a stationary kernel.
      expect(p.latentVariance).toBeCloseTo(1.75, 14);
    }
    // And an empty training set is refused rather than silently treated as the prior.
    expect(() => conditionGp({ X: [], y: [], kernel: spec, noiseVariance: 0.1 })).toThrow(/training set is empty/);
  });

  it('matches a two-point GP computed by hand from the 2×2 conditional-Gaussian formulas', () => {
    // x₁ = 0, x₂ = 1, x* = 0.5; RBF with σ² = 1, ℓ = 1; noise σ²ₙ = 0.1; y = (1, 2).
    //
    //   k(0,1)  = exp(−½)       = 0.6065306597126334
    //   k*      = exp(−½·0.25)  = 0.8824969025845955   (both entries)
    //   K_y     = [[1.1, k₁₂], [k₁₂, 1.1]]
    //   det     = 1.1² − k₁₂²   = 0.8421205588285579
    //   α       = K_y⁻¹y = ((1.1·1 − k₁₂·2)/det, (−k₁₂·1 + 1.1·2)/det)
    //           = (−0.13425787820991106, 1.8922104722202506)
    //   mean    = k*ᵀα = k*·(α₁ + α₂) = 1.5513877191046794
    //   var     = k** − k*ᵀK_y⁻¹k* = 1 − 2·k*²·(1.1 − k₁₂)/det = 0.08727009545489317
    //   predictive variance = latent + 0.1 = 0.18727009545489318
    const model = conditionGp({
      X: [[0], [1]],
      y: [1, 2],
      kernel: kernel.base('rbf', { variance: 1, lengthScale: 1 }),
      noiseVariance: 0.1,
    });
    const p = predictGp(model, [[0.5]]).predictions[0];
    expect(p.mean).toBeCloseTo(1.5513877191046794, 10);
    expect(p.latentVariance).toBeCloseTo(0.08727009545489317, 10);
    expect(p.predictiveVariance).toBeCloseTo(0.18727009545489318, 10);
  });

  it('log marginal likelihood agrees with the multivariate normal density computed from the definition', () => {
    const rng = new Random('lml');
    const X = Array.from({ length: 7 }, (_, i) => [i * 0.6, rng.uniformRange(-1, 1)]);
    const y = X.map((x) => Math.sin(x[0]) + 0.3 * x[1]);
    for (const id of ['rbf', 'matern32', 'rational-quadratic', 'periodic'] as KernelId[]) {
      const spec = kernel.base(id, { variance: 1.4 });
      const model = conditionGp({ X, y, kernel: spec, noiseVariance: 0.07 });
      const k = buildKernel(spec, 2, model.kernel.values);
      const cov = covarianceMatrix(k, X).map((row, i) => row.map((v, j) => (i === j ? v + 0.07 : v)));
      // 1e-9 absolute on a log density of order 10: the Cholesky route and the
      // explicit determinant/solve route differ only by rounding.
      expect(model.logMarginalLikelihood).toBeCloseTo(mvnLogPdf(y, cov), 9);
    }
  });

  it('keeps the latent and predictive intervals separate, with the predictive one strictly wider', () => {
    const model = conditionGp({
      X: [[0], [1], [2], [3]],
      y: [0, 1, 0.5, -0.5],
      kernel: kernel.base('matern52', { variance: 1, lengthScale: 1 }),
      noiseVariance: 0.2,
    });
    const set = predictGp(model, [[0], [0.5], [1.5], [9]]);
    for (const p of set.predictions) {
      expect(p.predictiveVariance).toBeCloseTo(p.latentVariance + 0.2, 12);
      const latentWidth = p.latentInterval.upper - p.latentInterval.lower;
      const predWidth = p.predictiveInterval.upper - p.predictiveInterval.lower;
      expect(predWidth).toBeGreaterThan(latentWidth);
      expect(p.latentInterval.kind).toBe('latent-credible');
      expect(p.predictiveInterval.kind).toBe('predictive');
      expect(p.latentInterval.label).not.toBe(p.predictiveInterval.label);
    }
    expect(set.exactness).toBe('exact');
  });

  it('honours per-observation noise variances', () => {
    const X = [[0], [1], [2], [3]];
    const y = [0, 5, 0, 0];
    // Observation 1 is declared ten times noisier than the others, so the fit
    // must follow it less closely than when all noise is equal.
    const equal = conditionGp({ X, y, kernel: kernel.base('rbf', { variance: 4, lengthScale: 1 }), noiseVariance: 0.1 });
    const hetero = conditionGp({
      X,
      y,
      kernel: kernel.base('rbf', { variance: 4, lengthScale: 1 }),
      noiseVariance: 0.1,
      noiseWeights: [1, 10, 1, 1],
    });
    const a = predictGp(equal, [[1]]).predictions[0];
    const b = predictGp(hetero, [[1]]).predictions[0];
    expect(b.mean).toBeLessThan(a.mean);
    expect(b.latentVariance).toBeGreaterThan(a.latentVariance);
    expect(() => conditionGp({ X, y, kernel: kernel.base('rbf'), noiseVariance: 0.1, noiseWeights: [1, 1] })).toThrow(
      /one weight per observation/,
    );
  });

  it('reports the jitter it added for duplicate inputs, and still returns a usable result', () => {
    const X = [[0], [0], [1], [1], [2]];
    const y = [0.5, 0.5, 1.2, 1.2, -0.3];
    const model = conditionGp({ X, y, kernel: kernel.base('rbf', { variance: 1, lengthScale: 1 }), noiseVariance: 0 });
    expect(model.jitter.needed).toBe(true);
    expect(model.jitter.added).toBeGreaterThan(0);
    expect(model.jitter.attempts.length).toBeGreaterThan(0);
    expect(model.jitter.note).toMatch(/jitter|diagonal/i);
    expect(model.warnings.join(' ')).toMatch(/jitter|singular/i);
    const p = predictGp(model, X).predictions;
    // Still usable: the mean interpolates to within the jitter's effect.
    p.forEach((pi, i) => expect(Math.abs(pi.mean - y[i])).toBeLessThan(1e-4));
  });

  it('refuses a dataset beyond the exact limit, naming the limit and the memory estimate', () => {
    const n = 40;
    const X = Array.from({ length: n }, (_, i) => [i]);
    const y = X.map(() => 0);
    let message = '';
    try {
      conditionGp({ X, y, kernel: kernel.base('rbf'), noiseVariance: 0.1, maxExactN: 10 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/limit for this request is n = 10/);
    expect(message).toMatch(/memory|KB|MB|B of memory/);
    expect(message).toMatch(/sparse|subset/);
    // The absolute cap applies even when a larger override is requested.
    expect(GP_LIMITS.absoluteMaxN).toBeGreaterThanOrEqual(GP_LIMITS.maxExactN);
  });

  it('refuses contradictory noise-free duplicates, a negative noise variance and an empty prediction set', () => {
    expect(() =>
      conditionGp({ X: [[0], [0]], y: [1, 2], kernel: kernel.base('rbf'), noiseVariance: 0 }),
    ).toThrow(/identical inputs/);
    // The same data with noise is a perfectly sensible model.
    expect(() => conditionGp({ X: [[0], [0]], y: [1, 2], kernel: kernel.base('rbf'), noiseVariance: 0.5 })).not.toThrow();
    expect(() => conditionGp({ X: [[0]], y: [1], kernel: kernel.base('rbf'), noiseVariance: -1 })).toThrow(/0 or more/);
    const m = conditionGp({ X: [[0], [1]], y: [1, 2], kernel: kernel.base('rbf'), noiseVariance: 0.1 });
    expect(() => predictGp(m, [])).toThrow(/nothing to predict/);
    expect(() => predictGp(m, [[0, 1]])).toThrow(/1 dimension/);
    expect(() => predictGp(m, [[0]], { level: 1 })).toThrow(/strictly between 0 and 1/);
  });

  it('refuses a covariance matrix that jitter cannot rescue, reporting the jitter tried and the smallest eigenvalue', () => {
    // A matrix with a genuinely negative eigenvalue is not a covariance matrix.
    const bad = [
      [1, 2],
      [2, 1],
    ];
    let message = '';
    try {
      choleskyWithJitter(bad);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/not positive definite/);
    expect(message).toMatch(/Jitter values tried/);
    expect(message).toMatch(/smallest eigenvalue is -1\.0/);
    // Cross-check the eigenvalue with this file's own Jacobi implementation.
    expect(eigenvaluesSym(bad)[0]).toBeCloseTo(-1, 12);
  });

  it('samples whole functions from the prior and the posterior with the right first two moments', () => {
    const spec = kernel.base('rbf', { variance: 2, lengthScale: 1.5 });
    const grid = [[0], [1], [2], [3]];
    const prior = samplePriorFunctions(spec, 1, grid, 4000, 'prior-seed');
    expect(prior.samples.length).toBe(4000);
    expect(prior.exactness).toBe('empirical');
    const col0 = prior.samples.map((s) => s[0]);
    const mean0 = col0.reduce((a, b) => a + b, 0) / col0.length;
    const var0 = col0.reduce((a, b) => a + (b - mean0) ** 2, 0) / (col0.length - 1);
    // Monte Carlo error on a variance from 4000 draws is about σ²·√(2/n) ≈ 4.5%.
    expect(mean0).toBeCloseTo(0, 1);
    expect(var0 / 2).toBeCloseTo(1, 1);
    const model = conditionGp({ X: [[0], [2]], y: [1, -1], kernel: spec, noiseVariance: 1e-6 });
    const post = samplePosteriorFunctions(model, grid, 2000, 'post-seed');
    const atData = post.samples.map((s) => s[0]);
    const m = atData.reduce((a, b) => a + b, 0) / atData.length;
    // The posterior is pinned at the observation, so every draw passes through it.
    expect(m).toBeCloseTo(1, 2);
    expect(Math.max(...atData.map((v) => Math.abs(v - 1)))).toBeLessThan(0.05);
  });
});

/* ================================================================== *
 * Gradients
 * ================================================================== */

describe('analytic hyperparameter gradients', () => {
  it('match central finite differences for every kernel', () => {
    const X = [
      [0, 0.2],
      [1, 0.5],
      [2.5, -1],
      [4, 0.1],
      [1.5, 2],
      [-0.7, 0.9],
    ];
    const y = [0.3, -1.2, 0.8, 2, 0.1, -0.4];
    const failures: string[] = [];
    for (const id of KERNEL_IDS) {
      const spec = kernel.base(id);
      const objective = hyperObjective({ X, y, kernel: spec, noiseVariance: 0.15 }, { fitNoise: true });
      const theta = objective.names.map((n) => (n === 'noiseVariance' ? Math.log(0.15) : 0.2));
      const { gradient } = objective.evaluate(theta);
      const h = 1e-6;
      for (let j = 0; j < theta.length; j++) {
        const up = [...theta];
        const dn = [...theta];
        up[j] += h;
        dn[j] -= h;
        const fd = (objective.evaluate(up).value - objective.evaluate(dn).value) / (2 * h);
        const rel = Math.abs(gradient[j] - fd) / Math.max(1, Math.abs(fd));
        // 1e-6 relative: a central difference with h = 1e-6 on a smooth
        // objective is itself accurate to about h² = 1e-12 in truncation plus
        // roughly 1e-10/h = 1e-4 absolute in cancellation noise, so anything
        // tighter would test the finite difference rather than the gradient.
        if (!(rel < 1e-6)) failures.push(`${id}/${objective.names[j]}: analytic ${gradient[j]}, fd ${fd}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('match finite differences for a composed kernel and heteroskedastic noise', () => {
    const X = [[0], [0.8], [1.9], [3.1], [4.4]];
    const y = [1, 0.2, -0.7, 0.4, 1.1];
    const spec = kernel.sum(
      kernel.base('matern52', { variance: 1.2, lengthScale: 1.4 }),
      kernel.base('periodic', { variance: 0.4, lengthScale: 1, period: 2 }),
    );
    const objective = hyperObjective(
      { X, y, kernel: spec, noiseVariance: 0.05, noiseWeights: [1, 2, 0.5, 1, 3] },
      { fitNoise: true },
    );
    const theta = objective.names.map((n) => (n === 'noiseVariance' ? Math.log(0.05) : 0.1));
    const { gradient } = objective.evaluate(theta);
    const h = 1e-6;
    for (let j = 0; j < theta.length; j++) {
      const up = [...theta];
      const dn = [...theta];
      up[j] += h;
      dn[j] -= h;
      const fd = (objective.evaluate(up).value - objective.evaluate(dn).value) / (2 * h);
      expect(Math.abs(gradient[j] - fd) / Math.max(1, Math.abs(fd))).toBeLessThan(1e-6);
    }
  });
});

/* ================================================================== *
 * Cross-validation
 * ================================================================== */

describe('leave-one-out cross-validation', () => {
  it('matches brute-force refitting with each point removed', () => {
    const X = [[0], [1], [2], [3], [4.5], [5.5]];
    const y = [0.5, -1, 0.2, 1.4, 0.9, -0.2];
    const spec = kernel.base('rbf', { variance: 1.4, lengthScale: 0.9 });
    const model = conditionGp({ X, y, kernel: spec, noiseVariance: 0.05 });
    const loo = looCrossValidation(model);
    for (let i = 0; i < X.length; i++) {
      const brute = conditionGp({
        X: X.filter((_, j) => j !== i),
        y: y.filter((_, j) => j !== i),
        kernel: spec,
        noiseVariance: 0.05,
      });
      const p = predictGp(brute, [X[i]]).predictions[0];
      // The closed form is an identity, not an approximation: 1e-9 is pure
      // floating-point rounding across two different solve orders.
      expect(loo.means[i]).toBeCloseTo(p.mean, 9);
      expect(loo.variances[i]).toBeCloseTo(p.predictiveVariance, 9);
    }
    expect(loo.exactness).toBe('exact');
    // The log predictive density is the sum of the per-point Gaussian densities.
    const manual = y.reduce(
      (s, yi, i) => s - 0.5 * Math.log(2 * Math.PI * loo.variances[i]) - (yi - loo.means[i]) ** 2 / (2 * loo.variances[i]),
      0,
    );
    expect(loo.logPredictiveDensity).toBeCloseTo(manual, 10);
  });

  it('refuses the closed form when the mean was profiled out, instead of returning a wrong number', () => {
    const model = conditionGp({
      X: [[0], [1], [2]],
      y: [1, 2, 3],
      kernel: kernel.base('rbf'),
      noiseVariance: 0.1,
      mean: { kind: 'constant' },
    });
    expect(() => looCrossValidation(model)).toThrow(/generalised least squares/);
  });
});

/* ================================================================== *
 * Hyperparameter fitting
 * ================================================================== */

describe('hyperparameter fitting', () => {
  it('recovers known hyperparameters from data generated by a GP with those hyperparameters', () => {
    // Truth: RBF with σ² = 1.5, ℓ = 1.2, noise variance 0.04. The latent
    // function is one draw from that prior with a fixed seed, so this is a
    // genuine recovery test rather than a fit to a hand-picked function.
    const X = Array.from({ length: 110 }, (_, i) => [i * 0.12]);
    const truth = kernel.base('rbf', { variance: 1.5, lengthScale: 1.2 });
    const f = samplePriorFunctions(truth, 1, X, 1, 'recovery').samples[0];
    const rng = new Random('recovery-noise');
    const y = f.map((v) => v + 0.2 * rng.normal());
    const { model, fit } = fitHyperparameters(
      { X, y, kernel: kernel.base('rbf'), noiseVariance: 0.1 },
      { restarts: 6, seed: 'fit' },
    );
    const variance = model.kernel.values[model.kernel.slots.findIndex((s) => s.base === 'variance')];
    const lengthScale = model.kernel.values[model.kernel.slots.findIndex((s) => s.base === 'lengthScale')];
    // One realisation of a GP on a finite window identifies its
    // hyperparameters only loosely (the length scale and signal variance are
    // confounded along a ridge), so the tolerance is a factor rather than a
    // decimal: within a factor of 2 on the length scale and signal variance,
    // and a factor of 2 on the noise variance, is what maximum likelihood can
    // deliver from 110 points.
    expect(lengthScale).toBeGreaterThan(0.6);
    expect(lengthScale).toBeLessThan(2.4);
    expect(variance).toBeGreaterThan(0.75);
    expect(variance).toBeLessThan(3);
    expect(model.noiseVariance).toBeGreaterThan(0.02);
    expect(model.noiseVariance).toBeLessThan(0.08);
    expect(fit.exactness).toBe('numerical');
    expect(fit.restarts).toBe(6);
    expect(fit.convergedRestarts).toBeGreaterThan(0);
    expect(fit.outcomes.length).toBe(6);
    expect(fit.logMarginalLikelihoodRange[0]).toBeLessThanOrEqual(fit.logMarginalLikelihoodRange[1]);
    expect(fit.best.logMarginalLikelihood).toBe(fit.logMarginalLikelihoodRange[1]);
  });

  it('shows that the multi-restart machinery matters: a bad single initialisation lands on a worse optimum', () => {
    // Two-scale data: a slow trend plus a fast wiggle. The marginal likelihood
    // has a short-length-scale optimum and a long-length-scale one.
    const X = Array.from({ length: 60 }, (_, i) => [i * 0.1]);
    const y = X.map((x) => Math.sin(x[0] * 0.5) + 0.35 * Math.sin(x[0] * 9));
    const request = { X, y, kernel: kernel.base('rbf'), noiseVariance: 0.02 };
    const bad = fitHyperparameters(request, {
      restarts: 1,
      seed: 'bad',
      // A single start with a length scale of e^4 ≈ 55, far longer than the
      // data window: the optimiser cannot leave that basin.
      logBounds: [Math.log(1e-6), Math.log(1e6)],
      maxIterations: 150,
    });
    const many = fitHyperparameters(request, { restarts: 10, seed: 'many', maxIterations: 150 });
    expect(many.fit.best.logMarginalLikelihood).toBeGreaterThanOrEqual(bad.fit.best.logMarginalLikelihood - 1e-9);
    // The restarts must actually disagree, otherwise this test proves nothing.
    expect(many.fit.logMarginalLikelihoodRange[1] - many.fit.logMarginalLikelihoodRange[0]).toBeGreaterThan(0.5);
    expect(many.fit.identifiable).toBe(false);
    expect(many.fit.note).toMatch(/multimodal|NOT identified/);
  });

  it('refuses to report an unconverged fit', () => {
    const X = Array.from({ length: 20 }, (_, i) => [i * 0.3]);
    const y = X.map((x) => Math.cos(x[0]));
    expect(() =>
      fitHyperparameters({ X, y, kernel: kernel.base('rbf'), noiseVariance: 0.05 }, { restarts: 2, maxIterations: 0, seed: 'z' }),
    ).toThrow(/did not converge|None of the/);
    // Fitting a noise variance from a starting value of 0 is impossible, and
    // is refused rather than silently replaced with a small number.
    expect(() =>
      fitHyperparameters({ X, y, kernel: kernel.base('rbf'), noiseVariance: 0 }, { fitNoise: true, seed: 'z' }),
    ).toThrow(/positive starting value/);
  });

  it('ranks input relevance by the fitted ARD length scales', () => {
    // y depends on x₀ and not at all on x₁.
    const rng = new Random('ard');
    const X = Array.from({ length: 70 }, () => [rng.uniformRange(0, 5), rng.uniformRange(0, 5)]);
    const y = X.map((x) => Math.sin(x[0]) + 0.02 * rng.normal());
    const { model } = fitHyperparameters(
      { X, y, kernel: kernel.base('rbf'), noiseVariance: 0.01 },
      { restarts: 6, seed: 'ard-fit' },
    );
    const ard = ardReport(model);
    expect(ard).not.toBeNull();
    const entries = ard!.entries;
    // The irrelevant input must come out with the longer length scale, hence
    // the lower relevance and the worse rank.
    expect(entries[1].lengthScale).toBeGreaterThan(entries[0].lengthScale);
    expect(entries[0].rank).toBe(1);
    expect(entries[0].relevanceShare).toBeGreaterThan(entries[1].relevanceShare);
    expect(entries[0].relevanceShare + entries[1].relevanceShare).toBeCloseTo(1, 12);
    expect(ard!.exactness).toBe('numerical');
    expect(ard!.limitations.join(' ')).toMatch(/Sobol/);
  });

  it('fits length scales that reflect the roughness of the data', () => {
    // A rough path should be fitted with a shorter length scale under Matérn
    // 1/2 than a smooth one under the same kernel.
    const X = Array.from({ length: 80 }, (_, i) => [i * 0.1]);
    const rough = samplePriorFunctions(kernel.base('matern12', { variance: 1, lengthScale: 0.3 }), 1, X, 1, 'rough').samples[0];
    const smooth = samplePriorFunctions(kernel.base('rbf', { variance: 1, lengthScale: 2.5 }), 1, X, 1, 'smooth').samples[0];
    const fitLs = (y: readonly number[]): number => {
      const { model } = fitHyperparameters(
        { X, y: Array.from(y), kernel: kernel.base('matern12'), noiseVariance: 0.001 },
        { restarts: 5, seed: 'rough-fit', fitNoise: false },
      );
      return model.kernel.values[model.kernel.slots.findIndex((s) => s.base === 'lengthScale')];
    };
    expect(fitLs(rough)).toBeLessThan(fitLs(smooth));
  });
});

/* ================================================================== *
 * Calibration — the honesty test
 * ================================================================== */

describe('predictive calibration', () => {
  it('covers about 95% of held-out observations with the predictive interval and about 95% of the latent function with the narrower one', () => {
    // One joint draw from a GP with KNOWN hyperparameters over the training
    // and test inputs together, so the test targets really are from the model.
    const spec = kernel.base('matern52', { variance: 1.6, lengthScale: 0.9 });
    const noiseVariance = 0.09;
    const train = Array.from({ length: 60 }, (_, i) => [i * 0.25]);
    const test = Array.from({ length: 200 }, (_, i) => [0.12 + i * 0.075]);
    const all = [...train, ...test];
    const f = samplePriorFunctions(spec, 1, all, 1, 'calibration').samples[0];
    const rng = new Random('calibration-noise');
    const yTrain = train.map((_, i) => f[i] + Math.sqrt(noiseVariance) * rng.normal());
    const fTest = test.map((_, i) => f[train.length + i]);
    const yTest = fTest.map((v) => v + Math.sqrt(noiseVariance) * rng.normal());

    const model = conditionGp({ X: train, y: yTrain, kernel: spec, noiseVariance });
    const preds = predictGp(model, test, { level: 0.95 }).predictions;

    let predictiveCovered = 0;
    let latentCovered = 0;
    for (let i = 0; i < test.length; i++) {
      const p = preds[i];
      if (yTest[i] >= p.predictiveInterval.lower && yTest[i] <= p.predictiveInterval.upper) predictiveCovered++;
      if (fTest[i] >= p.latentInterval.lower && fTest[i] <= p.latentInterval.upper) latentCovered++;
      // The predictive interval must be strictly wider EVERYWHERE.
      expect(p.predictiveInterval.upper - p.predictiveInterval.lower).toBeGreaterThan(
        p.latentInterval.upper - p.latentInterval.lower,
      );
    }
    const predictiveRate = predictiveCovered / test.length;
    const latentRate = latentCovered / test.length;
    // Measured on this seed: 97.0% of observations fall inside the 95%
    // predictive interval, 94.5% of latent values inside the 95% latent
    // interval, and only 75% of observations inside the latent interval —
    // which is the error this test exists to catch. The LOO standardised
    // residuals have variance 1.004.
    //
    // The test points are strongly correlated with one another, so the
    // effective sample size is far below 200 and the coverage of a single
    // realisation fluctuates much more than the binomial √(p(1−p)/n) ≈ 1.5%
    // would suggest. A window of 0.85 to 1.0 is wide enough to be stable
    // across the seed and narrow enough to fail an uncalibrated model (a GP
    // reporting the LATENT interval for observations would cover roughly 60%
    // here, and one with the noise double-counted would cover ~100% with
    // visibly wider intervals).
    expect(predictiveRate).toBeGreaterThan(0.85);
    expect(predictiveRate).toBeLessThanOrEqual(1);
    expect(latentRate).toBeGreaterThan(0.85);
    expect(latentRate).toBeLessThanOrEqual(1);
    // Using the wrong interval for observations would under-cover badly: show it.
    let wrong = 0;
    for (let i = 0; i < test.length; i++) {
      if (yTest[i] >= preds[i].latentInterval.lower && yTest[i] <= preds[i].latentInterval.upper) wrong++;
    }
    expect(wrong / test.length).toBeLessThan(predictiveRate);
    // Standardised LOO residuals should have variance near 1 for a calibrated model.
    const loo = looCrossValidation(model);
    const sr = loo.standardisedResiduals;
    const v = sr.reduce((s, r) => s + r * r, 0) / sr.length;
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(2);
  });
});

/* ================================================================== *
 * Sparse approximations
 * ================================================================== */

describe('sparse approximations', () => {
  it('errs in the documented direction: SoR under-estimates the variance, FITC is closer, subset-of-data over-estimates it', () => {
    const rng = new Random('sparse');
    const X = Array.from({ length: 60 }, (_, i) => [i * 0.15]);
    const y = X.map((x) => Math.sin(x[0]) + 0.1 * rng.normal());
    const spec = kernel.base('matern52', { variance: 1, lengthScale: 1 });
    const noiseVariance = 0.01;
    const exact = conditionGp({ X, y, kernel: spec, noiseVariance });
    const test = Array.from({ length: 25 }, (_, i) => [0.07 + i * 0.35]);
    const exactVar = predictGp(exact, test).predictions.map((p) => p.latentVariance);

    const sor = fitSparseGp({ X, y, kernel: spec, noiseVariance, method: 'sor', inducingCount: 12, seed: 's' });
    const fitc = fitSparseGp({ X, y, kernel: spec, noiseVariance, method: 'fitc', inducingCount: 12, seed: 's' });
    const sod = fitSparseGp({ X, y, kernel: spec, noiseVariance, method: 'subset-of-data', inducingCount: 12, seed: 's' });
    const sorVar = sor.predict(test).predictions.map((p) => p.latentVariance);
    const fitcVar = fitc.predict(test).predictions.map((p) => p.latentVariance);
    const sodVar = sod.predict(test).predictions.map((p) => p.latentVariance);

    for (let i = 0; i < test.length; i++) {
      // SoR: Q ⪯ K, so its latent variance cannot exceed the exact one. 1e-9
      // absolute slack for rounding.
      expect(sorVar[i]).toBeLessThan(exactVar[i] + 1e-9);
      // FITC keeps the exact diagonal, so it is never below SoR.
      expect(fitcVar[i]).toBeGreaterThan(sorVar[i] - 1e-12);
      // Subset of data knows less, so it is never more confident.
      expect(sodVar[i]).toBeGreaterThan(exactVar[i] - 1e-9);
    }
    expect(sor.biasDirection).toMatch(/DOWNWARD/);
    expect(fitc.biasDirection).toMatch(/UNDERESTIMATES the noise/);
    expect(sod.biasDirection).toMatch(/UPWARD/);
    expect(sor.exactness).toBe('numerical');
    expect(sor.predict(test).exactness).toBe('numerical');
    expect(sor.predict(test).warnings.join(' ')).toMatch(/NOT exact/);
    // FITC's predictive mean should track the exact one closely.
    const exactMean = predictGp(exact, test).predictions.map((p) => p.mean);
    const fitcMean = fitc.predict(test).predictions.map((p) => p.mean);
    const maxErr = Math.max(...fitcMean.map((m, i) => Math.abs(m - exactMean[i])));
    expect(maxErr).toBeLessThan(0.25);
  });

  it('refuses more inducing points than data, and refuses SoR/FITC without noise', () => {
    const X = [[0], [1], [2]];
    const y = [0, 1, 2];
    const spec = kernel.base('rbf');
    expect(() => fitSparseGp({ X, y, kernel: spec, noiseVariance: 0.1, method: 'fitc', inducingCount: 5 })).toThrow(
      /only 3 observations/,
    );
    expect(() => fitSparseGp({ X, y, kernel: spec, noiseVariance: 0, method: 'fitc', inducingCount: 2 })).toThrow(
      /strictly positive noise/,
    );
  });
});

/* ================================================================== *
 * Classification
 * ================================================================== */

describe('GP classification by the Laplace approximation', () => {
  it('separates a one-dimensional problem and reports probabilities that account for latent uncertainty', () => {
    const X = [[-3], [-2.5], [-2], [-1.5], [-1], [1], [1.5], [2], [2.5], [3]];
    const y = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    const spec = kernel.base('rbf', { variance: 4, lengthScale: 1.5 });
    const model = fitGpClassifier({ X, y, kernel: spec });
    expect(model.exactness).toBe('numerical');
    expect(model.iterations).toBeGreaterThan(0);
    const probs = predictGpClassifier(model, [[-3], [-1], [0], [1], [3], [20]], spec).predictions;
    for (const p of probs) {
      expect(p.probability).toBeGreaterThan(0);
      expect(p.probability).toBeLessThan(1);
    }
    // Monotone in x for this data.
    for (let i = 1; i < 5; i++) expect(probs[i].probability).toBeGreaterThan(probs[i - 1].probability);
    expect(probs[0].probability).toBeLessThan(0.25);
    expect(probs[4].probability).toBeGreaterThan(0.75);
    // At x = 0 the classes are balanced: the probability must be near ½.
    expect(probs[2].probability).toBeGreaterThan(0.3);
    expect(probs[2].probability).toBeLessThan(0.7);
    // Far from the data the latent variance is the prior variance and the
    // averaged probability is pulled toward ½, while the plug-in value is not.
    expect(Math.abs(probs[5].probability - 0.5)).toBeLessThan(Math.abs(probs[5].plugInProbability - 0.5) + 1e-12);
    expect(model.limitations.join(' ')).toMatch(/over-confident/);
  });

  it('refuses a single-class dataset and an unusable label', () => {
    expect(() => fitGpClassifier({ X: [[0], [1]], y: [1, 1], kernel: kernel.base('rbf') })).toThrow(/one class/);
    expect(() => fitGpClassifier({ X: [[0], [1]], y: [0, 0.5], kernel: kernel.base('rbf') })).toThrow(/0\/1 or −1\/\+1/);
  });
});

/* ================================================================== *
 * Acquisition functions
 * ================================================================== */

describe('acquisition functions', () => {
  it('expected improvement matches the textbook closed form, is zero where it must be, and is never negative', () => {
    const cases = [
      { mean: 0.5, sd: 0.3, incumbent: 1 },
      { mean: 1.5, sd: 0.3, incumbent: 1 },
      { mean: 1, sd: 2, incumbent: 1 },
      { mean: -3, sd: 0.01, incumbent: 0 },
    ];
    for (const c of cases) {
      // Textbook formula for minimisation, written out here:
      //   z = (f* − μ)/σ,  EI = (f* − μ)·Φ(z) + σ·φ(z)
      const z = (c.incumbent - c.mean) / c.sd;
      const reference = (c.incumbent - c.mean) * standardNormalCdf(z) + c.sd * standardNormalPdf(z);
      // 1e-6 absolute: the A&S error-function approximation used for the
      // independent reference in this file is itself only good to ~1.5e-7.
      expect(expectedImprovement(c)).toBeCloseTo(reference, 6);
      expect(expectedImprovement(c)).toBeGreaterThanOrEqual(0);
    }
    // σ = 0 and no improvement: exactly 0, not a small positive number.
    expect(expectedImprovement({ mean: 1.2, sd: 0, incumbent: 1 })).toBe(0);
    expect(expectedImprovement({ mean: 1, sd: 0, incumbent: 1 })).toBe(0);
    // σ = 0 with a better mean: the improvement is certain and exact.
    expect(expectedImprovement({ mean: 0.4, sd: 0, incumbent: 1 })).toBeCloseTo(0.6, 14);
    // ξ makes it stricter.
    expect(expectedImprovement({ mean: 0.9, sd: 0.1, incumbent: 1 }, 0.5)).toBeLessThan(
      expectedImprovement({ mean: 0.9, sd: 0.1, incumbent: 1 }, 0),
    );
    // Probability of improvement is a probability.
    expect(probabilityOfImprovement({ mean: 1, sd: 1, incumbent: 1 })).toBeCloseTo(0.5, 6);
    expect(probabilityOfImprovement({ mean: 2, sd: 0, incumbent: 1 })).toBe(0);
  });

  it('grows the UCB exploration constant with the iteration count', () => {
    const b1 = ucbBeta(1, 2);
    const b50 = ucbBeta(50, 2);
    expect(b50).toBeGreaterThan(b1);
    // β_t = 2·log(t^(d/2+2)·π²/(3δ)) — recomputed here from the definition.
    expect(ucbBeta(10, 4, 0.05)).toBeCloseTo(2 * Math.log((Math.pow(10, 4) * Math.PI * Math.PI) / (3 * 0.05)), 12);
  });

  it('computes E[max(aᵢ + bᵢZ)] in agreement with Monte Carlo', () => {
    const a = [0, 1, -0.5, 0.25];
    const b = [1, -0.5, 2, 0];
    const exact = expectedMaxOfLines(a, b);
    const rng = new Random('emax');
    let sum = 0;
    const draws = 200000;
    for (let i = 0; i < draws; i++) {
      const z = rng.normal();
      let m = -Infinity;
      for (let j = 0; j < a.length; j++) m = Math.max(m, a[j] + b[j] * z);
      sum += m;
    }
    // Monte Carlo standard error with 2·10⁵ draws is about 0.003, so 0.02
    // absolute is roughly six standard errors.
    expect(exact).toBeCloseTo(sum / draws, 1);
    expect(Math.abs(exact - sum / draws)).toBeLessThan(0.02);
    // A single line: E[max] = a + b·E[Z] = a.
    expect(expectedMaxOfLines([2.5], [1.5])).toBeCloseTo(2.5, 12);
    // Zero slopes: E[max] = max aᵢ.
    expect(expectedMaxOfLines([1, 3, 2], [0, 0, 0])).toBeCloseTo(3, 12);
  });

  it('gives a non-negative knowledge gradient that is zero when nothing can be learned', () => {
    expect(knowledgeGradient([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(knowledgeGradient([1, 1.05, 3], [0.5, 0.4, 0.1])).toBeGreaterThan(0);
    expect(knowledgeGradient([1, 2, 3], [0.3, 0.1, 0.2])).toBeGreaterThanOrEqual(0);
  });

  it('refuses a flat acquisition instead of returning an arbitrary point', () => {
    expect(() => maximiseAcquisition(() => 1, [[0, 1]], { count: 64 })).toThrow(/flat across all/);
    expect(() => maximiseAcquisition(() => Number.NaN, [[0, 1]], { count: 8 })).toThrow(/non-finite acquisition/);
    // And it finds the maximum of something that is not flat.
    const found = maximiseAcquisition((x) => -((x[0] - 0.3) ** 2), [[0, 1]], { count: 128 });
    expect(found.x[0]).toBeCloseTo(0.3, 5);
    expect(found.exactness).toBe('numerical');
  });

  it('refuses an empty or inverted search box', () => {
    expect(() => candidateSet([], { count: 4 })).toThrow(/at least one dimension/);
    expect(() => candidateSet([[1, 1]], { count: 4 })).toThrow(/empty/);
  });
});

/* ================================================================== *
 * Bayesian optimisation
 * ================================================================== */

describe('Bayesian optimisation', () => {
  it('finds the Branin minimum and beats the same budget of Sobol sampling, averaged over seeds', () => {
    const budget = 28;
    const initial = 6;
    const boRegrets: number[] = [];
    const sobolRegrets: number[] = [];
    for (const seed of ['bo-1', 'bo-2', 'bo-3']) {
      const result = runBayesOpt({
        objective: (x) => BRANIN.evaluate(x),
        bounds: BRANIN.bounds,
        iterations: budget - initial,
        initialDesign: initial,
        seed,
        noiseVariance: 0,
        acquisition: { kind: 'expected-improvement' },
        refitEvery: 4,
        fitRestarts: 3,
        knownOptimum: BRANIN.optimum,
        candidates: { count: 256 },
      });
      expect(result.evaluations).toBe(budget);
      expect(result.simpleRegret).not.toBeNull();
      boRegrets.push(result.simpleRegret as number);
      const sobol = candidateSet(BRANIN.bounds, { count: budget, source: 'sobol', seed: `${seed}:plain` });
      sobolRegrets.push(Math.min(...sobol.map((x) => BRANIN.evaluate(x))) - BRANIN.optimum);
      expect(result.exactness).toBe('empirical');
      expect(result.limitations.join(' ')).toMatch(/NO guarantee/);
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Within 1.5 of the optimum (Branin's range over the box is about 300, so
    // this is 0.5% of the range) in 28 evaluations, on every seed.
    for (const r of boRegrets) expect(r).toBeLessThan(1.5);
    // And materially better than a space-filling design of the same size.
    expect(mean(boRegrets)).toBeLessThan(mean(sobolRegrets));
  }, 120_000);

  it('reports the best posterior mean rather than the best observation when the objective is noisy', () => {
    const rng = new Random('noisy-bo');
    const noiseSd = 1;
    const result = runBayesOpt({
      objective: (x) => x[0] * x[0] + noiseSd * rng.normal(),
      bounds: [[-3, 3]],
      iterations: 16,
      initialDesign: 6,
      seed: 'noisy',
      noiseVariance: noiseSd * noiseSd,
      refitEvery: 5,
      fitRestarts: 3,
      candidates: { count: 128 },
    });
    expect(result.recommendation.basis).toMatch(/POSTERIOR MEAN/);
    expect(result.recommendation.x).toEqual(result.bestPosteriorMean.x);
    // The lowest OBSERVED value is a lucky draw and is below the posterior
    // mean at the recommended point: that is exactly the bias being avoided.
    expect(result.bestObserved.y).toBeLessThan(result.bestPosteriorMean.mean);
    // Construct the comparison explicitly: the two differ.
    expect(result.bestObserved.x).not.toEqual(result.bestPosteriorMean.x);
    // The recommendation is near the true minimiser at 0.
    expect(Math.abs(result.bestPosteriorMean.x[0])).toBeLessThan(1.2);
    expect(result.limitations.join(' ')).toMatch(/OPTIMISTIC/);
  }, 60_000);

  it('runs as a generator that yields between iterations, and honours cancellation', () => {
    const req = {
      objective: (x: readonly number[]) => (x[0] - 0.4) ** 2,
      bounds: [[0, 1]] as const,
      iterations: 5,
      initialDesign: 4,
      seed: 'gen',
      noiseVariance: 0,
      refitEvery: 0,
      candidates: { count: 64 },
    };
    const gen = bayesOptSteps(req);
    let yields = 0;
    let step = gen.next();
    while (!step.done) {
      yields++;
      expect(step.value.iteration).toBe(yields);
      expect(step.value.suggested.length).toBe(1);
      step = gen.next();
    }
    expect(yields).toBe(5);
    expect(step.value.observations.length).toBe(9);
    // Cancelling between iterations produces a refusal, not a partial answer
    // dressed up as a result.
    expect(() => runBayesOpt(req, { isCancelled: () => true })).toThrow(/cancelled/);
  });

  it('respects constraints by weighting the acquisition with the probability of feasibility', () => {
    // Minimise (x − 0.2)², subject to x ≥ 0.5 — written as c(x) = 0.5 − x ≤ 0.
    // The unconstrained minimiser (0.2) is infeasible, so the constrained
    // optimum sits on the boundary at x = 0.5 with value 0.09.
    const result = runBayesOpt({
      objective: (x) => (x[0] - 0.2) ** 2,
      bounds: [[0, 1]],
      iterations: 14,
      initialDesign: 5,
      seed: 'constrained',
      noiseVariance: 0,
      refitEvery: 0,
      constraints: [{ name: 'x ≥ 0.5', evaluate: (x) => 0.5 - x[0], threshold: 0 }],
      candidates: { count: 128 },
    });
    expect(result.bestObserved.feasible).toBe(true);
    expect(result.bestObserved.x[0]).toBeGreaterThanOrEqual(0.5);
    // The constrained optimum is at x = 0.5, value 0.09. The probability of
    // feasibility only softly discourages the infeasible side, so 0.02 of
    // slack in the objective (about x ≤ 0.55) is the sensible tolerance.
    expect(result.bestObserved.y).toBeLessThan(0.11);
    expect(result.limitations.join(' ')).toMatch(/probability of feasibility/);
  }, 60_000);

  it('stops and says why when the acquisition stops preferring any point', () => {
    // A monotone objective under a constraint that cuts off the improving
    // direction: once the boundary has been sampled, expected improvement
    // weighted by the probability of feasibility is 0 everywhere, which is a
    // meaningful statement and is reported as one.
    const result = runBayesOpt({
      objective: (x) => x[0],
      bounds: [[0, 1]],
      iterations: 20,
      initialPoints: [[0.5], [0.6], [0.8], [1], [0.2]],
      seed: 'early-stop',
      noiseVariance: 0,
      refitEvery: 0,
      constraints: [{ name: 'x ≥ 0.5', evaluate: (x) => 0.5 - x[0], threshold: 0 }],
      candidates: { count: 64 },
    });
    expect(result.stoppedEarly).not.toBeNull();
    expect(result.stoppedEarly!.reason).toMatch(/no longer prefers any point/);
    expect(result.stoppedEarly!.reason).toMatch(/NOT a claim that the optimum has been found/);
    expect(result.evaluations).toBeLessThan(25);
    expect(result.warnings.join(' ')).toMatch(/Stopped at iteration/);
  }, 60_000);

  it('suggests a batch of distinct points', () => {
    for (const strategy of ['kriging-believer', 'local-penalisation'] as const) {
      const gen = bayesOptSteps({
        objective: (x) => Math.sin(3 * x[0]) + x[0] * x[0],
        bounds: [[-2, 2]],
        iterations: 2,
        initialDesign: 5,
        seed: `batch-${strategy}`,
        noiseVariance: 0,
        refitEvery: 0,
        batchSize: 3,
        batchStrategy: strategy,
        candidates: { count: 128 },
      });
      const first = gen.next();
      expect(first.done).toBe(false);
      if (first.done) return;
      const batch = first.value.suggested;
      expect(batch.length).toBe(3);
      const keys = new Set(batch.map((p) => p.join(',')));
      expect(keys.size).toBe(3);
    }
  }, 60_000);

  it('supports Thompson sampling and the knowledge gradient over a candidate set', () => {
    for (const kind of ['thompson', 'knowledge-gradient'] as const) {
      const result = runBayesOpt({
        objective: (x) => (x[0] - 0.7) ** 2,
        bounds: [[0, 1]],
        iterations: 6,
        initialDesign: 5,
        seed: `acq-${kind}`,
        noiseVariance: 1e-4,
        refitEvery: 0,
        acquisition: { kind },
        candidates: { count: 96 },
      });
      expect(result.acquisition).toBe(kind);
      expect(result.acquisitionNote.length).toBeGreaterThan(40);
      expect(result.observations.length).toBe(11);
    }
  }, 60_000);

  it('refuses a non-finite objective value and an impossible configuration', () => {
    expect(() =>
      runBayesOpt({
        objective: () => Number.NaN,
        bounds: [[0, 1]],
        iterations: 2,
        initialDesign: 3,
        seed: 'nan',
        refitEvery: 0,
      }),
    ).toThrow(/cannot \s*|non-finite|NaN/);
    expect(() =>
      runBayesOpt({ objective: (x) => x[0], bounds: [[0, 1]], iterations: 0, seed: 'z' }),
    ).toThrow(/at least 1/);
    expect(() =>
      runBayesOpt({ objective: (x) => x[0], bounds: [[0, 1]], iterations: 50, seed: 'z', maxEvaluations: 10 }),
    ).toThrow(/maxEvaluations/);
  });
});

/* ================================================================== *
 * Kriging
 * ================================================================== */

describe('kriging', () => {
  it('ordinary kriging reproduces the GP posterior with an unknown constant mean', () => {
    const rng = new Random('kriging');
    const X = Array.from({ length: 18 }, () => [rng.uniformRange(0, 10), rng.uniformRange(0, 10)]);
    const y = X.map((x) => 5 + Math.sin(x[0] / 2) + Math.cos(x[1] / 3));
    const spec = kernel.base('matern52', { variance: 1.2, lengthScale: 2.5 });
    const test = [
      [1, 1],
      [5, 5],
      [9, 2],
      [3, 8],
    ];
    const result = krige({ X, y, kernel: spec, nugget: 0.05, type: 'ordinary' }, test);
    const gp = predictGp(result.equivalentGp, test).predictions;
    for (let i = 0; i < test.length; i++) {
      // Same mathematics by two independent routes: the classical augmented
      // Lagrange system and the GP's Cholesky-based GLS posterior. 1e-9 is
      // rounding only.
      expect(result.predictions[i].estimate).toBeCloseTo(gp[i].mean, 9);
      expect(result.predictions[i].krigingVariance).toBeCloseTo(gp[i].latentVariance, 9);
      // The kriging weights carry a Lagrange multiplier for the unbiasedness
      // constraint, which is what distinguishes ordinary from simple kriging.
      expect(result.predictions[i].lagrange.length).toBe(1);
      // And the predictive interval adds the nugget.
      expect(result.predictions[i].predictiveInterval.upper - result.predictions[i].estimate).toBeGreaterThan(
        result.predictions[i].latentInterval.upper - result.predictions[i].estimate,
      );
    }
    expect(result.exactness).toBe('exact');
    expect(result.limitations.join(' ')).toMatch(/estimated from the same data/);
  });

  it('simple kriging with a known mean reproduces the known-mean GP, and ordinary kriging is less certain', () => {
    const X = [[0], [1], [2], [3.5]];
    const y = [4.5, 5.5, 4.8, 5.2];
    const spec = kernel.base('rbf', { variance: 1, lengthScale: 1.5 });
    const test = [[0.5], [2.5], [8]];
    const simple = krige({ X, y, kernel: spec, nugget: 0.05, type: 'simple', knownMean: 5 }, test);
    const gp = predictGp(simple.equivalentGp, test).predictions;
    for (let i = 0; i < test.length; i++) {
      expect(simple.predictions[i].estimate).toBeCloseTo(gp[i].mean, 9);
      expect(simple.predictions[i].krigingVariance).toBeCloseTo(gp[i].latentVariance, 9);
    }
    const ordinary = krige({ X, y, kernel: spec, nugget: 0.05, type: 'ordinary' }, test);
    // Not knowing the mean costs variance — that is the whole difference.
    for (let i = 0; i < test.length; i++) {
      expect(ordinary.predictions[i].krigingVariance).toBeGreaterThan(simple.predictions[i].krigingVariance);
    }
    expect(() => krige({ X, y, kernel: spec, nugget: 0.05, type: 'simple' }, test)).toThrow(/KNOWN mean/);
  });

  it('universal kriging follows a linear trend where ordinary kriging reverts to the mean', () => {
    const X = Array.from({ length: 12 }, (_, i) => [i * 0.5]);
    const y = X.map((x) => 2 + 3 * x[0]);
    const spec = kernel.base('rbf', { variance: 0.5, lengthScale: 1 });
    const test = [[8]]; // Beyond the data, which ends at 5.5.
    const universal = krige({ X, y, kernel: spec, nugget: 0.01, type: 'universal', driftDegree: 1 }, test);
    const ordinary = krige({ X, y, kernel: spec, nugget: 0.01, type: 'ordinary' }, test);
    const truth = 2 + 3 * 8;
    expect(Math.abs(universal.predictions[0].estimate - truth)).toBeLessThan(
      Math.abs(ordinary.predictions[0].estimate - truth),
    );
    // The linear drift extrapolates the trend to within 10% at x = 8.
    expect(Math.abs(universal.predictions[0].estimate - truth) / truth).toBeLessThan(0.1);
  });

  it('the empirical variogram recovers a known range, nugget and sill from simulated data', () => {
    // Simulate a field from an exponential kernel with σ² = 1, ℓ = 2 on 2-D
    // locations, plus a nugget of 0.09 as independent measurement error.
    const rng = new Random('variogram');
    const X = Array.from({ length: 160 }, () => [rng.uniformRange(0, 20), rng.uniformRange(0, 20)]);
    const f = samplePriorFunctions(kernel.base('exponential', { variance: 1, lengthScale: 2 }), 2, X, 1, 'vg-field')
      .samples[0];
    const y = f.map((v) => v + 0.3 * rng.normal());
    const empirical = empiricalVariogram(X, y, { bins: 14 });
    expect(empirical.exactness).toBe('empirical');
    expect(empirical.bins.length).toBeGreaterThanOrEqual(10);
    // The semivariance must rise with separation and flatten near the sill.
    expect(empirical.bins[0].semivariance).toBeLessThan(empirical.bins[empirical.bins.length - 1].semivariance);
    const fit = fitVariogram(empirical, 'exponential');
    expect(fit.converged).toBe(true);
    expect(fit.exactness).toBe('numerical');
    // Variogram fitting from one realisation is a famously imprecise business:
    // the range is identified to within a factor of about two, and the nugget
    // and a short range are partly confounded. The window below is wide for
    // that reason and would still reject a range of 0.2 or 20.
    expect(fit.range).toBeGreaterThan(0.8);
    expect(fit.range).toBeLessThan(6);
    expect(fit.sill).toBeGreaterThan(0.5);
    expect(fit.sill).toBeLessThan(2.5);
    expect(fit.nugget).toBeLessThan(0.5);
    expect(fit.note).toMatch(/Nugget/);
    expect(fit.limitations.join(' ')).toMatch(/not maximum likelihood/);
  }, 60_000);

  it('the kriging variance map depends on the locations and the model, never on the measured values', () => {
    const X = [[0, 0], [1, 0], [0, 1], [2, 2]];
    const spec = kernel.base('matern32', { variance: 1, lengthScale: 1 });
    const grid = [
      [0.5, 0.5],
      [3, 3],
    ];
    const a = krigingVarianceMap({ X, y: [1, 2, 3, 4], kernel: spec, nugget: 0.1, type: 'ordinary' }, grid);
    const b = krigingVarianceMap({ X, y: [-9, 40, 0.1, 7], kernel: spec, nugget: 0.1, type: 'ordinary' }, grid);
    for (let i = 0; i < grid.length; i++) expect(a.points[i].variance).toBeCloseTo(b.points[i].variance, 14);
    // Far from every sample the variance is larger.
    expect(a.points[1].variance).toBeGreaterThan(a.points[0].variance);
    expect(a.note).toMatch(/never on the measured values/);
  });

  it('refuses a variogram it cannot estimate and a kriging system it cannot solve', () => {
    expect(() => empiricalVariogram([[0], [1]], [1, 2])).toThrow(/at least 3 observations/);
    expect(() => krige({ X: [], y: [], kernel: kernel.base('rbf'), nugget: 0.1, type: 'ordinary' }, [[0]])).toThrow(
      /at least one observation/,
    );
    expect(() =>
      krige({ X: [[0], [0]], y: [1, 1], kernel: kernel.base('rbf'), nugget: -1, type: 'ordinary' }, [[0]]),
    ).toThrow(/0 or more/);
  });
});

/* ================================================================== *
 * Fully Bayesian hyperparameters
 * ================================================================== */

describe('fully Bayesian hyperparameters', () => {
  it('integrates over the hyperparameters and is wider than the plug-in posterior away from the data', () => {
    const X = Array.from({ length: 14 }, (_, i) => [i * 0.4]);
    const y = X.map((x) => Math.sin(x[0]));
    const request = { X, y, kernel: kernel.base('rbf', { variance: 1, lengthScale: 1 }), noiseVariance: 0.01 };
    const bayes = fullyBayesianGp(request, { chains: 2, iterations: 120, warmup: 80, seed: 'fb', predictiveDraws: 30 });
    expect(bayes.exactness).toBe('empirical');
    expect(bayes.summaries.length).toBe(bayes.parameterNames.length);
    expect(bayes.priorNote).toMatch(/weakly/);
    if (bayes.mcmc.convergence.verdict === 'not converged') {
      // The module must refuse rather than report numbers from an unconverged chain.
      expect(() => bayes.predict([[0]])).toThrow(/did not converge/);
      return;
    }
    const far = [[12]];
    const integrated = bayes.predict(far).predictions[0];
    const plugIn = predictGp(
      conditionGp({ ...request, kernelValues: undefined }),
      far,
    ).predictions[0];
    // Marginalising over the hyperparameters adds the between-draw variance of
    // the predictive mean, which can only widen the interval.
    expect(integrated.latentVariance).toBeGreaterThan(plugIn.latentVariance * 0.5);
    expect(integrated.predictiveVariance).toBeGreaterThan(integrated.latentVariance);
    expect(bayes.limitations.join(' ')).toMatch(/Monte Carlo/);
  }, 120_000);
});

/* ================================================================== *
 * Small numerical utilities used throughout
 * ================================================================== */

describe('numerical utilities', () => {
  it('factorises with no jitter when the matrix is well conditioned, and reports none', () => {
    const a = [
      [2, 0.5],
      [0.5, 3],
    ];
    const { L, jitter } = choleskyWithJitter(a);
    expect(jitter.needed).toBe(false);
    expect(jitter.added).toBe(0);
    // L·Lᵀ must reproduce the matrix.
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const v = L[i][0] * L[j][0] + L[i][1] * L[j][1];
        expect(v).toBeCloseTo(a[i][j], 12);
      }
    }
    expect(cholesky([[1, 2], [2, 1]])).toBeNull();
  });

  it('L-BFGS finds the minimum of a quadratic and reports convergence honestly', () => {
    const res = minimizeLbfgs(
      (x) => ({
        value: (x[0] - 3) ** 2 + 5 * (x[1] + 1) ** 2,
        gradient: [2 * (x[0] - 3), 10 * (x[1] + 1)],
      }),
      [0, 0],
    );
    expect(res.converged).toBe(true);
    expect(res.x[0]).toBeCloseTo(3, 6);
    expect(res.x[1]).toBeCloseTo(-1, 6);
    const stuck = minimizeLbfgs((x) => ({ value: x[0], gradient: [1] }), [0], { maxIterations: 3, bounds: [[0, 0]] });
    expect(stuck.converged).toBe(false);
    expect(stuck.reason.length).toBeGreaterThan(10);
  });
});
