/**
 * The shape of Settings: what it is divided into, and how to find something in it.
 *
 * Settings had grown to some three and a half thousand lines behind a single modal — thirty-one blocks in one
 * continuous scroll, reached five different ways that all landed at the top of it. Length was not really the problem.
 * The problem was that the order had no rule: Theme sat nine items from Visual effects, the three Orion settings were
 * spread across the whole list, and the four password settings were four unrelated panels in a row. A list with no
 * order cannot be scanned and cannot be guessed at, so the only way to find anything was to read all of it.
 *
 * So the sections live here, as data, away from the interface that draws them — which means the grouping can be tested,
 * a setting can be proved to live in exactly one place, and the window and the browser can eventually offer the same
 * search over the same list rather than each inventing one.
 *
 * Nothing here knows what a setting looks like or how it is saved. This is only where things are and what they are
 * called.
 */

import { rankFindables } from './settingsSearch.ts'

export type SettingsSectionId =
  | 'account'
  | 'security'
  | 'orion'
  | 'browsing'
  | 'notifications'
  | 'appearance'
  | 'voice'
  | 'files'
  | 'games'
  | 'about'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  /** One line, shown under the heading: what this section is for, in the words somebody would use. */
  blurb: string
  /** The icon's name, resolved to a real icon by the interface. Named here so the browser can use the same list. */
  icon: string
  /**
   * What somebody might type when looking for something in here.
   *
   * Deliberately includes the words people actually use rather than the words the interface uses: somebody looking for
   * where to change their password types "password", not "account security", and somebody looking for dark mode types
   * "dark", not "theme".
   */
  keywords: string[]
  /**
   * The keys of `Settings` this section is responsible for.
   *
   * Every editable key belongs to exactly one section, which is checked by a test. A setting in two places is a
   * setting that disagrees with itself; a setting in none is one nobody can find.
   */
  settings: string[]
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = Object.freeze([
  {
    id: 'account',
    label: 'Account',
    blurb: 'Who you are to Orbis, and what it calls you.',
    icon: 'user',
    keywords: ['name', 'profile', 'assistant name', 'address me as', 'title', 'who am i', 'rename', 'picture', 'avatar', 'world'],
    // `userAvatar` is the world somebody picked for themselves. The picker has been in this section since the
    // twelve worlds were drawn; the setting was simply never written down here, so searching Settings for
    // "picture" found nothing and the guard that says every setting has a home was failing.
    settings: ['assistantName', 'userName', 'userTitle', 'userAvatar']
  },
  {
    id: 'security',
    label: 'Security',
    /**
     * These four were scattered through the old scroll with unrelated settings between them, which made four passwords
     * look like four unrelated features rather than the layers they are. They nest: the account password opens the
     * profile, the profile lock puts the whole profile away, tab locks protect single tabs, and the transfer password
     * protects a profile that has left this computer.
     */
    blurb: 'Passwords, locks, and moving a profile between computers.',
    icon: 'lock',
    keywords: ['password', 'lock', 'unlock', 'pin', 'tab lock', 'profile lock', 'transfer', 'export', 'import', 'backup', 'encryption', 'privacy'],
    settings: []
  },
  {
    id: 'orion',
    label: 'Orion',
    blurb: 'Which model answers, what it may do, and what it knows about you.',
    icon: 'sparkles',
    keywords: ['model', 'ai', 'assistant', 'memory', 'remember', 'skills', 'instructions', 'prompt', 'permissions', 'what orion may do', 'reasoning'],
    settings: ['defaultModel', 'systemPrompt', 'autoFallback', 'reasoningEffort']
  },
  {
    id: 'browsing',
    label: 'Browsing',
    blurb: 'The browser, what it suggests as you type, and the market strip.',
    icon: 'globe',
    keywords: [
      'browser',
      'default browser',
      'suggestions',
      'address bar',
      'search',
      'history',
      'launch',
      'startup',
      'markets',
      'ticker',
      'strip',
      'prices',
      'pages you have read',
      'reading',
      'recall',
      'remember pages',
      // Which sources research uses, and whether it shows its plan first. Searching for either word has to land here.
      'research',
      'sources',
      'research plan',
      'blocked sites',
      'official sources',
      'academic'
    ],
    settings: ['searchSuggestions', 'personalizedSuggestions', 'visualSearch', 'openBrowserOnLaunch', 'keepSchedulesRunning', 'wakeForSchedules', 'researchSources', 'showResearchPlan']
  },
  {
    id: 'notifications',
    /*
     * Its own section, not a corner of Appearance.
     *
     * These were two settings nothing read -- quiet hours and a set of category switches that no notification ever
     * consulted, so a person could turn notifications off and still be woken at three in the morning. Now that one
     * place decides every interruption, this is where that place takes its instructions, and it is worth finding.
     */
    label: 'Notifications',
    blurb: 'What Orbis interrupts you for, and when it stays quiet.',
    icon: 'bell',
    keywords: ['notification', 'notifications', 'alert', 'alerts', 'quiet hours', 'do not disturb', 'dnd', 'silence', 'sound', 'toast', 'popup', 'interrupt', 'tell me when', 'badge', 'history'],
    settings: []
  },
  {
    id: 'appearance',
    label: 'Appearance',
    // Theme and Visual effects were nine items apart in the old list, which is the clearest single example of the fault.
    blurb: 'Light or dark, and how much of Orbis moves.',
    icon: 'palette',
    keywords: ['theme', 'dark', 'light', 'colour', 'color', 'effects', 'motion', 'animation', 'particles', 'reduce motion'],
    settings: ['theme', 'effects']
  },
  {
    id: 'voice',
    label: 'Voice',
    blurb: 'Speech to text, running on this computer.',
    icon: 'mic',
    keywords: ['voice', 'speech', 'dictation', 'microphone', 'pulsar', 'transcribe', 'whisper', 'talk'],
    settings: []
  },
  {
    id: 'files',
    label: 'Files',
    blurb: 'The file manager and the filesystem map: what is indexed, archives, the terminal.',
    icon: 'folder',
    keywords: ['files', 'file manager', 'universe', 'index', 'archives', 'terminal', 'folders', 'search index', 'thumbnails'],
    settings: []
  },
  {
    id: 'games',
    label: 'Games',
    blurb: 'What the browser shows when a page will not load.',
    icon: 'gamepad',
    keywords: ['games', 'offline', 'no connection', 'dinosaur', 'scores'],
    settings: []
  },
  {
    id: 'about',
    label: 'About',
    blurb: 'Updates, and what Orbis is built from.',
    icon: 'info',
    keywords: ['update', 'version', 'licences', 'licenses', 'notices', 'open source', 'third party', 'about'],
    settings: []
  }
])

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'account'

