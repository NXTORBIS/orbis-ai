import React, { useState, useEffect } from 'react';
import { base44 } from '../api/base44Client.js';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Loader2 } from 'lucide-react';

// Compare multiple saved experiments side by side: parameters, runtime,
// numerical results, and difference graphs for a chosen numeric metric.
export default function ExperimentComparison() {
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState([]);
  const [metric, setMetric] = useState('');
  const [loading, setLoading] = useState(true);
  const { explain, explaining, output } = useAIExplain();

  useEffect(() => { (async () => { try { const r = await base44.entities.ExperimentRecord.list('-created_date', 50); setRecords(r); } catch (e) { console.error(e); } finally { setLoading(false); } })(); }, []);

  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const chosen = records.filter((r) => selected.includes(r.id));
  const allKeys = chosen.length ? Array.from(new Set(chosen.flatMap((r) => Object.keys(r.results || {})))) : [];
  const numericKeys = allKeys.filter((k) => chosen.every((r) => typeof (r.results || {})[k] === 'number'));

  const diffData = chosen.map((r, i) => { const base = chosen[0]; const row = { exp: r.experiment_name.slice(0, 12) }; for (const k of numericKeys) row[k] = (r.results[k] - (base.results[k] || 0)); return row; });

  return (
    <div className="space-y-4">
      <ResearchHeader title="Experiment Comparison" subtitle="Select saved experiments and compare parameters, runtime, numerical results and convergence side by side, with difference graphs against a chosen baseline."
        onExplain={() => explain(`Comparing ${chosen.length} experiments on metrics: ${numericKeys.join(', ') || 'none'}.`)} explaining={explaining} />
      {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading experiments…</div> : records.length === 0 ? (
        <Card><div className="py-8 text-center text-sm text-muted-foreground">No saved experiments. Save experiments in the Research Notebook first.</div></Card>
      ) : (
        <div className="space-y-3">
          <Card title={`Select experiments (${selected.length} selected)`}>
            <div className="flex flex-wrap gap-1.5">
              {records.map((r) => <button key={r.id} onClick={() => toggle(r.id)} className={`rounded-full px-3 py-1.5 text-xs ${selected.includes(r.id) ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{r.experiment_name}</button>)}
            </div>
          </Card>
          {chosen.length >= 2 && (
            <>
              <Card title="Parameter & Result Comparison">
                <SciTable headers={['Experiment', ...numericKeys, 'runtime_ms']} rows={chosen.map((r) => [r.experiment_name, ...numericKeys.map((k) => (r.results[k] ?? '—').toFixed?.(4) ?? r.results[k] ?? '—'), r.runtime_ms || '—'])} />
              </Card>
              <Card title="Difference vs baseline (first selected)">
                <SciPlot type="bar" data={diffData} xKey="exp" series={numericKeys.map((k, i) => ({ key: k, label: `Δ${k}`, color: ['#22d3ee', '#f97316', '#a855f7', '#84cc16'][i % 4] }))} xLabel="experiment" yLabel="Δ value" height={220} exportName="diff" />
              </Card>
            </>
          )}
        </div>
      )}
      <AIPanel output={output} />
    </div>
  );
}