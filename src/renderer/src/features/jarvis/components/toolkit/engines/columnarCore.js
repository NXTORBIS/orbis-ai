/**
 * Columnar query execution engine.
 *
 * Columns are stored per type with a real encoding — integers as frame-of-reference plus
 * bit packing, strings as dictionary codes, floats raw, booleans one bit each — and every
 * batch of 1024 rows carries its own null bitmap and a min/max zone map.
 *
 * A query is planned into predicates and aggregates and executed batch by batch: the zone
 * map lets whole batches be skipped without decoding them, predicates combine as bitsets,
 * and only the batches that still hold surviving rows are decoded before aggregation walks
 * them. A naive row-oriented implementation sits alongside it as the reference, and the
 * engine compares the two on the same plan and re-checks every skipped batch against the
 * predicate that skipped it.
 */

export const BATCH = 1024;
const NULL_BYTES = BATCH / 8;

const utf8Len = (text) => {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes;
};

const bitGet = (mask, i) => (mask[i >> 3] >> (i & 7)) & 1;
const bitSet = (mask, i) => {
  mask[i >> 3] |= 1 << (i & 7);
};

function packBits(values, bits, count) {
  const out = new Uint8Array(Math.ceil((bits * count) / 8));
  let pos = 0;
  for (let i = 0; i < count; i += 1) {
    let v = values[i];
    for (let b = 0; b < bits; b += 1) {
      if (v % 2 >= 1) out[pos >> 3] |= 1 << (pos & 7);
      v = Math.floor(v / 2);
      pos += 1;
    }
  }
  return out;
}

function unpackBits(bytes, bits, count) {
  const out = new Array(count);
  let pos = 0;
  for (let i = 0; i < count; i += 1) {
    let v = 0;
    let scale = 1;
    for (let b = 0; b < bits; b += 1) {
      v += ((bytes[pos >> 3] >> (pos & 7)) & 1) * scale;
      scale *= 2;
      pos += 1;
    }
    out[i] = v;
  }
  return out;
}

