// Orbis's component extension. The Orbis panel is built into the browser (chrome://orbis); what remains here is ad blocking
// (network rules, page filtering, popups, statistics; built by scripts/build-extension.mjs) and, until the built-in pages replace
// them, the new tab page and the search results page. The app reaches this worker over the browser's debugging pipe.
import './adblock.js'
