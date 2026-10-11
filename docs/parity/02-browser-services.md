# Parity 02: Browser services (Electron baseline)

Read-only audit of what the Electron-based Orbis provides today, as the functional baseline for the Chromium migration.
Sources: `src/main`, `src/shared`, `src/preload`, plus the renderer's `BrowserPanel.tsx` where a service is implemented
there (find, zoom, session restore, user agent), because those services are called on the `<webview>` from the
renderer and would still need an owner in a Chromium build. Paths are relative to the repo root. Line numbers are as of
branch `browser-platform` at commit 511e20b.

Legend for "Chromium equivalent": **native** (Chromium already does it, Orbis only skins or wires it), **CDP** (drive it
over the DevTools protocol, as `src/main/chromium/cdpPage.ts` does), **ext-API** (Chromium's own extension system),
**Orbis UI** (Orbis must draw the surface, data comes from Chromium), **patch** (needs a change under `patches/`).
"(uncertain)" marks claims not confirmed from the code.

## 0. Architecture in one paragraph

Every browser tab is a `<webview>` in the Orbis window (`BrowserPanel.tsx:3214`, `partition=` at `:3217`). Sessions are
Electron partitions. `BrowserIntegration` (`src/main/browserIntegration.ts`) is the main-process service that hooks each
session and each guest `WebContents`. `BrowserLibrary` (`src/main/browserLibrary.ts`) is a single JSON file that holds
history, bookmarks, the downloads list, remembered permissions, reading list, saved pages, screenshots, address-bar
searches and new-tab shortcuts. `ExtensionsManager` + `ExtensionBridge` (`src/main/extensions/`) load Web Store
extensions and re-implement Chrome extension APIs Electron lacks. `OrbisAdBlock` (`src/main/adblock/electron.ts`) hooks
`webRequest`. The Browser Control Layer (`src/main/browserControl/`) exposes all of it as capabilities to Orion.
A Chromium build already owns most of these natively, so most rows are "delete the Orbis re-implementation and read the
native state", not "port it".

## 1. Downloads

Current behavior (`browserIntegration.ts:424-448`, `:489-509`):
- `session.on('will-download')` on every wired session. Save path is always the OS Downloads folder, no save dialog
  (`:425`). Filename is sanitised and made unique ("name (1).ext") by `uniqueDownloadName`
  (`browserLibrary.ts:506-513`).
- Progress: `item.on('updated')` throttled to 400 ms (`:437-441`) writes state `progressing | paused | interrupted` to the
  library; `done` writes `completed | cancelled | interrupted` with `finishedAt` (`:442-447`). The window is told only on
  start and done (`browser:download`, `:435`, `:446`); progress rides the debounced `library:changed` push
  (`:157-163`, 250 ms).
- Controls: `downloadAction` (`:489`) cancel/pause/resume use the live `DownloadItem` map (`:134`); resume is refused when
  `!item.canResume()` (`:497`); open uses `shell.openPath` and requires state `completed` (`:502-506`); show uses
  `shell.showItemInFolder` (`:507`). IPC: `library:download-action` (`:610`).
- List persistence: `BrowserLibrary.upsertDownload` capped at 200 (`browserLibrary.ts:9`, `:443-451`). On load, any
  `progressing` record becomes `interrupted` (`:103`): downloads do NOT survive an app restart.
- Clear finished: `clearFinishedDownloads` keeps only `progressing` (`:466-469`), so it also drops `paused` ones
  (likely a minor bug, intent uncertain). `removeDownload` refuses progressing/paused (`:458-464`).
- Save link/image/media as: `contents.downloadURL` from the context menu (`browserIntegration.ts:334`, `:343`, `:347`).
  Orion: `downloads.start` uses `session.downloadURL` (`mainCapabilities.ts:783-797`); pause/resume/cancel/open/show at
  `:815-830`; `downloads.waitFor` at `:861`.
- Downloads security: no Safe Browsing, no dangerous-file warning, no blocked-download prompt; Orion's `open` is
  `confirmation: 'always'` (`mainCapabilities.ts:827`); Orion-started downloads accept only http(s) (`:791`). No
  mark-of-the-web handling in Orbis code (whether Windows applies it with a forced `setSavePath` is uncertain).

Chromium equivalent: **native** download manager (pause/resume/cancel, resume across restart, Safe Browsing, dangerous
download warnings, mark-of-the-web) plus **Orbis UI** to render the panel. Orion capabilities become **CDP**
(`Browser.setDownloadBehavior`, `Browser.downloadWillBegin`, `Browser.downloadProgress`); CDP has no pause/resume, so
those need a **patch** or UI driving (uncertain).
Tests: local HTTP server with Range support and a slow-drip route; assert file appears with unique name, progress
monotonic, pause then resume completes with identical hash, cancel removes partial, restart mid-download resumes (new
behavior), open/show call the shell. Existing: `browserLibrary.test.ts`.

## 2. History

Current: recorded on `did-navigate` and `did-navigate-in-page` (main frame) only for persistent sessions
(`browserIntegration.ts:203-209`); title backfilled on `page-title-updated` (`:210-212`). `BrowserLibrary.visit`
(`browserLibrary.ts:261-275`): http(s) only (`:33`), key ignores fragment (`:36`), a revisit within 30 min updates the
entry instead of adding one (`:8`), cap 5000 (`:6`). Search with text/time filter (`:288-300`), delete by URL (`:311`),
by range (`:303`), clear (`:318`, also clears suggestion learning). Address-bar searches are separate (`:327-352`,
cap 300); deleting a search also removes matching Google/Bing/DDG/YouTube result pages from history (`:490-503`).
Private session never writes history (`:203`). IPC: `library:*` (`:537-560`). Orion:
`history.search/delete/deleteRange/clear` (`mainCapabilities.ts:888-930`).

Chromium equivalent: **native** History service (visit types, redirect chains, typed counts, favicon DB, omnibox
ranking). Orbis "learning" picks (`recordPick`) are replaced by omnibox scoring (behavior change). Orion access:
**ext-API** `chrome.history` from an Orbis component extension (uncertain which surface the build exposes). Per-profile
isolation is native.
Tests: navigate fixture pages, assert entries; native dedupe differs from the 30 min rule (document it); private window
leaves no entry; delete range removes the right ones. Existing: `browserLibrary.test.ts`, `omnibox.test.ts`.

## 3. Bookmarks

Current: flat list, newest first, http(s) only, no folders (`browserLibrary.ts:411-439`), toggle/add/remove
(`browserIntegration.ts:538-544`), bulk add for "bookmark all tabs" (`:539`). Title backfilled from history when empty
(`browserLibrary.ts:282-283`). Orion: `bookmarks.list/add/remove` (`mainCapabilities.ts:943-966`). Private tabs may be
bookmarked (UI hiding uncertain).

Chromium equivalent: **native** bookmark model (folders, bar, import/export HTML). Needs a one-time **migration** of
`browser-library.json` bookmarks into Chromium's `Bookmarks` file (custom tool). Orion: **ext-API** `chrome.bookmarks`.
Star and bar are native; **patch** only for branding.
Tests: import migration fixture then assert count/titles; star toggle; bookmark-all-tabs.

## 4. Reading list

Current: separate list from bookmarks, `addedAt`, `readAt`, cap 500 (`browserLibrary.ts:173-222`); re-adding clears
`readAt`; clear-read; IPC `library:reading-*` (`browserIntegration.ts:561-568`). No Orion capability found in
`mainCapabilities.ts` ids (uncertain).

Chromium equivalent: **native** Reading List (side panel). Stored items need migration. Orion: **ext-API**
`chrome.readingList` (MV3). Tests: add, mark read, remove, migration fixture.

## 5. Browser library storage (JSON file)

Current: one file `browser-library.json` under userData, or under `profiles/<id>/` for non-default profiles
(`browserLibrary.ts:67-76`, `shared/profiles.ts:29-33`). Debounced atomic write, 800 ms, tmp then rename (`:135-156`).
A corrupt file yields an empty library silently (`:117-120`). Switching profile flushes then reloads from the new dir
(`:87-94`). Contents: history, bookmarks, downloads, permissions (`"<origin> <permission>"` -> allow/block, `:475-485`),
searches, picks, new-tab shortcuts (cap 24, `:12`; icons as data URLs, `:56`), reading list, saved pages, screenshots
(PNG files in `<dir>/screenshots`, `browserIntegration.ts:573-594`).

Gap: `recordSavedPage` (`browserLibrary.ts:227`) has no caller outside tests (`browserLibrary.test.ts:215`), so the "saved
pages" list is never filled by the real save flow (`savePage`, `browserIntegration.ts:402-414`). Uncertain only because
`mainCapabilities.ts` contains control bytes and was searched with `grep -a`; no hit.

Chromium equivalent: history, bookmarks, permissions, downloads, reading list become **native** profile data.
Non-native items (screenshots, new-tab shortcuts, saved pages, searches/picks) stay as **Orbis UI** data in a small Orbis
store (narrow `BrowserLibrary` to those). New-tab shortcuts overlap Chromium's Most Visited.
Tests: migration round trip; kill during write leaves the previous file valid.

## 6. Extensions

Current (`src/main/extensions/manager.ts`, `bridge.ts`):
- Install: Chrome Web Store page via `electron-chrome-web-store` (`manager.ts:233-252`), MV3 only
  (`minimumManifestVersion: 3`, `:238`). Orbis intercepts `beforeInstall`, shows its own prompt with permission warnings
  (`:345-353`, warnings table `:26-73`), then installs directly with `installExtension`, because the store page's own
  completion crashes Electron (`:246-249`, per the code comment).
- Load at startup: discovers `userData/Extensions/<32-char id>/<version>/` requiring a manifest `key` (`:177-201`), loads
  via `session.extensions.loadExtension` and starts the service worker (`:277-288`).
- Enable/disable: state in `extensions-state.json` (`:157-174`); disable = `removeExtension` (`:437-451`).
- Remove: `uninstallExtension` (`:459-462`). Update: `updateExtensions` (`:475-488`), plus `autoUpdate: true` (`:237`).
- Pin to toolbar: state list (`:453-457`). Toolbar buttons, badge, icon, title are rendered in the window
  (`list()` `:401-433`); click opens the popup via `bridge.clickAction` (`:490`); popup and options pages open as
  webviews with `chrome-extension://` src, allowed only on `persist:browser` (`index.ts:387-388`).
- Permissions: install-time warnings; optional permissions via bridge `permissions.request/contains/remove/getAll`,
  granted set persisted (`manager.ts:145-149`), 5 min prompt timeout (`:334`).
- APIs Orbis re-implements (`bridge.ts` handler table, from about `:520`): `tabs.*`, `windows.*` (single window model),
  `contextMenus.*`, `action.*` (badge/title/icon/popup/enable), `permissions.*`, `storage.sync` (quota constants
  `bridge.ts:60`, files in `userData/extension-sync`), `runtime.openOptionsPage`. Injected with
  `session.registerPreloadScript` for service-worker and frame (`manager.ts:208-211`); calls go over `orbis-ext:call` IPC
  (`:217-222`, `:302-327`).
- Extension items are merged into the page context menu (`browserIntegration.ts:384-397`).
- Profiles: `useSession` reloads extensions into the new profile's session (`manager.ts:294-300`); install files are
  shared, extension storage is per session.
- Private tabs: no extensions (in-memory session cannot load them; `manager.ts:116` doc comment).
- Orion: `extensions.list/setEnabled/pin/remove/update/install/pages/clickAction/openOptions/permissions/
  revokePermissions/contextMenuItems/clickContextMenu` (`mainCapabilities.ts:1118-1360`).
- Which other extension APIs (declarativeNetRequest, webRequest, sidePanel, alarms, commands) work is whatever Electron
  supports natively (uncertain).

Chromium equivalent: **native** extension system (Web Store install UI, permission bubble, MV3 workers, DNR, toolbar
container, chrome://extensions, incognito toggle, updates). Deletes the whole bridge. **Orbis UI** only if the toolbar is
replaced (`docs/chromium-sidepanel-plan.md`). **Patch** for the DNR static rule limit
(`patches/chromium-adblock-static-rule-limit.patch`, exists). Web Store access from a non-Google build is unverified and
must be tested. Installed extension state is not portable; users reinstall (uncertain whether unpacked dirs could be
reused).
Tests: install a known MV3 fixture, popup renders, badge updates, permission grant persists across restart, DNR block
works, remove cleans storage, update against a local update server.

## 7. Permissions and device choosers

Permissions (`browserIntegration.ts:30-62`, `:450-482`):
- `setPermissionRequestHandler`: always allow `fullscreen`, `clipboard-sanitized-write` (`:31`). Askable: geolocation,
  notifications, midi (+sysex), clipboard-read, display-capture, pointerLock, keyboardLock, idle-detection,
  window-management, storage-access, top-level-storage-access, and `media` camera/mic (`:41-54`, `:453`). Everything else
  is denied (`:454`).
- The prompt is shown only for tabs hosted in the main Orbis window (`hostWebContents` check `:459`); pop-out windows deny.
  Prompt UI is `BrowserPanel.tsx:2889-2895`, with a "remember" box. Unanswered for 120 s means deny (`:477`).
- Remembered decisions are per origin+permission in the library (`:455-456`, `:467`); private sessions never read or write
  them (`remembers = session.isPersistent()`, `:423`). `setPermissionCheckHandler` returns allow only for a remembered
  allow, or for `usb/hid/serial` so Chromium offers the chooser (`:479-482`, `:38`).
- Forget: `library:forget-permissions` (`:560`); also cleared by clear-data (`index.ts:342`). Orion:
  `permissions.list/answer/set/forget` (`mainCapabilities.ts:607-680`).
- Camera and microphone: only the `media` permission through the same prompt; no camera/mic device picker.
- Geolocation: prompted, but Electron ships no Google location key, so `navigator.geolocation` probably fails even when
  allowed (uncertain, common Electron limitation).
- Web notifications: permission granted, delivery is Electron/Chromium's OS toast path (uncertain how it renders in a
  webview); click-to-focus not implemented (uncertain).

Device chooser (`src/main/deviceChooser.ts`): `select-usb-device`, `select-hid-device`, `select-serial-port` on the session
(`:110-123`), `select-bluetooth-device` per webContents (`:131-134`). Answered in the window (`DeviceChooser.tsx`, IPC
`browser:device-request/answer`, `browserIntegration.ts:82-105`, 120 s timeout). Grants live in memory only for the app
run (`deviceChooser.ts:66`, `:54`) and are enforced by `setDevicePermissionHandler` (`:106-108`).

Chromium equivalent: **native** permission manager (stored content settings, quiet UI, site settings page, device choosers
with persistent grants). Orbis prompt UI is deleted. Orion `permissions.*` become **CDP** `Browser.setPermission` /
`Browser.grantPermissions` (reading state is not in CDP; may need an internal page or UI driving, uncertain).
Geolocation in a non-Google build needs a provider key or a **patch** (uncertain). Behavior change: device grants become
persistent.
Tests: fixture page requesting each permission, assert prompt, remember, revoke in site settings, private window does not
remember; USB/serial need a mock or CDP `DeviceAccess`.

## 8. Cookies, storage, site data, clear data

Current:
- Clear browsing data: `clearBrowsingData` (`index.ts:338-344`) clears the `persist:browser` session (`clearStorageData()`
  with no args = cookies, localStorage, IndexedDB, service workers, cache storage) and the cache, then history, searches
  and remembered permissions. Bookmarks and downloads stay. It hard-codes `persist:browser` (`:339`), so for a non-default
  active profile it clears the wrong partition (bug or intended, uncertain).
- Private: `browser:clear-private` clears the in-memory `orbis-private` session including auth cache
  (`index.ts:963-966`).
- Orion: `browser.clearData/clearCache/clearCookies/cookieCount` (`mainCapabilities.ts:689-745`; uses
  `session.clearStorageData({storages:['cookies']})`, `session.cookies.get`, `session.clearCache`, `getCacheSize`).
- Not present: time-range clearing, per-site data view, clear-on-exit, third-party cookie policy in Orbis code (Chromium
  defaults of the Electron build apply; whether third-party blocking is on is uncertain).

Chromium equivalent: **native** clear-browsing-data dialog (time range, per type), site settings, cookie controls,
clear on exit. Orion: **CDP** `Storage.clearDataForOrigin`, `Network.clearBrowserCookies`, `Network.getCookies`,
`Network.clearBrowserCache`, `Storage.getUsageAndQuota`. The Orbis "clear everything including history" action is
**Orbis UI** wrapping native calls or a **patch**.
Tests: set cookies/localStorage/IndexedDB in a fixture page, clear, reload, assert empty; clearing profile A leaves B.

## 9. Sessions, partitions, profiles, private browsing (how isolation is done)

Current:
- Partitions: default profile `persist:browser`; others `persist:profile-<id>` (`shared/profiles.ts:29`); private tabs
  share ONE in-memory partition `orbis-private` (`BrowserPanel.tsx:257`, `:3217`; main `index.ts:1206`). The webview
  attach guard allows only those partitions (`index.ts:383-386`). Pop-out windows use `persist:browser` (`:324`), so a
  pop-out from a non-default profile lands in the default profile (likely a bug, uncertain).
- Isolation is therefore Electron partition isolation: separate cookie jars, storage and cache per profile. All private
  tabs share one private session, unlike Chrome incognito (one per window).
- Each new session is wired identically: `browser.setupSession`, `adblock.attachSession` (`index.ts:1203-1208`,
  `:1401-1413`). Profile switching calls `useProfile` (`:1401`), reloads the library directory, moves the extensions
  (`:1409`) and tells the window (`profiles:changed`).
- Profile data outside the partition: library, conversations, workflows, experience etc. under `profiles/<id>` via
  `dataDirFor` (`shared/profiles.ts:33`). Profile list in `personal/profiles.json` (`personal/profiles.ts:16`), max 20
  (`shared/profiles.ts:24`). Removing a profile deletes its data dir but no code clears its Electron partition storage
  (`personal/profiles.ts:79-88`; uncertain).
- Private tabs: no history, no remembered permissions, no extensions, ad blocking on, extra `clearAuthCache` on clear
  (`index.ts:963-966`), clipboard history skips them (`index.ts:1887`). Downloads in private ARE listed in the library
  (`browserIntegration.ts:429-447` never checks `remembers`; intent uncertain).
- Open pages (session restore) and zoom are per profile in renderer `localStorage` (`BrowserPanel.tsx:270`, `:272`, `:300`).

Chromium equivalent: **native** Profiles (one user-data subdirectory each, isolating extensions, passwords, history) and
native Incognito (off-the-record, per window, cleared on close). Orbis keeps its own profile list
(`shared/profiles.ts` is engine-neutral and in the PORTABLE list of `portability.test.ts`) and maps Orbis profile id to a
Chromium profile directory (**Orbis UI**, likely **patch** for the picker; a picker surface patch exists, commit 8a96f61).
Sync and sign-in are removed per project requirements. Differences to record: per-window private session; extensions off
in private unless allowed.
Tests: log in on profile A, assert profile B has no cookie; incognito cleared on close; two incognito windows isolated.

## 10. Settings persistence

Current: app settings in `settings.json` (`store.ts:46`, `:62-102`), atomic queued writes, API key encrypted through
`safeStorage` (`platformElectron.ts:35-39`); fields include theme, search suggestions, `openBrowserOnLaunch`, welcome
flags. Browser-related persisted state: library JSON (sec. 5), extension state, adblock settings (`adblock/store.ts`),
tab/session/zoom/groups in renderer `localStorage`, sidebar layout (`browserSidebarStore.ts`, `index.ts:1861-1871`), update
settings. Orion: `settings.get/set/adblock/adblockSite` (`mainCapabilities.ts:509-600`). No homepage, default search engine,
download folder, ask-where-to-save, language, font size or spellcheck preference is exposed; Orbis uses Chromium defaults
(spellcheck on in `webPreferences`, `index.ts:366`).

Chromium equivalent: browser prefs become **native** Preferences (`chrome://settings`); Orbis-only settings stay in
`settings.json`. Bridging Orbis UI to prefs needs a **patch** or `chrome.settingsPrivate` from a component extension.
Secrets: `safeStorage` becomes OS crypt (DPAPI) behind the existing `platform.ts` seam.
Tests: `store` tests exist; add a pref round trip after restart.

## 11. Media, PDF, Widevine

- Widevine: castlabs Electron fork (`package.json:33`, `+wvcus`); startup waits for `components.whenReady()`
  (`index.ts:1120-1127`); status via `browser:protected-media` (`:855`); VMP signing via the `sign:drm` script
  (`package.json:19`). Failure is non-fatal (DRM pages only).
- Media: audible and mute tracked in the renderer (`media-started-playing`, `BrowserPanel.tsx:3141`; `setAudioMuted` `:81`);
  muted hosts kept in state (`:1075`). PiP, autoplay policy, media keys: Chromium defaults, nothing in Orbis code.
- PDF: no Orbis code; whether the Chromium PDF viewer works in a `<webview>` here is uncertain. Print-to-PDF is Orion only
  (`devtools.printToPdf`, `mainCapabilities.ts:448-470`).
- Display capture: `display-capture` is askable (`browserIntegration.ts:47`) but no `setDisplayMediaRequestHandler` exists;
  whether screen sharing works is uncertain.

Chromium equivalent: PDF viewer, media controls, PiP, autoplay: **native**. Widevine: a component fetched by the component
updater, which a non-Google build may not be allowed to use; needs a license/VMP flow and build flags (**patch**); memory
notes flag this as a caveat.
Tests: Widevine test page (licensed stream), PDF fixture opens and prints, per-tab mute.

## 12. Printing, save-page, find, zoom, devtools, view-source

- Print: context menu `contents.print()` (`browserIntegration.ts:379`); shortcut `print`; Orion `devtools.print`
  (`mainCapabilities.ts:429-446`) and `printToPDF` (`:448`). OS print dialog, no in-app preview.
- Save page: `dialog.showSaveDialog` then `contents.savePage(path, 'HTMLComplete')` (`browserIntegration.ts:402-414`);
  html/htm only. Orion `devtools.savePage` (`mainCapabilities.ts:474`).
- Find: renderer calls `webview.findInPage/stopFindInPage` (`BrowserPanel.tsx:97-98`, `:1351-1364`); Orbis bar; result
  count source not verified (uncertain).
- Zoom: per-host in `localStorage` (`orbis.browser.zoom`, `:272-282`), applied with `setZoomFactor` on navigation
  (`:1322-1336`); Orion's click coordinate math multiplies by `getZoomFactor` (`page.ts:408-433`).
- DevTools: `webview.openDevTools()` (`BrowserPanel.tsx:1449`), menu accelerator (`index.ts:1131`), Orion
  `devtools.open/close/inspect` (`mainCapabilities.ts:264-320`, modes right/bottom/undocked/detach), console capture
  (`:325-364`), network capture over `webContents.debugger` `Network.*` (`:379-427`). Context menu "Inspect" uses
  `inspectElement` (`browserIntegration.ts:398`).
- View source: opens a `view-source:` tab (`browserIntegration.ts:380`); the guard allows `view-source:https?`
  (`index.ts:388`).
- Mark-up screenshot via `capturePage` (`BrowserPanel.tsx:1371`), kept via `library:keep-screenshot`
  (`browserIntegration.ts:573`, 24 MB cap).

Chromium equivalent: print preview and PDF save, Save as (complete/MHTML), find bar, per-origin zoom, DevTools,
view-source: all **native**. Orion hooks: **CDP** `Page.printToPDF`, `Page.captureSnapshot` (MHTML), `Runtime.*`,
`Network.*`, `Target.*`. DevTools docking control is **Orbis UI** or **patch**. The existing CDP adapter
(`src/main/chromium/cdpPage.ts`) covers reading, input, screenshots; print, save, devtools, console/network capture are
not confirmed there (uncertain; verify).
Tests: each against the real Chromium build using the `chromiumControl.test.ts` harness.

## 13. User agent

Current: the renderer sets `useragent` per webview: desktop = `navigator.userAgent` with `Electron|nxtorbis-ai|Orbis`
tokens removed (`BrowserPanel.tsx:190-193`), mobile = a fixed `MOBILE_UA` (`:190`), toggled with `webview.setUserAgent`
(`:1173`). No main-process `session.setUserAgent`, no client-hints handling found in `src/main` (so `Sec-CH-UA` follows
Chromium; uncertain). Orbis's own outbound requests use `Orbis/<version>` (`widgetFeeds.ts:60`).

Chromium equivalent: **native** UA (product token via branding patch, UA reduction). Request-desktop-site or mobile:
**CDP** `Emulation.setUserAgentOverride` with metadata, or an **Orbis UI** toggle.
Tests: echo server returns UA and `Sec-CH-UA`; assert no "Electron", correct brands, mobile toggle.

## 14. Proxy and network settings

Current: nothing. No `setProxy`, `appendSwitch`, `resolveProxy`, certificate or `login` handler in `src/main` (grep found
only the `--user-data-dir` check, `index.ts:1087`). System proxy is Chromium's default. Authenticated sites/proxies get no
prompt handler (webview behavior uncertain). `net.fetch` is used for Orbis's own requests (`index.ts:1177` etc.). Network
blocking: ad blocker via `webRequest.onBeforeRequest` and `onHeadersReceived` (CSP additions) on wired sessions
(`adblock/electron.ts:149-157`), popup and redirect guard (`:266-297`), cosmetic filters via `insertCSS` (`:138`).

Chromium equivalent: proxy, HTTP auth, certificate interstitials, HTTPS-first, DoH, Safe Browsing: **native**. Ad blocking
moves to **ext-API** `declarativeNetRequest` (needs the static-rule-limit patch) or a **patch**; cosmetic filtering becomes
a content script.
Tests: adblock fixture set, authenticated proxy test server, invalid-cert page shows the interstitial.

## 15. Captcha detection

Current: read-only detection; Orbis never solves (header comment, `captchaCapabilities.ts:9-19`). `captcha.check` and
`captcha.show` (`:103`, `:119`) run an in-page script (`SIGNALS_SCRIPT`, `:24-58`) that collects frame/script URLs (query
strings cut in-page, `:25`), element ids/classes/names, and up to 80 short text lines; `safeSignals` sanitises
(`shared/captcha.ts:281`); `detect` scores provider/kind/confidence (`:191`; thresholds `STOP_AT` 0.6 and `SUSPECT_AT` 0.3,
`:87-89`). Encounter state machine with a 5 minute wait and 3 reappearance limit (`shared/captcha.ts:332-334`).
`captcha.show` scrolls the challenge into view (`SCROLL_SCRIPT`, `:63-75`). Providers: recaptcha, hcaptcha, turnstile, arkose,
aws-waf, geetest, friendly (`shared/captcha.ts:21`). Electron API: only `webContents.executeJavaScript` through `page.exec`
(`page.ts:388`). Test: `src/main/captcha.test.ts`. How agent runs consume encounters (stop and ask the user) is not
traced here (uncertain).

Chromium equivalent: **CDP** `Runtime.evaluate` (what `CdpPage.executeJavaScript` provides); `shared/captcha.ts` is
engine-neutral. No native equivalent.
Tests: keep `captcha.test.ts`; add fixture pages per provider iframe URL run against Chromium.

## 16. Context menu

Current: built in main from each guest's `context-menu` event (`browserIntegration.ts:213`, `:319-400`) with Electron
`Menu`: link (new tab, background, window, copy, save as), image (open, copy, copy address, save as), media (save, copy
address), editable (spelling suggestions, undo/redo/cut/copy/paste/select all), selection (copy, "Search Google for...",
Google hardcoded, `:367`), page (back/forward/reload/save page/print/view source), extension items (`:384-397`), Inspect.
The Orbis shell window has a smaller menu (`index.ts:420-443`). Orion can list and invoke actions
(`pageCapabilities.ts:665-682`).

Chromium equivalent: **native** menu (Lens/search, translate, spellcheck, extension items). Orbis differences: search entry
should follow the Orbis default search engine (**patch**); Orbis-specific items need **patch** or **Orbis UI**. Orion
listing cannot enumerate native menus over CDP; a synthesised list is needed (uncertain).
Tests: right-click each element type via `Input.dispatchMouseEvent` and assert via UI automation.

## 17. Window management and tabs

Current: main window (`index.ts:347-372`, hidden title bar with overlay, `webviewTag: true`), pop-out windows for Shift+click
and "open in new window" (`popOutBrowser`, `index.ts:315-335`), single-instance lock (`:1107`), second instance focuses
the window (`:1110-1116`), fullscreen sync (`index.ts:373-375`; `browserIntegration.ts:625-630`; HTML fullscreen
`enter-html-full-screen`, `BrowserPanel.tsx:3181`). The tab model (tabs, groups, split view, pinned, muted, reopen closed up to 25,
mobile flag) lives entirely in React state in `BrowserPanel.tsx` (`:359-1300`) and is reported to control via
`control:window-state` (`preload/index.ts:223`). Orion window capabilities `window.list/create/close`, min/max/fullscreen
(`mainCapabilities.ts:124-232`). Shortcuts: one table in main (`browserShortcuts.ts`), `before-input-event` on window and
guests (`browserIntegration.ts:177`, `:190`), mouse back/forward via `app-command` (`:180-184`), trackpad swipe via
`before-mouse-event` wheel (`:194-246`, recogniser `shared/historySwipe.ts`). Ad popups and popup routing:
`adblock.attachWebview` (`index.ts:407`).

Chromium equivalent: tabs, groups, pinned, muted, split view (recent Chromium), windows, PiP, fullscreen, shortcuts,
swipe navigation are **native**. Swipe on Windows depends on the build's overscroll history navigation; the project
requirement says swipe gestures must work, so this needs a real test and possibly a **patch**. Orbis-specific UI (orb,
sidebar) is **Orbis UI** / side panel (`docs/chromium-sidepanel-plan.md`). Orion tab control: **CDP** `Target.*`.
Tests: open/close/pin/mute via CDP; swipe with synthesised wheel events plus a real trackpad check.

## 18. Session restore

Current: renderer only. Open http(s) tab URLs and groups are saved to `localStorage` per profile
(`BrowserPanel.tsx:270-306`, `:1000-1005`); `restoreSession` reopens them from a menu item or banner (`:1291-1305`,
`:2217-2226`, `:2719`, `:3049`); `openBrowserOnLaunch` setting (`store.ts:79`). Not restored: scroll position, form data,
private tabs, history stack, window bounds, pop-out windows; pinned state persistence uncertain. Closed tabs list is in
memory only (last 25, `:1103`).

Chromium equivalent: **native** session restore ("Continue where you left off", Ctrl+Shift+T with navigation entries) and
`chrome.sessions`. Tests: open tabs, kill the browser, relaunch, assert tabs and back history return.

## 19. Clipboard

Current: page clipboard is Chromium's (`clipboard-sanitized-write` always allowed, `clipboard-read` prompted;
`browserIntegration.ts:31`, `:46`). Context menu uses `webContents.copy/cut/paste/copyImageAt` (`:341`, `:357-360`).
Orbis-level: a `Platform.clipboard` port (`platform.ts`, `platformElectron.ts:13-34`) used by `ClipboardHistory`
(`personal/clipboard.ts`, started `index.ts:1920`, skips private tabs `:1887`), and Orion's
`clipboard.formats/read/write/clear/copyFromPage/copyImageFromPage` (`mainCapabilities.ts:980-1110`) using Electron
`clipboard` and `ClipboardItem`.

