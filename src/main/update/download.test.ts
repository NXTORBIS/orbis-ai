import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Downloader, fileChecksum, SPACE_HEADROOM } from './download.ts'

const PACKAGE = Buffer.from('ORBIS-PACKAGE-'.repeat(4000))
const SHA = createHash('sha256').update(PACKAGE).digest('hex')

/**
 * A stand-in release server that can be told to misbehave: to cut a download off part way, to refuse ranges, to fail
 * a few times before working, or to serve something other than what it promised.
 */
function releaseServer(): Promise<{ url: string; close(): Promise<void>; set(behaviour: Partial<Behaviour>): void; requests: { range: string | null }[] }> {
  type B = Behaviour
  const behaviour: B = { mode: 'ok', failuresLeft: 0, cutAfter: 0, body: PACKAGE }
  const requests: { range: string | null }[] = []
  const server: Server = createServer((req, res) => {
    const range = req.headers.range ?? null
    requests.push({ range: typeof range === 'string' ? range : null })

    if (behaviour.failuresLeft > 0) {
      behaviour.failuresLeft--
      res.writeHead(503)
      return res.end('busy')
    }
    if (behaviour.mode === 'missing') {
      res.writeHead(404)
      return res.end('gone')
    }

    const from = behaviour.mode === 'no-ranges' ? 0 : Number(/bytes=(\d+)-/.exec(String(range ?? ''))?.[1] ?? 0)
    if (from >= behaviour.body.length) {
      res.writeHead(416)
      return res.end()
    }
    const slice = behaviour.body.subarray(from)
    const partial = from > 0 && behaviour.mode !== 'no-ranges'
    res.writeHead(partial ? 206 : 200, {
      'content-length': String(behaviour.cutAfter > 0 ? Math.min(behaviour.cutAfter, slice.length) : slice.length),
      ...(partial ? { 'content-range': `bytes ${from}-${behaviour.body.length - 1}/${behaviour.body.length}` } : {})
    })
    if (behaviour.cutAfter > 0) {
      // Send only part of it, the way a download that stops part way leaves a short file behind. The next request
      // gets the rest, so a retry has something to carry on from.
      const part = slice.subarray(0, behaviour.cutAfter)
      behaviour.cutAfter = 0
      return res.end(part)
    }
    res.end(slice)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        url: `http://127.0.0.1:${port}/orbis.exe`,
        close: () => new Promise((done) => server.close(() => done())),
        set: (patch) => Object.assign(behaviour, patch),
        requests
      })
    })
  })
}

interface Behaviour {
  mode: 'ok' | 'no-ranges' | 'missing'
  failuresLeft: number
  /** Cut the connection after this many bytes; 0 sends everything. */
  cutAfter: number
  body: Buffer
}

async function withTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-download-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const noWait = { wait: async () => {} }

test('a package is fetched, and its checksum is what makes it an update', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const into = join(dir, 'orbis.exe')
      const seen: number[] = []
      const result = await new Downloader(noWait).fetchPackage({
        url: server.url,
        sha256: SHA,
        size: PACKAGE.length,
        into,
        onProgress: (p) => seen.push(p.fraction)
      })
      assert.equal(result.ok, true)
      assert.equal((await stat(into)).size, PACKAGE.length)
      assert.equal(await fileChecksum(into), SHA)
      assert.ok(seen.length > 0, 'progress is reported as it arrives')
      assert.ok(seen.at(-1)! > 0.99)
    })
  } finally {
    await server.close()
  }
})

test('a download that is cut off carries on from where it stopped rather than starting again', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const into = join(dir, 'orbis.exe')
      // The first attempt gets a third of the way and the connection dies; the retry picks it up.
      server.set({ cutAfter: Math.floor(PACKAGE.length / 3) })
      const result = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into })
      assert.equal(result.ok, true, result.ok ? '' : result.reason)
      assert.equal(await fileChecksum(into), SHA)

      const ranges = server.requests.map((r) => r.range).filter(Boolean)
      assert.ok(ranges.length > 0, 'it asked to carry on from part way through')
      assert.match(String(ranges[0]), /^bytes=\d+-$/)
    })
  } finally {
    await server.close()
  }
})

