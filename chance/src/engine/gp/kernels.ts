/**
 * Covariance kernels for Gaussian processes.
 *
 * ## Smoothness is a prior, and it is a strong one
 *
 * The kernel is the entire prior over functions. Its most consequential
 * content is the SMOOTHNESS it assumes, and every definition below states it:
 *
 *  - The squared-exponential (RBF) kernel makes sample paths infinitely
 *    differentiable. That is an extremely strong assumption and is almost
 *    never justified by anything the user knows about their problem; it
 *    produces over-confident extrapolation and over-smoothed fits.
 *  - **Matérn 5/2 is the safer default.** Its sample paths are twice
 *    differentiable, which is enough for gradient-based reasoning without
 *    asserting analyticity. Stein (1999) recommends exactly this.
 *  - Matérn 1/2 (= the exponential / Ornstein–Uhlenbeck kernel) gives
 *    continuous but nowhere-differentiable paths: the right choice for rough
 *    data, and a bad one for anything believed smooth.
 *
 * ## Parameters
 *
 * Every kernel exposes a flat list of parameter "slots". A slot is positive
 * (optimised in log space), trainable (or fixed, like Matérn's ν and the
 * polynomial degree) and possibly one of a per-dimension group — which is
 * what automatic relevance determination is: one length scale per input
 * dimension, whose fitted values rank the inputs by importance.
 *
 * ## Composition
 *
 * Kernels compose: sums express additive structure (trend + seasonality +
 * noise), products express interaction (a periodic component whose amplitude
 * decays), and scaling sets amplitude. Composition is where GPs become
 * expressive, so it is a first-class part of the API, not an internal detail.
 *
 * ## Gradients
 *
 * Each kernel supplies ANALYTIC derivatives with respect to every trainable
 * parameter. The marginal-likelihood optimiser depends on them; finite
 * differences on an O(n³) objective are both slow and inaccurate, and a wrong
 * gradient silently produces a badly fitted model rather than an error. The
 * tests check every analytic gradient against central finite differences.
 */
import { EngineError } from '../core/result';
import { besselK } from './bessel';

export type KernelId =
  | 'rbf'
  | 'matern12'
  | 'matern32'
  | 'matern52'
  | 'matern'
  | 'rational-quadratic'
  | 'exponential'
  | 'periodic'
  | 'locally-periodic'
  | 'linear'
  | 'polynomial'
  | 'white'
  | 'constant';

export interface KernelParamSpec {
  readonly name: string;
  readonly label: string;
  /** Must be strictly positive; fitted in log space. */
  readonly positive: boolean;
  /** One value per input dimension (automatic relevance determination). */
  readonly perDimension: boolean;
  /** False for parameters this module will not fit (ν, polynomial degree). */
  readonly trainable: boolean;
  readonly defaultValue: number;
  readonly description: string;
}

export interface KernelDef {
  readonly id: KernelId;
  readonly name: string;
  readonly description: string;
  readonly params: readonly KernelParamSpec[];
  readonly formula: string;
  /** What this kernel assumes about the smoothness of the function. */
  readonly smoothness: string;
  /** Mean-square differentiability of sample paths, or null when not finite. */
  readonly meanSquareDerivatives: number | null;
  readonly stationary: boolean;
  readonly limitations: readonly string[];
  /** Set when this kernel is a recommended or a discouraged default. */
  readonly guidance?: string;
}

export interface ParamSlot {
  /** Unique flat name, e.g. "rbf.lengthScale[1]". */
  readonly name: string;
  /** Parameter name within its kernel, e.g. "lengthScale". */
  readonly base: string;
  /** Dimension index for a per-dimension parameter, else null. */
  readonly dimension: number | null;
  readonly positive: boolean;
  readonly trainable: boolean;
  /** Which kernel in the composition the slot belongs to. */
  readonly kernelId: KernelId | 'sum' | 'product' | 'scale';
  readonly path: string;
}

export type KernelSpec =
  | { readonly kind: 'base'; readonly id: KernelId; readonly params?: Readonly<Record<string, number | readonly number[]>> }
  | { readonly kind: 'sum'; readonly terms: readonly KernelSpec[] }
  | { readonly kind: 'product'; readonly terms: readonly KernelSpec[] }
  | { readonly kind: 'scale'; readonly variance: number; readonly term: KernelSpec };

/* ------------------------------------------------------------------ *
 * Definitions
 * ------------------------------------------------------------------ */

const variance = (dflt = 1): KernelParamSpec => ({
  name: 'variance',
  label: 'Signal variance σ²',
  positive: true,
  perDimension: false,
  trainable: true,
  defaultValue: dflt,
  description: 'Prior variance of the function at any single point: k(x, x) = σ².',
});

