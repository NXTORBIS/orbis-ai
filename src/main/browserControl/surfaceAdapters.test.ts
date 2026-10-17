import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandResult } from '../../shared/browserControl.ts'
import type { ExperienceConfig } from '../../shared/experience.ts'
import { defaultConfig, normalizeConfig } from '../../shared/experience.ts'
import { BUILT_IN_PRESETS } from '../../shared/presets.ts'
import { BUILT_IN_THEMES } from '../../shared/themes.ts'
import type { AppFeature } from '../../shared/commandCenter.ts'
import type { Intent, NavState } from '../../shared/navigation.ts'
import { INITIAL_NAV, navReducer } from '../../shared/navigation.ts'
import type { SurfaceDescriptor, SurfaceOutcome } from '../../shared/surfaces.ts'
import { answerSurfaceCall } from '../../renderer/src/lib/surfaces/answer.ts'
import { forgetSurfaces, registerSurface, surfacesDrawn } from '../../renderer/src/lib/surfaces/registry.ts'
import { SETTINGS_SECTIONS } from '../../shared/settingsSections.ts'
import { settingsSurface } from '../../renderer/src/components/settingsSurfaces.ts'
import { appearanceSurface, customizeSurface, ACCENTS, ORBIS_OWN } from '../../renderer/src/components/appearanceSurfaces.ts'
import { accountSurface, browsingSurface, orionSurface } from '../../renderer/src/components/settingsSectionSurfaces.ts'
import { AVATARS } from '../../shared/avatars.ts'
import { MODELS } from '../../shared/models.ts'
import { chatSurface, shellSurface } from '../../renderer/src/components/shellSurfaces.ts'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * The window shell, Settings → Appearance and the Customize centre, driven end to end: a capability in the main
 * process, the bridge, the register in the window, and the real declarations those three screens hand it.
 *
 * What is missing is the two things that need a running Orbis, and both are replaced by something that behaves the
 * same way. `control:window-run` between the processes becomes a function that turns everything into text and back,
 * which is what that hop does to a value. React becomes what React does: state in a variable, a setter that changes
 * it and then says the screen has drawn, and a screen that is registered while it is on screen and taken away when
 * it is not -- including the Customize centre, which is loaded with its section and so turns up a moment late.
 *
 * Everything else is the real thing: the real registry with its real approval, retry, verification and undo, the real
 * six capabilities, the real answering code, the real register, and the real declarations in `shellSurfaces.ts` and
 * `appearanceSurfaces.ts`.
 */

/** Everything over the wire is text and back, because that is what the hop between the two processes does to it. */
const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

interface Options {
  /** The Customize centre has not read the stored configuration yet, so its getters cannot answer. */
  loading?: boolean
  /** How long the Customize centre takes to say what is on it after its section opens. */
  loadMs?: number
  /** A store that quietly will not keep something, for proving that Apply is checked rather than assumed. */
  refuse?(config: ExperienceConfig): ExperienceConfig
}

/**
 * Screens that are still on their way, from a world this one has replaced.
 *
 * Cleared before anything else, and the reason is worth writing down: the register is one register for the whole
 * program, and a part of a screen that loads after a moment goes on loading after its test has finished. Left
 * running, it registered itself into the NEXT test's register -- a second Customize centre, on the same path,
 * holding the previous test's configuration, and the newer registration is the one that answers. Three tests failed
 * that way and every one of them looked like a fault in the thing being tested.
 */
const loadingScreens = new Set<ReturnType<typeof setTimeout>>()

