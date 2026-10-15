// Pure logic for the NEUROVA prompt composer and the generation progress view. No DOM.
export const CAPTION_MAX = 512
export const LYRICS_MAX = 4096
export const GENRES = ['pop', 'rock', 'indie', 'hip hop', 'r&b', 'electronic', 'house', 'ambient', 'jazz', 'classical', 'folk', 'country', 'metal', 'lo-fi', 'cinematic'] as const
export const MOODS = ['calm', 'happy', 'sad', 'dark', 'energetic', 'romantic', 'dreamy', 'tense', 'hopeful', 'nostalgic'] as const
export const INSTRUMENTS = ['piano', 'acoustic guitar', 'electric guitar', 'bass', 'drums', 'strings', 'synth', 'saxophone', 'violin', 'choir'] as const
export const SECTIONS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'] as const
export const TEMPO_RANGE = { min: 40, max: 220 } as const
export const LENGTH_RANGE = { min: 10, max: 240 } as const

export interface ComposerValues { brief: string; chips: string[]; tempoBpm: number | null; seconds: number | null; instrumental: boolean }

/** The caption sent to the engine: the person's own text first and untouched, then chips and tempo appended. */
export function buildCaption(v: Pick<ComposerValues, 'brief' | 'chips' | 'tempoBpm'>): string {
  const extra = [...v.chips]
  if (v.tempoBpm) extra.push(`${v.tempoBpm} BPM`)
  const base = v.brief.trim()
  if (!extra.length) return v.brief
  return base ? `${base}. ${extra.join(', ')}` : extra.join(', ')
}

export interface Count { used: number; max: number; over: boolean; remaining: number }
export function countAgainst(text: string, max: number): Count {
  const used = text.length
  return { used, max, over: used > max, remaining: max - used }
}

/** Insert a section tag at a caret position, on its own line. Never removes or alters existing text. */
export function insertSection(text: string, label: string, caret: number): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, at)
  const after = text.slice(at)
  const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n'
  const tag = `${lead}[${label}]\n`
  return { text: before + tag + after, caret: before.length + tag.length }
}

export function toggleChip(chips: string[], chip: string): string[] {
  return chips.includes(chip) ? chips.filter((c) => c !== chip) : [...chips, chip]
}

/** Parses a number field; returns null when empty or out of range so nothing invented is sent. */
export function parseBounded(raw: string, r: { min: number; max: number }): number | null {
  const n = Number(raw.trim())
  return raw.trim() !== '' && Number.isFinite(n) && n >= r.min && n <= r.max ? Math.round(n) : null
}

export const TERMINAL_STATES = ['completed', 'failed', 'cancelled', 'interrupted'] as const
export const isTerminal = (state: string): boolean => (TERMINAL_STATES as readonly string[]).includes(state)

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function jobHeadline(state: string): string {
  if (state === 'completed') return 'Finished'
  if (state === 'failed') return 'Failed'
  if (state === 'cancelled') return 'Stopped'
  if (state === 'interrupted') return 'Interrupted'
  return 'Working'
}
