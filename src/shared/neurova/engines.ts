// NEUROVA engine registry. "documented" means the upstream README says it; it is NOT proof it works on this
// machine. Only a recorded successful test generation makes an engine `ready`.

export type Verification = 'verified' | 'documented' | 'unverified' | 'unsupported'

export interface EngineManifest {
  id: 'ace-step' | 'heartmula'
  name: string
  upstream: string
  /** Source the facts below were read from. */
  readFrom: string[]
  advertised: Record<'textToSong' | 'lyrics' | 'instrumental' | 'seed' | 'duration' | 'bpm' | 'key', Verification>
  /** Upstream states CPU inference works (ACE-Step: "significantly slower"). */
  cpu: 'documented-slow' | 'not-stated'
  /** Entries that must exist inside the model directory. */
  requiredFiles: string[]
  minDiskGb: number
  python: string
  license: { code: string; weights: string }
}

export const ENGINES: EngineManifest[] = [
  {
    id: 'ace-step',
    name: 'ACE-Step 1.5',
    upstream: 'https://github.com/ACE-Step/ACE-Step-1.5',
    readFrom: ['README.md', 'docs/en/INFERENCE.md', 'docs/en/INSTALL.md', 'LICENSE'],
    advertised: { textToSong: 'documented', lyrics: 'documented', instrumental: 'documented', seed: 'documented', duration: 'documented', bpm: 'documented', key: 'documented' },
    cpu: 'documented-slow',
    requiredFiles: ['vae', 'Qwen3-Embedding-0.6B', 'acestep-v15-turbo'],
    minDiskGb: 10,
    python: '3.11-3.12',
    license: { code: 'MIT', weights: 'not stated in the pages read; check the Hugging Face model card' }
  },
  {
    id: 'heartmula',
    name: 'HeartMuLa',
    upstream: 'https://github.com/HeartMuLa/heartlib',
    readFrom: ['README.md', 'examples/README.md', 'LICENSE'],
    advertised: { textToSong: 'documented', lyrics: 'documented', instrumental: 'unverified', seed: 'unverified', duration: 'unverified', bpm: 'unverified', key: 'unverified' },
    cpu: 'not-stated',
    requiredFiles: ['HeartCodec-oss', 'HeartMuLa-oss-3B', 'config.json', 'gen_config.json', 'tokenizer.json'],
    minDiskGb: 10,
    python: '3.10 recommended',
    license: { code: 'Apache-2.0', weights: 'Apache-2.0 per the README news of 20 Jan 2026' }
  }
]

export interface MachineFacts {
  pythonVersion: string | null
  gpuName: string | null
  gpuMemoryGb: number | null
  freeDiskGb: number
  /** Which required entries were found in each engine's model directory. */
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
  /** True when it would run on the processor only; slow. */
  cpuOnly: boolean
}

/** `ready` requires a recorded successful smoke test, never just files on disk. */
export function evaluate(m: EngineManifest, f: MachineFacts, smokeTestPassed: boolean): EngineStatus {
  const base = { id: m.id, name: m.name, cpuOnly: !f.gpuName }
  if (!f.pythonVersion) return { ...base, readiness: 'no-runtime', reason: 'Python was not found.' }
  if (!f.runtimeInstalled[m.id]) return { ...base, readiness: 'no-runtime', reason: `${m.name} is not installed in its own environment.` }
  const found = f.filesFound[m.id] ?? []
  const missing = m.requiredFiles.filter((x) => !found.includes(x))
  if (missing.length) return { ...base, readiness: 'no-model', reason: `Missing model files: ${missing.join(', ')}.` }
  if (!f.gpuName && m.cpu !== 'documented-slow') return { ...base, readiness: 'no-accelerator', reason: 'No GPU was found and CPU use is not stated for this engine.' }
  if (f.freeDiskGb < m.minDiskGb) return { ...base, readiness: 'low-disk', reason: `Needs about ${m.minDiskGb} GB free.` }
  if (!smokeTestPassed) {
    const slow = !f.gpuName ? ' It would run on the processor, which upstream says is significantly slower.' : ''
    return { ...base, readiness: 'unverified', reason: `Installed, but no real test generation has succeeded yet.${slow}` }
  }
  return { ...base, readiness: 'ready', reason: 'A test generation succeeded on this machine.' }
}