function screens(options: Options = {}) {
  for (const timer of loadingScreens) clearTimeout(timer)
  loadingScreens.clear()
  forgetSurfaces()
  const loadMs = options.loadMs ?? 200

  // ---------------------------------------------------------------- what the main process stores
  /*
   * What the settings service holds. One object, written through one function, the way one service is one service.
   *
   * The browsing switches start as they really start -- all off except Visual Search, which is on unless somebody
   * turned it off -- so a test about turning one on is a test about a change and not about a value that was already
   * there.
   */
  const prefs: Record<string, unknown> = {
    theme: 'system',
    effects: true,
    defaultModel: MODELS[0].id,
    autoFallback: true,
    reasoningEffort: 'high',
    userAvatar: '',
    showResearchPlan: false,
    openBrowserOnLaunch: false,
    keepSchedulesRunning: false,
    wakeForSchedules: false,
    searchSuggestions: false,
    visualSearch: true,
    personalizedSuggestions: false
  }
  /** The names and the instructions as the boxes show them: a draft, saved as soon as one is set. */
  const boxes = { assistantName: 'Orbis', userName: 'NxtOrbis', userTitle: '', instructions: '' }
  const settingsWrites: Record<string, unknown>[] = []
  const updateSettings = (patch: Record<string, unknown>): void => {
    settingsWrites.push(patch)
    Object.assign(prefs, patch)
    surfacesDrawn()
  }

  const store = { config: defaultConfig(), saves: 0 }
  const saveExperience = (next: ExperienceConfig): ExperienceConfig => {
    store.saves += 1
    // Read back through the real rules, the way the store does: a value it will not take does not get stored.
    store.config = normalizeConfig(options.refuse ? options.refuse(next) : next)
    return store.config
  }

  // ---------------------------------------------------------------- the window shell
  let nav: NavState = INITIAL_NAV
  const shell = {
    sidebar: true,
    settingsAt: null as string | null,
    activity: false,
    palette: false,
    shortcuts: false,
    notices: ['a downloaded file', 'a run that finished'],
    unread: 1,
    webSearch: false,
    /** How many times the main process was told to put the browser behind. */
    behind: 0
  }
  const go = (intent: Intent): void => {
    nav = navReducer(nav, intent)
    surfacesDrawn()
  }
  /** The stand-in for `showScreen` in App.tsx: the same order, with the browser told to go behind. */
  const show = (what: string): void => {
    if (what === 'browser') return go({ kind: 'browser' })
    if (nav.browserLaunched && nav.surface.kind === 'browser') shell.behind += 1
    if (what === 'chat') return go({ kind: 'chat' })
    if (what === 'images') return go({ kind: 'images' })
    go({ kind: 'feature', id: what as AppFeature })
  }

  // ---------------------------------------------------------------- the conversation
  const chat = {
    model: 'openai/gpt-oss-20b',
    incognito: false,
    open: { id: 'c1', title: 'Pancakes', messages: 2, replying: false } as { id: string; title: string; messages: number; replying: boolean } | null,
    chats: 3,
    searched: 0,
    stopped: 0
  }

  // ---------------------------------------------------------------- the Customize centre
  const customize = {
    category: 'appearance',
    /** What is being shown, kept or not. Null until the stored configuration has been read. */
    draft: (options.loading ? null : defaultConfig()) as ExperienceConfig | null,
    saved: defaultConfig()
  }
  const draft = (): ExperienceConfig => {
    if (!customize.draft) throw new Error('This screen has not finished reading what is stored.')
    return customize.draft
  }
  /** `change` in CustomizeView: shown at once, kept by nothing. */
  const change = (next: ExperienceConfig): void => {
    customize.draft = next
    surfacesDrawn()
  }

  // ---------------------------------------------------------------- mounting, as React does it
  let offSettings: (() => void) | null = null
  let offAppearance: (() => void) | null = null
  let offCustomize: (() => void) | null = null
  let loading: ReturnType<typeof setTimeout> | null = null

  const mountCustomize = (): void => {
    if (offCustomize || loading) return
    // Loaded with its section rather than with the window, so it says what is on it a moment after the section opens.
    loading = setTimeout(() => {
      loadingScreens.delete(loading!)
      loading = null
      offCustomize = registerSurface(() =>
        customizeSurface({
          embedded: true,
          categories: [
            { id: 'presets', label: 'Presets' },
            { id: 'appearance', label: 'Appearance' },
            { id: 'themes', label: 'Themes' },
            { id: 'newTab', label: 'New tab' },
            { id: 'accessibility', label: 'Accessibility' },
            { id: 'performance', label: 'Performance' },
            { id: 'privacy', label: 'Privacy' }
          ],
          resettable: [
            { id: 'appearance', label: 'Appearance' },
            { id: 'themes', label: 'Themes' },
            { id: 'newTab', label: 'New tab' },
            { id: 'accessibility', label: 'Accessibility' },
            { id: 'performance', label: 'Performance' },
            { id: 'privacy', label: 'Privacy' }
          ],
          accents: ACCENTS,
          category: () => customize.category,
          openCategory: (id) => {
            customize.category = id
            surfacesDrawn()
          },
          draft,
          saved: () => customize.saved,
          change,
          changeAppearance: (patch) => change({ ...draft(), appearance: { ...draft().appearance, ...patch } }),
          apply: async () => {
            const kept = saveExperience(draft())
            customize.saved = kept
            surfacesDrawn()
          },
          cancel: () => change(customize.saved),
          resetSection: async (id) => {
            const fresh = defaultConfig() as unknown as Record<string, unknown>
            const kept = saveExperience({ ...draft(), [id]: fresh[id] } as ExperienceConfig)
            customize.saved = kept
            change(kept)
          },
          savePreset: () => {
            const mine = { ...BUILT_IN_PRESETS[0], id: 'preset-mine', name: 'My preset', builtIn: false }
            change({ ...draft(), presets: [...draft().presets, mine], activePresetId: mine.id })
          },
          check: async () => store.config
        })
      )
      surfacesDrawn()
    }, loadMs)
    loadingScreens.add(loading)
    loading.unref?.()
  }
  const unmountCustomize = (): void => {
    if (loading) {
      clearTimeout(loading)
      loadingScreens.delete(loading)
      loading = null
    }
    offCustomize?.()
    offCustomize = null
  }

  const mountAppearance = (): void => {
    if (!offAppearance) {
      offAppearance = registerSurface(() =>
        appearanceSurface({
          themes: ['system', 'light', 'dark'],
          theme: () => String(prefs.theme),
          setTheme: (value) => updateSettings({ theme: value }),
          effects: () => prefs.effects === true,
          setEffects: (on) => updateSettings({ effects: on }),
          // The window writes this on the document; here it is what that would say.
          showing: () => (prefs.theme === 'system' ? 'dark' : String(prefs.theme))
        })
      )
    }
    mountCustomize()
  }
  const unmountAppearance = (): void => {
    unmountCustomize()
    offAppearance?.()
    offAppearance = null
  }

  /**
   * The three sections whose contents are plain settings: Account, Orion and Browsing.
   *
   * One holder between them because only one section is ever open, which is exactly what the dialog does with them --
   * each registration is a component drawn inside `active === 'account'` and so lives and dies with its section.
   */
  let offSection: (() => void) | null = null
  const mountSection = (id: string): void => {
    offSection?.()
    offSection = null
    if (id === 'account') {
      offSection = registerSurface(() =>
        accountSurface({
          names: () => ({ assistantName: boxes.assistantName, userName: boxes.userName, userTitle: boxes.userTitle }),
          // Both halves of what a person does: the box, and the save.
          setName: (key, text) => {
            boxes[key] = text
            updateSettings({ [key]: text })
          },
          avatar: () => String(prefs.userAvatar ?? ''),
          setAvatar: (picked) => updateSettings({ userAvatar: picked })
        })
      )
    } else if (id === 'orion') {
      offSection = registerSurface(() =>
        orionSurface({
          model: () => String(prefs.defaultModel),
          setModel: (picked) => updateSettings({ defaultModel: picked }),
          instructions: () => boxes.instructions,
          setInstructions: (text) => {
            boxes.instructions = text
            updateSettings({ systemPrompt: text })
          },
          stored: () => ({ autoFallback: prefs.autoFallback as boolean, reasoningEffort: prefs.reasoningEffort as 'low' | 'high' | 'max' })
        })
      )
    } else if (id === 'browsing') {
      offSection = registerSurface(() =>
        browsingSurface({
          stored: () => prefs as never,
          set: (key, on) => updateSettings({ [key]: on })
        })
      )
    }
  }

  /** The dialog's own section change, which now tells the window where it is (`onSection`). */
  const openSection = (id: string): void => {
    shell.settingsAt = id
    if (id === 'appearance') mountAppearance()
    else unmountAppearance()
    mountSection(id)
    surfacesDrawn()
  }

  const openSettings = (section: string | null): void => {
    if (section === null) {
      unmountAppearance()
      offSection?.()
      offSection = null
      offSettings?.()
      offSettings = null
      shell.settingsAt = null
      surfacesDrawn()
      return
    }
    if (!offSettings) {
      offSettings = registerSurface(() =>
        settingsSurface({
          section: () => shell.settingsAt ?? 'account',
          openSection,
          search: () => '',
          setSearch: () => undefined,
          close: () => openSettings(null),
          licencesOpen: () => false
        })
      )
    }
    openSection(section)
  }

  registerSurface(() =>
    shellSurface({
      nav: () => nav,
      show,
      browserRunning: () => nav.browserLaunched,
      sidebar: () => shell.sidebar,
      setSidebar: (open) => {
        shell.sidebar = open
        surfacesDrawn()
      },
      settings: () => shell.settingsAt,
      openSettings,
      activity: () => shell.activity,
      setActivity: (open) => {
        shell.activity = open
        shell.unread = open ? 0 : shell.unread
        surfacesDrawn()
      },
      activityCount: () => ({ total: shell.notices.length, unread: shell.unread }),
      clearActivity: () => {
        shell.notices = []
        surfacesDrawn()
      },
      palette: () => shell.palette,
      setPalette: (open) => {
        shell.palette = open
        surfacesDrawn()
      },
      shortcuts: () => shell.shortcuts,
      setShortcuts: (open) => {
        shell.shortcuts = open
        surfacesDrawn()
      },
      back: () => go({ kind: 'escape' }),
      chats: () => chat.chats
    })
  )

  /*
   * The conversation is registered while it is what is on screen, which is what App.tsx does with it.
   *
   * It is mounted the whole time behind a module, so this is the difference between "the conversation is there" and
   * "the conversation is what you are looking at".
   */
  let offChat: (() => void) | null = null
  const chatShowing = (): boolean => nav.surface.kind === 'chat'
  const syncChat = (): void => {
    if (chatShowing() && !offChat) {
      offChat = registerSurface(() =>
        chatSurface({
          model: () => chat.model,
          setModel: (id) => {
            chat.model = id
            surfacesDrawn()
          },
          incognito: () => chat.incognito,
          setIncognito: (on) => {
            chat.incognito = on
            chat.open = { id: 'c2', title: 'New chat', messages: 0, replying: false }
            surfacesDrawn()
          },
          webSearch: () => shell.webSearch,
          setWebSearch: (on) => {
            shell.webSearch = on
            surfacesDrawn()
          },
          open: () => chat.open,
          covered: () => shell.settingsAt !== null || shell.shortcuts || shell.palette,
          newChat: () => {
            chat.open = { id: 'c2', title: 'New chat', messages: 0, replying: false }
            surfacesDrawn()
          },
          rename: (title) => {
            if (chat.open) chat.open = { ...chat.open, title }
            surfacesDrawn()
          },
          clear: () => {
            if (chat.open) chat.open = { ...chat.open, messages: 0 }
            surfacesDrawn()
          },
          stop: () => {
            chat.stopped += 1
            if (chat.open) chat.open = { ...chat.open, replying: false }
            surfacesDrawn()
          },
          find: () => {
            chat.searched += 1
          },
          chats: () => chat.chats
        })
      )
    } else if (!chatShowing() && offChat) {
      offChat()
      offChat = null
    }
  }
  syncChat()
  // Every draw mounts or unmounts it, exactly as rendering it inside a condition does.
  const drawn = (): void => {
    syncChat()
  }

  const asks: string[] = []
  const state = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => {
      drawn()
      const answer = overTheWire(await answerSurfaceCall(call, overTheWire(params)))
      drawn()
      return answer
    },
    open: () => true
  })

  return {
    control,
    prefs,
    boxes,
    settingsWrites,
    store,
    shell,
    chat,
    customize,
    nav: () => nav,
    openSettings,
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

// ---------------------------------------------------------------- the window shell

test('the window says what is on screen, and setting it switches', async () => {
  const world = screens()
  const got = await run(world, 'screen.read', { path: 'window/screen' })
  assert.equal(got.ok, true, got.error?.message)
  const reading = got.data as { value: unknown; writable: boolean; values: string[] }
  assert.equal(reading.value, 'chat')
  assert.equal(reading.writable, true)
  assert.ok(reading.values.includes('markets'), 'the modules come from the capability registry, not from a list here')

  const moved = await run(world, 'screen.write', { path: 'window/screen', value: 'markets' })
  assert.equal(moved.ok, true, moved.error?.message)
  assert.deepEqual(world.nav().surface, { kind: 'feature', id: 'markets' })
  assert.match(moved.verification?.detail ?? '', /What is on screen is now “markets”/)

  const back = await run(world, 'screen.write', { path: 'window/screen', value: 'chat' })
  assert.equal(back.ok, true, back.error?.message)
  assert.deepEqual(world.nav().surface, { kind: 'chat' })
})

test('leaving the browser puts it behind rather than closing it', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/screen', value: 'browser' })
  assert.equal(world.nav().browserLaunched, true)

  const away = await run(world, 'screen.write', { path: 'window/screen', value: 'chess' })
  assert.equal(away.ok, true, away.error?.message)
  assert.equal(world.shell.behind, 1, 'the main process was told to put the browser behind')
  assert.equal(world.nav().browserLaunched, true, 'and it is still running, with its tabs')
})

