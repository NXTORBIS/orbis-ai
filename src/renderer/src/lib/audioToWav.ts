/**
 * Turning whatever the microphone recorded into the one shape Pulsar wants: 16 kHz, mono, 16-bit PCM WAV.
 *
 * Chromium's own decoder does the hard part — it already understands the Opus-in-WebM the recorder produced, so
 * there is no codec of Orbis's own to get subtly wrong. This only downmixes to one channel, resamples the audio to
 * the rate Pulsar was trained on, and writes the smallest header that says so.
 *
 * Deterministic and lossless in intent: nothing here recognises speech, guesses at silence, or changes the words —
 * it only changes the shape.
 */

const PULSAR_SAMPLE_RATE = 16_000

/** One shared context: opening a new one per recording is wasteful, and browsers cap how many can exist at once. */
let sharedContext: AudioContext | null = null
function context(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new AudioContext()
  return sharedContext
}

/** Every channel averaged into one. A voice recording has nothing to gain from being stereo. */
function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0)
  const mixed = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) mixed[i] += data[i] / buffer.numberOfChannels
  }
  return mixed
}

/**
 * Linear resampling to 16 kHz.
 *
 * Pulsar's own preprocessing expects this exact rate; recording at whatever the microphone's native rate happens to
 * be (44.1 kHz and 48 kHz are the common ones) and resampling here means every microphone reaches Pulsar the same
 * way, rather than each one working by accident.
 */
function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples
  const ratio = fromRate / toRate
  const outLength = Math.round(samples.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const a = Math.floor(pos)
    const b = Math.min(a + 1, samples.length - 1)
    const frac = pos - a
    out[i] = samples[a] * (1 - frac) + samples[b] * frac
  }
  return out
}

/** The smallest valid WAV: a 44-byte header in front of 16-bit little-endian PCM. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

/**
 * A recorded blob, however Chromium encoded it, turned into the WAV file whisper.cpp reads.
 *
 * Throws only when the browser itself could not decode what was recorded — genuinely bad audio, not something this
 * function invents an opinion about.
 */
export async function toPulsarWav(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const decoded = await context().decodeAudioData(arrayBuffer)
  const mono = toMono(decoded)
  const resampled = resample(mono, decoded.sampleRate, PULSAR_SAMPLE_RATE)
  return encodeWav(resampled, PULSAR_SAMPLE_RATE)
}
