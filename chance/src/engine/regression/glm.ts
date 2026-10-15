/**
 * Generalised linear models by iteratively reweighted least squares (IRLS),
 * written generically over a link/variance family.
 *
 * Each IRLS step is a weighted least-squares solve, and it uses the same
 * Householder QR as the linear module — so a near-collinear GLM design is no
 * worse conditioned here than it is there.
 *
 * Two failure modes are refused rather than reported:
 *  - PERFECT SEPARATION in a binary model. When a linear combination of the
 *    predictors splits the two outcomes exactly, the maximum likelihood
 *    estimate does not exist: the likelihood increases without bound as the
 *    coefficient grows. IRLS stopped at some iteration limit then prints a
 *    large but finite coefficient with a large but finite standard error, and
 *    that number is a lie about a quantity that is actually infinite. It is
 *    refused here, with the separating column named.
 *  - NON-CONVERGENCE. A coefficient vector from a stopped-early optimiser is
 *    not an estimate of anything, so none is returned.
 */
import { EngineError, type Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { digamma, logGamma, normalCdf, normalQuantile, normalPdf } from '../special/gamma';
import { brentRoot } from '../core/numeric';
import { householderQR, qrSolve, xtxInverseFromR } from './qr';
import { assertDesignFullRank } from './linear';
import { buildDesign } from './design';
import { chiSquareSf } from './dist';
import { REGRESSION_LIMITATIONS } from './linear';
import type { Column, MissingReport } from './types';

export type LinkName = 'logit' | 'probit' | 'cloglog' | 'log' | 'identity';
export type FamilyName = 'binomial' | 'poisson' | 'negativebinomial' | 'gaussian';

export interface GlmFamily {
  family: FamilyName;
  link: LinkName;
  /** Mean as a function of the linear predictor. */
  linkInv: (eta: number) => number;
  /** Linear predictor as a function of the mean. */
  linkFn: (mu: number) => number;
  /** dμ/dη. */
  dmuDeta: (eta: number) => number;
  /** Variance function V(μ) (times the dispersion, which is 1 here). */
  variance: (mu: number) => number;
  /** Twice the per-observation log-likelihood deficit against a perfect fit. */
  devianceTerm: (y: number, mu: number) => number;
  /** Per-observation log-likelihood. */
  logLikTerm: (y: number, mu: number) => number;
  /** Starting mean, kept strictly inside the valid range. */
  startMu: (y: number, ybar: number) => number;
  /** Number of extra estimated parameters beyond the coefficients (e.g. θ). */
  extraParameters: number;
  validate: (y: readonly number[]) => void;
}

const MU_EPS = 1e-12;

function clampProb(p: number): number {
  return Math.min(Math.max(p, MU_EPS), 1 - MU_EPS);
}

const yLogYOverMu = (y: number, mu: number): number => (y > 0 ? y * Math.log(y / mu) : 0);

function binomialFamily(link: 'logit' | 'probit' | 'cloglog'): GlmFamily {
  const linkInv =
    link === 'logit'
      ? (eta: number) => clampProb(1 / (1 + Math.exp(-eta)))
      : link === 'probit'
        ? (eta: number) => clampProb(normalCdf(eta))
        : (eta: number) => clampProb(-Math.expm1(-Math.exp(eta)));
  const linkFn =
    link === 'logit'
      ? (mu: number) => Math.log(clampProb(mu) / (1 - clampProb(mu)))
      : link === 'probit'
        ? (mu: number) => normalQuantile(clampProb(mu))
        : (mu: number) => Math.log(-Math.log(1 - clampProb(mu)));
  const dmuDeta =
    link === 'logit'
      ? (eta: number) => {
          const p = 1 / (1 + Math.exp(-eta));
          return Math.max(p * (1 - p), MU_EPS);
        }
      : link === 'probit'
        ? (eta: number) => Math.max(normalPdf(eta), MU_EPS)
        : (eta: number) => Math.max(Math.exp(eta - Math.exp(eta)), MU_EPS);
  return {
    family: 'binomial',
    link,
    linkInv,
    linkFn,
    dmuDeta,
    variance: (mu) => Math.max(mu * (1 - mu), MU_EPS),
    devianceTerm: (y, mu) => 2 * (yLogYOverMu(y, mu) + yLogYOverMu(1 - y, 1 - mu)),
    logLikTerm: (y, mu) => y * Math.log(clampProb(mu)) + (1 - y) * Math.log(1 - clampProb(mu)),
    startMu: (y) => clampProb((y + 0.5) / 2),
    extraParameters: 0,
    validate: (y) => {
      for (const v of y) {
        if (v < 0 || v > 1) {
          throw new EngineError(`A binomial response must be 0/1 (or a proportion in [0, 1]); found ${v}.`, 'range');
        }
      }
      const hasZero = y.some((v) => v < 0.5);
      const hasOne = y.some((v) => v >= 0.5);
      if (!hasZero || !hasOne) {
        throw new EngineError(
          `The response has only one outcome class (every value is ${hasOne ? 1 : 0}). There is nothing to discriminate, so no logistic model is identified.`,
          'degenerate',
        );
      }
    },
  };
}

function poissonFamily(): GlmFamily {
  return {
    family: 'poisson',
    link: 'log',
    linkInv: (eta) => Math.max(Math.exp(Math.min(eta, 700)), MU_EPS),
    linkFn: (mu) => Math.log(Math.max(mu, MU_EPS)),
    dmuDeta: (eta) => Math.max(Math.exp(Math.min(eta, 700)), MU_EPS),
    variance: (mu) => Math.max(mu, MU_EPS),
    devianceTerm: (y, mu) => 2 * (yLogYOverMu(y, mu) - (y - mu)),
    logLikTerm: (y, mu) => y * Math.log(Math.max(mu, MU_EPS)) - mu - logGamma(y + 1),
    startMu: (y, ybar) => Math.max(y, 0.1 * Math.max(ybar, MU_EPS), MU_EPS),
    extraParameters: 0,
    validate: (y) => {
      for (const v of y) {
        if (v < 0) throw new EngineError(`A Poisson response is a count and cannot be negative; found ${v}.`, 'range');
        if (!Number.isInteger(v)) {
          // Non-integers are allowed by the quasi-likelihood but are usually a
          // sign the response is a rate, which belongs in the offset.
          break;
        }
      }
    },
  };
}

function negativeBinomialFamily(theta: number): GlmFamily {
  if (!(theta > 0) || !Number.isFinite(theta)) throw new EngineError('The negative-binomial θ must be a finite positive number.', 'range');
  return {
    family: 'negativebinomial',
    link: 'log',
    linkInv: (eta) => Math.max(Math.exp(Math.min(eta, 700)), MU_EPS),
    linkFn: (mu) => Math.log(Math.max(mu, MU_EPS)),
    dmuDeta: (eta) => Math.max(Math.exp(Math.min(eta, 700)), MU_EPS),
    variance: (mu) => Math.max(mu + (mu * mu) / theta, MU_EPS),
    devianceTerm: (y, mu) => 2 * (yLogYOverMu(y, mu) - (y + theta) * Math.log((y + theta) / (mu + theta))),
    logLikTerm: (y, mu) =>
      logGamma(y + theta) -
      logGamma(theta) -
      logGamma(y + 1) +
      theta * Math.log(theta / (theta + mu)) +
      y * Math.log(Math.max(mu, MU_EPS) / (theta + mu)),
    startMu: (y, ybar) => Math.max(y, 0.1 * Math.max(ybar, MU_EPS), MU_EPS),
    extraParameters: 1,
    validate: (y) => {
      for (const v of y) if (v < 0) throw new EngineError(`A negative-binomial response is a count and cannot be negative; found ${v}.`, 'range');
    },
  };
}

export function glmFamily(name: FamilyName, link?: LinkName, theta?: number): GlmFamily {
  switch (name) {
    case 'binomial': {
      const l = link ?? 'logit';
      if (l !== 'logit' && l !== 'probit' && l !== 'cloglog') {
        throw new EngineError(`The binomial family supports the logit, probit and complementary log-log links; received "${l}".`, 'invalid');
      }
      return binomialFamily(l);
    }
    case 'poisson':
      if (link && link !== 'log') throw new EngineError('This module fits Poisson models with the log link only.', 'invalid');
      return poissonFamily();
    case 'negativebinomial':
      if (theta === undefined) throw new EngineError('The negative-binomial family needs θ (the dispersion parameter).', 'required');
      return negativeBinomialFamily(theta);
    case 'gaussian':
      throw new EngineError('A Gaussian GLM with the identity link is ordinary least squares; use fitLinearModel, which gives exact inference.', 'invalid');
  }
}

export interface GlmSpec {
  y: readonly (number | null | undefined)[];
  predictors: readonly Column[];
  family: FamilyName;
  link?: LinkName;
  /** Known exposure/offset on the link scale (log exposure for a Poisson rate). */
  offset?: readonly (number | null | undefined)[];
  /** Prior weights (number of trials for grouped binomial data). */
  weights?: readonly (number | null | undefined)[];
  intercept?: boolean;
  yName?: string;
  level?: number;
  maxIterations?: number;
  tolerance?: number;
  /** θ for the negative binomial; estimated by `fitNegativeBinomial` otherwise. */
  theta?: number;
}

export interface GlmCoefficient {
  name: string;
  estimate: number;
  stdError: number;
  zStatistic: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
  /** exp(estimate) with its interval: an odds ratio (logit) or rate ratio (log). */
  exponentiated?: { estimate: number; ciLow: number; ciHigh: number; label: string };
}

export interface GlmFit {
  family: FamilyName;
  link: LinkName;
  yName: string;
  coefficients: GlmCoefficient[];
  beta: number[];
  n: number;
  p: number;
  names: string[];
  fitted: number[];
  /** Linear predictor η = Xβ + offset. */
  linearPredictor: number[];
  /** Deviance residuals, signed. */
  devianceResiduals: number[];
  pearsonResiduals: number[];
  /** Hat values from the final IRLS weighted design. */
  leverage: number[];
  deviance: number;
  nullDeviance: number;
  degreesOfFreedom: number;
  nullDegreesOfFreedom: number;
  logLikelihood: number;
  nullLogLikelihood: number;
  aic: number;
  bic: number;
  /** Likelihood-ratio test of the whole model against the intercept alone. */
  likelihoodRatio: { statistic: number; degreesOfFreedom: number; pValue: number };
  pseudoRSquared: { mcFadden: number; coxSnell: number; nagelkerke: number };
  /** Pearson χ²/(n − p): a dispersion check. 1 is what the family assumes. */
  dispersion: number;
  covariance: number[][];
  iterations: number;
  level: number;
  theta?: number;
  missing: MissingReport;
  exactness: Exactness;
  warnings: string[];
  limitations: string[];
}

interface IrlsOutput {
  beta: number[];
  eta: number[];
  mu: number[];
  leverage: number[];
  covariance: number[][];
  iterations: number;
  deviance: number;
}

/** One generic IRLS loop, shared by every family and link. */
function irls(
  X: readonly (readonly number[])[],
  y: readonly number[],
  priorWeights: readonly number[],
  offset: readonly number[],
  family: GlmFamily,
  names: readonly string[],
  maxIterations: number,
  tolerance: number,
): IrlsOutput {
  const n = X.length;
  const p = X[0].length;
  const ybar = stableSum(y.map((v, i) => priorWeights[i] * v)) / stableSum(priorWeights);
  let mu = y.map((v) => family.startMu(v, ybar));
  let eta = mu.map((m) => family.linkFn(m));
  let beta = new Array<number>(p).fill(0);
  let deviance = Infinity;
  let iterations = 0;
  let Rfinal: number[][] | null = null;
  let leverage: number[] = new Array<number>(n).fill(0);
  for (let iter = 1; iter <= maxIterations; iter++) {
    iterations = iter;
    const Xw: number[][] = new Array<number[]>(n);
    const zw = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const d = family.dmuDeta(eta[i]);
      const v = family.variance(mu[i]);
      const wi = (priorWeights[i] * d * d) / v;
      const rootW = Math.sqrt(Math.max(wi, 0));
      const z = eta[i] - offset[i] + (y[i] - mu[i]) / d;
      Xw[i] = X[i].map((val) => val * rootW);
      zw[i] = z * rootW;
    }
    const qr = householderQR(Xw);
    if (qr.rank < qr.p) {
      // Either the design was dependent to begin with (named precisely) or the
      // IRLS weights have collapsed, which is itself a separation symptom.
      assertDesignFullRank(X, names);
      throw new EngineError(
        'The IRLS weighted design became rank deficient during fitting: the working weights have collapsed to zero for whole groups of observations, which happens when the fitted probabilities are being driven to 0 or 1. The maximum likelihood estimate does not exist.',
        'separation',
      );
    }
    beta = qrSolve(qr, zw);
    Rfinal = qr.R;
    leverage = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += qr.Q[i][j] * qr.Q[i][j];
      leverage[i] = s;
    }
    const newEta = new Array<number>(n);
    const newMu = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let s = offset[i];
      for (let j = 0; j < p; j++) s += X[i][j] * beta[j];
      newEta[i] = s;
      newMu[i] = family.linkInv(s);
    }
    const newDeviance = stableSum(newMu.map((m, i) => priorWeights[i] * family.devianceTerm(y[i], m)));
    eta = newEta;
    mu = newMu;
    const rel = Math.abs(newDeviance - deviance) / (Math.abs(newDeviance) + 0.1);
    deviance = newDeviance;
    if (rel < tolerance) {
      if (!Rfinal) break;
      return { beta, eta, mu, leverage, covariance: xtxInverseFromR(Rfinal), iterations, deviance };
    }
  }
  throw new EngineError(
    `IRLS did not converge in ${maxIterations} iterations (the deviance was still changing by more than the relative tolerance ${tolerance}). No coefficients are reported: the vector the iteration stopped on is not the maximum likelihood estimate, and presenting it as one — with standard errors computed as though it were — would be a fabrication. For a binary response this is usually separation or a near-separating predictor.`,
    'convergence',
  );
}