test('what cannot be done in the browser says what to do instead', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/screen', value: 'browser' })
  const refused = await run(world, 'screen.do', { path: 'window/back' })
  assert.equal(refused.ok, false)
  assert.match(refused.error?.message ?? '', /keeps Escape for its own pages\. Set screen to “chat” instead/)
})

test('back to the conversation is confirmed by looking, not by having asked', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/screen', value: 'student' })
  const got = await run(world, 'screen.do', { path: 'window/back' })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.equal(got.verification?.detail, 'The conversation is back in front.')
})

test('the chat list is shown or hidden; there is no width to set', async () => {
  const world = screens()
  const got = await run(world, 'screen.read', { path: 'window/sidebar' })
  assert.equal((got.data as { type: string }).type, 'boolean')

  const wider = await run(world, 'screen.write', { path: 'window/sidebar', value: 320 })
  assert.equal(wider.ok, false, 'a width is not something this control holds')
  assert.match(wider.error?.message ?? '', /must be a boolean, and the number 320 was given/)

  const hidden = await run(world, 'screen.write', { path: 'window/sidebar', value: false })
  assert.equal(hidden.ok, true, hidden.error?.message)
  assert.equal(world.shell.sidebar, false)
})

test('the activity drawer empties, and is asked about first', async () => {
  const world = screens()
  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'window/clearActivity' }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.equal(world.shell.notices.length, 2, 'nothing was forgotten')

  world.approve = true
  const done = await run(world, 'screen.do', { path: 'window/clearActivity' }, 'orion')
  assert.equal(done.ok, true, done.error?.message)
  assert.equal(done.verification?.detail, 'The activity drawer is empty.')
})

