// Orbis's component extension. The Orbis panel is built into the browser (chrome://orbis); what remains here is ad blocking
// (network rules, page filtering, popups, statistics; built by scripts/build-extension.mjs) and, until the built-in pages replace
// them, the new tab page and the search results page. The app reaches this worker over the browser's debugging pipe.
import './adblock.js'
// The selection orb's worker: what actually happens when somebody picks an action from the orb on a page.
import './selection-worker.js'
// Visual Search's worker: the only side that can take a picture of the window, cut the selection out of it, and
// reach Orbis. The page side draws a rectangle and knows nothing.
import './visual-worker.js'
// Orbis Music's full-tab page asks this worker to open it: chrome.tabs.create lives only here, and the helper's own
// way of opening an address accepts http and https only, so nothing else can put an extension page in a tab.
import './music-worker.js'
