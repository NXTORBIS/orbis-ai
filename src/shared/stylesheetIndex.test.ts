import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, access } from 'node:fs/promises'

/**
 * The window's stylesheet is a list of parts, and the list is load-bearing.
 *
 * It was one file of 19,109 lines whose own index stopped being useful around line 5,700. It is now 38 parts, cut
 * at the section banners the file already carried, with `styles/index.css` importing them in the order they were
 * always in. Nothing was reordered and no rule was changed — the built stylesheet holds the same 368,664 characters
 * of rules in the same order, and the only difference in the output is the comments naming each part.
 *
 * Order is the thing to protect. 1,397 selectors certainly contain pairs that depend on which came first, and the
 * Pages stacking rule is the proof that it matters: it sat above the rule it was meant to override and therefore
 * did nothing at all, in every window, for as long as it existed. So a part may be edited freely and must never be
 * moved, and this checks exactly that:
 *
 *   - every part on disk is imported, once;
 *   - every import names a part that is there;
 *   - the imports are in the parts' own numbered order.
 */

const STYLES = new URL('../renderer/src/styles/', import.meta.url)

const indexSource = async (): Promise<string> => readFile(new URL('index.css', STYLES), 'utf8')

const imported = (source: string): string[] => [...source.matchAll(/@import\s+'\.\/parts\/([^']+)'/g)].map((one) => one[1])

const onDisk = async (): Promise<string[]> => (await readdir(new URL('parts/', STYLES))).filter((one) => one.endsWith('.css')).sort()

describe('the window stylesheet', () => {
  test('every part is imported, and every import is a part', async () => {
    const listed = imported(await indexSource())
    const files = await onDisk()
    const missing = files.filter((one) => !listed.includes(one))
    const ghosts = listed.filter((one) => !files.includes(one))
    assert.deepEqual(missing, [], 'these parts are on disk and nothing imports them, so their rules are not applied')
    assert.deepEqual(ghosts, [], 'these imports name a file that is not there')
  })

  test('no part is imported twice', async () => {
    const listed = imported(await indexSource())
    const twice = listed.filter((one, at) => listed.indexOf(one) !== at)
    assert.deepEqual(twice, [], 'a part imported twice applies its rules twice, and the second time wins')
  })

  test('the imports are in the parts’ own order', async () => {
    const listed = imported(await indexSource())
    assert.deepEqual(
      listed,
      [...listed].sort(),
      'the numbered prefix is the order the rules were in. Moving an import moves rules past each other, and a rule that loses on order does nothing at all.'
    )
  })

  test('there is no second copy of the stylesheet left behind', async () => {
    // A `styles.css` beside `styles/` would be the old file, imported by nothing and quietly diverging.
    await assert.rejects(access(new URL('../renderer/src/styles.css', import.meta.url)), 'src/renderer/src/styles.css is back; it was split into styles/parts')
  })

  test('it is still the whole stylesheet rather than a sketch', async () => {
    const files = await onDisk()
    assert.ok(files.length >= 30, `only ${files.length} parts; the split was 38`)
    let lines = 0
    for (const name of files) lines += (await readFile(new URL(`parts/${name}`, STYLES), 'utf8')).split('\n').length
    assert.ok(lines > 17_000, `only ${lines} lines across the parts; the file was 19,109`)
  })
})
