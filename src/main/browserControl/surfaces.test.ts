import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandResult } from '../../shared/browserControl.ts'
import type { NotificationsConfig } from '../../shared/experience.ts'
import { DEFAULT_NOTIFICATIONS } from '../../shared/experience.ts'
import type { SurfaceDescriptor, SurfaceOutcome } from '../../shared/surfaces.ts'
import { answerSurfaceCall } from '../../renderer/src/lib/surfaces/answer.ts'
import { forgetSurfaces, registerSurface, surfacesDrawn } from '../../renderer/src/lib/surfaces/registry.ts'
import { notificationsSurface, settingsSurface } from '../../renderer/src/components/settingsSurfaces.ts'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * The whole chain, driven end to end: a capability in the main process, the bridge, the register in the window, and
 * two real screens' own getters and setters.
 *
 * What is missing is the one hop that needs an application -- `control:window-run` between the two processes -- and it
 * is replaced here by a function that turns everything into text and back again, which is what that hop does to a
 * value. Everything else is the real thing: the real registry with its real approval, retry, verification and undo,
 * the real six capabilities, the real answering code, the real register, and the real declarations that
 * `SettingsModal.tsx` and `NotificationSettings.tsx` register.
 *
 * React is not here, so the two screens are stood up the way React stands them up: state in a variable, a setter that
 * changes it and then says the screen has drawn, and a page that is registered when its section is open and taken
 * away when it is not.
 */

/** Everything over the wire is text and back, because that is what the hop between the two processes does to it. */
const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

interface Told {
  id: string
  read: boolean
}

/** The two screens, as React would hold them: state, setters, and "this has drawn". */
function screens(): {
  control: BrowserControl
  settings: { section: string; search: string; closed: boolean }
  notifications: { config: NotificationsConfig | null; told: Told[]; shows: boolean | null; tests: number }
  closeNotifications(): void
  asks: string[]
  approve: boolean
} {
  forgetSurfaces()
  const settings = { section: 'account', search: '', closed: false }
  const notifications = { config: null as NotificationsConfig | null, told: [{ id: 'a', read: false }, { id: 'b', read: true }] as Told[], shows: null as boolean | null, tests: 0 }
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
          { id: 'downloads', label: 'Downloads', what: 'When a download finishes or fails.' },
          { id: 'f1', label: 'F1', what: 'When a session is about to start.' }
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
      // The page inside Settings is mounted and unmounted by which section is open, which is what the real dialog does.
      openSection: (id) => {
        settings.section = id
        if (id === 'notifications') openPage()
        else closePage()
        surfacesDrawn()
      },
      search: () => settings.search,
      setSearch: (text) => {
        settings.search = text
        surfacesDrawn()
      },
      close: () => {
        settings.closed = true
        surfacesDrawn()
      },
      licencesOpen: () => false
    })
  )

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
    closeNotifications: closePage,
    asks,
    get approve() {
      return state.approve
    },
    set approve(value: boolean) {
      state.approve = value
    }
  }
}

const run = (world: ReturnType<typeof screens>, capability: string, params: Record<string, unknown>, source: 'user' | 'orion' = 'user'): Promise<CommandResult> =>
  world.control.execute(
    { capability, params, source },
    {
      confirm: async (request) => {
        world.asks.push(request.action)
        return world.approve
      }
    }
  )

test('the tree is what the screens say, and an empty answer says which empty it is', async () => {
  const world = screens()
  const got = await run(world, 'screen.tree', {})
  assert.equal(got.ok, true)
  const data = got.data as { surfaces: SurfaceDescriptor[]; count: number; registered: number }
  assert.deepEqual(
    data.surfaces.map((one) => one.path),
    ['settings']
  )
  assert.equal(data.registered, 1)
  /*
   * The page inside Settings is not open, so it is not in the tree -- and Settings says it could be opened.
   *
   * What it can open is whatever has a panel that says what is on it (`CONTROLLABLE_SECTIONS`), so this asks whether
   * Notifications is among them rather than for the whole list. Written as the whole list, this failed the day
   * somebody made a second section controllable -- which is the day it should have passed hardest.
   */
  assert.ok(
    data.surfaces[0].possibleChildren?.some((one) => one.id === 'notifications'),
    'Settings says the Notifications page is one it can open'
  )

  const nowhere = await run(world, 'screen.tree', { path: 'chess' })
  assert.equal(nowhere.ok, true)
  assert.match(String((nowhere.data as { note?: string }).note), /Nothing on screen is at “chess”/)
})

