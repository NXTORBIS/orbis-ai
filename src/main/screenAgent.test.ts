import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NotificationsConfig } from '../shared/experience.ts'
import { DEFAULT_NOTIFICATIONS } from '../shared/experience.ts'
import type { SurfaceDeclaration } from '../renderer/src/lib/surfaces/registry.ts'
import { forgetSurfaces, registerSurface, surfacesDrawn } from '../renderer/src/lib/surfaces/registry.ts'
import { answerSurfaceCall } from '../renderer/src/lib/surfaces/answer.ts'
import { notificationsSurface, settingsSurface } from '../renderer/src/components/settingsSurfaces.ts'
import { BrowserControl } from './browserControl/registry.ts'
import { registerSurfaceCapabilities } from './browserControl/surfaceCapabilities.ts'
import type { AskJson, ScreenAnswer } from './screenAgent.ts'
import { carryOutScreenRequest } from './screenAgent.ts'

/**
 * A sentence, carried the whole way: Orion's answer, the checking, a plan, the runner, the six capabilities, the
 * bridge, the register in the window, and two real screens' own getters and setters.
 *
 * Nothing is stubbed except the two things that are not code in this repository: the model, and the hop between the
 * two processes. The model is a function that returns the JSON a model would; the hop is `JSON.parse(JSON.stringify())`,
 * which is what crossing it does to a value. Everything in between is the real thing -- the real registry with its
 * real approvals, retries, verification and undo journal, the real `PlanRun`, the real path resolving, and the real
 * declarations that `SettingsModal.tsx` and `NotificationSettings.tsx` register.
 */

/** Everything over the wire is text and back, because that is what the hop between the two processes does to it. */
const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

interface Told {
  id: string
  read: boolean
}

/**
 * A panel with real numbers on it, which Settings has none of.
 *
 * Shaped on the engine panel in `docs/orbis-control.md`: a whole-number depth with a declared range, a decimal with
 * a much smaller one, and a chooser. The ranges are what make "a little higher" mean two different amounts on two
 * different controls, which is the whole point of working the number out from the control rather than from the
 * request.
 */
function enginePanel(state: { depth: number; seconds: number; style: string; thinking: boolean; stops: number }): SurfaceDeclaration {
  return {
    id: 'engine-panel',
    parent: 'study',
    name: 'Engine panel',
    kind: 'panel',
    keywords: ['engine', 'analysis', 'thinking'],
    controls: {
      depth: {
        name: 'Search depth',
        about: 'How many moves ahead to look.',
        spec: { type: 'integer', description: 'How many moves ahead to look.', min: 1, max: 40 },
        get: () => state.depth,
        set: (value) => {
          state.depth = Number(value)
          surfacesDrawn()
        },
        default: 18
      },
      seconds: {
        name: 'Time per move',
        spec: { type: 'number', description: 'How long the engine may think about one move.', min: 0.2, max: 2 },
        get: () => state.seconds,
        set: (value) => {
          state.seconds = Number(value)
          surfacesDrawn()
        }
      },
      style: {
        name: 'Playing style',
        spec: { type: 'string', description: 'How the engine chooses between equal moves.', enum: ['solid', 'sharp', 'wild'] },
        get: () => state.style,
        set: (value) => {
          state.style = String(value)
          surfacesDrawn()
        }
      }
    },
    actions: {
      stop: {
        name: 'Stop thinking',
        run: () => {
          state.thinking = false
          state.stops += 1
          return { stopped: true }
        },
        verify: () => ({ done: !state.thinking, detail: 'The engine has stopped.' })
      }
    },
    state: () => ({ activity: state.thinking ? 'running' : 'idle', detail: state.thinking ? `Looking ${state.depth} moves ahead` : undefined })
  }
}

