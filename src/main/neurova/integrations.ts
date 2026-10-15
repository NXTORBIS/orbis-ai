// Adapters that hand a finished NEUROVA version to Orbis Music and Orbis Files.
// Dependencies are injected so the adapters run without Electron. A failure here never touches the NEUROVA artifact:
// nothing in this file writes, moves or deletes the audio, it only reads it.
import { createHash } from 'node:crypto'
import { inspectWav } from '../../shared/neurova/audio.ts'

/** Maps to MusicLibrary.importFile(path, provenance, now) in src/main/music/library.ts:147. */
export interface MusicImportApi {
  importFile(path: string, provenance?: 'user-file' | 'watched-folder' | 'download' | 'recognised'): Promise<{
    kind: 'added' | 'already' | 'failed'
    track?: { id: string }
    file: string
    why?: string
  }>
  /** Maps to MusicStore.all() (the library's store; MusicLibrary.same at library.ts:418 reads it the same way). */
  allTracks(): Promise<Array<{ id: string; file?: string }>>
  /** Maps to MusicLibrary.fingerprint(path) at library.ts:444: sha256 of the first 256 KB, first 32 hex chars. */
  fingerprint(path: string): Promise<string | null>
}

export interface FileDeps {
  readFile(path: string): Promise<Uint8Array>
}

export interface AddToMusicInput {
  musicLibrary: MusicImportApi
  artifactPath: string
  sha256: string
  title: string
  projectTitle: string
  versionName: string
  engine?: string
}

export type IntegrationResult = { ok: true; trackId?: string; already?: boolean } | { ok: false; reason: string }

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

async function checkAudio(path: string, expected: string, deps: FileDeps): Promise<{ ok: true } | { ok: false; reason: string }> {
  let bytes: Uint8Array
  try { bytes = await deps.readFile(path) } catch { return { ok: false, reason: 'The audio file could not be found.' } }
  const ins = inspectWav(bytes)
  if (!ins.ok) return { ok: false, reason: ins.reason }
  if (sha(bytes) !== expected) return { ok: false, reason: 'The file on disk no longer matches this version, so it was not added.' }
  return { ok: true }
}

/** Which real functions the adapters map to. */
export function describeMusicApi(): string[] {
  return [
    'MusicLibrary.importFile(path: string, provenance: OrbisTrack["provenance"] = "user-file", now = Date.now()): Promise<ImportResult>  src/main/music/library.ts:147',
    'MusicLibrary.fingerprint(path: string): Promise<string | null>  src/main/music/library.ts:444',
    'MusicStore.all(): Promise<OrbisTrack[]>  (used by MusicLibrary.same, library.ts:418)',
    'Catalog.registerGenerated(g: { path; generator; chatId?; prompt?; createdMs? }): string  src/files/main/store/Catalog.ts:595 (via getFilesServices().catalog, src/main/filesIntegration.ts:122)'
  ]
}

export async function addToMusic(input: AddToMusicInput, deps: FileDeps): Promise<IntegrationResult> {
  try {
    const checked = await checkAudio(input.artifactPath, input.sha256, deps)
    if (!checked.ok) return checked
    const lib = input.musicLibrary
    const tracks = await lib.allTracks()
    const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
    const samePath = tracks.find((t) => t.file && norm(t.file) === norm(input.artifactPath))
    if (samePath) return { ok: true, trackId: samePath.id, already: true }
    // A matching short fingerprint is only a hint; the full hash decides.
    const mine = await lib.fingerprint(input.artifactPath)
    if (mine) {
      for (const t of tracks) {
        if (!t.file) continue
        if ((await lib.fingerprint(t.file)) !== mine) continue
        try {
          if (sha(await deps.readFile(t.file)) === input.sha256) return { ok: true, trackId: t.id, already: true }
        } catch { /* unreadable candidate: not a duplicate we can prove */ }
      }
    }
    const r = await lib.importFile(input.artifactPath, 'user-file')
    if (r.kind === 'failed') return { ok: false, reason: r.why ?? 'Orbis Music could not read the file.' }
    return { ok: true, trackId: r.track?.id, already: r.kind === 'already' }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Orbis Music could not add the file.' }
  }
}

/** Maps to getFilesServices().catalog.registerGenerated (Catalog.ts:595). */
export interface FilesCatalogApi {
  registerGenerated(g: { path: string; generator: string; chatId?: string; prompt?: string; createdMs?: number }): string
}

export interface RegisterWithFilesInput {
  catalog: FilesCatalogApi | null
  artifactPath: string
  sha256: string
  projectTitle: string
  versionName: string
  brief?: string
  engine?: string
  createdMs?: number
  /** True when Files already lists this path, so it is not registered twice. */
  alreadyRegistered?: (path: string) => boolean
}

export async function registerWithFiles(input: RegisterWithFilesInput, deps: FileDeps): Promise<IntegrationResult> {
  try {
    if (!input.catalog) return { ok: false, reason: 'Orbis Files is not running, so the file was not listed there.' }
    const checked = await checkAudio(input.artifactPath, input.sha256, deps)
    if (!checked.ok) return checked
    if (input.alreadyRegistered?.(input.artifactPath)) return { ok: true, already: true }
    const prompt = `${input.projectTitle} - ${input.versionName}${input.brief ? `: ${input.brief}` : ''}`.slice(0, 4000)
    const generator = input.engine ? `neurova:${input.engine}` : 'neurova'
    const id = input.catalog.registerGenerated({ path: input.artifactPath, generator, prompt, createdMs: input.createdMs })
    return { ok: true, trackId: id }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Orbis Files could not list the file.' }
  }
}
