import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Ohm's Law — V = IR verification. Unique: circuit diagram with ammeter/voltmeter,
// V-vs-I plot, extract R from slope.
export default function VLOhmsLawSim() {
  const [R, setR] = useState(100);
  const [V, setV] = useState(6);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();

  const ITheory = useMemo(() => V / R, [V, R]);

  // Circuit diagram
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
    // circuit loop
    const mx = 60, my = 40, Mw = w - 120, Mh = h - 80;
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
    ctx.strokeRect(mx, my, Mw, Mh);
    // battery (left side)
    ctx.fillStyle = '#f97316'; ctx.fillRect(mx - 4, my + Mh / 2 - 20, 8, 40);
    ctx.fillStyle = '#fff'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${V}V`, mx - 18, my + Mh / 2);
    // resistor (top)
    ctx.fillStyle = '#22d3ee'; ctx.fillRect(mx + Mw / 2 - 30, my - 8, 60, 16);
    ctx.fillText(`${R}Ω`, mx + Mw / 2, my - 14);
    // ammeter (right)
    ctx.fillStyle = '#0a0b0d'; ctx.beginPath(); ctx.arc(mx + Mw, my + Mh / 2, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#eab308'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#eab308'; ctx.font = '10px monospace'; ctx.fillText('A', mx + Mw, my + Mh / 2 + 3);
    ctx.fillText(`${(ITheory * 1000).toFixed(2)}mA`, mx + Mw + 24, my + Mh / 2);
    // voltmeter (across resistor)
    ctx.fillStyle = '#0a0b0d'; ctx.beginPath(); ctx.arc(mx + Mw / 2, my + Mh + 20, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a855f7'; ctx.stroke();
    ctx.fillStyle = '#a855f7'; ctx.fillText('V', mx + Mw / 2, my + Mh + 23);
    ctx.fillText(`${V}V`, mx + Mw / 2, my + Mh + 44);
    // wires to voltmeter
    ctx.strokeStyle = '#a855f7'; ctx.setLineDash([3, 3]); ctx.beginPath();
    ctx.moveTo(mx + Mw / 2 - 30, my); ctx.lineTo(mx + Mw / 2 - 30, my + Mh + 20); ctx.moveTo(mx + Mw / 2 + 30, my); ctx.lineTo(mx + Mw / 2 + 30, my + Mh + 20); ctx.stroke(); ctx.setLineDash([]);
  }, [V, R, ITheory]);

  const takeTrial = () => {
    const I = ITheory * (1 + (Math.random() - 0.5) * 0.03);
    setTrials((t) => [...t, { V, I }]);
  };

  // R from slope of V vs I
  const fit = useMemo(() => {
    if (trials.length < 2) return null;
    const n = trials.length;
    const sx = trials.reduce((s, t) => s + t.I, 0);
    const sy = trials.reduce((s, t) => s + t.V, 0);
    const sxx = trials.reduce((s, t) => s + t.I * t.I, 0);
    const sxy = trials.reduce((s, t) => s + t.I * t.V, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { slope };
  }, [trials]);

  const pctErr = fit ? pctError(fit.slope, R) : 0;
  const plotData = trials.map((t) => ({ I: t.I * 1000, V: t.V }));

  return (
    <div className="space-y-4">
      <ResearchHeader title="Ohm's Law" subtitle="Verify V = IR by measuring voltage vs current. Extract resistance R from the slope of the V-vs-I graph."
        onExplain={() => explain(`Ohm's law: ${trials.length} trials. R from V-vs-I slope = ${fit?.slope.toFixed(4) ?? '—'} Ω vs actual ${R} Ω (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Resistance R" value={R} onChange={setR} min={10} max={1000} step={10} unit="Ω" />
          <NumField label="Voltage V" value={V} onChange={setV} min={1} max={12} step={0.5} unit="V" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Read ammeter</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">I (theory) = <span className="font-mono text-cyan-j">{ITheory.toFixed(6)} A</span></div>
          <p className="mt-2 text-xs text-muted-foreground">Vary V across trials to build the V-vs-I graph.</p>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 240 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <Card title="V vs I">
            <SciPlot type="scatter" data={plotData} xKey="I" series={[{ key: 'V', label: 'Voltage (V)', color: '#22d3ee' }]} xLabel="I (mA)" yLabel="V (V)" height={180} exportName="V-vs-I" />
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'V (V)', 'I (mA)']} rows={trials.map((t, i) => [i + 1, t.V.toFixed(2), (t.I * 1000).toFixed(4)])} /></Card>}
          {fit && <Card title="Result"><div className="text-xs space-y-1"><div>Slope (R) = <span className="font-mono text-cyan-j">{fit.slope.toFixed(4)} Ω</span></div><div>% error = {pctErr.toFixed(2)}%</div></div></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ R, trials, fit }, null, 2), 'ohm.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}