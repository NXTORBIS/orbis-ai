# Chromium migration audit (Phases 1 and 2)

Scope: what the Electron Orbis browser actually does today (from code, not from memory), and the closest equivalent in
the Chromium 154 build at `C:\chromium\src` (`out\Default\chrome.exe`). Read-only audit; no source was changed.
Complements `docs/chromium-migration.md` (plan/status), `docs/ipc-mapping.md` (IPC contract) and
`docs/chromium-sidepanel-plan.md` (the side-panel route already started).

Line numbers are from the working tree at audit time. Where a claim is an inference rather than read from code it is
marked (inferred).

## 0. Findings that correct assumptions

1. **The browser is a `<webview>` tag inside one BrowserWindow.** There is no `WebContentsView`/`BrowserView` in
   `src/main`. `webviewTag: true` at `src/main/index.ts:368`; one `<webview>` per tab is rendered by `TabView`
   (`BrowserPanel.tsx:3214`). Main sees each tab as a guest `webContents` (`did-attach-webview`,
   `index.ts:393`), addressed by numeric `webContentsId`.
2. **"Full / Large / Medium / Small / Custom" browser modes do not exist in the code.** The only mode type is
   `mode: 'full' | 'window' | 'dock' | null` (`src/shared/browserControl.ts:323`), and the renderer hardcodes
   `mode: 'full'` (`App.tsx:1015`). What exists: the browser is a full-window panel (`browser-panel full`,
   `BrowserPanel.tsx:2427`) that can be hidden back to chat (`browserHidden`, `App.tsx:110`), plus an OS pop-out
   window (`popOutBrowser`, `index.ts:317`) and a per-tab mobile/desktop UA (`BrowserPanel.tsx:1171`). If the five
   size modes are a product requirement they are new work, not a port.
3. **A Chromium side-panel route is already in the repo**: `extension/` + `extension-src/` (MV3 extension with
   `panel.html/js`), `src/helper/` (local Node helper with token auth, `server.ts`, `auth.ts`, `handlers.ts`,
   ad-block DNR build in `src/helper/adblock/`), and two Chromium patches in `patches/`
   (`chromium-adblock-static-rule-limit.patch`, `chromium-ai-mode-to-orion.patch`). That route puts the Orbis panel
   beside real tabs; it does not replace the tab strip/omnibox with Orbis's.
4. The browser is roughly 13k lines of Electron-coupled main code (`src/main/browser*`, `browserControl/`,
   `extensions/`, `adblock/`) plus ~7.2k lines of browser renderer components; `BrowserPanel.tsx` alone is 3,223 lines.

## 1. Electron browser API usage in `src/main`

### 1.1 Windows and guest attachment
| Use | Where |
| --- | --- |
| Main `BrowserWindow`, hidden titlebar + overlay, `webviewTag`, sandbox preload | `index.ts:342-371` |
| Guest hardening: strip preload, force sandbox/contextIsolation, allow only partitions `persist:browser`, `orbis-private`, `persist:profile-<id>`; allow only http(s), `view-source:`, `chrome-extension://` pages | `index.ts:378-392` |
| `did-attach-webview`: fan-out to `browser.attachGuest`, `browserControl.trackGuest`, `workflowRecorder.attach`, ad-block `attachWebview` | `index.ts:393-409` |
| `setWindowOpenHandler` on guests: new-window -> new Orbis tab (disposition/features forwarded) | `index.ts:403`, `adblock/electron.ts:282` |
| Host window: external links go to `shell.openExternal`; `will-navigate` block; native `context-menu` (spellcheck suggestions) | `index.ts:410-424` |
| Pop-out `BrowserWindow` sharing `persist:browser` | `index.ts:317-337` |
| Fullscreen state relay; `window:fullscreen` | `index.ts:374-375`, `browserIntegration.ts:625` |

### 1.2 webContents (per-tab) operations
Navigation, history, title, favicon, loading, zoom, find, print, devtools, audio and UA are all driven from the
**renderer** through the `<webview>` element, not from main:

| Capability | Where |
| --- | --- |
| loadURL/goBack/goForward/reload/reloadIgnoringCache/stop/canGoBack | `BrowserPanel.tsx:850-881, 1162-1165, 1482-1492, 1946-1999` |
| Events: `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `page-favicon-updated`, `did-start/stop-loading`, `did-fail-load`, `render-process-gone`, `enter/leave-html-full-screen`, `found-in-page`, `media-started-playing/paused`, `dom-ready`, `focus` | `BrowserPanel.tsx:3134-3207` |
| Audio mute per site | `setAudioMuted` `BrowserPanel.tsx:3122,3134` |
| Zoom (`setZoomFactor`, steps) | `BrowserPanel.tsx:1324-1341, 2189` |
| Find in page (`findInPage`, `stopFindInPage`) | `BrowserPanel.tsx:1357-1364` |
| Print (`webview.print()`) | `BrowserPanel.tsx:1522`; control cap `mainCapabilities.ts:432` |
| DevTools (`openDevTools/closeDevTools/isDevToolsOpened`) | `BrowserPanel.tsx:1446-1449` |
| Per-tab UA mobile/desktop | `BrowserPanel.tsx:1173`, `useragent=` `:3217` |
| Capture page (mark-up tool) | `BrowserPanel.tsx:1371` |
| Element picker (injected `PICK_SCRIPT`) | `BrowserPanel.tsx:1388` |
| Save page (`webContents.savePage`) | `browserIntegration.ts:621` (`browser:save-page`) |
| Wheel/keyboard/mouse interception: `before-input-event` (host and guest), `before-mouse-event` (page-pointer, pointer-move for fullscreen bars) | `browserIntegration.ts:177, 191-200` |
| Swipe gesture recogniser (wheel events, precise-delta flag), `executeJavaScript` scrollable check | `browserIntegration.ts:251-308`, `gestureAdapter.ts`, `shared/historySwipe.ts` |
| Mouse back/forward (`app-command`) | `browserIntegration.ts:181` |

### 1.3 session
| Use | Where |
| --- | --- |
| Partitions: `persist:browser`, `orbis-private` (in-memory), `persist:profile-<id>` (via `session.fromPartition`) | `index.ts:339, 964, 1188-1206, 1403-1412`; `shared/profiles.ts` `partitionFor` |
| Cookies / storage / cache: `clearStorageData`, `clearCache`, `cookies.get`, `getCacheSize` | `index.ts:339-343`; `mainCapabilities.ts:714-745` |
| Downloads: `will-download`, `setSavePath`, progress/pause/cancel/resume, `downloadURL` | `browserIntegration.ts:424-449, 610`; `mainCapabilities.ts:793` |
| Permissions: `setPermissionRequestHandler`, `setPermissionCheckHandler`, per-origin remember, private never remembers | `browserIntegration.ts:450-490` |
| Device pickers: USB/HID/serial/Bluetooth (`setDevicePermissionHandler`, `select-*-device`) | `deviceChooser.ts:105-142` |
| webRequest: `onBeforeRequest`, `onHeadersReceived` (CSP), preload scripts registered per session | `adblock/electron.ts:145-160` |
| Extensions: `session.extensions.loadExtension/getExtension/removeExtension`, `serviceWorkers.*`, `registerPreloadScript` (service-worker + frame), `electron-chrome-web-store` install/update | `extensions/manager.ts:206-282, 447-481`; `bridge.ts:447` |
| Proxy: not used (no `setProxy` found in browser code) | grep |
| Widevine: castLabs Electron (`components.status()`); status exposed as `browser:protected-media` | `index.ts:1129-1131, 855` |

### 1.4 IPC channels the browser uses
Preload surface is `src/preload/index.ts` (356 lines, one `window.api`). 130 `ipcMain.handle/on` sites in
`index.ts` alone. Browser-related, by domain (full contract in `docs/ipc-mapping.md`):

- `library:*` (24): get, bookmarks add/remove/toggle, history remove/clear, searches record/remove/clear, pick record,
  downloads clear/action, reading list add/read/remove/clear-read, saved pages, screenshots keep/read/remove,
  forget-permissions. `browserIntegration.ts:537-612`.
- `browser:*`: `focus`, `watch-page-moves`, `permission-answer`, `device-answer`, `pending-devices`, `save-page`,
  `popout`, `protected-media`, `clear-data`, `clear-private`; events `browser:new-tab`, `browser:shortcut`,
  `browser:history-swipe`, `browser:download`, `browser:page-pointer(-move)`. `index.ts:853-968`, preload `:108-174`.
- `browser-sidebar:get/save/reset` (layout persistence). `browserSidebarStore.ts`.
- `adblock:*` (state, settings, site, allow-resource, remove-exception, report, update, rollback; event
  `adblock:event`). Preload `:135-147`; `index.ts:933`.
- `extensions:*` (list, set-enabled, set-pinned, remove, update, click-action, prompt-answer, report-tabs,
  window-request/answer). Preload `:182-195`.
- `control:*` (capabilities, state, execute, run-plan, run-control, runs, log, window-state, window-scope,
  window-result, confirm-answer, switches). Preload `:90-91, 215-228`.
- `omnibox:web`, `omnibox:predict` (`index.ts:835-848`); `shortcuts:*`; `profiles:*` (`personal/ipc.ts:168`);
  `default-browser:*` (`index.ts:1005-1007`); `window:fullscreen/is-fullscreen`.
- `chat:browser-target`, `chat:browser-confirm`, `automation:control` (the AI agent driving pages).

Security pattern: privileged handlers check `event.sender === mainWindow.webContents` (e.g. `index.ts:1014-1079`).
The Chromium equivalent must preserve "only the Orbis UI may call these".

## 2. The UI and the Electron state it depends on

| Component | Lines | Electron state it depends on |
| --- | ---: | --- |
| `BrowserPanel.tsx` (tabs, groups, split view, private tabs, find, zoom, pick, mark-up, print, devtools, session restore, control-layer window capabilities) | 3223 | `<webview>` element API and events; `webContentsId`; partitions; `window.api.*` |
| `UrlBar.tsx` (omnibox, suggestions, voice mic via `useVoiceInput`) | 827 | `omnibox:web/predict`, library search history |
| `BrowserSidebar.tsx`, `BrowserSidebarPanels.tsx` (tabs, library, spaces, notes, research, media, protection, Orion panels; layout in `shared/browserSidebar.ts`) | 551 + 915 | library/adblock/profile IPC; tab list from BrowserPanel |
| `BrowserLibraryPanel.tsx` (history, bookmarks, downloads, reading list, saved pages) | 235 | `library:*` |
| `TabContextMenu.tsx` | 308 | tab ops in BrowserPanel |
| `ExtensionsToolbar.tsx`, `ExtensionPrompts.tsx` | 234 + 62 | `extensions:*`, `report-tabs` |
| `BrowserOrb.tsx` (assistant entry), `DeviceChooser.tsx`, `ControlPrompts.tsx`, `ControlSwitches.tsx`, `AdBlockSection.tsx` | 435, 92, 58, 75, 242 | permission/device/control/adblock IPC |
| `App.tsx` | - | `browserOpen/browserHidden` (`:110,1015,1335,1464`), forwards `browser:*` events |

Key coupling: tab state (title, favicon, loading, back/forward, audible, mobile, private, group, split, pinned) lives
in React state in BrowserPanel and is fed by DOM events on `<webview>`. In Chromium the source of truth becomes
`TabStripModel`/`WebContents`; the React state must become a mirror.

## 3. Browser Control Layer, automation and the rest

**Control layer** (`src/main/browserControl/`, ~4.2k lines): capability registry (`registry.ts`) with
locking/safety, runner for plans (`runner.ts`), main-side caps (`mainCapabilities.ts`, 1542 lines: window, print,
cookies, cache, downloads, extensions, clipboard), page caps (`pageCapabilities.ts`), UI caps
(`uiCapabilities.ts`, drives the Orbis window itself via `sendInputEvent`), tab caps executed **in the renderer**
through `control:window-*` IPC (`window.ts`, `BrowserPanel.tsx:1946-2192`), CAPTCHA caps (`captchaCapabilities.ts`).

How it reads and acts on pages (all against a guest `webContents`, resolved by `pageCapabilities.ts:23-33`):
- Read: `executeJavaScript(SNAPSHOT_SCRIPT)` (`page.ts:376`); accessibility tree via `wc.debugger` +
  `Accessibility.getFullAXTree` (`page.ts:446-480`); screenshots via `capturePage` with `debugger`
  `Page.captureScreenshot` fallback (`pageCapabilities.ts:606-608`, `page.ts:480`).
- Act: `sendInputEvent` mouse/key/wheel/drag (`page.ts:396-433`, `pageCapabilities.ts:460`), JS injection.
- Older agent path: `browserAgent.ts` (1204 lines) uses the same primitives (`:359-362, 680-857`).
- Workflows: `workflows/recorder.ts` attaches to guests; `workflows/engine.ts` runs on the control layer.

**CAPTCHA**: `shared/captcha.ts` (pure, `detect`, thresholds `STOP_AT 0.6`, `SUSPECT_AT 0.3`) fed by page signals
collected through `page` capabilities. Pure logic ports unchanged; signal collection needs a new page-eval path.

**Ad blocker**: engine `main/adblock/blocker.ts` (Ghostery engine, per-tab stats keyed by `webContentsId`),
Electron wiring `adblock/electron.ts` (webRequest + CSP + cosmetic frame preload `preload/adblockFrame.ts`), filter
store `store.ts`. A second implementation is being built for Chromium: `src/helper/adblock/` (DNR conversion,
`dnr.ts`, `build.ts`) and `patches/chromium-adblock-static-rule-limit.patch`.

**Downloads / history / bookmarks**: Orbis keeps its own JSON store (`browserLibrary.ts`, 513 lines) fed by
`will-download` and navigation events, not Chromium's.

**Extensions**: `extensions/manager.ts` + `bridge.ts` (822 lines) emulate the Chrome extension APIs Electron lacks
(tabs, windows, action) on top of `electron-chrome-web-store`, with `preload/extensionApis.ts` shims.

**Profiles / private**: partition per profile (`shared/profiles.ts`), `orbis-private` in-memory partition wiped when
last private tab closes (`index.ts:963`, `BrowserPanel.tsx:554`).

**Settings**: `store.ts`, `settings:get/update`; per-profile keys in localStorage for tabs/groups
(`BrowserPanel.tsx:270-300`).

**Voice/whisper in the browser**: local Whisper (`main/whisper/*`, Node, no Electron browser API) used by the URL bar
mic (`UrlBar.tsx:212, 384`, `hooks/useVoiceInput.ts`). The only browser-specific need is microphone permission and
recording in the UI surface; portable to the helper (already listed in `chromium-sidepanel-plan.md`).

## 4. Central unresolved problem: hosting Orbis's React UI as the chrome

Orbis's tab strip, sidebar, omnibox and modes are React in the renderer, wrapped around `<webview>`s. Chromium has no
`<webview>` in a top-level browser window; its browser chrome is native Views (Windows) and WebUI for panels. Options:

| Option | What it is | Pros | Cons / risk |
| --- | --- | --- | --- |
| A. Side panel + extension + helper (in progress) | Real Chromium chrome; Orbis React in side panel / new-tab / WebUI-ish pages | Cheapest, low patch surface, real sign-in and native swipe, already partly built | Orbis tab strip, sidebar, omnibox, window layout and any "modes" are NOT reproduced; Orbis UI is confined to a panel |
| B. Patch Chromium browser UI to load Orbis WebUI (`chrome://orbis`, WebUIController + Mojo) as the toolbar/tab-strip replacement (Chromium already ships WebUI tab strip for touch: `webui_tab_strip`, plus WebUI toolbars via `WebUIToolbarWebView`/`WebView` in Views) | Real `TabStripModel`/`WebContents`; Orbis renders chrome via Mojo mirrors of tab state | Large, ongoing Chromium patch and rebase cost on every milestone; Views layout patching for a full custom chrome; highest fidelity |
| C. Content-shell-style embedder (own `content::ContentMainDelegate`, own window, Orbis React in a WebContents plus tab WebContents overlaid) | Full control of layout/modes, smaller than chrome/ | Loses Chrome features Orbis wants for free: extensions system, sync, sign-in, downloads UI, password manager, PDF viewer, Widevine plumbing, safe browsing; reimplements a browser | Effectively writing a browser; months; parity with today's Chrome features is the risk |
| D. Native window reparenting (Orbis Electron/other shell hosts `chrome.exe` HWNDs via `SetParent`) | Keep Orbis UI as is; embed Chromium window per tab | Fastest visual demo | Not viable as a product: a `chrome.exe` window is a whole browser (own tabs), one HWND per browser not per tab; focus, DPI, IME, DWM/occlusion, accessibility and input routing are broken by design; Chromium does not support it (inferred); no per-tab control; also keeps Electron |

Honest assessment: B is the only option that yields "the Orbis UI is the browser chrome around real Chromium tabs"
without re-writing a browser, and it is also the most expensive to maintain. A is the pragmatic near-term path and is
already underway. C is a fallback if B's patch surface proves unmaintainable. D should not be pursued.
Whether B can render Orbis's existing React unchanged is (inferred) plausible: WebUI pages are ordinary web content
with `chrome://` privileges, so the bundle can load, but every `window.api` call must be re-plumbed to Mojo or a
WebUI message handler (96+ channels).

## 5. Capability mapping (Phase 2)

Difficulty: E easy, M medium, H hard, X not feasible as-is.

| Capability | Electron implementation (file) | Chromium equivalent | Needs Chromium patch? | Diff. |
| --- | --- | --- | --- | --- |
| Tabs/tab strip/groups/split | `<webview>` per tab, React state (`BrowserPanel.tsx`) | `TabStripModel`, tab groups, split view (Chromium 154 has side-by-side) | Yes for Orbis-drawn strip (B/C); No if native strip kept (A) | H |
| Navigation, back/fwd, reload, stop | webview methods (`BrowserPanel.tsx:850-1492`) | `NavigationController` / native toolbar; CDP `Page.navigate` for control | No (A) / Yes (B) | E-M |
| Title/favicon/loading events | webview events (`:3134-3207`) | `WebContentsObserver`; `chrome.tabs.onUpdated` in extension | No (A) / Mojo mirror (B) | M |
| Two-finger swipe back/forward (required) | `historySwipe.ts`, `gestureAdapter.ts`, `before-input-event` | Native `OverscrollController` history navigation (default on in Chromium) | No | E (needs hardware verification) |
| Zoom | `setZoomFactor` | `HostZoomMap`; `chrome.tabs.setZoom` | No | E |
| Find in page | `findInPage` | Native find bar / `FindTabHelper`; CDP not needed | No (native UI); Yes to drive Orbis find UI | M |
| Print, save page | `print()`, `savePage` (`browserIntegration.ts:621`) | Native print preview, `SavePackage`; `chrome.tabs`/CDP `Page.printToPDF` | No | E |
| DevTools | `openDevTools` | Native DevTools | No | E |
| Audio mute/audible | `setAudioMuted`, media events | Native tab audio indicator/mute; `chrome.tabs.update({muted})`, `tab.audible` | No | E |
| Per-tab mobile UA | `setUserAgent` + reload | CDP `Emulation.setUserAgentOverride`+device metrics; extension DNR header rule | No | M |
| Context menus | `context-menu` on host only; page menus native | Native | No | E |
| Permissions prompts, remember/forget | `setPermissionRequestHandler` (`browserIntegration.ts:450`) | `PermissionManager` + native prompts; Orbis-styled prompt would need patch | Yes only to restyle | M |
| Device choosers | `deviceChooser.ts` | Native chooser | No (restyle needs patch) | E |
| Downloads | `will-download` + own store (`:424`) | `DownloadManager`/`DownloadCoreService`; `chrome.downloads` API in extension | No (A), Yes for Orbis-styled shelf | M |
| History / bookmarks / reading list | `browserLibrary.ts` own JSON | `HistoryService`, `BookmarkModel`, reading list; `chrome.history/bookmarks` | No (A); migration importer needed | M |
| Cookies/cache/clear data | `session.clearStorageData` etc. | `BrowsingDataRemover`; `chrome.browsingData`; CDP `Storage.*` | No | E |
| Private tabs | `orbis-private` in-memory partition | Incognito `Profile` (OTR) window | No for native incognito window; Orbis's "private tab inside a normal window" is not a Chromium concept | H |
| Profiles | `persist:profile-<id>` partitions | Chromium `Profile` (`--profile-directory`, `ProfileManager`) | Yes to make Orbis's switcher own it; else native picker | H |
| Ad blocking | `@ghostery/adblocker-electron`, `webRequest` (`adblock/electron.ts`) | DNR via extension (`src/helper/adblock/`); MV3 static rule limit | Yes (`chromium-adblock-static-rule-limit.patch`); cosmetic/scriptlets via content script | H |
| Extensions | `electron-chrome-web-store` + bridge (`extensions/*`) | Chromium's real extension system | No; Web Store install unavailable to non-Chrome branded builds (fetch CRX directly, as today) | M |
| Widevine | castLabs Electron | Own CDM licence + VMP signing | Build/licence, not code | X until licence |
| Browser Control Layer: read | `executeJavaScript`, `debugger` AX tree (`page.ts`) | CDP over `--remote-debugging-pipe` (`Runtime.evaluate`, `Accessibility.getFullAXTree`) | No | M |
| Control: screenshots | `capturePage`, debugger fallback | CDP `Page.captureScreenshot` | No | E |
| Control: input | `sendInputEvent` (`page.ts:396-433`) | CDP `Input.dispatchMouseEvent/KeyEvent` (trusted events) | No | M |
| Control: tab/window ops (from renderer state) | IPC to React (`window.ts`) | CDP `Target.*` + browser-side commands; extension `chrome.tabs/windows` | Possibly a small native command surface | M-H |
| CAPTCHA detection | `shared/captcha.ts` + page signals | Same logic; signals via CDP evaluate | No | E |
| Workflow recording | `workflows/recorder.ts` on guests | CDP `DOMDebugger`/injected script via extension content script | No | M |
| Orbis-drawn omnibox/suggestions | `UrlBar.tsx`, `omnibox:*` | Native omnibox (customisable providers) or Orbis WebUI | Yes for Orbis omnibox in chrome | H |
| Chat/Orion/Search/memory/skills/notes/whisper | portable Node in `src/main` | Helper process (`src/helper`), side panel | No | E-M |
| Shortcuts (browser keys) | `browserShortcuts.ts` via `before-input-event` | Chromium accelerators (native), custom via `commands` in extension | Yes for custom global | M |
| Default browser registration | `defaultBrowser.ts` | Installer + registry (Chromium `install_static`) | Packaging | M |
| Auto-update | `main/update/*` | Own updater; Omaha/none | Packaging | M |
| Sign-in to Google sites | blocked in webview sometimes | Works in real Chromium (unproven; test early) | No | E |
| Browser size modes (Full/Large/Medium/Small/Custom) | Not implemented (see 0.2) | Window bounds / side panel widths | New work | - |
| Sync | none in Orbis | Chromium Sync needs Google keys | Not planned | X |

## 6. Recommended phased plan (riskiest first)

**Phase 3a: risk spikes (2-3 weeks, throw-away where noted)**
1. **Chrome-hosting spike (B vs C).** In a scratch branch of `C:\chromium\src`, register a `chrome://orbis` WebUI that
   loads the built Orbis renderer, show it in a toolbar-sized `WebView` above the tab strip area, and round-trip one
   Mojo call (tab list mirror + "new tab"). Decision gate: patch size, rebase cost onto 154.x, and whether the React
   bundle loads with `window.api` shimmed. This is the single highest-risk item; do it first.
2. **CDP control spike.** Launch `chrome.exe --remote-debugging-pipe --user-data-dir=...`, implement
   evaluate / AX tree / screenshot / trusted click+type+wheel from Node against one tab. Confirms the control layer
   port is mechanical and no patch is needed.
3. **Swipe and sign-in on hardware.** Verify native precision-touchpad swipe and Google sign-in on the built binary
   (both are stated requirements).

**Phase 3b: ship the side-panel route (already started)**: extension + helper + ad-block DNR patch; migrate
Orion/search/notes/voice to the helper. This yields a usable product regardless of spike outcome.

**Phase 4: browser features on native Chromium.** Downloads, history, bookmarks import from Orbis JSON, permissions,
profiles, incognito, extensions (real system), find/zoom/print/devtools (all native, delete Orbis code).

**Phase 5: control layer on CDP** (port `browserControl/` primitives; tab/window ops via CDP `Target` + extension).
Keep `registry.ts`, `runner.ts`, `shared/captcha.ts`, workflows unchanged; replace `PageHandle` implementation only
(`page.ts` already isolates it via `asPageHandle`).

**Phase 6: Orbis chrome (only if the spike says B is affordable)**: Orbis tab strip, sidebar, omnibox as WebUI, with
sizes/modes designed as new features. Otherwise keep native chrome plus side panel.

**Phase 7: remove Electron**; Widevine licence in parallel from day one (long lead).

## 7. Risks and hard/not-feasible items

- Orbis-drawn full chrome around real tabs requires patching Chromium (B) or writing a browser shell (C); there is no
  supported embedding of a `chrome.exe` tab in another app (D). Cost is ongoing, every milestone rebase.
- Private tabs mixed into a normal window and per-tab partitions have no direct Chromium analogue.
- Widevine and Web Store install are licensing problems, not engineering ones.
- MV3 limits the ad blocker (static rule cap; already patched), no `webRequestBlocking` for non-enterprise.
- `executeJavaScript`-style page eval becomes async CDP with isolated worlds; timing and trust semantics differ.
- Removing Orbis's own history/bookmarks/downloads store means a one-time migration and losing Orbis-specific
  fields (reading list, saved pages, screenshots) unless kept in the helper.
- The 96 IPC channels (`docs/ipc-mapping.md`) all need a new transport; per-domain migration with probes re-run.
