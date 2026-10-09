import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Newton's Laws — F = ma verification. Unique: apply known forces, measure
// acceleration, extract mass from slope of F-vs-a plot.
export default function VLNewtonSim() {
  const [mass, setMass] = useState(2.0);
  const [force, setForce] = useState(10);
  const [trials, setTrials] = useState([]);
  const { explain, explaining, output } = useAIExplain();

  const aTheory = useMemo(() => force / mass, [force, mass]);

  const takeTrial = () => {
    const a = aTheory * (1 + (Math.random() - 0.5) * 0.03);
    setTrials((t) => [...t, { F: force, a }]);
  };

  // Linear regression: F = m*a → slope = mass
  const fit = useMemo(() => {
    if (trials.length < 2) return null;
    const n = trials.length;
    const sx = trials.reduce((s, t) => s + t.a, 0);
    const sy = trials.reduce((s, t) => s + t.F, 0);
    const sxx = trials.reduce((s, t) => s + t.a * t.a, 0);
    const sxy = trials.reduce((s, t) => s + t.a * t.F, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    return { slope, intercept };
  }, [trials]);

  const pctErr = fit ? pctError(fit.slope, mass) : 0;
  const plotData = trials.map((t, i) => ({ trial: i + 1, a: t.a, F: t.F }));
  const fitLine = useMemo(() => {
    if (!fit) return [];
    const aMin = Math.min(...trials.map((t) => t.a), 0);
    const aMax = Math.max(...trials.map((t) => t.a), aTheory * 1.5);
    return [{ a: aMin, F: fit.slope * aMin + fit.intercept }, { a: aMax, F: fit.slope * aMax + fit.intercept }];
  }, [fit, trials, aTheory]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Newton's Second Law" subtitle="Verify F = ma by applying known forces and measuring acceleration. Extract mass from the slope of F vs a."
        onExplain={() => explain(`Newton's 2nd law: ${trials.length} trials. F-vs-a slope (mass) = ${fit?.slope.toFixed(4) ?? '—'} kg vs actual ${mass} kg (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Mass m" value={mass} onChange={setMass} min={0.5} max={10} step={0.1} unit="kg" />
          <NumField label="Applied force F" value={force} onChange={setForce} min={1} max={50} step={0.5} unit="N" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure a</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">a (theory) = <span className="font-mono text-cyan-j">{aTheory.toFixed(4)} m/s²</span></div>
          <p className="mt-2 text-xs text-muted-foreground">Vary F across trials (keep m fixed) to build the F-vs-a graph.</p>
        </Card>
        <div className="space-y-3">
          <Card title="Force vs Acceleration">
            <SciPlot type="scatter" data={plotData} xKey="a" series={[{ key: 'F', label: 'Measured F', color: '#22d3ee' }]} xLabel="a (m/s²)" yLabel="F (N)" height={260} exportName="F-vs-a" />
            {fit && <p className="mt-2 text-xs text-muted-foreground">Slope (mass) = <span className="font-mono text-cyan-j">{fit.slope.toFixed(4)} kg</span>, intercept = <span className="font-mono">{fit.intercept.toFixed(4)} N</span>. % error: {pctErr.toFixed(2)}%</p>}
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'F (N)', 'a (m/s²)']} rows={trials.map((t, i) => [i + 1, t.F.toFixed(2), t.a.toFixed(4)])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ mass, trials, fit }, null, 2), 'newton.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}