import {
  ACCESSIBILITY_DEFAULTS, APPEARANCE_DEFAULTS, CONTEXT_MENU_DEFAULTS, LAYOUT_DEFAULTS, NAVIGATION_DEFAULTS, PANE_COUNT, TOOLBAR_DEFAULTS, VIEW_DEFAULTS,
  type Accessibility, type Appearance, type ContextMenuConfig, type CustomizationConfig, type Layout, type LayerValues, type Navigation, type Preset, type Shortcuts, type Toolbar, type ViewSettings, type Workspace,
} from './schema';
import { baseTokens, COLOR_TOKENS, HOST_OVERRIDABLE_TOKENS, TOKEN_BY_ID, type ColorTokenId, type ThemeMode, type TokenValues } from './tokens';
import { composite, contrastRatio, nearestAccessible, parseColor, parseRgba, toHex, type Rgba } from './color';
import { BUILT_IN_BY_ID, HIGH_CONTRAST, type BuiltInPreset } from './presets';

/**
 * Settings resolution. Precedence, lowest to highest:
 *   1. application defaults
 *   2. host design tokens (future Orbis host; colours only, never safety colours)
 *   3. baseline (the user's own configuration)
 *   4. selected preset
 *   5. active workspace overrides
 *   6. per-pane view state (handled by the panes themselves)
 * and finally mandatory constraints (contrast, layout reachability, reduced
 * motion), which always win and are reported as adjustments.
 */

export type LayerName = 'default' | 'host' | 'baseline' | 'preset' | 'workspace' | 'constraint';
export const LAYER_LABEL: Record<LayerName, string> = { default: 'Default', host: 'Orbis host', baseline: 'Your settings', preset: 'Preset', workspace: 'Workspace', constraint: 'Safeguard' };

export type Section = 'appearance' | 'layout' | 'view' | 'accessibility' | 'navigation';
export const SECTION_DEFAULTS: { appearance: Appearance; layout: Layout; view: ViewSettings; accessibility: Accessibility; navigation: Navigation } = {
  appearance: APPEARANCE_DEFAULTS, layout: LAYOUT_DEFAULTS, view: VIEW_DEFAULTS, accessibility: ACCESSIBILITY_DEFAULTS, navigation: NAVIGATION_DEFAULTS,
};

export interface HostTokens { contract: string; dark?: Partial<Record<ColorTokenId, string>>; light?: Partial<Record<ColorTokenId, string>> }

export interface ResolveContext {
  systemDark: boolean;
  systemHighContrast?: boolean;
  systemReducedMotion?: boolean;
  systemReducedTransparency?: boolean;
  hostTokens?: HostTokens | null;
}

export interface Adjustment { path: string; from?: string; to?: string; reason: string }

export interface Resolved {
  mode: ThemeMode;
  appearance: Appearance;
  layout: Layout;
  view: ViewSettings;
  accessibility: Accessibility;
  navigation: Navigation;
  toolbar: Toolbar;
  contextMenu: ContextMenuConfig;
  shortcuts: Shortcuts;
  tokens: TokenValues;
  highContrast: boolean;
  reducedMotion: boolean;
  /** Effective material after safeguards (high contrast, reduced transparency and reduced effects make it solid). */
  material: 'glass' | 'solid';
  /** Effective ambient light ('none' when switched off or suppressed by a safeguard). */
  ambient: Appearance['ambient'];
  ambientMotion: boolean;
  /** Which layer supplied each value, keyed by dotted path ("layout.sidebar.width", "tokens.accent"). */
  sources: Record<string, LayerName>;
  adjustments: Adjustment[];
  preset: { id: string; name: string; builtIn: boolean } | null;
  workspace: { id: string; name: string };
  cssVars: Record<string, string>;
}

