import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

/**
 * A screen must not decide its layout from the width of the window.
 *
 * Orbis's screens sit beside a 264px sidebar, and a Native App sits inside a card inside a conversation, narrower
 * still. So `@media (max-width: 860px)` is never asking about the thing that is running out of room. Four screens
 * were measured against the window and three of them were visibly broken by it:
 *
 *   - Create kept two columns needing 642px in a 616px panel, and grew a sideways scrollbar;
 *   - Pages had its stacking rule written *above* the rule it was meant to override, so it never applied in any
 *     window at all, and the subject list scrolled sideways by 2,088px;
 *   - Markets' tab strip was 44px too wide, and because `overflow-y: auto` makes overflow-x `auto` too, the whole
 *     screen scrolled sideways rather than the strip saying anything.
 *
 * Create and Pages ask a container query on their own root now. The rest of the window media queries are not
 * necessarily wrong -- most were tuned by eye against a sidebar of a fixed width, and they measured clean at
 * 1600, 1280, 1000 and 820 -- so this does not fail them. It is a ceiling.
 *
 * ## How this guard behaves
 *
 * Adding a window media query to a stylesheet fails. Converting one to a container query lowers the count and
 * passes, which is the direction this is meant to move in. The numbers below are allowed to shrink and never to
 * grow, exactly like the `LEGACY` list in `ipcMapping.test.ts`.
 *
 * If you are adding one: ask whether the thing running out of room is the window, or the panel the screen is in.
 * It is almost always the panel, and then the answer is `container-type: inline-size` on the screen's root and a
 * `@container` query — `.create-view`, `.pages-view` and `.mk-rows` are the worked examples.
 */

const ROOT = new URL('../renderer/src/', import.meta.url)

/**
 * The most window media queries each stylesheet may hold.
 *
 * A file not listed here may hold none. These are the counts as they stood when the four broken ones were fixed.
 */
const MOST: Readonly<Record<string, number>> = Object.freeze({
  // The window's global stylesheet is 38 parts; they share one allowance, because which part a rule sits in is an
  // accident of where the section banners fell.
  //
  // 19 -> 16: three went with the stylesheets of four deleted screens, which this guard noticed in the same change
  // that lowered them. That is what it is for -- a ceiling left above what is really there is room for the fault
  // to come back without anybody seeing it.
  'styles/parts': 16,
  'components/student/student.css': 8,
  'components/native/phase2.css': 2,
  'components/native/phase6.css': 2,
  'components/native/phase3.css': 1,
  'components/native/phase4.css': 1,
  'components/native/phase7.css': 1,
  'components/native/native.css': 1,
  'components/courses/courses.css': 1
})

async function* stylesheets(dir: URL, prefix = ''): AsyncGenerator<{ name: string; url: URL }> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) yield* stylesheets(url, `${prefix}${entry.name}/`)
    else if (entry.name.endsWith('.css')) yield { name: `${prefix}${entry.name}`, url }
  }
}

describe('screens measure themselves, not the window', () => {
  test('no stylesheet gains a window media query', async () => {
    const over: string[] = []
    for await (const sheet of stylesheets(ROOT)) {
      const source = await readFile(sheet.url, 'utf8')
      const found = [...source.matchAll(/@media\s*\([^)]*\bmax-width\b/g)].length
      const bucket = sheet.name.startsWith('styles/parts/') ? 'styles/parts' : sheet.name
      const allowed = MOST[bucket] ?? 0
      if (found > allowed) {
        over.push(`${sheet.name}: ${found}, allowed ${allowed}`)
      }
    }
    assert.deepEqual(
      over,
      [],
      'a screen sits beside the sidebar, so the window is not what runs out of room. Use a container query on the screen root — see .create-view, .pages-view and .mk-rows.'
    )
  })

  test('the ceiling is not quietly above what is really there', async () => {
    /*
     * The other direction, so the numbers above cannot drift into meaninglessness.
     *
     * A file whose count has come down should have the number brought down with it; otherwise the allowance grows
     * back silently the next time somebody adds one. This reports rather than fails, because lowering the number is
     * the fix and it belongs in the same change as the conversion.
     */
    const counted = new Map<string, number>()
    for await (const sheet of stylesheets(ROOT)) {
      const bucket = sheet.name.startsWith('styles/parts/') ? 'styles/parts' : sheet.name
      if (MOST[bucket] === undefined) continue
      const source = await readFile(sheet.url, 'utf8')
      const found = [...source.matchAll(/@media\s*\([^)]*\bmax-width\b/g)].length
      counted.set(bucket, (counted.get(bucket) ?? 0) + found)
    }
    const slack = [...counted]
      .filter(([bucket, found]) => found < MOST[bucket])
      .map(([bucket, found]) => `${bucket}: ${found} now, still allowed ${MOST[bucket]}`)
    assert.deepEqual(slack, [], 'bring these numbers down to what is really there, in the change that lowered them')
  })

  test('the screens that were fixed stay fixed', async () => {
    // The window's global stylesheet is 38 parts; read as one, because which part a rule sits in is an accident of
    // where the section banners fell.
    const names = (await readdir(new URL('styles/parts/', ROOT))).filter((one) => one.endsWith('.css')).sort()
    const styles = (await Promise.all(names.map((one) => readFile(new URL(`styles/parts/${one}`, ROOT), 'utf8')))).join('\n')
    const create = await readFile(new URL('components/create.css', ROOT), 'utf8')

    assert.match(create, /container-name:\s*create-view/, 'Create measures its own root')
    assert.match(create, /@container create-view/, 'and stacks from that')
    assert.match(styles, /container-name:\s*pages-view/, 'Pages measures its own root')
    assert.match(styles, /@container pages-view/, 'and stacks from that')

    /*
     * The ordering fault, which is the one no width would have revealed.
     *
     * `.pages-side { flex-direction: row }` sat above `.pages-side { flex-direction: column }`. Same specificity,
     * later wins, and the media query around the first one made no difference at all. The stacking rule must come
     * after the base rule it overrides.
     */
    const base = styles.indexOf('.pages-side {')
    const stacking = styles.indexOf('@container pages-view')
    assert.ok(base > 0 && stacking > base, 'the stacking rule must come after the base rule it overrides')
  })
})
