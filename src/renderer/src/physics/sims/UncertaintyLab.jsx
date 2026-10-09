import React, { useState, useMemo } from 'react';
import { propagate, sampleStats, confidenceInterval, combineUncertainties } from '../lib/uncertainty.js';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';

export default function UncertaintyLab() {
  const [mode, setMode] = useState('propagate');
  const { explain, explaining, output } = useAIExplain();

  return (
    <div className="space-y-4">
      <ResearchHeader title="Uncertainty & Error Laboratory" subtitle="Propagate uncertainty through any function via numerical partial derivatives; combine independent errors in quadrature; compute sample statistics and confidence intervals."
        onExplain={() => explain('Uncertainty lab: propagation, quadrature combination, and sample statistics with confidence intervals — all computed deterministically.')} explaining={explaining} />
      <div className="flex gap-1.5">{['propagate', 'combine', 'sample'].map((m) => <button key={m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1.5 text-xs ${mode === m ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{m === 'propagate' ? 'Error Propagation' : m === 'combine' ? 'Quadrature Combine' : 'Sample Statistics'}</button>)}</div>
      {mode === 'propagate' && <PropagatePanel />}
      {mode === 'combine' && <CombinePanel />}
      {mode === 'sample' && <SamplePanel />}
      <AIPanel output={output} />
    </div>
  );
}

function PropagatePanel() {
  const [expr, setExpr] = useState('x*y + z');
  const [vars, setVars] = useState([{ value: 2, unc: 0.1 }, { value: 3, unc: 0.2 }, { value: 1, unc: 0.05 }]);
  const f = useMemo(() => { try { return new Function(...['x', 'y', 'z', 'w'], `return ${expr};`); } catch { return null; }; }, [expr]);
  const res = useMemo(() => { if (!f) return null; try { return propagate(f, vars); } catch { return null; } }, [f, vars]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Function f(x, y, z, w)">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" />
        <div className="mt-3 space-y-2">
          {vars.map((v, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr] items-center gap-2">
              <span className="font-mono text-sm w-6">{['x', 'y', 'z', 'w'][i]}</span>
              <NumField label="value" value={v.value} onChange={(val) => setVars((a) => a.map((x, j) => j === i ? { ...x, value: val } : x))} min={-100} max={100} step={0.1} />
              <NumField label="±unc" value={v.unc} onChange={(val) => setVars((a) => a.map((x, j) => j === i ? { ...x, unc: Math.max(0, val) } : x))} min={0} max={50} step={0.01} />
            </div>
          ))}
        </div>
      </Card>
      <Card title="Result">
        {res ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3"><div className="text-[10px] uppercase text-muted-foreground">f =</div><div className="font-mono text-2xl">{res.y.toFixed(6)}</div><div className="mt-1 text-[10px] uppercase text-muted-foreground">± uncertainty</div><div className="font-mono text-lg text-cyan-j">± {res.uy.toFixed(6)}</div></div>
            <div className="text-xs text-muted-foreground">Relative uncertainty: <span className="font-mono">{res.y ? ((res.uy / Math.abs(res.y)) * 100).toFixed(3) : '0'}%</span></div>
            <p className="text-xs text-muted-foreground">Computed by central finite differences: u(f) = √Σ(∂f/∂xᵢ · u(xᵢ))². Works for any valid JS expression.</p>
          </div>
        ) : <div className="text-sm text-red-500">Invalid expression. Use x, y, z, w and JS math (e.g. Math.sqrt, Math.sin).</div>}
      </Card>
    </div>
  );
}

function CombinePanel() {
  const [us, setUs] = useState([0.2, 0.3, 0.1]);
  const combined = combineUncertainties(us);
  return (
    <Card title="Combine Independent Uncertainties (quadrature)">
      <p className="mb-3 text-xs text-muted-foreground">u = √(u₁² + u₂² + …) for independent errors.</p>
      <div className="space-y-2">
        {us.map((u, i) => <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-2"><span className="font-mono text-sm w-6">u{i + 1}</span><NumField label="" value={u} onChange={(v) => setUs((a) => a.map((x, j) => j === i ? Math.max(0, v) : x))} min={0} max={10} step={0.01} /><button onClick={() => setUs((a) => a.filter((_, j) => j !== i))} className="text-xs text-red-500">remove</button></div>)}
        <button onClick={() => setUs((a) => [...a, 0.1])} className="text-xs text-cyan-j">+ add uncertainty</button>
      </div>
      <div className="mt-3 rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3"><div className="text-[10px] uppercase text-muted-foreground">combined u =</div><div className="font-mono text-2xl text-cyan-j">{combined.toFixed(6)}</div></div>
    </Card>
  );
}

function SamplePanel() {
  const [text, setText] = useState('12.1, 12.3, 11.9, 12.4, 12.2, 12.0, 12.5, 12.1, 12.3, 12.2');
  const arr = useMemo(() => text.split(/[,\s]+/).map(Number).filter((n) => !isNaN(n)), [text]);
  const s = sampleStats(arr); const ci = confidenceInterval(arr);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Data (comma or space separated)">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" />
      </Card>
      <Card title="Statistics">
        <SciTable headers={['Quantity', 'Value']} rows={[['n', s.n], ['mean', s.mean?.toFixed(6)], ['std dev (sample)', s.sd?.toFixed(6)], ['std dev of mean', s.sdm?.toFixed(6)], ['min', s.min?.toFixed(6)], ['max', s.max?.toFixed(6)], ['95% CI', `[${ci.lo?.toFixed(4)}, ${ci.hi?.toFixed(4)}]`]]} />
      </Card>
    </div>
  );
}