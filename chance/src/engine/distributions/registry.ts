/**
 * Distribution registry and higher-level operations: parameter validation,
 * summaries, interval probabilities and curve data for charts.
 */
import { EngineError, type Issue } from '../core/result';
import { CONTINUOUS_DISTRIBUTIONS } from './continuous';
import { DISCRETE_DISTRIBUTIONS } from './discrete';
import { EXTENDED_DISTRIBUTIONS } from './extended';
import type { DistributionDef, DistributionSummary, Moment, Params } from './types';

export const DISTRIBUTIONS: DistributionDef[] = [
  ...DISCRETE_DISTRIBUTIONS,
  ...CONTINUOUS_DISTRIBUTIONS,
  ...EXTENDED_DISTRIBUTIONS,
];

const BY_ID = new Map(DISTRIBUTIONS.map((d) => [d.id, d]));

// A duplicate id would make `getDistribution` silently return whichever
// definition the Map happened to keep, so the collision is caught at module
// load rather than discovered as a wrong distribution at runtime.
if (BY_ID.size !== DISTRIBUTIONS.length) {
  const seen = new Set<string>();
  const duplicates = DISTRIBUTIONS.map((d) => d.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  throw new EngineError(`Duplicate distribution id(s) in the registry: ${[...new Set(duplicates)].join(', ')}.`, 'duplicate');
}

export function getDistribution(id: string): DistributionDef {
  const d = BY_ID.get(id);
  if (!d) throw new EngineError(`Unknown distribution "${id}".`, 'unknown');
  return d;
}

export function hasDistribution(id: string): boolean {
  return BY_ID.has(id);
}

export function defaultParams(def: DistributionDef): Params {
  return Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue]));
}

/** Validate parameters against the distribution's constraints. */
export function validateParams(def: DistributionDef, params: Params): Issue[] {
  const issues: Issue[] = [];
  for (const spec of def.params) {
    const v = params[spec.key];
    const label = `${spec.label} (${spec.symbol})`;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push({ code: 'finite', field: spec.key, message: `${label} must be a finite number.` });
      continue;
    }
    if (spec.integer && !Number.isInteger(v)) {
      issues.push({ code: 'integer', field: spec.key, message: `${label} must be a whole number.` });
    }
    if (spec.min !== undefined && (spec.minExclusive ? v <= spec.min : v < spec.min)) {
      issues.push({ code: 'range', field: spec.key, message: `${label} must be ${spec.minExclusive ? 'greater than' : 'at least'} ${spec.min}.` });
    }
    if (spec.max !== undefined && (spec.maxExclusive ? v >= spec.max : v > spec.max)) {
      issues.push({ code: 'range', field: spec.key, message: `${label} must be ${spec.maxExclusive ? 'less than' : 'at most'} ${spec.max}.` });
    }
  }
  if (!issues.length && def.validateExtra) issues.push(...def.validateExtra(params));
  return issues;
}

export function assertValidParams(def: DistributionDef, params: Params): void {
  const issues = validateParams(def, params);
  if (issues.length) throw new EngineError(issues);
}

function sqrtMoment(m: Moment): Moment {
  if (!m.defined) return m;
  return { defined: true, value: Math.sqrt(m.value) };
}

export function summarize(def: DistributionDef, params: Params): DistributionSummary {
  assertValidParams(def, params);
  const variance = def.variance(params);
  return {
    mean: def.mean(params),
    variance,
    sd: sqrtMoment(variance),
    skewness: def.skewness(params),
    excessKurtosis: def.excessKurtosis(params),
    median: def.quantile(0.5, params),
    mode: def.mode(params),
  };
}

export type IntervalKind = 'le' | 'lt' | 'ge' | 'gt' | 'between' | 'eq';

export interface IntervalQuery {
  kind: IntervalKind;
  a: number;
  /** Upper bound for "between" (inclusive a ≤ X ≤ b). */
  b?: number;
}

export interface IntervalResult {
  probability: number;
  complement: number;
  /** Notation, e.g. "P(2 ≤ X ≤ 5)". */
  notation: string;
  /** How it was computed, e.g. "F(5) − F(1)". */
  method: string;
  note?: string;
}

/**
 * Probability that X falls in an interval. For discrete distributions the
 * inclusive/exclusive distinction matters; for continuous ones P(X = a) = 0.
 */