test('a control is read with its range and whether it can be set', async () => {
  const world = screens()
  const got = await run(world, 'screen.read', { path: 'settings/section' })
  assert.equal(got.ok, true)
  const reading = got.data as { value: unknown; readable: boolean; writable: boolean; values: string[] }
  assert.equal(reading.value, 'account')
  assert.equal(reading.readable, true)
  assert.equal(reading.writable, true)
  assert.ok(reading.values.includes('notifications'), 'the allowed values come from the screen itself')
})

test('a write is confirmed by reading the control back, and the answer says what it became', async () => {
  const world = screens()
  const got = await run(world, 'screen.write', { path: 'settings/search', value: 'password' })
  assert.equal(got.ok, true)
  assert.equal(world.settings.search, 'password', 'the screen’s own setter ran')
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.equal((got.data as SurfaceOutcome).value, 'password')
  assert.equal(got.verification?.verified, true)
  assert.match(got.verification?.detail ?? '', /Search settings is now “password”/)
})

test('a control that already holds the value is not set again, and says so', async () => {
  const world = screens()
  const got = await run(world, 'screen.write', { path: 'settings/section', value: 'account' })
  assert.equal(got.ok, true)
  assert.deepEqual(got.data, { unchanged: true })
  // "Already" rather than "now": a different and more useful thing for somebody to read.
  assert.match(got.verification?.detail ?? '', /Section is already “account”/)
})

test('a value the control cannot take is refused before anything is touched', async () => {
  const world = screens()
  const got = await run(world, 'screen.write', { path: 'settings/section', value: 'nonsense' })
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /must be one of/)
  assert.equal(world.settings.section, 'account', 'nothing changed')

  // What is written on screen, for a value whose real name is an id.
  const byLabel = await run(world, 'screen.write', { path: 'settings/section', value: 'Appearance' })
  assert.equal(byLabel.ok, true)
  assert.equal(world.settings.section, 'appearance')
})

test('getting to a control four levels in opens what has to be opened on the way', async () => {
  const world = screens()
  const got = await run(world, 'screen.goTo', { path: 'settings/notifications/quietHours' })
  assert.equal(got.ok, true, got.error?.message)
  const where = got.data as { path: string; opened: string[]; alreadyThere: boolean }
  assert.deepEqual(where.opened, ['settings/notifications'], 'it opened the page nobody mentioned')
  assert.equal(where.alreadyThere, false)
  assert.equal(world.settings.section, 'notifications')
  assert.match(got.verification?.detail ?? '', /Orbis opened settings\/notifications/)

  // Asked again, nothing is opened and it says so rather than claiming to have done something.
  const again = await run(world, 'screen.goTo', { path: 'settings/notifications' })
  assert.equal((again.data as { alreadyThere: boolean }).alreadyThere, true)
})

test('a page Orbis cannot open is said to be that, with what it can open', async () => {
  const world = screens()
  // Voice is a real section and nothing on it has said what can be done there, so it is not somewhere to go.
  const got = await run(world, 'screen.goTo', { path: 'settings/voice' })
  assert.equal(got.ok, false)
  assert.equal(got.error?.code, 'not-found')
  assert.match(got.error?.message ?? '', /Settings cannot open anything called “voice”\. It can open: /)
  assert.match(got.error?.message ?? '', /notifications/, 'and it says what it can open instead')
})

test('something already open is found however it was named', async () => {
  const world = screens()
  world.notifications.config = { ...DEFAULT_NOTIFICATIONS }
  await run(world, 'screen.goTo', { path: 'settings/notifications' })

  // A level left out and the words from the screen rather than the code: still where it already is, nothing opened.
  const loose = await run(world, 'screen.goTo', { path: 'settings/quiet hours' })
  assert.equal(loose.ok, true, loose.error?.message)
  assert.deepEqual(loose.data, { path: 'settings/notifications', opened: [], alreadyThere: true })
})