function world(): {
  control: BrowserControl
  settings: { section: string; search: string; closed: boolean }
  notifications: { config: NotificationsConfig | null; told: Told[]; shows: boolean | null; tests: number }
  engine: { depth: number; seconds: number; style: string; thinking: boolean; stops: number }
  asks: string[]
  approve: boolean
} {
  forgetSurfaces()
  const settings = { section: 'account', search: '', closed: false }
  const notifications = {
    config: { ...DEFAULT_NOTIFICATIONS, quietHours: { ...DEFAULT_NOTIFICATIONS.quietHours }, categories: { ...DEFAULT_NOTIFICATIONS.categories } } as NotificationsConfig | null,
    told: [{ id: 'a', read: false }, { id: 'b', read: true }] as Told[],
    shows: null as boolean | null,
    tests: 0
  }
  const engine = { depth: 18, seconds: 0.8, style: 'solid', thinking: true, stops: 0 }
  let page: (() => void) | null = null

  const openPage = (): void => {
    if (page) return
    page = registerSurface(() =>
      notificationsSurface({
        settings: () => {
          if (!notifications.config) throw new Error('This page has not finished loading.')
          return notifications.config
        },
        save: (next) => {
          notifications.config = next
          surfacesDrawn()
        },
        categories: [
          { id: 'attention', label: 'Waiting for you', what: 'When Orbis cannot go on without you.' },
          { id: 'downloads', label: 'Downloads', what: 'When a download finishes or fails.' }
        ],
        told: () => ({ total: notifications.told.length, unread: notifications.told.filter((one) => !one.read).length }),
        shows: () => notifications.shows,
        test: async () => {
          notifications.tests += 1
          return { ok: true, message: 'A test notification was shown.' }
        },
        markAllRead: async () => {
          notifications.told = notifications.told.map((one) => ({ ...one, read: true }))
          surfacesDrawn()
        },
        clearAll: async () => {
          notifications.told = []
          surfacesDrawn()
        },
        check: async () => ({ total: notifications.told.length, unread: notifications.told.filter((one) => !one.read).length })
      })
    )
    surfacesDrawn()
  }
  const closePage = (): void => {
    page?.()
    page = null
    surfacesDrawn()
  }

  registerSurface(() =>
    settingsSurface({
      section: () => settings.section,
      openSection: (id) => {
        settings.section = id
        if (id === 'notifications') openPage()
        else closePage()
        surfacesDrawn()
      },
      search: () => settings.search,
      setSearch: (value) => {
        settings.search = value
        surfacesDrawn()
      },
      close: () => {
        settings.closed = true
        surfacesDrawn()
      },
      licencesOpen: () => false
    })
  )

  // A module with a page inside it and the panel inside that, so a walk has somewhere real to walk to.
  registerSurface(() => ({ id: 'study', parent: null, name: 'Study', kind: 'module', keywords: ['chess', 'board'], possibleChildren: [{ id: 'engine-panel', name: 'Engine panel', kind: 'panel', reach: { kind: 'always' } }] }))
  registerSurface(() => enginePanel(engine))

  const asks: string[] = []
  const state = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })

  return {
    control,
    settings,
    notifications,
    engine,
    asks,
    get approve() {
      return state.approve
    },
    set approve(value: boolean) {
      state.approve = value
    }
  }
}

/** A model that answers with exactly this, once per call, so what reaches the checking is what a model would send. */
const model = (...answers: (Record<string, unknown> | null)[]): { ask: AskJson; seen: string[] } => {
  const seen: string[] = []
  let at = 0
  return {
    seen,
    ask: async (_system, user) => {
      seen.push(user)
      return answers[Math.min(at++, answers.length - 1)] ?? null
    }
  }
}

const drive = (w: ReturnType<typeof world>, request: string, ask: AskJson, context: Parameters<typeof carryOutScreenRequest>[2] = {}): Promise<ScreenAnswer> =>
  carryOutScreenRequest(request, {
    control: w.control,
    ask,
    confirm: async (what) => {
      w.asks.push(what.action)
      return w.approve
    }
  }, context)

// ---------------------------------------------------------------- what goes into the request

test('only the screens the request is about are shown, with every control’s type, range and value', async () => {
  const w = world()
  const m = model({ say: 'nothing', steps: [] })
  await drive(w, 'turn the search depth up a little', m.ask)

  const sent = m.seen[0]
  assert.match(sent, /study\/engine-panel — Engine panel \(panel\)/)
  // The type, the real range and what it holds right now, from the screen's own spec and its own getter.
  assert.match(sent, /control depth “Search depth” integer range 1 to 40 = 18 \(back to 18\)/)
  assert.match(sent, /control style “Playing style” string one of: solid \| sharp \| wild = “solid”/)
  // Its parent came too, so the path reads whole, and Settings did not: it has nothing to do with search depth.
  assert.match(sent, /study — Study \(module\)/)
  assert.doesNotMatch(sent, /control quietHours/)
  // And what is open at all, so "Orbis has no such thing" can be said with evidence rather than asserted.
  assert.match(sent, /Everything open, by path: settings — Settings; study — Study; study\/engine-panel — Engine panel/)
  // And what is not open, said as not known rather than left out, which is the one honest gap in discovery.
  assert.match(sent, /what is on it is not known until it is opened:.*settings\/notifications — Notifications/)
})

