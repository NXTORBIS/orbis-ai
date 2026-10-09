import { useEffect, useRef, useState, useCallback } from 'react';
import { createCamera, updateCamera } from './lib/viewportCamera.js';

// Reusable real-time simulation hook. Owns the rAF loop, transport state,
// graph sampling and stats. Physics is provided as pure callbacks so every
// simulator stays mathematically genuine.
//
// step(state, dt, params, t)  — mutate state in place
// makeInitial(params)         — fresh state object
// draw(ctx, state, params, w, h, t)
// sample(state, params, t)    — object appended to the live graph (or null)
// computeStats(state, params) — object shown in the stat grid (or null)
// resetKey                    — change to re-initialise (structural params)
export function useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats,
  fps = 60, graphEvery = 0.05, statsEvery = 0.066, maxGraph = 400, resetKey, camera }) {
  const [playing, setPlaying] = useState(false);
  const [cameraMode, setCameraMode] = useState(camera?.mode || 'none');
  const [speed, setSpeed] = useState(1);
  const [t, setT] = useState(0);
  const [graphData, setGraphData] = useState([]);
  const [stats, setStats] = useState({});

  const stateRef = useRef(null);
  const cameraRef = useRef(createCamera());
  const cameraCfgRef = useRef(null); cameraCfgRef.current = camera ? { ...camera, mode: cameraMode } : null;
  const paramsRef = useRef(params); paramsRef.current = params;
  const playingRef = useRef(false); playingRef.current = playing;
  const speedRef = useRef(1); speedRef.current = speed;
  const tRef = useRef(0);
  const graphAcc = useRef(0);
  const statsAcc = useRef(0);
  const stepReq = useRef(0);

  const stepRef = useRef(step); stepRef.current = step;
  const drawRef = useRef(draw); drawRef.current = draw;
  const sampleRef = useRef(sample); sampleRef.current = sample;
  const statsFnRef = useRef(computeStats); statsFnRef.current = computeStats;
  const initRef = useRef(makeInitial); initRef.current = makeInitial;

  const pushGraph = useCallback(() => {
    if (!sampleRef.current || !stateRef.current) return;
    const pt = sampleRef.current(stateRef.current, paramsRef.current, tRef.current);
    if (!pt) return;
    if (pt.t === undefined) pt.t = +tRef.current.toFixed(3);
    setGraphData((prev) => {
      const next = prev.length >= maxGraph ? prev.slice(prev.length - maxGraph + 1) : prev.slice();
      next.push(pt);
      return next;
    });
  }, [maxGraph]);

  const reset = useCallback(() => {
    stateRef.current = initRef.current(paramsRef.current);
    tRef.current = 0; setT(0); setGraphData([]);
    cameraRef.current = createCamera();
    if (statsFnRef.current) setStats(statsFnRef.current(stateRef.current, paramsRef.current));
    setPlaying(false);
  }, []);

  const stepOnce = useCallback(() => {
    if (!stateRef.current) stateRef.current = initRef.current(paramsRef.current);
    stepRef.current(stateRef.current, 1 / fps, paramsRef.current, tRef.current);
    tRef.current += 1 / fps; setT(tRef.current);
    if (statsFnRef.current) setStats(statsFnRef.current(stateRef.current, paramsRef.current));
    pushGraph();
  }, [fps, pushGraph]);

  // (Re)initialise on mount and whenever the structural reset key changes.
  useEffect(() => {
    stateRef.current = initRef.current(paramsRef.current);
    tRef.current = 0; setT(0); setGraphData([]);
    cameraRef.current = createCamera();
    if (statsFnRef.current) setStats(statsFnRef.current(stateRef.current, paramsRef.current));
  }, [resetKey]);

  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const dtFixed = 1 / fps;
      if (playingRef.current) {
        const sp = speedRef.current;
        const sub = Math.max(1, Math.ceil(Math.abs(sp)));
        const ddt = (dtFixed * sp) / sub;
        for (let i = 0; i < sub; i++) stepRef.current(stateRef.current, ddt, paramsRef.current, tRef.current + i * ddt);
        tRef.current += dtFixed * sp;
        graphAcc.current += dtFixed * Math.abs(sp);
        statsAcc.current += dtFixed * Math.abs(sp);
        if (graphAcc.current >= graphEvery) { graphAcc.current = 0; pushGraph(); }
        if (statsAcc.current >= statsEvery) { statsAcc.current = 0; setT(tRef.current); if (statsFnRef.current) setStats(statsFnRef.current(stateRef.current, paramsRef.current)); }
      } else if (stepReq.current > 0) {
        const n = stepReq.current; stepReq.current = 0;
        for (let i = 0; i < n; i++) stepRef.current(stateRef.current, dtFixed, paramsRef.current, tRef.current);
        tRef.current += dtFixed * n; setT(tRef.current);
        if (statsFnRef.current) setStats(statsFnRef.current(stateRef.current, paramsRef.current));
        pushGraph();
      }
      const cam = cameraCfgRef.current ? cameraRef.current : null;
      if (cam) {
        const cfg = cameraCfgRef.current;
        const focus = cfg.getFocus(stateRef.current, paramsRef.current, cv.width, cv.height);
        const vel = cfg.getVelocity ? cfg.getVelocity(stateRef.current, paramsRef.current, cv.width, cv.height) : { x: 0, y: 0 };
        updateCamera(cameraRef.current, focus, vel, cv.width, cv.height, cfg);
      }
      drawRef.current(ctx, stateRef.current, paramsRef.current, cv.width, cv.height, tRef.current, cam);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, fps, graphEvery, statsEvery, pushGraph]);

  const recenterCamera = useCallback(() => { cameraRef.current = createCamera(); }, []);

  // Manual pan: drag the canvas to override auto-follow. Auto-follow resumes
  // when the user presses Recenter (which clears the manual flag via createCamera).
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let dragging = false, lastX = 0, lastY = 0;
    const down = (e) => { if (!cameraCfgRef.current) return; dragging = true; lastX = e.clientX; lastY = e.clientY; cameraRef.current.manual = true; if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId); };
    const move = (e) => { if (!dragging) return; const dpr = window.devicePixelRatio || 1; cameraRef.current.x -= (e.clientX - lastX) * dpr; cameraRef.current.y -= (e.clientY - lastY) * dpr; lastX = e.clientX; lastY = e.clientY; };
    const up = (e) => { dragging = false; if (cv.releasePointerCapture) cv.releasePointerCapture(e.pointerId); };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    return () => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); };
  }, [canvasRef]);

  return { playing, setPlaying, speed, setSpeed, t, reset, stepOnce, graphData, stats, stateRef, cameraMode, setCameraMode, recenterCamera, cameraEnabled: !!camera };
}