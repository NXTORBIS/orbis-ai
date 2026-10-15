/**
 * Regression tests for the interface, data-handling and persistence defects
 * found in review. Browser-level behaviour is covered in e2e/journeys.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { formatPercent, formatProbability, formatValue, linearScale } from './ui/charts/scale';
import { DATA_LIMITS, parseJsonDataset } from './engine/stats/dataset';
import { MAX_CONFIG_DEPTH, buildExportFile, investigationSchema, parseExportFile } from './persistence/schema';
import { nextCopyName } from './app/store';
import type { ReactNode } from 'react';
import { Notice } from './ui/primitives';

/**
 * Renders a Notice and returns its markup, or null when it rendered nothing.
 * `Notice` returning null is the behaviour under test, and calling the
 * component directly is enough to observe it: it has no hooks and no state.
 */
function renderNotice(props: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; children?: ReactNode; items?: string[] }) {
  return Notice(props as Parameters<typeof Notice>[0]);
}

describe('chart scales never emit invalid geometry', () => {
  it('a span that overflows to Infinity still produces finite pixels', () => {
    // A dataset containing 1e308 and -1e308 made the span Infinity, so every
    // mapped value came out NaN and reached the SVG as x="NaN".
    const scale = linearScale([-1e308, 1e308], [0, 100]);
    for (const v of [-1e308, -1, 0, 1, 1e308]) {
      expect(Number.isFinite(scale(v)), `scale(${v}) = ${scale(v)}`).toBe(true);
      expect(scale(v)).toBeGreaterThanOrEqual(0);
      expect(scale(v)).toBeLessThanOrEqual(100);
    }
  });

  it('non-finite inputs are kept inside the plot area', () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(Number.isFinite(scale(NaN))).toBe(true);
    expect(Number.isFinite(scale(Infinity))).toBe(true);
    expect(Number.isFinite(scale(-Infinity))).toBe(true);
  });

  it('ordinary and degenerate domains are unaffected', () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(scale(0)).toBe(0);
    expect(scale(5)).toBe(50);
    expect(scale(10)).toBe(100);
    // A zero-width domain is widened rather than dividing by zero.
    const flat = linearScale([7, 7], [0, 100]);
    expect(Number.isFinite(flat(7))).toBe(true);
    expect(flat(7)).toBeCloseTo(50, 6);
  });
});