test('a control whose screen cannot answer is shown as unreadable, never as a value nobody set', async () => {
  const w = world()
  w.notifications.config = null
  await drive(w, 'is quiet hours on', model({ say: '', steps: [] }).ask)
  const m = model({ say: '', steps: [] })
  await drive(w, 'set the section to notifications', m.ask)
  // Open the page so its controls are in the tree, then look at what a model would be shown about them.
  await w.control.execute({ capability: 'screen.write', params: { path: 'settings/section', value: 'notifications' }, source: 'user' }, { confirm: async () => true })
  const after = model({ say: '', steps: [] })
  await drive(w, 'quiet hours', after.ask)
  assert.match(after.seen[0], /control quietHours “Quiet hours” boolean = \(could not be read: Its value could not be read: This page has not finished loading\.\)/)
})

// ---------------------------------------------------------------- the three requests, end to end

test('REQUEST 1 — “turn quiet hours on”: walks to a page nobody named, sets it, and confirms it by reading back', async () => {
  const w = world()
  const answer = await drive(
    w,
    'turn quiet hours on please',
    model({
      say: 'Turning quiet hours on.',
      steps: [
        { op: 'open', path: 'settings/notifications', why: 'Open the Notifications page' },
        { op: 'set', path: 'settings/notifications/quietHours', value: true, why: 'Turn quiet hours on' }
      ]
    }).ask
  )

  assert.equal(answer.kind, 'done')
  assert.equal(answer.confirmed, true)
  assert.equal(w.notifications.config?.quietHours.enabled, true, 'the screen’s own setter ran')
  assert.equal(w.settings.section, 'notifications', 'and Settings really moved to the page')
  assert.deepEqual(answer.steps?.map((one) => [one.capability, one.status]), [
    ['screen.goTo', 'confirmed'],
    ['screen.write', 'confirmed']
  ])
  assert.match(answer.text, /Notifications is open\. Orbis opened settings\/notifications to get there\./)
  assert.match(answer.text, /Quiet hours is now on\./)
})

test('REQUEST 2 — “turn the search depth up a little”: the number comes from the control’s own range, not the model', async () => {
  const w = world()
  const answer = await drive(w, 'turn the search depth up a little', model({ say: 'Nudging the depth up.', steps: [{ op: 'nudge', path: 'study/engine-panel/depth', direction: 'up', size: 'little', why: 'Raise the search depth a little' }] }).ask)

  assert.equal(answer.kind, 'done')
  assert.equal(answer.confirmed, true)
  // A tenth of 1-to-40 is four, from 18. Nothing in the model's answer contained a number at all.
  assert.equal(w.engine.depth, 22)
  assert.deepEqual(answer.outline, ['Raise the search depth a little — up a little from 18 to 22 (its range is 1 to 40)'])
  assert.match(answer.text, /Search depth is now 22\./)

  // The same words on a control with a different range move it by a different amount, which is the point.
  const other = await drive(w, 'give it a little more time per move', model({ say: '', steps: [{ op: 'nudge', path: 'study/engine-panel/seconds', direction: 'up', size: 'little' }] }).ask)
  assert.equal(other.kind, 'done')
  assert.equal(w.engine.seconds, 0.98, 'a tenth of 0.2-to-2 is 0.18, not four')
})

test('REQUEST 3 — “set the depth to 400”: refused with the range, and nothing is touched', async () => {
  const w = world()
  const answer = await drive(w, 'set the search depth to 400', model({ say: 'Setting the depth.', steps: [{ op: 'set', path: 'study/engine-panel/depth', value: 400 }] }).ask)

  assert.equal(answer.kind, 'refused')
  assert.match(answer.text, /at most 40/)
  assert.equal(w.engine.depth, 18, 'nothing was set, and nothing was clamped to 40 either')
  assert.equal(answer.steps, undefined, 'no plan ran at all')
})

// ---------------------------------------------------------------- the rest of the behaviour

test('a question is answered from real readings and changes nothing, even when Orion proposes a change', async () => {
  const w = world()
  const answer = await drive(
    w,
    'how do I change the search depth?',
    model({
      say: 'Search depth is on the Engine panel. It is a whole number from 1 to 40 and is 18 now.',
      // A model that proposed a change anyway: the shape of the request decides, not the model's enthusiasm.
      steps: [{ op: 'set', path: 'study/engine-panel/depth', value: 30 }]
    }).ask
  )
  assert.equal(answer.kind, 'answered')
  assert.equal(w.engine.depth, 18, 'a question never sets anything')
  assert.match(answer.text, /whole number from 1 to 40/)
})

