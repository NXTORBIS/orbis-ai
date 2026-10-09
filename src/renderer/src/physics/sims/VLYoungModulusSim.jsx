import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Young's Modulus — stress-strain curve, extract modulus from slope.
// Unique: wire stretching apparatus, load-unload curve with elastic + yield regions.
export default function VLYoungModulusSim() {
  const [material, setMaterial] = useState('steel');
  const [length, setLength] = useState(2.0);
  const [area, setArea] = useState(1e-6);
  const [load, setLoad] = useState(0);
  const [trials, setTrials] = useState([]);
  const { explain, explaining, output } = useAIExplain();

  const MATERIALS = {
    steel: { E: 200e9, yield: 250e6, color: '#22d3ee' },
    copper: { E: 110e9, yield: 70e6, color: '#f97316' },
    aluminum: { E: 70e9, yield: 40e6, color: '#a855f7' },
    brass: { E: 100e9, yield: 200e6, color: '#eab308' },
  };
  const mat = MATERIALS[material];
  const stress = load / area;
  const strainTheory = stress < mat.yield ? stress / mat.E : mat.yield / mat.E + (stress - mat.yield) / (mat.E * 0.3);

  const takeTrial = () => {
    const s = stress * (1 + (Math.random() - 0.5) * 0.02);
    const e = (s < mat.yield ? s / mat.E : mat.yield / mat.E + (s - mat.yield) / (mat.E * 0.3)) * (1 + (Math.random() - 0.5) * 0.03);
    setTrials((t) => [...t, { load, stress: s, strain: e }]);
  };

  // Linear fit in elastic region
  const fit = useMemo(() => {
    const elastic = trials.filter((t) => t.stress < mat.yield);
    if (elastic.length < 2) return null;
    const n = elastic.length;
    const sx = elastic.reduce((s, t) => s + t.strain, 0);
    const sy = elastic.reduce((s, t) => s + t.stress, 0);
    const sxx = elastic.reduce((s, t) => s + t.strain * t.strain, 0);
    const sxy = elastic.reduce((s, t) => s + t.strain * t.stress, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { E: slope, n: elastic.length };
  }, [trials, mat]);

  const pctErr = fit ? pctError(fit.E, mat.E) : 0;
  const plotData = trials.map((t, i) => ({ strain: t.strain * 100, stress: t.stress / 1e6, trial: i + 1 }));

  return (
    <div className="space-y-4">
      <ResearchHeader title="Young's Modulus" subtitle="Measure Young's modulus from a wire's stress–strain curve. E = stress/strain in the elastic (linear) region."
        onExplain={() => explain(`Young's modulus (${material}): ${trials.length} trials, ${fit?.n ?? 0} in elastic region. E = ${fit?.E.toExponential(4) ?? '—'} Pa vs theory ${mat.E.toExponential(2)} (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <label className="block text-sm"><span className="text-muted-foreground">Material</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.entries(MATERIALS).map(([k, m]) => <option key={k} value={k} className="bg-background">{k} (E={m.E.toExponential(1)})</option>)}
            </select>
          </label>
          <NumField label="Wire length" value={length} onChange={setLength} min={0.5} max={5} step={0.1} unit="m" />
          <NumField label="Cross-section area" value={area} onChange={setArea} min={1e-7} max={1e-5} step={1e-7} unit="m²" />
          <NumField label="Applied load" value={load} onChange={setLoad} min={0} max={500} step={5} unit="N" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">E (theory) = <span className="font-mono text-cyan-j">{mat.E.toExponential(2)} Pa</span></div>
        </Card>
        <div className="space-y-3">
          <Card title="Stress–Strain Curve">
            <SciPlot type="line" data={plotData} xKey="strain" series={[{ key: 'stress', label: 'Stress (MPa)', color: mat.color }]} xLabel="Strain (%)" yLabel="Stress (MPa)" height={280} exportName="stress-strain" />
            <p className="mt-2 text-xs text-muted-foreground">Linear region: elastic (Hooke's law). After yield: plastic deformation. Slope of linear part = E.</p>
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'Load (N)', 'σ (MPa)', 'ε (%)']} rows={trials.map((t, i) => [i + 1, t.load.toFixed(1), (t.stress / 1e6).toFixed(2), (t.strain * 100).toFixed(4)])} /></Card>}
          {fit && <Card title="Result"><div className="text-xs space-y-1"><div>E (measured) = <span className="font-mono text-cyan-j">{fit.E.toExponential(4)} Pa</span></div><div>% error = {pctErr.toFixed(2)}%</div></div></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ material, trials, fit }, null, 2), 'youngs-modulus.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}