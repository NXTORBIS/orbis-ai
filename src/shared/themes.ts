/**
 * Themes: a named set of colours Orbis paints itself with. A theme only ever sets tokens Orbis already uses, so a theme
 * can change how Orbis looks without changing how anything works, and removing it puts the original colours straight
 * back.
 *
 * Orbis comes with a few of its own, and you can make your own from whatever is on screen. Nothing is fetched and
 * nothing is shared: a theme is a small list of colours kept with the rest of your personalisation.
 *
 * Pure — no browser, no storage.
 */

export interface ThemeTokenSpec {
  /** The CSS variable's name without the leading dashes, e.g. 'bg-center'. */
  name: string
  label: string
  group: 'Background' | 'Text' | 'Accent' | 'Surfaces'
  /** What Orbis itself uses, so a theme can be compared with the original. */
  orbis: string
}

/** The tokens a theme may set. Everything else about Orbis is left alone. */
export const THEME_TOKENS: ThemeTokenSpec[] = [
  { name: 'bg-center', label: 'Background centre', group: 'Background', orbis: '#0e1013' },
  { name: 'bg-mid', label: 'Background middle', group: 'Background', orbis: '#060708' },
  { name: 'bg-edge', label: 'Background edge', group: 'Background', orbis: '#000000' },
  { name: 'grid', label: 'Grid lines', group: 'Background', orbis: 'rgba(255, 255, 255, 0.045)' },
  { name: 'text', label: 'Text', group: 'Text', orbis: '#ededef' },
  { name: 'muted', label: 'Quieter text', group: 'Text', orbis: '#a2a6ae' },
  { name: 'muted-strong', label: 'Secondary text', group: 'Text', orbis: '#cbced4' },
  { name: 'faint', label: 'Faintest text', group: 'Text', orbis: '#6e727b' },
  { name: 'cyan', label: 'Accent', group: 'Accent', orbis: '#3fd8ff' },
  { name: 'green', label: 'Good', group: 'Accent', orbis: '#3ee58a' },
  { name: 'amber', label: 'Warning', group: 'Accent', orbis: '#ffbe4d' },
  { name: 'red', label: 'Trouble', group: 'Accent', orbis: '#ff4d6d' },
  { name: 'glass', label: 'Panels', group: 'Surfaces', orbis: 'rgba(14, 15, 18, 0.84)' },
  { name: 'glass-border', label: 'Panel edges', group: 'Surfaces', orbis: 'rgba(160, 210, 255, 0.13)' },
  { name: 'line-strong', label: 'Dividers', group: 'Surfaces', orbis: 'rgba(255, 255, 255, 0.09)' },
  { name: 'bar-bg', label: 'Bars', group: 'Surfaces', orbis: 'rgba(0, 0, 0, 0.65)' },
  { name: 'rail-bg', label: 'Side rail', group: 'Surfaces', orbis: 'rgba(0, 0, 0, 0.4)' },
  { name: 'pill-bg', label: 'Buttons', group: 'Surfaces', orbis: 'rgba(12, 13, 16, 0.75)' },
  { name: 'pill-bg-strong', label: 'Raised buttons', group: 'Surfaces', orbis: 'rgba(255, 255, 255, 0.06)' },
  { name: 'pill-border', label: 'Button edges', group: 'Surfaces', orbis: 'rgba(255, 255, 255, 0.14)' },
  { name: 'hover', label: 'Hover', group: 'Surfaces', orbis: 'rgba(255, 255, 255, 0.07)' }
]

export const isThemeToken = (name: string): boolean => THEME_TOKENS.some((t) => t.name === name)

export const MAX_THEMES = 40
export const MAX_TOKEN_LENGTH = 200

/** A theme Orbis ships with. These are read-only: using one as a starting point makes a copy of your own. */
export interface BuiltInTheme {
  id: string
  name: string
  description: string
  base: 'dark' | 'light'
  tokens: Record<string, string>
}