/**
 * Perfect / quasi-perfect separation check for a binary response.
 *
 * A direct test for each column: order the observations by that column and
 * see whether the outcomes are perfectly sorted (every 0 before every 1, or
 * the reverse), with no overlap. That is exactly the case in which the
 * coefficient of that column is +∞ at the maximum of the likelihood. A zero
 * cell in the 2 × 2 table of a binary predictor is the same condition.
 */
function separationCheck(X: readonly (readonly number[])[], y: readonly number[], names: readonly string[], hasIntercept: boolean): void {
  const n = y.length;
  const start = hasIntercept ? 1 : 0;
  for (let j = start; j < names.length; j++) {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => X[a][j] - X[b][j]);
    const labels = order.map((i) => (y[i] >= 0.5 ? 1 : 0));
    // Perfectly sorted either way, with a genuine split point (no tie across it).
    for (const direction of [1, -1]) {
      const seq = direction === 1 ? labels : [...labels].reverse();
      let switches = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) switches++;
      if (switches !== 1) continue;
      const cut = seq.findIndex((v, i) => i > 0 && v !== seq[i - 1]);
      const ordered = direction === 1 ? order : [...order].reverse();
      const xLow = X[ordered[cut - 1]][j];
      const xHigh = X[ordered[cut]][j];
      if (xLow === xHigh) continue; // The split falls inside a tie: not separation.
      throw new EngineError(
        `Perfect separation: the predictor "${names[j]}" splits the two outcomes exactly (every observation with ${names[j]} ${direction === 1 ? '≤' : '≥'} ${xLow} has one outcome and every observation beyond it has the other). The maximum likelihood estimate does not exist — the likelihood keeps increasing as that coefficient grows without bound, so the true estimate is infinite. Any finite coefficient and standard error for this model would be an artefact of where the optimiser was stopped, so none is reported. Use exact logistic regression, a penalised fit (Firth or ridge), or merge categories.`,
        'separation',
      );
    }
  }
}

