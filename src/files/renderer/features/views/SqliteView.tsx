import React, { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { Button, Loading } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import type { SqliteTable, SqliteQueryResult, SqliteSchemaResult } from '../../../shared/sqlite';

/**
 * SQLite database viewer.
 * Shows a table list sidebar, a data grid, a SQL query editor and export tools.
 */

const PAGE_SIZE = 100;

type SortDir = 'ASC' | 'DESC';

export function SqliteViewer({ path: dbPath }: { path: string }) {
  const [tables, setTables] = useState<SqliteTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'data' | 'schema' | 'query'>('data');

  useEffect(() => {
    call<SqliteTable[]>('sqlite:open', { path: dbPath })
      .then(setTables)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [dbPath]);

  if (error) return <div className="sqlite-viewer"><div className="sqlite-error"><Icon name="warning" size={20} /><p>{error}</p></div></div>;
  if (!tables) return <div className="sqlite-viewer"><Loading label="Opening database..." /></div>;

  return (
    <div className="sqlite-viewer">
      <div className="sqlite-sidebar">
        <div className="sqlite-sidebar-header">
          <Icon name="database" size={14} />
          <span className="sqlite-sidebar-title">Tables</span>
        </div>
        <div className="sqlite-table-list">
          {tables.map((t) => (
            <button
              key={t.name}
              type="button"
              className={`sqlite-table-item ${selected === t.name ? 'is-active' : ''}`}
              onClick={() => { setSelected(t.name); setTab('data'); }}
            >
              <Icon name={t.type === 'view' ? 'eye' : 'table'} size={13} />
              <span className="sqlite-table-name">{t.name}</span>
              <span className="sqlite-row-count">{t.rowCount.toLocaleString()}</span>
            </button>
          ))}
          {tables.length === 0 && <p className="muted pad">No tables found.</p>}
        </div>
      </div>
      <div className="sqlite-main">
        <div className="sqlite-tabs">
          <button type="button" className={`sqlite-tab ${tab === 'data' ? 'is-active' : ''}`} onClick={() => setTab('data')}>Data</button>
          <button type="button" className={`sqlite-tab ${tab === 'schema' ? 'is-active' : ''}`} onClick={() => setTab('schema')}>Schema</button>
          <button type="button" className={`sqlite-tab ${tab === 'query' ? 'is-active' : ''}`} onClick={() => setTab('query')}>Query</button>
        </div>
        {tab === 'data' && selected && <TableData dbPath={dbPath} table={selected} />}
        {tab === 'schema' && selected && <SchemaView dbPath={dbPath} table={selected} />}
        {tab === 'query' && <QueryEditor dbPath={dbPath} />}
        {!selected && tab !== 'query' && <div className="sqlite-empty"><p className="muted">Select a table from the sidebar.</p></div>}
      </div>
    </div>
  );
}

function TableData({ dbPath, table }: { dbPath: string; table: string }) {
  const [result, setResult] = useState<SqliteQueryResult | null>(null);
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('ASC');
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(async (pg: number, col: string | null, dir: SortDir) => {
    setLoading(true);
    try {
      const esc = table.replace(/"/g, '""');
      const orderClause = col ? ` ORDER BY "${col.replace(/"/g, '""')}" ${dir}` : '';
      const sql = `SELECT * FROM "${esc}"${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${pg * PAGE_SIZE}`;
      const r = await call<SqliteQueryResult>('sqlite:query', { path: dbPath, sql });
      // Get total count
      const countR = await call<SqliteQueryResult>('sqlite:query', { path: dbPath, sql: `SELECT COUNT(*) FROM "${esc}"` });
      r.totalRows = Number(countR.rows[0]?.[0] ?? -1);
      setResult(r);
    } catch (err) {
      toastError(err, 'Query failed');
    }
    setLoading(false);
  }, [dbPath, table]);

  useEffect(() => {
    setPage(0); setSortCol(null); setSortDir('ASC');
    void fetchPage(0, null, 'ASC');
  }, [dbPath, table, fetchPage]);

  const handleSort = (col: string) => {
    const newDir: SortDir = sortCol === col && sortDir === 'ASC' ? 'DESC' : 'ASC';
    setSortCol(col); setSortDir(newDir); setPage(0);
    void fetchPage(0, col, newDir);
  };

  const handlePage = (pg: number) => { setPage(pg); void fetchPage(pg, sortCol, sortDir); };

  if (!result && loading) return <Loading label="Loading rows..." />;
  if (!result) return null;

  const totalPages = result.totalRows >= 0 ? Math.ceil(result.totalRows / PAGE_SIZE) : -1;

  return (
    <div className="sqlite-data">
      <div className="sqlite-data-toolbar">
        <span className="muted tabular">
          {result.totalRows >= 0 ? `${result.totalRows.toLocaleString()} rows` : `${result.rowCount} rows`}
          {totalPages > 1 && ` · Page ${page + 1} of ${totalPages}`}
        </span>
        <ExportButton result={result} tableName={table} />
      </div>
      <div className="sqlite-grid-wrap">
        <table className="sqlite-grid">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th key={col.name} onClick={() => handleSort(col.name)} className="sqlite-th">
                  <span>{col.name}</span>
                  {sortCol === col.name && <Icon name={sortDir === 'ASC' ? 'arrowUp' : 'arrowDown'} size={12} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="sqlite-td">{formatCell(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="sqlite-pager">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => handlePage(page - 1)}>Previous</Button>
          <span className="muted tabular">Page {page + 1} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => handlePage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function SchemaView({ dbPath, table }: { dbPath: string; table: string }) {
  const [schema, setSchema] = useState<SqliteSchemaResult | null>(null);

  useEffect(() => {
    call<SqliteSchemaResult>('sqlite:schema', { path: dbPath, table }).then(setSchema).catch((err) => toastError(err, 'Failed to load schema'));
  }, [dbPath, table]);

  if (!schema) return <Loading label="Loading schema..." />;

  return (
    <div className="sqlite-schema">
      <h3>Columns</h3>
      <table className="sqlite-grid">
        <thead>
          <tr>
            <th className="sqlite-th">Name</th>
            <th className="sqlite-th">Type</th>
            <th className="sqlite-th">NOT NULL</th>
            <th className="sqlite-th">Default</th>
            <th className="sqlite-th">PK</th>
          </tr>
        </thead>
        <tbody>
          {schema.columns.map((col) => (
            <tr key={col.cid}>
              <td className="sqlite-td">{col.name}</td>
              <td className="sqlite-td mono">{col.type || 'ANY'}</td>
              <td className="sqlite-td">{col.notnull ? 'Yes' : ''}</td>
              <td className="sqlite-td mono">{col.dfltValue != null ? String(col.dfltValue) : ''}</td>
              <td className="sqlite-td">{col.pk ? 'Yes' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>DDL</h3>
      <pre className="sqlite-ddl">{schema.ddl}</pre>
    </div>
  );
}

function QueryEditor({ dbPath }: { dbPath: string }) {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<SqliteQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const run = async () => {
    if (!sql.trim()) return;
    setRunning(true); setError(null);
    try {
      const r = await call<SqliteQueryResult>('sqlite:query', { path: dbPath, sql: sql.trim() });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    }
    setRunning(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); }
  };

  return (
    <div className="sqlite-query">
      <div className="sqlite-query-editor">
        <textarea
          ref={textRef}
          className="sqlite-query-input"
          placeholder="SELECT * FROM ..."
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <div className="sqlite-query-actions">
          <Button variant="primary" size="sm" onClick={() => void run()} disabled={running || !sql.trim()}>
            {running ? 'Running...' : 'Run'}
          </Button>
          <span className="muted">Ctrl+Enter to run</span>
        </div>
      </div>
      {error && <div className="sqlite-query-error"><Icon name="warning" size={14} /><span>{error}</span></div>}
      {result && (
        <div className="sqlite-data">
          <div className="sqlite-data-toolbar">
            <span className="muted tabular">{result.rowCount} row{result.rowCount !== 1 ? 's' : ''} in {result.elapsedMs} ms</span>
            <ExportButton result={result} tableName="query_result" />
          </div>
          <div className="sqlite-grid-wrap">
            <table className="sqlite-grid">
              <thead>
                <tr>{result.columns.map((c) => <th key={c.name} className="sqlite-th">{c.name}</th>)}</tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j} className="sqlite-td">{formatCell(cell)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportButton({ result, tableName }: { result: SqliteQueryResult; tableName: string }) {
  const [open, setOpen] = useState(false);

  const copyAs = (format: 'csv' | 'json' | 'sql') => {
    let text = '';
    if (format === 'csv') {
      const header = result.columns.map((c) => csvEscape(c.name)).join(',');
      const rows = result.rows.map((row) => row.map((c) => csvEscape(formatCell(c))).join(','));
      text = [header, ...rows].join('\n');
    } else if (format === 'json') {
      const objs = result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        result.columns.forEach((col, i) => { obj[col.name] = row[i]; });
        return obj;
      });
      text = JSON.stringify(objs, null, 2);
    } else {
      const esc = tableName.replace(/"/g, '""');
      text = result.rows.map((row) => {
        const vals = row.map((v) => {
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(', ');
        return `INSERT INTO "${esc}" (${result.columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(', ')}) VALUES (${vals});`;
      }).join('\n');
    }
    void call('fs:copyText', { text });
    toast({ level: 'success', title: `Copied ${result.rowCount} rows as ${format.toUpperCase()}` });
    setOpen(false);
  };

  return (
    <div className="sqlite-export" style={{ position: 'relative' }}>
      <Button variant="ghost" size="sm" icon="copy" onClick={() => setOpen(!open)}>Export</Button>
      {open && (
        <div className="sqlite-export-menu">
          <button type="button" onClick={() => copyAs('csv')}>Copy as CSV</button>
          <button type="button" onClick={() => copyAs('json')}>Copy as JSON</button>
          <button type="button" onClick={() => copyAs('sql')}>Copy as SQL INSERT</button>
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Uint8Array) return `[BLOB ${v.length} bytes]`;
  return String(v);
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
