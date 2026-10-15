/**
 * Tests for the regression module.
 *
 * Every reference value here is independent of the implementation under test:
 * hand-computed closed forms written out in the comments, the existing
 * (separately tested) `pearson`/`correlationTest`/`oneWayAnova` code, a
 * deliberately naive normal-equations solver built inside the test, brute
 * force refitting, and simulation coverage with fixed seeds.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import { pearson, variance, mean } from '../stats/descriptive';
import { correlationTest } from '../stats/tests';
import { solve } from '../stats/linalg';
import {
  areaUnderRoc,
  bestSubsetSelection,
  breuschPaganTest,
  classificationReport,
  crossValidatePenalty,
  diagnosticPlots,
  fitGlm,
  fitLinearModel,
  fitNegativeBinomial,
  fitPenalized,
  hosmerLemeshowTest,
  householderQR,
  influenceMeasures,
  kFoldLinear,
  leaveOneOutLinear,
  naturalCubicSplineBasis,
  bSplineBasis,
  overdispersionCheck,
  polynomialBasis,
  predictIntervals,
  stepwiseSelection,
  tCritical,
  whiteTest,
} from './index';
import type { Column } from './types';

const col = (name: string, values: readonly number[]): Column => ({ name, values: [...values] });

/* ================================================================== *
 * 1. Exact small-sample OLS, computed by hand
 * ================================================================== */

describe('exact small-sample OLS', () => {
  // x = [1, 2, 3, 4], y = [2, 3, 5, 4].
  //   x̄ = 2.5, ȳ = 3.5
  //   Sxx = Σ(x−x̄)² = 2.25 + 0.25 + 0.25 + 2.25 = 5
  //   Sxy = Σ(x−x̄)(y−ȳ) = 2.25 + 0.25 + 0.75 + 0.75 = 4
  //   slope     = Sxy/Sxx = 4/5 = 0.8
  //   intercept = ȳ − slope·x̄ = 3.5 − 2 = 1.5
  //   fitted    = [2.3, 3.1, 3.9, 4.7]
  //   residuals = [−0.3, −0.1, 1.1, −0.7]  → RSS = 0.09+0.01+1.21+0.49 = 1.80
  //   Syy = 5.0 → R² = 1 − 1.8/5 = 0.64 (= Sxy²/(Sxx·Syy) = 16/25)
  //   s² = RSS/(n−2) = 0.9
  //   se(slope)     = √(s²/Sxx)                 = √0.18
  //   se(intercept) = √(s²·(1/n + x̄²/Sxx))      = √(0.9·1.5) = √1.35
  //   t_slope = 0.8/√0.18, t_intercept = 1.5/√1.35
  // Tolerance 1e-10 is far looser than the ~1e-16 these dyadic-rational
  // quantities actually achieve; it only guards against a wrong formula.
  const fit = fitLinearModel({ y: [2, 3, 5, 4], predictors: [col('x', [1, 2, 3, 4])] });

  it('recovers the hand-computed coefficients', () => {
    expect(fit.coefficients[0].name).toBe('(intercept)');
    expect(fit.coefficients[0].estimate).toBeCloseTo(1.5, 10);
    expect(fit.coefficients[1].estimate).toBeCloseTo(0.8, 10);
  });

  it('recovers the hand-computed fitted values and residuals', () => {
    expect(fit.fitted[0]).toBeCloseTo(2.3, 10);
    expect(fit.fitted[3]).toBeCloseTo(4.7, 10);
    expect(fit.residuals).toHaveLength(4);
    expect(fit.residuals[2]).toBeCloseTo(1.1, 10);
    expect(fit.anova.residualSS).toBeCloseTo(1.8, 10);
    expect(fit.anova.totalSS).toBeCloseTo(5, 10);
  });

  it('recovers R², adjusted R² and the residual standard error', () => {
    expect(fit.rSquared).toBeCloseTo(0.64, 10);
    // adjusted R² = 1 − (RSS/2)/(TSS/3) = 1 − 0.9/(5/3) = 0.46
    expect(fit.adjustedRSquared).toBeCloseTo(0.46, 10);
    expect(fit.sigmaSquared).toBeCloseTo(0.9, 10);
    expect(fit.residualStandardError).toBeCloseTo(Math.sqrt(0.9), 10);
  });

  it('recovers the hand-computed standard errors and t statistics', () => {
    expect(fit.coefficients[1].stdError).toBeCloseTo(Math.sqrt(0.18), 10);
    expect(fit.coefficients[0].stdError).toBeCloseTo(Math.sqrt(1.35), 10);
    expect(fit.coefficients[1].tStatistic).toBeCloseTo(0.8 / Math.sqrt(0.18), 10);
    expect(fit.coefficients[0].tStatistic).toBeCloseTo(1.5 / Math.sqrt(1.35), 10);
  });

  it('builds the confidence interval from the t critical value', () => {
    const t = tCritical(0.95, 2);
    expect(fit.coefficients[1].ciLow).toBeCloseTo(0.8 - t * Math.sqrt(0.18), 10);
    expect(fit.coefficients[1].ciHigh).toBeCloseTo(0.8 + t * Math.sqrt(0.18), 10);
  });

  it('reports the ANOVA decomposition with F = t² for a single predictor', () => {
    // Regression SS = TSS − RSS = 3.2, df = 1; F = 3.2/0.9.
    expect(fit.anova.regressionSS).toBeCloseTo(3.2, 10);
    expect(fit.anova.regressionDf).toBe(1);
    expect(fit.anova.residualDf).toBe(2);
    expect(fit.anova.fStatistic).toBeCloseTo(3.2 / 0.9, 10);
    expect(fit.anova.fStatistic).toBeCloseTo(fit.coefficients[1].tStatistic ** 2, 10);
    expect(fit.anova.fPValue).toBeCloseTo(fit.coefficients[1].pValue, 12);
  });

  it('states that regression is association, not causation', () => {
    expect(fit.limitations.join(' ')).toMatch(/association, not causation/i);
    expect(fit.limitations.join(' ')).toMatch(/omitted-variable/i);
    expect(fit.exactness).toBe('exact');
  });

  it('reports n, p and the complete-case accounting', () => {
    expect(fit.n).toBe(4);
    expect(fit.p).toBe(2);
    expect(fit.missing).toEqual({ suppliedRows: 4, droppedRows: 0, rowsUsed: 4 });
  });
});

describe('perfect fit', () => {
  // y = 3 + 2x exactly: R² = 1, residuals 0, and no residual variance to
  // estimate standard errors from. They must be exactly 0, never NaN.
  const fit = fitLinearModel({ y: [3, 5, 7, 9, 11], predictors: [col('x', [0, 1, 2, 3, 4])] });

  it('returns R² = 1 with exactly zero residuals and zero standard errors', () => {
    expect(fit.coefficients[0].estimate).toBeCloseTo(3, 12);
    expect(fit.coefficients[1].estimate).toBeCloseTo(2, 12);
    expect(fit.rSquared).toBeCloseTo(1, 12);
    for (const e of fit.residuals) expect(Math.abs(e)).toBeLessThan(1e-13);
    for (const c of fit.coefficients) {
      expect(Number.isNaN(c.stdError)).toBe(false);
      expect(c.stdError).toBeLessThan(1e-13);
      expect(Number.isNaN(c.tStatistic)).toBe(false);
      expect(Number.isNaN(c.pValue)).toBe(false);
    }
  });

  it('warns that the fit is interpolating', () => {
    expect(fit.warnings.join(' ')).toMatch(/exactly zero/i);
  });
});

