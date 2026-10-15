/**
 * Event-scheduling kernel: the future-event list, the simulation clock and the
 * guards that stop a broken model from silently producing numbers or freezing
 * the page.
 *
 * Refusals (each an `EngineError`, never a substituted 0):
 *  - scheduling an event in the past (both times are reported),
 *  - a negative or non-finite delay,
 *  - breaching the event limit,
 *  - breaching the simulated-time limit,
 *  - a zero-delay loop: events that keep firing at one timestamp without the
 *    clock ever advancing. This is the classic way a discrete-event model
 *    hangs, and in a browser it hangs the tab, so it is detected and named.
 */
import { EngineError } from '../core/result';
import { EventHeap, type DesEvent } from './heap';

export interface DesLimits {
  /** Hard cap on executed events; breaching it is an error, not a silent stop. */
  maxEvents: number;
  /** Hard cap on the simulation clock. */
  maxSimulatedTime: number;
  /**
   * How many events may fire at one timestamp before the run is judged to be
   * in a zero-delay loop. Legitimate models fire a handful of simultaneous
   * events (an arrival that immediately starts service); a self-scheduling
   * zero-delay loop fires unboundedly many.
   */
  maxEventsPerTimestamp: number;
}

export const DES_LIMITS: DesLimits = {
  maxEvents: 20_000_000,
  maxSimulatedTime: 1e12,
  maxEventsPerTimestamp: 200_000,
};

export interface DesTraceEntry {
  time: number;
  seq: number;
  label: string;
}

export class Kernel {
  readonly limits: DesLimits;
  private readonly heap = new EventHeap();
  private seqCounter = 0;
  private clock: number;
  private executed = 0;
  /** Events fired at `timestampOfChain`, for zero-delay-loop detection. */
  private chainLength = 0;
  private timestampOfChain = Number.NaN;
  /** When non-null, every executed event is appended (determinism testing). */
  trace: DesTraceEntry[] | null = null;

  constructor(options: { startTime?: number; limits?: Partial<DesLimits> } = {}) {
    const start = options.startTime ?? 0;
    if (!Number.isFinite(start)) {
      throw new EngineError('The simulation start time must be a finite number.', 'finite');
    }
    this.clock = start;
    this.limits = { ...DES_LIMITS, ...options.limits };
    if (!(this.limits.maxEvents >= 1)) {
      throw new EngineError('The event limit must be at least 1.', 'range');
    }
    if (!(this.limits.maxSimulatedTime > start)) {
      throw new EngineError(
        `The simulated-time limit (${this.limits.maxSimulatedTime}) must be later than the start time (${start}).`,
        'range',
      );
    }
  }

  get now(): number {
    return this.clock;
  }

  get eventsExecuted(): number {
    return this.executed;
  }

  get pending(): number {
    return this.heap.size;
  }

  /** Time of the next event that is still live, or null when none remains. */
  nextTime(): number | null {
    for (;;) {
      const next = this.heap.peek();
      if (!next) return null;
      if (!next.cancelled) return next.time;
      this.heap.pop();
    }
  }

  /** Schedule at an absolute time. Refuses any time before the clock. */
  scheduleAt(time: number, action: () => void, label = 'event'): DesEvent {
    if (!Number.isFinite(time)) {
      throw new EngineError(
        `Event "${label}" was scheduled for a non-finite time (${time}). A simulated time must be a finite number.`,
        'finite',
      );
    }
    if (time < this.clock) {
      throw new EngineError(
        `Event "${label}" was scheduled for simulated time ${time}, which is before the current simulation clock of ${this.clock}. An event cannot be scheduled in the past; the difference is ${this.clock - time}.`,
        'causality',
      );
    }
    if (time > this.limits.maxSimulatedTime) {
      throw new EngineError(
        `Event "${label}" was scheduled for simulated time ${time}, beyond the simulated-time limit of ${this.limits.maxSimulatedTime}. Raise the limit or shorten the run; no result is reported for a run that breaches it.`,
        'limit',
      );
    }
    const event: DesEvent = { time, seq: this.seqCounter++, cancelled: false, action, label };
    this.heap.push(event);
    return event;
  }

  /** Schedule `delay` time units from now. Refuses a negative delay. */
  schedule(delay: number, action: () => void, label = 'event'): DesEvent {
    if (!Number.isFinite(delay)) {
      throw new EngineError(
        `Event "${label}" was given a non-finite delay (${delay}). A delay must be a finite number of time units.`,
        'finite',
      );
    }
    if (delay < 0) {
      throw new EngineError(
        `Event "${label}" was given a negative delay of ${delay}. A delay must be 0 or greater; a negative delay would schedule the event in the past.`,
        'range',
      );
    }
    return this.scheduleAt(this.clock + delay, action, label);
  }

  cancel(event: DesEvent): void {
    event.cancelled = true;
  }

  /**
   * Execute the next live event. Returns false when the event list is empty.
   * Advances the clock to the event's time; the clock never moves backwards
   * because the heap pops in non-decreasing time order.
   */
  step(): boolean {
    let event = this.heap.pop();
    while (event && event.cancelled) event = this.heap.pop();
    if (!event) return false;

    if (event.time === this.timestampOfChain) {
      this.chainLength++;
      if (this.chainLength > this.limits.maxEventsPerTimestamp) {
        throw new EngineError(
          `A zero-delay loop was detected: ${this.chainLength} events have fired at simulated time ${event.time} without the clock advancing (most recently "${event.label}"). A process is scheduling itself with a delay of 0, so the run would never finish. Give the loop a positive delay, or add a condition that stops it.`,
          'zero-delay-loop',
        );
      }
    } else {
      this.chainLength = 1;
      this.timestampOfChain = event.time;
    }

    this.executed++;
    if (this.executed > this.limits.maxEvents) {
      throw new EngineError(
        `The run exceeded the event limit of ${this.limits.maxEvents.toLocaleString('en-US')} events at simulated time ${event.time}. No result is reported, because a truncated run is not an estimate of anything. Raise the limit or shorten the run.`,
        'limit',
      );
    }

    this.clock = event.time;
    if (this.trace) this.trace.push({ time: event.time, seq: event.seq, label: event.label });
    event.action();
    return true;
  }

  /** Discard every pending event (used when a run terminates early). */
  clearPending(): void {
    this.heap.clear();
  }
}
