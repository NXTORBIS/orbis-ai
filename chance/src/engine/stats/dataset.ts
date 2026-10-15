/**
 * Dataset import and cleaning for the Data Lab.
 *
 * Imported files are untrusted input. Parsing is strict about structure and
 * never evaluates content. Every row that is dropped or coerced is counted and
 * reported, so nothing is discarded silently.
 */
import { EngineError, type Issue } from '../core/result';

export type ColumnType = 'numeric' | 'categorical' | 'empty';

export interface Column {
  name: string;
  type: ColumnType;
  /** Numeric values with missing entries recorded as NaN. */
  values: Float64Array;
  /** Raw text of every cell, kept for categorical columns and previews. */
  raw: string[];
  missing: number;
  /** Values that looked numeric but could not be parsed. */
  invalid: number;
  /** Distinct raw values, for categorical columns (capped). */
  categories: string[] | null;
}

export interface Dataset {
  name: string;
  columns: Column[];
  rowCount: number;
  /** Rows skipped because their field count did not match the header. */
  malformedRows: { line: number; reason: string }[];
  duplicateRowCount: number;
  delimiter: string;
  notes: string[];
}

export const DATA_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxRows: 500_000,
  maxColumns: 200,
  maxCategories: 1000,
  previewRows: 50,
};

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'nil', 'none', '-', '--', '?', '.']);

