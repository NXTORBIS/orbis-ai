import { useMemo, useState } from 'react';
import { Database } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, Field, Seg, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const SAMPLE = 'id,name,email,joined,active\n1,Asha Rao,asha@example.com,2024-01-15,true\n2,Rohan Mehta,rohan@example.com,2024-02-03,false\n3,"Quoted, Name",quoted@example.com,2024-03-21,true';

const detect = (text) => {
  if (text.includes('\t')) return '\t';
  if (text.includes(';')) return ';';
  return ',';
};

const splitLine = (line, delimiter) => {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim());
};

const DIALECTS = {
  postgres: { quote: '"', multi: true, label: 'PostgreSQL' },
  mysql: { quote: '`', multi: true, label: 'MySQL' },
  sqlite: { quote: '"', multi: false, label: 'SQLite' },
};

const literal = (value, dialect, nullsAsNull, quoteAll) => {
  if (value === '' && nullsAsNull) return 'NULL';
  const isNumber = /^-?\d+(\.\d+)?$/.test(value);
  if (isNumber && !quoteAll) return value;
  return `'${String(value).replace(/'/g, "''")}'`;
};

export default function CsvToSql() {
  const [csv, setCsv] = useState(SAMPLE);
  const [table, setTable] = useState('people');
  const [dialectId, setDialectId] = useState('postgres');
  const [header, setHeader] = useState(true);
  const [nullsAsNull, setNullsAsNull] = useState(true);
  const [quoteAll, setQuoteAll] = useState(false);

  const dialect = DIALECTS[dialectId];

  const parsed = useMemo(() => {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { columns: [], rows: [] };
    const delimiter = detect(csv);
    const table0 = lines.map((line) => splitLine(line, delimiter));
    const columns = header ? table0[0] : table0[0].map((_, i) => `column_${i + 1}`);
    return { columns, rows: header ? table0.slice(1) : table0 };
  }, [csv, header]);

  const sql = useMemo(() => {
    const { columns, rows } = parsed;
    if (!columns.length || !rows.length) return '';
    const name = table.trim() || 'my_table';
    const q = (id) => `${dialect.quote}${String(id).replace(new RegExp(dialect.quote, 'g'), dialect.quote + dialect.quote)}${dialect.quote}`;
    const columnList = `(${columns.map(q).join(', ')})`;
    const valuesFor = (row) => `(${columns.map((_, i) => literal(row[i] ?? '', dialectId, nullsAsNull, quoteAll)).join(', ')})`;
    if (dialect.multi) {
      const chunks = [];
      for (let i = 0; i < rows.length; i += 250) {
        const batch = rows.slice(i, i + 250).map(valuesFor).join(',\n  ');
        chunks.push(`INSERT INTO ${q(name)} ${columnList} VALUES\n  ${batch};`);
      }
      return chunks.join('\n\n');
    }
    return rows.map((row) => `INSERT INTO ${q(name)} ${columnList} VALUES ${valuesFor(row)};`).join('\n');
  }, [parsed, table, dialect, dialectId, nullsAsNull, quoteAll]);

  const download = () => {
    const blob = new Blob([sql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(table || 'export').replace(/\W+/g, '_')}.sql`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <ToolShell
      toolId="csv-sql"
      icon={Database}
      title="CSV → SQL Insert"
      desc="Turn a spreadsheet export into INSERT statements with the right quoting, NULLs and numbering for your database."
      state={{ csv, table, dialectId, header, nullsAsNull, quoteAll }}
      onRestore={(saved) => {
        if (saved.csv !== undefined) setCsv(saved.csv);
        if (saved.table !== undefined) setTable(saved.table);
        if (saved.dialectId) setDialectId(saved.dialectId);
        setHeader(saved.header ?? true);
        setNullsAsNull(saved.nullsAsNull ?? true);
        setQuoteAll(!!saved.quoteAll);
      }}
      exportText={sql}
      exportName={`${(table || 'export').replace(/\W+/g, '_')}.sql`}
    >
      <Area value={csv} onChange={setCsv} rows={8} mono placeholder="Paste CSV or tab-separated rows…" />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Table name">
          <input value={table} onChange={(e) => setTable(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Dialect">
          <Seg value={dialectId} onChange={setDialectId} options={Object.entries(DIALECTS).map(([id, d]) => ({ value: id, label: d.label }))} />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="First row is the header" checked={header} onChange={setHeader} />
        <ToggleRow label="Empty cells become NULL" checked={nullsAsNull} onChange={setNullsAsNull} />
        <ToggleRow label="Quote every value" checked={quoteAll} onChange={setQuoteAll} hint="numbers as text" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Columns" value={String(parsed.columns.length)} />
        <Stat label="Data rows" value={String(parsed.rows.length)} />
        <Stat label="Statement size" value={`${sql.length.toLocaleString()} chars`} mono />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">SQL</span>
          <div className="flex gap-2">
            <button type="button" onClick={download} disabled={!sql} className="text-[11px] text-cyan-j transition hover:underline disabled:opacity-40">
              Download .sql
            </button>
            <CopyBtn value={sql} />
          </div>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{sql || 'Paste some rows to build the statement.'}</pre>
      </Panel>

      <Panel>
        <div className="mb-2 text-xs font-medium">Columns found</div>
        <div className="flex flex-wrap gap-1.5">
          {parsed.columns.map((c, i) => (
            <span key={`${c}-${i}`} className="rounded-md border border-border/70 px-1.5 py-0.5 font-mono-j text-[10px] text-muted-foreground">{c}</span>
          ))}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Single quotes inside values are doubled, which is what every one of these engines expects. Postgres and MySQL get batched multi-row inserts
          for far fewer round trips, while SQLite gets one statement per row. Text is never sent anywhere — the SQL is built in this tab.
        </p>
      </Panel>
    </ToolShell>
  );
}