/**
 * The Orbis Experience Runtime's configuration: what can be personalised, what it is by default (exactly the Orbis
 * everyone already has), how a stored configuration is checked and brought forward, where a setting's value comes from
 * when several layers have an opinion, and how changes are compared, undone and exported.
 *
 * Pure — no browser, no storage. Nothing here changes Orbis by itself: the engine applies what these rules work out.
 */

import type { WidgetInstance } from './widgets'
import { normalizeWidgets } from './widgets.ts'
import type { Dashboard } from './dashboards'
import { normalizeDashboards } from './dashboards.ts'
import type { StoredTheme } from './themes'
import { cleanTokens, themeExists, themeName, themeTokens } from './themes.ts'
import { builtInPreset, cleanPresets, presetVariables, type StoredPreset } from './presets.ts'
import { cleanRules, type StoredRule } from './rules.ts'
import type { VoiceInputConfig } from './voiceInput'
import { defaultVoiceConfig, normalizeVoiceConfig } from './voiceInput.ts'

export const EXPERIENCE_SCHEMA_VERSION = 1

// ---------------------------------------------------------------- appearance

export type Density = 'comfortable' | 'cosy' | 'compact'

export interface AppearanceConfig {
  /** Empty means Orbis's own accent (the cyan it has always used). */
  accent: string
  density: Density
  /** 0 keeps Orbis's own corner radius. */
  cornerRadius: number
  /** How see-through panels are, as a factor of Orbis's own: 1 is unchanged. */
  transparency: number
  /** Background blur as a factor of Orbis's own: 1 is unchanged. */
  blur: number
  /** Less movement than usual: 'system' follows the operating system. */
  reducedMotion: 'system' | 'on' | 'off'
  fontScale: number
}

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  accent: '',
  density: 'comfortable',
  cornerRadius: 0,
  transparency: 1,
  blur: 1,
  reducedMotion: 'system',
  fontScale: 1
}

// ---------------------------------------------------------------- the rest of the configuration

export interface WallpaperConfig {
  id: string
  name: string
  /** A data URL or a gradient Orbis draws itself; nothing is fetched from the internet. */
  source: string
  kind: 'image' | 'gradient'
  addedAt: number
}

export interface NewTabConfig {
  /** 'current' is the Orbis new tab exactly as it is. */
  mode: 'current' | 'minimal' | 'focus' | 'study' | 'research' | 'developer' | 'personal'
  greeting: boolean
  clock: boolean
  shortcuts: boolean
  quote: boolean
  widgets: boolean
  wallpaperId: string | null
}

export const DEFAULT_NEW_TAB: NewTabConfig = { mode: 'current', greeting: true, clock: false, shortcuts: true, quote: false, widgets: false, wallpaperId: null }

export interface PrivacyConfig {
  /** Nothing about how Orbis is used is learnt or kept. */
  doNotPersonalize: boolean
  /** Personalisation never follows you into private tabs. */
  keepOutOfPrivate: boolean
  keepUsageDays: number
}

export const DEFAULT_PRIVACY: PrivacyConfig = { doNotPersonalize: false, keepOutOfPrivate: true, keepUsageDays: 30 }

export interface PerformanceConfig {
  mode: 'balanced' | 'performance' | 'visual' | 'battery'
  /** Widgets that have not been looked at stop doing work. */
  suspendIdleWidgets: boolean
  /** Remote things refresh less often and are cached for longer. */
  dataSaver: boolean
}

export const DEFAULT_PERFORMANCE: PerformanceConfig = { mode: 'balanced', suspendIdleWidgets: true, dataSaver: false }

export interface AccessibilityConfig {
  highContrast: boolean
  largerText: boolean
  alwaysShowFocus: boolean
}

export const DEFAULT_ACCESSIBILITY: AccessibilityConfig = { highContrast: false, largerText: false, alwaysShowFocus: false }

export interface NotificationsConfig {
  quietHours: { enabled: boolean; from: string; to: string }
  categories: Record<string, boolean>
}

