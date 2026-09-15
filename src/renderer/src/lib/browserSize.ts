/** Where the open browser is: over the whole content area, a sized window, or docked beside the chat. */
export type BrowserMode = 'full' | 'window' | 'dock'

/** How big the Orbis browser opens: a full-page view, a preset window, or a custom size in pixels. */
export type BrowserSizePreset = 'full' | 'large' | 'medium' | 'small' | 'custom'

export interface BrowserSizePref {
  preset: BrowserSizePreset
  /** Custom size in CSS pixels; kept for when Custom is chosen again. */
  width: number
  height: number
}

export interface Bounds {
  width: number
  height: number
}

export const BROWSER_SIZE_PRESETS: { id: BrowserSizePreset; label: string; hint: string }[] = [
  { id: 'full', label: 'Full', hint: 'Full page, over the whole content area' },
  { id: 'large', label: 'Large', hint: 'A window at about 90% of the space' },
  { id: 'medium', label: 'Medium', hint: 'A window at about 70% of the space' },
  { id: 'small', label: 'Small', hint: 'A window at about half the space' },
  { id: 'custom', label: 'Custom', hint: 'A window of the width and height you set' }
]

/** Fractions of the available space for the preset windows. */
const FRACTIONS: Record<'large' | 'medium' | 'small', [number, number]> = {
  large: [0.9, 0.94],
  medium: [0.7, 0.82],
  small: [0.48, 0.66]
}

export const MIN_BROWSER_WIDTH = 360
export const MIN_BROWSER_HEIGHT = 320
/** Space kept free around a browser window so its edges and controls stay reachable. */
const EDGE = 16
const STORAGE_KEY = 'orbis.browser.size'
const DEFAULT_PREF: BrowserSizePref = { preset: 'full', width: 1200, height: 800 }

export function loadBrowserSize(): BrowserSizePref {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<BrowserSizePref> | null
    if (!saved || !BROWSER_SIZE_PRESETS.some((p) => p.id === saved.preset)) return DEFAULT_PREF
    const width = Number(saved.width)
    const height = Number(saved.height)
    return {
      preset: saved.preset as BrowserSizePreset,
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : DEFAULT_PREF.width,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : DEFAULT_PREF.height
    }
  } catch {
    return DEFAULT_PREF
  }
}

export function saveBrowserSize(pref: BrowserSizePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref))
  } catch {
    // Storage can be unavailable; the preference just lasts for this session.
  }
}

/** The largest window that still fits with its edges reachable. */
export function maxBrowserSize(bounds: Bounds): Bounds {
  return { width: Math.max(MIN_BROWSER_WIDTH, Math.round(bounds.width - EDGE * 2)), height: Math.max(MIN_BROWSER_HEIGHT, Math.round(bounds.height - EDGE * 2)) }
}

/** Keeps a window size usable: never smaller than the minimum, never larger than the space it opens in. */
export function clampBrowserSize(width: number, height: number, bounds: Bounds): Bounds {
  const max = maxBrowserSize(bounds)
  return {
    width: Math.round(Math.min(Math.max(width || 0, MIN_BROWSER_WIDTH), max.width)),
    height: Math.round(Math.min(Math.max(height || 0, MIN_BROWSER_HEIGHT), max.height))
  }
}

/** The pixel size a window preference opens at in the given space (Full has no window size). */
export function resolveBrowserSize(pref: BrowserSizePref, bounds: Bounds): Bounds {
  if (pref.preset === 'custom' || pref.preset === 'full') return clampBrowserSize(pref.width, pref.height, bounds)
  const [fw, fh] = FRACTIONS[pref.preset]
  return clampBrowserSize(bounds.width * fw, bounds.height * fh, bounds)
}

export function describeBrowserSize(pref: BrowserSizePref): string {
  if (pref.preset === 'custom') return `${pref.width} × ${pref.height}`
  return BROWSER_SIZE_PRESETS.find((p) => p.id === pref.preset)?.label ?? 'Full'
}
