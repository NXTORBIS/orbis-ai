import { z } from 'zod';
import { COLOR_TOKEN_IDS } from './tokens';
import { parseColor } from './color';
import { normalizeShortcut } from './shortcuts';

/**
 * Customization configuration — schema version 1.
 *
 * One typed, validated document per profile. Layers (see resolve.ts):
 *   constraints > application defaults > baseline (this document) > preset > workspace > per-pane view.
 * The active configuration, the last known-good copy and backups are stored
 * separately (main/customization/CustomizationService.ts).
 *
 * Every object is strict: unknown properties are reported, never kept.
 * Missing properties are filled from the defaults below before validation,
 * so a document only needs the values that differ.
 */
export const CUSTOMIZATION_SCHEMA_VERSION = 2;

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Fill missing properties from `defaults`, recursively. Arrays and scalars are taken as given. */
export function withDefaults<T>(defaults: T, value: unknown): unknown {
  if (value === undefined) return structuredClone(defaults);
  if (isPlain(defaults) && isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(defaults)) out[k] = withDefaults((defaults as Record<string, unknown>)[k], value[k]);
    for (const k of Object.keys(value)) if (!(k in out)) out[k] = value[k];
    return out;
  }
  return value;
}

const filled = <S extends z.ZodTypeAny>(shape: S, defaults: z.input<S>) => z.preprocess((v) => withDefaults(defaults, v), shape) as unknown as z.ZodType<z.output<S>, z.ZodTypeDef, unknown>;

