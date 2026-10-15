import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { MachineFacts } from '../../shared/neurova/engines.ts'

const run = promisify(execFile)

const tryRun = async (cmd: string, args: string[]): Promise<string | null> => {
  try {
    const { stdout, stderr } = await run(cmd, args, { timeout: 4000, windowsHide: true })
    return (stdout || stderr).trim()
  } catch {
    return null
  }
}

/**
 * What this machine really has. Nothing is assumed: a missing tool is reported as missing.
 * No model runtime is installed by Orbis yet, so `runtimeInstalled` and `filesFound` are honestly empty.
 */
export async function probeMachine(userData: string): Promise<MachineFacts> {
  const [py, gpu, fs] = await Promise.all([
    tryRun('python', ['--version']),
    tryRun('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']),
    statfs(userData).catch(() => null)
  ])
  const first = gpu?.split(/\r?\n/)[0]?.split(',').map((s) => s.trim())
  return {
    pythonVersion: py?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null,
    gpuName: first?.[0] || null,
    gpuMemoryGb: first?.[1] ? Math.round(Number(first[1]) / 1024) : null,
    freeDiskGb: fs ? Math.floor((fs.bavail * fs.bsize) / 1024 ** 3) : 0,
    filesFound: {},
    runtimeInstalled: {}
  }
}
