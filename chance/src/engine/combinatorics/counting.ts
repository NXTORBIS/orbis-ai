/**
 * Exact combinatorics using BigInt, with documented limits.
 *
 * Counts are exact integers (BigInt) rather than floating-point values, so
 * C(100, 50) is returned precisely. Because very large results are expensive
 * to compute and display, each function enforces a limit and reports it rather
 * than hanging or overflowing. When a count is too large for exact arithmetic,
 * the natural logarithm of the count is offered instead, clearly labelled as
 * an approximation.
 */
import { EngineError, type Issue } from '../core/result';
import { logChoose, logFactorial, logGamma } from '../special/gamma';

/** Largest n for which n! is computed exactly. 20000! has ~77 000 digits. */
export const MAX_EXACT_FACTORIAL = 20000;
/** Largest n for exact permutation/combination counts. */
export const MAX_EXACT_N = 2_000_000;
/** Digits above which we present the result in scientific notation only. */
export const MAX_DISPLAY_DIGITS = 50;

export interface CountResult {
  /** Exact value when available. */
  exact: bigint | null;
  /** Natural logarithm of the count — always available. */
  logValue: number;
  /** Floating-point approximation; Infinity when the count overflows a double. */
  approx: number;
  /** Formula in conventional notation. */
  formula: string;
  /** Explanation of the method and any precision limitation. */
  note?: string;
  digits: number;
}

function result(exact: bigint | null, logValue: number, formula: string, note?: string): CountResult {
  const approx = exact !== null ? bigToNumber(exact) : Math.exp(logValue);
  const digits = exact !== null ? exact.toString().length : Math.max(1, Math.floor(logValue / Math.LN10) + 1);
  return { exact, logValue, approx, formula, note, digits };
}

/** Convert a BigInt to the nearest double, returning Infinity on overflow. */
export function bigToNumber(x: bigint): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : Infinity;
}

/** Format a count for display: exact digits when short, scientific otherwise. */
export function formatCount(r: CountResult): string {
  if (r.exact !== null && r.digits <= MAX_DISPLAY_DIGITS) return r.exact.toLocaleString('en-US');
  const mantissaLog = r.logValue / Math.LN10;
  const exponent = Math.floor(mantissaLog);
  const mantissa = Math.pow(10, mantissaLog - exponent);
  return `${mantissa.toFixed(6)} × 10^${exponent}`;
}

export function factorialExact(n: number): bigint {
  let acc = 1n;
  for (let i = 2n; i <= BigInt(n); i++) acc *= i;
  return acc;
}

export function factorial(n: number): CountResult {
  if (!Number.isInteger(n) || n < 0) throw new EngineError('Factorial is defined for whole numbers of 0 or more.', 'domain');
  if (n > MAX_EXACT_FACTORIAL) {
    return result(
      null,
      logFactorial(n),
      `${n}!`,
      `${n}! has roughly ${Math.floor(logFactorial(n) / Math.LN10) + 1} digits, beyond the exact limit of ${MAX_EXACT_FACTORIAL}!. The value shown is computed from the log-gamma function and is accurate to about 15 significant digits.`,
    );
  }
  return result(factorialExact(n), logFactorial(n), `${n}!`);
}

/** Permutations of k items chosen from n, order matters, no repetition: nPk. */
export function permutations(n: number, k: number): CountResult {
  validatePair(n, k, 'Permutations');
  if (k > n) {
    return result(0n, -Infinity, `P(${n}, ${k}) = ${n}! / (${n} − ${k})!`, `You cannot arrange ${k} items chosen from only ${n} without repetition, so the count is 0.`);
  }
  const logValue = logGamma(n + 1) - logGamma(n - k + 1);
  if (n > MAX_EXACT_N || k > MAX_EXACT_FACTORIAL) {
    return result(null, logValue, `P(${n}, ${k})`, 'Exact arithmetic was skipped because the inputs exceed the exact limit; the value is a 15-digit approximation.');
  }
  let acc = 1n;
  const bn = BigInt(n);
  for (let i = 0n; i < BigInt(k); i++) acc *= bn - i;
  return result(acc, logValue, `P(${n}, ${k}) = ${n}! / (${n} − ${k})!`);
}

/** Combinations of k items chosen from n, order irrelevant: nCk. */
export function combinations(n: number, k: number): CountResult {
  validatePair(n, k, 'Combinations');
  if (k > n) {
    return result(0n, -Infinity, `C(${n}, ${k})`, `You cannot choose ${k} items from only ${n}, so the count is 0.`);
  }
  const logValue = logChoose(n, k);
  const kk = Math.min(k, n - k);
  if (n > MAX_EXACT_N) {
    return result(null, logValue, `C(${n}, ${k})`, 'Exact arithmetic was skipped because n exceeds the exact limit; the value is a 15-digit approximation.');
  }
  // Multiplicative formula keeps every intermediate value an exact integer.
  let acc = 1n;
  const bn = BigInt(n);
  for (let i = 1n; i <= BigInt(kk); i++) acc = (acc * (bn - i + 1n)) / i;
  return result(acc, logValue, `C(${n}, ${k}) = ${n}! / (${k}! · (${n} − ${k})!)`);
}