Chromium equivalent: page clipboard and prompts **native**. Clipboard history and Orion clipboard need an OS-level source:
replace `platformElectron.ts` with a Chromium-side implementation (**Orbis UI** / native module), as its own comment states
(`platformElectron.ts:4-9`).
Tests: text, HTML, PNG round trip; history skips private-window copies.

## 20. File upload and file chooser

Current: no Orbis code; `<input type=file>` uses Chromium's default chooser in the webview. Orbis dialogs are for its own
features (`files:pick-text`, `files:pick-images`, `image:save`; `dialog.showOpenDialog/showSaveDialog`, `index.ts:795`, `:809`,
`:992`; save page `browserIntegration.ts:406`). Orion has no file-input attach (no `DOM.setFileInputFiles` use found;
uncertain). Drag and drop is Chromium default.

Chromium equivalent: **native** chooser and drop. Orion upload: **CDP** `DOM.setFileInputFiles` (new).
Tests: fixture page with input, set files via CDP, assert name and content read.

## 21. Notifications and geolocation

- Web notifications: permission askable (`browserIntegration.ts:42`), no explicit delivery handler; Windows needs an
  AppUserModelID (`app.setAppUserModelId`, `index.ts:1105`). Click-to-focus not implemented (uncertain).
- Orbis notifications: `new Notification` for workflow results (`index.ts:1316`), guarded by `isSupported`.
- Geolocation: see section 7.
- Chromium equivalent: **native** notification center / Windows toast, site settings; geolocation **patch** or key
  (uncertain). Tests: grant via `Browser.grantPermissions`, fire a notification, assert toast (UI automation).

