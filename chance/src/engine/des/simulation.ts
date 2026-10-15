/**
 * Process-oriented modelling on top of the event kernel.
 *
 * A model is written as a generator function, so it reads as the sequential
 * story of one entity:
 *
 *     function* patient(sim: Simulation) {
 *       const nurse = sim.resource('nurse', { capacity: 2 });
 *       const got = yield seize(nurse, { patience: 30 });   // wait, or give up
 *       if (!got.ok) { sim.counter('abandoned').increment(); return; }
 *       yield hold(sim.stream('service').exponential(1 / 8));
 *       yield release(got.request);
 *     }
 *
 * The same model written with the event kernel directly is a set of callbacks
 * with the entity's state smeared across them. Generators keep the control
 * flow where a modeller can read it, and `yield` is exactly the suspension
 * point a process-oriented simulation needs, so no interpreter or
 * continuation-passing transform is required.
 *
 * Every suspension goes through `settle`, which guarantees a process is
 * resumed at most once: a customer who is granted a server at the same instant
 * their patience expires is served or abandons, never both. That single
 * invariant is what makes resource contention reproducible.
 */
import { EngineError } from '../core/result';
import type { Random, Seed } from '../random/rng';
import { Kernel, type DesLimits } from './kernel';
import type { DesEvent } from './heap';
import { Resource, Store, type ResourceOptions, type ResourceRequest } from './resources';
import { Counter, Tally, TimeWeighted } from './statistics';
import { StreamSet } from './streams';

export type OutcomeReason =
  | 'granted'
  | 'completed'
  | 'reneged'
  | 'preempted'
  | 'stored'
  | 'taken'
  | 'signalled'
  | 'timeout'
  | 'reactivated';

/**
 * What a suspended process learns when it resumes. `ok` is true when the thing
 * the process asked for happened, false when it gave up or was interrupted;
 * `reason` always says which.
 */
export interface Outcome {
  readonly ok: boolean;
  readonly reason: OutcomeReason;
  /** Simulated time spent suspended on this command. */
  readonly waited: number;
  /** The granted resource request, to be passed to `release`. */
  readonly request: ResourceRequest | null;
  /** Item taken from a store. */
  readonly item: unknown;
  /** Unfinished service time when a `serve` was preempted. */
  readonly remaining: number;
}

const VOID_OUTCOME: Outcome = { ok: true, reason: 'completed', waited: 0, request: null, item: null, remaining: 0 };

/** Take a typed item from a store outcome, refusing rather than returning null. */
export function takenItem<T>(outcome: Outcome): T {
  if (!outcome.ok || outcome.item === null) {
    throw new EngineError(
      `An item was required from a store but the request ended with "${outcome.reason}". The model must check the outcome before using the item; there is no default item to substitute.`,
      'no-item',
    );
  }
  return outcome.item as T;
}

export type Command =
  | { readonly kind: 'hold'; readonly delay: number }
  | { readonly kind: 'waitUntil'; readonly time: number }
  | {
      readonly kind: 'seize';
      readonly resource: Resource;
      readonly amount: number;
      readonly priority: number;
      readonly processingTime: number | null;
      readonly patience: number | null;
      readonly preemptible: boolean;
    }
  | { readonly kind: 'release'; readonly request: ResourceRequest }
  | { readonly kind: 'serve'; readonly request: ResourceRequest; readonly duration: number }
  | { readonly kind: 'put'; readonly store: Store<unknown>; readonly item: unknown }
  | {
      readonly kind: 'get';
      readonly store: Store<unknown>;
      readonly filter: ((item: unknown) => boolean) | null;
      readonly patience: number | null;
    }
  | { readonly kind: 'spawn'; readonly body: ProcessBody; readonly name: string }
  | { readonly kind: 'waitSignal'; readonly signal: string; readonly patience: number | null }
  | { readonly kind: 'sendSignal'; readonly signal: string; readonly all: boolean }
  | { readonly kind: 'passivate' }
  | { readonly kind: 'terminate' };

export type ProcessGenerator = Generator<Command, void, Outcome>;
export type ProcessBody = (sim: Simulation, self: ProcessHandle) => ProcessGenerator;

export type ProcessState = 'runnable' | 'waiting' | 'finished';

export interface ProcessHandle {
  readonly id: number;
  readonly name: string;
  state: ProcessState;
  /** What the process is waiting for, for deadlock reporting. */
  waitingOn: string;
}

