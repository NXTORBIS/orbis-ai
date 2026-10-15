/**
 * Running a discrete-event model.
 *
 * `desSteps` is a generator that yields between chunks of events, matching the
 * contract of the Monte Carlo runner in `src/engine/simulation/runner.ts`. The
 * reason is the same: JavaScript is single-threaded, so a Web Worker executing
 * a long synchronous loop can never receive a `cancel` message, and
 * `SharedArrayBuffer` is unavailable unless the page is cross-origin isolated.
 * Handing control back between chunks lets the worker's message queue drain,
 * which is what makes cancellation work at all.
 *
 * The run refuses rather than guesses. An empty event list while processes are
 * still waiting is a deadlock and is reported as one, naming what each stuck
 * process is waiting for — not reported as a finished run with plausible
 * numbers.
 */
import { EngineError } from '../core/result';
import type { DesTraceEntry } from './kernel';
import type { QueueDiscipline } from './resources';
import type { TallyReport, TimeWeightedReport } from './statistics';
import type { Simulation, WaitingSummary } from './simulation';

export interface DesRunHooks {
  onProgress?(progress: DesProgress): void;
  /** Checked between chunks; returning true stops the run. */
  isCancelled?(): boolean;
}

export interface DesProgress {
  now: number;
  until: number;
  eventsExecuted: number;
}

export interface DesRunOptions {
  /**
   * Simulated time at which to stop. Events scheduled later are not executed.
   * Leave undefined to run until the event list empties (a terminating model).
   */
  until?: number;
  /**
   * Discard all statistics at this simulated time, keeping the system state.
   * The discarded period is reported, never hidden.
   */
  warmupTime?: number;
  /** Events per chunk; control returns to the caller after each chunk. */
  chunkEvents?: number;
  /** Record every executed event, for determinism checks and debugging. */
  collectTrace?: boolean;
  hooks?: DesRunHooks;
}

export type DesTermination = 'until-time' | 'event-list-empty' | 'model-stop' | 'cancelled';

export interface ResourceReport {
  name: string;
  capacity: number;
  discipline: QueueDiscipline;
  preemptive: boolean;
  /** Time-weighted mean busy units divided by capacity. */
  utilisation: number;
  busyUnits: TimeWeightedReport;
  queueLength: TimeWeightedReport;
  /** Null when nobody was served, rather than a fabricated mean of 0. */
  waitingTime: TallyReport | null;
  served: number;
  balks: number;
  reneges: number;
  preemptions: number;
}

export interface DesRunReport {
  seed: string;
  startTime: number;
  endTime: number;
  /** The warm-up period that was discarded, and when. Null when none was. */
  warmup: { discardedUntil: number; method: string } | null;
  eventsExecuted: number;
  terminatedBy: DesTermination;
  cancelled: boolean;
  stopReason: string | null;
  /** Processes still alive at the end (unfinished entities). */
  processesRemaining: number;
  waiting: WaitingSummary[];
  states: TimeWeightedReport[];
  tallies: TallyReport[];
  counters: { name: string; value: number }[];
  resources: ResourceReport[];
  stores: { name: string; capacity: number; contents: TimeWeightedReport; dwellTime: TallyReport | null }[];
  trace: DesTraceEntry[] | null;
  /** Statistics that had no observations, named rather than reported as 0. */
  emptyStatistics: string[];
  durationMs: number;
  exactness: 'empirical';
}

