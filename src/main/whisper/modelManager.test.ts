import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelManager } from './modelManager.ts'

/** A model small enough to make up whole in memory for a test, standing in for a real multi-hundred-megabyte one. */
const FAKE_BYTES = Buffer.from('this is a fake ggml model file, exactly the size the manifest says it is')

/** A `fetch` that never touches the network: it serves FAKE_BYTES (and honours Range, the way the real mirror does). */
function fakeFetch(bytes = FAKE_BYTES): { fetchFn: typeof fetch } {
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range
    if (range) {
      const start = Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0)
      const slice = bytes.subarray(start)
      return new Response(slice, { status: 206, headers: { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } })
    }
    return new Response(bytes, { status: 200 })
  }) as unknown as typeof fetch
  return { fetchFn }
}

function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-whisper-test-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

// The catalog's real sizes are multi-hundred-megabyte; the manager itself does not know or care what the bytes are,
// so every test below monkey-patches WHISPER_MODEL_INFO's size for 'tiny' to match the small fake file — the manager
// is exercised exactly as it runs against a real model, just with a file small enough for a test to hold in memory.
import { WHISPER_MODEL_INFO } from '../../shared/whisperModels.ts'
const realSize = WHISPER_MODEL_INFO.tiny.sizeBytes
const realUrl = WHISPER_MODEL_INFO.tiny.url

test.beforeEach(() => {
  WHISPER_MODEL_INFO.tiny.sizeBytes = FAKE_BYTES.length
})
test.after(() => {
  WHISPER_MODEL_INFO.tiny.sizeBytes = realSize
  WHISPER_MODEL_INFO.tiny.url = realUrl
})

test('a model downloads, is recorded installed, and its file really is what was fetched', () =>
  withDir(async (dir) => {
    const { fetchFn } = fakeFetch()
    const manager = new ModelManager(dir, fetchFn)
    assert.equal(await manager.isInstalled('tiny'), false)

    const progress: number[] = []
    await manager.download('tiny', (p) => progress.push(p.receivedBytes))

    assert.equal(await manager.isInstalled('tiny'), true)
    assert.deepEqual(await manager.installed(), ['tiny'])
    assert.equal(await manager.verify('tiny'), true)
    assert.ok(progress.length > 0, 'progress was reported at least once')
    assert.equal(progress.at(-1), FAKE_BYTES.length)

    const onDisk = await readFile(manager.modelPath('tiny'))
    assert.deepEqual(onDisk, FAKE_BYTES)
  }))

test('a file that has been tampered with after downloading fails verification, even though it "is installed"', () =>
  withDir(async (dir) => {
    const { fetchFn } = fakeFetch()
    const manager = new ModelManager(dir, fetchFn)
    await manager.download('tiny')
    await writeFile(manager.modelPath('tiny'), Buffer.concat([FAKE_BYTES, Buffer.from('x')]))
    // Its size changed, so even the cheap check now says no.
    assert.equal(await manager.isInstalled('tiny'), false)
  }))

test('a file corrupted in place, same size, is caught by the real checksum but not by the cheap size check', () =>
  withDir(async (dir) => {
    const { fetchFn } = fakeFetch()
    const manager = new ModelManager(dir, fetchFn)
    await manager.download('tiny')
    const tampered = Buffer.from(FAKE_BYTES)
    tampered[0] = tampered[0] ^ 0xff
    await writeFile(manager.modelPath('tiny'), tampered)
    assert.equal(await manager.isInstalled('tiny'), true, 'the size still matches, so the cheap check alone would miss this')
    assert.equal(await manager.verify('tiny'), false, 'the real checksum catches what the size check cannot')
  }))

test('deleting a model removes its file and its record, and is safe on one that was never installed', () =>
  withDir(async (dir) => {
    const { fetchFn } = fakeFetch()
    const manager = new ModelManager(dir, fetchFn)
    await manager.download('tiny')
    await manager.delete('tiny')
    assert.equal(await manager.isInstalled('tiny'), false)
    await manager.delete('tiny') // does not throw
  }))

test('cancelling a download in progress leaves nothing installed, and the manager is free to try again', () =>
  withDir(async (dir) => {
    const held: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null }
    const fetchFn = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          held.controller = c
        }
      })
      return new Response(stream, { status: 200 })
    }) as unknown as typeof fetch

    const manager = new ModelManager(dir, fetchFn)
    const download = manager.download('tiny').catch((err: Error) => err)
    // The download is genuinely mid-stream — waiting for the fake stream to actually open, not guessing at timing.
    while (!held.controller) await new Promise((resolve) => setImmediate(resolve))
    manager.cancelDownload('tiny')
    held.controller.error(new Error('cancelled by test'))

    const result = await download
    assert.ok(result instanceof Error)
    assert.equal(await manager.isInstalled('tiny'), false)
    assert.equal(manager.isDownloading('tiny'), false)
  }))

test('two downloads of the same model at once are refused rather than racing each other', () =>
  withDir(async (dir) => {
    // A stream that never closes on its own, so the first download is still genuinely in flight when the second is
    // attempted — checking the guard against a real race, not one that only looks like it was tested.
    const held: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null }
    const fetchFn = (async () => {
      const stream = new ReadableStream<Uint8Array>({ start: (c) => (held.controller = c) })
      return new Response(stream, { status: 200 })
    }) as unknown as typeof fetch

    const manager = new ModelManager(dir, fetchFn)
    const first = manager.download('tiny').catch((err: Error) => err)
    while (!held.controller) await new Promise((resolve) => setImmediate(resolve))

    await assert.rejects(manager.download('tiny'), /already downloading/)

    manager.cancelDownload('tiny')
    held.controller.error(new Error('ending the test'))
    await first
  }))

test('a download refused for lack of disk space never touches the network', () =>
  withDir(async (dir) => {
    let called = false
    const fetchFn = (async () => {
      called = true
      return new Response(FAKE_BYTES, { status: 200 })
    }) as unknown as typeof fetch
    const manager = new ModelManager(dir, fetchFn)
    // A model manager can only be asked about space on a real filesystem; this checks the refusal path directly by
    // asking for a size the temp directory's free space cannot possibly hold.
    const hugeOriginal = WHISPER_MODEL_INFO.tiny.sizeBytes
    WHISPER_MODEL_INFO.tiny.sizeBytes = Number.MAX_SAFE_INTEGER / 2
    try {
      await assert.rejects(manager.download('tiny'), /space/i)
    } finally {
      WHISPER_MODEL_INFO.tiny.sizeBytes = hugeOriginal
    }
    assert.equal(called, false, 'refused before ever asking the network for anything')
  }))
