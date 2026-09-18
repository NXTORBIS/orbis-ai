import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { defaultThreads, readHardware, transcribeLocal, whisperBinaryDir, WhisperRuntimeError } from './runtime.ts'

const execFileAsync = promisify(execFile)

/**
 * The one test in this file that is not a unit test: it really runs the bundled whisper.cpp binary, against a real
 * downloaded model, against a real recording of speech — because a mock of any of those three would only prove that
 * the mock was consistent with itself, which is exactly the kind of "local Whisper" this project was asked not to
 * build. It is skipped, not failed, where one of those three genuinely cannot be had (no network for the model, or
 * not running on Windows, where the bundled binary and the WAV it is tested against both come from) — a missing
 * ingredient is not the same thing as the runtime being broken.
 */

const CACHE = join(tmpdir(), 'orbis-whisper-e2e')
const MODEL_PATH = join(CACHE, 'ggml-tiny.bin')
const WAV_PATH = join(CACHE, 'speech.wav')
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'

async function ensureModel(): Promise<boolean> {
  try {
    const info = await stat(MODEL_PATH)
    if (info.size > 50_000_000) return true
  } catch {
    // Not cached yet.
  }
  try {
    await mkdir(CACHE, { recursive: true })
    const res = await fetch(MODEL_URL)
    if (!res.ok || !res.body) return false
    await writeFile(MODEL_PATH, Buffer.from(await res.arrayBuffer()))
    return true
  } catch {
    return false
  }
}

/** A real recording of real speech, synthesised once by Windows' own text-to-speech and cached beside the model. */
async function ensureSpeechWav(): Promise<boolean> {
  try {
    await stat(WAV_PATH)
    return true
  } catch {
    // Not made yet.
  }
  if (platform() !== 'win32') return false
  const script = `
    Add-Type -AssemblyName System.Speech
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SetOutputToWaveFile('${WAV_PATH.replace(/\\/g, '\\\\')}')
    $s.Speak('The quick brown fox jumps over the lazy dog.')
  `
  try {
    await mkdir(CACHE, { recursive: true })
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script])
    await stat(WAV_PATH)
    return true
  } catch {
    return false
  }
}

test('reads real numbers about the machine it is running on, not placeholders', () => {
  const hardware = readHardware()
  assert.ok(hardware.cpuThreads >= 1)
  assert.ok(hardware.totalRamMb > 0)
  assert.ok(hardware.freeRamMb > 0)
  assert.ok(hardware.cpuModel.length > 0)
  assert.ok(defaultThreads() >= 1)
  assert.ok(defaultThreads() < hardware.cpuThreads + 1)
})

test('a model file that plainly is not one fails loading rather than returning invented words', async () => {
  if (platform() !== 'win32') return
  const binaryDir = whisperBinaryDir(join(import.meta.dirname, '..', '..', '..', 'resources'))
  const fakeModelPath = join(tmpdir(), 'orbis-not-a-real-model.bin')
  await writeFile(fakeModelPath, 'this is not a ggml model')
  const wav = Buffer.alloc(44 + 1600) // A well-formed but silent WAV is enough to reach the model-loading step.
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + 1600, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(1600, 40)

  await assert.rejects(
    transcribeLocal(binaryDir, { wav, modelPath: fakeModelPath, language: 'en', timeoutMs: 15_000 }),
    (err: unknown) => err instanceof WhisperRuntimeError && err.code === 'crashed'
  )
})

test('a real recording of real speech is really transcribed, by the actual bundled binary and a real downloaded model', async (t) => {
  if (platform() !== 'win32') return t.skip('the bundled binary and the speech sample are both Windows-only')
  if (!(await ensureModel())) return t.skip('could not fetch the tiny model — no network, most likely')
  if (!(await ensureSpeechWav())) return t.skip('could not synthesise a speech sample on this machine')

  const wav = await readFile(WAV_PATH)
  const binaryDir = whisperBinaryDir(join(import.meta.dirname, '..', '..', '..', 'resources'))
  const text = await transcribeLocal(binaryDir, { wav, modelPath: MODEL_PATH, language: 'en', timeoutMs: 30_000 })

  // Nothing here is invented: this is whisper.cpp's own tiny model reading its own audio decode of a real WAV file.
  assert.match(text.toLowerCase(), /fox/, `expected the real sentence back, got: ${JSON.stringify(text)}`)
  assert.match(text.toLowerCase(), /lazy dog/, `expected the real sentence back, got: ${JSON.stringify(text)}`)
})

test('cancelling mid-run actually stops the process, rather than only stopping the promise', async (t) => {
  if (platform() !== 'win32') return t.skip('Windows-only binary')
  if (!(await ensureModel())) return t.skip('could not fetch the tiny model')
  if (!(await ensureSpeechWav())) return t.skip('could not synthesise a speech sample')

  const wav = await readFile(WAV_PATH)
  const binaryDir = whisperBinaryDir(join(import.meta.dirname, '..', '..', '..', 'resources'))
  const controller = new AbortController()
  const run = transcribeLocal(binaryDir, { wav, modelPath: MODEL_PATH, language: 'en', signal: controller.signal, timeoutMs: 30_000 })
  controller.abort()
  await assert.rejects(run, (err: unknown) => err instanceof WhisperRuntimeError && err.code === 'cancelled')
})

test('a run given no time at all is stopped as a timeout, not left running', async (t) => {
  if (platform() !== 'win32') return t.skip('Windows-only binary')
  if (!(await ensureModel())) return t.skip('could not fetch the tiny model')
  if (!(await ensureSpeechWav())) return t.skip('could not synthesise a speech sample')

  const wav = await readFile(WAV_PATH)
  const binaryDir = whisperBinaryDir(join(import.meta.dirname, '..', '..', '..', 'resources'))
  await assert.rejects(
    transcribeLocal(binaryDir, { wav, modelPath: MODEL_PATH, language: 'en', timeoutMs: 1 }),
    (err: unknown) => err instanceof WhisperRuntimeError && err.code === 'timeout'
  )
})
