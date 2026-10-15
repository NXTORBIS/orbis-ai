/**
 * Integration tests for persistence and the portable file format.
 *
 * These use fake-indexeddb so the real IndexedDB code path is exercised rather
 * than a stub.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  FORMAT_ID,
  SCHEMA_VERSION,
  buildExportFile,
  investigationSchema,
  parseExportFile,
  validateInvestigation,
  type Investigation,
} from './schema';
import { MemoryStore, newId, openStore, slug, toCsv } from './store';
import { nextCopyName } from '../app/store';
import { runSimulation } from '../engine/simulation/runner';

function makeInvestigation(over: Partial<Investigation> = {}): Investigation {
  const now = new Date().toISOString();
  return investigationSchema.parse({
    id: newId(),
    name: 'Test investigation',
    description: '',
    toolId: 'simulation',
    config: { modelId: 'pi-estimation' },
    simulation: { trials: 1000, seed: 'abc', keepSamples: false },
    assumptions: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  });
}

describe('investigation schema', () => {
  it('accepts a well-formed investigation and applies defaults', () => {
    const r = validateInvestigation({
      id: 'x',
      name: 'N',
      toolId: 'bayes',
      config: { a: 1 },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.description).toBe('');
      expect(r.value.assumptions).toEqual([]);
    }
  });

  it('rejects an unknown tool, a missing name and an over-long name', () => {
    expect(validateInvestigation({ id: 'x', name: 'N', toolId: 'not-a-tool', config: {}, createdAt: 'a', updatedAt: 'b' }).ok).toBe(false);
    expect(validateInvestigation({ id: 'x', name: '', toolId: 'bayes', config: {}, createdAt: 'a', updatedAt: 'b' }).ok).toBe(false);
    expect(validateInvestigation({ id: 'x', name: 'y'.repeat(500), toolId: 'bayes', config: {}, createdAt: 'a', updatedAt: 'b' }).ok).toBe(false);
  });

  it('rejects a trial count beyond the supported limit', () => {
    const r = validateInvestigation({
      id: 'x',
      name: 'N',
      toolId: 'simulation',
      config: {},
      simulation: { trials: 99_000_000, seed: 's' },
      createdAt: 'a',
      updatedAt: 'b',
    });
    expect(r.ok).toBe(false);
  });
});

describe('export and import', () => {
  it('round-trips an investigation exactly', () => {
    const original = makeInvestigation({ name: 'Round trip', assumptions: ['one', 'two'] });
    const file = buildExportFile([original]);
    const text = JSON.stringify(file);
    const outcome = parseExportFile(text);
    expect(outcome.investigations).toHaveLength(1);
    expect(outcome.investigations[0]).toEqual(original);
  });

  it('rejects files that are not Orbis Chance exports, naming the reason', () => {
    expect(() => parseExportFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseExportFile('[]')).toThrow(/top level is an array/);
    expect(() => parseExportFile('42')).toThrow(/top level is a number/);
    expect(() => parseExportFile('{"format":"other"}')).toThrow(/not an Orbis Chance investigation export/);
    expect(() => parseExportFile(JSON.stringify({ format: FORMAT_ID }))).toThrow(/missing or invalid format version/);
  });

  it('refuses a file from a newer format version rather than guessing', () => {
    const file = { format: FORMAT_ID, formatVersion: SCHEMA_VERSION + 5, exportedAt: 'x', investigations: [] };
    expect(() => parseExportFile(JSON.stringify(file))).toThrow(/newer version of Orbis Chance/);
  });

  it('rejects a structurally invalid investigation without importing any of them', () => {
    const good = makeInvestigation();
    const file = { format: FORMAT_ID, formatVersion: SCHEMA_VERSION, exportedAt: 'x', investigations: [good, { id: 'bad' }] };
    expect(() => parseExportFile(JSON.stringify(file))).toThrow(/No investigations were imported/);
  });

  it('does not let an imported file inject unexpected properties', () => {
    const good = makeInvestigation();
    const file = {
      format: FORMAT_ID,
      formatVersion: SCHEMA_VERSION,
      exportedAt: 'x',
      investigations: [{ ...good, __proto__: { polluted: true }, unexpectedField: 'dropped' }],
    };
    const outcome = parseExportFile(JSON.stringify(file));
    expect('unexpectedField' in outcome.investigations[0]).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('an export file declares its format and version', () => {
    const f = buildExportFile([makeInvestigation()]);
    expect(f.format).toBe(FORMAT_ID);
    expect(f.formatVersion).toBe(SCHEMA_VERSION);
    expect(f.application).toMatch(/Orbis Chance/);
  });
});

describe('store', () => {
  it('saves, lists, reads back, duplicates and deletes', async () => {
    const { store } = await openStore();
    await store.clearAll();
    const a = makeInvestigation({ name: 'A' });
    const b = makeInvestigation({ name: 'B' });
    await store.saveInvestigation(a);
    await store.saveInvestigation(b);

    const list = await store.listInvestigations();
    expect(list.map((i) => i.name).sort()).toEqual(['A', 'B']);

    const read = await store.getInvestigation(a.id);
    expect(read?.name).toBe('A');
    expect(read?.config).toEqual(a.config);

    await store.deleteInvestigation(a.id);
    expect(await store.getInvestigation(a.id)).toBeNull();
    expect((await store.listInvestigations()).map((i) => i.name)).toEqual(['B']);
  });

  it('saveMany writes nothing when one record is invalid', async () => {
    const { store } = await openStore();
    await store.clearAll();
    const good = makeInvestigation({ name: 'Valid' });
    const bad = { ...makeInvestigation(), toolId: 'nonsense' } as unknown as Investigation;
    await expect(store.saveMany([good, bad])).rejects.toThrow();
    expect(await store.listInvestigations()).toHaveLength(0);
  });

  it('persists preferences and recent entries', async () => {
    const { store } = await openStore();
    await store.savePreferences({ ...(await store.getPreferences()), theme: 'light', defaultTrials: 1234 });
    const prefs = await store.getPreferences();
    expect(prefs.theme).toBe('light');
    expect(prefs.defaultTrials).toBe(1234);

    const inv = makeInvestigation();
    await store.saveInvestigation(inv);
    await store.recordRecent(inv.id);
    expect((await store.listRecent()).map((r) => r.investigationId)).toContain(inv.id);
    // Deleting removes it from the recent list too.
    await store.deleteInvestigation(inv.id);
    expect((await store.listRecent()).map((r) => r.investigationId)).not.toContain(inv.id);
  });

  it('the in-memory fallback satisfies the same interface', async () => {
    const store = new MemoryStore();
    const inv = makeInvestigation({ name: 'Memory' });
    await store.saveInvestigation(inv);
    expect((await store.listInvestigations())[0].name).toBe('Memory');
    expect(store.kind).toBe('memory');
  });
});

describe('reproducibility of a saved investigation', () => {
  it('re-running with the saved seed reproduces the stored result exactly', () => {
    const inv = makeInvestigation({ simulation: { trials: 5000, seed: 'saved-seed', keepSamples: false } });
    const request = { modelId: 'pi-estimation', config: {}, trials: inv.simulation!.trials, seed: inv.simulation!.seed };
    const first = runSimulation(request);
    // Simulate reopening the file later and running again from the stored settings.
    const reopened = JSON.parse(JSON.stringify(inv)) as Investigation;
    const second = runSimulation({ modelId: reopened.toolId === 'simulation' ? 'pi-estimation' : 'pi-estimation', config: {}, trials: reopened.simulation!.trials, seed: reopened.simulation!.seed });
    expect(second.outputs[0].summary.mean).toBe(first.outputs[0].summary.mean);
    expect(second.outputs[0].summary.sd).toBe(first.outputs[0].summary.sd);
  });
});

describe('helpers', () => {
  it('copy names never collide', () => {
    expect(nextCopyName('Report', [])).toBe('Report (copy)');
    expect(nextCopyName('Report', ['Report (copy)'])).toBe('Report (copy 2)');
    expect(nextCopyName('Report (copy)', ['Report (copy)'])).toBe('Report (copy 2)');
    expect(nextCopyName('Report (copy 2)', ['Report (copy)', 'Report (copy 2)'])).toBe('Report (copy 3)');
  });

  it('slug produces a safe filename', () => {
    expect(slug('My Report: 2024/07!')).toBe('my-report-2024-07');
    expect(slug('')).toBe('investigation');
    expect(slug('   ')).toBe('investigation');
  });

  it('CSV escapes quotes, commas and newlines', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['line\nbreak', null]]);
    expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n"line\nbreak",');
  });
});
