// Request builders for the two engines, written from the upstream pages read (see engines.ts `readFrom`).
// They only build and validate input. Nothing here has been run against a real model on this machine.

export interface SongInput {
  caption: string
  lyrics: string | null
  instrumental: boolean
  durationSec?: number
  seed?: number
  bpm?: number
  keyScale?: string
  language?: string
  batchSize?: number
}

export type Built<T> = { ok: true; value: T; notes: string[] } | { ok: false; error: string }

/** The documented `GenerationParams` fields for ACE-Step 1.5 `generate_music`, plus `GenerationConfig`. */
export interface AceStepRequest {
  params: Record<string, unknown>
  config: { batch_size: number; use_random_seed: boolean; seeds?: number[]; audio_format: 'wav' }
}

export function buildAceStep(i: SongInput): Built<AceStepRequest> {
  const notes: string[] = []
  const caption = i.caption.trim()
  if (!caption) return { ok: false, error: 'A description is required.' }
  if (caption.length > 512) return { ok: false, error: 'ACE-Step accepts descriptions up to 512 characters; yours is longer and was not shortened.' }
  const lyrics = i.instrumental ? '[Instrumental]' : (i.lyrics ?? '')
  if (lyrics.length > 4096) return { ok: false, error: 'ACE-Step accepts lyrics up to 4096 characters; yours is longer and was not shortened.' }
  const params: Record<string, unknown> = { task_type: 'text2music', caption, lyrics, instrumental: i.instrumental }
  if (i.durationSec !== undefined) {
    if (!(i.durationSec >= 10 && i.durationSec <= 600)) return { ok: false, error: 'Duration must be between 10 and 600 seconds.' }
    params.duration = i.durationSec
  } else notes.push('Duration is left to the model.')
  if (i.bpm !== undefined) {
    if (!(i.bpm >= 30 && i.bpm <= 300)) return { ok: false, error: 'Tempo must be between 30 and 300 BPM.' }
    params.bpm = i.bpm
  }
  if (i.keyScale) params.keyscale = i.keyScale
  if (i.language) params.vocal_language = i.language
  const batch = i.batchSize ?? 1
  if (!Number.isInteger(batch) || batch < 1 || batch > 8) return { ok: false, error: 'Batch size must be 1 to 8.' }
  const config: AceStepRequest['config'] = { batch_size: batch, use_random_seed: i.seed === undefined, audio_format: 'wav' }
  if (i.seed !== undefined) {
    if (!Number.isInteger(i.seed) || i.seed < 0) return { ok: false, error: 'Seed must be a whole number of zero or more.' }
    config.seeds = [i.seed]
    params.seed = i.seed
    notes.push('A fixed seed was passed; identical output across machines is not guaranteed.')
  }
  return { ok: true, value: { params, config }, notes }
}

/** HeartMuLa is driven by `examples/run_music_generation.py`; lyrics and tags go in files, never in the command line. */
export interface HeartRequest {
  argv: string[]
  lyricsFile: { name: string; content: string }
  tagsFile: { name: string; content: string }
}

const SAFE_TAG = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u

export function buildHeartMuLa(i: SongInput, o: { modelPath: string; script: string; savePath: string; lyricsPath: string; tagsPath: string; tags: string[]; maxLengthMs?: number }): Built<HeartRequest> {
  const notes: string[] = []
  if (i.instrumental) return { ok: false, error: 'HeartMuLa has no documented instrumental mode, so this request was not sent to it.' }
  if (!i.lyrics || !i.lyrics.trim()) return { ok: false, error: 'HeartMuLa needs lyrics.' }
  const tags = o.tags.map((t) => t.trim()).filter(Boolean)
  if (!tags.length) return { ok: false, error: 'HeartMuLa needs at least one tag.' }
  for (const t of tags) if (!SAFE_TAG.test(t)) return { ok: false, error: `The tag "${t}" has characters that are not allowed.` }
  if (i.seed !== undefined) notes.push('HeartMuLa has no documented seed for generation; the seed was not sent.')
  if (i.bpm !== undefined || i.keyScale) notes.push('HeartMuLa documents no tempo or key control; these stay as wording only.')
  const argv = [o.script, `--model_path=${o.modelPath}`, '--version=3B', `--lyrics=${o.lyricsPath}`, `--tags=${o.tagsPath}`, `--save_path=${o.savePath}`]
  if (i.durationSec !== undefined) {
    argv.push(`--max_audio_length_ms=${Math.round(i.durationSec * 1000)}`)
    notes.push('Duration is only an upper limit in HeartMuLa.')
  }
  return {
    ok: true,
    value: { argv, lyricsFile: { name: 'lyrics.txt', content: i.lyrics }, tagsFile: { name: 'tags.txt', content: tags.join(',') } },
    notes
  }
}
