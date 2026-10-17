import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ParamSpec } from './browserControl.ts'
import type { SurfaceControl, SurfaceDescriptor, SurfaceTree } from './surfaces.ts'
import { attempted, checkControlValue, checkSurfaceWiring, coerceForSpec, completed, descendantsOf, matchOne, normalizeName, pathSegments, planNextStep, resolveSurfacePath } from './surfaces.ts'

/**
 * The part of the screens layer that has to be right before anything is on screen.
 *
 * Resolving a path is where a request becomes an action on a real control, so a mistake here is not a wrong answer --
 * it is the wrong setting changed on the wrong screen, reported as a success. All of it is pure, which is why all of
 * it can be checked here rather than by driving a window and hoping.
 */

const control = (id: string, name: string, spec: ParamSpec, extra: Partial<SurfaceControl> = {}): SurfaceControl => ({
  id,
  name,
  spec,
  value: null,
  readable: true,
  writable: true,
  ...extra
})

const surface = (one: Partial<SurfaceDescriptor> & { id: string; path: string; name: string }): SurfaceDescriptor => ({
  parent: null,
  kind: 'panel',
  controls: [],
  actions: [],
  state: { present: true, activity: 'idle' },
  children: [],
  ...one
})

/** A tree shaped like the real thing: a module, a page in it, a panel in that, and controls at the bottom. */
function tree(): SurfaceTree {
  return [
    surface({
      id: 'chess',
      path: 'chess',
      name: 'Chess World',
      kind: 'module',
      children: ['chess/study'],
      controls: [
        control('board', 'Board style', { type: 'string', description: 'How the board is drawn.', enum: ['flat', 'wood', 'glass'] }),
        // The way into Puzzles below is this control. A fixture that left it out was the first thing
        // `checkSurfaceWiring` found, which is exactly the fault it is there to find.
        control('page', 'Area', { type: 'string', description: 'Which area of Chess World is open.', enum: ['study', 'puzzles'] }, { value: 'study' })
      ],
      actions: [{ id: 'newGame', name: 'New game' }],
      possibleChildren: [{ id: 'puzzles', name: 'Puzzles', reach: { kind: 'control', control: 'page', value: 'puzzles' } }]
    }),
    surface({
      id: 'study',
      path: 'chess/study',
      name: 'Study',
      kind: 'page',
      parent: 'chess',
      children: ['chess/study/engine-panel'],
      possibleChildren: [
        { id: 'engine-panel', name: 'Engine panel', reach: { kind: 'action', action: 'showEngine' } },
        { id: 'tournament', name: 'Tournament', reach: { kind: 'manual', how: 'join one from the lobby first' } }
      ],
      actions: [{ id: 'showEngine', name: 'Show the engine panel' }]
    }),
    surface({
      id: 'engine-panel',
      path: 'chess/study/engine-panel',
      name: 'Engine panel',
      parent: 'chess/study',
      state: { present: true, activity: 'running', detail: 'Thinking about move 14', progress: 0.5 },
      controls: [
        control('depth', 'Search depth', { type: 'integer', description: 'How deep to look.', min: 1, max: 40 }, { value: 18 }),
        control('animationSpeedMultiplier', 'Animation speed', { type: 'number', description: 'How fast the arrows move.', min: 0.25, max: 4 }, { value: 1 }),
        control('threads', 'Threads', { type: 'integer', description: 'Cores to use.', min: 1, max: 16 }, { value: 4, writable: false, readonlyReason: 'The engine is thinking.' })
      ],
      actions: [{ id: 'stop', name: 'Stop thinking' }]
    }),
    surface({ id: 'settings', path: 'settings', name: 'Settings', kind: 'module', children: [], possibleChildren: [{ id: 'notifications', name: 'Notifications', reach: { kind: 'control', control: 'section', value: 'notifications' } }], controls: [control('section', 'Section', { type: 'string', description: 'Which part is open.', enum: ['account', 'notifications'] }, { value: 'account' })] })
  ]
}

