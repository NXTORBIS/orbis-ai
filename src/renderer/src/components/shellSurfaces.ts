import { CAPABILITIES } from '../../../shared/commandCenter.ts'
import { featureOf, showingBrowser, showingImages } from '../../../shared/navigation.ts'
import type { NavState } from '../../../shared/navigation'
import { CHAT_MODELS } from '../../../shared/models.ts'
import { cleanSectionId, SETTINGS_SECTIONS } from '../../../shared/settingsSections.ts'
import type { PossibleChild } from '../../../shared/surfaces.ts'
import type { SurfaceDeclaration } from '../lib/surfaces/registry.ts'

/**
 * What the Orbis window itself lets Orbis do: which screen is in front, the chat list, Settings, the activity
 * drawer, the box of everything Orbis can do -- and the conversation, while the conversation is what you are looking
 * at.
 *
 * Here rather than inside `App.tsx` for the reason every declaration is written this way: one inside a component can
 * only be checked by drawing that component, and there is no browser in the test suite. Written as a function of the
 * shell's own state and its own handlers, the whole chain can be driven with no window at all.
 *
 * Nothing here decides anything. Every value is read from what the shell already holds, and every setter is the
 * handler the shell's own button, row or shortcut already calls -- which is the rule: a surface describes what is
 * there, it is never a second way of doing it.
 */

/**
 * The screens the window can be showing, as one list.
 *
 * Taken from the capability registry -- the list both halves of Orbis read -- rather than written out again here. A
 * module becomes switchable because it is in that registry, which is the same reason it appears in the launcher and
 * in the browser's Command Centre. A second copy here is exactly how the launcher and the registry came to disagree
 * about nine screens.
 */
export const WINDOW_SCREENS: readonly string[] = Object.freeze([
  'chat',
  'images',
  'browser',
  ...[...new Set(CAPABILITIES.flatMap((one) => (one.app ? [one.app] : [])))]
])

/**
 * Waits for the window to have drawn, and then says what it shows.
 *
 * A control is read when somebody asks, and setting one is already given its moment by the register. An action is
 * different: it is checked the instant it has run, and what it changed in React is a render that has not happened
 * yet -- so a check that read the screen straight away would report every one of these as not having worked. This
 * waits for the answer to become true, and if it never does that is what gets reported.
 *
 * It only works because what it reads is held in refs the window writes on every draw, rather than captured when
 * this declaration was built.
 */
async function settled(ready: () => boolean, ms = 1200): Promise<boolean> {
  const end = Date.now() + ms
  while (!ready() && Date.now() < end) await new Promise((wake) => setTimeout(wake, 25))
  return ready()
}

/**
 * The modules the shell can show, paired with the path each one registers itself at.
 *
 * Needed because the two are not the same word, and because nothing else knows both. A module registers at the top
 * level under its own name -- Markets is `markets`, the arcade is `games` -- while the shell shows it by setting its
 * “what is on screen” control to the id the capability registry uses. Those agree for most of them and not for the
 * arcade, which the registry calls `arcade` and which calls its own screen Games.
 *
 * Only the modules that really do say what can be done on them are here, and that is the point of the list rather
 * than a shortcoming of it. A module Orbis can show but which has not declared a surface would make a walk set the
 * control, wait for a screen that never says anything, and then report a step that did not work -- which reads as a
 * broken module. Left out, asking for it says plainly that Orbis has nothing of that name on screen, which is true.
 *
 * So this grows by one line when a module declares a surface. What stops it rotting the other way is the check below
 * and the test over it: every `shows` here has to be a screen the shell can really show, which is read from the
 * capability registry rather than written out again.
 */
const MODULE_SCREENS: readonly { shows: string; at: string }[] = Object.freeze([
  { shows: 'chess', at: 'chess' },
  { shows: 'markets', at: 'markets' },
  { shows: 'pages', at: 'pages' },
  { shows: 'student', at: 'student' },
  { shows: 'courses', at: 'courses' },
  { shows: 'labs', at: 'labs' },
  { shows: 'toolkit', at: 'toolkit' },
  { shows: 'arcade', at: 'games' }
])

