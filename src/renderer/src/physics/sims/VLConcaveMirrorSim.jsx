import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Concave Mirror — reflection imaging, focal length from mirror formula.
// Unique: ray diagram with concave mirror, principal rays, image formation.
export default function VLConcaveMirrorSim() {
  const [f, setF] = useState(15);
  const [u, setU] = useState(30);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();

  const vTheory = useMemo(() => (u * f) / (u - f), [u, f]);
  const mTheory = -vTheory / u;

  // Ray diagram
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
    const cx = w * 0.7, cy = h / 2;
    const scale = Math.min(w, h) / 100;
    // principal axis
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    // concave mirror (arc)
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3; ctx.beginPath();
    ctx.arc(cx + 60 * scale, cy, 60 * scale, Math.PI - 0.5, Math.PI + 0.5); ctx.stroke();
    // focal points
    ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(cx - f * scale, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + f * scale, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '9px monospace'; ctx.fillStyle = '#f97316'; ctx.textAlign = 'center';
    ctx.fillText('F', cx - f * scale, cy + 14); ctx.fillText('C', cx + f * scale, cy + 14);
    // object
    const ox = cx - u * scale, oy = cy;
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - 20 * scale); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 20 * scale); ctx.lineTo(ox - 4, oy - 20 * scale + 6); ctx.lineTo(ox + 4, oy - 20 * scale + 6); ctx.closePath(); ctx.fill();
    // image
    if (vTheory > 0 && vTheory < 200) {
      const ix = cx - vTheory * scale, iy = cy;
      const ih = -mTheory * 20 * scale;
      ctx.strokeStyle = '#eab308'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ix, iy - ih); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ix, iy - ih); ctx.lineTo(ix - 4, iy - ih + (ih > 0 ? -6 : 6)); ctx.lineTo(ix + 4, iy - ih + (ih > 0 ? -6 : 6)); ctx.closePath(); ctx.fill();
    }
    // rays
    ctx.strokeStyle = 'hsl(var(--cyan) / 0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(ox, oy - 20 * scale); ctx.lineTo(cx, oy - 20 * scale); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 20 * scale); ctx.lineTo(cx - f * scale, oy); ctx.lineTo(cx - vTheory * scale, cy - mTheory * 20 * scale); ctx.stroke();
    ctx.setLineDash([]);
  }, [f, u, vTheory, mTheory]);

  const takeTrial = () => {
    const v = vTheory * (1 + (Math.random() - 0.5) * 0.04);
    const fCalc = (u * v) / (u + v);
    setTrials((t) => [...t, { u, v, f: fCalc, m: -v / u }]);
  };

  const fValues = trials.map((t) => t.f);
  const stats = useMemo(() => sampleStats(fValues), [fValues]);
  const pctErr = stats.n ? pctError(stats.mean, f) : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Concave Mirror" subtitle="Measure focal length by reflection imaging. Mirror formula: 1/f = 1/u + 1/v. f = R/2."
        onExplain={() => explain(`Concave mirror: ${trials.length} trials. f = ${stats.mean?.toFixed(4) ?? '—'} cm vs actual ${f} cm (${pctErr.toFixed(2)}% error). u=${u}, v=${vTheory.toFixed(2)}, m=${mTheory.toFixed(3)}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Focal length f" value={f} onChange={setF} min={5} max={40} step={1} unit="cm" />
          <NumField label="Object distance u" value={u} onChange={setU} min={10} max={80} step={1} unit="cm" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure v</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">v (theory) = <span className="font-mono text-cyan-j">{vTheory.toFixed(2)} cm</span></div>
          <div className="text-xs text-muted-foreground">R = 2f = <span className="font-mono">{(2 * f).toFixed(1)} cm</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 300 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          {stats.n > 0 && <Card title="Result"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Mean f', stats.mean.toFixed(4) + ' cm'], ['Std Dev', stats.sd.toFixed(4)], ['% Error', pctErr.toFixed(2) + '%'], ['m', trials[trials.length - 1].m.toFixed(3)]].map(([k, v]) => <div key={k} className="rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5"><div className="text-[10px] uppercase text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}</div></Card>}
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'u (cm)', 'v (cm)', 'f (cm)', 'm']} rows={trials.map((t, i) => [i + 1, t.u.toFixed(1), t.v.toFixed(2), t.f.toFixed(2), t.m.toFixed(3)])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ f, trials }, null, 2), 'concave-mirror.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}