export function fitGlm(spec: GlmSpec): GlmFit {
  const family = glmFamily(spec.family, spec.link, spec.theta);
  const level = spec.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError('The confidence level must be between 0 and 1.', 'range');
  const design = buildDesign({
    y: spec.y,
    predictors: spec.predictors,
    intercept: spec.intercept,
    weights: spec.weights,
    offset: spec.offset,
    allowConstantResponse: true,
  });
  const { X, y, w, names, offset, hasIntercept } = design;
  family.validate(y);
  assertDesignFullRank(X, names);
  if (family.family === 'binomial') separationCheck(X, y, names, hasIntercept);

  const maxIterations = spec.maxIterations ?? 100;
  const tolerance = spec.tolerance ?? 1e-10;
  const out = irls(X, y, w, offset, family, names, maxIterations, tolerance);
  const n = X.length;
  const p = names.length;
  const warnings: string[] = [...design.warnings];

  if (family.family === 'binomial') {
    const maxEta = Math.max(...out.eta.map((e) => Math.abs(e)));
    if (maxEta > 25) {
      throw new EngineError(
        `Quasi-perfect separation: the fitted linear predictor reaches ${maxEta.toPrecision(4)} on the logit scale, i.e. fitted probabilities within 1e-11 of 0 or 1. The likelihood has no interior maximum in that direction, so the coefficients are diverging to infinity and the finite numbers the iteration happens to be sitting on are meaningless. No estimates are reported. Reduce the number of predictors, merge sparse categories, or use a penalised (Firth) fit.`,
        'separation',
      );
    }
    if (maxEta > 12) {
      warnings.push(
        `Some fitted probabilities are extreme (|η| up to ${maxEta.toPrecision(4)}, i.e. within about ${Math.exp(-maxEta).toExponential(2)} of 0 or 1). The data is close to separable, so those coefficients and their standard errors are unstable even though the fit converged.`,
      );
    }
  }

  // Null model: intercept only (same offset and weights), for the deviance and
  // likelihood-ratio comparisons.
  let nullDeviance: number;
  let nullLogLik: number;
  if (hasIntercept) {
    const ones = X.map(() => [1]);
    const nullFit = irls(ones, y, w, offset, family, ['(intercept)'], maxIterations, tolerance);
    nullDeviance = nullFit.deviance;
    nullLogLik = stableSum(nullFit.mu.map((m, i) => w[i] * family.logLikTerm(y[i], m)));
  } else {
    nullDeviance = stableSum(y.map((v, i) => w[i] * family.devianceTerm(v, family.linkInv(offset[i]))));
    nullLogLik = stableSum(y.map((v, i) => w[i] * family.logLikTerm(v, family.linkInv(offset[i]))));
  }

  const logLik = stableSum(out.mu.map((m, i) => w[i] * family.logLikTerm(y[i], m)));
  const kParams = p + family.extraParameters;
  const aic = -2 * logLik + 2 * kParams;
  const bic = -2 * logLik + Math.log(n) * kParams;
  const zCrit = normalQuantile(0.5 + level / 2);
  const se = out.beta.map((_, j) => Math.sqrt(Math.max(out.covariance[j][j], 0)));
  const expLabel = family.link === 'logit' ? 'odds ratio' : family.link === 'log' ? 'rate ratio' : '';
  const coefficients: GlmCoefficient[] = names.map((name, j) => {
    const est = out.beta[j];
    const s = se[j];
    const z = s > 0 ? est / s : est === 0 ? 0 : est > 0 ? Infinity : -Infinity;
    const pValue = s > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : est === 0 ? 1 : 0;
    const lo = est - zCrit * s;
    const hi = est + zCrit * s;
    const base: GlmCoefficient = { name, estimate: est, stdError: s, zStatistic: z, pValue, ciLow: lo, ciHigh: hi };
    if (expLabel) {
      base.exponentiated = { estimate: Math.exp(est), ciLow: Math.exp(lo), ciHigh: Math.exp(hi), label: expLabel };
    }
    return base;
  });

  const devianceResiduals = out.mu.map((m, i) => {
    const d = w[i] * family.devianceTerm(y[i], m);
    return Math.sign(y[i] - m) * Math.sqrt(Math.max(d, 0));
  });
  const pearsonResiduals = out.mu.map((m, i) => ((y[i] - m) * Math.sqrt(w[i])) / Math.sqrt(family.variance(m)));
  const pearsonChiSq = stableSum(pearsonResiduals.map((r) => r * r));
  const dispersion = pearsonChiSq / (n - p);

  const lrStat = nullDeviance - out.deviance;
  const lrDf = hasIntercept ? p - 1 : p;
  const likelihoodRatio = {
    statistic: lrStat,
    degreesOfFreedom: lrDf,
    pValue: lrDf > 0 ? chiSquareSf(lrStat, lrDf) : Number.NaN,
  };
  const mcFadden = nullDeviance > 0 ? 1 - out.deviance / nullDeviance : Number.NaN;
  const coxSnell = 1 - Math.exp((out.deviance - nullDeviance) / n);
  const maxCoxSnell = 1 - Math.exp(-nullDeviance / n);
  const nagelkerke = maxCoxSnell > 0 ? coxSnell / maxCoxSnell : Number.NaN;

  const limitations = [
    ...REGRESSION_LIMITATIONS,
    'The coefficients are on the link scale. For a logit link each coefficient is a log odds ratio, so the effect on the probability depends on where you start: the same coefficient moves a probability near 0.5 a great deal and a probability near 0.02 hardly at all.',
    'Pseudo-R² values are not proportions of explained variance and are not comparable with the R² of a linear model. McFadden, Cox–Snell and Nagelkerke are three different conventions and all three are reported precisely so that none of them is mistaken for "the" R².',
    'The standard errors are the usual asymptotic (Wald) ones. In small samples, with rare outcomes, or when the data is close to separable, they are unreliable and the likelihood-ratio test is the better guide.',
  ];
  if (family.family === 'poisson') {
    limitations.push(
      'The Poisson model assumes the variance equals the mean. If the counts are overdispersed, every standard error below is too small — check the dispersion figure and the overdispersion test.',
    );
  }
  if (spec.offset) {
    limitations.push('The offset is treated as known exactly, with its coefficient fixed at 1. The model estimates a rate per unit of exposure.');
  }

  return {
    family: family.family,
    link: family.link,
    yName: spec.yName ?? 'y',
    coefficients,
    beta: out.beta,
    n,
    p,
    names: [...names],
    fitted: out.mu,
    linearPredictor: out.eta,
    devianceResiduals,
    pearsonResiduals,
    leverage: out.leverage,
    deviance: out.deviance,
    nullDeviance,
    degreesOfFreedom: n - p,
    nullDegreesOfFreedom: hasIntercept ? n - 1 : n,
    logLikelihood: logLik,
    nullLogLikelihood: nullLogLik,
    aic,
    bic,
    likelihoodRatio,
    pseudoRSquared: { mcFadden, coxSnell, nagelkerke },
    dispersion,
    covariance: out.covariance,
    iterations: out.iterations,
    level,
    theta: spec.theta,
    missing: design.missing,
    exactness: 'numerical',
    warnings,
    limitations,
  };
}

