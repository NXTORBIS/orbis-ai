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
  | 'tools'
  | 'arena'
  | 'customize'
  | 'settings'

/**
 * The lanes, which are how the panel is laid out -- not how the registry is filed.
 *
 * `CommandCategory` below is a map of Orbis's subsystems and it is the right shape for the registry: adding a
 * feature means adding a line in the category it belongs to. It is the wrong shape for a 340px column. Measured
 * against what is actually there: `automation` holds one capability, `customize` holds one, `settings` is three
 * headings' worth of chrome:// deep links nobody opens twice, and `tools` is described in this very file as the
 * bin for things that fit nowhere. Eleven headings, all open at once, made the panel one endless scroll -- it ran
 * to roughly 1,800px and was still cut off at "Privacy & Protection".
 *
 * A lane is the errand, not the subsystem. "Where did that go" is one errand whether the answer is a tab, a
 * download or a screenshot, and those live in three different categories. Five lanes, each one closable, none
 * smaller than four: the categories stay exactly as they are and become the sub-headings inside an open lane, so
 * there is one taxonomy in the registry and one *view* of it in the panel rather than two competing copies.
 */
export type Lane = 'page' | 'find' | 'keep' | 'browse' | 'set' | 'elsewhere'

export const LANES: { id: Lane; label: string; hint: string; icon: string }[] = [
  { id: 'page', label: 'On this page', hint: 'What Orbis can do with what you are looking at', icon: 'globe' },
  { id: 'find', label: 'Find it again', hint: 'Tabs, history, downloads and everything Orbis kept', icon: 'search' },
  { id: 'keep', label: 'Yours', hint: 'The things you made, saved or asked Orbis to run', icon: 'notes' },
  { id: 'browse', label: 'The browser', hint: 'Moving around, extensions and how it looks', icon: 'controls' },
  { id: 'set', label: 'Settings', hint: 'This profile, and how Orbis behaves', icon: 'settings' },
  // Not a lane that opens: these four live in the Orbis window, and a tile that opens another application is a
  // different promise from a tile that opens a panel. Said in one sentence instead.
  { id: 'elsewhere', label: 'In the Orbis window', hint: 'These open the main application', icon: 'external' }
]

export const CATEGORIES: { id: CommandCategory; label: string; icon: string; blurb: string }[] = [
  { id: 'browser', label: 'Browser', icon: 'tabs', blurb: 'Tabs, navigation, and everything Orbis keeps for you' },
  { id: 'ai', label: 'AI', icon: 'orion', blurb: 'Orion: asking, reading this page, and acting on it' },
  { id: 'automation', label: 'Automation', icon: 'workflows', blurb: 'Work Orbis does for you, and what it did' },
  { id: 'research', label: 'Research', icon: 'research', blurb: 'Searching, sources, notes and how they connect' },
  { id: 'capture', label: 'Capture', icon: 'screenshots', blurb: 'Pictures of pages, and pages kept to read later' },
  { id: 'media', label: 'Media', icon: 'media', blurb: 'What is playing, and where' },
  { id: 'protection', label: 'Privacy & Protection', icon: 'privacy', blurb: 'What a page is allowed to do' },
  { id: 'workspace', label: 'Workspace', icon: 'workspaces', blurb: 'Sets of tabs, and the things you are keeping' },
  // Pages and Markets fit none of the others: they are not research, not capture, not a workspace. They are things
  // that work something out. A category of two is worth having when the alternative is filing them somewhere they
  // do not belong, which is how a list stops meaning anything.
  { id: 'tools', label: 'Tools', icon: 'pages', blurb: 'Things that work something out' },
  // Arena: sport and competition intelligence. F1 is its first member, and it sits apart from Tools because what it
  // holds is a subject to follow, not a thing that works something out.
  { id: 'arena', label: 'Arena', icon: 'chart', blurb: 'Sport and competition intelligence' },
  { id: 'customize', label: 'Customize', icon: 'customize', blurb: 'How Orbis looks and what sits on the toolbar' },
  { id: 'settings', label: 'Settings', icon: 'settings', blurb: 'Every setting, found by name instead of hunted for' }
]

