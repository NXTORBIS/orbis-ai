import { useMemo, useState } from 'react';
import { Table, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const SAMPLE_LEFT = 'id,name,region,seats\n1,Acme Corp,EMEA,240\n2,Northwind,AMER,85\n3,Contoso,APAC,410\n4,Fabrikam,EMEA,60';
const SAMPLE_RIGHT = 'account_id,plan,renewal,arr\n1,Enterprise,2027-01-15,48000\n2,Growth,2026-11-02,12400\n3,Enterprise,2027-03-30,96000\n5,Starter,2026-09-01,2400';

const DELIMITERS = [
  { id: 'comma', label: 'Comma', char: ',' },
  { id: 'tab', label: 'Tab', char: '\t' },
  { id: 'semicolon', label: 'Semicolon', char: ';' },
  { id: 'pipe', label: 'Pipe', char: '|' },
];

const JOINS = [
  { id: 'inner', label: 'Inner — only matches' },
  { id: 'left', label: 'Left — keep all from A' },
  { id: 'right', label: 'Right — keep all from B' },
  { id: 'full', label: 'Full — keep everything' },
];

const OUTPUTS = [
  { id: 'csv', label: 'CSV' },
  { id: 'tsv', label: 'TSV' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON' },
  { id: 'sql', label: 'SQL insert' },
];

/** Split delimited text into rows of cells, honouring quoted fields. */
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value !== ''));
}

