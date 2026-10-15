import { z } from 'zod';
import {
  AppearanceSchema, ContextMenuSchema, CustomizationSchema, CUSTOMIZATION_SCHEMA_VERSION, LayoutSchema, NavigationSchema, PresetSchema, SavedViewSchema, ShortcutsSchema, ToolbarSchema, WorkspaceSchema,
  type CustomizationConfig, type Preset, type SavedView, type Workspace,
} from './schema';
import { migrateConfig } from './migrations';
import { validateConfig, CustomizationError } from './ops';
import { BUILT_IN_BY_ID } from './presets';
import { getAt } from './resolve';

/**
 * Portable customization files ("*.orbis-files.json").
 *
 * Envelope, format version 1:
 *   { "format": "orbis-files-customization", "formatVersion": 1, "kind": <kind>,
 *     "schemaVersion": 1, "exportedMs": <ms>, "generator": "Orbis Files <version>", "data": <payload> }
 *
 * Imports are untrusted: size and depth limits, no prototype keys, no
 * executable-looking strings, strict schemas (unknown properties are listed
 * and dropped), version checks, reference checks, and a preview of every
 * change before anything is applied.
 */

export const PORTABLE_FORMAT = 'orbis-files-customization';
export const PORTABLE_FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const EXPORT_KINDS = ['complete', 'appearance', 'theme', 'layout', 'workspace', 'view', 'shortcuts', 'toolbar', 'contextMenu', 'navigation'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_KIND_LABEL: Record<ExportKind, string> = {
  complete: 'Complete customization', appearance: 'Appearance settings', theme: 'Theme (preset)', layout: 'Layout', workspace: 'Workspace', view: 'Saved view', shortcuts: 'Shortcut profile', toolbar: 'Toolbar', contextMenu: 'Context menus', navigation: 'Navigation',
};

const LayoutFileSchema = z.object({ name: z.string().trim().min(1).max(60).default('Imported layout'), layout: LayoutSchema }).strict() as unknown as z.ZodType<{ name: string; layout: CustomizationConfig['layout'] }, z.ZodTypeDef, unknown>;

export interface Envelope { format: string; formatVersion: number; kind: ExportKind; schemaVersion: number; exportedMs: number; generator: string; data: unknown }

export function exportCustomization(config: CustomizationConfig, kind: ExportKind, opts: { id?: string; generator: string; now?: number; effectiveLayout?: unknown }): Envelope {
  let data: unknown;
  switch (kind) {
    case 'complete': data = { ...config, provenance: [] }; break;
    case 'appearance': data = config.appearance; break;
    case 'theme': {
      const p: Preset | undefined = config.presets.find((x) => x.id === opts.id) ?? (opts.id && BUILT_IN_BY_ID[opts.id] ? toPreset(BUILT_IN_BY_ID[opts.id]!) : undefined);
      if (!p) throw new CustomizationError('Choose a preset to export.');
      data = p;
      break;
    }
    case 'layout': {
      // A saved layout by id, or the layout currently in effect.
      const saved = opts.id ? config.savedLayouts.find((x) => x.id === opts.id) : undefined;
      if (opts.id && !saved) throw new CustomizationError('That layout does not exist.');
      data = saved ? { name: saved.name, layout: saved.layout } : { name: 'Current layout', layout: opts.effectiveLayout ?? config.layout };
      break;
    }
    case 'workspace': {
      const w = config.workspaces.find((x) => x.id === (opts.id ?? config.activeWorkspaceId));
      if (!w) throw new CustomizationError('That workspace does not exist.');
      data = w;
      break;
    }
    case 'view': {
      const v = config.savedViews.find((x) => x.id === opts.id);
      if (!v) throw new CustomizationError('Choose a saved view to export.');
      data = v;
      break;
    }
    case 'shortcuts': data = config.shortcuts; break;
    case 'toolbar': data = config.toolbar; break;
    case 'contextMenu': data = config.contextMenu; break;
    case 'navigation': data = config.navigation; break;
  }
  return { format: PORTABLE_FORMAT, formatVersion: PORTABLE_FORMAT_VERSION, kind, schemaVersion: CUSTOMIZATION_SCHEMA_VERSION, exportedMs: opts.now ?? Date.now(), generator: opts.generator, data: structuredClone(data) };
}

function toPreset(b: (typeof BUILT_IN_BY_ID)[string]): Preset {
  return { id: `${b.id}-export`, name: b.name, description: b.description, basedOn: b.id, createdMs: 0, updatedMs: 0, appearance: b.appearance, layout: b.layout, view: b.view, accessibility: b.accessibility };
}

// ------------------------------------------------------------------ import

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EXECUTABLE = /<\s*script|javascript:|vbscript:|data:\s*text\/html|url\s*\(|@import|expression\s*\(|on\w+\s*=|\$\{|<\s*iframe|<\s*object/i;

export interface ImportIssue { path: string; message: string }

export interface ImportPreview {
  ok: boolean;
  kind?: ExportKind;
  errors: ImportIssue[];
  /** Properties this version does not know; they are dropped. */
  unsupported: string[];
  warnings: string[];
  /** Human-readable list of what would change. */
  changes: Array<{ path: string; before: string; after: string }>;
  /** The configuration that would result; present only when ok. */
  result?: CustomizationConfig;
  summary: string;
}

/** Walk parsed JSON: depth/size limits, forbidden keys and executable-looking strings. */
function scan(v: unknown, path: string, depth: number, issues: ImportIssue[], counter: { n: number }): void {
  if (++counter.n > 50_000) {
    if (counter.n === 50_001) issues.push({ path, message: 'The file contains too many values.' });
    return;
  }
  if (depth > 24) {
    issues.push({ path, message: 'The file is nested too deeply.' });
    return;
  }
  if (typeof v === 'string') {
    if (EXECUTABLE.test(v)) issues.push({ path, message: 'Contains text that looks like code or a remote reference; customization files may only hold values.' });
    return;
  }
  if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}[${i}]`, depth + 1, issues, counter));
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) issues.push({ path: `${path}.${k}`, message: 'Forbidden property name.' });
      else scan((v as Record<string, unknown>)[k], `${path}.${k}`, depth + 1, issues, counter);
    }
  }
}

/** Unknown properties relative to a strict zod schema, found by stripping them one by one. */
function collectUnsupported(schemaIssues: z.ZodIssue[]): string[] {
  const out: string[] = [];
  for (const i of schemaIssues) if (i.code === 'unrecognized_keys') for (const k of i.keys) out.push([...i.path, k].join('.'));
  return out;
}

function stripKeys(v: unknown, paths: string[]): unknown {
  const out = structuredClone(v);
  for (const p of paths) {
    const parts = p.split('.');
    const last = parts.pop()!;
    const parent = parts.length ? getAt(out, parts.map((x) => x)) : out;
    if (parent && typeof parent === 'object') delete (parent as Record<string, unknown>)[last];
  }
  return out;
}

/** Parse with a strict schema, dropping unknown properties (reported) and retrying. */
function parseLenient<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): { value?: T; errors: ImportIssue[]; unsupported: string[] } {
  let current = data;
  const unsupported: string[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = schema.safeParse(current);
    if (r.success) return { value: r.data, errors: [], unsupported };
    const unknown = collectUnsupported(r.error.issues);
    const others = r.error.issues.filter((i) => i.code !== 'unrecognized_keys');
    if (!unknown.length || others.length) return { errors: others.slice(0, 30).map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })), unsupported: [...unsupported, ...unknown] };
    unsupported.push(...unknown);
    current = stripKeys(current, unknown);
  }
  return { errors: [{ path: '(root)', message: 'Too many unsupported properties.' }], unsupported };
}

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) if (!lower.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`;
  return `${base} ${Date.now()}`;
}

function flatten(v: unknown, prefix: string, out: Map<string, string>): void {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else out.set(prefix, JSON.stringify(v) ?? 'undefined');
}

export function describeChanges(before: unknown, after: unknown, limit = 200): Array<{ path: string; before: string; after: string }> {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, '', a);
  flatten(after, '', b);
  const out: Array<{ path: string; before: string; after: string }> = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (k.startsWith('meta.') || k.startsWith('provenance')) continue;
    const x = a.get(k) ?? '—';
    const y = b.get(k) ?? '—';
    if (x !== y) out.push({ path: k, before: x.length > 80 ? `${x.slice(0, 77)}…` : x, after: y.length > 80 ? `${y.slice(0, 77)}…` : y });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Validate an import and compute its result WITHOUT applying it.
 * `knownCommands`, when given, is used to drop references to commands this build does not have.
 */
export function previewImport(text: string, config: CustomizationConfig, opts: { fileName: string; now?: number; knownCommands?: Set<string> }): ImportPreview {
  const fail = (errors: ImportIssue[], extra: Partial<ImportPreview> = {}): ImportPreview => ({ ok: false, errors, unsupported: [], warnings: [], changes: [], summary: errors[0]?.message ?? 'The file cannot be imported.', ...extra });
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return fail([{ path: '(file)', message: 'The file is larger than 2 MB; customization files are much smaller.' }]);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return fail([{ path: '(file)', message: `The file is not valid JSON (${(err as Error).message.slice(0, 120)}).` }]);
  }
  const issues: ImportIssue[] = [];
  scan(json, '', 0, issues, { n: 0 });
  if (issues.length) return fail(issues.slice(0, 30));
  const env = json as Partial<Envelope>;
  if (!env || typeof env !== 'object' || env.format !== PORTABLE_FORMAT) return fail([{ path: 'format', message: 'This is not an Orbis Files customization file.' }]);
  if (env.formatVersion !== PORTABLE_FORMAT_VERSION) return fail([{ path: 'formatVersion', message: `Unsupported file format version ${String(env.formatVersion)} (this version reads ${PORTABLE_FORMAT_VERSION}).` }]);
  if (!(EXPORT_KINDS as readonly string[]).includes(String(env.kind))) return fail([{ path: 'kind', message: `Unknown content “${String(env.kind)}”.` }]);
  if (typeof env.schemaVersion !== 'number' || env.schemaVersion > CUSTOMIZATION_SCHEMA_VERSION) return fail([{ path: 'schemaVersion', message: `It was made by a newer Orbis Files (schema ${String(env.schemaVersion)}); update Orbis Files to import it.` }]);
  const kind = env.kind as ExportKind;
  const warnings: string[] = [];
  const now = opts.now ?? Date.now();
  let next: CustomizationConfig = structuredClone(config);
  let unsupported: string[] = [];
  let summary = '';

  const parse = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T | undefined => {
    const r = parseLenient(schema, data);
    unsupported = r.unsupported;
    if (r.errors.length) {
      issues.push(...r.errors);
      return undefined;
    }
    return r.value;
  };

  switch (kind) {
    case 'complete': {
      let migrated: unknown;
      try {
        migrated = migrateConfig({ ...(env.data as object), schemaVersion: env.schemaVersion }).doc;
      } catch (err) {
        return fail([{ path: 'data', message: (err as Error).message }]);
      }
      const c = parse(CustomizationSchema, migrated);
      if (c) {
        next = { ...c, provenance: config.provenance, meta: { ...c.meta, createdMs: config.meta.createdMs, updatedMs: now } };
        summary = 'Replaces your whole customization (appearance, layout, workspaces, views, toolbar, menus, shortcuts and navigation).';
      }
      break;
    }
    case 'appearance': {
      const a = parse(AppearanceSchema, env.data);
      if (a) next.appearance = a;
      summary = 'Replaces your appearance settings (colours, typography, effects and background).';
      break;
    }
    case 'theme': {
      const p = parse(PresetSchema, env.data);
      if (p) {
        const name = uniqueName(p.name, [...config.presets.map((x) => x.name), ...Object.values(BUILT_IN_BY_ID).map((x) => x.name)]);
        const basedOn = p.basedOn && BUILT_IN_BY_ID[p.basedOn] ? p.basedOn : undefined;
        if (p.basedOn && !basedOn) warnings.push(`It was based on “${p.basedOn}”, which this version does not have; it can still be used but not restored to that original.`);
        next.presets = [...config.presets, { ...p, id: uid('preset'), name, basedOn, createdMs: now, updatedMs: now }];
        if (name !== p.name) warnings.push(`A preset named “${p.name}” already exists; the import is called “${name}”.`);
        summary = `Adds the preset “${name}”. It is not applied until you choose it.`;
      }
      break;
    }
    case 'layout': {
      const l = parse(LayoutFileSchema, env.data);
      if (l) {
        if (config.savedLayouts.length >= 100) {
          issues.push({ path: 'data', message: 'You already have 100 saved layouts.' });
          break;
        }
        const name = uniqueName(l.name, config.savedLayouts.map((x) => x.name));
        next.savedLayouts = [...config.savedLayouts, { id: uid('layout'), name, layout: l.layout, createdMs: now, updatedMs: now }];
        if (name !== l.name) warnings.push(`A layout named “${l.name}” already exists; the import is called “${name}”.`);
        summary = `Adds the layout “${name}” to your saved layouts. Apply it from Layout when you want it.`;
      }
      break;
    }
    case 'workspace': {
      const w = parse(WorkspaceSchema, env.data);
      if (w) {
        if (config.workspaces.length >= 50) {
          issues.push({ path: 'data', message: 'You already have 50 workspaces.' });
          break;
        }
        const name = uniqueName(w.name, config.workspaces.map((x) => x.name));
        const ws: Workspace = { ...w, id: uid('ws'), name, createdMs: now };
        next.workspaces = [...config.workspaces, ws];
        if (name !== w.name) warnings.push(`A workspace named “${w.name}” already exists; the import is called “${name}”.`);
        summary = `Adds the workspace “${name}”. Switching to it never moves or changes files.`;
      }
      break;
    }
    case 'view': {
      const v = parse(SavedViewSchema, env.data) as SavedView | undefined;
      if (v) {
        const name = uniqueName(v.name, config.savedViews.map((x) => x.name));
        next.savedViews = [...config.savedViews, { ...v, id: uid('view'), name, createdMs: now }];
        summary = `Adds the saved view “${name}”.`;
      }
      break;
    }
    case 'shortcuts': {
      const s = parse(ShortcutsSchema, env.data);
      if (s) {
        const bindings = { ...s.bindings };
        if (opts.knownCommands) for (const k of Object.keys(bindings)) if (!opts.knownCommands.has(k)) {
          warnings.push(`“${k}” is not a command in this version; its shortcut is ignored.`);
          delete bindings[k];
        }
        next.shortcuts = { bindings };
        summary = 'Replaces your custom shortcuts.';
      }
      break;
    }
    case 'toolbar': {
      const t = parse(ToolbarSchema, env.data);
      if (t) {
        const keep = (items: typeof t.start) => items.filter((i) => {
          if (!('id' in i) || i.id.startsWith('menu:') || !opts.knownCommands || opts.knownCommands.has(i.id)) return true;
          warnings.push(`“${i.id}” is not a command in this version; it is left out of the toolbar.`);
          return false;
        });
        next.toolbar = { ...t, start: keep(t.start), end: keep(t.end) };
        if (![...next.toolbar.start, ...next.toolbar.end].some((i) => 'id' in i && i.id === 'menu:more')) next.toolbar.end.push({ id: 'menu:more', pinned: true });
        summary = 'Replaces the toolbar layout.';
      }
      break;
    }
    case 'contextMenu': {
      const m = parse(ContextMenuSchema, env.data);
      if (m) {
        next.contextMenu = m;
        summary = 'Replaces the context-menu arrangement. Confirmations for destructive actions are unaffected.';
      }
      break;
    }
    case 'navigation': {
      const n = parse(NavigationSchema, env.data);
      if (n) {
        next.navigation = n;
        if (n.start.kind === 'path') warnings.push(`The start folder ${n.start.path} is checked when Orbis Files starts; if it is missing you start at Home.`);
        summary = 'Replaces the navigation preferences.';
      }
      break;
    }
  }
  if (issues.length) return fail(issues, { kind, unsupported });
  if (next.appearance.background.imagePath) warnings.push(`The background image ${next.appearance.background.imagePath} is only used if it exists on this computer; it is not copied and no folder access is granted.`);
  try {
    next.provenance = [...config.provenance, { kind, fileName: opts.fileName.slice(-260), formatVersion: PORTABLE_FORMAT_VERSION, importedMs: now }].slice(-20);
    next.meta = { ...next.meta, updatedMs: now };
    next = validateConfig(next);
  } catch (err) {
    const ce = err as CustomizationError;
    return fail((ce.details?.length ? ce.details : [ce.message]).map((m) => ({ path: 'result', message: m })), { kind, unsupported });
  }
  if (unsupported.length) warnings.push(`${unsupported.length} propert${unsupported.length === 1 ? 'y is' : 'ies are'} not supported by this version and will be ignored.`);
  return { ok: true, kind, errors: [], unsupported, warnings, changes: describeChanges(config, next), result: next, summary };
}

export function suggestedFileName(kind: ExportKind, label?: string): string {
  const base = (label ?? EXPORT_KIND_LABEL[kind]).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || kind;
  return `${base}.orbis-files.json`;
}
