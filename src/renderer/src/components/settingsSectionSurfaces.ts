import { AVATARS, DEFAULT_AVATAR } from '../../../shared/avatars.ts'
import { MODELS } from '../../../shared/models.ts'
import type { Settings } from '../../../shared/types.ts'
import type { SurfaceDeclaration } from '../lib/surfaces/registry.ts'

/**
 * What the Account, Orion and Browsing sections of Settings let Orbis do.
 *
 * Settings itself and its Notifications and Appearance pages were the first three screens to describe themselves.
 * These are the three remaining sections whose contents are plain `Settings` keys -- a name, a model, a handful of
 * switches -- so every setting a person can change in them is now a control Orbis can read and set as well.
 *
 * Everything goes through `onUpdate`, which is the one settings service: the same call the select, the switch and the
 * text box on each of these sections already make. There is no second place where any of this is kept, and nothing is
 * described twice -- the models come from `MODELS`, the pictures from `AVATARS`, and both lists grow without an edit
 * here.
 *
 * Here rather than inside `SettingsModal.tsx` for the usual reason: a declaration written inside a component can only
 * be checked by drawing that component, and there is no browser in the test suite. Written as a function of the
 * screen's own readers and handlers, the whole chain can be driven without React.
 */

/**
 * Settings keys that are stored and read but have no control anywhere in the window yet.
 *
 * They are offered as readings that cannot be set, each with the sentence saying so, which is the same thing Chess
 * World does with the five of its thirty fields nothing consults yet. A switch for one of these would be a switch
 * that appears to do something; leaving them out would hide a stored preference that really is in use.
 */
export const READ_ONLY_ORION_KEYS: Readonly<Record<string, string>> = Object.freeze({
  autoFallback: 'There is no control for this in Settings yet. It is read when a model refuses a request, and only a new release can change it.',
  reasoningEffort: 'There is no control for this in Settings yet. How hard Orion thinks is chosen per answer while a chat is running, not here.'
})

/** What the Account section has to hand over. Each one is a live reader or the handler its own controls call. */
export interface AccountScreen {
  /**
   * The three names as the boxes on screen show them -- which is what has been typed, not what is stored.
   *
   * Throws while the section has nothing to show, on purpose: a getter that cannot answer must throw so the control
   * comes back as "could not be read". Answering with an empty string would report somebody's name as blank.
   */
  names(): { assistantName: string; userName: string; userTitle: string }
  /** Puts a name in its box and saves it, which is what typing in the box and leaving it does. */
  setName(key: 'assistantName' | 'userName' | 'userTitle', text: string): void
  /** The picture on this account. Saved the moment one is pressed; there is nothing to confirm about a picture. */
  avatar(): string
  setAvatar(id: string): void
}

/**
 * Settings → Account: who you are to Orbis, and what it calls you.
 *
 * The three names are drafts on screen until the box is left, so each setter puts the text in the box *and* saves it
 * through the settings service -- both halves of what a person does, in one go, rather than leaving a name typed and
 * never kept.
 */
export function accountSurface(screen: AccountScreen): SurfaceDeclaration {
  /**
   * Forty characters is what the boxes themselves allow, so it is the limit here too.
   *
   * Said in the description and enforced in the setter rather than put in `max`, because `max` is the range of a
   * *number* -- `validateParams` never looks at it for a string, so declaring it there would be a limit that reads
   * as real and is not checked, and a forty-one character name would arrive silently truncated or not at all.
   */
  const LIMIT = 40
  const nameSpec = (what: string): { type: 'string'; description: string } => ({ type: 'string', description: `${what} Up to ${LIMIT} characters.` })
  const within = (text: string): string => {
    /*
     * The second sentence is there because a setter that throws comes back as a failure that can be retried, and
     * retrying this one with the same text would fail in exactly the same way. So it says what a retry has to change.
     */
    if (text.length > LIMIT) throw new Error(`A name can be at most ${LIMIT} characters, and that one is ${text.length}. Send a shorter one; the same text will be refused again.`)
    return text
  }

  return {
    id: 'account',
    parent: 'settings',
    name: 'Account',
    about: 'Who you are to Orbis, what it calls you, and the world shown beside your name.',
    kind: 'page',
    keywords: ['account', 'profile', 'name', 'my name', 'address me as', 'title', 'picture', 'avatar', 'world'],
    controls: {
      assistantName: {
        name: 'Assistant name',
        about: 'What Orbis calls itself on its own messages, and in what it is told about itself.',
        spec: nameSpec('What the assistant is called.'),
        get: () => screen.names().assistantName,
        set: (value) => screen.setName('assistantName', within(String(value ?? ''))),
        default: 'Orbis'
      },
      yourName: {
        name: 'Your name',
        about: 'Shown on your own messages.',
        spec: nameSpec('What you are called.'),
        get: () => screen.names().userName,
        set: (value) => screen.setName('userName', within(String(value ?? '')))
      },
      addressMeAs: {
        name: 'Address me as',
        about: 'How the assistant addresses you: "Commander", "Dr Rao", whatever you like. Empty means it just uses your name.',
        spec: nameSpec('How the assistant addresses you. Empty for nothing in particular.'),
        get: () => screen.names().userTitle,
        set: (value) => screen.setName('userTitle', within(String(value ?? ''))),
        default: ''
      },
      world: {
        name: 'Your world',
        about: 'The picture beside your name: one of the twelve worlds, by its id. The description names each one.',
        /*
         * The twelve the picker draws, from the same list it draws them from, by id -- with the names said in the
         * description.
         *
         * The id alone, deliberately, and this is the one decision in this file worth explaining. Taking the name on
         * screen as well would be friendlier to read and dishonest to write: a write is confirmed by reading the
         * control back, so setting it to "Nebula" and reading back "orchid" is a write that worked being reported as
         * one that could not be confirmed. A control holds one kind of value. The names are here to be read, so the
         * right id can be sent in the first place.
         */
        spec: {
          type: 'string',
          description: `Which world is shown beside your name. ${AVATARS.map((one) => `${one.id} is ${one.name}`).join('; ')}.`,
          enum: AVATARS.map((one) => one.id)
        },
        // Never chosen means the first one, which is what the picker shows as chosen too.
        get: () => screen.avatar() || DEFAULT_AVATAR,
        set: (value) => {
          const want = String(value)
          const found = AVATARS.find((one) => one.id === want)
          if (!found) throw new Error(`There is no world called “${want}”. The twelve are: ${AVATARS.map((one) => `${one.name} (${one.id})`).join(', ')}.`)
          screen.setAvatar(found.id)
        },
        default: DEFAULT_AVATAR
      }
    },
    state: () => {
      const names = screen.names()
      return {
        values: {
          assistantName: names.assistantName,
          yourName: names.userName,
          // Left as what it is -- empty is a real answer here, and "not set" would be inventing one.
          addressMeAs: names.userTitle,
          world: screen.avatar() || DEFAULT_AVATAR
        }
      }
    }
  }
}

