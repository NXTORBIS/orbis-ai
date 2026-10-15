/**
 * Study design for a survival comparison: the number of EVENTS required, and
 * only then the number of subjects.
 *
 * Power in a time-to-event study is driven by the number of events, not the
 * number of subjects. Doubling the sample while halving the follow-up buys
 * almost nothing. The event count comes first here for that reason; the
 * sample size is derived from it, and depends on accrual and follow-up through
 * the probability that a subject is observed to have an event at all.
 */

import { attempt, EngineError, Validator, type EngineResult, type Explanation } from '../core/result.ts';
import { normalQuantile } from '../special/gamma.ts';
import { normalCdf } from '../special/gamma.ts';

export type EventFormula = 'schoenfeld' | 'freedman';

export const EVENTS_DRIVE_POWER =
  'Power is driven by the number of EVENTS, not the number of subjects. A trial with 2000 subjects ' +
  'and 60 events has the power of a trial with 60 events. Enrolling more people helps only insofar ' +
  'as it produces more events; extending follow-up often helps more.';

export interface RequiredEventsResult {
  formula: EventFormula;
  hazardRatio: number;
  alpha: number;
  power: number;
  allocationRatio: number;
  /** Total events required across both arms. */
  requiredEvents: number;
  explanation: Explanation;
}

/**
 * Events required for a two-arm log-rank test.
 *
 * Schoenfeld: d = (z_{1−α/2} + z_power)² / (p₁ p₂ (log HR)²).
 * Freedman:   d = (z_{1−α/2} + z_power)² (1 + r·HR)² / (r (1 − HR)²).
 *
 * The two differ by a few percent at moderate hazard ratios and more as the
 * ratio moves away from 1; both are reported so the choice is visible.
 */
