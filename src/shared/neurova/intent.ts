// Deterministic request validation and constraint extraction. The original text is never altered.

export interface SongRequest {
  prompt: string
  lyrics?: string
}

export interface Intent {
  original: string
  lyrics: string | null
  instrumental: boolean | null
  conflicts: string[]
  /** Phrases the user asked to avoid, verbatim. */
  avoid: string[]
}

export type Validated = { ok: true; intent: Intent } | { ok: false; error: string }

const INSTR = /\b(instrumental|no vocals?|without vocals?|no singing)\b/i
const VOCAL = /\b(sung|sing|vocals?|singer)\b/i
const AVOID = /\b(?:no|without|avoid)\s+([a-z][a-z-]{1,20}(?: [a-z-]{1,20})?)(?=[,.;]|$)/gi

export function interpret(req: SongRequest): Validated {
  const prompt = req.prompt ?? ''
  if (!prompt.trim()) return { ok: false, error: 'Describe the song first.' }
  const lyrics = req.lyrics && req.lyrics.trim() ? req.lyrics : null
  const wantsInstrumental = INSTR.test(prompt)
  const instrumental = wantsInstrumental ? true : lyrics ? false : null
  const conflicts: string[] = []
  if (wantsInstrumental && lyrics) conflicts.push('The song is marked instrumental but lyrics were supplied.')
  if (wantsInstrumental && VOCAL.test(prompt.replace(INSTR, ''))) conflicts.push('The prompt asks for no vocals and also mentions vocals.')
  const avoid: string[] = []
  for (const m of prompt.matchAll(AVOID)) avoid.push(m[0].trim())
  return { ok: true, intent: { original: prompt, lyrics, instrumental, conflicts, avoid } }
}