export const DEFAULT_NOTIFICATIONS: NotificationsConfig = { quietHours: { enabled: false, from: '22:00', to: '07:00' }, categories: {} }

export interface ExperienceConfig {
  schemaVersion: number
  appearance: AppearanceConfig
  newTab: NewTabConfig
  wallpapers: WallpaperConfig[]
  themes: StoredTheme[]
  /** Which of the user's themes is in use, or null for Orbis's own. */
  themeId: string | null
  privacy: PrivacyConfig
  performance: PerformanceConfig
  accessibility: AccessibilityConfig
  notifications: NotificationsConfig
  /** Which Pulsar model, language and microphone every voice-input button in Orbis uses — one setting for all of them. */
  voice: VoiceInputConfig
  dashboards: Dashboard[]
  /** Which dashboard's widgets are on screen, or null when the widgets below are simply the ones chosen. */
  activeDashboardId: string | null
  widgets: WidgetInstance[]
  scenes: unknown[]
  /** "Tell me when...": what Orbis is watching, and what it should say when it becomes true. */
  rules: StoredRule[]
  /** The looks Orbis offers and the ones the person has made. */
  presets: StoredPreset[]
  /** Which one is being worn, or null for whatever the appearance below happens to say. */
  activePresetId: string | null
  shortcuts: unknown[]
  /** Changed at, so two configurations can be told apart. */
  updatedAt: number
}

/** Exactly the Orbis everyone already has: nothing added, nothing changed. */
export function defaultConfig(): ExperienceConfig {
  return {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    appearance: { ...DEFAULT_APPEARANCE },
    newTab: { ...DEFAULT_NEW_TAB },
    wallpapers: [],
    themes: [],
    themeId: null,
    privacy: { ...DEFAULT_PRIVACY },
    performance: { ...DEFAULT_PERFORMANCE },
    accessibility: { ...DEFAULT_ACCESSIBILITY },
    notifications: { quietHours: { ...DEFAULT_NOTIFICATIONS.quietHours }, categories: {} },
    voice: defaultVoiceConfig(),
    dashboards: [],
    activeDashboardId: null,
    widgets: [],
    scenes: [],
    rules: [],
    presets: [],
    activePresetId: null,
    shortcuts: [],
    updatedAt: 0
  }
}

/** Whether a configuration is the untouched Orbis experience (so "Restore original" can say there is nothing to undo). */
export function isDefaultConfig(config: ExperienceConfig): boolean {
  const fresh = defaultConfig()
  return JSON.stringify({ ...config, updatedAt: 0 }) === JSON.stringify({ ...fresh, updatedAt: 0 })
}

// ---------------------------------------------------------------- reading stored configuration

const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
const colour = (value: unknown, fallback: string): string => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback)
const time = (value: unknown, fallback: string): string => (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback)

