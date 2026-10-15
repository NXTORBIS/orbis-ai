// Makes the simulation in cosmos/ present itself as ORBIS COSMOS, everywhere a person can see it.
//
//   node scripts/cosmos-rebrand.mjs
//
// Idempotent: running it again changes nothing. It edits the vendored Gaia Sky tree in place, so every file it touches
// is listed in cosmos/ORBIS-MODIFICATIONS.md (the Mozilla Public License asks that changes to its files be stated).
//
// What it does NOT change, on purpose:
//   - the licence headers at the top of source files, LICENSE.md, AUTHORS.md, CONTRIBUTORS.md, ACKNOWLEDGEMENTS.md:
//     the licence requires them to stay. They are not shown by the simulation; Orbis shows them under
//     Settings -> Third-party notices.
//   - the word "Gaia" where it names the ESA mission's data (the Gaia archive, Gaia star catalogues, attitude): that
//     is what the data is called, not the program.
//   - internal identifiers and folder names (package names, the ".gaiasky" folder inside Orbis's own private home).

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cosmos = join(root, 'cosmos')
const NAME = 'ORBIS COSMOS'
const changed = new Set()

const read = (p) => readFileSync(p, 'utf8')
function write(p, text) {
  const was = existsSync(p) ? read(p) : null
  if (was === text) return
  writeFileSync(p, text)
  changed.add(relative(cosmos, p).replace(/\\/g, '/'))
}
function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p, ext) : ext.some((x) => p.endsWith(x)) ? [p] : []
  })
}

// ---- 1. words in the program's own text (Java string literals) -----------------------------------------------------------------
// Only inside string literals on lines that are not comments; comments and licence headers stay as they are.
for (const file of walk(join(cosmos, 'core', 'src'), ['.java'])) {
  const src = read(file)
  if (!/Gaia ?Sky|GaiaSky\//.test(src)) continue
  const out = src
    .split('\n')
    .map((line) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return line
      return line.replace(/"(?:[^"\\]|\\.)*"/g, (lit) => lit.replace(/Gaia Sky/g, NAME).replace(/"GaiaSky\//, '"OrbisCosmos/'))
    })
    .join('\n')
  write(file, out)
}

// ---- 2. constants that name the program, its websites and its people ---------------------------------------------------------------
{
  const f = join(cosmos, 'core', 'src', 'gaiasky', 'util', 'Settings.java')
  let s = read(f)
  const set = (name, value) => {
    s = s.replace(new RegExp(`(public static final String ${name} = )"[^"]*";`), `$1"${value}";`)
  }
  // Addresses must stay well-formed (the program hands them to the SAMP protocol), so they point at a reserved,
  // never-resolving name rather than at the original project.
  for (const n of ['HOMEPAGE', 'HOMEPAGE_DOWNLOADS', 'DOCUMENTATION', 'SOCIAL_MEDIA_MASTO_URL', 'SOCIAL_MEDIA_BSKY_URL', 'AUTHOR_WEBSITE_FULL']) set(n, 'https://orbis.invalid/cosmos')
  for (const n of ['SOCIAL_MEDIA_MASTO_NAME', 'SOCIAL_MEDIA_BSKY_NAME', 'AUTHOR_NAME', 'AUTHOR_NAME_PLAIN', 'AUTHOR_WEBSITE_TEXT']) set(n, NAME)
  set('AUTHOR_EMAIL', 'cosmos@orbis.invalid')
  set('AUTHOR_AFFILIATION', NAME)
  set('AUTHOR_AFFILIATION_PLAIN', NAME)
  s = s.replace('public static final String REPOSITORY = "https://codeberg.org/gaiasky/gaiasky";', 'public static final String REPOSITORY = "https://orbis.invalid/cosmos";')
  s = s.replace('public static String APPLICATION_NAME_TITLE = "G a i a  S k y";', 'public static String APPLICATION_NAME_TITLE = "O R B I S   C O S M O S";')
  write(f, s)
}

