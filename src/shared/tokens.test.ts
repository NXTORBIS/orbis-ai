import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One colour, decided in one place, reaching all three places that draw.
 *
 * orbis-ui/tokens.json is the source. scripts/build-orbis-ui.mjs turns it into three outputs: the CSS the browser's
 * own pages load, the C++ constants Chromium's window frame is painted with, and the CSS the Orbis window loads.
 * The window's copy is new -- it used to hand-write its own palette with different names for the same colours, so a
 * colour had to be changed twice and the two slowly drifted apart. The whole point of the change was to make that
 * impossible, which is only true while something checks it.
 *
 * So this file checks the three outputs against the source and against each other, and it checks the thing that
 * actually breaks the window: a name used with var() that nothing defines. CSS does not complain about that. It
 * draws nothing at all -- a transparent background, a border that is not there -- and it looks like a design choice.
 *
 * The one allowance is a short list of names the window's own code sets on the element at run time, and takes off
 * again when the setting is at its default. Those are genuinely absent most of the time, so every var() that reads
 * one has to carry a fallback, and that is what is checked instead.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const tokens = JSON.parse(read('orbis-ui/tokens.json')) as {
  font: Record<string, string>
  scale: Record<string, Record<string, string>>
  dark: Record<string, string>
  light: Record<string, string>
}
const browserCss = read('orbis-ui/orbis-tokens.css')
const windowCss = read('src/renderer/src/styles/tokens.generated.css')
const header = read('orbis-ui/generated/orbis_tokens.h')
/*
 * The window's stylesheet, which is 38 parts now rather than one file. Read as one: splitting it changed no rule
 * and no order, so every check below asks exactly what it asked before.
 */
const styles = (() => {
  const dir = join(ROOT, 'src/renderer/src/styles/parts')
  return readdirSync(dir)
    .filter((one) => one.endsWith('.css'))
    .sort()
    .map((one) => readFileSync(join(dir, one), 'utf8'))
    .join('\n')
})()

/** Every `--name: value;` a stylesheet declares, last one wins, as the cascade would see it. */
function declared(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) out.set(m[1], m[2].trim())
  return out
}

/** Every `var(--name` a stylesheet reads, and whether that read carries a fallback after the comma. */
function readsOf(css: string): Map<string, { withFallback: number; bare: number }> {
  const out = new Map<string, { withFallback: number; bare: number }>()
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
    const seen = out.get(m[1]) ?? { withFallback: 0, bare: 0 }
    if (m[2] === ',') seen.withFallback++
    else seen.bare++
    out.set(m[1], seen)
  }
  return out
}

/**
 * Set on the element by the window's own code, not by a stylesheet: the size of everything, the rounding of corners
 * and the strength of the blur (lib/experience.ts), the market strip's measured height and the room it reserves
 * (MarketStrip.tsx), and the background a look brings with it (shared/presets.ts). Each is taken off again when its
 * setting is at the default, so the name is genuinely absent most of the time and every read of it has to carry a
 * fallback -- which is what is checked.
 *
 * --thread-width is the same shape of thing for a different reason: it was never a token, and the fallback in the
 * one place that reads it is its only value.
 */
const SET_AT_RUNTIME = new Set([
  '--ui-scale',
  '--corner-radius',
  '--blur-scale',
  '--backdrop-cycle',
  '--mstrip-reserved',
  '--mstrip-height',
  '--preset-background',
  '--thread-width'
])

/**
 * Read bare, but only inside a rule that selects on the element carrying it: `.mk-logo-fallback[style*="--mk-logo-hue"]`
 * cannot match an element that does not have the colour set on it, so there is nothing for a fallback to catch.
 */
const SET_ON_THE_ELEMENT = new Set([
  '--mk-logo-hue',
  /*
   * An account's picture, from `shared/avatars.ts`.
   *
   * These are not theme colours and must not be: every orb on the setup screen carries its own four, set inline on
   * the element, which is what lets one set of rules draw all twelve. A `:root` definition would be a thirteenth
   * colour that nothing ever shows, and would hide the real mistake -- an orb rendered with no style at all -- by
   * quietly painting it in whatever that default happened to be.
   */
  '--av-from',
  '--av-to',
  '--av-with',
  '--av-sky',
  '--av-rim',
  '--av-turn'
])

test('the window has a definition for every token name it reads', () => {
  const defined = new Set([...declared(windowCss).keys(), ...declared(styles).keys()])
  const missing: string[] = []
  for (const [name, use] of readsOf(styles)) {
    if (defined.has(name)) continue
    if (SET_ON_THE_ELEMENT.has(name)) continue
    if (SET_AT_RUNTIME.has(name)) {
      assert.equal(use.bare, 0, `${name} is not always there, so every var() that reads it needs a fallback`)
      continue
    }
    missing.push(name)
  }
  assert.deepEqual(missing, [], 'these draw nothing at all: nothing defines them')
})

