/**
 * Support shared by the computational engines: a stop signal for long running work,
 * a deterministic PRNG, and the hand-back to the browser that keeps the page alive.
 */

/** Thrown when the caller cancels, or when the engine runs out of its time budget. */
export class SearchStopped extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** Deterministic PRNG, so a generated problem can be reproduced from its seed. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Give the browser a frame — the only way a main-thread engine stays cancellable. */
export function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}