/**
 * What Orbis can do, as one list.
 *
 * The Command Center does not know how to block an advertisement, run a workflow or take a screenshot. It knows what
 * Orbis is capable of, where each capability lives, and what each one needs in order to work; the capability itself is
 * implemented where it always was. That separation is the point: adding a feature to Orbis means adding a line here,
 * not redesigning a panel, and nothing in the interface is a route somebody wired by hand.
 *
 * Every entry below is a capability that genuinely exists today. A capability is listed with what it depends on --
 * the browser, the helper, the network -- and the interface asks before it offers: a button that cannot work is not
 * drawn as though it can. Nothing here is aspirational.
 *
 * Pure: no DOM, no storage, no browser. Tested in commandCenter.test.ts.
 */

export type CommandCategory =
  | 'browser'
  | 'ai'
  | 'automation'
  | 'research'
  | 'capture'
  | 'media'
  | 'protection'
  | 'workspace'
  | 'customize'

export const CATEGORIES: { id: CommandCategory; label: string; icon: string; blurb: string }[] = [
  { id: 'browser', label: 'Browser', icon: 'tabs', blurb: 'Tabs, navigation, and everything Orbis keeps for you' },
  { id: 'ai', label: 'AI', icon: 'orion', blurb: 'Orion: asking, reading this page, and acting on it' },
  { id: 'automation', label: 'Automation', icon: 'workflows', blurb: 'Work Orbis does for you, and what it did' },
  { id: 'research', label: 'Research', icon: 'research', blurb: 'Searching, sources, notes and how they connect' },
  { id: 'capture', label: 'Capture', icon: 'screenshots', blurb: 'Pictures of pages, and pages kept to read later' },
  { id: 'media', label: 'Media', icon: 'media', blurb: 'What is playing, and where' },
  { id: 'protection', label: 'Privacy & Protection', icon: 'privacy', blurb: 'What a page is allowed to do' },
  { id: 'workspace', label: 'Workspace', icon: 'workspaces', blurb: 'Sets of tabs, and the things you are keeping' },
  { id: 'customize', label: 'Customize', icon: 'customize', blurb: 'How Orbis looks and what sits on the toolbar' }
]

/** What a capability needs before it can do anything. Checked before it is offered, not after it fails. */
export type Requirement =
  /** The Orbis browser must be running and reachable (the Browser Control Layer). */
  | 'browser'
  /** The local helper must be answering. */
  | 'helper'
  /** A key for Orion. */
  | 'key'
  /** A web page to act on: not a new tab, not a built-in page. */
  | 'page'

/** Where opening a capability goes. */
export type Target =
  /** A view of the Orbis panel, chrome://orbis/#<view>. */
  | { kind: 'panel'; view: string }
  /** One of the panel's own rail views (orbis-ui/panel/rail), which reads the real browser or store. */
  | { kind: 'view'; view: string }
  /** A page in the browser. */
  | { kind: 'page'; url: string }

export interface OrbisCapability {
  id: string
  name: string
  category: CommandCategory
  /** One line, in the interface. Not documentation. */
  description: string
  /** A name in the shared icon set (orbis-ui/panel/rail/icons.js). */
  icon: string
  /** Other words somebody might look for it by. The name itself is always searched. */
  keywords: string[]
  target: Target
  /** True when a real Chromium toolbar action exists for it, so it can be pinned beside the address bar. */
  pinnable: boolean
  needs: Requirement[]
}

/**
 * The capabilities Orbis has.
 *
 * `pinnable` is true only where a toolbar action genuinely exists (chrome/browser/ui/browser_actions.cc). Marking
 * anything else pinnable would put a button in the Command Center that could not become a button on the toolbar.
 */