test('a name is the same name however it is written', () => {
  assert.equal(normalizeName('Animation Speed'), 'animationspeed')
  assert.equal(normalizeName('animation-speed'), 'animationspeed')
  assert.equal(normalizeName('animationSpeed'), 'animationspeed')
  assert.deepEqual(pathSegments('/chess/study//engine-panel/'), ['chess', 'study', 'engine-panel'])
  // Written with dots, which is how a path arrives from something that thinks in objects.
  assert.deepEqual(pathSegments('chess.study.depth'), ['chess', 'study', 'depth'])
})

test('an exact path reaches the control at the end of it', () => {
  const hit = resolveSurfacePath(tree(), 'chess/study/engine-panel/depth')
  assert.equal(hit.kind, 'control')
  if (hit.kind !== 'control') return
  assert.equal(hit.control.id, 'depth')
  assert.equal(hit.surface.path, 'chess/study/engine-panel')
  assert.deepEqual(hit.skipped, [])
  assert.deepEqual(hit.how, ['id', 'id', 'id', 'id'])
})

test('what somebody says on screen reaches what the code calls it', () => {
  const byName = resolveSurfacePath(tree(), 'chess/study/engine panel/animation speed')
  assert.equal(byName.kind, 'control')
  if (byName.kind === 'control') {
    assert.equal(byName.control.id, 'animationSpeedMultiplier')
    // Matched on what it is called on screen, which is reported as such: the caller can tell this from an exact id.
    assert.equal(byName.how.at(-1), 'name')
  }

  // Only the start of what it is called, which is the loosest of the three and still only one thing.
  const partial = resolveSurfacePath(tree(), 'chess/study/engine-panel/animation')
  assert.equal(partial.kind === 'control' && partial.control.id, 'animationSpeedMultiplier')
  if (partial.kind === 'control') assert.equal(partial.how.at(-1), 'start')

  // The words in another order.
  const reordered = resolveSurfacePath(tree(), 'chess/study/engine-panel/speed animation')
  assert.equal(reordered.kind === 'control' && reordered.control.id, 'animationSpeedMultiplier')

  // What it is called on screen, including the capital and the space.
  assert.equal(resolveSurfacePath(tree(), 'Chess World/Study/Engine panel/Search depth').kind, 'control')
})

test('a level left out is found further down, and the levels jumped over are reported', () => {
  const hit = resolveSurfacePath(tree(), 'chess/study/depth')
  assert.equal(hit.kind, 'control')
  if (hit.kind !== 'control') return
  assert.equal(hit.path, 'chess/study/engine-panel/depth')
  assert.deepEqual(hit.skipped, ['engine-panel'])

  // And not when it is switched off, because a caller that needs the real path must be able to insist on it.
  const strict = resolveSurfacePath(tree(), 'chess/study/depth', { skipLevels: false })
  assert.equal(strict.kind, 'miss')
  if (strict.kind === 'miss') assert.equal(strict.why, 'unknown')
})

test('two things that answer equally well are reported, never chosen between', () => {
  const two = tree().concat(
    surface({ id: 'other-panel', path: 'chess/study/other-panel', name: 'Other panel', parent: 'chess/study', controls: [{ ...control('depth', 'Search depth', { type: 'integer', description: 'How deep.' }) }] })
  )
  const hit = resolveSurfacePath(two, 'chess/study/depth')
  assert.equal(hit.kind, 'miss')
  if (hit.kind !== 'miss') return
  assert.equal(hit.why, 'ambiguous')
  assert.deepEqual(hit.choices, ['depth', 'depth'])
  assert.match(hit.message, /Say which one/)
})

test('a miss says how far it got and what was there instead', () => {
  const hit = resolveSurfacePath(tree(), 'chess/study/engine-panel/temperature')
  assert.equal(hit.kind, 'miss')
  if (hit.kind !== 'miss') return
  assert.equal(hit.reached, 'chess/study/engine-panel')
  assert.equal(hit.stuck, 'temperature')
  assert.ok(hit.choices.includes('depth'), 'the choices are what is really there')
  assert.match(hit.message, /Engine panel has nothing called/)

  const nothing = resolveSurfacePath([], 'chess')
  assert.equal(nothing.kind === 'miss' && nothing.why, 'unknown')
  if (nothing.kind === 'miss') assert.match(nothing.message, /No screen has registered/)
})