interface ProcessRecord extends ProcessHandle {
  generator: ProcessGenerator;
  /** Cancels timers and withdraws queued requests when the process resumes. */
  settle: ((outcome: Outcome) => void) | null;
}

/** Placeholder so a record exists before its body (which needs `self`) runs. */
function* emptyProcess(): ProcessGenerator {
  /* nothing */
}

// --- command constructors -------------------------------------------------

/** Advance this process by `delay` time units. */
export function hold(delay: number): Command {
  return { kind: 'hold', delay };
}

/** Advance this process to an absolute simulated time. */
export function waitUntil(time: number): Command {
  return { kind: 'waitUntil', time };
}

export interface SeizeOptions {
  amount?: number;
  /** Lower numbers are more urgent. */
  priority?: number;
  /** Declared service time, required by a shortest-processing-time queue. */
  processingTime?: number | null;
  /**
   * Abandon the queue after this much waiting (reneging). Null — or an
   * infinite patience, which means the same thing — waits forever. An infinite
   * patience is deliberately NOT turned into a timer event: a model with
   * infinite patience must produce exactly the same run as a model with no
   * reneging at all, down to the event trace.
   */
  patience?: number | null;
  /** Allow a more urgent request to preempt this one while it is in service. */
  preemptible?: boolean;
}

export function seize(resource: Resource, options: SeizeOptions = {}): Command {
  return {
    kind: 'seize',
    resource,
    amount: options.amount ?? 1,
    priority: options.priority ?? 0,
    processingTime: options.processingTime ?? null,
    patience:
      options.patience === undefined || options.patience === null || options.patience === Number.POSITIVE_INFINITY
        ? null
        : options.patience,
    preemptible: options.preemptible ?? false,
  };
}

export function release(request: ResourceRequest): Command {
  return { kind: 'release', request };
}

/**
 * Occupy a seized resource for `duration`. Unlike a plain `hold`, a `serve`
 * can be cut short by preemption, and the outcome then reports the remaining
 * work so the model can decide whether to resume it or restart it.
 */
export function serve(request: ResourceRequest, duration: number): Command {
  return { kind: 'serve', request, duration };
}

export function put<T>(store: Store<T>, item: T): Command {
  return { kind: 'put', store: store as Store<unknown>, item };
}

export function get<T>(
  store: Store<T>,
  options: { filter?: (item: T) => boolean; patience?: number | null } = {},
): Command {
  return {
    kind: 'get',
    store: store as Store<unknown>,
    filter: options.filter ? (item: unknown) => (options.filter as (i: T) => boolean)(item as T) : null,
    patience:
      options.patience === undefined || options.patience === null || options.patience === Number.POSITIVE_INFINITY
        ? null
        : options.patience,
  };
}

export function spawn(body: ProcessBody, name = 'process'): Command {
  return { kind: 'spawn', body, name };
}

export function waitSignal(signal: string, patience: number | null = null): Command {
  return { kind: 'waitSignal', signal, patience };
}

export function sendSignal(signal: string, all = true): Command {
  return { kind: 'sendSignal', signal, all };
}

/** Suspend indefinitely until another process reactivates this one. */
export function passivate(): Command {
  return { kind: 'passivate' };
}

/** End this process immediately. */
export function terminate(): Command {
  return { kind: 'terminate' };
}

// --- the simulation -------------------------------------------------------

export interface SimulationOptions {
  seed: Seed;
  startTime?: number;
  limits?: Partial<DesLimits>;
  /**
   * When set, every time-weighted statistic created through the simulation
   * records per-batch means over windows of this length, giving batch-means
   * intervals for state variables without a second run.
   */
  batchDuration?: number;
  /**
   * How many commands one process may execute without ever suspending before
   * the run is judged to be in a zero-delay loop. A process that yields
   * `hold(0)` in a loop, or routes an entity in a cycle with no delay, never
   * returns control to the kernel, so no event is scheduled and the
   * kernel's own same-timestamp guard never sees anything: in a browser the
   * tab simply freezes. This limit catches it and names it.
   */
  maxCommandsPerResumption?: number;
}

export interface WaitingSummary {
  waitingOn: string;
  count: number;
}

