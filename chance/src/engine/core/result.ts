/**
 * Shared result and validation types for the Orbis Chance mathematical engine.
 *
 * Every engine function either returns a structured `EngineResult` or throws an
 * `EngineError` carrying validation issues. Engine code never returns a fake
 * value (such as 0) in place of a failed computation.
 */

/**
 * How a numeric result was obtained.
 *  - exact:       derived symbolically / with exact arithmetic from the inputs.
 *  - numerical:   computed by a deterministic numerical approximation (series,
 *                 continued fraction, root finding) with documented accuracy.
 *  - empirical:   an observed frequency or simulation estimate; subject to
 *                 sampling error.
 *  - assumed:     a value supplied by the user as an assumption / estimate.
 */
export type Exactness = 'exact' | 'numerical' | 'empirical' | 'assumed';

export const EXACTNESS_LABEL: Record<Exactness, string> = {
  exact: 'Exact',
  numerical: 'Numerical approximation',
  empirical: 'Empirical estimate',
  assumed: 'User assumption',
};

export interface Issue {
  /** Machine-readable code, e.g. "range", "required", "sum". */
  code: string;
  /** Human readable message suitable for display. */
  message: string;
  /** Optional input field the issue refers to. */
  field?: string;
}

export interface ExplanationStep {
  label: string;
  /** Formula or expression, plain text with conventional notation. */
  expression?: string;
  /** Result of the step formatted for display. */
  value?: string;
}

/** A deterministic explanation generated from the actual computation. */
export interface Explanation {
  method: string;
  formula?: string;
  steps: ExplanationStep[];
  assumptions: string[];
  limitations: string[];
  exactness: Exactness;
}

export type EngineResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: Issue[] };

export class EngineError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[] | string, code = 'invalid') {
    const list = typeof issues === 'string' ? [{ code, message: issues }] : issues;
    super(list.map((i) => i.message).join('; '));
    this.name = 'EngineError';
    this.issues = list;
  }
}

export function ok<T>(value: T, warnings: string[] = []): EngineResult<T> {
  return { ok: true, value, warnings };
}

export function fail<T = never>(errors: Issue[] | string): EngineResult<T> {
  return { ok: false, errors: typeof errors === 'string' ? [{ code: 'invalid', message: errors }] : errors };
}

/** Run a computation, converting thrown EngineErrors into a failed result. */
export function attempt<T>(fn: () => T, warnings: string[] = []): EngineResult<T> {
  try {
    return ok(fn(), warnings);
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, errors: e.issues };
    if (e instanceof RangeError) return fail([{ code: 'range', message: e.message }]);
    throw e;
  }
}

/** Collects validation issues; throws once at the end if any were recorded. */
export class Validator {
  readonly issues: Issue[] = [];

  add(message: string, field?: string, code = 'invalid'): this {
    this.issues.push({ code, message, field });
    return this;
  }

  finite(value: number, field: string, label = field): boolean {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.add(`${label} must be a finite number.`, field, 'finite');
      return false;
    }
    return true;
  }

  probability(value: number, field: string, label = field): boolean {
    if (!this.finite(value, field, label)) return false;
    if (value < 0 || value > 1) {
      this.add(`${label} must be between 0 and 1 (inclusive).`, field, 'range');
      return false;
    }
    return true;
  }

  positive(value: number, field: string, label = field): boolean {
    if (!this.finite(value, field, label)) return false;
    if (value <= 0) {
      this.add(`${label} must be greater than 0.`, field, 'range');
      return false;
    }
    return true;
  }

  nonNegative(value: number, field: string, label = field): boolean {
    if (!this.finite(value, field, label)) return false;
    if (value < 0) {
      this.add(`${label} must be 0 or greater.`, field, 'range');
      return false;
    }
    return true;
  }

  integer(value: number, field: string, label = field, min = -Infinity, max = Infinity): boolean {
    if (!this.finite(value, field, label)) return false;
    if (!Number.isInteger(value)) {
      this.add(`${label} must be a whole number.`, field, 'integer');
      return false;
    }
    if (value < min || value > max) {
      const range =
        max === Infinity ? `at least ${min}` : min === -Infinity ? `at most ${max}` : `between ${min} and ${max}`;
      this.add(`${label} must be ${range}.`, field, 'range');
      return false;
    }
    return true;
  }

  range(value: number, field: string, label: string, min: number, max: number): boolean {
    if (!this.finite(value, field, label)) return false;
    if (value < min || value > max) {
      this.add(`${label} must be between ${min} and ${max}.`, field, 'range');
      return false;
    }
    return true;
  }

  get valid(): boolean {
    return this.issues.length === 0;
  }

  throwIfInvalid(): void {
    if (this.issues.length) throw new EngineError(this.issues);
  }
}
