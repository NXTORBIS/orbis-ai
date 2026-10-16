import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { ZipWriter } from '../../shared/portable/zip.ts'
import {
  ARCHIVE_LIMITS,
  InstallError,
  LICENCE_NAME,
  assetPreference,
  checkBinaryPath,
  chooseAsset,
  downloadAsset,
  readInstalled,
  readRelease,
  resolveRelease,
  unpackEngine,
  writeInstalled,
  type InstallRecord,
  type ReleaseAsset
} from './install.ts'

const home = (): string => mkdtempSync(join(tmpdir(), 'orbis-chess-'))

/** A release as GitHub really answers, shortened: this is the shape sf_19 has. */
const sf19 = {
  tag_name: 'sf_19',
  prerelease: false,
  assets: [
    {
      name: 'stockfish-windows-x86-64-universal.zip',
      browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
      size: 81431614,
      digest: 'sha256:3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7'
    },
    {
      name: 'stockfish-windows-arm64-universal.zip',
      browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-arm64-universal.zip',
      size: 80190536,
      digest: 'sha256:8372ad3f0d7276deb2c70f801f541ec7db463219fc6d9c7592864e542aa4f401'
    },
    {
      name: 'stockfish-linux-x86-64-universal.tar.gz',
      browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz',
      size: 81388977,
      digest: 'sha256:9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f'
    }
  ]
}

