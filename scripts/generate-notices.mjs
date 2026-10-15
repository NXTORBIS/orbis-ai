/**
 * Collects the licence of every package that ends up inside Orbis, with its full text, into
 * resources/notices.json — which the app shows under Settings → Third-party notices.
 *
 * Most of these licences (MIT, BSD, ISC, Apache) require their copyright notice and licence text to travel with any
 * copy of the software, so this file is not paperwork: shipping without it would breach them. It is generated rather
 * than written by hand so it cannot drift from what is actually installed.
 *
 * Run: node scripts/generate-notices.mjs
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LICENCE_FILES = ['LICENSE', 'LICENCE', 'LICENSE.md', 'LICENCE.md', 'LICENSE.txt', 'LICENSE-MIT', 'COPYING', 'NOTICE']

/** Every package in the tree, including nested ones, since a bundle can pull in any of them. */
function* packages(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    if (entry.name.startsWith('@')) {
      yield* packages(full, depth)
      continue
    }
    if (entry.name === 'node_modules') {
      yield* packages(full, depth + 1)
      continue
    }
    if (existsSync(join(full, 'package.json'))) yield full
    const nested = join(full, 'node_modules')
    if (existsSync(nested)) yield* packages(nested, depth + 1)
  }
}

const readLicence = (dir) => {
  for (const name of LICENCE_FILES) {
    const file = join(dir, name)
    try {
      if (statSync(file).isFile()) return readFileSync(file, 'utf8').trim().slice(0, 40_000)
    } catch {
      // Not there; try the next name.
    }
  }
  return ''
}

const licenceName = (pkg) =>
  typeof pkg.license === 'string'
    ? pkg.license
    : pkg.license?.type || (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) || 'See the text below'

const found = new Map()
for (const dir of packages(join(root, 'node_modules'))) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  if (!pkg.name || !pkg.version) continue
  const key = `${pkg.name}@${pkg.version}`
  if (found.has(key)) continue
  found.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: licenceName(pkg),
    homepage: typeof pkg.homepage === 'string' ? pkg.homepage.slice(0, 200) : '',
    text: readLicence(dir)
  })
}

const packagesOut = [...found.values()].sort((a, b) => a.name.localeCompare(b.name))

/**
 * Things Orbis uses that are not npm packages. Their terms apply just as much, and a generated list of packages would
 * quietly leave them out.
 */
const others = [
  {
    name: 'Electron and Chromium',
    version: JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version,
    license: 'MIT (Electron), BSD-3-Clause and others (Chromium)',
    homepage: 'https://www.electronjs.org',
    text: 'Orbis is built on castLabs\' Electron for Content Security, which is Electron with support for protected media. The full licences ship beside Orbis as LICENSE.electron.txt and LICENSES.chromium.html.'
  },
  {
    name: 'Widevine Content Decryption Module',
    version: 'installed and updated by Google',
    license: 'Proprietary — Google',
    homepage: 'https://www.widevine.com',
    text: 'Protected media (Spotify, Netflix and the like) is decrypted by Google\'s Widevine module. It is not part of Orbis and is not distributed with it: it is fetched and kept up to date on your own computer, and is governed by Google\'s terms.'
  },
  {
    name: 'Filter lists (EasyList, EasyPrivacy, uBlock Origin, Peter Lowe\'s list)',
    version: 'downloaded and updated at runtime',
    license: 'GPL-3.0 / CC BY-SA 3.0 — see each list',
    homepage: 'https://github.com/ghostery/adblocker',
    text: 'Orbis blocks ads and trackers using filter lists written and maintained by other people. They are not shipped with Orbis: they are downloaded on first run and updated daily, and each carries its own licence in its header. Orbis\'s own compatibility rules are its own.'
  },
  {
    name: 'H.264, AAC and HEVC media codecs',
    version: 'built into the browser',
    license: 'Patent-licensed formats',
    homepage: 'https://www.via-la.com',
    text: 'The Orbis browser includes decoders for the H.264 (AVC), AAC and HEVC (H.265) formats so that ordinary web video and audio play. These formats are covered by patents that are licensed separately, for example through patent pools such as Via LA and Access Advance. Those patent licences are the responsibility of whoever distributes the browser; the open-source licence of the code does not grant them.'
  },
  {
    name: 'Real-ESRGAN (realesr-general-x4v3 model)',
    version: 'v0.2.5.0, converted to ONNX',
    license: 'BSD-3-Clause',
    homepage: 'https://github.com/xinntao/Real-ESRGAN',
    text: "Generated images are sharpened on your computer with the Real-ESRGAN model, shipped with Orbis.\n\nBSD 3-Clause License\n\nCopyright (c) 2021, Xintao Wang\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this\n   list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice,\n   this list of conditions and the following disclaimer in the documentation\n   and/or other materials provided with the distribution.\n\n3. Neither the name of the copyright holder nor the names of its\n   contributors may be used to endorse or promote products derived from\n   this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE\nFOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\nDAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\nSERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\nCAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\nOR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."
  }
]

