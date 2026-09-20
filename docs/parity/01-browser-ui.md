# Parity 01: Browser UI baseline (Electron Orbis today)

Purpose: the functional baseline of the existing Electron-based Orbis browser UI, for the migration to the Chromium 154.0.8037.44 build.
Method: read-only audit of the code. Nothing was run; behavior is inferred from source. "(uncertain)" marks claims not fully verified. Line numbers are approximate to within a few lines where a range is given.

Abbreviations: BP = `src/renderer/src/components/BrowserPanel.tsx`. UB = `src/renderer/src/components/UrlBar.tsx`. BI = `src/main/browserIntegration.ts`. BS = `src/main/browserShortcuts.ts`. IDX = `src/main/index.ts`. TCM = `TabContextMenu.tsx`. BLP = `BrowserLibraryPanel.tsx`. BSP = `BrowserSidebarPanels.tsx`. Chromium column: native (Chromium already has it), needs-UI (Orbis UI work on top of the build), needs-patch (Chromium source patch).

## 0. Architecture facts that shape everything

- The whole browser chrome is React inside the Orbis window; pages are `<webview>` guests (BP:3112 `TabView`; tag at the end of the file). One webview per tab; `partition` is the profile session (`persist:browser` or `persist:profile-*`) or `orbis-private` for private tabs (BP:257). Guest hardening is in `will-attach-webview` (IDX:378-392).
- The address bar is NOT in BrowserPanel. `UrlBar` is mounted once in `App.tsx:1339`, above the header, and is the only address bar. BP reports the active page through `onPageChange` and focuses the bar through a DOM event `orbis:focus-url` (BP:239, UB:291).
- Layout modes: only ONE mode really exists, `full`. BP hard-codes `data-mode="full"` (BP:2437); `App.tsx:1214` reports `mode: browserOpen ? 'full' : null`. The type `'full' | 'window' | 'dock'` (`src/shared/browserControl.ts:323`) is aspirational; no window or dock layout code was found. Related real behaviors: hide-to-chat (`hidden` prop, "Chat" button BP:~2640, `inert`), pop-out into a separate BrowserWindow (IDX:316-338), split view of two tabs (BP:1197), and an F11 "immersive" mode where the tab and address bars tuck above the top edge (BP:2412-2448).
- In the Chromium build, tab strip, omnibox and menus come from Chromium's own UI. Orbis features layered on top (Ask Orion, sidebar panels, Workflows, Orbis Search/Galaxy pages, widgets) need to be re-hosted.

## 1. Tab strip

Owner: BP (state 242-258, 939-1290, render 2470-2625). Context menu: TCM. Session persistence: BP:268-320.

