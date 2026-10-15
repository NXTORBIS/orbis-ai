import { z } from 'zod';
import {
  CustomizationSchema, defaultConfig, DEFAULT_WORKSPACE_ID, PresetSchema, SavedViewShape, ToolbarSchema, ContextMenuSchema, NavigationSchema, LayoutSchema, ColumnSetShape,
  type CustomizationConfig, type LayerValues, type Preset, type SavedView, type Workspace, type Layout, type ColumnConfig,
} from './schema';
import { BUILT_IN_BY_ID, LAYOUT_PRESETS, WORKSPACE_TEMPLATES } from './presets';
import { editTargetFor, findPreset, getAt, resolveCustomization, SECTION_DEFAULTS, setAt, unsetAt, type EditLayer, type Section } from './resolve';

import { COLOR_TOKEN_IDS } from './tokens';
import { normalizeShortcut } from './shortcuts';

/**
 * Declarative customization operations. The renderer sends these; the main
 * process applies them with `applyOp`, validates the whole result and only
 * then persists it. Nothing here touches files.
 */

const SECTION_ORDER = ['appearance', 'layout', 'view', 'accessibility', 'navigation'] as const;
const section = z.enum(SECTION_ORDER);
const target = z.enum(['auto', 'baseline', 'preset', 'workspace']);
const pathArr = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).min(1).max(6);
const id = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const name = z.string().trim().min(1).max(60);

export const CustomOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), target: target.default('auto'), section, path: pathArr, value: z.unknown(), label: z.string().max(80).optional() }),
  z.object({ op: z.literal('unset'), target: z.enum(['baseline', 'preset', 'workspace']), section, path: pathArr }),
  z.object({ op: z.literal('setColor'), target: target.default('auto'), mode: z.enum(['dark', 'light']), token: z.enum(COLOR_TOKEN_IDS), value: z.string().max(64) }),
  z.object({ op: z.literal('resetColor'), target: z.enum(['baseline', 'preset', 'workspace']), mode: z.enum(['dark', 'light']), token: z.enum(COLOR_TOKEN_IDS) }),
  z.object({ op: z.literal('resetCategory'), category: z.enum(['appearance', 'colors', 'typography', 'layout', 'view', 'accessibility', 'navigation', 'toolbar', 'contextMenu', 'shortcuts', 'background']), target: z.enum(['baseline', 'preset', 'workspace']).default('baseline') }),
  z.object({ op: z.literal('replace'), key: z.enum(['toolbar', 'contextMenu', 'navigation']), value: z.unknown(), target: z.enum(['baseline', 'workspace']).default('baseline') }),
  z.object({ op: z.literal('setShortcut'), command: z.string().regex(/^[a-z][A-Za-z0-9.:-]{1,63}$/), keys: z.array(z.string().max(40)).max(4) }),
  z.object({ op: z.literal('resetShortcut'), command: z.string().regex(/^[a-z][A-Za-z0-9.:-]{1,63}$/) }),
  z.object({ op: z.literal('resetAllShortcuts') }),
  z.object({ op: z.literal('applyPreset'), id: id.nullable() }),
  z.object({ op: z.literal('savePreset'), name, description: z.string().max(300).optional() }),
  z.object({ op: z.literal('duplicatePreset'), id, name: name.optional() }),
  z.object({ op: z.literal('renamePreset'), id, name }),
  z.object({ op: z.literal('deletePreset'), id }),
  z.object({ op: z.literal('restorePreset'), id }),
  z.object({ op: z.literal('createWorkspace'), name, template: id.optional(), fromCurrent: z.boolean().default(false), activate: z.boolean().default(true) }),
  z.object({ op: z.literal('renameWorkspace'), id, name }),
  z.object({ op: z.literal('duplicateWorkspace'), id, name: name.optional() }),
  z.object({ op: z.literal('moveWorkspace'), id, toIndex: z.number().int().min(0).max(49) }),
  z.object({ op: z.literal('deleteWorkspace'), id }),
  z.object({ op: z.literal('activateWorkspace'), id }),
  z.object({ op: z.literal('restoreDefaultWorkspace') }),
  z.object({ op: z.literal('addSavedFilter'), name, filter: z.string().max(200) }),
  z.object({ op: z.literal('removeSavedFilter'), id }),
  z.object({ op: z.literal('saveView'), view: z.unknown() }),
  z.object({ op: z.literal('updateView'), id, view: z.unknown() }),
  z.object({ op: z.literal('renameView'), id, name }),
  z.object({ op: z.literal('deleteView'), id }),
  z.object({ op: z.literal('resetAll') }),
  // Layouts: apply a complete layout (editor Apply), built-in layout presets, saved layouts.
  z.object({ op: z.literal('setLayout'), layout: z.unknown(), label: z.string().max(80).optional() }),
  z.object({ op: z.literal('applyLayoutPreset'), id }),
  z.object({ op: z.literal('saveLayout'), name, layout: z.unknown().optional() }),
  z.object({ op: z.literal('updateLayout'), id, layout: z.unknown().optional() }),
  z.object({ op: z.literal('duplicateLayout'), id, name: name.optional() }),
  z.object({ op: z.literal('renameLayout'), id, name }),
  z.object({ op: z.literal('deleteLayout'), id }),
  z.object({ op: z.literal('applyLayout'), id }),
  z.object({ op: z.literal('moveLayout'), id, toIndex: z.number().int().min(0).max(99) }),
  z.object({ op: z.literal('moveView'), id, toIndex: z.number().int().min(0).max(199) }),
  // Column sets.
  z.object({ op: z.literal('saveColumns'), name, columns: z.unknown().optional() }),
  z.object({ op: z.literal('applyColumns'), id }),
  z.object({ op: z.literal('renameColumns'), id, name }),
  z.object({ op: z.literal('deleteColumns'), id }),
  // Saved views: the configuration part (columns, sizes, density, preview); the pane applies view/sort/group/filter itself.
  z.object({ op: z.literal('applyView'), id }),
  // Several simple edits as one undoable change.
  z.object({ op: z.literal('batch'), label: z.string().min(1).max(80), ops: z.array(z.discriminatedUnion('op', [
    z.object({ op: z.literal('set'), target: target.default('auto'), section, path: pathArr, value: z.unknown() }),
    z.object({ op: z.literal('unset'), target: z.enum(['baseline', 'preset', 'workspace']), section, path: pathArr }),
  ])).min(1).max(40) }),
]);
export type CustomOp = z.input<typeof CustomOpSchema>;