/**
 * ORBIS COSMOS: Gaia Sky is MPL-2.0, a file-level copyleft: its source (cosmos/) travels with Orbis and stays under
 * that licence, with its licence, authors and acknowledgements kept beside it. The libraries it runs on are listed
 * from the build's own record; each carries its licence inside its jar.
 */
const cosmosText = (name) => {
  try {
    return readFileSync(join(root, 'cosmos', name), 'utf8').trim()
  } catch {
    return ''
  }
}
if (existsSync(join(root, 'cosmos', 'LICENSE.md'))) {
  const up = JSON.parse(cosmosText('upstream.json') || '{}')
  others.push({
    name: 'Gaia Sky (ORBIS COSMOS)',
    version: up.tag || '',
    license: 'MPL-2.0',
    homepage: 'https://codeberg.org/gaiasky/gaiasky',
    text:
      'ORBIS COSMOS is the Gaia Sky simulation, by the Gaia Sky authors (developed at the Astronomisches Rechen-Institut, Heidelberg University, and by contributors), included in the cosmos folder of Orbis together with its source code. It is distributed under the Mozilla Public License 2.0; its source is available in that folder and at the address above.\n\n' +
      cosmosText('LICENSE.md') +
      '\n\n--- AUTHORS ---\n' +
      cosmosText('AUTHORS.md') +
      '\n\n--- ACKNOWLEDGEMENTS ---\n' +
      cosmosText('ACKNOWLEDGEMENTS.md')
  })
  let libs = []
  try {
    libs = JSON.parse(readFileSync(join(root, 'cosmos', '.build', 'build.json'), 'utf8')).libraries.map((l) => l.file)
  } catch {
    // not built on this computer: nothing to list
  }
  others.push({
    name: 'Libraries ORBIS COSMOS runs on',
    version: up.tag || '',
    license: 'Apache-2.0, BSD-3-Clause, MIT, EPL and others: see each library',
    homepage: 'https://codeberg.org/gaiasky/gaiasky',
    text:
      'Fetched from Maven Central by npm run cosmos:build, each checked against its published SHA-1, and used to run ORBIS COSMOS. Each library carries its own licence and notices inside its jar.' +
      (libs.length ? '\n\n' + libs.join('\n') : '')
  })
}

/** Where F1 (Orbis Arena) gets its data. Both are free to use without an account or key. */
others.push(
  {
    name: 'Jolpica-F1 (F1 calendar, results and standings)',
    version: 'live service',
    license: 'Data service; see the project for its terms',
    homepage: 'https://github.com/jolpica/jolpica-f1',
    text: 'The calendar, race results and championship standings shown in F1 come from the Jolpica-F1 API (an Ergast-compatible service), fetched from api.jolpi.ca when you open F1. Orbis keeps recent answers in memory only and shows where each came from.'
  },
  {
    name: 'OpenF1 (F1 sessions, drivers and lap timing)',
    version: 'live service',
    license: 'Data service; see the project for its terms',
    homepage: 'https://openf1.org',
    text: 'Session lists, drivers, lap times, sector times, car telemetry, tyre stints, pit stops, weather and race-control messages shown in F1 come from the OpenF1 API (api.openf1.org), used without an account for finished sessions. Orbis does not use its paid live-streaming plan.'
  },
  {
    name: 'Formula 1 live-timing stream and archive (F1 live timing and replay)',
    version: 'live service',
    license: 'Unofficial public data service; no licence is granted by this notice',
    homepage: 'https://livetiming.formula1.com',
    text: 'F1 live timing and session replay read the public live-timing stream and static archive at livetiming.formula1.com, the same feeds used by the sport\'s own pages and by the FastF1 project. It is an unofficial interface that can change or stop without notice; Orbis stores none of it. FORMULA 1 and related marks are trade marks of Formula One Licensing B.V.; Orbis is not affiliated with or endorsed by them.'
  }
)

const out = {
  generatedAt: new Date().toISOString(),
  orbis: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  others,
  packages: packagesOut
}

const file = join(root, 'resources', 'notices.json')
writeFileSync(file, JSON.stringify(out))
const withText = packagesOut.filter((p) => p.text).length
console.log(`${packagesOut.length} packages (${withText} with licence text) + ${others.length} others -> ${file}`)
const missing = packagesOut.filter((p) => !p.text && p.license === 'See the text below')
if (missing.length) console.log(`no licence found for: ${missing.map((p) => p.name).join(', ')}`)
