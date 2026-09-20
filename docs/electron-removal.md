# Removing the Electron browser from the main process

Orbis's browser is Chromium and nothing else. The in-app Electron browser (a `<webview>` per tab, driven by the main process) was
deleted from the renderer earlier; this is the same job for the main process, the preload, the shared types and the styles. Every
feature of the Orbis app that touched it was either re-pointed at Chromium or is listed below as deliberately gone.

## What was removed

| Removed | Lines | What it was |
| --- | ---: | --- |
| `src/main/browserIntegration.ts` | 632 | Shortcuts, context menu, downloads, permissions, swipe recogniser wiring and IPC for the in-app tabs |
| `src/main/extensions/manager.ts`, `bridge.ts` | 515 + 822 | The Electron extension host: installing from the Web Store and re-implementing `chrome.tabs`/`chrome.windows` for extensions |
| `src/main/extensions/matchPattern.ts` (+ test) | 40 + 29 | URL match patterns for that host |
| `src/main/adblock/electron.ts` | 475 | The blocker on Electron's session (`webRequest`, CSP, cosmetic frame preload) |
| `src/main/browserControl/mainCapabilities.ts` | 1,542 | The Electron capability set: windows, devtools, permissions, downloads, history, bookmarks, extensions, shortcuts, clipboard, settings, state |
| `src/main/browserControl/electronPages.ts` | 26 | Resolved a capability's page to an Electron `webview` |
| `src/main/browserShortcuts.ts` (+ test) | 169 + 89 | The in-app browser's keyboard shortcut table |
| `src/main/deviceChooser.ts` | 156 | USB/HID/serial/Bluetooth chooser for in-app pages |
| `src/main/workflows/recorder.ts` | 77 | The Electron workflow recorder (Chromium's is `workflows/chromiumRecorder.ts`) |
| `src/preload/adblockFrame.ts`, `extensionApis.ts` | 8 + 302 | Preloads for in-app frames and for extension pages in the Electron host |
| `AdBlockSection.tsx`, `ExtensionPrompts.tsx`, `DeviceChooser.tsx`, `ShortcutsGrid.tsx` | 242 + 62 + 92 + 195 | Renderer components nothing mounted any more |
| `styles.css` | about 3,300 | 452 rules of classes no component uses (browser, sidebar panel, extension, ad block, device, tab, shortcut) |

In the files that stay: `index.ts` (-284 net of additions), `types.ts` (-278), the preload (-71: 51 channels), `BrowserLibrary` (-278: the
history recorder, downloads bookkeeping, permissions, reading list, saved pages and pictures), the renderer's window-control library and
`App.tsx` (-148: the in-app browser's state and its `app` capability scope). Electron's `webviewTag` stays `false`, and the Electron
preload build now has one entry (the app's own).

The first commit (`git show --stat 6082fc7`) is 6,865 lines out and 925 in; the styles are 3,300 lines net out.

## What the app still has of it, and why

* **`window.ts`, `setup.ts`, `registry.ts`, `runner.ts`**: the Browser Control Layer's registry, approvals (the confirm prompts are shown in the
  Orbis window), plan runs, the log, the switches, and the window-provided capabilities. The address bar in the Orbis window still provides
  its `addressBar.*` capabilities through `control:window-scope`. The window no longer reports browser state: the main process reads
  Chromium's tabs itself (`browserState.ts`).
* **`appCapabilities.ts`** (the app's own capabilities): `settings.get/set`, `clipboard.formats/read/write/clear`, `state.snapshot/capabilities/log/check`,
  `browser.open/close/openWorkspace`, `navigation.openExternal`. `state.check` now reads Chromium's downloads, windows and extensions
  through their capabilities and pages through Chromium's page resolver. `uiCapabilities.ts` (the Orbis interface, `ui.*`) is unchanged
  apart from dropping selectors of deleted regions. The page and CAPTCHA capabilities are registered once with a resolver that says
  "the Orbis browser is not open yet", so they are listed before the browser starts; Chromium's own resolver replaces them when it starts.
* **`browserCapabilities.ts`**: window and tab conveniences the old set had and Chromium's did not spell out (below), on `chrome.windows` / `chrome.tabs`.
* **`libraryIpc.ts` + `BrowserLibrary`**: the app's own memory (new-tab shortcuts, address-bar searches and picks) and a *copy* of Chromium's history,
  bookmarks and downloads. Decision by evidence: the address bar (`UrlBar`), the new-tab widgets (`widgets/views.tsx`) and Galaxy read
  `library:get`/`library:changed`, and the workflow engine's "download completed" trigger listens to the library. So the store stays, but
  Chromium is the source of truth: `browserMirror.ts` reads history, bookmarks and downloads from the browser's capabilities when the
  window asks (at most every 3 s) and when the browser's tabs change; writes the window can still make (bookmark, remove from history, show
  a download) are made in Chromium and then re-read. The reading list, saved pages and pictures of pages had no screen left; their
  data in `browser-library.json` is written back untouched, never dropped.
* **`historySwipe.ts` (shared) and `gestureAdapter.ts`**: kept, with their tests. Two-finger swipe must work in the Chromium build, and
  whether Chromium's own overscroll navigation covers a Windows precision touchpad is not yet verified on hardware
  (`docs/chromium-migration.md`). The recogniser's rules are what a port would use if it does not.
* **`browserSidebarStore.ts` + `browser-sidebar:*`**: kept (per-profile layout for the side panel, planned in `docs/parity/01-browser-ui.md`);
  nothing in the renderer reads it yet.
* **`adblock/blocker.ts` and `store.ts`**: shared with the Chromium path (the extension's build, `adblockInjector`), kept.

## What was re-pointed to Chromium

| Was | Now |
| --- | --- |
| Chat ad-blocking commands (`adblock.command`) on the Electron blocker | `adblockChat.ts`: read and change the extension's ad blocker (`globalThis.__orbisAdblock` through the extension bridge) and answer only from what it reports. What it cannot do from chat (allow one blocked resource, update lists) it says |
| `chat:browser-target` handshake (the window handed over a `webview`) | Removed; the browser agent takes Chromium's active tab (`BrowserManager.ensure().agent`); no Chromium installed gives "The Orbis browser (Chromium) is not installed" |
| `readOpenPage` (text of the open `webview`) | Reads the matching tab through Chromium's page handle |
| Chat request's open page (`request.browser`, sent by the deleted panel) | Filled from Chromium's active web tab in the main process (`openBrowserPage`), so "summarise this page" and ad-block questions have a page again |
| Step-by-step runs' `activePage` (`webContents.fromId`) | Chromium's page by id |
| `windowControl.state` (the panel's report) feeding workspaces, Galaxy, workflow triggers | `followChromiumTabs`: read at start and on the browser's own tab events, with pinned, muted, audible, private and groups (colors mapped to and from Chromium's names); `previousTabId` kept |
| `browser.openWorkspace` (Workspaces "open") | `browserWorkspace.ts`: tabs, pins, groups and the active page through the extension, real-browser tested |
| Profile partitions (`persist:browser`, `persist:profile-*`), `partitionFor` | Gone. A profile is its data folder (`profilesStore.dataDir`) and its own Chromium folder (`BrowserManager` `profileId`). `profiles:list` and `profiles:changed` no longer carry a `partition` |
| Search made in the browser recorded by the in-app URL bar | `browserSearches.ts`: a tab showing the Orbis Search results page (`#q=`) is one search, recorded once, never from a private tab, only when "personalized suggestions" is on; reopening saved research (`&at=`) is not a search. Works with both `chrome-extension://…/results.html` and `chrome://orbis-search` |
| Web/Orion suggestions and local speech for the results page | Helper channels `omnibox:web`, `omnibox:predict`, `voice:transcribe`, `voice:cancel`, `voice:hardware`, `voice:models:status` (`src/helper/appServices.ts`): the same functions and settings the Orbis window uses (suggestions answer `[]` unless "Web search suggestions" is on). `voice:transcribe` takes the clip as base64 and returns `{ ok, text }` |
| Saved Orion Search research | The app's one `SearchSessionStore` is given to `BrowserManager` (`searchSessions`) so browser-side saves refresh Galaxy |

Microphone on the results page: on real Chromium (fake capture device) the results page can call `getUserMedia`, records with
`MediaRecorder` as `audio/webm;codecs=opus`, and produced 12,000 bytes in 1.2 s, which is what `voice:transcribe` takes. With a real
microphone Chromium shows its normal microphone prompt for that extension page (checked with the fake-UI flag only; a real device
prompt was not exercised here). Porting the button, the level meter and the push-to-talk handling into the page is page work (the
page is another agent's file); nothing on the app side is missing.

## Capability ids: before and after

`node scripts/capability-ids.mjs` lists the control-layer ids registered before the Electron browser UI was removed (main capability set
plus everything the window registered, read from git at `cf38507^`) and the ids registered now. Result: **164 before, 149 now, 139
kept, 25 not carried over (every one deliberate, below), 10 new.**

Not carried over, and why:

| Ids | Outcome |
| --- | --- |
| `browser.show`, `browser.backToChat`, `browser.showPanel`, `find.open`, `find.close` | Deliberately gone: they drove the in-app panel and find bar. Chromium has its own find bar (`find.text` reads and drives it) and window |
| `browser.restoreSession`, `tabs.split`, `tabs.mobileView`, `tabs.rename`, `tabs.muteSite` | Deliberately gone: features of the Orbis tab strip. Chromium restores its own session; `tabs.mute` (per tab) exists |
| `extensions.install`, `.update`, `.pin`, `.clickAction`, `.clickContextMenu`, `.openOptions`, `.pages`, `.permissions`, `.revokePermissions` | Deliberately gone: Chromium's extension system and toolbar own these, and installs from the Web Store need the person at Chromium's prompt. `extensions.list`, `.setEnabled`, `.remove` exist |
| `permissions.answer`, `permissions.getAll`, `permissions.remove` | Deliberately gone: site permission prompts are Chromium's own. `permissions.list`, `.set`, `.forget` exist |
| `shortcuts.list`, `shortcuts.invoke` | Replaced by `browser.shortcut` (Chromium's own shortcuts by name) |
| `downloads.show` | Renamed `downloads.showInFolder` |

Found missing by the comparison and **ported**, so they are kept, not gone: `navigation.openExternal`, `window.minimize/maximize/restore/fullscreen/focus/resize/move`,
`tabs.closeOthers/closeRight/activatePrevious/activateMatching/closeMatching`, `downloads.open`, and `browser.openWorkspace`
(the Workspaces "open" button called it, and nothing registered it any more until this was done). They live in `appCapabilities.ts`,
`browserCapabilities.ts` and `browserWorkspace.ts`, with real-Chromium tests.

New ids Chromium added: `addressBar.type`, `bookmarks.readingList*`, `browser.shortcut`, `downloads.showInFolder`, `find.text`, `groups.list`,
`tabs.recentlyClosed`, `window.innerWidth`. The state parts `downloads`, `history`, `bookmarks`, `extensions` and `permissions` of
`state.snapshot` (read from the Electron library) are not registered any more; `tabs`, `windows`, `browser`, `settings`, `clipboard`,
`capabilities` and `automation` are.

## IPC

`src/main/ipcMapping.test.ts` and `docs/ipc-mapping.md` agree: 176 channels before, **131 now**. Gone: all `extensions:*`, `adblock:*`, `orbis-ext:call`,
all `browser:*`, the `library:*` reading list, saved pages, screenshots, permissions, clear-* and bulk
bookmark and history operations, `control:window-state`, `chat:browser-target`, `chromium:available`. The preload lost 58 methods and
the shared types 18 types.

## Known limits

* Capabilities are listed before the browser starts only for the app's own set and the page/CAPTCHA/UI ones. Tab, window, download and
  extension capabilities appear when Chromium has started (a workflow draft made before that does not see them). Starting the browser
  to list them was judged worse than the gap.
* The mirror of Chromium's downloads refreshes on the window's reads and on tab changes, so a "download completed" workflow trigger can
  fire a few seconds late, and only while the window or the browser is being used.
* `UrlBar` still contains the bookmark, reading-list and page-picture buttons for a page open in the window; with no in-app page they never
  show. Removing them is a renderer refactor of a 1,000-line component and was left.
* Voice: see above (page port).