export function intervalProbability(def: DistributionDef, params: Params, q: IntervalQuery): IntervalResult {
  assertValidParams(def, params);
  const { a } = q;
  if (!Number.isFinite(a)) throw new EngineError('Interval bound must be a finite number.', 'finite');
  const discrete = def.kind === 'discrete';
  const fmt = (x: number) => String(x);
  // For discrete X: P(X < a) = F(⌈a⌉ − 1), P(X ≥ a) = S(⌈a⌉ − 1).
  const below = (x: number) => (discrete ? def.cdf(Math.ceil(x) - 1, params) : def.cdf(x, params));
  const atOrAbove = (x: number) => (discrete ? def.sf(Math.ceil(x) - 1, params) : def.sf(x, params));
  let probability: number;
  let complement: number;
  let notation: string;
  let method: string;
  let note: string | undefined;
  switch (q.kind) {
    case 'le':
      probability = def.cdf(a, params);
      complement = def.sf(a, params);
      notation = `P(X ≤ ${fmt(a)})`;
      method = `F(${fmt(a)})`;
      break;
    case 'lt':
      probability = below(a);
      complement = atOrAbove(a);
      notation = `P(X < ${fmt(a)})`;
      method = discrete ? `F(${Math.ceil(a) - 1})` : `F(${fmt(a)}) (equal to P(X ≤ ${fmt(a)}) for a continuous variable)`;
      break;
    case 'gt':
      probability = def.sf(a, params);
      complement = def.cdf(a, params);
      notation = `P(X > ${fmt(a)})`;
      method = `1 − F(${fmt(a)}) computed directly as the survival function`;
      break;
    case 'ge':
      probability = atOrAbove(a);
      complement = below(a);
      notation = `P(X ≥ ${fmt(a)})`;
      method = discrete ? `1 − F(${Math.ceil(a) - 1})` : `1 − F(${fmt(a)})`;
      break;
    case 'eq':
      if (!discrete) {
        probability = 0;
        complement = 1;
        notation = `P(X = ${fmt(a)})`;
        method = 'Single points have probability 0 for a continuous distribution';
        note = `The density f(${fmt(a)}) = ${def.pdf(a, params).toPrecision(6)} is not a probability. Use an interval instead.`;
      } else {
        probability = def.pdf(a, params);
        complement = 1 - probability;
        notation = `P(X = ${fmt(a)})`;
        method = `p(${fmt(a)})`;
        if (!Number.isInteger(a)) note = 'This distribution only takes whole-number values.';
      }
      break;
    case 'between': {
      const b = q.b;
      if (b === undefined || !Number.isFinite(b)) throw new EngineError('Upper bound must be a finite number.', 'finite');
      if (b < a) throw new EngineError('Upper bound must be at least the lower bound.', 'range');
      // P(a ≤ X ≤ b) = F(b) − P(X < a). Choose the tail form that avoids cancellation.
      const lowerTailA = below(a);
      const cdfB = def.cdf(b, params);
      const sfB = def.sf(b, params);
      const upperTailA = atOrAbove(a);
      probability = cdfB < 0.5 ? cdfB - lowerTailA : upperTailA - sfB;
      probability = Math.max(0, Math.min(1, probability));
      complement = lowerTailA + sfB;
      notation = `P(${fmt(a)} ≤ X ≤ ${fmt(b)})`;
      method = discrete ? `F(${Math.floor(b)}) − F(${Math.ceil(a) - 1})` : `F(${fmt(b)}) − F(${fmt(a)})`;
      break;
    }
  }
  return { probability, complement, notation, method, note };
}

export interface CurvePoint {
  x: number;
  pdf: number;
  cdf: number;
}

/**
 * Sensible plotting range: covers the [0.0005, 0.9995] quantile range (clipped
 * to the support) so the visible window contains at least 99.9% of the mass.
 * Returns the fraction of probability outside the window so charts can label
 * the truncation honestly.
 */
export function plotRange(def: DistributionDef, params: Params): { min: number; max: number; massOutside: number } {
  const s = def.support(params);
  let lo = Number.isFinite(s.min) ? s.min : def.quantile(0.0005, params);
  let hi = Number.isFinite(s.max) ? s.max : def.quantile(0.9995, params);
  if (def.id === 'cauchy') {
    lo = def.quantile(0.02, params);
    hi = def.quantile(0.98, params);
  }
  if (def.kind === 'continuous' && Number.isFinite(s.min) && !Number.isFinite(s.max)) {
    hi = def.quantile(0.9995, params);
  }
  if (def.kind === 'discrete') {
    lo = Math.max(s.min, def.quantile(0.0005, params));
    hi = Math.min(s.max, def.quantile(0.9995, params));
    lo = Math.floor(lo);
    hi = Math.ceil(hi);
  }
  if (!(hi > lo)) hi = lo + 1;
  const massOutside = Math.max(0, (def.kind === 'discrete' ? def.cdf(lo - 1, params) : def.cdf(lo, params)) + def.sf(hi, params));
  return { min: lo, max: hi, massOutside };
}

/** Maximum number of points for a discrete pmf chart before we aggregate. */
export const MAX_DISCRETE_POINTS = 1500;

export function curve(def: DistributionDef, params: Params, range: { min: number; max: number }, points = 400): CurvePoint[] {
  assertValidParams(def, params);
  const out: CurvePoint[] = [];
  if (def.kind === 'discrete') {
    const lo = Math.ceil(range.min);
    const hi = Math.floor(range.max);
    if (hi - lo + 1 > MAX_DISCRETE_POINTS) {
      throw new EngineError(
        `The visible range contains ${hi - lo + 1} values; narrow the range to at most ${MAX_DISCRETE_POINTS} values.`,
        'limit',
      );
    }
    for (let k = lo; k <= hi; k++) out.push({ x: k, pdf: def.pdf(k, params), cdf: def.cdf(k, params) });
    return out;
  }
  const step = (range.max - range.min) / (points - 1);
  for (let i = 0; i < points; i++) {
    const x = i === points - 1 ? range.max : range.min + step * i;
    const pdf = def.pdf(x, params);
    out.push({ x, pdf: Number.isFinite(pdf) ? pdf : NaN, cdf: def.cdf(x, params) });
  }
  return out;
}
