import { useState } from 'react';
import { Table, Upload, Download } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Stat, downloadBlob, readFileAsText } from './shared';

function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else { if (ch === '"') inQ = true; else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch; }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export default function CsvAnalyzer() {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [sortCol, setSortCol] = useState(-1);
  const [sortDir, setSortDir] = useState(1);
  const [name, setName] = useState('');

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setName(f.name);
    const text = await readFileAsText(f);
    const data = parseCSV(text);
    if (data.length) { setHeaders(data[0]); setRows(data.slice(1).map((r) => { const o = {}; data[0].forEach((h, i) => o[h] = r[i] ?? ''); return o; })); }
  };

  const numeric = (col) => rows.length > 0 && rows.slice(0, 20).every((r) => r[col] === '' || !isNaN(parseFloat(r[col])));
  const stats = (col) => {
    if (!numeric(col)) return null;
    const vals = rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return { count: vals.length, sum, mean: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
  };
  const filtered = rows.filter((r) => !filter || Object.values(r).some((v) => String(v).toLowerCase().includes(filter.toLowerCase())));
  const sorted = sortCol >= 0 ? [...filtered].sort((a, b) => { const av = a[headers[sortCol]], bv = b[headers[sortCol]]; const an = parseFloat(av), bn = parseFloat(bv); if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir; return String(av).localeCompare(String(bv)) * sortDir; }) : filtered;
  const missing = headers.map((h) => rows.filter((r) => r[h] === '').length);

  const exportCSV = () => {
    const csv = [headers.join(','), ...sorted.map((r) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), 'filtered.csv');
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Table} title="CSV Analyzer" desc="Preview, filter, sort and get statistics on CSV data — all in-browser." />
      <label className="inline-flex">
        <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Choose CSV</Button>
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
      </label>
      {headers.length > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter rows…" className="max-w-xs" />
            <Button size="sm" variant="outline" onClick={exportCSV} className="gap-1.5"><Download className="h-4 w-4" /> Export filtered</Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows" value={rows.length} mono /><Stat label="Columns" value={headers.length} mono /><Stat label="Filtered" value={sorted.length} mono /><Stat label="File" value={name} />
          </div>
          <div className="overflow-auto rounded-md border border-border/70">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50"><tr>{headers.map((h, i) => (
                <th key={i} onClick={() => { if (sortCol === i) setSortDir((d) => -d); else { setSortCol(i); setSortDir(1); } }} className="cursor-pointer whitespace-nowrap px-2 py-1.5 font-medium hover:text-cyan-j">{h}{sortCol === i && (sortDir > 0 ? ' ▲' : ' ▼')}</th>
              ))}</tr></thead>
              <tbody>{sorted.slice(0, 100).map((r, i) => (
                <tr key={i} className="border-t border-border/40">{headers.map((h, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{r[h]}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          {sorted.length > 100 && <p className="text-[11px] text-muted-foreground">Showing first 100 of {sorted.length} rows.</p>}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Column statistics</div>
            {headers.map((h, i) => {
              const s = stats(h); const m = missing[i];
              return <div key={i} className="rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-xs">
                <span className="font-medium">{h}</span>{numeric(h) && s ? <span className="ml-2 text-muted-foreground">n={s.count} · mean={s.mean.toFixed(2)} · min={s.min} · max={s.max}</span> : <span className="ml-2 text-muted-foreground">text column</span>}{m > 0 && <span className="ml-2 text-amber-500">{m} missing</span>}
              </div>;
            })}
          </div>
        </>
      )}
    </div>
  );
}