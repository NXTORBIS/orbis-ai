import type { NotificationsConfig } from '../../../shared/experience.ts'
import { cleanSectionId, SETTINGS_SECTIONS, type SettingsSectionId } from '../../../shared/settingsSections.ts'
import type { SurfaceDeclaration } from '../lib/surfaces/registry.ts'

/**
 * What Settings and its Notifications page let Orbis do, as data.
 *
 * Here rather than inside the two components for one reason: a declaration that lives in a component can only be
 * checked by drawing that component, and there is no browser in the test suite. Written as a function of the screen's
 * own state and its own handlers, the whole chain -- a capability in the main process, the bridge, the register, these
 * getters and setters -- is driven by `src/main/browserControl/surfaces.test.ts` with no window at all.
 *
 * Nothing here reaches for anything. Every value comes from the screen that passes itself in, and every setter is a
 * function that screen already calls when somebody presses the control themselves. That is the rule for every screen
 * that does this: a surface is a description of what is already there, never a second way of doing it.
 */

/**
 * The sections whose panels say what can be done on them.
 *
 * Kept as a list rather than worked out, because the answer is not a property of a section: it is whether the panel
 * inside it registers a surface. A section named here whose panel does not register is worse than one left out --
 * Orbis would open it, find nothing, and have to report something it cannot tell apart from a fault. Add to this in
 * the same change as the `useSurface` call in the panel.
 */
export const CONTROLLABLE_SECTIONS = new Set<SettingsSectionId>(['account', 'orion', 'browsing', 'notifications', 'appearance', 'games'])

/** What the Settings dialog has to hand over. Each one is a live reader or the handler its own controls call. */
export interface SettingsScreen {
  /** Which section is open. A plain string, because what this does with it is hand it to a control. */
  section(): string
  openSection(id: string): void
  search(): string
  setSearch(text: string): void
  close(): void
  licencesOpen(): boolean
}

/**
 * Settings, as something Orbis can work rather than click at.
 *
 * Two controls and the list of pages it can open. The list is what makes "turn quiet hours on" reachable without
 * anybody naming Settings first: the walk opens Settings, sets `section` to `notifications`, and the Notifications
 * page registers itself and says what is on it.
 */
