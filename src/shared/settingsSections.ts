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

export type SettingsSectionId =
  | 'account'
  | 'security'
  | 'orion'
  | 'browsing'
  | 'appearance'
  | 'voice'
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
    keywords: ['name', 'profile', 'assistant name', 'address me as', 'title', 'who am i', 'rename'],
    settings: ['assistantName', 'userName', 'userTitle']
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
    keywords: ['browser', 'default browser', 'suggestions', 'address bar', 'search', 'history', 'launch', 'startup', 'markets', 'ticker', 'strip', 'prices', 'pages you have read', 'reading', 'recall', 'remember pages'],
    settings: ['searchSuggestions', 'personalizedSuggestions', 'openBrowserOnLaunch', 'keepSchedulesRunning', 'wakeForSchedules']
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
  introVersion: 'set by the startup screen'
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
 * Scored rather than filtered, because the useful answer to "password" is Security first and not merely "the sections
 * containing that word somewhere". A name that starts with the query beats one that merely contains it, and a match on
 * the section's own name beats one on a keyword — so typing "vo" offers Voice before anything that happens to mention
 * a voice.
 */
export function findSections(query: string): SettingsSection[] {
  const wanted = String(query ?? '').trim().toLowerCase()
  if (!wanted) return [...SETTINGS_SECTIONS]

  /**
   * The words typed, as well as the whole phrase.
   *
   * Somebody typing "dark mode" means the same thing as somebody typing "dark", and matching only the whole phrase
   * found nothing for the longer one -- no keyword is literally "dark mode". So the phrase is tried first and scores
   * highest, and then each word on its own, which is what makes a half-remembered description work at all.
   */
  const words = wanted.split(/\s+/).filter((word) => word.length > 1)

  const scored: { section: SettingsSection; score: number }[] = []
  for (const section of SETTINGS_SECTIONS) {
    const label = section.label.toLowerCase()
    let score = 0

    const against = (text: string, whole: number, starts: number, part: number): void => {
      if (text === wanted) score = Math.max(score, whole)
      else if (text.startsWith(wanted)) score = Math.max(score, starts)
      else if (text.includes(wanted)) score = Math.max(score, part)
      // Then each word of the phrase, worth less than the phrase itself so a precise search still wins.
      for (const word of words) {
        if (word === wanted) continue
        if (text === word) score = Math.max(score, Math.round(whole * 0.7))
        else if (text.startsWith(word)) score = Math.max(score, Math.round(starts * 0.7))
        else if (text.includes(word)) score = Math.max(score, Math.round(part * 0.7))
      }
    }

    against(label, 100, 80, 60)
    for (const keyword of section.keywords) against(keyword.toLowerCase(), 50, 40, 20)
    against(section.blurb.toLowerCase(), 10, 10, 10)

    if (score > 0) scored.push({ section, score })
  }

  return scored
    // Ties fall back to the order the sections are declared in, so the list never shuffles between keystrokes.
    .sort(
      (a, b) =>
        b.score - a.score ||
        SETTINGS_SECTIONS.indexOf(a.section) - SETTINGS_SECTIONS.indexOf(b.section)
    )
    .map((one) => one.section)
}

/** Which section a given setting lives in, for opening Settings at the thing somebody asked about. */
export function sectionForSetting(key: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.settings.includes(key))
}