/** Detect the most likely delimiter from the first few lines. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (!lines.length) return ',';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const first = counts[0];
    if (first < 2) continue;
    // Prefer the delimiter giving a consistent field count above 1.
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 10 + Math.min(first, 50) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Split one CSV line, honouring double-quoted fields and escaped quotes. */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
    } else if (c === delimiter) {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function parseNumeric(text: string): number {
  const t = text.trim();
  if (!t || MISSING_TOKENS.has(t.toLowerCase())) return NaN;
  // Accept thousands separators, a trailing/leading percent and currency symbols,
  // and parenthesised negatives, which are all common in exported spreadsheets.
  let s = t.replace(/\s/g, '').replace(/\u00a0/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/^[£$€¥]/, '').replace(/,(?=\d{3}\b)/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return NaN;
  let v = parseFloat(s);
  if (percent) v /= 100;
  if (negative) v = -v;
  return v;
}

/** True when the text is a recognised "missing" marker rather than a bad number. */
function isMissingToken(text: string): boolean {
  return MISSING_TOKENS.has(text.trim().toLowerCase());
}

export interface ParseOptions {
  name?: string;
  delimiter?: string;
  /** Treat the first row as a header (detected automatically when omitted). */
  hasHeader?: boolean;
  /** Drop rows that are exact duplicates of an earlier row. */
  dropDuplicates?: boolean;
}

export function parseCsv(text: string, options: ParseOptions = {}): Dataset {
  if (typeof text !== 'string') throw new EngineError('The file could not be read as text.', 'format');
  if (text.length > DATA_LIMITS.maxBytes) {
    throw new EngineError(
      `The file is larger than the supported limit of ${(DATA_LIMITS.maxBytes / (1024 * 1024)).toFixed(0)} MB. Split it or reduce the number of rows.`,
      'limit',
    );
  }
  // Strip a UTF-8 byte-order mark.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rawLines = body.split(/\r?\n/);
  const delimiter = options.delimiter ?? detectDelimiter(body);
  const notes: string[] = [];
  const malformedRows: { line: number; reason: string }[] = [];

  // Find the first non-empty line for the header.
  let start = 0;
  while (start < rawLines.length && !rawLines[start].trim()) start++;
  if (start >= rawLines.length) throw new EngineError('The file contains no data.', 'empty');

  const firstFields = splitLine(rawLines[start], delimiter);
  const hasHeader = options.hasHeader ?? firstFields.some((f) => f !== '' && Number.isNaN(parseNumeric(f)));
  const headerNames = hasHeader
    ? firstFields.map((f, i) => (f ? f : `Column ${i + 1}`))
    : firstFields.map((_, i) => `Column ${i + 1}`);
  if (!hasHeader) notes.push('No header row was detected, so columns are named by position.');
  const uniqueNames = dedupeNames(headerNames);
  if (uniqueNames.some((n, i) => n !== headerNames[i])) notes.push('Duplicate column names were made unique by adding a suffix.');
  if (uniqueNames.length > DATA_LIMITS.maxColumns) {
    throw new EngineError(`The file has ${uniqueNames.length} columns; at most ${DATA_LIMITS.maxColumns} are supported.`, 'limit');
  }

  const rows: string[][] = [];
  const seen = options.dropDuplicates ? new Set<string>() : null;
  let duplicateRowCount = 0;
  for (let i = hasHeader ? start + 1 : start; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim()) continue;
    const fields = splitLine(line, delimiter);
    if (fields.length !== uniqueNames.length) {
      if (malformedRows.length < 100) {
        malformedRows.push({
          line: i + 1,
          reason: `Found ${fields.length} field(s) but the header has ${uniqueNames.length}.`,
        });
      }
      continue;
    }
    if (seen) {
      const key = fields.join('\u0001');
      if (seen.has(key)) {
        duplicateRowCount++;
        continue;
      }
      seen.add(key);
    }
    rows.push(fields);
    if (rows.length >= DATA_LIMITS.maxRows) {
      notes.push(`Only the first ${DATA_LIMITS.maxRows.toLocaleString('en-US')} data rows were read; the rest of the file was not loaded.`);
      break;
    }
  }
  if (!rows.length) {
    throw new EngineError(
      malformedRows.length
        ? `No usable data rows were found. ${malformedRows.length} row(s) had a field count that did not match the header — check the delimiter (currently "${delimiter === '\t' ? 'tab' : delimiter}").`
        : 'The file has a header but no data rows.',
      'empty',
    );
  }
  if (malformedRows.length) {
    notes.push(
      `${malformedRows.length}${malformedRows.length >= 100 ? '+' : ''} row(s) were skipped because their field count did not match the header. The first is line ${malformedRows[0].line}.`,
    );
  }
  if (duplicateRowCount) notes.push(`${duplicateRowCount.toLocaleString('en-US')} duplicate row(s) were removed at your request.`);

  const columns: Column[] = uniqueNames.map((name, c) => {
    const raw = rows.map((r) => r[c]);
    const values = new Float64Array(raw.length);
    let missing = 0;
    let invalid = 0;
    let numericCount = 0;
    for (let i = 0; i < raw.length; i++) {
      const cell = raw[i];
      if (isMissingToken(cell)) {
        values[i] = NaN;
        missing++;
        continue;
      }
      const v = parseNumeric(cell);
      if (Number.isNaN(v)) {
        values[i] = NaN;
        invalid++;
      } else {
        values[i] = v;
        numericCount++;
      }
    }
    const nonMissing = raw.length - missing;
    // A column is numeric when (nearly) every non-missing cell parsed as a number.
    const type: ColumnType = nonMissing === 0 ? 'empty' : numericCount / nonMissing >= 0.95 ? 'numeric' : 'categorical';
    let categories: string[] | null = null;
    if (type === 'categorical') {
      const set = new Set<string>();
      for (const cell of raw) {
        if (!isMissingToken(cell)) set.add(cell);
        if (set.size > DATA_LIMITS.maxCategories) break;
      }
      categories = set.size > DATA_LIMITS.maxCategories ? null : [...set].sort();
    }
    return { name, type, values, raw, missing, invalid, categories };
  });

  for (const col of columns) {
    if (col.type === 'numeric' && col.invalid > 0) {
      notes.push(
        `Column "${col.name}" is treated as numeric, but ${col.invalid} value(s) could not be read as numbers and are recorded as missing. They are listed in the data preview.`,
      );
    }
    if (col.type === 'empty') notes.push(`Column "${col.name}" has no values and is excluded from analysis.`);
    if (col.type === 'categorical' && col.categories === null) {
      notes.push(`Column "${col.name}" has more than ${DATA_LIMITS.maxCategories.toLocaleString('en-US')} distinct values, so its category list is not shown.`);
    }
  }

  return {
    name: options.name ?? 'Imported data',
    columns,
    rowCount: rows.length,
    malformedRows,
    duplicateRowCount,
    delimiter,
    notes,
  };
}

/** Parse a JSON array of flat objects, or an object of arrays. */
export function parseJsonDataset(text: string, options: ParseOptions = {}): Dataset {
  if (text.length > DATA_LIMITS.maxBytes) {
    throw new EngineError(`The file exceeds the ${(DATA_LIMITS.maxBytes / (1024 * 1024)).toFixed(0)} MB limit.`, 'limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new EngineError(`The file is not valid JSON: ${(e as Error).message}`, 'format');
  }
  let records: Record<string, unknown>[];
  let truncatedFrom = 0;
  if (Array.isArray(parsed)) {
    if (!parsed.length) throw new EngineError('The JSON array is empty.', 'empty');
    if (parsed.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
      records = parsed as Record<string, unknown>[];
    } else if (parsed.every((v) => typeof v === 'number' || typeof v === 'string' || v === null)) {
      records = parsed.map((v) => ({ value: v }));
    } else {
      throw new EngineError('The JSON array must contain either objects with the same fields, or plain numbers.', 'format');
    }
  } else if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
    if (!keys.length) throw new EngineError('The JSON object contains no arrays to read as columns.', 'format');
    const declared = Math.max(...keys.map((k) => (obj[k] as unknown[]).length));
    // Apply the row limit *before* building the records. Materialising every
    // record first and slicing afterwards allocates hundreds of megabytes and
    // freezes the tab for a file that is still inside the byte limit.
    const length = Math.min(declared, DATA_LIMITS.maxRows);
    records = Array.from({ length }, (_, i) => Object.fromEntries(keys.map((k) => [k, (obj[k] as unknown[])[i]])));
    if (declared > length) truncatedFrom = declared;
  } else {
    throw new EngineError('The JSON must be an array of records or an object of arrays.', 'format');
  }
  if (records.length > DATA_LIMITS.maxRows) {
    truncatedFrom = records.length;
    records = records.slice(0, DATA_LIMITS.maxRows);
  }
  // Convert to CSV-like rows and reuse the column typing logic.
  const names = dedupeNames([...new Set(records.flatMap((r) => Object.keys(r)))]);
  if (!names.length) throw new EngineError('No fields were found in the JSON records.', 'empty');
  const header = names.join(JSON_FIELD_SEPARATOR);
  const lines = [header, ...records.map((r) => names.map((n) => stringifyCell(r[n])).join(JSON_FIELD_SEPARATOR))];
  const ds = parseCsv(lines.join('\n'), { ...options, delimiter: JSON_FIELD_SEPARATOR, hasHeader: true });
  const notes = [...ds.notes, 'Imported from JSON. Nested values were not flattened and appear as text.'];
  if (truncatedFrom) {
    notes.push(
      `The file contains ${truncatedFrom.toLocaleString('en-US')} records; only the first ${DATA_LIMITS.maxRows.toLocaleString('en-US')} were read.`,
    );
  }
  return { ...ds, delimiter: 'JSON', notes };
}

/**
 * Field separator used when funnelling JSON records through the CSV column
 * typing logic. U+0001 cannot occur in a JSON string value that has been
 * through `stringifyCell`, which strips it.
 */
const JSON_FIELD_SEPARATOR = '\u0001';

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'string') return sanitiseCell(v);
  return sanitiseCell(JSON.stringify(v));
}