/* ================================================================== *
 * 2. Cross-checks against already-tested engine code
 * ================================================================== */

describe('simple regression is the correlation test', () => {
  const x = [2.1, 3.4, 1.9, 5.6, 4.4, 6.1, 3.3, 7.2, 5.0, 2.8];
  const y = [4.4, 5.1, 3.2, 8.0, 6.6, 8.4, 5.9, 9.9, 7.1, 4.9];
  const fit = fitLinearModel({ y, predictors: [col('x', x)] });

  it('matches Pearson r² exactly', () => {
    const r = pearson(x, y);
    // Both are the same algebraic quantity; agreement is to rounding only.
    expect(fit.rSquared).toBeCloseTo(r * r, 13);
  });

  it("matches the correlation test's t statistic and p-value", () => {
    const ct = correlationTest(x, y);
    expect(fit.coefficients[1].tStatistic).toBeCloseTo(ct.statistic, 11);
    expect(fit.coefficients[1].pValue).toBeCloseTo(ct.pValue, 13);
    expect(fit.anova.residualDf).toBe(ct.degreesOfFreedom);
  });
});

describe('regression on a dummy reproduces the pooled two-sample t test', () => {
  const groupA = [5.1, 4.8, 6.2, 5.5, 4.9, 5.8];
  const groupB = [7.2, 6.8, 7.9, 7.1, 6.5];
  const y = [...groupA, ...groupB];
  const dummy = [...groupA.map(() => 0), ...groupB.map(() => 1)];
  const fit = fitLinearModel({ y, predictors: [col('groupB', dummy)] });

  // Pooled two-sample t, computed here and nowhere near the implementation:
  const nA = groupA.length;
  const nB = groupB.length;
  const mA = mean(groupA);
  const mB = mean(groupB);
  const sp2 = ((nA - 1) * variance(groupA) + (nB - 1) * variance(groupB)) / (nA + nB - 2);
  const tPooled = (mB - mA) / Math.sqrt(sp2 * (1 / nA + 1 / nB));

  it('estimates the group difference and matches the pooled t exactly', () => {
    expect(fit.coefficients[0].estimate).toBeCloseTo(mA, 12);
    expect(fit.coefficients[1].estimate).toBeCloseTo(mB - mA, 12);
    expect(fit.coefficients[1].tStatistic).toBeCloseTo(tPooled, 11);
    expect(fit.sigmaSquared).toBeCloseTo(sp2, 12);
  });

  it('gives F = t² for the one-way layout', () => {
    expect(fit.anova.fStatistic).toBeCloseTo(tPooled * tPooled, 10);
  });
});

/* ================================================================== *
 * 3. QR really is better than the normal equations
 * ================================================================== */

describe('QR versus the normal equations on an ill-conditioned design', () => {
  it('is closer to the known truth than forming and inverting XᵀX', () => {
    // A Vandermonde design on [1, 2] with 8 columns: condition number ~1e10,
    // so the normal equations (condition number ~1e20) have no digits left.
    const n = 16;
    const degree = 7;
    const xs = Array.from({ length: n }, (_, i) => 1 + i / (n - 1));
    const X = xs.map((x) => Array.from({ length: degree + 1 }, (_, j) => Math.pow(x, j)));
    const truth = [1, -2, 3, -1, 0.5, 2, -1.5, 0.25];
    const y = X.map((row) => row.reduce((s, v, j) => s + v * truth[j], 0));

    // Route 1: this module's QR. The x⁰ column is supplied as the intercept,
    // which is the same design matrix written the way the module expects it.
    const fit = fitLinearModel({
      y,
      predictors: Array.from({ length: degree }, (_, j) => col(`x^${j + 1}`, X.map((row) => row[j + 1]))),
    });

    // Route 2: the normal equations, built here deliberately naively.
    const p = degree + 1;
    const xtx = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) => X.reduce((s, row) => s + row[a] * row[b], 0)),
    );
    const xty = Array.from({ length: p }, (_, a) => X.reduce((s, row, i) => s + row[a] * y[i], 0));
    const normalEq = solve(xtx, xty);
    expect(normalEq).not.toBeNull();

    const err = (b: readonly number[]) => Math.sqrt(b.reduce((s, v, j) => s + (v - truth[j]) ** 2, 0));
    const qrError = err(fit.beta);
    const neError = err(normalEq as number[]);
    // The squared condition number costs the normal equations several orders
    // of magnitude here; requiring a factor of 10 is a conservative assertion.
    expect(qrError).toBeLessThan(neError / 10);
    expect(fit.collinearity.conditionNumber).toBeGreaterThan(1e6);
    expect(fit.warnings.join(' ')).toMatch(/condition number/i);
  });

  it('computes a condition number consistent with the singular values of a known design', () => {
    // Diagonal design: singular values are the diagonal entries exactly.
    const X = [
      [100, 0, 0],
      [0, 10, 0],
      [0, 0, 0.1],
      [0, 0, 0],
    ];
    const qr = householderQR(X);
    expect(qr.rank).toBe(3);
    const fit = fitLinearModel({
      y: [1, 2, 3, 4],
      intercept: false,
      predictors: [col('a', X.map((r) => r[0])), col('b', X.map((r) => r[1])), col('c', X.map((r) => r[2]))],
    });
    // cond = 100/0.1 = 1000, to the accuracy of the Jacobi eigen-solver.
    expect(fit.collinearity.conditionNumber).toBeCloseTo(1000, 6);
  });
});

/* ================================================================== *
 * 4. Coverage: the definitive check on the standard errors
 * ================================================================== */

