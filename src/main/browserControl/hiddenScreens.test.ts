import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'
import { SURFACE_CALLS } from '../../shared/surfaces.ts'
import { chooseVisible, everythingChoice, featureState, newChoice } from '../../shared/featureVisibility.ts'

/**
 * Switched off is not missing, and Orion has to say which.
 *
 * People choose which of Orbis's screens they see. A screen that is switched off is not mounted, so it is in no
 * surface tree -- which from the control layer's point of view looks exactly like a screen that does not exist.
 * They are different answers and only one of them is true: everything in that screen is still there and one switch
 * brings it back.
 *
 * Told "Orbis cannot get to Markets", Orion gives up or says Orbis has no such thing, and the person is left with
 * something that is both wrong and unactionable. Told "Markets is switched off, turn it on and it is back", they
 * have the truth and the way out. That is rule four -- never claim a thing is on when it is off, never fail
 * silently -- enforced here rather than left to whichever model happens to be answering.
 */

/** A window with nothing registered, which is what a window with the screen in question switched off looks like. */
function world(hidden?: (path: string) => Promise<string | null>): BrowserControl {
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call) => (call === SURFACE_CALLS.tree ? { ok: true, data: { surfaces: [] } } : { ok: false, error: { code: 'failed', message: 'not asked for in this test', recoverable: false } }),
    open: () => true,
    hidden
  })
  return control
}

const goTo = (control: BrowserControl, path: string): Promise<{ ok: boolean; error?: { code?: string; message?: string; recoverable?: boolean } }> =>
  control.execute({ capability: 'screen.goTo', params: { path }, source: 'orion' }, { confirm: async () => true }) as Promise<{
    ok: boolean
    error?: { code?: string; message?: string; recoverable?: boolean }
  }>

test('opening a screen somebody switched off says it is switched off, in words, and that it can be turned on', async () => {
  const choice = chooseVisible(everythingChoice(), [...everythingChoice().shown].filter((id) => id !== 'markets'), 1).value
  const said = featureState('markets', choice).hiddenBecause
  assert.ok(said, 'a hidden screen has no sentence to say about it, so this test is checking nothing')

  const result = await goTo(
    world(async (path) => {
      const state = featureState(path.split('/')[0] ?? '', choice)
      return state.available && !state.visible ? state.hiddenBecause : null
    }),
    'markets'
  )

  assert.equal(result.ok, false, 'a screen that is switched off was reported as opened')
  assert.equal(result.error?.message, said, `Orion is told "${result.error?.message}" rather than that the screen is switched off`)
  assert.equal(result.error?.code, 'unavailable', 'a switched-off screen is reported as not found, which is a different thing and not true')
  assert.equal(result.error?.recoverable, true, 'a switched-off screen is reported as something nothing can be done about, when one switch fixes it')
})

test('a screen that is switched on and simply not open is still reported as not found', async () => {
  // The old answer, and the right one here: Markets is in this person's menu, so its absence from the tree is about
  // what is on screen rather than about what they chose.
  const result = await goTo(
    world(async (path) => {
      const state = featureState(path.split('/')[0] ?? '', everythingChoice())
      return state.available && !state.visible ? state.hiddenBecause : null
    }),
    'markets'
  )

  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'not-found', 'a screen that is switched on is reported as switched off')
})

test('a name Orbis has never had is not reported as switched off', async () => {
  const result = await goTo(
    world(async (path) => {
      const state = featureState(path.split('/')[0] ?? '', newChoice())
      return state.available && !state.visible ? state.hiddenBecause : null
    }),
    'telepathy'
  )

  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'not-found', 'a screen Orbis has never had is reported as one that is switched off, so somebody is offered a switch that does not exist')
})

test('without the question wired up at all, nothing is reported wrongly', async () => {
  // The answer is optional on purpose: a build that has not wired it gives the answer it always gave rather than a
  // made-up one.
  const result = await goTo(world(), 'markets')
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'not-found')
})