/** Remove the separator and line breaks so one record stays on one line. */
function sanitiseCell(text: string): string {
  let out = '';
  for (const ch of text) out += ch === JSON_FIELD_SEPARATOR || ch === '\n' || ch === '\r' ? ' ' : ch;
  return out;
}

function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = n || 'Column';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

export type MissingPolicy = 'exclude' | 'zero' | 'mean';

/** Numeric values of a column with the chosen missing-value policy applied. */
export function cleanColumn(col: Column, policy: MissingPolicy = 'exclude'): { values: Float64Array; removed: number; note: string } {
  if (col.type !== 'numeric') {
    throw new EngineError(`Column "${col.name}" is not numeric, so it cannot be analysed as numbers.`, 'type');
  }
  const missingCount = col.missing + col.invalid;
  if (missingCount === 0) return { values: col.values, removed: 0, note: 'No missing values.' };
  switch (policy) {
    case 'exclude': {
      const out = col.values.filter((v) => Number.isFinite(v));
      return {
        values: out,
        removed: missingCount,
        note: `${missingCount.toLocaleString('en-US')} missing or unreadable value(s) were excluded, leaving ${out.length.toLocaleString('en-US')} observation(s).`,
      };
    }
    case 'zero': {
      const out = Float64Array.from(col.values, (v) => (Number.isFinite(v) ? v : 0));
      return {
        values: out,
        removed: 0,
        note: `${missingCount.toLocaleString('en-US')} missing value(s) were replaced with 0. This changes the mean and variance; use it only when 0 is genuinely the right value for a missing entry.`,
      };
    }
    case 'mean': {
      const finite = col.values.filter((v) => Number.isFinite(v));
      if (!finite.length) throw new EngineError(`Column "${col.name}" has no usable values to compute a mean from.`, 'empty');
      let s = 0;
      for (const v of finite) s += v;
      const m = s / finite.length;
      const out = Float64Array.from(col.values, (v) => (Number.isFinite(v) ? v : m));
      return {
        values: out,
        removed: 0,
        note: `${missingCount.toLocaleString('en-US')} missing value(s) were replaced with the mean of the observed values (${m.toPrecision(6)}). This keeps the mean unchanged but makes the variance smaller than it should be, so intervals computed from it are too narrow.`,
      };
    }
  }
}