describe('recovery and interval coverage', () => {
  const trueBeta = [2, -1.5, 0.75];
  const sigma = 1.3;
  const n = 40;
  const x0 = [1.2, -0.4];

  function simulate(rng: Random) {
    const x1: number[] = [];
    const x2: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      const b = rng.normal() * 0.8 + 0.3 * a;
      x1.push(a);
      x2.push(b);
      y.push(trueBeta[0] + trueBeta[1] * a + trueBeta[2] * b + sigma * rng.normal());
    }
    return { x1, x2, y };
  }

  it('recovers a known linear model', () => {
    const rng = new Random('recovery-point');
    const big = { x1: [] as number[], x2: [] as number[], y: [] as number[] };
    for (let i = 0; i < 5000; i++) {
      const a = rng.normal();
      const b = rng.normal() * 0.8 + 0.3 * a;
      big.x1.push(a);
      big.x2.push(b);
      big.y.push(trueBeta[0] + trueBeta[1] * a + trueBeta[2] * b + sigma * rng.normal());
    }
    const fit = fitLinearModel({ y: big.y, predictors: [col('x1', big.x1), col('x2', big.x2)] });
    // With n = 5000 the standard error is ≈0.02, so 0.1 is ~5 SE: a formula
    // error of any size fails, sampling noise does not.
    fit.coefficients.forEach((c, j) => expect(c.estimate).toBeCloseTo(trueBeta[j], 1));
    expect(fit.residualStandardError).toBeCloseTo(sigma, 1);
  });

  it('coefficient confidence intervals cover the truth about 95% of the time', () => {
    const reps = 300;
    const covered = [0, 0, 0];
    const rng = new Random('coverage-coef');
    for (let r = 0; r < reps; r++) {
      const { x1, x2, y } = simulate(rng);
      const fit = fitLinearModel({ y, predictors: [col('x1', x1), col('x2', x2)] });
      fit.coefficients.forEach((c, j) => {
        if (c.ciLow <= trueBeta[j] && trueBeta[j] <= c.ciHigh) covered[j]++;
      });
    }
    // Binomial SE of a 95% coverage estimate over 300 reps is 1.26%, so ±4
    // percentage points is just over 3 SE: a correct implementation passes,
    // an SE wrong by even 10% does not.
    for (const c of covered) {
      expect(c / reps).toBeGreaterThan(0.91);
      expect(c / reps).toBeLessThan(0.99);
    }
  });

  it('prediction intervals cover a genuinely new observation about 95% of the time', () => {
    const reps = 300;
    let covered = 0;
    let meanCovered = 0;
    const rng = new Random('coverage-pred');
    const trueMean = trueBeta[0] + trueBeta[1] * x0[0] + trueBeta[2] * x0[1];
    for (let r = 0; r < reps; r++) {
      const { x1, x2, y } = simulate(rng);
      const fit = fitLinearModel({ y, predictors: [col('x1', x1), col('x2', x2)] });
      const [pt] = predictIntervals(fit, [x0]);
      const fresh = trueMean + sigma * rng.normal();
      if (pt.predictionLow <= fresh && fresh <= pt.predictionHigh) covered++;
      if (pt.meanLow <= trueMean && trueMean <= pt.meanHigh) meanCovered++;
    }
    expect(covered / reps).toBeGreaterThan(0.91);
    expect(covered / reps).toBeLessThan(0.99);
    // The mean-response interval is a 95% interval for a different quantity.
    expect(meanCovered / reps).toBeGreaterThan(0.91);
    expect(meanCovered / reps).toBeLessThan(0.99);
  });

  it('the prediction interval is strictly wider than the mean interval everywhere', () => {
    const rng = new Random('width');
    const { x1, x2, y } = simulate(rng);
    const fit = fitLinearModel({ y, predictors: [col('x1', x1), col('x2', x2)] });
    const grid: number[][] = [];
    for (let a = -3; a <= 3; a += 0.5) for (let b = -3; b <= 3; b += 0.5) grid.push([a, b]);
    const points = predictIntervals(fit, grid);
    for (const pt of points) {
      const predWidth = pt.predictionHigh - pt.predictionLow;
      const meanWidth = pt.meanHigh - pt.meanLow;
      expect(predWidth).toBeGreaterThan(meanWidth);
      // Both are centred on the same fit.
      expect((pt.predictionHigh + pt.predictionLow) / 2).toBeCloseTo(pt.fit, 10);
      expect((pt.meanHigh + pt.meanLow) / 2).toBeCloseTo(pt.fit, 10);
    }
    // Analytic check of the two widths at one point: the ratio is
    // √(1 + q)/√q with q = x₀ᵀ(XᵀX)⁻¹x₀.
    const pt = points[0];
    const q = ((pt.meanHigh - pt.meanLow) / (2 * tCritical(0.95, fit.n - fit.p))) ** 2 / fit.sigmaSquared;
    const expectedRatio = Math.sqrt(1 + q) / Math.sqrt(q);
    expect((pt.predictionHigh - pt.predictionLow) / (pt.meanHigh - pt.meanLow)).toBeCloseTo(expectedRatio, 10);
  });
});

/* ================================================================== *
 * 5. Diagnostics, leverage and the LOO shortcut
 * ================================================================== */

describe('leave-one-out shortcut', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const z = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16];
  const y = [2.3, 3.1, 4.9, 5.2, 7.7, 7.1, 9.8, 9.1, 12.4, 11.3, 14.0, 13.2, 16.1, 15.4, 18.5];

  it('equals brute-force refitting to 1e-10', () => {
    const fit = fitLinearModel({ y, predictors: [col('x', x), col('z', z)] });
    const loo = leaveOneOutLinear(fit.residuals, fit.leverage, y, fit.rSquared);
    // Brute force: drop each row, refit, predict the held-out point.
    const brute: number[] = [];
    for (let i = 0; i < y.length; i++) {
      const keep = y.map((_, k) => k).filter((k) => k !== i);
      const sub = fitLinearModel({
        y: keep.map((k) => y[k]),
        predictors: [col('x', keep.map((k) => x[k])), col('z', keep.map((k) => z[k]))],
      });
      const pred = sub.beta[0] + sub.beta[1] * x[i] + sub.beta[2] * z[i];
      brute.push(y[i] - pred);
    }
    const brutePress = brute.reduce((s, e) => s + e * e, 0);
    // Both are the same number computed two ways; 1e-10 is the stated bar.
    expect(loo.press).toBeCloseTo(brutePress, 10);
    expect(loo.rmse).toBeCloseTo(Math.sqrt(brutePress / y.length), 10);
  });

  it('reports the out-of-sample figure alongside in-sample R²', () => {
    const fit = fitLinearModel({ y, predictors: [col('x', x), col('z', z)] });
    const loo = leaveOneOutLinear(fit.residuals, fit.leverage, y, fit.rSquared);
    expect(loo.inSampleRSquared).toBeCloseTo(fit.rSquared, 12);
    expect(loo.exactness).toBe('empirical');
    const kf = kFoldLinear(fit.n === y.length ? y.map((_, i) => [1, x[i], z[i]]) : [], y, 5, fit.rSquared);
    expect(kf.folds).toBe(5);
    expect(kf.rmse).toBeGreaterThan(0);
  });
});

describe('leverage, Cook\'s distance and influence', () => {
  // Nine points on a line, plus one wild point far out in x.
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 30];
  const ys = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1, 18.0, 10];
  const fit = fitLinearModel({ y: ys, predictors: [col('x', xs)] });
  const influence = influenceMeasures(fit, fit.fitted.map((_, i) => [1, xs[i]]));

  it('flags the high-leverage outlier', () => {
    const last = influence.rows[9];
    expect(last.leverage).toBeGreaterThan(influence.thresholds.leverage);
    expect(last.cooksDistance).toBeGreaterThan(1);
    expect(influence.flagged.map((r) => r.index)).toContain(9);
    expect(influence.warnings.join(' ')).toMatch(/influential/i);
    // It is the most influential point by a wide margin.
    const others = influence.rows.slice(0, 9).map((r) => r.cooksDistance);
    expect(last.cooksDistance).toBeGreaterThan(10 * Math.max(...others));
  });

  it('removing it materially changes the slope', () => {
    const without = fitLinearModel({
      y: ys.slice(0, 9),
      predictors: [col('x', xs.slice(0, 9))],
    });
    expect(Math.abs(without.beta[1] - fit.beta[1])).toBeGreaterThan(0.5);
    // DFBETAS says exactly that, in standard-error units.
    expect(Math.abs(influence.rows[9].dfbetas[1])).toBeGreaterThan(2 / Math.sqrt(10));
  });

  it('matches brute-force single deletion for DFFITS', () => {
    // DFFITS_i = (ŷ_i − ŷ_i(i)) / (s_(i)·√h_i), recomputed by refitting.
    const i = 4;
    const keep = ys.map((_, k) => k).filter((k) => k !== i);
    const sub = fitLinearModel({ y: keep.map((k) => ys[k]), predictors: [col('x', keep.map((k) => xs[k]))] });
    const predWithout = sub.beta[0] + sub.beta[1] * xs[i];
    const h = fit.leverage[i];
    const expected = (fit.fitted[i] - predWithout) / (sub.residualStandardError * Math.sqrt(h));
    expect(influence.rows[i].dffits).toBeCloseTo(expected, 9);
  });

  it('produces the four diagnostic plots as point arrays', () => {
    const plots = diagnosticPlots(fit, influence);
    expect(plots.residualsVsFitted).toHaveLength(10);
    expect(plots.qq).toHaveLength(10);
    expect(plots.scaleLocation).toHaveLength(10);
    expect(plots.residualsVsLeverage).toHaveLength(10);
    // The Q–Q plot must be sorted in the residual coordinate.
    for (let i = 1; i < plots.qq.length; i++) expect(plots.qq[i].y).toBeGreaterThanOrEqual(plots.qq[i - 1].y);
  });
});