/** sf_17.1's shape: the per-instruction-set names, and no digest at all. */
const sf171 = {
  tag_name: 'sf_17.1',
  prerelease: false,
  assets: [
    { name: 'stockfish-windows-x86-64-avx2.zip', browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-windows-x86-64-avx2.zip', size: 65443094 },
    { name: 'stockfish-windows-x86-64-bmi2.zip', browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-windows-x86-64-bmi2.zip', size: 65440505 },
    { name: 'stockfish-windows-x86-64.zip', browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-windows-x86-64.zip', size: 65440867 }
  ]
}

test('a release is read field by field, and a digest becomes a checksum', () => {
  const release = readRelease(sf19)
  assert.ok(release)
  assert.equal(release.tag, 'sf_19')
  assert.equal(release.prerelease, false)
  assert.equal(release.assets.length, 3)
  assert.equal(release.assets[0].sha256, '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7')
  assert.equal(release.assets[0].size, 81431614)
  // No digest is null, never an empty string that would later compare equal to something.
  assert.equal(readRelease(sf171)?.assets[0].sha256, null)
})

test('an asset is ignored when its address is not the project’s own host, and when a field is missing', () => {
  const release = readRelease({
    tag_name: 'sf_19',
    assets: [
      { name: 'evil.zip', browser_download_url: 'https://example.invalid/evil.zip', size: 10, digest: 'sha256:' + 'a'.repeat(64) },
      { name: 'nameless.zip', browser_download_url: '' },
      { name: 'fine.zip', browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/fine.zip', size: 10 },
      { name: 'short-digest.zip', browser_download_url: 'https://objects.githubusercontent.com/x', size: 1, digest: 'sha256:abc' }
    ]
  })
  assert.deepEqual(release?.assets.map((a) => a.name), ['fine.zip', 'short-digest.zip'])
  // A digest that is not a sha256 is not half-trusted; it is no checksum at all.
  assert.equal(release?.assets[1].sha256, null)
  assert.equal(readRelease({ assets: [] }), null)
  assert.equal(readRelease(null), null)
})

test('the Windows build chosen is the universal one, and never an instruction set nobody checked for', () => {
  const release = readRelease(sf19)!
  assert.equal(chooseAsset(release, { platform: 'win32', arch: 'x64' }).asset?.name, 'stockfish-windows-x86-64-universal.zip')
  assert.equal(chooseAsset(release, { platform: 'win32', arch: 'arm64' }).asset?.name, 'stockfish-windows-arm64-universal.zip')
  // The older naming scheme: the baseline build, because nothing here can see whether this processor has AVX2.
  const old = readRelease(sf171)!
  assert.equal(chooseAsset(old, { platform: 'win32', arch: 'x64' }).asset?.name, 'stockfish-windows-x86-64.zip')
  for (const names of [assetPreference('win32', 'x64'), assetPreference('win32', 'arm64')]) {
    assert.equal(names.some((n) => /avx|bmi|vnni|sse|dotprod/.test(n)), false, names.join(','))
  }
})

test('a platform this installer cannot unpack for is said plainly rather than guessed at', () => {
  const release = readRelease(sf19)!
  const linux = chooseAsset(release, { platform: 'linux', arch: 'x64' })
  assert.equal(linux.asset, null)
  assert.match(linux.reason, /Windows archive/)
  assert.match(linux.reason, /linux\/x64/)
  assert.deepEqual(assetPreference('darwin', 'arm64'), [])
  assert.deepEqual(assetPreference('win32', 'ia32'), [])
})

test('an asset asked for by name is only used when the release really has it', () => {
  const release = readRelease(sf19)!
  assert.equal(chooseAsset(release, { prefer: 'stockfish-windows-arm64-universal.zip' }).asset?.name, 'stockfish-windows-arm64-universal.zip')
  const missing = chooseAsset(release, { prefer: 'stockfish-windows-x86-64-avx512.zip' })
  assert.equal(missing.asset, null)
  assert.match(missing.reason, /has no asset called/)
})

test('a release with no build Orbis knows is reported with what it does have', () => {
  const release = readRelease({ tag_name: 'sf_99', assets: [{ name: 'stockfish-windows-x86-64-avx2.zip', browser_download_url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_99/stockfish-windows-x86-64-avx2.zip', size: 1 }] })!
  const choice = chooseAsset(release, { platform: 'win32', arch: 'x64' })
  assert.equal(choice.asset, null)
  assert.match(choice.reason, /stockfish-windows-x86-64-avx2\.zip/)
})

test('resolving a release skips the daily development build and takes the finished one', async () => {
  const body = [
    { tag_name: 'stockfish-dev-20261013-5c4cef0b', prerelease: true, assets: sf19.assets },
    sf19
  ]
  const fetchFn = (async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })) as typeof fetch
  assert.equal((await resolveRelease({ fetchFn })).tag, 'sf_19')
})

test('a release list that cannot be reached is an offline failure, not an empty release', async () => {
  const dead = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch
  await assert.rejects(() => resolveRelease({ fetchFn: dead }), (e: unknown) => e instanceof InstallError && e.code === 'offline')
  const refused = (async () => new Response('nope', { status: 503 })) as typeof fetch
  await assert.rejects(() => resolveRelease({ fetchFn: refused }), (e: unknown) => e instanceof InstallError && e.code === 'no-release')
  const empty = (async () => new Response('[]')) as typeof fetch
  await assert.rejects(() => resolveRelease({ fetchFn: empty }), (e: unknown) => e instanceof InstallError && e.code === 'no-release')
})

// ---------------------------------------------------------------- downloading

const body = Buffer.from('a pretend engine archive, long enough to be worth hashing'.repeat(20))
const digest = createHash('sha256').update(body).digest('hex')

const asset = (over: Partial<ReleaseAsset> = {}): ReleaseAsset => ({
  name: 'stockfish-windows-x86-64-universal.zip',
  url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
  size: body.length,
  sha256: digest,
  ...over
})

const serve = (data: Buffer | string, init: ResponseInit = {}): typeof fetch =>
  (async () => new Response(data, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.from(data).length) }, ...init })) as typeof fetch

test('a download is kept only when its bytes hash to what the release published', async () => {
  const dir = home()
  const seen: number[] = []
  const got = await downloadAsset(asset(), join(dir, 'a.zip'), { fetchFn: serve(body), onProgress: (p) => seen.push(p.received) })
  assert.equal(got.bytes, body.length)
  assert.equal(got.sha256, digest)
  assert.equal(got.verified, true)
  assert.deepEqual(await readFile(join(dir, 'a.zip')), body)
  assert.ok(seen.length >= 1 && seen[seen.length - 1] === body.length)
})

test('a download that does not match its checksum is discarded and never left where it could be run', async () => {
  const dir = home()
  const wrong = Buffer.concat([body, Buffer.from('tampered')])
  await assert.rejects(
    () => downloadAsset(asset({ size: wrong.length }), join(dir, 'a.zip'), { fetchFn: serve(wrong) }),
    (e: unknown) => e instanceof InstallError && e.code === 'unverified' && /discarded and never run/.test(e.message)
  )
  assert.equal(existsSync(join(dir, 'a.zip')), false)
  assert.equal(existsSync(join(dir, 'a.zip.part')), false)
})

test('a release with no checksum is refused rather than run, unless that is asked for explicitly', async () => {
  const dir = home()
  await assert.rejects(
    () => downloadAsset(asset({ sha256: null }), join(dir, 'a.zip'), { fetchFn: serve(body) }),
    (e: unknown) => e instanceof InstallError && e.code === 'unverified' && /publishes no checksum/.test(e.message)
  )
  assert.equal(existsSync(join(dir, 'a.zip')), false)
  const got = await downloadAsset(asset({ sha256: null }), join(dir, 'a.zip'), { fetchFn: serve(body), allowUnverified: true })
  // It downloaded, and it says so: "verified" is not quietly true because nothing contradicted it.
  assert.equal(got.verified, false)
  assert.equal(got.sha256, digest)
})

test('a web page where an archive was expected, and a length that disagrees, are both refused', async () => {
  const dir = home()
  const page = (async () => new Response('<html>rate limited</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch
  await assert.rejects(() => downloadAsset(asset(), join(dir, 'a.zip'), { fetchFn: page }), (e: unknown) => e instanceof InstallError && /web page/.test(e.message))
  const shortHeader = (async () => new Response(body, { headers: { 'content-type': 'application/zip', 'content-length': '7' } })) as typeof fetch
  await assert.rejects(() => downloadAsset(asset(), join(dir, 'a.zip'), { fetchFn: shortHeader }), (e: unknown) => e instanceof InstallError && e.code === 'download-failed')
  const short = (async () => new Response(body.subarray(0, 10), { headers: { 'content-type': 'application/zip' } })) as typeof fetch
  await assert.rejects(() => downloadAsset(asset(), join(dir, 'a.zip'), { fetchFn: short }), (e: unknown) => e instanceof InstallError && /bytes where the release says/.test(e.message))
  await assert.rejects(() => downloadAsset(asset(), join(dir, 'a.zip'), { fetchFn: serve(body, { status: 404 }) }), (e: unknown) => e instanceof InstallError && /status 404/.test(e.message))
})

// ---------------------------------------------------------------- unpacking

/** The archive upstream really builds: one folder, the executable, the licence, and a lot of other files. */
function buildArchive(o: { exe?: string; licence?: boolean; extras?: string[] } = {}): Buffer {
  const writer = new ZipWriter((d) => new Uint8Array(deflateRawSync(d)))
  const chunks: Uint8Array[] = []
  const add = (path: string, data: Buffer): void => {
    const out = writer.add({ path, data: new Uint8Array(data), compress: true }, ARCHIVE_LIMITS)
    assert.ok(out instanceof Uint8Array, `could not add ${path}`)
    chunks.push(out)
  }
  // Larger than a megabyte so the "which entry is the engine" rule has something to choose by.
  add(`stockfish/${o.exe ?? 'stockfish-windows-x86-64-universal.exe'}`, Buffer.alloc(1024 * 1024 + 7, 0x41))
  if (o.licence !== false) add(`stockfish/${LICENCE_NAME}`, Buffer.from('GNU GENERAL PUBLIC LICENSE Version 3'))
  add('stockfish/README.md', Buffer.from('# Stockfish'))
  add('stockfish/src/main.cpp', Buffer.from('int main() { return 0; }'))
  add('stockfish/wiki/Home.md', Buffer.from('welcome'))
  for (const extra of o.extras ?? []) add(extra, Buffer.alloc(2048, 0x42))
  chunks.push(writer.finish())
  return Buffer.concat(chunks)
}

test('only the program and its licence come out of the archive, out of everything in it', async () => {
  const dir = home()
  const archive = join(dir, 'sf.zip')
  await writeFile(archive, buildArchive())
  const unpacked = await unpackEngine(archive, join(dir, 'engine'), { platform: 'win32' })
  assert.equal(unpacked.binary, join(dir, 'engine', 'stockfish-windows-x86-64-universal.exe'))
  assert.equal(unpacked.licence, join(dir, 'engine', LICENCE_NAME))
  assert.match(await readFile(unpacked.licence!, 'utf8'), /GENERAL PUBLIC LICENSE/)
  // The source tree and the wiki stay in the archive: around a hundred entries that nothing would ever read.
  assert.equal(existsSync(join(dir, 'engine', 'README.md')), false)
  assert.equal(existsSync(join(dir, 'engine', 'src')), false)
  assert.equal(existsSync(join(dir, 'engine', 'wiki')), false)
})

test('an archive with no program in it is a failure, said as one', async () => {
  const dir = home()
  const writer = new ZipWriter((d) => new Uint8Array(deflateRawSync(d)))
  const chunks = [writer.add({ path: 'stockfish/README.md', data: new Uint8Array(Buffer.from('nothing to run')), compress: true }) as Uint8Array, writer.finish()]
  const archive = join(dir, 'sf.zip')
  await writeFile(archive, Buffer.concat(chunks))
  await assert.rejects(
    () => unpackEngine(archive, join(dir, 'engine'), { platform: 'win32' }),
    (e: unknown) => e instanceof InstallError && e.code === 'archive-failed' && /no program to run/.test(e.message)
  )
})

test('an archive that is not an archive is refused before anything is written', async () => {
  const dir = home()
  const archive = join(dir, 'sf.zip')
  await writeFile(archive, Buffer.from('this is not a zip file at all, not even close'))
  await assert.rejects(() => unpackEngine(archive, join(dir, 'engine'), { platform: 'win32' }), (e: unknown) => e instanceof InstallError && e.code === 'archive-failed')
  assert.equal(existsSync(join(dir, 'engine', 'stockfish-windows-x86-64-universal.exe')), false)
})

test('a missing licence is reported rather than invented', async () => {
  const dir = home()
  const archive = join(dir, 'sf.zip')
  await writeFile(archive, buildArchive({ licence: false }))
  const unpacked = await unpackEngine(archive, join(dir, 'engine'), { platform: 'win32' })
  assert.equal(unpacked.licence, null)
  assert.equal(existsSync(join(dir, 'engine', LICENCE_NAME)), false)
})

// ---------------------------------------------------------------- the record

const record = (over: Partial<InstallRecord> = {}): InstallRecord => ({
  version: 'sf_19',
  asset: 'stockfish-windows-x86-64-universal.zip',
  archiveUrl: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
  sha256: digest,
  verified: true,
  bytes: 81431614,
  binary: 'stockfish-windows-x86-64-universal.exe',
  licence: LICENCE_NAME,
  licenceId: 'GPL-3.0-or-later',
  sourceUrl: 'https://github.com/official-stockfish/Stockfish/releases/tag/sf_19',
  installedAt: 1760000000000,
  ...over
})

test('the install record survives a round trip, and says which version and whether it was verified', async () => {
  const dir = home()
  assert.deepEqual(await readInstalled(dir), { record: null, problem: null })
  writeFileSync(join(dir, 'stockfish-windows-x86-64-universal.exe'), 'x')
  await writeInstalled(dir, record())
  const read = await readInstalled(dir)
  assert.equal(read.problem, null)
  assert.equal(read.record?.version, 'sf_19')
  assert.equal(read.record?.verified, true)
  assert.equal(read.record?.licenceId, 'GPL-3.0-or-later')
})

test('a record that cannot be read is a problem, not an absence', async () => {
  const dir = home()
  writeFileSync(join(dir, 'installed.json'), '{ half written')
  const broken = await readInstalled(dir)
  assert.equal(broken.record, null)
  // The difference matters: "not installed" would send somebody to download eighty megabytes again over a bad file.
  assert.match(broken.problem ?? '', /could not be read/)

  const dir2 = home()
  writeFileSync(join(dir2, 'installed.json'), JSON.stringify({ version: 'sf_19' }))
  assert.match((await readInstalled(dir2)).problem ?? '', /not in a shape Orbis understands/)

  const dir3 = home()
  await writeInstalled(dir3, record())
  assert.match((await readInstalled(dir3)).problem ?? '', /is not in .* any more/)
})

// ---------------------------------------------------------------- a path somebody chose

test('a binary path is checked, and a relative one or a line break is refused', () => {
  const dir = home()
  const exe = join(dir, 'engine.exe')
  writeFileSync(exe, 'x')
  assert.equal(checkBinaryPath(exe, { platform: 'win32' }).ok, true)
  assert.match(checkBinaryPath('stockfish.exe', { platform: 'win32' }).why, /not a full path/)
  assert.match(checkBinaryPath(`${exe}\nsetoption name Hash value 1`, { platform: 'win32' }).why, /line break/)
  assert.match(checkBinaryPath(`${exe}\u0000`, { platform: 'win32' }).why, /null byte/)
  assert.match(checkBinaryPath('', { platform: 'win32' }).why, /no engine path/)
  assert.match(checkBinaryPath(42, { platform: 'win32' }).why, /no engine path/)
  assert.match(checkBinaryPath(join(dir, 'nothing.exe'), { platform: 'win32' }).why, /there is no file/)
  assert.match(checkBinaryPath(dir, { platform: 'linux' }).why, /not a file/)
  // On Windows a path that is not a program is refused before it is handed to spawn.
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'sub', 'stockfish'), 'x')
  assert.match(checkBinaryPath(join(dir, 'sub', 'stockfish'), { platform: 'win32' }).why, /not a program Windows can run/)
  assert.equal(checkBinaryPath(join(dir, 'sub', 'stockfish'), { platform: 'linux' }).ok, true)
})
