/**
 * Resources: things entities compete for.
 *
 *  - `Resource`     — a counted resource with a queue (seize / release), with
 *                     FIFO, LIFO, priority or shortest-processing-time service
 *                     order, and optional preemption by priority.
 *  - `Store`        — a buffer of distinguishable items, with a capacity, a
 *                     queue of waiting takers and a queue of blocked putters.
 *
 * Both are passive bookkeeping: they decide who is served next and keep the
 * statistics. Suspending and resuming a process is the job of `process.ts`,
 * which supplies the callbacks. Keeping that split is what lets the same
 * resource serve a process-oriented model and a hand-written event model.
 *
 * Every queue selection is deterministic. Ties are broken by the request's
 * insertion counter, never by array order or object identity, so resource
 * contention reproduces exactly under the same seed.
 */
import { EngineError } from '../core/result';
import { Counter, Tally, TimeWeighted } from './statistics';

export type QueueDiscipline = 'fifo' | 'lifo' | 'priority' | 'spt';

export const QUEUE_DISCIPLINE_LABEL: Record<QueueDiscipline, string> = {
  fifo: 'First in, first out',
  lifo: 'Last in, first out',
  priority: 'Priority (lowest number served first)',
  spt: 'Shortest processing time first',
};

/** Anything that can report the current simulated time. */
export interface Clock {
  readonly now: number;
}

export type RequestState = 'queued' | 'in-service' | 'withdrawn' | 'released';

export interface ResourceRequest {
  readonly seq: number;
  /** The resource these units belong to, so a release needs no second argument. */
  readonly owner: Resource;
  /** Declared willing to be interrupted mid-service by a more urgent request. */
  readonly preemptible: boolean;
  /** Units of the resource required. */
  readonly amount: number;
  /** Lower numbers are more urgent. */
  readonly priority: number;
  /** Known service time, required only by the shortest-processing-time rule. */
  readonly processingTime: number | null;
  readonly requestedAt: number;
  readonly label: string;
  state: RequestState;
  /** Called when the request is granted; `waited` is the time spent queueing. */
  onGrant: (waited: number) => void;
  /** Called when a preemptive resource takes the units back mid-service. */
  onPreempt: (() => void) | null;
}

export interface ResourceOptions {
  capacity?: number;
  discipline?: QueueDiscipline;
  /** Allow a more urgent request to interrupt a less urgent one in service. */
  preemptive?: boolean;
  startTime?: number;
  /** Record per-batch time-weighted means of queue length and utilisation. */
  batchDuration?: number;
}

export class Resource {
  readonly name: string;
  readonly capacity: number;
  readonly discipline: QueueDiscipline;
  readonly preemptive: boolean;
  /** Time-weighted busy units; divide by capacity for utilisation. */
  readonly busyUnits: TimeWeighted;
  /** Time-weighted number of requests waiting (excluding those in service). */
  readonly queueLength: TimeWeighted;
  /** Per-request waiting time before service started. */
  readonly waitingTime: Tally;
  readonly balks = new Counter('balks');
  readonly reneges = new Counter('reneges');
  readonly preemptions = new Counter('preemptions');
  private readonly clock: Clock;
  private available: number;
  private readonly queue: ResourceRequest[] = [];
  private readonly serving: ResourceRequest[] = [];
  private seqCounter = 0;
  private grantedCount = 0;

  constructor(name: string, clock: Clock, options: ResourceOptions = {}) {
    const capacity = options.capacity ?? 1;
    if (!Number.isFinite(capacity) || !Number.isInteger(capacity) || capacity < 1) {
      throw new EngineError(
        `Resource "${name}" was given a capacity of ${capacity}. A counted resource must have a whole-number capacity of at least 1; a negative or fractional capacity has no meaning and no result is produced for it.`,
        'range',
      );
    }
    this.name = name;
    this.capacity = capacity;
    this.discipline = options.discipline ?? 'fifo';
    this.preemptive = options.preemptive ?? false;
    this.clock = clock;
    this.available = capacity;
    const startTime = options.startTime ?? clock.now;
    this.busyUnits = new TimeWeighted(`${name}.busyUnits`, { startTime, initial: 0 });
    this.queueLength = new TimeWeighted(`${name}.queueLength`, { startTime, initial: 0 });
    if (options.batchDuration !== undefined) {
      this.busyUnits.enableTimeBatches(options.batchDuration);
      this.queueLength.enableTimeBatches(options.batchDuration);
    }
    this.waitingTime = new Tally(`${name}.waitingTime`);
  }