const lengthScale = (name = 'lengthScale', label = 'Length scale ℓ'): KernelParamSpec => ({
  name,
  label,
  positive: true,
  perDimension: true,
  trainable: true,
  defaultValue: 1,
  description:
    'Distance over which the function decorrelates, one value per input dimension. The fitted values rank input relevance (ARD).',
});

const SMOOTH_RBF =
  'Sample paths are infinitely mean-square differentiable (analytic). This is the strongest smoothness prior available and is usually unjustified: it makes the posterior extrapolate confidently and over-smooths real data. Prefer Matérn 5/2 unless analyticity is actually known.';

export const KERNEL_DEFS: Readonly<Record<KernelId, KernelDef>> = {
  rbf: {
    id: 'rbf',
    name: 'Squared exponential (RBF)',
    description:
      'The default of convenience in most software. Smooth, stationary, infinitely differentiable, and for that reason a stronger assumption than most problems support.',
    params: [variance(), lengthScale()],
    formula: 'k(a, b) = σ²·exp(−½·r²),  r² = Σᵢ (aᵢ − bᵢ)² / ℓᵢ²',
    smoothness: SMOOTH_RBF,
    meanSquareDerivatives: null,
    stationary: true,
    limitations: [
      'Assumes analyticity: an infinitely differentiable function. Very few measured processes are.',
      'Reverts to the prior mean quickly outside the data, so extrapolation is confidently flat.',
    ],
    guidance: 'Discouraged as a default. Matérn 5/2 makes a weaker and more defensible assumption.',
  },
  matern12: {
    id: 'matern12',
    name: 'Matérn ν = 1/2 (exponential)',
    description:
      'The roughest Matérn. Identical to the exponential / Ornstein–Uhlenbeck kernel: continuous sample paths that are nowhere differentiable.',
    params: [variance(), lengthScale()],
    formula: 'k(a, b) = σ²·exp(−r)',
    smoothness:
      'Sample paths are continuous but NOT mean-square differentiable. Appropriate for genuinely rough processes; it will under-smooth data that is actually smooth.',
    meanSquareDerivatives: 0,
    stationary: true,
    limitations: ['No derivative exists, so a GP with this kernel cannot support derivative reasoning.'],
  },
  matern32: {
    id: 'matern32',
    name: 'Matérn ν = 3/2',
    description: 'Once-differentiable sample paths. A middle choice between the exponential and Matérn 5/2.',
    params: [variance(), lengthScale()],
    formula: 'k(a, b) = σ²·(1 + √3·r)·exp(−√3·r)',
    smoothness: 'Sample paths are once mean-square differentiable.',
    meanSquareDerivatives: 1,
    stationary: true,
    limitations: ['Still rough enough that second derivatives do not exist.'],
  },
  matern52: {
    id: 'matern52',
    name: 'Matérn ν = 5/2',
    description:
      'Twice-differentiable sample paths: smooth enough for gradient-based reasoning without asserting analyticity.',
    params: [variance(), lengthScale()],
    formula: 'k(a, b) = σ²·(1 + √5·r + 5r²/3)·exp(−√5·r)',
    smoothness: 'Sample paths are twice mean-square differentiable — the usual recommended compromise (Stein, 1999).',
    meanSquareDerivatives: 2,
    stationary: true,
    limitations: ['Like every stationary kernel, it assumes the same roughness everywhere in the input space.'],
    guidance: 'The recommended default for this module.',
  },
  matern: {
    id: 'matern',
    name: 'Matérn, general ν',
    description:
      'The whole Matérn family through the modified Bessel function K_ν. ν controls smoothness: ⌈ν⌉ − 1 mean-square derivatives exist.',
    params: [
      variance(),
      lengthScale(),
      {
        name: 'nu',
        label: 'Smoothness ν',
        positive: true,
        perDimension: false,
        trainable: false,
        defaultValue: 2.5,
        description:
          'Smoothness order. NOT fitted: the derivative of K_ν with respect to its order is not implemented here, so ν is held fixed. Choose it by comparing the marginal likelihood over a grid of ν instead.',
      },
    ],
    formula: 'k(a, b) = σ²·2^(1−ν)/Γ(ν)·(√(2ν)·r)^ν·K_ν(√(2ν)·r)',
    smoothness:
      'Sample paths are ⌈ν⌉ − 1 times mean-square differentiable. ν = 1/2 gives the exponential kernel and ν → ∞ gives the RBF kernel, so ν is literally a smoothness dial.',
    meanSquareDerivatives: null,
    stationary: true,
    limitations: [
      'ν is fixed, not fitted: no analytic ∂K_ν/∂ν is implemented and this module will not fit a parameter whose gradient it cannot compute.',
      'Each evaluation costs a numerical quadrature of the Bessel integral, so this kernel is far slower than the ν = 1/2, 3/2, 5/2 closed forms.',
    ],
  },
  'rational-quadratic': {
    id: 'rational-quadratic',
    name: 'Rational quadratic',
    description:
      'A scale mixture of RBF kernels with Gamma-distributed inverse square length scales: it models variation on several length scales at once. α → ∞ recovers the RBF kernel.',
    params: [
      variance(),
      lengthScale(),
      {
        name: 'alpha',
        label: 'Scale-mixture α',
        positive: true,
        perDimension: false,
        trainable: true,
        defaultValue: 1,
        description: 'Smaller α mixes a wider range of length scales; α → ∞ collapses to the RBF kernel.',
      },
    ],
    formula: 'k(a, b) = σ²·(1 + r²/(2α))^(−α)',
    smoothness: 'Infinitely mean-square differentiable, like the RBF kernel it mixes — the same strong assumption.',
    meanSquareDerivatives: null,
    stationary: true,
    limitations: [
      'α and the length scale are only weakly identified together; expect a flat ridge in the marginal likelihood.',
      'Inherits the RBF kernel’s analyticity assumption.',
    ],
  },
  exponential: {
    id: 'exponential',
    name: 'Exponential (Ornstein–Uhlenbeck)',
    description:
      'The covariance of the Ornstein–Uhlenbeck process. Mathematically identical to Matérn ν = 1/2; offered separately because that is how it is named in time-series work.',
    params: [variance(), lengthScale()],
    formula: 'k(a, b) = σ²·exp(−r)',
    smoothness: 'Continuous, nowhere differentiable sample paths — a Markov process in one dimension.',
    meanSquareDerivatives: 0,
    stationary: true,
    limitations: ['Identical to Matérn ν = 1/2: the two ids are aliases of the same function.'],
  },
  periodic: {
    id: 'periodic',
    name: 'Periodic (exp-sine-squared)',
    description: 'Exactly repeating structure with a fitted period. MacKay’s warping of the RBF kernel onto a circle.',
    params: [
      variance(),
      lengthScale(),
      {
        name: 'period',
        label: 'Period p',
        positive: true,
        perDimension: true,
        trainable: true,
        defaultValue: 1,
        description: 'Repeat interval, one per input dimension.',
      },
    ],
    formula: 'k(a, b) = σ²·exp(−2·Σᵢ sin²(π(aᵢ − bᵢ)/pᵢ) / ℓᵢ²)',
    smoothness: 'Infinitely differentiable AND exactly periodic: the function is asserted to repeat forever, without decay.',
    meanSquareDerivatives: null,
    stationary: true,
    limitations: [
      'Asserts exact, undecaying periodicity. Real seasonality drifts; multiply by an RBF kernel (locally periodic) instead.',
      'The period is badly multimodal in the marginal likelihood — harmonics of the true period are local optima. Use many restarts.',
    ],
  },
  'locally-periodic': {
    id: 'locally-periodic',
    name: 'Locally periodic',
    description:
      'A periodic kernel multiplied by a squared exponential, so the repeating pattern is allowed to drift. Usually what is wanted when "seasonal" is said.',
    params: [
      variance(),
      lengthScale('lengthScale', 'Periodic length scale ℓ'),
      {
        name: 'period',
        label: 'Period p',
        positive: true,
        perDimension: true,
        trainable: true,
        defaultValue: 1,
        description: 'Repeat interval, one per input dimension.',
      },
      lengthScale('decayLengthScale', 'Decay length scale ℓ_d'),
    ],
    formula: 'k(a, b) = σ²·exp(−2·Σᵢ sin²(π dᵢ/pᵢ)/ℓᵢ² − ½·Σᵢ dᵢ²/ℓ_dᵢ²),  dᵢ = aᵢ − bᵢ',
    smoothness: 'Infinitely differentiable; periodic locally and decorrelating over ℓ_d.',
    meanSquareDerivatives: null,
    stationary: true,
    limitations: ['Four parameter groups in one kernel: expect a multimodal and weakly identified fit.'],
  },
  linear: {
    id: 'linear',
    name: 'Linear (dot product)',
    description:
      'A GP with this kernel is Bayesian linear regression. Non-stationary: the variance grows away from the origin.',
    params: [
      variance(),
      {
        name: 'bias',
        label: 'Bias variance σ₀²',
        positive: true,
        perDimension: false,
        trainable: true,
        defaultValue: 1,
        description: 'Prior variance of the intercept.',
      },
      lengthScale(),
    ],
    formula: 'k(a, b) = σ₀² + σ²·Σᵢ aᵢbᵢ/ℓᵢ²',
    smoothness: 'Sample paths are exactly linear — infinitely differentiable but with no local flexibility at all.',
    meanSquareDerivatives: null,
    stationary: false,
    limitations: [
      'Not stationary: k(x, x) depends on x, so the prior variance grows with distance from the origin, and so does the posterior.',
      'Alone it can only represent a straight line; useful mainly as a trend term in a sum.',
    ],
  },
  polynomial: {
    id: 'polynomial',
    name: 'Polynomial',
    description: 'The linear kernel raised to an integer degree: a GP over polynomials of that degree.',
    params: [
      variance(),
      {
        name: 'bias',
        label: 'Bias σ₀²',
        positive: true,
        perDimension: false,
        trainable: true,
        defaultValue: 1,
        description: 'Offset inside the power; must stay positive to keep the kernel positive semi-definite.',
      },
      lengthScale(),
      {
        name: 'degree',
        label: 'Degree',
        positive: true,
        perDimension: false,
        trainable: false,
        defaultValue: 2,
        description: 'Polynomial degree, a fixed whole number. Not fitted — it is a discrete structural choice.',
      },
    ],
    formula: 'k(a, b) = (σ₀² + σ²·Σᵢ aᵢbᵢ/ℓᵢ²)^d',
    smoothness: 'Polynomial sample paths of degree d.',
    meanSquareDerivatives: null,
    stationary: false,
    limitations: [
      'Not stationary, and the variance grows like |x|^(2d): extrapolation explodes.',
      'Numerically poorly conditioned for d greater than about 3.',
    ],
  },
  white: {
    id: 'white',
    name: 'White noise',
    description:
      'Independent variance on identical inputs only. Used inside a sum to represent observation noise as part of the kernel rather than as a separate σ².',
    params: [variance()],
    formula: 'k(a, b) = σ²·1{a = b}',
    smoothness: 'No smoothness whatsoever: the function is discontinuous everywhere.',
    meanSquareDerivatives: 0,
    stationary: true,
    limitations: [
      'Compares inputs for exact equality. Two distinct inputs that are merely very close are NOT treated as the same point, so this kernel does not regularise near-duplicates — jitter does.',
      'A white-noise term inside the kernel and the model’s separate noise variance are not distinguishable from data; do not fit both.',
    ],
  },
  constant: {
    id: 'constant',
    name: 'Constant',
    description: 'A constant covariance: an unknown offset shared by every point. Used in sums to give the GP a free mean level.',
    params: [variance()],
    formula: 'k(a, b) = σ²',
    smoothness: 'Sample paths are constant functions.',
    meanSquareDerivatives: null,
    stationary: true,
    limitations: ['Rank one: on its own the covariance matrix is singular and will need jitter or an explicit mean function.'],
  },
};

