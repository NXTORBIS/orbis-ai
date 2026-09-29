/**
 * The Pulsar models Orbis can use, and which one a machine should start with.
 *
 * These are OpenAI's Whisper weights, converted to the ggml format whisper.cpp reads, mirrored from the project's own
 * distribution point. Nothing here is invented: every size and every URL is what whisper.cpp itself downloads when
 * asked for that model (see its models/download-ggml-model.sh).
 *
 * Pure — no disk, no network, no process. What actually fetches and runs a model lives in src/main/Pulsar.
 */

export type PulsarModelId = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' | 'large-v3-turbo'

export const PULSAR_MODELS: PulsarModelId[] = ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo']

export interface PulsarModelInfo {
  id: PulsarModelId
  label: string
  /** The file whisper.cpp expects, and the name it is asked for at the mirror below. */
  file: string
  url: string
  /** What the mirror actually serves today, so a corrupt or partial download can be told from a good one. */
  sizeBytes: number
  /** Rough resident memory while loaded and transcribing, which is what actually limits a machine — not the file size. */
  ramMb: number
  description: string
}

const HF_MIRROR = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export const PULSAR_MODEL_INFO: Record<PulsarModelId, PulsarModelInfo> = {
  tiny: { id: 'tiny', label: 'Pulsar Tiny', file: 'ggml-tiny.bin', url: `${HF_MIRROR}/ggml-tiny.bin`, sizeBytes: 77_691_713, ramMb: 273, description: 'The fastest, and the least accurate. Good enough for short commands; it will misread unusual words. Pick this on an older or low-memory machine.' },
  base: { id: 'base', label: 'Pulsar Base', file: 'ggml-base.bin', url: `${HF_MIRROR}/ggml-base.bin`, sizeBytes: 147_951_465, ramMb: 388, description: 'Quick, and noticeably better than Tiny at ordinary speech. A sensible floor if you dictate more than a few words.' },
  small: { id: 'small', label: 'Pulsar Small', file: 'ggml-small.bin', url: `${HF_MIRROR}/ggml-small.bin`, sizeBytes: 487_601_967, ramMb: 852, description: 'The balance most laptops want: accurate on normal speech and still fast enough not to wait for.' },
  medium: { id: 'medium', label: 'Pulsar Medium', file: 'ggml-medium.bin', url: `${HF_MIRROR}/ggml-medium.bin`, sizeBytes: 1_533_763_059, ramMb: 2_100, description: 'Clearly more accurate on names, jargon and accents. Wants a capable machine and takes longer.' },
  'large-v3': { id: 'large-v3', label: 'Pulsar Large', file: 'ggml-large-v3.bin', url: `${HF_MIRROR}/ggml-large-v3.bin`, sizeBytes: 3_095_033_483, ramMb: 3_900, description: 'The most accurate there is, and the slowest by some way. Worth it only if accuracy matters more than waiting.' },
  'large-v3-turbo': { id: 'large-v3-turbo', label: 'Pulsar Turbo', file: 'ggml-large-v3-turbo.bin', url: `${HF_MIRROR}/ggml-large-v3-turbo.bin`, sizeBytes: 1_624_555_275, ramMb: 2_000, description: 'Large accuracy at a fraction of the time. The one to pick if your machine can hold it.' }
}

/** A download size somebody can judge at a glance. Gigabytes to one decimal, megabytes whole. */
export function saidSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  return `${Math.round(bytes / 1_000_000)} MB`
}

export const isPulsarModelId = (value: unknown): value is PulsarModelId => PULSAR_MODELS.includes(value as PulsarModelId)

// ---------------------------------------------------------------- what the window is told about a download or a machine

/** One tick of a model download, on its way to the window's progress bar. */
export interface PulsarDownloadProgress {
  id: PulsarModelId
  receivedBytes: number
  totalBytes: number
}

/** What this machine can tell Orbis about itself, and the model that follows from it. */
export interface PulsarHardwareInfo {
  cpuModel: string
  cpuThreads: number
  totalRamMb: number
  freeRamMb: number
  /** Best-effort only, and never required: CPU inference is the floor whether or not a GPU is found. */
  hasNvidiaGpu: boolean
  recommended: PulsarModelId
}

/** What a model needs to run at all, with headroom for the rest of Orbis and the OS. */
function fitsMemory(model: PulsarModelInfo, totalRamMb: number): boolean {
  return totalRamMb >= model.ramMb * 2.2
}

/**
 * The model a machine should start with: the most capable one that comfortably fits, so accuracy is not given up
 * where there is no need to, and nothing is picked that would thrash a small machine's memory.
 *
 * This is deliberately simple. It looks at RAM only — CPU speed changes how *long* transcription takes, not whether it
 * fits at all, and a slow machine is better served by a model that runs slowly than by one that does not run.
 */
export function recommendedModel(totalRamMb: number, hasGpu: boolean): PulsarModelId {
  const order: PulsarModelId[] = ['large-v3-turbo', 'medium', 'small', 'base', 'tiny']
  for (const id of order) {
    const model = PULSAR_MODEL_INFO[id]
    // A GPU that can hold the model gives more headroom than CPU-only RAM would; still never assumed available.
    if (hasGpu && fitsMemory(model, totalRamMb + 2_048)) return id
    if (fitsMemory(model, totalRamMb)) return id
  }
  return 'tiny'
}
