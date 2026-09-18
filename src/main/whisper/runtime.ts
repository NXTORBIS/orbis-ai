import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { cpus, freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { WhisperHardwareInfo } from '../../shared/whisperModels.ts'

/**
 * Running whisper.cpp itself.
 *
 * Orbis ships the official whisper.cpp CLI binary (MIT-licensed, built by the whisper.cpp project — see
 * resources/whisper/LICENSE-whisper.cpp) rather than compiling it, because compiling it needs a C++ toolchain nobody
 * running Orbis has any reason to have installed. Everything below is a child process this machine runs on this
 * machine's own audio: nothing here reaches the network.
 *
 * The audio a session hands in is already a 16 kHz mono WAV file — the browser's own decoder did that conversion in
 * the window, which is where Chromium can decode whatever the microphone actually recorded. This only writes that
 * file to a temporary path, runs the binary against it, reads back the words, and deletes it whether the run
 * succeeded or not.
 */

export class WhisperRuntimeError extends Error {
  readonly code: 'binary-missing' | 'model-missing' | 'spawn-failed' | 'crashed' | 'timeout' | 'cancelled' | 'no-output'
  constructor(code: WhisperRuntimeError['code'], message: string) {
    super(message)
    this.name = 'WhisperRuntimeError'
    this.code = code
  }
}

export interface TranscribeLocalOptions {
  /** A 16 kHz mono 16-bit PCM WAV file, exactly what whisper.cpp asks for. */
  wav: Buffer
  modelPath: string
  /** ISO-639-1, or null to let Whisper detect it — the same freedom the Groq path used to give. */
  language: string | null
  threads?: number
  timeoutMs?: number
  signal?: AbortSignal
}

/** Where the bundled binary lives, packaged or not. */
export function whisperBinaryDir(resourcesPath: string): string {
  return join(resourcesPath, 'whisper', 'win-x64')
}

/** Cores to actually give it: all of them but one, so the rest of Orbis — and the rest of the machine — keeps moving. */
export function defaultThreads(): number {
  return Math.max(1, cpus().length - 1)
}

export function readHardware(): Omit<WhisperHardwareInfo, 'hasNvidiaGpu' | 'recommended'> {
  const info = cpus()
  return {
    cpuModel: info[0]?.model.trim() ?? 'Unknown CPU',
    cpuThreads: info.length,
    totalRamMb: Math.round(totalmem() / 1_000_000),
    freeRamMb: Math.round(freemem() / 1_000_000)
  }
}

/**
 * Turns a recording into words, entirely on this machine.
 *
 * whisper-cli is asked for plain text on stdout with no timestamps, which is exactly the shape every Orbis input
 * already expects a transcript to be in — nothing here has to parse a caption format only to strip it straight back
 * out again.
 */
export async function transcribeLocal(binaryDir: string, options: TranscribeLocalOptions): Promise<string> {
  const binary = join(binaryDir, 'whisper-cli.exe')
  const wavPath = join(tmpdir(), `orbis-voice-${randomUUID()}.wav`)
  await writeFile(wavPath, options.wav)

  const args = [
    '-m', options.modelPath,
    '-f', wavPath,
    '-t', String(options.threads ?? defaultThreads()),
    '--no-timestamps',
    '--no-prints',
    '-otxt', '-of', wavPath.replace(/\.wav$/, '')
  ]
  if (options.language) args.push('-l', options.language)
  else args.push('-l', 'auto')

  try {
    await runProcess(binary, args, binaryDir, options.timeoutMs ?? 60_000, options.signal)
    const { readFile } = await import('node:fs/promises')
    const textPath = `${wavPath.replace(/\.wav$/, '')}.txt`
    let text: string
    try {
      text = await readFile(textPath, 'utf8')
    } catch {
      throw new WhisperRuntimeError('no-output', 'Whisper produced no text.')
    }
    await rm(textPath, { force: true })
    return text.replace(/\s+/g, ' ').trim()
  } finally {
    await rm(wavPath, { force: true })
  }
}

function runProcess(binary: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new WhisperRuntimeError('cancelled', 'Cancelled.'))

    const child = spawn(binary, args, { cwd, windowsHide: true })
    let stderr = ''
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = (): void => {
      child.kill()
      finish(() => reject(new WhisperRuntimeError('cancelled', 'Cancelled.')))
    }
    signal?.addEventListener('abort', onAbort)

    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new WhisperRuntimeError('timeout', 'Transcribing took too long and was stopped.')))
    }, timeoutMs)

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000)
    })

    child.once('error', (err) => finish(() => reject(new WhisperRuntimeError('spawn-failed', err.message))))
    child.once('exit', (code) => {
      if (code === 0) return finish(resolve)
      finish(() => reject(new WhisperRuntimeError('crashed', `Whisper exited with code ${code}. ${stderr.slice(-400)}`)))
    })
  })
}