test('a place is preferred over a setting of the same name', () => {
  const both = tree().concat(surface({ id: 'depth', path: 'chess/study/depth', name: 'Depth', parent: 'chess/study' }))
  const hit = resolveSurfacePath(both, 'chess/study/depth')
  assert.equal(hit.kind, 'surface', 'a path that could continue must not end at a control')
  // Asked for only surfaces, a control is never offered.
  assert.equal(resolveSurfacePath(tree(), 'chess/study/engine-panel/depth', { surfacesOnly: true }).kind, 'miss')
})

test('an action at the end of a path is found as an action', () => {
  const hit = resolveSurfacePath(tree(), 'chess/study/engine-panel/stop')
  assert.equal(hit.kind, 'action')
  if (hit.kind === 'action') assert.equal(hit.action.name, 'Stop thinking')
})

test('everything inside a surface is listed nearest first', () => {
  assert.deepEqual(
    descendantsOf(tree(), 'chess').map((one) => one.path),
    ['chess/study', 'chess/study/engine-panel']
  )
})

test('a value is checked against the control’s own spec, and not quietly made to fit', () => {
  const depth = control('depth', 'Search depth', { type: 'integer', description: 'How deep.', min: 1, max: 40 })
  assert.deepEqual(checkControlValue(depth, 20), { ok: true, value: 20 })
  const tooDeep = checkControlValue(depth, 400)
  assert.equal(tooDeep.ok, false)
  // The range, not a clamp: 400 silently becoming 40 is an automation told it got what it asked for.
  if (!tooDeep.ok) assert.match(tooDeep.message, /at most 40/)
  const wrongType = checkControlValue(depth, 1.5)
  assert.equal(wrongType.ok, false)
  if (!wrongType.ok) assert.match(wrongType.message, /whole number/)

  // Text that is plainly the number is read as the number, and says so.
  const asText = checkControlValue(depth, '22')
  assert.equal(asText.ok && asText.value, 22)
  if (asText.ok) assert.match(asText.note ?? '', /read “22” as the number 22/)
})

test('a control that cannot be set is refused for that reason, not for its type', () => {
  const locked = control('threads', 'Threads', { type: 'integer', description: 'Cores.' }, { writable: false, readonlyReason: 'The engine is thinking.' })
  const refusal = checkControlValue(locked, 8)
  assert.equal(refusal.ok, false)
  if (!refusal.ok) assert.match(refusal.message, /cannot be set right now\. The engine is thinking\./)
})

test('a switch takes the words people use for on and off, and says what it read', () => {
  assert.deepEqual(coerceForSpec({ type: 'boolean', description: '' }, 'on'), { value: true, note: 'read “on” as on' })
  assert.deepEqual(coerceForSpec({ type: 'boolean', description: '' }, 'FALSE'), { value: false, note: 'read “FALSE” as off' })
  // Not a guess at anything else: "maybe" stays as it was and is refused by the type check.
  assert.deepEqual(coerceForSpec({ type: 'boolean', description: '' }, 'maybe'), { value: 'maybe' })
  assert.equal(checkControlValue(control('quiet', 'Quiet hours', { type: 'boolean', description: '' }), 'maybe').ok, false)
})

test('a chooser takes what is written on screen for one of its values', () => {
  const section = control('section', 'Section', { type: 'string', description: 'Which part.', enum: ['account', 'notifications'] })
  const got = checkControlValue(section, 'Notifications')
  assert.equal(got.ok && got.value, 'notifications')
  const nope = checkControlValue(section, 'nonsense')
  assert.equal(nope.ok, false)
  if (!nope.ok) assert.match(nope.message, /one of: account, notifications/)
})

