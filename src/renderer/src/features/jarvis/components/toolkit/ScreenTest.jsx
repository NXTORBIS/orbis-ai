import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Seg, Panel, Stat, ToggleRow } from './shared';

const COLOURS = [
  '#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#00ffff',
  '#ff00ff', '#ffff00', '#808080', '#f5f5f5', '#1f2937', '#8b5cf6',
];

const LEVELS = ['#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080', '#999999', '#b3b3b3', '#cccccc', '#e6e6e6', '#ffffff'];

export default function ScreenTest() {
  const [mode, setMode] = useState('colours');
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const [fps, setFps] = useState(0);
  const [points, setPoints] = useState([]);
  const [maxPoints, setMaxPoints] = useState(0);
  const [running, setRunning] = useState(true);

  const stageRef = useRef(null);
  const rafRef = useRef(null);
  const framesRef = useRef(0);
  const lastRef = useRef(0);

  useEffect(() => {
    if (mode !== 'colours' || !auto) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % COLOURS.length), 1800);
    return () => clearInterval(id);
  }, [mode, auto]);

  useEffect(() => {
    if (mode !== 'motion' || !running) return undefined;
    lastRef.current = performance.now();
    framesRef.current = 0;
    const loop = (now) => {
      framesRef.current += 1;
      const elapsed = now - lastRef.current;
      if (elapsed >= 500) {
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastRef.current = now;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode, running]);

  const goFullscreen = () => {
    const node = stageRef.current;
    if (!node) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (node.requestFullscreen) node.requestFullscreen();
  };

  const track = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setPoints((list) => {
      const next = [...list.filter((p) => p.id !== event.pointerId), { id: event.pointerId, x, y }];
      setMaxPoints((m) => Math.max(m, next.length));
      return next;
    });
  };

  const release = (event) => setPoints((list) => list.filter((p) => p.id !== event.pointerId));

  return (
    <ToolShell
      toolId="screen-test"
      icon={Monitor}
      title="Screen & Touch Test"
      desc="Check colour, banding, sharpness, motion smoothness and multi-touch on the display you are holding."
      state={{ mode, index, auto }}
      onRestore={(saved) => {
        if (saved.mode) setMode(saved.mode);
        if (saved.index !== undefined) setIndex(saved.index);
        setAuto(!!saved.auto);
      }}
      exportText={`Mode: ${mode}${mode === 'motion' ? ` · ${fps} fps` : ''}${mode === 'touch' ? ` · max ${maxPoints} simultaneous touches` : ''}${mode === 'colours' ? ` · colour ${COLOURS[index]}` : ''}`}
      exportName="screen-test.txt"
    >
      <Seg
        value={mode}
        onChange={setMode}
        options={[
          { value: 'colours', label: 'Colours' },
          { value: 'gradients', label: 'Gradients' },
          { value: 'grid', label: 'Geometry' },
          { value: 'text', label: 'Sharpness' },
          { value: 'motion', label: 'Motion' },
          { value: 'touch', label: 'Touch' },
        ]}
      />

      <div
        ref={stageRef}
        onPointerDown={mode === 'touch' ? track : undefined}
        onPointerMove={mode === 'touch' ? (e) => { if (e.buttons || e.pointerType === 'touch') track(e); } : undefined}
        onPointerUp={mode === 'touch' ? release : undefined}
        onPointerCancel={mode === 'touch' ? release : undefined}
        onClick={mode === 'colours' ? () => setIndex((i) => (i + 1) % COLOURS.length) : undefined}
        className="relative min-h-[52vh] overflow-hidden rounded-2xl border border-border/70 bg-black"
      >
        {mode === 'colours' && (
          <div className="grid h-[52vh] w-full place-items-center transition-colors duration-300" style={{ background: COLOURS[index] }}>
            <span className="rounded-md bg-black/40 px-3 py-1.5 font-mono-j text-[11px] text-white">
              {COLOURS[index]} · {index + 1}/{COLOURS.length} · tap to advance
            </span>
          </div>
        )}

        {mode === 'gradients' && (
          <div className="flex h-[52vh] flex-col">
            {LEVELS.map((c) => <div key={c} className="flex-1" style={{ background: c }} />)}
            <div className="h-8 w-full" style={{ background: 'linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }} />
            <div className="h-6 w-full" style={{ background: 'linear-gradient(90deg, #000, #fff)' }} />
          </div>
        )}

        {mode === 'grid' && (
          <div className="relative h-[52vh] w-full" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.25) 1px, transparent 1px)', backgroundSize: '8px 8px' }}>
            <div className="absolute inset-0 grid place-items-center">
              <svg viewBox="0 0 200 200" className="h-full w-auto">
                <circle cx="100" cy="100" r="90" fill="none" stroke="#22d3ee" strokeWidth="0.6" />
                <circle cx="100" cy="100" r="60" fill="none" stroke="#22d3ee" strokeWidth="0.6" />
                <circle cx="100" cy="100" r="30" fill="none" stroke="#22d3ee" strokeWidth="0.6" />
                <line x1="100" y1="0" x2="100" y2="200" stroke="#f472b6" strokeWidth="0.4" />
                <line x1="0" y1="100" x2="200" y2="100" stroke="#f472b6" strokeWidth="0.4" />
                <rect x="10" y="10" width="180" height="180" fill="none" stroke="#ffffff" strokeWidth="0.5" />
              </svg>
            </div>
            <div className="absolute bottom-3 left-3 flex gap-1">
              {['#ffffff', '#cccccc', '#999999', '#666666', '#333333', '#000000'].map((c) => (
                <span key={c} className="block h-6 w-6 rounded" style={{ background: c }} />
              ))}
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="h-[52vh] space-y-3 overflow-auto bg-white p-4 text-black">
            {[6, 8, 10, 12, 14, 18].map((size) => (
              <p key={size} style={{ fontSize: `${size}px`, lineHeight: 1.3 }}>
                {size}px — the quick brown fox jumps over the lazy dog while screens are checked.
              </p>
            ))}
            <div className="rounded-lg bg-black p-3">
              <p className="text-[11px] text-white">Subpixel colour test on black: RGB CMYK 1234567890</p>
              <p className="text-[11px]" style={{ color: '#ff0000' }}>Red</p>
              <p className="text-[11px]" style={{ color: '#00ff00' }}>Green</p>
              <p className="text-[11px]" style={{ color: '#0000ff' }}>Blue</p>
            </div>
            <div className="rounded-lg border border-black/20 p-3">
              <div className="flex gap-px">
                {Array.from({ length: 60 }, (_, i) => (
                  <span key={i} className="block h-6 flex-1" style={{ background: i % 2 ? '#000' : '#fff' }} />
                ))}
              </div>
              <p className="mt-1 text-[10px] text-black/60">Alternating 1px lines — if they blur together, the panel is scaling.</p>
            </div>
          </div>
        )}

        {mode === 'motion' && (
          <div className="relative h-[52vh] w-full bg-slate-950">
            <div
              className="absolute top-1/3 h-16 w-16 rounded-2xl bg-gradient-to-br from-cyan-j to-fuchsia-500"
              style={{ animation: 'tk-move 2.4s linear infinite' }}
            />
            <style>{'@keyframes tk-move { 0% { left: 0; transform: rotate(0deg); } 100% { left: calc(100% - 4rem); transform: rotate(360deg); } }'}</style>
            <div className="absolute bottom-4 left-4 rounded-md bg-black/50 px-2 py-1 font-mono-j text-[11px] text-white">
              {running ? `${fps} fps` : 'paused'}
            </div>
            <button
              type="button"
              onClick={() => setRunning((r) => !r)}
              className="absolute bottom-4 right-4 rounded-lg border border-white/40 px-3 py-1.5 text-[11px] text-white"
            >
              {running ? 'Pause' : 'Resume'}
            </button>
          </div>
        )}

        {mode === 'touch' && (
          <div className="relative h-[52vh] w-full touch-none bg-slate-950">
            <div className="absolute inset-0 grid place-items-center text-center text-[11px] text-white/60">
              Drag several fingers at once to see how many the display reports.
            </div>
            {points.map((p) => (
              <span
                key={p.id}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-j bg-cyan-j/30"
                style={{ left: p.x, top: p.y, width: 72, height: 72 }}
              />
            ))}
            <div className="absolute bottom-4 left-4 rounded-md bg-black/50 px-2 py-1 font-mono-j text-[11px] text-white">
              {points.length} now · {maxPoints} at once
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={goFullscreen} className="rounded-lg border border-cyan-j/50 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/10">
          Full screen
        </button>
        {mode === 'colours' && (
          <button type="button" onClick={() => setIndex((i) => (i + 1) % COLOURS.length)} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
            Next colour
          </button>
        )}
        {mode === 'touch' && (
          <button type="button" onClick={() => { setPoints([]); setMaxPoints(0); }} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
            Clear touches
          </button>
        )}
      </div>

      {mode === 'colours' && <ToggleRow label="Cycle colours automatically" checked={auto} onChange={setAuto} hint="every 1.8s" />}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Mode" value={mode} />
        <Stat label="Frame rate" value={mode === 'motion' ? `${fps} fps` : '—'} mono />
        <Stat label="Touches" value={mode === 'touch' ? String(maxPoints) : '—'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          In colour mode, tap through the flats looking for stray bright dots — a stuck pixel is most obvious on a full screen of one colour.
          Banding shows up in the grey ramp, and the 1px line pattern catches display scaling. Motion mode reports the frame rate the browser is
          actually hitting.
        </p>
      </Panel>
    </ToolShell>
  );
}