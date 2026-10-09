import React, { useState, useRef, useEffect } from 'react';
import { Database, Play, Table2, Trash2, Loader2, KeyRound } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Full SQL playground backed by sql.js (SQLite compiled to WebAssembly).
// Supports the entire SQLite SQL dialect: JOINs, GROUP BY, subqueries,
// UPDATE, DELETE, ALTER, indexes, transactions, etc.

let sqlJsPromise = null;
async function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const mod = await import(/* @vite-ignore */ 'https://esm.sh/sql.js@1.10.3/dist/sql-wasm.js');
      const init = mod.default || mod.initSqlJs || mod;
      const SQL = await init({ locateFile: (f) => `https://esm.sh/sql.js@1.10.3/dist/${f}` });
      return SQL;
    })();
  }
  return sqlJsPromise;
}

const SAMPLE = `-- Full SQL playground — powered by SQLite (WASM)
CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, grade TEXT, dept_id INTEGER);
CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT);

INSERT INTO departments VALUES (1, 'Computer Science'), (2, 'Mathematics'), (3, 'Physics');
INSERT INTO students VALUES
  (1, 'Alice', 20, 'A', 1),
  (2, 'Bob',   22, 'B', 1),
  (3, 'Carol', 19, 'A', 2),
  (4, 'Dave',  21, 'C', 2),
  (5, 'Eve',   23, 'B', 3),
  (6, 'Frank', 20, 'A', 3);

-- JOIN: students with their department names
SELECT s.name, s.age, s.grade, d.name AS department
FROM students s
JOIN departments d ON s.dept_id = d.id
WHERE s.age > 19
ORDER BY s.age DESC;

-- GROUP BY with aggregates
SELECT d.name AS department, COUNT(*) AS students, AVG(s.age) AS avg_age
FROM students s JOIN departments d ON s.dept_id = d.id
GROUP BY d.name
ORDER BY students DESC;`;