test('getting to a screen is one step at a time, from what is open now', () => {
  const now = tree()
  // Already there.
  const there = planNextStep(now, 'chess/study/engine-panel')
  assert.equal(there.arrived, true)
  assert.equal(there.next, null)

  // A path that ends at a control is reached by opening the screen that holds it.
  assert.equal(planNextStep(now, 'chess/study/engine-panel/depth').arrived, true)

  // Something that is not open yet: the step is named, and it is the parent's own control.
  const closed = now.filter((one) => one.path !== 'chess/study/engine-panel')
  const step = planNextStep(closed, 'chess/study/engine-panel/depth')
  assert.equal(step.arrived, false)
  assert.deepEqual(step.open, ['chess', 'chess/study'])
  assert.deepEqual(step.next, { path: 'chess/study/engine-panel', name: 'Engine panel', reach: { kind: 'action', action: 'showEngine' }, on: 'chess/study' })

  // Settings, where the way in is a control rather than a button.
  const toNotifications = planNextStep(now, 'settings/notifications/quietHours')
  assert.deepEqual(toNotifications.next?.reach, { kind: 'control', control: 'section', value: 'notifications' })
})

test('a screen only a person can open says so instead of being tried', () => {
  const plan = planNextStep(tree(), 'chess/study/tournament')
  assert.equal(plan.next, null)
  assert.match(plan.stuck ?? '', /cannot be opened by Orbis: join one from the lobby first/)
})

test('a screen that cannot be reached at all says what can be', () => {
  const plan = planNextStep(tree(), 'chess/study/nowhere')
  assert.equal(plan.next, null)
  assert.match(plan.stuck ?? '', /Study cannot open anything called “nowhere”/)
  assert.match(plan.stuck ?? '', /It can open: engine-panel, tournament/)
})

test('one thing among several is chosen only when it is the only one', () => {
  const candidates = [
    { value: 1, id: 'speed', name: 'Speed' },
    { value: 2, id: 'speedLimit', name: 'Speed limit' }
  ]
  assert.deepEqual(matchOne('speed', candidates), { kind: 'one', value: 1, how: 'id' })
  // Both start with "sp", so neither is chosen.
  assert.equal(matchOne('sp', candidates).kind, 'several')
  assert.equal(matchOne('colour', candidates).kind, 'none')
})

test('what was carried out and what was confirmed are different answers', () => {
  const done = completed('Search depth is now 20.', { value: 20 })
  assert.deepEqual([done.status, done.verified], ['completed', true])
  const sent = attempted('Send a test was done. The screen does not report whether it worked.')
  assert.deepEqual([sent.status, sent.verified], ['attempted', false])
})

/*
 * Whether the screens are joined to each other.
 *
 * Every one of the faults below is silent: nothing throws, nothing is refused, and the only sign of any of them is a
 * screen that can never be opened. That is how this product has lost whole features before, so each is checked here
 * against a tree shaped like the real one.
 */

test('a healthy tree has nothing wrong with it', () => {
  assert.deepEqual(checkSurfaceWiring(tree()), [])
})

test('a way in that names a control the screen has not got is found, with what it does have', () => {
  const broken = [
    surface({
      id: 'markets',
      path: 'markets',
      name: 'Markets',
      kind: 'module',
      controls: [control('panel', 'Panel', { type: 'string', description: 'Which panel is open.', enum: ['chart', 'screener'] })],
      possibleChildren: [{ id: 'screener', name: 'Screener', reach: { kind: 'control', control: 'pane', value: 'screener' } }]
    })
  ]
  const found = checkSurfaceWiring(broken)
  assert.equal(found.length, 1)
  assert.equal(found[0].at, 'markets')
  assert.match(found[0].message, /Screener is reached by setting “pane” on Markets, and Markets has no control of that name\. It has: panel\./)
})

test('a way in that sets a value the control does not take is found, with the values it does take', () => {
  const broken = [
    surface({
      id: 'markets',
      path: 'markets',
      name: 'Markets',
      kind: 'module',
      controls: [control('panel', 'Panel', { type: 'string', description: 'Which panel is open.', enum: ['chart', 'screener'] })],
      possibleChildren: [{ id: 'book', name: 'Order book', reach: { kind: 'control', control: 'panel', value: 'orderbook' } }]
    })
  ]
  const found = checkSurfaceWiring(broken)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /is not one of the values it takes: chart, screener/)
})

