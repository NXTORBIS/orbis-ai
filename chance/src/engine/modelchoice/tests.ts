/**
 * Hypothesis tests between models: likelihood-ratio, score and Wald for
 * nested models, the boundary correction, and Vuong's test for non-nested
 * models.
 *
 * A test answers a different question from a criterion. A test asks whether
 * the data are compatible with the simpler model; a criterion asks which model
 * predicts better. A significant likelihood-ratio test does not mean the
 * larger model predicts better, and a non-significant one does not mean the
 * models are equivalent.
 */
import { EngineError, Validator, type Explanation } from '../core/result';
import { incompleteGamma, logChoose } from '../special/gamma';
import { normalCdf } from '../special/gamma';
import { solve, type Matrix } from '../stats/linalg';

/** Upper tail of the chi-square distribution with df degrees of freedom. */
export function chiSquareUpperTail(statistic: number, df: number): number {
  if (!(df > 0)) {
    throw new EngineError(`The chi-square degrees of freedom must be positive; got ${String(df)}.`, 'range');
  }
  if (statistic <= 0) return 1;
  return incompleteGamma(df / 2, statistic / 2).upper;
}

export interface NestedTestResult {
  readonly test: 'likelihood-ratio' | 'score' | 'wald';
  readonly statistic: number;
  readonly degreesOfFreedom: number;
  readonly pValue: number;
  /** The uncorrected chi-square p-value; equal to pValue away from a boundary. */
  readonly naivePValue: number;
  readonly boundaryParameters: number;
  readonly onBoundary: boolean;
  readonly reject: (level: number) => boolean;
  readonly exactness: 'numerical';
  readonly statement: string;
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

const TEST_WARNINGS: readonly string[] = [
  'A likelihood-ratio, score or Wald test answers whether the data are compatible with the restricted model. It does not say which model predicts better; for that, use elpd (cross-validation, WAIC or PSIS-LOO).',
  'Failing to reject the restriction is not evidence that the restriction holds. It usually means the data cannot tell.',
  'All three tests are asymptotic. In small samples their nominal levels are approximate, and the three can disagree because they approximate the same surface at different points.',
];

/**
 * Mixture p-value for a likelihood-ratio statistic when `boundary` of the
 * tested parameters are constrained at the edge of their space (Chernoff 1954;
 * Self & Liang 1987).
 *
 * Under the null the maximum-likelihood estimate of a boundary parameter sits
 * exactly on the boundary about half the time, so the statistic is 0 half the
 * time and the asymptotic distribution is a mixture of chi-squares with
 * binomial(q, 1/2) weights, not chi-square with q degrees of freedom. Using
 * the naive chi-square here does not produce a slightly wrong level: for one
 * boundary parameter the test is conservative by a factor of two, which means
 * real effects are missed.
 */
function boundaryMixtureTail(statistic: number, df: number, boundary: number): number {
  if (boundary <= 0) return chiSquareUpperTail(statistic, df);
  if (statistic <= 0) return 1;
  const free = df - boundary;
  let p = 0;
  for (let j = 0; j <= boundary; j++) {
    const weight = Math.exp(logChoose(boundary, j) - boundary * Math.LN2);
    const d = free + j;
    p += weight * (d === 0 ? 0 : chiSquareUpperTail(statistic, d));
  }
  return p;
}

export interface LikelihoodRatioInput {
  /** Log-likelihood of the restricted (nested, simpler) model at its maximum. */
  readonly restrictedLogLikelihood: number;
  /** Log-likelihood of the full model at its maximum. */
  readonly fullLogLikelihood: number;
  /** Number of restrictions tested (the difference in free parameters). */
  readonly degreesOfFreedom: number;
  /**
   * How many of those restrictions put a parameter on the boundary of its
   * space (a variance fixed at 0, a mixture weight at 0, a correlation at ±1).
   */
  readonly boundaryParameters?: number;
}

/** Likelihood-ratio test, with the boundary mixture correction when needed. */
export function likelihoodRatioTest(input: LikelihoodRatioInput): NestedTestResult {
  const v = new Validator();
  v.finite(input.restrictedLogLikelihood, 'restrictedLogLikelihood', 'The restricted log-likelihood');
  v.finite(input.fullLogLikelihood, 'fullLogLikelihood', 'The full log-likelihood');
  v.integer(input.degreesOfFreedom, 'degreesOfFreedom', 'The number of restrictions', 1);
  const boundary = input.boundaryParameters ?? 0;
  v.integer(boundary, 'boundaryParameters', 'The number of boundary restrictions', 0);
  v.throwIfInvalid();
  if (boundary > input.degreesOfFreedom) {
    throw new EngineError(
      `${boundary} boundary restrictions were declared but only ${input.degreesOfFreedom} restrictions are being tested.`,
      'range',
    );
  }
  const statistic = 2 * (input.fullLogLikelihood - input.restrictedLogLikelihood);
  const warnings = [...TEST_WARNINGS];
  if (statistic < 0) {
    if (statistic < -1e-8) {
      throw new EngineError(
        `The likelihood-ratio statistic is negative (${statistic.toPrecision(4)}): the restricted model has a HIGHER maximised log-likelihood (${input.restrictedLogLikelihood.toPrecision(10)}) than the full model (${input.fullLogLikelihood.toPrecision(10)}). That is impossible for genuinely nested models, so either the models are not nested or the full model’s optimiser did not converge.`,
        'invalid',
      );
    }
    warnings.push('The likelihood-ratio statistic was very slightly negative and has been treated as 0; the full model’s optimiser gained nothing over the restricted one.');
  }
  const stat = Math.max(0, statistic);
  const naive = chiSquareUpperTail(stat, input.degreesOfFreedom);
  const p = boundary > 0 ? boundaryMixtureTail(stat, input.degreesOfFreedom, boundary) : naive;
  if (boundary > 0) {
    warnings.push(
      `${boundary} of the ${input.degreesOfFreedom} restrictions place a parameter on the boundary of its space. The asymptotic null distribution is therefore a mixture of chi-squares with binomial(${boundary}, ½) weights, not chi-square with ${input.degreesOfFreedom} degrees of freedom. The naive chi-square p-value (${naive.toPrecision(4)}) is WRONG here — conservative, so it misses real effects; the mixture p-value is ${p.toPrecision(4)}.`,
      'The mixture correction itself assumes the boundary parameters are not on the boundary of each other’s space and that the information matrix is non-singular there. For several correlated boundary parameters, simulate the null distribution instead.',
    );
  }
  return {
    test: 'likelihood-ratio',
    statistic: stat,
    degreesOfFreedom: input.degreesOfFreedom,
    pValue: p,
    naivePValue: naive,
    boundaryParameters: boundary,
    onBoundary: boundary > 0,
    reject: (level: number) => p < level,
    exactness: 'numerical',
    statement:
      boundary > 0
        ? `Likelihood-ratio statistic ${stat.toPrecision(5)}; with ${boundary} parameter(s) on a boundary the p-value is ${p.toPrecision(4)} from the chi-square mixture, against ${naive.toPrecision(4)} from the incorrect plain chi-square on ${input.degreesOfFreedom} degrees of freedom.`
        : `Likelihood-ratio statistic ${stat.toPrecision(5)} on ${input.degreesOfFreedom} degrees of freedom, p = ${p.toPrecision(4)}.`,
    warnings,
    explanation: {
      method: boundary > 0 ? 'Likelihood-ratio test with boundary (chi-square mixture) correction' : 'Likelihood-ratio test',
      formula:
        boundary > 0
          ? 'Λ = 2(lnL_full − lnL_restricted);  null: Σ_j C(q,j) 2^−q · χ²_{df−q+j}'
          : 'Λ = 2(lnL_full − lnL_restricted) ~ χ²_df',
      steps: [
        { label: 'Λ', value: stat.toPrecision(8) },
        { label: 'Degrees of freedom', value: String(input.degreesOfFreedom) },
        { label: 'p (used)', value: p.toPrecision(6) },
        { label: 'p (plain chi-square)', value: naive.toPrecision(6) },
      ],
      assumptions: [
        'The restricted model is genuinely nested in the full model, both fitted to the same data.',
        boundary > 0
          ? 'The tested parameters sit on the boundary of their space under the null, with a non-singular information matrix there.'
          : 'The true parameter is interior to the parameter space, so the statistic is asymptotically chi-square.',
      ],
      limitations: warnings,
      exactness: 'numerical',
    },
  };
}

/**
 * Wald test of H₀: θ = θ₀ for a vector θ, from the estimate and its
 * covariance matrix: W = (θ̂ − θ₀)ᵀ V⁻¹ (θ̂ − θ₀).
 *
 * The Wald test is not invariant to how the restriction is written: testing
 * β = 1 and 1/β = 1 give different statistics from the same fit. Where the
 * likelihood is available, prefer the likelihood-ratio test.
 */
export function waldTest(input: {
  readonly estimate: readonly number[];
  readonly nullValue?: readonly number[];
  readonly covariance: Matrix;
  readonly boundaryParameters?: number;
}): NestedTestResult {
  const q = input.estimate.length;
  if (q === 0) throw new EngineError('A Wald test needs at least one parameter.', 'empty');
  const nullValue = input.nullValue ?? new Array<number>(q).fill(0);
  if (nullValue.length !== q) {
    throw new EngineError(`The null value has ${nullValue.length} entries but the estimate has ${q}.`, 'shape');
  }
  if (input.covariance.length !== q || input.covariance.some((r) => r.length !== q)) {
    throw new EngineError(
      `The covariance matrix must be ${q}×${q} to match the ${q} parameters tested; got ${input.covariance.length}×${input.covariance[0]?.length ?? 0}.`,
      'shape',
    );
  }
  const d = input.estimate.map((e, i) => {
    if (!Number.isFinite(e) || !Number.isFinite(nullValue[i])) {
      throw new EngineError(`Parameter ${i}: the estimate or its null value is not finite.`, 'nonfinite');
    }
    return e - nullValue[i];
  });
  const x = solve(
    input.covariance.map((r) => [...r]),
    [...d],
  );
  if (x === null) {
    throw new EngineError(
      'The covariance matrix of the tested parameters is singular, so the Wald statistic is undefined. This usually means the parameters are not separately identified by the data.',
      'singular',
    );
  }
  let statistic = 0;
  for (let i = 0; i < q; i++) statistic += d[i] * x[i];
  if (!(statistic >= 0) || !Number.isFinite(statistic)) {
    throw new EngineError(
      `The Wald statistic is ${String(statistic)}, which means the supplied covariance matrix is not positive definite.`,
      'not-positive-definite',
    );
  }
  const boundary = input.boundaryParameters ?? 0;
  const naive = chiSquareUpperTail(statistic, q);
  const p = boundary > 0 ? boundaryMixtureTail(statistic, q, boundary) : naive;
  const warnings = [
    ...TEST_WARNINGS,
    'The Wald test depends on the parameterisation: an algebraically equivalent restriction can give a different statistic and p-value from the same fit. Prefer the likelihood-ratio test where the likelihood is available.',
  ];
  if (boundary > 0) {
    warnings.push(
      `${boundary} boundary parameter(s) declared, so the chi-square mixture p-value (${p.toPrecision(4)}) replaces the plain chi-square one (${naive.toPrecision(4)}). A Wald test on a boundary is poorly behaved even after this correction, because the estimate’s sampling distribution is not normal there.`,
    );
  }
  return {
    test: 'wald',
    statistic,
    degreesOfFreedom: q,
    pValue: p,
    naivePValue: naive,
    boundaryParameters: boundary,
    onBoundary: boundary > 0,
    reject: (level: number) => p < level,
    exactness: 'numerical',
    statement: `Wald statistic ${statistic.toPrecision(5)} on ${q} degrees of freedom, p = ${p.toPrecision(4)}.`,
    warnings,
    explanation: {
      method: 'Wald test',
      formula: 'W = (θ̂ − θ₀)ᵀ V⁻¹ (θ̂ − θ₀) ~ χ²_q',
      steps: [
        { label: 'W', value: statistic.toPrecision(8) },
        { label: 'Degrees of freedom', value: String(q) },
        { label: 'p', value: p.toPrecision(6) },
      ],
      assumptions: ['The estimator is asymptotically normal with the covariance matrix supplied.'],
      limitations: warnings,
      exactness: 'numerical',
    },
  };
}

/**
 * Score (Lagrange multiplier) test: U = sᵀ I⁻¹ s, with the score vector and
 * information matrix evaluated at the RESTRICTED estimate. Only the restricted
 * model needs to be fitted, which is the reason to use it.
 */
export function scoreTest(input: {
  readonly score: readonly number[];
  readonly information: Matrix;
  readonly degreesOfFreedom?: number;
  readonly boundaryParameters?: number;
}): NestedTestResult {
  const q = input.score.length;
  if (q === 0) throw new EngineError('A score test needs a score vector with at least one entry.', 'empty');
  if (input.information.length !== q || input.information.some((r) => r.length !== q)) {
    throw new EngineError(
      `The information matrix must be ${q}×${q} to match the score vector; got ${input.information.length}×${input.information[0]?.length ?? 0}.`,
      'shape',
    );
  }
  const bad = input.score.findIndex((s) => !Number.isFinite(s));
  if (bad >= 0) throw new EngineError(`Score component ${bad} is not finite.`, 'nonfinite');
  const x = solve(
    input.information.map((r) => [...r]),
    [...input.score],
  );
  if (x === null) {
    throw new EngineError('The information matrix is singular, so the score statistic is undefined.', 'singular');
  }
  let statistic = 0;
  for (let i = 0; i < q; i++) statistic += input.score[i] * x[i];
  if (!(statistic >= 0) || !Number.isFinite(statistic)) {
    throw new EngineError(
      `The score statistic is ${String(statistic)}, which means the information matrix supplied is not positive definite.`,
      'not-positive-definite',
    );
  }
  const df = input.degreesOfFreedom ?? q;
  const boundary = input.boundaryParameters ?? 0;
  const naive = chiSquareUpperTail(statistic, df);
  const p = boundary > 0 ? boundaryMixtureTail(statistic, df, boundary) : naive;
  const warnings = [
    ...TEST_WARNINGS,
    'The score test uses only the restricted fit, so it is cheap, but it approximates the likelihood surface at the null and has little power when the truth is far from it.',
  ];
  return {
    test: 'score',
    statistic,
    degreesOfFreedom: df,
    pValue: p,
    naivePValue: naive,
    boundaryParameters: boundary,
    onBoundary: boundary > 0,
    reject: (level: number) => p < level,
    exactness: 'numerical',
    statement: `Score statistic ${statistic.toPrecision(5)} on ${df} degrees of freedom, p = ${p.toPrecision(4)}.`,
    warnings,
    explanation: {
      method: 'Score (Lagrange multiplier) test',
      formula: 'U = s(θ̃)ᵀ I(θ̃)⁻¹ s(θ̃) ~ χ²_q, at the restricted estimate θ̃',
      steps: [
        { label: 'U', value: statistic.toPrecision(8) },
        { label: 'Degrees of freedom', value: String(df) },
        { label: 'p', value: p.toPrecision(6) },
      ],
      assumptions: ['The score and information were evaluated at the restricted maximum likelihood estimate.'],
      limitations: warnings,
      exactness: 'numerical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vuong's test for non-nested models                                 */
/* ------------------------------------------------------------------ */

export interface VuongResult {
  readonly statistic: number;
  readonly pValue: number;
  readonly meanLogRatio: number;
  readonly standardDeviation: number;
  readonly observations: number;
  readonly correction: 'none' | 'aic' | 'bic';
  readonly favours: string | 'neither';
  readonly exactness: 'numerical';
  readonly statement: string;
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

/**
 * Vuong's (1989) test for two non-nested models, from the pointwise
 * log-likelihoods at each model's maximum.
 *
 * The statistic is sqrt(n)·mean(lr) / sd(lr) with lr_i the pointwise
 * log-likelihood ratio, standard normal under the null that both models are
 * equally close in Kullback-Leibler divergence to the truth. The optional
 * correction subtracts a complexity term (AIC- or BIC-style) from the ratio,
 * because the raw statistic favours the larger model.
 *
 * The test is only valid for strictly non-nested models: if the models are
 * nested the variance of lr goes to 0 under the null and the statistic has no
 * limiting normal distribution. It also assumes neither model is correctly
 * specified; if one is, the null is degenerate.
 */
export function vuongTest(input: {
  readonly nameA: string;
  readonly nameB: string;
  readonly pointwiseLogLikA: readonly number[];
  readonly pointwiseLogLikB: readonly number[];
  readonly parametersA?: number;
  readonly parametersB?: number;
  readonly correction?: 'none' | 'aic' | 'bic';
}): VuongResult {
  const a = input.pointwiseLogLikA;
  const b = input.pointwiseLogLikB;
  if (a.length !== b.length) {
    throw new EngineError(
      `Vuong's test needs paired pointwise log-likelihoods: "${input.nameA}" has ${a.length} and "${input.nameB}" has ${b.length}.`,
      'shape',
    );
  }
  const n = a.length;
  if (n < 10) {
    throw new EngineError(`Vuong's test is asymptotic and needs at least 10 observations; ${n} were supplied.`, 'insufficient');
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      throw new EngineError(`The pointwise log-likelihood at observation ${i} is non-finite for at least one model.`, 'nonfinite');
    }
  }
  const correction = input.correction ?? 'none';
  let penalty = 0;
  if (correction !== 'none') {
    if (input.parametersA === undefined || input.parametersB === undefined) {
      throw new EngineError(
        `The ${correction.toUpperCase()} correction to Vuong's statistic needs the parameter count of both models.`,
        'required',
      );
    }
    const factor = correction === 'aic' ? 1 : Math.log(n) / 2;
    penalty = (factor * (input.parametersA - input.parametersB)) / n;
  }
  const lr = new Array<number>(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    lr[i] = a[i] - b[i] - penalty;
    mean += lr[i] / n;
  }
  let v = 0;
  for (const r of lr) v += (r - mean) * (r - mean);
  const sd = Math.sqrt(v / n);
  if (!(sd > 0)) {
    throw new EngineError(
      `The pointwise log-likelihood ratio has zero variance, so Vuong's statistic is undefined. The two models make identical pointwise predictions, or they are nested with the restriction binding exactly — in either case this test does not apply.`,
      'degenerate',
    );
  }
  const statistic = (Math.sqrt(n) * mean) / sd;
  const pValue = 2 * (1 - normalCdf(Math.abs(statistic)));
  const favours = Math.abs(statistic) < 1.96 ? 'neither' : statistic > 0 ? input.nameA : input.nameB;
  const warnings = [
    'Vuong’s test is valid only for strictly non-nested models. For nested models the variance of the pointwise log-likelihood ratio vanishes under the null and the statistic has no normal limit — use the likelihood-ratio test instead.',
    'The null hypothesis is that both models are equally distant from the truth in Kullback-Leibler divergence, i.e. that both are wrong to the same degree. Failing to reject it does not mean either model is adequate.',
    ...TEST_WARNINGS,
  ];
  if (correction === 'none') {
    warnings.push('With no complexity correction the statistic systematically favours the model with more parameters. Consider correction: "aic" or "bic".');
  }
  return {
    statistic,
    pValue,
    meanLogRatio: mean,
    standardDeviation: sd,
    observations: n,
    correction,
    favours,
    exactness: 'numerical',
    statement:
      favours === 'neither'
        ? `Vuong statistic ${statistic.toFixed(3)} (p = ${pValue.toPrecision(3)}): "${input.nameA}" and "${input.nameB}" are equally distant from the truth as far as this data can tell. Neither is preferred.`
        : `Vuong statistic ${statistic.toFixed(3)} (p = ${pValue.toPrecision(3)}), favouring "${favours}" under a ${correction === 'none' ? 'raw' : correction.toUpperCase() + '-corrected'} comparison.`,
    warnings,
    explanation: {
      method: `Vuong test for non-nested models${correction === 'none' ? '' : ` (${correction.toUpperCase()} correction)`}`,
      formula: 'z = √n · mean(lr) / sd(lr),  lr_i = ln f_A(y_i) − ln f_B(y_i) − penalty',
      steps: [
        { label: 'Mean log-likelihood ratio', value: mean.toPrecision(8) },
        { label: 'Standard deviation of the ratio', value: sd.toPrecision(8) },
        { label: 'z', value: statistic.toPrecision(6) },
        { label: 'Two-sided p', value: pValue.toPrecision(6) },
      ],
      assumptions: ['The two models are strictly non-nested.', 'The observations are independent.'],
      limitations: warnings,
      exactness: 'numerical',
    },
  };
}