  get availableUnits(): number {
    return this.available;
  }

  get busy(): number {
    return this.capacity - this.available;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  get granted(): number {
    return this.grantedCount;
  }

  /** The requests currently holding units, for inspection by a model. */
  get inService(): readonly ResourceRequest[] {
    return this.serving;
  }

  /**
   * Ask for `amount` units. Returns true when granted immediately; otherwise
   * the request is queued (or has preempted someone) and `onGrant` fires later.
   */
  request(spec: {
    amount?: number;
    priority?: number;
    processingTime?: number | null;
    label?: string;
    preemptible?: boolean;
    onGrant: (waited: number) => void;
    onPreempt?: () => void;
  }): ResourceRequest {
    const amount = spec.amount ?? 1;
    if (!Number.isInteger(amount) || amount < 1) {
      throw new EngineError(
        `A request for resource "${this.name}" asked for ${amount} units. A request must be for a whole number of units, at least 1.`,
        'range',
      );
    }
    if (amount > this.capacity) {
      throw new EngineError(
        `A request for resource "${this.name}" asked for ${amount} units, but its total capacity is ${this.capacity}. The request can never be satisfied, so the run would deadlock; it is refused instead.`,
        'deadlock',
      );
    }
    const priority = spec.priority ?? 0;
    if (!Number.isFinite(priority)) {
      throw new EngineError(`A request for resource "${this.name}" was given a non-finite priority.`, 'finite');
    }
    const processingTime = spec.processingTime ?? null;
    if (this.discipline === 'spt' && (processingTime === null || !(processingTime >= 0))) {
      throw new EngineError(
        `Resource "${this.name}" uses the shortest-processing-time rule, but a request did not declare its processing time (got ${String(processingTime)}). That rule cannot order the queue without it, and guessing a value would invent a result.`,
        'required',
      );
    }
    const req: ResourceRequest = {
      seq: this.seqCounter++,
      owner: this,
      preemptible: spec.preemptible ?? false,
      amount,
      priority,
      processingTime,
      requestedAt: this.clock.now,
      label: spec.label ?? this.name,
      state: 'queued',
      onGrant: spec.onGrant,
      onPreempt: spec.onPreempt ?? null,
    };
    if (this.available >= amount) {
      this.startService(req, 0);
      return req;
    }
    if (this.preemptive && this.tryPreempt(req)) {
      this.startService(req, 0);
      return req;
    }
    this.queue.push(req);
    this.queueLength.set(this.clock.now, this.queue.length);
    return req;
  }

  /** Release the units held by a granted request and serve the next in line. */
  release(req: ResourceRequest): void {
    if (req.state !== 'in-service') {
      throw new EngineError(
        `A request for resource "${this.name}" was released while in state "${req.state}". Only a request that currently holds units can be released; releasing twice, or releasing while still queued, would corrupt the utilisation statistics.`,
        'order',
      );
    }
    const index = this.serving.indexOf(req);
    if (index >= 0) this.serving.splice(index, 1);
    req.state = 'released';
    this.available += req.amount;
    this.busyUnits.set(this.clock.now, this.busy);
    this.dispatch();
  }

  /** Remove a queued request without serving it (balking or reneging). */
  withdraw(req: ResourceRequest, reason: 'balk' | 'renege'): void {
    if (req.state !== 'queued') return;
    const index = this.queue.indexOf(req);
    if (index >= 0) this.queue.splice(index, 1);
    req.state = 'withdrawn';
    if (reason === 'balk') this.balks.increment();
    else this.reneges.increment();
    this.queueLength.set(this.clock.now, this.queue.length);
  }

  private startService(req: ResourceRequest, waited: number): void {
    this.available -= req.amount;
    req.state = 'in-service';
    this.serving.push(req);
    this.grantedCount++;
    this.busyUnits.set(this.clock.now, this.busy);
    this.waitingTime.push(waited);
    req.onGrant(waited);
  }

  /**
   * Free units by interrupting the least urgent requests in service, if that
   * is enough to satisfy `req`. Returns false and changes nothing otherwise.
   */
  private tryPreempt(req: ResourceRequest): boolean {
    const victims = this.serving
      .filter((s) => s.preemptible && s.onPreempt !== null && s.priority > req.priority)
      .sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : b.seq - a.seq));
    let freed = 0;
    const chosen: ResourceRequest[] = [];
    for (const victim of victims) {
      if (this.available + freed >= req.amount) break;
      freed += victim.amount;
      chosen.push(victim);
    }
    if (this.available + freed < req.amount) return false;
    for (const victim of chosen) {
      const index = this.serving.indexOf(victim);
      if (index >= 0) this.serving.splice(index, 1);
      victim.state = 'withdrawn';
      this.available += victim.amount;
      this.preemptions.increment();
      const notify = victim.onPreempt;
      if (notify) notify();
    }
    this.busyUnits.set(this.clock.now, this.busy);
    return true;
  }

  /**
   * Serve waiting requests while the next one by the queue discipline fits.
   * A request that does not fit blocks the ones behind it rather than being
   * skipped: skipping would quietly turn the declared discipline into
   * something else.
   */
  private dispatch(): void {
    for (;;) {
      if (this.queue.length === 0) return;
      const index = this.selectIndex();
      const req = this.queue[index];
      if (req.amount > this.available) return;
      this.queue.splice(index, 1);
      this.queueLength.set(this.clock.now, this.queue.length);
      this.startService(req, this.clock.now - req.requestedAt);
    }
  }

  private selectIndex(): number {
    const q = this.queue;
    let best = 0;
    for (let i = 1; i < q.length; i++) {
      if (this.preferred(q[i], q[best])) best = i;
    }
    return best;
  }

  private preferred(a: ResourceRequest, b: ResourceRequest): boolean {
    switch (this.discipline) {
      case 'fifo':
        return a.seq < b.seq;
      case 'lifo':
        return a.seq > b.seq;
      case 'priority':
        return a.priority !== b.priority ? a.priority < b.priority : a.seq < b.seq;
      case 'spt': {
        const pa = a.processingTime as number;
        const pb = b.processingTime as number;
        return pa !== pb ? pa < pb : a.seq < b.seq;
      }
    }
  }
}