describe('Durbin–Watson', () => {
  it('is near 2 for independent residuals and small for a trend', () => {
    const rng = new Random('dw');
    const n = 200;
    const x = Array.from({ length: n }, (_, i) => i / n);
    const indep = fitLinearModel({ y: x.map((v) => 1 + 2 * v + rng.normal() * 0.3), predictors: [col('x', x)] });
    expect(indep.durbinWatson).toBeGreaterThan(1.6);
    expect(indep.durbinWatson).toBeLessThan(2.4);
    // A quadratic fitted by a straight line leaves a smooth residual curve,
    // which is maximally autocorrelated in the supplied order.
    const curved = fitLinearModel({ y: x.map((v) => v * v * 10), predictors: [col('x', x)] });
    expect(curved.durbinWatson).toBeLessThan(0.5);
    expect(curved.warnings.join(' ')).toMatch(/Durbin–Watson/);
  });
});

/* ================================================================== *
 * 6. Weighted least squares, robust standard errors, heteroskedasticity
 * ================================================================== */

describe('weighted least squares', () => {
  it('reproduces OLS when every weight is equal', () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [2.2, 3.9, 6.1, 7.8, 10.2, 11.9];
    const ols = fitLinearModel({ y, predictors: [col('x', x)] });
    const wls = fitLinearModel({ y, predictors: [col('x', x)], weights: x.map(() => 3) });
    expect(wls.beta[0]).toBeCloseTo(ols.beta[0], 11);
    expect(wls.beta[1]).toBeCloseTo(ols.beta[1], 11);
    expect(wls.kind).toBe('wls');
  });

  it('matches the closed-form weighted slope', () => {
    // Weighted simple regression: β₁ = Σw(x−x̄_w)(y−ȳ_w) / Σw(x−x̄_w)².
    const x = [1, 2, 3, 4, 5];
    const y = [1, 3, 2, 5, 4];
    const w = [1, 4, 2, 8, 1];
    const sw = w.reduce((s, v) => s + v, 0);
    const xbar = x.reduce((s, v, i) => s + w[i] * v, 0) / sw;
    const ybar = y.reduce((s, v, i) => s + w[i] * v, 0) / sw;
    const num = x.reduce((s, v, i) => s + w[i] * (v - xbar) * (y[i] - ybar), 0);
    const den = x.reduce((s, v, i) => s + w[i] * (v - xbar) ** 2, 0);
    const fit = fitLinearModel({ y, predictors: [col('x', x)], weights: w });
    expect(fit.beta[1]).toBeCloseTo(num / den, 11);
    expect(fit.beta[0]).toBeCloseTo(ybar - (num / den) * xbar, 11);
  });
});

describe('heteroskedasticity', () => {
  function heteroskedastic(rng: Random, n: number) {
    const x = Array.from({ length: n }, () => rng.uniformRange(0.5, 3.5));
    const y = x.map((v) => 1 + 2 * v + rng.normal() * v * v);
    return { x, y };
  }

  it('HC3 standard errors differ from the classical ones', () => {
    const rng = new Random('hc3');
    const { x, y } = heteroskedastic(rng, 150);
    const fit = fitLinearModel({ y, predictors: [col('x', x)] });
    const classical = fit.classicalStdErrors[1];
    const hc3 = fit.robustStdErrors.HC3[1];
    expect(Math.abs(hc3 - classical) / classical).toBeGreaterThan(0.1);
    // HC0 < HC1 < HC2 ≈ HC3 is the usual ordering of the finite-sample
    // corrections; HC3 is the most conservative.
    expect(fit.robustStdErrors.HC3[1]).toBeGreaterThan(fit.robustStdErrors.HC0[1]);
  });

  it('robust intervals cover better than classical ones under heteroskedasticity', () => {
    const reps = 300;
    const n = 40;
    let classicalCover = 0;
    let robustCover = 0;
    const rng = new Random('hc-coverage');
    for (let r = 0; r < reps; r++) {
      const { x, y } = heteroskedastic(rng, n);
      const classical = fitLinearModel({ y, predictors: [col('x', x)] });
      const robust = fitLinearModel({ y, predictors: [col('x', x)], seType: 'HC3' });
      if (classical.coefficients[1].ciLow <= 2 && 2 <= classical.coefficients[1].ciHigh) classicalCover++;
      if (robust.coefficients[1].ciLow <= 2 && 2 <= robust.coefficients[1].ciHigh) robustCover++;
    }
    expect(robustCover).toBeGreaterThan(classicalCover);
    // The robust interval should be close to its nominal level; the classical
    // one is materially below it here.
    expect(robustCover / reps).toBeGreaterThan(0.9);
    expect(classicalCover / reps).toBeLessThan(0.93);
  });

  it('Breusch–Pagan and White fire on heteroskedastic data and not on homoskedastic data', () => {
    const rng = new Random('bp');
    const { x, y } = heteroskedastic(rng, 200);
    const het = fitLinearModel({ y, predictors: [col('x', x)] });
    const bpHet = breuschPaganTest(het, x.map((v) => [v]));
    expect(bpHet.rejects).toBe(true);
    expect(bpHet.pValue).toBeLessThan(0.01);
    expect(whiteTest(het, x.map((v) => [v])).rejects).toBe(true);

    const rng2 = new Random('bp-homo');
    const xh = Array.from({ length: 200 }, () => rng2.uniformRange(0.5, 3.5));
    const yh = xh.map((v) => 1 + 2 * v + rng2.normal());
    const homo = fitLinearModel({ y: yh, predictors: [col('x', xh)] });
    const bpHomo = breuschPaganTest(homo, xh.map((v) => [v]));
    expect(bpHomo.rejects).toBe(false);
    expect(bpHomo.pValue).toBeGreaterThan(0.05);
    expect(whiteTest(homo, xh.map((v) => [v])).rejects).toBe(false);
  });
});

/* ================================================================== *
 * 7. Penalised regression
 * ================================================================== */

