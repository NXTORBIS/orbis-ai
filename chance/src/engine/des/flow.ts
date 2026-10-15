/**
 * Entity-flow building blocks: the pieces a real system is described with.
 *
 * Each one is a process body or a small helper, so a model is assembled from
 * them rather than written from scratch. They all draw from named substreams,
 * so adding a failure process to a model does not change its arrival pattern.
 */
import { EngineError } from '../core/result';
import { getDistribution, assertValidParams } from '../distributions/registry';
import type { Params } from '../distributions/types';
import type { Random } from '../random/rng';
import {
  get,
  hold,
  put,
  release,
  seize,
  serve,
  spawn,
  type ProcessBody,
  type ProcessGenerator,
  type Simulation,
} from './simulation';
import type { Resource, Store } from './resources';

/** A sampler for a delay: an interarrival time, a service time, a patience. */
export type DelaySampler = (rng: Random) => number;

/** A delay drawn from a registry distribution, validated once up front. */
export function distributionDelay(distributionId: string, params: Params): DelaySampler {
  const def = getDistribution(distributionId);
  assertValidParams(def, params);
  const support = def.support(params);
  if (support.min < 0) {
    throw new EngineError(
      `The distribution "${def.name}" has support reaching ${support.min}, so it can produce a negative delay. A simulated duration cannot be negative; use a distribution supported on the non-negative numbers, or truncate it explicitly.`,
      'range',
    );
  }
  return (rng: Random) => def.sample(rng, params);
}

/** A fixed delay — a deterministic service time, as in M/D/1. */
export function constantDelay(value: number): DelaySampler {
  if (!Number.isFinite(value) || value < 0) {
    throw new EngineError(`A constant delay must be a finite number of time units, 0 or greater (got ${value}).`, 'range');
  }
  return () => value;
}

/** Exponential delay with the given rate, i.e. a Poisson arrival process. */
export function exponentialDelay(rate: number): DelaySampler {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new EngineError(`An exponential rate must be a finite positive number (got ${rate}).`, 'range');
  }
  return (rng: Random) => rng.exponential(rate);
}

export interface SourceOptions {
  /** Name of the substream the interarrival times are drawn from. */
  stream: string;
  interarrival: DelaySampler;
  /** Body of the process each arriving entity runs. */
  entity: (index: number) => ProcessBody;
  /** Stop after this many arrivals. */
  limit?: number;
  /** Stop generating arrivals at this simulated time. */
  until?: number;
  /** Time of the first arrival; by default one interarrival time after the start. */
  firstAt?: number;
  name?: string;
}

/**
 * A source of arriving entities. The source is itself a process: it holds for
 * an interarrival time, spawns one entity, and repeats. Keeping the arrival
 * process on its own substream is what makes two configurations comparable.
 */
export function source(options: SourceOptions): ProcessBody {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  if (limit !== Number.POSITIVE_INFINITY && (!Number.isInteger(limit) || limit < 0)) {
    throw new EngineError(`An arrival limit must be a whole number, 0 or greater (got ${limit}).`, 'range');
  }
  return function* sourceProcess(sim: Simulation): ProcessGenerator {
    const rng = sim.stream(options.stream);
    let index = 0;
    if (options.firstAt !== undefined) {
      const wait = options.firstAt - sim.now;
      if (wait > 0) yield hold(wait);
    }
    for (;;) {
      if (index >= limit) return;
      const gap = options.interarrival(rng);
      if (!(gap >= 0) || !Number.isFinite(gap)) {
        throw new EngineError(
          `The arrival process produced an interarrival time of ${gap}. An interarrival time must be a finite number of time units, 0 or greater.`,
          'range',
        );
      }
      yield hold(gap);
      if (options.until !== undefined && sim.now > options.until) return;
      sim.counter('arrivals').increment();
      yield spawn(options.entity(index), `${options.name ?? 'entity'} ${index}`);
      index++;
    }
  };
}

/** Pick an index from weights, using the supplied substream. */
export function probabilisticRoute(rng: Random, weights: readonly number[]): number {
  if (weights.length === 0) throw new EngineError('A probabilistic route needs at least one destination.', 'required');
  let total = 0;
  for (const w of weights) {
    if (!(w >= 0) || !Number.isFinite(w)) {
      throw new EngineError(`A routing weight of ${w} is invalid; weights must be finite and 0 or greater.`, 'range');
    }
    total += w;
  }
  if (!(total > 0)) throw new EngineError('All routing weights are zero, so no destination can be chosen.', 'degenerate');
  const u = rng.uniform() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (u < acc) return i;
  }
  return weights.length - 1;
}

/** First rule whose condition holds; refuses rather than guessing when none do. */
export function conditionalRoute<T, D>(entity: T, rules: readonly { when: (e: T) => boolean; target: D }[], fallback?: D): D {
  for (const rule of rules) if (rule.when(entity)) return rule.target;
  if (fallback !== undefined) return fallback;
  throw new EngineError(
    'An entity reached a conditional route where no condition matched and no default destination was given. Routing it arbitrarily would invent model behaviour, so the run is stopped instead.',
    'routing',
  );
}

/** Round-robin routing, deterministic and therefore reproducible. */
export class CyclicRouter {
  private index = 0;
  readonly destinations: number;

  constructor(destinations: number) {
    if (!Number.isInteger(destinations) || destinations < 1) {
      throw new EngineError(`A cyclic router needs at least 1 destination (got ${destinations}).`, 'range');
    }
    this.destinations = destinations;
  }

  next(): number {
    const out = this.index;
    this.index = (this.index + 1) % this.destinations;
    return out;
  }
}

