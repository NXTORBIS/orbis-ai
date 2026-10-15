/**
 * Advanced copulas: dependence structures with tail dependence, which the
 * Gaussian copula in the scenario engine cannot represent.
 */
export type {
  CopulaDef,
  CopulaExactness,
  CopulaFamilyClass,
  CopulaFamilyId,
  CopulaParamSpec,
  CopulaParams,
  TailDependence,
} from './types';
export { defaultCopulaParams } from './types';
export {
  COPULAS,
  FITTABLE_COPULAS,
  claytonCopula,
  comonotonicCopula,
  countermonotonicCopula,
  frankCopula,
  gaussianCopula,
  getCopula,
  gumbelCopula,
  independenceCopula,
  joeCopula,
  tCopula,
  T_COPULA_DEFAULT_NU,
} from './families';
export type { CopulaComparison, CopulaFit, EmpiricalCopula, Pair, SkippedFamily } from './empirical';
export {
  compareCopulaFamilies,
  empiricalCopula,
  fitCopulaByKendallTau,
  midRanks,
  pseudoObservations,
  sampleKendallTau,
  sampleSpearmanRho,
} from './empirical';
export type { MultivariateCopulaSampler } from './multivariate';
export { gaussianCopulaSampler, tCopulaSampler } from './multivariate';
export {
  bivariateNormalCdf,
  bivariateNormalPdf,
  bivariateTCdf,
  bivariateTPdf,
  debye1,
} from './quadrature';