/** What the Orion section has to hand over. */
export interface OrionScreen {
  /** Which model answers new chats. */
  model(): string
  setModel(id: string): void
  /**
   * The custom instructions as the box on screen shows them: what has been typed, not what is stored.
   *
   * Throws while there is nothing to show, for the same reason as the names above.
   */
  instructions(): string
  /** Puts the instructions in the box and saves them -- typing in the box and leaving it, in one go. */
  setInstructions(text: string): void
  /** Settings keys this section is responsible for that have no control: read here, chosen elsewhere or not at all. */
  stored(): Pick<Settings, 'autoFallback' | 'reasoningEffort'>
}

/**
 * Settings → Orion: which model answers, and what it is told about you.
 *
 * What Orion may *do* is not here. That is the `ControlSwitches` panel, and it is already a real thing Orbis can set
 * through the control registry's own effect policy -- offering it a second time as a control on this screen would be
 * two ways of changing one rule.
 */
export function orionSurface(screen: OrionScreen): SurfaceDeclaration {
  const byId = (id: string): (typeof MODELS)[number] | undefined => MODELS.find((one) => one.id === id)

  return {
    id: 'orion',
    parent: 'settings',
    name: 'Orion',
    about: 'Which model answers new chats, and the standing instructions every chat starts with.',
    kind: 'page',
    keywords: ['orion', 'model', 'ai', 'assistant', 'instructions', 'custom instructions', 'prompt', 'memory'],
    controls: {
      model: {
        name: 'Default model',
        // Named by its id, with the names on screen said in the description, because the id is what is stored and a
        // write of "ORION Max" that resolved to an id would be this file guessing at a chooser it does not own.
        about: 'Used for new chats. A chat already open keeps whatever it was started with.',
        // The id, with the names said in the description, for the reason the world above gives at length: a control
        // holds one kind of value, or a write that worked cannot be confirmed by reading it back.
        spec: {
          type: 'string',
          description: `Which model answers new chats. ${MODELS.map((one) => `${one.id} is ${one.label}`).join('; ')}.`,
          enum: MODELS.map((one) => one.id)
        },
        get: () => screen.model(),
        set: (value) => {
          const want = String(value)
          const found = byId(want)
          if (!found) throw new Error(`There is no model called “${want}”. The ones offered are: ${MODELS.map((one) => `${one.label} (${one.id})`).join(', ')}.`)
          screen.setModel(found.id)
        },
        default: MODELS[0]?.id
      },
      instructions: {
        name: 'Custom instructions',
        about: 'What Orion should know about you, or how it should answer. Sent with every chat.',
        spec: { type: 'string', description: 'Standing instructions for every chat. Empty for none.' },
        get: () => screen.instructions(),
        set: (value) => screen.setInstructions(String(value ?? '')),
        default: ''
      },
      // The two this section is responsible for that nothing on screen chooses. Readable, and each says in a
      // sentence why it cannot be set here.
      ...Object.fromEntries(
        Object.entries(READ_ONLY_ORION_KEYS).map(([key, why]) => [
          key,
          {
            name: key === 'autoFallback' ? 'Fall back to another model' : 'How hard Orion thinks',
            about: why,
            spec: {
              type: (key === 'autoFallback' ? 'boolean' : 'string') as 'boolean' | 'string',
              description: why,
              ...(key === 'reasoningEffort' ? { enum: ['low', 'high', 'max'] } : {})
            },
            get: () => screen.stored()[key as 'autoFallback' | 'reasoningEffort'],
            writable: () => why
          }
        ])
      )
    },
    state: () => {
      const id = screen.model()
      const found = byId(id)
      return {
        values: {
          model: id,
          // The name on screen as well as the id, because the id is not what anybody calls it.
          modelName: found?.label ?? 'a model this release does not list',
          // How long they are, not what they say: the instructions can be read deliberately and are nobody's
          // business in a summary of what is on screen.
          instructionsLength: screen.instructions().length
        }
      }
    }
  }
}

