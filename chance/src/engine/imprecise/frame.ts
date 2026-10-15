/**
 * Finite frames of discernment and subsets as bitmasks.
 *
 * Every function over subsets here is ITERATIVE. The subset lattice has 2^n
 * elements; recursion over it would be both slower and a stack hazard, and the
 * fast zeta/Möbius transforms used by the belief module are naturally written
 * as n passes over a flat array.
 */
import { EngineError } from '../core/result';

/**
 * Largest frame we will build the full subset lattice for.
 *
 * 2^20 = 1_048_576 subsets, i.e. an 8 MB Float64Array per transform. Beyond
 * this the lattice stops fitting in a browser tab's budget, so we refuse and
 * name the limit rather than silently thinning the lattice.
 */
export const MAX_FRAME_SIZE = 20;

export interface Frame {
  /** Element labels, in the order that fixes bit positions. */
  readonly elements: readonly string[];
  readonly n: number;
  /** Number of subsets, 2^n. */
  readonly size: number;
  /** Bitmask of the whole frame, 2^n − 1. */
  readonly full: number;
}

export function makeFrame(elements: readonly string[]): Frame {
  if (elements.length === 0) {
    throw new EngineError('A frame of discernment needs at least one element; none were given.', 'empty');
  }
  if (elements.length > MAX_FRAME_SIZE) {
    throw new EngineError(
      `Frame has ${elements.length} elements, so the subset lattice would have 2^${elements.length} = ` +
        `${2 ** elements.length} subsets. The limit is ${MAX_FRAME_SIZE} elements (2^${MAX_FRAME_SIZE} = ` +
        `${2 ** MAX_FRAME_SIZE} subsets). Coarsen the frame or use a p-box instead.`,
      'frame-too-large',
    );
  }
  const seen = new Set<string>();
  for (const e of elements) {
    if (seen.has(e)) {
      throw new EngineError(`Frame element "${e}" appears more than once; frame elements must be distinct.`, 'duplicate');
    }
    seen.add(e);
  }
  const n = elements.length;
  return { elements: [...elements], n, size: 2 ** n, full: 2 ** n - 1 };
}

/** Index of a named element; throws naming the frame if absent. */
export function elementIndex(frame: Frame, label: string): number {
  const i = frame.elements.indexOf(label);
  if (i < 0) {
    throw new EngineError(
      `"${label}" is not in the frame {${frame.elements.join(', ')}}.`,
      'unknown-element',
    );
  }
  return i;
}

/** Bitmask for a set given by element labels. */
export function maskOf(frame: Frame, labels: readonly string[]): number {
  let m = 0;
  for (const l of labels) m |= 1 << elementIndex(frame, l);
  return m;
}

/** Element labels of a bitmask, in frame order. */
export function labelsOf(frame: Frame, mask: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < frame.n; i++) if (mask & (1 << i)) out.push(frame.elements[i]);
  return out;
}

export function subsetName(frame: Frame, mask: number): string {
  if (mask === 0) return '∅';
  if (mask === frame.full) return 'Θ';
  return `{${labelsOf(frame, mask).join(', ')}}`;
}

/** Population count. Iterative; no recursion, no lookup table needed. */
export function cardinality(mask: number): number {
  let m = mask;
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/**
 * Fast zeta transform over the subset lattice, in place:
 * on return a[A] = Σ_{B ⊆ A} a[B].  O(n·2^n), n passes, no recursion.
 */
export function zetaSubsets(a: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const bit = 1 << i;
    for (let s = 0; s < a.length; s++) {
      if (s & bit) a[s] += a[s ^ bit];
    }
  }
}

/**
 * Fast zeta transform over supersets, in place:
 * on return a[A] = Σ_{B ⊇ A} a[B].  Used for the commonality function.
 */
export function zetaSupersets(a: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const bit = 1 << i;
    for (let s = 0; s < a.length; s++) {
      if (!(s & bit)) a[s] += a[s | bit];
    }
  }
}

/**
 * Möbius transform over the subset lattice, in place (inverse of zetaSubsets):
 * on return a[A] = Σ_{B ⊆ A} (−1)^{|A|−|B|} a[B].
 */
export function mobiusSubsets(a: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const bit = 1 << i;
    for (let s = 0; s < a.length; s++) {
      if (s & bit) a[s] -= a[s ^ bit];
    }
  }
}