export const CAPABILITIES: OrbisCapability[] = [
  // ---- Browser
  { id: 'tabs', name: 'Tabs', category: 'browser', description: 'Every open tab, to search, switch or close', icon: 'tabs', keywords: ['tab', 'switch', 'open', 'close'], target: { kind: 'view', view: 'tabs' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'tabGroups', name: 'Tab groups', category: 'browser', description: 'The groups your tabs are gathered into', icon: 'tabGroups', keywords: ['group', 'collection'], target: { kind: 'view', view: 'tabGroups' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'navigation', name: 'Navigation', category: 'browser', description: 'Back, forward, reload and stop', icon: 'back', keywords: ['back', 'forward', 'reload', 'refresh', 'stop'], target: { kind: 'view', view: 'controls' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'zoom', name: 'Zoom', category: 'browser', description: 'How large this page is drawn', icon: 'zoomIn', keywords: ['zoom', 'bigger', 'smaller', 'text size'], target: { kind: 'view', view: 'controls' }, pinnable: false, needs: ['browser', 'helper', 'page'] },
  { id: 'bookmarks', name: 'Bookmarks', category: 'browser', description: 'Pages kept for later', icon: 'bookmarks', keywords: ['bookmark', 'favourite', 'favorite', 'saved'], target: { kind: 'page', url: 'chrome://bookmarks/' }, pinnable: false, needs: ['browser'] },
  { id: 'history', name: 'History', category: 'browser', description: 'Where this profile has been', icon: 'history', keywords: ['history', 'visited', 'recent'], target: { kind: 'page', url: 'chrome://history/' }, pinnable: false, needs: ['browser'] },
  { id: 'downloads', name: 'Downloads', category: 'browser', description: 'Files Orbis has fetched', icon: 'downloads', keywords: ['download', 'file', 'saved'], target: { kind: 'page', url: 'chrome://downloads/' }, pinnable: false, needs: ['browser'] },
  { id: 'extensions', name: 'Extensions', category: 'browser', description: 'What is installed, and whether it is on', icon: 'extensions', keywords: ['extension', 'addon', 'add-on', 'plugin'], target: { kind: 'page', url: 'chrome://extensions/' }, pinnable: false, needs: ['browser'] },

  { id: 'controls', name: 'Browser controls', category: 'browser', description: 'Everything Orbis can be asked to do, and what it has done', icon: 'controls', keywords: ['control', 'command', 'capability', 'action'], target: { kind: 'view', view: 'controls' }, pinnable: false, needs: ['browser', 'helper'] },

  // ---- AI
  { id: 'ask', name: 'Ask Orion', category: 'ai', description: 'Ask about this page, or about anything', icon: 'orion', keywords: ['orion', 'ai', 'chat', 'ask', 'assistant', 'question'], target: { kind: 'panel', view: 'ask' }, pinnable: true, needs: ['helper', 'key'] },
  { id: 'orbSummarise', name: 'Summarise this page', category: 'ai', description: 'What this page says, in short', icon: 'orion', keywords: ['summary', 'summarise', 'summarize', 'tldr', 'explain'], target: { kind: 'panel', view: 'ask' }, pinnable: false, needs: ['helper', 'key', 'browser', 'page'] },
  { id: 'browserTask', name: 'Do something on this page', category: 'ai', description: 'Give Orbis a task and watch it work in the browser', icon: 'controls', keywords: ['task', 'agent', 'automate', 'click', 'do', 'act'], target: { kind: 'panel', view: 'ask' }, pinnable: false, needs: ['helper', 'key', 'browser'] },

  // ---- Automation
  { id: 'workflows', name: 'Workflows', category: 'automation', description: 'Sequences Orbis runs for you, and what they did', icon: 'workflows', keywords: ['workflow', 'automation', 'automate', 'routine', 'schedule', 'run'], target: { kind: 'panel', view: 'workflows' }, pinnable: true, needs: ['helper'] },

  // ---- Research
  { id: 'search', name: 'Search', category: 'research', description: 'Search the web from Orbis', icon: 'search', keywords: ['search', 'find', 'web', 'images', 'videos', 'news'], target: { kind: 'panel', view: 'search' }, pinnable: true, needs: ['helper'] },
  { id: 'galaxy', name: 'Galaxy', category: 'research', description: 'A map of everything Orbis keeps, and how it connects', icon: 'galaxy', keywords: ['galaxy', 'map', 'graph', 'connections', 'knowledge'], target: { kind: 'panel', view: 'galaxy' }, pinnable: true, needs: ['helper'] },
  { id: 'notes', name: 'Notes', category: 'research', description: 'Notes kept in Orbis', icon: 'notes', keywords: ['note', 'write', 'jot'], target: { kind: 'panel', view: 'notes' }, pinnable: true, needs: ['helper'] },
  { id: 'whiteboard', name: 'Whiteboard', category: 'research', description: 'Boards to gather things on', icon: 'whiteboard', keywords: ['whiteboard', 'board', 'canvas', 'draw'], target: { kind: 'view', view: 'whiteboard' }, pinnable: false, needs: ['helper'] },
  { id: 'sources', name: 'Sources', category: 'research', description: 'The pages behind an answer', icon: 'sources', keywords: ['source', 'citation', 'reference', 'research'], target: { kind: 'view', view: 'sources' }, pinnable: false, needs: ['helper'] },

  { id: 'research', name: 'Research', category: 'research', description: 'What Orion has looked into, and what it found', icon: 'research', keywords: ['research', 'investigate', 'study', 'deep'], target: { kind: 'view', view: 'research' }, pinnable: false, needs: ['helper'] },

  // ---- Capture
  { id: 'screenshots', name: 'Screenshots', category: 'capture', description: 'Pictures taken of pages', icon: 'screenshots', keywords: ['screenshot', 'capture', 'picture', 'image', 'snap'], target: { kind: 'view', view: 'screenshots' }, pinnable: false, needs: ['helper'] },
  { id: 'savedPages', name: 'Saved pages', category: 'capture', description: 'Pages kept on this computer, readable offline', icon: 'savedPages', keywords: ['saved', 'offline', 'archive', 'keep'], target: { kind: 'view', view: 'savedPages' }, pinnable: false, needs: ['helper'] },

  // ---- Media
  { id: 'media', name: 'Media', category: 'media', description: 'What is playing, and where', icon: 'media', keywords: ['media', 'audio', 'video', 'play', 'pause', 'sound', 'music'], target: { kind: 'view', view: 'media' }, pinnable: false, needs: ['browser', 'helper'] },

  // ---- Privacy & Protection
  { id: 'adblock', name: 'Ad blocking', category: 'protection', description: 'What was blocked here, and the rules behind it', icon: 'adblock', keywords: ['ad', 'advert', 'advertising', 'block', 'blocker', 'ads'], target: { kind: 'panel', view: 'block' }, pinnable: true, needs: ['helper'] },
  { id: 'permissions', name: 'Site permissions', category: 'protection', description: 'What this site is allowed to do', icon: 'privacy', keywords: ['permission', 'camera', 'microphone', 'location', 'notification', 'site'], target: { kind: 'page', url: 'chrome://settings/content' }, pinnable: false, needs: ['browser'] },
  { id: 'secrets', name: 'Secrets', category: 'protection', description: 'Keys and passwords, behind a master password', icon: 'secrets', keywords: ['secret', 'password', 'key', 'vault', 'credential'], target: { kind: 'panel', view: 'secrets' }, pinnable: true, needs: ['helper'] },

  // ---- Workspace
  { id: 'workspaces', name: 'Workspaces', category: 'workspace', description: 'Sets of tabs kept together and reopened as one', icon: 'workspaces', keywords: ['workspace', 'space', 'session', 'project'], target: { kind: 'view', view: 'workspaces' }, pinnable: false, needs: ['helper'] },
  { id: 'tasks', name: 'Tasks', category: 'workspace', description: 'Things to do', icon: 'tasks', keywords: ['task', 'todo', 'to-do', 'reminder'], target: { kind: 'panel', view: 'tasks' }, pinnable: true, needs: ['helper'] },
  { id: 'reminders', name: 'Reminders', category: 'workspace', description: 'Tasks with a time on them', icon: 'reminders', keywords: ['reminder', 'due', 'alarm', 'later'], target: { kind: 'view', view: 'reminders' }, pinnable: false, needs: ['helper'] },
  { id: 'clipboard', name: 'Clipboard', category: 'workspace', description: 'What has been copied lately', icon: 'clipboard', keywords: ['clipboard', 'copied', 'paste', 'copy'], target: { kind: 'view', view: 'clipboard' }, pinnable: false, needs: ['helper'] },

  // ---- Customize
  { id: 'customize', name: 'Customize', category: 'customize', description: 'How the new tab page looks, and what it shows', icon: 'customize', keywords: ['customize', 'customise', 'theme', 'appearance', 'wallpaper', 'widget', 'look'], target: { kind: 'page', url: 'chrome://orbis-newtab/' }, pinnable: false, needs: ['browser'] },
  { id: 'account', name: 'Account', category: 'customize', description: 'Who Orbis knows you as', icon: 'account', keywords: ['account', 'profile', 'name', 'identity', 'who'], target: { kind: 'panel', view: 'account' }, pinnable: true, needs: ['helper'] }
]

export const capabilityById = (id: string): OrbisCapability | undefined => CAPABILITIES.find((c) => c.id === id)

export const capabilitiesIn = (category: CommandCategory): OrbisCapability[] => CAPABILITIES.filter((c) => c.category === category)

/** What is true of Orbis right now. Everything unknown is taken as absent: an unproven capability is not offered. */
export interface Readiness {
  browser: boolean
  helper: boolean
  key: boolean
  /** A real web page is in front of the person, rather than a new tab or a built-in page. */
  page: boolean
}

/** Why a capability cannot be used, in the words the interface says. Null when it can. */
export function unavailableBecause(capability: OrbisCapability, ready: Readiness): string | null {
  for (const need of capability.needs) {
    if (need === 'browser' && !ready.browser) return 'The browser is not connected'
    if (need === 'helper' && !ready.helper) return 'Orbis is not running'
    if (need === 'key' && !ready.key) return 'Orion has no key'
    if (need === 'page' && !ready.page) return 'There is no page to act on'
  }
  return null
}

export const isAvailable = (capability: OrbisCapability, ready: Readiness): boolean => unavailableBecause(capability, ready) === null

// ---------------------------------------------------------------- finding things

/**
 * A score for how well a capability answers what was typed, or 0 for not at all.
 *
 * Ordered so the obvious answer comes first: the name somebody typed beats the name that merely contains it, which
 * beats a word it is also known by, which beats the description. Without that, typing "notes" put "Screenshots" above
 * "Notes" because its description mentions them.
 */
/** Letters and digits: what a word is made of, for deciding whether a match starts one. */
const isWordCharacter = (ch: string): boolean => /[a-z0-9]/i.test(ch)

export function scoreCapability(capability: OrbisCapability, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const name = capability.name.toLowerCase()
  const keywords = capability.keywords.map((k) => k.toLowerCase())

  if (name === q) return 100
  if (name.startsWith(q)) return 80
  // An exact word somebody knows it by beats letters that merely happen to appear inside another name: "ads" is
  // Ad blocking, not Down(ads).
  if (keywords.includes(q)) return 70
  // Inside the name, but at the start of a word, so it reads as the thing they typed. Checked by looking at the
  // character before it rather than with a pattern: the query is whatever somebody typed, and building a regular
  // expression out of that is how a stray bracket becomes an error.
  const at = name.indexOf(q)
  const startsAWord = at === 0 || (at > 0 && !isWordCharacter(name[at - 1]))
  if (at >= 0 && startsAWord) return 60
  if (keywords.some((k) => k.startsWith(q))) return 40
  if (capability.category.toLowerCase() === q) return 30
  // Letters buried inside a longer word: worth something, but the least of anything.
  if (name.includes(q)) return 25
  if (capability.description.toLowerCase().includes(q)) return 20

  // Several words, each of which has to land somewhere: "block ads" finds Ad blocking.
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    const haystack = `${name} ${keywords.join(' ')} ${capability.description}`.toLowerCase()
    if (words.every((w) => haystack.includes(w))) return 15
  }
  return 0
}

export interface SearchHit {
  capability: OrbisCapability
  score: number
  /** Null when it can be used now; otherwise why not. Unavailable things are still found, and still say why. */
  unavailable: string | null
}

/**
 * What matches, best first.
 *
 * Something that cannot be used is still returned, with the reason: somebody looking for ad blocking while the browser
 * is closed should be told the browser is closed, not that Orbis has no ad blocking.
 */
export function searchCapabilities(query: string, ready: Readiness, limit = 8): SearchHit[] {
  return CAPABILITIES.map((capability) => ({ capability, score: scoreCapability(capability, query), unavailable: unavailableBecause(capability, ready) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.capability.name.localeCompare(b.capability.name))
    .slice(0, limit)
}

/** The address a capability opens at, for the panel's own routing. */
export function addressFor(capability: OrbisCapability): string {
  if (capability.target.kind === 'panel' || capability.target.kind === 'view') return `chrome://orbis/#${capability.target.view}`
  return capability.target.url
}

// ---------------------------------------------------------------- pins

/** The most that fit beside the address bar before the toolbar stops being a toolbar. */
export const MAX_PINS = 6

/** Only capabilities with a real toolbar action behind them can be pinned. */
export const canPin = (capability: OrbisCapability): boolean => capability.pinnable

/** Reads back a saved pin order, dropping anything that is no longer pinnable. */
export function normalizePins(raw: unknown): string[] {
  const out: string[] = []
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id !== 'string' || out.includes(id)) continue
    const capability = capabilityById(id)
    if (!capability || !canPin(capability)) continue
    out.push(id)
    if (out.length >= MAX_PINS) break
  }
  return out
}

/** Returns the new order, or the reason it cannot be pinned. */
export function addPin(pins: string[], id: string): { ok: true; pins: string[] } | { ok: false; error: string } {
  const capability = capabilityById(id)
  if (!capability) return { ok: false, error: 'That is not something Orbis has.' }
  if (!canPin(capability)) return { ok: false, error: `${capability.name} cannot go on the toolbar.` }
  if (pins.includes(id)) return { ok: true, pins }
  if (pins.length >= MAX_PINS) return { ok: false, error: `The toolbar holds ${MAX_PINS}. Remove one first.` }
  return { ok: true, pins: [...pins, id] }
}

export const removePin = (pins: string[], id: string): string[] => pins.filter((p) => p !== id)

/** Moves a pin one place along. Past either end the order is returned unchanged rather than wrapping. */
export function movePin(pins: string[], id: string, delta: number): string[] {
  const from = pins.indexOf(id)
  if (from < 0) return pins
  const to = from + delta
  if (to < 0 || to >= pins.length) return pins
  const out = [...pins]
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved)
  return out
}
