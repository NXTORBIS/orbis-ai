// src/shared/commandCenter.ts
var LANES = [
  { id: "page", label: "On this page", hint: "What Orbis can do with what you are looking at", icon: "globe" },
  { id: "find", label: "Find it again", hint: "Tabs, history, downloads and everything Orbis kept", icon: "search" },
  { id: "keep", label: "Yours", hint: "The things you made, saved or asked Orbis to run", icon: "notes" },
  { id: "browse", label: "The browser", hint: "Moving around, extensions and how it looks", icon: "controls" },
  { id: "set", label: "Settings", hint: "This profile, and how Orbis behaves", icon: "settings" },
  // Not a lane that opens: these four live in the Orbis window, and a tile that opens another application is a
  // different promise from a tile that opens a panel. Said in one sentence instead.
  { id: "elsewhere", label: "In the Orbis window", hint: "These open the main application", icon: "external" }
];
var CATEGORIES = [
  { id: "browser", label: "Browser", icon: "tabs", blurb: "Tabs, navigation, and everything Orbis keeps for you" },
  { id: "ai", label: "AI", icon: "orion", blurb: "Orion: asking, reading this page, and acting on it" },
  { id: "automation", label: "Automation", icon: "workflows", blurb: "Work Orbis does for you, and what it did" },
  { id: "research", label: "Research", icon: "research", blurb: "Searching, sources, notes and how they connect" },
  { id: "capture", label: "Capture", icon: "screenshots", blurb: "Pictures of pages, and pages kept to read later" },
  { id: "media", label: "Media", icon: "media", blurb: "What is playing, and where" },
  { id: "protection", label: "Privacy & Protection", icon: "privacy", blurb: "What a page is allowed to do" },
  { id: "workspace", label: "Workspace", icon: "workspaces", blurb: "Sets of tabs, and the things you are keeping" },
  // Pages and Markets fit none of the others: they are not research, not capture, not a workspace. They are things
  // that work something out. A category of two is worth having when the alternative is filing them somewhere they
  // do not belong, which is how a list stops meaning anything.
  { id: "tools", label: "Tools", icon: "pages", blurb: "Things that work something out" },
  { id: "customize", label: "Customize", icon: "customize", blurb: "How Orbis looks and what sits on the toolbar" },
  { id: "settings", label: "Settings", icon: "settings", blurb: "Every setting, found by name instead of hunted for" }
];
var PANEL_VIEWS = ["home", "ask", "search", "block", "recall", "schedules", "notes", "tasks", "workflows", "galaxy", "secrets", "account", "music", "student"];
var RAIL_VIEWS = ["tabs", "tabGroups", "media", "controls", "savedPages", "screenshots", "reminders", "clipboard", "whiteboard", "research", "sources", "workspaces"];
var CAPABILITIES = [
  // ---- Browser
  { id: "tabs", name: "Tabs", lane: "find", category: "browser", description: "Every open tab, to search, switch or close", icon: "tabs", keywords: ["tab", "switch", "open", "close"], target: { kind: "view", view: "tabs" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "tabGroups", name: "Tab groups", lane: "find", category: "browser", description: "The groups your tabs are gathered into", icon: "tabGroups", keywords: ["group", "collection"], target: { kind: "view", view: "tabGroups" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "navigation", name: "Navigation", lane: "browse", category: "browser", description: "Back, forward, reload and stop", icon: "back", keywords: ["back", "forward", "reload", "refresh", "stop"], target: { kind: "view", view: "controls" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "zoom", name: "Zoom", lane: "page", category: "browser", description: "How large this page is drawn", icon: "zoomIn", keywords: ["zoom", "bigger", "smaller", "text size"], target: { kind: "view", view: "controls" }, pinnable: false, needs: ["browser", "helper", "page"] },
  { id: "copyLink", name: "Copy link", lane: "page", category: "browser", description: "This page's address, on the clipboard", icon: "copy", keywords: ["copy", "link", "url", "address", "share", "clipboard"], target: { kind: "do", message: "orbis.page.copyLink" }, pinnable: false, needs: ["browser", "page"] },
  { id: "bookmarks", name: "Bookmarks", lane: "find", category: "browser", description: "Pages kept for later", icon: "bookmarks", keywords: ["bookmark", "favourite", "favorite", "saved"], target: { kind: "page", url: "chrome://bookmarks/" }, pinnable: false, needs: ["browser"] },
  { id: "history", name: "History", lane: "find", category: "browser", description: "Where this profile has been", icon: "history", keywords: ["history", "visited", "recent"], target: { kind: "page", url: "chrome://history/" }, pinnable: false, needs: ["browser"] },
  { id: "downloads", name: "Downloads", lane: "find", category: "browser", description: "Files Orbis has fetched", icon: "downloads", keywords: ["download", "file", "saved"], target: { kind: "page", url: "chrome://downloads/" }, pinnable: false, needs: ["browser"] },
  { id: "extensions", name: "Extensions", lane: "browse", category: "browser", description: "What is installed, and whether it is on", icon: "extensions", keywords: ["extension", "addon", "add-on", "plugin"], target: { kind: "page", url: "chrome://extensions/" }, pinnable: false, needs: ["browser"] },
  // The description used to read "Everything Orbis can be asked to do, and what it has done". The view behind it
  // (rail/browser.js) has three groups -- Navigation, Zoom, and a box to open an address -- and keeps no record of
  // anything. Half of that sentence was a feature nobody had written, promised on the row that led to it.
  { id: "controls", name: "Browser controls", lane: "browse", category: "browser", description: "Back, forward, zoom, and opening an address", icon: "controls", keywords: ["control", "command", "capability", "action"], target: { kind: "view", view: "controls" }, pinnable: false, needs: ["browser", "helper"] },
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
  { id: "ask", name: "Ask Orion", lane: "page", category: "ai", description: "Ask about this page, or about anything", icon: "orion", keywords: ["orion", "ai", "chat", "ask", "assistant", "question"], target: { kind: "panel", view: "ask" }, pinnable: true, needs: ["helper", "key"] },
  { id: "orbSummarise", name: "Summarise this page", lane: "page", category: "ai", description: "What this page says, in short", icon: "lines", keywords: ["summary", "summarise", "summarize", "tldr", "explain"], target: { kind: "panel", view: "ask" }, pinnable: false, needs: ["helper", "key", "task", "page"] },
  // "watch it work in the browser" was a promise nothing kept while the screen did not exist. It does now, and the
  // wording says what is actually shown: the steps the Browser Control Layer confirmed, as it confirms them.
  { id: "browserTask", name: "Do something on this page", lane: "page", category: "ai", description: "Give Orbis a task and watch every step it takes", icon: "spark", keywords: ["task", "agent", "automate", "click", "do", "act"], target: { kind: "panel", view: "ask" }, pinnable: false, needs: ["helper", "key", "task"] },
  // ---- Automation
  { id: "workflows", name: "Workflows", lane: "keep", category: "automation", description: "Sequences Orbis runs for you, and what they did", icon: "workflows", keywords: ["workflow", "automation", "automate", "routine", "schedule", "run"], target: { kind: "panel", view: "workflows" }, pinnable: true, needs: ["helper"] },
  // ---- Research
  { id: "search", name: "Search", lane: "find", category: "research", description: "Search the web from Orbis", icon: "search", keywords: ["search", "find", "web", "images", "videos", "news"], target: { kind: "panel", view: "search" }, pinnable: true, needs: ["helper"] },
  { id: "galaxy", name: "Galaxy", lane: "find", category: "research", description: "A map of everything Orbis keeps, and how it connects", icon: "galaxy", keywords: ["galaxy", "map", "graph", "connections", "knowledge"], target: { kind: "panel", view: "galaxy" }, pinnable: true, needs: ["helper"] },
  { id: "notes", name: "Notes", lane: "keep", category: "research", description: "Notes kept in Orbis", icon: "notes", keywords: ["note", "write", "jot"], target: { kind: "panel", view: "notes" }, app: "notes", pinnable: true, needs: ["helper"] },
  { id: "whiteboard", name: "Whiteboard", lane: "keep", category: "research", description: "Boards to gather things on", icon: "whiteboard", keywords: ["whiteboard", "board", "canvas", "draw"], target: { kind: "view", view: "whiteboard" }, app: "whiteboard", pinnable: false, needs: ["helper"] },
  { id: "sources", name: "Sources", lane: "find", category: "research", description: "The pages behind an answer", icon: "sources", keywords: ["source", "citation", "reference", "research"], target: { kind: "view", view: "sources" }, pinnable: false, needs: ["helper"] },
  { id: "research", name: "Research", lane: "find", category: "research", description: "What Orion has looked into, and what it found", icon: "research", keywords: ["research", "investigate", "study", "deep"], target: { kind: "view", view: "research" }, pinnable: false, needs: ["helper"] },
  // ---- Capture
  { id: "screenshots", name: "Screenshots", lane: "page", category: "capture", description: "Pictures taken of pages", icon: "screenshots", keywords: ["screenshot", "capture", "picture", "image", "snap"], target: { kind: "view", view: "screenshots" }, pinnable: false, needs: ["helper"] },
  // The pages this person has read, searchable by what was in them. A `panel` target, not a `view` one: this is a
  // section of index.html, not one of the rail's. It said `view` and worked anyway, because the panel happened to
  // know the name -- which is exactly the sort of near-miss that makes a wrong kind survive for months.
  // Create and Laboratories are screens the Orbis window has had all along and the registry had never heard of, so
  // nothing that reads the registry -- the browser's Command Centre, the window's own palette -- could offer
  // either of them. They open in the window, which is what `app` says and what `kind: 'app'` means.
  { id: "create", name: "Create", lane: "keep", category: "workspace", description: "Tables and documents, kept and saved as real files", icon: "edit", keywords: ["create", "make", "new", "document", "table", "sheet", "spreadsheet", "write", "file"], target: { kind: "app" }, app: "create", pinnable: false, needs: [] },
  { id: "labs", name: "Laboratories", lane: "keep", category: "tools", description: "Every laboratory Orbis has, by subject", icon: "calculator", keywords: ["lab", "laboratory", "physics", "chemistry", "experiment", "simulate", "science", "computing"], target: { kind: "app" }, app: "labs", pinnable: false, needs: [] },
  { id: "recall", name: "Pages you have read", lane: "find", category: "capture", description: "Find a page again by what was in it", icon: "book", keywords: ["read", "history", "again", "remember", "find", "article", "recall"], target: { kind: "panel", view: "recall" }, pinnable: false, needs: ["helper"] },
  /*
   * Schedules. A `panel` target rather than a `view` one, because the panel's own section is where it lives -- the
   * rail views are a different set, and pointing at one of those would land on the Command Center instead.
   */
  { id: "schedules", name: "Schedules", lane: "keep", category: "capture", description: "Things Orbis does at a time you chose", icon: "clock", keywords: ["schedule", "remind", "reminder", "later", "every", "daily", "timer", "when", "repeat", "automation"], target: { kind: "panel", view: "schedules" }, app: "schedules", pinnable: false, needs: ["helper"] },
  /*
   * Focus, in the browser.
   *
   * Not the whole of Orbis Student -- that lives in the Orbis window, and two homes for one feature is the exact
   * confusion worth avoiding. This is the part that belongs where the reading happens: what is running, how long is
   * left, keeping a page or a card, and the way out of a session.
   */
  {
    id: "focus",
    name: "Focus",
    lane: "keep",
    category: "tools",
    description: "Your study session, and keeping what you find while you read",
    icon: "hourglass",
    keywords: ["focus", "study", "session", "timer", "pomodoro", "student", "revision", "flashcard", "card", "mistake", "exam", "deep work", "concentrate"],
    target: { kind: "panel", view: "student" },
    // Not pinnable: a pin needs a toolbar action registered in the fork, and there is no Focus button there yet.
    pinnable: false,
    needs: ["helper"]
  },
  { id: "music", name: "Music", lane: "keep", category: "media", description: "What is playing, your own music, and songs you hear while browsing", icon: "volume", keywords: ["music", "song", "track", "playlist", "album", "artist", "play", "pause", "listen", "library", "audio", "now playing", "shazam", "identify", "recognise", "recognize"], target: { kind: "panel", view: "music" }, pinnable: false, needs: ["helper"] },
  { id: "savedPages", name: "Saved pages", lane: "page", category: "capture", description: "Pages kept on this computer, readable offline", icon: "savedPages", keywords: ["saved", "offline", "archive", "keep"], target: { kind: "view", view: "savedPages" }, pinnable: false, needs: ["helper"] },
  // ---- Media
  { id: "media", name: "Media", lane: "find", category: "media", description: "What is playing, and where", icon: "media", keywords: ["media", "audio", "video", "play", "pause", "sound", "music"], target: { kind: "view", view: "media" }, pinnable: false, needs: ["browser", "helper"] },
  // ---- Privacy & Protection
  // Not pinnable: pinning offers a toolbar button, and the toolbar actions the browser registers are the list in
  // chrome/browser/ui/browser_actions.cc. Marking these pinnable would offer a pin that could never become a button.
  // "password" is deliberately not a keyword on any of them -- somebody typing it means the Secrets vault, and taking that
  // word would make the vault harder to find in order to make a lock command easier to.
  { id: "lockTab", name: "Lock this tab", lane: "page", category: "protection", description: "Hides this tab behind its tab password, at once", icon: "privacy", keywords: ["lock", "private", "hide", "protect", "tab lock"], target: { kind: "ask", channel: "security:lockTab" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "lockAllTabs", name: "Lock every protected tab", lane: "browse", category: "protection", description: "Locks everything you have protected and closes every tab password", icon: "layers", keywords: ["lock", "all", "panic", "private", "hide", "everything"], target: { kind: "ask", channel: "security:lockAll" }, pinnable: false, needs: ["helper"] },
  { id: "lockOrbis", name: "Lock Orbis", lane: "browse", category: "protection", description: "Puts Orbis away and asks for your account password. Nothing is closed", icon: "lock", keywords: ["lock", "orbis", "profile", "away", "sign out"], target: { kind: "ask", channel: "security:lockProfile" }, pinnable: false, needs: ["helper"] },
  { id: "adblock", name: "Ad blocking", lane: "page", category: "protection", description: "What was blocked here, and the rules behind it", icon: "adblock", keywords: ["ad", "advert", "advertising", "block", "blocker", "ads"], target: { kind: "panel", view: "block" }, pinnable: true, needs: ["helper"] },
  { id: "permissions", name: "Site permissions", lane: "page", category: "protection", description: "What this site is allowed to do", icon: "eye", keywords: ["permission", "camera", "microphone", "location", "notification", "site"], target: { kind: "page", url: "chrome://settings/content" }, pinnable: false, needs: ["browser"] },
  { id: "secrets", name: "Secrets", lane: "keep", category: "protection", description: "Keys and passwords, behind a master password", icon: "secrets", keywords: ["secret", "password", "key", "vault", "credential"], target: { kind: "panel", view: "secrets" }, pinnable: true, needs: ["helper"] },
  // ---- Workspace
  { id: "workspaces", name: "Workspaces", lane: "keep", category: "workspace", description: "Sets of tabs kept together and reopened as one", icon: "workspaces", keywords: ["workspace", "space", "session", "project"], target: { kind: "view", view: "workspaces" }, app: "workspaces", pinnable: false, needs: ["helper"] },
  { id: "tasks", name: "Tasks", lane: "keep", category: "workspace", description: "Things to do", icon: "tasks", keywords: ["task", "todo", "to-do", "reminder"], target: { kind: "panel", view: "tasks" }, pinnable: true, needs: ["helper"] },
  { id: "reminders", name: "Reminders", lane: "keep", category: "workspace", description: "Tasks with a time on them", icon: "reminders", keywords: ["reminder", "due", "alarm", "later"], target: { kind: "view", view: "reminders" }, pinnable: false, needs: ["helper"] },
  { id: "clipboard", name: "Clipboard", lane: "keep", category: "workspace", description: "What has been copied lately", icon: "clipboard", keywords: ["clipboard", "copied", "paste", "copy"], target: { kind: "view", view: "clipboard" }, app: "clipboard", pinnable: false, needs: ["helper"] },
  // ---- Customize
  { id: "customize", name: "Customize", lane: "browse", category: "customize", description: "How the new tab page looks, and what it shows", icon: "customize", keywords: ["customize", "customise", "theme", "appearance", "wallpaper", "widget", "look"], target: { kind: "page", url: "chrome://orbis-newtab/" }, pinnable: false, needs: ["browser"] },
  // Tools. Both of these are Orbis window screens with no browser counterpart, which is why they are `app` targets:
  // the browser has nowhere to put them. They were both written down as the panel's 'home' view, so choosing Pages in
  // the Command Center redrew the Command Center.
  { id: "pages", name: "Pages", lane: "elsewhere", category: "tools", description: "Orbis\u2019s own tools, each with its own address", icon: "pages", keywords: ["page", "tool", "calculator", "converter", "lab", "build"], target: { kind: "app" }, app: "pages", pinnable: false, needs: ["helper"] },
  { id: "markets", name: "Markets", lane: "elsewhere", category: "tools", description: "Live prices, charts and watchlists", icon: "markets", keywords: ["market", "price", "chart", "crypto", "ticker", "watchlist", "trading"], target: { kind: "app" }, app: "markets", pinnable: false, needs: ["helper"] },
  { id: "student", name: "Student", lane: "elsewhere", category: "tools", description: "Focus sessions, goals, daily learning and Orbi", icon: "student", keywords: ["student", "study", "focus", "school", "exam", "revision", "homework", "learn", "goal", "pomodoro", "timer", "orbi", "xp"], target: { kind: "app" }, app: "student", pinnable: false, needs: [] },
  { id: "courses", name: "Courses", lane: "elsewhere", category: "tools", description: "Structured learning, with what you know actually measured", icon: "board", keywords: ["course", "courses", "lesson", "module", "curriculum", "learn", "learning", "certificate", "quiz", "syllabus", "tutorial", "training"], target: { kind: "app" }, app: "courses", pinnable: false, needs: [] },
  /*
   * There is no Profiles row here, and that is deliberate.
   *
   * It used to point at the panel's Account view, which is about the name somebody typed in: no list of profiles,
   * nothing to switch, and a true sentence about a different thing ("Orbis has no account") where the answer
   * should have been. Profiles are Settings and Settings is in the Orbis window, so there is nothing in the
   * browser for this row to open -- and the rule for this registry is that a row either goes somewhere or is not
   * here. Searching for "profile" finds Account, which is the thing the browser really has.
   */
  { id: "settings", name: "Settings", lane: "set", category: "settings", description: "Everything there is to change", icon: "settings", keywords: ["settings", "preferences", "options", "configure", "setup"], target: { kind: "page", url: "chrome://settings/" }, pinnable: false, needs: ["browser"] },
  { id: "settings.appearance", name: "Appearance", lane: "set", category: "settings", description: "Theme, fonts and how pages are shown", icon: "customize", keywords: ["appearance", "browser theme", "dark mode", "light mode", "font", "font size", "text size", "page zoom"], target: { kind: "page", url: "chrome://settings/appearance" }, pinnable: false, needs: ["browser"] },
  { id: "settings.privacy", name: "Privacy and security", lane: "set", category: "settings", description: "Cookies, tracking, safe browsing and clearing what is kept", icon: "privacy", keywords: ["privacy", "security", "cookies", "tracking", "clear", "delete", "safe browsing", "https"], target: { kind: "page", url: "chrome://settings/privacy" }, pinnable: false, needs: ["browser"] },
  { id: "settings.passwords", name: "Saved passwords", lane: "set", category: "settings", description: "The browser's own password manager, separate from the Orbis vault", icon: "secrets", keywords: ["saved passwords", "password manager", "browser passwords", "autofill", "login", "sign in"], target: { kind: "page", url: "chrome://password-manager/passwords" }, pinnable: false, needs: ["browser"] },
  { id: "settings.search-engines", name: "Search engines", lane: "set", category: "settings", description: "What a search in the address bar uses", icon: "search", keywords: ["search engine", "default search", "address bar", "omnibox", "shortcut"], target: { kind: "page", url: "chrome://settings/searchEngines" }, pinnable: false, needs: ["browser"] },
  { id: "settings.downloads", name: "Download settings", lane: "set", category: "settings", description: "Where files are saved, and whether to ask each time", icon: "downloads", keywords: ["download", "downloads", "save location", "folder", "ask where"], target: { kind: "page", url: "chrome://settings/downloads" }, pinnable: false, needs: ["browser"] },
  { id: "settings.languages", name: "Languages", lane: "set", category: "settings", description: "What to read pages in, and what to translate", icon: "languages", keywords: ["language", "languages", "translate", "spellcheck", "locale"], target: { kind: "page", url: "chrome://settings/languages" }, pinnable: false, needs: ["browser"] },
  { id: "settings.accessibility", name: "Accessibility", lane: "set", category: "settings", description: "Captions, focus and navigating without a mouse", icon: "accessibility", keywords: ["accessibility", "a11y", "caption", "captions", "screen reader", "contrast", "keyboard"], target: { kind: "page", url: "chrome://settings/accessibility" }, pinnable: false, needs: ["browser"] },
  { id: "settings.system", name: "System", lane: "set", category: "settings", description: "Startup, hardware acceleration and the proxy", icon: "system", keywords: ["system", "startup", "hardware acceleration", "gpu", "proxy", "background"], target: { kind: "page", url: "chrome://settings/system" }, pinnable: false, needs: ["browser"] },
  { id: "settings.reset", name: "Reset settings", lane: "set", category: "settings", description: "Put every setting back the way it started", icon: "reset", keywords: ["reset", "restore", "defaults", "factory", "start over"], target: { kind: "page", url: "chrome://settings/reset" }, pinnable: false, needs: ["browser"] },
  // Under Settings, beside Profiles, which opens the same screen. It used to sit under Customize -- "How Orbis looks
  // and what sits on the toolbar" -- where who you are signed in as is not what anybody was looking for.
  { id: "account", name: "Account", lane: "set", category: "settings", description: "Who Orbis knows you as", icon: "account", keywords: ["account", "profile", "profiles", "name", "identity", "who", "person"], target: { kind: "panel", view: "account" }, pinnable: true, needs: ["helper"] }
];
var capabilityById = (id) => CAPABILITIES.find((c) => c.id === id);
var capabilitiesIn = (category) => CAPABILITIES.filter((c) => c.category === category);
function destinationMissing(capability) {
  const target = capability.target;
  if (target.kind === "app") return "Only in the Orbis window";
  if (target.kind === "panel") {
    if (target.view === "home") return "This is the screen you are on";
    return PANEL_VIEWS.includes(target.view) ? null : "Orbis has not built this screen yet";
  }
  if (target.kind === "view") {
    return RAIL_VIEWS.includes(target.view) ? null : "Orbis has not built this screen yet";
  }
  return null;
}
function unavailableBecause(capability, ready) {
  if (capability.app && ready.window === true) return null;
  const nowhere = destinationMissing(capability);
  if (nowhere) return nowhere;
  for (const need of capability.needs) {
    if (need === "browser" && !ready.browser) return "The browser is not connected";
    if (need === "task" && !ready.task) return "Orbis cannot act in the browser yet";
    if (need === "helper" && !ready.helper) return "Orbis is not running";
    if (need === "key" && !ready.key) return "Orion has no key";
    if (need === "page" && !ready.page) return "There is no page to act on";
  }
  return null;
}
var isAvailable = (capability, ready) => unavailableBecause(capability, ready) === null;
var isWordCharacter = (ch) => /[a-z0-9]/i.test(ch);
function scoreCapability(capability, query) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = capability.name.toLowerCase();
  const keywords = capability.keywords.map((k) => k.toLowerCase());
  if (name === q) return 100;
  if (name.startsWith(q)) return 80 + Math.round(10 * q.length / name.length);
  if (keywords.includes(q)) return 70;
  const at = name.indexOf(q);
  const startsAWord = at === 0 || at > 0 && !isWordCharacter(name[at - 1]);
  if (at >= 0 && startsAWord) return 60;
  if (keywords.some((k) => k.startsWith(q))) return 40;
  if (capability.category.toLowerCase() === q) return 30;
  if (name.includes(q)) return 25;
  if (capability.description.toLowerCase().includes(q)) return 20;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const haystack = `${name} ${keywords.join(" ")} ${capability.description}`.toLowerCase();
    if (words.every((w) => haystack.includes(w))) return 15;
  }
  return 0;
}
function searchCapabilities(query, ready, limit = 8) {
  return CAPABILITIES.map((capability) => ({ capability, score: scoreCapability(capability, query), unavailable: unavailableBecause(capability, ready) })).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score || a.capability.name.localeCompare(b.capability.name)).slice(0, limit);
}
function addressFor(capability) {
  if (capability.target.kind === "panel" || capability.target.kind === "view") return `chrome://orbis/#${capability.target.view}`;
  if (capability.target.kind === "page") return capability.target.url;
  return "";
}
var MAX_PINS = 6;
var canPin = (capability) => capability.pinnable;
function normalizePins(raw) {
  const out = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id !== "string" || out.includes(id)) continue;
    const capability = capabilityById(id);
    if (!capability || !canPin(capability)) continue;
    out.push(id);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}
function addPin(pins, id) {
  const capability = capabilityById(id);
  if (!capability) return { ok: false, error: "That is not something Orbis has." };
  if (!canPin(capability)) return { ok: false, error: `${capability.name} cannot go on the toolbar.` };
  if (pins.includes(id)) return { ok: true, pins };
  if (pins.length >= MAX_PINS) return { ok: false, error: `The toolbar holds ${MAX_PINS}. Remove one first.` };
  return { ok: true, pins: [...pins, id] };
}
var removePin = (pins, id) => pins.filter((p) => p !== id);
function movePin(pins, id, delta) {
  const from = pins.indexOf(id);
  if (from < 0) return pins;
  const to = from + delta;
  if (to < 0 || to >= pins.length) return pins;
  const out = [...pins];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}
export {
  CAPABILITIES,
  CATEGORIES,
  LANES,
  MAX_PINS,
  PANEL_VIEWS,
  RAIL_VIEWS,
  addPin,
  addressFor,
  canPin,
  capabilitiesIn,
  capabilityById,
  destinationMissing,
  isAvailable,
  movePin,
  normalizePins,
  removePin,
  scoreCapability,
  searchCapabilities,
  unavailableBecause
};