/** A stored configuration read back safely: anything unknown, missing or out of range falls back to Orbis's own value. */
export function normalizeConfig(raw: unknown): ExperienceConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ExperienceConfig>
  const appearance = (r.appearance ?? {}) as Partial<AppearanceConfig>
  const newTab = (r.newTab ?? {}) as Partial<NewTabConfig>
  const privacy = (r.privacy ?? {}) as Partial<PrivacyConfig>
  const performance = (r.performance ?? {}) as Partial<PerformanceConfig>
  const accessibility = (r.accessibility ?? {}) as Partial<AccessibilityConfig>
  const notifications = (r.notifications ?? {}) as Partial<NotificationsConfig>
  const wallpapers = (Array.isArray(r.wallpapers) ? r.wallpapers : [])
    .filter((w): w is WallpaperConfig => Boolean(w) && typeof w.id === 'string' && typeof w.source === 'string')
    // Only what Orbis holds itself: a picture the user added, or a gradient Orbis draws. Nothing is fetched.
    .filter((w) => w.source.startsWith('data:image/') || w.kind === 'gradient')
    .map((w) => ({ id: w.id, name: String(w.name ?? 'Wallpaper').slice(0, 60), source: w.source.slice(0, 8_000_000), kind: w.kind === 'gradient' ? ('gradient' as const) : ('image' as const), addedAt: num(w.addedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER) }))
    .slice(0, 60)
  const dashboards = normalizeDashboards(r.dashboards)
  const themes = (Array.isArray(r.themes) ? r.themes : [])
    .filter((t): t is StoredTheme => Boolean(t) && typeof t.id === 'string')
    .map((t) => ({
      id: t.id,
      name: String(t.name ?? 'Theme').slice(0, 60),
      base: t.base === 'light' ? ('light' as const) : ('dark' as const),
      // Only tokens Orbis really uses, holding only what a colour can hold.
      tokens: cleanTokens(t.tokens),
      createdAt: num(t.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
    }))
    .slice(0, 40)
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, 500) : [])
  return {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    appearance: {
      accent: appearance.accent === '' ? '' : colour(appearance.accent, ''),
      density: pick(appearance.density, ['comfortable', 'cosy', 'compact'] as const, DEFAULT_APPEARANCE.density),
      cornerRadius: num(appearance.cornerRadius, 0, 0, 24),
      transparency: num(appearance.transparency, 1, 0.5, 1.5),
      blur: num(appearance.blur, 1, 0, 2),
      reducedMotion: pick(appearance.reducedMotion, ['system', 'on', 'off'] as const, DEFAULT_APPEARANCE.reducedMotion),
      fontScale: num(appearance.fontScale, 1, 0.85, 1.4)
    },
    newTab: {
      mode: pick(newTab.mode, ['current', 'minimal', 'focus', 'study', 'research', 'developer', 'personal'] as const, DEFAULT_NEW_TAB.mode),
      greeting: bool(newTab.greeting, DEFAULT_NEW_TAB.greeting),
      clock: bool(newTab.clock, DEFAULT_NEW_TAB.clock),
      shortcuts: bool(newTab.shortcuts, DEFAULT_NEW_TAB.shortcuts),
      quote: bool(newTab.quote, DEFAULT_NEW_TAB.quote),
      widgets: bool(newTab.widgets, DEFAULT_NEW_TAB.widgets),
      wallpaperId: typeof newTab.wallpaperId === 'string' && wallpapers.some((w) => w.id === newTab.wallpaperId) ? newTab.wallpaperId : null
    },
    wallpapers,
    themes,
    // One of Orbis's own themes, or one of yours; a theme that has been deleted falls back to Orbis's colours.
    themeId: typeof r.themeId === 'string' && themeExists(r.themeId, themes) ? r.themeId : null,
    privacy: {
      doNotPersonalize: bool(privacy.doNotPersonalize, DEFAULT_PRIVACY.doNotPersonalize),
      keepOutOfPrivate: bool(privacy.keepOutOfPrivate, DEFAULT_PRIVACY.keepOutOfPrivate),
      keepUsageDays: num(privacy.keepUsageDays, DEFAULT_PRIVACY.keepUsageDays, 0, 365)
    },
    performance: {
      mode: pick(performance.mode, ['balanced', 'performance', 'visual', 'battery'] as const, DEFAULT_PERFORMANCE.mode),
      suspendIdleWidgets: bool(performance.suspendIdleWidgets, DEFAULT_PERFORMANCE.suspendIdleWidgets),
      dataSaver: bool(performance.dataSaver, DEFAULT_PERFORMANCE.dataSaver)
    },
    accessibility: {
      highContrast: bool(accessibility.highContrast, false),
      largerText: bool(accessibility.largerText, false),
      alwaysShowFocus: bool(accessibility.alwaysShowFocus, false)
    },
    voice: normalizeVoiceConfig(r.voice),
    notifications: {
      quietHours: {
        enabled: bool(notifications.quietHours?.enabled, false),
        from: time(notifications.quietHours?.from, DEFAULT_NOTIFICATIONS.quietHours.from),
        to: time(notifications.quietHours?.to, DEFAULT_NOTIFICATIONS.quietHours.to)
      },
      categories: Object.fromEntries(Object.entries(notifications.categories ?? {}).filter(([key, value]) => /^[a-z-]{1,40}$/.test(key) && typeof value === 'boolean').slice(0, 40))
    },
    dashboards,
    activeDashboardId: typeof r.activeDashboardId === 'string' && dashboards.some((d) => d.id === r.activeDashboardId) ? r.activeDashboardId : null,
    widgets: normalizeWidgets(list(r.widgets)),
    scenes: list(r.scenes),
    rules: cleanRules(r.rules),
    presets: cleanPresets(r.presets),
    activePresetId: typeof r.activePresetId === 'string' ? r.activePresetId : null,
    shortcuts: list(r.shortcuts),
    updatedAt: num(r.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER)
  }
}

