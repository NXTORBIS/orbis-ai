/**
 * Proportional-hazards diagnostics for a Cox fit.
 *
 * Schoenfeld residuals test the assumption the model cannot check itself: if
 * the scaled residuals trend with time, the hazard ratio is not constant and a
 * single reported ratio is an average over a changing effect. Martingale and
 * deviance residuals look for subjects the model fits badly; dfbeta looks for
 * subjects that move the coefficients on their own.
 */

import { attempt, EngineError, type EngineResult, type Explanation } from '../core/result.ts';
import { solve, type Matrix } from '../stats/linalg.ts';
import { INDEPENDENT_CENSORING } from './data.ts';
import { chiSquareSurvival } from './logrank.ts';
import { PH_CHECK_REQUIRED, type CoxFit } from './cox.ts';

export type TimeTransform = 'identity' | 'log' | 'rank' | 'km';

export interface SchoenfeldCovariateTest {
  name: string;
  /** Correlation between the scaled residual and transformed time. */
  correlation: number;
  statistic: number;
  df: 1;
  pValue: number;
  /** True when the test rejects proportional hazards at the chosen alpha. */
  rejects: boolean;
}

export interface SchoenfeldResult {
  transform: TimeTransform;
  alpha: number;
  /** Raw Schoenfeld residuals, one row per event. */
  residuals: { time: number; values: number[] }[];
  /** Scaled (Grambsch–Therneau) residuals, one row per event. */
  scaledResiduals: { time: number; values: number[] }[];
  perCovariate: SchoenfeldCovariateTest[];
  global: { statistic: number; df: number; pValue: number; rejects: boolean };
  verdict: string;
  explanation: Explanation;
}

/**
 * Grambsch–Therneau test for a time trend in the Schoenfeld residuals.
 *
 * The scaled residual is r*_k = β̂ + d · V⁻¹ r_k (d = number of events,
 * V = the model information). The test regresses r*_k on g(t_k) and tests the
 * slope, per covariate and globally.
 */
