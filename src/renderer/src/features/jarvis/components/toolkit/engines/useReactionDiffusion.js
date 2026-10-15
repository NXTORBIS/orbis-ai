import { useEffect, useRef, useState } from 'react';
import ScienceWorker from '@jarvis/components/toolkit/engines/scienceWorker.js?worker';

export default function useReactionDiffusion(config) {
  const worker = useRef(null), timer = useRef(null), playing = useRef(false), inFlight = useRef(false), speedRef = useRef(20);
  const [running, setRunning] = useState(false), [frame, setFrame] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(true), [nonce, setNonce] = useState(0), [speed, setSpeed] = useState(20);
  speedRef.current = speed;
  const advance = steps => { window.clearTimeout(timer.current); if (!worker.current || inFlight.current) return; inFlight.current = true; worker.current.postMessage({ action: 'rd-advance', steps }); };
  useEffect(() => {
    const current = new ScienceWorker(); worker.current = current; playing.current = false; inFlight.current = true; setRunning(false); setFrame(null); setBusy(true); setError('');
    current.onmessage = e => {
      if (worker.current !== current) return;
      inFlight.current = false; setBusy(false);
      if (e.data.error) { setError(e.data.error); playing.current = false; setRunning(false); return; }
      setFrame(e.data.result);
      window.clearTimeout(timer.current);
      if (playing.current) timer.current = window.setTimeout(() => advance(speedRef.current), 16);
    };
    current.onerror = e => { setError(e.message || 'Simulation stopped.'); setBusy(false); playing.current = false; setRunning(false); };
    current.postMessage({ action: 'rd-init', ...config });
    return () => { window.clearTimeout(timer.current); current.terminate(); if (worker.current === current) worker.current = null; };
  }, [config, nonce]);
  const toggle = () => { const next = !playing.current; playing.current = next; setRunning(next); window.clearTimeout(timer.current); if (next) advance(speedRef.current); };
  const reset = () => setNonce(v => v + 1);
  const stimulate = (x, y) => { if (!worker.current || inFlight.current) return; inFlight.current = true; worker.current.postMessage({ action: 'rd-stimulate', x, y }); };
  return { frame, error, busy, running, toggle, reset, step: () => advance(speedRef.current), stimulate, speed, setSpeed };
}