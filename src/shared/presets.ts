import type { AppearanceConfig, ExperienceConfig } from './experience.ts'
import { builtInTheme } from './themes.ts'

/**
 * Orbis's own appearance, repeated here rather than imported.
 *
 * `experience.ts` reads this file to clean the presets it stores, so importing its values back would make the two
 * modules depend on each other while they are still being loaded -- and this file reads the defaults the moment it
 * is loaded, to build Orbis's own presets. The type still comes from there, and a test asserts these values are the
 * same as `DEFAULT_APPEARANCE`, so the two cannot quietly drift apart.
 */
const DEFAULT_APPEARANCE: AppearanceConfig = {
  accent: '',
  density: 'comfortable',
  cornerRadius: 0,
  transparency: 1,
  blur: 1,
  reducedMotion: 'system',
  fontScale: 1
}

/**
 * A preset: the whole look of Orbis, in one choice.
 *
 * Orbis already had the parts. `themes.ts` holds the palettes, `experience.ts` holds how see-through panels are, how
 * round corners are, how dense the layout is and how much movement is wanted, and `cssVariables` already turns all of
 * that into the variables the interface is drawn from. What was missing was the thing that ties them together: the
 * configuration even reserved a `presets` field for it and left it as `unknown[]`.
 *
 * So a preset is not another appearance engine. It is a named set of values for the one that exists -- which is what
 * keeps a preset honest: everything it changes is something a person could have changed by hand, and everything it
 * cannot change is something Orbis genuinely does not let appearance touch.
 */
export const PRESET_SCHEMA_VERSION = 1

/** Enough for a considered collection; far short of a number that would make the list unusable. */
export const MAX_PRESETS = 60

export type PresetCategory = 'Orbis' | 'Calm' | 'Dark' | 'Light' | 'Vivid' | 'Work'

/**
 * How much the interface moves.
 *
 * These are factors on what Orbis already does rather than absolute durations, so a preset asks for "half as much
 * movement" and cannot ask for something that has never been designed.
 */
export interface PresetMotion {
  /** How far things move and how much they glow. 0 is still, 1 is Orbis's own. */
  intensity: number
  /** How long transitions take. Below 1 is quicker, above 1 is more languid. */
  speed: number
}

/**
 * The background a preset is designed around.
 *
 * `orbis` is the background Orbis has always drawn. A gradient is drawn by Orbis too -- it is a handful of colours,
 * not a file -- so a preset stays small, works offline and cannot carry anything but appearance.
 */
/**
 * The movement a background is allowed to have.
 *
 * Each of these names an animation Orbis itself draws, in its own stylesheet, out of transforms and opacity and
 * nothing else. A preset chooses from this list; it cannot describe an animation, which is what stops a shared preset
 * from being a way to run something. `none` is a background that sits still.
 */
export type PresetBackdrop = 'none' | 'drift' | 'aurora' | 'stars' | 'flow' | 'waves' | 'scan'

const BACKDROPS: PresetBackdrop[] = ['none', 'drift', 'aurora', 'stars', 'flow', 'waves', 'scan']

export interface PresetBackground {
  kind: 'orbis' | 'gradient'
  /** For a gradient, the CSS Orbis draws. Ignored for `orbis`. */
  value?: string
  /**
   * How it moves. Defaults to `none`, so a preset that says nothing about movement gets none -- and so every preset
   * written before this field existed still loads as the still background it was.
   */
  backdrop?: PresetBackdrop
}