test('“what is it set to” reads the control and says the reading, not that a command was sent', async () => {
  const w = world()
  const answer = await drive(w, 'what is the playing style set to?', model({ say: '', steps: [{ op: 'read', path: 'study/engine-panel/style' }] }).ask)
  assert.equal(answer.kind, 'answered')
  assert.deepEqual(answer.steps?.map((one) => [one.capability, one.status, one.detail]), [['screen.read', 'confirmed', 'Playing style is “solid”.']])
})

test('“the second option” is counted from the control’s own list, and “the next one” from where it is now', async () => {
  const w = world()
  const second = await drive(w, 'set the playing style to the second option', model({ say: '', steps: [{ op: 'choose', path: 'study/engine-panel/style', which: 2 }] }).ask)
  assert.equal(second.kind, 'done', second.text)
  assert.equal(w.engine.style, 'sharp')
  assert.deepEqual(second.outline, ['Set Playing style to “sharp” — option 2 of 3: sharp'])

  const next = await drive(w, 'try the next one', model({ say: '', steps: [{ op: 'choose', path: 'study/engine-panel/style', which: 'next' }] }).ask)
  assert.equal(next.kind, 'done', next.text)
  assert.equal(w.engine.style, 'wild')

  // And past the end it says so rather than wrapping round to the first.
  const past = await drive(w, 'and the next one again', model({ say: '', steps: [{ op: 'choose', path: 'study/engine-panel/style', which: 'next' }] }).ask)
  assert.equal(past.kind, 'refused')
  assert.match(past.text, /already the last option, wild/)
  assert.equal(w.engine.style, 'wild')
})

test('“put it back” reads the value from the undo journal, which is a reading rather than a memory', async () => {
  const w = world()
  await drive(w, 'set the search depth to 30', model({ say: '', steps: [{ op: 'set', path: 'study/engine-panel/depth', value: 30 }] }).ask)
  assert.equal(w.engine.depth, 30)

  const back = await drive(w, 'put the depth back to what it was', model({ say: '', steps: [{ op: 'revert', path: 'study/engine-panel/depth' }] }).ask)
  assert.equal(back.kind, 'done', back.text)
  assert.equal(w.engine.depth, 18, 'the value it really held before, not the control’s default')
  assert.deepEqual(back.outline, ['Set Search depth to 18 — back to 18, which is what it held before Orbis changed it'])
})

test('a control with nothing to go back to says so instead of using its default', async () => {
  const w = world()
  const back = await drive(w, 'put the depth back', model({ say: '', steps: [{ op: 'revert', path: 'study/engine-panel/depth' }] }).ask)
  assert.equal(back.kind, 'refused')
  assert.match(back.text, /no record of what Search depth was before/)
  assert.equal(w.engine.depth, 18)
})

test('“a little more” on something that is not a number is refused with what to say instead', async () => {
  const w = world()
  await w.control.execute({ capability: 'screen.write', params: { path: 'settings/section', value: 'notifications' }, source: 'user' }, { confirm: async () => true })
  const answer = await drive(w, 'turn quiet hours up a bit', model({ say: '', steps: [{ op: 'nudge', path: 'settings/notifications/quietHours', direction: 'up', size: 'little' }] }).ask)
  assert.equal(answer.kind, 'refused')
  assert.match(answer.text, /Quiet hours holds a yes or a no, so there is nothing to turn up or down\./)
})

test('a control that cannot be set yet is refused with the thing that would fix it', async () => {
  const w = world()
  const answer = await drive(
    w,
    'make quiet hours start at 23:15',
    model({
      say: '',
      steps: [
        { op: 'open', path: 'settings/notifications' },
        { op: 'set', path: 'settings/notifications/quietFrom', value: '23:15' }
      ]
    }).ask
  )
  // The page is not open yet, so the refusal comes from running the plan rather than from checking it.
  assert.equal(answer.kind, 'done')
  assert.equal(answer.confirmed, false)
  assert.deepEqual(answer.steps?.map((one) => [one.capability, one.status]), [
    ['screen.goTo', 'confirmed'],
    ['screen.write', 'refused']
  ])
  assert.match(answer.text, /Turn quietHours on first/)
  assert.equal(w.notifications.config?.quietHours.from, DEFAULT_NOTIFICATIONS.quietHours.from, 'nothing changed')
})