/** Each step brings a configuration forward one version. Nothing is ever thrown away without a migration. */
export const MIGRATIONS: Record<number, (config: Record<string, unknown>) => Record<string, unknown>> = {}

export interface MigrationResult {
  config: ExperienceConfig
  /** The version it came from, when it had to be brought forward. */
  from?: number
  /** True when the stored configuration could not be read at all and Orbis started from its own defaults. */
  recovered: boolean
}

/** Reads a stored configuration, bringing it forward from an older Orbis if need be. Never throws. */
export function migrateConfig(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== 'object') return { config: defaultConfig(), recovered: true }
  const stored = raw as Record<string, unknown>
  const from = typeof stored.schemaVersion === 'number' ? stored.schemaVersion : 0
  if (from > EXPERIENCE_SCHEMA_VERSION) {
    // Written by a newer Orbis: keep what this one understands rather than refusing to start.
    return { config: normalizeConfig(stored), from, recovered: false }
  }
  let working = stored
  try {
    for (let version = from; version < EXPERIENCE_SCHEMA_VERSION; version++) {
      const step = MIGRATIONS[version]
      if (step) working = step(working)
    }
  } catch {
    return { config: defaultConfig(), recovered: true }
  }
  return { config: normalizeConfig(working), ...(from < EXPERIENCE_SCHEMA_VERSION ? { from } : {}), recovered: false }
}

export interface ExperienceHealth {
  ok: boolean
  /** What is wrong, in words the user can act on. */
  problems: string[]
  /** What Orbis did about it by itself. */
  repairs: string[]
  schemaVersion: number
  snapshots: number
  /** The version it was brought forward from, when it had to be. */
  migratedFrom?: number
}

// ---------------------------------------------------------------- where a value comes from

/** The layers that may have an opinion, weakest first. This order is fixed and is what the diagnostics explain. */
export const LAYERS = ['orbis', 'profile', 'workspace', 'scene', 'rule', 'user'] as const
export type Layer = (typeof LAYERS)[number]

export interface LayeredValue<T> {
  value: T
  /** Which layer decided it. */
  from: Layer
  /** What each layer had to say, for "why is this set?". */
  considered: { layer: Layer; value: T }[]
}

/**
 * Works out a setting's value from the layers that have one. The last layer with something to say wins, and every
 * opinion is kept so Orbis can explain the result rather than leaving the user guessing.
 */
export function resolveLayered<T>(base: T, opinions: Partial<Record<Layer, T | undefined>>): LayeredValue<T> {
  let value = base
  let from: Layer = 'orbis'
  const considered: { layer: Layer; value: T }[] = [{ layer: 'orbis', value: base }]
  for (const layer of LAYERS) {
    if (layer === 'orbis') continue
    const opinion = opinions[layer]
    if (opinion === undefined) continue
    considered.push({ layer, value: opinion })
    value = opinion
    from = layer
  }
  return { value, from, considered }
}

