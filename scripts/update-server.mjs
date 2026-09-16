/**
 * A release server for developing against.
 *
 * It serves the same thing the real one will: a manifest saying what the latest version is, and the package itself.
 * It is deliberately not part of Orbis and is never shipped — a production build points at the real endpoint, which
 * is set by the build rather than by anything in the application.
 *
 * Usage:
 *   node scripts/update-server.mjs --package dist/Orbis-Setup-1.1.0.exe --version 1.1.0 [--port 8788]
 *     [--channel stable] [--minimum 0.0.1] [--mandatory] [--notes "What's new"]
 *
 * Then run Orbis with ORBIS_UPDATE_URL=http://127.0.0.1:8788/manifest pointing at it.
 *
 * It supports range requests, so resuming a part-finished download can be exercised, and it can be told to misbehave
 * (--flaky, --corrupt) to see what Orbis does when a release server does not behave.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : args.includes(`--${name}`) ? true : fallback
}

const packagePath = flag('package')
const version = flag('version')
if (!packagePath || !version) {
  console.error('Both --package and --version are needed. See the top of this file.')
  process.exit(1)
}

const port = Number(flag('port', 8788))
const channel = String(flag('channel', 'stable'))
const minimum = String(flag('minimum', '0.0.1'))
const mandatory = flag('mandatory') === true
const notes = String(flag('notes', `Orbis ${version}`))
const flaky = flag('flaky') === true
const corrupt = flag('corrupt') === true

const info = await stat(packagePath).catch(() => null)
if (!info) {
  console.error(`There is no package at ${packagePath}`)
  process.exit(1)
}

// The checksum of what is really being served, worked out once at startup.
const sha256 = await new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  createReadStream(packagePath)
    .on('data', (chunk) => hash.update(chunk))
    .on('end', () => resolve(hash.digest('hex')))
    .on('error', reject)
})

const platformKeys = ['windows-x64', 'windows-arm64']
let served = 0

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname === '/manifest') {
    // What the real server will answer, and nothing about whoever asked.
    const manifest = {
      channel,
      latestVersion: version,
      minimumSupportedVersion: minimum,
      mandatory,
      releaseDate: new Date().toISOString().slice(0, 10),
      releaseNotes: notes,
      components: { browser: version, orion: version, ui: version },
      platforms: Object.fromEntries(
        platformKeys.map((key) => [
          key,
          {
            url: `http://127.0.0.1:${port}/package`,
            sha256: corrupt ? 'f'.repeat(64) : sha256,
            size: info.size
          }
        ])
      )
    }
    console.log(`manifest asked for: channel=${url.searchParams.get('channel')} version=${url.searchParams.get('version')} platform=${url.searchParams.get('platform')}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(manifest, null, 2))
  }

  if (url.pathname === '/package') {
    served++
    if (flaky && served % 2 === 1) {
      console.log(`package request ${served}: pretending to fall over`)
      res.writeHead(503)
      return res.end('busy')
    }
    const range = /bytes=(\d+)-/.exec(String(req.headers.range ?? ''))
    const from = range ? Number(range[1]) : 0
    if (from >= info.size) {
      res.writeHead(416)
      return res.end()
    }
    console.log(`package request ${served}: from ${from} of ${info.size}`)
    res.writeHead(from > 0 ? 206 : 200, {
      'content-type': 'application/octet-stream',
      'content-length': String(info.size - from),
      'accept-ranges': 'bytes',
      'content-disposition': `attachment; filename="${basename(packagePath)}"`,
      ...(from > 0 ? { 'content-range': `bytes ${from}-${info.size - 1}/${info.size}` } : {})
    })
    return createReadStream(packagePath, { start: from }).pipe(res)
  }

  res.writeHead(404)
  res.end('Try /manifest or /package')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Orbis development release server`)
  console.log(`  serving  ${packagePath} (${(info.size / 1_000_000).toFixed(1)} MB)`)
  console.log(`  version  ${version} on the ${channel} channel${mandatory ? ', required' : ''}`)
  console.log(`  sha256   ${corrupt ? 'deliberately wrong, to see the download refused' : sha256}`)
  console.log(`  manifest http://127.0.0.1:${port}/manifest`)
  console.log('')
  console.log(`  Run Orbis with: ORBIS_UPDATE_URL=http://127.0.0.1:${port}/manifest`)
})