/* ------------------------------------------------------------------ *
 * Binary classification assessment
 * ------------------------------------------------------------------ */

export interface ConfusionMatrix {
  threshold: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  accuracy: number;
  sensitivity: number;
  specificity: number;
  precision: number;
  f1: number;
  notes: string[];
}

export interface ClassificationReport {
  confusion: ConfusionMatrix;
  roc: { falsePositiveRate: number; truePositiveRate: number; threshold: number }[];
  auc: number;
  precisionRecall: { recall: number; precision: number; threshold: number }[];
  /** Mean squared error of the predicted probabilities. */
  brierScore: number;
  /** Brier score of always predicting the base rate, for comparison. */
  brierBaseline: number;
  baseRate: number;
  exactness: Exactness;
  warnings: string[];
  notes: string[];
}

export function confusionAt(y: readonly number[], prob: readonly number[], threshold: number): ConfusionMatrix {
  if (!(threshold >= 0 && threshold <= 1)) throw new EngineError('The classification threshold must be between 0 and 1.', 'range');
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < y.length; i++) {
    const positive = prob[i] >= threshold;
    if (y[i] >= 0.5) {
      if (positive) tp++;
      else fn++;
    } else if (positive) fp++;
    else tn++;
  }
  const n = y.length;
  const sensitivity = tp + fn > 0 ? tp / (tp + fn) : Number.NaN;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : Number.NaN;
  const precision = tp + fp > 0 ? tp / (tp + fp) : Number.NaN;
  const f1 = Number.isFinite(precision) && Number.isFinite(sensitivity) && precision + sensitivity > 0 ? (2 * precision * sensitivity) / (precision + sensitivity) : Number.NaN;
  return {
    threshold,
    truePositive: tp,
    falsePositive: fp,
    trueNegative: tn,
    falseNegative: fn,
    accuracy: (tp + tn) / n,
    sensitivity,
    specificity,
    precision,
    f1,
    notes: [
      `Counted at threshold ${threshold}. The threshold is a decision, not a property of the model: moving it trades false positives against false negatives, and the right place for it depends on what each error costs.`,
      `Base rate: ${(((tp + fn) / n) * 100).toPrecision(4)}% of observations are positive. Accuracy alone is misleading whenever the classes are unbalanced — always predicting the majority class here would already score ${((Math.max(tp + fn, tn + fp) / n) * 100).toPrecision(4)}%.`,
    ],
  };
}