export function requiredEvents(
  options: {
    hazardRatio: number;
    alpha?: number;
    power?: number;
    /** Allocation ratio, experimental : control. 1 is equal allocation. */
    allocationRatio?: number;
    formula?: EventFormula;
  },
): EngineResult<RequiredEventsResult> {
  return attempt(() => {
    const { hazardRatio } = options;
    const alpha = options.alpha ?? 0.05;
    const power = options.power ?? 0.8;
    const r = options.allocationRatio ?? 1;
    const formula = options.formula ?? 'schoenfeld';
    const v = new Validator();
    v.positive(hazardRatio, 'hazardRatio', 'Hazard ratio');
    v.range(alpha, 'alpha', 'Alpha', 1e-10, 0.5);
    v.range(power, 'power', 'Power', 0.5, 1 - 1e-10);
    v.positive(r, 'allocationRatio', 'Allocation ratio');
    v.throwIfInvalid();
    if (hazardRatio === 1) {
      throw new EngineError([
        {
          code: 'no-effect',
          message:
            'A hazard ratio of exactly 1 is the null hypothesis: no finite number of events gives power ' +
            'against it. Specify the smallest hazard ratio that would matter instead.',
          field: 'hazardRatio',
        },
      ]);
    }
    const za = normalQuantile(1 - alpha / 2);
    const zb = normalQuantile(power);
    const p1 = r / (1 + r);
    const p2 = 1 / (1 + r);
    const d =
      formula === 'schoenfeld'
        ? Math.pow(za + zb, 2) / (p1 * p2 * Math.pow(Math.log(hazardRatio), 2))
        : (Math.pow(za + zb, 2) * Math.pow(1 + r * hazardRatio, 2)) / (r * Math.pow(1 - hazardRatio, 2));
    const other =
      formula === 'schoenfeld'
        ? (Math.pow(za + zb, 2) * Math.pow(1 + r * hazardRatio, 2)) / (r * Math.pow(1 - hazardRatio, 2))
        : Math.pow(za + zb, 2) / (p1 * p2 * Math.pow(Math.log(hazardRatio), 2));
    return {
      formula,
      hazardRatio,
      alpha,
      power,
      allocationRatio: r,
      requiredEvents: Math.ceil(d),
      explanation: {
        method: `Required events for a two-sided log-rank test (${formula} formula)`,
        formula:
          formula === 'schoenfeld'
            ? 'd = (z_{1−α/2} + z_power)² / (p₁ p₂ (log HR)²)'
            : 'd = (z_{1−α/2} + z_power)² (1 + r·HR)² / (r (1 − HR)²)',
        steps: [
          { label: 'Target hazard ratio', value: String(hazardRatio) },
          { label: 'Two-sided alpha', value: String(alpha) },
          { label: 'Power', value: String(power) },
          { label: 'Allocation (exp:ctrl)', value: `${r}:1` },
          { label: 'Required events', value: String(Math.ceil(d)) },
          {
            label: 'Other formula for comparison',
            value: `${formula === 'schoenfeld' ? 'Freedman' : 'Schoenfeld'} gives ${Math.ceil(other)} events`,
          },
          { label: 'What matters', value: EVENTS_DRIVE_POWER },
        ],
        assumptions: [
          'Proportional hazards with the stated constant hazard ratio throughout follow-up. If the effect emerges late, these numbers understate what is needed.',
          'An unweighted log-rank test as the analysis, with no interim analyses and no adjustment for covariates.',
          'Independent (non-informative) censoring, and no loss to follow-up beyond what the sample-size step models.',
        ],
        limitations: [
          EVENTS_DRIVE_POWER,
          'Both formulas are asymptotic approximations. Below roughly 50 events they are optimistic; verify by simulation.',
          'Non-compliance, drop-in, competing risks and crossing hazards all reduce real power below these figures.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

export interface SampleSizeResult extends RequiredEventsResult {
  accrualDuration: number;
  followUpDuration: number;
  controlHazard: number;
  /** Probability a control-arm subject is observed to have an event. */
  controlEventProbability: number;
  experimentalEventProbability: number;
  /** Weighted average event probability across the two arms. */
  averageEventProbability: number;
  totalSubjects: number;
  subjectsControl: number;
  subjectsExperimental: number;
  /** Expected events at the planned sample size, which should match requiredEvents. */
  expectedEvents: number;
}

/**
 * Probability that a subject with constant hazard λ, accrued uniformly over
 * [0, a] and followed until total time a + f, is observed to have an event:
 *
 *   P = 1 − exp(−λ f) (1 − exp(−λ a)) / (λ a)      (Rubinstein et al.)
 *
 * With a = 0 this is the plain 1 − exp(−λ f).
 */
export function eventProbability(hazard: number, accrual: number, followUp: number): number {
  if (accrual <= 0) return 1 - Math.exp(-hazard * followUp);
  return 1 - (Math.exp(-hazard * followUp) * (1 - Math.exp(-hazard * accrual))) / (hazard * accrual);
}

/** Sample size for a two-arm log-rank test under exponential survival. */
export function logRankSampleSize(
  options: {
    hazardRatio: number;
    /** Either the control hazard, or the control median survival. */
    controlHazard?: number;
    controlMedian?: number;
    accrualDuration: number;
    followUpDuration: number;
    alpha?: number;
    power?: number;
    allocationRatio?: number;
    formula?: EventFormula;
    /** Proportion lost to follow-up per unit time, as an extra hazard. */
    dropoutHazard?: number;
  },
): EngineResult<SampleSizeResult> {
  return attempt(() => {
    const v = new Validator();
    v.nonNegative(options.accrualDuration, 'accrualDuration', 'Accrual duration');
    v.nonNegative(options.followUpDuration, 'followUpDuration', 'Follow-up duration');
    if (options.controlHazard === undefined && options.controlMedian === undefined) {
      v.add(
        'Supply either the control hazard or the control median survival; the sample size cannot be ' +
          'derived from the hazard ratio alone, because it depends on how many events the follow-up produces.',
        'controlHazard',
        'required',
      );
    }
    if (options.controlMedian !== undefined) v.positive(options.controlMedian, 'controlMedian', 'Control median survival');
    if (options.controlHazard !== undefined) v.positive(options.controlHazard, 'controlHazard', 'Control hazard');
    v.throwIfInvalid();
    const lambda0 =
      options.controlHazard ?? Math.log(2) / (options.controlMedian as number);
    const lambda1 = lambda0 * options.hazardRatio;
    if (options.accrualDuration === 0 && options.followUpDuration === 0) {
      throw new EngineError([
        {
          code: 'no-follow-up',
          message: 'Accrual and follow-up are both zero, so no events can occur and no sample size exists.',
          field: 'followUpDuration',
        },
      ]);
    }
    const ev = requiredEvents({
      hazardRatio: options.hazardRatio,
      alpha: options.alpha,
      power: options.power,
      allocationRatio: options.allocationRatio,
      formula: options.formula,
    });
    if (!ev.ok) throw new EngineError(ev.errors);
    const drop = options.dropoutHazard ?? 0;
    const a = options.accrualDuration;
    const f = options.followUpDuration;
    // With a competing dropout hazard, the probability of an OBSERVED event is
    // the cause-specific probability for the event of interest.
    const probability = (lambda: number): number => {
      if (drop <= 0) return eventProbability(lambda, a, f);
      const total = lambda + drop;
      return (lambda / total) * eventProbability(total, a, f);
    };
    const p0 = probability(lambda0);
    const p1 = probability(lambda1);
    const r = options.allocationRatio ?? 1;
    const wExp = r / (1 + r);
    const avg = wExp * p1 + (1 - wExp) * p0;
    if (!(avg > 0)) {
      throw new EngineError([
        {
          code: 'no-events',
          message: 'The planned accrual and follow-up produce no events, so no sample size can deliver the required events.',
          field: 'followUpDuration',
        },
      ]);
    }
    const total = Math.ceil(ev.value.requiredEvents / avg);
    const nExp = Math.ceil(total * wExp);
    const nCtrl = total - nExp;
    return {
      ...ev.value,
      accrualDuration: a,
      followUpDuration: f,
      controlHazard: lambda0,
      controlEventProbability: p0,
      experimentalEventProbability: p1,
      averageEventProbability: avg,
      totalSubjects: total,
      subjectsControl: nCtrl,
      subjectsExperimental: nExp,
      expectedEvents: total * avg,
      explanation: {
        ...ev.value.explanation,
        method: `${ev.value.explanation.method}, converted to subjects under exponential survival`,
        steps: [
          ...ev.value.explanation.steps,
          { label: 'Control hazard', value: lambda0.toExponential(6) },
          { label: 'Event probability (control)', value: p0.toFixed(6) },
          { label: 'Event probability (experimental)', value: p1.toFixed(6) },
          { label: 'Subjects required', value: `${total} (${nCtrl} control, ${nExp} experimental)` },
        ],
        assumptions: [
          ...ev.value.explanation.assumptions,
          'Exponential (constant-hazard) survival in both arms, and uniform accrual over the accrual period. The event probability, and therefore the sample size, is sensitive to both.',
        ],
        limitations: [
          ...ev.value.explanation.limitations,
          'The conversion from events to subjects is where most of the error lives: it assumes the planned accrual and follow-up actually happen.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

export interface PowerResult {
  events: number;
  hazardRatio: number;
  alpha: number;
  allocationRatio: number;
  power: number;
  explanation: Explanation;
}

/** Power of a two-sided log-rank test given the number of events (Schoenfeld). */
export function logRankPower(
  options: { events: number; hazardRatio: number; alpha?: number; allocationRatio?: number },
): EngineResult<PowerResult> {
  return attempt(() => {
    const alpha = options.alpha ?? 0.05;
    const r = options.allocationRatio ?? 1;
    const v = new Validator();
    v.positive(options.events, 'events', 'Number of events');
    v.positive(options.hazardRatio, 'hazardRatio', 'Hazard ratio');
    v.range(alpha, 'alpha', 'Alpha', 1e-10, 0.5);
    v.positive(r, 'allocationRatio', 'Allocation ratio');
    v.throwIfInvalid();
    const p1 = r / (1 + r);
    const p2 = 1 / (1 + r);
    const za = normalQuantile(1 - alpha / 2);
    const theta = Math.abs(Math.log(options.hazardRatio)) * Math.sqrt(options.events * p1 * p2);
    const power = normalCdf(theta - za) + normalCdf(-theta - za);
    return {
      events: options.events,
      hazardRatio: options.hazardRatio,
      alpha,
      allocationRatio: r,
      power,
      explanation: {
        method: 'Power of the two-sided log-rank test given an event count (Schoenfeld)',
        formula: 'power = Φ(|log HR|√(d p₁ p₂) − z_{1−α/2}) + Φ(−|log HR|√(d p₁ p₂) − z_{1−α/2})',
        steps: [
          { label: 'Events', value: String(options.events) },
          { label: 'Hazard ratio', value: String(options.hazardRatio) },
          { label: 'Power', value: power.toFixed(6) },
          { label: 'What matters', value: EVENTS_DRIVE_POWER },
        ],
        assumptions: [
          'Proportional hazards with the stated constant hazard ratio.',
          'The event count is treated as fixed and known; in reality it is random, which makes realised power slightly more variable.',
        ],
        limitations: [EVENTS_DRIVE_POWER, 'An asymptotic approximation; verify small studies by simulation.'],
        exactness: 'numerical',
      },
    };
  });
}