export function settingsSurface(screen: SettingsScreen): SurfaceDeclaration {
  return {
    id: 'settings',
    parent: null,
    name: 'Settings',
    about: 'How Orbis itself is set up, in sections.',
    kind: 'module',
    keywords: ['settings', 'preferences', 'options', 'configuration'],
    controls: {
      section: {
        name: 'Section',
        about: 'Which part of Settings is open.',
        spec: { type: 'string', description: 'Which part of Settings is open.', enum: SETTINGS_SECTIONS.map((one) => one.id) },
        get: () => screen.section(),
        // Through the same cleaning the dialog uses when it is opened at a section, so one unknown name cannot leave
        // Settings showing nothing.
        set: (value) => screen.openSection(cleanSectionId(String(value)))
      },
      search: {
        name: 'Search settings',
        about: 'Narrows the list to the settings that match, and moves to the best one.',
        spec: { type: 'string', description: 'What to look for. Empty shows everything.' },
        get: () => screen.search(),
        set: (value) => screen.setSearch(String(value ?? '')),
        default: ''
      }
    },
    actions: {
      close: {
        name: 'Close settings',
        about: 'Saves what has been typed and closes the dialog.',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    possibleChildren: SETTINGS_SECTIONS.filter((one) => CONTROLLABLE_SECTIONS.has(one.id)).map((one) => ({
      id: one.id,
      name: one.label,
      kind: 'page' as const,
      reach: { kind: 'control' as const, control: 'section', value: one.id }
    })),
    state: () => ({
      values: { section: screen.section(), sections: SETTINGS_SECTIONS.length, searching: screen.search().trim().length > 0, licencesOpen: screen.licencesOpen() }
    })
  }
}

/** What the Notifications page has to hand over. */
export interface NotificationsScreen {
  /**
   * What is saved now.
   *
   * Throws while the page is still loading, on purpose: a control whose getter throws is reported as "could not be
   * read", which is the truth. Answering with a default instead would report a switch as off because a file was slow.
   */
  settings(): NotificationsConfig
  save(next: NotificationsConfig): void
  /** The kinds of notification, as the page itself lists them. */
  categories: readonly { id: string; label: string; what: string }[]
  /** What the person has been told: how many, and how many of those are unread. */
  told(): { total: number; unread: number }
  /** Whether this computer shows notifications for Orbis at all. Null while that has not been asked yet. */
  shows(): boolean | null
  test(): Promise<{ ok: boolean; message: string }>
  markAllRead(): Promise<unknown>
  clearAll(): Promise<unknown>
  /** The list as it really is now, asked again, for checking that marking or clearing happened. */
  check(): Promise<{ total: number; unread: number }>
}

/** The Notifications page: the quiet hours, a switch for every kind, and the three things you can do there. */
export function notificationsSurface(screen: NotificationsScreen): SurfaceDeclaration {
  const quiet = (): NotificationsConfig['quietHours'] => screen.settings().quietHours
  const quietOn = (): boolean => quiet().enabled
  /*
   * Said as a sentence rather than a flag: "cannot be set" with no reason is a dead end, and this one has a fix.
   *
   * Handed over as the function rather than its answer, so it is asked when somebody wants to know. Called here, it
   * would run while this declaration is being built -- on every draw, before the page has loaded -- and throw.
   */
  const onlyWhenQuiet = (): true | string => (quietOn() ? true : 'Quiet hours are off, so there are no hours to set. Turn quietHours on first.')

  return {
    id: 'notifications',
    parent: 'settings',
    name: 'Notifications',
    about: 'What Orbis interrupts you for, when it stays quiet, and what it has told you.',
    kind: 'page',
    keywords: ['notifications', 'alerts', 'interruptions', 'quiet hours', 'do not disturb'],
    controls: {
      quietHours: {
        name: 'Quiet hours',
        about: 'Holds notifications overnight and says them in one line afterwards. Security warnings still get through.',
        spec: { type: 'boolean', description: 'Whether notifications are held during the hours below.' },
        get: () => quietOn(),
        set: (on) => screen.save({ ...screen.settings(), quietHours: { ...quiet(), enabled: on === true } })
      },
      quietFrom: {
        name: 'Quiet from',
        spec: { type: 'string', description: 'When quiet hours start, as 24-hour time: "22:30".' },
        get: () => quiet().from,
        writable: onlyWhenQuiet,
        set: (value) => screen.save({ ...screen.settings(), quietHours: { ...quiet(), from: String(value) } })
      },
      quietUntil: {
        name: 'Quiet until',
        spec: { type: 'string', description: 'When quiet hours end, as 24-hour time: "07:00".' },
        get: () => quiet().to,
        writable: onlyWhenQuiet,
        set: (value) => screen.save({ ...screen.settings(), quietHours: { ...quiet(), to: String(value) } })
      },
      /*
       * One switch per kind, built from the same list the page draws.
       *
       * Not a second list written out for Orbis. A kind added to the page becomes readable and settable in the same
       * change, which is the whole idea: adding something must not mean teaching the assistant about it.
       */
      ...Object.fromEntries(
        screen.categories.map((category) => [
          category.id,
          {
            name: category.label,
            about: category.what,
            spec: { type: 'boolean' as const, description: `Whether Orbis tells you about: ${category.what}` },
            // Never decided about means on, which is what the switch on screen shows too.
            get: () => screen.settings().categories[category.id] !== false,
            set: (on: unknown) => screen.save({ ...screen.settings(), categories: { ...screen.settings().categories, [category.id]: on === true } })
          }
        ])
      )
    },
    actions: {
      sendTest: {
        name: 'Send a test',
        about: 'Shows a real notification now, and says what the computer did with it.',
        // It leaves Orbis for the operating system's own notifications, which is more than changing what is on screen.
        effects: ['communicate'],
        run: () => screen.test(),
        // The answer is the computer's own: whether it really showed it, in its words.
        verify: (data) => ({ done: (data as { ok: boolean }).ok === true, detail: (data as { message: string }).message })
      },
      markAllRead: {
        name: 'Mark all read',
        run: () => screen.markAllRead(),
        verify: async () => {
          const now = await screen.check()
          return { done: now.unread === 0, detail: now.unread === 0 ? 'Nothing is unread now.' : `${now.unread} are still unread.` }
        }
      },
      clearAll: {
        name: 'Clear the list',
        about: 'Forgets the notes about what you were told. Never the download, file or workflow each was about.',
        effects: ['delete'],
        confirmation: 'always',
        run: () => screen.clearAll(),
        verify: async () => {
          const now = await screen.check()
          return { done: now.total === 0, detail: now.total === 0 ? 'The list is empty.' : `${now.total} are still in the list.` }
        }
      }
    },
    state: () => {
      const told = screen.told()
      return {
        values: {
          told: told.total,
          unread: told.unread,
          // Whether this computer shows them at all is asked of the computer. Until the answer is back it is unknown,
          // which is a different thing from "no" and is said as such.
          showsNotifications: screen.shows() === null ? 'not checked yet' : screen.shows(),
          quietHours: quietOn() ? `${quiet().from} to ${quiet().to}` : 'off'
        }
      }
    }
  }
}
