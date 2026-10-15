import { useMemo, useState } from 'react';
import { Table } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow, downloadBlob } from './shared';

const JSON_SAMPLE = `[
  { "id": 1, "name": "Ada Lovelace", "active": true, "address": { "city": "London", "postcode": "N1" }, "tags": ["maths", "pioneer"], "joined": "2026-01-04" },
  { "id": 2, "name": "Grace Hopper", "active": false, "address": { "city": "New York", "postcode": "10001" }, "tags": ["compiler"], "joined": "2026-02-11" }
]`;

const CSV_SAMPLE = `id,name,active,city,tags,joined
1,Ada Lovelace,true,London,"maths|pioneer",2026-01-04
2,Grace Hopper,false,New York,compiler,2026-02-11`;

const flatten = (value, prefix = '', output = {}) => {
  if (Array.isArray(value)) {
    output[prefix || 'items'] = value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join('|');
    return output;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      flatten(child, prefix ? `${prefix}.${key}` : key, output);
    });
    return output;
  }
  output[prefix] = value === null || value === undefined ? '' : value;
  return output;
};

const splitDelimited = (text, delimiter, quoted) => String(text).split('\n').filter((line) => line.trim().length).map((line) => {
  if (!quoted) return line.split(delimiter).map((cell) => cell.trim());
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1; } else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
});

const escapeCsv = (value, delimiter) => {
  const text = value === null || value === undefined ? '' : String(value);
  return text.includes(delimiter) || text.includes('"') || text.includes('\n') ? `"${text.replace(/"/g, '""')}"` : text;
};

const coerce = (value, enabled, dates, nested) => {
  if (!enabled) return value;
  const trimmed = String(value).trim();
  if (trimmed === '') return nested ? null : '';
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (dates && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(trimmed)) return trimmed;
  return trimmed;
};

