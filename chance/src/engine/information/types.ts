/**
 * Shared types for the information-theory module.
 *
 * Internal arithmetic is always carried out in **nats** (natural logarithm)
 * and converted to the requested unit exactly once, at the boundary. Mixing
 * bases inside a derivation is a classic source of silently wrong numbers, so
 * every value that leaves this module carries the unit it is expressed in.
 */
import { EngineError } from '../core/result';
import type { Exactness, Explanation } from '../core/result';

/** Unit in which an information quantity is reported. */
export type LogBase = 'bits' | 'nats' | 'hartleys';

/** Natural logarithm of the numeric base of each unit. */
export const BASE_LN: Record<LogBase, number> = {
  bits: Math.LN2,
  nats: 1,
  hartleys: Math.LN10,
};

export const BASE_NUMBER: Record<LogBase, number> = { bits: 2, nats: Math.E, hartleys: 10 };

export const BASE_LABEL: Record<LogBase, string> = {
  bits: 'bits (log base 2)',
  nats: 'nats (natural log)',
  hartleys: 'hartleys / dits (log base 10)',
};

/** Convert a quantity expressed in nats into `base`. */
export function fromNats(nats: number, base: LogBase): number {
  return nats / BASE_LN[base];
}

/** Convert a quantity expressed in `base` into nats. */
export function toNats(value: number, base: LogBase): number {
  return value * BASE_LN[base];
}

/** An information quantity together with its unit and provenance. */
export interface InfoQuantity {
  value: number;
  base: LogBase;
  baseLabel: string;
  exactness: Exactness;
}

export function quantity(nats: number, base: LogBase, exactness: Exactness = 'exact'): InfoQuantity {
  return { value: fromNats(nats, base), base, baseLabel: BASE_LABEL[base], exactness };
}

/** A quantity that may legitimately be infinite (KL, cross-entropy, log score). */
export interface PossiblyInfinite extends InfoQuantity {
  /** False when the quantity is mathematically infinite. */
  finite: boolean;
  /** Indices responsible for the divergence, when it is infinite. */
  offendingIndices: number[];
  /** Explanation of why it is infinite, when it is. */
  infiniteReason?: string;
}

/** Standard options accepted by every public entry point. */
export interface BaseOptions {
  base?: LogBase;
}

export function resolveBase(options?: BaseOptions): LogBase {
  const b = options?.base ?? 'bits';
  if (b !== 'bits' && b !== 'nats' && b !== 'hartleys') {
    throw new EngineError(`Unknown logarithm base "${String(b)}". Use "bits", "nats" or "hartleys".`, 'unknown');
  }
  return b;
}

export interface Explained<T> {
  result: T;
  explanation: Explanation;
}
