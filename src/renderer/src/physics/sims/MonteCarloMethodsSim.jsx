// Monte Carlo Methods — Metropolis sampling, π estimation, convergence
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Metropolis-Hastings sampler for a 1D target distribution
function metropolis(target, x0, n, sigma) {
  let x = x0; const samples = []; let accepted = 0;
  let r = 12345;
  const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
  const gauss = () => { const u1 = rand(), u2 = rand(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
  for (let i = 0; i < n; i++) {
    const xNew = x + sigma * gauss();
    const ratio = target(xNew) / target(x);
    if (rand() < ratio) { x = xNew; accepted++; }
    samples.push(x);
  }
  return { samples, acceptanceRate: accepted / n };
}

const TARGETS = {
  'Gaussian': (x) => Math.exp(-x * x / 2),
  'Double well': (x) => Math.exp(-(((x * x - 4) ** 2) / 8)),
  'Cauchy': (x) => 1 / (1 + x * x),
  'Bimodal mix': (x) => 0.5 * Math.exp(-((x - 3) ** 2) / 2) + 0.5 * Math.exp(-((x + 3) ** 2) / 2),
};

export default function MonteCarloMethodsSim() {
  const [targetKey, setTargetKey] = useState('Gaussian');
  const [n, setN] = useState(50000);
  const [sigma, setSigma] = useState(1);
  const [piN, setPiN] = useState(100000);
  const { explain, explaining, output } = useAIExplain();

  const { hist, acceptRate, mean, variance } = useMemo(() => {
    const target = TARGETS[targetKey];
    const { samples, acceptanceRate } = metropolis(target, 0, n, sigma);
    // histogram
    const nBins = 60, lo = -8, hi = 8;
    const bins = new Array(nBins).fill(0);
    for (const s of samples) { const idx = Math.floor((s - lo) / (hi - lo) * nBins); if (idx >= 0 && idx < nBins) bins[idx]++; }
    const hist = bins.map((c, i) => ({ x: lo + (i + 0.5) * (hi - lo) / nBins, count: c / n }));
    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return { hist, acceptRate: acceptanceRate, mean, variance };
  }, [targetKey, n, sigma]);

  // π estimation via Monte Carlo
  const piEst = useMemo(() => {
    let inside = 0; let r = 999;
    const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
    const conv = [];
    for (let i = 1; i <= piN; i++) {
      const x = rand() * 2 - 1, y = rand() * 2 - 1;
      if (x * x + y * y < 1) inside++;
      if (i % 1000 === 0) conv.push({ n: i, pi: 4 * inside / i, err: Math.abs(4 * inside / i - Math.PI) });
    }
    return { pi: 4 * inside / piN, conv };
  }, [piN]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Monte Carlo Methods — Metropolis & π Estimation"
        subtitle="Metropolis-Hastings samples from any target distribution via a random walk with detailed balance. π estimation shows 1/√N convergence."
        onExplain={() => explain(`Metropolis sampling of ${targetKey} with N=${n}, proposal σ=${sigma}. Acceptance rate = ${(acceptRate * 100).toFixed(1)}%. Sampled mean = ${mean.toFixed(4)}, variance = ${variance.toFixed(4)}. π estimated as ${piEst.pi.toFixed(6)} (error ${Math.abs(piEst.pi - Math.PI).toExponential(3)}) using ${piN.toLocaleString()} samples. Error scales as 1/√N.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Metropolis Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Target</span>
            <select value={targetKey} onChange={(e) => setTargetKey(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(TARGETS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <div className="mt-3"><NumField label="samples N" value={n} onChange={setN} min={1000} max={500000} step={1000} /></div>
          <div className="mt-2"><NumField label="proposal σ" value={sigma} onChange={setSigma} min={0.1} max={5} step={0.1} /></div>
        </Card>
        <div className="space-y-3">
          <SciPlot type="bar" data={hist} xKey="x" series={[{ key: 'count', label: 'density', color: '#22d3ee' }]} xLabel="x" yLabel="P(x)" height={220} exportName="metropolis-hist" />
          <SciTable headers={['Statistic', 'Value']} rows={[
            ['Acceptance rate', `${(acceptRate * 100).toFixed(1)}%`],
            ['Sampled mean', mean.toFixed(6)],
            ['Sampled variance', variance.toFixed(6)],
            ['Target', targetKey],
          ]} />
        </div>
      </div>
      <Card title="π Estimation — 4·(points inside circle)/(total points)">
        <div className="flex items-center gap-2 mb-2"><NumField label="N samples" value={piN} onChange={setPiN} min={1000} max={10000000} step={10000} /></div>
        <SciPlot type="line" data={piEst.conv} xKey="n" log="log"
          series={[{ key: 'err', label: '|π̂ − π|', color: '#f97316' }]}
          xLabel="N samples" yLabel="error" height={200} exportName="pi-convergence" />
        <div className="mt-2 text-xs text-muted-foreground">π̂ = <span className="font-mono text-cyan-j">{piEst.pi.toFixed(8)}</span> · error = <span className="font-mono">{Math.abs(piEst.pi - Math.PI).toExponential(3)}</span> · 1/√N slope visible on log-log plot</div>
      </Card>
      <AIPanel output={output} />
    </div>
  );
}