/**
 * Each of those as a way in, named the way the capability registry names it.
 *
 * The name and nothing else comes from the registry, so “open the arcade” and “open Arcade” find the same thing and
 * there is no second place where a module is given a name. A pairing whose module the shell cannot show is dropped
 * rather than offered: a route that sets the control to a value the control does not take would be refused by the
 * control, which is honest but late, and `checkSurfaceWiring` would report it as a fault in Orbis -- correctly.
 */
export const moduleWaysIn = (): PossibleChild[] =>
  MODULE_SCREENS.filter((one) => WINDOW_SCREENS.includes(one.shows)).map((one) => ({
    id: one.at,
    name: CAPABILITIES.find((capability) => capability.app === one.shows)?.name ?? one.at,
    kind: 'module' as const,
    reach: { kind: 'control' as const, control: 'screen', value: one.shows },
    opens: one.at
  }))

/** Which screen is in front, in the words of the list above. */
export function screenShowing(nav: NavState): string {
  if (showingBrowser(nav)) return 'browser'
  if (showingImages(nav)) return 'images'
  return featureOf(nav) ?? 'chat'
}

/** What the window shell has to hand over. Each one is a live reader or the handler its own control already calls. */
export interface ShellScreen {
  /** What is on screen, as the one value `shared/navigation.ts` keeps it as. */
  nav(): NavState
  /**
   * Shows one of `WINDOW_SCREENS`.
   *
   * The whole switch, including hiding the browser when something else is asked for: the browser is a window of its
   * own parented into this one, so leaving it is this process's job rather than something a view can do by collapsing.
   */
  show(what: string): void
  /** Whether Chromium is running at all, which is not whether it is in front. */
  browserRunning(): boolean
  /** Whether the chat list down the side is showing. */
  sidebar(): boolean
  setSidebar(open: boolean): void
  /** Which section of Settings is open, or null when Settings is shut. */
  settings(): string | null
  openSettings(section: string | null): void
  activity(): boolean
  setActivity(open: boolean): void
  /** How many notes are in the activity drawer, and how many of those have not been read. */
  activityCount(): { total: number; unread: number }
  clearActivity(): void
  palette(): boolean
  setPalette(open: boolean): void
  shortcuts(): boolean
  setShortcuts(open: boolean): void
  /** Escape: out of whatever screen is open, back to the conversation. */
  back(): void
  /** How many saved conversations there are, for what the shell reports about itself. */
  chats(): number
}

/**
 * The Orbis window, as something Orbis can work rather than click at.
 *
 * `screen` is the one control that matters here: `shared/navigation.ts` keeps what is on screen as a single value, so
 * this is a chooser rather than five switches that can disagree. A module says what is inside it once it is open --
 * nothing in this declaration claims to know what is in Chess World or Markets.
 */