| Item | Current behavior | Electron API | Chromium equivalent |
|---|---|---|---|
| Create | `addTab` (BP:~500) appends or inserts at an index (pinned stay in front) and activates; `openTab(url, activate, private)` BP:520. "+" button BP:2621; Ctrl+T (BP:1459). Page links arrive via `browser:new-tab` IPC (BP:544, BI:311-316). | webview, `will-attach-webview`, `setWindowOpenHandler` (IDX:403) | native. Orbis new-tab page already patched (commit 5bb4c1d). |
| Close | `closeTab` BP:944; middle-click (BP:2543), X button, Ctrl+W / Ctrl+F4, Delete on a focused tab. Closing the last tab calls `onClose` (closes the browser). Closed tabs kept (max 25, non-private) for reopen. | none | native |
| Switch | click; Ctrl+Tab/PgDn, Ctrl+Shift+Tab/PgUp, Ctrl+1..8, Ctrl+9 = last (BP:1469-1476); arrows/Home/End on the tablist (BP:2570-2578). Focus goes to the page, or the address bar for a blank tab (BP:939). | `webview.focus` | native |
| Reorder / drag | HTML5 drag inside the strip (BP:2547-2565), `moveTab` BP:965; Ctrl+Shift+PgUp/PgDn (repeatable); menu "Move to start/end". No drag-out tear-off; menu "Move to new window" instead (BP:1237, `popOutBrowser`). | HTML5 DnD | native (drag and tear-off) |
| Pin | Menu item; pinned tabs gather at the front, hide audio/private icons, are skipped by close-others/close-right (BP:1183). Compact pinned styling not verified (uncertain; CSS `.pinned` in `styles.css`). | none | native |
| Mute | Per-SITE mute (host list `mutedHosts`, BP:1260) applied with `setAudioMuted` on every dom-ready (BP:3117-3138). Icons VolumeX/Volume2 (BP:2532). Extensions can mute a tab (BP:680). | `webview.setAudioMuted` | native ("Mute site") |
| Audio indicator | `media-started-playing` / `media-paused` set `audible` (BP:3131-3132); navigation clears it. | webview events | native |
| Groups | Named, colored (7 colors, BP:1006), collapsible chips; rename by double-click or F2; ungroup; move group as a block (BP:1008-1090). Saved with the session by URL (BP:1003, 303-318). | none | native tab groups (color palette differs) |
| Duplicate | Menu item (BP:1249) inserts a copy after the tab, keeps custom title/icon/group/pin/mobile. | none | native (custom title/icon lost) |
| Restore closed | Ctrl+Shift+T (BP:1467, `reopenTab` BP:954) restores at the old index; menu and library tab "Closed tabs". "Restore last session (N tabs)" (BP:~2717) and new-tab button "Restore N tabs from last time" (BP:~3050) use localStorage `orbis.browser.session` (max 20 URLs). | localStorage | native (Ctrl+Shift+T, startup setting) |
| Private tabs | Ctrl+Shift+N inside the browser (BS comment; BP:1461). `private: true`, in-memory session `orbis-private`, HatGlasses icon (BP:2529); never in history, closed list, session or groups (BP:1003). Data cleared when the last private tab closes (BP:712-717 -> `browser:clear-private`, IDX:963). New-tab page shows a private note. Suggestions off (App.tsx:1349). Private tabs cannot move to another window (TCM:142). | partition, `session.isPersistent()` (BI:203) | needs-patch: Chromium Incognito is a separate window, not a private tab in a normal window. Product decision needed. |
| Favicons | `page-favicon-updated`, first favicon (BP:3195), Globe fallback; broken image resets (BP:2521). Custom emoji icon overrides. Omnibox suggestion icons use `<origin>/favicon.ico` (UB:135-145). | webview event | native; custom emoji icon needs-patch |
| Loading | Spinner replaces favicon while `loading` (BP:2515); from `did-start-loading` / `did-stop-loading` (BP:3199-3200). | webview events | native |
| Title | `page-title-updated`; user override `customTitle` via "Edit name and icon" (TCM:208, `TabEditDialog`). Default "New tab" / "Private tab". | webview event | native title; custom name/emoji needs-patch |
| Split view | Two tabs side by side with a divider and close button (BP:1197, 2985). | webview layout | Chromium has split view in recent milestones (uncertain for 154 flag state) |
| Crash | `render-process-gone` sets `crashed`, error view with "Reload tab" (BP:3170, 3010). | webview event | native (sad tab) |
| Mobile view | Per-tab toggle sets an iPhone UA and reloads (BP:1147, 2664; `MOBILE_UA` BP:190). | `setUserAgent` | needs-UI (DevTools emulation only) |
| Offline page | Non-HTTP load failures show `OfflineGames` (BP:2993-3008, `classifyLoadFailure`). | `did-fail-load` | needs-patch (net-error page) |
| A11y | role tablist/tab with aria labels (BP:2469, 2528). | | native |

## 2. Unified address / search bar (UB)

Doc comment UB:188-193. Draft text is kept per tab (UB:236, 258-284). Settings gates: `searchSuggestions`, `personalizedSuggestions` (SettingsModal.tsx:126-141).