test('a path that points at nothing becomes one short question with what was really there', async () => {
  const w = world()
  const answer = await drive(w, 'set the engine aggression to 5', model({ say: '', steps: [{ op: 'set', path: 'study/engine-panel/aggression', value: 5 }] }).ask)
  assert.equal(answer.kind, 'question')
  assert.match(answer.text, /Orbis cannot find “aggression”/)
  assert.deepEqual(answer.choices, ['depth', 'seconds', 'style', 'stop'])
})

test('a feature Orbis has not got is said to be missing, with nothing opened instead', async () => {
  const w = world()
  const m = model({ say: '', missing: 'Orbis has no thermostat calibration. What is on screen is Settings, Study and the Engine panel.', steps: [] })
  const answer = await drive(w, 'open the thermostat calibration panel', m.ask)
  assert.equal(answer.kind, 'nothing')
  assert.match(answer.text, /Orbis has no thermostat calibration/)
  assert.equal(w.settings.section, 'account', 'nothing was opened')
})

test('a route to somewhere no screen says it can reach is refused, however Orion worded it', async () => {
  const w = world()
  // The deterministic half of the rule above: a model that opens something near it instead of saying so is caught
  // by the route being checked, not by anybody reading its sentence.
  const answer = await drive(w, 'open the thermostat calibration panel', model({ say: 'Opening it.', steps: [{ op: 'open', path: 'settings/thermostat' }] }).ask)
  assert.equal(answer.kind, 'refused')
  assert.match(answer.text, /Settings cannot open anything called “thermostat”\. It can open: /)
  assert.equal(w.settings.section, 'account')
})

test('nothing open matching and nothing left to open is answered without asking Orion to guess', async () => {
  forgetSurfaces()
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, { ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))), open: () => true })
  // One screen, with nothing it says it can open: there is nowhere else the thing could be.
  registerSurface(() => ({ id: 'timer', parent: null, name: 'Timer', kind: 'tool', controls: { minutes: { name: 'Minutes', spec: { type: 'integer', description: 'How long.', min: 1, max: 60 }, get: () => 5, set: () => undefined } } }))
  const m = model({ say: 'opening something near it', steps: [{ op: 'open', path: 'timer' }] })
  const answer = await carryOutScreenRequest('open the thermostat calibration panel', { control, ask: m.ask, confirm: async () => true })
  assert.equal(answer.kind, 'nothing')
  assert.match(answer.text, /Orbis has nothing on screen that matches that\. What is open: timer — Timer\./)
  assert.equal(m.seen.length, 0, 'and Orion was not asked to guess')
})

test('a question with no subject is answered rather than told the feature does not exist', async () => {
  const w = world()
  const m = model({ say: 'You can change the section and the search box in Settings, and three things on the Engine panel.', steps: [] })
  const answer = await drive(w, 'what can I change here?', m.ask)
  assert.equal(answer.kind, 'answered')
  assert.equal(m.seen.length, 1, 'Orion was asked, because the request named nothing in particular')
  assert.match(m.seen[0], /control depth “Search depth”/)
})

test('Orion proposing something ambiguous ends in one question, not a guess and not a wall of options', async () => {
  const w = world()
  const answer = await drive(w, 'turn the thing up', model({ say: '', ask: 'Did you mean the search depth or the time per move?', steps: [] }).ask)
  assert.equal(answer.kind, 'question')
  assert.equal(answer.text, 'Did you mean the search depth or the time per move?')
  assert.equal(w.engine.depth, 18)
})

test('an action the screen says always asks is not done until the person says so, and the answer says it was declined', async () => {
  const w = world()
  await drive(w, 'open notifications', model({ say: '', steps: [{ op: 'open', path: 'settings/notifications' }] }).ask)
  w.approve = false
  const answer = await drive(w, 'clear the notification list', model({ say: '', steps: [{ op: 'do', path: 'settings/notifications/clearAll' }] }).ask)
  assert.equal(answer.kind, 'done')
  assert.equal(answer.confirmed, false)
  assert.equal(w.notifications.told.length, 2, 'nothing was cleared')
  assert.deepEqual(answer.steps?.map((one) => one.status), ['refused'])
  assert.match(answer.text, /The user declined/)
  assert.deepEqual(w.asks, ['Do settings/notifications/clearAll in Orbis'])
})

