import { useEffect, useRef, useState } from 'react';
import ScienceWorker from '@jarvis/components/toolkit/engines/scienceWorker.js?worker';

export default function useScienceEngine() {
  const worker = useRef(null), pending = useRef(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const cancel = () => { worker.current?.terminate(); worker.current = null; pending.current?.(null); pending.current = null; setBusy(false); };
  useEffect(() => () => { worker.current?.terminate(); pending.current?.(null); }, []);
  const run = payload => {
    cancel(); setBusy(true); setError('');
    return new Promise(resolve => {
      pending.current = resolve;
      const current = new ScienceWorker(); worker.current = current;
      const finish = (result, message = '') => { if (worker.current !== current) return; current.terminate(); worker.current = null; pending.current = null; setBusy(false); setError(message); resolve(result); };
      current.onmessage = event => finish(event.data.result ?? null, event.data.error ?? '');
      current.onerror = event => finish(null, event.message || 'The calculation could not finish.');
      current.postMessage(payload);
    });
  };
  return { busy, error, run, cancel };
}