- Suggestion sources (`src/shared/omnibox.ts`, `buildSuggestions` line 288): typed address or default query item (319-326); browsing history by frecency (333); past searches (340); bookmarks (344); Orion research questions (350); search-engine suggestions `window.api.webSuggestions` (UB:132, 90 ms debounce); Orion predictions `window.api.predictQueries` (UB:133, 450 ms, min 3 chars, IDX:850); "site" search items (373); vertical shortcuts news/images/videos/shopping (379). Empty bar shows sections Recent searches / Recently visited / Frequently visited / Researched with Orion / Bookmarks (`recentSuggestions`, 388-421). Learned picks boost ranking (`recordSuggestionPick`, UB:355). Max 8 items. Incognito or personalization off disables history/search/bookmark/research sources.
- Enter: opens the selected or top suggestion, or the typed text, in the current tab (`submit`, UB:369). Alt+Enter: new tab (UB:246). Ctrl+Enter: sends the text to Orion; the answer overlays the browser (`askOrion` UB:396, `OrionAnswer.tsx`). Shift+Enter: opens in the system default browser through `shell.openExternal` (`openInDefaultBrowser` UB:406, IDX:779). Commit 3c05396 already patches Shift+Enter in the Chromium build.
- Inline autocomplete: top item's completion is filled and selected (UB:331-338); Tab accepts (UB:249); suppressed right after deleting (UB:220, 642). Arrows cycle (UB:232); Shift+Delete removes a history/search suggestion (UB:254); Escape steps back, then closes (UB:257).
- Search provider: default is Orbis Search (`searchDestination`, `src/shared/orbisSearch.ts:100`, used by `toUrl` omnibox.ts:95-102) at an internal `orbis://` page. Bangs (`!g`, `!yt`) route to third parties (orbisSearch.ts:67-102). `searchUrl` (omnibox.ts:84) builds Google URLs for verticals. The page context menu "Search Google for" uses Google directly (BI:~388). Which endpoint main uses for web suggestions is not confirmed (uncertain). Specialized categories: `src/shared/searchProviders.ts`.
- Address detection: `isAddress` omnibox.ts:75; local hosts get http; TLD guard (`node.js` is a search).
- Paste: no custom paste handler in UB (grep found none), so plain input paste triggers the change handler. No "paste and go".
- Voice input: mic button (UB, `useVoiceInput('url-bar')` UB:212; hook `src/renderer/src/hooks/useVoiceInput.ts`; logic `src/shared/voiceInput.ts`, `src/renderer/src/lib/voiceInput.ts`). Transcribes locally with whisper (SettingsModal.tsx:163); only inserts words into the bar (UB:383-393). Push-to-talk Ctrl+Shift+M (App.tsx:1253).
- Decorations: lock icon or "Not secure" (`secure`, UB:341), loading spinner, Copy address, Summarize this page (`summarizePage` UB:414, reads the page through the `orbis:read-page` event, BP:~760), bookmark star (Ctrl+D), Workflows quick panel with running/recording badge (`WorkflowQuickPanel`), "back to browser" chip.
- Focus shortcuts: Ctrl+L, Ctrl+E, Alt+D, F6 (BS); Ctrl+E is also global (App.tsx:1229).
- Electron APIs: IPC (`window.api.*`), `shell.openExternal`.
- Chromium: omnibox core (autocomplete, history, bookmarks, search suggest, security chip, star, paste, Alt+Enter) is native. Needs-patch: default provider to Orbis Search, `orbis://` scheme, Ctrl+Enter Ask Orion, Orion prediction and research providers, learned-pick ranking, Summarize, Workflows and mic buttons. `!bang` maps to native keyword engines (needs-UI config).

## 3. Navigation controls

Owner: BP:2450-2469 (`browser-nav`), `goBack`/`goForward` BP:850-860, `reloadTab` BP:1141, loading bar BP:2915.
- Back/Forward buttons are disabled from `back`/`forward` flags refreshed on did-navigate and did-stop-loading (BP:3178, 3200). Orbis pages (Orbis Search, Galaxy) keep their own history trail (`stepOrbisHistory`, BP:~830-848).
- Reload/Stop share one button (BP:2462). F5, Ctrl+R reload; Ctrl+Shift+R, Ctrl+F5, Shift+F5 hard reload (`reloadIgnoringCache`, BP:1150); Esc stops (also passes to the page). Reloading a crashed tab restarts it.
- Loading bar: thin `browser-loading-bar` while loading (BP:2915).
- Alt+Left/Right, BrowserBack/Forward keys and mouse back/forward buttons (`app-command`, BI:184-188).
- Two-finger trackpad history swipe: rules in `src/shared/historySwipe.ts` (activation 60 px, commit 140 px, horizontal ratio 2, max vertical drift 70), recognizer in BI:230-310 on `before-mouse-event`, adapter `src/main/gestureAdapter.ts`, overlay `browser-swipe` (BP:2891). Memory notes say swipe must work in the Chromium build.
- Chromium: back/forward/reload/stop and loading indicator native. Swipe: Windows Chromium supports overscroll history navigation; precision-touchpad behavior is uncertain and must be verified, possibly patched.