export const KERNEL_IDS = Object.keys(KERNEL_DEFS) as KernelId[];

/** The default recommended by this module, and why. */
export const DEFAULT_KERNEL_ID: KernelId = 'matern52';

/* ------------------------------------------------------------------ *
 * Compiled kernels
 * ------------------------------------------------------------------ */

interface Node {
  readonly slots: readonly ParamSlot[];
  readonly defaults: readonly number[];
  readonly defs: readonly KernelDef[];
  readonly stationary: boolean;
  readonly label: string;
  k(v: readonly number[], off: number, a: readonly number[], b: readonly number[]): number;
  /** Adds ∂k/∂θ into out[off + j] for each slot j of this node. */
  grad(v: readonly number[], off: number, a: readonly number[], b: readonly number[], out: number[], scale: number): void;
}

export interface Kernel {
  readonly dimension: number;
  readonly slots: readonly ParamSlot[];
  readonly values: readonly number[];
  readonly defs: readonly KernelDef[];
  readonly stationary: boolean;
  readonly label: string;
  readonly spec: KernelSpec;
  k(a: readonly number[], b: readonly number[]): number;
  /** ∂k(a,b)/∂θⱼ for every slot j, in slot order. */
  grad(a: readonly number[], b: readonly number[]): number[];
  withValues(values: readonly number[]): Kernel;
  /** Indices of trainable slots, in slot order. */
  readonly trainableIndices: readonly number[];
  /** Slots holding per-dimension length scales, for the ARD report. */
  readonly lengthScaleSlots: readonly number[];
}