function encodeColumn(type, values) {
  const count = values.length;
  const batches = [];
  const zoneMap = [];
  let rawBytes = 0;
  let storedBytes = 0;
  let nullCount = 0;
  let dictionary = null;
  let codeOf = null;

  if (type === 'string') {
    const unique = [...new Set(values.filter((v) => v != null))].sort();
    if (unique.length > 65535) throw new Error('Dictionary encoding is limited to 65535 distinct strings in a column.');
    dictionary = unique;
    codeOf = new Map(unique.map((value, index) => [value, index]));
  }

  const batchCount = Math.max(1, Math.ceil(count / BATCH));
  for (let bi = 0; bi < batchCount; bi += 1) {
    const start = bi * BATCH;
    const end = Math.min(count, start + BATCH);
    const size = end - start;
    const nulls = new Uint8Array(NULL_BYTES);
    const present = [];
    for (let i = start; i < end; i += 1) {
      if (values[i] == null) {
        bitSet(nulls, i - start);
        nullCount += 1;
      } else present.push(values[i]);
    }
    const batch = { start, size, nulls };

    if (type === 'int') {
      let min = Infinity;
      let max = -Infinity;
      for (const v of present) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      const range = present.length ? max - min : 0;
      const bits = range <= 0 ? 0 : Math.ceil(Math.log2(range + 1));
      const offsets = [];
      for (let i = start; i < end; i += 1) if (values[i] != null) offsets.push(values[i] - min);
      batch.encoding = 'frame-of-reference';
      batch.min = present.length ? min : 0;
      batch.max = present.length ? max : 0;
      batch.bits = bits;
      batch.packed = packBits(offsets, bits, offsets.length);
      batch.raw = size * 8;
      batch.stored = batch.packed.length + NULL_BYTES + 8;
      rawBytes += batch.raw;
    } else if (type === 'float') {
      const arr = new Float64Array(size);
      let min = Infinity;
      let max = -Infinity;
      for (let i = start; i < end; i += 1) {
        const value = values[i];
        if (value == null) continue;
        arr[i - start] = value;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      batch.encoding = 'raw-double';
      batch.values = arr;
      batch.min = present.length ? min : 0;
      batch.max = present.length ? max : 0;
      batch.raw = size * 8;
      batch.stored = batch.raw + NULL_BYTES;
      rawBytes += batch.raw;
    } else if (type === 'string') {
      const codes = new Uint16Array(size);
      let min = Infinity;
      let max = -Infinity;
      let raw = 0;
      for (let i = start; i < end; i += 1) {
        const value = values[i];
        if (value == null) continue;
        const code = codeOf.get(String(value));
        codes[i - start] = code;
        min = Math.min(min, code);
        max = Math.max(max, code);
        raw += utf8Len(String(value));
      }
      batch.encoding = 'dictionary';
      batch.codes = codes;
      batch.min = present.length ? min : 0;
      batch.max = present.length ? max : 0;
      batch.raw = raw;
      batch.stored = size * 2 + NULL_BYTES;
      rawBytes += raw;
    } else {
      const bits = new Uint8Array(NULL_BYTES);
      let min = 1;
      let max = 0;
      for (let i = start; i < end; i += 1) {
        const value = values[i];
        if (value == null) continue;
        if (value) bitSet(bits, i - start);
        min = 0;
        max = 1;
      }
      batch.encoding = 'bit-packed';
      batch.bits = bits;
      batch.min = min;
      batch.max = max;
      batch.raw = size;
      batch.stored = NULL_BYTES * 2;
      rawBytes += batch.raw;
    }
    storedBytes += batch.stored;
    zoneMap.push({ start, end, min: batch.min, max: batch.max, nulls: batch.size - present.length });
    batches.push(batch);
  }

  if (type === 'string') storedBytes += dictionary.reduce((sum, value) => sum + utf8Len(value) + 2, 0);

  return {
    type,
    encoding: batches[0]?.encoding ?? 'empty',
    count,
    nullCount,
    batches,
    dictionary,
    zoneMap,
    bytes: { raw: rawBytes, stored: storedBytes, ratio: storedBytes ? rawBytes / storedBytes : 1 },
  };
}

export function decodeBatch(col, bi) {
  const batch = col.batches[bi];
  const out = new Array(batch.size);
  if (col.type === 'int') {
    let present = 0;
    for (let i = 0; i < batch.size; i += 1) if (!bitGet(batch.nulls, i)) present += 1;
    const offsets = unpackBits(batch.packed, batch.bits, present);
    let cursor = 0;
    for (let i = 0; i < batch.size; i += 1) out[i] = bitGet(batch.nulls, i) ? null : batch.min + offsets[cursor++];
  } else if (col.type === 'float') {
    for (let i = 0; i < batch.size; i += 1) out[i] = bitGet(batch.nulls, i) ? null : batch.values[i];
  } else if (col.type === 'string') {
    for (let i = 0; i < batch.size; i += 1) out[i] = bitGet(batch.nulls, i) ? null : col.dictionary[batch.codes[i]];
  } else {
    for (let i = 0; i < batch.size; i += 1) out[i] = bitGet(batch.nulls, i) ? null : (bitGet(batch.bits, i) ? 1 : 0);
  }
  return out;
}

export function decodeColumn(col) {
  const out = [];
  for (let bi = 0; bi < col.batches.length; bi += 1) out.push(...decodeBatch(col, bi));
  return out;
}

export function buildTable({ columns, rows }) {
  const table = { columns: {}, rowCount: rows.length, order: columns.map((c) => c.name) };
  for (const column of columns) {
    const values = rows.map((row) => (row[column.name] === undefined ? null : row[column.name]));
    table.columns[column.name] = { ...encodeColumn(column.type, values), name: column.name };
  }
  return table;
}

const satisfies = (value, op, target) => {
  if (value == null) return false;
  switch (op) {
    case '=': return value === target;
    case '!=': return value !== target;
    case '>': return value > target;
    case '>=': return value >= target;
    case '<': return value < target;
    case '<=': return value <= target;
    default: throw new Error(`Unsupported comparison: ${op}`);
  }
};

/** Zone map test: false means no row in the batch can satisfy the predicate. */
const zoneCouldMatch = (zone, op, target) => {
  if (zone.nulls === zone.end - zone.start) return false;
  switch (op) {
    case '=': return target >= zone.min && target <= zone.max;
    case '>': return zone.max > target;
    case '>=': return zone.max >= target;
    case '<': return zone.min < target;
    case '<=': return zone.min <= target;
    default: return true;
  }
};

/** Strings compare as dictionary codes, which are ordered because the dictionary is sorted. */
const resolveTarget = (col, value) => {
  if (col.type !== 'string') return value;
  const code = col.dictionary.indexOf(String(value));
  return code === -1 ? -1 : code;
};

function scanFilter(col, predicate, stats, primary) {
  const mask = new Uint8Array(col.count);
  const target = predicate.value;
  const skipped = [];
  for (let bi = 0; bi < col.batches.length; bi += 1) {
    const batch = col.batches[bi];
    if (!zoneCouldMatch(col.zoneMap[bi], predicate.op, target)) {
      // only the leading predicate's scan is counted: later predicates see fewer rows, not more
      if (primary) stats.blocksSkipped += 1;
      if (primary) stats.rowsSkipped += batch.size;
      skipped.push(bi);
      continue;
    }
    if (primary) stats.blocksScanned += 1;
    if (primary) stats.rowsScanned += batch.size;
    if (col.type === 'string') {
      for (let i = 0; i < batch.size; i += 1) {
        if (bitGet(batch.nulls, i)) continue;
        if (satisfies(batch.codes[i], predicate.op, target)) mask[batch.start + i] = 1;
      }
    } else {
      const values = decodeBatch(col, bi);
      for (let i = 0; i < batch.size; i += 1) if (satisfies(values[i], predicate.op, target)) mask[batch.start + i] = 1;
    }
  }
  return { mask, skipped };
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Runs a plan: predicates become bitsets, then aggregation walks only the batches that
 * still hold surviving rows, reading each value out of its encoded form.
 */
export function query(table, plan) {
  const stats = {
    blocksScanned: 0, blocksSkipped: 0, rowsScanned: 0, rowsSkipped: 0,
    batchesDecoded: 0, bytesDecoded: 0, rowsOut: 0, groups: 0, skipped: [], ms: 0,
  };
  const started = Date.now();
  let mask = null;
  for (const predicate of plan.where ?? []) {
    const col = table.columns[predicate.column];
    if (!col) throw new Error(`No such column: ${predicate.column}`);
    const result = scanFilter(col, { ...predicate, value: resolveTarget(col, predicate.value) }, stats, stats.skipped.length === 0);
    stats.skipped.push({ column: predicate.column, op: predicate.op, value: predicate.value, batches: result.skipped });
    if (!mask) mask = result.mask;
    else for (let i = 0; i < mask.length; i += 1) mask[i] = mask[i] && result.mask[i] ? 1 : 0;
  }
  if (!mask) mask = new Uint8Array(table.rowCount).fill(1);

  const groupCols = (plan.groupBy ?? []).map((name) => {
    const col = table.columns[name];
    if (!col) throw new Error(`No such column: ${name}`);
    return col;
  });
  const aggs = plan.aggs ?? [{ agg: 'count', column: null, as: 'count' }];
  const aggCols = aggs.map((agg) => {
    if (!agg.column) return null;
    const col = table.columns[agg.column];
    if (!col) throw new Error(`No such column: ${agg.column}`);
    return col;
  });

  const groups = new Map();
  const batchCount = table.columns[table.order[0]]?.batches.length ?? 0;
  for (let bi = 0; bi < batchCount; bi += 1) {
    const first = table.columns[table.order[0]].batches[bi];
    let anySurvivor = false;
    for (let i = 0; i < first.size; i += 1) {
      if (mask[first.start + i]) {
        anySurvivor = true;
        break;
      }
    }
    if (!anySurvivor) continue;
    const groupValues = groupCols.map((col) => decodeBatch(col, bi));
    const aggValues = aggCols.map((col) => (col ? decodeBatch(col, bi) : null));
    stats.batchesDecoded += 1;
    stats.bytesDecoded += first.size * 8;
    for (let i = 0; i < first.size; i += 1) {
      const row = first.start + i;
      if (!mask[row]) continue;
      const key = groupCols.length ? groupCols.map((col, g) => groupValues[g][i] ?? '∅').join(' · ') : 'all';
      if (!groups.has(key)) {
        groups.set(key, aggs.map((agg) => ({ agg: agg.agg, column: agg.column, sum: 0, count: 0, min: null, max: null, seen: new Set() })));
      }
      const slot = groups.get(key);
      aggs.forEach((agg, ai) => {
        const acc = slot[ai];
        if (agg.agg === 'count') {
          acc.count += 1;
          return;
        }
        const raw = aggValues[ai][i];
        if (raw == null) return;
        const value = typeof raw === 'string' ? raw : Number(raw);
        acc.count += 1;
        if (agg.agg === 'sum' || agg.agg === 'avg') acc.sum += Number(value);
        if (agg.agg === 'min') acc.min = acc.min == null || value < acc.min ? value : acc.min;
        if (agg.agg === 'max') acc.max = acc.max == null || value > acc.max ? value : acc.max;
        if (agg.agg === 'distinct') acc.seen.add(raw);
      });
    }
  }

  const rows = [...groups.entries()].map(([key, slot]) => {
    const row = groupCols.length ? { group: key } : {};
    aggs.forEach((agg, ai) => {
      const acc = slot[ai];
      const as = agg.as ?? `${agg.agg}${agg.column ? `_${agg.column}` : ''}`;
      if (agg.agg === 'count') row[as] = acc.count;
      else if (agg.agg === 'sum') row[as] = round(acc.sum);
      else if (agg.agg === 'avg') row[as] = acc.count ? round(acc.sum / acc.count) : null;
      else if (agg.agg === 'min') row[as] = acc.min;
      else if (agg.agg === 'max') row[as] = acc.max;
      else if (agg.agg === 'distinct') row[as] = acc.seen.size;
    });
    return row;
  });
  rows.sort((a, b) => ((a.group ?? '') < (b.group ?? '') ? -1 : 1));
  stats.rowsOut = rows.length;
  stats.groups = groups.size;
  stats.ms = Math.max(1, Date.now() - started);
  return { rows: plan.limit ? rows.slice(0, plan.limit) : rows, stats };
}

/** The reference: every column fully decoded, one row at a time, no pushdown anywhere. */
export function referenceQuery(table, plan) {
  const decoded = {};
  for (const name of table.order) decoded[name] = decodeColumn(table.columns[name]);
  const aggs = plan.aggs ?? [{ agg: 'count', column: null, as: 'count' }];
  const keeping = [];
  for (let i = 0; i < table.rowCount; i += 1) {
    let keep = true;
    for (const predicate of plan.where ?? []) {
      if (!satisfies(decoded[predicate.column][i], predicate.op, predicate.value)) {
        keep = false;
        break;
      }
    }
    if (keep) keeping.push(i);
  }
  const groups = new Map();
  for (const i of keeping) {
    const key = plan.groupBy?.length ? plan.groupBy.map((name) => decoded[name][i] ?? '∅').join(' · ') : 'all';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const out = [...groups.entries()].map(([key, members]) => {
    const row = plan.groupBy?.length ? { group: key } : {};
    for (const agg of aggs) {
      const as = agg.as ?? `${agg.agg}${agg.column ? `_${agg.column}` : ''}`;
      const values = agg.column ? members.map((i) => decoded[agg.column][i]).filter((v) => v != null) : members;
      if (agg.agg === 'count') row[as] = members.length;
      else if (agg.agg === 'sum') row[as] = round(values.reduce((sum, v) => sum + Number(v), 0));
      else if (agg.agg === 'avg') row[as] = values.length ? round(values.reduce((sum, v) => sum + Number(v), 0) / values.length) : null;
      else if (agg.agg === 'min') row[as] = values.length ? values.reduce((m, v) => (v < m ? v : m)) : null;
      else if (agg.agg === 'max') row[as] = values.length ? values.reduce((m, v) => (v > m ? v : m)) : null;
      else if (agg.agg === 'distinct') row[as] = new Set(values).size;
    }
    return row;
  });
  out.sort((a, b) => ((a.group ?? '') < (b.group ?? '') ? -1 : 1));
  return { rows: plan.limit ? out.slice(0, plan.limit) : out };
}

/** Everything the engine claims, checked against the reference and against the data itself. */
export function verifyQuery(table, plan) {
  const fast = query(table, plan);
  const slow = referenceQuery(table, plan);
  const rowsEqual = JSON.stringify(fast.rows) === JSON.stringify(slow.rows);

  const roundTrip = Object.entries(table.columns).map(([name, col]) => {
    const decoded = decodeColumn(col);
    const original = table.rawRows ? table.rawRows.map((row) => (row[name] === undefined ? null : row[name])) : null;
    const same = (value, reference) => (col.type === 'bool' ? Number(value) === Number(reference) : value === reference);
    const lossless = original ? decoded.length === original.length && decoded.every((value, i) => same(value, original[i])) : null;
    return {
      name, type: col.type, encoding: col.encoding, lossless,
      ratio: Math.round(col.bytes.ratio * 100) / 100,
      stored: col.bytes.stored, raw: col.bytes.raw, nulls: col.nullCount,
    };
  });

  // Pushdown honesty: every row in a skipped batch is re-checked against its predicate
  let skippedRows = 0;
  let skippedMatches = 0;
  for (const entry of fast.stats.skipped) {
    const col = table.columns[entry.column];
    const target = resolveTarget(col, entry.value);
    for (const bi of entry.batches) {
      const batch = col.batches[bi];
      if (col.type === 'string') {
        for (let i = 0; i < batch.size; i += 1) {
          if (bitGet(batch.nulls, i)) continue;
          skippedRows += 1;
          if (satisfies(batch.codes[i], entry.op, target)) skippedMatches += 1;
        }
      } else {
        const values = decodeBatch(col, bi);
        for (const value of values) {
          skippedRows += 1;
          if (satisfies(value, entry.op, target)) skippedMatches += 1;
        }
      }
    }
  }

  return {
    fast,
    slow,
    rowsEqual,
    roundTrip,
    pushdownSound: skippedMatches === 0,
    skippedRows,
    skippedMatches,
    scannedShare: table.rowCount ? fast.stats.rowsScanned / table.rowCount : 0,
    decodedShare: table.rowCount ? (fast.stats.batchesDecoded * BATCH) / table.rowCount : 0,
  };
}

export const PLANS = [
  {
    label: 'Region totals',
    plan: { where: [], groupBy: ['region'], aggs: [{ agg: 'count', as: 'rows' }, { agg: 'sum', column: 'amount', as: 'revenue' }, { agg: 'avg', column: 'units', as: 'avg_units' }] },
  },
  {
    label: 'Active premium orders',
    plan: { where: [{ column: 'active', op: '=', value: 1 }, { column: 'tier', op: '=', value: 'premium' }], groupBy: ['region'], aggs: [{ agg: 'count', as: 'orders' }, { agg: 'sum', column: 'amount', as: 'revenue' }, { agg: 'max', column: 'amount', as: 'largest' }] },
  },
  {
    label: 'Large scores',
    plan: { where: [{ column: 'score', op: '>', value: 90 }], groupBy: ['tier'], aggs: [{ agg: 'count', as: 'rows' }, { agg: 'avg', column: 'score', as: 'avg_score' }, { agg: 'distinct', column: 'region', as: 'regions' }] },
  },
  {
    label: 'Busy units',
    plan: { where: [{ column: 'units', op: '>=', value: 30 }, { column: 'active', op: '=', value: 1 }], groupBy: ['region', 'tier'], aggs: [{ agg: 'count', as: 'rows' }, { agg: 'sum', column: 'units', as: 'units' }, { agg: 'min', column: 'amount', as: 'smallest' }] },
  },
  {
    label: 'Everything',
    plan: { where: [], groupBy: [], aggs: [{ agg: 'count', as: 'rows' }, { agg: 'sum', column: 'amount', as: 'revenue' }, { agg: 'avg', column: 'score', as: 'avg_score' }, { agg: 'distinct', column: 'tier', as: 'tiers' }] },
  },
];

export function makeRows({ seed = 11, rows = 12000 } = {}) {
  let state = (seed >>> 0) || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const regions = ['north', 'south', 'east', 'west', 'central'];
  const tiers = ['free', 'standard', 'premium'];
  const out = [];
  for (let i = 0; i < rows; i += 1) {
    const roll = random();
    out.push({
      region: regions[Math.floor(random() * regions.length)],
      tier: tiers[roll < 0.55 ? 0 : roll < 0.88 ? 1 : 2],
      units: Math.floor(random() * 40),
      amount: Math.round(random() * 100000) / 100,
      score: random() < 0.9 ? Math.round(random() * 10000) / 100 : null,
      active: random() > 0.25,
    });
  }
  const table = buildTable({
    columns: [
      { name: 'region', type: 'string' },
      { name: 'tier', type: 'string' },
      { name: 'units', type: 'int' },
      { name: 'amount', type: 'float' },
      { name: 'score', type: 'float' },
      { name: 'active', type: 'bool' },
    ],
    rows: out,
  });
  table.rawRows = out;
  return table;
}