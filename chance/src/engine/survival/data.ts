/**
 * Survival / time-to-event analysis — shared input handling.
 *
 * Censoring is the whole reason this is a separate field. A subject observed
 * for 5 years without the event contributes the information "survived at least
 * 5 years", which is neither "event at 5 years" nor "no data". Dropping such
 * subjects biases every estimate downward; counting them as events biases it
 * downward too (in a different way). The estimators here use them correctly,
 * but all of them rest on one assumption that no computation can check:
 * censoring must be independent of prognosis.
 */

import { EngineError, Validator } from '../core/result.ts';
import { normalQuantile } from '../special/gamma.ts';

/** Status code convention: 0 = right-censored, 1 = the event of interest. */
export type Status = 0 | 1;

/**
 * The assumption behind every estimator in this module. It is stated on every
 * result on purpose: it is untestable from the observed data alone.
 */
export const INDEPENDENT_CENSORING =
  'Censoring is assumed independent (non-informative): at every time, subjects still under ' +
  'observation must have the same future risk as those censored at that time. If censoring is ' +
  'related to prognosis (sicker subjects withdraw, or follow-up stops because of the outcome), ' +
  'every number here is biased, and no amount of computation can detect that from this data alone.';

export const CENSORING_FRAGILITY =
  'Heavy censoring makes every estimate fragile: the tail of the curve rests on few subjects, ' +
  'and confidence intervals there are wide and approximate.';

/** n, events, censoring and the follow-up range: reported on every result. */
export interface FollowUpSummary {
  n: number;
  events: number;
  censored: number;
  /** Fraction of observations that are censored, in [0, 1]. */
  censoringFraction: number;
  minTime: number;
  maxTime: number;
  /** Largest time at which an event was observed, or null if there are none. */
  lastEventTime: number | null;
  /** Number of distinct times at which at least one event occurred. */
  distinctEventTimes: number;
}

export interface ValidateOptions {
  /** Allow a sample in which nothing happened (used only by internal helpers). */
  allowZeroEvents?: boolean;
  /** Field name prefix for error messages. */
  label?: string;
}

/** Throws an EngineError naming the problem; never silently repairs input. */
export function validateSurvivalInput(
  time: readonly number[],
  status: readonly number[],
  options: ValidateOptions = {},
): void {
  const v = new Validator();
  const label = options.label ?? 'time';
  if (time.length !== status.length) {
    v.add(
      `Mismatched lengths: ${time.length} times but ${status.length} status values. ` +
        'Every subject needs exactly one time and one status.',
      label,
      'length',
    );
    v.throwIfInvalid();
  }
  if (time.length === 0) {
    v.add('No observations were supplied, so nothing can be estimated.', label, 'empty');
    v.throwIfInvalid();
  }
  let events = 0;
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    if (!Number.isFinite(t)) {
      v.add(`Observation ${i + 1} has a non-finite follow-up time (${String(t)}).`, label, 'finite');
    } else if (t < 0) {
      v.add(`Observation ${i + 1} has a negative follow-up time (${t}). Times must be ≥ 0.`, label, 'range');
    }
    const s = status[i];
    if (s !== 0 && s !== 1) {
      v.add(
        `Observation ${i + 1} has status ${String(s)}; use 1 for an event and 0 for right-censored.`,
        'status',
        'domain',
      );
    } else if (s === 1) events++;
  }
  v.throwIfInvalid();
  if (events === 0 && !options.allowZeroEvents) {
    throw new EngineError(
      [
        {
          code: 'no-events',
          message:
            `All ${time.length} observations are censored: not one event was observed. ` +
            'With zero events nothing is estimable — no survival curve, no median, no hazard ratio. ' +
            'The only honest statement is a lower bound on survival from the follow-up achieved.',
          field: 'status',
        },
      ],
    );
  }
}

export function summarizeFollowUp(time: readonly number[], status: readonly number[]): FollowUpSummary {
  let events = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;
  let lastEventTime: number | null = null;
  const eventTimes = new Set<number>();
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    if (t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;
    if (status[i] === 1) {
      events++;
      eventTimes.add(t);
      if (lastEventTime === null || t > lastEventTime) lastEventTime = t;
    }
  }
  const n = time.length;
  return {
    n,
    events,
    censored: n - events,
    censoringFraction: (n - events) / n,
    minTime,
    maxTime,
    lastEventTime,
    distinctEventTimes: eventTimes.size,
  };
}

/** Human-readable one-liner for the censoring picture, for the explanation steps. */
export function censoringNote(s: FollowUpSummary): string {
  const pct = (100 * s.censoringFraction).toFixed(1);
  return (
    `n = ${s.n}, events = ${s.events}, censored = ${s.censored} (${pct}%), ` +
    `follow-up ${s.minTime} to ${s.maxTime}` +
    (s.lastEventTime === null ? '' : `, last event at ${s.lastEventTime}`)
  );
}

export function heavyCensoringWarnings(s: FollowUpSummary): string[] {
  const out: string[] = [];
  if (s.censoringFraction >= 0.5) {
    out.push(
      `${(100 * s.censoringFraction).toFixed(1)}% of observations are censored. ` + CENSORING_FRAGILITY,
    );
  }
  if (s.events < 10) {
    out.push(
      `Only ${s.events} event${s.events === 1 ? '' : 's'} observed. Asymptotic standard errors, ` +
        'confidence intervals and p-values are unreliable at this event count.',
    );
  }
  return out;
}

/** One row of the risk table: the audit trail behind every curve in this module. */
export interface RiskRow {
  time: number;
  /** Number still under observation and event-free just before `time`. */
  atRisk: number;
  /** Events observed exactly at `time`. */
  events: number;
  /** Observations censored exactly at `time`. */
  censored: number;
}

/**
 * Risk table over every distinct observed time (event or censoring).
 * Convention: censoring at time t is treated as occurring just after any event
 * at t, so a subject censored at t is counted in the risk set at t.
 */
export function buildRiskTable(time: readonly number[], status: readonly number[]): RiskRow[] {
  const byTime = new Map<number, { events: number; censored: number }>();
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    let cell = byTime.get(t);
    if (!cell) {
      cell = { events: 0, censored: 0 };
      byTime.set(t, cell);
    }
    if (status[i] === 1) cell.events++;
    else cell.censored++;
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const rows: RiskRow[] = [];
  let remaining = time.length;
  for (const t of times) {
    const cell = byTime.get(t)!;
    rows.push({ time: t, atRisk: remaining, events: cell.events, censored: cell.censored });
    remaining -= cell.events + cell.censored;
  }
  return rows;
}

/** Sorted index permutation by time ascending, events before censorings at ties. */
export function orderByTime(time: readonly number[], status: readonly number[]): number[] {
  const idx = Array.from({ length: time.length }, (_, i) => i);
  idx.sort((a, b) => time[a] - time[b] || status[b] - status[a]);
  return idx;
}

/** Normal quantile for a two-sided level, e.g. level 0.95 → 1.959963985… */
export function zForLevel(level: number): number {
  const v = new Validator();
  if (!(level > 0 && level < 1)) {
    v.add(`Confidence level must be strictly between 0 and 1 (got ${level}).`, 'level', 'range');
    v.throwIfInvalid();
  }
  return normalQuantile(1 - (1 - level) / 2);
}

