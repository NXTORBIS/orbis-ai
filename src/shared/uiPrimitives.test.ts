import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * The window's shared controls, and the screens that have taken them up.
 *
 * There is no renderer test harness — no jsdom, no React Testing Library — so these cannot be rendered. What can be
 * checked is the thing that actually goes wrong: a screen quietly writing its own copy of something shared, which is
 * how the window came to have four frames for one idea, twenty-one empty states, sixteen search boxes and seven
 * toggle chips that disagreed about how they say they are on.
 *
 * This is a source-text guard, like `cssCollisions.test.ts` and `screenWidth.test.ts` beside it. It does not demand
 * that every screen converts — that is a change per screen, each needing to be looked at — it holds the ones that
 * have, and keeps the primitives honest.
 */

const REPO = resolve(import.meta.dirname, '../..')
const UI = join(REPO, 'src/renderer/src/ui')
const COMPONENTS = join(REPO, 'src/renderer/src/components')

/** The screens that have taken up `Surface`. Add to this when a screen converts; never remove. */
const CONVERTED = ['WhiteboardView.tsx', 'ClipboardView.tsx']

describe('the shared controls', () => {
  test('each one is exported, so there is one way to reach them', async () => {
    const index = await readFile(join(UI, 'index.ts'), 'utf8')
    for (const name of ['Surface', 'IconButton', 'EmptyState', 'SearchBox', 'Chip']) {
      assert.match(index, new RegExp(`export \\{ ${name} \\}`), `${name} is not exported from ui/index.ts`)
    }
  })

  test('they bring almost no CSS of their own', async () => {
    /*
     * The point of the set is that `.view`, `.view-head`, `.view-actions`, `.view-empty` and `.icon-btn` already
     * existed; the components make them the default rather than replacing them. A second stylesheet beside the
     * first is exactly the duplication being undone, so what this file may define is small and is checked.
     */
    const css = await readFile(join(UI, 'ui.css'), 'utf8')
    const defined = [...css.matchAll(/^\.([a-z][a-z0-9-]*)/gm)].map((one) => one[1])
    const allowed = new Set(['ui-search', 'ui-chip', 'view-empty-words', 'view-empty-do'])
    const extra = [...new Set(defined)].filter((one) => !allowed.has(one))
    assert.deepEqual(extra, [], 'ui.css is for what had no shared rule at all. Anything else belongs to the screen that needs it.')
  })

  test('a toggle says which way it is set, and a search box says what it searches', async () => {
    const chip = await readFile(join(UI, 'Chip.tsx'), 'utf8')
    assert.match(chip, /aria-pressed=\{on\}/, 'Chip must always carry aria-pressed')
    assert.match(chip, /on: boolean/, 'and `on` must be required, or it can be left unsaid')

    const search = await readFile(join(UI, 'SearchBox.tsx'), 'utf8')
    assert.match(search, /aria-label=\{label\}/, 'SearchBox must name its field')
    assert.match(search, /label: string/, 'and the name must be required')
  })

  test('an icon button cannot be rendered without a name', async () => {
    const button = await readFile(join(UI, 'IconButton.tsx'), 'utf8')
    assert.match(button, /label: string/, 'the label must be required, not optional')
    assert.match(button, /aria-label=\{label\}/, 'and must become the accessible name')
  })

  test('the frame always has a way out', async () => {
    const surface = await readFile(join(UI, 'Surface.tsx'), 'utf8')
    assert.match(surface, /onClose: \(\) => void/, 'onClose must be required — a screen with no way out is the fault this exists to stop')
    assert.match(surface, /IconButton label=\{closeLabel\}/, 'and the close button must be drawn from it')
  })
})

describe('the screens that have taken them up', () => {
  test('they no longer write the frame by hand', async () => {
    const faults: string[] = []
    for (const name of CONVERTED) {
      const source = await readFile(join(COMPONENTS, name), 'utf8')
      if (!source.includes('<Surface')) faults.push(`${name} no longer uses Surface`)
      if (/className="view /.test(source)) faults.push(`${name} writes its own .view frame again`)
      if (/className="view-head"/.test(source)) faults.push(`${name} writes its own .view-head again`)
    }
    assert.deepEqual(faults, [], 'a screen that has converted must not grow a second frame beside the one it was given')
  })

  test('none of them draws a second close button', async () => {
    // Surface draws one. A screen drawing its own as well is two ways out of the same screen, in the same corner.
    const faults: string[] = []
    for (const name of CONVERTED) {
      const source = await readFile(join(COMPONENTS, name), 'utf8')
      if (/aria-label="Close/.test(source)) faults.push(`${name} draws its own close button`)
    }
    assert.deepEqual(faults, [])
  })
})

describe('what is still to convert', () => {
  test('the count of hand-written frames only goes down', async () => {
    /*
     * A ceiling, not a demand. Converting a screen is a change that has to be looked at, so this does not fail the
     * ones that have not — it fails a *new* hand-written frame, which is the thing that would undo the work.
     */
    const MOST_HAND_WRITTEN = 24
    let found = 0
    const seen: string[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.name.endsWith('.tsx')) {
          const source = await readFile(path, 'utf8')
          if (/className="view-head"/.test(source)) {
            found += 1
            seen.push(entry.name)
          }
        }
      }
    }
    await walk(COMPONENTS)
    assert.ok(
      found <= MOST_HAND_WRITTEN,
      `${found} screens write the frame by hand, allowed ${MOST_HAND_WRITTEN}: ${seen.join(', ')}. Use Surface from ui/ instead.`
    )
  })
})
