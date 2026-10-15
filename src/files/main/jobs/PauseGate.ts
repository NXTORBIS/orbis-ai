/**
 * Pause control for read-only background jobs (storage scans, duplicate and
 * similar-image searches, folder comparisons, checksums, folder sizes,
 * project discovery). Job loops call `wait()` between items: while the gate
 * is paused the loop stops there, so no further files are read until it is
 * resumed. Cancelling the job's AbortSignal releases a paused loop at once,
 * so a paused job can always be cancelled; the loop then sees the aborted
 * signal and stops as it does without a gate.
 */
export class PauseGate {
  private paused = false;
  private waiters = new Set<() => void>();
  private listeners = new Set<(paused: boolean) => void>();

  constructor(private readonly signal?: AbortSignal) {
    signal?.addEventListener('abort', () => this.release(), { once: true });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Pause at the next item. Returns false when it was already paused or the job is cancelled. */
  pause(): boolean {
    if (this.paused || this.signal?.aborted) return false;
    this.paused = true;
    this.notify();
    return true;
  }

  /** Continue a paused job. Returns false when it was not paused. */
  resume(): boolean {
    if (!this.paused) return false;
    this.paused = false;
    this.release();
    this.notify();
    return true;
  }

  /** Resolves at once while running; while paused, when resumed or cancelled. Never throws. */
  async wait(): Promise<void> {
    while (this.paused && !this.signal?.aborted) {
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
  }

  /** Called with the new state whenever the job is paused or resumed. Returns an unsubscribe function. */
  onChange(listener: (paused: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private release(): void {
    const w = [...this.waiters];
    this.waiters.clear();
    w.forEach((r) => r());
  }

  private notify(): void {
    for (const l of this.listeners) l(this.paused);
  }
}

/** What job loops need from a gate (lets tests pass a plain PauseGate or nothing). */
export type JobGate = Pick<PauseGate, 'isPaused' | 'wait'>;