export function shellSurface(screen: ShellScreen): SurfaceDeclaration {
  const openSections = SETTINGS_SECTIONS.map((one) => one.id)
  const inBrowser = (): boolean => screenShowing(screen.nav()) === 'browser'

  return {
    id: 'window',
    parent: null,
    name: 'The Orbis window',
    about: 'Which screen is in front, the chat list, Settings, the activity drawer and the box of everything Orbis can do.',
    kind: 'module',
    keywords: ['window', 'shell', 'orbis', 'app', 'screen', 'sidebar', 'navigation', 'home', 'back', 'browser', 'chat list'],
    controls: {
      screen: {
        name: 'What is on screen',
        about: 'The one screen in front of you. Setting it to “browser” shows the browser, starting it if it is not running; setting it to anything else puts the browser behind without closing it.',
        spec: { type: 'string', description: 'Which screen is in front: the conversation, the pictures, the browser, or one of Orbis’s own modules.', enum: [...WINDOW_SCREENS] },
        get: () => screenShowing(screen.nav()),
        set: (value) => screen.show(String(value)),
        default: 'chat'
      },
      sidebar: {
        name: 'Chat list',
        about: 'The list of conversations down the left. There is no width to set: it is shown or hidden. How tight everything is drawn is Spacing, under Appearance.',
        spec: { type: 'boolean', description: 'Whether the list of conversations is showing.' },
        get: () => screen.sidebar(),
        set: (open) => screen.setSidebar(open === true),
        default: true
      },
      /*
       * Settings is a screen of its own once it is open, so this control is how it gets opened.
       *
       * It cannot be a possible child of this one: Settings registers itself as a screen in its own right (`settings`,
       * with its own pages under it), not as something inside the window shell, and a parent may only claim a child
       * that really registers underneath it. So the honest arrangement is this: set the section here, and everything
       * in Settings is then at `settings/...`.
       */
      settings: {
        name: 'Settings',
        about: 'Which section of Settings is open. “closed” shuts it. Once it is open, everything in it is at settings/… — for example settings/appearance/theme.',
        spec: { type: 'string', description: 'The section of Settings to open, or “closed”.', enum: [...openSections, 'closed'] },
        get: () => screen.settings() ?? 'closed',
        set: (value) => screen.openSettings(String(value) === 'closed' ? null : cleanSectionId(String(value))),
        default: 'closed'
      },
      activity: {
        name: 'Activity drawer',
        about: 'What Orbis has been doing: downloads, runs, and anything it told you about.',
        spec: { type: 'boolean', description: 'Whether the activity drawer is open.' },
        get: () => screen.activity(),
        set: (open) => screen.setActivity(open === true),
        default: false
      },
      palette: {
        name: 'Everything Orbis can do',
        about: 'The box Ctrl+K opens, listing every screen and command.',
        spec: { type: 'boolean', description: 'Whether the command box is open.' },
        get: () => screen.palette(),
        set: (open) => screen.setPalette(open === true),
        default: false
      },
      shortcuts: {
        name: 'Keyboard shortcuts',
        about: 'The sheet of keyboard shortcuts.',
        spec: { type: 'boolean', description: 'Whether the shortcuts sheet is open.' },
        get: () => screen.shortcuts(),
        set: (open) => screen.setShortcuts(open === true),
        default: false
      }
    },
    actions: {
      back: {
        name: 'Back to the conversation',
        about: 'Out of whatever screen is open, the way Escape does it.',
        /*
         * Said as a sentence rather than left to fail.
         *
         * Escape belongs to the browser while the browser is in front -- a page, a find bar and a dialog all want it --
         * so this really cannot be done there, and the fix is to set `screen` instead.
         */
        unavailable: () =>
          inBrowser()
            ? 'The browser is in front, and it keeps Escape for its own pages. Set screen to “chat” instead.'
            : screenShowing(screen.nav()) === 'chat'
              ? 'The conversation is already what is on screen.'
              : null,
        run: () => {
          const from = screenShowing(screen.nav())
          screen.back()
          return { from }
        },
        verify: async () => {
          const there = await settled(() => screenShowing(screen.nav()) === 'chat')
          return { done: there, detail: there ? 'The conversation is back in front.' : `${screenShowing(screen.nav())} is still what is on screen.` }
        }
      },
      clearActivity: {
        name: 'Empty the activity drawer',
        about: 'Forgets the notes about what Orbis has been doing. Never the download, file or run each was about.',
        effects: ['delete'],
        confirmation: 'always',
        unavailable: () => (screen.activityCount().total === 0 ? 'The activity drawer is already empty.' : null),
        run: () => {
          screen.clearActivity()
          return { emptied: true }
        },
        verify: async () => {
          const empty = await settled(() => screen.activityCount().total === 0)
          return { done: empty, detail: empty ? 'The activity drawer is empty.' : `${screen.activityCount().total} are still in it.` }
        }
      }
    },
    /*
     * The ways out of the shell: the conversation, and every module that has said what can be done on it.
     *
     * The conversation is the only one that really registers underneath the shell. The modules register as screens in
     * their own right -- Chess World says what is in Chess World, at `chess` -- so each of those says in `opens`
     * where it will appear, and the walk waits for it there instead of waiting under the shell for something that
     * would never arrive. Naming them here without that was what made every path into a closed module stop at
     * “nothing on screen is called markets”, about a screen the shell can open perfectly well.
     */
    possibleChildren: [{ id: 'chat', name: 'Conversation', kind: 'page', reach: { kind: 'control', control: 'screen', value: 'chat' } }, ...moduleWaysIn()],
    state: () => {
      const told = screen.activityCount()
      return {
        values: {
          showing: screenShowing(screen.nav()),
          // Running and in front are different facts, and the browser goes on running while the chat is used -- which
          // is what makes coming back to it keep every tab.
          browser: !screen.browserRunning() ? 'not running' : inBrowser() ? 'in front' : 'running, behind this window',
          sidebar: screen.sidebar() ? 'showing' : 'hidden',
          settings: screen.settings() ?? 'closed',
          chats: screen.chats(),
          activity: told.total,
          unread: told.unread
        }
      }
    }
  }
}

