import { useEffect, useState } from 'react';

/**
 * Table export.
 *
 * Every table-based tool already renders a real <table>, so the rows the user is
 * looking at *are* the data. This reads them out of the rendered tool — headers
 * become the column names — which means any tool with a table gets CSV and JSON
 * without a single line of per-tool wiring.
 */

const MAX_ROWS = 5000;

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const uniqueKeys = (keys) => {
  const seen = new Map();
  return keys.map((key, index) => {
    const base = key || `column ${index + 1}`;
    const used = seen.get(base) || 0;
    seen.set(base, used + 1);
    return used ? `${base} (${used + 1})` : base;
  });
};

const rowsFor = (table) => {
  const headRow = table.querySelector('thead tr') || table.querySelector('tr');
  const keys = uniqueKeys(Array.from(headRow?.children || []).map((cell) => clean(cell.textContent)));

  let body = Array.from(table.querySelectorAll('tbody tr'));
  if (!body.length) body = Array.from(table.querySelectorAll('tr')).slice(1);

  return body
    .slice(0, MAX_ROWS)
    .map((tr) => Array.from(tr.children).reduce((row, cell, index) => {
      row[keys[index] || `column ${index + 1}`] = clean(cell.textContent);
      return row;
    }, {}))
    .filter((row) => Object.keys(row).length && Object.values(row).some((value) => value !== ''));
};

export function findTables(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll('table'))
    .map((table) => ({ rows: rowsFor(table) }))
    .filter((entry) => entry.rows.length);
}

/** The biggest table on screen — what someone means by “export this”. */
export function largestRows(root) {
  const tables = findTables(root);
  if (!tables.length) return null;
  return tables.reduce((best, entry) => (entry.rows.length > best.rows.length ? entry : best), tables[0]);
}

const escapeCsv = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(',')),
  ].join('\n');
}

const coerce = (value) => {
  const text = String(value ?? '').trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
};

export function rowsToJson(rows) {
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, coerce(value)]))),
    null,
    2,
  );
}

/** True once the enclosing tool has rendered a table with rows in it. */
export function useTablePresence(ref) {
  const [present, setPresent] = useState(false);

  useEffect(() => {
    const root = ref.current?.closest('.tk-frame, .tk-shell') || ref.current?.parentElement;
    if (!root) return undefined;

    let signature = '';
    const check = () => {
      const tables = root.querySelectorAll('table');
      let next = String(tables.length);
      tables.forEach((table) => { next += `|${table.querySelectorAll('tr').length}`; });
      if (next === signature) return;
      signature = next;
      setPresent(findTables(root).length > 0);
    };

    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref]);

  return present;
}