function quoteCell(value, delimiter) {
  const text = value === undefined || value === null ? '' : String(value);
  if (text.includes('"') || text.includes(delimiter) || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

export default function TableJoiner() {
  const [left, setLeft] = useState(SAMPLE_LEFT);
  const [right, setRight] = useState(SAMPLE_RIGHT);
  const [delimiterId, setDelimiterId] = useState('comma');
  const [leftKey, setLeftKey] = useState('');
  const [rightKey, setRightKey] = useState('');
  const [joinType, setJoinType] = useState('left');
  const [output, setOutput] = useState('csv');
  const [tableName, setTableName] = useState('joined_report');
  const [extra, setExtra] = useState({ caseInsensitive: true, trimKeys: true, addSource: true, headers: true });
  const [extraColumns, setExtraColumns] = useState([{ left: '', right: '', name: '' }]);

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));
  const delimiter = (DELIMITERS.find((entry) => entry.id === delimiterId) || DELIMITERS[0]).char;

  const parsed = useMemo(() => {
    const leftRows = parseDelimited(left, delimiter);
    const rightRows = parseDelimited(right, delimiter);
    const leftHeaders = leftRows[0] || [];
    const rightHeaders = rightRows[0] || [];
    return {
      leftHeaders,
      rightHeaders,
      leftBody: leftRows.slice(1),
      rightBody: rightRows.slice(1),
    };
  }, [left, right, delimiter]);

  const keyLeft = leftKey || parsed.leftHeaders[0] || '';
  const keyRight = rightKey || parsed.rightHeaders[0] || '';

  const result = useMemo(() => {
    const { leftHeaders, rightHeaders, leftBody, rightBody } = parsed;
    if (!leftHeaders.length || !rightHeaders.length || !keyLeft || !keyRight) {
      return { rows: [], columns: [], matched: 0, leftOnly: 0, rightOnly: 0, duplicates: {}, report: '', unmatchedLeft: [], unmatchedRight: [], sql: '', csv: '', json: '', markdown: '' };
    }

    const normalise = (value) => {
      const text = extra.trimKeys ? String(value ?? '').trim() : String(value ?? '');
      return extra.caseInsensitive ? text.toLowerCase() : text;
    };

    const leftIndex = leftHeaders.indexOf(keyLeft);
    const rightIndex = rightHeaders.indexOf(keyRight);

    // Duplicate keys on the right side are counted rather than silently dropping rows.
    const rightMap = new Map();
    const duplicates = {};
    rightBody.forEach((row) => {
      const key = normalise(row[rightIndex]);
      if (!rightMap.has(key)) rightMap.set(key, []);
      rightMap.get(key).push(row);
      duplicates[key] = (duplicates[key] || 0) + 1;
    });
    const rightCounts = Object.entries(duplicates).filter(([, count]) => count > 1);
    const duplicateKeys = rightCounts.length;

    const sharedRight = rightHeaders.filter((entry) => entry !== keyRight);
    const columns = [
      ...leftHeaders,
      ...sharedRight.map((entry) => (leftHeaders.includes(entry) ? entry + ' (B)' : entry)),
      ...(extra.addSource ? ['match_source'] : []),
    ];

    const rows = [];
    const usedRight = new Set();
    const unmatchedLeft = [];

    leftBody.forEach((row) => {
      const key = normalise(row[leftIndex]);
      const matches = rightMap.get(key) || [];
      const extras = extraColumns.map((column) => {
        const fromLeft = leftHeaders.indexOf(column.left);
        const fromRight = rightHeaders.indexOf(column.right);
        if (fromLeft >= 0) return row[fromLeft] ?? '';
        if (fromRight >= 0 && matches[0]) return matches[0][fromRight] ?? '';
        return '';
      });
      if (matches.length === 0) {
        unmatchedLeft.push(key);
        if (joinType === 'left' || joinType === 'full') {
          rows.push([...row, ...sharedRight.map(() => ''), ...extras, extra.addSource ? 'A only' : ''].filter((value, i) => !(extra.addSource === false && i === row.length + sharedRight.length + extras.length)));
        }
      } else {
        matches.forEach((match) => {
          usedRight.add(normalise(match[rightIndex]));
          rows.push([...row, ...sharedRight.map((entry) => match[rightHeaders.indexOf(entry)] ?? ''), ...extras, extra.addSource ? 'matched' : '']);
        });
      }
    });

    const unmatchedRight = [];
    rightBody.forEach((row) => {
      const key = normalise(row[rightIndex]);
      if (!usedRight.has(key)) {
        unmatchedRight.push(key);
        if (joinType === 'right' || joinType === 'full') {
          rows.push([...leftHeaders.map((entry) => (entry === keyLeft ? row[rightIndex] : '')), ...sharedRight.map((entry) => row[rightHeaders.indexOf(entry)] ?? ''), ...extraColumns.map(() => ''), extra.addSource ? 'B only' : '']);
        }
      }
    });

    const matched = rows.filter((row) => row[row.length - 1] === 'matched').length;
    const finalColumns = [...columns.filter((entry) => entry !== 'match_source'), ...extraColumns.map((column) => column.name || 'extra'), ...(extra.addSource ? ['match_source'] : [])];
    const headerRow = extra.headers ? [finalColumns] : [];
    const allRows = [...headerRow, ...rows];

    const csv = allRows.map((row) => row.map((cell) => quoteCell(cell, ',')).join(',')).join('\n');
    const tsv = allRows.map((row) => row.map((cell) => quoteCell(cell, '\t')).join('\t')).join('\n');
    const markdown = allRows.length
      ? [allRows[0].map((cell) => String(cell)).join(' | '), allRows[0].map(() => '---').join(' | '), ...allRows.slice(1).map((row) => row.map((cell) => String(cell)).join(' | '))].join('\n')
      : '';
    const json = JSON.stringify(rows.map((row) => {
      const object = {};
      finalColumns.forEach((column, i) => { object[column] = row[i] ?? ''; });
      return object;
    }), null, 2);
    const sql = rows.length
      ? 'INSERT INTO ' + tableName + ' (' + finalColumns.join(', ') + ')\nVALUES\n' + rows.map((row) => '  (' + row.map((cell) => (cell === '' || cell === undefined ? 'NULL' : "'" + String(cell).replace(/'/g, "''") + "'")).join(', ') + ')').join(',\n') + ';'
      : '-- no rows to insert';

    const report = [
      'TABLE JOIN',
      joinType + ' join on ' + keyLeft + ' = ' + keyRight + (extra.caseInsensitive ? ' (case insensitive)' : ''),
      '',
      'Left table: ' + leftBody.length + ' rows, ' + leftHeaders.length + ' columns',
      'Right table: ' + rightBody.length + ' rows, ' + rightHeaders.length + ' columns',
      'Output: ' + rows.length + ' rows, ' + finalColumns.length + ' columns',
      'Matched rows: ' + matched,
      'Left-only rows: ' + unmatchedLeft.length,
      'Right-only rows: ' + unmatchedRight.length,
      duplicateKeys > 0 ? 'Duplicate keys on the right: ' + duplicateKeys + ' (rows were multiplied)' : 'No duplicate keys on the right',
      '',
      unmatchedLeft.length ? 'Unmatched left keys: ' + unmatchedLeft.slice(0, 20).join(', ') + (unmatchedLeft.length > 20 ? ' …' : '') : '',
      unmatchedRight.length ? 'Unmatched right keys: ' + unmatchedRight.slice(0, 20).join(', ') + (unmatchedRight.length > 20 ? ' …' : '') : '',
      '',
      'OUTPUT',
      csv.split('\n').slice(0, 30).join('\n'),
    ].filter(Boolean).join('\n');

    return { rows, columns: finalColumns, matched, leftOnly: unmatchedLeft.length, rightOnly: unmatchedRight.length, duplicates: rightCounts, unmatchedLeft, unmatchedRight, csv, tsv, markdown, json, sql, report, allRows };
  }, [parsed, keyLeft, keyRight, joinType, output, tableName, extra, extraColumns]);

  const exportText = output === 'csv' ? result.csv : output === 'tsv' ? result.tsv : output === 'markdown' ? result.markdown : output === 'json' ? result.json : result.sql;

  const [showAll, setShowAll] = useState(false);
  const previewRows = (result.allRows || []).slice(0, showAll ? 60 : 12);

  const download = () => {
    const extension = output === 'json' ? 'json' : output === 'markdown' ? 'md' : output === 'sql' ? 'sql' : output === 'tsv' ? 'tsv' : 'csv';
    const blob = new Blob([exportText], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = tableName + '.' + extension;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="table-joiner"
      icon={Table}
      title="Table Joiner & Data Merger"
      desc="Paste two delimited tables, choose the key columns and join them properly — inner, left, right or full — with duplicate keys, unmatched rows and the output as CSV, JSON, Markdown or SQL."
      state={{ left, right, delimiterId, leftKey, rightKey, joinType, output, tableName, extra, extraColumns }}
      onRestore={(restored) => {
        if (typeof restored.left === 'string') setLeft(restored.left);
        if (typeof restored.right === 'string') setRight(restored.right);
        if (restored.delimiterId) setDelimiterId(restored.delimiterId);
        if (typeof restored.leftKey === 'string') setLeftKey(restored.leftKey);
        if (typeof restored.rightKey === 'string') setRightKey(restored.rightKey);
        if (restored.joinType) setJoinType(restored.joinType);
        if (restored.output) setOutput(restored.output);
        if (typeof restored.tableName === 'string') setTableName(restored.tableName);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
        if (Array.isArray(restored.extraColumns)) setExtraColumns(restored.extraColumns);
      }}
      exportText={exportText}
      exportName={tableName + (output === 'csv' ? '.csv' : output === 'json' ? '.json' : '.txt')}
    >
      <div className="flex flex-wrap gap-1.5">
        {DELIMITERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setDelimiterId(entry.id)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${delimiterId === entry.id ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/60 text-muted-foreground hover:border-cyan-j/40'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Table A</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{parsed.leftBody.length} rows</span>
          </div>
          <textarea value={left} onChange={(e) => setLeft(e.target.value)} rows={7} className="w-full rounded-lg border border-input bg-transparent p-2 font-mono-j text-[11px]" />
          <div className="mt-2">
            <Field label="Key column in A">
              <select value={leftKey} onChange={(e) => setLeftKey(e.target.value)} className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
                <option value="">{parsed.leftHeaders[0] || 'first column'}</option>
                {parsed.leftHeaders.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </Field>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Table B</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{parsed.rightBody.length} rows</span>
          </div>
          <textarea value={right} onChange={(e) => setRight(e.target.value)} rows={7} className="w-full rounded-lg border border-input bg-transparent p-2 font-mono-j text-[11px]" />
          <div className="mt-2">
            <Field label="Key column in B">
              <select value={rightKey} onChange={(e) => setRightKey(e.target.value)} className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
                <option value="">{parsed.rightHeaders[0] || 'first column'}</option>
                {parsed.rightHeaders.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </Field>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Join type">
          <select value={joinType} onChange={(e) => setJoinType(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
            {JOINS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </Field>
        <Field label="Output format">
          <select value={output} onChange={(e) => setOutput(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
            {OUTPUTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </Field>
        <Field label="SQL table name"><input value={tableName} onChange={(e) => setTableName(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <ToggleRow label="Keys case insensitive" checked={extra.caseInsensitive} onChange={() => toggle('caseInsensitive')} />
        <ToggleRow label="Trim whitespace from keys" checked={extra.trimKeys} onChange={() => toggle('trimKeys')} />
        <ToggleRow label="Add match source column" checked={extra.addSource} onChange={() => toggle('addSource')} />
        <ToggleRow label="Include header row" checked={extra.headers} onChange={() => toggle('headers')} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Extra columns to pull across</span>
          <button type="button" onClick={() => setExtraColumns((current) => [...current, { left: '', right: '', name: '' }])} className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j transition hover:bg-cyan-j/20">
            <Plus className="h-3 w-3" /> Add column
          </button>
        </div>
        <div className="space-y-1.5">
          {extraColumns.map((column, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1.5">
              <select value={column.left} onChange={(e) => setExtraColumns((current) => current.map((entry, i) => (i === index ? { ...entry, left: e.target.value } : entry)))} className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]">
                <option value="">from A…</option>
                {parsed.leftHeaders.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
              <select value={column.right} onChange={(e) => setExtraColumns((current) => current.map((entry, i) => (i === index ? { ...entry, right: e.target.value } : entry)))} className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]">
                <option value="">or from B…</option>
                {parsed.rightHeaders.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
              <input value={column.name} onChange={(e) => setExtraColumns((current) => current.map((entry, i) => (i === index ? { ...entry, name: e.target.value } : entry)))} placeholder="output name" className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
              <button type="button" onClick={() => setExtraColumns((current) => current.filter((_, i) => i !== index))} className="rounded-md border border-border/60 p-1.5 text-muted-foreground transition hover:border-rose-500/50 hover:text-rose-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Useful when the column you want is named differently in each table — pick it from either side and give the output its own name.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={JOINS.find((entry) => entry.id === joinType).label.split(' — ')[0] + ' join on ' + (keyLeft || '—') + ' = ' + (keyRight || '—')}
          value={String(result.rows.length)}
          unit="output rows"
          sub={result.matched + ' rows matched on both sides, ' + result.leftOnly + ' exist only in A and ' + result.rightOnly + ' only in B. ' + (result.duplicates.length ? 'Duplicate keys in B multiplied ' + result.duplicates.length + ' of the matches.' : 'Every key in B was unique, so no rows were multiplied.')}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Join diagnostics</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Table A rows</span><span>{parsed.leftBody.length}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Table B rows</span><span>{parsed.rightBody.length}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Output rows</span><span className="text-cyan-j">{result.rows.length}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Matched</span><span>{result.matched}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Left only</span><span className={result.leftOnly ? 'text-amber-400' : ''}>{result.leftOnly}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Right only</span><span className={result.rightOnly ? 'text-amber-400' : ''}>{result.rightOnly}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Duplicate B keys</span><span className={result.duplicates.length ? 'text-rose-400' : ''}>{result.duplicates.length}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Join', value: joinType },
                { label: 'Columns', value: String(result.columns.length) },
                { label: 'Format', value: OUTPUTS.find((entry) => entry.id === output).label },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Joined result</span>
          <div className="flex gap-2">
            <CopyBtn value={exportText} label="Copy output" />
            <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              Download
            </button>
          </div>
        </div>
        <div className="max-h-72 overflow-auto rounded-lg border border-border/60">
          <table className="w-full font-mono-j text-[10px]">
            <thead className="sticky top-0 bg-card/90 text-muted-foreground">
              <tr>{(result.allRows?.[0] || []).map((cell, index) => <th key={index} className="whitespace-nowrap py-1 pl-2 pr-2 text-left">{String(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {previewRows.slice(1).map((row, index) => (
                <tr key={index} className="border-t border-border/40">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`whitespace-nowrap py-1 pl-2 pr-2 ${String(cell) === 'A only' || String(cell) === 'B only' ? 'text-amber-400' : ''}`}>{cell === '' || cell === undefined ? '—' : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.rows.length > 11 && (
          <button type="button" onClick={() => setShowAll((current) => !current)} className="mt-2 rounded-lg border border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/40">
            {showAll ? 'Show fewer rows' : 'Show 60 rows'}
          </button>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Rows tagged <span className="font-mono-j">A only</span> or <span className="font-mono-j">B only</span> are the unmatched ones. Their presence or absence is exactly what the join type controls.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{OUTPUTS.find((entry) => entry.id === output).label} output</span>
            <CopyBtn value={exportText} label="Copy" />
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{exportText.slice(0, 4000)}</pre>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Full analysis</div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Output rows" value={String(result.rows.length)} mono sub={joinType + ' join'} />
        <Stat label="Matched" value={String(result.matched)} mono sub="keys found on both sides" />
        <Stat label="Unmatched" value={String(result.leftOnly + result.rightOnly)} mono sub="rows only in one table" />
        <Stat label="Columns" value={String(result.columns.length)} mono sub="in the output" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Joining data correctly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Duplicate keys on the right multiply rows. A match count higher than the left row count is the usual symptom, and it silently inflates any total you calculate afterwards.</p>
            <p>· A left join keeps every row in A whether or not it matched, filling the right side with blanks. That is usually the honest choice when reporting on customers.</p>
            <p>· Case and stray spaces are the most common reason two keys fail to match. Normalise before joining rather than debugging afterwards.</p>
            <p>· An inner join quietly drops rows. The count of unmatched keys is the number you should look at before trusting any total.</p>
            <p>· Numbers formatted as text — leading zeros, thousands separators — never match their numeric twins. Clean the key column first.</p>
            <p>· Quoted fields containing the delimiter are handled here, but spreadsheets often export malformed CSV. Check the preview before trusting the join.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Which join to use</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Join</th><th className="py-1 pr-2 text-left">Keeps</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Inner</td><td className="py-1 pr-2">Only rows present in both tables</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Left</td><td className="py-1 pr-2">All of A, blanks where B has nothing</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Right</td><td className="py-1 pr-2">All of B, blanks where A has nothing</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Full</td><td className="py-1 pr-2">Everything, matched where possible</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Use a left join when the left table defines the population you care about, and an inner join when you only want rows with complete data on both sides.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Parsing handles quoted fields, embedded delimiters and escaped quotes, and every join is computed in your browser with nothing sent anywhere. Extremely malformed exports, mixed line endings and
          multi-line cells inside quotes are the usual causes of an unexpected result — check the diagnostics before relying on the output.
        </p>
      </Panel>
    </ToolShell>
  );
}