import React, { useState, useMemo, useRef } from 'react';
import { mean, median, std, variance, rms, minmax, correlation, covariance, linreg, polyfit, polyval, histogram } from '../lib/stats.js';
import { ResearchHeader, Card, SciTable, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Upload } from 'lucide-react';

export default function DataLab() {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [xCol, setXCol] = useState(0); const [yCol, setYCol] = useState(1);
  const [deg, setDeg] = useState(1);
  const [sortCol, setSortCol] = useState(-1); const [sortDir, setSortDir] = useState(1);
  const [query, setQuery] = useState('');
  const fileRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();

  const parseText = (text) => {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return;
    const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s+/;
    const h = lines[0].split(delim).map((s) => s.trim());
    const r = lines.slice(1).map((l) => l.split(delim).map((s) => parseFloat(s.trim())));
    setHeaders(h); setRows(r); setXCol(0); setYCol(Math.min(1, h.length - 1));
  };
  const onFile = async (e) => { const f = e.target.files[0]; if (!f) return; parseText(await f.text()); };
  const loadSample = () => parseText('t,s\n0,0\n1,2.1\n2,3.9\n3,6.2\n4,7.8\n5,10.1\n6,11.7\n7,14.2\n8,15.9\n9,18.1');

  const filtered = useMemo(() => {
    let r = rows;
    if (query) r = r.filter((row) => row.some((c) => String(c).includes(query)));
    if (sortCol >= 0) r = [...r].sort((a, b) => (a[sortCol] - b[sortCol]) * sortDir);
    return r;
  }, [rows, query, sortCol, sortDir]);

  const xs = useMemo(() => rows.map((r) => r[xCol]).filter((x) => !isNaN(x)), [rows, xCol]);
  const ys = useMemo(() => rows.map((r) => r[yCol]).filter((y) => !isNaN(y)), [rows, yCol]);
  const xy = useMemo(() => rows.map((r) => [r[xCol], r[yCol]]).filter(([x, y]) => !isNaN(x) && !isNaN(y)), [rows, xCol, yCol]);
  const fit = useMemo(() => { if (!xy.length) return null; if (deg === 1) { const lr = linreg(xy.map((p) => p[0]), xy.map((p) => p[1])); return { coef: [lr.c, lr.m], r2: lr.r2, mErr: lr.mErr, cErr: lr.cErr, type: `y = ${lr.m.toFixed(4)}x + ${lr.c.toFixed(4)}` }; } const c = polyfit(xy.map((p) => p[0]), xy.map((p) => p[1]), deg); return { coef: c, r2: 1 - xy.reduce((s, [x, y]) => s + (y - polyval(c, x)) ** 2, 0) / (variance(xy.map((p) => p[1])) * (xy.length - 1) || 1), type: c.map((v, i) => `${v.toFixed(4)}${i ? `x${i > 1 ? `^${i}` : ''}` : ''}`).join(' + ') }; }, [xy, deg]);
  const plotData = useMemo(() => xy.map(([x, y], i) => ({ x, y, fit: fit ? polyval(fit.coef, x) : null })), [xy, fit]);
  const hist = useMemo(() => histogram(ys, 20), [ys]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Physics Data Laboratory" subtitle="Import CSV/JSON/TXT, clean & sort, compute statistics, fit models (linear & polynomial), and visualise with scientific plots. Deterministic analysis — no AI in the math."
        onExplain={() => explain(`Data lab: ${rows.length} rows, ${headers.length} columns. Fit ${fit?.type || 'none'} with R²=${fit?.r2?.toFixed(4) ?? '—'}.`)} explaining={explaining} />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,.txt,.json" onChange={onFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="rounded-md border border-input bg-card/40 px-3 py-1.5 text-sm flex items-center gap-1.5"><Upload className="size-3.5" />Import CSV/TXT/JSON</button>
        <button onClick={loadSample} className="rounded-md border border-input bg-card/40 px-3 py-1.5 text-sm">Load sample (linear motion)</button>
        {rows.length > 0 && <button onClick={() => downloadFile([headers.join(','), ...rows.map((r) => r.join(','))].join('\n'), 'data.csv', 'text/csv')} className="rounded-md border border-input bg-card/40 px-3 py-1.5 text-sm">Export CSV</button>}
      </div>
      {rows.length === 0 ? (
        <Card><div className="py-10 text-center text-sm text-muted-foreground">Import a file or load the sample to begin analysis.</div></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <Card title={`Data (${filtered.length} rows)`}>
              <div className="mb-2 flex flex-wrap gap-2 items-center">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter…" className="rounded-md border border-input bg-transparent px-2 py-1 text-xs" />
                {headers.map((h, i) => <button key={i} onClick={() => { setSortCol(i); setSortDir(sortCol === i ? -sortDir : 1); }} className={`text-xs px-1.5 py-0.5 rounded ${sortCol === i ? 'bg-cyan-j text-background' : 'bg-card/40'}`}>{h}{sortCol === i ? (sortDir > 0 ? '↑' : '↓') : ''}</button>)}
              </div>
              <div className="max-h-56 overflow-auto">
                <SciTable headers={headers} rows={filtered.slice(0, 50)} />
              </div>
            </Card>
            <Card title="Summary Statistics">
              <div className="grid grid-cols-2 gap-2">
                {[['Mean', mean(ys).toFixed(4)], ['Median', median(ys).toFixed(4)], ['Std Dev', std(ys).toFixed(4)], ['Variance', variance(ys).toFixed(4)], ['RMS', rms(ys).toFixed(4)], ['Min/Max', `${minmax(ys).min.toFixed(3)} / ${minmax(ys).max.toFixed(3)}`], ['Corr(x,y)', correlation(xs, ys).toFixed(4)], ['Cov(x,y)', covariance(xs, ys).toExponential(3)]].map(([k, v]) => <div key={k} className="rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5"><div className="text-[10px] uppercase text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}
              </div>
            </Card>
          </div>
          <div className="space-y-3">
            <Card title="Fit & Plot">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">x:</span><select value={xCol} onChange={(e) => setXCol(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-xs">{headers.map((h, i) => <option key={i} value={i} className="bg-background">{h}</option>)}</select>
                <span className="text-xs text-muted-foreground">y:</span><select value={yCol} onChange={(e) => setYCol(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-xs">{headers.map((h, i) => <option key={i} value={i} className="bg-background">{h}</option>)}</select>
                <span className="text-xs text-muted-foreground">degree:</span><select value={deg} onChange={(e) => setDeg(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-xs">{[1, 2, 3, 4].map((d) => <option key={d} value={d} className="bg-background">{d}</option>)}</select>
              </div>
              <SciPlot type="scatter" data={plotData} xKey="x" series={[{ key: 'y', label: headers[yCol] || 'y', color: '#22d3ee' }, { key: 'fit', label: 'fit', color: '#f97316' }]} xLabel={headers[xCol] || 'x'} yLabel={headers[yCol] || 'y'} height={220} exportName="fit" />
              {fit && <div className="mt-2 rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-2.5"><div className="font-mono text-sm text-cyan-j">{fit.type}</div><div className="text-xs text-muted-foreground">R² = {fit.r2?.toFixed(6)}{deg === 1 && fit.mErr !== undefined ? ` · slope ± ${fit.mErr.toFixed(5)} · intercept ± ${fit.cErr.toFixed(5)}` : ''}</div></div>}
            </Card>
            <Card title="Histogram">
              <SciPlot type="bar" data={hist.counts.map((c, i) => ({ x: hist.edges[i].toFixed(3), count: c }))} xKey="x" series={[{ key: 'count', label: 'frequency', color: '#a855f7' }]} xLabel={headers[yCol] || 'y'} yLabel="count" height={180} exportName="hist" />
            </Card>
          </div>
        </div>
      )}
      <AIPanel output={output} />
    </div>
  );
}