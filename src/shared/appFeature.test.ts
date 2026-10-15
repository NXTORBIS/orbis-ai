import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CAPABILITIES } from './commandCenter.ts'
import type { AppFeature } from './commandCenter.ts'

/**
 * The Orbis window's screens and the registry, held to each other in both directions.
 *
 * These two had drifted nine features apart, and the drift was invisible because neither side ever asked the other
 * anything. It is two separate kinds of lie, and this file is one test for each:
 *
 *   - **A route that goes nowhere.** Six capabilities said `app` -- the window can open this -- and the window
 *     could open none of them. Galaxy, Secrets, Tasks and Workflows had moved to the browser and their window
 *     screens had been deleted; the field was simply left behind. Customize and Profiles are reached inside
 *     Settings and were never screens. This is the same bug the browser's panel shipped with eighteen times over,
 *     where a row rendered as live and went nowhere.
 *   - **A screen nothing can find.** Create, Laboratories and Schedules are screens the window really has, and no
 *     capability mentioned them, so nothing that reads the registry could offer them: not the browser's Command
 *     Centre, not the window's own palette, not a slash command.
 *
 * Both directions are checked because fixing one and not the other is how this happened in the first place.
 */

const FEATURE_SWITCH = new URL('../renderer/src/App.tsx', import.meta.url)
const SIDEBAR = new URL('../renderer/src/components/Sidebar.tsx', import.meta.url)

/** Every `app` the registry claims the window can open. */
const claimed = (): Set<string> => new Set(CAPABILITIES.filter((one) => one.app).map((one) => String(one.app)))

/**
 * Every feature the window really draws, read out of the one place that decides it.
 *
 * Parsed from `App.tsx` rather than from a list someone maintains, because a list someone maintains is exactly the
 * second copy this test exists to stop. If the switch moves, this breaks loudly, which is the correct outcome:
 * somebody has to point it at the new place rather than let it quietly check nothing.
 */
async function drawn(): Promise<Set<string>> {
  const source = await readFile(FEATURE_SWITCH, 'utf8')
  const found = [...source.matchAll(/feature === '([a-zA-Z0-9]+)'/g)].map((one) => one[1])
  assert.ok(found.length > 5, 'the feature switch in App.tsx was not found -- point this test at wherever it moved')
  return new Set(found)
}

describe('the window opens exactly what the registry says it opens', () => {
  test('nothing claims a screen the window does not have', async () => {
    const window = await drawn()
    const lying = [...claimed()].filter((one) => !window.has(one)).sort()
    assert.deepEqual(lying, [], 'these say `app` and the window cannot open them: a row that renders as live and goes nowhere')
  })

  test('no screen the window has is invisible to the registry', async () => {
    const window = await drawn()
    const hidden = [...window].filter((one) => !claimed().has(one)).sort()
    assert.deepEqual(hidden, [], 'the window can open these and no capability mentions them, so nothing can offer them')
  })

  test('two capabilities never claim the same screen', () => {
    const seen = new Map<string, string[]>()
    for (const one of CAPABILITIES) {
      if (!one.app) continue
      seen.set(one.app, [...(seen.get(one.app) ?? []), one.name])
    }
    const doubled = [...seen].filter(([, names]) => names.length > 1).map(([app, names]) => `${app}: ${names.join(', ')}`)
    assert.deepEqual(doubled, [], 'one screen, one capability -- two ways in means two names for the same thing')
  })

  test('a capability that opens in the window names the screen it opens', () => {
    /*
     * `target: { kind: 'app' }` says "this happens in the Orbis window" and carries nothing else -- which screen is
     * `app` on the capability. So the two have to appear together: a target of `app` with no `app` beside it is a
     * capability that opens the window and cannot say what for.
     */
    const silent = CAPABILITIES.filter((one) => one.target.kind === 'app' && !one.app).map((one) => one.id)
    assert.deepEqual(silent, [], 'these open the Orbis window without saying which screen')
  })
})

describe('one feature, one place', () => {
  test('the window keeps no second list of its own screens', async () => {
    /*
     * `Sidebar.tsx` held `FEATURES`: eleven entries with their own labels, icons, hints and order. It is the second
     * copy that drifted. The sidebar reads the registry now, and this keeps it that way -- a hand-written list is
     * not wrong because it is duplication, it is wrong because the copies stop agreeing and nobody finds out.
     */
    const source = await readFile(SIDEBAR, 'utf8')
    assert.doesNotMatch(source, /export const FEATURES\b/, 'the launcher is built from the capability registry, not from a list kept here')
  })

  test('the screens the window has are the screens AppFeature names', async () => {
    const window = await drawn()
    // `AppFeature` is a type, so it cannot be read at run time; this checks the registry's use of it instead, which
    // is what every consumer actually sees.
    const named = new Set(CAPABILITIES.map((one) => one.app).filter((one): one is AppFeature => Boolean(one)))
    assert.deepEqual([...named].sort(), [...window].sort())
  })
})