export interface StoreGetRequest<T> {
  readonly seq: number;
  readonly requestedAt: number;
  readonly filter: ((item: T) => boolean) | null;
  state: 'queued' | 'withdrawn' | 'served';
  onItem: (item: T, waited: number) => void;
}

export interface StorePutRequest<T> {
  readonly seq: number;
  readonly requestedAt: number;
  readonly item: T;
  state: 'queued' | 'withdrawn' | 'served';
  onStored: (waited: number) => void;
}

/**
 * A store of distinguishable items with a finite capacity. A `get` for which
 * no matching item exists waits; a `put` into a full store blocks, which is
 * what makes a finite buffer in a production line actually block upstream.
 */
export class Store<T> {
  readonly name: string;
  readonly capacity: number;
  /** Time-weighted number of items held. */
  readonly contents: TimeWeighted;
  /** Time each taken item spent in the store. */
  readonly dwellTime: Tally;
  private readonly clock: Clock;
  private readonly items: { item: T; storedAt: number }[] = [];
  private readonly getQueue: StoreGetRequest<T>[] = [];
  private readonly putQueue: StorePutRequest<T>[] = [];
  private seqCounter = 0;

  constructor(name: string, clock: Clock, options: { capacity?: number; startTime?: number } = {}) {
    const capacity = options.capacity ?? Number.POSITIVE_INFINITY;
    if (!(capacity >= 0) || (Number.isFinite(capacity) && !Number.isInteger(capacity))) {
      throw new EngineError(
        `Store "${name}" was given a capacity of ${capacity}. A store capacity must be a whole number of items, 0 or greater (0 means no buffering at all), or Infinity for an unlimited store.`,
        'range',
      );
    }
    this.name = name;
    this.capacity = capacity;
    this.clock = clock;
    this.contents = new TimeWeighted(`${name}.contents`, { startTime: options.startTime ?? clock.now, initial: 0 });
    this.dwellTime = new Tally(`${name}.dwellTime`);
  }

