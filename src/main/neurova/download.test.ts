import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { download, stageInstall, DownloadError } from './download.ts'

const body = randomBytes(300_000)
const sha = createHash('sha256').update(body).digest('hex')
let server: http.Server
let base = ''
let dir = ''
let slowAfter = 0

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dl-'))
  server = http.createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/file') {
      const m = /bytes=(\d+)-/.exec(String(req.headers.range ?? ''))
      if (m) {
        const s = Number(m[1])
        res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-length': body.length - s, 'content-range': 'bytes ' + s + '-' + (body.length - 1) + '/' + body.length })
        return res.end(body.subarray(s))
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length })
      return res.end(body)
    }
    if (url === '/norange') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length })
      return res.end(body)
    }
    if (url === '/redir') { res.writeHead(302, { location: '/file' }); return res.end() }
    if (url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end() }
    if (url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>404</html>') }
    if (url === '/cut') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length })
      res.write(body.subarray(0, 100_000))
      slowAfter++
      return setTimeout(() => res.destroy(), 20)
    }
    res.writeHead(404); res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})
after(async () => { server.close(); await rm(dir, { recursive: true, force: true }) })

const fail = async (p: Promise<unknown>, code: string) => {
  await assert.rejects(p, (e: unknown) => e instanceof DownloadError && e.code === code)
}

test('plain download verifies hash and size, reports progress', async () => {
  let last = { received: 0, total: null as number | null }
  const r = await download(base + '/file', join(dir, 'a.bin'), { sha256: sha, size: body.length, onProgress: (p) => { last = p } })
  assert.equal(r.bytes, body.length)
  assert.equal(last.received, body.length)
  assert.equal(last.total, body.length)
  assert.deepEqual(await readFile(join(dir, 'a.bin')), body)
})

test('follows a redirect; refuses a redirect loop and a bad protocol', async () => {
  await download(base + '/redir', join(dir, 'r.bin'), { sha256: sha })
  await fail(download(base + '/loop', join(dir, 'l.bin')), 'TOO_MANY_REDIRECTS')
  await fail(download('file:///etc/passwd', join(dir, 'x.bin')), 'BAD_PROTOCOL')
})

test('wrong hash deletes the part and writes no dest', async () => {
  await fail(download(base + '/file', join(dir, 'h.bin'), { sha256: 'ab'.repeat(32) }), 'HASH_MISMATCH')
  await assert.rejects(stat(join(dir, 'h.bin')))
  await assert.rejects(stat(join(dir, 'h.bin.part')))
})

test('html body refused', async () => {
  await fail(download(base + '/html', join(dir, 'html.bin')), 'HTML_RESPONSE')
  await fail(download(base + '/file', join(dir, 'ct.bin'), { expectContentType: ['audio/'] }), 'HTML_RESPONSE')
})

test('wrong expected size refused', async () => {
  await fail(download(base + '/file', join(dir, 's.bin'), { size: 5 }), 'SIZE_MISMATCH')
})

test('resumes with Range from an existing part', async () => {
  const dest = join(dir, 'res.bin')
  await writeFile(dest + '.part', body.subarray(0, 120_000))
  const r = await download(base + '/file', dest, { sha256: sha })
  assert.equal(r.resumed, true)
  assert.deepEqual(await readFile(dest), body)
})

test('restarts from zero when the server ignores Range', async () => {
  const dest = join(dir, 'nr.bin')
  await writeFile(dest + '.part', body.subarray(0, 50_000))
  const r = await download(base + '/norange', dest, { sha256: sha })
  assert.equal(r.resumed, false)
  assert.deepEqual(await readFile(dest), body)
})

test('dropped connection keeps the part; cancel keeps a valid part', async () => {
  const dest = join(dir, 'cut.bin')
  await assert.rejects(download(base + '/cut', dest))
  assert.ok(slowAfter > 0)
  assert.ok((await stat(dest + '.part')).size > 0)
  await assert.rejects(stat(dest))

  const ac = new AbortController()
  const d2 = join(dir, 'ab.bin')
  const p = download(base + '/file', d2, { signal: ac.signal, onProgress: () => ac.abort() })
  await assert.rejects(p, (e: unknown) => e instanceof DownloadError && e.code === 'CANCELLED')
  await assert.rejects(stat(d2))
  const partBytes = (await stat(d2 + '.part')).size
  assert.ok(partBytes > 0)
  assert.deepEqual((await readFile(d2 + '.part')), body.subarray(0, partBytes))
})

test('stageInstall: nothing replaced until all verified; then swapped', async () => {
  const final = join(dir, 'engine')
  await writeFile(join(dir, 'marker'), 'x')
  await stageInstall([{ url: base + '/file', sha256: sha, dest: 'a.bin' }], final)
  assert.deepEqual(await readFile(join(final, 'a.bin')), body)

  await assert.rejects(
    stageInstall([{ url: base + '/file', sha256: sha, dest: 'b.bin' }, { url: base + '/file', sha256: '00'.repeat(32), dest: 'c.bin' }], final)
  )
  // old install is intact, new file not present in it
  assert.deepEqual(await readFile(join(final, 'a.bin')), body)
  await assert.rejects(stat(join(final, 'b.bin')))
})