/**
 * AUC by the rank (Mann–Whitney U) identity, which handles ties exactly:
 * the AUC is the probability that a randomly chosen positive case is scored
 * above a randomly chosen negative one, counting ties as half.
 */
export function areaUnderRoc(y: readonly number[], score: readonly number[]): number {
  const n = y.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[a] - score[b]);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && score[idx[j + 1]] === score[idx[i]]) j++;
    const avg = (i + j) / 2 + 1; // average rank, 1-based
    for (let k = i; k <= j; k++) ranks[idx[k]] = avg;
    i = j + 1;
  }
  let n1 = 0;
  let sumRankPos = 0;
  for (let k = 0; k < n; k++) {
    if (y[k] >= 0.5) {
      n1++;
      sumRankPos += ranks[k];
    }
  }
  const n0 = n - n1;
  if (n1 === 0 || n0 === 0) {
    throw new EngineError('The AUC needs both outcome classes to be present.', 'degenerate');
  }
  return (sumRankPos - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

export function classificationReport(
  y: readonly number[],
  prob: readonly number[],
  threshold = 0.5,
): ClassificationReport {
  if (y.length !== prob.length) throw new EngineError('The outcome and predicted-probability arrays have different lengths.', 'shape');
  const n = y.length;
  const auc = areaUnderRoc(y, prob);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => prob[b] - prob[a]);
  const totalPos = y.filter((v) => v >= 0.5).length;
  const totalNeg = n - totalPos;
  const roc: { falsePositiveRate: number; truePositiveRate: number; threshold: number }[] = [
    { falsePositiveRate: 0, truePositiveRate: 0, threshold: Infinity },
  ];
  const precisionRecall: { recall: number; precision: number; threshold: number }[] = [];
  let tp = 0;
  let fp = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    if (y[i] >= 0.5) tp++;
    else fp++;
    const isLast = k === n - 1 || prob[order[k + 1]] !== prob[i];
    if (isLast) {
      roc.push({ falsePositiveRate: fp / totalNeg, truePositiveRate: tp / totalPos, threshold: prob[i] });
      precisionRecall.push({ recall: tp / totalPos, precision: tp / (tp + fp), threshold: prob[i] });
    }
  }
  const brier = stableSum(prob.map((p, i) => (p - (y[i] >= 0.5 ? 1 : 0)) ** 2)) / n;
  const baseRate = totalPos / n;
  const brierBaseline = stableSum(y.map((v) => (baseRate - (v >= 0.5 ? 1 : 0)) ** 2)) / n;
  const warnings: string[] = [];
  if (auc < 0.55) {
    warnings.push(
      `AUC is ${auc.toPrecision(4)}, barely above the 0.5 of a coin flip. This model does not usefully rank the two outcomes apart, whatever its coefficients' p-values say.`,
    );
  }
  if (brier > brierBaseline) {
    warnings.push(
      `The Brier score (${brier.toPrecision(4)}) is worse than simply predicting the base rate of ${(baseRate * 100).toPrecision(4)}% for everyone (${brierBaseline.toPrecision(4)}). The predicted probabilities are not merely weak, they are miscalibrated.`,
    );
  }
  return {
    confusion: confusionAt(y, prob, threshold),
    roc,
    auc,
    precisionRecall,
    brierScore: brier,
    brierBaseline,
    baseRate,
    exactness: 'empirical',
    warnings,
    notes: [
      'The AUC is the probability that a randomly chosen positive case is given a higher predicted probability than a randomly chosen negative one, with ties counted as half. 0.5 is chance.',
      'The AUC measures ranking only. A model can have an excellent AUC and badly calibrated probabilities; the Brier score and the Hosmer–Lemeshow table address calibration instead.',
      'With unbalanced classes the precision–recall curve is more informative than the ROC curve, because the false-positive rate has a large denominator and hides a lot of false positives.',
      'These figures are computed on the data the model was fitted to, so they are optimistic. Cross-validate to see what the model does on data it has not seen.',
    ],
  };
}