export interface OpResult { config: CustomizationConfig; label: string; coalesceKey?: string; major?: boolean; notice?: string }

export class CustomizationError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
  }
}

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const n = `${base.slice(0, 54)} (${i})`;
    if (!lower.has(n.toLowerCase())) return n;
  }
  return `${base.slice(0, 50)} ${Date.now() % 10000}`;
}

/** Where the layer for an edit lives, creating a user copy when a built-in preset would have to change. */
function layerFor(config: CustomizationConfig, t: 'auto' | EditLayer, sec: Section | 'toolbar', path: string[]): EditLayer {
  return t === 'auto' ? editTargetFor(config, sec, path) : t;
}

function writeLayer(config: CustomizationConfig, layer: EditLayer, fullPath: string[], value: unknown): CustomizationConfig {
  if (layer === 'baseline') return setAt(config, fullPath, value);
  if (layer === 'workspace') {
    return { ...config, workspaces: config.workspaces.map((w) => (w.id === config.activeWorkspaceId ? setAt(w, ['overrides', ...fullPath], value) : w)) };
  }
  const p = findPreset(config, config.activePresetId);
  if (!p) throw new CustomizationError('No preset is selected, so there is no preset to change.');
  if ('builtIn' in p && p.builtIn) throw new CustomizationError(`“${p.name}” is a built-in preset and cannot be changed. Duplicate it to make your own version.`);
  return { ...config, presets: config.presets.map((x) => (x.id === p.id ? { ...setAt(x, fullPath, value), updatedMs: Date.now() } : x)) };
}

function clearLayer(config: CustomizationConfig, layer: EditLayer, fullPath: string[]): CustomizationConfig {
  if (layer === 'baseline') {
    const def = getAt(SECTION_DEFAULTS, fullPath) ?? getAt({ toolbar: defaultConfig(0).toolbar, contextMenu: defaultConfig(0).contextMenu, shortcuts: defaultConfig(0).shortcuts }, fullPath);
    return def === undefined ? unsetAt(config, fullPath) : setAt(config, fullPath, structuredClone(def));
  }
  if (layer === 'workspace') return { ...config, workspaces: config.workspaces.map((w) => (w.id === config.activeWorkspaceId ? { ...w, overrides: unsetAt(w.overrides, fullPath) } : w)) };
  const p = findPreset(config, config.activePresetId);
  if (!p || ('builtIn' in p && p.builtIn)) throw new CustomizationError('Built-in presets cannot be changed.');
  return { ...config, presets: config.presets.map((x) => (x.id === p.id ? { ...unsetAt(x, fullPath), updatedMs: Date.now() } : x)) };
}

