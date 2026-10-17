import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppFeature } from '../../shared/commandCenter.ts'
import type { NavState } from '../../shared/navigation.ts'
import { planNextStep } from '../../shared/surfaces.ts'
import type { SurfaceDescriptor } from '../../shared/surfaces.ts'
import { answerSurfaceCall } from '../../renderer/src/lib/surfaces/answer.ts'
import { forgetSurfaces, registerSurface, surfaceTree, surfaceWiring, surfacesDrawn } from '../../renderer/src/lib/surfaces/registry.ts'
import { moduleWaysIn, shellSurface, WINDOW_SCREENS } from '../../renderer/src/components/shellSurfaces.ts'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * Whether Orbis's own screens are joined to each other, over the real window shell.
 *
 * The other tests beside this one each drive one area end to end -- Markets, Chess World, the laboratories -- and a
 * mistake in how two areas are joined is the one thing none of them can see. This is that check: the real shell
 * declaration, the real register, the real `screen.*` capabilities, and the real wiring check over the whole tree
 * rather than over a subtree.
 *
 * It matters because every fault it looks for is silent. A way into a screen names a control by hand; spell that name
 * differently from the way the screen spells it, or name a value the control does not take, and nothing throws. The
 * walk still produces a step, the step is still carried out, the write is refused by a screen that is perfectly right
 * to refuse it, and the screen at the end of the route is unreachable for ever. This product has lost whole features
 * exactly that way, which is why the check is also read at runtime and put into the answer to `screen.tree`.
 *
 * React is not here, so the shell is stood up the way React stands it up: its state in an object, handlers that
 * change it and then say the screen has drawn.
 */

/** Everything over the wire is text and back, because that is what the hop between the two processes does to it. */
const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

const chatNav = (): NavState => ({ surface: { kind: 'chat' }, browserLaunched: false, behind: { kind: 'chat' } })
const featureNav = (id: AppFeature): NavState => ({ surface: { kind: 'feature', id }, browserLaunched: false, behind: { kind: 'chat' } })

/** The window shell, with the one piece of state these tests touch: which screen is in front. */
function shell(): { state: { nav: NavState; shown: string[] }; control: BrowserControl } {
  forgetSurfaces()
  const state = { nav: chatNav(), shown: [] as string[] }
  registerSurface(() =>
    shellSurface({
      nav: () => state.nav,
      show: (what) => {
        state.shown.push(what)
        state.nav = what === 'chat' ? chatNav() : featureNav(what as AppFeature)
        surfacesDrawn()
      },
      browserRunning: () => false,
      sidebar: () => true,
      setSidebar: () => surfacesDrawn(),
      settings: () => null,
      openSettings: () => surfacesDrawn(),
      activity: () => false,
      setActivity: () => surfacesDrawn(),
      activityCount: () => ({ total: 0, unread: 0 }),
      clearActivity: () => surfacesDrawn(),
      palette: () => false,
      setPalette: () => surfacesDrawn(),
      shortcuts: () => false,
      setShortcuts: () => surfacesDrawn(),
      back: () => surfacesDrawn(),
      chats: () => 3
    })
  )
  surfacesDrawn()

  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })
  return { state, control }
}

test('the real window shell has nothing wrong with how it is wired', () => {
  shell()
  assert.deepEqual(surfaceWiring(), [])
})

test('every way into a module sets the shell’s own control to a screen the shell can really show', () => {
  shell()
  const window = surfaceTree().find((one) => one.path === 'window')!
  const screen = window.controls.find((one) => one.id === 'screen')!
  const offered = window.possibleChildren ?? []
  assert.ok(offered.length > 1, 'the shell offers the conversation and at least one module')
  for (const way of offered) {
    assert.equal(way.reach.kind, 'control')
    const reach = way.reach as { kind: 'control'; control: string; value: unknown }
    assert.equal(reach.control, 'screen')
    /*
     * Both halves, because they are different mistakes. A value the control does not offer is a route that can never
     * be taken; a value the control offers that is not one of the screens the window can show would be the shell's
     * own list and the capability registry's list having drifted apart, which is how the launcher and the registry
     * came to disagree about nine screens.
     */
    assert.ok(screen.spec.enum?.includes(String(reach.value)), `${way.name} sets “what is on screen” to ${String(reach.value)}, which it does not offer`)
    assert.ok(WINDOW_SCREENS.includes(String(reach.value)), `${String(reach.value)} is not a screen the window can show`)
  }
})