export function schoenfeldTest(
  fit: CoxFit,
  options: { transform?: TimeTransform; alpha?: number } = {},
): EngineResult<SchoenfeldResult> {
  return attempt(() => {
    const transform = options.transform ?? 'km';
    const alpha = options.alpha ?? 0.05;
    const design = fit.design;
    const p = design.p;
    const beta = fit.coefficients.map((c) => c.coefficient);
    const rows = design.rows;

    // Risk-set weighted means x̄(t) at each event time, per stratum.
    const residuals: { time: number; values: number[] }[] = [];
    for (const stratum of design.strata) {
      const idx = [...stratum.rows];
      const byStop = [...idx].sort((a, b) => rows[a].stop - rows[b].stop);
      const deathTimes = [...new Set(byStop.filter((i) => rows[i].event === 1).map((i) => rows[i].stop))].sort(
        (a, b) => a - b,
      );
      for (const t of deathTimes) {
        let s0 = 0;
        const s1 = new Array<number>(p).fill(0);
        for (const i of idx) {
          if (!(rows[i].start < t && rows[i].stop >= t)) continue;
          let eta = 0;
          for (let j = 0; j < p; j++) eta += beta[j] * rows[i].covariates[j];
          const w = Math.exp(eta);
          s0 += w;
          for (let j = 0; j < p; j++) s1[j] += w * rows[i].covariates[j];
        }
        if (!(s0 > 0)) continue;
        for (const i of idx) {
          if (rows[i].event !== 1 || rows[i].stop !== t) continue;
          residuals.push({
            time: t,
            values: Array.from({ length: p }, (_, j) => rows[i].covariates[j] - s1[j] / s0),
          });
        }
      }
    }
    const d = residuals.length;
    if (d < p + 2) {
      throw new EngineError([
        {
          code: 'insufficient',
          message:
            `Only ${d} event${d === 1 ? '' : 's'} are available for ${p} covariate${p === 1 ? '' : 's'}; ` +
            'the Schoenfeld time-trend test needs more events than parameters plus two to be meaningful.',
          field: 'events',
        },
      ]);
    }
    // Scaled residuals.
    const information: Matrix = (() => {
      const inv = fit.covariance;
      const m = invertMatrix(inv);
      if (!m) {
        throw new EngineError([
          { code: 'singular', message: 'The Cox covariance matrix could not be inverted for scaling.', field: 'covariance' },
        ]);
      }
      return m;
    })();
    const scaled = residuals.map((r) => {
      const v = solve(
        information.map((row) => [...row]),
        [...r.values],
      );
      if (!v) {
        throw new EngineError([
          { code: 'singular', message: 'Scaling the Schoenfeld residuals failed: singular information matrix.', field: 'covariance' },
        ]);
      }
      return { time: r.time, values: v.map((x, j) => beta[j] + d * x) };
    });

    const g = transformTimes(
      residuals.map((r) => r.time),
      transform,
      fit,
    );
    const gBar = g.reduce((a, b) => a + b, 0) / d;
    const gCentered = g.map((x) => x - gBar);
    const sgg = gCentered.reduce((a, b) => a + b * b, 0);
    if (!(sgg > 0)) {
      throw new EngineError([
        {
          code: 'degenerate',
          message:
            'The transformed event times are all equal, so no time trend can be tested. ' +
            'This happens when every event occurs at the same time.',
          field: 'time',
        },
      ]);
    }
    // Per-covariate: the Grambsch–Therneau score test reduces to
    // T_j = (Σ g̃_k r_{kj})² / (V_jj · Σ g̃_k²) with V the information.
    const perCovariate: SchoenfeldCovariateTest[] = [];
    const u = new Array<number>(p).fill(0);
    for (let j = 0; j < p; j++) {
      let num = 0;
      for (let k = 0; k < d; k++) num += gCentered[k] * residuals[k].values[j];
      u[j] = num;
      // Var(Σ g̃_k r_k) ≈ (Σ g̃_k²) · I_jj / d, since the per-event information
      // is approximately I/d. The factor d is not optional: dropping it makes
      // the test d times too conservative and it then never rejects.
      const stat = (d * num * num) / (sgg * information[j][j]);
      // Correlation of scaled residual with transformed time, for reporting.
      const ys = scaled.map((s) => s.values[j]);
      const yBar = ys.reduce((a, b) => a + b, 0) / d;
      let sxy = 0;
      let syy = 0;
      for (let k = 0; k < d; k++) {
        sxy += gCentered[k] * (ys[k] - yBar);
        syy += (ys[k] - yBar) * (ys[k] - yBar);
      }
      const corr = syy > 0 ? sxy / Math.sqrt(sgg * syy) : 0;
      const pv = chiSquareSurvival(stat, 1);
      perCovariate.push({
        name: design.names[j],
        correlation: corr,
        statistic: stat,
        df: 1,
        pValue: pv,
        rejects: pv < alpha,
      });
    }
    // Global test: U ᵀ (sgg · I / d)⁻¹ U on p degrees of freedom.
    const scaledInfo: Matrix = information.map((row) => row.map((x) => (x * sgg) / d));
    const sol = solve(
      scaledInfo.map((row) => [...row]),
      [...u],
    );
    if (!sol) {
      throw new EngineError([
        { code: 'singular', message: 'The global Schoenfeld test could not be computed: singular information matrix.', field: 'covariance' },
      ]);
    }
    let globalStat = 0;
    for (let j = 0; j < p; j++) globalStat += u[j] * sol[j];
    const globalP = chiSquareSurvival(globalStat, p);
    const rejects = globalP < alpha;
    const verdict = rejects
      ? `Proportional hazards is REJECTED (global p = ${globalP.toExponential(3)} < ${alpha}). The ` +
        'hazard ratios from this fit are averages over an effect that changes with time and should ' +
        'not be reported as constant. Consider a time-varying coefficient, stratification, or ' +
        'comparing restricted mean survival times instead.'
      : `Proportional hazards is not rejected (global p = ${globalP.toFixed(4)} ≥ ${alpha}). This is ` +
        'absence of evidence against the assumption, not evidence for it: the test has little power ' +
        'at low event counts.';

    return {
      transform,
      alpha,
      residuals,
      scaledResiduals: scaled,
      perCovariate,
      global: { statistic: globalStat, df: p, pValue: globalP, rejects },
      verdict,
      explanation: {
        method: 'Grambsch–Therneau test for a time trend in the Schoenfeld residuals',
        formula: 'r*_k = β̂ + d·V⁻¹ r_k;  test the slope of r* on g(t)',
        steps: [
          { label: 'Time transform g', value: transform },
          { label: 'Events used', value: String(d) },
          { label: 'Global statistic', value: `${globalStat.toFixed(6)} on ${p} df` },
          { label: 'Verdict', value: verdict },
        ],
        assumptions: [
          INDEPENDENT_CENSORING,
          'The test is directed at a trend of the chosen form g(t). A non-monotone departure from proportional hazards can pass it.',
        ],
        limitations: [
          'The p-value is an asymptotic chi-square approximation.',
          'The choice of time transform changes the test. The Kaplan–Meier transform is the default because it is less sensitive to a few very late event times than identity time.',
          'Not rejecting is not a pass. With few events the test detects almost nothing.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

function invertMatrix(m: Matrix): Matrix | null {
  const n = m.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const col = solve(
      m.map((r) => [...r]),
      e,
    );
    if (!col) return null;
    for (let i = 0; i < n; i++) out[i][j] = col[i];
  }
  return out;
}

function transformTimes(times: readonly number[], transform: TimeTransform, fit: CoxFit): number[] {
  switch (transform) {
    case 'identity':
      return [...times];
    case 'log':
      return times.map((t) => Math.log(t));
    case 'rank': {
      const sorted = [...new Set(times)].sort((a, b) => a - b);
      const rank = new Map(sorted.map((t, i) => [t, i + 1]));
      return times.map((t) => rank.get(t)!);
    }
    case 'km': {
      // 1 − Ŝ_KM(t) from the pooled data: the standard "km" transform.
      const rows = fit.design.rows;
      const byTime = new Map<number, { events: number; exits: number }>();
      for (const r of rows) {
        let c = byTime.get(r.stop);
        if (!c) {
          c = { events: 0, exits: 0 };
          byTime.set(r.stop, c);
        }
        c.exits++;
        if (r.event === 1) c.events++;
      }
      const ordered = [...byTime.keys()].sort((a, b) => a - b);
      let atRisk = rows.length;
      let s = 1;
      const km = new Map<number, number>();
      for (const t of ordered) {
        const c = byTime.get(t)!;
        if (c.events > 0 && atRisk > 0) s *= 1 - c.events / atRisk;
        km.set(t, s);
        atRisk -= c.exits;
      }
      return times.map((t) => 1 - (km.get(t) ?? s));
    }
  }
}

export interface ResidualSet {
  /** Martingale residual per row: δ − Λ̂₀(T)·exp(xᵀβ̂). */
  martingale: number[];
  /** Deviance residual: a symmetrised martingale residual. */
  deviance: number[];
  /** dfbeta per row and covariate: the approximate change in β̂ from deleting the row. */
  dfbeta: number[][];
  /** Rows whose |dfbeta| exceeds the flag threshold, with the covariate. */
  influential: { row: number; covariate: string; dfbeta: number; standardised: number }[];
  explanation: Explanation;
}

/** Martingale, deviance and dfbeta residuals from a fitted Cox model. */
export function coxResiduals(fit: CoxFit, options: { influenceThreshold?: number } = {}): EngineResult<ResidualSet> {
  return attempt(() => {
    const design = fit.design;
    const beta = fit.coefficients.map((c) => c.coefficient);
    const cumByStratum = new Map<number | string, { times: number[]; cum: number[] }>();
    for (const s of design.strata) {
      const pts = fit.baselineHazard.filter((b) =>
        design.hasStrata ? b.stratum === s.label : true,
      );
      cumByStratum.set(s.label, { times: pts.map((b) => b.time), cum: pts.map((b) => b.cumulativeHazard) });
    }
    const cumAt = (label: number | string, t: number): number => {
      const entry = cumByStratum.get(label);
      if (!entry) return 0;
      let lo = 0;
      let hi = entry.times.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (entry.times[mid] <= t) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return found < 0 ? 0 : entry.cum[found];
    };
    const martingale = design.rows.map((r) => {
      let eta = 0;
      for (let j = 0; j < design.p; j++) eta += beta[j] * r.covariates[j];
      const label = r.stratum ?? '_all';
      const expected = (cumAt(label, r.stop) - cumAt(label, r.start)) * Math.exp(eta);
      return r.event - expected;
    });
    const deviance = design.rows.map((r, i) => {
      const m = martingale[i];
      const delta = r.event;
      const expected = delta - m;
      const inner = expected <= 0 ? 0 : delta * Math.log(delta === 0 ? 1 : delta / expected);
      return Math.sign(m) * Math.sqrt(Math.max(0, -2 * (m + inner)));
    });
    const threshold = options.influenceThreshold ?? 2;
    const influential: ResidualSet['influential'] = [];
    for (let j = 0; j < design.p; j++) {
      const se = fit.coefficients[j].stdError;
      for (let i = 0; i < design.rows.length; i++) {
        const dfb = fit.dfbeta[i][j];
        const std = se > 0 ? dfb / se : 0;
        if (Math.abs(std) > threshold * Math.sqrt(1 / Math.max(1, design.summary.events))) {
          influential.push({ row: i, covariate: design.names[j], dfbeta: dfb, standardised: std });
        }
      }
    }
    influential.sort((a, b) => Math.abs(b.standardised) - Math.abs(a.standardised));
    return {
      martingale,
      deviance,
      dfbeta: fit.dfbeta,
      influential: influential.slice(0, 50),
      explanation: {
        method: 'Martingale, deviance and dfbeta residuals from the Cox fit',
        formula: 'M̂ᵢ = δᵢ − Λ̂₀(Tᵢ)·exp(xᵢᵀβ̂)',
        steps: [
          { label: 'Rows', value: String(design.rows.length) },
          { label: 'Influential rows flagged', value: String(influential.length) },
        ],
        assumptions: [INDEPENDENT_CENSORING, 'Martingale residuals use the Breslow baseline hazard.'],
        limitations: [
          'Martingale residuals are skewed by construction: they are bounded above by 1 but unbounded below. The deviance residual is the symmetrised version and is the one to plot.',
          'dfbeta is a one-step approximation to leave-one-out refitting, not the exact change.',
          PH_CHECK_REQUIRED,
        ],
        exactness: 'numerical',
      },
    };
  });
}
