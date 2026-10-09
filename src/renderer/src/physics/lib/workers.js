// High-Performance Computing helper: run a pure function in a real Web Worker
// (created from a Blob URL so no separate file is needed), with progress
// reporting and cancellation via AbortSignal. Keeps the UI thread responsive
// for long Monte Carlo sweeps, diagonalisation, etc.
//
//   runInWorker(workFn, { payload, onProgress, signal, chunkMs })
//     workFn(payload, report) — runs in the worker; call report(progress, partial)
//     to stream progress (0..1) and an optional partial result; return the
//     final result (must be structured-cloneable).
//   Returns a Promise that resolves with the final result, or rejects on abort.

export function runInWorker(workFn, { payload, onProgress, signal, chunkMs = 16 } = {}) {
  return new Promise((resolve, reject) => {
    const src = `
      self.onmessage = (e) => {
        const { payload } = e.data;
        let cancelled = false;
        const report = (progress, partial) => { self.postMessage({ type: 'progress', progress, partial }); };
        try {
          const result = (${workFn.toString()})(payload, report);
          self.postMessage({ type: 'done', result });
        } catch (err) {
          self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
        }
      };
    `;
    const blob = new Blob([src], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    let done = false;
    const cleanup = () => { worker.terminate(); URL.revokeObjectURL(url); };
    if (signal) {
      if (signal.aborted) { cleanup(); reject(new Error('aborted')); return; }
      signal.addEventListener('abort', () => { if (!done) { done = true; cleanup(); reject(new Error('aborted')); } });
    }
    worker.onmessage = (e) => {
      if (done) return;
      if (e.data.type === 'progress' && onProgress) onProgress(e.data.progress, e.data.partial);
      else if (e.data.type === 'done') { done = true; cleanup(); resolve(e.data.result); }
      else if (e.data.type === 'error') { done = true; cleanup(); reject(new Error(e.data.message)); }
    };
    worker.onerror = (e) => { if (!done) { done = true; cleanup(); reject(new Error(e.message || 'worker error')); } };
    worker.postMessage({ payload });
  });
}

// Convenience: a cancellable controller with pause/resume. The worker function
// should check the `paused` flag via report cadence; here we expose a simple
// AbortController wrapper that also tracks a `paused` boolean the caller can
// gate UI on.
export function makeComputeController() {
  const ac = new AbortController();
  return { signal: ac.signal, cancel: () => ac.abort(), paused: false };
}