/** Paired numeric values from two columns, dropping rows missing either value. */
export function pairedValues(a: Column, b: Column): { x: Float64Array; y: Float64Array; dropped: number } {
  if (a.type !== 'numeric' || b.type !== 'numeric') {
    throw new EngineError('Both columns must be numeric to compare them as numbers.', 'type');
  }
  const n = Math.min(a.values.length, b.values.length);
  const x: number[] = [];
  const y: number[] = [];
  let dropped = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(a.values[i]) && Number.isFinite(b.values[i])) {
      x.push(a.values[i]);
      y.push(b.values[i]);
    } else dropped++;
  }
  return { x: Float64Array.from(x), y: Float64Array.from(y), dropped };
}

/** Split a numeric column into groups defined by a categorical column. */
export function groupBy(value: Column, group: Column): { label: string; values: Float64Array }[] {
  if (value.type !== 'numeric') throw new EngineError(`Column "${value.name}" must be numeric.`, 'type');
  const map = new Map<string, number[]>();
  const n = Math.min(value.values.length, group.raw.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(value.values[i])) continue;
    const key = group.raw[i].trim() || '(missing)';
    const arr = map.get(key);
    if (arr) arr.push(value.values[i]);
    else map.set(key, [value.values[i]]);
    if (map.size > DATA_LIMITS.maxCategories) {
      throw new EngineError(
        `Column "${group.name}" has more than ${DATA_LIMITS.maxCategories.toLocaleString('en-US')} distinct values, which is too many to group by.`,
        'limit',
      );
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, values]) => ({ label, values: Float64Array.from(values) }));
}

export function validateDatasetForAnalysis(ds: Dataset): Issue[] {
  const issues: Issue[] = [];
  if (!ds.columns.some((c) => c.type === 'numeric')) {
    issues.push({ code: 'type', message: 'No numeric column was found. Statistical analysis needs at least one column of numbers.' });
  }
  if (ds.rowCount < 2) issues.push({ code: 'insufficient', message: 'At least 2 rows are needed for statistical analysis.' });
  return issues;
}