## 4. New-tab page and new-window behavior

- New tab page: drawn by BP (`browser-newtab`, BP:3020-3080) whenever `!hasPage`. Contents: Orbis orb/logo (`OrbisMark` size 92, BP:3027) that focuses the address bar; private-tab note; hint "Type a URL or search in the bar above" (BP:3036); `ShortcutsGrid` (max 24 site tiles, add/edit/remove, icon refresh, `ShortcutsGrid.tsx:7`); optional widgets (`widgets/WidgetHost.tsx:137`, hidden in private tabs) and wallpaper (BP:3025); "Restore N tabs from last time"; quick links Google, YouTube, GitHub, Wikipedia (BP:195-200). Personalization = shortcuts + widgets + wallpaper (`src/main/experience/`). Assets: `src/renderer/src/assets/orbis-logo.png`, `orbis-ring*.png`.
- New window: no "new window" command exists (Ctrl+N is New Chat; RESERVED in BS). Windows come from `popOutBrowser` (IDX:316-338): 1100x800, `persist:browser`, no preload, sandboxed, http(s) only, in-window links navigate in place. Triggers: pop-out button (BP:~2672), tab menu "Move to new window", context "Open link in new window" (BI:341), Shift+click (`openFromPage`, BI:313). The pop-out has no tab strip or toolbar (plain BrowserWindow with `loadURL`; inferred).
- Popups: `window.open` becomes a tab; ad popups blocked (IDX:403-409, adblock).
- Chromium: new tab/window native. Orbis NTP override already patched (5bb4c1d); shortcuts grid, widgets, wallpaper, restore-last-time and quick links must be confirmed on that page (needs-UI). Ctrl+N conflict needs a decision.

## 5. The three-dot menu (BP:2652-2760)

In order: (1) Ad-blocking section (`AdBlockSection.tsx`: Standard / Strict / Custom, per-site, counts; lines 25-28); (2) Screenshot and mark up (`markup` BP:1367, opens `ImageEditor`); (3) Pick an element to ask Orbis (`pick` BP:1379); (4) Mobile view toggle; (5) Open in default browser (`openExternal`); (6) Copy link; (7) Bookmark this page (Ctrl+D); (8) Bookmarks (Ctrl+Shift+B); (9) History (Ctrl+H); (10) Downloads (Ctrl+J); (11) Recently closed tabs (Ctrl+Shift+T); (12) Restore last session (only when there is something to restore); (13) Find in page (Ctrl+F); (14) Print (Ctrl+P, `webview.print`); (15) Save page as (Ctrl+S, `browser:save-page` BI:621, HTMLComplete); (16) View page source (Ctrl+U, opens a `view-source:` tab); (17) Fullscreen (F11); (18) Zoom row with minus, percent (reset), plus (BP:~2775); (19) Developer tools (F12); (20) Clear browsing data (`clearBrowsingData` IDX:~347: cookies, storage, cache, history, searches, permissions; keeps bookmarks and downloads).
Other header buttons: "Chat" (back to chat, BP:~2640), sidebar toggle, ExtensionsToolbar, Pop out.
- Chromium: native menu covers 7-11, 13-19 and Clear browsing data (Ctrl+Shift+Del). Orbis-only entries (ad-block, markup, pick element, default-browser hand-off, Chat) are needs-UI (toolbar buttons or side panel) or needs-patch (menu entries).

## 6. Sidebar and assistant panels

