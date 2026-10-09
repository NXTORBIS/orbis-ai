import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { RotateCcw } from 'lucide-react';

// Conservation of Energy — KE + PE = const on a frictionless track.
// Unique: rolling ball on a curved track, live KE/PE bars, energy vs position plot.
export default function VLEnergySim() {
  const [height, setHeight] = useState(2.0);
  const [mass, setMass] = useState(1.0);
  const [friction, setFriction] = useState(0);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const { explain, explaining, output } = useAIExplain();

  const g = 9.81;
  const Etotal = useMemo(() => mass * g * height, [mass, height]);

  // Track is a half-pipe: y(x) = height * cos²(πx / L)
  const trackY = (x, L) => height * Math.cos((Math.PI * x / L) / 2) ** 2;

  // Energy data along the track
  const energyData = useMemo(() => {
    const pts = [];
    const L = 10;
    for (let i = 0; i <= 50; i++) {
      const x = (i / 50) * L;
      const y = trackY(x, L);
      const PE = mass * g * y;
      const KE = Etotal - PE - friction * x * 0.5;
      pts.push({ x, KE: Math.max(0, KE), PE, total: KE + PE });
    }
    return pts;
  }, [height, mass, friction, Etotal]);

  // Animation
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current; if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const L = 10, scale = w / L, vs = (h - 40) / height;
      // track
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const x = (i / 100) * L, y = trackY(x, L);
        const px = x * scale, py = h - 20 - y * vs;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // ball oscillating
      const omega = Math.sqrt(g / height);
      const x = L / 2 + (L / 2 - 0.5) * Math.sin(omega * tRef.current * 0.5);
      const y = trackY(x, L);
      const px = x * scale, py = h - 20 - y * vs;
      ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(px, py - 10, 10, 0, Math.PI * 2); ctx.fill();
      // KE/PE bars
      const KE = Math.max(0, Etotal - mass * g * y - friction * x * 0.5);
      const PE = mass * g * y;
      const barW = 30, barH = 100;
      ctx.fillStyle = '#334155'; ctx.fillRect(w - 80, h - barH - 20, barW, barH); ctx.fillRect(w - 40, h - barH - 20, barW, barH);
      ctx.fillStyle = '#f97316'; ctx.fillRect(w - 80, h - (KE / Etotal) * barH - 20, barW, (KE / Etotal) * barH);
      ctx.fillStyle = '#22d3ee'; ctx.fillRect(w - 40, h - (PE / Etotal) * barH - 20, barW, (PE / Etotal) * barH);
      ctx.fillStyle = '#fff'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('KE', w - 65, h - barH - 24); ctx.fillText('PE', w - 25, h - barH - 24);
      tRef.current += 0.016;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [height, mass, friction, Etotal]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Conservation of Mechanical Energy" subtitle="Verify KE + PE = const on a frictionless track. Watch energy barter between KE and PE as the ball rolls."
        onExplain={() => explain(`Energy conservation: total E = ${Etotal.toFixed(4)} J. At max height, all PE; at bottom, all KE. Friction = ${friction} → ${friction > 0 ? 'energy dissipates' : 'energy conserved'}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Track height" value={height} onChange={setHeight} min={0.5} max={5} step={0.1} unit="m" />
          <NumField label="Mass" value={mass} onChange={setMass} min={0.1} max={5} step={0.1} unit="kg" />
          <NumField label="Friction coeff." value={friction} onChange={setFriction} min={0} max={0.5} step={0.01} />
          <div className="mt-2 text-xs text-muted-foreground">E total = <span className="font-mono text-cyan-j">{Etotal.toFixed(4)} J</span></div>
          <p className="mt-2 text-xs text-muted-foreground">With friction=0, KE+PE is constant. With friction&gt;0, energy dissipates.</p>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 280 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <Card title="Energy vs Position">
            <SciPlot type="line" data={energyData} xKey="x" series={[{ key: 'KE', label: 'KE (J)', color: '#f97316' }, { key: 'PE', label: 'PE (J)', color: '#22d3ee' }, { key: 'total', label: 'Total (J)', color: '#a855f7' }]} xLabel="x (m)" yLabel="Energy (J)" height={180} exportName="energy-vs-position" />
          </Card>
        </div>
        <div className="space-y-3">
          <Card title="Energy Breakdown">
            <div className="space-y-2 text-xs">
              <div>KE at bottom = <span className="font-mono text-orange-400">{Etotal.toFixed(4)} J</span></div>
              <div>PE at top = <span className="font-mono text-cyan-j">{Etotal.toFixed(4)} J</span></div>
              <div>v at bottom = <span className="font-mono">{Math.sqrt(2 * g * height).toFixed(4)} m/s</span></div>
              <div>Friction loss = <span className="font-mono">{(friction * 2.5).toFixed(4)} J</span></div>
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ height, mass, friction, energyData }, null, 2), 'energy.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}