import { CUSTOMIZATION_SCHEMA_VERSION, DEFAULT_COLUMNS, defaultConfig, SIDEBAR_SECTIONS, type ColumnConfig, type CustomizationConfig } from './schema';

/**
 * Configuration migrations.
 *
 *  - Version 0 is the pre-customization era: presentation preferences lived in
 *    the general settings table (theme, density, sidebar/inspector widths…).
 *    `fromLegacySettings` turns them into a version-1 document once.
 *  - `migrateConfig` upgrades stored documents step by step. A document from a
 *    NEWER version is refused (never "downgraded"), so a newer Orbis Files'
 *    data is not damaged by an older build.
 */

export type MigrationStep = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Steps keyed by the version they upgrade FROM. Add a step and bump CUSTOMIZATION_SCHEMA_VERSION together. */
export const MIGRATIONS: Record<number, MigrationStep> = {
  /**
   * 1 → 2: design system 2 ("Orbis Native" glass). The new material, glow and
   * ambient settings are filled with their defaults by the schema. Corner
   * radius and panel spacing still at the version-1 defaults (6 px, 0 px) move
   * to the new defaults (10 px, 6 px); values the user changed are kept.
   * The previous look is the built-in "Orbis Classic" preset.
   */
  1: (doc) => {
    const a = doc.appearance;
    if (!a || typeof a !== 'object' || Array.isArray(a)) return doc;
    const ap = { ...(a as Record<string, unknown>) };
    if (ap.radius === 6 && (ap.panelSpacing === 0 || ap.panelSpacing === undefined)) {
      ap.radius = 10;
      ap.panelSpacing = 6;
    }
    return { ...doc, appearance: ap };
  },
};

export class UnsupportedVersionError extends Error {}

export function migrateConfig(raw: unknown): { doc: unknown; from: number; steps: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The stored customization is not an object.');
  let doc = raw as Record<string, unknown>;
  const v = doc.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('The stored customization has no valid schema version.');
  if (v > CUSTOMIZATION_SCHEMA_VERSION) throw new UnsupportedVersionError(`This customization was saved by a newer Orbis Files (schema ${v}); this version understands up to ${CUSTOMIZATION_SCHEMA_VERSION}.`);
  let cur = v;
  let steps = 0;
  while (cur < CUSTOMIZATION_SCHEMA_VERSION) {
    const step = MIGRATIONS[cur];
    if (!step) throw new Error(`No migration from schema ${cur}.`);
    doc = { ...step(doc), schemaVersion: cur + 1 };
    cur++;
    steps++;
  }
  return { doc, from: v, steps };
}

/** Presentation keys that moved out of the general settings in schema 1. */
export const LEGACY_PRESENTATION_KEYS = ['theme', 'density', 'uiScale', 'reduceMotion', 'sidebarVisible', 'sidebarWidth', 'inspectorVisible', 'inspectorWidth', 'defaultView', 'sort', 'groupBy', 'detailsColumns', 'iconSize', 'startLocation'] as const;

const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

/**
 * Build a version-1 configuration from legacy settings values (already
 * JSON-parsed). Invalid legacy values are skipped and keep their defaults;
 * the list of keys actually carried over is returned for the startup notice.
 */
export function fromLegacySettings(legacy: Record<string, unknown>, sidebarHidden: Record<string, boolean> = {}, now = Date.now()): { config: CustomizationConfig; carried: string[] } {
  const c = defaultConfig(now);
  const carried: string[] = [];
  const take = (key: string, apply: () => boolean) => {
    if (key in legacy && apply()) carried.push(key);
  };
  take('theme', () => {
    const m = oneOf(legacy.theme, ['dark', 'light', 'system'] as const);
    if (m) c.appearance.mode = m;
    return !!m;
  });
  take('density', () => {
    const d = oneOf(legacy.density, ['compact', 'comfortable', 'spacious'] as const);
    if (d) c.appearance.density = d;
    return !!d;
  });
  take('uiScale', () => {
    const s = num(legacy.uiScale, 0.8, 1.6);
    if (s !== undefined) c.accessibility.interfaceScale = s;
    return s !== undefined;
  });
  take('reduceMotion', () => {
    const r = oneOf(legacy.reduceMotion, ['system', 'on', 'off'] as const);
    if (r) c.accessibility.reduceMotion = r;
    return !!r;
  });
  take('sidebarVisible', () => typeof legacy.sidebarVisible === 'boolean' && ((c.layout.sidebar.visible = legacy.sidebarVisible), true));
  take('sidebarWidth', () => {
    const w = num(legacy.sidebarWidth, 180, 480);
    if (w !== undefined) c.layout.sidebar.width = Math.round(w);
    return w !== undefined;
  });
  take('inspectorVisible', () => typeof legacy.inspectorVisible === 'boolean' && ((c.layout.details.visible = legacy.inspectorVisible), true));
  take('inspectorWidth', () => {
    const w = num(legacy.inspectorWidth, 260, 640);
    if (w !== undefined) c.layout.details.width = Math.round(w);
    return w !== undefined;
  });
  take('defaultView', () => {
    const v = oneOf(legacy.defaultView, ['details', 'list', 'compact', 'grid', 'gallery', 'columns', 'tree'] as const);
    if (v) c.view.view = v;
    return !!v;
  });
  take('sort', () => {
    const s = legacy.sort as Record<string, unknown> | undefined;
    const key = oneOf(s?.key, ['name', 'size', 'modified', 'created', 'accessed', 'type', 'ext', 'tags', 'dimensions', 'duration', 'taken'] as const);
    const dir = oneOf(s?.dir, ['asc', 'desc'] as const);
    if (key && dir) c.view.sort = { key, dir, foldersFirst: s?.foldersFirst !== false };
    return !!(key && dir);
  });
  take('groupBy', () => {
    const g = oneOf(legacy.groupBy, ['none', 'type', 'modified', 'created', 'size', 'kind', 'tags'] as const);
    if (g) c.view.groupBy = g;
    return !!g;
  });
  take('detailsColumns', () => {
    if (!Array.isArray(legacy.detailsColumns)) return false;
    const ids = new Set<string>(DEFAULT_COLUMNS.map((x) => x.id).concat(['accessed', 'location', 'attributes', 'owner', 'dimensions', 'duration', 'taken', 'volume', 'checksum']));
    const cols: ColumnConfig[] = [];
    for (const x of legacy.detailsColumns as Array<Record<string, unknown>>) {
      if (!x || typeof x.id !== 'string' || !ids.has(x.id) || cols.some((y) => y.id === x.id)) continue;
      cols.push({ id: x.id as ColumnConfig['id'], width: Math.round(num(x.width, 48, 1200) ?? 120), visible: x.visible !== false, pinned: x.id === 'name' });
    }
    const name = cols.find((x) => x.id === 'name');
    if (!name) return false;
    name.visible = true;
    c.view.columns = cols;
    return true;
  });
  take('iconSize', () => {
    const s = num(legacy.iconSize, 48, 256);
    if (s !== undefined) c.appearance.iconSize = Math.round(s);
    return s !== undefined;
  });
  take('startLocation', () => {
    const s = oneOf(legacy.startLocation, ['home', 'last'] as const);
    if (s) c.navigation.start = { kind: s, path: '' };
    return !!s;
  });
  const hidden = SIDEBAR_SECTIONS.filter((id) => sidebarHidden[id]);
  if (hidden.length) {
    c.navigation.sections = c.navigation.sections.map((s) => ({ ...s, visible: !hidden.includes(s.id) }));
    carried.push('sidebar sections');
  }
  c.meta.migratedFrom = 'settings-v0';
  return { config: c, carried };
}