test('a way in that does something the screen cannot do is found, with what it can do', () => {
  const broken = [
    surface({
      id: 'study',
      path: 'study',
      name: 'Study',
      actions: [{ id: 'showEngine', name: 'Show the engine panel' }],
      possibleChildren: [{ id: 'engine-panel', name: 'Engine panel', reach: { kind: 'action', action: 'openEngine' } }]
    })
  ]
  const found = checkSurfaceWiring(broken)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /has nothing of that name to do\. It can do: showEngine\./)
})

test('a way in that passes the wrong thing to the button is found, in the words the parameter check uses', () => {
  const broken = [
    surface({
      id: 'library',
      path: 'library',
      name: 'Library',
      actions: [{ id: 'open', name: 'Open a game', params: { id: { type: 'string', description: 'Which game.', required: true } } }],
      possibleChildren: [{ id: 'game', name: 'The open game', reach: { kind: 'action', action: 'open', params: { game: 'latest' } } }]
    })
  ]
  const found = checkSurfaceWiring(broken)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /what the route passes it is wrong/)
})

test('a setting and a button of one name is found, because the setting is what a path of that name finds', () => {
  const broken = [
    surface({
      id: 'lab',
      path: 'lab',
      name: 'Laboratory',
      controls: [control('run', 'Keep running', { type: 'boolean', description: 'Whether it keeps going.' })],
      actions: [{ id: 'run', name: 'Run' }]
    })
  ]
  const found = checkSurfaceWiring(broken)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /the button can never be reached by name/)
  // And this is why it matters: the path finds the setting, so the button is unreachable rather than ambiguous.
  const hit = resolveSurfacePath(broken, 'lab/run')
  assert.equal(hit.kind, 'control')
})

test('two screens on one path, and a screen whose parent is not there, are both said out loud', () => {
  const broken = [
    surface({ id: 'markets', path: 'markets', name: 'Markets', kind: 'module' }),
    surface({ id: 'markets', path: 'markets', name: 'Markets again', kind: 'module' }),
    surface({ id: 'screener', path: 'markets/screener', name: 'Screener', parent: 'markets/charts' })
  ]
  const said = checkSurfaceWiring(broken).map((one) => one.message)
  assert.equal(said.length, 2)
  assert.match(said[0], /Two screens are registered as “markets”/)
  assert.match(said[1], /Its parent “markets\/charts” is not on screen/)
})

test('a name that cannot be part of a path is found, on the screen and on what is on it', () => {
  const broken = [
    surface({
      id: 'lab',
      path: 'lab',
      name: 'Laboratory',
      controls: [control('2nd stage', 'Second stage', { type: 'boolean', description: 'Whether the second stage runs.' })],
      possibleChildren: [{ id: '', name: 'Nameless', reach: { kind: 'always' } }]
    })
  ]
  const said = checkSurfaceWiring(broken).map((one) => one.message)
  assert.equal(said.length, 2)
  assert.match(said[0], /“2nd stage” on Laboratory cannot be part of a path/)
  assert.match(said[1], /cannot be part of a path/)
})

test('a screen said to be openable twice is found, because only the first way is ever used', () => {
  const broken = [
    surface({
      id: 'settings',
      path: 'settings',
      name: 'Settings',
      controls: [control('section', 'Section', { type: 'string', description: 'Which section is open.', enum: ['account', 'notifications'] })],
      possibleChildren: [
        { id: 'notifications', name: 'Notifications', reach: { kind: 'control', control: 'section', value: 'notifications' } },
        { id: 'notifications', name: 'Notifications', reach: { kind: 'control', control: 'section', value: 'account' } }
      ]
    })
  ]
  const said = checkSurfaceWiring(broken).map((one) => one.message)
  assert.equal(said.length, 1)
  assert.match(said[0], /says twice that it can open “notifications”/)
})

