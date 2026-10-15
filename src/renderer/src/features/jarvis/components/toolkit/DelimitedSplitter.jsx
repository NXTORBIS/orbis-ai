import { useMemo, useState } from 'react';
import { Table } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const DELIMITERS = [
  { value: 'comma', label: 'Comma', char: ',' },
  { value: 'tab', label: 'Tab', char: '\t' },
  { value: 'semicolon', label: 'Semicolon', char: ';' },
  { value: 'pipe', label: 'Pipe', char: '|' },
  { value: 'space', label: 'Spaces', char: /\s+/ },
];

const SAMPLE = `name,role,city,joined
Priya Sharma,Designer,Mumbai,2024-03-11
Sam Okafor,Engineer,Lagos,2023-09-02
Lena Fischer,Analyst,Berlin,2025-01-20`;

const splitLine = (line, delimiter, respectQuotes) => {
  if (!respectQuotes) {
    return String(line).split(delimiter === ' ' ? /\s+/ : delimiter).map((cell) => cell.trim());
  }
  const char = delimiter === ' ' ? null : delimiter;
  if (!char) return line.split(/\s+/);
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const cursor = line[i];
    if (cursor === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (cursor === char && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += cursor;
    }
  }
  cells.push(current.trim());
  return cells;
};

export default function DelimitedSplitter() {
  const [text, setText] = useState(SAMPLE);
  const [delimiter, setDelimiter] = useState('comma');
  const [custom, setCustom] = useState(';');
  const [header, setHeader] = useState(true);
  const [quotes, setQuotes] = useState(true);
  const [output, setOutput] = useState('table');

  const rows = useMemo(() => {
    const found = DELIMITERS.find((d) => d.value === delimiter);
    const char = delimiter === 'custom' ? custom : found?.char ?? ',';
    const lines = String(text).split('\n').filter((line) => line.trim().length);
    return lines.map((line) => splitLine(line, typeof char === 'string' ? char : ' ', quotes));
  }, [text, delimiter, custom, quotes]);

  const columns = useMemo(() => rows.reduce((max, row) => Math.max(max, row.length), 0), [rows]);
  const headers = header && rows.length ? rows[0] : Array.from({ length: columns }, (_, i) => `column_${i + 1}`);
  const body = header ? rows.slice(1) : rows;

  const asTsv = rows.map((row) => row.join('\t')).join('\n');
  const asJson = useMemo(() => {
    const objects = body.map((row) => {
      const entry = {};
      headers.forEach((key, index) => { entry[key || `column_${index + 1}`] = row[index] ?? ''; });
      return entry;
    });
    return JSON.stringify(objects, null, 2);
  }, [body, headers]);

  const asSql = `INSERT INTO table_name (${headers.map((h) => h || 'column').join(', ')}) VALUES\n${body.map((row) => `  (${headers.map((_, i) => `'${String(row[i] ?? '').replace(/'/g, "''")}'`).join(', ')})`).join(',\n')};`;

  const result = output === 'json' ? asJson : output === 'tsv' ? asTsv : output === 'sql' ? asSql : '';

  const setTable = useMemo(() => {
    const counts = new Map();
    rows.forEach((row) => row.forEach((cell) => { if (cell) counts.set(cell, (counts.get(cell) || 0) + 1); }));
    return [...counts.entries()].filter(([, count]) => count > 1).slice(0, 8);
  }, [rows]);

  return (
    <ToolShell
      toolId="split-delimited"
      icon={Table}
      title="Delimited Text Splitter"
      desc="Turn pasted delimited text into a real grid — columns aligned, quotes understood, ready to export as TSV, JSON or SQL."
      state={{ text, delimiter, custom, header, quotes, output }}
      onRestore={(restored) => {
        if (typeof restored.text === 'string') setText(restored.text);
        if (restored.delimiter) setDelimiter(restored.delimiter);
        if (typeof restored.custom === 'string') setCustom(restored.custom);
        if (typeof restored.header === 'boolean') setHeader(restored.header);
        if (typeof restored.quotes === 'boolean') setQuotes(restored.quotes);
        if (restored.output) setOutput(restored.output);
      }}
      exportText={result || asTsv}
      exportName="split.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={delimiter} onChange={setDelimiter} options={[...DELIMITERS.map((d) => ({ value: d.value, label: d.label })), { value: 'custom', label: 'Custom' }]} />
        {delimiter === 'custom' && (
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="·" className="h-9 w-16 rounded-md border border-input bg-transparent px-2 text-center font-mono-j text-sm" />
        )}
      </div>

      <Field label="Paste your data">
        <Area value={text} onChange={setText} rows={7} mono />
      </Field>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="First row is headings" checked={header} onChange={setHeader} />
        <ToggleRow label="Respect quoted cells" checked={quotes} onChange={setQuotes} hint={`"a, b"`} />
        <Seg value={output} onChange={setOutput} options={[{ value: 'table', label: 'Table' }, { value: 'tsv', label: 'TSV' }, { value: 'json', label: 'JSON' }, { value: 'sql', label: 'SQL' }]} />
      </div>

      {output === 'table' ? (
        <div className="tk-card tk-depth max-h-80 overflow-auto rounded-xl border border-border/70 bg-card/40 p-1">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr>
                {headers.map((cell, index) => (
                  <th key={`${cell}-${index}`} className="border-b border-border/60 px-2.5 py-2 text-[10px] uppercase tracking-wider text-cyan-j">{cell || `column_${index + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-accent/30">
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex} className="border-b border-border/40 px-2.5 py-1.5 font-mono-j text-[11px]">{row[cellIndex] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{output.toUpperCase()} output</span>
            <CopyBtn value={result} label="Copy" />
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{result || 'Nothing to export yet.'}</pre>
        </Panel>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Rows" value={String(body.length)} mono />
        <Stat label="Columns" value={String(columns)} mono />
        <Stat label="Characters" value={text.length.toLocaleString()} mono />
        <Stat label="Repeated cells" value={String(setTable.length)} mono />
      </div>

      {!!setTable.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Values that repeat</div>
          <div className="flex flex-wrap gap-1.5">
            {setTable.map(([value, count]) => (
              <span key={value} className="rounded-lg border border-border/60 px-2 py-1 font-mono-j text-[10px]">
                {value} <span className="text-muted-foreground">×{count}</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Columns are padded to the widest row so missing cells read as blank rather than shifting everything left — which is exactly the bug that
          makes imported spreadsheets go wrong. Quoted cells containing your delimiter stay in one piece, so a comma inside an address will not split
          the row.
        </p>
      </Panel>
    </ToolShell>
  );
}