## 22. Other services touching session or webContents

- Ad blocking: `adblock/electron.ts`, `blocker.ts`, `store.ts`; per-site allow list, exceptions, rollback, updates. Uses
  `webRequest`, `registerPreloadScript`, `insertCSS`, `ipcMain` handlers (`electron.ts:129-157`).
- Guest hardening: `will-attach-webview` removes preload, forces sandbox and contextIsolation, restricts partition and URL
  scheme (`index.ts:381-389`); window-open handler routes new windows to tabs (`:403-417`); shell `will-navigate` sends
  external navigations to the system browser (`:416-419`).
- Default browser registration: `defaultBrowser.ts:38-68` (`app.isDefaultProtocolClient`, `setAsDefaultProtocolClient`,
  `ms-settings:defaultapps`). Chromium: **native** `shell_integration`.
- Orion browser automation: `browserAgent.ts`, `stepRunner.ts`, `browserControl/*` (read, click, type, screenshot via
  `capturePage` and `Page.captureScreenshot`, `page.ts:446-501`). Contract in `pageHandle.ts`; Chromium implementation in
  `src/main/chromium/cdpPage.ts`. Registry, confirmation and safety (`browserSafety.ts`) are engine-neutral.
- Workflow recorder attaches to guests (`index.ts:407`, `workflows/recorder.ts`); which webContents events it uses is
  not traced (uncertain).