export const BUILT_IN_THEMES: BuiltInTheme[] = [
  {
    id: 'orbis-midnight',
    name: 'Midnight',
    description: 'Deeper and quieter than usual, with the same cyan.',
    base: 'dark',
    tokens: {
      'bg-center': '#0a0c14',
      'bg-mid': '#04050a',
      'bg-edge': '#000000',
      text: '#e8eaf2',
      muted: '#949aab',
      'muted-strong': '#c3c8d6',
      glass: 'rgba(10, 12, 20, 0.86)',
      'glass-border': 'rgba(130, 170, 255, 0.14)',
      'pill-bg': 'rgba(9, 11, 18, 0.78)'
    }
  },
  {
    id: 'orbis-ember',
    name: 'Ember',
    description: 'Warm amber on near-black, easy on the eyes at night.',
    base: 'dark',
    tokens: {
      'bg-center': '#141010',
      'bg-mid': '#0a0706',
      'bg-edge': '#000000',
      text: '#f2eae4',
      muted: '#b0a49b',
      'muted-strong': '#d8cec6',
      cyan: '#ff9d4d',
      glass: 'rgba(20, 16, 16, 0.86)',
      'glass-border': 'rgba(255, 170, 110, 0.16)',
      'pill-bg': 'rgba(18, 14, 13, 0.78)',
      hover: 'rgba(255, 190, 140, 0.08)'
    }
  },
  {
    id: 'orbis-forest',
    name: 'Forest',
    description: 'Cool greens, for long stretches of reading.',
    base: 'dark',
    tokens: {
      'bg-center': '#0b1310',
      'bg-mid': '#050a08',
      'bg-edge': '#000000',
      text: '#e6efe9',
      muted: '#96a89d',
      'muted-strong': '#c6d4cb',
      cyan: '#4de2a4',
      glass: 'rgba(11, 19, 16, 0.86)',
      'glass-border': 'rgba(110, 230, 180, 0.15)',
      'pill-bg': 'rgba(10, 17, 14, 0.78)'
    }
  },
  {
    id: 'orbis-violet',
    name: 'Violet',
    description: 'A purple cast with a soft lilac accent.',
    base: 'dark',
    tokens: {
      'bg-center': '#120f1a',
      'bg-mid': '#08060d',
      'bg-edge': '#000000',
      text: '#ece9f5',
      muted: '#a49cb8',
      'muted-strong': '#cec8dd',
      cyan: '#b28bff',
      glass: 'rgba(18, 15, 26, 0.86)',
      'glass-border': 'rgba(180, 150, 255, 0.16)',
      'pill-bg': 'rgba(16, 13, 23, 0.78)'
    }
  },
  {
    id: 'orbis-daylight',
    name: 'Daylight',
    description: 'A light theme: dark text on paper-white surfaces.',
    base: 'light',
    tokens: {
      'bg-center': '#f4f5f7',
      'bg-mid': '#e9ebef',
      'bg-edge': '#dfe2e7',
      grid: 'rgba(0, 0, 0, 0.05)',
      text: '#14161a',
      muted: '#5b616b',
      'muted-strong': '#31353c',
      faint: '#8b919b',
      cyan: '#0a7ea4',
      green: '#12855a',
      amber: '#a96a00',
      red: '#c62a46',
      glass: 'rgba(255, 255, 255, 0.92)',
      'glass-border': 'rgba(10, 30, 60, 0.14)',
      'line-strong': 'rgba(0, 0, 0, 0.12)',
      'bar-bg': 'rgba(255, 255, 255, 0.88)',
      'rail-bg': 'rgba(255, 255, 255, 0.7)',
      'pill-bg': 'rgba(255, 255, 255, 0.85)',
      'pill-bg-strong': 'rgba(10, 20, 40, 0.06)',
      'pill-border': 'rgba(0, 0, 0, 0.16)',
      hover: 'rgba(0, 0, 0, 0.06)'
    }
  },
  {
    id: 'orbis-paper',
    name: 'Paper',
    description: 'A warm light theme, closer to printed paper than to a screen.',
    base: 'light',
    tokens: {
      'bg-center': '#f7f3ea',
      'bg-mid': '#efe9dd',
      'bg-edge': '#e6dfd0',
      grid: 'rgba(60, 40, 10, 0.05)',
      text: '#1d1a14',
      muted: '#6a6255',
      'muted-strong': '#3a352c',
      faint: '#948b7b',
      cyan: '#9c5a12',
      green: '#2f7346',
      amber: '#9a6b00',
      red: '#b33a3a',
      glass: 'rgba(253, 250, 244, 0.93)',
      'glass-border': 'rgba(70, 50, 20, 0.16)',
      'line-strong': 'rgba(60, 45, 20, 0.14)',
      'bar-bg': 'rgba(250, 246, 238, 0.9)',
      'rail-bg': 'rgba(250, 246, 238, 0.72)',
      'pill-bg': 'rgba(252, 249, 242, 0.88)',
      'pill-bg-strong': 'rgba(70, 50, 20, 0.07)',
      'pill-border': 'rgba(70, 50, 20, 0.18)',
      hover: 'rgba(70, 50, 20, 0.07)'
    }
  }
]

export const builtInTheme = (id: string): BuiltInTheme | null => BUILT_IN_THEMES.find((t) => t.id === id) ?? null

// ---------------------------------------------------------------- reading a colour

/** Reads #rgb, #rrggbb and rgb()/rgba() into channels and an alpha. Anything else is not a colour Orbis can judge. */
export function readColour(value: string): { r: number; g: number; b: number; a: number } | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: 1 }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text)
  if (!rgb) return null
  const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])
  const channels = [rgb[1], rgb[2], rgb[3]].map(Number)
  if (channels.some((c) => !Number.isFinite(c) || c < 0 || c > 255) || !Number.isFinite(alpha)) return null
  return { r: channels[0], g: channels[1], b: channels[2], a: Math.min(1, Math.max(0, alpha)) }
}