export function runDes(sim: Simulation, options: DesRunOptions = {}): DesRunReport {
  const steps = desSteps(sim, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export function* desSteps(
  sim: Simulation,
  options: DesRunOptions = {},
): Generator<DesProgress, DesRunReport, void> {
  const until = options.until ?? Number.POSITIVE_INFINITY;
  if (Number.isNaN(until) || until < sim.now) {
    throw new EngineError(
      `The run was asked to stop at simulated time ${until}, which is not after the start time of ${sim.now}.`,
      'range',
    );
  }
  if (Number.isFinite(until) && until > sim.kernel.limits.maxSimulatedTime) {
    throw new EngineError(
      `The requested run length (until simulated time ${until}) exceeds the simulated-time limit of ${sim.kernel.limits.maxSimulatedTime}. Raise the limit explicitly or shorten the run; the run is refused rather than silently truncated.`,
      'limit',
    );
  }
  const warmupTime = options.warmupTime ?? 0;
  if (!(warmupTime >= 0) || !Number.isFinite(warmupTime)) {
    throw new EngineError(`The warm-up period must be a finite number of time units, 0 or greater (got ${warmupTime}).`, 'range');
  }
  if (Number.isFinite(until) && warmupTime >= until) {
    throw new EngineError(
      `The warm-up period (${warmupTime}) is not shorter than the run length (${until}), so every observation would be discarded and no statistic could be reported.`,
      'range',
    );
  }
  const chunkEvents = options.chunkEvents ?? 20_000;
  if (!Number.isInteger(chunkEvents) || chunkEvents < 1) {
    throw new EngineError(`The chunk size must be a whole number of events, at least 1 (got ${chunkEvents}).`, 'range');
  }
  if (options.collectTrace) sim.kernel.trace = [];

  const started = Date.now();
  const startTime = sim.now;
  const warmup: { applied: { discardedUntil: number; method: string } | null } = { applied: null };
  if (warmupTime > startTime) {
    sim.kernel.scheduleAt(
      warmupTime,
      () => {
        sim.resetStatistics();
        warmup.applied = {
          discardedUntil: warmupTime,
          method: 'Fixed warm-up period supplied with the run options; all statistics were discarded at that time and the system state was kept.',
        };
      },
      'warm-up: discard statistics',
    );
  }

  let terminatedBy: DesTermination = 'event-list-empty';
  let cancelled = false;

  outer: for (;;) {
    let inChunk = 0;
    for (;;) {
      if (sim.stopReason !== null) {
        terminatedBy = 'model-stop';
        break outer;
      }
      const next = sim.kernel.nextTime();
      if (next === null) {
        // Nothing left to do. If processes are still waiting, the model is
        // stuck: that is a deadlock, not a completed run.
        const waiting = sim.waitingSummary();
        if (waiting.length > 0) {
          const detail = waiting.map((w) => `${w.count} waiting for ${w.waitingOn}`).join('; ');
          throw new EngineError(
            `Deadlock at simulated time ${sim.now}: the future-event list is empty but ${sim.waitingCount} process(es) are still waiting and nothing can ever wake them (${detail}). No statistics are reported for a deadlocked run, because the quantities they would describe never reached a steady state.`,
            'deadlock',
          );
        }
        terminatedBy = 'event-list-empty';
        break outer;
      }
      if (next > until) {
        terminatedBy = 'until-time';
        break outer;
      }
      sim.kernel.step();
      inChunk++;
      if (inChunk >= chunkEvents) break;
    }
    options.hooks?.onProgress?.({ now: sim.now, until, eventsExecuted: sim.kernel.eventsExecuted });
    // Hand control back so a worker can service its message queue and
    // therefore observe a cancellation between chunks.
    yield { now: sim.now, until, eventsExecuted: sim.kernel.eventsExecuted };
    if (options.hooks?.isCancelled?.()) {
      cancelled = true;
      terminatedBy = 'cancelled';
      break;
    }
  }

  const endTime = Number.isFinite(until) && terminatedBy === 'until-time' ? until : sim.now;
  const emptyStatistics: string[] = [];

  const tallyOrNull = (name: string, report: () => TallyReport, n: number): TallyReport | null => {
    if (n === 0) {
      emptyStatistics.push(name);
      return null;
    }
    return report();
  };

  const states = sim.stateNames().map((name) => sim.getState(name).report(endTime));
  const tallies: TallyReport[] = [];
  for (const name of sim.tallyNames()) {
    const t = sim.getTally(name);
    const r = tallyOrNull(name, () => t.report(), t.n);
    if (r) tallies.push(r);
  }
  const resources: ResourceReport[] = sim.resourceNames().map((name) => {
    const r = sim.getResource(name);
    const busy = r.busyUnits.report(endTime);
    return {
      name,
      capacity: r.capacity,
      discipline: r.discipline,
      preemptive: r.preemptive,
      utilisation: busy.timeWeightedMean / r.capacity,
      busyUnits: busy,
      queueLength: r.queueLength.report(endTime),
      waitingTime: tallyOrNull(`${name}.waitingTime`, () => r.waitingTime.report(), r.waitingTime.n),
      served: r.granted,
      balks: r.balks.value,
      reneges: r.reneges.value,
      preemptions: r.preemptions.value,
    };
  });
  const stores = sim.storeNames().map((name) => {
    const s = sim.store(name);
    return {
      name,
      capacity: s.capacity,
      contents: s.contents.report(endTime),
      dwellTime: tallyOrNull(`${name}.dwellTime`, () => s.dwellTime.report(), s.dwellTime.n),
    };
  });

  return {
    seed: String(sim.streams.seed),
    startTime,
    endTime,
    warmup: warmup.applied,
    eventsExecuted: sim.kernel.eventsExecuted,
    terminatedBy,
    cancelled,
    stopReason: sim.stopReason,
    processesRemaining: sim.liveProcesses,
    waiting: sim.waitingSummary(),
    states,
    tallies,
    counters: sim.counterNames().map((name) => ({ name, value: sim.getCounter(name).value })),
    resources,
    stores,
    trace: sim.kernel.trace,
    emptyStatistics,
    durationMs: Date.now() - started,
    exactness: 'empirical',
  };
}