  get count(): number {
    return this.items.length;
  }

  get waitingToTake(): number {
    return this.getQueue.length;
  }

  get blockedPutting(): number {
    return this.putQueue.length;
  }

  /** Items currently held, in storage order. */
  peek(): readonly T[] {
    return this.items.map((e) => e.item);
  }

  put(item: T, onStored: (waited: number) => void): StorePutRequest<T> {
    const req: StorePutRequest<T> = {
      seq: this.seqCounter++,
      requestedAt: this.clock.now,
      item,
      state: 'queued',
      onStored,
    };
    // A taker already waiting for exactly this item is served directly: the
    // item never occupies the buffer, so a zero-capacity store still works.
    const takerIndex = this.getQueue.findIndex((g) => g.filter === null || g.filter(item));
    if (takerIndex >= 0) {
      const taker = this.getQueue.splice(takerIndex, 1)[0];
      taker.state = 'served';
      req.state = 'served';
      const waited = this.clock.now - taker.requestedAt;
      this.dwellTime.push(0);
      taker.onItem(item, waited);
      onStored(0);
      return req;
    }
    if (this.items.length < this.capacity) {
      this.items.push({ item, storedAt: this.clock.now });
      this.contents.set(this.clock.now, this.items.length);
      req.state = 'served';
      onStored(0);
      return req;
    }
    this.putQueue.push(req);
    return req;
  }

  get(onItem: (item: T, waited: number) => void, filter: ((item: T) => boolean) | null = null): StoreGetRequest<T> {
    const req: StoreGetRequest<T> = {
      seq: this.seqCounter++,
      requestedAt: this.clock.now,
      filter,
      state: 'queued',
      onItem,
    };
    const index = this.items.findIndex((e) => filter === null || filter(e.item));
    if (index >= 0) {
      const entry = this.items.splice(index, 1)[0];
      this.contents.set(this.clock.now, this.items.length);
      req.state = 'served';
      this.dwellTime.push(this.clock.now - entry.storedAt);
      onItem(entry.item, 0);
      this.admitBlockedPutter();
      return req;
    }
    // Nothing held: a blocked putter can hand its item straight over.
    const putterIndex = this.putQueue.findIndex((p) => filter === null || filter(p.item));
    if (putterIndex >= 0) {
      const putter = this.putQueue.splice(putterIndex, 1)[0];
      putter.state = 'served';
      req.state = 'served';
      this.dwellTime.push(0);
      onItem(putter.item, 0);
      putter.onStored(this.clock.now - putter.requestedAt);
      return req;
    }
    this.getQueue.push(req);
    return req;
  }

  withdrawGet(req: StoreGetRequest<T>): void {
    if (req.state !== 'queued') return;
    const index = this.getQueue.indexOf(req);
    if (index >= 0) this.getQueue.splice(index, 1);
    req.state = 'withdrawn';
  }

  private admitBlockedPutter(): void {
    while (this.putQueue.length > 0 && this.items.length < this.capacity) {
      const putter = this.putQueue.shift() as StorePutRequest<T>;
      putter.state = 'served';
      this.items.push({ item: putter.item, storedAt: this.clock.now });
      this.contents.set(this.clock.now, this.items.length);
      putter.onStored(this.clock.now - putter.requestedAt);
    }
  }
}