// ---------------------------------------------------------------- changes, undo and export

export interface ConfigChange {
  /** Where the change is, such as "appearance.density". */
  path: string
  before: unknown
  after: unknown
}

/** What changed between two configurations, for "recently changed", undo and conflict resolution. */
export function diffConfig(before: ExperienceConfig, after: ExperienceConfig, prefix = ''): ConfigChange[] {
  const changes: ConfigChange[] = []
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (path === 'updatedAt' || path === 'schemaVersion') return
    const bothObjects = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)
    if (bothObjects) {
      for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
      }
      return
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path, before: a, after: b })
  }
  walk(before, after, prefix)
  return changes
}

export interface Snapshot {
  id: string
  /** Why it was taken, in words: "Before changing appearance". */
  reason: string
  takenAt: number
  config: ExperienceConfig
}

export const MAX_SNAPSHOTS = 20

/** Keeps the most recent snapshots, newest first. */
export const addSnapshot = (snapshots: Snapshot[], snapshot: Snapshot): Snapshot[] => [snapshot, ...snapshots].slice(0, MAX_SNAPSHOTS)

export interface ExperienceExport {
  format: 'orbis-experience'
  version: number
  exportedAt: number
  config: ExperienceConfig
}

/** A configuration written out to share or keep. Nothing private travels: only what was personalised. */
export function exportConfig(config: ExperienceConfig): ExperienceExport {
  return { format: 'orbis-experience', version: EXPERIENCE_SCHEMA_VERSION, exportedAt: Date.now(), config: normalizeConfig(config) }
}

export interface ImportCheck {
  ok: boolean
  config?: ExperienceConfig
  /** What is in it, in plain words, so the user knows before applying. */
  summary: string[]
  problems: string[]
}

/** Checks something offered for import: the right kind of file, readable, and brought forward if it is older. */
export function checkImport(raw: unknown): ImportCheck {
  const problems: string[] = []
  const file = (raw && typeof raw === 'object' ? raw : {}) as Partial<ExperienceExport>
  if (file.format !== 'orbis-experience') problems.push('This is not an Orbis personalisation file.')
  if (!file.config || typeof file.config !== 'object') problems.push('There is no configuration in it.')
  if (problems.length) return { ok: false, summary: [], problems }
  const migrated = migrateConfig(file.config)
  if (migrated.recovered) return { ok: false, summary: [], problems: ['The configuration in it could not be read.'] }
  return { ok: true, config: migrated.config, summary: describeConfig(migrated.config), problems: [] }
}

/** A configuration in plain words, for the import preview, snapshots and a readable export. */
export function describeConfig(config: ExperienceConfig): string[] {
  const lines: string[] = []
  const a = config.appearance
  if (a.accent) lines.push(`Accent colour ${a.accent}`)
  if (a.density !== 'comfortable') lines.push(`${a.density === 'compact' ? 'Compact' : 'Cosy'} spacing`)
  if (a.fontScale !== 1) lines.push(`Text at ${Math.round(a.fontScale * 100)}%`)
  if (a.cornerRadius) lines.push(`Corners ${a.cornerRadius}px`)
  if (a.transparency !== 1) lines.push(`Panels ${a.transparency < 1 ? 'more solid' : 'more see-through'}`)
  if (a.blur !== 1) lines.push(`Background blur ${Math.round(a.blur * 100)}%`)
  if (a.reducedMotion !== 'system') lines.push(`Less movement: ${a.reducedMotion}`)
  if (config.themeId) lines.push(`Theme: ${themeName(config.themeId, config.themes) ?? config.themeId}`)
  if (config.wallpapers.length) lines.push(`${config.wallpapers.length} wallpaper${config.wallpapers.length === 1 ? '' : 's'}`)
  if (config.newTab.mode !== 'current') lines.push(`New tab: ${config.newTab.mode}`)
  if (config.accessibility.highContrast) lines.push('High contrast')
  if (config.accessibility.largerText) lines.push('Larger text')
  if (config.performance.mode !== 'balanced') lines.push(`Performance: ${config.performance.mode}`)
  if (config.privacy.doNotPersonalize) lines.push('Personalisation learning is off')
  for (const [name, items] of [
    ['dashboard', config.dashboards],
    ['widget', config.widgets],
    ['scene', config.scenes],
    ['rule', config.rules],
    ['preset', config.presets],
    ['shortcut', config.shortcuts]
  ] as const) {
    if (items.length) lines.push(`${items.length} ${name}${items.length === 1 ? '' : 's'}`)
  }
  return lines.length ? lines : ['The Orbis experience, unchanged']
}

