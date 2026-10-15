/**
 * `reconcileConfig` is the last gate before a stored or imported
 * configuration reaches a tool screen, and it had no tests at all.
 */
import { describe, expect, it } from 'vitest';
import { reconcileConfig } from './reconcile';

const defaults = {
  trials: 10_000,
  label: 'Default run',
  useBaseline: true,
  levels: [0.95, 0.99],
  severity: { kind: 'lognormal', sigma: 1.2 },
};

describe('reconcileConfig keeps what is usable and resets what is not', () => {
  it('keeps every value that matches the default shape', () => {
    const stored = { trials: 500, label: 'Mine', useBaseline: false, levels: [0.9], severity: { kind: 'gamma', sigma: 2 } };
    const out = reconcileConfig(defaults, stored);
    expect(out.repaired).toBe(0);
    expect(out.value).toEqual(stored);
  });

  it('fills in a missing setting and counts it', () => {
    const out = reconcileConfig(defaults, { trials: 500 });
    expect(out.value.label).toBe('Default run');
    expect(out.repaired).toBe(4);
  });

  it('resets a setting whose type does not match the default', () => {
    // The defect this closes: a value of the wrong type was taken verbatim and
    // handed to the screen, which would read NaN or crash — while `repaired`
    // stayed 0, so the interface said nothing was wrong.
    const out = reconcileConfig(defaults, { trials: 'soon', label: 42, useBaseline: 'yes', levels: 0.95, severity: 'lognormal' });
    expect(out.value.trials).toBe(10_000);
    expect(out.value.label).toBe('Default run');
    expect(out.value.useBaseline).toBe(true);
    expect(out.value.levels).toEqual([0.95, 0.99]);
    expect(out.value.severity).toEqual({ kind: 'lognormal', sigma: 1.2 });
    expect(out.repaired).toBe(5);
  });

  it('does not accept an array where an object is wanted, or the reverse', () => {
    const out = reconcileConfig(defaults, { levels: { '0': 0.95 }, severity: [1.2] });
    expect(out.value.levels).toEqual([0.95, 0.99]);
    expect(out.value.severity).toEqual({ kind: 'lognormal', sigma: 1.2 });
    // Both mismatches, plus the three keys this stored object omits entirely.
    expect(out.repaired).toBe(5);
  });

  it('resets a non-finite number even though its type matches', () => {
    // A configuration from IndexedDB was written by an older build and never
    // passed through the import schema, and a NaN reaching a chart axis is
    // what previously put x="NaN" into the SVG.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = reconcileConfig(defaults, { trials: bad });
      expect(out.value.trials, `trials = ${bad}`).toBe(10_000);
      expect(out.repaired).toBeGreaterThan(0);
    }
  });

  it('treats null and undefined as absent rather than as values', () => {
    const out = reconcileConfig(defaults, { trials: null, label: undefined });
    expect(out.value.trials).toBe(10_000);
    expect(out.value.label).toBe('Default run');
  });

  it('replaces a configuration that is not an object at all', () => {
    for (const stored of [null, undefined, 42, 'config', [1, 2, 3], true]) {
      const out = reconcileConfig(defaults, stored);
      expect(out.value, `stored = ${JSON.stringify(stored)}`).toEqual(defaults);
      expect(out.repaired).toBe(Object.keys(defaults).length);
    }
  });

  it('keeps extra keys a newer build may have written', () => {
    const out = reconcileConfig(defaults, { trials: 10, futureSetting: 'kept' });
    expect(out.value.futureSetting).toBe('kept');
  });

  it('does not share structure with the defaults it falls back to', () => {
    // A fallback handed out by reference would let one investigation's edits
    // reach the defaults object and so every other investigation.
    const out = reconcileConfig(defaults, {});
    (out.value.levels as number[]).push(0.5);
    (out.value.severity as { sigma: number }).sigma = 99;
    expect(defaults.levels).toEqual([0.95, 0.99]);
    expect(defaults.severity.sigma).toBe(1.2);
  });

  it('accepts zero, an empty string, false and an empty array as real values', () => {
    const out = reconcileConfig(defaults, { trials: 0, label: '', useBaseline: false, levels: [] });
    expect(out.value.trials).toBe(0);
    expect(out.value.label).toBe('');
    expect(out.value.useBaseline).toBe(false);
    expect(out.value.levels).toEqual([]);
    expect(out.repaired).toBe(1); // only `severity`, which was absent
  });
});
