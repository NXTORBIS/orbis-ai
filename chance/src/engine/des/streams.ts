/**
 * Independent random substreams, one per stochastic component of a model.
 *
 * A single shared generator is the usual arrangement and it is a trap. Every
 * draw comes from one sequence, so changing the service-time distribution
 * changes which numbers the arrival process receives, and two configurations
 * that differ in one place end up with completely different arrival patterns.
 * Comparisons then measure the reshuffling as much as the change, and common
 * random numbers — the main variance-reduction technique for comparing
 * alternatives — becomes impossible.
 *
 * Here each named component gets its own `Random`, seeded by hashing the run
 * seed together with the component name. The streams are therefore stable: the
 * arrival stream for seed "x" is the same whatever else the model contains, and
 * two configurations sharing a seed share every stream they have in common.
 * That is exactly the property common random numbers needs.
 */
import { Random, Xoshiro128, type Seed } from '../random/rng';
import { EngineError } from '../core/result';

export class StreamSet {
  readonly seed: Seed;
  private readonly streams = new Map<string, Random>();

  constructor(seed: Seed) {
    if (seed === '' || seed === undefined || seed === null) {
      throw new EngineError('A seed is required so the run can be reproduced exactly.', 'required');
    }
    this.seed = seed;
  }

  /**
   * The stream for a named component, created on first use. The name is part
   * of the seed, so a stream's values do not depend on the order in which
   * components were created or on how many other components exist.
   */
  stream(name: string): Random {
    if (!name) throw new EngineError('A random substream must be given a name identifying the component it drives.', 'required');
    const existing = this.streams.get(name);
    if (existing) return existing;
    const created = new Random(new Xoshiro128(`${String(this.seed)}\u0000${name}`));
    this.streams.set(name, created);
    return created;
  }

  /** Names of the substreams created so far, in creation order. */
  names(): string[] {
    return [...this.streams.keys()];
  }
}