export class Simulation {
  readonly kernel: Kernel;
  readonly streams: StreamSet;
  readonly batchDuration: number | null;
  readonly maxCommandsPerResumption: number;
  private readonly processes = new Map<number, ProcessRecord>();
  private readonly resourcesByName = new Map<string, Resource>();
  private readonly storesByName = new Map<string, Store<unknown>>();
  private readonly talliesByName = new Map<string, Tally>();
  private readonly statesByName = new Map<string, TimeWeighted>();
  private readonly countersByName = new Map<string, Counter>();
  private readonly signalWaiters = new Map<string, ProcessRecord[]>();
  private processCounter = 0;
  private waitingProcesses = 0;
  private stopRequest: string | null = null;
  /** Depth guard: a command must never resume its own process re-entrantly. */
  private driving = 0;
  private readonly readyQueue: { record: ProcessRecord; outcome: Outcome }[] = [];

  constructor(options: SimulationOptions) {
    this.kernel = new Kernel({ startTime: options.startTime, limits: options.limits });
    this.streams = new StreamSet(options.seed);
    this.batchDuration = options.batchDuration ?? null;
    this.maxCommandsPerResumption = options.maxCommandsPerResumption ?? 1_000_000;
    if (!Number.isInteger(this.maxCommandsPerResumption) || this.maxCommandsPerResumption < 1) {
      throw new EngineError(
        `The limit on commands per resumption must be a whole number of at least 1 (got ${this.maxCommandsPerResumption}).`,
        'range',
      );
    }
  }

  get now(): number {
    return this.kernel.now;
  }

  /** The named random substream; see `streams.ts` for why these are separate. */
  stream(name: string): Random {
    return this.streams.stream(name);
  }

  resource(name: string, options: ResourceOptions = {}): Resource {
    const existing = this.resourcesByName.get(name);
    if (existing) return existing;
    const created = new Resource(name, this.kernel, {
      ...options,
      batchDuration: options.batchDuration ?? this.batchDuration ?? undefined,
    });
    this.resourcesByName.set(name, created);
    return created;
  }

  store<T>(name: string, options: { capacity?: number } = {}): Store<T> {
    const existing = this.storesByName.get(name);
    if (existing) return existing as Store<T>;
    const created = new Store<T>(name, this.kernel, options);
    this.storesByName.set(name, created as Store<unknown>);
    return created;
  }

  tally(name: string, options: { keepValues?: boolean; keepLimit?: number } = {}): Tally {
    const existing = this.talliesByName.get(name);
    if (existing) return existing;
    const created = new Tally(name, options);
    this.talliesByName.set(name, created);
    return created;
  }

  /** A time-weighted state variable, e.g. a queue length or inventory level. */
  state(name: string, options: { initial?: number } = {}): TimeWeighted {
    const existing = this.statesByName.get(name);
    if (existing) return existing;
    const created = new TimeWeighted(name, { startTime: this.now, initial: options.initial ?? 0 });
    if (this.batchDuration !== null) created.enableTimeBatches(this.batchDuration);
    this.statesByName.set(name, created);
    return created;
  }

  counter(name: string): Counter {
    const existing = this.countersByName.get(name);
    if (existing) return existing;
    const created = new Counter(name);
    this.countersByName.set(name, created);
    return created;
  }

  resourceNames(): string[] {
    return [...this.resourcesByName.keys()];
  }

  storeNames(): string[] {
    return [...this.storesByName.keys()];
  }

  tallyNames(): string[] {
    return [...this.talliesByName.keys()];
  }

  stateNames(): string[] {
    return [...this.statesByName.keys()];
  }

  counterNames(): string[] {
    return [...this.countersByName.keys()];
  }

  getTally(name: string): Tally {
    const t = this.talliesByName.get(name);
    if (!t) throw new EngineError(`No tally statistic named "${name}" was collected by this model.`, 'unknown');
    return t;
  }

  getState(name: string): TimeWeighted {
    const s = this.statesByName.get(name);
    if (!s) throw new EngineError(`No time-weighted statistic named "${name}" was collected by this model.`, 'unknown');
    return s;
  }

  getCounter(name: string): Counter {
    const c = this.countersByName.get(name);
    if (!c) throw new EngineError(`No counter named "${name}" was collected by this model.`, 'unknown');
    return c;
  }

  getResource(name: string): Resource {
    const r = this.resourcesByName.get(name);
    if (!r) throw new EngineError(`No resource named "${name}" exists in this model.`, 'unknown');
    return r;
  }

