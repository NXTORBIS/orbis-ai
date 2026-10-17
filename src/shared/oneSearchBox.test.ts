import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * There is one search box in the window, and only one stylesheet may draw it.
 *
 * ## What this is for
 *
 * Sixteen screens had written their own box to type a query into, and the copies disagreed about everything that
 * matters: what Escape does, whether there is a clear button, whether the field has a name of its own or leans on
 * a placeholder that vanishes the moment somebody types. They have been moved onto the shared `SearchBox`, whose
 * rules live in `src/renderer/src/ui/ui.css` under the name `.ui-search`.
 *
 * Nothing stops the seventeenth from being written, which is how this came about the first time. So this reads the
 * stylesheets and fails when one of them draws a search box of its own again. A screen is still free to say *where*
 * its box sits — a width, how much of a row it takes — because that is genuinely the screen's own business. What it
 * may not do is draw the box: the border, the corner, the colours and the field inside it.
 *
 * ## How it tells one from the other
 *
 * A rule is drawing a box, rather than placing one, when it is a flex row with a background and a rounded corner —
 * the three things every one of the sixteen copies had, and none of which a layout rule needs. That is a shape, not
 * a name, so it still catches a copy called something that does not have "search" in it.
 */

const REPO = resolve(import.meta.dirname, '../..')
const STYLES = join(REPO, 'src/renderer/src')

/** The one file allowed to draw it, and the ported sub-projects, which are whole designs of their own. */
const ALLOWED = [
  'src/renderer/src/ui/ui.css',
  // Jarvis is the Toolkit's ported design with a palette and a component set of its own; see the note at the top
  // of its stylesheet. Chess is being rebuilt in its own right.
  'src/renderer/src/features/jarvis/jarvis.css',
  'src/renderer/src/components/chess/'
]

/**
 * The boxes that have not moved yet, each for a reason, so the list is a record of work left rather than a hole.
 *
 * - the sidebar's box filters your chats and sits in a 200px rail with keyboard navigation of its own;
 * - the laboratories popover in the chat is drawn inside a measured popover rather than on a screen;
 * - Markets' box in its header folds down to a magnifier and carries the fold with it;
 * - the offline game list's box lives in `games.css`, which is the browser's error page, not the window's.
 */
const NOT_YET = ['sb-search', 'na-labs-search', 'mk-search', 'og-search']

async function stylesheets(): Promise<{ path: string; css: string }[]> {
  const found: { path: string; css: string }[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.name.endsWith('.css')) continue
      found.push({ path: full.slice(REPO.length + 1).replace(/\\/g, '/'), css: await readFile(full, 'utf8') })
    }
  }
  await walk(STYLES)
  return found
}

test('only the shared stylesheet draws a search box', async () => {
  const drawn: string[] = []
  for (const sheet of await stylesheets()) {
    if (ALLOWED.some((one) => sheet.path.startsWith(one))) continue
    const css = sheet.css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().replace(/\s+/g, ' ')
      const body = rule[2]
      // `research-sources` is not a search box. Only the word on its own counts.
      if (!/(?<![a-z])search/i.test(selector)) continue
      if (NOT_YET.some((one) => selector.includes(one))) continue
      const drawsTheBox =
        /display\s*:\s*flex/.test(body) && /background\s*:/.test(body) && /border-radius\s*:/.test(body)
      if (drawsTheBox) drawn.push(`${sheet.path}: ${selector}`)
    }
  }
  assert.deepEqual(
    drawn,
    [],
    'These draw a search box of their own:\n  ' +
      drawn.join('\n  ') +
      '\nUse the shared SearchBox from src/renderer/src/ui instead. A screen may still say where its box sits — ' +
      'a width, or how much of a row it takes — but the box itself is drawn once, in src/renderer/src/ui/ui.css.'
  )
})

test('a screen may place the shared search box but not repaint it', async () => {
  /*
   * A screen says where its box sits by writing against the row it is in -- `.clips-toolbar .ui-search` -- which
   * is the convention the nine screens already moved over follow, and it is right: how much of a row a box takes
   * is the row's business and nobody else's.
   *
   * What it must not do from there is decide what the box *looks* like. That is how two places came to decide one
   * thing before, and which of them wins depends on the order the bundler happened to put the stylesheets in, so
   * it goes wrong on one machine and not another. Placing is allowed; painting is not.
   */
  const ALLOWED_PROPERTIES = new Set([
    'flex',
    'flex-basis',
    'flex-grow',
    'flex-shrink',
    'width',
    'min-width',
    'max-width',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'margin-inline',
    'margin-inline-start',
    'margin-inline-end',
    'margin-block',
    'align-self',
    'justify-self',
    'grid-area',
    'grid-column',
    'grid-row',
    'order',
    'position',
    'inset',
    'top',
    'right',
    'bottom',
    'left',
    'z-index'
  ])
  const painted: string[] = []
  for (const sheet of await stylesheets()) {
    if (sheet.path === 'src/renderer/src/ui/ui.css') continue
    const css = sheet.css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().replace(/\s+/g, ' ')
      if (!/\.ui-search\b/.test(selector.split(/[\s>+~]+/).pop() ?? '')) continue
      for (const declaration of rule[2].split(';')) {
        const property = declaration.split(':')[0]?.trim().toLowerCase() ?? ''
        if (property === '') continue
        if (!ALLOWED_PROPERTIES.has(property)) painted.push(`${sheet.path}: ${selector} sets ${property}`)
      }
    }
  }
  assert.deepEqual(
    painted,
    [],
    'These decide what the shared search box looks like from outside the file that draws it:\n  ' +
      painted.join('\n  ') +
      '\nA screen may set where the box sits -- its width, how much of a row it takes, where it sits in a grid -- ' +
      'and nothing else. The look of it is decided once, in src/renderer/src/ui/ui.css.'
  )
})
