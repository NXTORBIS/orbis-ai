import React, { useState, useMemo } from 'react';
import { CONSTANTS, PREFIXES, UNITS, convert, dimString } from '../lib/constants.js';
import { ResearchHeader, SciTable, Card, NumField, useAIExplain, AIPanel, downloadFile } from '../research.jsx';
import { Search } from 'lucide-react';

export default function ConstantsLab() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('m'); const [to, setTo] = useState('ft'); const [val, setVal] = useState(1);
  const conv = useMemo(() => convert(val, from, to), [val, from, to]);
  const filtered = useMemo(() => Object.entries(CONSTANTS).filter(([k, c]) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || k.includes(q.toLowerCase())), [q]);
  const unitNames = Object.keys(UNITS);
  const { explain, explaining, output } = useAIExplain();

  return (
    <div className="space-y-4">
      <ResearchHeader title="Physics Constants & Units" subtitle="CODATA 2018 values, SI prefixes, and deterministic unit conversion with dimensional checking."
        onExplain={() => explain(`Constants lab: ${filtered.length} constants loaded. Unit converter: ${val} ${from} → ${to} = ${conv.ok ? conv.value : 'invalid'}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Constants (${filtered.length})`}>
          <div className="relative mb-2"><Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search constants…" className="w-full rounded-md border border-input bg-transparent pl-7 pr-2 py-1.5 text-sm" /></div>
          <div className="max-h-80 overflow-auto">
            <SciTable headers={['Sym', 'Name', 'Value', 'Unit']} rows={filtered.map(([k, c]) => [c.sym, c.name, c.value.toExponential(4), c.unit])} />
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Unit Converter">
            <div className="grid grid-cols-[1fr_auto_auto_1fr] items-end gap-2">
              <NumField label="Value" value={val} onChange={setVal} min={-1e9} max={1e9} step={0.1} />
              <div className="pb-1" />
              <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">{unitNames.map((u) => <option key={u} value={u} className="bg-background">{u}</option>)}</select>
              <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">{unitNames.map((u) => <option key={u} value={u} className="bg-background">{u}</option>)}</select>
            </div>
            <div className={`mt-3 rounded-lg border p-3 text-sm ${conv.ok ? 'border-cyan-j/30 bg-cyan-j/5' : 'border-red-500/40 bg-red-500/5'}`}>
              {conv.ok ? <><span className="font-mono text-lg">{conv.value.toExponential(6)}</span> <span className="text-muted-foreground">{to}</span>
                <div className="mt-1 text-xs text-muted-foreground">Dimension: {dimString(UNITS[from].dim)}</div></>
                : <span className="text-red-500">{conv.error}</span>}
            </div>
          </Card>
          <Card title="SI Prefixes">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {PREFIXES.filter((p) => p.factor >= 1).map((p) => <div key={p.sym} className="rounded border border-border/50 bg-card/30 px-2 py-1 text-center"><div className="font-mono text-sm">{p.sym || '—'}</div><div className="text-[10px] text-muted-foreground">{p.name}</div><div className="font-mono text-[10px]">{p.factor.toExponential(0)}</div></div>)}
            </div>
          </Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}