test('every name the old hand-written palette defined still resolves', () => {
  // The names the window's stylesheet was written against, before the palette moved into tokens.json. Miss one and
  // every rule using it silently draws nothing, which is why the list is written out rather than derived.
  const LEGACY = [
    '--font', '--display', '--mono',
    '--bg-center', '--bg-mid', '--bg-edge', '--grid', '--line-strong', '--line', '--bar-bg', '--rail-bg',
    '--text', '--muted', '--muted-strong', '--faint',
    '--cyan', '--cyan-dim', '--cyan-fill', '--cyan-glow', '--cyan-glow-soft',
    '--green', '--amber', '--red', '--danger', '--danger-bg', '--danger-border',
    '--glass', '--glass-border', '--glass-shadow', '--hover', '--hover-strong', '--active',
    '--pill-bg', '--pill-bg-strong', '--pill-border',
    '--avatar-bg', '--avatar-border', '--user-bubble', '--user-bubble-border',
    '--composer-bg', '--composer-border', '--composer-glow', '--composer-glow-strong',
    '--composer-text', '--composer-placeholder', '--composer-icon', '--beam-dim', '--beam-hot',
    '--input-bg', '--input-border', '--table-head', '--table-border', '--code-inline-bg',
    '--greeting', '--particle-opacity', '--scrollbar', '--option-bg', '--popover-bg'
  ]
  const defined = declared(windowCss)
  const unresolved: string[] = []
  for (const name of LEGACY) {
    const value = defined.get(name)
    if (!value) { unresolved.push(name); continue }
    // An alias is only worth anything if what it points at exists.
    const pointsAt = /^var\(\s*(--[a-z0-9-]+)/.exec(value)
    if (pointsAt && !defined.has(pointsAt[1])) unresolved.push(`${name} -> ${pointsAt[1]}`)
  }
  assert.deepEqual(unresolved, [])
})

/** The declarations of one block, from its selector to the first close brace after it. */
function blockOf(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector)
  assert.ok(start >= 0, `no ${selector} block`)
  const open = css.indexOf('{', start)
  return declared(css.slice(open, css.indexOf('}', open)))
}

test('the window and the browser are given the same values', () => {
  const windowDark = blockOf(windowCss, ':root {')
  const browserDark = blockOf(browserCss, ':root {')
  for (const [name, value] of Object.entries(tokens.dark)) {
    assert.equal(windowDark.get(`--${name}`), value, `dark --${name} in the window`)
    assert.equal(browserDark.get(`--${name}`), value, `dark --${name} in the browser`)
  }
  for (const [name, value] of Object.entries(tokens.light)) {
    for (const where of ['@media (prefers-color-scheme: light)', ":root[data-theme='light']"]) {
      assert.equal(blockOf(windowCss, where).get(`--${name}`), value, `light --${name} in the window, ${where}`)
      assert.equal(blockOf(browserCss, where).get(`--${name}`), value, `light --${name} in the browser, ${where}`)
    }
  }
  for (const [name, value] of Object.entries(tokens.dark)) {
    assert.equal(blockOf(windowCss, ":root[data-theme='dark']").get(`--${name}`), value, `forced dark --${name}`)
  }
  for (const [group, entries] of Object.entries({ font: tokens.font, ...tokens.scale })) {
    for (const [key, value] of Object.entries(entries)) {
      assert.equal(windowDark.get(`--${group}-${key}`), value, `--${group}-${key} in the window`)
    }
  }
})

test('the window follows the system scheme and both forced themes', () => {
  for (const selector of [
    ':root {',
    "@media (prefers-color-scheme: light) { :root:not([data-theme='dark'])",
    ":root[data-theme='light']",
    ":root[data-theme='dark']"
  ]) {
    assert.ok(windowCss.includes(selector), `missing the ${selector} case`)
  }
})

test('the C++ window frame is painted with the same colours', () => {
  // The header holds colours as 0xAARRGGBB. Anything that is not a colour -- a gradient, a shadow, an opacity --
  // has no constant, which is why only the entries that parse as a colour are compared.
  const argb = (s: string): string | null => {
    const hexPair = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
    let m = /^#([0-9a-f]{6})$/i.exec(s.trim())
    if (m) return '0xFF' + m[1].toUpperCase()
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s.trim())
    if (!m) return null
    const alpha = m[4] === undefined ? 1 : Number(m[4])
    return '0x' + hexPair(Math.round(alpha * 255)) + hexPair(+m[1]) + hexPair(+m[2]) + hexPair(+m[3])
  }
  const camel = (k: string) => 'k' + k.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  for (const scheme of ['dark', 'light'] as const) {
    const start = header.indexOf(`namespace ${scheme} {`)
    const block = header.slice(start, header.indexOf('}  // namespace', start))
    assert.ok(start > 0, `no ${scheme} colours in the header`)
    for (const [name, value] of Object.entries(tokens[scheme])) {
      const expected = argb(value)
      if (!expected) continue
      assert.ok(
        block.includes(`constexpr uint32_t ${camel(name)} = ${expected};`),
        `${scheme} ${name}: the header does not have ${expected}`
      )
    }
  }
  assert.ok(header.includes(`constexpr int kRadiusPill = 999;`))
})

test('nothing is left behind in the stylesheet that the tokens now decide', () => {
  // The whole saving of this change is that the palette exists once. If a :root palette block ever grows back at the
  // top of styles.css, the two will drift again exactly as they did before, and nobody will see it happen.
  assert.ok(!/^:root\s*\{/m.test(styles), 'styles.css has a :root block again')
  assert.ok(!styles.includes("@media (prefers-color-scheme: light) {\n  :root"), 'styles.css redeclares the light scheme')
})