test('a control on a page that has not loaded says it could not be read, not that it is off', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'settings/section', value: 'notifications' })
  const got = await run(world, 'screen.read', { path: 'settings/notifications/quietHours' })
  assert.equal(got.ok, true)
  const reading = got.data as { readable: boolean; value: unknown; note?: string }
  assert.equal(reading.readable, false)
  assert.equal(reading.value, null, 'never a false that nobody chose')
  assert.match(reading.note ?? '', /could not be read/)

  // And it cannot be set either, with the reason rather than a type error.
  const refused = await run(world, 'screen.write', { path: 'settings/notifications/quietHours', value: true })
  assert.equal(refused.ok, false)
  assert.match(refused.error?.message ?? '', /has not finished loading/)
})

test('the whole way through: open the page, turn quiet hours on, then set the hour it could not take before', async () => {
  const world = screens()
  world.notifications.config = { ...DEFAULT_NOTIFICATIONS, quietHours: { ...DEFAULT_NOTIFICATIONS.quietHours } }

  const there = await run(world, 'screen.goTo', { path: 'settings/notifications' })
  assert.equal(there.ok, true, there.error?.message)

  // While quiet hours are off, the hours cannot be set -- and the refusal says what would fix it.
  const tooSoon = await run(world, 'screen.write', { path: 'settings/notifications/quietFrom', value: '23:15' })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /Turn quietHours on first/)

  const on = await run(world, 'screen.write', { path: 'settings/notifications/quiet hours', value: 'on' })
  assert.equal(on.ok, true, on.error?.message)
  assert.equal(world.notifications.config?.quietHours.enabled, true)
  assert.match(on.verification?.detail ?? '', /read “on” as on/)

  const from = await run(world, 'screen.write', { path: 'settings/notifications/quietFrom', value: '23:15' })
  assert.equal(from.ok, true, from.error?.message)
  assert.equal(world.notifications.config?.quietHours.from, '23:15')

  // A switch per kind, found by what it is called on screen rather than by its id.
  const kind = await run(world, 'screen.write', { path: 'settings/notifications/Waiting for you', value: false })
  assert.equal(kind.ok, true, kind.error?.message)
  assert.equal(world.notifications.config?.categories.attention, false)

  const state = await run(world, 'screen.state', { path: 'settings/notifications' })
  assert.deepEqual((state.data as { state: { values: Record<string, unknown> } }).state.values, {
    told: 2,
    unread: 1,
    showsNotifications: 'not checked yet',
    quietHours: '23:15 to 07:00'
  })
})

test('a write can be put back, through the same door it was made', async () => {
  const world = screens()
  world.notifications.config = { ...DEFAULT_NOTIFICATIONS, quietHours: { enabled: true, from: '22:00', to: '07:00' } }
  await run(world, 'screen.goTo', { path: 'settings/notifications' })
  await run(world, 'screen.write', { path: 'settings/notifications/quietFrom', value: '01:30' })
  assert.equal(world.notifications.config?.quietHours.from, '01:30')

  const offer = world.control.undoHistory()[0]
  assert.match(offer.what, /Set settings\/notifications\/quietFrom to 01:30/)
  const back = await world.control.undoLast({ confirm: async () => true })
  assert.equal(back.ok, true, back.message)
  assert.equal(world.notifications.config?.quietHours.from, '22:00', 'the value it really had before')
})

test('an action says whether the screen confirmed it, in the screen’s own words', async () => {
  const world = screens()
  world.notifications.config = { ...DEFAULT_NOTIFICATIONS }
  await run(world, 'screen.goTo', { path: 'settings/notifications' })

  const sent = await run(world, 'screen.do', { path: 'settings/notifications/sendTest' })
  assert.equal(sent.ok, true, sent.error?.message)
  assert.equal(world.notifications.tests, 1, 'done once, not twice')
  assert.equal((sent.data as SurfaceOutcome).status, 'completed')
  assert.equal(sent.verification?.detail, 'A test notification was shown.')

  const marked = await run(world, 'screen.do', { path: 'settings/notifications/markAllRead' })
  assert.equal(marked.ok, true, marked.error?.message)
  assert.equal(marked.verification?.detail, 'Nothing is unread now.')
})

test('an action the screen says always asks is not done until the person says so', async () => {
  const world = screens()
  world.notifications.config = { ...DEFAULT_NOTIFICATIONS }
  await run(world, 'screen.goTo', { path: 'settings/notifications' })

  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'settings/notifications/clearAll' }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.equal(world.notifications.told.length, 2, 'nothing was cleared')
  assert.deepEqual(world.asks, ['Do settings/notifications/clearAll in Orbis'])

  world.approve = true
  const done = await run(world, 'screen.do', { path: 'settings/notifications/clearAll' }, 'orion')
  assert.equal(done.ok, true, done.error?.message)
  assert.equal(world.notifications.told.length, 0)
  assert.equal(done.verification?.detail, 'The list is empty.')
})