test('a package already on disk in full is checked rather than fetched again', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const into = join(dir, 'orbis.exe')
      await writeFile(into, PACKAGE)
      const before = server.requests.length
      const result = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into })
      assert.equal(result.ok, true)
      assert.equal(server.requests.length, before, 'nothing was downloaded')
    })
  } finally {
    await server.close()
  }
})

test('something the right size but the wrong file is thrown away and fetched properly', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const into = join(dir, 'orbis.exe')
      await writeFile(into, Buffer.alloc(PACKAGE.length, 7))
      const result = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into })
      assert.equal(result.ok, true)
      assert.equal(await fileChecksum(into), SHA, 'what is there now is the real package')
    })
  } finally {
    await server.close()
  }
})

test('a package that does not match its checksum is refused and deleted', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const into = join(dir, 'orbis.exe')
      // The server sends something else of the same length: the size is right, the file is not.
      const impostor = Buffer.alloc(PACKAGE.length, 9)
      server.set({ body: impostor })
      const result = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into })
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.match(result.reason, /checksum/)
      assert.equal(result.resumable, false, 'fetching the same wrong file again would not help')
      await assert.rejects(() => readFile(into), 'and it is not left lying around')
    })
  } finally {
    await server.close()
  }
})

test('a server having a bad moment is tried again; one that says the release is gone is not', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      server.set({ failuresLeft: 2 })
      const recovered = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into: join(dir, 'a.exe') })
      assert.equal(recovered.ok, true, 'it kept trying and got there')

      server.set({ mode: 'missing' })
      const gone = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into: join(dir, 'b.exe') })
      assert.equal(gone.ok, false)
      if (gone.ok) return
      assert.match(gone.reason, /404/)
      assert.equal(gone.resumable, false)
    })
  } finally {
    await server.close()
  }
})

test('a server that ignores the request to carry on starts the file again rather than doubling it up', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const into = join(dir, 'orbis.exe')
      // Half a file from an earlier attempt, and a server that sends the whole thing whatever it is asked.
      await writeFile(into, PACKAGE.subarray(0, Math.floor(PACKAGE.length / 2)))
      server.set({ mode: 'no-ranges' })
      const result = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into })
      assert.equal(result.ok, true, result.ok ? '' : result.reason)
      assert.equal((await stat(into)).size, PACKAGE.length, 'exactly one copy of the package')
      assert.equal(await fileChecksum(into), SHA)
    })
  } finally {
    await server.close()
  }
})

test('stopping a download leaves what has arrived, so it can be picked up later', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const into = join(dir, 'orbis.exe')
      const controller = new AbortController()
      controller.abort()
      const result = await new Downloader(noWait).fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into, signal: controller.signal })
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.match(result.reason, /stopped/)
      assert.equal(result.resumable, true)
    })
  } finally {
    await server.close()
  }
})

test('a disk without room is told about before anything is downloaded', async () => {
  const server = await releaseServer()
  try {
    await withTemp(async (dir) => {
      const before = server.requests.length
      const downloader = new Downloader({ ...noWait, freeSpace: async () => PACKAGE.length })
      const result = await downloader.fetchPackage({ url: server.url, sha256: SHA, size: PACKAGE.length, into: join(dir, 'orbis.exe') })
      assert.equal(result.ok, false, `room for the package alone is not enough; ${SPACE_HEADROOM}x is wanted`)
      if (result.ok) return
      assert.match(result.reason, /not enough room/)
      assert.equal(result.resumable, true, 'freeing up space and trying again is the answer')
      assert.equal(server.requests.length, before, 'nothing was fetched')
    })
  } finally {
    await server.close()
  }
})
