/**
 * Non-parametric and multi-group hypothesis tests.
 *
 * This module complements `stats/tests.ts` (t tests, χ², correlation,
 * one-sample KS) rather than duplicating it: everything here either makes no
 * distributional assumption, handles paired data, compares more than two
 * groups, or is an exact test.
 *
 * Three rules hold throughout:
 *  - Exact where exact is possible. Exact null distributions and the
 *    hypergeometric tests are labelled `exact`; asymptotic approximations are
 *    `numerical` and say at what sample size they become trustworthy;
 *    permutation and bootstrap results are `empirical`.
 *  - No post-hoc comparison without multiplicity control.
 *  - No non-significant result without the statement that failing to reject is
 *    not evidence of no effect, together with the smallest effect the sample
 *    size could have detected.
 */
export type {
  EffectSize,
  GroupSummary,
  NonparametricInterval,
  NonparametricResult,
  PValueRoute,
  PairwiseComparison,
  PostHocResult,
  SensitivityStatement,
  TieHandling,
} from './types';
export type { Alternative, PowerDesign } from './support';
export { sensitivity, tieInfo } from './support';

export {
  MANN_WHITNEY_EXACT_MAX_PRODUCT,
  SIGNED_RANK_EXACT_MAX_N,
  KS_EXACT_MAX_PRODUCT,
  mannWhitneyNullDistribution,
  mannWhitneyExactP,
  signedRankNullDistribution,
  signedRankExactP,
  ksTwoSampleExactP,
} from './exact';

export {
  brunnerMunzelTest,
  hodgesLehmannShift,
  ksTwoSampleTest,
  mannWhitneyUTest,
  moodMedianTest,
  type HodgesLehmannEstimate,
} from './twoSample';

export { mcnemarTest, signTest, wilcoxonSignedRankTest } from './paired';

export {
  friedmanTest,
  kruskalWallisTest,
  oneWayAnovaTest,
  twoWayAnovaTest,
  welchAnovaTest,
  type GroupInput,
  type TwoWayAnovaResult,
  type TwoWayCell,
} from './multiGroup';

export { dunnTest, gamesHowell, nemenyiTest, tukeyHsd } from './posthoc';

export { studentizedRangeCdf, studentizedRangeQuantile, studentizedRangeSf } from './studentizedRange';

export { bartlettTest, flignerKilleenTest, leveneTest } from './variance';

export {
  BARNARD_MAX_N,
  EXACT_TABLE_BUDGET,
  barnardExactTest,
  cochranArmitageTrend,
  fisherExact2x2,
  fisherFreemanHalton,
  twoByTwoEffects,
  type FisherExactResult,
  type TwoByTwoEffects,
} from './categorical';

export {
  bootstrapInterval,
  bootstrapIntervalSteps,
  meanDifference,
  permutationCount,
  permutationTest,
  permutationTestSteps,
  type BootstrapOptions,
  type BootstrapResult,
  type PermutationOptions,
  type PermutationProgress,
} from './resampling';

export {
  MULTIPLICITY_DESCRIPTIONS,
  adjustPValues,
  compareAdjustments,
  type MultiplicityMethod,
  type MultiplicityResult,
} from './multiplicity';

export {
  RANK_TEST_ARE_NORMAL,
  anovaMinimumDetectableEffect,
  anovaPower,
  chiSquareMinimumDetectableEffect,
  chiSquarePower,
  fCriticalValue,
  noncentralChiSquareSurvival,
  noncentralFSurvival,
  noncentralTSurvival,
  oneSampleMinimumDetectableEffect,
  oneSampleTPower,
  twoSampleMinimumDetectableEffect,
  twoSampleTPower,
} from './power';