export interface HosmerLemeshow {
  groups: { observed: number; expected: number; count: number; meanPredicted: number }[];
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  rejects: boolean;
  interpretation: string;
  warnings: string[];
}

/** Hosmer–Lemeshow calibration test: observed against predicted by risk decile. */
export function hosmerLemeshowTest(y: readonly number[], prob: readonly number[], groupCount = 10): HosmerLemeshow {
  const n = y.length;
  if (!Number.isInteger(groupCount) || groupCount < 3) throw new EngineError('The Hosmer–Lemeshow test needs at least 3 groups.', 'range');
  if (n < groupCount * 5) {
    throw new EngineError(
      `The Hosmer–Lemeshow test with ${groupCount} groups needs at least ${groupCount * 5} observations to have ~5 per group; ${n} were supplied. Use fewer groups or a calibration plot instead.`,
      'insufficient',
    );
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => prob[a] - prob[b]);
  const groups: { observed: number; expected: number; count: number; meanPredicted: number }[] = [];
  let stat = 0;
  const warnings: string[] = [];
  for (let g = 0; g < groupCount; g++) {
    const from = Math.floor((g * n) / groupCount);
    const to = Math.floor(((g + 1) * n) / groupCount);
    let obs = 0;
    let exp = 0;
    for (let k = from; k < to; k++) {
      const i = order[k];
      obs += y[i] >= 0.5 ? 1 : 0;
      exp += prob[i];
    }
    const count = to - from;
    groups.push({ observed: obs, expected: exp, count, meanPredicted: exp / count });
    const denom = exp * (1 - exp / count);
    if (denom > 0) stat += ((obs - exp) ** 2) / denom;
    else warnings.push(`Group ${g + 1} has an expected count of ${exp.toPrecision(3)}; its contribution to the statistic is omitted because the χ² approximation breaks down there.`);
  }
  const df = groupCount - 2;
  const pValue = chiSquareSf(stat, df);
  return {
    groups,
    statistic: stat,
    degreesOfFreedom: df,
    pValue,
    rejects: pValue < 0.05,
    interpretation:
      pValue < 0.05
        ? `Calibration is rejected (χ² = ${stat.toPrecision(4)} on ${df} df, p = ${pValue.toPrecision(3)}): within at least one risk group the observed rate differs systematically from the predicted probability. The model's ranking may still be useful, but its probabilities should not be read as probabilities.`
        : `No detectable miscalibration (χ² = ${stat.toPrecision(4)} on ${df} df, p = ${pValue.toPrecision(3)}). This is a weak test: it depends on the arbitrary number of groups, it has little power in small samples, and a non-rejection is not evidence of good calibration.`,
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Count models: overdispersion and the negative-binomial alternative
 * ------------------------------------------------------------------ */

export interface OverdispersionCheck {
  /** Pearson χ² / residual df. The Poisson model assumes 1. */
  dispersion: number;
  pearsonChiSquare: number;
  degreesOfFreedom: number;
  pValue: number;
  /** True when the counts are more variable than the Poisson model allows. */
  overdispersed: boolean;
  interpretation: string;
  recommendation: string;
}

/**
 * Overdispersion check for a Poisson fit.
 *
 * This is not optional. A Poisson GLM fitted to overdispersed counts
 * understates EVERY standard error — by roughly √dispersion — so p-values
 * come out far too small and intervals far too narrow. A dispersion of 3
 * means the reported standard errors are about 1.7 times too small.
 */
export function overdispersionCheck(fit: GlmFit): OverdispersionCheck {
  if (fit.family !== 'poisson') {
    throw new EngineError('The overdispersion check applies to a Poisson fit; the negative binomial already models extra variance through θ.', 'invalid');
  }
  const df = fit.degreesOfFreedom;
  const chi = stableSum(fit.pearsonResiduals.map((r) => r * r));
  const dispersion = chi / df;
  const pValue = chiSquareSf(chi, df);
  // Fires on a clear excess that is also statistically decisive, so that the
  // 5% of true-Poisson samples with a slightly high χ² do not trip it.
  const overdispersed = dispersion > 1.2 && pValue < 0.01;
  return {
    dispersion,
    pearsonChiSquare: chi,
    degreesOfFreedom: df,
    pValue,
    overdispersed,
    interpretation: overdispersed
      ? `Overdispersion detected: Pearson χ² / df = ${dispersion.toPrecision(4)} (χ² = ${chi.toPrecision(5)} on ${df} df, p = ${pValue.toPrecision(3)}). The counts are about ${dispersion.toPrecision(3)} times as variable as a Poisson distribution with these means allows.`
      : `No evidence of overdispersion: Pearson χ² / df = ${dispersion.toPrecision(4)} (p = ${pValue.toPrecision(3)}). The Poisson variance assumption is consistent with this data.`,
    recommendation: overdispersed
      ? `Every standard error in the Poisson fit is too small by roughly √${dispersion.toPrecision(3)} = ${Math.sqrt(dispersion).toPrecision(3)}, and the p-values are correspondingly too small. Refit as a negative binomial (fitNegativeBinomial), which estimates the extra variance, or use quasi-Poisson standard errors scaled by √dispersion. Do not report the Poisson standard errors as they stand.`
      : 'The Poisson standard errors can be used as reported. Note that this check cannot distinguish overdispersion from a misspecified mean model: a missing predictor or a missing non-linearity shows up here too.',
  };
}

export interface NegativeBinomialFit extends GlmFit {
  theta: number;
  /** Standard error of θ from the profile likelihood curvature. */
  thetaStdError: number;
  /**
   * Likelihood-ratio test of the negative binomial against the Poisson
   * (θ → ∞). The null sits on the boundary of the parameter space, so the
   * p-value uses the usual halved-χ²₁ correction.
   */
  versusPoisson: { statistic: number; pValue: number; note: string };
}

/**
 * Negative-binomial regression: the alternative when Poisson counts are
 * overdispersed. θ is estimated by maximising the profile log-likelihood
 * (alternating with IRLS for the coefficients), and Var(Y) = μ + μ²/θ, so a
 * large θ means the model has reduced to a Poisson.
 */
export function fitNegativeBinomial(spec: Omit<GlmSpec, 'family' | 'theta'>): NegativeBinomialFit {
  const poisson = fitGlm({ ...spec, family: 'poisson' });
  const design = buildDesign({
    y: spec.y,
    predictors: spec.predictors,
    intercept: spec.intercept,
    weights: spec.weights,
    offset: spec.offset,
    allowConstantResponse: true,
  });
  const yv = design.y;

  const score = (theta: number, mu: readonly number[]): number =>
    stableSum(
      mu.map(
        (m, i) =>
          digamma(yv[i] + theta) - digamma(theta) + Math.log(theta / (theta + m)) + 1 - (yv[i] + theta) / (theta + m),
      ),
    );
  const profileLogLik = (theta: number, mu: readonly number[]): number => {
    const fam = negativeBinomialFamily(theta);
    return stableSum(mu.map((m, i) => fam.logLikTerm(yv[i], m)));
  };

  let mu = poisson.fitted;
  let theta = Number.NaN;
  let fit: GlmFit | null = null;
  const LOW = 1e-3;
  const HIGH = 1e7;
  for (let round = 0; round < 25; round++) {
    const sLow = score(LOW, mu);
    const sHigh = score(HIGH, mu);
    if (!(sLow > 0 && sHigh < 0)) {
      if (sHigh >= 0) {
        throw new EngineError(
          `The negative-binomial dispersion θ is unbounded for this data: the profile likelihood keeps increasing as θ → ∞, which is the Poisson model. There is no extra variance for the negative binomial to absorb, so fitting one is not meaningful — use the Poisson fit.`,
          'degenerate',
        );
      }
      throw new EngineError(
        `θ could not be bracketed between ${LOW} and ${HIGH}: the counts are more variable than even a negative binomial with θ = ${LOW} allows (extreme zero-inflation or a misspecified mean model).`,
        'numerical',
      );
    }
    const newTheta = brentRoot((t) => score(t, mu), LOW, HIGH, { tol: 1e-10 });
    fit = fitGlm({ ...spec, family: 'negativebinomial', theta: newTheta });
    const converged = Number.isFinite(theta) && Math.abs(newTheta - theta) / newTheta < 1e-8;
    theta = newTheta;
    mu = fit.fitted;
    if (converged) break;
  }
  if (!fit || !Number.isFinite(theta)) {
    throw new EngineError('The joint estimation of θ and the coefficients did not converge; no estimates are reported.', 'convergence');
  }
  // Curvature of the profile log-likelihood at the optimum, by a central
  // second difference on the log scale (θ is positive and often large).
  const h = Math.max(theta * 1e-4, 1e-6);
  const second = (profileLogLik(theta + h, mu) - 2 * profileLogLik(theta, mu) + profileLogLik(theta - h, mu)) / (h * h);
  const thetaStdError = second < 0 ? Math.sqrt(-1 / second) : Number.NaN;
  const lr = 2 * (fit.logLikelihood - poisson.logLikelihood);
  const warnings = [...fit.warnings];
  if (theta > 1e5) {
    warnings.push(`θ = ${theta.toPrecision(5)} is very large, meaning μ²/θ is negligible: this negative binomial has collapsed onto the Poisson model. Use the Poisson fit, which has one fewer parameter.`);
  }
  return {
    ...fit,
    theta,
    thetaStdError,
    versusPoisson: {
      statistic: lr,
      // θ → ∞ is on the boundary, so the LR statistic is a 50:50 mixture of a
      // point mass at 0 and a χ²₁; halving the χ²₁ tail is the standard fix.
      pValue: lr > 0 ? 0.5 * chiSquareSf(lr, 1) : 1,
      note: 'The Poisson model is the negative binomial with θ = ∞, which sits on the edge of the parameter space, so the likelihood-ratio statistic is not χ²₁ but a 50:50 mixture of χ²₁ and a point mass at zero. The p-value reported here uses that correction; taking the plain χ²₁ p-value would overstate the evidence by a factor of two.',
    },
    warnings,
    limitations: [
      ...fit.limitations,
      `θ = ${theta.toPrecision(5)} is estimated from the same data, so the standard errors below treat an estimated quantity as known and are slightly too small.`,
      'The negative binomial absorbs extra variance but does not explain it. Overdispersion caused by a missing predictor, clustering or zero-inflation is better addressed by modelling that cause.',
    ],
  };
}