test('an action is reported in the screen’s own words, and only as confirmed when the screen confirmed it', async () => {
  const w = world()
  const answer = await drive(w, 'stop the engine thinking', model({ say: '', steps: [{ op: 'do', path: 'study/engine-panel/stop' }] }).ask)
  assert.equal(answer.kind, 'done')
  assert.equal(w.engine.stops, 1, 'done once, not twice')
  assert.deepEqual(answer.steps?.map((one) => [one.status, one.detail]), [['confirmed', 'The engine has stopped.']])
})

test('a “set” guarded by onlyIf reads the control again at the moment of the branch', async () => {
  const w = world()
  await drive(w, 'open notifications', model({ say: '', steps: [{ op: 'open', path: 'settings/notifications' }] }).ask)

  // Quiet hours are off, so the guarded step does not run -- and the answer says nothing was done rather than
  // claiming the time was set.
  const skipped = await drive(
    w,
    'if quiet hours are on, make them start at 23:15',
    model({ say: '', steps: [{ op: 'set', path: 'settings/notifications/quietFrom', value: '23:15', onlyIf: { path: 'settings/notifications/quietHours', is: true } }] }).ask
  )
  assert.equal(skipped.kind, 'done')
  assert.deepEqual(skipped.steps, [], 'the step inside the branch never ran, so there is nothing to report')
  assert.equal(skipped.text, 'Nothing was done.')
  assert.equal(w.notifications.config?.quietHours.from, DEFAULT_NOTIFICATIONS.quietHours.from)

  await drive(w, 'turn quiet hours on', model({ say: '', steps: [{ op: 'set', path: 'settings/notifications/quietHours', value: true }] }).ask)
  const done = await drive(
    w,
    'if quiet hours are on, make them start at 23:15',
    model({ say: '', steps: [{ op: 'set', path: 'settings/notifications/quietFrom', value: '23:15', onlyIf: { path: 'settings/notifications/quietHours', is: true } }] }).ask
  )
  assert.equal(done.kind, 'done', done.text)
  assert.equal(w.notifications.config?.quietHours.from, '23:15')
})

test('a control that already holds the value is not set again, and the answer says “already”', async () => {
  const w = world()
  const answer = await drive(w, 'set the playing style to solid', model({ say: '', steps: [{ op: 'set', path: 'study/engine-panel/style', value: 'solid' }] }).ask)
  assert.equal(answer.kind, 'done')
  assert.deepEqual(answer.steps?.map((one) => [one.status, one.detail]), [['nothing-to-do', 'Playing style is already “solid”.']])
})

test('a step Orbis cannot state the meaning of stops the whole request rather than most of it', async () => {
  const w = world()
  const answer = await drive(
    w,
    'turn the depth up somewhat and stop thinking',
    model({
      say: '',
      steps: [
        { op: 'nudge', path: 'study/engine-panel/depth', direction: 'sideways', size: 'little' },
        { op: 'do', path: 'study/engine-panel/stop' }
      ]
    }).ask
  )
  assert.equal(answer.kind, 'unavailable')
  assert.match(answer.text, /direction is "sideways" rather than up or down/)
  assert.equal(w.engine.depth, 18)
  assert.equal(w.engine.stops, 0, 'and the step after it was not done either')
})

test('Orion out of reach answers a question from the screen and refuses an instruction', async () => {
  const w = world()
  const silent: AskJson = async () => null

  const question = await drive(w, 'what is the search depth?', silent)
  assert.equal(question.kind, 'answered')
  assert.match(question.text, /Search depth is 18\. It goes from 1 to 40\. It is on Engine panel \(study\/engine-panel\/depth\)\. \(Read from the screen itself; Orion could not be reached to say more\.\)/)

  const instruction = await drive(w, 'set the search depth to 30', silent)
  assert.equal(instruction.kind, 'unavailable')
  assert.equal(w.engine.depth, 18)
})

test('switching the kind off stops Orion using the screens, and says where that was done', async () => {
  const w = world()
  w.control.setSwitchedOff(['screens'])
  const answer = await drive(w, 'turn the search depth up a little', model({ say: '', steps: [] }).ask)
  assert.equal(answer.kind, 'unavailable')
  assert.match(answer.text, /switched off in Settings → What Orion may do/)
})

test('no screen having said anything is a different answer from no screen matching', async () => {
  forgetSurfaces()
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, { ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))), open: () => true })
  const answer = await carryOutScreenRequest('turn the depth up', { control, ask: async () => null, confirm: async () => true })
  assert.equal(answer.kind, 'nothing')
  assert.match(answer.text, /No Orbis screen has said what can be done on it/)
})