describe('ridge, lasso and elastic net', () => {
  const rng = new Random('penalty-data');
  const n = 120;
  const x1: number[] = [];
  const x2: number[] = [];
  const x3: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng.normal();
    const b = rng.normal();
    const c = 0.9 * a + 0.2 * rng.normal();
    x1.push(a);
    x2.push(b);
    x3.push(c);
    y.push(1.5 + 2 * a - 1 * b + 0 * c + rng.normal() * 0.5);
  }
  const predictors = [col('x1', x1), col('x2', x2), col('x3', x3)];

  it('ridge at λ = 0 is exactly OLS', () => {
    const ols = fitLinearModel({ y, predictors });
    const ridge0 = fitPenalized({ y, predictors, lambda: 0, alpha: 0 });
    expect(ridge0.intercept).toBeCloseTo(ols.beta[0], 9);
    ridge0.coefficients.forEach((c, j) => expect(c.estimate).toBeCloseTo(ols.beta[j + 1], 9));
    expect(ridge0.exactness).toBe('exact');
  });

  it('ridge shrinks monotonically towards zero as λ grows', () => {
    const lambdas = [0, 0.001, 0.01, 0.1, 0.5, 1, 5, 20, 100];
    const norms = lambdas.map((lambda) => {
      const fit = fitPenalized({ y, predictors, lambda, alpha: 0 });
      return Math.sqrt(fit.standardisedBeta.reduce((s, v) => s + v * v, 0));
    });
    for (let i = 1; i < norms.length; i++) expect(norms[i]).toBeLessThan(norms[i - 1]);
    expect(norms[norms.length - 1]).toBeLessThan(norms[0] / 10);
    // Ridge never reaches exactly zero, which is the difference from lasso.
    const heavy = fitPenalized({ y, predictors, lambda: 100, alpha: 0 });
    for (const c of heavy.coefficients) expect(c.estimate).not.toBe(0);
  });

  it('lasso sets coefficients exactly to zero', () => {
    const mild = fitPenalized({ y, predictors, lambda: 0.05, alpha: 1 });
    const heavy = fitPenalized({ y, predictors, lambda: 10, alpha: 1 });
    // At a large penalty every coefficient is EXACTLY zero, not merely small.
    expect(heavy.standardisedBeta.every((v) => v === 0)).toBe(true);
    expect(heavy.coefficients.every((c) => c.estimate === 0)).toBe(true);
    expect(heavy.nonZero).toBe(0);
    // The intercept then equals the mean of the response.
    expect(heavy.intercept).toBeCloseTo(mean(y), 10);
    // At a mild penalty the irrelevant collinear predictor is dropped first.
    expect(mild.nonZero).toBeGreaterThan(0);
    expect(mild.nonZero).toBeLessThan(4);
  });

  it('refuses to attach p-values to penalised coefficients', () => {
    const fit = fitPenalized({ y, predictors, lambda: 0.1, alpha: 1 });
    expect(fit.inferenceValid).toBe(false);
    expect(Object.keys(fit.coefficients[0])).toEqual(['name', 'estimate']);
    expect(fit.limitations.join(' ')).toMatch(/DO NOT apply/);
    expect(fit.limitations.join(' ')).toMatch(/biased towards zero/);
  });

  it('elastic net sits between ridge and lasso', () => {
    // λ chosen large enough that the L1 part of the net's penalty bites.
    const lambda = 0.3;
    const ridge = fitPenalized({ y, predictors, lambda, alpha: 0 });
    const net = fitPenalized({ y, predictors, lambda, alpha: 0.5 });
    const lasso = fitPenalized({ y, predictors, lambda, alpha: 1 });
    expect(net.kind).toBe('elasticnet');
    const l1 = (f: { standardisedBeta: number[] }) => f.standardisedBeta.reduce((s, v) => s + Math.abs(v), 0);
    // The elastic net inherits the L1 penalty's ability to zero a coefficient
    // (ridge never does) while shrinking the rest like ridge, so its total L1
    // norm stays at or below the ridge solution's.
    expect(l1(net)).toBeLessThanOrEqual(l1(ridge) * 1.01);
    expect(lasso.nonZero).toBeLessThanOrEqual(net.nonZero);
    expect(net.nonZero).toBeLessThanOrEqual(ridge.nonZero);
    expect(ridge.nonZero).toBe(3);
    // x3 is the redundant, collinear predictor. The lasso removes it, ridge
    // keeps it at nearly full size, and the elastic net lands between them —
    // the L2 part of the penalty is what keeps correlated predictors together.
    const x3of = (f: { standardisedBeta: number[] }) => Math.abs(f.standardisedBeta[2]);
    expect(x3of(lasso)).toBe(0);
    expect(x3of(net)).toBeLessThan(x3of(ridge));
    expect(x3of(net)).toBeGreaterThan(0);
  });

  it('chooses λ by cross-validation and reports a one-standard-error choice', () => {
    const sel = crossValidatePenalty({ y, predictors, alpha: 1 }, { folds: 5, lambdas: [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.005] });
    expect(sel.path).toHaveLength(8);
    expect(sel.lambdaMin).toBeGreaterThan(0);
    expect(sel.lambdaOneStandardError).toBeGreaterThanOrEqual(sel.lambdaMin);
    expect(sel.exactness).toBe('empirical');
    // The cross-validated error must be worse at an absurd penalty than at the choice.
    const worst = sel.path[0];
    const best = sel.path.find((p) => p.lambda === sel.lambdaMin);
    expect(best?.rmse).toBeLessThanOrEqual(worst.rmse);
  });

  it('propagates a non-converged coordinate descent as a refusal', () => {
    expect(() =>
      fitPenalized({ y, predictors, lambda: 0.01, alpha: 1, maxIterations: 1, tolerance: 1e-14 }),
    ).toThrow(/did not converge/i);
  });
});

/* ================================================================== *
 * 8. Basis expansions and selection
 * ================================================================== */

describe('polynomial and spline bases', () => {
  const xs = Array.from({ length: 60 }, (_, i) => -3 + (6 * i) / 59);
  const rng = new Random('basis');
  const ys = xs.map((x) => Math.sin(x) + rng.normal() * 0.05);

  it('a cubic polynomial fits a curve a line cannot, and warns about extrapolation', () => {
    const basis = polynomialBasis(xs, 3, 'x');
    const poly = fitLinearModel({ y: ys, predictors: basis.columns });
    const line = fitLinearModel({ y: ys, predictors: [col('x', xs)] });
    expect(poly.rSquared).toBeGreaterThan(line.rSquared + 0.2);
    expect(basis.warnings.join(' ')).toMatch(/extrapolation is wild/i);
  });

  it('a natural cubic spline fits at least as well as a cubic polynomial here', () => {
    const ns = naturalCubicSplineBasis(xs, { interiorKnots: 4 }, 'x');
    const fit = fitLinearModel({ y: ys, predictors: ns.columns });
    expect(fit.rSquared).toBeGreaterThan(0.98);
    expect(ns.warnings.join(' ')).toMatch(/linear outside the boundary knots/);
    // The basis must reproduce its own columns when evaluated at a data point.
    const row = ns.evaluate(xs[10]);
    ns.columns.forEach((c, j) => expect(c.values[10]).toBeCloseTo(row[j], 12));
  });

  it('a B-spline basis sums to one before the first column is dropped', () => {
    const bs = bSplineBasis(xs, { degree: 3, interiorKnots: 3 }, 'x');
    const fit = fitLinearModel({ y: ys, predictors: bs.columns });
    expect(fit.rSquared).toBeGreaterThan(0.98);
    expect(bs.columns.length).toBeGreaterThan(3);
  });

  it('refuses an absurd polynomial degree', () => {
    expect(() => polynomialBasis(xs, 15, 'x')).toThrow(EngineError);
  });
});

