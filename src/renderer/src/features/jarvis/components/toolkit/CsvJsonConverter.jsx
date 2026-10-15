import { useState } from 'react';
import { Braces } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Seg, Area, Out, CopyBtn, Stat, Panel, ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const DELIMS = [['comma', ',', 'Comma  ,'], ['semicolon', ';', 'Semicolon  ;'], ['tab', '\t', 'Tab'], ['pipe', '|', 'Pipe  |']];

function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const escapeCell = (value, delim) => {
  const s = value === null || value === undefined ? '' : String(value);
  return s.includes(delim) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
};

const detectDelim = (text) => {
  const line = (text.split('\n')[0] || '');
  const counts = DELIMS.map(([id, ch]) => [id, line.split(ch).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : 'comma';
};

const SAMPLE = 'name,city,role,joined\nAda Lovelace,London,Engineer,1843\nGrace Hopper,New York,Admiral,1943\nKatherine Johnson,Virginia,Mathematician,1953';

export default function CsvJsonConverter() {
  const [mode, setMode] = useState('csv2json');
  const [delim, setDelim] = useState('comma');
  const [header, setHeader] = useState(true);
  const [input, setInput] = useState(SAMPLE);

  const char = DELIMS.find(([id]) => id === delim)[1];

  const parsed = (() => {
    const trimmed = input.trim();
    if (!trimmed) return { rows: [], cols: 0 };
    try {
      if (mode === 'csv2json') {
        const rows = parseCsv(trimmed, char);
        if (!rows.length) return { rows: [], cols: 0 };
        const keys = header ? rows[0].map((k, i) => k.trim() || `column_${i + 1}`) : rows[0].map((_, i) => `column_${i + 1}`);
        const data = (header ? rows.slice(1) : rows).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
        return { rows: data, keys, cols: keys.length, output: JSON.stringify(data, null, 2) };
      }
      const json = JSON.parse(trimmed);
      let rows = [];
      if (Array.isArray(json)) rows = json;
      else if (typeof json === 'object' && json) rows = [json];
      else rows = [{ value: json }];
      if (!rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
        if (rows.every((r) => Array.isArray(r))) {
          const csv = rows.map((r) => r.map((c) => escapeCell(c, char)).join(char)).join('\n');
          return { rows: rows.map((r) => Object.fromEntries(r.map((v, i) => [`column_${i + 1}`, v]))), cols: rows[0].length, output: csv, arrayMode: true };
        }
        throw new Error('JSON must be an array of objects (or an array of arrays).');
      }
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const csv = [keys.join(char), ...rows.map((r) => keys.map((k) => escapeCell(r[k], char)).join(char))].join('\n');
      return { rows, keys, cols: keys.length, output: csv };
    } catch (error) {
      return { error: error.message };
    }
  })();

  const preview = parsed.error || parsed.arrayMode ? '' : (mode === 'csv2json' ? input : parsed.output);

  return (
    <ToolShell
      toolId="csv-json"
      icon={Braces}
      title="CSV ⇄ JSON Converter"
      desc="Convert between spreadsheets and JSON, with quote-aware parsing and a preview."
      state={{ mode, delim, header, input }}
      onRestore={(saved) => {
        setMode(saved.mode); setDelim(saved.delim);
        setHeader(saved.header ?? true); setInput(saved.input);
      }}
      exportText={parsed.output || ''}
      exportName={mode === 'csv2json' ? 'data.json' : 'data.csv'}
    >
      <Seg value={mode} onChange={(v) => setMode(v)} options={[{ value: 'csv2json', label: 'CSV → JSON' }, { value: 'json2csv', label: 'JSON → CSV' }]} />
      <Seg value={delim} onChange={setDelim} options={DELIMS.map(([id, , label]) => ({ value: id, label }))} />
      <div className="flex flex-wrap items-center gap-2">
        <ToggleRow label="First row is a header" checked={header} onChange={setHeader} />
        <Button size="sm" variant="outline" onClick={() => setDelim(detectDelim(input))}>Detect delimiter</Button>
        <Button size="sm" variant="outline" onClick={() => setInput(mode === 'csv2json' ? SAMPLE : JSON.stringify([{ name: 'Ada', city: 'London' }, { name: 'Grace', city: 'New York' }], null, 2))}>Load sample</Button>
      </div>
      <Area value={input} onChange={setInput} rows={7} placeholder={mode === 'csv2json' ? 'Paste CSV…' : 'Paste JSON…'} />
      {parsed.error ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{parsed.error}</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Rows" value={String(parsed.rows.length)} />
            <Stat label={mode === 'csv2json' ? 'Fields' : 'Columns'} value={String(parsed.cols || 0)} />
            <Stat label="Output size" value={`${(parsed.output?.length || 0).toLocaleString()} chars`} />
          </div>
          <Out label={mode === 'csv2json' ? 'JSON' : `CSV (${char === '\t' ? 'tab' : char})`} value={parsed.output || ''}>
            <pre className="max-h-60 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{parsed.output?.slice(0, 4000)}</pre>
          </Out>
          <div className="flex flex-wrap gap-2">
            <CopyBtn value={parsed.output || ''} label={mode === 'csv2json' ? 'Copy JSON' : 'Copy CSV'} />
          </div>
          {preview && parsed.rows.length > 0 && (
            <Panel>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Preview — first {Math.min(5, parsed.rows.length)} rows</div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {(parsed.keys || Object.keys(parsed.rows[0])).map((k) => <th key={k} className="border-b border-border/60 px-2 py-1 text-left font-medium text-muted-foreground">{k}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {Object.keys(parsed.rows[0]).map((k) => <td key={k} className="border-b border-border/40 px-2 py-1 font-mono-j">{String(r[k] ?? '').slice(0, 40)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </ToolShell>
  );
}