function squaredDistanceScaled(a: readonly number[], b: readonly number[], v: readonly number[], lsOff: number, d: number): number {
  let s = 0;
  for (let i = 0; i < d; i++) {
    const diff = a[i] - b[i];
    const l = v[lsOff + i];
    s += (diff * diff) / (l * l);
  }
  return s;
}

function paramSlots(def: KernelDef, d: number, path: string): { slots: ParamSlot[]; defaults: number[]; offsets: Record<string, number> } {
  const slots: ParamSlot[] = [];
  const defaults: number[] = [];
  const offsets: Record<string, number> = {};
  for (const p of def.params) {
    offsets[p.name] = slots.length;
    if (p.perDimension) {
      for (let i = 0; i < d; i++) {
        slots.push({
          name: `${path}.${p.name}[${i}]`,
          base: p.name,
          dimension: i,
          positive: p.positive,
          trainable: p.trainable,
          kernelId: def.id,
          path,
        });
        defaults.push(p.defaultValue);
      }
    } else {
      slots.push({
        name: `${path}.${p.name}`,
        base: p.name,
        dimension: null,
        positive: p.positive,
        trainable: p.trainable,
        kernelId: def.id,
        path,
      });
      defaults.push(p.defaultValue);
    }
  }
  return { slots, defaults, offsets };
}

