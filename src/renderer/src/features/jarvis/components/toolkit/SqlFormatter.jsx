import { useMemo, useState } from 'react';
import { Database } from 'lucide-react';
import { ToolHeader, Seg, Area, Out, CopyBtn, Panel, Field, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const MAJOR = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'FULL JOIN', 'JOIN', 'WITH', 'RETURNING'];
const KEYWORDS = [...MAJOR, 'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'ILIKE', 'BETWEEN', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'INNER', 'OUTER', 'EXISTS', 'ALL', 'ANY', 'CASCADE', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'DEFAULT', 'CHECK', 'OVER', 'PARTITION BY'];

const SAMPLE = "select u.id, u.name as full_name, count(o.id) as orders, sum(o.total) as revenue from users u left join orders o on o.user_id = u.id where u.created_at > '2024-01-01' and o.status <> 'cancelled' group by u.id, u.name order by revenue desc limit 25;";

function protectStrings(sql) {
  const store = [];
  const text = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => {
    store.push(m);
    return `\u0000${store.length - 1}\u0000`;
  });
  return { text, store };
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === separator && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

export default function SqlFormatter() {
  const [sql, setSql] = useState(SAMPLE);
  const [indent, setIndent] = useState(2);
  const [mode, setMode] = useState('pretty');

  const formatted = useMemo(() => {
    const { text, store } = protectStrings(sql);
    let out = text.replace(/\s+/g, ' ').trim();
    if (!out) return '';
    KEYWORDS.forEach((k) => {
      out = out.replace(new RegExp(`\\b${k.replace(/ /g, '\\s+')}\\b`, 'gi'), k);
    });
    if (mode === 'minify') return out.replace(/\s*([(),])\s*/g, '$1 ').replace(/\s+/g, ' ').trim();

    const pad = ' '.repeat(indent);
    MAJOR.slice().sort((a, b) => b.length - a.length).forEach((k) => {
      out = out.replace(new RegExp(`\\s+(?=${k.replace(/ /g, '\\s+')}\\b)`, 'g'), `\n${k}\n${pad}`);
    });
    out = out.replace(new RegExp(`\n${' '.repeat(indent)}\\n${pad}`, 'g'), `\n${pad}`);
    out = out.split('\n').map((line) => {
      const t = line.trim();
      if (!t) return '';
      if (t.toUpperCase() === t && MAJOR.includes(t)) return t;
      return `${pad}${t}`;
    }).filter(Boolean).join('\n');
    out = out.replace(/\s+(AND|OR)\s+/g, `\n${pad}$1 `);
    out = splitTopLevel(out, ',').join(`,\n${pad}`);
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.split('\n').map((l) => l.trimEnd()).join('\n');
  }, [sql, indent, mode]);

  const output = useMemo(() => {
    const { store } = protectStrings(sql);
    return formatted.replace(/\u0000(\d+)\u0000/g, (_, i) => store[Number(i)]);
  }, [formatted, sql]);

  const stats = useMemo(() => ({ lines: output.split('\n').length, clauses: MAJOR.filter((k) => output.includes(`\n${k}`)).length, chars: output.length }), [output]);

  return (
    <ToolShell
      toolId="sql-formatter"
      icon={Database}
      title="SQL Formatter"
      desc="Tidy messy queries: keywords, clause breaks and one condition per line."
      state={{ sql, indent, mode }}
      onRestore={(saved) => { setSql(saved.sql); setIndent(saved.indent ?? 2); setMode(saved.mode || 'pretty'); }}
      exportText={output}
      exportName={mode === 'minify' ? 'query.min.sql' : 'query.sql'}
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'pretty', label: 'Pretty print' }, { value: 'minify', label: 'Minify' }]} />
      <Area value={sql} onChange={setSql} rows={8} placeholder="Paste a SQL query…" />
      <Field label={`Indent · ${indent} spaces`}>
        <input type="range" min={2} max={6} value={indent} onChange={(e) => setIndent(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Out label="Formatted SQL" value={output}>
        <pre className="max-h-80 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{output || '—'}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Lines" value={String(stats.lines)} />
        <Stat label="Clauses broken out" value={String(stats.clauses)} />
        <Stat label="Characters" value={stats.chars.toLocaleString()} />
      </div>
      <Panel>
        <p className="text-xs text-muted-foreground">Strings, comments and quoted identifiers are left untouched, so your data values stay exactly as written.</p>
      </Panel>
    </ToolShell>
  );
}