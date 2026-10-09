import { useEffect, useRef, useState, useCallback } from 'react';

// Playback engine: drives a pre-computed array of steps.
// Supports play / pause / resume / stop / restart / step / jump / skip / speed.
// Changing speed while playing never restarts the algorithm.
export function usePlayback(steps) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef(null);

  // Stop whenever the steps array is replaced (new algorithm / new input).
  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [steps]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!playing) return;
    if (idx >= steps.length - 1) { setPlaying(false); return; }
    // Base interval 450ms at 1x; scaled by speed.
    const interval = Math.max(8, 450 / speed);
    timerRef.current = setTimeout(() => {
      setIdx((i) => Math.min(steps.length - 1, i + 1));
    }, interval);
    return () => clearTimeout(timerRef.current);
  }, [playing, idx, speed, steps]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const stop = useCallback(() => { setPlaying(false); setIdx(0); }, []);
  const restart = useCallback(() => { setPlaying(false); setIdx(0); }, []);
  const toStart = useCallback(() => setIdx(0), []);
  const toEnd = useCallback(() => { setPlaying(false); setIdx(Math.max(0, steps.length - 1)); }, [steps.length]);
  const next = useCallback(() => { setPlaying(false); setIdx((i) => Math.min(steps.length - 1, i + 1)); }, [steps.length]);
  const prev = useCallback(() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }, [steps.length]);
  const skip = useCallback((n) => setIdx((i) => Math.max(0, Math.min(steps.length - 1, i + n))), [steps.length]);
  const jump = useCallback((i) => setIdx(Math.max(0, Math.min(steps.length - 1, i))), [steps.length]);

  return {
    idx, playing, speed,
    setSpeed, play, pause, toggle, stop, restart,
    toStart, toEnd, next, prev, skip, jump,
    total: steps.length,
    atEnd: idx >= steps.length - 1,
  };
}