// ------------------------------------------------------------------ path helpers

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function getAt(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!isPlain(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Immutable set; creates intermediate objects. */
export function setAt<T>(obj: T, path: readonly string[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path as [string, ...string[]];
  const base = isPlain(obj) ? obj : {};
  return { ...base, [k]: setAt((base as Record<string, unknown>)[k], rest, value) } as T;
}

/** Immutable delete; removes objects left empty. */
export function unsetAt<T>(obj: T, path: readonly string[]): T {
  if (!isPlain(obj) || !path.length) return obj;
  const [k, ...rest] = path as [string, ...string[]];
  if (!(k in obj)) return obj;
  const copy: Record<string, unknown> = { ...obj };
  if (!rest.length) delete copy[k];
  else {
    const child = unsetAt(copy[k], rest);
    if (isPlain(child) && !Object.keys(child).length) delete copy[k];
    else copy[k] = child;
  }
  return copy as T;
}

/** Merge a partial override into a full value. Arrays replace; objects merge; undefined is ignored. Records the source of every leaf. */
function mergeLayer(target: Record<string, unknown>, override: unknown, layer: LayerName, prefix: string, sources: Record<string, LayerName>): void {
  if (!isPlain(override)) return;
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    const p = `${prefix}.${k}`;
    if (isPlain(v) && isPlain(target[k])) {
      const next = { ...(target[k] as Record<string, unknown>) };
      mergeLayer(next, v, layer, p, sources);
      target[k] = next;
    } else if (isPlain(v) && target[k] === undefined) {
      // Record-valued settings (colour overrides) start empty.
      const next: Record<string, unknown> = {};
      mergeLayer(next, v, layer, p, sources);
      target[k] = next;
    } else {
      target[k] = structuredClone(v);
      markLeaves(v, layer, p, sources);
    }
  }
}

function markLeaves(v: unknown, layer: LayerName, p: string, sources: Record<string, LayerName>): void {
  sources[p] = layer;
  if (isPlain(v)) for (const [k, x] of Object.entries(v)) markLeaves(x, layer, `${p}.${k}`, sources);
}

/** Baseline values count as "your settings" only where they differ from the defaults. */
function diffLeaves(def: unknown, val: unknown, p: string, sources: Record<string, LayerName>): void {
  if (isPlain(def) && isPlain(val)) {
    for (const k of new Set([...Object.keys(def), ...Object.keys(val)])) diffLeaves(def[k], val[k], `${p}.${k}`, sources);
    return;
  }
  if (JSON.stringify(def) !== JSON.stringify(val)) markLeaves(val, 'baseline', p, sources);
}

// ------------------------------------------------------------------ layers

export function findPreset(config: CustomizationConfig, id: string | null): (Preset & { builtIn?: false }) | BuiltInPreset | undefined {
  if (!id) return undefined;
  return config.presets.find((p) => p.id === id) ?? BUILT_IN_BY_ID[id];
}

export function activeWorkspace(config: CustomizationConfig): Workspace {
  return config.workspaces.find((w) => w.id === config.activeWorkspaceId) ?? config.workspaces[0]!;
}

export type EditLayer = 'baseline' | 'preset' | 'workspace';

/**
 * Where a direct edit of `section.path` should be written so it takes effect:
 * the highest layer that currently defines the value. Built-in presets are
 * read-only, so values they define are overridden in the workspace instead.
 */
export function editTargetFor(config: CustomizationConfig, section: Section | 'toolbar', path: readonly string[]): EditLayer {
  const ws = activeWorkspace(config);
  if (getAt(ws.overrides, [section, ...path]) !== undefined) return 'workspace';
  const preset = findPreset(config, config.activePresetId);
  if (preset && section !== 'toolbar' && getAt(preset, [section, ...path]) !== undefined) return 'builtIn' in preset && preset.builtIn ? 'workspace' : 'preset';
  return 'baseline';
}

// ------------------------------------------------------------------ geometry

const DENSITY = { compact: { row: 24, control: 26, toolbar: 36 }, comfortable: { row: 30, control: 28, toolbar: 40 }, spacious: { row: 36, control: 30, toolbar: 44 } } as const;
const FONT = { xs: 11, sm: 12, md: 13, lg: 15, xl: 18, '2xl': 22 } as const;
const MOTION_FACTOR = { system: 1, none: 0, reduced: 0.5, normal: 1, expressive: 1.4 } as const;

function mix(a: string, b: string, t: number): string {
  const x = parseRgba(a);
  const y = parseRgba(b);
  if (!x || !y) return b;
  const f = (p: number, q: number) => Math.round(Math.min(255, Math.max(0, p + (q - p) * t)));
  return toHex({ r: f(x.r, y.r), g: f(x.g, y.g), b: f(x.b, y.b), a: y.a });
}

// ------------------------------------------------------------------ resolve

export function resolveCustomization(config: CustomizationConfig, ctx: ResolveContext): Resolved {
  const sources: Record<string, LayerName> = {};
  const adjustments: Adjustment[] = [];
  const cssVarsGlass: Record<string, string> = {};
  const presetDef = findPreset(config, config.activePresetId);
  if (config.activePresetId && !presetDef) adjustments.push({ path: 'activePresetId', from: config.activePresetId, reason: 'The selected preset no longer exists; no preset is applied.' });
  const ws = activeWorkspace(config);
  if (ws.id !== config.activeWorkspaceId) adjustments.push({ path: 'activeWorkspaceId', from: config.activeWorkspaceId, to: ws.id, reason: 'The selected workspace no longer exists; the first workspace is used.' });

  const layers: Array<[LayerName, LayerValues | undefined]> = [['preset', presetDef as LayerValues | undefined], ['workspace', ws.overrides]];
  const resolveSection = <K extends Section>(section: K): (typeof SECTION_DEFAULTS)[K] => {
    const out = structuredClone(config[section]) as unknown as Record<string, unknown>;
    diffLeaves(SECTION_DEFAULTS[section], config[section], section, sources);
    for (const [name, layer] of layers) mergeLayer(out, layer?.[section], name, section, sources);
    return out as unknown as (typeof SECTION_DEFAULTS)[K];
  };
  const appearance = resolveSection('appearance');
  const layout = resolveSection('layout');
  const view = resolveSection('view');
  const accessibility = resolveSection('accessibility');
  const navigation = resolveSection('navigation');
  let toolbar = config.toolbar;
  if (JSON.stringify(config.toolbar) !== JSON.stringify(TOOLBAR_DEFAULTS)) sources.toolbar = 'baseline';
  if (ws.overrides.toolbar) {
    toolbar = ws.overrides.toolbar;
    sources.toolbar = 'workspace';
  }
  if (JSON.stringify(config.contextMenu) !== JSON.stringify(CONTEXT_MENU_DEFAULTS)) sources.contextMenu = 'baseline';

  const mode: ThemeMode = appearance.mode === 'system' ? (ctx.systemDark ? 'dark' : 'light') : appearance.mode;
  const highContrast = accessibility.highContrast === 'on' || (accessibility.highContrast === 'system' && !!ctx.systemHighContrast);
  const reducedMotion = accessibility.reduceMotion === 'on' || (accessibility.reduceMotion === 'system' && !!ctx.systemReducedMotion) || appearance.reducedEffects;

  // ---- colour tokens
  const tokens = baseTokens(mode);
  const host = ctx.hostTokens?.[mode];
  if (host) {
    for (const [id, v] of Object.entries(host) as Array<[ColorTokenId, string]>) {
      const c = HOST_OVERRIDABLE_TOKENS.has(id) ? parseColor(v) : undefined;
      if (c) {
        tokens[id] = c;
        sources[`tokens.${id}`] = 'host';
      }
    }
  }
  for (const [id, v] of Object.entries(appearance.colors[mode] ?? {}) as Array<[ColorTokenId, string]>) {
    if (!TOKEN_BY_ID[id]) continue;
    tokens[id] = v;
    sources[`tokens.${id}`] = sources[`appearance.colors.${mode}.${id}`] ?? 'baseline';
  }
  // Surface separation and border intensity are relative adjustments of the surface/line tokens.
  if (appearance.surfaceSeparation !== 1) {
    for (const id of ['bgSurface2', 'bgPanel', 'bgSidebar', 'bgRaised', 'bgDialog', 'bgToolbar', 'bgApp'] as ColorTokenId[]) tokens[id] = mix(tokens.bgSurface, tokens[id], appearance.surfaceSeparation);
  }
  if (appearance.borderIntensity !== 1) {
    tokens.border = mix(tokens.bgSurface, tokens.border, appearance.borderIntensity);
    tokens.borderStrong = mix(tokens.bgSurface, tokens.borderStrong, appearance.borderIntensity);
  }
  if (highContrast) {
    for (const [id, v] of Object.entries(HIGH_CONTRAST[mode]) as Array<[ColorTokenId, string]>) {
      tokens[id] = v;
      sources[`tokens.${id}`] = 'constraint';
    }
  }
  enforceContrast(tokens, sources, adjustments);

  // ---- material, glow and ambient light
  const reducedTransparency = accessibility.reduceTransparency === 'on' || (accessibility.reduceTransparency === 'system' && !!ctx.systemReducedTransparency);
  let material = appearance.material;
  if (material === 'glass' && (highContrast || reducedTransparency || appearance.reducedEffects)) {
    material = 'solid';
    sources['appearance.material'] = 'constraint';
    if (highContrast || reducedTransparency) adjustments.push({ path: 'appearance.material', from: 'glass', to: 'solid', reason: highContrast ? 'High contrast uses opaque surfaces.' : 'Reduced transparency is on, so panels are opaque.' });
  }
  let ambient = appearance.ambient;
  if (ambient !== 'none' && (highContrast || appearance.reducedEffects || appearance.ambientIntensity === 0)) {
    ambient = 'none';
    if (highContrast || appearance.reducedEffects) sources['appearance.ambient'] = 'constraint';
  }
  const ambientMotion = ambient !== 'none' && appearance.ambientMotion && !reducedMotion;
  const glow = highContrast || appearance.reducedEffects ? 0 : appearance.glow;
  const glass = computeGlass(tokens, mode, material, ambient, appearance, adjustments, sources);
  Object.assign(cssVarsGlass, glass.vars);

  // ---- layout constraints
  const fixedLayout = structuredClone(layout);
  if (!fixedLayout.sidebar.visible && !fixedLayout.addressBar.visible) {
    fixedLayout.addressBar.visible = true;
    sources['layout.addressBar.visible'] = 'constraint';
    adjustments.push({ path: 'layout.addressBar.visible', from: 'hidden', to: 'shown', reason: 'With the sidebar hidden, the address bar stays visible so you can always get to another folder.' });
  }
  fixedLayout.panes.ratios = normalizeRatios(fixedLayout.panes.arrangement, fixedLayout.panes.ratios);

  // ---- CSS variables
  const cssVars: Record<string, string> = { ...cssVarsGlass, ...glowVars(tokens, mode, glow) };
  for (const t of COLOR_TOKENS) cssVars[t.cssVar] = tokens[t.id];
  const d = DENSITY[appearance.density];
  const r = appearance.radius;
  cssVars['--radius-sm'] = `${Math.round(r * 0.66)}px`;
  cssVars['--radius-md'] = `${r}px`;
  cssVars['--radius-lg'] = `${Math.round(r * 1.5)}px`;
  const shadow = appearance.reducedEffects ? 0 : appearance.shadowIntensity;
  const shadowAlpha = (mode === 'dark' ? 0.55 : 0.18) * shadow;
  cssVars['--shadow-raised'] = shadow === 0 ? `0 0 0 1px ${tokens.borderStrong}` : `0 ${Math.round(18 * Math.min(1.5, shadow))}px ${Math.round(48 * Math.min(1.5, shadow))}px rgba(0, 0, 0, ${shadowAlpha.toFixed(3)}), 0 0 0 1px ${tokens.borderStrong}`;
  cssVars['--row-h'] = `${appearance.rowHeight ?? d.row}px`;
  cssVars['--control-h'] = `${Math.max(d.control, accessibility.minTarget)}px`;
  cssVars['--min-target'] = `${accessibility.minTarget}px`;
  cssVars['--toolbar-h'] = `${Math.max(appearance.toolbarHeight ?? d.toolbar, accessibility.minTarget + 8)}px`;
  cssVars['--tabbar-h'] = `${Math.max(appearance.tabHeight, accessibility.minTarget + 4)}px`;
  for (const [k, px] of Object.entries(FONT)) cssVars[`--fs-${k}`] = `${Math.round(px * appearance.fontScale * 2) / 2}px`;
  cssVars['--fw-regular'] = appearance.fontWeight === 'medium' ? '500' : '400';
  cssVars['--fw-medium'] = appearance.fontWeight === 'medium' ? '600' : '500';
  cssVars['--lh-body'] = String(appearance.lineHeight);
  cssVars['--font-ui'] = appearance.fontFamily === 'system' ? "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif" : "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  const motion = reducedMotion ? 0 : MOTION_FACTOR[appearance.motion] * appearance.durationScale;
  cssVars['--dur-fast'] = `${Math.round(90 * motion)}ms`;
  cssVars['--dur-med'] = `${Math.round(160 * motion)}ms`;
  cssVars['--panel-gap'] = `${appearance.panelSpacing}px`;
  const effects = !appearance.reducedEffects;
  cssVars['--panel-alpha'] = String(effects ? 1 - appearance.transparency : 1);
  cssVars['--panel-blur'] = `${effects ? appearance.blur : 0}px`;
  cssVars['--focus-width'] = accessibility.focusRing === 'strong' || highContrast ? '3px' : '2px';
  cssVars['--focus-offset'] = accessibility.focusRing === 'strong' || highContrast ? '2px' : '1px';

  const presetInfo = presetDef ? { id: presetDef.id, name: presetDef.name, builtIn: 'builtIn' in presetDef && presetDef.builtIn === true } : null;
  return {
    mode, appearance, layout: fixedLayout, view, accessibility, navigation, toolbar, contextMenu: config.contextMenu, shortcuts: config.shortcuts,
    tokens, highContrast, reducedMotion, material, ambient, ambientMotion, sources, adjustments, preset: presetInfo, workspace: { id: ws.id, name: ws.name }, cssVars,
  };
}

// ------------------------------------------------------------------ glass

/** Ambient light colours per kind: three soft blobs behind the panels. */
const AMBIENT_SOURCES: Record<Exclude<Appearance['ambient'], 'none'>, [ColorTokenId, ColorTokenId, ColorTokenId]> = {
  aurora: ['accent', 'accent2', 'hueImage'],
  nebula: ['accent', 'accent2', 'hueVideo'],
  ember: ['hueAudio', 'hueExe', 'hueVideo'],
};
const AMBIENT_ALPHA = { dark: [0.6, 0.46, 0.4], light: [0.4, 0.32, 0.26] } as const;

const withAlpha = (hex: string, a: number): string => {
  const c = parseRgba(hex);
  return c ? toHex({ ...c, a: Math.max(0, Math.min(1, Math.round(a * 1000) / 1000)) }) : hex;
};

/**
 * Glass surface groups.
 *  - bars: title bar, pane toolbars and the sidebar. Only primary/secondary text and icons sit
 *    on them in glass mode (the stylesheet moves muted text there to secondary text, so muted
 *    text is used for icons and separators only and needs 3:1). They are the most transparent
 *    and let the ambient light through.
 *  - panels: the details panel, which carries muted text (full text rules).
 *  - content: file lists, previews and tool views — always opaque.
 *  - overlays: menus, dialogs, toasts — frosted (blurred) and nearly opaque.
 */
const GLASS_GROUPS: Array<{ name: 'bars' | 'panels' | 'content' | 'overlay'; extra: number; tokens: ColorTokenId[]; relaxed?: Partial<Record<ColorTokenId, number>> }> = [
  { name: 'bars', extra: -0.3, tokens: ['bgApp', 'bgToolbar', 'bgSidebar'], relaxed: { text3: 3 } },
  { name: 'panels', extra: 0, tokens: ['bgPanel'] },
  { name: 'content', extra: 1, tokens: ['bgSurface', 'bgSurface2'] },
  { name: 'overlay', extra: 0.1, tokens: ['bgRaised', 'bgDialog'] },
];
const GLASS_VAR: Partial<Record<ColorTokenId, string>> = {
  bgApp: '--glass-app', bgSidebar: '--glass-sidebar', bgToolbar: '--glass-toolbar', bgPanel: '--glass-panel',
  bgSurface: '--glass-surface', bgSurface2: '--glass-surface-2', bgRaised: '--glass-raised', bgDialog: '--glass-dialog',
};

/**
 * Glass surfaces are the opaque surface tokens made translucent over the
 * ambient light. Text stays readable: for every glass surface, every token
 * that must be readable on it (its contrast rule) is checked against the
 * surface composited over the brightest parts of the ambient light, and the
 * panel opacity is raised until all pass. Raising is reported.
 */
const glassCache = new Map<string, { vars: Record<string, string>; adjustments: Adjustment[] }>();
function computeGlass(tokens: TokenValues, mode: ThemeMode, material: 'glass' | 'solid', ambient: Appearance['ambient'], a: Appearance, adjustments: Adjustment[], sources: Record<string, LayerName>): { vars: Record<string, string> } {
  const key = JSON.stringify([tokens, mode, material, ambient, a.glassOpacity, a.ambientIntensity, a.reducedEffects]);
  let hit = glassCache.get(key);
  if (!hit) {
    hit = { vars: {}, adjustments: [] };
    computeGlassUncached(tokens, mode, material, ambient, a, hit);
    if (glassCache.size > 16) glassCache.delete(glassCache.keys().next().value!);
    glassCache.set(key, hit);
  }
  for (const adj of hit.adjustments) {
    adjustments.push({ ...adj });
    sources['appearance.glassOpacity'] = 'constraint';
  }
  return { vars: { ...hit.vars } };
}

function computeGlassUncached(tokens: TokenValues, mode: ThemeMode, material: 'glass' | 'solid', ambient: Appearance['ambient'], a: Appearance, out: { vars: Record<string, string>; adjustments: Adjustment[] }): void {
  const { vars, adjustments } = out;
  const bgApp = parseRgba(tokens.bgApp)!;
  // Ambient colours and the backdrops they can produce (each blob alone and pairs overlapping).
  const blobs: string[] = [];
  if (ambient !== 'none') {
    AMBIENT_SOURCES[ambient].forEach((id, i) => blobs.push(withAlpha(tokens[id], AMBIENT_ALPHA[mode][i]! * a.ambientIntensity)));
  }
  ['--ambient-1', '--ambient-2', '--ambient-3'].forEach((v, i) => (vars[v] = blobs[i] ?? 'transparent'));
  const backdrops: Rgba[] = [bgApp];
  for (let i = 0; i < blobs.length; i++) {
    const bi = composite(parseRgba(blobs[i]!)!, bgApp);
    backdrops.push(bi);
    for (let j = i + 1; j < blobs.length; j++) backdrops.push(composite(parseRgba(blobs[j]!)!, bi));
  }
  const readableOn = (surface: ColorTokenId, relaxed: Partial<Record<ColorTokenId, number>> = {}) =>
    COLOR_TOKENS.filter((t) => t.contrast?.against.includes(surface)).map((t) => ({ id: t.id, min: Math.min(t.contrast!.min, relaxed[t.id] ?? Infinity) }));
  const passes = (surface: ColorTokenId, alpha: number, relaxed?: Partial<Record<ColorTokenId, number>>) => {
    const s = parseRgba(tokens[surface])!;
    const rules = readableOn(surface, relaxed);
    return backdrops.every((bd) => {
      const eff = toHex(composite({ ...s, a: alpha }, bd));
      return rules.every((r) => contrastRatio(tokens[r.id], eff) >= r.min);
    });
  };
  for (const g of GLASS_GROUPS) {
    const requested = material === 'glass' ? Math.max(0.3, Math.min(1, a.glassOpacity + g.extra)) : 1;
    let alpha = requested;
    while (alpha < 1 && !g.tokens.every((id) => passes(id, alpha, g.relaxed))) alpha = Math.min(1, Math.round((alpha + 0.02) * 100) / 100);
    if (alpha > requested + 1e-9 && g.name === 'panels') {
      adjustments.push({ path: 'appearance.glassOpacity', from: requested.toFixed(2), to: alpha.toFixed(2), reason: 'Glass panels were made more opaque so text stays readable over the ambient light.' });
    }
    for (const id of g.tokens) vars[GLASS_VAR[id]!] = alpha >= 1 ? tokens[id] : withAlpha(tokens[id], alpha);
    if (g.name === 'content') {
      // Opaque equivalents for sticky headers and pinned columns (content scrolls beneath them).
      vars['--pane-solid'] = toHex(composite({ ...parseRgba(tokens.bgSurface)!, a: alpha }, bgApp));
      vars['--pane-solid-2'] = toHex(composite({ ...parseRgba(tokens.bgSurface2)!, a: alpha }, bgApp));
    }
  }
  const effects = !a.reducedEffects;
  vars['--glass-blur'] = material === 'glass' && effects ? '20px' : '0px';
  vars['--glass-edge'] = material === 'glass' ? (mode === 'dark' ? '#ffffff12' : '#ffffffb8') : 'transparent';
  vars['--glass-shine'] = material === 'glass' ? (mode === 'dark' ? 'inset 0 1px 0 #ffffff0d' : 'inset 0 1px 0 #ffffffcc') : 'inset 0 0 0 transparent';
}

/** Accent glow shadows; a neutral (invisible) shadow when glow is off so the values can always be combined. */
function glowVars(tokens: TokenValues, mode: ThemeMode, glow: number): Record<string, string> {
  const none = '0 0 0 0 transparent';
  const k = mode === 'dark' ? 1 : 0.7;
  const strong = withAlpha(tokens.accent, 0.55 * glow * k);
  const soft = withAlpha(tokens.accent, 0.28 * glow * k);
  // The gradient end must keep text on accent readable; otherwise primary buttons stay flat.
  const end = contrastRatio(tokens.textOnAccent, tokens.accentHover) >= 4.5 ? tokens.accentHover : tokens.accent;
  return {
    '--glow': String(glow),
    '--glow-color': glow ? strong : 'transparent',
    '--glow-soft': glow ? soft : 'transparent',
    '--glow-sm': glow ? `0 0 10px ${soft}` : none,
    '--glow-md': glow ? `0 0 18px ${strong}` : none,
    '--glow-lg': glow ? `0 8px 32px ${soft}` : none,
    '--accent-gradient': glow ? `linear-gradient(135deg, ${tokens.accent}, ${end})` : tokens.accent,
    // A light-catching edge for the active pane, dialogs and the palette.
    '--edge-gradient': glow ? `linear-gradient(135deg, ${withAlpha(tokens.accent, 0.9 * glow)}, ${withAlpha(tokens.accent, 0)} 38%, ${withAlpha(tokens.accent2, 0)} 62%, ${withAlpha(tokens.accent2, 0.75 * glow)})` : 'none',
  };
}

export function normalizeRatios(arrangement: Layout['panes']['arrangement'], ratios: number[]): number[] {
  const n = PANE_COUNT[arrangement];
  if (arrangement === 'quad') return [ratios[0] ?? 0.5, ratios[1] ?? 0.5].slice(0, 2);
  const need = n - 1;
  if (ratios.length === need) return ratios;
  // Equal panes: cumulative split points.
  return Array.from({ length: need }, (_, i) => Math.round(((i + 1) / n) * 1000) / 1000);
}

/**
 * Contrast safeguards. Tokens that fail their rule are moved to the nearest
 * readable colour (same hue), and each change is reported. Translucent
 * selection colours are weakened until text on them is readable.
 */
export function enforceContrast(tokens: TokenValues, sources: Record<string, LayerName>, adjustments: Adjustment[]): void {
  for (const t of COLOR_TOKENS) {
    if (t.contrast) {
      const bgs = t.contrast.against.map((id) => tokens[id]);
      const worst = Math.min(...bgs.map((bg) => contrastRatio(tokens[t.id], bg)));
      if (worst < t.contrast.min) {
        const fixed = nearestAccessible(tokens[t.id], bgs, t.contrast.min);
        if (fixed) {
          adjustments.push({ path: `tokens.${t.id}`, from: tokens[t.id], to: fixed, reason: `${t.contrast.reason} (was ${worst.toFixed(2)}:1)` });
          tokens[t.id] = fixed;
          sources[`tokens.${t.id}`] = 'constraint';
        }
      }
    }
    if (t.legibleText) {
      const rule = t.legibleText;
      const ok = (hex: string) => rule.over.every((s) => contrastRatio(tokens[rule.text], toHex(composite(parseRgba(hex)!, parseRgba(tokens[s])!))) >= rule.min);
      let v = tokens[t.id];
      if (!ok(v)) {
        const c = parseRgba(v)!;
        let a = c.a;
        while (a > 0.02 && !ok(toHex({ ...c, a }))) a -= 0.02;
        const fixed = toHex({ ...c, a: Math.max(0.02, a) });
        adjustments.push({ path: `tokens.${t.id}`, from: v, to: fixed, reason: `Text on ${t.label.toLowerCase()} must stay readable (${rule.min}:1); the highlight was made more transparent.` });
        v = fixed;
        tokens[t.id] = v;
        sources[`tokens.${t.id}`] = 'constraint';
      }
    }
  }
}

/** Check one proposed colour for a token against the current effective tokens; returns a refusal with a safe alternative. */
export function checkTokenEdit(tokens: TokenValues, id: ColorTokenId, value: string): { ok: boolean; value?: string; reason?: string; suggestion?: string; ratio?: number } {
  const def = TOKEN_BY_ID[id];
  const c = parseColor(value);
  if (!def || !c) return { ok: false, reason: `"${value}" is not a colour. Use #rrggbb, rgb(r, g, b) or hsl(h, s%, l%).` };
  if (!def.alpha && (parseRgba(c)?.a ?? 1) < 1) return { ok: false, reason: `${def.label} must be opaque.` };
  const next = { ...tokens, [id]: c };
  // Rules this token must satisfy, and rules of other tokens that depend on it.
  const checks = COLOR_TOKENS.filter((t) => t.contrast && (t.id === id || t.contrast.against.includes(id)));
  for (const t of checks) {
    const worst = Math.min(...t.contrast!.against.map((bg) => contrastRatio(next[t.id], next[bg])));
    if (worst < t.contrast!.min) {
      const suggestion = t.id === id ? nearestAccessible(c, t.contrast!.against.map((bg) => next[bg]), t.contrast!.min) : undefined;
      return { ok: false, ratio: worst, reason: `${t.contrast!.reason} With this colour it would be ${worst.toFixed(2)}:1${t.id === id ? '' : ` for ${t.label.toLowerCase()}`}.`, suggestion };
    }
  }
  return { ok: true, value: c, ratio: def.contrast ? Math.min(...def.contrast.against.map((bg) => contrastRatio(c, next[bg]))) : undefined };
}

export const CONTEXT_DEFAULTS = CONTEXT_MENU_DEFAULTS;
