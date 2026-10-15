/**
 * Factor (potential) algebra for discrete Bayesian networks.
 *
 * A factor is a non-negative function over a tuple of discrete variables. It is
 * stored densely: `vars[i]` has `card[i]` states, and `values` is indexed
 * row-major with the LAST variable varying fastest, exactly like a nested
 * array `v[x0][x1]...[xn]`.
 *
 * Every operation here is exact arithmetic on the supplied numbers; nothing is
 * approximated and nothing silently substitutes 0 or NaN for a failure.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';

export interface Factor {
  /** Variable names, in index order. */
  readonly vars: readonly string[];
  /** Number of states of each variable, parallel to `vars`. */
  readonly card: readonly number[];
  /** Dense table of size `prod(card)`. */
  readonly values: Float64Array;
}

/** Number of entries a factor over these cardinalities would need. */
export function tableSize(card: readonly number[]): number {
  let n = 1;
  for (const c of card) n *= c;
  return n;
}

export function makeFactor(vars: readonly string[], card: readonly number[], values: Float64Array): Factor {
  if (vars.length !== card.length) {
    throw new EngineError(`Factor over [${vars.join(', ')}] has ${vars.length} variables but ${card.length} cardinalities.`, 'factor');
  }
  const n = tableSize(card as number[]);
  if (values.length !== n) {
    throw new EngineError(
      `Factor over [${vars.join(', ')}] needs ${n} entries but ${values.length} were supplied.`,
      'factor',
    );
  }
  return { vars: [...vars], card: [...card], values };
}

/** A scalar factor (no variables). */
export function scalarFactor(value: number): Factor {
  return { vars: [], card: [], values: Float64Array.of(value) };
}

/** Strides of a factor's own variables (last variable fastest). */
export function strides(card: readonly number[]): number[] {
  const out = new Array<number>(card.length);
  let s = 1;
  for (let i = card.length - 1; i >= 0; i--) {
    out[i] = s;
    s *= card[i];
  }
  return out;
}

/**
 * Stride of each variable of `targetVars` inside `f`; 0 when `f` does not
 * mention that variable (so it contributes nothing to the flat index).
 */
function projectedStrides(f: Factor, targetVars: readonly string[]): number[] {
  const own = new Map<string, number>();
  for (let i = 0; i < f.vars.length; i++) own.set(f.vars[i], i);
  const s = strides(f.card);
  return targetVars.map((v) => {
    const i = own.get(v);
    return i === undefined ? 0 : s[i];
  });
}

export function cardinalityOf(f: Factor, v: string): number {
  const i = f.vars.indexOf(v);
  if (i < 0) throw new EngineError(`Variable "${v}" is not in the factor over [${f.vars.join(', ')}].`, 'factor');
  return f.card[i];
}

/** Pointwise product of two factors over the union of their variables. */
export function multiplyFactors(a: Factor, b: Factor, maxEntries = Infinity): Factor {
  const vars: string[] = [...a.vars];
  const card: number[] = [...a.card];
  for (let i = 0; i < b.vars.length; i++) {
    const v = b.vars[i];
    const at = vars.indexOf(v);
    if (at < 0) {
      vars.push(v);
      card.push(b.card[i]);
    } else if (card[at] !== b.card[i]) {
      throw new EngineError(
        `Variable "${v}" has ${card[at]} states in one factor and ${b.card[i]} in another.`,
        'factor',
      );
    }
  }
  const n = tableSize(card);
  if (n > maxEntries) {
    throw new EngineError(
      `Multiplying factors over [${a.vars.join(', ')}] and [${b.vars.join(', ')}] would need a table of ${n} entries, ` +
        `over the configured limit of ${maxEntries}. Increase maxFactorEntries or use approximate inference.`,
      'size',
    );
  }
  const sa = projectedStrides(a, vars);
  const sb = projectedStrides(b, vars);
  const out = new Float64Array(n);
  const counter = new Array<number>(vars.length).fill(0);
  let ia = 0;
  let ib = 0;
  for (let k = 0; k < n; k++) {
    out[k] = a.values[ia] * b.values[ib];
    for (let d = vars.length - 1; d >= 0; d--) {
      counter[d]++;
      ia += sa[d];
      ib += sb[d];
      if (counter[d] < card[d]) break;
      ia -= sa[d] * card[d];
      ib -= sb[d] * card[d];
      counter[d] = 0;
    }
  }
  return { vars, card, values: out };
}

