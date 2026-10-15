/** Batch date modifier types. */

export type DateField = 'modified' | 'accessed' | 'created';

export interface DateModifySpec {
  mode: 'set' | 'shift' | 'fromName' | 'fromExif';
  /** ISO date string for 'set' mode. */
  date?: string;
  /** Milliseconds to shift (positive = forward, negative = backward) for 'shift' mode. */
  shiftMs?: number;
  /** Which timestamp fields to modify. */
  fields: DateField[];
}

export interface DateModifyResult {
  path: string;
  name: string;
  /** Previous timestamps. */
  oldModifiedMs: number;
  oldAccessedMs: number;
  oldCreatedMs?: number;
  /** New timestamps (undefined if unchanged or errored). */
  newModifiedMs?: number;
  newAccessedMs?: number;
  /** Error message if this file failed. */
  error?: string;
  /** Where the date came from (for fromName / fromExif). */
  source?: string;
}