- `src/shared/browserSidebar.ts` `PANELS` (lines ~60-100). Panels: tabs, tabGroups, bookmarks, history, downloads, readingList, savedPages, workspaces, profiles, extensions, research, sources, galaxy, notes, tasks, reminders, clipboard, whiteboard, screenshots, media, privacy, adblock, tracking, controls, workflows, secrets, orion, customize. Layout (groups, hidden, pinned, icon/label mode, width, open) is stored per profile in main (`browserSidebarStore.ts`, IPC `browser-sidebar:get/save/reset`, BP:~365-380). Rendering: `BrowserSidebar.tsx`; panels in BSP (`SidebarPanel` switch, BSP:834-905); toggle `SidebarToggle`.
- Individual panels: Tabs (BSP:130; search, switch, close, reopen), Tab groups (202), Reading list (268; `setReadingListRead`, `removeFromReadingList`), Saved pages (345; offline copies), Screenshots (376), Research (462), Sources (493), Galaxy (536), Extensions (587), Media (646), Privacy (682), Controls (746; Browser Control switches), Orion assistant (778; `sendChat` with `browserTask: true`, BP:~2400-2420). Bookmarks/History/Downloads reuse the library UI (BSP:843-861).
- On-page assistant: `BrowserOrb.tsx` (BP:~2915), agent banner "Orbis is using this tab" with Pause/Stop (BP:~2627), `StepRunPanel`.
- Chromium: native Side panel has Bookmarks, Reading list, History, Customize Chrome. Orbis panels (Orion, Research, Notes, Tasks, Whiteboard, Galaxy, Workflows, Secrets ...) are needs-UI (host in a side panel as WebUI/extension). The assistant link to the page needs the Browser Control adapter (present, commit 32d3ab1). Saved pages panel needs-UI.

## 7. Keyboard shortcuts (complete)

One table: `src/main/browserShortcuts.ts` lines ~96-137, matched in main on `before-input-event` (BI:172-195), only while the browser has focus; automated key input is excluded (BS:150-166). Renderer handler `runShortcut`: BP:1455-1535. Never taken (RESERVED, BS:79): Ctrl+Shift+O, Ctrl+B, Ctrl+`,`, Ctrl+N, Ctrl+Q, Ctrl+Z, Ctrl+Shift+Z, Ctrl+X, Ctrl+C, Ctrl+V, Ctrl+Shift+I, Ctrl+K. Cmd is treated as Ctrl.

| Action | Keys | Notes |
|---|---|---|
| New tab | Ctrl+T | |
| New private tab | Ctrl+Shift+N | only inside the browser; elsewhere Orbis incognito chat (App.tsx:1220) |
| Close tab | Ctrl+W, Ctrl+F4 | |
| Reopen tab | Ctrl+Shift+T | |
| Next tab | Ctrl+Tab, Ctrl+PageDown | repeats |
| Previous tab | Ctrl+Shift+Tab, Ctrl+PageUp | repeats |
| Select tab 1-8 | Ctrl+1 ... Ctrl+8 | |
| Last tab | Ctrl+9 | |
| Move tab left / right | Ctrl+Shift+PageUp / PageDown | repeats |
| Back / Forward | Alt+Left / Alt+Right, BrowserBack / BrowserForward | plus mouse buttons |
| Reload | Ctrl+R, F5, BrowserRefresh | |
| Hard reload | Ctrl+Shift+R, Ctrl+F5, Shift+F5 | |
| Stop | Esc | key still reaches the page |
| Focus address bar | Ctrl+L, Ctrl+E, Alt+D, F6 | |
| Find | Ctrl+F | |
| Find next / previous | F3, Ctrl+G / Shift+F3, Ctrl+Shift+G | repeats |
| Zoom in | Ctrl+=, Ctrl++, Ctrl+Shift+=, Ctrl+Shift++ | repeats |
| Zoom out | Ctrl+-, Ctrl+Shift+-, Ctrl+_ | repeats |
| Zoom reset | Ctrl+0 | |
| Fullscreen | F11 | |
| History / Downloads | Ctrl+H / Ctrl+J | toggle in-window library |
| Bookmark / bookmark all tabs / bookmarks | Ctrl+D / Ctrl+Shift+D / Ctrl+Shift+B | |
| Print / Save page / View source | Ctrl+P / Ctrl+S / Ctrl+U | |
| DevTools | F12 | Ctrl+Shift+I is the app menu's (IDX:1153) |

Other shortcuts touching the browser: Ctrl+Shift+O new chat, Ctrl+B sidebar, Ctrl+`,` settings, Ctrl+K search chats, Ctrl+E address bar, Ctrl+Shift+M push-to-talk (App.tsx:1216-1265). Address bar keys: Alt+Enter, Ctrl+Enter, Shift+Enter, Tab, Shift+Delete, arrows, Esc (UB:640-670). App menu accelerators: Ctrl+N New Chat, Ctrl+Q, Ctrl+R (outside browser), undo/redo/cut/copy/paste, Ctrl+Shift+I (IDX:1135-1160).
- Chromium: nearly all are native with the same keys. Conflicts to resolve: Ctrl+N (new window vs New Chat), Ctrl+Shift+N (Incognito window vs private tab), Ctrl+E, Ctrl+K, Ctrl+B, Ctrl+Shift+O, Ctrl+Shift+M, Ctrl+`,`. Ctrl+H/J open chrome://history and chrome://downloads instead of the in-window library.

