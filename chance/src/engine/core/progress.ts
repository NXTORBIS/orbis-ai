/**
 * Progress reporting for long engine computations.
 *
 * Every long-running engine computation is written as a generator that yields
 * one of these between chunks of work. That is what makes cancellation
 * possible: a worker blocked in a synchronous loop can never receive a
 * `cancel` message, and `SharedArrayBuffer` is unavailable unless the page is
 * cross-origin isolated. The values are real — they are emitted after the work
 * they describe has actually been done — and they are plain data, so they
 * survive `postMessage`.
 */
export interface JobProgress {
  /** Units of work finished so far. */
  completed: number;
  /** Units of work expected in total. An upper bound when a run can stop early. */
  total: number;
  /** Optional short description of the current phase, shown next to the bar. */
  label?: string;
}
