/**
 * Every piece of Orbis data that persists, what class it belongs to, and what happens to it in a transfer.
 *
 * This file is the authoritative inventory. It exists because the alternative -- a list of exporters scattered across
 * twenty modules -- has one failure mode that matters: a feature ships, nobody adds it to the export, and the profile
 * transfer quietly stops being complete while continuing to say "Everything". A registry that a test compares against
 * the filesystem cannot do that.
 *
 * ## The three classes, and why the third one exists
 *
 * **Portable** data is copied. A note is a note on any machine.
 *
 * **Portable with transformation** has to be adapted. A window at x=3840 is off-screen on a laptop; an absolute path
 * into `C:\Users\Alice` does not exist for Bob. These are transferred as logical values and resolved on arrival.
 *
 * **Device-bound** data must *not* be copied, and saying so is the point. An API key encrypted with the operating
 * system's own key store cannot be decrypted on another machine -- copying those bytes would produce a profile with a
 * key-shaped thing in it that never works, which is worse than a profile that asks for the key again. So it is named,
 * excluded, and the user is told what to re-enter.
 *
 * ## What "everything" means
 *
 * `EVERYTHING` is derived from this table, never written out by hand. A category added here is in the next export
 * without anybody remembering to include it; a category missing from here fails `registry.test.ts`, which walks the
 * real data directory and complains about anything it does not recognise.
 */

// ---------------------------------------------------------------- the classes

export type PortabilityClass =
  /** Copied as it is. The same bytes mean the same thing on any machine. */
  | 'portable'
  /** Copied, then adapted to the destination: paths, geometry, device names, scheduler registrations. */
  | 'transformed'
  /** Never copied. Reconstructed on arrival, or re-established by the user. */
  | 'device-bound'
  /** Derived from something else in the package. Left out, rebuilt after import. */
  | 'rebuilt'

export type Sensitivity =
  /** Nothing private. Preferences, layouts, counts. */
  | 'ordinary'
  /** The user's own content: notes, conversations, boards. Private, not secret. */
  | 'personal'
  /** Already encrypted at rest by something the user knows. Travels sealed. */
  | 'sealed'
  /** Cannot leave the machine in a usable form. Named and excluded. */
  | 'device-secret'

export interface PortableCategory {
  /** Stable for ever. Appears in manifests, so renaming one breaks old packages. */
  id: string
  /** What a person would call it. */
  label: string
  /** One sentence, shown in the export picker. */
  describe: string
  portability: PortabilityClass
  sensitivity: Sensitivity

  /**
   * Where it lives now, relative to the profile's own data directory, or to the user-data directory for `scope: 'app'`.
   *
   * Recorded so the audit test can walk the real directory and check nothing persists outside this table. It is
   * documentation of the present, not the package layout -- the package uses its own canonical paths, which is what
   * lets storage change without invalidating old packages.
   */
  storage: string[]
  scope: 'profile' | 'app'

  /** The portable schema's own version. Each category migrates independently. */
  schemaVersion: number
  /** Categories that must be restored before this one. Ids from this table. */
  dependsOn: string[]

  /** True when the user has to sign in or re-enter something on the destination. */
  requiresReauthentication: boolean
  /** What the user must do, when they must do something. Null when nothing is required of them. */
  userAction: string | null
  /** Why it is not simply copied, for the classes where that needs saying. Null for plain portable data. */
  why: string | null
  /** Whether a merge into an existing profile can be done object by object rather than all-or-nothing. */
  mergeable: boolean
}

const category = (one: PortableCategory): PortableCategory => Object.freeze(one)

// ---------------------------------------------------------------- the inventory

