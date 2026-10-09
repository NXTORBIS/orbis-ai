/**
 * Orbis Atmosphere: the sound and the look of a study environment.
 *
 * ## Why some sounds are here and some are not
 *
 * Everything in `SOUNDS` is **generated** -- built from noise and filters in the browser's own audio engine, at the
 * moment it plays. Nothing is downloaded and nothing is bundled, which is why it works offline and why it never
 * loops audibly.
 *
 * That also decides what can honestly be offered. Noise, rain, ocean, wind and a low space rumble are things filtered
 * noise genuinely sounds like. A café, a fireplace, a forest and a thunderstorm are recordings; synthesising them
 * would produce something that is not what it says it is. So they are listed as `needsFile: true` and are shown as
 * unavailable until somebody points Orbis at their own audio. An atmosphere called "Fireplace" that plays filtered
 * hiss is exactly the kind of small lie that makes a student stop believing the rest of the interface.
 *
 * Pure: a description of what to build. The audio graph itself is in the renderer, where the audio engine is.
 */

export interface SoundLayer {
  /** The kind of noise underneath. */
  noise: 'white' | 'pink' | 'brown'
  /** A filter over it, when there is one. */
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; q?: number }
  /** A slow wobble on the volume, which is what makes generated sound stop sounding like a machine. */
  wobble?: { rate: number; depth: number }
  /** Occasional short bursts, for rain-like texture. */
  drops?: { rate: number; decay: number; frequency: number }
  gain: number
}

export interface AtmosphereSound {
  id: string
  label: string
  blurb: string
  /** Null when this one needs a recording Orbis does not have. */
  layers: readonly SoundLayer[] | null
  needsFile: boolean
  /** What to say when it cannot play. */
  unavailable?: string
}

export const SOUNDS: readonly AtmosphereSound[] = [
  {
    id: 'brown',
    label: 'Brown noise',
    blurb: 'Deep and even. The one most people settle into.',
    needsFile: false,
    layers: [{ noise: 'brown', gain: 0.9, filter: { type: 'lowpass', frequency: 1600 } }]
  },
  {
    id: 'pink',
    label: 'Pink noise',
    blurb: 'Softer than white, brighter than brown.',
    needsFile: false,
    layers: [{ noise: 'pink', gain: 0.75 }]
  },
  {
    id: 'white',
    label: 'White noise',
    blurb: 'Flat and bright. Good at covering voices.',
    needsFile: false,
    layers: [{ noise: 'white', gain: 0.5, filter: { type: 'lowpass', frequency: 9000 } }]
  },
  {
    id: 'rain',
    label: 'Rain',
    blurb: 'Steady rain, built from filtered noise and droplets.',
    needsFile: false,
    layers: [
      { noise: 'pink', gain: 0.5, filter: { type: 'bandpass', frequency: 1200, q: 0.6 }, wobble: { rate: 0.08, depth: 0.25 } },
      { noise: 'white', gain: 0.18, filter: { type: 'highpass', frequency: 3500 }, drops: { rate: 14, decay: 0.05, frequency: 5200 } }
    ]
  },
  {
    id: 'ocean',
    label: 'Ocean',
    blurb: 'Slow waves, from brown noise that rises and falls.',
    needsFile: false,
    layers: [{ noise: 'brown', gain: 0.95, filter: { type: 'lowpass', frequency: 900 }, wobble: { rate: 0.07, depth: 0.7 } }]
  },
  {
    id: 'wind',
    label: 'Wind',
    blurb: 'Moving air, with gusts.',
    needsFile: false,
    layers: [{ noise: 'pink', gain: 0.6, filter: { type: 'bandpass', frequency: 500, q: 1.2 }, wobble: { rate: 0.05, depth: 0.6 } }]
  },
  {
    id: 'space',
    label: 'Space',
    blurb: 'A very low rumble, almost below hearing.',
    needsFile: false,
    layers: [{ noise: 'brown', gain: 1, filter: { type: 'lowpass', frequency: 180 }, wobble: { rate: 0.03, depth: 0.3 } }]
  },
  { id: 'thunder', label: 'Thunder', blurb: 'Distant storm.', needsFile: true, layers: null, unavailable: 'Thunder is a recording. Add your own audio file in Music Settings to use it.' },
  { id: 'forest', label: 'Forest', blurb: 'Birds and leaves.', needsFile: true, layers: null, unavailable: 'Forest is a recording. Add your own audio file in Music Settings to use it.' },
  { id: 'fireplace', label: 'Fireplace', blurb: 'A fire in the room.', needsFile: true, layers: null, unavailable: 'Fireplace is a recording. Add your own audio file in Music Settings to use it.' },
  { id: 'cafe', label: 'Café', blurb: 'Quiet chatter and cups.', needsFile: true, layers: null, unavailable: 'Café is a recording. Add your own audio file in Music Settings to use it.' },
  { id: 'library', label: 'Library', blurb: 'Pages and distant footsteps.', needsFile: true, layers: null, unavailable: 'Library is a recording. Add your own audio file in Music Settings to use it.' }
]

