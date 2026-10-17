import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The shared controls have to actually be worn.
 *
 * This has been tried once before and it failed in a way worth naming. `orbis-ui/orbis.css` is a complete set of
 * shared controls, written, finished, and used by nothing -- while the window went on hand-writing its own. The
 * second attempt, `src/renderer/src/ui/`, reached **two screens out of eighty** the same way. Neither failed
 * because the components were wrong. They failed because nothing ever made adopting them the easy path, and
 * writing one more `-head` of your own was always three seconds cheaper than finding the one that exists.
 *
 * So the list below is the debt, written down, and it may only ever get SHORTER. A screen converting removes its
 * line. A screen inventing a new title row, a new "nothing here yet" or a new search box cannot, because its name
 * is not on the list and the build says so on the day it is written rather than a year later.
 *
 * It deliberately does not care how many lines are left. It cares that the number never goes up.
 */

const PARTS = fileURLToPath(new URL('../renderer/src/styles/parts/', import.meta.url))

/** The families the shared controls replace: a title row, a "nothing here yet", a search box. */
const FAMILIES = /^\.([a-z0-9-]+(?:-head|-header|-empty|-none|-search))\b/

/**
 * Every one that existed when the shared controls were finished.
 *
 * Mostly a debt: delete a line when its screen moves onto the shared control.
 *
 * But NOT all of it, and the difference matters. A sweep over these found that several own real layout of their
 * own and the shared control would restyle them -- `.images-empty` is a flex column centred in the whole panel
 * while `.view-empty` is a narrow block near the top. Converting those would move pixels, which is the one thing
 * the whole exercise forbids.
 *
 * The search boxes turned out not to be in that group. What each of them really owned was *where it sits* -- how
 * much of its row it takes -- and that is one line, which the screen keeps written against the row it is in. The
 * border, the corner, the colours, the focus ring and the clear button were the same idea written out eleven times
 * and disagreeing every time, so they come from `.ui-search` now.
 *
 * So a name staying here is not automatically a failure. What this list guarantees is narrower and still worth
 * having: nothing NEW appears, and nothing is listed that the stylesheet no longer has. A name that genuinely
 * belongs to its screen should say so beside it.
 */
const STILL_HAND_MADE: readonly string[] = [
  'automation-head',
  'browser-confirm-head',
  'chat-header',
  'code-header',
  'cz-section-head',
  'drawer-empty',
  'drawer-head',
  'ext-prompt-head',
  'imagegen-head',
  'images-head',
  'meeting-detail-head',
  'mk-alert-head',
  'mk-book-head',
  'mk-detail-head',
  'mk-empty',
  'mk-head',
  'mk-introduce-head',
  'mk-list-head',
  'mk-panel-head',
  'mk-pattern-head',
  'mk-pf-head',
  'mk-rule-head',
  'mk-search',
  'mk-validate-head',
  'mk-ws-head',
  'modal-header',
  'mstrip-none',
  'mstrip-panel-head',
  'notices-head',
  'notify-none',
  'orb-confirm-head',
  'orb-panel-head',
  'orion-answer-head',
  'page-cell-empty',
  'pages-card-head',
  'pages-search',
  'pages-side-head',
  'pulsar-model-head',
  'pulsar-setup-head',
  'queue-head',
  'research-head',
  'research-run-head',
  'sb-empty',
  'sb-head',
  'sb-menu-head',
  'sb-search',
  'sb-section-head',
  'set-head',
  'set-none',
  'skill-item-head',
  'space-head',
  'tl-group-head',
  'unfinished-head',
  'view-empty',
  'view-head',
  'wf-panel-head',
  'wf-quick-head',
]

test('no screen invents a title row, an empty message or a search box of its own', () => {
  const found = new Set<string>()
  for (const name of readdirSync(PARTS).filter((one) => one.endsWith('.css'))) {
    for (const line of readFileSync(PARTS + name, 'utf8').split(String.fromCharCode(10))) {
      const hit = FAMILIES.exec(line.trim())
      if (hit) found.add(hit[1])
    }
  }
  const known = new Set(STILL_HAND_MADE)
  const added = [...found].filter((one) => !known.has(one)).sort()
  assert.deepEqual(
    added,
    [],
    'these are new hand-made copies of something `src/renderer/src/ui/` already provides. Use the shared one, or ' +
      'if it genuinely does not fit, say why in a comment and add the name to STILL_HAND_MADE in this file.'
  )
})

test('the list of hand-made copies only ever gets shorter', () => {
  // The other half of the promise. Without this, a name could be deleted from the stylesheet and left on the list,
  // and the list would stop describing anything -- which is how an allowlist becomes decoration.
  const found = new Set<string>()
  for (const name of readdirSync(PARTS).filter((one) => one.endsWith('.css'))) {
    for (const line of readFileSync(PARTS + name, 'utf8').split(String.fromCharCode(10))) {
      const hit = FAMILIES.exec(line.trim())
      if (hit) found.add(hit[1])
    }
  }
  const gone = STILL_HAND_MADE.filter((one) => !found.has(one)).sort()
  assert.deepEqual(gone, [], 'these are no longer in the stylesheet: delete them from STILL_HAND_MADE in this file')
})
