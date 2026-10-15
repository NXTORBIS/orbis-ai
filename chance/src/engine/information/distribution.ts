/**
 * Validation and normalisation of discrete probability vectors and joint
 * tables.
 *
 * The project rules forbid silently repairing user input. A vector that does
 * not sum to 1 is therefore refused with the *actual* sum reported, and is
 * normalised only when the caller explicitly asks, in which case the
 * transformation is returned so the interface can show it.
 */
import { EngineError, type Issue } from '../core/result';
import { stableSum } from '../core/numeric';

/** Tolerance on the sum of a probability vector (absolute). */
export const SUM_TOLERANCE = 1e-9;

export interface NormaliseOptions {
  /**
   * Allow a vector that does not sum to 1 to be divided by its sum. The
   * returned `transformation` text must be shown to the user.
   */
  normalise?: boolean;
  /** Absolute tolerance on |sum − 1| before the vector is rejected. */
  tolerance?: number;
  /** Field name used in error messages. */
  field?: string;
}

export interface ValidatedDistribution {
  /** Probabilities, guaranteed finite, ≥ 0 and summing to 1 within tolerance. */
  p: number[];
  /** The sum of the input before any normalisation. */
  inputSum: number;
  /** Set when the caller allowed normalisation and it was applied. */
  transformation?: string;
}

/**
 * Validate a probability vector. Throws an `EngineError` naming the exact
 * problem (and, for a bad sum, the value of that sum) rather than returning a
 * repaired vector.
 */
export function validateDistribution(
  input: ArrayLike<number>,
  options: NormaliseOptions = {},
): ValidatedDistribution {
  const field = options.field ?? 'distribution';
  const tol = options.tolerance ?? SUM_TOLERANCE;
  const n = input.length;
  const issues: Issue[] = [];
  if (n === 0) {
    throw new EngineError([{ code: 'empty', field, message: `${field}: a probability vector must have at least one outcome.` }]);
  }
  const p = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = input[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push({ code: 'finite', field, message: `${field}[${i}] = ${String(v)} is not a finite number.` });
      p[i] = 0;
      continue;
    }
    if (v < 0) {
      issues.push({ code: 'range', field, message: `${field}[${i}] = ${v} is negative; probabilities cannot be negative.` });
    }
    p[i] = v;
  }
  if (issues.length) throw new EngineError(issues);
  const sum = stableSum(p);
  if (sum <= 0) {
    throw new EngineError([
      { code: 'sum', field, message: `${field} sums to ${sum}; a probability vector must have positive total mass.` },
    ]);
  }
  if (Math.abs(sum - 1) > tol) {
    if (!options.normalise) {
      throw new EngineError([
        {
          code: 'sum',
          field,
          message:
            `${field} is not normalised: its entries sum to ${sum.toPrecision(12)}, not 1 ` +
            `(difference ${(sum - 1).toExponential(3)}). Fix the input, or pass normalise: true to divide by the sum ` +
            `— the division will be reported.`,
        },
      ]);
    }
    const scaled = p.map((v) => v / sum);
    return { p: scaled, inputSum: sum, transformation: `Each entry was divided by the input total ${sum.toPrecision(12)} to normalise it.` };
  }
  return { p, inputSum: sum };
}

/** Validate two distributions that must share the same support (same length). */
export function validatePair(
  pIn: ArrayLike<number>,
  qIn: ArrayLike<number>,
  options: NormaliseOptions = {},
): { p: number[]; q: number[]; transformations: string[] } {
  if (pIn.length !== qIn.length) {
    throw new EngineError([
      {
        code: 'support',
        message:
          `The two distributions are defined on different supports: P has ${pIn.length} outcome(s) and Q has ${qIn.length}. ` +
          'A divergence between them is undefined — align the supports first (include zero-probability outcomes explicitly).',
      },
    ]);
  }
  const a = validateDistribution(pIn, { ...options, field: options.field ? `${options.field} P` : 'P' });
  const b = validateDistribution(qIn, { ...options, field: options.field ? `${options.field} Q` : 'Q' });
  const transformations: string[] = [];
  if (a.transformation) transformations.push(`P: ${a.transformation}`);
  if (b.transformation) transformations.push(`Q: ${b.transformation}`);
  return { p: a.p, q: b.p, transformations };
}

export interface ValidatedJoint {
  /** Row-major joint probabilities, rows indexing X and columns Y. */
  joint: number[][];
  rows: number;
  cols: number;
  /** Marginal of X (row sums). */
  px: number[];
  /** Marginal of Y (column sums). */
  py: number[];
  inputSum: number;
  transformation?: string;
}

/** Validate a rectangular joint distribution table. */
export function validateJoint(table: readonly ArrayLike<number>[], options: NormaliseOptions = {}): ValidatedJoint {
  const field = options.field ?? 'joint distribution';
  if (table.length === 0) throw new EngineError(`${field}: the table has no rows.`, 'empty');
  const cols = table[0].length;
  if (cols === 0) throw new EngineError(`${field}: the table has no columns.`, 'empty');
  const flat: number[] = [];
  for (let i = 0; i < table.length; i++) {
    if (table[i].length !== cols) {
      throw new EngineError(
        `${field}: row ${i} has ${table[i].length} entries but row 0 has ${cols}. The joint table must be rectangular.`,
        'shape',
      );
    }
    for (let j = 0; j < cols; j++) flat.push(table[i][j]);
  }
  const v = validateDistribution(flat, { ...options, field });
  const rows = table.length;
  const joint: number[][] = [];
  for (let i = 0; i < rows; i++) joint.push(v.p.slice(i * cols, (i + 1) * cols));
  const px = joint.map((row) => stableSum(row));
  const py = new Array<number>(cols).fill(0);
  for (let j = 0; j < cols; j++) {
    const col = new Array<number>(rows);
    for (let i = 0; i < rows; i++) col[i] = joint[i][j];
    py[j] = stableSum(col);
  }
  return { joint, rows, cols, px, py, inputSum: v.inputSum, transformation: v.transformation };
}

/** Flatten an n-dimensional probability array (nested arrays) into a vector. */
export function flattenNested(value: NestedProbabilities): number[] {
  const out: number[] = [];
  const walk = (node: NestedProbabilities): void => {
    if (typeof node === 'number') {
      out.push(node);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(value);
  return out;
}

export type NestedProbabilities = number | readonly NestedProbabilities[];

/** Shape of a nested probability array, refusing ragged input. */
export function nestedShape(value: NestedProbabilities, field = 'distribution'): number[] {
  if (typeof value === 'number') return [];
  if (value.length === 0) throw new EngineError(`${field}: an axis has length 0.`, 'empty');
  const sub = nestedShape(value[0], field);
  for (const child of value) {
    const s = nestedShape(child, field);
    if (s.length !== sub.length || s.some((x, i) => x !== sub[i])) {
      throw new EngineError(`${field}: the array is ragged — every axis must have a constant length.`, 'shape');
    }
  }
  return [value.length, ...sub];
}
