/**
 * The uniform description of a bivariate copula family.
 *
 * A copula is the joint distribution of the ranks: C(u, v) = P(U ≤ u, V ≤ v)
 * with U and V standard uniform. Separating it from the margins is what lets
 * the scenario engine attach a dependence structure — including tail
 * dependence, which a Gaussian copula cannot express — to any set of marginal
 * distributions.
 */
import type { Exactness } from '../core/result';
import type { Random } from '../random/rng';

export type CopulaFamilyId =
  | 'gaussian'
  | 't'
  | 'clayton'
  | 'gumbel'
  | 'frank'
  | 'joe'
  | 'independence'
  | 'comonotonic'
  | 'countermonotonic';

/** Structural class of a family, which is what determines its tail behaviour. */
export type CopulaFamilyClass = 'elliptical' | 'archimedean' | 'reference';

export type CopulaParams = Record<string, number>;

export interface CopulaParamSpec {
  key: string;
  label: string;
  /** Conventional symbol, e.g. "θ". */
  symbol: string;
  description: string;
  defaultValue: number;
  min: number;
  minExclusive?: boolean;
  max: number;
  maxExclusive?: boolean;
  sliderMin: number;
  sliderMax: number;
  step: number;
}

/** Coefficients of tail dependence: λ_L = lim_{q→0} P(V ≤ q | U ≤ q) and the
 *  mirror-image quantity λ_U = lim_{q→1} P(V > q | U > q). */
export interface TailDependence {
  lower: number;
  upper: number;
}

/** How each reported quantity of a family was obtained. */
export interface CopulaExactness {
  cdf: Exactness;
  /** Absent for the singular reference copulas, which have no density. */
  density?: Exactness;
  kendallTau: Exactness;
  spearmanRho: Exactness;
  tailDependence: Exactness;
}

export interface CopulaDef {
  id: CopulaFamilyId;
  name: string;
  description: string;
  family: CopulaFamilyClass;
  params: CopulaParamSpec[];
  /** The copula in conventional notation. */
  formula: string;
  /** Conventions, parameterisation and structural facts. */
  notes: string[];
  /** What this family cannot represent, and where the numerics are limited. */
  limitations: string[];
  /** Plain-language description of the sampling algorithm actually used. */
  samplingMethod: string;
  exactness: CopulaExactness;

  /** Throws an EngineError listing every parameter problem found. */
  validate(p: CopulaParams): void;
  /** C(u, v) for u, v ∈ [0, 1]. */
  cdf(u: number, v: number, p: CopulaParams): number;
  /** The copula density c = ∂²C/∂u∂v, where it exists. */
  density?(u: number, v: number, p: CopulaParams): number;
  /** One draw (U, V) from the copula. */
  sample(rng: Random, p: CopulaParams): [number, number];
  kendallTau(p: CopulaParams): number;
  spearmanRho(p: CopulaParams): number;
  tailDependence(p: CopulaParams): TailDependence;
  /** The parameters of this family that reproduce a target Kendall's τ. */
  fromKendallTau(tau: number): CopulaParams;
  /** The τ values this family can represent, as a closed interval. */
  kendallTauRange: { min: number; max: number };
}

/** Default parameter values of a family, as a fresh object. */
export function defaultCopulaParams(def: CopulaDef): CopulaParams {
  const out: CopulaParams = {};
  for (const spec of def.params) out[spec.key] = spec.defaultValue;
  return out;
}
