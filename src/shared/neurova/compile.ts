// Turns intent + plan into the text an engine receives. Deterministic, never truncates, never adds
// anything the user did not ask for, and lists what could not be expressed.

import type { Plan } from './plan.ts'

export interface Caps {
  captionMax: number
  lyricsMax: number
  /** Whether the engine takes lyrics at all. */
  lyrics: boolean
  instrumentalFlag: boolean
}

export interface CompileInput {
  prompt: string
  instrumental: boolean
  lyrics: string | null
  avoid: string[]
  plan: Plan | null
}

export interface Compiled {
  caption: string
  lyrics: string | null
  /** Things asked for that this engine cannot take; the user is told instead of it being dropped quietly. */
  unsupported: string[]
  /** Optional wording that was left out to fit. */
  omitted: string[]
  error: string | null
}

export function compile(i: CompileInput, c: Caps): Compiled {
  const unsupported: string[] = []
  const omitted: string[] = []
  const prompt = i.prompt.trim()
  if (!prompt) return { caption: '', lyrics: null, unsupported, omitted, error: 'Describe the song first.' }
  if (i.instrumental && !c.instrumentalFlag) unsupported.push('Instrumental: this engine has no documented instrumental mode.')
  if (!i.instrumental && i.lyrics && !c.lyrics) unsupported.push('Lyrics: this engine does not take lyrics.')
  if (i.plan) {
    const named = i.plan.sections.filter((s) => s.origin === 'user')
    if (named.some((s) => s.energy !== 'unspecified' || s.purpose)) unsupported.push('Per-section energy and purpose: engines take one whole-song description, so these are worded, not enforced.')
    if (i.plan.targetSec !== null) unsupported.push('Exact length: it is passed only where the engine documents a length control.')
  }
  const parts: string[] = [prompt]
  const arrangement = i.plan && i.plan.sections.filter((s) => s.origin === 'user').length > 1 ? `Structure: ${i.plan.sections.map((s) => s.name).join(', ')}.` : ''
  const ending = i.plan?.ending ? `Ending: ${i.plan.ending}.` : ''
  const avoid = i.avoid.length ? `Avoid: ${i.avoid.join('; ')}.` : ''
  const optional = [arrangement, ending, avoid].filter(Boolean)
  let caption = [...parts, ...optional].join(' ')
  if (caption.length > c.captionMax) {
    for (const o of [...optional].reverse()) {
      if (caption.length <= c.captionMax) break
      omitted.push(o)
      caption = [...parts, ...optional.filter((x) => !omitted.includes(x))].join(' ')
    }
  }
  if (caption.length > c.captionMax) {
    return { caption: '', lyrics: null, unsupported, omitted, error: `The description is ${prompt.length} characters and this engine takes ${c.captionMax}. Nothing was cut; shorten it.` }
  }
  let lyrics: string | null = null
  if (!i.instrumental && i.lyrics && c.lyrics) {
    if (i.lyrics.length > c.lyricsMax) return { caption: '', lyrics: null, unsupported, omitted, error: `The lyrics are ${i.lyrics.length} characters and this engine takes ${c.lyricsMax}. Nothing was cut.` }
    lyrics = i.lyrics
  }
  return { caption, lyrics, unsupported, omitted, error: null }
}
