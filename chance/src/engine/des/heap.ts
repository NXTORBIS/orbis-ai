/**
 * Future-event list.
 *
 * A proper binary min-heap ordered by (time, sequence number). Insertion and
 * removal are both O(log n); the sorted-array insert that simulation tutorials
 * usually show is O(n) per insert and collapses on long runs.
 *
 * The sequence number is what makes a run reproducible. Floating-point event
 * times collide constantly in practice (zero delays, simultaneous arrivals,
 * a service that starts the instant another ends), and a heap is not a stable
 * data structure: without an explicit tie-break the order of equal-timestamp
 * events depends on the internal array layout, so the same seed would not
 * reproduce the same run. Ordering by the monotonically increasing insertion
 * counter makes equal timestamps pop in insertion order, deterministically.
 */

export interface DesEvent {
  /** Simulated time at which the event fires. */
  readonly time: number;
  /** Monotonic insertion counter; breaks ties at equal `time`. */
  readonly seq: number;
  /** Cancelled events stay in the heap and are skipped when popped. */
  cancelled: boolean;
  readonly action: () => void;
  readonly label: string;
}

/** True when `x` must fire before `y`. */
export function eventBefore(x: DesEvent, y: DesEvent): boolean {
  if (x.time !== y.time) return x.time < y.time;
  return x.seq < y.seq;
}

export class EventHeap {
  private readonly items: DesEvent[] = [];

  get size(): number {
    return this.items.length;
  }

  push(event: DesEvent): void {
    const a = this.items;
    a.push(event);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!eventBefore(a[i], a[parent])) break;
      const tmp = a[i];
      a[i] = a[parent];
      a[parent] = tmp;
      i = parent;
    }
  }

  pop(): DesEvent | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop() as DesEvent;
    if (a.length > 0) {
      a[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  peek(): DesEvent | undefined {
    return this.items.length > 0 ? this.items[0] : undefined;
  }

  clear(): void {
    this.items.length = 0;
  }

  private siftDown(start: number): void {
    const a = this.items;
    const n = a.length;
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < n && eventBefore(a[left], a[best])) best = left;
      if (right < n && eventBefore(a[right], a[best])) best = right;
      if (best === i) return;
      const tmp = a[i];
      a[i] = a[best];
      a[best] = tmp;
      i = best;
    }
  }
}
