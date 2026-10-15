// NEUROVA engine registry. Capabilities stay `unverified` until a real run proves them;
// nothing here claims a song can be generated. Readiness is computed from probed facts only.

export type Verification = 'verified' | 'unverified' | 'unsupported'

export interface EngineManifest {
  id: 'ace-step' | 'heartmula'
  name: string
  upstream: string
  /** What the upstream project advertises. Not proof for this machine. */
  advertised: Record<'textToSong' | 'lyrics' | 'instrumental' | 'seed' | 'duration', Verification>
  /** Files that must exist under the model directory before the engine can be called ready. */
  requiredFiles: string[]
  minDiskGb: number
  licenseNote: string
}

const UNVERIFIED = { textToSong: 'unverified', lyrics: 'unverified', instrumental: 'unverified', seed: 'unverified', duration: 'unverified' } as const

export const ENGINES: EngineManifest[] = [
  {
    id: 'ace-step',
    name: 'ACE-Step 1.5',
    upstream: 'https://github.com/ACE-Step/ACE-Step-1.5',
    advertised: { ...UNVERIFIED },
    requiredFiles: [],
    minDiskGb: 10,
    licenseNote: 'Code and weights licences not yet read from upstream; confirm before shipping.'
  },
  {
    id: 'heartmula',
    name: 'HeartMuLa',
    upstream: 'https://github.com/HeartMuLa/heartlib',
    advertised: { ...UNVERIFIED },
    requiredFiles: [],
    minDiskGb: 10,
    licenseNote: 'Code and weights licences not yet read from upstream; confirm before shipping.'
  }
]

export interface MachineFacts {
  pythonVersion: string | null
  gpuName: string | null
  gpuMemoryGb: number | null
  freeDiskGb: number
  /** Which model files were found, keyed by engine id. */
  filesFound: Record<string, string[]>
  /** Engines whose runtime is installed in an isolated environment. */
  runtimeInstalled: Record<string, boolean>
}

export type Readiness = 'no-runtime' | 'no-model' | 'no-accelerator' | 'low-disk' | 'unverified' | 'ready'

export interface EngineStatus {
  id: EngineManifest['id']
  name: string
  readiness: Readiness
  reason: string
}

/** `ready` requires a recorded successful smoke test, never just files on disk. */
export function evaluate(m: EngineManifest, f: MachineFacts, smokeTestPassed: boolean): EngineStatus {
  const base = { id: m.id, name: m.name }
  if (!f.pythonVersion) return { ...base, readiness: 'no-runtime', reason: 'Python was not found.' }
  if (!f.runtimeInstalled[m.id]) return { ...base, readiness: 'no-runtime', reason: `${m.name} is not installed in its own environment.` }
  const found = f.filesFound[m.id] ?? []
  const missing = m.requiredFiles.filter((x) => !found.includes(x))
  if (missing.length || found.length === 0) return { ...base, readiness: 'no-model', reason: 'Model weights are not downloaded.' }
  if (!f.gpuName) return { ...base, readiness: 'no-accelerator', reason: 'No supported GPU was detected; CPU generation is not verified for this engine.' }
  if (f.freeDiskGb < m.minDiskGb) return { ...base, readiness: 'low-disk', reason: `Needs about ${m.minDiskGb} GB free.` }
  if (!smokeTestPassed) return { ...base, readiness: 'unverified', reason: 'Installed, but no real test generation has succeeded yet.' }
  return { ...base, readiness: 'ready', reason: 'A test generation succeeded on this machine.' }
}