  /**
   * Discard every statistic collected so far and start again from the current
   * time. This is in-run warm-up truncation; the discarded period must be
   * reported alongside the results.
   */
  resetStatistics(): void {
    for (const t of this.talliesByName.values()) t.reset();
    for (const c of this.countersByName.values()) c.reset();
    for (const s of this.statesByName.values()) s.resetAt(this.now);
    for (const r of this.resourcesByName.values()) {
      r.busyUnits.resetAt(this.now);
      r.queueLength.resetAt(this.now);
      r.waitingTime.reset();
      r.balks.reset();
      r.reneges.reset();
      r.preemptions.reset();
    }
    for (const s of this.storesByName.values()) {
      s.contents.resetAt(this.now);
      s.dwellTime.reset();
    }
  }

  /** Ask the run loop to stop after the current event. */
  stop(reason: string): void {
    this.stopRequest = reason;
  }

  get stopReason(): string | null {
    return this.stopRequest;
  }

  get liveProcesses(): number {
    return this.processes.size;
  }

  get waitingCount(): number {
    return this.waitingProcesses;
  }

  /** What the still-waiting processes are waiting for, for deadlock reports. */
  waitingSummary(): WaitingSummary[] {
    const counts = new Map<string, number>();
    for (const p of this.processes.values()) {
      if (p.state !== 'waiting') continue;
      counts.set(p.waitingOn, (counts.get(p.waitingOn) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([waitingOn, count]) => ({ waitingOn, count }))
      .sort((a, b) => b.count - a.count || a.waitingOn.localeCompare(b.waitingOn));
  }

  /** Start a new process. It begins running at the current simulated time. */
  activate(body: ProcessBody, name = 'process'): ProcessHandle {
    const record: ProcessRecord = {
      id: this.processCounter++,
      name,
      state: 'runnable',
      waitingOn: '',
      generator: emptyProcess(),
      settle: null,
    };
    record.generator = body(this, record);
    this.processes.set(record.id, record);
    this.enqueue(record, VOID_OUTCOME);
    return record;
  }

  /** Resume a passivated process. */
  reactivate(handle: ProcessHandle): void {
    const record = this.processes.get(handle.id);
    if (!record || record.state !== 'waiting' || !record.settle) return;
    record.settle({ ...VOID_OUTCOME, reason: 'reactivated' });
  }

  // --- process driving ----------------------------------------------------

  /**
   * Queue a process for advancement and drain the queue. Commands can grant a
   * resource synchronously, which would otherwise re-enter the generator while
   * it is still suspended at its own `yield`; queueing instead keeps every
   * resumption at the top of the driving loop.
   */
  private enqueue(record: ProcessRecord, outcome: Outcome): void {
    this.readyQueue.push({ record, outcome });
    if (this.driving > 0) return;
    this.driving++;
    try {
      while (this.readyQueue.length > 0) {
        const next = this.readyQueue.shift() as { record: ProcessRecord; outcome: Outcome };
        if (next.record.state === 'finished') continue;
        this.advance(next.record, next.outcome);
      }
    } finally {
      this.driving--;
      this.readyQueue.length = 0;
    }
  }

  private finish(record: ProcessRecord): void {
    record.state = 'finished';
    record.settle = null;
    this.processes.delete(record.id);
  }

  private suspend(record: ProcessRecord, waitingOn: string, settle: (outcome: Outcome) => void): void {
    record.state = 'waiting';
    record.waitingOn = waitingOn;
    record.settle = settle;
    this.waitingProcesses++;
  }

  /**
   * Build the single-shot resumption used by every suspension. `settled`
   * guarantees that a process granted a server at the same instant its
   * patience expires resumes once, with one definite outcome.
   */
  private waiter(
    record: ProcessRecord,
    waitingOn: string,
    onSettled: (outcome: Outcome) => void,
  ): { settle: (outcome: Outcome) => void; timer: { event: DesEvent | null }; settled: { done: boolean } } {
    const settled = { done: false };
    const timer: { event: DesEvent | null } = { event: null };
    const settle = (outcome: Outcome): void => {
      if (settled.done) return;
      settled.done = true;
      if (timer.event) this.kernel.cancel(timer.event);
      record.state = 'runnable';
      record.waitingOn = '';
      record.settle = null;
      this.waitingProcesses--;
      onSettled(outcome);
      this.enqueue(record, outcome);
    };
    this.suspend(record, waitingOn, settle);
    return { settle, timer, settled };
  }

  private advance(record: ProcessRecord, outcome: Outcome): void {
    let next = outcome;
    let commands = 0;
    for (;;) {
      if (++commands > this.maxCommandsPerResumption) {
        this.finish(record);
        throw new EngineError(
          `A zero-delay loop was detected in process "${record.name}": it executed ${commands - 1} commands at simulated time ${this.now} without ever suspending, so the simulation clock can never advance and the run would never finish. A process must eventually yield a positive delay or wait for something; a loop of zero-length holds, or a routing cycle with no delay, does neither.`,
          'zero-delay-loop',
        );
      }
      let step: IteratorResult<Command, void>;
      try {
        step = record.generator.next(next);
      } catch (error) {
        this.finish(record);
        throw error;
      }
      if (step.done) {
        this.finish(record);
        return;
      }
      const immediate = this.execute(record, step.value);
      if (immediate === null) return; // suspended
      next = immediate;
    }
  }

  /**
   * Carry out one command. Returns the outcome when the command completes at
   * once, or null when the process is now suspended.
   */
  private execute(record: ProcessRecord, command: Command): Outcome | null {
    switch (command.kind) {
      case 'hold': {
        if (command.delay === 0) return VOID_OUTCOME;
        const start = this.now;
        const w = this.waiter(record, 'a delay', () => {});
        w.timer.event = this.kernel.schedule(
          command.delay,
          () => w.settle({ ...VOID_OUTCOME, waited: this.now - start }),
          `${record.name}: hold`,
        );
        return null;
      }
      case 'waitUntil': {
        if (command.time <= this.now) return VOID_OUTCOME;
        const start = this.now;
        const w = this.waiter(record, 'a scheduled time', () => {});
        w.timer.event = this.kernel.scheduleAt(
          command.time,
          () => w.settle({ ...VOID_OUTCOME, waited: this.now - start }),
          `${record.name}: wait until`,
        );
        return null;
      }
      case 'seize':
        return this.executeSeize(record, command);
      case 'release': {
        command.request.owner.release(command.request);
        return VOID_OUTCOME;
      }
      case 'serve':
        return this.executeServe(record, command);
      case 'put': {
        const sync = { fired: false, waited: 0 };
        const w = { settle: null as ((o: Outcome) => void) | null };
        const onStored = (waited: number): void => {
          if (w.settle === null) {
            sync.fired = true;
            sync.waited = waited;
            return;
          }
          w.settle({ ...VOID_OUTCOME, reason: 'stored', waited });
        };
        command.store.put(command.item, onStored);
        if (sync.fired) return { ...VOID_OUTCOME, reason: 'stored', waited: sync.waited };
        const waiter = this.waiter(record, `space in store "${command.store.name}"`, () => {});
        w.settle = waiter.settle;
        return null;
      }
      case 'get':
        return this.executeGet(record, command);
      case 'spawn': {
        this.activate(command.body, command.name);
        return VOID_OUTCOME;
      }
      case 'waitSignal': {
        const start = this.now;
        const waiter = this.waiter(record, `signal "${command.signal}"`, () => {
          const list = this.signalWaiters.get(command.signal);
          if (list) {
            const index = list.indexOf(record);
            if (index >= 0) list.splice(index, 1);
          }
        });
        const list = this.signalWaiters.get(command.signal);
        if (list) list.push(record);
        else this.signalWaiters.set(command.signal, [record]);
        if (command.patience !== null) {
          this.requirePatience(command.patience, `signal "${command.signal}"`);
          waiter.timer.event = this.kernel.schedule(
            command.patience,
            () => waiter.settle({ ...VOID_OUTCOME, ok: false, reason: 'timeout', waited: this.now - start }),
            `${record.name}: signal timeout`,
          );
        }
        return null;
      }
      case 'sendSignal': {
        const list = this.signalWaiters.get(command.signal);
        if (list && list.length > 0) {
          const targets = command.all ? [...list] : [list[0]];
          for (const target of targets) {
            const settle = target.settle;
            if (settle) settle({ ...VOID_OUTCOME, reason: 'signalled' });
          }
        }
        return VOID_OUTCOME;
      }
      case 'passivate': {
        this.waiter(record, 'reactivation', () => {});
        return null;
      }
      case 'terminate': {
        this.finish(record);
        return null;
      }
    }
  }

  private requirePatience(patience: number, what: string): void {
    if (!Number.isFinite(patience) || patience < 0) {
      throw new EngineError(
        `A patience time of ${patience} was given for ${what}. A patience time must be a finite number of time units, 0 or greater; use null for a process that waits indefinitely.`,
        'range',
      );
    }
  }

  private executeSeize(record: ProcessRecord, command: Command & { kind: 'seize' }): Outcome | null {
    const start = this.now;
    const sync = { fired: false, waited: 0 };
    const link = { settle: null as ((o: Outcome) => void) | null, request: null as ResourceRequest | null };
    const onGrant = (waited: number): void => {
      if (link.settle === null) {
        sync.fired = true;
        sync.waited = waited;
        return;
      }
      link.settle({ ...VOID_OUTCOME, reason: 'granted', waited, request: link.request });
    };
    const request = command.resource.request({
      amount: command.amount,
      priority: command.priority,
      processingTime: command.processingTime,
      label: record.name,
      preemptible: command.preemptible,
      onGrant,
    });
    link.request = request;
    if (sync.fired) {
      return { ...VOID_OUTCOME, reason: 'granted', waited: sync.waited, request };
    }
    const waiter = this.waiter(record, `resource "${command.resource.name}"`, (outcome) => {
      if (!outcome.ok) command.resource.withdraw(request, 'renege');
    });
    link.settle = waiter.settle;
    if (command.patience !== null) {
      this.requirePatience(command.patience, `resource "${command.resource.name}"`);
      waiter.timer.event = this.kernel.schedule(
        command.patience,
        () =>
          waiter.settle({
            ...VOID_OUTCOME,
            ok: false,
            reason: 'reneged',
            waited: this.now - start,
            request: null,
          }),
        `${record.name}: renege from ${command.resource.name}`,
      );
    }
    return null;
  }

  private executeServe(record: ProcessRecord, command: Command & { kind: 'serve' }): Outcome | null {
    if (command.request.state !== 'in-service') {
      throw new EngineError(
        `A service period was started on a resource request in state "${command.request.state}". The resource must be held before it can be occupied.`,
        'order',
      );
    }
    if (!Number.isFinite(command.duration) || command.duration < 0) {
      throw new EngineError(
        `A service duration of ${command.duration} was given. A service time must be a finite number of time units, 0 or greater.`,
        'range',
      );
    }
    if (command.duration === 0) return VOID_OUTCOME;
    const start = this.now;
    const endTime = start + command.duration;
    const waiter = this.waiter(record, `service on "${command.request.label}"`, () => {
      command.request.onPreempt = null;
    });
    waiter.timer.event = this.kernel.scheduleAt(
      endTime,
      () => waiter.settle({ ...VOID_OUTCOME, waited: command.duration }),
      `${record.name}: service complete`,
    );
    command.request.onPreempt = (): void => {
      waiter.settle({
        ...VOID_OUTCOME,
        ok: false,
        reason: 'preempted',
        waited: this.now - start,
        remaining: endTime - this.now,
      });
    };
    return null;
  }

  private executeGet(record: ProcessRecord, command: Command & { kind: 'get' }): Outcome | null {
    const start = this.now;
    const sync = { fired: false, item: null as unknown, waited: 0 };
    const link = { settle: null as ((o: Outcome) => void) | null };
    const onItem = (item: unknown, waited: number): void => {
      if (link.settle === null) {
        sync.fired = true;
        sync.item = item;
        sync.waited = waited;
        return;
      }
      link.settle({ ...VOID_OUTCOME, reason: 'taken', waited, item });
    };
    const request = command.store.get(onItem, command.filter);
    if (sync.fired) {
      return { ...VOID_OUTCOME, reason: 'taken', waited: sync.waited, item: sync.item };
    }
    const waiter = this.waiter(record, `an item from store "${command.store.name}"`, (outcome) => {
      if (!outcome.ok) command.store.withdrawGet(request);
    });
    link.settle = waiter.settle;
    if (command.patience !== null) {
      this.requirePatience(command.patience, `store "${command.store.name}"`);
      waiter.timer.event = this.kernel.schedule(
        command.patience,
        () => waiter.settle({ ...VOID_OUTCOME, ok: false, reason: 'reneged', waited: this.now - start }),
        `${record.name}: give up waiting for ${command.store.name}`,
      );
    }
    return null;
  }
}
