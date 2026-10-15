import { Transform, type TransformCallback } from 'node:stream';

/**
 * A Transform stream that limits throughput to `bytesPerSecond`.
 * Set `bytesPerSecond` to 0 or Infinity to disable throttling.
 * The limit can be changed at any time via `setLimit()`.
 */
export class ThrottleTransform extends Transform {
  private _bytesPerSecond: number;
  private _sentInWindow = 0;
  private _windowStart = Date.now();
  private _pending: { chunk: Buffer; callback: TransformCallback } | null = null;
  private _timer: NodeJS.Timeout | null = null;

  constructor(bytesPerSecond: number) {
    super();
    this._bytesPerSecond = bytesPerSecond;
  }

  setLimit(bytesPerSecond: number): void {
    this._bytesPerSecond = bytesPerSecond;
    // If we had a pending chunk waiting for the limit, try again now.
    if (this._pending && (bytesPerSecond <= 0 || bytesPerSecond === Infinity)) {
      this._drainPending();
    }
  }

  get limit(): number {
    return this._bytesPerSecond;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this._bytesPerSecond <= 0 || !isFinite(this._bytesPerSecond)) {
      this.push(chunk);
      callback();
      return;
    }

    const now = Date.now();
    const elapsed = now - this._windowStart;
    if (elapsed >= 1000) {
      this._sentInWindow = 0;
      this._windowStart = now;
    }

    const remaining = this._bytesPerSecond - this._sentInWindow;
    if (remaining >= chunk.length) {
      this._sentInWindow += chunk.length;
      this.push(chunk);
      callback();
    } else {
      // Send what we can now, schedule the rest.
      if (remaining > 0) {
        this.push(chunk.subarray(0, remaining));
        this._sentInWindow += remaining;
        this._pending = { chunk: chunk.subarray(remaining), callback };
      } else {
        this._pending = { chunk, callback };
      }
      const waitMs = Math.max(10, 1000 - elapsed);
      this._timer = setTimeout(() => {
        this._timer = null;
        this._drainPending();
      }, waitMs);
    }
  }

  private _drainPending(): void {
    if (!this._pending) return;
    const { chunk, callback } = this._pending;
    this._pending = null;
    this._sentInWindow = 0;
    this._windowStart = Date.now();
    // Re-enter _transform to handle large chunks in multiple windows.
    this._transform(chunk, 'buffer' as BufferEncoding, callback);
  }

  override _flush(callback: TransformCallback): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._pending) {
      this.push(this._pending.chunk);
      this._pending = null;
    }
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pending = null;
    super._destroy(error, callback);
  }
}