export default function JsonCsvConverter() {
  const [mode, setMode] = useState('json');
  const [raw, setRaw] = useState(JSON_SAMPLE);
  const [delimiter, setDelimiter] = useState(',');
  const [quoted, setQuoted] = useState(true);
  const [coerceTypes, setCoerceTypes] = useState(true);
  const [nestedPaths, setNestedPaths] = useState(true);
  const [pretty, setPretty] = useState(true);
  const [error, setError] = useState('');

  const jsonToCsv = useMemo(() => {
    if (mode !== 'json') return '';
    try {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const flat = rows.map((row) => flatten(row));
      const headers = [...new Set(flat.flatMap((row) => Object.keys(row)))];
      const lines = [headers.join(delimiter), ...flat.map((row) => headers.map((header) => escapeCsv(row[header], delimiter)).join(delimiter))];
      return { csv: lines.join('\n'), headers, rowCount: rows.length };
    } catch (err) {
      return { csv: '', headers: [], rowCount: 0, error: String(err.message || err) };
    }
  }, [mode, raw, delimiter]);

  const csvToJson = useMemo(() => {
    if (mode !== 'csv') return '';
    try {
      const delimiterChar = delimiter === '\\t' ? '\t' : delimiter;
      const lines = splitDelimited(raw, delimiterChar, quoted);
      if (!lines.length) return { json: '', rows: [], headers: [] };
      const headers = lines[0];
      const rows = lines.slice(1).map((cells) => {
        const entry = {};
        headers.forEach((header, index) => {
          const value = coerce(cells[index] ?? '', coerceTypes, true, nestedPaths);
          if (nestedPaths && header.includes('.')) {
            const path = header.split('.');
            let cursor = entry;
            path.forEach((key, keyIndex) => {
              if (keyIndex === path.length - 1) cursor[key] = value;
              else {
                cursor[key] = cursor[key] || {};
                cursor = cursor[key];
              }
            });
          } else {
            entry[header] = value;
          }
        });
        return entry;
      });
      return { json: JSON.stringify(rows, null, pretty ? 2 : 0), rows, headers };
    } catch (err) {
      return { json: '', rows: [], headers: [], error: String(err.message || err) };
    }
  }, [mode, raw, delimiter, quoted, coerceTypes, nestedPaths, pretty]);

  const flat = mode === 'json' ? jsonToCsv : csvToJson;
  const problem = error || flat.error || '';

  const save = () => {
    if (mode === 'json') downloadBlob(new Blob([flat.csv || ''], { type: 'text/csv' }), 'data.csv');
    else downloadBlob(new Blob([flat.json || ''], { type: 'application/json' }), 'data.json');
  };

  return (
    <ToolShell
      toolId="json-csv"
      icon={Table}
      title="JSON ⇄ CSV Converter"
      desc="Flatten nested JSON into clean columns, or rebuild structured records from a spreadsheet — with types and dot-paths handled properly."
      state={{ mode, raw, delimiter, quoted, coerceTypes, nestedPaths, pretty }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (restored.delimiter) setDelimiter(restored.delimiter);
        if (typeof restored.quoted === 'boolean') setQuoted(restored.quoted);
        if (typeof restored.coerceTypes === 'boolean') setCoerceTypes(restored.coerceTypes);
        if (typeof restored.nestedPaths === 'boolean') setNestedPaths(restored.nestedPaths);
        if (typeof restored.pretty === 'boolean') setPretty(restored.pretty);
      }}
      exportText={mode === 'json' ? flat.csv || '' : flat.json || ''}
      exportName={mode === 'json' ? 'data.csv' : 'data.json'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={(value) => { setMode(value); setRaw(value === 'json' ? JSON_SAMPLE : CSV_SAMPLE); }} options={[{ value: 'json', label: 'JSON → CSV' }, { value: 'csv', label: 'CSV → JSON' }]} />
        <Seg value={delimiter} onChange={setDelimiter} options={[{ value: ',', label: 'Comma' }, { value: ';', label: 'Semicolon' }, { value: '\\t', label: 'Tab' }, { value: '|', label: 'Pipe' }]} />
        <button type="button" onClick={save} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Download {mode === 'json' ? '.csv' : '.json'}
        </button>
        <CopyBtn value={mode === 'json' ? flat.csv || '' : flat.json || ''} label="Copy output" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Area label={mode === 'json' ? 'JSON input — an array of objects or one object' : 'CSV / delimited input'} value={raw} onChange={(value) => { setRaw(value); setError(''); }} rows={12} mono />
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{mode === 'json' ? 'CSV output' : 'JSON output'}</span>
            {mode === 'csv' && <ToggleRow label="pretty" checked={pretty} onChange={setPretty} />}
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">
            {(mode === 'json' ? flat.csv : flat.json) || 'Nothing to convert yet.'}
          </pre>
        </Panel>
      </div>

      {problem && <Panel className="border-rose-500/40 text-[11px] text-rose-400">{problem}</Panel>}

      <div className="grid gap-2 sm:grid-cols-3">
        {mode === 'csv' ? (
          <>
            <ToggleRow label="Convert numbers and booleans" checked={coerceTypes} onChange={setCoerceTypes} />
            <ToggleRow label="Rebuild nested objects from dot paths" checked={nestedPaths} onChange={setNestedPaths} hint="address.city → { address: { city } }" />
            <ToggleRow label="Respect quoted cells" checked={quoted} onChange={setQuoted} />
          </>
        ) : (
          <>
            <ToggleRow label="Nested objects become dot-path columns" checked onChange={() => {}} hint="address.city" />
            <ToggleRow label="Arrays join with a pipe" checked onChange={() => {}} hint="maths|pioneer" />
            <ToggleRow label="Empty values stay blank" checked onChange={() => {}} />
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          label={mode === 'json' ? 'Rows converted' : 'Records built'}
          value={mode === 'json' ? flat.rowCount || 0 : flat.rows?.length || 0}
          sub={mode === 'json' ? `${flat.headers?.length || 0} columns detected` : `${flat.headers?.length || 0} columns read from the header row`}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">{mode === 'json' ? 'Detected columns' : 'Columns'}</div>
          <div className="max-h-32 overflow-auto">
            <Pills items={(flat.headers || []).map((header) => ({ label: header }))} />
          </div>
        </Panel>
      </div>

      {mode === 'csv' && !!flat.rows?.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">First rows, as parsed</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">
            {JSON.stringify(flat.rows.slice(0, 4), null, 2)}
          </pre>
        </Panel>
      )}

      {mode === 'json' && !!flat.headers?.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Preview of the CSV</div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-collapse text-left font-mono-j text-[11px]">
              <thead className="sticky top-0 bg-card/95 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>{flat.headers.map((header) => <th key={header} className="border-b border-border/50 px-2 py-1.5">{header}</th>)}</tr>
              </thead>
              <tbody>
                {(flat.csv || '').split('\n').slice(1, 9).map((line, index) => (
                  <tr key={index} className="border-b border-border/30">
                    {line.split(delimiter).map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-2 py-1 text-muted-foreground">{cell.replace(/^"|"$/g, '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Input size" value={`${raw.length.toLocaleString()} chars`} mono />
        <Stat label="Delimiter" value={delimiter === '\\t' ? 'tab' : delimiter} mono />
        <Stat label="Output size" value={`${(mode === 'json' ? flat.csv || '' : flat.json || '').length.toLocaleString()} chars`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Flattening is a lossy shape change — the dot-path columns keep the information but not the nesting, so a round trip back to JSON rebuilds
          objects rather than arrays. Quoted cells are respected, so a comma inside an address will not split the row, and numbers only become numbers
          when coercion is on: leave it off when something like a phone number or a postcode must survive with its leading zeros.
        </p>
      </Panel>
    </ToolShell>
  );
}