/** What the Browsing section has to hand over: one reader and one handler for each switch it draws. */
export interface BrowsingScreen {
  /** What is saved now. Throws while it cannot be read, so a switch is never reported off because a file was slow. */
  stored(): Pick<
    Settings,
    'showResearchPlan' | 'openBrowserOnLaunch' | 'keepSchedulesRunning' | 'wakeForSchedules' | 'searchSuggestions' | 'visualSearch' | 'personalizedSuggestions'
  >
  /** The handler every switch on the section calls. */
  set(key: string, on: boolean): void
}

/**
 * The switches on Settings → Browsing, as the section itself words them.
 *
 * Kept as data so the control and the switch cannot drift apart, and so that what each one does -- and what it does
 * not -- is said in the same words a person reads on screen.
 */
const BROWSING_SWITCHES: readonly { key: string; name: string; what: string }[] = Object.freeze([
  {
    key: 'showResearchPlan',
    name: 'Show the research plan first',
    what: 'Research says what it is about to search for and waits, so it can be changed. Off, it starts straight away.'
  },
  {
    key: 'openBrowserOnLaunch',
    name: 'Open browser on launch',
    what: 'Orbis starts in its browser, at the saved browser size, instead of the chat.'
  },
  {
    key: 'keepSchedulesRunning',
    name: 'Keep schedules running when you close Orbis',
    what: 'Orbis stays running with no window while something is scheduled. There is a tray icon with a way to quit, and it quits by itself once nothing is scheduled.'
  },
  {
    key: 'wakeForSchedules',
    name: 'Wake this computer for a schedule',
    what: 'Windows wakes a sleeping computer for the next thing due. It cannot wake one that is switched off, and wake timers are often off on battery.'
  },
  {
    key: 'searchSuggestions',
    name: 'Web search suggestions',
    what: 'As you type in the address bar, the search engine and Orion are asked for likely searches. This sends what you type.'
  },
  {
    key: 'visualSearch',
    name: 'Visual Search',
    what: 'Hold Ctrl and drag over anything on a page to ask Orion about it. Off removes the gesture rather than hiding a button.'
  },
  {
    key: 'personalizedSuggestions',
    name: 'Personalized suggestions',
    what: 'Suggestions come from your own history, searches, bookmarks and research, and Orbis learns which you pick. Stays on this computer.'
  }
])

/**
 * Settings → Browsing: the browser, what it suggests, and what Orbis is allowed to do while you are not looking.
 *
 * Which sources research leans towards is not here. It is a whole shape rather than a switch, with its own panel, and
 * the `research` capabilities already set it -- a second, flatter version of it on this screen would be a second
 * answer to the same question.
 */
export function browsingSurface(screen: BrowsingScreen): SurfaceDeclaration {
  return {
    id: 'browsing',
    parent: 'settings',
    name: 'Browsing',
    about: 'The browser, what the address bar suggests, and whether Orbis keeps running for a schedule.',
    kind: 'page',
    keywords: ['browsing', 'browser', 'address bar', 'suggestions', 'research plan', 'schedules', 'wake', 'visual search', 'launch'],
    controls: Object.fromEntries(
      BROWSING_SWITCHES.map((one) => [
        one.key,
        {
          name: one.name,
          about: one.what,
          spec: { type: 'boolean' as const, description: one.what },
          /*
           * `visualSearch` is on unless it was turned off, which is what the switch on screen shows too.
           *
           * Said here rather than in the store because that is where the difference really is: the setting was added
           * after people had already saved their settings, so "never decided" has to read as on.
           */
          get: () =>
            one.key === 'visualSearch'
              ? (screen.stored() as Record<string, unknown>).visualSearch !== false
              : (screen.stored() as Record<string, unknown>)[one.key] === true,
          set: (on: unknown) => screen.set(one.key, on === true),
          default: one.key === 'visualSearch' ? true : false
        }
      ])
    ),
    state: () => {
      const stored = screen.stored() as Record<string, unknown>
      return {
        values: Object.fromEntries(BROWSING_SWITCHES.map((one) => [one.key, one.key === 'visualSearch' ? stored.visualSearch !== false : stored[one.key] === true]))
      }
    }
  }
}
