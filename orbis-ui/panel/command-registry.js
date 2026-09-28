// src/shared/commandCenter.ts
var CATEGORIES = [
  { id: "browser", label: "Browser", icon: "tabs", blurb: "Tabs, navigation, and everything Orbis keeps for you" },
  { id: "ai", label: "AI", icon: "orion", blurb: "Orion: asking, reading this page, and acting on it" },
  { id: "automation", label: "Automation", icon: "workflows", blurb: "Work Orbis does for you, and what it did" },
  { id: "research", label: "Research", icon: "research", blurb: "Searching, sources, notes and how they connect" },
  { id: "capture", label: "Capture", icon: "screenshots", blurb: "Pictures of pages, and pages kept to read later" },
  { id: "media", label: "Media", icon: "media", blurb: "What is playing, and where" },
  { id: "protection", label: "Privacy & Protection", icon: "privacy", blurb: "What a page is allowed to do" },
  { id: "workspace", label: "Workspace", icon: "workspaces", blurb: "Sets of tabs, and the things you are keeping" },
  { id: "customize", label: "Customize", icon: "customize", blurb: "How Orbis looks and what sits on the toolbar" },
  { id: "settings", label: "Settings", icon: "settings", blurb: "Every setting, found by name instead of hunted for" }
];
var CAPABILITIES = [
  // ---- Browser
  { id: "tabs", name: "Tabs", category: "browser", description: "Every open tab, to search, switch or close", icon: "tabs", keywords: ["tab", "switch", "open", "close"], target: { kind: "view", view: "tabs" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "tabGroups", name: "Tab groups", category: "browser", description: "The groups your tabs are gathered into", icon: "tabGroups", keywords: ["group", "collection"], target: { kind: "view", view: "tabGroups" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "navigation", name: "Navigation", category: "browser", description: "Back, forward, reload and stop", icon: "back", keywords: ["back", "forward", "reload", "refresh", "stop"], target: { kind: "view", view: "controls" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "zoom", name: "Zoom", category: "browser", description: "How large this page is drawn", icon: "zoomIn", keywords: ["zoom", "bigger", "smaller", "text size"], target: { kind: "view", view: "controls" }, pinnable: false, needs: ["browser", "helper", "page"] },
  { id: "copyLink", name: "Copy link", category: "browser", description: "This page's address, on the clipboard", icon: "clipboard", keywords: ["copy", "link", "url", "address", "share", "clipboard"], target: { kind: "do", message: "orbis.page.copyLink" }, pinnable: false, needs: ["browser", "page"] },
  { id: "bookmarks", name: "Bookmarks", category: "browser", description: "Pages kept for later", icon: "bookmarks", keywords: ["bookmark", "favourite", "favorite", "saved"], target: { kind: "page", url: "chrome://bookmarks/" }, pinnable: false, needs: ["browser"] },
  { id: "history", name: "History", category: "browser", description: "Where this profile has been", icon: "history", keywords: ["history", "visited", "recent"], target: { kind: "page", url: "chrome://history/" }, pinnable: false, needs: ["browser"] },
  { id: "downloads", name: "Downloads", category: "browser", description: "Files Orbis has fetched", icon: "downloads", keywords: ["download", "file", "saved"], target: { kind: "page", url: "chrome://downloads/" }, pinnable: false, needs: ["browser"] },
  { id: "extensions", name: "Extensions", category: "browser", description: "What is installed, and whether it is on", icon: "extensions", keywords: ["extension", "addon", "add-on", "plugin"], target: { kind: "page", url: "chrome://extensions/" }, pinnable: false, needs: ["browser"] },
  { id: "controls", name: "Browser controls", category: "browser", description: "Everything Orbis can be asked to do, and what it has done", icon: "controls", keywords: ["control", "command", "capability", "action"], target: { kind: "view", view: "controls" }, pinnable: false, needs: ["browser", "helper"] },
  // ---- AI
  { id: "ask", name: "Ask Orion", category: "ai", description: "Ask about this page, or about anything", icon: "orion", keywords: ["orion", "ai", "chat", "ask", "assistant", "question"], target: { kind: "panel", view: "ask" }, pinnable: true, needs: ["helper", "key"] },
  { id: "orbSummarise", name: "Summarise this page", category: "ai", description: "What this page says, in short", icon: "orion", keywords: ["summary", "summarise", "summarize", "tldr", "explain"], target: { kind: "panel", view: "ask" }, pinnable: false, needs: ["helper", "key", "browser", "page"] },
  { id: "browserTask", name: "Do something on this page", category: "ai", description: "Give Orbis a task and watch it work in the browser", icon: "controls", keywords: ["task", "agent", "automate", "click", "do", "act"], target: { kind: "panel", view: "ask" }, pinnable: false, needs: ["helper", "key", "browser"] },
  // ---- Automation
  { id: "workflows", name: "Workflows", category: "automation", description: "Sequences Orbis runs for you, and what they did", icon: "workflows", keywords: ["workflow", "automation", "automate", "routine", "schedule", "run"], target: { kind: "panel", view: "workflows" }, pinnable: true, needs: ["helper"] },
  // ---- Research
  { id: "search", name: "Search", category: "research", description: "Search the web from Orbis", icon: "search", keywords: ["search", "find", "web", "images", "videos", "news"], target: { kind: "panel", view: "search" }, pinnable: true, needs: ["helper"] },
  { id: "galaxy", name: "Galaxy", category: "research", description: "A map of everything Orbis keeps, and how it connects", icon: "galaxy", keywords: ["galaxy", "map", "graph", "connections", "knowledge"], target: { kind: "panel", view: "galaxy" }, pinnable: true, needs: ["helper"] },
  { id: "notes", name: "Notes", category: "research", description: "Notes kept in Orbis", icon: "notes", keywords: ["note", "write", "jot"], target: { kind: "panel", view: "notes" }, pinnable: true, needs: ["helper"] },
  { id: "whiteboard", name: "Whiteboard", category: "research", description: "Boards to gather things on", icon: "whiteboard", keywords: ["whiteboard", "board", "canvas", "draw"], target: { kind: "view", view: "whiteboard" }, pinnable: false, needs: ["helper"] },
  { id: "sources", name: "Sources", category: "research", description: "The pages behind an answer", icon: "sources", keywords: ["source", "citation", "reference", "research"], target: { kind: "view", view: "sources" }, pinnable: false, needs: ["helper"] },
  { id: "research", name: "Research", category: "research", description: "What Orion has looked into, and what it found", icon: "research", keywords: ["research", "investigate", "study", "deep"], target: { kind: "view", view: "research" }, pinnable: false, needs: ["helper"] },
  // ---- Capture
  { id: "screenshots", name: "Screenshots", category: "capture", description: "Pictures taken of pages", icon: "screenshots", keywords: ["screenshot", "capture", "picture", "image", "snap"], target: { kind: "view", view: "screenshots" }, pinnable: false, needs: ["helper"] },
  { id: "savedPages", name: "Saved pages", category: "capture", description: "Pages kept on this computer, readable offline", icon: "savedPages", keywords: ["saved", "offline", "archive", "keep"], target: { kind: "view", view: "savedPages" }, pinnable: false, needs: ["helper"] },
  // ---- Media
  { id: "media", name: "Media", category: "media", description: "What is playing, and where", icon: "media", keywords: ["media", "audio", "video", "play", "pause", "sound", "music"], target: { kind: "view", view: "media" }, pinnable: false, needs: ["browser", "helper"] },
  // ---- Privacy & Protection
  // Not pinnable: pinning offers a toolbar button, and the toolbar actions the browser registers are the list in
  // chrome/browser/ui/browser_actions.cc. Marking these pinnable would offer a pin that could never become a button.
  // "password" is deliberately not a keyword on any of them -- somebody typing it means the Secrets vault, and taking that
  // word would make the vault harder to find in order to make a lock command easier to.
  { id: "lockTab", name: "Lock this tab", category: "protection", description: "Hides this tab behind its tab password, at once", icon: "privacy", keywords: ["lock", "private", "hide", "protect", "tab lock"], target: { kind: "ask", channel: "security:lockTab" }, pinnable: false, needs: ["browser", "helper"] },
  { id: "lockAllTabs", name: "Lock every protected tab", category: "protection", description: "Locks everything you have protected and closes every tab password", icon: "privacy", keywords: ["lock", "all", "panic", "private", "hide", "everything"], target: { kind: "ask", channel: "security:lockAll" }, pinnable: false, needs: ["helper"] },
  { id: "lockOrbis", name: "Lock Orbis", category: "protection", description: "Puts Orbis away and asks for your account password. Nothing is closed", icon: "privacy", keywords: ["lock", "orbis", "profile", "away", "sign out"], target: { kind: "ask", channel: "security:lockProfile" }, pinnable: false, needs: ["helper"] },
  { id: "adblock", name: "Ad blocking", category: "protection", description: "What was blocked here, and the rules behind it", icon: "adblock", keywords: ["ad", "advert", "advertising", "block", "blocker", "ads"], target: { kind: "panel", view: "block" }, pinnable: true, needs: ["helper"] },
  { id: "permissions", name: "Site permissions", category: "protection", description: "What this site is allowed to do", icon: "privacy", keywords: ["permission", "camera", "microphone", "location", "notification", "site"], target: { kind: "page", url: "chrome://settings/content" }, pinnable: false, needs: ["browser"] },
  { id: "secrets", name: "Secrets", category: "protection", description: "Keys and passwords, behind a master password", icon: "secrets", keywords: ["secret", "password", "key", "vault", "credential"], target: { kind: "panel", view: "secrets" }, pinnable: true, needs: ["helper"] },
  // ---- Workspace
  { id: "workspaces", name: "Workspaces", category: "workspace", description: "Sets of tabs kept together and reopened as one", icon: "workspaces", keywords: ["workspace", "space", "session", "project"], target: { kind: "view", view: "workspaces" }, pinnable: false, needs: ["helper"] },
  { id: "tasks", name: "Tasks", category: "workspace", description: "Things to do", icon: "tasks", keywords: ["task", "todo", "to-do", "reminder"], target: { kind: "panel", view: "tasks" }, pinnable: true, needs: ["helper"] },
  { id: "reminders", name: "Reminders", category: "workspace", description: "Tasks with a time on them", icon: "reminders", keywords: ["reminder", "due", "alarm", "later"], target: { kind: "view", view: "reminders" }, pinnable: false, needs: ["helper"] },
  { id: "clipboard", name: "Clipboard", category: "workspace", description: "What has been copied lately", icon: "clipboard", keywords: ["clipboard", "copied", "paste", "copy"], target: { kind: "view", view: "clipboard" }, pinnable: false, needs: ["helper"] },
  // ---- Customize
  { id: "customize", name: "Customize", category: "customize", description: "How the new tab page looks, and what it shows", icon: "customize", keywords: ["customize", "customise", "theme", "appearance", "wallpaper", "widget", "look"], target: { kind: "page", url: "chrome://orbis-newtab/" }, pinnable: false, needs: ["browser"] },
  { id: "settings", name: "Settings", category: "settings", description: "Everything there is to change", icon: "settings", keywords: ["settings", "preferences", "options", "configure", "setup"], target: { kind: "page", url: "chrome://settings/" }, pinnable: false, needs: ["browser"] },
  { id: "settings.appearance", name: "Appearance", category: "settings", description: "Theme, fonts and how pages are shown", icon: "customize", keywords: ["appearance", "browser theme", "dark mode", "light mode", "font", "font size", "text size", "page zoom"], target: { kind: "page", url: "chrome://settings/appearance" }, pinnable: false, needs: ["browser"] },
  { id: "settings.privacy", name: "Privacy and security", category: "settings", description: "Cookies, tracking, safe browsing and clearing what is kept", icon: "privacy", keywords: ["privacy", "security", "cookies", "tracking", "clear", "delete", "safe browsing", "https"], target: { kind: "page", url: "chrome://settings/privacy" }, pinnable: false, needs: ["browser"] },
  { id: "settings.passwords", name: "Saved passwords", category: "settings", description: "The browser's own password manager, separate from the Orbis vault", icon: "secrets", keywords: ["saved passwords", "password manager", "browser passwords", "autofill", "login", "sign in"], target: { kind: "page", url: "chrome://password-manager/passwords" }, pinnable: false, needs: ["browser"] },
  { id: "settings.search-engines", name: "Search engines", category: "settings", description: "What a search in the address bar uses", icon: "search", keywords: ["search engine", "default search", "address bar", "omnibox", "shortcut"], target: { kind: "page", url: "chrome://settings/searchEngines" }, pinnable: false, needs: ["browser"] },
  { id: "settings.downloads", name: "Download settings", category: "settings", description: "Where files are saved, and whether to ask each time", icon: "downloads", keywords: ["download", "downloads", "save location", "folder", "ask where"], target: { kind: "page", url: "chrome://settings/downloads" }, pinnable: false, needs: ["browser"] },
  { id: "settings.languages", name: "Languages", category: "settings", description: "What to read pages in, and what to translate", icon: "languages", keywords: ["language", "languages", "translate", "spellcheck", "locale"], target: { kind: "page", url: "chrome://settings/languages" }, pinnable: false, needs: ["browser"] },
  { id: "settings.accessibility", name: "Accessibility", category: "settings", description: "Captions, focus and navigating without a mouse", icon: "accessibility", keywords: ["accessibility", "a11y", "caption", "captions", "screen reader", "contrast", "keyboard"], target: { kind: "page", url: "chrome://settings/accessibility" }, pinnable: false, needs: ["browser"] },
  { id: "settings.system", name: "System", category: "settings", description: "Startup, hardware acceleration and the proxy", icon: "system", keywords: ["system", "startup", "hardware acceleration", "gpu", "proxy", "background"], target: { kind: "page", url: "chrome://settings/system" }, pinnable: false, needs: ["browser"] },
  { id: "settings.reset", name: "Reset settings", category: "settings", description: "Put every setting back the way it started", icon: "reset", keywords: ["reset", "restore", "defaults", "factory", "start over"], target: { kind: "page", url: "chrome://settings/reset" }, pinnable: false, needs: ["browser"] },
  { id: "account", name: "Account", category: "customize", description: "Who Orbis knows you as", icon: "account", keywords: ["account", "profile", "name", "identity", "who"], target: { kind: "panel", view: "account" }, pinnable: true, needs: ["helper"] }
];
var capabilityById = (id) => CAPABILITIES.find((c) => c.id === id);
var capabilitiesIn = (category) => CAPABILITIES.filter((c) => c.category === category);
function unavailableBecause(capability, ready) {
  for (const need of capability.needs) {
    if (need === "browser" && !ready.browser) return "The browser is not connected";
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
  if (name.startsWith(q)) return 80;
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
  MAX_PINS,
  addPin,
  addressFor,
  canPin,
  capabilitiesIn,
  capabilityById,
  isAvailable,
  movePin,
  normalizePins,
  removePin,
  scoreCapability,
  searchCapabilities,
  unavailableBecause
};