export function soundById(id: string): AtmosphereSound | null {
  return SOUNDS.find((one) => one.id === id) ?? null
}

/** Which sounds can play right now: the generated ones, plus any the student has supplied a file for. */
export function playableSounds(withFiles: readonly string[]): AtmosphereSound[] {
  return SOUNDS.filter((one) => !one.needsFile || withFiles.includes(one.id))
}

/** A mix: several sounds at their own volumes. */
export interface AtmosphereMix {
  /** Sound id to volume, 0..1. */
  layers: Readonly<Record<string, number>>
}

export interface AtmospherePreset {
  id: string
  label: string
  blurb: string
  mix: AtmosphereMix
  /** The look that goes with it. */
  environment: string
}

export const PRESETS: readonly AtmospherePreset[] = [
  { id: 'minimal', label: 'Minimal', blurb: 'No sound at all.', mix: { layers: {} }, environment: 'minimal' },
  { id: 'deep-space', label: 'Deep Space', blurb: 'Brown noise under a low rumble.', mix: { layers: { brown: 0.6, space: 0.35 } }, environment: 'space' },
  { id: 'rain-study', label: 'Rain Study', blurb: 'Rain with something steady underneath.', mix: { layers: { rain: 0.7, brown: 0.25 } }, environment: 'rain-window' },
  { id: 'calm', label: 'Calm', blurb: 'Slow waves.', mix: { layers: { ocean: 0.6 } }, environment: 'orbital' },
  { id: 'cover-voices', label: 'Cover voices', blurb: 'For a noisy room.', mix: { layers: { white: 0.5, pink: 0.3 } }, environment: 'library' },
  { id: 'night', label: 'Night', blurb: 'Wind and a low rumble.', mix: { layers: { wind: 0.4, space: 0.3 } }, environment: 'night-study' }
]

export function presetById(id: string): AtmospherePreset | null {
  return PRESETS.find((one) => one.id === id) ?? null
}

/** Only the layers that can actually play, so a preset degrades rather than failing. */
export function playableMix(mix: AtmosphereMix, withFiles: readonly string[]): AtmosphereMix {
  const out: Record<string, number> = {}
  for (const [id, gain] of Object.entries(mix.layers)) {
    const sound = soundById(id)
    if (!sound) continue
    if (sound.needsFile && !withFiles.includes(id)) continue
    out[id] = Math.max(0, Math.min(1, gain))
  }
  return { layers: out }
}

// ---------------------------------------------------------------- what it looks like

export interface Environment {
  id: string
  label: string
  blurb: string
  /** A hint for the visual layer. Nothing here changes how anything works. */
  look: { tint: string; depth: 'flat' | 'soft' | 'deep'; motion: 'none' | 'slow' | 'drift' }
}

export const ENVIRONMENTS: readonly Environment[] = [
  { id: 'orbital', label: 'Orbital', blurb: 'Orbis as it normally looks, with the rings brought forward.', look: { tint: 'cyan', depth: 'soft', motion: 'slow' } },
  { id: 'library', label: 'Library', blurb: 'Warm, still, paper.', look: { tint: 'amber', depth: 'soft', motion: 'none' } },
  { id: 'laboratory', label: 'Laboratory', blurb: 'Clean and bright.', look: { tint: 'white', depth: 'flat', motion: 'none' } },
  { id: 'night-study', label: 'Night Study', blurb: 'Dim, for late work.', look: { tint: 'indigo', depth: 'deep', motion: 'slow' } },
  { id: 'space', label: 'Space', blurb: 'Dark, with slow drift.', look: { tint: 'violet', depth: 'deep', motion: 'drift' } },
  { id: 'minimal', label: 'Minimal', blurb: 'Nothing but the timer.', look: { tint: 'none', depth: 'flat', motion: 'none' } },
  { id: 'rain-window', label: 'Rain Window', blurb: 'Grey light and water.', look: { tint: 'slate', depth: 'soft', motion: 'drift' } }
]

export function environmentById(id: string): Environment | null {
  return ENVIRONMENTS.find((one) => one.id === id) ?? null
}

/**
 * The volumes, kept apart on purpose.
 *
 * Music, atmosphere, interface sounds and Orbi's voice each have their own, because they are four different reasons to
 * want quiet. A single volume means somebody who wants the atmosphere but not the chime has to choose.
 */
export interface Volumes {
  music: number
  atmosphere: number
  ui: number
  orbi: number
}

export function defaultVolumes(): Volumes {
  return { music: 0.7, atmosphere: 0.5, ui: 0.4, orbi: 0.6 }
}

export function clampVolumes(raw: Partial<Volumes> | undefined, held: Volumes): Volumes {
  const one = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback)
  return {
    music: one(raw?.music, held.music),
    atmosphere: one(raw?.atmosphere, held.atmosphere),
    ui: one(raw?.ui, held.ui),
    orbi: one(raw?.orbi, held.orbi)
  }
}