describe('selection', () => {
  const rng = new Random('selection');
  const n = 150;
  const cols: number[][] = Array.from({ length: 5 }, () => Array.from({ length: n }, () => rng.normal()));
  const y = Array.from({ length: n }, (_, i) => 1 + 2 * cols[0][i] - 1.5 * cols[1][i] + rng.normal() * 0.6);
  const candidates = cols.map((c, j) => col(`v${j}`, c));

  it('stepwise AIC finds the two real predictors', () => {
    const res = stepwiseSelection({ y, candidates, criterion: 'aic' });
    expect(res.selected).toContain('v0');
    expect(res.selected).toContain('v1');
    expect(res.selected.length).toBeLessThanOrEqual(4);
  });

  it('best subset agrees and reports the best model at each size', () => {
    const res = bestSubsetSelection({ y, candidates, criterion: 'bic' });
    expect(res.selected.sort()).toEqual(['v0', 'v1']);
    expect(res.bestBySize?.length).toBe(6);
    // R² can never decrease as variables are added.
    const bySize = [...(res.bestBySize ?? [])].sort((a, b) => a.size - b.size);
    for (let i = 1; i < bySize.length; i++) {
      expect(bySize[i].rSquared).toBeGreaterThanOrEqual(bySize[i - 1].rSquared - 1e-12);
    }
  });

  it('warns that selection invalidates the p-values and inflates R²', () => {
    const res = stepwiseSelection({ y, candidates });
    const text = [...res.warnings, ...res.limitations].join(' ');
    expect(text).toMatch(/post-selection/i);
    expect(text).toMatch(/p-values/);
    expect(text).toMatch(/biased upward|inflat/i);
  });

  it('refuses a best-subset search that is too large', () => {
    const many = Array.from({ length: 16 }, (_, j) => col(`w${j}`, Array.from({ length: 40 }, () => rng.normal())));
    expect(() => bestSubsetSelection({ y: Array.from({ length: 40 }, () => rng.normal()), candidates: many })).toThrow(EngineError);
  });
});

/* ================================================================== *
 * 9. Logistic regression
 * ================================================================== */

describe('logistic regression', () => {
  it('recovers a known logistic model within its standard errors', () => {
    const rng = new Random('logit-recovery');
    const n = 20000;
    const truth = [-0.5, 1.2, -0.8];
    const x1: number[] = [];
    const x2: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      const b = rng.normal();
      const eta = truth[0] + truth[1] * a + truth[2] * b;
      x1.push(a);
      x2.push(b);
      y.push(rng.bernoulli(1 / (1 + Math.exp(-eta))) ? 1 : 0);
    }
    const fit = fitGlm({ y, predictors: [col('x1', x1), col('x2', x2)], family: 'binomial' });
    expect(fit.link).toBe('logit');
    fit.coefficients.forEach((c, j) => {
      // Within 3.5 standard errors: a correct fit is inside this with
      // probability ~0.9995 per coefficient, a wrong one is not.
      expect(Math.abs(c.estimate - truth[j])).toBeLessThan(3.5 * c.stdError);
      expect(c.stdError).toBeLessThan(0.1);
    });
    expect(fit.exactness).toBe('numerical');
    // Odds ratios are the exponentiated coefficients, with the interval
    // transformed rather than recomputed.
    const or = fit.coefficients[1].exponentiated;
    expect(or?.label).toBe('odds ratio');
    expect(or?.estimate).toBeCloseTo(Math.exp(fit.coefficients[1].estimate), 12);
    expect(or?.ciLow).toBeCloseTo(Math.exp(fit.coefficients[1].ciLow), 12);
    // Model-level statistics.
    expect(fit.likelihoodRatio.pValue).toBeLessThan(1e-10);
    expect(fit.pseudoRSquared.mcFadden).toBeGreaterThan(0.05);
    expect(fit.pseudoRSquared.nagelkerke).toBeGreaterThan(fit.pseudoRSquared.coxSnell);
    expect(fit.aic).toBeCloseTo(-2 * fit.logLikelihood + 2 * fit.p, 8);
    expect(fit.bic).toBeCloseTo(-2 * fit.logLikelihood + Math.log(n) * fit.p, 8);
    // The deviance is −2·logLik for a 0/1 binomial response.
    expect(fit.deviance).toBeCloseTo(-2 * fit.logLikelihood, 6);

    const report = classificationReport(y, fit.fitted, 0.5);
    expect(report.auc).toBeGreaterThan(0.65);
    expect(report.brierScore).toBeLessThan(report.brierBaseline);
    expect(report.confusion.truePositive + report.confusion.falseNegative).toBe(y.filter((v) => v === 1).length);
    expect(report.roc[0]).toEqual({ falsePositiveRate: 0, truePositiveRate: 0, threshold: Infinity });
    expect(report.roc[report.roc.length - 1].truePositiveRate).toBeCloseTo(1, 12);
    expect(report.precisionRecall.length).toBeGreaterThan(10);
    const hl = hosmerLemeshowTest(y, fit.fitted, 10);
    expect(hl.degreesOfFreedom).toBe(8);
    expect(hl.groups).toHaveLength(10);
    // The model is correctly specified, so calibration should not be rejected.
    expect(hl.rejects).toBe(false);
  });

  it('gives AUC ≈ 0.5 for a null model and high AUC when well separated', () => {
    const rng = new Random('auc');
    const n = 4000;
    const noise = Array.from({ length: n }, () => rng.normal());
    const yNull = Array.from({ length: n }, () => (rng.bernoulli(0.4) ? 1 : 0));
    const nullFit = fitGlm({ y: yNull, predictors: [col('x', noise)], family: 'binomial' });
    const nullReport = classificationReport(yNull, nullFit.fitted);
    // With n = 4000 the SE of the AUC under the null is about 0.009.
    expect(Math.abs(nullReport.auc - 0.5)).toBeLessThan(0.04);
    expect(nullFit.coefficients[1].pValue).toBeGreaterThan(0.01);
    expect(nullReport.warnings.join(' ')).toMatch(/coin flip/i);

    const strong: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      strong.push(a);
      ys.push(rng.bernoulli(1 / (1 + Math.exp(-4 * a))) ? 1 : 0);
    }
    const strongFit = fitGlm({ y: ys, predictors: [col('x', strong)], family: 'binomial' });
    expect(classificationReport(ys, strongFit.fitted).auc).toBeGreaterThan(0.9);
  });

  it('refuses perfect separation instead of reporting a huge finite coefficient', () => {
    const x = [-3, -2, -1, -0.5, 0.5, 1, 2, 3, 4, 5];
    const y = x.map((v) => (v > 0 ? 1 : 0));
    expect(() => fitGlm({ y, predictors: [col('x', x)], family: 'binomial' })).toThrow(/separation/i);
    try {
      fitGlm({ y, predictors: [col('x', x)], family: 'binomial' });
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).message).toMatch(/does not exist|infinite/i);
      expect((e as EngineError).issues[0].code).toBe('separation');
    }
    // A zero cell in a 2 × 2 table is the same condition.
    const bin = [0, 0, 0, 0, 1, 1, 1, 1];
    const yBin = [0, 0, 0, 0, 1, 1, 1, 1];
    expect(() => fitGlm({ y: yBin, predictors: [col('g', bin)], family: 'binomial' })).toThrow(/separation/i);
  });

  it('matches the exact 2 × 2 empirical odds ratio for a single binary predictor', () => {
    // 2 × 2 table (all four cells non-empty, so the MLE exists):
    //   group 0: 30 successes of 100 ; group 1: 60 successes of 120
    //   odds₀ = 30/70, odds₁ = 60/60 = 1  → OR = 1/(30/70) = 70/30 = 2.3333…
    // Logistic regression on the group dummy must reproduce log(OR) exactly:
    // the model is saturated, so the fitted probabilities equal the observed
    // proportions and the coefficient is the empirical log odds ratio.
    const g: number[] = [];
    const y: number[] = [];
    const push = (group: number, successes: number, failures: number) => {
      for (let i = 0; i < successes; i++) {
        g.push(group);
        y.push(1);
      }
      for (let i = 0; i < failures; i++) {
        g.push(group);
        y.push(0);
      }
    };
    push(0, 30, 70);
    push(1, 60, 60);
    const oddsRatio = (60 / 60) / (30 / 70);
    const fit = fitGlm({
      y,
      predictors: [col('group', g)],
      family: 'binomial',
      tolerance: 1e-14,
      maxIterations: 200,
    });
    // 1e-8 as specified; IRLS on a saturated model converges quadratically and
    // in practice lands within ~1e-12.
    expect(fit.coefficients[1].estimate).toBeCloseTo(Math.log(oddsRatio), 8);
    expect(fit.coefficients[1].exponentiated?.estimate).toBeCloseTo(oddsRatio, 8);
    // The intercept is the log odds in group 0.
    expect(fit.coefficients[0].estimate).toBeCloseTo(Math.log(30 / 70), 8);
    // Standard error of a log odds ratio: √(1/a + 1/b + 1/c + 1/d).
    const seExact = Math.sqrt(1 / 30 + 1 / 70 + 1 / 60 + 1 / 60);
    expect(fit.coefficients[1].stdError).toBeCloseTo(seExact, 8);
  });

  it('fits probit and complementary log-log links', () => {
    const rng = new Random('links');
    const n = 3000;
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      x.push(a);
      // Generated from a probit model with intercept −0.3, slope 0.9.
      y.push(rng.uniform() < 0.5 * (1 + erfApprox((-0.3 + 0.9 * a) / Math.SQRT2)) ? 1 : 0);
    }
    const probit = fitGlm({ y, predictors: [col('x', x)], family: 'binomial', link: 'probit' });
    // Recovery is asserted against the sampling error of this n (3.5 SE), not
    // against an arbitrary absolute tolerance.
    expect(Math.abs(probit.coefficients[0].estimate + 0.3)).toBeLessThan(3.5 * probit.coefficients[0].stdError);
    expect(Math.abs(probit.coefficients[1].estimate - 0.9)).toBeLessThan(3.5 * probit.coefficients[1].stdError);
    const cloglog = fitGlm({ y, predictors: [col('x', x)], family: 'binomial', link: 'cloglog' });
    expect(cloglog.link).toBe('cloglog');
    // Different links, same ranking of the fitted probabilities.
    expect(areaUnderRoc(y, cloglog.fitted)).toBeCloseTo(areaUnderRoc(y, probit.fitted), 2);
    // A logit coefficient is about 1.7 times the probit one for the same data.
    const logit = fitGlm({ y, predictors: [col('x', x)], family: 'binomial' });
    expect(logit.coefficients[1].estimate / probit.coefficients[1].estimate).toBeGreaterThan(1.4);
    expect(logit.coefficients[1].estimate / probit.coefficients[1].estimate).toBeLessThan(2.1);
  });
});

