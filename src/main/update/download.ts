import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Fetching an update package.
 *
 * A release is a large file over a network that comes and goes, so this is written for interruption rather than for
 * the happy path: a download that stops part way is picked up where it left off, a connection that fails is tried
 * again, and the whole thing can be paused or given up at any point. Nothing is ever believed on arrival — the file is
 * only an update once its checksum matches what the manifest said it would be.
 *
 * The package is written to a folder the application owns, never into anybody's profile.
 */

/** How many times a failed attempt is retried before giving up, and how long it waits between them. */
export const DOWNLOAD_ATTEMPTS = 4
export const RETRY_BACKOFF_MS = [1000, 3000, 8000]
/** Room wanted beyond the package itself, so installing has somewhere to work. */
export const SPACE_HEADROOM = 2

export interface DownloadProgress {
  /** Bytes on disk so far, including anything carried over from an earlier attempt. */
  received: number
  total: number
  /** 0 to 1. */
  fraction: number
  /** Bytes per second over the last stretch, or 0 before there is enough to say. */
  bytesPerSecond: number
  /** Seconds left at the current rate, or null when it cannot be guessed yet. */
  secondsLeft: number | null
}

export interface DownloadRequest {
  url: string
  /** What the manifest says the file will be; the download is not an update until this matches. */
  sha256: string
  size: number
  /** Where to put it. The folder is created if it is not there. */
  into: string
  onProgress?(progress: DownloadProgress): void
  signal?: AbortSignal
}

export type DownloadResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: string; /** True when picking up again later is worth trying. */ resumable: boolean }

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: unknown
}>

export interface DownloadOptions {
  /** Replaced in tests; the real one is the platform's. */
  fetchFn?: FetchLike
  /** How much room the disk has, in bytes. Replaced in tests. */
  freeSpace?(path: string): Promise<number>
  wait?(ms: number): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** What is already on disk from an earlier attempt, or 0. */
async function partialBytes(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

/** The checksum of a file as it sits on disk, read in pieces so a large package never has to be held in memory. */
export async function fileChecksum(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export class Downloader {
  private readonly o: DownloadOptions

  constructor(options: DownloadOptions = {}) {
    this.o = options
  }

  private get fetchFn(): FetchLike {
    return this.o.fetchFn ?? (globalThis.fetch as unknown as FetchLike)
  }

  private async freeSpace(path: string): Promise<number> {
    if (this.o.freeSpace) return this.o.freeSpace(path)
    try {
      const info = await statfs(path)
      return Number(info.bsize) * Number(info.bavail)
    } catch {
      // A disk that will not say how much room it has is not a reason to refuse to try.
      return Number.POSITIVE_INFINITY
    }
  }

  /**
   * Fetches a package, carrying on from whatever is already there. Returns where it was put, or why it could not be
   * finished and whether trying again later is worth it.
   */
  async fetchPackage(request: DownloadRequest): Promise<DownloadResult> {
    await mkdir(dirname(request.into), { recursive: true })

    // A package that has already arrived in full does not need fetching again, only checking.
    const already = await partialBytes(request.into)
    if (already === request.size) {
      const checksum = await fileChecksum(request.into)
      if (checksum === request.sha256) return { ok: true, path: request.into, bytes: already }
      // What is there is the right size but the wrong file, so it is thrown away rather than resumed.
      await rm(request.into, { force: true })
    }

    const needed = (request.size - (await partialBytes(request.into))) * SPACE_HEADROOM
    const free = await this.freeSpace(dirname(request.into))
    if (free < needed) {
      return { ok: false, reason: `there is not enough room to download the update (${Math.ceil(needed / 1_000_000)} MB needed)`, resumable: true }
    }

    let lastProblem = 'the download did not finish'
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
      if (request.signal?.aborted) return { ok: false, reason: 'the download was stopped', resumable: true }
      if (attempt > 0) await (this.o.wait ?? sleep)(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)])

      const from = await partialBytes(request.into)
      if (from > request.size) {
        // More on disk than the release is meant to be: what is there cannot be part of this package.
        await rm(request.into, { force: true })
        continue
      }
      const outcome = await this.attempt(request, from)
      if (outcome.ok) {
        // A request can end tidily and still be short of the whole package — a proxy cutting it off looks exactly
        // like this. Only a file of the right length is finished; anything less is carried on from.
        if ((await partialBytes(request.into)) >= request.size) break
        lastProblem = 'the download stopped before the whole package had arrived'
        continue
      }
      lastProblem = outcome.reason
      if (!outcome.retry) return { ok: false, reason: outcome.reason, resumable: outcome.resumable }
    }

    const bytes = await partialBytes(request.into)
    if (bytes !== request.size) return { ok: false, reason: lastProblem, resumable: true }

    // The last word: a package is only an update if it is exactly the file the manifest described.
    const checksum = await fileChecksum(request.into)
    if (checksum !== request.sha256) {
      await rm(request.into, { force: true })
      return { ok: false, reason: 'the download did not match its checksum, so it was thrown away', resumable: false }
    }
    return { ok: true, path: request.into, bytes }
  }

  /** One go at fetching, from `from` bytes in. */
  private async attempt(request: DownloadRequest, from: number): Promise<{ ok: true } | { ok: false; reason: string; retry: boolean; resumable: boolean }> {
    let response
    try {
      response = await this.fetchFn(request.url, {
        headers: from > 0 ? { Range: `bytes=${from}-` } : {},
        ...(request.signal ? { signal: request.signal } : {})
      })
    } catch (err) {
      if (request.signal?.aborted) return { ok: false, reason: 'the download was stopped', retry: false, resumable: true }
      return { ok: false, reason: `the server could not be reached (${err instanceof Error ? err.message : String(err)})`, retry: true, resumable: true }
    }

    // 416 means the server thinks there is nothing left to send: what is on disk is wrong, so it goes.
    if (response.status === 416) {
      await rm(request.into, { force: true })
      return { ok: false, reason: 'what had been downloaded no longer matches the release', retry: true, resumable: true }
    }
    if (!response.ok) {
      const permanent = response.status === 404 || response.status === 403 || response.status === 410
      return { ok: false, reason: `the server answered ${response.status}`, retry: !permanent, resumable: !permanent }
    }
    // Asking to carry on and being sent the whole file again means starting over rather than doubling it up.
    const resuming = from > 0 && response.status === 206
    if (from > 0 && !resuming) await rm(request.into, { force: true })

    const body = response.body
    if (!body) return { ok: false, reason: 'the server sent nothing', retry: true, resumable: true }

    const started = Date.now()
    const startedAt = resuming ? from : 0
    let received = startedAt
    const report = request.onProgress
    const stream = createWriteStream(request.into, { flags: resuming ? 'a' : 'w' })
    try {
      const source = Readable.fromWeb ? Readable.fromWeb(body as never) : (body as Readable)
      source.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (!report) return
        const seconds = (Date.now() - started) / 1000
        const rate = seconds > 0.5 ? (received - startedAt) / seconds : 0
        report({
          received,
          total: request.size,
          fraction: request.size > 0 ? Math.min(1, received / request.size) : 0,
          bytesPerSecond: rate,
          secondsLeft: rate > 0 ? Math.max(0, Math.round((request.size - received) / rate)) : null
        })
      })
      await pipeline(source, stream)
    } catch (err) {
      if (request.signal?.aborted) return { ok: false, reason: 'the download was stopped', retry: false, resumable: true }
      return { ok: false, reason: `the download was interrupted (${err instanceof Error ? err.message : String(err)})`, retry: true, resumable: true }
    }
    return { ok: true }
  }
}