test('how a screen says it was reached is checked against the screen it was reached from', () => {
  const broken = [
    surface({
      id: 'settings',
      path: 'settings',
      name: 'Settings',
      controls: [control('section', 'Section', { type: 'string', description: 'Which section is open.', enum: ['account', 'notifications'] })]
    }),
    surface({ id: 'notifications', path: 'settings/notifications', name: 'Notifications', parent: 'settings', reach: { kind: 'control', control: 'tab', value: 'notifications' } })
  ]
  const said = checkSurfaceWiring(broken).map((one) => one.message)
  assert.equal(said.length, 1)
  assert.match(said[0], /Settings has no control of that name/)
})

test('a way in only a person can take is not a fault', () => {
  const fine = [
    surface({
      id: 'chess',
      path: 'chess',
      name: 'Chess World',
      possibleChildren: [{ id: 'tournament', name: 'Tournament', reach: { kind: 'manual', how: 'join one from the lobby first' } }]
    })
  ]
  assert.deepEqual(checkSurfaceWiring(fine), [])
})

/*
 * The way into a screen that is not open and does not live inside the thing that opens it.
 *
 * Every Orbis module is like this: the window shell is the only thing that can show Markets, and Markets registers
 * itself at the top level rather than inside the shell. Before `opens` existed the protocol could not say that, so
 * the first segment of every path into a closed module answered “nothing on screen is called markets”.
 */
const shellOnly = (): SurfaceTree => [
  surface({
    id: 'window',
    path: 'window',
    name: 'The Orbis window',
    kind: 'module',
    controls: [control('screen', 'What is on screen', { type: 'string', description: 'Which screen is in front.', enum: ['chat', 'markets', 'arcade'] }, { value: 'chat' })],
    possibleChildren: [
      { id: 'chat', name: 'Conversation', reach: { kind: 'control', control: 'screen', value: 'chat' } },
      { id: 'markets', name: 'Markets', kind: 'module', reach: { kind: 'control', control: 'screen', value: 'markets' }, opens: 'markets' },
      { id: 'games', name: 'Arcade', kind: 'module', reach: { kind: 'control', control: 'screen', value: 'arcade' }, opens: 'games' }
    ]
  })
]

test('a path into a closed module starts by asking the one screen that can show it', () => {
  const plan = planNextStep(shellOnly(), 'markets/screener')
  assert.equal(plan.arrived, false)
  assert.deepEqual(plan.next, { path: 'markets', name: 'Markets', reach: { kind: 'control', control: 'screen', value: 'markets' }, on: 'window' })
})

test('the screen is waited for where it really appears, not underneath whatever opened it', () => {
  // The registry calls the arcade “arcade” and the arcade calls its own screen Games. Waiting at window/games, or at
  // arcade, would be waiting for something that never arrives while the module is open and working.
  const plan = planNextStep(shellOnly(), 'games/snake')
  assert.equal(plan.next?.path, 'games')
  assert.deepEqual(plan.next?.reach, { kind: 'control', control: 'screen', value: 'arcade' })
})

test('a module nothing on screen can show is said to be missing, with what can be shown', () => {
  const plan = planNextStep(shellOnly(), 'thermostat/calibration')
  assert.equal(plan.next, null)
  assert.match(plan.stuck ?? '', /Nothing on screen is called “thermostat”/)
  assert.match(plan.stuck ?? '', /There is: window, markets, games/)
})

test('a way in that does not say where the screen appears is a fault rather than a wait with no end', () => {
  const broken = [
    surface({
      id: 'window',
      path: 'window',
      name: 'The Orbis window',
      controls: [control('screen', 'What is on screen', { type: 'string', description: 'Which screen is in front.', enum: ['chat', 'markets'] })],
      possibleChildren: [{ id: 'markets', name: 'Markets', reach: { kind: 'control', control: 'screen', value: 'markets' }, opens: '' }]
    })
  ]
  const said = checkSurfaceWiring(broken).map((one) => one.message)
  assert.equal(said.length, 1)
  assert.match(said[0], /appears somewhere other than inside it, and does not say where/)
})