export interface StoredPreset {
  id: string
  name: string
  description: string
  schemaVersion: number
  category: PresetCategory
  /**
   * Orbis's own presets are read-only. Starting from one makes a copy, so the original is always still there to
   * come back to.
   */
  builtIn: boolean
  /** The palette, as a theme id. `null` is the palette Orbis has always used. */
  themeId: string | null
  appearance: AppearanceConfig
  motion: PresetMotion
  background: PresetBackground
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------- limits
//
// A preset is configuration a person can be given, imported or talked into, so every number it carries is clamped to
// a range the interface was built to survive. Nothing here can ask for a blur that stops the browser drawing.

const LIMITS = {
  cornerRadius: [0, 2.5],
  transparency: [0.3, 1],
  blur: [0, 2],
  fontScale: [0.8, 1.6],
  intensity: [0, 1.6],
  speed: [0.4, 2.5]
} as const

const clamp = (value: unknown, [low, high]: readonly [number, number], fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(high, Math.max(low, n))
}

const DENSITIES = ['comfortable', 'cosy', 'compact'] as const
const REDUCED = ['system', 'on', 'off'] as const
const CATEGORIES: PresetCategory[] = ['Orbis', 'Calm', 'Dark', 'Light', 'Vivid', 'Work']

const text = (value: unknown, max: number, fallback = ''): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : fallback

/** A colour Orbis will accept as an accent, or '' for its own. */
const accent = (value: unknown): string => {
  const raw = text(value, 40)
  return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : ''
}

// ---------------------------------------------------------------- what Orbis ships with

const preset = (
  id: string,
  name: string,
  category: PresetCategory,
  description: string,
  themeId: string | null,
  appearance: Partial<AppearanceConfig>,
  motion: PresetMotion,
  background: PresetBackground
): StoredPreset => ({
  id,
  name,
  description,
  schemaVersion: PRESET_SCHEMA_VERSION,
  category,
  builtIn: true,
  themeId,
  appearance: { ...DEFAULT_APPEARANCE, ...appearance },
  motion,
  background,
  createdAt: 0,
  updatedAt: 0
})

/**
 * Orbis's own presets.
 *
 * Each one is a decision about a way of working, not a colour swap: what the palette is, how solid the panels are,
 * how tight the layout is, how much the interface moves, and what is behind it. Two presets that would have differed
 * only in name are not here.
 */
export const BUILT_IN_PRESETS: StoredPreset[] = [
  // ---- Orbis itself -------------------------------------------------------
  preset(
    'orbis-default',
    'Orbis',
    'Orbis',
    'Orbis exactly as it comes.',
    null,
    {},
    { intensity: 1, speed: 1 },
    { kind: 'orbis' }
  ),

  // ---- quiet --------------------------------------------------------------
  preset(
    'orbis-minimal',
    'Minimal',
    'Calm',
    'Quiet and flat. Solid panels, little movement, nothing decorative.',
    'orbis-midnight',
    { transparency: 1, blur: 0, cornerRadius: 0.6, density: 'cosy' },
    { intensity: 0.25, speed: 0.8 },
    { kind: 'gradient', value: 'radial-gradient(120% 90% at 50% 0%, #15171c 0%, #0b0c0f 55%, #050506 100%)' }
  ),
  preset(
    'orbis-monochrome',
    'Monochrome',
    'Dark',
    'Grey, and only grey. Nothing is coloured except what you are doing.',
    'orbis-midnight',
    { accent: '#b9bec6', transparency: 1, blur: 0, cornerRadius: 0.25, density: 'cosy' },
    { intensity: 0.3, speed: 0.75 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #17181a 0%, #0d0e0f 60%, #050505 100%)' }
  ),
  preset(
    'orbis-study',
    'Study',
    'Calm',
    'Warm and still, for long reading.',
    'orbis-ember',
    { accent: '#ffb877', transparency: 0.92, blur: 0.5, cornerRadius: 1, fontScale: 1.05 },
    { intensity: 0.35, speed: 1.2 },
    { kind: 'gradient', value: 'radial-gradient(120% 90% at 50% 0%, #1a1512 0%, #0d0a09 60%, #060505 100%)' }
  ),
  preset(
    'orbis-forest-preset',
    'Forest',
    'Calm',
    'Green and low, with barely any movement.',
    'orbis-forest',
    { accent: '#64c88c', transparency: 0.9, blur: 0.6, cornerRadius: 0.9 },
    { intensity: 0.3, speed: 1.3 },
    {
      kind: 'gradient',
      value: 'radial-gradient(120% 90% at 50% 10%, #0d1611 0%, #070b09 60%, #030504 100%)',
      backdrop: 'drift'
    }
  ),
  preset(
    'orbis-ocean',
    'Ocean',
    'Calm',
    'Cool blue, moving the way water does.',
    'orbis-midnight',
    { accent: '#4fc3e8', transparency: 0.86, blur: 1, cornerRadius: 1.1 },
    { intensity: 0.6, speed: 1.6 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(110% 80% at 30% 0%, rgba(60, 170, 220, 0.2) 0%, transparent 62%), linear-gradient(180deg, #071620 0%, #040c12 60%, #020609 100%)',
      backdrop: 'waves'
    }
  ),

  // ---- dark ---------------------------------------------------------------
  preset(
    'orbis-glass',
    'Glass',
    'Dark',
    'Panels you can see through, with the background showing between them.',
    'orbis-midnight',
    { transparency: 0.62, blur: 1.6, cornerRadius: 1.35 },
    { intensity: 1.1, speed: 1.15 },
    {
      kind: 'gradient',
      value: 'radial-gradient(130% 100% at 20% 0%, #16202b 0%, #0a0f15 55%, #04070a 100%)',
      backdrop: 'drift'
    }
  ),
  preset(
    'orbis-amoled',
    'AMOLED',
    'Dark',
    'Black that is actually black, and as little light as the interface can manage.',
    'orbis-midnight',
    { transparency: 1, blur: 0, cornerRadius: 0.4, density: 'cosy' },
    { intensity: 0.2, speed: 0.85 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #000000 0%, #000000 100%)' }
  ),
  preset(
    'orbis-midnight-preset',
    'Midnight',
    'Dark',
    'Deep blue and quiet, with a little depth.',
    'orbis-midnight',
    { accent: '#6ea8ff', transparency: 0.8, blur: 1, cornerRadius: 1 },
    { intensity: 0.7, speed: 1.2 },
    {
      kind: 'gradient',
      value: 'radial-gradient(120% 90% at 50% 0%, #0d1522 0%, #070a11 60%, #030407 100%)',
      backdrop: 'drift'
    }
  ),
  preset(
    'orbis-cinematic',
    'Cinematic',
    'Dark',
    'Wide and dim, with the light coming from one side.',
    'orbis-midnight',
    { accent: '#d8c9a8', transparency: 0.74, blur: 1.3, cornerRadius: 0.9, density: 'cosy' },
    { intensity: 0.8, speed: 1.8 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(120% 100% at 8% 0%, rgba(216, 201, 168, 0.12) 0%, transparent 58%), linear-gradient(180deg, #0c0b0a 0%, #060505 55%, #020202 100%)',
      backdrop: 'drift'
    }
  ),
  preset(
    'orbis-deep-ocean',
    'Deep Ocean',
    'Dark',
    'Far down. Very dark, very slow, with the light coming from above.',
    'orbis-midnight',
    { accent: '#3f9fbf', transparency: 0.72, blur: 1.5, cornerRadius: 1.2 },
    { intensity: 0.5, speed: 2.1 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(100% 70% at 50% -10%, rgba(60, 160, 200, 0.16) 0%, transparent 60%), linear-gradient(180deg, #040d13 0%, #02070b 55%, #010304 100%)',
      backdrop: 'waves'
    }
  ),

  // ---- vivid --------------------------------------------------------------
  preset(
    'orbis-aurora',
    'Aurora',
    'Vivid',
    'Cold light over a dark sky, moving slowly.',
    'orbis-midnight',
    { accent: '#59f2c8', transparency: 0.7, blur: 1.4, cornerRadius: 1.2 },
    { intensity: 1.3, speed: 1.4 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(90% 70% at 15% 0%, rgba(89, 242, 200, 0.22) 0%, transparent 60%), radial-gradient(80% 60% at 85% 10%, rgba(120, 130, 255, 0.2) 0%, transparent 65%), linear-gradient(180deg, #071018 0%, #04070c 100%)',
      backdrop: 'aurora'
    }
  ),
  preset(
    'orbis-space',
    'Space',
    'Vivid',
    'Depth and distance. Dark, wide, and slow.',
    'orbis-violet',
    { accent: '#8aa6ff', transparency: 0.68, blur: 1.2, cornerRadius: 1.1 },
    { intensity: 0.9, speed: 1.5 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(100% 80% at 70% 10%, rgba(120, 90, 220, 0.24) 0%, transparent 60%), radial-gradient(70% 60% at 10% 80%, rgba(60, 90, 200, 0.18) 0%, transparent 60%), linear-gradient(180deg, #06070f 0%, #020308 100%)',
      backdrop: 'stars'
    }
  ),
  preset(
    'orbis-cyber',
    'Cyber',
    'Vivid',
    'Hard edges and bright signal colour. Everything answers immediately.',
    'orbis-midnight',
    { accent: '#00e5ff', transparency: 0.85, blur: 0.5, cornerRadius: 0.35, density: 'compact' },
    { intensity: 1.4, speed: 0.6 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(100% 70% at 50% 0%, rgba(0, 229, 255, 0.12) 0%, transparent 55%), linear-gradient(180deg, #060a0d 0%, #020405 100%)',
      backdrop: 'scan'
    }
  ),
  preset(
    'orbis-violet-preset',
    'Violet',
    'Vivid',
    'Purple light on near-black.',
    'orbis-violet',
    { accent: '#b98cff', transparency: 0.75, blur: 1.2, cornerRadius: 1.2 },
    { intensity: 1, speed: 1.2 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(110% 80% at 30% 0%, rgba(150, 100, 255, 0.2) 0%, transparent 60%), linear-gradient(180deg, #0a0712 0%, #040308 100%)',
      backdrop: 'aurora'
    }
  ),
  preset(
    'orbis-crimson',
    'Crimson',
    'Vivid',
    'Red held back, on black.',
    'orbis-ember',
    { accent: '#ff5d6c', transparency: 0.78, blur: 1, cornerRadius: 0.7 },
    { intensity: 1, speed: 0.9 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(110% 80% at 20% 0%, rgba(230, 60, 80, 0.16) 0%, transparent 58%), linear-gradient(180deg, #130708 0%, #080304 55%, #030101 100%)',
      backdrop: 'drift'
    }
  ),
  preset(
    'orbis-ember',
    'Ember',
    'Vivid',
    'Warm and dark, like low light.',
    'orbis-ember',
    { accent: '#ff8f5e', transparency: 0.82, blur: 0.9, cornerRadius: 1 },
    { intensity: 0.9, speed: 1.1 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(110% 80% at 25% 0%, rgba(255, 130, 70, 0.16) 0%, transparent 60%), linear-gradient(180deg, #120b08 0%, #060403 100%)',
      backdrop: 'drift'
    }
  ),
  preset(
    'orbis-sunset',
    'Sunset',
    'Vivid',
    'The last of the light, still moving.',
    'orbis-ember',
    { accent: '#ff9d6e', transparency: 0.76, blur: 1.2, cornerRadius: 1.25 },
    { intensity: 1.1, speed: 1.7 },
    {
      kind: 'gradient',
      value: 'linear-gradient(180deg, #2a1526 0%, #46203a 18%, #7a3348 42%, #b8543f 62%, #1a0d17 100%)',
      backdrop: 'flow'
    }
  ),
  preset(
    'orbis-neon-city',
    'Neon City',
    'Vivid',
    'Wet streets at night. Dark, with colour bleeding across it.',
    'orbis-violet',
    { accent: '#ff4fd8', transparency: 0.7, blur: 1.5, cornerRadius: 0.8, density: 'compact' },
    { intensity: 1.35, speed: 1.1 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(70% 55% at 12% 88%, rgba(255, 79, 216, 0.22) 0%, transparent 62%), radial-gradient(70% 55% at 88% 78%, rgba(0, 220, 255, 0.2) 0%, transparent 62%), linear-gradient(180deg, #08060f 0%, #04030a 55%, #010103 100%)',
      backdrop: 'flow'
    }
  ),
  preset(
    'orbis-holographic',
    'Holographic',
    'Vivid',
    'Light that changes colour as it passes. Very see-through.',
    'orbis-violet',
    { accent: '#7fe3ff', transparency: 0.52, blur: 2, cornerRadius: 1.5 },
    { intensity: 1.25, speed: 1.35 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(80% 60% at 20% 15%, rgba(127, 227, 255, 0.2) 0%, transparent 60%), radial-gradient(80% 60% at 80% 30%, rgba(200, 130, 255, 0.18) 0%, transparent 60%), radial-gradient(70% 50% at 50% 95%, rgba(130, 255, 200, 0.14) 0%, transparent 60%), linear-gradient(180deg, #080a12 0%, #03040a 100%)',
      backdrop: 'aurora'
    }
  ),
  preset(
    'orbis-matrix',
    'Digital Matrix',
    'Vivid',
    'Green on black, with something running underneath.',
    'orbis-forest',
    { accent: '#39ff88', transparency: 0.88, blur: 0.4, cornerRadius: 0.2, density: 'compact', fontScale: 0.96 },
    { intensity: 1.2, speed: 0.7 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(100% 70% at 50% 0%, rgba(57, 255, 136, 0.1) 0%, transparent 55%), linear-gradient(180deg, #040806 0%, #010301 100%)',
      backdrop: 'scan'
    }
  ),
  preset(
    'orbis-retro',
    'Retro',
    'Vivid',
    'Amber on a curved screen, lines and all.',
    'orbis-ember',
    { accent: '#ffb000', transparency: 0.94, blur: 0.2, cornerRadius: 0.15, density: 'cosy' },
    { intensity: 0.85, speed: 0.8 },
    {
      kind: 'gradient',
      value: 'radial-gradient(110% 85% at 50% 45%, #1b1206 0%, #0e0903 55%, #050301 100%)',
      backdrop: 'scan'
    }
  ),
  preset(
    'orbis-gaming',
    'Gaming',
    'Vivid',
    'Loud and fast. Strong colour, everything reacts.',
    'orbis-violet',
    { accent: '#a855ff', transparency: 0.8, blur: 0.8, cornerRadius: 0.6, density: 'compact' },
    { intensity: 1.6, speed: 0.55 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(80% 60% at 0% 100%, rgba(168, 85, 255, 0.22) 0%, transparent 60%), radial-gradient(80% 60% at 100% 0%, rgba(0, 200, 255, 0.18) 0%, transparent 60%), linear-gradient(180deg, #0a0712 0%, #020105 100%)',
      backdrop: 'flow'
    }
  ),

  // ---- work ---------------------------------------------------------------
  preset(
    'orbis-professional',
    'Professional',
    'Work',
    'Restrained and readable. Nothing competes with the page.',
    'orbis-midnight',
    { accent: '#7aa2d9', transparency: 0.95, blur: 0.4, cornerRadius: 0.7, density: 'cosy' },
    { intensity: 0.5, speed: 0.85 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #121519 0%, #0a0c0f 100%)' }
  ),
  preset(
    'orbis-developer',
    'Developer',
    'Work',
    'Dense and technical. More on screen, less around it.',
    'orbis-forest',
    { accent: '#5fd68a', transparency: 1, blur: 0, cornerRadius: 0.3, density: 'compact', fontScale: 0.95 },
    { intensity: 0.4, speed: 0.6 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #0b100d 0%, #050706 100%)' }
  ),
  preset(
    'orbis-terminal',
    'Terminal',
    'Work',
    'One window, one colour, square corners.',
    'orbis-forest',
    { accent: '#8fffc4', transparency: 1, blur: 0, cornerRadius: 0, density: 'compact', fontScale: 0.94 },
    { intensity: 0.35, speed: 0.5 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #050806 0%, #010201 100%)', backdrop: 'scan' }
  ),
  preset(
    'orbis-research',
    'Research',
    'Work',
    'Built around reading many things at once.',
    'orbis-midnight',
    { accent: '#9db4d0', transparency: 0.96, blur: 0.3, cornerRadius: 0.6, density: 'cosy', fontScale: 1.04 },
    { intensity: 0.4, speed: 0.9 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #101318 0%, #08090c 100%)' }
  ),

  // ---- light --------------------------------------------------------------
  preset(
    'orbis-daylight',
    'Daylight',
    'Light',
    'Orbis in the light, with panels that stay solid.',
    'orbis-daylight',
    { transparency: 1, blur: 0.3, cornerRadius: 0.8, density: 'cosy' },
    { intensity: 0.6, speed: 0.95 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #eef1f6 0%, #dfe4ec 100%)' }
  ),
  preset(
    'orbis-paper',
    'Paper',
    'Light',
    'Warm white and flat, for writing and reading.',
    'orbis-paper',
    { transparency: 1, blur: 0, cornerRadius: 0.5, density: 'cosy', fontScale: 1.05 },
    { intensity: 0.25, speed: 0.9 },
    { kind: 'gradient', value: 'linear-gradient(180deg, #f6f3ec 0%, #eae5da 100%)' }
  ),
  preset(
    'orbis-arctic',
    'Arctic',
    'Light',
    'Cold and bright, with ice in the corners.',
    'orbis-daylight',
    { accent: '#2f86b8', transparency: 0.9, blur: 1.1, cornerRadius: 1.1, density: 'cosy' },
    { intensity: 0.55, speed: 1.4 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(100% 75% at 25% 0%, rgba(120, 200, 235, 0.35) 0%, transparent 62%), linear-gradient(180deg, #f2f7fb 0%, #dce8f1 55%, #c9dae7 100%)',
      backdrop: 'drift'
    }
  ),
  preset(
    'orbis-solar',
    'Solar',
    'Light',
    'Warm daylight, with the light moving across it.',
    'orbis-paper',
    { accent: '#c2701a', transparency: 0.92, blur: 0.7, cornerRadius: 1, density: 'cosy' },
    { intensity: 0.7, speed: 1.6 },
    {
      kind: 'gradient',
      value:
        'radial-gradient(90% 70% at 80% 0%, rgba(255, 190, 90, 0.4) 0%, transparent 60%), linear-gradient(180deg, #fdf6e8 0%, #f4e6cd 55%, #e8d5b4 100%)',
      backdrop: 'flow'
    }
  )
]

export const builtInPreset = (id: string): StoredPreset | null => BUILT_IN_PRESETS.find((p) => p.id === id) ?? null

// ---------------------------------------------------------------- reading one in

/**
 * A preset from something that claims to be one.
 *
 * Presets travel: they are exported, shared and written by Orion. So nothing here is taken on trust. Every field is
 * read, bounded and defaulted, unknown fields are dropped, and a preset that names a palette this Orbis does not have
 * falls back to Orbis's own rather than leaving the interface with no colours at all.
 */
export function cleanPreset(raw: unknown, at = Date.now()): StoredPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 64)
  const name = text(o.name, 60)
  if (!id || !name) return null

  const a = (o.appearance ?? {}) as Record<string, unknown>
  const m = (o.motion ?? {}) as Record<string, unknown>
  const b = (o.background ?? {}) as Record<string, unknown>

  const themeId = typeof o.themeId === 'string' && builtInTheme(o.themeId) ? o.themeId : null
  const density = DENSITIES.includes(a.density as (typeof DENSITIES)[number])
    ? (a.density as AppearanceConfig['density'])
    : DEFAULT_APPEARANCE.density
  const reducedMotion = REDUCED.includes(a.reducedMotion as (typeof REDUCED)[number])
    ? (a.reducedMotion as AppearanceConfig['reducedMotion'])
    : DEFAULT_APPEARANCE.reducedMotion

  // A gradient is drawn by Orbis from the text it is given, so it is kept short and is never fetched from anywhere.
  const kind = b.kind === 'gradient' ? 'gradient' : 'orbis'
  const value = kind === 'gradient' ? text(b.value, 600) : undefined
  // A backdrop is chosen from Orbis's own animations by name. An unknown name is stillness, never an animation Orbis
  // does not have -- so a preset from elsewhere cannot describe movement, only ask for some that already exists.
  const backdrop: PresetBackdrop = BACKDROPS.includes(b.backdrop as PresetBackdrop)
    ? (b.backdrop as PresetBackdrop)
    : 'none'

  return {
    id,
    name,
    description: text(o.description, 200),
    schemaVersion: PRESET_SCHEMA_VERSION,
    category: CATEGORIES.includes(o.category as PresetCategory) ? (o.category as PresetCategory) : 'Orbis',
    // Only Orbis's own list may claim to be built in; an imported preset saying so does not make it read-only.
    builtIn: false,
    themeId,
    appearance: {
      accent: accent(a.accent),
      density,
      cornerRadius: clamp(a.cornerRadius, LIMITS.cornerRadius, DEFAULT_APPEARANCE.cornerRadius),
      transparency: clamp(a.transparency, LIMITS.transparency, DEFAULT_APPEARANCE.transparency),
      blur: clamp(a.blur, LIMITS.blur, DEFAULT_APPEARANCE.blur),
      reducedMotion,
      fontScale: clamp(a.fontScale, LIMITS.fontScale, DEFAULT_APPEARANCE.fontScale)
    },
    motion: {
      intensity: clamp(m.intensity, LIMITS.intensity, 1),
      speed: clamp(m.speed, LIMITS.speed, 1)
    },
    background: value ? { kind, value, backdrop } : { kind: 'orbis', backdrop: 'none' },
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : at,
    updatedAt: at
  }
}

// ---------------------------------------------------------------- using one

/**
 * Orbis configured as the preset describes.
 *
 * Only appearance is touched. A preset cannot reach privacy, notifications, widgets, the new tab page or anything
 * else in the configuration -- which is the promise that changing how Orbis looks cannot change what it does.
 */
export function applyPreset(config: ExperienceConfig, preset: StoredPreset, at = Date.now()): ExperienceConfig {
  return {
    ...config,
    themeId: preset.themeId,
    appearance: { ...preset.appearance },
    updatedAt: at
  }
}

/** The preset Orbis is wearing now, so it can be kept, named and returned to. */
export function presetFromConfig(config: ExperienceConfig, name: string, at = Date.now()): StoredPreset {
  return {
    id: `preset-${at.toString(36)}-${Math.trunc(at % 1000)}`,
    name: text(name, 60) || 'My preset',
    description: '',
    schemaVersion: PRESET_SCHEMA_VERSION,
    category: 'Orbis',
    builtIn: false,
    themeId: config.themeId,
    appearance: { ...config.appearance },
    motion: { intensity: 1, speed: 1 },
    background: { kind: 'orbis', backdrop: 'none' },
    createdAt: at,
    updatedAt: at
  }
}

/** A preset of Orbis's own, made editable by making it the person's. */
export function copyOfPreset(preset: StoredPreset, at = Date.now()): StoredPreset {
  return {
    ...preset,
    id: `preset-${at.toString(36)}-${Math.trunc(at % 1000)}`,
    name: `${preset.name} (mine)`.slice(0, 60),
    builtIn: false,
    createdAt: at,
    updatedAt: at
  }
}

/**
 * The variables a preset adds on top of the ones the appearance already produces.
 *
 * Movement is expressed as factors so the interface keeps its own designed timings and simply does more or less of
 * them, and a preset asking for stillness reaches zero rather than a different animation.
 */
export function presetVariables(preset: StoredPreset, reducedMotion: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  const intensity = reducedMotion ? 0 : clamp(preset.motion.intensity, LIMITS.intensity, 1)
  const speed = reducedMotion ? 0.4 : clamp(preset.motion.speed, LIMITS.speed, 1)
  out['--motion-scale'] = intensity.toFixed(2)
  out['--motion-speed'] = speed.toFixed(2)
  if (preset.background.kind === 'gradient' && preset.background.value) {
    out['--preset-background'] = preset.background.value
  }
  // How long one pass of the backdrop takes. It is derived from the preset's own motion speed rather than being a
  // second setting, so a preset asked to move less moves less everywhere, background included.
  out['--backdrop-cycle'] = `${Math.round(BACKDROP_SECONDS * speed)}s`
  return out
}

/** How long a backdrop takes to come round again at the preset's own speed. Slow enough not to be watched. */
const BACKDROP_SECONDS = 40

/**
 * Which of Orbis's background animations to draw, if any.
 *
 * Kept apart from `presetVariables` because it is not a value the stylesheet interpolates: it selects between whole
 * rules, so it belongs on the document as an attribute. It returns nothing when movement is not wanted -- either
 * because the preset asked for none, or because the person did -- and stillness is then the absence of a rule rather
 * than an animation running at zero speed.
 */
export function presetBackdrop(preset: StoredPreset | null, reducedMotion: boolean): PresetBackdrop | null {
  if (!preset || reducedMotion) return null
  const backdrop = preset.background.backdrop ?? 'none'
  if (backdrop === 'none' || preset.motion.intensity <= 0) return null
  return backdrop
}

/** Presets that came in from a file or another Orbis, with the rubbish left out. */
export function cleanPresets(raw: unknown, at = Date.now()): StoredPreset[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StoredPreset[] = []
  for (const entry of raw) {
    const preset = cleanPreset(entry, at)
    // Orbis's own ids are not available to take: a shared preset cannot quietly replace the one it was copied from.
    if (!preset || seen.has(preset.id) || builtInPreset(preset.id)) continue
    seen.add(preset.id)
    out.push(preset)
    if (out.length >= MAX_PRESETS) break
  }
  return out
}
