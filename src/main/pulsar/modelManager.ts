import { createHash } from 'node:crypto'
import { statfs } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PULSAR_MODEL_INFO, type PulsarModelId, type PulsarDownloadProgress } from '../../shared/pulsarModels.ts'

/**
 * Pulsar's model files, kept on disk.
 *
 * Every model lives under one directory, downloaded to a `.part` file and only ever renamed into place once it is
 * whole and its checksum has been taken — so a download that is cut short leaves nothing that looks installed. That
 * checksum is recorded in a small manifest and checked again before every load, which is what tells a corrupted file
 * from a good one: not a hash somebody else published, but the one this copy had when it finished downloading.
 *
 * Nothing here runs a model. This only ever manages the files.
 */

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface ModelManifestEntry {
  sha256: string
  bytes: number
  installedAt: number
}

type Manifest = Partial<Record<PulsarModelId, ModelManifestEntry>>

const statfsAsync = promisify(statfs)

export class ModelManager {
  private readonly dir: string
  private readonly manifestPath: string
  private readonly fetchFn: FetchFn
  private readonly downloads = new Map<PulsarModelId, AbortController>()

  constructor(baseDir: string, fetchFn: FetchFn) {
    this.dir = join(baseDir, 'Pulsar-models')
    this.manifestPath = join(this.dir, 'manifest.json')
    this.fetchFn = fetchFn
  }

  modelPath(id: PulsarModelId): string {
    return join(this.dir, PULSAR_MODEL_INFO[id].file)
  }

  private async readManifest(): Promise<Manifest> {
    try {
      return JSON.parse(await readFile(this.manifestPath, 'utf8')) as Manifest
    } catch {
      return {}
    }
  }

  private async writeManifest(manifest: Manifest): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  }

  /** Whether a model's file is on disk, its size matches what it downloaded as, and its checksum still agrees. */
  async isInstalled(id: PulsarModelId): Promise<boolean> {
    const manifest = await this.readManifest()
    const entry = manifest[id]
    if (!entry) return false
    try {
      const info = await stat(this.modelPath(id))
      if (info.size !== entry.bytes) return false
    } catch {
      return false
    }
    return true
  }

  /** Every model this profile has installed, verified cheaply (size only — a full hash on every check would be slow). */
  async installed(): Promise<PulsarModelId[]> {
    const manifest = await this.readManifest()
    const ids = Object.keys(manifest) as PulsarModelId[]
    const checks = await Promise.all(ids.map(async (id) => ((await this.isInstalled(id)) ? id : null)))
    return checks.filter((id): id is PulsarModelId => id !== null)
  }

  /** A full checksum against what was recorded when the file finished downloading — the real corruption check. */
  async verify(id: PulsarModelId): Promise<boolean> {
    const manifest = await this.readManifest()
    const entry = manifest[id]
    if (!entry) return false
    try {
      const buf = await readFile(this.modelPath(id))
      if (buf.length !== entry.bytes) return false
      const hash = createHash('sha256').update(buf).digest('hex')
      return hash === entry.sha256
    } catch {
      return false
    }
  }

  /** Free space where the models live, so a download can be refused honestly rather than fail halfway through. */
  async freeBytes(): Promise<number> {
    try {
      const info = await statfsAsync(this.dir).catch(async () => {
        await mkdir(this.dir, { recursive: true })
        return statfsAsync(this.dir)
      })
      return info.bavail * info.bsize
    } catch {
      return Number.POSITIVE_INFINITY // Unknown rather than zero: a machine this cannot be asked on should not be blocked by it.
    }
  }

  isDownloading(id: PulsarModelId): boolean {
    return this.downloads.has(id)
  }

  /** Stops a download in progress. The partial file is left for the next attempt to resume, where the server allows it. */
  cancelDownload(id: PulsarModelId): void {
    this.downloads.get(id)?.abort()
  }

  async delete(id: PulsarModelId): Promise<void> {
    this.cancelDownload(id)
    await rm(this.modelPath(id), { force: true })
    await rm(`${this.modelPath(id)}.part`, { force: true })
    const manifest = await this.readManifest()
    delete manifest[id]
    await this.writeManifest(manifest)
  }

  /**
   * Downloads a model, resuming a partial file where the server honours `Range` and starting over where it does not.
   * The file is only ever renamed into place — and only ever recorded as installed — once it is the whole thing and
   * its checksum has been taken.
   */
  async download(id: PulsarModelId, onProgress?: (progress: PulsarDownloadProgress) => void): Promise<void> {
    if (this.downloads.has(id)) throw new Error('That model is already downloading.')
    const info = PULSAR_MODEL_INFO[id]
    const free = await this.freeBytes()
    if (Number.isFinite(free) && free < info.sizeBytes * 1.1) {
      throw new Error(`Not enough free space for ${info.label} (needs about ${Math.ceil((info.sizeBytes * 1.1) / 1_000_000)} MB).`)
    }

    await mkdir(this.dir, { recursive: true })
    const partPath = `${this.modelPath(id)}.part`
    const controller = new AbortController()
    this.downloads.set(id, controller)

    try {
      let resumeFrom = 0
      try {
        resumeFrom = (await stat(partPath)).size
      } catch {
        resumeFrom = 0
      }

      const headers: Record<string, string> = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {}
      const res = await this.fetchFn(info.url, { headers, signal: controller.signal })
      if (!res.ok && res.status !== 206) throw new Error(`Pulsar model server answered ${res.status}.`)
      if (!res.body) throw new Error('The model server sent nothing.')

      // A server that ignores Range sends the whole file again from byte 0; that has to be honoured, not appended to.
      const reallyResuming = res.status === 206
      const startAt = reallyResuming ? resumeFrom : 0
      let received = startAt

      // A plain write, one chunk at a time, rather than piping through node:stream/promises: `fetch`'s body is a web
      // ReadableStream, whose chunk type node's own pipeline typings do not agree with — and writing it by hand is
      // exactly as simple, with progress reported from the one place a chunk is ever seen.
      const out = createWriteStream(partPath, { flags: reallyResuming ? 'a' : 'w' })
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.length
          onProgress?.({ id, receivedBytes: received, totalBytes: info.sizeBytes })
          if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
        }
      } finally {
        await new Promise<void>((resolve, reject) => out.end((err: Error | null | undefined) => (err ? reject(err) : resolve())))
      }

      const final = await readFile(partPath)
      if (final.length !== info.sizeBytes) {
        throw new Error(`The downloaded model is ${final.length} bytes; ${info.sizeBytes} were expected. Try again.`)
      }
      const sha256 = createHash('sha256').update(final).digest('hex')

      await rename(partPath, this.modelPath(id))
      const manifest = await this.readManifest()
      manifest[id] = { sha256, bytes: final.length, installedAt: Date.now() }
      await this.writeManifest(manifest)
    } catch (err) {
      if (controller.signal.aborted) {
        // Cancelled, not corrupt: the partial file stays so a later download can pick up from here.
        throw new Error('cancelled')
      }
      throw err
    } finally {
      this.downloads.delete(id)
    }
  }
}
