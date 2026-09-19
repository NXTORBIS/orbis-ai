// Clicking the Orbis button in the toolbar opens the side panel beside the page. That is all this file does; every
// real thing Orbis does is done by the helper running on this computer, which the panel talks to directly.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

// Orbis ad blocking (network rules, page filtering, popups, statistics). Built by scripts/build-extension.mjs.
import './adblock.js'