test('a module is reached by the name it registers under, not by the name the registry shows it under', () => {
  shell()
  // The capability registry calls the arcade “Arcade” and the arcade calls its own screen Games. Both have to find it,
  // and what the walk waits for afterwards has to be where the screen really appears.
  const ways = moduleWaysIn()
  const arcade = ways.find((one) => one.id === 'games')
  assert.ok(arcade, 'the arcade is one of the ways in')
  assert.equal(arcade!.name, 'Arcade')
  assert.equal(arcade!.opens, 'games')
  assert.deepEqual(arcade!.reach, { kind: 'control', control: 'screen', value: 'arcade' })
})

test('a path into a module that is not open starts by asking the shell to show it', () => {
  shell()
  const plan = planNextStep(surfaceTree(), 'markets/screener')
  assert.equal(plan.arrived, false)
  assert.ok(plan.next, plan.stuck ?? 'there was no step to take')
  assert.equal(plan.next!.on, 'window')
  // Waited for at `markets`, which is where Markets registers itself -- not at `window/markets`, where nothing ever
  // appears and where the walk used to decide the step had not worked.
  assert.equal(plan.next!.path, 'markets')
})

test('opening a module really switches the window, and a module that then says nothing is not reported as opened', async () => {
  const world = shell()
  const done = await world.control.execute({ capability: 'screen.goTo', params: { path: 'markets' }, source: 'orion' }, { confirm: async () => true })
  // The switch really happened: the shell's own handler was called with the value the route declared.
  assert.deepEqual(world.state.shown, ['markets'])
  /*
   * And it is still a failure, because nothing on Markets said what can be done there.
   *
   * Only the shell is standing here, so Markets registers nothing -- which is what a module that failed to load looks
   * like. Reporting that as “Markets is open” is the one answer that must never come back: everything after it
   * would be done to a screen that is not there. What Markets itself offers once it is up is driven in
   * `moduleSurfaces.test.ts`, with the real declaration.
   */
  assert.equal(done.ok, false)
  assert.match(done.ok ? '' : (done.error?.message ?? ''), /asked window to open Markets, waited, and it did not appear/)
})

test('a screen Orbis has no way to show is said to be missing, not opened as something near it', async () => {
  const world = shell()
  const done = await world.control.execute({ capability: 'screen.goTo', params: { path: 'thermostat' }, source: 'orion' }, { confirm: async () => true })
  assert.equal(done.ok, false)
  assert.match(done.ok ? '' : (done.error?.message ?? ''), /Nothing on screen is called “thermostat”/)
  assert.deepEqual(world.state.shown, [], 'nothing was switched to on the way to deciding that')
})

test('a mis-wired way in is a sentence in the answer rather than a screen nobody can open', async () => {
  const world = shell()
  // A panel whose own route names a control its parent has not got: the kind of thing that costs nothing to write and
  // can never be taken. The register answers about it happily; the wiring check is what says it out loud.
  registerSurface(() => ({
    id: 'thermostat',
    parent: null,
    name: 'Thermostat',
    kind: 'module',
    controls: {},
    possibleChildren: [{ id: 'calibration', name: 'Calibration', reach: { kind: 'control', control: 'pane', value: 'calibration' } }]
  }))
  surfacesDrawn()

  const answer = await world.control.execute({ capability: 'screen.tree', params: {}, source: 'orion' }, { confirm: async () => true })
  assert.equal(answer.ok, true, answer.ok ? '' : (answer.error?.message ?? ''))
  const said = (answer.ok ? (answer.data as { wiring?: string[] }).wiring : []) ?? []
  assert.equal(said.length, 1)
  assert.match(said[0], /^thermostat: Calibration is reached by setting “pane” on Thermostat/)
  // And the screen itself is still listed, because it is on screen. Unreadable is not missing, and neither is
  // mis-wired: what is wrong with it is said beside it rather than instead of it.
  const listed = (answer.ok ? (answer.data as { surfaces: SurfaceDescriptor[] }).surfaces : []) ?? []
  assert.ok(listed.some((one) => one.path === 'thermostat'))
})