/** What a capability needs before it can do anything. Checked before it is offered, not after it fails. */
export type Requirement =
  /** The Orbis browser must be running and reachable (the Browser Control Layer). */
  | 'browser'
  /**
   * Orion must be able to run a task in the browser: the task host alive, not merely the browser reachable.
   *
   * Separate from `browser` because they are separate questions, and were one answer. Tabs, Tab groups,
   * Navigation and Zoom need to reach the browser; they do not need the task host, and being told about it made
   * five rows report that the browser was not connected while the views behind them listed the open tabs.
   */
  | 'task'
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
  /**
   * Something the browser does, rather than somewhere it goes.
   *
   * `message` is the name of a handler the Orbis page already registers (chrome/browser/ui/webui/orbis/orbis_ui.cc).
   * Naming the handler rather than describing the work is what keeps this honest: a capability cannot ask for
   * something the browser has not been built to do, and a capability whose handler is missing does nothing and says
   * so, rather than reporting a success nobody performed.
   */
  | { kind: 'do'; message: string }
  /**
   * Something Orbis does, rather than the browser.
   *
   * `channel` is a helper channel the Orbis side already answers. Needed because some things the Command Centre offers are
   * not the browser's to do: only Orbis knows which tabs are protected and only Orbis holds the passwords, so "lock
   * everything protected" has to be asked of Orbis rather than of the window it is drawn in.
   *
   * Same honesty as `do`: naming a channel rather than describing the work means a capability cannot ask for something
   * that was never built, and one whose channel is missing says so instead of reporting a success nobody performed.
   */
  | { kind: 'ask'; channel: string }
  /**
   * A screen the Orbis window has and the browser does not.
   *
   * Pages and Markets are the two of these. They used to be written down as `{ kind: 'panel', view: 'home' }`, which
   * resolved -- 'home' is a real view -- and so passed every check there was, while doing the one thing a row must
   * never do: clicking "Pages" in the Command Center opened the Command Center. Saying "this one lives in the Orbis
   * window" is the truth, and the truth is something the interface can tell somebody. There is no helper channel that
   * opens the Orbis window at a chosen screen, so until there is, the row's job is to say where to look.
   */
  | { kind: 'app' }

/**
 * The views the Orbis panel actually has, which is the list the panel itself navigates by.
 *
 * `orbis-ui/panel/panel.js` reads this rather than keeping a second copy, and the first copy is why this list exists.
 * The panel had its own array of eleven names; the registry had capabilities pointing at fifteen more; and because
 * nothing compared the two, a row for a view the panel had never heard of looked exactly like a row for one it had.
 * Clicking "Tabs" put `#tabs` in the address bar, the panel did not recognise it, and it fell back to the Command
 * Center -- so the Command Center appeared to open the Command Center. Eighteen rows behaved that way.
 *
 * Adding a name here is a claim that `orbis-ui/panel/index.html` has a `<section id="view-NAME">` to go with it.
 * commandCenterDestinations.test.ts reads that file and checks, so the claim cannot be made by mistake.
 *
 * 'home' is the Command Center itself. It is a real view, which is why it is here, but no capability may point at it:
 * a row whose destination is the screen you clicked it on has not taken you anywhere.
 */
export const PANEL_VIEWS = ['home', 'ask', 'search', 'block', 'recall', 'schedules', 'notes', 'tasks', 'workflows', 'galaxy', 'secrets', 'account', 'music', 'student'] as const

/**
 * The panel's rail views: Tabs, Tab groups, Media, Controls, and the ones that read a store.
 *
 * A different set from the one above, and that difference is the whole trap. These are not written into index.html --
 * `orbis-ui/panel/rail/browser.js` and `rail/stores.js` build them and hand them to `registerView` as the page loads,
 * so they exist only once that code has run. They were fully built, 900 lines of them, and completely unreachable:
 * nothing called the one function that reveals them, and the panel's own routing hid them again on every move.
 *
 * Same rule as above: a name here is a claim that one of those files registers it, and the test reads the files.
 */
export const RAIL_VIEWS = ['tabs', 'tabGroups', 'media', 'controls', 'savedPages', 'screenshots', 'reminders', 'clipboard', 'whiteboard', 'research', 'sources', 'workspaces', 'downloads'] as const

export interface OrbisCapability {
  /** Which lane of the panel it is shown in. The category says what it is; the lane says where to look for it. */
  lane: Lane
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
  /**
   * The Orbis window's own screen for this, when it has one.
   *
   * Separate from `target`, which says where the *browser* goes. A capability can be both -- Notes is a screen in the
   * Orbis window and, for now, a view in the browser panel -- and saying so in one entry is what stops the two halves
   * keeping separate lists of the same features, which is exactly what they did.
   *
   * The value is a `FeatureId`: the app's launcher opens it directly. A capability with no `app` is something only
   * the browser can do, and the app's launcher does not offer it.
   */
  app?: AppFeature
  /** True when a real Chromium toolbar action exists for it, so it can be pinned beside the address bar. */
  pinnable: boolean
  needs: Requirement[]
}

/**
 * The screens the Orbis window can open. Exactly those, and nothing aspirational.
 *
 * Declared here rather than in the renderer because this is the list both halves read. `Sidebar.tsx` held a second
 * copy with its own labels and its own order, and the two had drifted nine features apart -- which is not a tidiness
 * problem, it is two kinds of lie:
 *
 *   - Six capabilities said `app` and the window could not open any of them. Four -- Galaxy, Secrets, Tasks and
 *     Workflows -- had moved to the browser and their window screens were deleted; the field saying the window
 *     still had them was simply left behind. Two more, Customize and Profiles, are reached through Settings and
 *     were never screens of their own. That is the "finished feature nothing can open" bug: a route that renders
 *     as live and goes nowhere, which this product has already shipped once in the browser's panel.
 *   - Three screens the window really does have -- Create, Laboratories and Schedules -- were in no capability at
 *     all, so nothing that reads the registry could offer them. The Command Centre could not list them and the
 *     window's own search could not find them.
 *
 * `appFeatureGuard.test.ts` now holds this to a one-to-one match in both directions.
 */
