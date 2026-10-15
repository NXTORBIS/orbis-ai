/**
 * n-dimensional Gaussian and Student-t copula samplers.
 *
 * Scenario models link many variables at once, so the bivariate families are
 * not enough: these samplers take a full correlation matrix, factor it once,
 * and then produce one vector of dependent uniforms per call. The t version is
 * the Gaussian one with a single shared chi-square scale, which is what gives
 * every pair tail dependence simultaneously.
 */
import { clamp } from '../core/numeric';
import { EngineError, Validator } from '../core/result';
import { normalCdf } from '../special/gamma';
import { studentT } from '../distributions/continuous';
import { choleskyWithCheck, type Matrix } from '../stats/linalg';
import type { Random } from '../random/rng';

const U_MIN = 1e-300;
const U_MAX = 1 - 1e-16;

export interface MultivariateCopulaSampler {
  dimension: number;
  /** Family and the parameters it was built with, for labelling output. */
  description: string;
  /** One draw: a vector of dependent standard uniforms. */
  sample(rng: Random): number[];
  /** Pairwise tail dependence coefficients implied by the correlation matrix. */
  tailDependence(i: number, j: number): { lower: number; upper: number };
  limitations: string[];
}

/**
 * Check that `corr` is a usable correlation matrix and return its Cholesky
 * factor. A matrix that is not positive definite is reported, never repaired
 * silently: an inconsistent set of correlations is a statement the user has to
 * fix, not something to round off.
 */
function factor(corr: Matrix): Matrix {
  const v = new Validator();
  const n = corr.length;
  if (n < 2) v.add('A multivariate copula needs at least 2 variables.', 'corr', 'insufficient');
  for (let i = 0; i < n; i++) {
    if (!corr[i] || corr[i].length !== n) {
      v.add(`The correlation matrix must be square; row ${i + 1} has the wrong length.`, 'corr', 'shape');
      v.throwIfInvalid();
    }
    if (Math.abs(corr[i][i] - 1) > 1e-12) {
      v.add(`The diagonal of a correlation matrix must be 1; entry (${i + 1}, ${i + 1}) is ${corr[i][i]}.`, 'corr', 'range');
    }
    for (let j = 0; j < n; j++) {
      if (!Number.isFinite(corr[i][j])) {
        v.add(`Correlation (${i + 1}, ${j + 1}) must be a finite number.`, 'corr', 'finite');
        continue;
      }
      if (corr[i][j] < -1 || corr[i][j] > 1) {
        v.add(`Correlation (${i + 1}, ${j + 1}) must lie in [−1, 1]; received ${corr[i][j]}.`, 'corr', 'range');
      }
      if (Math.abs(corr[i][j] - corr[j][i]) > 1e-10) {
        v.add(
          `The correlation matrix must be symmetric; (${i + 1}, ${j + 1}) = ${corr[i][j]} but (${j + 1}, ${i + 1}) = ${corr[j][i]}.`,
          'corr',
          'symmetry',
        );
      }
    }
  }
  v.throwIfInvalid();
  const chol = choleskyWithCheck(corr);
  if (!chol.ok) {
    throw new EngineError(
      'The correlation matrix is not positive definite, so no joint distribution has these correlations. Check for a set of pairwise correlations that cannot hold at the same time (for example ρ₁₂ = ρ₁₃ = 0.9 with ρ₂₃ = −0.9).',
      'notPositiveDefinite',
    );
  }
  return chol.L;
}

/** Correlated standard normals L·z. */
function correlatedNormals(L: Matrix, rng: Random): number[] {
  const n = L.length;
  const z = new Array<number>(n);
  for (let i = 0; i < n; i++) z[i] = rng.normal();
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k <= i; k++) s += L[i][k] * z[k];
    out[i] = s;
  }
  return out;
}

const clampDraw = (u: number): number => clamp(u, U_MIN, U_MAX);

/** n-dimensional Gaussian copula sampler for a given correlation matrix. */
export function gaussianCopulaSampler(corr: Matrix): MultivariateCopulaSampler {
  const L = factor(corr);
  const n = L.length;
  return {
    dimension: n,
    description: `${n}-dimensional Gaussian copula (Cholesky factor of the supplied correlation matrix)`,
    sample: (rng) => correlatedNormals(L, rng).map((x) => clampDraw(normalCdf(x))),
    tailDependence: (i, j) => {
      requireIndices(i, j, n);
      return { lower: corr[i][j] === 1 ? 1 : 0, upper: corr[i][j] === 1 ? 1 : 0 };
    },
    limitations: [
      'No tail dependence for any pair with |ρ| < 1: joint extremes across variables are as rare as the correlations alone imply.',
      'The matrix supplied is the correlation of the latent normals. It is not the Pearson correlation of the final variables once the marginal distributions are applied.',
    ],
  };
}

/**
 * n-dimensional Student-t copula sampler. One chi-square draw is shared by all
 * coordinates of a vector, which is what couples their extremes.
 */
export function tCopulaSampler(corr: Matrix, nu: number): MultivariateCopulaSampler {
  if (!Number.isFinite(nu) || nu <= 0) {
    throw new EngineError(`The degrees of freedom must be greater than 0; received ${nu}.`, 'range');
  }
  const L = factor(corr);
  const n = L.length;
  const params = { nu, mu: 0, sigma: 1 };
  return {
    dimension: n,
    description: `${n}-dimensional Student-t copula with ν = ${nu}`,
    sample(rng) {
      const w = 2 * rng.gamma(nu / 2);
      if (!(w > 0)) {
        throw new EngineError('The chi-square draw underflowed to zero; try a larger ν.', 'numerical');
      }
      const scale = Math.sqrt(nu / w);
      return correlatedNormals(L, rng).map((x) => clampDraw(studentT.cdf(x * scale, params)));
    },
    tailDependence(i, j) {
      requireIndices(i, j, n);
      const rho = corr[i][j];
      if (rho <= -1) return { lower: 0, upper: 0 };
      const arg = -Math.sqrt(((nu + 1) * (1 - rho)) / (1 + rho));
      const lambda = clamp(2 * studentT.cdf(arg, { nu: nu + 1, mu: 0, sigma: 1 }), 0, 1);
      return { lower: lambda, upper: lambda };
    },
    limitations: [
      'A single ν governs every pair, so all pairs share the same tail heaviness; pair-specific tail dependence cannot be expressed.',
      'Tail dependence is symmetric: the model cannot have joint losses cluster without joint gains clustering equally.',
      'The matrix supplied is the correlation parameter of the latent t vector, not the Pearson correlation of the final variables.',
    ],
  };
}

function requireIndices(i: number, j: number, n: number): void {
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= n || j >= n) {
    throw new EngineError(`Variable indices must be whole numbers in [0, ${n - 1}].`, 'range');
  }
}