/** Product of a list of factors, left to right. */
export function multiplyAll(factors: readonly Factor[], maxEntries = Infinity): Factor {
  if (factors.length === 0) return scalarFactor(1);
  let acc = factors[0];
  for (let i = 1; i < factors.length; i++) acc = multiplyFactors(acc, factors[i], maxEntries);
  return acc;
}

type Combine = 'sum' | 'max';

function eliminate(f: Factor, remove: readonly string[], how: Combine): Factor {
  const removeSet = new Set(remove);
  for (const v of removeSet) {
    if (!f.vars.includes(v)) {
      throw new EngineError(`Cannot eliminate "${v}": it is not in the factor over [${f.vars.join(', ')}].`, 'factor');
    }
  }
  const keep: string[] = [];
  const keepCard: number[] = [];
  for (let i = 0; i < f.vars.length; i++) {
    if (!removeSet.has(f.vars[i])) {
      keep.push(f.vars[i]);
      keepCard.push(f.card[i]);
    }
  }
  const n = tableSize(keepCard);
  const keepStrides = projectedStrides({ vars: keep, card: keepCard, values: new Float64Array(0) }, f.vars);
  const counter = new Array<number>(f.vars.length).fill(0);
  const total = f.values.length;
  if (how === 'sum') {
    // Compensated accumulation: collect per output cell, then sum stably.
    const buckets: number[][] = Array.from({ length: n }, () => []);
    let idx = 0;
    for (let k = 0; k < total; k++) {
      buckets[idx].push(f.values[k]);
      for (let d = f.vars.length - 1; d >= 0; d--) {
        counter[d]++;
        idx += keepStrides[d];
        if (counter[d] < f.card[d]) break;
        idx -= keepStrides[d] * f.card[d];
        counter[d] = 0;
      }
    }
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = stableSum(buckets[i]);
    return { vars: keep, card: keepCard, values: out };
  }
  const out = new Float64Array(n).fill(-Infinity);
  let idx = 0;
  for (let k = 0; k < total; k++) {
    if (f.values[k] > out[idx]) out[idx] = f.values[k];
    for (let d = f.vars.length - 1; d >= 0; d--) {
      counter[d]++;
      idx += keepStrides[d];
      if (counter[d] < f.card[d]) break;
      idx -= keepStrides[d] * f.card[d];
      counter[d] = 0;
    }
  }
  return { vars: keep, card: keepCard, values: out };
}

/** Sum a factor over the given variables (marginalisation). */
export function marginalizeFactor(f: Factor, remove: readonly string[]): Factor {
  return eliminate(f, remove, 'sum');
}

/** Maximise a factor over the given variables (max-product elimination). */
export function maxOutFactor(f: Factor, remove: readonly string[]): Factor {
  return eliminate(f, remove, 'max');
}

/** Keep only the variables listed, summing out everything else. */
export function marginalizeTo(f: Factor, keep: readonly string[]): Factor {
  const keepSet = new Set(keep);
  const remove = f.vars.filter((v) => !keepSet.has(v));
  const reduced = remove.length ? marginalizeFactor(f, remove) : f;
  return reorderFactor(reduced, keep);
}

/** Rearrange a factor's variables into the given order. */
export function reorderFactor(f: Factor, order: readonly string[]): Factor {
  if (order.length !== f.vars.length) {
    throw new EngineError(
      `Cannot reorder a factor over [${f.vars.join(', ')}] to [${order.join(', ')}]: different variables.`,
      'factor',
    );
  }
  let same = true;
  for (let i = 0; i < order.length; i++) if (order[i] !== f.vars[i]) same = false;
  if (same) return f;
  const card = order.map((v) => cardinalityOf(f, v));
  const s = projectedStrides(f, order);
  const n = tableSize(card);
  const out = new Float64Array(n);
  const counter = new Array<number>(order.length).fill(0);
  let src = 0;
  for (let k = 0; k < n; k++) {
    out[k] = f.values[src];
    for (let d = order.length - 1; d >= 0; d--) {
      counter[d]++;
      src += s[d];
      if (counter[d] < card[d]) break;
      src -= s[d] * card[d];
      counter[d] = 0;
    }
  }
  return { vars: [...order], card, values: out };
}