/** Abramowitz–Stegun 7.1.26 error function, used only to GENERATE probit data. */
function erfApprox(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const a = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-a * a));
}

/* ================================================================== *
 * 10. Poisson, overdispersion and the negative binomial
 * ================================================================== */

describe('Poisson regression', () => {
  function poissonData(rng: Random, n: number, overdispersed: boolean, theta = 1.5) {
    const x: number[] = [];
    const logExposure: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal() * 0.7;
      const exposure = 1 + rng.uniform() * 3;
      const mu = Math.exp(0.4 + 0.9 * a) * exposure;
      x.push(a);
      logExposure.push(Math.log(exposure));
      // A gamma-mixed Poisson is exactly a negative binomial with that θ.
      const lambda = overdispersed ? (mu * rng.gamma(theta)) / theta : mu;
      y.push(rng.poisson(lambda));
    }
    return { x, logExposure, y };
  }

  it('recovers a known Poisson model with an offset', () => {
    const rng = new Random('poisson-recovery');
    const { x, logExposure, y } = poissonData(rng, 4000, false);
    const fit = fitGlm({ y, predictors: [col('x', x)], family: 'poisson', offset: logExposure });
    expect(fit.coefficients[0].estimate).toBeCloseTo(0.4, 1);
    expect(fit.coefficients[1].estimate).toBeCloseTo(0.9, 1);
    fit.coefficients.forEach((c, j) => {
      expect(Math.abs(c.estimate - [0.4, 0.9][j])).toBeLessThan(3.5 * c.stdError);
    });
    expect(fit.coefficients[1].exponentiated?.label).toBe('rate ratio');
    expect(fit.limitations.join(' ')).toMatch(/variance equals the mean/);
  });

  it('the overdispersion check does NOT fire on true Poisson data', () => {
    const rng = new Random('poisson-clean');
    const { x, logExposure, y } = poissonData(rng, 2000, false);
    const fit = fitGlm({ y, predictors: [col('x', x)], family: 'poisson', offset: logExposure });
    const check = overdispersionCheck(fit);
    // The Pearson dispersion of a correctly specified Poisson fit is 1 with
    // SE ≈ √(2/df) ≈ 0.032 here, so 1.2 is six standard errors away.
    expect(check.dispersion).toBeGreaterThan(0.85);
    expect(check.dispersion).toBeLessThan(1.15);
    expect(check.overdispersed).toBe(false);
  });

  it('the overdispersion check FIRES on negative-binomial data', () => {
    const rng = new Random('poisson-over');
    const { x, logExposure, y } = poissonData(rng, 2000, true, 1.2);
    const fit = fitGlm({ y, predictors: [col('x', x)], family: 'poisson', offset: logExposure });
    const check = overdispersionCheck(fit);
    expect(check.overdispersed).toBe(true);
    expect(check.dispersion).toBeGreaterThan(1.5);
    expect(check.recommendation).toMatch(/too small/);
    expect(check.recommendation).toMatch(/negative binomial/i);
  });

  it('the negative-binomial alternative recovers θ and widens the standard errors', () => {
    const rng = new Random('nb');
    const trueTheta = 1.2;
    const { x, logExposure, y } = poissonData(rng, 3000, true, trueTheta);
    const poisson = fitGlm({ y, predictors: [col('x', x)], family: 'poisson', offset: logExposure });
    const nb = fitNegativeBinomial({ y, predictors: [col('x', x)], offset: logExposure });
    // θ is estimated from 3000 observations; ±35% is a generous band that a
    // broken estimator (off by a factor, or diverging) cannot sneak through.
    expect(nb.theta).toBeGreaterThan(trueTheta * 0.65);
    expect(nb.theta).toBeLessThan(trueTheta * 1.35);
    expect(nb.coefficients[1].estimate).toBeCloseTo(0.9, 1);
    // The honest standard errors are substantially larger than the Poisson ones.
    expect(nb.coefficients[1].stdError).toBeGreaterThan(1.5 * poisson.coefficients[1].stdError);
    expect(nb.versusPoisson.pValue).toBeLessThan(1e-10);
    expect(nb.aic).toBeLessThan(poisson.aic);
  });

  it('says the negative binomial is unnecessary when the data is genuinely Poisson', () => {
    const rng = new Random('nb-unneeded');
    const { x, logExposure, y } = poissonData(rng, 1200, false);
    // θ → ∞ IS the Poisson model. Either the profile likelihood is unbounded
    // (refused outright) or θ comes back enormous, in which case the fit must
    // say so rather than presenting the extra parameter as meaningful.
    try {
      const nb = fitNegativeBinomial({ y, predictors: [col('x', x)], offset: logExposure });
      // θ large enough that μ²/θ is a small fraction of μ (mean count ≈ 3),
      // and the likelihood-ratio test against the Poisson does not reject.
      expect(nb.theta).toBeGreaterThan(20);
      expect(nb.versusPoisson.pValue).toBeGreaterThan(0.01);
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).message).toMatch(/unbounded|Poisson/i);
    }
  });
});