/** Keys of `Settings` that are deliberately not offered in Settings, with the reason each one is not. */
export const NOT_IN_SETTINGS: Readonly<Record<string, string>> = Object.freeze({
  // Answered by whether a key has been entered, not chosen: a switch for it would be a switch that lies.
  hasApiKey: 'reported, not chosen',
  // Set once by the startup screen and never again. A switch would offer to replay an introduction.
  welcomeCompleted: 'set by the startup screen',
  introVersion: 'set by the startup screen',
  /*
   * The code sandbox the Code Playground runs programs in.
   *
   * Its address and the header its key goes in are set up once for an installation, not chosen while using Orbis, and
   * there is no screen for them -- the Playground says in words when there is no sandbox and falls back to Orion
   * reading the code and labelling the answer a guess. A switch here would imply there was something to switch.
   */
  judge0Url: 'set up once for the installation, with no screen for it',
  judge0KeyHeader: 'set up once for the installation, with no screen for it',
  // Answered by whether a key has been entered, not chosen -- the same as the model key above.
  hasJudge0Key: 'reported, not chosen'
})

export const sectionById = (id: string): SettingsSection | undefined =>
  SETTINGS_SECTIONS.find((section) => section.id === id)

/** A section id that came from somewhere untrusted, made safe. Anything unrecognised opens the first section. */
export function cleanSectionId(raw: unknown): SettingsSectionId {
  return sectionById(String(raw ?? ''))?.id ?? DEFAULT_SETTINGS_SECTION
}

/**
 * Sections matching what somebody typed, best first.
 *
 * The matching itself is in `settingsSearch.ts`, over a name, a blurb and a list of keywords -- which is all a section
 * is, as far as finding one goes. It used to be written out here, which meant the one part of this file that could be
 * subtly wrong was also the part tangled up with the list it searched. Separating them is what lets the browser's own
 * panel search the same sections the same way instead of inventing a second idea of what "password" means.
 */
export function findSections(query: string): SettingsSection[] {
  return rankFindables(SETTINGS_SECTIONS, query)
}

/** Which section a given setting lives in, for opening Settings at the thing somebody asked about. */
export function sectionForSetting(key: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.settings.includes(key))
}
