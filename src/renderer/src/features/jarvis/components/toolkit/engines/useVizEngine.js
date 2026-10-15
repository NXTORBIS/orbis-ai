import { useEffect, useRef, useState } from 'react';
import VizWorker from '@jarvis/components/toolkit/engines/vizWorker.js?worker';

/** Runs a structure calculation in a background worker and reports its status. */
export default function useVizEngine() {
  const worker = useRef(null);
  const pending = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    pending.current?.(null);
    pending.current = null;
    setBusy(false);
  };

  useEffect(() => () => { worker.current?.terminate(); pending.current?.(null); }, []);

  const run = (payload) => {
    cancel();
    setBusy(true);
    setError('');
    return new Promise((resolve) => {
      pending.current = resolve;
      const current = new VizWorker();
      worker.current = current;
      const finish = (result, message = '') => {
        if (worker.current !== current) return;
        current.terminate();
        worker.current = null;
        pending.current = null;
        setBusy(false);
        setError(message);
        resolve(result);
      };
      current.onmessage = (event) => finish(event.data.result ?? null, event.data.error ?? '');
      current.onerror = (event) => finish(null, event.message || 'The calculation could not finish.');
      current.postMessage(payload);
    });
  };

  return { busy, error, run, cancel };
}