export type AppFeature =
  | 'create'
  | 'chess'
  | 'neurova'
  | 'pages'
  | 'labs'
  | 'markets'
  | 'whiteboard'
  | 'clipboard'
  | 'workspaces'
  | 'schedules'
  | 'notes'
  | 'student'
  | 'courses'
  | 'toolkit'
  | 'eye'
  | 'cosmos'
  | 'f1'
  | 'arena'
  | 'football'

/**
 * The capabilities Orbis has.
 *
 * `pinnable` is true only where a toolbar action genuinely exists (chrome/browser/ui/browser_actions.cc). Marking
 * anything else pinnable would put a button in the Command Center that could not become a button on the toolbar.
 */
export const CAPABILITIES: OrbisCapability[] = [
  // ---- Browser
  { id: 'tabs', name: 'Tabs', lane: 'find', category: 'browser', description: 'Every open tab, to search, switch or close', icon: 'tabs', keywords: ['tab', 'switch', 'open', 'close'], target: { kind: 'view', view: 'tabs' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'tabGroups', name: 'Tab groups', lane: 'find', category: 'browser', description: 'The groups your tabs are gathered into', icon: 'tabGroups', keywords: ['group', 'collection'], target: { kind: 'view', view: 'tabGroups' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'navigation', name: 'Navigation', lane: 'browse', category: 'browser', description: 'Back, forward, reload and stop', icon: 'back', keywords: ['back', 'forward', 'reload', 'refresh', 'stop'], target: { kind: 'view', view: 'controls' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'zoom', name: 'Zoom', lane: 'page', category: 'browser', description: 'How large this page is drawn', icon: 'zoomIn', keywords: ['zoom', 'bigger', 'smaller', 'text size'], target: { kind: 'view', view: 'controls' }, pinnable: false, needs: ['browser', 'helper', 'page'] },
  { id: 'copyLink', name: 'Copy link', lane: 'page', category: 'browser', description: "This page's address, on the clipboard", icon: 'copy', keywords: ['copy', 'link', 'url', 'address', 'share', 'clipboard'], target: { kind: 'do', message: 'orbis.page.copyLink' }, pinnable: false, needs: ['browser', 'page'] },
  { id: 'bookmarks', name: 'Bookmarks', lane: 'find', category: 'browser', description: 'Pages kept for later', icon: 'bookmarks', keywords: ['bookmark', 'favourite', 'favorite', 'saved'], target: { kind: 'page', url: 'chrome://bookmarks/' }, pinnable: false, needs: ['browser'] },
  { id: 'history', name: 'History', lane: 'find', category: 'browser', description: 'Where this profile has been', icon: 'history', keywords: ['history', 'visited', 'recent'], target: { kind: 'page', url: 'chrome://history/' }, pinnable: false, needs: ['browser'] },
  { id: 'downloads', name: 'Downloads', lane: 'find', category: 'browser', description: 'Find a downloaded file by what is inside it', icon: 'downloads', keywords: ['download', 'file', 'saved', 'search inside'], target: { kind: 'view', view: 'downloads' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'extensions', name: 'Extensions', lane: 'browse', category: 'browser', description: 'What is installed, and whether it is on', icon: 'extensions', keywords: ['extension', 'addon', 'add-on', 'plugin'], target: { kind: 'page', url: 'chrome://extensions/' }, pinnable: false, needs: ['browser'] },

  // The description used to read "Everything Orbis can be asked to do, and what it has done". The view behind it
  // (rail/browser.js) has three groups -- Navigation, Zoom, and a box to open an address -- and keeps no record of
  // anything. Half of that sentence was a feature nobody had written, promised on the row that led to it.
  { id: 'controls', name: 'Browser controls', lane: 'browse', category: 'browser', description: 'Back, forward, zoom, and opening an address', icon: 'controls', keywords: ['control', 'command', 'capability', 'action'], target: { kind: 'view', view: 'controls' }, pinnable: false, needs: ['browser', 'helper'] },

  // ---- AI
  //
  // All three open the panel's #ask view, which is one screen that does all three things: a question about the page in
  // front of you, the short version of it, or something done on it. They are three uses of one request rather than
  // three systems, because the helper already has the one place that decides which of those a sentence is (`orb:ask`),
  // and the screen names all three on arrival so whichever row was clicked, that thing is one step away.
  //
  // Until that view was written these three were the only rows in the registry whose destination did not exist. They
  // were drawn as live, clicked, and quietly redrew the Command Center -- and because 'ask' carries a real toolbar
  // action, the Ask Orion button beside the address bar did exactly the same thing.
  { id: 'ask', name: 'Ask Orion', lane: 'page', category: 'ai', description: 'Ask about this page, or about anything', icon: 'orion', keywords: ['orion', 'ai', 'chat', 'ask', 'assistant', 'question'], target: { kind: 'panel', view: 'ask' }, pinnable: true, needs: ['helper', 'key'] },
  { id: 'orbSummarise', name: 'Summarise this page', lane: 'page', category: 'ai', description: 'What this page says, in short', icon: 'lines', keywords: ['summary', 'summarise', 'summarize', 'tldr', 'explain'], target: { kind: 'panel', view: 'ask' }, pinnable: false, needs: ['helper', 'key', 'task', 'page'] },
  // "watch it work in the browser" was a promise nothing kept while the screen did not exist. It does now, and the
  // wording says what is actually shown: the steps the Browser Control Layer confirmed, as it confirms them.
  { id: 'browserTask', name: 'Do something on this page', lane: 'page', category: 'ai', description: 'Give Orbis a task and watch every step it takes', icon: 'spark', keywords: ['task', 'agent', 'automate', 'click', 'do', 'act'], target: { kind: 'panel', view: 'ask' }, pinnable: false, needs: ['helper', 'key', 'task'] },

  // ---- Automation
  { id: 'workflows', name: 'Workflows', lane: 'keep', category: 'automation', description: 'Sequences Orbis runs for you, and what they did', icon: 'workflows', keywords: ['workflow', 'automation', 'automate', 'routine', 'schedule', 'run'], target: { kind: 'panel', view: 'workflows' }, pinnable: true, needs: ['helper'] },

  // ---- Research
  { id: 'search', name: 'Search', lane: 'find', category: 'research', description: 'Search the web from Orbis', icon: 'search', keywords: ['search', 'find', 'web', 'images', 'videos', 'news'], target: { kind: 'panel', view: 'search' }, pinnable: true, needs: ['helper'] },
  { id: 'galaxy', name: 'Galaxy', lane: 'find', category: 'research', description: 'A map of everything Orbis keeps, and how it connects', icon: 'galaxy', keywords: ['galaxy', 'map', 'graph', 'connections', 'knowledge'], target: { kind: 'panel', view: 'galaxy' }, pinnable: true, needs: ['helper'] },
  { id: 'notes', name: 'Notes', lane: 'keep', category: 'research', description: 'Notes kept in Orbis', icon: 'notes', keywords: ['note', 'write', 'jot'], target: { kind: 'panel', view: 'notes' }, app: 'notes', pinnable: true, needs: ['helper'] },
  { id: 'whiteboard', name: 'Whiteboard', lane: 'keep', category: 'research', description: 'Boards to gather things on', icon: 'whiteboard', keywords: ['whiteboard', 'board', 'canvas', 'draw'], target: { kind: 'view', view: 'whiteboard' }, app: 'whiteboard', pinnable: false, needs: ['helper'] },
  { id: 'sources', name: 'Sources', lane: 'find', category: 'research', description: 'The pages behind an answer', icon: 'sources', keywords: ['source', 'citation', 'reference', 'research'], target: { kind: 'view', view: 'sources' }, pinnable: false, needs: ['helper'] },

  { id: 'research', name: 'Research', lane: 'find', category: 'research', description: 'What Orion has looked into, and what it found', icon: 'research', keywords: ['research', 'investigate', 'study', 'deep'], target: { kind: 'view', view: 'research' }, pinnable: false, needs: ['helper'] },

  // ---- Capture
  { id: 'screenshots', name: 'Screenshots', lane: 'page', category: 'capture', description: 'Pictures taken of pages', icon: 'screenshots', keywords: ['screenshot', 'capture', 'picture', 'image', 'snap'], target: { kind: 'view', view: 'screenshots' }, pinnable: false, needs: ['helper'] },
  // The pages this person has read, searchable by what was in them. A `panel` target, not a `view` one: this is a
  // section of index.html, not one of the rail's. It said `view` and worked anyway, because the panel happened to
  // know the name -- which is exactly the sort of near-miss that makes a wrong kind survive for months.
  // Create and Laboratories are screens the Orbis window has had all along and the registry had never heard of, so
  // nothing that reads the registry -- the browser's Command Centre, the window's own palette -- could offer
  // either of them. They open in the window, which is what `app` says and what `kind: 'app'` means.
  { id: 'chess', name: 'Chess World', lane: 'keep', category: 'workspace', description: 'Play the engine, study your games, train, and follow live tournaments', icon: 'grip', keywords: ['chess', 'chessboard', 'stockfish', 'pgn', 'opening', 'endgame', 'puzzle', 'tactics', 'game', 'board', 'play'], target: { kind: 'app' }, app: 'chess', pinnable: false, needs: [] },
  { id: 'neurova', name: 'NEUROVA', lane: 'keep', category: 'workspace', description: 'Song projects: keep versions of your audio, check it, and export it', icon: 'quote', keywords: ['neurova', 'song', 'music', 'project', 'version', 'audio', 'wav', 'export', 'compose'], target: { kind: 'app' }, app: 'neurova', pinnable: false, needs: [] },
  { id: 'create', name: 'Create', lane: 'keep', category: 'workspace', description: 'Tables and documents, kept and saved as real files', icon: 'edit', keywords: ['create', 'make', 'new', 'document', 'table', 'sheet', 'spreadsheet', 'write', 'file'], target: { kind: 'app' }, app: 'create', pinnable: false, needs: [] },
  { id: 'labs', name: 'Laboratories', lane: 'keep', category: 'tools', description: 'Every laboratory Orbis has, by subject', icon: 'calculator', keywords: ['lab', 'laboratory', 'physics', 'chemistry', 'experiment', 'simulate', 'science', 'computing'], target: { kind: 'app' }, app: 'labs', pinnable: false, needs: [] },
  { id: 'recall', name: 'Pages you have read', lane: 'find', category: 'capture', description: 'Find a page again by what was in it', icon: 'book', keywords: ['read', 'history', 'again', 'remember', 'find', 'article', 'recall'], target: { kind: 'panel', view: 'recall' }, pinnable: false, needs: ['helper'] },
  /*
   * Schedules. A `panel` target rather than a `view` one, because the panel's own section is where it lives -- the
   * rail views are a different set, and pointing at one of those would land on the Command Center instead.
   */
  { id: 'schedules', name: 'Schedules', lane: 'keep', category: 'capture', description: 'Things Orbis does at a time you chose', icon: 'clock', keywords: ['schedule', 'remind', 'reminder', 'later', 'every', 'daily', 'timer', 'when', 'repeat', 'automation'], target: { kind: 'panel', view: 'schedules' }, app: 'schedules', pinnable: false, needs: ['helper'] },
  /*
   * Focus, in the browser.
   *
   * Not the whole of Orbis Student -- that lives in the Orbis window, and two homes for one feature is the exact
   * confusion worth avoiding. This is the part that belongs where the reading happens: what is running, how long is
   * left, keeping a page or a card, and the way out of a session.
   */
  { id: 'focus', name: 'Focus', lane: 'keep', category: 'tools', description: 'Your study session, and keeping what you find while you read', icon: 'hourglass', keywords: ['focus', 'study', 'session', 'timer', 'pomodoro', 'student', 'revision', 'flashcard', 'card', 'mistake', 'exam', 'deep work', 'concentrate'], target: { kind: 'panel', view: 'student' },
    // Not pinnable: a pin needs a toolbar action registered in the fork, and there is no Focus button there yet.
    pinnable: false,
    needs: ['helper'] },
  { id: 'music', name: 'Music', lane: 'keep', category: 'media', description: 'What is playing, your own music, and songs you hear while browsing', icon: 'volume', keywords: ['music', 'song', 'track', 'playlist', 'album', 'artist', 'play', 'pause', 'listen', 'library', 'audio', 'now playing', 'shazam', 'identify', 'recognise', 'recognize'], target: { kind: 'panel', view: 'music' }, pinnable: true, needs: ['helper'] },
  { id: 'savedPages', name: 'Saved pages', lane: 'page', category: 'capture', description: 'Pages kept on this computer, readable offline', icon: 'savedPages', keywords: ['saved', 'offline', 'archive', 'keep'], target: { kind: 'view', view: 'savedPages' }, pinnable: false, needs: ['helper'] },

  // ---- Media
  { id: 'media', name: 'Media', lane: 'find', category: 'media', description: 'What is playing, and where', icon: 'media', keywords: ['media', 'audio', 'video', 'play', 'pause', 'sound', 'music'], target: { kind: 'view', view: 'media' }, pinnable: false, needs: ['browser', 'helper'] },

  // ---- Privacy & Protection
  // Not pinnable: pinning offers a toolbar button, and the toolbar actions the browser registers are the list in
  // chrome/browser/ui/browser_actions.cc. Marking these pinnable would offer a pin that could never become a button.
  // "password" is deliberately not a keyword on any of them -- somebody typing it means the Secrets vault, and taking that
  // word would make the vault harder to find in order to make a lock command easier to.
  { id: 'lockTab', name: 'Lock this tab', lane: 'page', category: 'protection', description: 'Hides this tab behind its tab password, at once', icon: 'privacy', keywords: ['lock', 'private', 'hide', 'protect', 'tab lock'], target: { kind: 'ask', channel: 'security:lockTab' }, pinnable: false, needs: ['browser', 'helper'] },
  { id: 'lockAllTabs', name: 'Lock every protected tab', lane: 'browse', category: 'protection', description: 'Locks everything you have protected and closes every tab password', icon: 'layers', keywords: ['lock', 'all', 'panic', 'private', 'hide', 'everything'], target: { kind: 'ask', channel: 'security:lockAll' }, pinnable: false, needs: ['helper'] },
  { id: 'lockOrbis', name: 'Lock Orbis', lane: 'browse', category: 'protection', description: 'Puts Orbis away and asks for your account password. Nothing is closed', icon: 'lock', keywords: ['lock', 'orbis', 'profile', 'away', 'sign out'], target: { kind: 'ask', channel: 'security:lockProfile' }, pinnable: false, needs: ['helper'] },
  { id: 'adblock', name: 'Ad blocking', lane: 'page', category: 'protection', description: 'What was blocked here, and the rules behind it', icon: 'adblock', keywords: ['ad', 'advert', 'advertising', 'block', 'blocker', 'ads'], target: { kind: 'panel', view: 'block' }, pinnable: true, needs: ['helper'] },
  { id: 'permissions', name: 'Site permissions', lane: 'page', category: 'protection', description: 'What this site is allowed to do', icon: 'eye', keywords: ['permission', 'camera', 'microphone', 'location', 'notification', 'site'], target: { kind: 'page', url: 'chrome://settings/content' }, pinnable: false, needs: ['browser'] },
  { id: 'secrets', name: 'Secrets', lane: 'keep', category: 'protection', description: 'Keys and passwords, behind a master password', icon: 'secrets', keywords: ['secret', 'password', 'key', 'vault', 'credential'], target: { kind: 'panel', view: 'secrets' }, pinnable: true, needs: ['helper'] },

  // ---- Workspace
  { id: 'workspaces', name: 'Workspaces', lane: 'keep', category: 'workspace', description: 'Sets of tabs kept together and reopened as one', icon: 'workspaces', keywords: ['workspace', 'space', 'session', 'project'], target: { kind: 'view', view: 'workspaces' }, app: 'workspaces', pinnable: false, needs: ['helper'] },
  { id: 'tasks', name: 'Tasks', lane: 'keep', category: 'workspace', description: 'Things to do', icon: 'tasks', keywords: ['task', 'todo', 'to-do', 'reminder'], target: { kind: 'panel', view: 'tasks' }, pinnable: true, needs: ['helper'] },
  { id: 'reminders', name: 'Reminders', lane: 'keep', category: 'workspace', description: 'Tasks with a time on them', icon: 'reminders', keywords: ['reminder', 'due', 'alarm', 'later'], target: { kind: 'view', view: 'reminders' }, pinnable: false, needs: ['helper'] },
  { id: 'clipboard', name: 'Clipboard', lane: 'keep', category: 'workspace', description: 'What has been copied lately', icon: 'clipboard', keywords: ['clipboard', 'copied', 'paste', 'copy'], target: { kind: 'view', view: 'clipboard' }, app: 'clipboard', pinnable: false, needs: ['helper'] },

  // ---- Customize
  { id: 'customize', name: 'Customize', lane: 'browse', category: 'customize', description: 'How the new tab page looks, and what it shows', icon: 'customize', keywords: ['customize', 'customise', 'theme', 'appearance', 'wallpaper', 'widget', 'look'], target: { kind: 'page', url: 'chrome://orbis-newtab/' }, pinnable: false, needs: ['browser'] },
  // Tools. Both of these are Orbis window screens with no browser counterpart, which is why they are `app` targets:
  // the browser has nowhere to put them. They were both written down as the panel's 'home' view, so choosing Pages in
  // the Command Center redrew the Command Center.
  { id: 'pages', name: 'Pages', lane: 'elsewhere', category: 'tools', description: 'Orbis\u2019s own tools, each with its own address', icon: 'pages', keywords: ['page', 'tool', 'calculator', 'converter', 'lab', 'build'], target: { kind: 'app' }, app: 'pages', pinnable: false, needs: ['helper'] },
  { id: 'markets', name: 'Markets', lane: 'elsewhere', category: 'tools', description: 'Live prices, charts and watchlists', icon: 'markets', keywords: ['market', 'price', 'chart', 'crypto', 'ticker', 'watchlist', 'trading'], target: { kind: 'app' }, app: 'markets', pinnable: false, needs: ['helper'] },
  { id: 'student', name: 'Student', lane: 'elsewhere', category: 'tools', description: 'Focus sessions, goals, daily learning and Orbi', icon: 'student', keywords: ['student', 'study', 'focus', 'school', 'exam', 'revision', 'homework', 'learn', 'goal', 'pomodoro', 'timer', 'orbi', 'xp'], target: { kind: 'app' }, app: 'student', pinnable: false, needs: [] },
  { id: 'arena', name: 'Arena', lane: 'elsewhere', category: 'arena', description: 'The Arena’s front door: live football, Formula 1 and what is coming', icon: 'news', keywords: ['arena', 'sport', 'sports', 'live', 'scores', 'football', 'f1', 'formula 1', 'racing', 'stadium', 'orbis arena'], target: { kind: 'app' }, app: 'arena', pinnable: false, needs: [] },
  { id: 'football', name: 'Football', lane: 'elsewhere', category: 'arena', description: 'Football: live scores, fixtures, tables, goals and form from open data', icon: 'game', keywords: ['football', 'soccer', 'live scores', 'fixtures', 'results', 'table', 'standings', 'bundesliga', 'premier league', 'la liga', 'serie a', 'goals', 'match', 'league', 'arena'], target: { kind: 'app' }, app: 'football', pinnable: false, needs: [] },
  { id: 'f1', name: 'F1', lane: 'elsewhere', category: 'arena', description: 'Formula 1: the calendar, results, standings, and lap and sector timing', icon: 'timer', keywords: ['f1', 'formula 1', 'formula one', 'grand prix', 'race', 'racing', 'standings', 'championship', 'lap times', 'sectors', 'drivers', 'constructors', 'arena', 'motorsport'], target: { kind: 'app' }, app: 'f1', pinnable: false, needs: [] },
  { id: 'cosmos', name: 'ORBIS COSMOS', lane: 'elsewhere', category: 'tools', description: 'A real-time 3D universe: the Solar System, nearby stars and the Milky Way, simulated to scale', icon: 'star', keywords: ['cosmos', 'space', 'universe', 'solar system', 'planets', 'stars', 'galaxy', 'astronomy', 'gaia', 'sky', 'orbit'], target: { kind: 'app' }, app: 'cosmos', pinnable: false, needs: [] },
  { id: 'eye', name: 'OrbisEye', lane: 'elsewhere', category: 'tools', description: 'A live 3D Earth: aircraft, ships, satellites, earthquakes and cameras, with voice control', icon: 'sun', keywords: ['eye', 'orbiseye', 'earth', 'globe', 'map', 'flights', 'aircraft', 'planes', 'ships', 'satellites', 'earthquakes', 'cctv', 'cameras', 'radio', 'live', 'osint', 'world'], target: { kind: 'app' }, app: 'eye', pinnable: false, needs: [] },
  { id: 'toolkit', name: 'Toolkit', lane: 'elsewhere', category: 'tools', description: 'Over two thousand calculators, converters and lab tools that work on this computer', icon: 'grid', keywords: ['toolkit', 'tool', 'tools', 'calculator', 'converter', 'calculate', 'convert', 'formula', 'engineering', 'physics', 'chemistry', 'science', 'lab'], target: { kind: 'app' }, app: 'toolkit', pinnable: false, needs: [] },
  { id: 'courses', name: 'Courses', lane: 'elsewhere', category: 'tools', description: 'Structured learning, with what you know actually measured', icon: 'board', keywords: ['course', 'courses', 'lesson', 'module', 'curriculum', 'learn', 'learning', 'certificate', 'quiz', 'syllabus', 'tutorial', 'training'], target: { kind: 'app' }, app: 'courses', pinnable: false, needs: [] },
  /*
   * There is no Profiles row here, and that is deliberate.
   *
   * It used to point at the panel's Account view, which is about the name somebody typed in: no list of profiles,
   * nothing to switch, and a true sentence about a different thing ("Orbis has no account") where the answer
   * should have been. Profiles are Settings and Settings is in the Orbis window, so there is nothing in the
   * browser for this row to open -- and the rule for this registry is that a row either goes somewhere or is not
   * here. Searching for "profile" finds Account, which is the thing the browser really has.
   */

  { id: 'settings', name: 'Settings', lane: 'set', category: 'settings', description: 'Everything there is to change', icon: 'settings', keywords: ['settings', 'preferences', 'options', 'configure', 'setup'], target: { kind: 'page', url: 'chrome://settings/' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.appearance', name: 'Appearance', lane: 'set', category: 'settings', description: 'Theme, fonts and how pages are shown', icon: 'customize', keywords: ['appearance', 'browser theme', 'dark mode', 'light mode', 'font', 'font size', 'text size', 'page zoom'], target: { kind: 'page', url: 'chrome://settings/appearance' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.privacy', name: 'Privacy and security', lane: 'set', category: 'settings', description: 'Cookies, tracking, safe browsing and clearing what is kept', icon: 'privacy', keywords: ['privacy', 'security', 'cookies', 'tracking', 'clear', 'delete', 'safe browsing', 'https'], target: { kind: 'page', url: 'chrome://settings/privacy' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.passwords', name: 'Saved passwords', lane: 'set', category: 'settings', description: "The browser's own password manager, separate from the Orbis vault", icon: 'secrets', keywords: ['saved passwords', 'password manager', 'browser passwords', 'autofill', 'login', 'sign in'], target: { kind: 'page', url: 'chrome://password-manager/passwords' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.search-engines', name: 'Search engines', lane: 'set', category: 'settings', description: 'What a search in the address bar uses', icon: 'search', keywords: ['search engine', 'default search', 'address bar', 'omnibox', 'shortcut'], target: { kind: 'page', url: 'chrome://settings/searchEngines' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.downloads', name: 'Download settings', lane: 'set', category: 'settings', description: 'Where files are saved, and whether to ask each time', icon: 'downloads', keywords: ['download', 'downloads', 'save location', 'folder', 'ask where'], target: { kind: 'page', url: 'chrome://settings/downloads' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.languages', name: 'Languages', lane: 'set', category: 'settings', description: 'What to read pages in, and what to translate', icon: 'languages', keywords: ['language', 'languages', 'translate', 'spellcheck', 'locale'], target: { kind: 'page', url: 'chrome://settings/languages' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.accessibility', name: 'Accessibility', lane: 'set', category: 'settings', description: 'Captions, focus and navigating without a mouse', icon: 'accessibility', keywords: ['accessibility', 'a11y', 'caption', 'captions', 'screen reader', 'contrast', 'keyboard'], target: { kind: 'page', url: 'chrome://settings/accessibility' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.system', name: 'System', lane: 'set', category: 'settings', description: 'Startup, hardware acceleration and the proxy', icon: 'system', keywords: ['system', 'startup', 'hardware acceleration', 'gpu', 'proxy', 'background'], target: { kind: 'page', url: 'chrome://settings/system' }, pinnable: false, needs: ['browser'] },
  { id: 'settings.reset', name: 'Reset settings', lane: 'set', category: 'settings', description: 'Put every setting back the way it started', icon: 'reset', keywords: ['reset', 'restore', 'defaults', 'factory', 'start over'], target: { kind: 'page', url: 'chrome://settings/reset' }, pinnable: false, needs: ['browser'] },
  // Under Settings, beside Profiles, which opens the same screen. It used to sit under Customize -- "How Orbis looks
  // and what sits on the toolbar" -- where who you are signed in as is not what anybody was looking for.
  { id: 'account', name: 'Account', lane: 'set', category: 'settings', description: 'Who Orbis knows you as', icon: 'account', keywords: ['account', 'profile', 'profiles', 'name', 'identity', 'who', 'person'], target: { kind: 'panel', view: 'account' }, pinnable: true, needs: ['helper'] }
]

export const capabilityById = (id: string): OrbisCapability | undefined => CAPABILITIES.find((c) => c.id === id)

export const capabilitiesIn = (category: CommandCategory): OrbisCapability[] => CAPABILITIES.filter((c) => c.category === category)

/** What is true of Orbis right now. Everything unknown is taken as absent: an unproven capability is not offered. */
export interface Readiness {
  /**
   * The Orbis window is the one asking.
   *
   * Absent on the browser's side, where every capability is reached from a page rather than from a screen the
   * window has. Set there, a capability with an `app` is one of the window's own screens and is always reachable.
   */
  window?: boolean
  /** The browser answered at all: there are tabs to list and a page to navigate. */
  browser: boolean
  /** A task could run in it: the task host is alive. A different question from `browser`, and once the same flag. */
  task: boolean
  helper: boolean
  key: boolean
  /** A real web page is in front of the person, rather than a new tab or a built-in page. */
  page: boolean
}

/**
 * Why a capability has nowhere to go, in the words the interface says. Null when its destination is really there.
 *
 * This is the case `unavailableBecause` was missing. It knew about the browser being closed, Orbis not running, Orion
 * having no key and there being no page -- four things that can be fixed by doing something -- and had no idea of the
 * fifth: the place this row leads to does not exist. So eighteen rows were drawn as live, were clicked, and quietly
 * went nowhere. A reason somebody can act on ("The browser is not connected") would have been the wrong answer here:
 * they would have connected the browser and clicked again.
 *
 * Only `panel`, `view` and `app` destinations can be checked from here, because only those are named in this file. A
 * `page` is a chrome:// address inside a browser this code never sees; a `do` names a handler compiled into that
 * browser; an `ask` names a helper channel. commandCenterDestinations.test.ts checks the `ask` channels against the
 * helper's own source, and the test says plainly which kinds it cannot reach.
 */
export function destinationMissing(capability: OrbisCapability): string | null {
  const target = capability.target
  if (target.kind === 'app') return 'Only in the Orbis window'
  if (target.kind === 'panel') {
    // Not an oversight: 'home' is a real view. It is the Command Center, and the Command Center is where these rows
    // are drawn, so a row pointing at it is a row that goes nowhere while looking like one that goes somewhere.
    if (target.view === 'home') return 'This is the screen you are on'
    return (PANEL_VIEWS as readonly string[]).includes(target.view) ? null : 'Orbis has not built this screen yet'
  }
  if (target.kind === 'view') {
    return (RAIL_VIEWS as readonly string[]).includes(target.view) ? null : 'Orbis has not built this screen yet'
  }
  return null
}

/** Why a capability cannot be used, in the words the interface says. Null when it can. */
export function unavailableBecause(capability: OrbisCapability, ready: Readiness): string | null {
  /*
   * A screen the Orbis window has is available whenever the window is the one asking, and this is asked first.
   *
   * Both of the checks below are written from the BROWSER's point of view, because that is the side the registry
   * was built for, and in the window both of them say the wrong thing. `destinationMissing` answers
   * `{ kind: 'app' }` with "Only in the Orbis window" -- true in a browser panel, nonsense in the Orbis window.
   * And `needs` names the helper and a connected browser, which a window screen does not need at all.
   *
   * Measured in the running application, which is the only place it showed: with the browser closed, the command
   * palette offered "Whiteboard -- Orbis is not running" to somebody who was looking at Orbis, and every one of
   * the eleven screens in the launcher read as unavailable.
   *
   * `app` is what says "the window has this screen". Nothing a person can start, connect or set up changes whether
   * it is there.
   */
  if (capability.app && ready.window === true) return null

  // Asked before the needs. Nothing a person can start, connect or set up will make a destination that was never
  // built appear, so telling them Orbis is not running would send them off to fix the wrong thing.
  const nowhere = destinationMissing(capability)
  if (nowhere) return nowhere
  for (const need of capability.needs) {
    if (need === 'browser' && !ready.browser) return 'The browser is not connected'
    if (need === 'task' && !ready.task) return 'Orbis cannot act in the browser yet'
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
  /*
   * The start of the name, and the more of the name it is, the better.
   *
   * "tab" starts both Tabs and Tab groups, and a flat score left them tied and sorted by their names, so typing the
   * name of a thing offered something else first. The share of the name the query covers breaks the tie the way
   * anybody typing expects: all but one letter of Tabs, a third of Tab groups.
   */
  if (name.startsWith(q)) return 80 + Math.round((10 * q.length) / name.length)
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
/**
 * The address a capability opens at, or '' for one that has none.
 *
 * A capability that does something rather than going somewhere has no address, and is given none. Nor has one that
 * lives in the Orbis window, which the browser cannot reach. Returning a plausible-looking one would mean a caller
 * could navigate to it and get a page that does nothing, which is what `chrome://orbis/#tabs` was.
 */
export function addressFor(capability: OrbisCapability): string {
  if (capability.target.kind === 'panel' || capability.target.kind === 'view') return `chrome://orbis/#${capability.target.view}`
  if (capability.target.kind === 'page') return capability.target.url
  return ''
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
