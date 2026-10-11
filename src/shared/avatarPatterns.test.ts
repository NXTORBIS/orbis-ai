import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AVATARS } from './avatars.ts'

/**
 * The weather inside a world is drawn in two places, and they have to agree.
 *
 * An account's picture appears on the setup screen (`components/welcome.css`) and again in Settings
 * (`styles/parts/10-toasts-modals.css`), and the two stylesheets hold their own copy of the same six patterns. The
 * copy is deliberate -- `welcome.css` belongs to a screen that is unmounted the moment setup finishes, so Settings
 * cannot import it -- but a copy nobody checks is a copy that drifts.
 *
 * It already had. The first version of `eye` photographed as a dartboard and `shard` as a pie chart; both were
 * redrawn, and for a while only the setup screen got the redraw, so the same world was two different pictures
 * depending on where you looked at it. Nothing on screen says which one is wrong.
 *
 * Compared after comments and layout are taken out, because those are the two things that legitimately differ:
 * one file explains a rule above it and the other inside it.
 */

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const WELCOME = read('../renderer/src/components/welcome.css')
const SETTINGS = read('../renderer/src/styles/parts/10-toasts-modals.css')
const SIDEBAR = read('../renderer/src/styles/parts/03-sidebar.css')

/** The declarations of the first `[data-pattern='<name>']::before` rule in a stylesheet, with the noise removed. */
function bodyFor(css: string, pattern: string): string {
  const at = css.indexOf(`[data-pattern='${pattern}']::before`)
  assert.notEqual(at, -1, `no rule for the ${pattern} pattern`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  assert.ok(open !== -1 && close !== -1, `the ${pattern} rule is not closed`)
  return css
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),:;])\s*/g, '$1')
    .trim()
}

describe('the two copies of the weather', () => {
  const patterns = [...new Set(AVATARS.map((one) => one.pattern))].sort()

  it('covers every pattern the set actually uses', () => {
    // One per world. If `avatars.ts` ever gains a thirteenth, this names it rather than quietly skipping it.
    assert.deepEqual(patterns, [
      'aurora',
      'belts',
      'craters',
      'eye',
      'facets',
      'lattice',
      'nebula',
      'ocean',
      'ring',
      'strata',
      'veins',
      'vortex'
    ])
  })

  for (const pattern of patterns) {
    it(`${pattern} is drawn the same way wherever a world appears`, () => {
      // Three sizes in three stylesheets -- the setup screen, Settings, and the sidebar orb somebody sees every
      // time they look at Orbis. One of them drifting is the same world looking like a different world.
      assert.equal(
        bodyFor(SETTINGS, pattern),
        bodyFor(WELCOME, pattern),
        `the ${pattern} pattern differs between welcome.css and 10-toasts-modals.css`
      )
      assert.equal(
        bodyFor(SIDEBAR, pattern),
        bodyFor(WELCOME, pattern),
        `the ${pattern} pattern differs between welcome.css and 03-sidebar.css`
      )
    })
  }
})
