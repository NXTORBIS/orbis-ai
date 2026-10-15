/**
 * The tool catalogue is spread across four places that must agree: the stored
 * id union, the catalogue entries the interface renders, and the two lazy
 * tables that load a tool's default configuration and its screen. Adding a
 * tool means touching all four, and missing one fails in a different way each
 * time — an id with no screen renders nothing, a screen with no id will not
 * typecheck, and an entry with no loader leaves a new investigation waiting
 * for a default that never arrives. Seventeen tools were added in one pass
 * with nothing asserting this, so it is asserted here.
 */
import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_CATEGORIES, TOOLS_BY_ID } from './tools';
import { TOOL_IDS } from '../persistence/schema';
import { DEFAULT_CONFIG_LOADERS, TOOL_SCREENS, resolveEntryConfig } from './tools/lazy';
import { BUILT_IN_TEMPLATES, EXAMPLES } from '../examples/library';

describe('the tool catalogue agrees with itself', () => {
  it('every stored id has a catalogue entry, a loader and a screen', () => {
    for (const id of TOOL_IDS) {
      expect(TOOLS_BY_ID.has(id), `${id} has no catalogue entry`).toBe(true);
      expect(id in DEFAULT_CONFIG_LOADERS, `${id} has no default-configuration loader`).toBe(true);
      expect(id in TOOL_SCREENS, `${id} has no screen`).toBe(true);
    }
  });

  it('there are no catalogue entries, loaders or screens without a stored id', () => {
    const ids = new Set<string>(TOOL_IDS);
    expect(TOOLS.filter((t) => !ids.has(t.id)).map((t) => t.id)).toEqual([]);
    expect(Object.keys(DEFAULT_CONFIG_LOADERS).filter((k) => !ids.has(k))).toEqual([]);
    expect(Object.keys(TOOL_SCREENS).filter((k) => !ids.has(k))).toEqual([]);
  });

  it('ids are unique', () => {
    expect(new Set(TOOL_IDS).size).toBe(TOOL_IDS.length);
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
  });

  it('every tool sits in a listed category, and no category is empty', () => {
    const categories = new Set<string>(TOOL_CATEGORIES);
    for (const t of TOOLS) {
      expect(categories.has(t.category), `${t.id} is in the unlisted category ${t.category}`).toBe(true);
    }
    for (const c of TOOL_CATEGORIES) {
      expect(TOOLS.some((t) => t.category === c), `the category ${c} holds no tools`).toBe(true);
    }
  });

  it('every tool carries the text the interface renders', () => {
    for (const t of TOOLS) {
      expect(t.name.length, `${t.id} has no name`).toBeGreaterThan(0);
      expect(t.summary.length, `${t.id} has no summary`).toBeGreaterThan(0);
      expect(t.description.length, `${t.id} has no description`).toBeGreaterThan(0);
      // The home screen and the search surface both read these, and an empty
      // array renders as a heading with nothing under it.
      expect(t.questions.length, `${t.id} lists no questions`).toBeGreaterThan(0);
      expect(t.methods.length, `${t.id} lists no methods`).toBeGreaterThan(0);
    }
  });

  // This one necessarily imports all forty-two tool modules, which means
  // forty-two Vite transforms. That costs around fourteen seconds on a loaded
  // machine and has nothing to do with runtime work: timing each load
  // individually shows the cost spread evenly across the modules, with the
  // first paying the cold start, rather than any one module computing at
  // import time. The budget that matters for the product is the end-to-end
  // paint time per tool, which e2e/journeys.spec.ts asserts against a real
  // build. So this gets a generous timeout rather than being allowed to pass
  // or fail on machine load.
  it("each tool's default configuration loads and is a plain object", async () => {
    for (const id of TOOL_IDS) {
      const value = await DEFAULT_CONFIG_LOADERS[id]();
      expect(value, `${id} loaded no default configuration`).toBeTruthy();
      expect(typeof value, `${id} default configuration is not an object`).toBe('object');
      // A configuration is persisted and schema-validated, so it must survive
      // a structured clone and carry no non-finite number.
      expect(() => structuredClone(value)).not.toThrow();
      const nonFinite: string[] = [];
      const walk = (v: unknown, path: string) => {
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) nonFinite.push(path);
        } else if (Array.isArray(v)) {
          v.forEach((item, i) => walk(item, `${path}[${i}]`));
        } else if (v && typeof v === 'object') {
          for (const [k, item] of Object.entries(v)) walk(item, `${path}.${k}`);
        }
      };
      walk(value, id);
      expect(nonFinite, `${id} default configuration holds non-finite numbers`).toEqual([]);
    }
  }, 120_000);
});

describe('the library reaches every tool', () => {
  it('every tool has at least one example or template', () => {
    // Twenty-eight of the forty-two tools had neither. The library was written
    // for the fourteen the application shipped with and never grew as tools
    // were added, and a tool with no entry in the library is one a person has
    // no way into except by already knowing it exists.
    const covered = new Set<string>([...EXAMPLES.map((e) => e.toolId), ...BUILT_IN_TEMPLATES.map((t) => t.toolId)]);
    const missing = TOOL_IDS.filter((id) => !covered.has(id));
    expect(missing, `tools with no example and no template: ${missing.join(', ')}`).toEqual([]);
  });

  it('every example and template names a tool that exists', () => {
    for (const entry of [...EXAMPLES, ...BUILT_IN_TEMPLATES]) {
      expect(TOOLS_BY_ID.has(entry.toolId), `${entry.id} names the unknown tool ${entry.toolId}`).toBe(true);
    }
  });

  it('ids are unique across examples and across templates', () => {
    const exampleIds = EXAMPLES.map((e) => e.id);
    const templateIds = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(exampleIds).size).toBe(exampleIds.length);
    expect(new Set(templateIds).size).toBe(templateIds.length);
  });

  it('every entry resolves to a usable configuration', async () => {
    // An entry's override is merged over its tool's default. An override that
    // names a field the tool does not have would open a screen with a setting
    // nothing reads, which is how a library entry rots silently after the
    // tool it points at changes.
    for (const entry of [...EXAMPLES, ...BUILT_IN_TEMPLATES]) {
      const resolved = await resolveEntryConfig(entry.toolId, entry.configOverride);
      expect(resolved, `${entry.id} resolved to nothing`).toBeTruthy();
      const defaults = (await DEFAULT_CONFIG_LOADERS[entry.toolId]()) as Record<string, unknown>;
      const unknown = Object.keys(entry.configOverride).filter((k) => !(k in defaults));
      expect(unknown, `${entry.id} overrides settings ${entry.toolId} does not have: ${unknown.join(', ')}`).toEqual([]);
      expect(() => structuredClone(resolved)).not.toThrow();
    }
  }, 120_000);
});