/**
 * Restrict a factor to a partial assignment, dropping the assigned variables.
 * Variables not mentioned by the factor are ignored.
 */
export function reduceFactor(f: Factor, assignment: ReadonlyMap<string, number>): Factor {
  const fixed: number[] = [];
  const keep: string[] = [];
  const keepCard: number[] = [];
  const s = strides(f.card);
  let base = 0;
  for (let i = 0; i < f.vars.length; i++) {
    const a = assignment.get(f.vars[i]);
    if (a === undefined) {
      keep.push(f.vars[i]);
      keepCard.push(f.card[i]);
      fixed.push(i);
    } else {
      if (!Number.isInteger(a) || a < 0 || a >= f.card[i]) {
        throw new EngineError(
          `State index ${a} is out of range for "${f.vars[i]}", which has ${f.card[i]} states.`,
          'state',
        );
      }
      base += a * s[i];
    }
  }
  if (keep.length === f.vars.length) return f;
  const keepStrides = fixed.map((i) => s[i]);
  const n = tableSize(keepCard);
  const out = new Float64Array(n);
  const counter = new Array<number>(keep.length).fill(0);
  let src = base;
  for (let k = 0; k < n; k++) {
    out[k] = f.values[src];
    for (let d = keep.length - 1; d >= 0; d--) {
      counter[d]++;
      src += keepStrides[d];
      if (counter[d] < keepCard[d]) break;
      src -= keepStrides[d] * keepCard[d];
      counter[d] = 0;
    }
  }
  return { vars: keep, card: keepCard, values: out };
}

/** Indicator factor that is 1 at `state` and 0 elsewhere. */
export function indicatorFactor(v: string, card: number, state: number): Factor {
  const values = new Float64Array(card);
  values[state] = 1;
  return { vars: [v], card: [card], values };
}

/** Total mass of a factor, summed stably. */
export function factorTotal(f: Factor): number {
  return stableSum(f.values);
}

/**
 * Normalise a factor to sum to 1. Returns the normalising constant too.
 * A factor whose total mass is 0 cannot be normalised; that is reported rather
 * than turned into NaN.
 */
export function normalizeFactor(f: Factor, context = 'factor'): { factor: Factor; total: number } {
  const total = factorTotal(f);
  if (!(total > 0)) {
    throw new EngineError(
      `Cannot normalise ${context}: its total probability is ${total}. ` +
        `This means the configuration has probability zero under the model, so no conditional distribution exists.`,
      'zero-probability',
    );
  }
  const out = new Float64Array(f.values.length);
  for (let i = 0; i < f.values.length; i++) out[i] = f.values[i] / total;
  return { factor: { vars: f.vars, card: f.card, values: out }, total };
}

/** Index of the maximal entry of a factor (ties resolved to the lowest index). */
export function argmaxIndex(f: Factor): number {
  let best = -Infinity;
  let at = -1;
  for (let i = 0; i < f.values.length; i++) {
    if (f.values[i] > best) {
      best = f.values[i];
      at = i;
    }
  }
  if (at < 0) throw new EngineError('Cannot take the argmax of an empty factor.', 'factor');
  return at;
}

/** Decode a flat index into per-variable state indices. */
export function decodeIndex(card: readonly number[], index: number): number[] {
  const out = new Array<number>(card.length);
  let rest = index;
  for (let i = card.length - 1; i >= 0; i--) {
    out[i] = rest % card[i];
    rest = Math.floor(rest / card[i]);
  }
  return out;
}

/** Encode per-variable state indices into a flat index. */
export function encodeIndex(card: readonly number[], states: readonly number[]): number {
  let idx = 0;
  for (let i = 0; i < card.length; i++) idx = idx * card[i] + states[i];
  return idx;
}

/** Look up one entry by a complete assignment over the factor's variables. */
export function factorValueAt(f: Factor, assignment: ReadonlyMap<string, number>): number {
  const s = strides(f.card);
  let idx = 0;
  for (let i = 0; i < f.vars.length; i++) {
    const a = assignment.get(f.vars[i]);
    if (a === undefined) {
      throw new EngineError(`Assignment is missing a value for "${f.vars[i]}".`, 'state');
    }
    idx += a * s[i];
  }
  return f.values[idx];
}