describe('JSON import respects the row limit before allocating', () => {
  it('a column longer than the limit is truncated without building every record', () => {
    // Previously every record was materialised and only then sliced, which
    // allocated hundreds of megabytes and froze the tab for a file well inside
    // the byte limit. The guard is the row count, so a modest array proves the
    // ordering: the note must report the original length.
    const declared = DATA_LIMITS.maxRows + 25;
    const payload = JSON.stringify({ a: Array.from({ length: declared }, (_, i) => i) });
    const started = Date.now();
    const ds = parseJsonDataset(payload);
    expect(ds.rowCount).toBe(DATA_LIMITS.maxRows);
    expect(ds.notes.join(' ')).toMatch(new RegExp(`${declared.toLocaleString('en-US')} records`));
    // Comfortably below the many seconds the unbounded version took.
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it('a small file is read in full', () => {
    const ds = parseJsonDataset('{"a":[1,2,3],"b":[4,5,6]}');
    expect(ds.rowCount).toBe(3);
    expect(ds.notes.join(' ')).not.toMatch(/only the first/);
  });
});

describe('imported files cannot overflow the stack', () => {
  /** Build the nested JSON as text: JSON.stringify is itself recursive. */
  const nestedText = (depth: number) => `${'['.repeat(depth)}1${']'.repeat(depth)}`;

  const wrapText = (configJson: string) =>
    JSON.stringify(
      buildExportFile([
        investigationSchema.parse({
          id: 'x',
          name: 'Deep',
          toolId: 'bayes',
          config: {},
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        }),
      ]),
    ).replace('"config":{}', `"config":${configJson}`);

  it('a deeply nested configuration is rejected with a readable message', () => {
    // 1000 levels of nesting in about 2 KB used to throw "Maximum call stack
    // size exceeded" straight into a toast.
    const text = wrapText(nestedText(1000));
    expect(() => parseExportFile(text)).toThrow(/nested more than 32 levels/);
    expect(() => parseExportFile(text)).not.toThrow(/call stack/);
  });

  it('a file too deep even to parse is reported, not crashed on', () => {
    // Which guard fires depends on the host: V8's JSON.parse handles very deep
    // arrays iteratively, so the depth check catches it and the reader sees the
    // ordinary validation message; a recursive parser throws first and the
    // "nested far too deeply" branch reports that. Either is acceptable. What
    // must never happen is a raw RangeError reaching the interface.
    const run = () => parseExportFile(wrapText(nestedText(200_000)));
    expect(run).toThrow(/nested more than 32 levels|nested far too deeply/);
    expect(run).not.toThrow(/call stack/i);
    expect(run).not.toThrow(RangeError);
  });

  it('configurations at a realistic depth still import', () => {
    const outcome = parseExportFile(wrapText(nestedText(MAX_CONFIG_DEPTH - 3)));
    expect(outcome.investigations).toHaveLength(1);
  });

  it('a configuration containing a non-finite number is rejected', () => {
    // JSON cannot carry Infinity, but a hand-edited file can carry 1e999,
    // which parses to Infinity.
    expect(() => parseExportFile(wrapText('{"trials":1e999}'))).toThrow(/not a finite number/);
  });
});

describe('renaming on import stays within the stored name limit', () => {
  it('a long name is trimmed so the suffix fits', () => {
    // A 200-character name plus " (imported)" exceeded the schema maximum, so
    // the whole import failed with a validation message and nothing was added.
    const long = 'A'.repeat(200);
    const renamed = nextCopyName(long, [], 'imported');
    expect(renamed.length).toBeLessThanOrEqual(200);
    expect(renamed.endsWith(' (imported)')).toBe(true);
    expect(() =>
      investigationSchema.parse({
        id: 'x',
        name: renamed,
        toolId: 'bayes',
        config: {},
        createdAt: 'a',
        updatedAt: 'b',
      }),
    ).not.toThrow();
  });

  it('successive copies stay within the limit and remain distinct', () => {
    const long = 'B'.repeat(195);
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      const next = nextCopyName(long, names, 'copy');
      expect(next.length).toBeLessThanOrEqual(200);
      expect(names).not.toContain(next);
      names.push(next);
    }
  });

  it('short names are untouched', () => {
    expect(nextCopyName('Report', [])).toBe('Report (copy)');
  });
});

describe('number formatters cannot take down a screen', () => {
  // `digits` is a count of significant figures handed to `toPrecision`, which
  // throws a RangeError outside 1..100 rather than rounding. Two whole tool
  // screens hit the error boundary on open because a caller read
  // `formatPercent(level, 0)` as "no decimal places" — a reasonable reading of
  // the name. The numbers were fine; only their rendering was over-specified,
  // so a formatter must clamp rather than throw.
  const hostile = [0, -1, -100, 0.4, NaN, Infinity, -Infinity, 101, 1e9];

  it('formatValue survives any requested precision', () => {
    for (const d of hostile) {
      for (const v of [0, 1, -1, 0.95, 1234.5678, 1e-9, 1e15, -1e15]) {
        expect(() => formatValue(v, d), `formatValue(${v}, ${d})`).not.toThrow();
        const out = formatValue(v, d);
        expect(out, `formatValue(${v}, ${d})`).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  it('formatPercent survives any requested precision and still reads correctly', () => {
    for (const d of hostile) {
      expect(() => formatPercent(0.95, d), `formatPercent(0.95, ${d})`).not.toThrow();
    }
    // The default must render a confidence level the way a reader expects.
    expect(formatPercent(0.95)).toBe('95%');
    expect(formatPercent(0.99)).toBe('99%');
    expect(formatPercent(0.999)).toBe('99.9%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
    // A precision of 0 is clamped to 1 significant figure, not thrown on.
    expect(formatPercent(0.95, 0)).toBe('100%');
  });

  it('the formatters still report non-finite inputs honestly rather than as a number', () => {
    expect(formatValue(NaN)).toBe('undefined');
    expect(formatValue(Infinity)).toBe('∞');
    expect(formatValue(-Infinity)).toBe('−∞');
    expect(formatPercent(NaN)).toBe('undefined');
    expect(formatProbability(NaN)).toBe('undefined');
  });
});

describe('a notice with nothing to say renders nothing', () => {
  // Several screens pass `items` straight from an engine result's warnings
  // array, which is empty whenever there are no warnings — the common case.
  // The notice then drew its icon and the bare word "Warning", which reads as
  // though something is wrong and then says nothing at all.
  it('renders nothing when there is no title, no children and no items', () => {
    expect(renderNotice({ tone: 'warning', items: [] })).toBeNull();
    expect(renderNotice({ tone: 'warning' })).toBeNull();
    expect(renderNotice({ tone: 'error', items: [] })).toBeNull();
  });

  it('still renders when there is something to say', () => {
    expect(renderNotice({ tone: 'warning', items: ['A real warning'] })).not.toBeNull();
    expect(renderNotice({ tone: 'warning', title: 'A heading on its own' })).not.toBeNull();
    expect(renderNotice({ tone: 'info', children: 'Body text' })).not.toBeNull();
  });
});