// ---------------------------------------------------------------- the conversation

test('the conversation is only offered while it is what is on screen', async () => {
  const world = screens()
  const there = await run(world, 'screen.write', { path: 'window/chat/model', value: 'openai/gpt-oss-120b' })
  assert.equal(there.ok, true, there.error?.message)
  assert.equal(world.chat.model, 'openai/gpt-oss-120b')

  await run(world, 'screen.write', { path: 'window/screen', value: 'markets' })
  const gone = await run(world, 'screen.read', { path: 'window/chat/model' })
  assert.equal(gone.ok, false)
  assert.equal(gone.error?.code, 'not-found')
})

test('renaming the conversation says what it is called now, and a blank name is not a name', async () => {
  const world = screens()
  const named = await run(world, 'screen.do', { path: 'window/chat/rename', params: { title: 'Weekend plans' } })
  assert.equal(named.ok, true, named.error?.message)
  assert.equal(world.chat.open?.title, 'Weekend plans')
  assert.equal(named.verification?.detail, 'The conversation is called “Weekend plans” now.')

  const blank = await run(world, 'screen.do', { path: 'window/chat/rename', params: { title: '   ' } })
  assert.equal(blank.ok, false)
  assert.match(blank.error?.message ?? '', /A conversation needs a name/)
})

