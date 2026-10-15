import { useEffect, useState } from 'react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import useScienceEngine from '@jarvis/components/toolkit/engines/useScienceEngine';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';

export default function RdGrowthCheck({ config }) {
  const [result, setResult] = useState(null), engine = useScienceEngine();
  useEffect(() => { setResult(null); engine.cancel(); }, [config]);
  const run = async () => { const value = await engine.run({ action: 'rd-growth', ...config }); if (value) setResult(value); };
  return <Panel className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Seeded-mode growth comparison</h3><Button variant="outline" disabled={engine.busy} onClick={run}>{engine.busy ? 'Measuring…' : 'Measure growth'}</Button></div>
    <p className="text-xs text-muted-foreground">A separate 32² field is seeded with one real eigenvector at amplitude 10⁻⁵. Compare the fitted rate with continuous-time stability and the exact Euler growth rate.</p>
    {engine.error && <p role="alert" className="text-xs text-destructive">{engine.error}</p>}
    {result && <><div className="grid gap-2 sm:grid-cols-3"><Stat label="Measured growth" value={result.rate == null ? 'Insufficient linear samples' : result.rate.toFixed(6)} sub={`${result.samples} fitted samples · mode (${result.mode.join(', ')})`} /><Stat label="Continuous / Euler prediction" value={`${result.predicted.toFixed(6)} / ${result.discreteRate.toFixed(6)}`} /><Stat label="Turing Dv/Du threshold" value={result.threshold == null ? 'No stable-rest crossing found' : result.threshold.toFixed(5)} /></div><ScientificPlot series={[{ label: 'log amplitude', points: result.times.map((x, i) => ({ x, y: Math.log(Math.max(result.amps[i], 1e-16)) })) }]} xLabel="Time" yLabel="ln(mode amplitude)" /></>}
  </Panel>;
}