function buildBase(
  id: KernelId,
  d: number,
  path: string,
  overrides: Readonly<Record<string, number | readonly number[]>> | undefined,
): Node {
  const def = KERNEL_DEFS[id];
  if (!def) throw new EngineError(`Unknown kernel id "${String(id)}".`, 'unknown');
  const { slots, defaults, offsets } = paramSlots(def, d, path);
  if (overrides) {
    for (const [name, value] of Object.entries(overrides)) {
      const spec = def.params.find((p) => p.name === name);
      if (!spec) {
        throw new EngineError(`Kernel "${def.name}" has no parameter named "${name}".`, 'unknown');
      }
      const off = offsets[name];
      if (spec.perDimension) {
        const arr = typeof value === 'number' ? new Array<number>(d).fill(value) : Array.from(value);
        if (arr.length !== d) {
          throw new EngineError(
            `Parameter "${name}" of kernel "${def.name}" is per-dimension and needs ${d} values (one per input dimension); received ${arr.length}.`,
            'length',
          );
        }
        for (let i = 0; i < d; i++) defaults[off + i] = arr[i];
      } else {
        if (typeof value !== 'number') {
          throw new EngineError(`Parameter "${name}" of kernel "${def.name}" is a single number.`, 'invalid');
        }
        defaults[off] = value;
      }
    }
  }
  const base = { slots, defaults, defs: [def], stationary: def.stationary, label: def.name };

  switch (id) {
    case 'rbf': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      return {
        ...base,
        k(v, off, a, b) {
          const r2 = squaredDistanceScaled(a, b, v, off + lOff, d);
          return v[off + vOff] * Math.exp(-0.5 * r2);
        },
        grad(v, off, a, b, out, scale) {
          const r2 = squaredDistanceScaled(a, b, v, off + lOff, d);
          const e = Math.exp(-0.5 * r2);
          const kv = v[off + vOff] * e;
          out[off + vOff] += scale * e;
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const l = v[off + lOff + i];
            out[off + lOff + i] += scale * kv * ((diff * diff) / (l * l * l));
          }
        },
      };
    }
    case 'matern12':
    case 'exponential': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      return {
        ...base,
        k(v, off, a, b) {
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          return v[off + vOff] * Math.exp(-r);
        },
        grad(v, off, a, b, out, scale) {
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          const e = Math.exp(-r);
          const kv = v[off + vOff] * e;
          out[off + vOff] += scale * e;
          if (r > 0) {
            for (let i = 0; i < d; i++) {
              const diff = a[i] - b[i];
              const l = v[off + lOff + i];
              out[off + lOff + i] += scale * kv * ((diff * diff) / (l * l * l * r));
            }
          }
          // At r = 0 the kernel equals σ² exactly and is flat in ℓ: gradient 0.
        },
      };
    }
    case 'matern32': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      const R3 = Math.sqrt(3);
      return {
        ...base,
        k(v, off, a, b) {
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          const s = R3 * r;
          return v[off + vOff] * (1 + s) * Math.exp(-s);
        },
        grad(v, off, a, b, out, scale) {
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          const s = R3 * r;
          const e = Math.exp(-s);
          out[off + vOff] += scale * (1 + s) * e;
          // dk/dℓᵢ = σ²·3·e^{−s}·dᵢ²/ℓᵢ³  (the 1/r from dr/dℓ cancels).
          const sig = v[off + vOff];
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const l = v[off + lOff + i];
            out[off + lOff + i] += scale * sig * 3 * e * ((diff * diff) / (l * l * l));
          }
        },
      };
    }
    case 'matern52': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      const R5 = Math.sqrt(5);
      return {
        ...base,
        k(v, off, a, b) {
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          const s = R5 * r;
          return v[off + vOff] * (1 + s + (s * s) / 3) * Math.exp(-s);
        },
        grad(v, off, a, b, out, scale) {
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          const s = R5 * r;
          const e = Math.exp(-s);
          out[off + vOff] += scale * (1 + s + (s * s) / 3) * e;
          // dk/dℓᵢ = σ²·(5/3)·(1 + s)·e^{−s}·dᵢ²/ℓᵢ³  (r cancels again).
          const sig = v[off + vOff];
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const l = v[off + lOff + i];
            out[off + lOff + i] += scale * sig * ((5 * (1 + s)) / 3) * e * ((diff * diff) / (l * l * l));
          }
        },
      };
    }
    case 'matern': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      const nuOff = offsets.nu;
      const prefactor = (nu: number): number =>
        Math.exp((1 - nu) * Math.LN2 - logGammaLocal(nu));
      return {
        ...base,
        k(v, off, a, b) {
          const nu = v[off + nuOff];
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          if (r === 0) return v[off + vOff];
          const x = Math.sqrt(2 * nu) * r;
          return v[off + vOff] * prefactor(nu) * Math.pow(x, nu) * besselK(nu, x);
        },
        grad(v, off, a, b, out, scale) {
          const nu = v[off + nuOff];
          const r = Math.sqrt(squaredDistanceScaled(a, b, v, off + lOff, d));
          if (r === 0) {
            out[off + vOff] += scale;
            return;
          }
          const c = Math.sqrt(2 * nu);
          const x = c * r;
          const pf = prefactor(nu);
          const shape = pf * Math.pow(x, nu) * besselK(nu, x);
          out[off + vOff] += scale * shape;
          // d/dx [x^ν K_ν(x)] = −x^ν K_{ν−1}(x), and K_{−a} = K_a.
          const dkdr = -v[off + vOff] * pf * Math.pow(x, nu) * besselK(nu - 1, x) * c;
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const l = v[off + lOff + i];
            const drdl = -(diff * diff) / (l * l * l * r);
            out[off + lOff + i] += scale * dkdr * drdl;
          }
          // ν is not trainable: no gradient is produced for it.
        },
      };
    }
    case 'rational-quadratic': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      const aOff = offsets.alpha;
      return {
        ...base,
        k(v, off, a, b) {
          const r2 = squaredDistanceScaled(a, b, v, off + lOff, d);
          const alpha = v[off + aOff];
          return v[off + vOff] * Math.pow(1 + r2 / (2 * alpha), -alpha);
        },
        grad(v, off, a, b, out, scale) {
          const r2 = squaredDistanceScaled(a, b, v, off + lOff, d);
          const alpha = v[off + aOff];
          const sig = v[off + vOff];
          const u = r2 / (2 * alpha);
          const base1 = 1 + u;
          const shape = Math.pow(base1, -alpha);
          out[off + vOff] += scale * shape;
          const dkdr2 = (-sig * Math.pow(base1, -alpha - 1)) / 2;
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const l = v[off + lOff + i];
            out[off + lOff + i] += scale * dkdr2 * (-2 * (diff * diff)) / (l * l * l);
          }
          // ∂k/∂α = k·(−ln(1+u) + u/(1+u))
          out[off + aOff] += scale * sig * shape * (-Math.log(base1) + u / base1);
        },
      };
    }
    case 'periodic': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      const pOff = offsets.period;
      return {
        ...base,
        k(v, off, a, b) {
          let e = 0;
          for (let i = 0; i < d; i++) {
            const t = (Math.PI * (a[i] - b[i])) / v[off + pOff + i];
            const s = Math.sin(t);
            const l = v[off + lOff + i];
            e += (2 * s * s) / (l * l);
          }
          return v[off + vOff] * Math.exp(-e);
        },
        grad(v, off, a, b, out, scale) {
          let e = 0;
          for (let i = 0; i < d; i++) {
            const t = (Math.PI * (a[i] - b[i])) / v[off + pOff + i];
            const s = Math.sin(t);
            const l = v[off + lOff + i];
            e += (2 * s * s) / (l * l);
          }
          const shape = Math.exp(-e);
          const kv = v[off + vOff] * shape;
          out[off + vOff] += scale * shape;
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const p = v[off + pOff + i];
            const l = v[off + lOff + i];
            const t = (Math.PI * diff) / p;
            const s = Math.sin(t);
            const c = Math.cos(t);
            out[off + lOff + i] += scale * kv * ((4 * s * s) / (l * l * l));
            out[off + pOff + i] += scale * kv * ((4 * Math.PI * diff * s * c) / (l * l * p * p));
          }
        },
      };
    }
    case 'locally-periodic': {
      const vOff = offsets.variance;
      const lOff = offsets.lengthScale;
      const pOff = offsets.period;
      const dOff = offsets.decayLengthScale;
      return {
        ...base,
        k(v, off, a, b) {
          let e = 0;
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const t = (Math.PI * diff) / v[off + pOff + i];
            const s = Math.sin(t);
            const l = v[off + lOff + i];
            const ld = v[off + dOff + i];
            e += (2 * s * s) / (l * l) + (0.5 * diff * diff) / (ld * ld);
          }
          return v[off + vOff] * Math.exp(-e);
        },
        grad(v, off, a, b, out, scale) {
          let e = 0;
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const t = (Math.PI * diff) / v[off + pOff + i];
            const s = Math.sin(t);
            const l = v[off + lOff + i];
            const ld = v[off + dOff + i];
            e += (2 * s * s) / (l * l) + (0.5 * diff * diff) / (ld * ld);
          }
          const shape = Math.exp(-e);
          const kv = v[off + vOff] * shape;
          out[off + vOff] += scale * shape;
          for (let i = 0; i < d; i++) {
            const diff = a[i] - b[i];
            const p = v[off + pOff + i];
            const l = v[off + lOff + i];
            const ld = v[off + dOff + i];
            const t = (Math.PI * diff) / p;
            const s = Math.sin(t);
            const c = Math.cos(t);
            out[off + lOff + i] += scale * kv * ((4 * s * s) / (l * l * l));
            out[off + pOff + i] += scale * kv * ((4 * Math.PI * diff * s * c) / (l * l * p * p));
            out[off + dOff + i] += scale * kv * ((diff * diff) / (ld * ld * ld));
          }
        },
      };
    }
    case 'linear': {
      const vOff = offsets.variance;
      const bOff = offsets.bias;
      const lOff = offsets.lengthScale;
      return {
        ...base,
        k(v, off, a, b) {
          let dot = 0;
          for (let i = 0; i < d; i++) {
            const l = v[off + lOff + i];
            dot += (a[i] * b[i]) / (l * l);
          }
          return v[off + bOff] + v[off + vOff] * dot;
        },
        grad(v, off, a, b, out, scale) {
          let dot = 0;
          for (let i = 0; i < d; i++) {
            const l = v[off + lOff + i];
            dot += (a[i] * b[i]) / (l * l);
          }
          out[off + vOff] += scale * dot;
          out[off + bOff] += scale;
          const sig = v[off + vOff];
          for (let i = 0; i < d; i++) {
            const l = v[off + lOff + i];
            out[off + lOff + i] += scale * sig * (-2 * a[i] * b[i]) / (l * l * l);
          }
        },
      };
    }
    case 'polynomial': {
      const vOff = offsets.variance;
      const bOff = offsets.bias;
      const lOff = offsets.lengthScale;
      const degOff = offsets.degree;
      return {
        ...base,
        k(v, off, a, b) {
          let dot = 0;
          for (let i = 0; i < d; i++) {
            const l = v[off + lOff + i];
            dot += (a[i] * b[i]) / (l * l);
          }
          return Math.pow(v[off + bOff] + v[off + vOff] * dot, v[off + degOff]);
        },
        grad(v, off, a, b, out, scale) {
          let dot = 0;
          for (let i = 0; i < d; i++) {
            const l = v[off + lOff + i];
            dot += (a[i] * b[i]) / (l * l);
          }
          const deg = v[off + degOff];
          const inner = v[off + bOff] + v[off + vOff] * dot;
          const outer = deg * Math.pow(inner, deg - 1);
          out[off + vOff] += scale * outer * dot;
          out[off + bOff] += scale * outer;
          const sig = v[off + vOff];
          for (let i = 0; i < d; i++) {
            const l = v[off + lOff + i];
            out[off + lOff + i] += scale * outer * sig * (-2 * a[i] * b[i]) / (l * l * l);
          }
        },
      };
    }
    case 'white': {
      const vOff = offsets.variance;
      return {
        ...base,
        k(v, off, a, b) {
          return sameInput(a, b, d) ? v[off + vOff] : 0;
        },
        grad(_v, off, a, b, out, scale) {
          if (sameInput(a, b, d)) out[off + vOff] += scale;
        },
      };
    }
    case 'constant': {
      const vOff = offsets.variance;
      return {
        ...base,
        k(v, off) {
          return v[off + vOff];
        },
        grad(_v, off, _a, _b, out, scale) {
          out[off + vOff] += scale;
        },
      };
    }
    default: {
      // Exhaustive by construction; keeps the switch honest if a KernelId is added.
      throw new EngineError(`Kernel "${String(id)}" has a definition but no implementation.`, 'unknown');
    }
  }
}