- Web search suggestions and other Orbis network calls use Electron `net.fetch` (`index.ts:830-849`); a Chromium build
  needs an Orbis-side HTTP client.
- App updates (`src/main/update/`) are not browser services and are already engine-neutral.

## 23. Feature table

| feature | behavior | owner | Electron API | Chromium equivalent | status |
|---|---|---|---|---|---|
| Downloads: start/progress | Auto-save to Downloads with unique names, 400 ms throttled state, list capped at 200 | browserIntegration.ts:424; browserLibrary.ts:443 | `session.will-download`, `DownloadItem.setSavePath/updated/done` | native download manager + Orbis UI panel | replace; Orion via CDP Browser.download* |
| Downloads: pause/resume/cancel | Live item map; resume needs `canResume` | browserIntegration.ts:489 | `DownloadItem.pause/resume/cancel/canResume` | native; CDP lacks pause/resume | needs patch or UI driving for Orion (uncertain) |
| Downloads: open/show | Only completed opens; show in folder | browserIntegration.ts:501-508 | `shell.openPath`, `shell.showItemInFolder` | native (chrome://downloads) | replace |
| Downloads: restart | In-progress become "interrupted" | browserLibrary.ts:103 | none | native resumption | improves |
| Downloads security | No Safe Browsing or danger warning; Orion open needs confirm | mainCapabilities.ts:791,827 | none | native Safe Browsing + MOTW | closed by native (verify offline) |
| Save link/image/media as | Context menu triggers download | browserIntegration.ts:334-347 | `webContents.downloadURL` | native context menu | replace |
| History | http(s) only, 30 min revisit merge, 5000 cap, private skipped | browserLibrary.ts:261; browserIntegration.ts:203 | `did-navigate`, `did-navigate-in-page`, `page-title-updated` | native History DB; ext-API chrome.history | replace; Orion via ext-API |
| Address-bar searches/picks | Own learned ranking | browserLibrary.ts:327-364 | none | native omnibox scoring | behavior change |
| Bookmarks | Flat, no folders, toggle/bulk | browserLibrary.ts:411-439 | none | native bookmarks; chrome.bookmarks | replace; one-time import |
| Reading list | Separate list with read state, cap 500 | browserLibrary.ts:173-222 | none | native Reading List; chrome.readingList | replace; import |
| Library storage | One JSON per profile, atomic debounced writes | browserLibrary.ts:63-156 | none (fs) | native stores + small Orbis store | narrow to non-native data |
| Saved-pages list | Table exists, never filled by real flow | browserLibrary.ts:227; browserIntegration.ts:402 | none | Orbis UI if kept | bug in baseline |
| Screenshot library | PNG files + list, 24 MB cap | browserIntegration.ts:573-609 | none (fs) | CDP Page.captureScreenshot + Orbis store | keep (Orbis) |
| New-tab shortcuts | 24 shortcuts with fetched icons | browserLibrary.ts:366-407; index.ts (shortcuts:*) | `net` fetch | Orbis new-tab page (done, 5bb4c1d) | keep |
| Extensions: install | Web Store via electron-chrome-web-store, MV3, own prompt, direct-install workaround | extensions/manager.ts:233-275 | `session.extensions.loadExtension`, ecws `installExtension` | native | replace; Web Store access in non-Google build unverified |
| Extensions: enable/disable/remove | State file; disable unloads | manager.ts:437-472 | `removeExtension`, ecws `uninstallExtension` | native chrome://extensions | replace |
| Extensions: update | Web Store check + autoUpdate | manager.ts:475-488 | ecws `updateExtensions` | native updater | replace |
| Extensions: permissions | Warning text, optional-permission prompt, 5 min timeout | manager.ts:26-73,355-366; bridge.ts permissions.* | none (own bridge) | native permission bubble | replace |
| Extensions: popup/toolbar | Window-rendered buttons, badge, popup webview | manager.ts:401-433; bridge.ts action.* | `serviceWorkers`, preload scripts | native toolbar / side panel | replace; toolbar design open |
| Extensions: APIs | tabs, windows, contextMenus, action, permissions, storage.sync | bridge.ts:521+ | `registerPreloadScript`, `ipcMain` | native full API set | delete bridge |
| Permission prompts | Per origin+type, remember, 120 s timeout, main window only | browserIntegration.ts:450-482 | `setPermissionRequestHandler`, `setPermissionCheckHandler` | native permission manager | replace; Orion via CDP Browser.setPermission |
| Device choosers | USB/HID/serial/Bluetooth, per-run grants | deviceChooser.ts | `select-*-device`, `setDevicePermissionHandler` | native choosers (persistent) | replace; behavior change |
| Cookies/site data | Clear all or cookies only, cookie count | index.ts:338; mainCapabilities.ts:689-745 | `clearStorageData`, `clearCache`, `cookies.get` | native clear dialog; CDP Network/Storage | replace |
| Sessions/partitions | `persist:browser`, `persist:profile-<id>`, `orbis-private` | shared/profiles.ts:29; index.ts:1206,1401 | `session.fromPartition` | native Profile dirs | map Orbis profile to Chromium profile |
| Profiles | Up to 20, per-profile data dir + partition | personal/profiles.ts; shared/profiles.ts | (partition) | native Profiles + Orbis picker | patch/UI; delete cleanup unverified |
| Private browsing | Shared in-memory session; no history/permissions/extensions | index.ts:1206; browserIntegration.ts:203,423 | in-memory partition | native Incognito (per window) | behavior change |
| App settings | settings.json, API key via safeStorage | store.ts; platformElectron.ts:35 | `safeStorage` | Orbis store + native prefs | keep + prefs bridge |
| Widevine | castlabs fork, component wait, status IPC | index.ts:1120-1127,855 | `components.whenReady/status` | native component (licensing) | open risk |
| PDF viewing | No Orbis code | none | Chromium PDF plugin in webview (uncertain) | native PDF viewer | verify |
| Print / print to PDF | OS print dialog; Orion printToPDF | browserIntegration.ts:379; mainCapabilities.ts:429-470 | `webContents.print/printToPDF` | native preview; CDP Page.printToPDF | replace |
| Save page | Save dialog, HTMLComplete | browserIntegration.ts:402-414 | `dialog.showSaveDialog`, `webContents.savePage` | native Save as; CDP captureSnapshot | replace |
| Find in page | Renderer bar over webview find | BrowserPanel.tsx:1351-1364 | `findInPage/stopFindInPage` | native find bar | replace |
| Zoom | Per-host, localStorage | BrowserPanel.tsx:272,1322-1336 | `setZoomFactor/getZoomFactor` | native per-origin zoom | replace |
| DevTools / inspect | Open/close/inspect; console+network capture for Orion | mainCapabilities.ts:264-427; BrowserPanel.tsx:1449 | `openDevTools`, `inspectElement`, `webContents.debugger` | native DevTools; CDP | replace |
| View source | New tab `view-source:` | browserIntegration.ts:380 | (URL scheme) | native | replace |
| User agent | Desktop UA with Electron token stripped; fixed mobile UA | BrowserPanel.tsx:190-193,1173 | `webview useragent`, `setUserAgent` | native UA + CDP Emulation | replace |
| Proxy/network | None (system defaults); adblock via webRequest | adblock/electron.ts:149-157 | `webRequest.*` | native proxy/auth/certs; DNR | replace; adblock via DNR + patch |
| Captcha detection | Read-only detect, show/scroll, never solve | browserControl/captchaCapabilities.ts; shared/captcha.ts | `executeJavaScript` | CDP Runtime.evaluate | portable logic; re-host |
| Context menu | Custom Electron `Menu` per element type | browserIntegration.ts:319-400 | `context-menu`, `Menu.buildFromTemplate` | native menu + patch for Orbis items | replace |
| Window management | Main + pop-out windows, fullscreen, single instance | index.ts:315-372,1107 | `BrowserWindow`, `requestSingleInstanceLock` | native | replace |
| Shortcuts / swipe | Central table; trackpad swipe recogniser | browserShortcuts.ts; browserIntegration.ts:177-311 | `before-input-event`, `before-mouse-event`, `app-command` | native accelerators; overscroll nav | must-work requirement, test |
| Session restore | URLs + groups in localStorage, manual restore | BrowserPanel.tsx:1291-1305 | none | native session restore | replace |
| Clipboard | Platform port + history + Orion | platformElectron.ts:13-34; personal/clipboard.ts; mainCapabilities.ts:980+ | `clipboard`, `ClipboardItem` | native page clipboard; OS listener for history | re-implement seam |
| File upload | Chromium default chooser | none | none | native; CDP DOM.setFileInputFiles for Orion | new for Orion |
| Notifications | Permission prompt; OS toast; Orbis workflow toast | browserIntegration.ts:42; index.ts:1316 | `Notification` | native | replace |
| Geolocation | Permission prompt only | browserIntegration.ts:42 | (permission) | native; needs location provider | risk (uncertain) |
| Default browser | Registers protocol clients, opens Settings | defaultBrowser.ts | `app.setAsDefaultProtocolClient` | native shell_integration | replace |
| Ad blocking | Ghostery engine: network, CSP, cosmetic, popup | adblock/*.ts | `webRequest`, `insertCSS`, preload | DNR extension + patch | redesign |
| Browser Control (Orion) | Capability registry over all of the above | browserControl/*.ts; pageHandle.ts | `webContents`, `debugger` | chromium/cdpPage.ts (partial) | in progress |

## 24. Baseline defects worth acting on (found while auditing)

1. `recordSavedPage` is never called by production code (`browserLibrary.ts:227`); the saved pages list stays empty.
2. `clearBrowsingData` clears only `persist:browser` (`index.ts:339`), not the active profile's partition.
3. Deleting a profile removes its data dir but no code clears its Electron partition storage (`personal/profiles.ts:79-88`).
4. Pop-out windows always use `persist:browser` (`index.ts:324`), so a non-default profile's pop-out uses the default one.
5. Private downloads are recorded in the library (`browserIntegration.ts:429-447` does not check `remembers`).
6. `clearFinishedDownloads` also deletes paused downloads (`browserLibrary.ts:466-469`).
7. The selection context menu hardcodes Google search (`browserIntegration.ts:367`).
8. No HTTP auth, certificate-error or display-media handlers exist; behavior in `<webview>` is uncertain.
9. Not confirmed in the Chromium CDP adapter (verify): print, save page, devtools, console/network capture, file input, permissions.