/** True when an arriving entity should balk at the queue it finds. */
export function shouldBalk(resource: Resource, maxQueue: number): boolean {
  if (!Number.isInteger(maxQueue) || maxQueue < 0) {
    throw new EngineError(`A balking threshold must be a whole number of waiting entities, 0 or greater (got ${maxQueue}).`, 'range');
  }
  return resource.queueSize >= maxQueue;
}

/**
 * Collect entities from `input` into groups of `size` and put each group into
 * `output`. A batching station genuinely waits: the first item of a batch sits
 * until the last one arrives, and that wait belongs in the statistics.
 */
export function batcher<T>(input: Store<T>, output: Store<T[]>, size: number): ProcessBody {
  if (!Number.isInteger(size) || size < 1) {
    throw new EngineError(`A batch size must be a whole number of at least 1 (got ${size}).`, 'range');
  }
  return function* batchProcess(): ProcessGenerator {
    for (;;) {
      const group: T[] = [];
      while (group.length < size) {
        const taken = yield get(input);
        group.push(taken.item as T);
      }
      yield put(output, group);
    }
  };
}

/** Split batches from `input` back into individual items in `output`. */
export function unbatcher<T>(input: Store<T[]>, output: Store<T>): ProcessBody {
  return function* unbatchProcess(): ProcessGenerator {
    for (;;) {
      const taken = yield get(input);
      const group = taken.item as T[];
      for (const item of group) yield put(output, item);
    }
  };
}

export interface FailureOptions {
  /** Time to the next failure, measured from the end of the last repair. */
  uptime: DelaySampler;
  repair: DelaySampler;
  uptimeStream: string;
  repairStream: string;
  /** How urgent the repair is; must be more urgent than any job's priority. */
  priority?: number;
}

/**
 * Failures and repairs of a server, modelled as the repair crew seizing the
 * whole resource at a priority nobody can outrank. Expressing it this way
 * rather than with a special "broken" flag means the in-service job is
 * preempted through the ordinary preemption path, its remaining work is
 * reported, and the resource's utilisation statistics stay consistent.
 *
 * The resource must be preemptive and the jobs must declare themselves
 * preemptible, otherwise a failure would politely wait for the current job to
 * finish — which is a different (and usually wrong) model.
 */
export function failureProcess(resource: Resource, options: FailureOptions): ProcessBody {
  if (!resource.preemptive) {
    throw new EngineError(
      `A failure process was attached to resource "${resource.name}", which is not preemptive. A breakdown that waits for the current job to finish is not a breakdown; create the resource with preemptive: true.`,
      'configuration',
    );
  }
  const priority = options.priority ?? -1_000_000;
  return function* failures(sim: Simulation): ProcessGenerator {
    const upRng = sim.stream(options.uptimeStream);
    const repairRng = sim.stream(options.repairStream);
    const downtime = sim.state(`${resource.name}.down`);
    for (;;) {
      yield hold(options.uptime(upRng));
      const got = yield seize(resource, { amount: resource.capacity, priority });
      if (!got.ok || got.request === null) return;
      sim.counter(`${resource.name}.failures`).increment();
      downtime.set(sim.now, 1);
      yield serve(got.request, options.repair(repairRng));
      downtime.set(sim.now, 0);
      yield release(got.request);
    }
  };
}

/**
 * A shift schedule: the resource's capacity is held down to `capacity − staff`
 * during each off-shift window, so fewer servers are available then.
 *
 * The capacity of a resource never changes here; instead a "time off" process
 * holds the unused units. That keeps utilisation meaningful (it is always
 * measured against the same denominator) and makes the reduction visible in
 * the statistics instead of hidden in a mutable field.
 */
export function shiftSchedule(
  resource: Resource,
  shifts: readonly { from: number; to: number; staff: number }[],
  options: { cycle: number; priority?: number } = { cycle: 24 },
): ProcessBody {
  if (!(options.cycle > 0) || !Number.isFinite(options.cycle)) {
    throw new EngineError(`A shift cycle must be a finite positive length (got ${options.cycle}).`, 'range');
  }
  for (const shift of shifts) {
    if (!(shift.from >= 0) || !(shift.to > shift.from) || shift.to > options.cycle) {
      throw new EngineError(
        `A shift window from ${shift.from} to ${shift.to} does not fit inside a cycle of length ${options.cycle}; windows must satisfy 0 ≤ from < to ≤ cycle.`,
        'range',
      );
    }
    if (!Number.isInteger(shift.staff) || shift.staff < 0 || shift.staff > resource.capacity) {
      throw new EngineError(
        `A shift asks for ${shift.staff} of resource "${resource.name}", whose capacity is ${resource.capacity}. Staffing must be a whole number between 0 and the capacity.`,
        'range',
      );
    }
  }
  const priority = options.priority ?? -500_000;
  return function* schedule(sim: Simulation): ProcessGenerator {
    for (;;) {
      const cycleStart = Math.floor(sim.now / options.cycle) * options.cycle;
      for (const shift of shifts) {
        const idle = resource.capacity - shift.staff;
        const startAt = cycleStart + shift.from;
        if (startAt >= sim.now && idle > 0) {
          if (startAt > sim.now) yield hold(startAt - sim.now);
          const got = yield seize(resource, { amount: idle, priority });
          if (got.ok && got.request !== null) {
            yield serve(got.request, shift.to - shift.from);
            yield release(got.request);
          }
        }
      }
      const nextCycle = cycleStart + options.cycle;
      if (nextCycle > sim.now) yield hold(nextCycle - sim.now);
      else yield hold(options.cycle);
    }
  };
}