function sameInput(a: readonly number[], b: readonly number[], d: number): boolean {
  for (let i = 0; i < d; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Lanczos log-Γ, duplicated here only to keep the kernel file free of cycles. */
function logGammaLocal(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGammaLocal(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function buildNode(spec: KernelSpec, d: number, path: string): Node {
  if (spec.kind === 'base') return buildBase(spec.id, d, path, spec.params);
  if (spec.kind === 'scale') {
    const inner = buildNode(spec.term, d, `${path}.term`);
    const slot: ParamSlot = {
      name: `${path}.scaleVariance`,
      base: 'scaleVariance',
      dimension: null,
      positive: true,
      trainable: true,
      kernelId: 'scale',
      path,
    };
    const slots = [slot, ...inner.slots];
    const defaults = [spec.variance, ...inner.defaults];
    return {
      slots,
      defaults,
      defs: inner.defs,
      stationary: inner.stationary,
      label: `${spec.variance} × (${inner.label})`,
      k(v, off, a, b) {
        return v[off] * inner.k(v, off + 1, a, b);
      },
      grad(v, off, a, b, out, scale) {
        out[off] += scale * inner.k(v, off + 1, a, b);
        inner.grad(v, off + 1, a, b, out, scale * v[off]);
      },
    };
  }
  const terms = spec.terms.map((t, i) => buildNode(t, d, `${path}.${spec.kind}${i}`));
  if (terms.length === 0) {
    throw new EngineError(`A kernel ${spec.kind} needs at least one term.`, 'required');
  }
  const slots = terms.flatMap((t) => t.slots);
  const defaults = terms.flatMap((t) => t.defaults);
  const defs = terms.flatMap((t) => t.defs);
  const offsets: number[] = [];
  let acc = 0;
  for (const t of terms) {
    offsets.push(acc);
    acc += t.slots.length;
  }
  if (spec.kind === 'sum') {
    return {
      slots,
      defaults,
      defs,
      stationary: terms.every((t) => t.stationary),
      label: terms.map((t) => t.label).join(' + '),
      k(v, off, a, b) {
        let s = 0;
        for (let i = 0; i < terms.length; i++) s += terms[i].k(v, off + offsets[i], a, b);
        return s;
      },
      grad(v, off, a, b, out, scale) {
        for (let i = 0; i < terms.length; i++) terms[i].grad(v, off + offsets[i], a, b, out, scale);
      },
    };
  }
  return {
    slots,
    defaults,
    defs,
    stationary: terms.every((t) => t.stationary),
    label: terms.map((t) => `(${t.label})`).join(' × '),
    k(v, off, a, b) {
      let s = 1;
      for (let i = 0; i < terms.length; i++) s *= terms[i].k(v, off + offsets[i], a, b);
      return s;
    },
    grad(v, off, a, b, out, scale) {
      const values = terms.map((t, i) => t.k(v, off + offsets[i], a, b));
      for (let i = 0; i < terms.length; i++) {
        let other = 1;
        for (let j = 0; j < terms.length; j++) if (j !== i) other *= values[j];
        terms[i].grad(v, off + offsets[i], a, b, out, scale * other);
      }
    },
  };
}

/** Convenience spec builders. Composition is part of the public API. */
export const kernel = {
  base(id: KernelId, params?: Readonly<Record<string, number | readonly number[]>>): KernelSpec {
    return { kind: 'base', id, params };
  },
  sum(...terms: KernelSpec[]): KernelSpec {
    return { kind: 'sum', terms };
  },
  product(...terms: KernelSpec[]): KernelSpec {
    return { kind: 'product', terms };
  },
  scale(variance: number, term: KernelSpec): KernelSpec {
    return { kind: 'scale', variance, term };
  },
};

/**
 * Compile a kernel specification for a given input dimension.
 *
 * Refuses, rather than clamping, when any positive parameter is not positive:
 * a negative length scale or signal variance is not a covariance function and
 * the result would be meaningless.
 */
export function buildKernel(spec: KernelSpec, dimension: number, values?: readonly number[]): Kernel {
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new EngineError(`The input dimension must be a whole number of at least 1; received ${dimension}.`, 'range');
  }
  const node = buildNode(spec, dimension, 'k');
  const vals = values ? Array.from(values) : Array.from(node.defaults);
  if (vals.length !== node.slots.length) {
    throw new EngineError(
      `This kernel has ${node.slots.length} parameters but ${vals.length} values were supplied.`,
      'length',
    );
  }
  for (let i = 0; i < vals.length; i++) {
    const slot = node.slots[i];
    if (!Number.isFinite(vals[i])) {
      throw new EngineError(`Kernel parameter ${slot.name} must be a finite number; received ${vals[i]}.`, 'finite');
    }
    if (slot.positive && !(vals[i] > 0)) {
      throw new EngineError(
        `Kernel parameter ${slot.name} must be strictly positive; received ${vals[i]}. A non-positive length scale or variance is not a covariance function, so no result is produced.`,
        'range',
      );
    }
  }
  const trainableIndices = node.slots.map((s, i) => (s.trainable ? i : -1)).filter((i) => i >= 0);
  const lengthScaleSlots = node.slots
    .map((s, i) => (s.dimension !== null && (s.base === 'lengthScale' || s.base === 'decayLengthScale') ? i : -1))
    .filter((i) => i >= 0);
  const self: Kernel = {
    dimension,
    slots: node.slots,
    values: vals,
    defs: node.defs,
    stationary: node.stationary,
    label: node.label,
    spec,
    k(a, b) {
      return node.k(vals, 0, a, b);
    },
    grad(a, b) {
      const out = new Array<number>(node.slots.length).fill(0);
      node.grad(vals, 0, a, b, out, 1);
      return out;
    },
    withValues(next) {
      return buildKernel(spec, dimension, next);
    },
    trainableIndices,
    lengthScaleSlots,
  };
  return self;
}

/** k(x, x) — the prior variance at a point, used by the prior-recovery path. */
export function priorVariance(k: Kernel, x: readonly number[]): number {
  return k.k(x, x);
}