export default function DatabasesLab() {
  const [sql, setSql] = useState(SAMPLE);
  const [results, setResults] = useState([]); // array of { columns, rows, affected }
  const [schema, setSchema] = useState([]); // array of { name, columns, rowCount, pk }
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const dbRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const SQL = await getSqlJs();
        dbRef.current = new SQL.Database();
        setReady(true);
        // auto-run sample on first load so the user sees results immediately
        runAll(SAMPLE);
      } catch (e) {
        setError('Failed to load SQLite engine: ' + (e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const refreshSchema = () => {
    const db = dbRef.current;
    if (!db) return;
    try {
      const res = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      );
      const tableNames = res[0]?.values.map((r) => r[0]) || [];
      const out = tableNames.map((name) => {
        const info = db.exec(`PRAGMA table_info("${name}")`)[0];
        const cols = info.values.map((r) => ({ name: r[1], type: r[2], pk: r[5] > 0 }));
        const countRes = db.exec(`SELECT COUNT(*) FROM "${name}"`);
        const rowCount = countRes[0]?.values[0][0] || 0;
        return { name, columns: cols, rowCount };
      });
      setSchema(out);
    } catch { /* ignore schema errors */ }
  };

  const runAll = (script) => {
    const db = dbRef.current;
    if (!db) return;
    setError('');
    setResults([]);
    try {
      db.run('BEGIN');
      const stmts = splitStatements(script);
      const out = [];
      for (const stmt of stmts) {
        const stripped = stmt.replace(/--[^\n]*/g, '').trim();
        if (!stripped) continue;
        const upper = stripped.toUpperCase();
        if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA') || upper.startsWith('WITH') || upper.startsWith('EXPLAIN')) {
          const r = db.exec(stripped);
          if (r.length > 0) {
            out.push({ columns: r[0].columns, rows: r[0].values, isSelect: true });
          } else {
            out.push({ columns: [], rows: [], isSelect: true, empty: true });
          }
        } else {
          db.run(stripped);
          const changes = db.getRowsModified();
          out.push({ affected: changes, statement: stripped.slice(0, 60) });
        }
      }
      db.run('COMMIT');
      setResults(out);
      refreshSchema();
    } catch (e) {
      try { db.run('ROLLBACK'); } catch { /* ignore */ }
      setError(e?.message || String(e));
      refreshSchema();
    }
  };

  const run = () => runAll(sql);

  const reset = async () => {
    if (dbRef.current) dbRef.current.close();
    const SQL = await getSqlJs();
    dbRef.current = new SQL.Database();
    setResults([]);
    setError('');
    setSchema([]);
  };

  const loadSample = () => {
    setSql(SAMPLE);
    reset().then(() => runAll(SAMPLE));
  };

  return (
    <LabShell icon={Database} title="Databases" description="Full SQL playground powered by SQLite (WASM) — JOINs, GROUP BY, subqueries, UPDATE, DELETE, indexes, and more.">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Editor + schema */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button onClick={run} disabled={!ready || loading}
              className="flex items-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90 disabled:opacity-50">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Execute
            </button>
            <button onClick={loadSample} disabled={!ready}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-cyan-j/40 disabled:opacity-50">Load Sample</button>
            <button onClick={reset} disabled={!ready}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-cyan-j/40 disabled:opacity-50"><Trash2 className="size-3.5" /> Reset DB</button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {ready ? <span className="text-emerald-400">● SQLite ready</span> : <span className="text-amber-400">● loading engine…</span>}
            </span>
          </div>
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false}
            className="h-80 resize-none rounded-lg border border-border bg-card p-3 font-mono-j text-xs leading-relaxed scrollbar-thin focus:border-cyan-j focus:outline-none" />
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <span className="font-semibold">Error: </span>{error}
            </div>
          )}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
              <Table2 className="size-3" /> SCHEMA
            </div>
            {schema.length === 0 ? <div className="text-xs text-muted-foreground">No tables yet.</div> :
              <div className="space-y-2">
                {schema.map((t) => (
                  <div key={t.name}>
                    <div className="flex items-center gap-1.5 font-mono-j text-[11px]">
                      <span className="text-cyan-j font-semibold">{t.name}</span>
                      <span className="text-muted-foreground">{t.rowCount} rows</span>
                    </div>
                    <div className="ml-3 flex flex-wrap gap-x-3 gap-y-0.5 font-mono-j text-[10px] text-muted-foreground">
                      {t.columns.map((c) => (
                        <span key={c.name}>
                          {c.pk && <KeyRound className="mr-0.5 inline size-2.5 text-amber-400" />}
                          {c.name}<span className="text-muted-foreground/60"> {c.type || 'ANY'}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>}
          </div>
        </div>

        {/* Results */}
        <div className="flex flex-col gap-3">
          <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card scrollbar-thin">
            <div className="sticky top-0 border-b border-border bg-card/80 px-3 py-2 text-xs font-semibold backdrop-blur">Query Results</div>
            {!ready ? (
              <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin text-cyan-j" /> Loading SQLite engine…
              </div>
            ) : results.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">Run a query to see results.</div>
            ) : (
              <div className="divide-y divide-border">
                {results.map((r, i) => (
                  <ResultBlock key={i} result={r} index={i + 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function ResultBlock({ result, index }) {
  if (result.isSelect) {
    if (result.empty || result.rows.length === 0) {
      return (
        <div className="px-3 py-3 text-xs">
          <div className="mb-1 text-[10px] font-semibold text-muted-foreground">Query {index}</div>
          <div className="text-muted-foreground">Empty result set (0 rows)</div>
        </div>
      );
    }
    return (
      <div className="px-3 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground">Query {index}</span>
          <span className="text-[10px] text-muted-foreground">{result.rows.length} row(s)</span>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {result.columns.map((c) => (
                  <th key={c} className="px-2.5 py-1.5 text-left font-mono-j font-semibold text-cyan-j whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-border/40 odd:bg-muted/10">
                  {row.map((v, j) => (
                    <td key={j} className="px-2.5 py-1.5 font-mono-j whitespace-nowrap">
                      {v === null ? <span className="text-muted-foreground italic">NULL</span> :
                       typeof v === 'number' ? <span className="text-amber-300/90">{v}</span> :
                       <span>{String(v)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  // Non-SELECT statement
  return (
    <div className="px-3 py-2.5 text-xs">
      <span className="text-[10px] font-semibold text-muted-foreground">Statement {index} </span>
      <span className="font-mono-j text-foreground/70">{result.statement}{result.statement.length >= 60 ? '…' : ''}</span>
      <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
        {result.affected} row(s) affected
      </span>
    </div>
  );
}

// Split SQL into statements on semicolons, respecting string literals.
function splitStatements(sql) {
  const out = [];
  let cur = '';
  let inSingle = false, inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; cur += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; cur += ch; continue; }
    if (ch === ';' && !inSingle && !inDouble) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}