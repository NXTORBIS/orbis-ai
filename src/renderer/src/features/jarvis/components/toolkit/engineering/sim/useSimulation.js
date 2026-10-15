import { useCallback, useEffect, useRef, useState } from 'react';
import { createHistory, integrate, pushSample } from './core';

/**
 * Drives one simulator: a fixed-step integration of the core's equations of motion on
 * requestAnimationFrame, with a transport (play, pause, step, reverse, speed), a rolling
 * sample buffer for the live plots, and a snapshot published at display rate.
 */
export default function useSimulation(sim, params, options = {}) {
  const { maxStep = 1 / 400, sampleEvery = 0.02, resetOn = [] } = options;
  const paramsRef = useRef(params); paramsRef.current = params;
  const state = useRef(null);
  const live = useRef({ running: true, speed: 1, direction: 1 });
  const buffer = useRef(createHistory());
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState({ xs: [], data: {} });
  const [clock, setClock] = useState(0);
  const [running, setRunningState] = useState(true);
  const [speed, setSpeedState] = useState(1);
  const [direction, setDirectionState] = useState(1);

  const reset = useCallback(() => {
    state.current = { t: 0, ...sim.init(paramsRef.current) };
    buffer.current = createHistory();
    setHistory({ xs: [], data: {} });
    setSnapshot({ ...state.current });
    setClock(0);
  }, [sim]);

  const resetKey = resetOn.map((key) => String(params[key])).join('|') + `|${sim.id}`;

  useEffect(() => { reset(); }, [reset, resetKey]);

  const advance = useCallback((dt, record = true) => {
    if (!state.current) return;
    state.current = integrate(sim, state.current, dt, paramsRef.current, maxStep);
    state.current.t = Math.max(0, state.current.t + dt);
    const next = sim.read(state.current, paramsRef.current);
    setSnapshot({ ...state.current });
    setClock(state.current.t);
    if (record && sim.series?.length) {
      const last = buffer.current.xs[buffer.current.xs.length - 1];
      if (last === undefined || Math.abs(state.current.t - last) >= sampleEvery) {
        pushSample(buffer.current, state.current.t, Object.fromEntries(sim.series.map((s) => [s.key, s.value(next, paramsRef.current)])));
        setHistory({ xs: [...buffer.current.xs], data: Object.fromEntries(Object.entries(buffer.current.data).map(([k, v]) => [k, [...v]])) });
      }
    }
  }, [sim, maxStep, sampleEvery]);

  useEffect(() => {
    let frame, last = performance.now(), publish = 0;
    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const real = Math.min(0.05, (now - last) / 1000); last = now;
      if (!live.current.running || !state.current) return;
      advance(real * live.current.speed * live.current.direction, false);
      publish += real;
      if (publish > 1 / 24) {
        publish = 0;
        const next = sim.read(state.current, paramsRef.current);
        setSnapshot({ ...state.current });
        setClock(state.current.t);
        const lastSample = buffer.current.xs[buffer.current.xs.length - 1];
        if (sim.series?.length && (lastSample === undefined || Math.abs(state.current.t - lastSample) >= sampleEvery)) {
          pushSample(buffer.current, state.current.t, Object.fromEntries(sim.series.map((s) => [s.key, s.value(next, paramsRef.current)])));
          setHistory({ xs: [...buffer.current.xs], data: Object.fromEntries(Object.entries(buffer.current.data).map(([k, v]) => [k, [...v]])) });
        }
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sim, advance, sampleEvery]);

  const setRunning = (value) => { live.current.running = value; setRunningState(value); };
  const setSpeed = (value) => { live.current.speed = value; setSpeedState(value); };
  const setDirection = (value) => { live.current.direction = value; setDirectionState(value); };

  return {
    snapshot, clock, history,
    running, speed, direction,
    toggle: () => setRunning(!live.current.running),
    setRunning, setSpeed, setDirection,
    reset,
    step: (dir = 1) => advance(dir * sampleEvery * 5),
    readings: snapshot ? sim.read(snapshot, params) : (sim.read(sim.init(params), params)),
  };
}