test('a write that does not take is reported as that, not as done', async () => {
  const world = screens()
  let pretend = 1
  registerSurface(() => ({
    id: 'pretend',
    parent: null,
    name: 'A screen that ignores you',
    controls: {
      // A setter that saves nothing: a disabled control, a handler that dropped the value, a screen going away.
      ignored: { name: 'Ignored', spec: { type: 'integer', description: 'Looks settable.', min: 0, max: 10 }, get: () => pretend, set: () => undefined },
      kept: { name: 'Kept', spec: { type: 'integer', description: 'Really settable.', min: 0, max: 10 }, get: () => pretend, set: (value) => void (pretend = Number(value)) }
    }
  }))

  const ignored = await run(world, 'screen.write', { path: 'pretend/ignored', value: 7 })
  assert.equal(ignored.ok, false, 'a control that ignored the value must not report success')
  assert.equal(ignored.error?.code, 'verification-failed')
  assert.match(ignored.error?.message ?? '', /was set to 7 and it reads 1 — the same as before/)

  const kept = await run(world, 'screen.write', { path: 'pretend/kept', value: 7 })
  assert.equal(kept.ok, true, kept.error?.message)
  assert.equal(pretend, 7)

  // And the range is the screen's own, checked before anything is set.
  const tooBig = await run(world, 'screen.write', { path: 'pretend/kept', value: 99 })
  assert.equal(tooBig.ok, false)
  assert.match(tooBig.error?.message ?? '', /at most 10/)
  assert.equal(pretend, 7, 'nothing was touched')
})

test('a screen that has gone stops being offered', async () => {
  const world = screens()
  world.notifications.config = { ...DEFAULT_NOTIFICATIONS }
  await run(world, 'screen.goTo', { path: 'settings/notifications' })
  assert.equal((await run(world, 'screen.read', { path: 'settings/notifications/quietHours' })).ok, true)

  world.closeNotifications()
  const gone = await run(world, 'screen.read', { path: 'settings/notifications/quietHours' })
  assert.equal(gone.ok, false)
  assert.equal(gone.error?.code, 'not-found')
  assert.match(gone.error?.message ?? '', /Settings has nothing called “notifications”/)
})

test('a screen that cannot even describe itself is said out loud, not quietly left out', async () => {
  const world = screens()
  registerSurface(() => {
    throw new Error('its own state is not ready')
  })
  const got = await run(world, 'screen.tree', {})
  assert.equal(got.ok, true)
  const data = got.data as { surfaces: SurfaceDescriptor[]; registered: number; broken?: string[] }
  assert.deepEqual(
    data.surfaces.map((one) => one.path),
    ['settings'],
    'the ones that can describe themselves still answer'
  )
  // Two are registered and one is in the tree: the difference is said rather than being left to be noticed.
  assert.equal(data.registered, 2)
  assert.deepEqual(data.broken, ['A screen could not say what it offers: its own state is not ready'])
})

test('what is on screen is in the state Orion is given, shallow', async () => {
  const world = screens()
  const snapshot = (await world.control.snapshot(['screens'])) as { screens: { registered: number; screens: { path: string; controls: number; canOpen: string[] }[] } }
  assert.equal(snapshot.screens.registered, 1)
  const [said] = snapshot.screens.screens
  // `canOpen` is left out of this comparison and asked about on its own: it grows as panels say what is on them.
  assert.deepEqual({ ...said, canOpen: undefined }, { path: 'settings', name: 'Settings', kind: 'module', activity: 'idle', controls: 2, actions: 1, canOpen: undefined })
  assert.ok(said.canOpen.includes('notifications'))
})

test('switching the kind off takes it away from Orion and leaves it for the person', async () => {
  const world = screens()
  world.control.setSwitchedOff(['screens'])
  const refused = await run(world, 'screen.read', { path: 'settings/section' }, 'orion')
  assert.equal(refused.ok, false)
  assert.equal(refused.error?.code, 'blocked')
  assert.equal((await run(world, 'screen.read', { path: 'settings/section' }, 'user')).ok, true)
})