test('stopping a reply that is not happening is refused with the reason', async () => {
  const world = screens()
  const got = await run(world, 'screen.do', { path: 'window/chat/stop' })
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /Nothing is being answered right now/)
  assert.equal(world.chat.stopped, 0)
})

test('a title that cannot be read says so rather than answering “New chat”', async () => {
  const world = screens()
  world.chat.open = null
  const got = await run(world, 'screen.read', { path: 'window/chat/title' })
  assert.equal(got.ok, true)
  const reading = got.data as { readable: boolean; value: unknown; note?: string }
  assert.equal(reading.readable, false)
  assert.equal(reading.value, null)
  assert.match(reading.note ?? '', /No conversation is open/)
})

// ---------------------------------------------------------------- Settings, appearance

test('switch to the light theme: opened, set, and saved through the settings service', async () => {
  const world = screens()
  // Settings is shut, so nothing in it exists yet -- and the miss says what is really there.
  const tooSoon = await run(world, 'screen.read', { path: 'settings/appearance/theme' })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /Nothing on screen is called “settings”/)

  const opened = await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  assert.equal(opened.ok, true, opened.error?.message)

  const light = await run(world, 'screen.write', { path: 'settings/appearance/theme', value: 'light' })
  assert.equal(light.ok, true, light.error?.message)
  assert.equal(world.prefs.theme, 'light', 'the screen’s own handler ran')
  assert.deepEqual(world.settingsWrites, [{ theme: 'light' }], 'through the settings service, once, with nothing else touched')
  assert.match(light.verification?.detail ?? '', /Theme is now “light”/)

  const state = await run(world, 'screen.state', { path: 'settings/appearance' })
  assert.deepEqual((state.data as { state: { values: Record<string, unknown> } }).state.values, { theme: 'light', showing: 'light', effects: true })
})

test('a theme the segmented control does not offer is refused with the three that are', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  const got = await run(world, 'screen.write', { path: 'settings/appearance/theme', value: 'midnight' })
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /must be one of: system, light, dark/)
  assert.equal(world.prefs.theme, 'system', 'nothing changed')
})

test('the window and the dialog hold one answer about which section is open', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'account' })
  // Moved from inside the dialog, the way pressing a section in the list does.
  const moved = await run(world, 'screen.write', { path: 'settings/section', value: 'appearance' })
  assert.equal(moved.ok, true, moved.error?.message)
  const asked = await run(world, 'screen.read', { path: 'window/settings' })
  assert.equal((asked.data as { value: unknown }).value, 'appearance')
})

// ---------------------------------------------------------------- the Customize centre

test('getting to the Customize centre waits for it to load rather than calling it unreachable', async () => {
  const world = screens({ loadMs: 400 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })

  const got = await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })
  assert.equal(got.ok, true, got.error?.message)
  const where = got.data as { path: string; opened: string[]; alreadyThere: boolean }
  assert.equal(where.path, 'settings/appearance/customize')
  assert.deepEqual(where.opened, [], 'nothing was opened: it was loaded with its section, and waited for')
})