## 8. Find in page, zoom, fullscreen

- Find: bar `browser-find` (BP:2795-2830), Enter / Shift+Enter, prev/next, "n/m" count, Esc closes; `webview.findInPage` (note in BP:1356 that Electron's `findNext` means "start a new find"); `found-in-page` event (BP:3203). Chromium: native find bar.
- Zoom: steps 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2 (BP:194); per-host memory in localStorage `orbis.browser.zoom` (BP:272-297), applied on navigation (BP:1331); menu shows percent. Chromium: native per-origin zoom.
- Fullscreen: F11 toggles WINDOW fullscreen through `window:fullscreen` IPC (BI:625, BP:1409); HTML fullscreen (`enter-html-full-screen`, BP:3168) fills the window; in window fullscreen the bars hide and reveal at the top edge (BP:2412, `watchPagePointerMoves` BI:534). `fullscreen` permission always granted (BI:31). Chromium: native.

## 9. Context menus

- Page menu: `BI.contextMenu` (BI:320-400), native `Menu.popup`. Link: Open link in new tab / background tab / new window, Copy link address, Save link as. Image: Open image in new tab, Copy image, Copy image address, Save image as. Video/audio: Save as, Copy address. Editable: spelling suggestions, Undo, Redo, Cut, Copy, Paste, Select all. Selection: Copy, "Search Google for" (Google directly, not Orbis Search). Blank page: Back, Forward, Reload, Save page as, Print, View page source. Extension items appended. Always "Inspect". The Orbis window's own menu is IDX:420-442 (spellcheck, cut/copy/paste, Copy link).
- Tab menu (TCM:19-34, 190-240): Pin/Unpin; Bookmark tab; Copy link; Edit name and icon; Reload; Duplicate; Mute site; Close; Close others; Close tabs to the right; Add to new group / existing group / Ungroup; Move to start / end / new window; Split view / Close split.
- Chromium: all native. "Search Google for" becomes the default engine. Edit name and icon and Split entries need patches. No "Ask Orion about selection" exists today.

## 10. Downloads, history, bookmarks, reading list

- Downloads: `session.on('will-download')` (BI:424-447) saves into the Downloads folder with unique names, state in `browserLibrary.ts`; toasts BP:783-790; list UI BLP:163-215 (Open, Show in folder, Pause, Resume, Cancel, Clear); count badge BP:369-378. No save-as prompt, no shelf/bubble. Chromium: native download bubble and chrome://downloads.
- History: `library.visit` / `retitle` on navigation (BI:204-212), skipped for private sessions; library tab with search, remove, clear (BLP:117-140); sidebar panel. Chromium: native. Migrating existing Orbis history data is not covered (uncertain).
- Bookmarks: `toggleBookmark` (BP:1418), bookmark all tabs (BP:1424), URL bar star, tab menu; library tab with search and remove (BLP:144-160); folders in the sidebar panel. Chromium: native. Sign-in is removed per memory notes, so no sync.
- Reading list and saved pages: stored in the library snapshot; UI only in the sidebar (BSP:268, 345). Chromium: native reading list; saved pages needs-UI.

## 11. Permission prompts and device chooser

- Handler `setPermissionRequestHandler` (BI:450-478): `fullscreen` and `clipboard-sanitized-write` always allowed; askable: media (camera/mic), geolocation, notifications, midi, clipboard-read, display-capture, pointerLock, keyboardLock, idle-detection, window-management, storage-access (BI:37-49); everything else denied. Answers can be remembered per origin (persistent sessions only); 2-minute timeout denies; only tabs hosted in the main window can prompt (pop-outs deny).
- Prompt UI: `browser-permission` alertdialog with Remember checkbox, Block, Allow (BP:~2885-2905). Device chooser for usb/hid/serial: `DeviceChooser.tsx`, `src/main/deviceChooser.ts`, IPC `browser:device-answer`.
- Chromium: native permission bubbles, site settings and device choosers.

## 12. Settings screens for the browser

- SettingsModal.tsx: Web search suggestions (126), Personalized suggestions (134), Open browser on launch (144), Default browser (`DefaultBrowserSetting` 275; `defaultBrowserState`, `requestDefaultBrowser`), Voice model (163), Offline games (`OfflineGamesSettings.tsx`), Updates (`UpdateSettings.tsx`).
- Elsewhere: Ad blocking (menu `AdBlockSection.tsx`, sidebar adblock/tracking), Privacy panel (BSP:682), Profiles (`ProfilesView.tsx`), Customize (`CustomizeView.tsx`), sidebar arrangement.
- Profiles: separate cookies by partition; switching (`onProfileChanged`) swaps that profile's tabs (BP:~530).
- Chromium: chrome://settings covers search engine, on-startup, default browser, privacy, downloads, profiles. Orbis toggles need preference plumbing (needs-patch).

## 13. Extensions UI

- `ExtensionsToolbar.tsx` (icons, pin, on/off switch, per-extension menu, popup host), `ExtensionPrompts.tsx` (install and permission prompts, `main/extensions/manager.ts:346-358`), sidebar Extensions panel (BSP:587). `main/extensions/manager.ts`, `bridge.ts`, `matchPattern.ts` and `src/preload/extensionApis.ts` are Orbis's own chrome.* shim (IPC `orbis-ext:call`). Extensions can create, update, remove and move tabs and open popups (BP:660-695). Their context items appear in the page menu (BI:392). Install sources not verified (uncertain).
- Chromium: native extension toolbar, chrome://extensions, MV3. The shim layer is not reused. Widevine and Sync caveats per memory notes.

## 14. Devtools entry

- F12 and menu "Developer tools" call `webview.openDevTools()` / `closeDevTools()` (BP:1444). Page context "Inspect" -> `inspectElement` (BI:398). "View page source" opens a `view-source:` tab (BP:1439; permitted by IDX:387). Ctrl+Shift+I toggles the Orbis app's own devtools (IDX:1153).
- Chromium: native (F12, Ctrl+Shift+I/J/C, view-source).

## 15. Other behaviors worth preserving

- Google sign-in rejection notice (BP:2837-2850, regex BP:202). Sign-in is removed in the Chromium build per memory, so probably moot (decision).
- Ad-redirect "Open anyway" banner (BP:2853-2870). Ad blocking is Orbis-side (`src/main/adblock/`, `src/preload/adblockFrame.ts`): needs-patch or needs-UI.
- DRM: `protectedMedia` component wait (IDX:1123-1130). Chromium: Widevine caveat.
- Screenshot and element picking (BP:1367-1405) use `capturePage` / `executeJavaScript`: covered by the Browser Control adapter (commit 32d3ab1).
- Browser Control layer registers most UI actions as capabilities (BP:~2180-2380, `src/shared/browserControl.ts`, `src/main/browserControl/`). The Chromium adapter (`src/main/chromium/cdp*.ts`) implements the page contract only; UI capabilities need reimplementation.

## Checklist

| Feature | Behavior | Owner | Chromium equivalent | Status |
|---|---|---|---|---|
| Tab create/close/switch | Ctrl+T/W/Tab, click, middle-click, last tab closes browser | BP:500-960, BS | Chromium tab strip | native |
| Tab reorder/drag | HTML5 DnD, Ctrl+Shift+PgUp/Dn | BP:965, 2547 | native drag and tear-off | native |
| Pin | menu, front of strip | BP:1183 | native pin | native |
| Mute / audio indicator | per-site mute, audible icon | BP:1260, 3131 | native mute site | native |
| Tab groups | named, colored, collapsible, persisted | BP:1006-1090 | native groups | native |
| Duplicate tab | menu | BP:1249 | native | native |
| Restore closed / session | Ctrl+Shift+T, restore last session | BP:954, 303 | native | native |
| Private tabs | in-window tab, in-memory session | BP:257, BI:203 | Incognito window (different model) | needs-patch |
| Favicon / loading / title | webview events | BP:3195-3200 | native | native |
| Custom tab name/emoji | Edit name and icon | TCM:208 | none | needs-patch |
| Split view | two tabs side by side | BP:1197 | Chromium split view (154 status uncertain) | needs-patch |
| Mobile view | iPhone UA toggle | BP:1147 | DevTools emulation only | needs-UI |
| Offline page + games | net error to games | BP:2993 | Chromium error page | needs-patch |
| Address bar core | typing, autocomplete, history/bookmark/search suggestions | UB, omnibox.ts | native omnibox | native |
| Default search Orbis Search, orbis:// | `toUrl` | orbisSearch.ts:100 | provider pref + scheme handler | needs-patch |
| Enter / Alt+Enter | open / new tab | UB:369, 246 | native | native |
| Ctrl+Enter Ask Orion | question overlay | UB:396 | none | needs-patch |
| Shift+Enter default browser | `shell.openExternal` | UB:406 | patched (3c05396) | needs-patch (done) |
| Orion/research suggestions, learned picks | omnibox.ts:350-364 | UB | none | needs-patch |
| Voice input mic | local whisper into bar | UB:212 | none | needs-patch |
| Summarize / Workflows bar buttons | bar buttons | UB | none | needs-UI |
| Back/Forward/Reload/Stop | toolbar and keys | BP:2450 | native | native |
| Loading bar | thin bar | BP:2915 | native throbber | native |
| History swipe | 2-finger, 60/140 px | historySwipe.ts, BI:230 | overscroll nav (touchpad uncertain) | needs-patch |
| New-tab page | orb, shortcuts, widgets, wallpaper, quick links | BP:3020 | Orbis NTP override (5bb4c1d) | needs-UI |
| New window / pop-out | pop-out BrowserWindow, Shift+click | IDX:316 | native new window | native |
| Three-dot menu, standard entries | find, print, save, zoom, fullscreen, devtools, clear data | BP:2652 | native | native |
| Three-dot menu, Orbis entries | ad-block, markup, pick element, default browser, Chat | BP:2652 | none | needs-patch |
| Sidebar: bookmarks/history/downloads/reading list | panels, per-profile layout | BSP, browserSidebar.ts | Chromium side panel | needs-UI |
| Sidebar: Orion, Notes, Tasks, Galaxy, Workflows, Secrets ... | Orbis panels | BSP | none | needs-UI |
| Assistant orb / agent banner | BrowserOrb, StepRunPanel | BP, BrowserOrb.tsx | Browser Control adapter | needs-UI |
| Layout modes full/window/dock | only `full` implemented | BP:2437 | n/a | native (moot) |
| Browser shortcut table | ~60 combos | BS:96-137 | same keys native | native |
| Shortcut conflicts (Ctrl+N/E/K/B, Ctrl+Shift+N/O) | Orbis owns | BS:79 | Chromium owns | needs-patch |
| Find in page | bar with n/m | BP:2795 | native | native |
| Zoom | steps, per-host | BP:194, 1324 | native | native |
| Fullscreen | window + HTML, hover reveal | BP:1409, 2412 | native | native |
| Page context menus | link/image/text/edit/page | BI:320-400 | native (Search Google = default engine) | native |
| Tab context menu | 16 items | TCM | native minus rename/split | needs-patch |
| Downloads UI | library panel, toasts | BI:424, BLP:163 | download bubble, chrome://downloads | native |
| History / bookmarks UI | library panel, star | BLP, BP:1418 | native | native |
| Reading list / saved pages | sidebar | BSP:268, 345 | native reading list; saved pages none | needs-UI |
| Permission prompts | bar with Remember | BI:450, BP:2885 | native bubbles | native |
| Device chooser | usb/hid/serial | DeviceChooser.tsx | native | native |
| Browser settings | suggestions, launch, default browser | SettingsModal.tsx:126-144 | chrome://settings; Orbis toggles need prefs | needs-patch |
| Extensions UI | toolbar, prompts, panel | ExtensionsToolbar.tsx | native MV3 UI | native |
| Devtools | F12, Inspect, view-source | BP:1444, BI:398 | native | native |
| Ad blocking | Orbis blocker, banner, levels | src/main/adblock | none | needs-patch |
| Profiles | partitions, per-profile session and sidebar | BP:~530 | native profiles (sign-in removed) | native |
| DRM / protected media | component updater | IDX:1123 | Widevine caveat | needs-patch |