/** What the conversation has to hand over. */
export interface ChatScreen {
  /** The model answering this conversation, and whether it is an incognito one. */
  model(): string
  setModel(id: string): void
  incognito(): boolean
  /** Starts a new chat that is or is not saved -- which is what the incognito switch does. */
  setIncognito(on: boolean): void
  webSearch(): boolean
  setWebSearch(on: boolean): void
  /**
   * The conversation as the window really holds it now, from the list it keeps rather than from a drawn screen.
   *
   * Read for every action's `verify`: an action is checked the moment it has run, and React has not redrawn by then,
   * so anything read off the screen's own state would be the value from before.
   */
  open(): { id: string; title: string; messages: number; replying: boolean } | null
  /** Whether something is drawn over it: Settings, the shortcut sheet, the command box, a picture being edited. */
  covered(): boolean
  newChat(): void
  rename(title: string): void
  clear(): void
  stop(): void
  /** Opens the box that searches what was said in every conversation. */
  find(): void
  chats(): number
}

/** The conversation: which model answers, whether it is saved, and the things you can do to it. */
export function chatSurface(screen: ChatScreen): SurfaceDeclaration {
  const open = (): ReturnType<ChatScreen['open']> => screen.open()
  const needsChat = (): string | null => (open() ? null : 'There is no conversation open yet. Say something first, or start one with newChat.')

  return {
    id: 'chat',
    parent: 'window',
    name: 'Conversation',
    about: 'The conversation in the Orbis window: which model answers it, whether it is saved, and what can be done to it.',
    kind: 'page',
    keywords: ['chat', 'conversation', 'orion', 'model', 'incognito', 'private', 'web search', 'talk'],
    /*
     * On screen and in front of somebody are two things.
     *
     * The conversation is what is on screen here -- that is why this is registered at all -- but a dialog over the
     * top of it means nobody is looking at it. Said rather than hidden: everything on it still works, and `present`
     * is how a caller knows whether what it is about to change is what the person can see.
     */
    visible: () => !screen.covered(),
    controls: {
      model: {
        name: 'Model',
        about: 'Which model answers. Changing it on an open conversation changes that conversation; with none open it changes what the next one starts with.',
        // Exactly the list the picker in the message box draws (`CHAT_MODELS`), rather than a second one written out
        // here: the models that can answer a chat, without the two that only look at pictures.
        spec: { type: 'string', description: 'The model that answers this conversation.', enum: CHAT_MODELS.map((one) => one.id) },
        get: () => screen.model(),
        set: (value) => screen.setModel(String(value))
      },
      incognito: {
        name: 'Incognito',
        about: 'Turning this on starts a new conversation that is not saved and never appears in the list. It does not make the one you are in private — nothing can, once it is written down.',
        spec: { type: 'boolean', description: 'Whether this conversation is one that is never saved.' },
        get: () => screen.incognito(),
        set: (on) => screen.setIncognito(on === true),
        default: false
      },
      webSearch: {
        name: 'Web search',
        about: 'Replies use live results from the web. What you ask is sent to a search engine.',
        spec: { type: 'boolean', description: 'Whether replies use live web results.' },
        get: () => screen.webSearch(),
        set: (on) => screen.setWebSearch(on === true),
        default: false
      },
      title: {
        name: 'Title',
        about: 'What this conversation is called. Set it with the rename action, which says whether it took.',
        spec: { type: 'string', description: 'The conversation’s title.' },
        /*
         * A getter that cannot answer throws, rather than answering "New chat".
         *
         * There is a real difference between a conversation called something and no conversation at all, and a
         * sentence saying a chat is called "New chat" when none exists is the kind of thing somebody acts on.
         */
        get: () => {
          const now = open()
          if (!now) throw new Error('No conversation is open, so there is no title.')
          return now.title
        }
      }
    },
    actions: {
      newChat: {
        name: 'Start a new conversation',
        run: () => {
          screen.newChat()
          return { started: true }
        },
        verify: async () => {
          const fresh = await settled(() => {
            const now = open()
            return !now || now.messages === 0
          })
          return { done: fresh, detail: fresh ? 'A new conversation is open, with nothing said in it yet.' : `The conversation still has ${open()?.messages ?? 0} messages in it.` }
        }
      },
      rename: {
        name: 'Rename this conversation',
        params: { title: { type: 'string', description: 'What to call it. Blank is refused: a conversation with no name cannot be found again.', required: true } },
        unavailable: needsChat,
        run: (params) => {
          const title = String(params.title ?? '').trim()
          if (!title) throw new Error('A conversation needs a name.')
          screen.rename(title)
          return { title }
        },
        verify: async (data) => {
          const wanted = (data as { title: string }).title
          const took = await settled(() => open()?.title === wanted)
          return { done: took, detail: took ? `The conversation is called “${wanted}” now.` : `It is called “${open()?.title ?? 'nothing'}”.` }
        }
      },
      clear: {
        name: 'Empty this conversation',
        about: 'Takes every message out of it and keeps the conversation itself.',
        effects: ['delete'],
        confirmation: 'always',
        unavailable: () => needsChat() ?? (open()!.messages === 0 ? 'This conversation is already empty.' : null),
        run: () => {
          screen.clear()
          return { emptied: true }
        },
        verify: async () => {
          const empty = await settled(() => (open()?.messages ?? 0) === 0)
          return { done: empty, detail: empty ? 'The conversation is empty.' : `${open()?.messages ?? 0} messages are still in it.` }
        }
      },
      stop: {
        name: 'Stop the reply',
        unavailable: () => needsChat() ?? (open()!.replying ? null : 'Nothing is being answered right now.'),
        run: () => {
          screen.stop()
          return { stopped: true }
        },
        /*
         * Stopping is asked for, not done here.
         *
         * The reply is being streamed by the main process; this aborts the request and the stream ends when that
         * arrives back. So the check is whether it has ended -- and when it has not yet, that is said rather than
         * reported as a stop that worked.
         */
        verify: async () => {
          const stopped = await settled(() => open()?.replying !== true)
          return { done: stopped, detail: stopped ? 'The reply has stopped.' : 'The reply is still arriving; Orbis has asked for it to stop.' }
        }
      },
      find: {
        name: 'Search what was said',
        about: 'Opens the box that searches every saved conversation.',
        run: () => {
          screen.find()
          return { opened: true }
        }
      }
    },
    state: () => {
      const now = open()
      return {
        activity: now?.replying ? 'running' : 'idle',
        ...(now?.replying ? { detail: 'Orion is answering.' } : {}),
        values: {
          open: now ? now.title : 'nothing yet',
          messages: now?.messages ?? 0,
          model: screen.model(),
          incognito: screen.incognito(),
          webSearch: screen.webSearch(),
          saved: screen.chats()
        }
      }
    }
  }
}