test('a part of a screen that never says what is on it is reported as that, with what to look at', async () => {
  const world = screens({ loadMs: 9_000 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  const got = await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /says it is there as soon as settings\/appearance is, and after waiting it has not said what can be done on it/)
})

test('use a preset: shown at once, kept only when apply runs, and checked against what is stored', async () => {
  const world = screens({ loadMs: 10 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })

  const wearing = BUILT_IN_PRESETS.find((one) => one.id !== 'orbis-default')!
  const worn = await run(world, 'screen.write', { path: 'settings/appearance/customize/preset', value: wearing.id })
  assert.equal(worn.ok, true, worn.error?.message)
  assert.equal(world.customize.draft?.activePresetId, wearing.id, 'the screen is showing it')
  assert.equal(world.store.saves, 0, 'and nothing has been stored: that is what Apply is for')

  const state = await run(world, 'screen.state', { path: 'settings/appearance/customize' })
  const said = (state.data as { state: { detail?: string; values: Record<string, unknown> } }).state
  assert.match(said.detail ?? '', /being shown and not yet kept/)
  assert.equal(said.values.wearing, wearing.id)

  const kept = await run(world, 'screen.do', { path: 'settings/appearance/customize/apply' })
  assert.equal(kept.ok, true, kept.error?.message)
  assert.equal(world.store.saves, 1)
  assert.equal(world.store.config.activePresetId, wearing.id, 'it is in what is really stored')
  assert.equal(kept.verification?.verified, true)
  assert.equal(kept.verification?.detail, 'What is on screen is what is now stored.')

  // Nothing left to keep, and it says so instead of saving again.
  const again = await run(world, 'screen.do', { path: 'settings/appearance/customize/apply' })
  assert.equal(again.ok, false)
  assert.match(again.error?.message ?? '', /Nothing has been changed, so there is nothing to keep/)
  assert.equal(world.store.saves, 1)
})

test('a store that will not keep something says which, rather than reporting it kept', async () => {
  // A store that holds the text size where it was: a value refused, a setter that saved nothing, a rule that clamped.
  const world = screens({ loadMs: 10, refuse: (config) => ({ ...config, appearance: { ...config.appearance, fontScale: 1 } }) })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })

  const bigger = await run(world, 'screen.write', { path: 'settings/appearance/customize/fontScale', value: 1.25 })
  assert.equal(bigger.ok, true, bigger.error?.message)

  const kept = await run(world, 'screen.do', { path: 'settings/appearance/customize/apply' })
  assert.equal(kept.ok, true, 'it was carried out, and a retry is not what anybody wants of an action')
  /*
   * Carried out, and not confirmed.
   *
   * `status` is the thing to read on an action: an action that is reported as a failure invites somebody to do it
   * again, so the control layer says it happened and puts what is really known in the sentence. Here the sentence is
   * the store's answer -- the text size is not what the screen shows -- rather than "saved".
   */
  assert.equal((kept.data as SurfaceOutcome).status, 'attempted')
  assert.equal((kept.data as SurfaceOutcome).verified, false)
  assert.match(kept.verification?.detail ?? '', /did not keep: appearance\.fontScale/)
  assert.equal(world.store.config.appearance.fontScale, 1, 'and the store really did not keep it')
})

test('a number outside a slider’s range is refused with the range, and nothing is touched', async () => {
  const world = screens({ loadMs: 10 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })

  const got = await run(world, 'screen.write', { path: 'settings/appearance/customize/fontScale', value: 3 })
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /must be at most 1\.4/)
  assert.equal(world.customize.draft?.appearance.fontScale, 1, 'nothing was clamped and nothing was set')
})

test('a theme and an accent are named the way the screen names them, Orbis’s own included', async () => {
  const world = screens({ loadMs: 10 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })

  const midnight = BUILT_IN_THEMES[0]
  const painted = await run(world, 'screen.write', { path: 'settings/appearance/customize/colours', value: midnight.id })
  assert.equal(painted.ok, true, painted.error?.message)
  assert.equal(world.customize.draft?.themeId, midnight.id)

  const own = await run(world, 'screen.write', { path: 'settings/appearance/customize/colours', value: ORBIS_OWN })
  assert.equal(own.ok, true, own.error?.message)
  assert.equal(world.customize.draft?.themeId, null, 'Orbis’s own colours are stored as nothing, and said as a word')

  const accent = await run(world, 'screen.write', { path: 'settings/appearance/customize/accent', value: '#ff4d6d' })
  assert.equal(accent.ok, true, accent.error?.message)
  assert.equal(world.customize.draft?.appearance.accent, '#ff4d6d')
})

test('resetting one part is confirmed against how Orbis comes, not against the screen', async () => {
  const world = screens({ loadMs: 10 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })
  await run(world, 'screen.write', { path: 'settings/appearance/customize/density', value: 'compact' })
  await run(world, 'screen.do', { path: 'settings/appearance/customize/apply' })
  assert.equal(world.store.config.appearance.density, 'compact')

  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'settings/appearance/customize/resetPart', params: { section: 'appearance' } }, 'orion')
  assert.equal(declined.ok, false, 'it throws away what somebody chose, so it asks first')
  assert.equal(world.store.config.appearance.density, 'compact')

  world.approve = true
  const done = await run(world, 'screen.do', { path: 'settings/appearance/customize/resetPart', params: { section: 'appearance' } }, 'orion')
  assert.equal(done.ok, true, done.error?.message)
  assert.equal(world.store.config.appearance.density, 'comfortable')
  assert.equal(done.verification?.detail, 'Appearance is back to how Orbis has it.')
})

