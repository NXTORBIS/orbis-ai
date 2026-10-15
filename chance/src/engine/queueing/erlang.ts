/**
 * Erlang B / Erlang C and the state probabilities of multi-server queues,
 * evaluated so that they stay accurate for large numbers of servers.
 *
 * Why not the textbook form? Erlang B and C are usually written with a^n/n!
 * terms. In double precision a^n overflows for a ≳ 180 and n! overflows at
 * n = 171, so the naive formula returns Infinity/Infinity = NaN for problems
 * that are entirely ordinary in practice (a call centre with 200 agents).
 *
 * Two devices avoid that completely:
 *  1. The Erlang B recursion B(0) = 1, B(n) = a·B(n−1) / (n + a·B(n−1)).
 *     Every quantity in it lies in [0, 1] (B is a probability) or is O(n + a),
 *     so nothing overflows for any c and any a. It is also numerically benign:
 *     all operations are on positive numbers, so there is no cancellation.
 *  2. Erlang C from Erlang B: C = B / (1 − ρ(1 − B)) with ρ = a/c < 1. This is
 *     an exact algebraic identity, not an approximation.
 * The state probabilities use log-space terms (logFactorial) summed with
 * logSumExp for the same reason.
 */
import { logSumExp } from '../core/numeric';
import { EngineError } from '../core/result';
import { logFactorial } from '../special/gamma';

/** Guard against unbounded loops; far above any practical server count. */
export const MAX_SERVERS = 100_000;

/**
 * Erlang B: the blocking probability of an M/M/c/c loss system with offered
 * load `a` erlangs and `servers` servers. Stable recursion; valid for any
 * a ≥ 0 and any servers ≥ 0 (B(0) = 1: with no servers everything blocks).
 */
export function erlangB(a: number, servers: number): number {
  if (!Number.isFinite(a) || a < 0) {
    throw new EngineError('Offered load must be a finite number of erlangs, 0 or greater.', 'range');
  }
  if (!Number.isInteger(servers) || servers < 0 || servers > MAX_SERVERS) {
    throw new EngineError(`Number of servers must be a whole number between 0 and ${MAX_SERVERS}.`, 'range');
  }
  let b = 1; // B(0) = 1
  for (let n = 1; n <= servers; n++) {
    const ab = a * b;
    b = ab / (n + ab);
  }
  return b;
}

/**
 * Erlang C: the probability that an arrival to an M/M/c queue (unlimited
 * waiting room) has to wait. Requires ρ = a/c < 1.
 */
export function erlangC(a: number, servers: number): number {
  if (!Number.isInteger(servers) || servers < 1 || servers > MAX_SERVERS) {
    throw new EngineError(`Number of servers must be a whole number between 1 and ${MAX_SERVERS}.`, 'range');
  }
  if (!Number.isFinite(a) || a < 0) {
    throw new EngineError('Offered load must be a finite number of erlangs, 0 or greater.', 'range');
  }
  const rho = a / servers;
  if (rho >= 1) {
    throw new EngineError(
      `Erlang C needs the offered load (${a} erlangs) to be below the number of servers (${servers}): at ρ = ${rho.toPrecision(
        6,
      )} the queue grows without bound and there is no steady state to describe.`,
      'unstable',
    );
  }
  const b = erlangB(a, servers);
  const denom = 1 - rho * (1 - b);
  if (!(denom > 0)) {
    throw new EngineError('Erlang C could not be evaluated: the stationary normalisation vanished.', 'numerical');
  }
  return Math.min(1, b / denom);
}

/**
 * Direct factorial evaluation of Erlang B, for cross-checking the recursion at
 * small c. Returns NaN once the factorial or the power overflows, which is
 * exactly the failure the recursion exists to avoid.
 */
export function erlangBDirect(a: number, servers: number): number {
  let num = 1;
  let denom = 0;
  for (let n = 0; n <= servers; n++) {
    const term = Math.pow(a, n) / factorial(n);
    denom += term;
    if (n === servers) num = term;
  }
  return num / denom;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/**
 * log of the unnormalised stationary weight of state n for an M/M/c system:
 *   n ≤ c:  a^n / n!
 *   n > c:  a^n / (c! c^(n−c))
 */
export function logStateWeight(a: number, servers: number, n: number): number {
  if (a === 0) return n === 0 ? 0 : -Infinity;
  const logA = Math.log(a);
  if (n <= servers) return n * logA - logFactorial(n);
  return n * logA - logFactorial(servers) - (n - servers) * Math.log(servers);
}

/**
 * Stationary distribution of an M/M/c queue with unlimited waiting room,
 * returned as P(n) for n = 0 … `upTo`, plus the exact P(0).
 */
export function mmcStateProbabilities(a: number, servers: number, upTo: number): { p0: number; p: number[] } {
  const rho = a / servers;
  const logs: number[] = [];
  for (let n = 0; n < servers; n++) logs.push(logStateWeight(a, servers, n));
  // The tail n ≥ c is geometric with ratio ρ: sum = weight(c) / (1 − ρ).
  logs.push(logStateWeight(a, servers, servers) - Math.log1p(-rho));
  const logNorm = logSumExp(logs);
  const p0 = Math.exp(-logNorm);
  const p: number[] = [];
  for (let n = 0; n <= upTo; n++) p.push(Math.exp(logStateWeight(a, servers, n) - logNorm));
  return { p0, p };
}

/**
 * Stationary distribution of a truncated M/M/c/K system (K ≥ c). Normalised
 * over the finite state space in log space, so it is accurate for large c.
 */
export function truncatedStateProbabilities(a: number, servers: number, capacity: number): number[] {
  const logs: number[] = [];
  for (let n = 0; n <= capacity; n++) logs.push(logStateWeight(a, servers, n));
  const logNorm = logSumExp(logs);
  return logs.map((l) => Math.exp(l - logNorm));
}