/** Arrangements of k items from n where repetition is allowed: n^k. */
export function permutationsWithRepetition(n: number, k: number): CountResult {
  if (!Number.isInteger(n) || n < 0) throw new EngineError('n must be a whole number of 0 or more.', 'domain');
  if (!Number.isInteger(k) || k < 0) throw new EngineError('k must be a whole number of 0 or more.', 'domain');
  const logValue = k === 0 ? 0 : n === 0 ? -Infinity : k * Math.log(n);
  if (logValue / Math.LN10 > 100000) {
    return result(null, logValue, `${n}^${k}`, 'The exact value has more than 100,000 digits, so only the approximation is shown.');
  }
  return result(BigInt(n) ** BigInt(k), logValue, `${n}^${k}`);
}

/** Multisets of size k from n types (combinations with repetition): C(n+k−1, k). */
export function combinationsWithRepetition(n: number, k: number): CountResult {
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The number of types must be a whole number of at least 1.', 'domain');
  if (!Number.isInteger(k) || k < 0) throw new EngineError('The number of selections must be a whole number of 0 or more.', 'domain');
  const r = combinations(n + k - 1, k);
  return { ...r, formula: `C(${n} + ${k} − 1, ${k}) = C(${n + k - 1}, ${k})` };
}

/**
 * Multinomial coefficient: distinct arrangements of a multiset whose group
 * sizes are given, e.g. the arrangements of "MISSISSIPPI".
 */
export function multinomial(groups: number[]): CountResult {
  if (!groups.length) throw new EngineError('Provide at least one group size.', 'domain');
  for (const g of groups) {
    if (!Number.isInteger(g) || g < 0) throw new EngineError('Every group size must be a whole number of 0 or more.', 'domain');
  }
  const n = groups.reduce((a, b) => a + b, 0);
  if (n > MAX_EXACT_FACTORIAL) {
    const logValue = logFactorial(n) - groups.reduce((a, g) => a + logFactorial(g), 0);
    return result(null, logValue, `${n}! / (${groups.join('! · ')}!)`, 'The total exceeds the exact factorial limit; the value is a 15-digit approximation.');
  }
  let acc = 1n;
  let used = 0;
  for (const g of groups) {
    used += g;
    const c = combinations(used, g);
    acc *= c.exact!;
  }
  const logValue = logFactorial(n) - groups.reduce((a, g) => a + logFactorial(g), 0);
  return result(acc, logValue, `${n}! / (${groups.join('! · ')}!)`);
}

function validatePair(n: number, k: number, label: string): void {
  const issues: Issue[] = [];
  if (!Number.isInteger(n) || n < 0) issues.push({ code: 'domain', field: 'n', message: `${label}: n must be a whole number of 0 or more.` });
  if (!Number.isInteger(k) || k < 0) issues.push({ code: 'domain', field: 'k', message: `${label}: k must be a whole number of 0 or more.` });
  if (issues.length) throw new EngineError(issues);
}

export type SelectionMode = 'ordered-no-repeat' | 'ordered-repeat' | 'unordered-no-repeat' | 'unordered-repeat';

export const SELECTION_MODES: { id: SelectionMode; label: string; description: string; formula: string }[] = [
  {
    id: 'ordered-no-repeat',
    label: 'Ordered, no repetition',
    description: 'Arrangements where order matters and each item can be used once — for example finishing positions in a race.',
    formula: 'P(n, k) = n! / (n − k)!',
  },
  {
    id: 'ordered-repeat',
    label: 'Ordered, with repetition',
    description: 'Sequences where order matters and items may repeat — for example a PIN code.',
    formula: 'n^k',
  },
  {
    id: 'unordered-no-repeat',
    label: 'Unordered, no repetition',
    description: 'Selections where order is irrelevant and each item can be used once — for example a committee or a lottery draw.',
    formula: 'C(n, k) = n! / (k!(n − k)!)',
  },
  {
    id: 'unordered-repeat',
    label: 'Unordered, with repetition',
    description: 'Multisets where order is irrelevant and items may repeat — for example choosing k scoops from n flavours.',
    formula: 'C(n + k − 1, k)',
  },
];

export function count(mode: SelectionMode, n: number, k: number): CountResult {
  switch (mode) {
    case 'ordered-no-repeat':
      return permutations(n, k);
    case 'ordered-repeat':
      return permutationsWithRepetition(n, k);
    case 'unordered-no-repeat':
      return combinations(n, k);
    case 'unordered-repeat':
      return combinationsWithRepetition(n, k);
  }
}