export const CATEGORIES: readonly PortableCategory[] = Object.freeze([
  // ---- identity
  category({
    id: 'profile.identity',
    label: 'Profile',
    describe: 'The profile\u2019s name, colour and mark.',
    portability: 'portable',
    sensitivity: 'ordinary',
    storage: ['profiles.json'],
    scope: 'app',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: false
  }),
  category({
    id: 'profile.security',
    label: 'Account password',
    describe: 'The account password, as the sealed key it already is.',
    portability: 'portable',
    sensitivity: 'sealed',
    storage: ['account.lock'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['profile.identity'],
    requiresReauthentication: false,
    // Portable because the key is wrapped by the password itself through scrypt, not by anything belonging to this
    // machine. The same password opens it anywhere, and Orbis never holds the password to put in the package.
    userAction: null,
    why: null,
    mergeable: false
  }),

  // ---- Orion
  category({
    id: 'orion.conversations',
    label: 'Orion conversations',
    describe: 'Every conversation, with its messages, attachments and titles.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['conversations'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['assets'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'orion.memory',
    label: 'Orion memory',
    describe: 'What Orion has been asked to remember, and how the entries relate.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['knowledge/knowledge.db'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'orion.settings',
    label: 'Orion preferences',
    describe: 'The model, effort, system prompt, names and the rest of the Orion settings.',
    portability: 'portable',
    sensitivity: 'ordinary',
    storage: ['settings.json'],
    scope: 'app',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: false
  }),
  category({
    id: 'orion.apiKey',
    label: 'Model provider key',
    describe: 'The API key for the model provider.',
    portability: 'device-bound',
    sensitivity: 'device-secret',
    storage: ['settings.json'],
    scope: 'app',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: true,
    userAction: 'Enter your model provider key again on the new device.',
    why:
      'The key is encrypted with this operating system\u2019s own key store, which is tied to this machine and this user account. Those bytes cannot be decrypted anywhere else, so copying them would produce a key-shaped value that never works.',
    mergeable: false
  }),

  // ---- knowledge
  category({
    id: 'galaxy.graph',
    label: 'Galaxy',
    describe: 'The knowledge graph: its nodes, links and what they came from.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['knowledge/knowledge.db'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['orion.conversations'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'search.sessions',
    label: 'Orion Search sessions',
    describe: 'Saved search sessions and the sources they gathered.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['knowledge/knowledge.db'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),

  // ---- what a person keeps
  category({
    id: 'notes',
    label: 'Notes',
    describe: 'Notes, their folders and tags.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['personal/notes.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['assets'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'tasks',
    label: 'Tasks',
    describe: 'Tasks, their lists, due dates and what is done.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['personal/tasks.json', 'personal/task-lists.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'whiteboards',
    label: 'Whiteboards',
    describe: 'Boards, everything on them and where it sits.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['personal/whiteboards.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['assets'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'workspaces',
    label: 'Workspaces',
    describe: 'Workspaces, their tabs, groups and appearance.',
    portability: 'transformed',
    sensitivity: 'personal',
    storage: ['personal/workspaces.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: 'Tabs are restored by address. The runtime identifiers a live tab carries belong to the browser process that opened it and are made fresh.',
    mergeable: true
  }),
  category({
    id: 'tray',
    label: 'Tray',
    describe: 'What has been put aside in the tray.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['personal/tray.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['assets'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),

  // ---- automation
  category({
    id: 'workflows.definitions',
    label: 'Workflows',
    describe: 'Workflow definitions, their steps, variables and conditions.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['workflows'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['pages.documents'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'workflows.schedules',
    label: 'Workflow schedules',
    describe: 'When a workflow is set to run.',
    portability: 'transformed',
    sensitivity: 'ordinary',
    storage: ['workflows/repeats.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['workflows.definitions'],
    requiresReauthentication: false,
    userAction: null,
    why:
      'The time and the rule travel; the scheduler entry does not. A scheduler identifier belongs to the machine that made it, so the destination registers its own -- which also stops a second import creating a duplicate job.',
    mergeable: true
  }),
  category({
    id: 'workflows.runs',
    label: 'Workflow history',
    describe: 'What each workflow has done, and when.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['workflows/runs.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['workflows.definitions'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'skills',
    label: 'Skills',
    describe: 'Skills saved from step-by-step runs, and how they are configured.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['skills'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['workflows.definitions'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),

  // ---- pages and markets
  category({
    id: 'pages.documents',
    label: 'Orbis Pages',
    describe: 'Pages, what they hold, and their own saved work.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['pages.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['assets'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'markets',
    label: 'Markets',
    describe: 'Watchlists, alerts, screens, strategies, the paper account, drawings and pattern rules.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['markets.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: false
  }),

  // ---- appearance
  category({
    id: 'personalization',
    label: 'Personalisation',
    describe: 'Appearance, presets, layout, density, motion and accessibility.',
    portability: 'transformed',
    sensitivity: 'ordinary',
    storage: ['experience/experience.json', 'experience/snapshots.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['assets'],
    requiresReauthentication: false,
    userAction: null,
    why: 'Sizes travel as logical values rather than as pixels measured on the source display, so a layout made at 4K stays usable at 1366 by 768.',
    mergeable: true
  }),
  category({
    id: 'browser.sidebar',
    label: 'Browser sidebar',
    describe: 'What is in the sidebar, in what order, and how wide it is.',
    portability: 'transformed',
    sensitivity: 'ordinary',
    storage: ['browser-sidebar.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: 'A width is kept as a logical size and clamped to what fits the destination window.',
    mergeable: false
  }),

  // ---- the browser
  category({
    id: 'browser.library',
    label: 'Bookmarks and reading list',
    describe: 'Bookmarks, their folders, the reading list and saved pages.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['browser-library.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['assets'],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'browser.history',
    label: 'Browsing history',
    describe: 'Where the browser has been, and when.',
    portability: 'transformed',
    sensitivity: 'personal',
    storage: ['browser/Default/History'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why:
      'Read out of Chromium\u2019s own database into addresses, titles and times, and written back through the destination\u2019s. The database file itself carries indexes and identifiers belonging to the installation that built it.',
    mergeable: true
  }),
  category({
    id: 'browser.preferences',
    label: 'Site settings',
    describe: 'What each site is allowed to do, and the browser\u2019s own preferences.',
    portability: 'transformed',
    sensitivity: 'ordinary',
    storage: ['browser/Default/Preferences'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: 'The preferences that describe choices travel. The ones naming this machine\u2019s paths, displays and hardware are left for the destination to set.',
    mergeable: false
  }),
  category({
    id: 'browser.session',
    label: 'Open tabs',
    describe: 'The tabs and groups that are open, and which one is in front.',
    portability: 'transformed',
    sensitivity: 'personal',
    storage: ['browser/Default/Sessions'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['workspaces'],
    requiresReauthentication: false,
    userAction: null,
    why: 'Described as addresses and groups, then reopened. A session file holds handles into a browser process that no longer exists.',
    mergeable: false
  }),
  category({
    id: 'browser.siteData',
    label: 'Cookies and site data',
    describe: 'Cookies, local storage and what sites have kept.',
    portability: 'device-bound',
    sensitivity: 'device-secret',
    storage: ['browser/Default/Cookies', 'browser/Default/Local Storage', 'browser/Default/IndexedDB'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: true,
    userAction: 'Sign in again on the sites you were signed in to.',
    why:
      'Chromium seals cookies with a key held by this operating system for this user. Those bytes cannot be read on another machine, and a partial copy is how a browser ends up signed in to nothing while believing it is signed in.',
    mergeable: false
  }),
  category({
    id: 'browser.passwords',
    label: 'Saved passwords',
    describe: 'Passwords the browser has saved.',
    portability: 'device-bound',
    sensitivity: 'device-secret',
    storage: ['browser/Default/Login Data'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: true,
    userAction: 'Use the browser\u2019s own password export and import, or sign in to the sites again.',
    why:
      'Saved passwords are sealed with the operating system\u2019s key store. Orbis will not decrypt them to put them in a file: a package that contained readable passwords would be a password file with a different extension.',
    mergeable: false
  }),
  category({
    id: 'browser.extensions',
    label: 'Extensions',
    describe: 'Which extensions were installed, and how they were set up.',
    portability: 'transformed',
    sensitivity: 'personal',
    storage: ['browser/Default/Extensions', 'browser/Default/Local Extension Settings'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: 'Reinstall the extensions listed in the import report. Their settings are restored once they are back.',
    why:
      'Which extensions were installed and how they were configured travels. The extension code does not: redistributing somebody else\u2019s package is not Orbis\u2019s to do, and installing one has to go through the normal consent.',
    mergeable: true
  }),
  category({
    id: 'browser.caches',
    label: 'Browser caches',
    describe: 'What the browser has cached to make pages load faster.',
    portability: 'rebuilt',
    sensitivity: 'ordinary',
    storage: ['browser/Default/Cache', 'browser/Default/Code Cache', 'browser/Default/GPUCache', 'browser/ShaderCache'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: 'A cache is a copy of something that can be fetched again. Packaging gigabytes of it would make the transfer slower and the result no better.',
    mergeable: false
  }),

  // ---- security
  category({
    id: 'secrets.vault',
    label: 'Secrets Vault',
    describe: 'The vault, still sealed.',
    portability: 'portable',
    sensitivity: 'sealed',
    storage: ['secrets.vault'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: true,
    userAction: 'Unlock the vault with its master password on the new device.',
    // The vault's key is wrapped by the master password through scrypt, not by anything belonging to this machine, so
    // the file travels exactly as it is. Nothing in it is readable without the password -- not the values, not the
    // names, not how many there are -- and Orbis never has the password to put in the package.
    why: null,
    mergeable: false
  }),
  category({
    id: 'tabLock',
    label: 'Tab Lock',
    describe: 'Which tabs and sites are protected, and how.',
    portability: 'portable',
    sensitivity: 'sealed',
    storage: ['tab-locks.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: true,
    userAction: 'Enter a locked tab\u2019s password when you first open it on the new device.',
    why: null,
    mergeable: true
  }),
  category({
    id: 'security.log',
    label: 'Security log',
    describe: 'What Orbis recorded about access to this profile.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['security-log.json'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),
  category({
    id: 'control.switches',
    label: 'Browser control switches',
    describe: 'Which kinds of browser action Orion may take.',
    portability: 'portable',
    sensitivity: 'ordinary',
    storage: ['control-switches.json', 'control-capabilities.json'],
    scope: 'app',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: false
  }),

  // ---- assets
  category({
    id: 'assets',
    label: 'Files and images',
    describe: 'Wallpapers, attachments, generated images and everything else stored as a file.',
    portability: 'portable',
    sensitivity: 'personal',
    storage: ['assets', 'generated'],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why: null,
    mergeable: true
  }),

  // ---- shared across profiles, and therefore not a profile's to export
  category({
    id: 'clipboard',
    label: 'Clipboard history',
    describe: 'What has been copied, and what is pinned.',
    portability: 'device-bound',
    sensitivity: 'personal',
    storage: ['personal/clipboard.json', 'personal/clipboard-settings.json'],
    scope: 'app',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why:
      'Clipboard history is kept for the installation rather than per profile, so it is not this profile\u2019s to hand over. Exporting it would put every profile\u2019s copied text -- which is where passwords are most often found -- into one profile\u2019s package.',
    mergeable: false
  }),

  // ---- derived
  category({
    id: 'search.index',
    label: 'Search index',
    describe: 'The index that makes Pages, notes and bookmarks findable.',
    portability: 'rebuilt',
    sensitivity: 'ordinary',
    storage: [],
    scope: 'profile',
    schemaVersion: 1,
    dependsOn: ['pages.documents', 'notes', 'browser.library'],
    requiresReauthentication: false,
    userAction: null,
    why: 'Built from data that is in the package. Rebuilding it is faster than carrying it, and it cannot arrive stale.',
    mergeable: false
  }),
  category({
    id: 'device.state',
    label: 'Window and display state',
    describe: 'Where windows were, on which screen, at what scaling.',
    portability: 'device-bound',
    sensitivity: 'ordinary',
    storage: [],
    scope: 'app',
    schemaVersion: 1,
    dependsOn: [],
    requiresReauthentication: false,
    userAction: null,
    why:
      'A window at x=3840 is off-screen on a single-monitor machine. The preference -- how large, which layout, which panels -- travels under personalisation; the coordinates are worked out again from the destination\u2019s own displays.',
    mergeable: false
  })
])

// ---------------------------------------------------------------- reading it

const BY_ID = new Map(CATEGORIES.map((one) => [one.id, one]))

/**
 * A category by id.
 *
 * Through a `Map`, because an id can arrive from a package somebody else made, and `CATEGORIES['constructor']` on a
 * plain object answers with a function.
 */
export const categoryById = (id: string): PortableCategory | undefined => BY_ID.get(id)

/**
 * Everything an export includes when the user asks for everything.
 *
 * Derived, never listed. A category added above is in the next export without anybody remembering it, which is the
 * only arrangement under which "Everything" stays true as Orbis grows.
 */
export const EVERYTHING: readonly string[] = Object.freeze(
  CATEGORIES.filter((one) => one.portability === 'portable' || one.portability === 'transformed').map((one) => one.id)
)

/** Categories deliberately left out, with the reason each one is left out. */
export const EXCLUDED: readonly PortableCategory[] = Object.freeze(
  CATEGORIES.filter((one) => one.portability === 'device-bound' || one.portability === 'rebuilt')
)

/** What the user has to do after an import, gathered from the categories being restored. */
export function actionsAfterImport(categoryIds: readonly string[]): { id: string; label: string; action: string }[] {
  const wanted = new Set(categoryIds)
  return CATEGORIES.filter((one) => one.requiresReauthentication && one.userAction !== null && (wanted.has(one.id) || one.portability === 'device-bound'))
    .map((one) => ({ id: one.id, label: one.label, action: one.userAction as string }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The order to restore in, dependencies first.
 *
 * A topological sort rather than a hand-written list, so adding a category with a dependency puts it in the right
 * place automatically. A cycle is returned as an error rather than resolved: two categories that each need the other
 * restored first is a modelling mistake, and picking an order would hide it.
 */
export function restoreOrder(categoryIds: readonly string[]): { order: string[] } | { error: string; cycle: string[] } {
  const wanted = categoryIds.filter((one) => BY_ID.has(one))
  const remaining = new Set(wanted)
  const order: string[] = []

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => (categoryById(id)?.dependsOn ?? []).every((need) => !remaining.has(need)))
      .sort()
    if (ready.length === 0) {
      return { error: 'These categories depend on each other in a circle, so there is no order to restore them in.', cycle: [...remaining].sort() }
    }
    for (const id of ready) {
      order.push(id)
      remaining.delete(id)
    }
  }
  return { order }
}

/** Every category whose dependencies are also being restored, plus the dependencies that had to be added. */
export function withDependencies(categoryIds: readonly string[]): { categories: string[]; added: string[] } {
  const chosen = new Set(categoryIds.filter((one) => BY_ID.has(one)))
  const added: string[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...chosen]) {
      for (const need of categoryById(id)?.dependsOn ?? []) {
        // Only pull in a dependency that can actually travel. A rebuilt or device-bound one is satisfied by the
        // destination rather than by the package, so adding it to the selection would promise something else.
        const one = categoryById(need)
        if (one === undefined || chosen.has(need)) continue
        if (one.portability !== 'portable' && one.portability !== 'transformed') continue
        chosen.add(need)
        added.push(need)
        changed = true
      }
    }
  }
  return { categories: [...chosen].sort(), added: [...new Set(added)].sort() }
}

/** The assumptions the registry rests on, shown rather than implied. */
export const REGISTRY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'This table is the authoritative inventory. A category not in it is not in any export, and a store on disk not covered by it fails the audit test.',
  '"Everything" is derived from this table rather than written out, so a new feature becomes portable by being added here.',
  'Data encrypted by the operating system\u2019s own key store is never copied. Those bytes cannot be decrypted elsewhere, and a key-shaped value that never works is worse than being asked for the key.',
  'Data encrypted by something the user knows travels sealed, because the password opens it anywhere and Orbis never holds it.',
  'A derived index is rebuilt rather than carried: it is smaller to rebuild and it cannot arrive stale.',
  'Window coordinates are never copied. The preference travels and the geometry is worked out from the destination\u2019s displays.',
  'Clipboard history is kept for the installation rather than per profile, so no profile\u2019s export contains it.',
  'Every excluded category records why it is excluded and what the user has to do instead.',
  'Restore order is a topological sort of the declared dependencies; a cycle is an error rather than an order somebody picked.'
])
