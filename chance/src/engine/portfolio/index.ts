/**
 * Portfolio and aggregate risk.
 *
 * The existing risk module measures ONE loss distribution. This module combines
 * many uncertain quantities, measures the risk of the combination coherently,
 * allocates that risk back to its sources, optimises over it, and stresses and
 * backtests the result.
 *
 * Three rules run through all of it:
 *   1. Risks do not add. Every aggregate result names the dependence
 *      assumption that produced it, and an unknown dependence yields bounds.
 *   2. A risk measure is not its estimate. The tail quantile and the sampling
 *      uncertainty of the estimate are reported separately and labelled.
 *   3. Nothing plausible is returned in place of a failure.
 */
export * from './empirical';
export * from './discrete';
export * from './measures';
export * from './marginal';
export * from './aggregate';
export * from './allocation';
export * from './optimise';
export * from './scenario';
export { checkCovariance, jacobiEigen, gaussLegendreUnit, chiSquareSf, projectBudgetBox, quadraticForm, convolve } from './numerics';
export type { CovarianceCheck, SymmetricEigen } from './numerics';