test('a screen that has not read what is stored says so, and cannot be set', async () => {
  const world = screens({ loading: true, loadMs: 10 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  await run(world, 'screen.goTo', { path: 'settings/appearance/customize' })

  const got = await run(world, 'screen.read', { path: 'settings/appearance/customize/density' })
  assert.equal(got.ok, true)
  const reading = got.data as { readable: boolean; value: unknown; note?: string }
  assert.equal(reading.readable, false)
  assert.equal(reading.value, null, 'never a “comfortable” that nobody chose')
  assert.match(reading.note ?? '', /has not finished reading what is stored/)

  const refused = await run(world, 'screen.write', { path: 'settings/appearance/customize/density', value: 'compact' })
  assert.equal(refused.ok, false)
  assert.match(refused.error?.message ?? '', /has not finished reading what is stored/)
})

test('what is on screen is in the state Orion is given, with the window and Settings as the roots', async () => {
  const world = screens({ loadMs: 10 })
  await run(world, 'screen.write', { path: 'window/settings', value: 'appearance' })
  const snapshot = (await world.control.snapshot(['screens'])) as { screens: { screens: { path: string; controls: number }[] } }
  const paths = snapshot.screens.screens.map((one) => one.path)
  assert.ok(paths.includes('window'), 'the window itself')
  assert.ok(paths.includes('settings'), 'and Settings, while it is open')
  // Shallow on purpose: what is inside Settings is one `screen.tree` away.
  assert.ok(!paths.includes('settings/appearance/customize'))

  const tree = await run(world, 'screen.tree', { path: 'window' })
  const surfaces = (tree.data as { surfaces: SurfaceDescriptor[] }).surfaces
  assert.deepEqual(
    surfaces.map((one) => one.path),
    ['window', 'window/chat']
  )
})

// ---------------------------------------------------------------- Account, Orion and Browsing

test('“call me Commander” is walked to, set, and saved through the settings service', async () => {
  const world = screens()
  /*
   * Settings is opened through the window's own control, which is the real door: Settings is a root surface rather
   * than something inside the window, so until it is open there is no `settings` for a walk to walk to. The comment
   * on that control in `shellSurfaces.ts` says the same thing from the other side.
   */
  const opened = await run(world, 'screen.write', { path: 'window/settings', value: 'account' })
  assert.equal(opened.ok, true, opened.error?.message)
  assert.equal(world.shell.settingsAt, 'account')

  const set = await run(world, 'screen.write', { path: 'settings/account/addressMeAs', value: 'Commander' })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal((set.data as SurfaceOutcome).status, 'completed')
  assert.equal(world.boxes.userTitle, 'Commander', 'in the box, as somebody typing it would leave it')
  assert.deepEqual(world.settingsWrites.at(-1), { userTitle: 'Commander' }, 'and saved through the one settings service')
})

test('a name longer than the box allows is refused with the length, and nothing is saved', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'account' })
  const writes = world.settingsWrites.length
  const refused = await run(world, 'screen.write', { path: 'settings/account/yourName', value: 'x'.repeat(41) })
  assert.equal(refused.ok, false)
  assert.match(refused.error?.message ?? '', /at most 40 characters, and that one is 41/)
  assert.equal(world.settingsWrites.length, writes, 'the service was never called')
  assert.equal(world.boxes.userName, 'NxtOrbis', 'and the box is as it was')
})

test('a world is chosen by its id, and the reading says which one it is', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'account' })
  const named = AVATARS[3]

  // The names are in the description so the right id can be sent; the control itself holds the id, because a write
  // is confirmed by reading the control back and a control that takes two kinds of value cannot be.
  const reading = await run(world, 'screen.read', { path: 'settings/account/world' })
  assert.ok(((reading.data as { values?: string[] }).values ?? []).includes(named.id))

  const set = await run(world, 'screen.write', { path: 'settings/account/world', value: named.id })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal((set.data as SurfaceOutcome).status, 'completed')
  assert.equal(world.prefs.userAvatar, named.id)

  const refused = await run(world, 'screen.write', { path: 'settings/account/world', value: 'mars' })
  assert.equal(refused.ok, false)
  assert.equal(refused.error?.code, 'invalid-params')
  assert.ok((refused.error?.message ?? '').includes(named.id), 'and it says what there is instead')
})

test('the default model is set by its id, and the state says the name beside it', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'orion' })
  const wanted = MODELS[1]
  const set = await run(world, 'screen.write', { path: 'settings/orion/model', value: wanted.id })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal(world.prefs.defaultModel, wanted.id)

  const state = await run(world, 'screen.state', { path: 'settings/orion' })
  const values = (state.data as { state: { values: Record<string, unknown> } }).state.values
  assert.equal(values.model, wanted.id)
  assert.equal(values.modelName, wanted.label, 'said by the name as well, because the id is not what anybody calls it')
})

