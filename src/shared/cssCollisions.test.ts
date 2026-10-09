import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Two stylesheets must not claim the same class name.
 *
 * ## What this caught
 *
 * Settings and Student both used the prefix `st-` — one for *settings*, one for *student* — and both defined
 * `.st-nav`. The global stylesheet loads after the feature's own, so Settings' 200px vertical sidebar won, and
 * Orbis Student's row of tabs came out as a full-width stack of ten rows. Nothing failed, nothing logged, and the
 * CSS of both features was correct in isolation.
 *
 * That is the shape of every bug this test exists for: a stylesheet is a single global namespace, a duplicate name
 * is silent, and which copy wins depends on load order rather than on anything anybody wrote down.
 *
 * ## The rule
 *
 * A class defined in a co-located feature stylesheet (a `.css` file beside its components) must not also be
 * defined in the renderer's global `styles.css`, and no two feature stylesheets may share one either. Shared
 * primitives belong in the global sheet alone, which is why names only *used* by a feature are fine — this is about
 * who **defines** a rule for it.
 */

const REPO = resolve(import.meta.dirname, '../..')
const GLOBAL = join(REPO, 'src/renderer/src/styles.css')

/**
 * Class names a stylesheet claims **on their own**.
 *
 * A modifier written as `.st-btn.primary` is not a claim on `.primary`: the element has to carry the feature's own
 * class as well, so two features can both have a "primary" modifier without ever touching each other. What is
 * dangerous is a rule whose compound selector is one bare class and nothing else -- `.st-nav { ... }` -- because
 * that lands on every element anywhere with that class.
 */
function claimed(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Set<string>()
  for (const match of withoutComments.matchAll(/(^|\})([^{}@]+)\{/g)) {
    for (const selector of match[2].split(',')) {
      /*
       * Only the first compound, and only when it is one bare class.
       *
       * That is the shape that reaches another feature's screen: `.st-nav` lands on every element anywhere wearing
       * that class. Everything else is already scoped by something -- `.st-btn.primary` needs the feature's own
       * class on the element, `.create-grid .num` only reaches things inside that grid, and
       * `html[data-corners] .og-card` is the theme deliberately reaching in from outside.
       */
      const first = selector.trim().split(/[\s>+~]+/)[0] ?? ''
      const classes = [...first.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((one) => one[1])
      if (classes.length !== 1) continue
      const rest = first.replace(/\.[a-zA-Z][\w-]*/, '').replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
      if (rest.trim() === '') out.add(classes[0])
    }
  }
  return out
}

async function featureStylesheets(): Promise<{ path: string; css: string }[]> {
  const root = join(REPO, 'src/renderer/src')
  const found: { path: string; css: string }[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.name.endsWith('.css') || full === GLOBAL) continue
      found.push({ path: full.slice(REPO.length + 1).replace(/\\/g, '/'), css: await readFile(full, 'utf8') })
    }
  }
  await walk(root)
  return found
}

test('no feature stylesheet defines a class the global stylesheet also defines', async () => {
  const globalNames = claimed(await readFile(GLOBAL, 'utf8'))
  for (const sheet of await featureStylesheets()) {
    const shared = [...claimed(sheet.css)].filter((one) => globalNames.has(one)).sort()
    assert.deepEqual(
      shared,
      [],
      `${sheet.path} and src/renderer/src/styles.css both define ${shared.map((one) => `.${one}`).join(', ')}. ` +
        'Whichever loads last silently wins, which is how Student\'s row of tabs became a full-width stack. Rename one side.'
    )
  }
})

test('no two feature stylesheets define the same class', async () => {
  const sheets = await featureStylesheets()
  const owner = new Map<string, string>()
  for (const sheet of sheets) {
    for (const name of claimed(sheet.css)) {
      const already = owner.get(name)
      assert.ok(!already, `${sheet.path} and ${already} both define .${name}. Load order decides which one a screen gets.`)
      owner.set(name, sheet.path)
    }
  }
})