const channelLuminance = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** How bright a colour is, 0 to 1, the way the accessibility guidelines measure it. */
export function luminance(colour: string): number | null {
  const parsed = readColour(colour)
  if (!parsed) return null
  return 0.2126 * channelLuminance(parsed.r) + 0.7152 * channelLuminance(parsed.g) + 0.0722 * channelLuminance(parsed.b)
}

/** How far apart two colours are, from 1 (identical) to 21 (black on white). */
export function contrast(front: string, back: string): number | null {
  const a = luminance(front)
  const b = luminance(back)
  if (a === null || b === null) return null
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export interface ReadabilityNote {
  token: string
  label: string
  ratio: number
  /** 4.5 is the usual mark for ordinary text; below 3 is hard work for anyone. */
  severity: 'hard' | 'tight'
}

/**
 * Says honestly whether a theme's text will be readable on its own background. Orbis never refuses a theme for this —
 * it just says what it found, so nobody applies something they cannot read by accident.
 */
export function readability(tokens: Record<string, string>): ReadabilityNote[] {
  const background = tokens['bg-center'] ?? THEME_TOKENS.find((t) => t.name === 'bg-center')!.orbis
  const notes: ReadabilityNote[] = []
  for (const name of ['text', 'muted', 'muted-strong', 'cyan']) {
    const colour = tokens[name]
    if (!colour) continue
    const ratio = contrast(colour, background)
    if (ratio === null) continue
    // Quieter text and the accent are held to the larger-text mark; ordinary text to the full one.
    const mark = name === 'text' ? 4.5 : 3
    if (ratio >= mark) continue
    notes.push({
      token: name,
      label: THEME_TOKENS.find((t) => t.name === name)?.label ?? name,
      ratio: Math.round(ratio * 10) / 10,
      severity: ratio < mark * 0.67 ? 'hard' : 'tight'
    })
  }
  return notes
}

// ---------------------------------------------------------------- making and checking themes

export interface StoredTheme {
  id: string
  name: string
  base: 'dark' | 'light'
  tokens: Record<string, string>
  createdAt: number
}

const id = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Only tokens Orbis actually uses, with values short enough to be a colour and nothing else. */
export function cleanTokens(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isThemeToken(name) || typeof value !== 'string') continue
    const text = value.trim()
    // No url(), no expressions: a token carries a colour, so nothing a theme sets can reach outside Orbis.
    if (!text || text.length > MAX_TOKEN_LENGTH || /url\(|@import|expression|javascript:/i.test(text)) continue
    out[name] = text
  }
  return out
}

/** A theme of your own, made from a starting point (one of Orbis's, another of yours, or nothing at all). */
export function newTheme(name: string, base: 'dark' | 'light', tokens: Record<string, string>, at = Date.now()): StoredTheme {
  return { id: id('theme'), name: name.trim().slice(0, 60) || 'My theme', base, tokens: cleanTokens(tokens), createdAt: at }
}

/** A copy of one of Orbis's own themes, which you can then change. Orbis's own are never edited. */
export const copyOfBuiltIn = (theme: BuiltInTheme, at = Date.now()): StoredTheme => newTheme(`${theme.name} (mine)`, theme.base, theme.tokens, at)

/** What a theme changes, compared with Orbis's own colours. */
export const themeChanges = (tokens: Record<string, string>): number =>
  Object.entries(tokens).filter(([name, value]) => THEME_TOKENS.find((t) => t.name === name)?.orbis !== value).length

/** The tokens in use right now: one of Orbis's own themes, one of yours, or none at all. */
export function themeTokens(themeId: string | null, mine: StoredTheme[]): Record<string, string> {
  if (!themeId) return {}
  const built = builtInTheme(themeId)
  if (built) return cleanTokens(built.tokens)
  return cleanTokens(mine.find((t) => t.id === themeId)?.tokens ?? {})
}

/** The name to show for whatever is in use, or null when Orbis's own colours are. */
export function themeName(themeId: string | null, mine: StoredTheme[]): string | null {
  if (!themeId) return null
  return builtInTheme(themeId)?.name ?? mine.find((t) => t.id === themeId)?.name ?? null
}

/** Whether a theme id is one Orbis can still use; an id pointing at a theme that has been deleted is not. */
export const themeExists = (themeId: string, mine: StoredTheme[]): boolean => Boolean(builtInTheme(themeId)) || mine.some((t) => t.id === themeId)

/**
 * Whether the theme in use expects light or dark surroundings, or null when Orbis's own choice stands. A light theme
 * turns on the light Orbis that already exists and then refines it, rather than repainting a dark one colour by colour.
 */
export function themeBase(themeId: string | null, mine: StoredTheme[]): 'dark' | 'light' | null {
  if (!themeId) return null
  return builtInTheme(themeId)?.base ?? mine.find((t) => t.id === themeId)?.base ?? null
}
