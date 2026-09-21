# Orbis UI inventory (where each Orbis surface lives in the browser)

| Surface | Lives in | Status |
| --- | --- | --- |
| Panel: Ask, Search, Blocking, Notes, Tasks, Workflows, Galaxy, Secrets | `chrome://orbis` (WebUI, `chrome/browser/ui/webui/orbis`, sources `orbis-ui/panel`), shown in the native side panel | Built in; live data from the helper |
| Ad blocking engine (network rules, page filtering, popups, statistics) | Component extension `resources/orbis_extension` (id gcaebck...), hidden from chrome://extensions | Built in as a component |
| New tab page | `chrome://orbis-newtab` (WebUI, sources `orbis-ui/newtab`); Chromium's new tab URL resolves to it (`search.cc`) | Built in (phase 2) |
| Orbis Search results | `chrome://orbis-search` (WebUI, sources `orbis-ui/results`, built from `results.ts`) | Built in (phase 2) |
| Default search URL and its migration | `chromium-orbis-default-search.patch`: `chrome://orbis-search/#q={searchTerms}`; also moves profiles whose default was the old extension-page engine | Done (phase 2) |
| Ctrl+Enter (Orion answer) / Shift+Enter (system browser) | `chromium-orbis-newtab-and-orion.patch` / `chromium-orbis-shift-enter.patch` | Done |
| Sidebar (launcher rail: groups, pin, hide, reorder, icons/labels, compact) | Left rail of `chrome://orbis` (`orbis-ui/panel/sidebar.ts`); the arrangement is kept by the app's `BrowserSidebarStore` through helper channels `sidebar:get/save/reset` | Built in (phase 2); see deferred list below |
| Assistant orb | On `chrome://orbis-newtab` and `chrome://orbis-search` (`orbis-ui/panel/orb.js`): quick Orion prompt on the real `chat:send` channel; "Open the Orbis panel" shows the native side panel (`orbis.openPanel`) | Built in (phase 2); see deferred list below |
| Views restyle (tab strip, toolbar, omnibox popup, menus, dialogs, settings...) | not started | Phase 3 |

## Phase 2 deferred (stated honestly)

- Sidebar rows for panels that have no implementation in the Chromium build are shown disabled with a tooltip, not faked: Tabs, Tab groups, Saved pages, Workspaces, Reminders, Clipboard, Whiteboard, Research, Sources, Screenshots, Media, Controls. Rows for Bookmarks, History, Downloads, Reading list, Extensions, Profiles, Customize, Privacy and Tracking open Chromium's own page for that feature in a new tab; Orion, Blocking, Notes, Tasks, Workflows, Galaxy and Secrets open the panel's own tab.
- The rail shows in the `chrome://orbis` page (tab or native side panel). Resizing the rail by dragging, group creation/rename and drag-and-drop reordering are not in this port (pin, hide, up/down, collapse, icons/labels and compact are). Rows use letter monograms until the phase 3 icon family.
- The orb is not drawn over ordinary web pages (a chrome:// page cannot draw over another page; that needs a native overlay or a content script in the component extension). Opening the panel from the orb does not carry the typed prompt across (the quick prompt answers in place).
- The tab context menu (`TabContextMenu.tsx`) belongs to Chromium's native tab strip now (phase 3 restyles it).