// ---- 3. no update checks against the original project ------------------------------------------------------------------------------
{
  const f = join(cosmos, 'core', 'src', 'gaiasky', 'util', 'update', 'VersionChecker.java')
  let s = read(f)
  if (!s.includes('ORBIS COSMOS: no update check')) {
    s = s.replace(/public void run\(\) \{/, 'public void run() {\n        // ORBIS COSMOS: no update check. It is updated with Orbis, never by looking at another project\'s releases.\n        if (true) return;')
  }
  write(f, s)
}

// ---- 4. the About window: only what ORBIS COSMOS is ----------------------------------------------------------------------------------
{
  const f = join(cosmos, 'core', 'src', 'gaiasky', 'gui', 'window', 'AboutWindow.java')
  let s = read(f)
  s = s.replace('boolean showUpdateTab = !SysUtils.launchedViaInstall4j();', 'boolean showUpdateTab = false;')
  const drop = ['homepageTitle', 'homepageLink', 'docsTitle', 'docsLink', 'repoTitle', 'repoLink']
  s = s.replace(new RegExp(`^\\s*contentHelp\\.add\\((${drop.join('|')})\\).*$\\n`, 'gm'), '')
  const dropAbout = ['homePageTitle', 'homepage', 'devNewsTitle', 'sm', 'authorTitle', 'author', 'contribTitle', 'contribScroll', 'licenseTable', 'thanksSc']
  s = s.replace(new RegExp(`^\\s*contentAbout\\.add\\((${dropAbout.join('|')})\\).*$\\n`, 'gm'), '')
  write(f, s)
}

// ---- 4b. a filter every shown text passes through (see cosmos-rebrand-filter.mjs) ---------------------------------------------------------
{
  const { applyFilter } = await import('./cosmos-rebrand-filter.mjs')
  applyFilter({ cosmos, read, write, join })
}

// ---- 5. the translated texts ---------------------------------------------------------------------------------------------------------
for (const file of walk(join(cosmos, 'assets', 'i18n'), ['.properties'])) {
  let s = read(file)
  s = s.replace(/Gaia ?Sky/g, NAME)
  // The credits line names the institutes behind the original program; this program's own line replaces it.
  s = s.replace(/^gui\.help\.gscredits=.*$/m, `gui.help.gscredits=${NAME} ({0}) is the real-time 3D universe of Orbis.`)
  // Links to the original project's pages and bug tracker, and its command-line name in the tips.
  s = s.replace(/\s*\|\s*%%link-big \S+/g, '')
  s = s.replace(/%%mono-big gaiasky/g, '%%mono-big cosmos')
  s = s.replace(/\bhttps?:\/\/(?:www\.)?(?:gaiasky\.space|docs\.gaiasky\.space|codeberg\.org\/gaiasky\S*)/g, '')
  write(file, s)
}

// ---- 6. pictures -------------------------------------------------------------------------------------------------------------------------
const LOGO = join('C:', 'Users', 'ksran', 'Downloads', 'Orbis Logos', 'Full Orbis Logo with text.png')
const logoPath = process.env.ORBIS_LOGO || LOGO
if (!existsSync(logoPath)) {
  console.error(`[rebrand] the Orbis logo was not found at ${logoPath}; set ORBIS_LOGO to its path. Text changes were applied.`)
} else {
  const full = await loadImage(logoPath)
  // The ring that is the "O" of the wordmark, cut out square (coordinates of the 2000 px master).
  const RING = { x: 148, y: 622, w: 368, h: 452 }
  // Drawn additively, so the logo's black background adds nothing and only the ring itself lands on the picture.
  const ringOn = (ctx, cx, cy, size) => {
    const w = (size * RING.w) / RING.h
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(full, RING.x, RING.y, RING.w, RING.h, cx - w / 2, cy - size / 2, w, size)
    ctx.restore()
  }
  const iconBase = join(cosmos, 'assets', 'icon')
  const make = (w, h, draw, file, type = 'image/png', quality) => {
    const c = createCanvas(w, h)
    draw(c.getContext('2d'), w, h)
    const buf = type === 'image/jpeg' ? c.toBuffer('image/jpeg', quality ?? 90) : c.toBuffer('image/png')
    const prev = existsSync(file) ? readFileSync(file) : null
    if (!prev || !prev.equals(buf)) {
      writeFileSync(file, buf)
      changed.add(relative(cosmos, file).replace(/\\/g, '/'))
    }
    return buf
  }
  const space = (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
    g.addColorStop(0, '#0b1636')
    g.addColorStop(0.6, '#050a1c')
    g.addColorStop(1, '#02040c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  // A fixed seed, so running this again gives the same stars.
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const stars = (ctx, w, h, n) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(220,235,255,${0.2 + rnd() * 0.6})`
      const r = 0.4 + rnd() * 1.3
      ctx.fillRect(rnd() * w, rnd() * h, r, r)
    }
  }
  const square = (size) => (ctx, w, h) => {
    space(ctx, w, h)
    ringOn(ctx, w / 2, h / 2, size * 0.8)
  }
  const round = (size) => (ctx, w, h) => {
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2)
    ctx.clip()
    space(ctx, w, h)
    ringOn(ctx, w / 2, h / 2, size * 0.78)
  }
  for (const [file, size] of [['gs_icon_64.png', 64], ['gs_icon_128.png', 128], ['gs_icon_256.png', 256], ['gs_macos_256.png', 256], ['gs_macos_512.png', 512]]) {
    make(size, size, square(size), join(iconBase, file))
  }
  for (const [file, size] of [['gs_round_128.png', 128], ['gs_round_256.png', 256], ['gsvr_round_128.png', 128], ['gsvr_round_256.png', 256]]) {
    make(size, size, round(size), join(iconBase, file))
  }
  // Windows icons: a PNG inside an ICO container.
  const ico = (png) => {
    const head = Buffer.alloc(22)
    head.writeUInt16LE(0, 0)
    head.writeUInt16LE(1, 2)
    head.writeUInt16LE(1, 4)
    head[6] = 0
    head[7] = 0
    head.writeUInt16LE(1, 10)
    head.writeUInt16LE(32, 12)
    head.writeUInt32LE(png.length, 14)
    head.writeUInt32LE(22, 18)
    return Buffer.concat([head, png])
  }
  const png256 = readFileSync(join(iconBase, 'gs_icon_256.png'))
  for (const f of ['gs_icon.ico', 'gsvr_icon.ico']) {
    const target = join(iconBase, f)
    const buf = ico(png256)
    if (!existsSync(target) || !readFileSync(target).equals(buf)) {
      writeFileSync(target, buf)
      changed.add(relative(cosmos, target).replace(/\\/g, '/'))
    }
  }

  // The splash: the start-up background and the welcome screen's background.
  const splash = join(cosmos, 'assets', 'img', 'splash', 'splash.jpg')
  const sp = await loadImage(splash).catch(() => null)
  const W = sp?.width ?? 2200
  const H = sp?.height ?? 1220
  make(
    W,
    H,
    (ctx, w, h) => {
      space(ctx, w, h)
      stars(ctx, w, h, 1400)
      ctx.globalCompositeOperation = 'lighter'
      const glow = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, h * 0.5)
      glow.addColorStop(0, 'rgba(70,140,255,.20)')
      glow.addColorStop(1, 'rgba(70,140,255,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ringOn(ctx, w / 2, h * 0.42, h * 0.3)
      ctx.fillStyle = '#eaf6ff'
      ctx.textAlign = 'center'
      ctx.font = `bold ${Math.round(h * 0.075)}px sans-serif`
      ctx.letterSpacing = `${Math.round(h * 0.02)}px`
      ctx.fillText(NAME, w / 2, h * 0.72)
    },
    splash,
    'image/jpeg',
    92
  )

  // The pictures of other parties on the About and crash screens.
  for (const f of ['crash.png', 'zah.png', 'dlr.png', 'dpac.png']) {
    make(120, 120, round(120), join(cosmos, 'assets', 'img', f))
  }
  make(287, 149, (ctx, w, h) => {
    space(ctx, w, h)
    ringOn(ctx, w / 2, h / 2, h * 0.8)
  }, join(cosmos, 'assets', 'img', 'bmftr.png'))
  make(190, 400, (ctx, w, h) => {
    space(ctx, w, h)
    stars(ctx, w, h, 80)
    ringOn(ctx, w / 2, h * 0.4, w * 0.7)
  }, join(cosmos, 'assets', 'img', 'installer-img.jpg'), 'image/jpeg', 90)
}

// ---- 7. text art and vector art ---------------------------------------------------------------------------------------------------
write(join(cosmos, 'assets', 'icon', 'gsascii.txt'), `${NAME}\n`)
const svg = (label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#050a1c"/><circle cx="256" cy="256" r="150" fill="none" stroke="#38e8ff" stroke-width="22"/><text x="256" y="470" fill="#eaf6ff" font-family="sans-serif" font-size="40" text-anchor="middle" letter-spacing="8">${label}</text></svg>\n`
for (const f of ['gs_icon.svg', 'gs_icon_macos.svg', 'gsvr_icon.svg', 'gs_titlecard.svg', 'gaia.svg']) {
  const p = join(cosmos, 'assets', 'icon', f)
  if (existsSync(p)) write(p, svg('ORBIS COSMOS'))
}

// ---- 8. the record of what was changed ---------------------------------------------------------------------------------------------------
const recordPath = join(cosmos, 'ORBIS-MODIFICATIONS.md')
const prior = existsSync(recordPath) ? new Set((read(recordPath).match(/^- `(.+)`$/gm) ?? []).map((l) => l.slice(3, -1))) : new Set()
for (const c of changed) prior.add(c)
write(
  recordPath,
  `# Changes made to Gaia Sky inside ORBIS COSMOS

The simulation in this folder is Gaia Sky ${JSON.parse(read(join(cosmos, 'upstream.json'))).tag}, released under the Mozilla Public License 2.0
(see LICENSE.md). Orbis presents it as ORBIS COSMOS, so these files were changed from the original by
\`scripts/cosmos-rebrand.mjs\`: its name, links, pictures and update check. Licence headers, LICENSE.md, AUTHORS.md,
CONTRIBUTORS.md and ACKNOWLEDGEMENTS.md are kept as they were. The original source is at
https://codeberg.org/gaiasky/gaiasky (tag ${JSON.parse(read(join(cosmos, 'upstream.json'))).tag}).

Files changed:

${[...prior].sort().map((f) => `- \`${f}\``).join('\n')}
`
)
console.log(`[rebrand] ${changed.size} files changed this run (${prior.size} recorded in all)`)