const idStr = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Identifiers use letters, digits, ".", "_" or "-" (max 64).');
const nameStr = z.string().trim().min(1, 'A name is required.').max(60, 'Names are limited to 60 characters.');
const cmdId = z.string().regex(/^[a-z][A-Za-z0-9.:-]{1,63}$/, 'Not a command identifier.');
export const colorStr = z.string().max(64).refine((v) => !!parseColor(v), (v) => ({ message: `"${String(v).slice(0, 40)}" is not a colour (use #rrggbb, rgb() or hsl()).` })).transform((v) => parseColor(v)!);
const tokenOverrides = z.record(z.enum(COLOR_TOKEN_IDS), colorStr);
const absImage = z.string().max(4096).refine((p) => p === '' || ((/^\//.test(p) || /^[A-Za-z]:[\\/]/.test(p)) && /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(p)), 'Backgrounds must be local image files (PNG, JPEG, WebP, GIF, AVIF or BMP) given as an absolute path.');

// ------------------------------------------------------------------ appearance

export const BackgroundShape = z.object({
  kind: z.enum(['none', 'solid', 'gradient', 'image']),
  /** Where the background shows: the Home view only, or behind every file view too. */
  scope: z.enum(['home', 'workspace']),
  color: colorStr,
  gradient: z.object({ from: colorStr, to: colorStr, angle: z.number().int().min(0).max(360) }).strict(),
  /** Absolute path of a local image. Never a URL: remote backgrounds are not loaded. */
  imagePath: absImage,
  fit: z.enum(['cover', 'contain', 'center', 'tile']),
  position: z.enum(['center', 'top', 'bottom', 'left', 'right']),
  texture: z.enum(['none', 'grain', 'grid', 'dots']),
  textureOpacity: z.number().min(0).max(0.5),
  /** Surface-coloured overlay laid over the image or gradient. */
  overlayOpacity: z.number().min(0).max(0.9),
  /** Darkening applied to the background itself. */
  dim: z.number().min(0).max(0.9),
}).strict();

export const AppearanceShape = z.object({
  mode: z.enum(['dark', 'light', 'system']),
  colors: z.object({ dark: tokenOverrides, light: tokenOverrides }).strict(),
  radius: z.number().int().min(0).max(14),
  borderIntensity: z.number().min(0).max(2),
  shadowIntensity: z.number().min(0).max(2),
  surfaceSeparation: z.number().min(0).max(2),
  density: z.enum(['compact', 'comfortable', 'spacious']),
  /** File-row height in px; null follows the density. */
  rowHeight: z.number().int().min(20).max(48).nullable(),
  iconSize: z.number().int().min(48).max(256),
  thumbnailSize: z.number().int().min(96).max(512),
  toolbarHeight: z.number().int().min(32).max(56).nullable(),
  tabHeight: z.number().int().min(28).max(44),
  panelSpacing: z.number().int().min(0).max(16),
  fontScale: z.number().min(0.85).max(1.3),
  fontWeight: z.enum(['regular', 'medium']),
  lineHeight: z.number().min(1.2).max(1.8),
  fontFamily: z.enum(['plex', 'system']),
  motion: z.enum(['system', 'none', 'reduced', 'normal', 'expressive']),
  durationScale: z.number().min(0.5).max(2),
  /** Translucency of panels over a workspace background (0 = opaque). */
  transparency: z.number().min(0).max(0.5),
  blur: z.number().int().min(0).max(24),
  /** Turns off blur, translucency, shadows and non-essential animation. */
  reducedEffects: z.boolean(),
  /** Glass: translucent, layered panels over the ambient light; Solid: opaque surfaces. */
  material: z.enum(['glass', 'solid']),
  /** Opacity of glass panels (raised automatically when text would become hard to read). */
  glassOpacity: z.number().min(0.55).max(1),
  /** Strength of the accent glow on focus, selection, active items and primary buttons (0 = none). */
  glow: z.number().min(0).max(1),
  /** Soft coloured light behind the glass panels. */
  ambient: z.enum(['aurora', 'nebula', 'ember', 'none']),
  ambientIntensity: z.number().min(0).max(1),
  /** Slow drift of the ambient light (off with reduced motion). */
  ambientMotion: z.boolean(),
  background: BackgroundShape,
}).strict();
export type Appearance = z.infer<typeof AppearanceShape>;

export const APPEARANCE_DEFAULTS: Appearance = {
  mode: 'dark',
  colors: { dark: {}, light: {} },
  radius: 10,
  borderIntensity: 1,
  shadowIntensity: 1,
  surfaceSeparation: 1,
  density: 'comfortable',
  rowHeight: null,
  iconSize: 96,
  thumbnailSize: 220,
  toolbarHeight: null,
  tabHeight: 34,
  panelSpacing: 6,
  fontScale: 1,
  fontWeight: 'regular',
  lineHeight: 1.45,
  fontFamily: 'plex',
  motion: 'system',
  durationScale: 1,
  transparency: 0,
  blur: 0,
  reducedEffects: false,
  material: 'glass',
  glassOpacity: 0.82,
  glow: 0.6,
  ambient: 'aurora',
  ambientIntensity: 0.7,
  ambientMotion: true,
  background: { kind: 'none', scope: 'home', color: '#0f1318', gradient: { from: '#0f1722', to: '#0a0c0f', angle: 160 }, imagePath: '', fit: 'cover', position: 'center', texture: 'none', textureOpacity: 0.08, overlayOpacity: 0.35, dim: 0.2 },
};
export const AppearanceSchema = filled(AppearanceShape, APPEARANCE_DEFAULTS);

// ------------------------------------------------------------------ layout

export const PANE_ARRANGEMENTS = ['single', 'dual', 'dual-stacked', 'triple', 'quad'] as const;
export type PaneArrangement = (typeof PANE_ARRANGEMENTS)[number];
export const PANE_COUNT: Record<PaneArrangement, number> = { single: 1, dual: 2, 'dual-stacked': 2, triple: 3, quad: 4 };

export const LayoutShape = z.object({
  sidebar: z.object({ visible: z.boolean(), side: z.enum(['left', 'right']), width: z.number().int().min(180).max(480) }).strict(),
  details: z.object({
    visible: z.boolean(),
    position: z.enum(['right', 'left', 'bottom']),
    width: z.number().int().min(260).max(640),
    height: z.number().int().min(160).max(600),
    showPreview: z.boolean(),
    showProperties: z.boolean(),
  }).strict(),
  /** When the sidebar and the details panel share a side, which is outermost. */
  outermost: z.enum(['sidebar', 'details']),
  toolbar: z.object({ visible: z.boolean() }).strict(),
  addressBar: z.object({ visible: z.boolean() }).strict(),
  searchBox: z.object({ visible: z.boolean() }).strict(),
  tabs: z.object({ visible: z.boolean() }).strict(),
  statusBar: z.object({ visible: z.boolean() }).strict(),
  /** The shelf (drop stack) under the file area. Added in schema 2 with a default, so older documents validate unchanged. */
  shelf: z.object({ visible: z.boolean() }).strict(),
  operations: z.object({ dock: z.enum(['overlay', 'bottom']), height: z.number().int().min(140).max(480) }).strict(),
  panes: z.object({ arrangement: z.enum(PANE_ARRANGEMENTS), ratios: z.array(z.number().min(0.1).max(0.9)).max(3) }).strict(),
}).strict();
export type Layout = z.infer<typeof LayoutShape>;

export const LAYOUT_DEFAULTS: Layout = {
  sidebar: { visible: true, side: 'left', width: 240 },
  details: { visible: true, position: 'right', width: 320, height: 260, showPreview: true, showProperties: true },
  outermost: 'sidebar',
  toolbar: { visible: true },
  addressBar: { visible: true },
  searchBox: { visible: true },
  tabs: { visible: true },
  statusBar: { visible: true },
  shelf: { visible: false },
  operations: { dock: 'overlay', height: 220 },
  panes: { arrangement: 'single', ratios: [] },
};
export const LayoutSchema = filled(LayoutShape, LAYOUT_DEFAULTS);

// ------------------------------------------------------------------ file views

export const VIEW_MODES = ['details', 'list', 'compact', 'grid', 'thumbnails', 'gallery', 'columns', 'tree'] as const;
export const SORT_KEYS = ['name', 'size', 'modified', 'created', 'accessed', 'type', 'ext', 'tags', 'dimensions', 'duration', 'taken'] as const;
export const GROUP_KEYS = ['none', 'type', 'modified', 'created', 'size', 'kind', 'tags'] as const;
export const COLUMN_IDS = ['name', 'modified', 'created', 'accessed', 'type', 'size', 'ext', 'tags', 'location', 'attributes', 'owner', 'dimensions', 'duration', 'taken', 'volume', 'checksum', 'git'] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

export const ColumnShape = z.object({ id: z.enum(COLUMN_IDS), width: z.number().int().min(48).max(1200), visible: z.boolean(), pinned: z.boolean() }).strict();
export type ColumnConfig = z.infer<typeof ColumnShape>;
const columns = z.array(z.preprocess((v) => withDefaults({ pinned: false }, v), ColumnShape)).min(1).max(COLUMN_IDS.length).superRefine((cols, ctx) => {
  const seen = new Set<string>();
  for (const c of cols as ColumnConfig[]) {
    if (seen.has(c.id)) ctx.addIssue({ code: 'custom', message: `Column "${c.id}" appears twice.` });
    seen.add(c.id);
  }
  if (!(cols as ColumnConfig[]).some((c) => c.id === 'name' && c.visible)) ctx.addIssue({ code: 'custom', message: 'The Name column cannot be hidden.' });
});

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'name', width: 360, visible: true, pinned: true },
  { id: 'modified', width: 170, visible: true, pinned: false },
  { id: 'type', width: 130, visible: true, pinned: false },
  { id: 'size', width: 100, visible: true, pinned: false },
  { id: 'created', width: 170, visible: false, pinned: false },
  { id: 'tags', width: 160, visible: false, pinned: false },
  { id: 'ext', width: 80, visible: false, pinned: false },
];

export const SortKeyShape = z.object({ key: z.enum(SORT_KEYS), dir: z.enum(['asc', 'desc']) }).strict();
const sortShape = z.object({ key: z.enum(SORT_KEYS), dir: z.enum(['asc', 'desc']), foldersFirst: z.boolean() }).strict();

export const ViewShape = z.object({
  view: z.enum(VIEW_MODES),
  columns,
  sort: sortShape,
  /** Further sort keys, applied in order when the primary key ties. */
  thenBy: z.array(SortKeyShape).max(3),
  groupBy: z.enum(GROUP_KEYS),
}).strict();
export type ViewSettings = z.infer<typeof ViewShape>;
export const VIEW_DEFAULTS: ViewSettings = { view: 'details', columns: DEFAULT_COLUMNS, sort: { key: 'name', dir: 'asc', foldersFirst: true }, thenBy: [], groupBy: 'none' };
export const ViewSettingsSchema = filled(ViewShape, VIEW_DEFAULTS);

export const SavedViewShape = z.object({
  id: idStr,
  name: nameStr,
  view: z.enum(VIEW_MODES),
  columns,
  sort: sortShape,
  thenBy: z.array(SortKeyShape).max(3),
  groupBy: z.enum(GROUP_KEYS),
  iconSize: z.number().int().min(48).max(256).optional(),
  thumbnailSize: z.number().int().min(96).max(512).optional(),
  density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
  previewVisible: z.boolean().optional(),
  /** Quick-filter text applied with the view. */
  filter: z.string().max(200),
  createdMs: z.number().int().nonnegative(),
}).strict();
export type SavedView = z.infer<typeof SavedViewShape>;
export const SavedViewSchema = z.preprocess((v) => withDefaults({ thenBy: [], filter: '', createdMs: 0 }, v), SavedViewShape);

// ------------------------------------------------------------------ toolbar, context menus, shortcuts

/** Toolbar slots that are not single commands. `menu:more` is always present (it holds overflow). */
export const TOOLBAR_SPECIALS = ['menu:new', 'menu:view', 'menu:views', 'menu:more'] as const;
const ToolbarCommand = z.object({ id: cmdId, pinned: z.boolean() }).strict();
const ToolbarSeparator = z.object({ separator: z.literal(true) }).strict();
export const ToolbarItemSchema = z.union([z.preprocess((v) => (isPlain(v) && 'id' in v ? withDefaults({ pinned: false }, v) : v), ToolbarCommand), ToolbarSeparator]);
export type ToolbarItem = { id: string; pinned: boolean } | { separator: true };

export const DEFAULT_TOOLBAR_START: ToolbarItem[] = [{ id: 'nav.back', pinned: true }, { id: 'nav.forward', pinned: true }, { id: 'nav.up', pinned: true }, { id: 'nav.refresh', pinned: false }];
export const DEFAULT_TOOLBAR_END: ToolbarItem[] = [{ id: 'menu:new', pinned: false }, { id: 'edit.paste', pinned: false }, { id: 'menu:view', pinned: true }, { id: 'menu:views', pinned: false }, { id: 'nav.split', pinned: false }, { id: 'view.inspector', pinned: false }, { id: 'menu:more', pinned: true }];

export const ToolbarShape = z.object({
  start: z.array(ToolbarItemSchema).max(24),
  end: z.array(ToolbarItemSchema).max(24),
  presentation: z.enum(['icon', 'text', 'both']),
}).strict();
export type Toolbar = { start: ToolbarItem[]; end: ToolbarItem[]; presentation: 'icon' | 'text' | 'both' };
export const TOOLBAR_DEFAULTS: Toolbar = { start: DEFAULT_TOOLBAR_START, end: DEFAULT_TOOLBAR_END, presentation: 'icon' };
export const ToolbarSchema = filled(ToolbarShape, TOOLBAR_DEFAULTS) as unknown as z.ZodType<Toolbar, z.ZodTypeDef, unknown>;

const menuIds = z.array(cmdId).max(200);
const menuSection = z.object({ order: menuIds, hidden: menuIds }).strict();
export const ContextMenuShape = z.object({
  item: menuSection,
  background: menuSection,
  /** Unavailable actions: shown disabled with the reason, or hidden. */
  unavailable: z.enum(['disable', 'hide']),
  showIcons: z.boolean(),
  showShortcuts: z.boolean(),
}).strict();
export type ContextMenuConfig = z.infer<typeof ContextMenuShape>;
export const CONTEXT_MENU_DEFAULTS: ContextMenuConfig = { item: { order: [], hidden: [] }, background: { order: [], hidden: [] }, unavailable: 'disable', showIcons: true, showShortcuts: true };
export const ContextMenuSchema = filled(ContextMenuShape, CONTEXT_MENU_DEFAULTS);

export const ShortcutsShape = z.object({
  /** Command id → bindings replacing the defaults. An empty list removes the command's shortcuts. */
  bindings: z.record(cmdId, z.array(z.string().max(40)).max(4)),
}).strict().superRefine((v, ctx) => {
  for (const [cmd, keys] of Object.entries(v.bindings)) {
    for (const k of keys) {
      const n = normalizeShortcut(k);
      if (!n.ok) ctx.addIssue({ code: 'custom', path: ['bindings', cmd], message: `${cmd}: ${n.reason}` });
    }
  }
});
export type Shortcuts = z.infer<typeof ShortcutsShape>;
export const SHORTCUTS_DEFAULTS: Shortcuts = { bindings: {} };
export const ShortcutsSchema = filled(ShortcutsShape, SHORTCUTS_DEFAULTS);

// ------------------------------------------------------------------ navigation & accessibility

export const SIDEBAR_SECTIONS = ['quick', 'pinned', 'drives', 'remote', 'library', 'collections', 'searches', 'tags', 'tools', 'universe'] as const;
export type SidebarSectionId = (typeof SIDEBAR_SECTIONS)[number];
export const NavigationShape = z.object({
  sections: z.array(z.object({ id: z.enum(SIDEBAR_SECTIONS), visible: z.boolean() }).strict()).max(SIDEBAR_SECTIONS.length),
  indent: z.number().int().min(8).max(32),
  folderIcons: z.enum(['colored', 'monochrome']),
  treeExpand: z.enum(['remember', 'collapsed', 'first-level']),
  /** Supported indicators: drive usage meters and item counts in the sidebar; size/date and tag dots in the tree. */
  indicators: z.object({ driveUsage: z.boolean(), counts: z.boolean(), treeDetails: z.boolean(), tagDots: z.boolean() }).strict(),
  start: z.object({ kind: z.enum(['home', 'last', 'path']), path: z.string().max(4096) }).strict(),
  density: z.enum(['compact', 'comfortable', 'spacious']),
}).strict();
export type Navigation = z.infer<typeof NavigationShape>;
export const NAVIGATION_DEFAULTS: Navigation = {
  sections: SIDEBAR_SECTIONS.map((id) => ({ id, visible: true })),
  indent: 14,
  folderIcons: 'colored',
  treeExpand: 'remember',
  indicators: { driveUsage: true, counts: true, treeDetails: true, tagDots: true },
  start: { kind: 'last', path: '' },
  density: 'comfortable',
};
export const NavigationSchema = filled(NavigationShape, NAVIGATION_DEFAULTS);

export const AccessibilityShape = z.object({
  /** Window zoom (text and controls together). */
  interfaceScale: z.number().min(0.8).max(1.6),
  highContrast: z.enum(['off', 'on', 'system']),
  focusRing: z.enum(['standard', 'strong']),
  /** Minimum size of clickable targets in px. */
  minTarget: z.union([z.literal(24), z.literal(28), z.literal(32), z.literal(40)]),
  underlineLinks: z.boolean(),
  reduceMotion: z.enum(['system', 'on', 'off']),
  /** Opaque surfaces instead of glass; "System" follows the operating system's reduced-transparency setting. */
  reduceTransparency: z.enum(['system', 'on', 'off']),
}).strict();
export type Accessibility = z.infer<typeof AccessibilityShape>;
export const ACCESSIBILITY_DEFAULTS: Accessibility = { interfaceScale: 1, highContrast: 'system', focusRing: 'standard', minTarget: 24, underlineLinks: false, reduceMotion: 'system', reduceTransparency: 'system' };
export const AccessibilitySchema = filled(AccessibilityShape, ACCESSIBILITY_DEFAULTS);

// ------------------------------------------------------------------ partial layers

export const LayerSchema = z.object({
  appearance: AppearanceShape.deepPartial().optional(),
  layout: LayoutShape.deepPartial().optional(),
  view: ViewShape.deepPartial().optional(),
  accessibility: AccessibilityShape.partial().optional(),
  navigation: NavigationShape.deepPartial().optional(),
  toolbar: ToolbarShape.optional(),
}).strict();
export type LayerValues = {
  appearance?: DeepPartial<Appearance>;
  layout?: DeepPartial<Layout>;
  view?: DeepPartial<ViewSettings>;
  accessibility?: Partial<Accessibility>;
  navigation?: DeepPartial<Navigation>;
  toolbar?: Toolbar;
};
export type DeepPartial<T> = T extends Array<infer _U> ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export const PresetShape = z.object({
  id: idStr,
  name: nameStr,
  description: z.string().max(300),
  /** The built-in preset this one was copied from, so it can be restored. */
  basedOn: idStr.optional(),
  createdMs: z.number().int().nonnegative(),
  updatedMs: z.number().int().nonnegative(),
  appearance: AppearanceShape.deepPartial().optional(),
  layout: LayoutShape.deepPartial().optional(),
  view: ViewShape.deepPartial().optional(),
  accessibility: AccessibilityShape.partial().optional(),
}).strict();
export type Preset = Omit<z.infer<typeof PresetShape>, 'appearance' | 'layout' | 'view' | 'accessibility'> & Pick<LayerValues, 'appearance' | 'layout' | 'view' | 'accessibility'>;
export const PresetSchema = z.preprocess((v) => withDefaults({ description: '', createdMs: 0, updatedMs: 0 }, v), PresetShape) as unknown as z.ZodType<Preset, z.ZodTypeDef, unknown>;

export const WorkspaceShape = z.object({
  id: idStr,
  name: nameStr,
  createdMs: z.number().int().nonnegative(),
  /** Overrides on top of the baseline and preset; absent keys inherit. */
  overrides: LayerSchema,
  savedFilters: z.array(z.object({ id: idStr, name: nameStr, filter: z.string().max(200) }).strict()).max(50),
}).strict();
export type Workspace = Omit<z.infer<typeof WorkspaceShape>, 'overrides'> & { overrides: LayerValues };
export const WorkspaceSchema = z.preprocess((v) => withDefaults({ createdMs: 0, overrides: {}, savedFilters: [] }, v), WorkspaceShape) as unknown as z.ZodType<Workspace, z.ZodTypeDef, unknown>;

export const DEFAULT_WORKSPACE_ID = 'everyday';

/** A named, complete layout the user saved (Layout editor → Save layout). */
export const SavedLayoutShape = z.object({ id: idStr, name: nameStr, layout: LayoutSchema, createdMs: z.number().int().nonnegative(), updatedMs: z.number().int().nonnegative() }).strict();
export type SavedLayout = { id: string; name: string; layout: Layout; createdMs: number; updatedMs: number };
export const SavedLayoutSchema = z.preprocess((v) => withDefaults({ createdMs: 0, updatedMs: 0 }, v), SavedLayoutShape) as unknown as z.ZodType<SavedLayout, z.ZodTypeDef, unknown>;

/** A named column arrangement (Columns → Save column set). */
export const ColumnSetShape = z.object({ id: idStr, name: nameStr, columns, createdMs: z.number().int().nonnegative() }).strict();
export type ColumnSet = { id: string; name: string; columns: ColumnConfig[]; createdMs: number };
export const ColumnSetSchema = z.preprocess((v) => withDefaults({ createdMs: 0 }, v), ColumnSetShape) as unknown as z.ZodType<ColumnSet, z.ZodTypeDef, unknown>;

export const ProvenanceShape = z.object({ kind: z.string().max(40), fileName: z.string().max(260), formatVersion: z.number().int(), importedMs: z.number().int() }).strict();

export interface CustomizationConfig {
  schemaVersion: typeof CUSTOMIZATION_SCHEMA_VERSION;
  appearance: Appearance;
  layout: Layout;
  view: ViewSettings;
  toolbar: Toolbar;
  contextMenu: ContextMenuConfig;
  shortcuts: Shortcuts;
  navigation: Navigation;
  accessibility: Accessibility;
  /** Active preset: a built-in id, a user preset id, or null for none. */
  activePresetId: string | null;
  presets: Preset[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  savedViews: SavedView[];
  savedLayouts: SavedLayout[];
  columnSets: ColumnSet[];
  provenance: Array<z.infer<typeof ProvenanceShape>>;
  meta: { createdMs: number; updatedMs: number; migratedFrom?: string };
}

const CONFIG_DEFAULTS = {
  schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
  activePresetId: 'orbis-native',
  presets: [],
  workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Everyday', createdMs: 0, overrides: {}, savedFilters: [] }],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  savedViews: [],
  savedLayouts: [],
  columnSets: [],
  provenance: [],
  meta: { createdMs: 0, updatedMs: 0 },
};

export const CustomizationShape = z.object({
  schemaVersion: z.literal(CUSTOMIZATION_SCHEMA_VERSION),
  appearance: AppearanceSchema,
  layout: LayoutSchema,
  view: ViewSettingsSchema,
  toolbar: ToolbarSchema,
  contextMenu: ContextMenuSchema,
  shortcuts: ShortcutsSchema,
  navigation: NavigationSchema,
  accessibility: AccessibilitySchema,
  activePresetId: idStr.nullable(),
  presets: z.array(PresetSchema).max(100),
  workspaces: z.array(WorkspaceSchema).min(1, 'At least one workspace is required.').max(50),
  activeWorkspaceId: idStr,
  savedViews: z.array(SavedViewSchema).max(200),
  savedLayouts: z.array(SavedLayoutSchema).max(100),
  columnSets: z.array(ColumnSetSchema).max(100),
  provenance: z.array(ProvenanceShape).max(20),
  meta: z.object({ createdMs: z.number().int().nonnegative(), updatedMs: z.number().int().nonnegative(), migratedFrom: z.string().max(40).optional() }).strict(),
}).strict();

export const CustomizationSchema = z.preprocess((v) => withDefaults(CONFIG_DEFAULTS, v), CustomizationShape) as unknown as z.ZodType<CustomizationConfig, z.ZodTypeDef, unknown>;

export function defaultConfig(now = Date.now()): CustomizationConfig {
  const c = CustomizationSchema.parse({});
  c.meta = { createdMs: now, updatedMs: now };
  c.workspaces[0]!.createdMs = now;
  return c;
}
