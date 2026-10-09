import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';

// Prism — dispersion, deviation angle, minimum deviation, refractive index.
// Unique: prism ray-tracing canvas, deviation-vs-angle plot, Cauchy n(λ).
export default function VLPrismSim() {
  const [apexAngle, setApexAngle] = useState(60);
  const [n, setN] = useState(1.5);
  const [wavelength, setWavelength] = useState(589);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();

  // Minimum deviation: δ_min = 2·arcsin(n·sin(A/2)) − A
  const deltaMin = useMemo(() => {
    const A = apexAngle * Math.PI / 180;
    return (2 * Math.asin(Math.min(1, n * Math.sin(A / 2))) - A) * 180 / Math.PI;
  }, [n, apexAngle]);

  // Cauchy's equation: n(λ) = A + B/λ²
  const nAtWavelength = useMemo(() => {
    const B = 3000, A = n - B / (589 * 589);
    return A + B / (wavelength * wavelength);
  }, [n, wavelength]);

  // Ray diagram
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const A = apexAngle * Math.PI / 180;
    const scale = 100;
    // prism (triangle)
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(cx, cy - scale * Math.tan(A / 2));
    ctx.lineTo(cx - scale, cy + scale * 0.3);
    ctx.lineTo(cx + scale, cy + scale * 0.3);
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'hsl(var(--cyan) / 0.08)'; ctx.fill();
    // incident ray
    const i1 = 45 * Math.PI / 180;
    const dx = -Math.cos(i1) * 150, dy = -Math.sin(i1) * 150;
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + dx, cy + dy); ctx.lineTo(cx, cy - scale * Math.tan(A / 2) * 0.5); ctx.stroke();
    // refracted ray through prism
    ctx.strokeStyle = '#eab308'; ctx.beginPath(); ctx.moveTo(cx, cy - scale * Math.tan(A / 2) * 0.5); ctx.lineTo(cx + 40, cy + 10); ctx.stroke();
    // emergent ray
    ctx.strokeStyle = '#22d3ee'; ctx.beginPath(); ctx.moveTo(cx + 40, cy + 10); ctx.lineTo(cx + 150, cy + 40); ctx.stroke();
    // labels
    ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`A=${apexAngle}°`, cx + 5, cy + scale * 0.3 + 14);
    ctx.fillText(`n=${nAtWavelength.toFixed(4)}`, cx + 5, cy + scale * 0.3 + 26);
    ctx.fillText(`δ_min=${deltaMin.toFixed(2)}°`, cx + 5, cy + scale * 0.3 + 38);
  }, [apexAngle, n, wavelength, nAtWavelength, deltaMin]);

  const takeTrial = () => {
    const dm = deltaMin * (1 + (Math.random() - 0.5) * 0.02);
    const nCalc = Math.sin((dm + apexAngle) * Math.PI / 360) / Math.sin(apexAngle * Math.PI / 360);
    setTrials((t) => [...t, { wavelength, n: nAtWavelength, delta: dm, nCalc }]);
  };

  // Dispersion curve
  const dispersionData = useMemo(() => {
    const pts = [];
    const B = 3000, A = n - B / (589 * 589);
    for (let wl = 400; wl <= 700; wl += 10) {
      const nn = A + B / (wl * wl);
      const dm = (2 * Math.asin(Math.min(1, nn * Math.sin(apexAngle * Math.PI / 360))) - apexAngle * Math.PI / 180) * 180 / Math.PI;
      pts.push({ wl, n: nn, delta: dm });
    }
    return pts;
  }, [n, apexAngle]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Prism — Dispersion" subtitle="Measure deviation angle and minimum deviation. Extract n from δ_min: n = sin((A+δ_min)/2) / sin(A/2)."
        onExplain={() => explain(`Prism: A=${apexAngle}°, n=${nAtWavelength.toFixed(4)} at λ=${wavelength}nm. δ_min=${deltaMin.toFixed(2)}°. ${trials.length} trials.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Apex angle A" value={apexAngle} onChange={setApexAngle} min={30} max={90} step={1} unit="°" />
          <NumField label="Base index n" value={n} onChange={setN} min={1.3} max={1.9} step={0.01} />
          <NumField label="Wavelength λ" value={wavelength} onChange={setWavelength} min={400} max={700} step={5} unit="nm" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure δ</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">δ_min = <span className="font-mono text-cyan-j">{deltaMin.toFixed(2)}°</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 260 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <Card title="Dispersion Curve (n vs λ)">
            <SciPlot type="line" data={dispersionData} xKey="wl" series={[{ key: 'n', label: 'n', color: '#22d3ee' }, { key: 'delta', label: 'δ (°)', color: '#f97316' }]} xLabel="λ (nm)" yLabel="n / δ" height={160} exportName="dispersion" />
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'λ (nm)', 'n', 'δ (°)', 'n(calc)']} rows={trials.map((t, i) => [i + 1, t.wavelength, t.n.toFixed(4), t.delta.toFixed(2), t.nCalc.toFixed(4)])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ apexAngle, n, wavelength, trials, dispersionData }, null, 2), 'prism.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}