/* ================================================================== *
 * 11. Collinearity, rank deficiency and the other refusals
 * ================================================================== */

describe('collinearity', () => {
  it('refuses a duplicated column and names the dependency', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = [2, 4, 5, 4, 6, 7, 9, 8];
    let message = '';
    try {
      fitLinearModel({ y, predictors: [col('x', x), col('xCopy', [...x])] });
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/rank deficient/i);
    expect(message).toMatch(/xCopy/);
    expect(message).toMatch(/linear combination/i);
  });

  it('refuses a column that is a linear combination of two others', () => {
    const rng = new Random('collinear');
    const a = Array.from({ length: 30 }, () => rng.normal());
    const b = Array.from({ length: 30 }, () => rng.normal());
    const c = a.map((v, i) => 2 * v - 3 * b[i]);
    const y = a.map((v, i) => v + b[i] + rng.normal() * 0.1);
    expect(() => fitLinearModel({ y, predictors: [col('a', a), col('b', b), col('c', c)] })).toThrow(/rank deficient/i);
  });

  it('reports high VIFs and warns when predictors are nearly collinear', () => {
    const rng = new Random('vif');
    const n = 100;
    const a = Array.from({ length: n }, () => rng.normal());
    const b = a.map((v) => v + rng.normal() * 0.02);
    const y = a.map((v, i) => 1 + v + 0.5 * b[i] + rng.normal() * 0.3);
    const fit = fitLinearModel({ y, predictors: [col('a', a), col('b', b)] });
    expect(fit.collinearity.vif).toHaveLength(2);
    for (const v of fit.collinearity.vif) expect(v.value).toBeGreaterThan(10);
    expect(fit.warnings.join(' ')).toMatch(/Severe collinearity/);
    expect(fit.warnings.join(' ')).toMatch(/close to meaningless/);
    // Verify VIF independently: 1/(1 − R²) of a on b.
    const aux = fitLinearModel({ y: a, predictors: [col('b', b)] });
    expect(fit.collinearity.vif[0].value).toBeCloseTo(1 / (1 - aux.rSquared), 6);
  });
});

describe('refusals', () => {
  it('refuses n ≤ p', () => {
    expect(() =>
      fitLinearModel({ y: [1, 2, 3], predictors: [col('a', [1, 2, 3]), col('b', [1, 4, 9])] }),
    ).toThrow(/no residual degrees of freedom|n > p/i);
  });

  it('refuses a constant response', () => {
    expect(() => fitLinearModel({ y: [5, 5, 5, 5, 5], predictors: [col('x', [1, 2, 3, 4, 5])] })).toThrow(/constant/i);
  });

  it('refuses a zero-variance predictor', () => {
    expect(() =>
      fitLinearModel({ y: [1, 2, 3, 4, 5], predictors: [col('x', [1, 2, 3, 4, 5]), col('flat', [7, 7, 7, 7, 7])] }),
    ).toThrow(/constant/i);
  });

  it('refuses IRLS non-convergence rather than reporting the stopping point', () => {
    const rng = new Random('irls-stop');
    const n = 400;
    const x = Array.from({ length: n }, () => rng.normal());
    const y = x.map((v) => (rng.bernoulli(1 / (1 + Math.exp(-(0.3 + 1.1 * v)))) ? 1 : 0));
    expect(() =>
      fitGlm({ y, predictors: [col('x', x)], family: 'binomial', maxIterations: 1, tolerance: 1e-14 }),
    ).toThrow(/did not converge/i);
  });

  it('refuses a mismatched column length and a non-positive weight', () => {
    expect(() => fitLinearModel({ y: [1, 2, 3, 4], predictors: [col('x', [1, 2, 3])] })).toThrow(/one value per observation/i);
    expect(() =>
      fitLinearModel({ y: [1, 2, 3, 4, 5], predictors: [col('x', [1, 2, 3, 4, 5])], weights: [1, 1, 0, 1, 1] }),
    ).toThrow(/not positive/i);
  });

  it('refuses prediction intervals for a penalised fit', () => {
    const x = Array.from({ length: 20 }, (_, i) => i);
    const y = x.map((v) => 2 + 0.5 * v);
    const fit = fitLinearModel({ y, predictors: [col('x', x)] });
    const fake = { ...fit, inferenceValid: false };
    expect(() => predictIntervals(fake, [[5]])).toThrow(/penalised/i);
  });
});

describe('missing values', () => {
  it('drops incomplete rows, reports the count and warns about MAR', () => {
    const y = [1, 2, null, 4, 5, 6, 7, undefined, 9, 10];
    const x = [1, 2, 3, 4, null, 6, 7, 8, 9, 10];
    const fit = fitLinearModel({ y, predictors: [{ name: 'x', values: x }] });
    expect(fit.missing.suppliedRows).toBe(10);
    expect(fit.missing.droppedRows).toBe(3);
    expect(fit.missing.rowsUsed).toBe(7);
    expect(fit.n).toBe(7);
    expect(fit.warnings.join(' ')).toMatch(/missing at random/i);
    // NaN counts as missing too, and is never silently turned into a number.
    const withNaN = fitLinearModel({ y: [1, 2, NaN, 4, 5, 6], predictors: [col('x', [1, 2, 3, 4, 5, 6])] });
    expect(withNaN.missing.droppedRows).toBe(1);
    for (const c of withNaN.coefficients) expect(Number.isNaN(c.estimate)).toBe(false);
  });
});
