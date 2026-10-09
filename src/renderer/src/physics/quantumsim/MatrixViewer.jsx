import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Grid3x3 } from 'lucide-react';
import Section from './Section';

export default function MatrixViewer({ hamiltonian }) {
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState('signed'); // signed | magnitude
  const [hover, setHover] = useState(null);
  const { D, rows, cols, vals } = hamiltonian || {};

  const lookup = useMemo(() => {
    if (!hamiltonian) return null;
    const m = new Map();
    for (let k = 0; k < rows.length; k++) m.set(rows[k] * D + cols[k], vals[k]);
    return m;
  }, [hamiltonian]);

  const maxAbs = useMemo(() => (vals ? vals.reduce((m, v) => Math.max(m, Math.abs(v)), 0) : 1), [vals]);

  useEffect(() => {
    if (!hamiltonian) return;
    const cv = canvasRef.current;
    const ctx = cv.getContext('2d');
    const size = 360;
    cv.width = size; cv.height = size;
    ctx.clearRect(0, 0, size, size);
    const span = Math.max(1, Math.ceil(D / zoom));
    const off = Math.floor((D - span) / 2);
    const cell = size / span;
    // background
    ctx.fillStyle = 'hsl(var(--background))';
    ctx.fillRect(0, 0, size, size);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k], c = cols[k];
      if (r < off || r >= off + span || c < off || c >= off + span) continue;
      const v = vals[k];
      const av = Math.abs(v) / maxAbs;
      let color;
      if (mode === 'magnitude') {
        const g = Math.floor(220 * av);
        color = `rgb(${6 + g}, ${180 + g * 0.3}, ${214})`;
      } else {
        const t = v / maxAbs; // -1..1
        if (t >= 0) color = `rgba(239,68,68,${0.15 + 0.85 * t})`;
        else color = `rgba(59,130,246,${0.15 + 0.85 * -t})`;
      }
      ctx.fillStyle = color;
      ctx.fillRect((c - off) * cell, (r - off) * cell, Math.max(1, cell), Math.max(1, cell));
    }
    // diagonal reference line
    ctx.strokeStyle = 'hsl(var(--border))';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(size, size); ctx.stroke();
  }, [hamiltonian, zoom, mode, maxAbs]);

  const onMove = (e) => {
    if (!lookup) return;
    const cv = canvasRef.current;
    const rect = cv.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cv.width;
    const y = ((e.clientY - rect.top) / rect.height) * cv.height;
    const span = Math.max(1, Math.ceil(D / zoom));
    const off = Math.floor((D - span) / 2);
    const c = off + Math.floor((x / 360) * span);
    const r = off + Math.floor((y / 360) * span);
    if (r < 0 || r >= D || c < 0 || c >= D) { setHover(null); return; }
    const v = lookup.get(r * D + c) ?? 0;
    setHover({ r, c, v });
  };

  return (
    <Section title="Hamiltonian Matrix" icon={Grid3x3} right={
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          <button onClick={() => setMode('signed')} className={`rounded px-2 py-0.5 text-[10px] ${mode === 'signed' ? 'bg-cyan-j/20 text-cyan-j' : 'text-muted-foreground'}`}>Signed</button>
          <button onClick={() => setMode('magnitude')} className={`rounded px-2 py-0.5 text-[10px] ${mode === 'magnitude' ? 'bg-cyan-j/20 text-cyan-j' : 'text-muted-foreground'}`}>|H|</button>
        </div>
        <label className="text-[10px] text-muted-foreground">Zoom <input type="range" min={1} max={Math.max(1, (D || 16) / 16)} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="w-20 accent-cyan-500" /></label>
      </div>
    }>
      {!hamiltonian ? (
        <p className="text-xs text-muted-foreground">Build the Hamiltonian to inspect the matrix.</p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="rounded-lg border border-border/50" style={{ imageRendering: 'pixelated', maxWidth: '100%' }} />
          <div className="flex w-full flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">Viewing {Math.ceil(D / zoom)}×{Math.ceil(D / zoom)} block of {D}×{D}</span>
            {hover ? (
              <span className="font-mono">Row {hover.r} · Col {hover.c} · H = {hover.v.toExponential(3)}</span>
            ) : (
              <span className="text-muted-foreground">Hover a cell to inspect</span>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}