// ---------------------------------------------------------------- what the window applies

/**
 * The preset Orbis is wearing, whether it is one of its own or one the person made.
 *
 * A preset that has been deleted, or that came from a newer Orbis, is simply not worn: the appearance already stored
 * in the configuration still applies, so nothing is lost and nothing is invented to replace it.
 */
export function activePreset(config: ExperienceConfig): StoredPreset | null {
  if (!config.activePresetId) return null
  return builtInPreset(config.activePresetId) ?? config.presets.find((p) => p.id === config.activePresetId) ?? null
}

/**
 * The only things the runtime changes about how Orbis looks, as plain CSS variables. Anything the user has not
 * personalised is left out entirely, so Orbis keeps its own value and the default experience is untouched.
 */
export function appearanceVariables(config: ExperienceConfig, systemReducedMotion: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  const a = config.appearance
  if (a.accent) {
    out['--cyan'] = a.accent
    out['--cyan-dim'] = `color-mix(in srgb, ${a.accent} 55%, transparent)`
    out['--cyan-fill'] = `color-mix(in srgb, ${a.accent} 16%, transparent)`
    out['--cyan-glow'] = `color-mix(in srgb, ${a.accent} 45%, transparent)`
    out['--cyan-glow-soft'] = `color-mix(in srgb, ${a.accent} 18%, transparent)`
    out['--active'] = `color-mix(in srgb, ${a.accent} 10%, transparent)`
  }
  if (a.density !== 'comfortable') out['--density-scale'] = a.density === 'compact' ? '0.82' : '0.92'
  if (a.cornerRadius) out['--radius-scale'] = String(a.cornerRadius)
  if (a.transparency !== 1) out['--glass'] = `rgba(14, 15, 18, ${Math.min(1, 0.84 * a.transparency).toFixed(2)})`
  if (a.blur !== 1) out['--blur-scale'] = String(a.blur)
  if (a.fontScale !== 1) out['--font-scale'] = String(a.fontScale)
  for (const [token, value] of Object.entries(themeTokens(config.themeId, config.themes))) out[`--${token}`] = value
  if (config.accessibility.highContrast) {
    out['--text'] = '#ffffff'
    out['--muted'] = '#d8dbe1'
    out['--line-strong'] = 'rgba(255, 255, 255, 0.28)'
    out['--pill-border'] = 'rgba(255, 255, 255, 0.35)'
  }
  if (config.accessibility.largerText) out['--font-scale'] = String(Math.max(Number(out['--font-scale'] ?? 1), 1.15))
  // The preset on top: how much the interface moves, and the background it was designed around. It comes last so the
  // accessibility rules above cannot be undone by a look, and it is told whether movement is wanted at all -- which
  // is what finally gives this function a use for the system setting it is handed.
  const worn = activePreset(config)
  if (worn) Object.assign(out, presetVariables(worn, wantsReducedMotion(config, systemReducedMotion)))
  return out
}

/** Whether movement should be kept to a minimum right now. */
export const wantsReducedMotion = (config: ExperienceConfig, systemReducedMotion: boolean): boolean =>
  config.appearance.reducedMotion === 'on' || (config.appearance.reducedMotion === 'system' && systemReducedMotion) || config.performance.mode === 'battery' || config.performance.mode === 'performance'
