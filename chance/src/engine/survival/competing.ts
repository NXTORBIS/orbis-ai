/**
 * Competing risks: the cumulative incidence function (Aalen–Johansen) and the
 * Fine–Gray subdistribution hazard model.
 *
 * The error this module exists to prevent: estimating the incidence of one
 * cause by treating the competing causes as censoring and reporting
 * 1 − Kaplan–Meier. That OVERESTIMATES the incidence of the cause, sometimes
 * severely, because it asks "what would happen if the competing causes did not
 * exist" and then presents the answer as the observed risk. The subjects who
 * died of something else cannot later die of this cause, and the
 * Aalen–Johansen estimator accounts for that. Both are computed here so the
 * size of the error is visible.
 */

import { attempt, EngineError, Validator, type EngineResult, type Explanation } from '../core/result.ts';
import { normalCdf } from '../special/gamma.ts';
import { solve, type Matrix } from '../stats/linalg.ts';
import { INDEPENDENT_CENSORING, censoringNote, summarizeFollowUp, zForLevel, type FollowUpSummary } from './data.ts';

export const ONE_MINUS_KM_WARNING =
  'With competing risks, 1 − Kaplan–Meier for one cause (treating the other causes as censoring) ' +
  'OVERESTIMATES that cause’s cumulative incidence. It estimates the risk in a hypothetical world ' +
  'where the competing causes have been removed, which is not the observed risk of anything. Report ' +
  'the Aalen–Johansen cumulative incidence instead; the two are given side by side here so the size ' +
  'of the difference is visible.';

export interface CIFPoint {
  time: number;
  atRisk: number;
  /** Events of this cause at this time. */
  events: number;
  /** Events of any competing cause at this time. */
  competingEvents: number;
  /** Overall event-free survival just before this time, Ŝ(t−). */
  overallSurvivalBefore: number;
  /** Aalen–Johansen cumulative incidence of this cause. */
  cumulativeIncidence: number;
  stdError: number;
  lower: number;
  upper: number;
  /** 1 − KM treating competing events as censoring. Reported to expose the bias. */
  oneMinusKaplanMeier: number;
}

export interface CumulativeIncidenceResult {
  cause: number;
  causes: number[];
  summary: FollowUpSummary;
  /** Count of events by cause code. */
  eventsByCause: { cause: number; events: number }[];
  curve: CIFPoint[];
  /** Largest absolute excess of 1 − KM over Aalen–Johansen across the curve. */
  maxOverestimate: number;
  warning: string;
  explanation: Explanation;
}