/** Values that differ from the application defaults: what "save as preset" or "workspace from current" captures. */
function diffFromDefaults(def: unknown, val: unknown): unknown {
  if (def && val && typeof def === 'object' && typeof val === 'object' && !Array.isArray(def) && !Array.isArray(val)) {
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(def), ...Object.keys(val)])) {
      const d = diffFromDefaults((def as Record<string, unknown>)[k], (val as Record<string, unknown>)[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(def) === JSON.stringify(val) ? undefined : structuredClone(val);
}

function effectiveLayer(config: CustomizationConfig, systemDark: boolean): LayerValues {
  const r = resolveCustomization(config, { systemDark });
  const out: LayerValues = {};
  for (const s of SECTION_ORDER) {
    const d = diffFromDefaults(SECTION_DEFAULTS[s], r[s]);
    if (d) (out as Record<string, unknown>)[s] = d;
  }
  // Colours captured are the explicit overrides (not values derived by safeguards).
  const colors = { dark: { ...(config.appearance.colors.dark ?? {}) }, light: { ...(config.appearance.colors.light ?? {}) } };
  const p = findPreset(config, config.activePresetId);
  const ws = config.workspaces.find((w) => w.id === config.activeWorkspaceId);
  for (const layer of [p?.appearance?.colors, ws?.overrides.appearance?.colors]) {
    Object.assign(colors.dark, layer?.dark ?? {});
    Object.assign(colors.light, layer?.light ?? {});
  }
  if (Object.keys(colors.dark).length || Object.keys(colors.light).length) out.appearance = { ...(out.appearance ?? {}), colors };
  else if (out.appearance) delete (out.appearance as Record<string, unknown>).colors;
  return out;
}

export function applyOp(config: CustomizationConfig, rawOp: CustomOp, ctx: { systemDark: boolean; now?: number }): OpResult {
  const op = CustomOpSchema.parse(rawOp);
  const now = ctx.now ?? Date.now();
  switch (op.op) {
    case 'set': {
      const layer = layerFor(config, op.target, op.section, op.path);
      return { config: writeLayer(config, layer, [op.section, ...op.path], op.value), label: op.label ?? `Changed ${[op.section, ...op.path].join(' › ')}`, coalesceKey: `set:${layer}:${op.section}.${op.path.join('.')}` };
    }
    case 'unset':
      return { config: clearLayer(config, op.target, [op.section, ...op.path]), label: `Reset ${[op.section, ...op.path].join(' › ')}` };
    case 'setColor': {
      const path = ['colors', op.mode, op.token];
      const layer = layerFor(config, op.target, 'appearance', path);
      return { config: writeLayer(config, layer, ['appearance', ...path], op.value), label: `Changed colour “${op.token}”`, coalesceKey: `color:${layer}:${op.mode}.${op.token}` };
    }
    case 'resetColor':
      return { config: clearLayer(config, op.target, ['appearance', 'colors', op.mode, op.token]), label: `Reset colour “${op.token}”` };
    case 'resetCategory': {
      const map: Record<string, string[][]> = {
        appearance: [['appearance']], colors: [['appearance', 'colors']], background: [['appearance', 'background']],
        typography: [['appearance', 'fontScale'], ['appearance', 'fontWeight'], ['appearance', 'lineHeight'], ['appearance', 'fontFamily'], ['appearance', 'density'], ['appearance', 'rowHeight'], ['appearance', 'iconSize'], ['appearance', 'thumbnailSize'], ['appearance', 'toolbarHeight'], ['appearance', 'tabHeight']],
        layout: [['layout']], view: [['view']], accessibility: [['accessibility']], navigation: [['navigation']], toolbar: [['toolbar']], contextMenu: [['contextMenu']], shortcuts: [['shortcuts']],
      };
      let c = config;
      for (const p of map[op.category]!) c = op.target === 'baseline' && p.length === 1 && ['toolbar', 'contextMenu', 'shortcuts'].includes(p[0]!) ? { ...c, [p[0]!]: (defaultConfig(0) as unknown as Record<string, unknown>)[p[0]!] } : clearLayer(c, op.target, p);
      return { config: c, label: `Reset ${op.category}`, major: true };
    }
    case 'replace': {
      const schema = op.key === 'toolbar' ? ToolbarSchema : op.key === 'contextMenu' ? ContextMenuSchema : NavigationSchema;
      const parsed = schema.safeParse(op.value);
      if (!parsed.success) throw new CustomizationError(`The ${op.key} configuration is not valid.`, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      let value = parsed.data as Record<string, unknown>;
      if (op.key === 'toolbar') value = ensureMore(value as never) as never;
      if (op.target === 'workspace') {
        if (op.key === 'contextMenu') throw new CustomizationError('Context menus are global, not per workspace.');
        return { config: writeLayer(config, 'workspace', [op.key], value), label: `Changed ${op.key} for this workspace` };
      }
      return { config: { ...config, [op.key]: value }, label: `Changed ${op.key}` };
    }
    case 'setShortcut': {
      const keys: string[] = [];
      for (const k of op.keys) {
        const n = normalizeShortcut(k);
        if (!n.ok) throw new CustomizationError(n.reason);
        if (!keys.includes(n.value)) keys.push(n.value);
      }
      return { config: { ...config, shortcuts: { bindings: { ...config.shortcuts.bindings, [op.command]: keys } } }, label: `Shortcut for ${op.command}` };
    }
    case 'resetShortcut': {
      const b = { ...config.shortcuts.bindings };
      delete b[op.command];
      return { config: { ...config, shortcuts: { bindings: b } }, label: `Default shortcut for ${op.command}` };
    }
    case 'resetAllShortcuts':
      return { config: { ...config, shortcuts: { bindings: {} } }, label: 'Default shortcuts', major: true };
    case 'applyPreset': {
      if (op.id && !findPreset(config, op.id)) throw new CustomizationError('That preset does not exist.');
      return { config: { ...config, activePresetId: op.id }, label: op.id ? `Applied preset ${findPreset(config, op.id)!.name}` : 'No preset', major: true };
    }
    case 'savePreset': {
      const nm = uniqueName(op.name, [...config.presets.map((p) => p.name), ...Object.values(BUILT_IN_BY_ID).map((p) => p.name)]);
      const layer = effectiveLayer(config, ctx.systemDark);
      const preset: Preset = { id: uid('preset'), name: nm, description: op.description ?? '', createdMs: now, updatedMs: now, appearance: layer.appearance, layout: layer.layout, view: layer.view, accessibility: layer.accessibility };
      return { config: { ...config, presets: [...config.presets, PresetSchema.parse(preset)], activePresetId: preset.id }, label: `Saved preset ${nm}`, major: true };
    }
    case 'duplicatePreset': {
      const src = findPreset(config, op.id);
      if (!src) throw new CustomizationError('That preset does not exist.');
      const builtIn = 'builtIn' in src && src.builtIn;
      const nm = uniqueName(op.name ?? `${src.name} copy`, [...config.presets.map((p) => p.name), ...Object.values(BUILT_IN_BY_ID).map((p) => p.name)]);
      const copy: Preset = { id: uid('preset'), name: nm, description: src.description, basedOn: builtIn ? src.id : (src as Preset).basedOn, createdMs: now, updatedMs: now, appearance: structuredClone(src.appearance), layout: structuredClone(src.layout), view: structuredClone(src.view), accessibility: structuredClone(src.accessibility) };
      return { config: { ...config, presets: [...config.presets, PresetSchema.parse(copy)] }, label: `Duplicated preset ${src.name}` };
    }
    case 'renamePreset': {
      if (BUILT_IN_BY_ID[op.id]) throw new CustomizationError('Built-in presets keep their names. Duplicate one to rename your copy.');
      if (!config.presets.some((p) => p.id === op.id)) throw new CustomizationError('That preset does not exist.');
      if ([...config.presets.filter((p) => p.id !== op.id).map((p) => p.name), ...Object.values(BUILT_IN_BY_ID).map((p) => p.name)].some((n) => n.toLowerCase() === op.name.toLowerCase())) throw new CustomizationError(`A preset named “${op.name}” already exists.`);
      return { config: { ...config, presets: config.presets.map((p) => (p.id === op.id ? { ...p, name: op.name, updatedMs: now } : p)) }, label: `Renamed preset to ${op.name}` };
    }
    case 'deletePreset': {
      if (BUILT_IN_BY_ID[op.id]) throw new CustomizationError('Built-in presets cannot be deleted.');
      const p = config.presets.find((x) => x.id === op.id);
      if (!p) throw new CustomizationError('That preset does not exist.');
      return { config: { ...config, presets: config.presets.filter((x) => x.id !== op.id), activePresetId: config.activePresetId === op.id ? 'orbis-native' : config.activePresetId }, label: `Deleted preset ${p.name}`, major: true };
    }
    case 'restorePreset': {
      const p = config.presets.find((x) => x.id === op.id);
      const base = p?.basedOn ? BUILT_IN_BY_ID[p.basedOn] : BUILT_IN_BY_ID[op.id];
      if (!base) throw new CustomizationError('This preset was not copied from a built-in preset, so there is nothing to restore it to.');
      if (!p) return { config: { ...config, activePresetId: base.id }, label: `Restored ${base.name}`, major: true };
      return { config: { ...config, presets: config.presets.map((x) => (x.id === p.id ? { ...x, appearance: structuredClone(base.appearance), layout: structuredClone(base.layout), view: structuredClone(base.view), accessibility: structuredClone(base.accessibility), updatedMs: now } : x)) }, label: `Restored ${p.name} to ${base.name}`, major: true };
    }
    case 'createWorkspace': {
      if (config.workspaces.length >= 50) throw new CustomizationError('You can have up to 50 workspaces.');
      const nm = uniqueName(op.name, config.workspaces.map((w) => w.name));
      const tpl = op.template ? WORKSPACE_TEMPLATES.find((t) => t.id === op.template) : undefined;
      if (op.template && !tpl) throw new CustomizationError('Unknown workspace template.');
      const overrides = op.fromCurrent ? workspaceFromCurrent(config, ctx.systemDark) : structuredClone(tpl?.overrides ?? {});
      const ws: Workspace = { id: uid('ws'), name: nm, createdMs: now, overrides, savedFilters: [] };
      return { config: { ...config, workspaces: [...config.workspaces, ws], activeWorkspaceId: op.activate ? ws.id : config.activeWorkspaceId }, label: `Created workspace ${nm}`, major: true };
    }
    case 'renameWorkspace': {
      if (!config.workspaces.some((w) => w.id === op.id)) throw new CustomizationError('That workspace does not exist.');
      if (config.workspaces.some((w) => w.id !== op.id && w.name.toLowerCase() === op.name.toLowerCase())) throw new CustomizationError(`A workspace named “${op.name}” already exists.`);
      return { config: { ...config, workspaces: config.workspaces.map((w) => (w.id === op.id ? { ...w, name: op.name } : w)) }, label: `Renamed workspace to ${op.name}` };
    }
    case 'duplicateWorkspace': {
      const src = config.workspaces.find((w) => w.id === op.id);
      if (!src) throw new CustomizationError('That workspace does not exist.');
      if (config.workspaces.length >= 50) throw new CustomizationError('You can have up to 50 workspaces.');
      const nm = uniqueName(op.name ?? `${src.name} copy`, config.workspaces.map((w) => w.name));
      const copy: Workspace = { ...structuredClone(src), id: uid('ws'), name: nm, createdMs: now };
      const i = config.workspaces.indexOf(src);
      return { config: { ...config, workspaces: [...config.workspaces.slice(0, i + 1), copy, ...config.workspaces.slice(i + 1)] }, label: `Duplicated workspace ${src.name}` };
    }
    case 'moveWorkspace': {
      const i = config.workspaces.findIndex((w) => w.id === op.id);
      if (i < 0) throw new CustomizationError('That workspace does not exist.');
      const list = [...config.workspaces];
      const [w] = list.splice(i, 1);
      list.splice(Math.min(op.toIndex, list.length), 0, w!);
      return { config: { ...config, workspaces: list }, label: `Moved workspace ${w!.name}` };
    }
    case 'deleteWorkspace': {
      const w = config.workspaces.find((x) => x.id === op.id);
      if (!w) throw new CustomizationError('That workspace does not exist.');
      if (config.workspaces.length === 1) throw new CustomizationError('The last workspace cannot be deleted. Restore it to its defaults instead.');
      const rest = config.workspaces.filter((x) => x.id !== op.id);
      return { config: { ...config, workspaces: rest, activeWorkspaceId: config.activeWorkspaceId === op.id ? rest[0]!.id : config.activeWorkspaceId }, label: `Deleted workspace ${w.name}`, major: true, notice: 'Only the workspace settings were deleted. No files or folders were touched.' };
    }
    case 'activateWorkspace': {
      const w = config.workspaces.find((x) => x.id === op.id);
      if (!w) throw new CustomizationError('That workspace does not exist.');
      return { config: { ...config, activeWorkspaceId: op.id }, label: `Switched to workspace ${w.name}` };
    }
    case 'restoreDefaultWorkspace': {
      const exists = config.workspaces.find((w) => w.id === DEFAULT_WORKSPACE_ID);
      const def: Workspace = { id: DEFAULT_WORKSPACE_ID, name: exists?.name ?? 'Everyday', createdMs: exists?.createdMs ?? now, overrides: {}, savedFilters: exists?.savedFilters ?? [] };
      const list = exists ? config.workspaces.map((w) => (w.id === DEFAULT_WORKSPACE_ID ? def : w)) : [def, ...config.workspaces];
      return { config: { ...config, workspaces: list, activeWorkspaceId: DEFAULT_WORKSPACE_ID }, label: 'Restored the default workspace', major: true };
    }
    case 'addSavedFilter':
      return { config: { ...config, workspaces: config.workspaces.map((w) => (w.id === config.activeWorkspaceId ? { ...w, savedFilters: [...w.savedFilters, { id: uid('flt'), name: op.name, filter: op.filter }] } : w)) }, label: `Saved filter ${op.name}` };
    case 'removeSavedFilter':
      return { config: { ...config, workspaces: config.workspaces.map((w) => (w.id === config.activeWorkspaceId ? { ...w, savedFilters: w.savedFilters.filter((f) => f.id !== op.id) } : w)) }, label: 'Removed a saved filter' };
    case 'saveView': {
      const v = SavedViewShape.omit({ id: true, createdMs: true }).safeParse(op.view);
      if (!v.success) throw new CustomizationError('The view is not valid.', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      const nm = uniqueName(v.data.name, config.savedViews.map((x) => x.name));
      const view: SavedView = { ...v.data, name: nm, id: uid('view'), createdMs: now };
      return { config: { ...config, savedViews: [...config.savedViews, view] }, label: `Saved view ${nm}` };
    }
    case 'updateView': {
      const v = SavedViewShape.omit({ id: true, createdMs: true }).safeParse(op.view);
      if (!v.success) throw new CustomizationError('The view is not valid.', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      if (!config.savedViews.some((x) => x.id === op.id)) throw new CustomizationError('That view does not exist.');
      return { config: { ...config, savedViews: config.savedViews.map((x) => (x.id === op.id ? { ...x, ...v.data, id: x.id, createdMs: x.createdMs } : x)) }, label: `Updated view ${v.data.name}` };
    }
    case 'renameView':
      if (!config.savedViews.some((x) => x.id === op.id)) throw new CustomizationError('That view does not exist.');
      return { config: { ...config, savedViews: config.savedViews.map((x) => (x.id === op.id ? { ...x, name: op.name } : x)) }, label: `Renamed view to ${op.name}` };
    case 'deleteView':
      return { config: { ...config, savedViews: config.savedViews.filter((x) => x.id !== op.id) }, label: 'Deleted a saved view' };
    case 'resetAll':
      return { config: { ...defaultConfig(now), meta: { createdMs: config.meta.createdMs, updatedMs: now } }, label: 'Restored all default customization', major: true };
    case 'setLayout':
      return { config: withLayout(config, parseLayout(op.layout), ctx.systemDark), label: op.label ?? 'Changed the layout', major: true };
    case 'applyLayoutPreset': {
      const lp = LAYOUT_PRESETS.find((x) => x.id === op.id);
      if (!lp) throw new CustomizationError('Unknown layout preset.');
      const cur = resolveCustomization(config, { systemDark: ctx.systemDark }).layout;
      return { config: withLayout(config, parseLayout(mergeDeep(cur, lp.layout)), ctx.systemDark), label: `Layout: ${lp.name}`, major: true };
    }
    case 'saveLayout': {
      if (config.savedLayouts.length >= 100) throw new CustomizationError('You can save up to 100 layouts.');
      const layout = op.layout === undefined ? resolveCustomization(config, { systemDark: ctx.systemDark }).layout : parseLayout(op.layout);
      const nm = uniqueName(op.name, config.savedLayouts.map((l) => l.name));
      return { config: { ...config, savedLayouts: [...config.savedLayouts, { id: uid('layout'), name: nm, layout, createdMs: now, updatedMs: now }] }, label: `Saved layout ${nm}` };
    }
    case 'updateLayout': {
      const l = config.savedLayouts.find((x) => x.id === op.id);
      if (!l) throw new CustomizationError('That layout does not exist.');
      const layout = op.layout === undefined ? resolveCustomization(config, { systemDark: ctx.systemDark }).layout : parseLayout(op.layout);
      return { config: { ...config, savedLayouts: config.savedLayouts.map((x) => (x.id === op.id ? { ...x, layout, updatedMs: now } : x)) }, label: `Updated layout ${l.name}` };
    }
    case 'duplicateLayout': {
      const l = config.savedLayouts.find((x) => x.id === op.id);
      if (!l) throw new CustomizationError('That layout does not exist.');
      if (config.savedLayouts.length >= 100) throw new CustomizationError('You can save up to 100 layouts.');
      const nm = uniqueName(op.name ?? `${l.name} copy`, config.savedLayouts.map((x) => x.name));
      const i = config.savedLayouts.indexOf(l);
      const copy = { ...structuredClone(l), id: uid('layout'), name: nm, createdMs: now, updatedMs: now };
      return { config: { ...config, savedLayouts: [...config.savedLayouts.slice(0, i + 1), copy, ...config.savedLayouts.slice(i + 1)] }, label: `Duplicated layout ${l.name}` };
    }
    case 'renameLayout': {
      if (!config.savedLayouts.some((x) => x.id === op.id)) throw new CustomizationError('That layout does not exist.');
      if (config.savedLayouts.some((x) => x.id !== op.id && x.name.toLowerCase() === op.name.toLowerCase())) throw new CustomizationError(`A layout named “${op.name}” already exists.`);
      return { config: { ...config, savedLayouts: config.savedLayouts.map((x) => (x.id === op.id ? { ...x, name: op.name, updatedMs: now } : x)) }, label: `Renamed layout to ${op.name}` };
    }
    case 'deleteLayout': {
      const l = config.savedLayouts.find((x) => x.id === op.id);
      if (!l) throw new CustomizationError('That layout does not exist.');
      return { config: { ...config, savedLayouts: config.savedLayouts.filter((x) => x.id !== op.id) }, label: `Deleted layout ${l.name}` };
    }
    case 'applyLayout': {
      const l = config.savedLayouts.find((x) => x.id === op.id);
      if (!l) throw new CustomizationError('That layout does not exist.');
      return { config: withLayout(config, l.layout, ctx.systemDark), label: `Layout: ${l.name}`, major: true };
    }
    case 'moveLayout': {
      const i = config.savedLayouts.findIndex((x) => x.id === op.id);
      if (i < 0) throw new CustomizationError('That layout does not exist.');
      const list = [...config.savedLayouts];
      const [x] = list.splice(i, 1);
      list.splice(Math.min(op.toIndex, list.length), 0, x!);
      return { config: { ...config, savedLayouts: list }, label: `Moved layout ${x!.name}` };
    }
    case 'moveView': {
      const i = config.savedViews.findIndex((x) => x.id === op.id);
      if (i < 0) throw new CustomizationError('That view does not exist.');
      const list = [...config.savedViews];
      const [x] = list.splice(i, 1);
      list.splice(Math.min(op.toIndex, list.length), 0, x!);
      return { config: { ...config, savedViews: list }, label: `Moved view ${x!.name}` };
    }
    case 'saveColumns': {
      if (config.columnSets.length >= 100) throw new CustomizationError('You can save up to 100 column sets.');
      const columns = op.columns === undefined ? resolveCustomization(config, { systemDark: ctx.systemDark }).view.columns : op.columns;
      const nm = uniqueName(op.name, config.columnSets.map((c) => c.name));
      const parsed = ColumnSetShape.safeParse({ id: uid('cols'), name: nm, columns, createdMs: now });
      if (!parsed.success) throw new CustomizationError('The columns are not valid.', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return { config: { ...config, columnSets: [...config.columnSets, parsed.data as { id: string; name: string; columns: ColumnConfig[]; createdMs: number }] }, label: `Saved column set ${nm}` };
    }
    case 'applyColumns': {
      const cs = config.columnSets.find((x) => x.id === op.id);
      if (!cs) throw new CustomizationError('That column set does not exist.');
      const layer = editTargetFor(config, 'view', ['columns']);
      return { config: writeLayer(config, layer, ['view', 'columns'], structuredClone(cs.columns)), label: `Columns: ${cs.name}` };
    }
    case 'renameColumns': {
      if (!config.columnSets.some((x) => x.id === op.id)) throw new CustomizationError('That column set does not exist.');
      return { config: { ...config, columnSets: config.columnSets.map((x) => (x.id === op.id ? { ...x, name: op.name } : x)) }, label: `Renamed column set to ${op.name}` };
    }
    case 'deleteColumns':
      return { config: { ...config, columnSets: config.columnSets.filter((x) => x.id !== op.id) }, label: 'Deleted a column set' };
    case 'applyView': {
      const v = config.savedViews.find((x) => x.id === op.id);
      if (!v) throw new CustomizationError('That view does not exist.');
      let c = config;
      const put = (section: Section, path: string[], value: unknown) => {
        c = writeLayer(c, editTargetFor(c, section, path), [section, ...path], value);
      };
      put('view', ['columns'], structuredClone(v.columns));
      if (v.iconSize !== undefined) put('appearance', ['iconSize'], v.iconSize);
      if (v.thumbnailSize !== undefined) put('appearance', ['thumbnailSize'], v.thumbnailSize);
      if (v.density !== undefined) put('appearance', ['density'], v.density);
      if (v.previewVisible !== undefined) put('layout', ['details', 'visible'], v.previewVisible);
      return { config: c, label: `Applied view ${v.name}` };
    }
    case 'batch': {
      let c = config;
      for (const sub of op.ops) {
        if (sub.op === 'set') c = writeLayer(c, layerFor(c, sub.target, sub.section, sub.path), [sub.section, ...sub.path], sub.value);
        else c = clearLayer(c, sub.target, [sub.section, ...sub.path]);
      }
      return { config: c, label: op.label, coalesceKey: `batch:${op.label}` };
    }
  }
}

function parseLayout(raw: unknown): Layout {
  const p = LayoutSchema.safeParse(raw);
  if (!p.success) throw new CustomizationError('The layout is not valid.', p.error.issues.map((i) => `${i.path.join('.') || 'layout'}: ${i.message}`));
  return p.data;
}

function mergeDeep<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over) || !base || typeof base !== 'object' || Array.isArray(base)) return (over === undefined ? base : structuredClone(over)) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) if (v !== undefined) out[k] = mergeDeep(out[k], v);
  return out as T;
}

/**
 * Make `layout` the effective layout of the active workspace: the workspace
 * stores only what differs from the layers below it (baseline and preset),
 * so later changes to those still show through where the workspace agrees.
 */
function withLayout(config: CustomizationConfig, layout: Layout, systemDark: boolean): CustomizationConfig {
  const ws = config.workspaces.find((w) => w.id === config.activeWorkspaceId);
  if (!ws) return config;
  const without: CustomizationConfig = { ...config, workspaces: config.workspaces.map((w) => (w.id === ws.id ? { ...w, overrides: { ...w.overrides, layout: undefined } } : w)) };
  const lower = resolveCustomization(without, { systemDark }).layout;
  const diff = diffFromDefaults(lower, layout) as LayerValues['layout'] | undefined;
  return { ...config, workspaces: config.workspaces.map((w) => (w.id === ws.id ? { ...w, overrides: cleanOverrides({ ...w.overrides, layout: diff }) } : w)) };
}

function cleanOverrides(o: LayerValues): LayerValues {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as LayerValues;
}

function workspaceFromCurrent(config: CustomizationConfig, systemDark: boolean): LayerValues {
  const l = effectiveLayer(config, systemDark);
  const ws = config.workspaces.find((w) => w.id === config.activeWorkspaceId);
  // A workspace snapshot keeps layout and view choices; appearance stays with the preset and baseline.
  return { layout: l.layout, view: l.view, toolbar: ws?.overrides.toolbar, navigation: ws?.overrides.navigation };
}

function ensureMore<T extends { start: Array<{ id?: string }>; end: Array<{ id?: string }> }>(t: T): T {
  const has = [...t.start, ...t.end].some((i) => i.id === 'menu:more');
  return has ? t : { ...t, end: [...t.end, { id: 'menu:more', pinned: true }] };
}

/**
 * Validate a whole configuration: schema, then references between parts.
 * Returns the parsed configuration or throws with every problem listed.
 */
export function validateConfig(raw: unknown): CustomizationConfig {
  const parsed = CustomizationSchema.safeParse(raw);
  if (!parsed.success) throw new CustomizationError('The customization is not valid.', parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  const c = parsed.data;
  const problems: string[] = [];
  const dup = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const i of ids) {
      if (seen.has(i)) problems.push(`${what} id “${i}” is used twice.`);
      seen.add(i);
    }
  };
  dup(c.presets.map((p) => p.id), 'Preset');
  dup(c.workspaces.map((w) => w.id), 'Workspace');
  dup(c.savedViews.map((v) => v.id), 'Saved view');
  dup(c.savedLayouts.map((v) => v.id), 'Saved layout');
  dup(c.columnSets.map((v) => v.id), 'Column set');
  for (const p of c.presets) {
    if (BUILT_IN_BY_ID[p.id]) problems.push(`Preset id “${p.id}” belongs to a built-in preset.`);
    if (p.basedOn && !BUILT_IN_BY_ID[p.basedOn]) problems.push(`Preset “${p.name}” refers to an unknown built-in preset “${p.basedOn}”.`);
  }
  if (c.activePresetId && !findPreset(c, c.activePresetId)) problems.push(`The active preset “${c.activePresetId}” does not exist.`);
  if (!c.workspaces.some((w) => w.id === c.activeWorkspaceId)) problems.push(`The active workspace “${c.activeWorkspaceId}” does not exist.`);
  const toolbars = [c.toolbar, ...c.workspaces.map((w) => w.overrides.toolbar).filter((t): t is NonNullable<typeof t> => !!t)];
  for (const t of toolbars) if (![...t.start, ...t.end].some((i) => 'id' in i && i.id === 'menu:more')) problems.push('Every toolbar keeps its “More” menu, so no command becomes unreachable.');
  const sections = c.navigation.sections.map((s) => s.id);
  if (new Set(sections).size !== sections.length) problems.push('A sidebar section is listed twice.');
  if (problems.length) throw new CustomizationError('The customization refers to things that do not exist or is inconsistent.', problems);
  return c;
}