test('a setting nothing on screen chooses is a reading, with the sentence saying why', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'orion' })
  const got = await run(world, 'screen.read', { path: 'settings/orion/reasoningEffort' })
  assert.equal(got.ok, true, got.error?.message)
  const reading = got.data as { value: unknown; readable: boolean; writable: boolean; note?: string }
  assert.equal(reading.readable, true, 'it really is stored, and really is read')
  assert.equal(reading.value, 'high')
  assert.equal(reading.writable, false)
  assert.match(reading.note ?? '', /chosen per answer while a chat is running, not here/)

  const refused = await run(world, 'screen.write', { path: 'settings/orion/reasoningEffort', value: 'max' })
  assert.equal(refused.ok, false)
  assert.equal(refused.error?.code, 'invalid-params')
  assert.match(refused.error?.message ?? '', /chosen per answer/)
})

test('the standing instructions are written into the box and kept in one go', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'orion' })
  const set = await run(world, 'screen.write', { path: 'settings/orion/instructions', value: 'Answer in British English.' })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal(world.boxes.instructions, 'Answer in British English.')
  assert.deepEqual(world.settingsWrites.at(-1), { systemPrompt: 'Answer in British English.' })

  const state = await run(world, 'screen.state', { path: 'settings/orion' })
  const values = (state.data as { state: { values: Record<string, unknown> } }).state.values
  assert.equal(values.instructionsLength, 26, 'how long they are, not what they say')
  assert.ok(!('instructions' in values), 'what somebody told Orion about themselves is not in a summary of the screen')
})

test('a browsing switch is turned on, and one that is already on is not set again', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'browsing' })
  const on = await run(world, 'screen.write', { path: 'settings/browsing/wakeForSchedules', value: true })
  assert.equal(on.ok, true, on.error?.message)
  assert.equal(world.prefs.wakeForSchedules, true)

  // Visual Search is on unless somebody turned it off, so there is nothing to do and nothing is sent.
  const writes = world.settingsWrites.length
  const already = await run(world, 'screen.write', { path: 'settings/browsing/visualSearch', value: true })
  assert.equal(already.ok, true, already.error?.message)
  assert.equal((already.data as { unchanged?: boolean }).unchanged, true)
  assert.equal(world.settingsWrites.length, writes, 'the settings service was not called for a change that was not one')
})

test('a switch is not offered while its section is not open, and says what is', async () => {
  const world = screens()
  await run(world, 'screen.write', { path: 'window/settings', value: 'browsing' })
  assert.equal((await run(world, 'screen.read', { path: 'settings/browsing/searchSuggestions' })).ok, true)

  // Moving to another section takes the whole page away, which is the point of the register.
  await run(world, 'screen.write', { path: 'settings/section', value: 'account' })
  const gone = await run(world, 'screen.read', { path: 'settings/browsing/searchSuggestions' })
  assert.equal(gone.ok, false)
  assert.ok((gone.error?.message ?? '').includes('browsing'), gone.error?.message)
})

test('every setting these sections are responsible for is a control Orbis can reach', async () => {
  const world = screens({ loadMs: 10 })
  /*
   * The guard that keeps this honest as Settings grows.
   *
   * `SETTINGS_SECTIONS` already says which keys of `Settings` each section is responsible for, and a test elsewhere
   * proves every editable key is in exactly one of them. This asks the other half: of the keys in the sections that
   * describe themselves, is each one really a control Orbis can reach? A setting added to Account next year with no
   * control here fails this rather than quietly being something Orbis cannot touch.
   */
  const sections = ['account', 'orion', 'browsing', 'appearance'] as const
  /** The one key in these four sections that is deliberately not a flat control, and why. */
  const notFlat: Record<string, string> = {
    researchSources: 'a whole shape with its own panel, set by the research capabilities rather than as one value'
  }
  /** Where a control is called by the screen's own better words rather than the key it writes. Said once, here. */
  const alias: Record<string, string> = {
    userName: 'yourName',
    userTitle: 'addressMeAs',
    userAvatar: 'world',
    systemPrompt: 'instructions',
    defaultModel: 'model'
  }

  const found = new Map<string, Set<string>>()
  for (const id of sections) {
    await run(world, 'screen.write', { path: 'window/settings', value: id })
    const tree = await run(world, 'screen.tree', { path: `settings/${id}`, depth: 0 })
    const surface = (tree.data as { surfaces: SurfaceDescriptor[] }).surfaces[0]
    assert.ok(surface, `${id} says what is on it`)
    found.set(id, new Set(surface.controls.map((one) => one.id)))
  }

  const missing: string[] = []
  for (const section of SETTINGS_SECTIONS) {
    if (!sections.includes(section.id as (typeof sections)[number])) continue
    for (const key of section.settings) {
      if (notFlat[key]) continue
      const ids = found.get(section.id)!
      if (!ids.has(key) && !ids.has(alias[key] ?? key)) missing.push(`${section.id}/${key}`)
    }
  }
  assert.deepEqual(missing, [], 'every setting these sections own is a control Orbis can reach')
})