function validateCompeting(
  time: readonly number[],
  cause: readonly number[],
): { causes: number[]; counts: Map<number, number> } {
  const v = new Validator();
  if (time.length !== cause.length) {
    v.add(`Mismatched lengths: ${time.length} times but ${cause.length} cause codes.`, 'cause', 'length');
    v.throwIfInvalid();
  }
  if (time.length === 0) {
    v.add('No observations supplied.', 'time', 'empty');
    v.throwIfInvalid();
  }
  const counts = new Map<number, number>();
  for (let i = 0; i < time.length; i++) {
    if (!Number.isFinite(time[i])) v.add(`Observation ${i + 1} has a non-finite time.`, 'time', 'finite');
    else if (time[i] < 0) v.add(`Observation ${i + 1} has a negative time (${time[i]}).`, 'time', 'range');
    const c = cause[i];
    if (!Number.isInteger(c) || c < 0) {
      v.add(
        `Observation ${i + 1} has cause code ${String(c)}; use 0 for censored and a positive integer per cause.`,
        'cause',
        'domain',
      );
      continue;
    }
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  v.throwIfInvalid();
  const causes = [...counts.keys()].filter((c) => c > 0).sort((a, b) => a - b);
  if (causes.length === 0) {
    throw new EngineError([
      {
        code: 'no-events',
        message:
          'Every observation is censored: no event of any cause was observed, so no cumulative ' +
          'incidence is estimable.',
        field: 'cause',
      },
    ]);
  }
  return { causes, counts };
}

/** Aalen–Johansen cumulative incidence for one cause, with 1 − KM alongside it. */
export function cumulativeIncidence(
  time: readonly number[],
  cause: readonly number[],
  targetCause = 1,
  level = 0.95,
): EngineResult<CumulativeIncidenceResult> {
  return attempt(() => {
    const { causes, counts } = validateCompeting(time, cause);
    if (!causes.includes(targetCause)) {
      throw new EngineError([
        {
          code: 'unknown-cause',
          message:
            `Cause ${targetCause} has no events in this data (observed causes: ${causes.join(', ')}), so its ` +
            'cumulative incidence is zero throughout and nothing is estimable about it.',
          field: 'cause',
        },
      ]);
    }
    const z = zForLevel(level);
    const byTime = new Map<number, { target: number; competing: number; censored: number }>();
    for (let i = 0; i < time.length; i++) {
      let cell = byTime.get(time[i]);
      if (!cell) {
        cell = { target: 0, competing: 0, censored: 0 };
        byTime.set(time[i], cell);
      }
      if (cause[i] === 0) cell.censored++;
      else if (cause[i] === targetCause) cell.target++;
      else cell.competing++;
    }
    const times = [...byTime.keys()].sort((a, b) => a - b);
    let atRisk = time.length;
    let overall = 1; // event-free survival for ANY cause
    let cif = 0;
    let kmCause = 1; // KM treating competing events as censoring
    const curve: CIFPoint[] = [];
    // Variance terms accumulated per Aalen's delta-method formula.
    const history: { sBefore: number; d1: number; d: number; n: number; cifAt: number }[] = [];
    for (const t of times) {
      const cell = byTime.get(t)!;
      const d1 = cell.target;
      const d = cell.target + cell.competing;
      if (d > 0) {
        const sBefore = overall;
        cif += (sBefore * d1) / atRisk;
        overall *= 1 - d / atRisk;
        if (d1 > 0) kmCause *= 1 - d1 / atRisk;
        history.push({ sBefore, d1, d, n: atRisk, cifAt: cif });
        curve.push({
          time: t,
          atRisk,
          events: d1,
          competingEvents: cell.competing,
          overallSurvivalBefore: sBefore,
          cumulativeIncidence: cif,
          stdError: 0,
          lower: 0,
          upper: 0,
          oneMinusKaplanMeier: 1 - kmCause,
        });
      }
      atRisk -= d + cell.censored;
    }
    // Aalen (1978) variance of the cumulative incidence.
    for (let k = 0; k < curve.length; k++) {
      const F = curve[k].cumulativeIncidence;
      let varSum = 0;
      for (let j = 0; j <= k; j++) {
        const h = history[j];
        const n = h.n;
        if (n <= 0) continue;
        const diff = F - h.cifAt;
        const termA = n > h.d ? (diff * diff * h.d) / (n * (n - h.d)) : 0;
        const termB = (h.sBefore * h.sBefore * ((n - h.d1) / n) * h.d1) / (n * n);
        const termC = (2 * diff * h.sBefore * h.d1) / (n * n);
        varSum += termA + termB - termC;
      }
      const se = Math.sqrt(Math.max(0, varSum));
      curve[k].stdError = se;
      curve[k].lower = Math.max(0, F - z * se);
      curve[k].upper = Math.min(1, F + z * se);
    }
    const maxOverestimate = curve.reduce(
      (m, p) => Math.max(m, p.oneMinusKaplanMeier - p.cumulativeIncidence),
      0,
    );
    const statusForSummary = cause.map((c) => (c === 0 ? 0 : 1));
    const summary = summarizeFollowUp(time, statusForSummary);
    return {
      cause: targetCause,
      causes,
      summary,
      eventsByCause: causes.map((c) => ({ cause: c, events: counts.get(c) ?? 0 })),
      curve,
      maxOverestimate,
      warning:
        ONE_MINUS_KM_WARNING +
        ` In this data the largest excess of 1 − KM over the Aalen–Johansen estimate is ${maxOverestimate.toFixed(4)}.`,
      explanation: {
        method: 'Aalen–Johansen cumulative incidence function for competing risks',
        formula: 'F̂_k(t) = Σ_{t_j ≤ t} Ŝ(t_{j−1}) · d_{jk} / n_j',
        steps: [
          { label: 'Sample', value: censoringNote(summary) },
          { label: 'Causes observed', value: causes.map((c) => `${c}: ${counts.get(c) ?? 0}`).join(', ') },
          { label: 'Target cause', value: String(targetCause) },
          {
            label: 'Largest 1 − KM overestimate',
            value: maxOverestimate.toFixed(6),
          },
          { label: 'Warning', value: ONE_MINUS_KM_WARNING },
        ],
        assumptions: [
          INDEPENDENT_CENSORING,
          'Censoring is assumed independent of all causes. Competing events are NOT censoring and are not treated as such here.',
          'Each subject is assumed to experience at most one event, whose cause is recorded correctly.',
        ],
        limitations: [
          'Standard errors use the asymptotic delta-method variance; coverage is poor when few events of the target cause have occurred.',
          'The cumulative incidence curves of all causes sum to 1 − Ŝ(t); a cause-specific curve cannot be interpreted on its own without the others.',
          ONE_MINUS_KM_WARNING,
        ],
        exactness: 'empirical',
      },
    };
  });
}

export interface FineGrayCoefficient {
  name: string;
  coefficient: number;
  stdError: number;
  subdistributionHazardRatio: number;
  lower: number;
  upper: number;
  z: number;
  pValue: number;
}

export interface FineGrayFit {
  cause: number;
  coefficients: FineGrayCoefficient[];
  logPseudoLikelihood: number;
  iterations: number;
  summary: FollowUpSummary;
  explanation: Explanation;
}

/**
 * Fine–Gray subdistribution hazard model, fitted by Newton–Raphson on the
 * inverse-probability-of-censoring-weighted partial likelihood.
 *
 * The coefficient is a SUBDISTRIBUTION hazard ratio: it describes the effect on
 * the cumulative incidence of this cause, not on its cause-specific hazard.
 * The two answer different questions and routinely point in different
 * directions; neither is a substitute for the other.
 *
 * Cost is O(iterations · events · n), so this is intended for moderate samples.
 */
export function fineGray(
  time: readonly number[],
  cause: readonly number[],
  covariates: readonly number[][],
  options: { targetCause?: number; names?: string[]; level?: number; maxIterations?: number } = {},
): EngineResult<FineGrayFit> {
  return attempt(() => {
    const { causes } = validateCompeting(time, cause);
    const targetCause = options.targetCause ?? 1;
    const n = time.length;
    const v = new Validator();
    if (covariates.length !== n) {
      v.add(`Mismatched lengths: ${n} times but ${covariates.length} covariate rows.`, 'covariates', 'length');
      v.throwIfInvalid();
    }
    const p = covariates[0].length;
    if (p === 0) v.add('No covariates supplied.', 'covariates', 'empty');
    covariates.forEach((row, i) => {
      if (row.length !== p) v.add(`Covariate row ${i + 1} has ${row.length} values but row 1 has ${p}.`, 'covariates', 'length');
      row.forEach((x, j) => {
        if (!Number.isFinite(x)) v.add(`Covariate ${j + 1} of subject ${i + 1} is not finite.`, 'covariates', 'finite');
      });
    });
    if (options.names && options.names.length !== p) {
      v.add(`Expected ${p} covariate names but received ${options.names.length}.`, 'names', 'length');
    }
    v.throwIfInvalid();
    if (!causes.includes(targetCause)) {
      throw new EngineError([
        {
          code: 'unknown-cause',
          message: `Cause ${targetCause} has no events (observed: ${causes.join(', ')}); no subdistribution model is estimable.`,
          field: 'cause',
        },
      ]);
    }
    const level = options.level ?? 0.95;
    const z = zForLevel(level);

    // Censoring distribution Ĝ by the reverse Kaplan–Meier (censoring as "event").
    const byTime = new Map<number, { cens: number; evt: number }>();
    for (let i = 0; i < n; i++) {
      let c = byTime.get(time[i]);
      if (!c) {
        c = { cens: 0, evt: 0 };
        byTime.set(time[i], c);
      }
      if (cause[i] === 0) c.cens++;
      else c.evt++;
    }
    const allTimes = [...byTime.keys()].sort((a, b) => a - b);
    const gTimes: number[] = [];
    const gValues: number[] = [];
    let atRisk = n;
    let g = 1;
    for (const t of allTimes) {
      const c = byTime.get(t)!;
      if (c.cens > 0) g *= 1 - c.cens / atRisk;
      gTimes.push(t);
      gValues.push(g);
      atRisk -= c.cens + c.evt;
    }
    const gAt = (t: number): number => {
      // Ĝ(t), right-continuous step function; 1 before the first time.
      let lo = 0;
      let hi = gTimes.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (gTimes[mid] <= t) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return found < 0 ? 1 : gValues[found];
    };
    const eventTimes = [...new Set(time.filter((_, i) => cause[i] === targetCause))].sort((a, b) => a - b);
    // IPCW weight of subject i in the risk set at time t.
    const weightAt = (i: number, t: number): number => {
      if (time[i] >= t) return 1; // still under observation: ordinary risk set member
      if (cause[i] === 0 || cause[i] === targetCause) return 0; // censored or already had the event
      // Competing event before t: stays in the subdistribution risk set, down-weighted.
      const denom = gAt(time[i]);
      if (!(denom > 0)) return 0;
      return Math.min(1, gAt(t) / denom);
    };

    const evaluate = (beta: readonly number[]) => {
      let logLik = 0;
      const grad = new Array<number>(p).fill(0);
      const info: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
      const eta = covariates.map((row) => {
        let s = 0;
        for (let j = 0; j < p; j++) s += beta[j] * row[j];
        return s;
      });
      for (const t of eventTimes) {
        let s0 = 0;
        const s1 = new Array<number>(p).fill(0);
        const s2: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
        for (let i = 0; i < n; i++) {
          const w = weightAt(i, t);
          if (w === 0) continue;
          const wi = w * Math.exp(eta[i]);
          s0 += wi;
          for (let a = 0; a < p; a++) {
            s1[a] += wi * covariates[i][a];
            for (let b = 0; b <= a; b++) s2[a][b] += wi * covariates[i][a] * covariates[i][b];
          }
        }
        if (!(s0 > 0)) {
          throw new EngineError([
            {
              code: 'empty-risk-set',
              message: `The weighted subdistribution risk set at time ${t} is empty, so the Fine–Gray pseudo-likelihood is undefined.`,
              field: 'time',
            },
          ]);
        }
        for (let i = 0; i < n; i++) {
          if (time[i] !== t || cause[i] !== targetCause) continue;
          logLik += eta[i] - Math.log(s0);
          for (let a = 0; a < p; a++) {
            grad[a] += covariates[i][a] - s1[a] / s0;
            for (let b = 0; b <= a; b++) {
              info[a][b] += s2[a][b] / s0 - (s1[a] * s1[b]) / (s0 * s0);
            }
          }
        }
      }
      for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) info[a][b] = info[b][a];
      return { logLik, grad, info };
    };

    let beta = new Array<number>(p).fill(0);
    let current = evaluate(beta);
    const maxIterations = options.maxIterations ?? 40;
    let iterations = 0;
    let converged = false;
    for (; iterations < maxIterations; iterations++) {
      const step = solve(
        current.info.map((r) => [...r]),
        [...current.grad],
      );
      if (!step || step.some((s) => !Number.isFinite(s))) {
        throw new EngineError([
          {
            code: 'singular',
            message:
              'The Fine–Gray information matrix is singular: a covariate is collinear, constant, or ' +
              'perfectly separates the subdistribution risk sets, so no finite coefficient maximises the ' +
              'pseudo-likelihood.',
            field: 'covariates',
          },
        ]);
      }
      let scale = 1;
      let accepted = false;
      for (let halving = 0; halving < 30; halving++) {
        const cand = beta.map((b, j) => b + scale * step[j]);
        const next = evaluate(cand);
        if (Number.isFinite(next.logLik) && next.logLik >= current.logLik - 1e-12) {
          const improvement = next.logLik - current.logLik;
          beta = cand;
          current = next;
          accepted = true;
          if (Math.abs(improvement) < 1e-10 || Math.max(...next.grad.map(Math.abs)) < 1e-8) converged = true;
          break;
        }
        scale /= 2;
      }
      if (!accepted) {
        throw new EngineError([
          {
            code: 'no-convergence',
            message:
              'The Fine–Gray fit could not improve the pseudo-likelihood even with step halving; the ' +
              'model is not identified by this data.',
            field: 'covariates',
          },
        ]);
      }
      if (converged) {
        iterations++;
        break;
      }
    }
    if (!converged) {
      throw new EngineError([
        {
          code: 'no-convergence',
          message: `The Fine–Gray fit did not converge within ${maxIterations} iterations; no coefficients are reported.`,
          field: 'covariates',
        },
      ]);
    }
    const cov = (() => {
      const out: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
      for (let j = 0; j < p; j++) {
        const e = new Array<number>(p).fill(0);
        e[j] = 1;
        const col = solve(
          current.info.map((r) => [...r]),
          e,
        );
        if (!col) {
          throw new EngineError([
            { code: 'singular', message: 'The Fine–Gray information matrix could not be inverted for standard errors.', field: 'covariates' },
          ]);
        }
        for (let i = 0; i < p; i++) out[i][j] = col[i];
      }
      return out;
    })();
    const names = options.names ?? Array.from({ length: p }, (_, j) => `x${j + 1}`);
    const statusForSummary = cause.map((c) => (c === 0 ? 0 : 1));
    const summary = summarizeFollowUp(time, statusForSummary);
    return {
      cause: targetCause,
      coefficients: names.map((name, j) => {
        const est = beta[j];
        const se = Math.sqrt(cov[j][j]);
        const stat = est / se;
        return {
          name,
          coefficient: est,
          stdError: se,
          subdistributionHazardRatio: Math.exp(est),
          lower: Math.exp(est - z * se),
          upper: Math.exp(est + z * se),
          z: stat,
          pValue: 2 * (1 - normalCdf(Math.abs(stat))),
        };
      }),
      logPseudoLikelihood: current.logLik,
      iterations,
      summary,
      explanation: {
        method: 'Fine–Gray subdistribution hazard model (IPCW-weighted partial likelihood)',
        formula: 'λ_k(t | x) = λ_{k0}(t) · exp(xᵀβ), where λ_k is the subdistribution hazard of cause k',
        steps: [
          { label: 'Sample', value: censoringNote(summary) },
          { label: 'Target cause', value: String(targetCause) },
          { label: 'Iterations', value: String(iterations) },
          {
            label: 'Interpretation',
            value:
              'exp(β) is a SUBDISTRIBUTION hazard ratio: it describes the effect on the cumulative ' +
              'incidence of this cause. It is not a cause-specific hazard ratio, and the two can point ' +
              'in opposite directions because a covariate that reduces the competing cause raises the ' +
              'incidence of this one.',
          },
        ],
        assumptions: [
          INDEPENDENT_CENSORING,
          'The censoring distribution is estimated from the whole sample, so censoring is additionally assumed independent of the covariates. If censoring depends on covariates, the IPCW weights are wrong.',
          'The subdistribution hazard is assumed proportional in the covariates — the analogue of the Cox assumption, and equally unchecked by fitting.',
        ],
        limitations: [
          'Standard errors here are the inverse of the pseudo-likelihood information and do NOT include the variability of the estimated censoring weights, so they are mildly anti-conservative. The published variance estimator adds that term.',
          'Cost grows as events × sample size; this implementation is intended for moderate samples.',
        ],
        exactness: 'numerical',
      },
    };
  });
}
