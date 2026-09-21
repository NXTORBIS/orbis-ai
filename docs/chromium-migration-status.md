# Chromium migration: where things stand

As of 2026-09-20. Every "verified" item was run against the real Chromium 154 build (`out\Default`, with H.264/AAC enabled) and the Orbis
extension; "written, not run" means the code exists and typechecks but has not been seen working in a real browser.
The Electron browser is still the shipping browser: nothing below has replaced it yet. See `docs/chromium-hosting-decision.md` for the architecture
and `docs/parity/*.md` and `docs/chromium-capability-audit.md` for the feature-by-feature baseline.

## Verified on the real browser

| Area | What was checked |
|---|---|
| Browser build | Chromium 154 with proprietary codecs: H.264, HEVC, AAC, VP9, AV1, Opus, MP3, FLAC play; ClearKey works; Widevine unavailable (licence) |
| Look | Orbis palette in the shared colour system (Views + WebUI), WebUI toolbar and location bar restyled, tab radius, profile picker, product name and logo |
| Ad blocker | network blocking through declarativeNetRequest (same lists), element hiding for dynamic ads, popups, real statistics, per-site exceptions, off switch, restart survives (18 checks) |
| Control layer, page level | `PageHandle` on real tabs: read, click, type, submit, screenshot, history, accessibility tree, closed-tab handling (7 checks) |
| Control layer, browser level | tabs (create/list/pin/mute/move/duplicate/activate/close/reopen), navigation, windows, downloads (start/list/wait/clear/pause/resume/cancel), history, bookmarks, cookies with approval, tab groups, zoom, print to PDF, save MHTML, view source, extensions list + self-protection, recently closed, reading list (23 checks) |
| Control service | one control layer with browser + page + CAPTCHA capabilities, following the real tabs (4 checks) |
| Orion's browser agent | the unchanged agent completes a real task on Chromium (open, read, type, submit, read results, answer), with only the model's replies scripted (3 checks) |

All 33 real-browser tests run serially with `npm test` (`--test-concurrency=1`; parallel windows fight for focus).

## Written, not yet run in a real browser

- Side-panel Notes and Tasks tabs and their helper channels (the channels have HTTP-level tests; the panel UI has only been syntax-checked).
- New-tab page (`chrome://orbis-newtab`, built in; Chromium's new tab URL resolves to it from the first paint): shortcuts, greeting, clock, background, countdown, search, most visited; verified in the real build.
- Orbis Search results (`chrome://orbis-search`, built in) as Chromium's default search; Ctrl+Enter = Orion answer; verified in the real build.

## In progress

- **Orbis Search as the default search engine.** Chromium patch `patches/chromium-orbis-default-search.patch` makes "Orbis Search" the first (default)
  engine; its results page is the built-in `chrome://orbis-search` (phase 2; mirrors the Electron results page: search box, verticals, results with real sites, Orion
  on request with real sources, and an explicit "try Google instead"). Profiles that still had the untouched Google default, or the earlier extension-page Orbis engine, are moved once; any engine the person chose is kept.

## Chromium is now Orbis's browser (2026-09-20)

When a Chromium build is installed, the Orbis app opens Chromium for everything that used to open the in-app browser (address bar, links, research sources, "open the browser", `browser.open`) and Orion's browser agent works in Chromium's tabs. Verified on the real app: from the Orbis window, `chromiumOpen('how do tides work')` started Chromium with `--remote-debugging-pipe` (no port), whose window title was the Orbis Search results. The in-app browser panel did not open. Chromium is started per Orbis profile (own data folder), with the extension copied to a folder Orbis owns and the helper running inside Orbis. `ORBIS_BROWSER=electron` is a developer switch that keeps the old in-app browser reachable until it is removed; nothing falls back to it automatically. Not done: shipping Chromium and the extension inside the installer (electron-builder resources), the Electron renderer's browser UI still exists in the source, and the remaining capability families.

## Finished since (2026-09-20, verified on the real browser unless noted)

- Packaging: `npm run stage:browser` builds the ad-block assets and extension bundles and stages Chromium (`resources/chromium`, about 1.6 GB); `electron-builder` ships it with the extension. A packaged copy of the app started Chromium over the pipe and opened the Orbis Search results. Orbis grants the browser's sandbox read access to its own browser folder when it is missing (needed outside the dev build). The NSIS installer itself was not run.
- Ad blocker: the lists' page scripts and element hiding run before the page's own scripts (CDP-paused loads); a monetized YouTube video showed no ad with it and an ad without.
- Capabilities on Chromium: site permissions (only those Orbis set), find text, clipboard copy from the page, console and network capture, navigation details, ad-blocker settings. Browser UI by real OS input (Windows only, `browserUi.ts` + `chromiumCapabilities5.ts`): `devtools.open/close/inspect`, `addressBar.focus/type/submit/read/clear/suggestions`, `browser.shortcut`. They send genuine key presses (SendInput) to the window of the browser process Orbis launched (found by pid), fail with a typed `blocked` error if Windows refuses to bring it to the front, and are verified through CDP targets, the tab URL, and UI Automation (address bar text). See the limits noted in the test file.
- Workflow recording on Chromium (link click, typing, password never recorded, Enter, new tab). Not recorded: tab groups; downloads are polled and not covered by a test.
- Side panel: Workflows, Galaxy and Secrets tabs (secret values never reach the panel; no reveal or copy). Galaxy omits meteors, linking, and Ask Orion / save actions.
- Renderer: the in-app browser UI (`BrowserPanel` and its sidebar, toolbar, tab menu and orb) is deleted; `ORBIS_BROWSER=electron` and webview support are gone. Open browser actions go only to Chromium.

## Not done

- Main-process Electron browser code is still in the source but no longer reachable from the interface: `browserIntegration`, `extensions/manager`, `adblock/electron`, `BrowserLibrary`, the Electron capability set in `browserControl/mainCapabilities.ts`, and dead `.browser-*` styles. Chat features (ad-block chat commands, library data) still use some of it, so removing it is its own careful change.
- Address bar and menus stay Chromium's own (restyled), per `docs/chromium-hosting-decision.md`; no Orbis-drawn tab strip. CDP cannot drive the omnibox, so `addressBar.*` uses real key input plus UI Automation reads (needs the browser window in front; Windows only).
- Shortcut decisions: written in `docs/chromium-shortcuts.md` (Chromium wins); per-key verification in the running browser not yet done.
- Widevine, Safe Browsing and Sync (need Google licences/keys; not faked). H.264/AAC ship enabled: redistribution needs patent-licence awareness.
- Existing profiles: `patches/chromium-orbis-default-search.patch` now runs a one-time migration (pref `orbis.default_search_migrated`) that switches the default to Orbis Search only when it is the untouched prepopulated Google engine. Verified on a copy of an old profile (Google -> Orbis Search), with the migration disabled (stays Google), and with DuckDuckGo chosen in Settings (stays DuckDuckGo after the migration runs). Limitation: an owner who deliberately picked untouched prepopulated Google earlier cannot be told from the old default and is switched once; Google remains selectable.

## Known differences from the Electron browser

- Private browsing is Chromium's separate-window incognito, not Orbis's in-window private tabs.
- The layout modes are `full` only in the Electron code; no new modes were built (user decision).
- Weather, news, quote and the app-backed new-tab widgets are not on the built-in new-tab page (see `docs/newtab-parity.md`).


## Installer test (2026-09-21)
NSIS installer builds (532 MB), installs, launches Chromium from the installed location, ACL granted automatically, uninstalls cleanly. Details: docs/installer-test.md.

## Update 2026-09-21 (panel rail, real-browser check, packaging)

Verified in a real build (own launched Chromium 154.0.8037.44, real helper, temp-dir stores seeded through the app's own store classes; harness `scripts/panel-real-check.mjs`):
- The rail (sidebar.js) rendered nothing in the real WebUI at first: the icon helper used `DOMParser`, which Trusted Types forbids on the built-in pages. Fixed (`orbis-ui/panel/rail/icons.js` builds SVG nodes with `createElementNS`); the headless-Chrome harness could not show this. After the fix the whole rail renders in the native side panel (screenshots `docs/native-side-panel-rail.png`, `docs/panel-rail-tabs-view.png`).
- Rows checked against real data: Tabs (favicons through chrome://favicon2, pin, move, close; activate through the row), Tab groups (group created and listed), Media (a tab made audible by WebAudio is listed and muted from the row), Controls (zoom step, real percentage read through `zoom.get`, reload), Saved pages, Screenshots (incl. a missing file), Reminders, Clipboard (secret masked, reveal shows it), Whiteboard, Research and Sources (window.open of `chrome://orbis-search/#q=...&s=<id>` opens the results page in the real WebUI; a source opens its page), Workspaces (save, list, open through `browser.openWorkspace`), rail resize, arrange mode, pin and drag reorder (persisted through `sidebar:save`).
- `zoom.get` has a real-browser assertion in `chromiumCapabilities2.test.ts`.
- Customize-chrome side panel: the mini/corner new-tab mock svgs no longer carry the Chrome logo or Google blues (Orbis ring mark, token colours); the theme colour swatch seeds (blue, aqua, green, citron, rose) are Orbis accent-family colours. Built, not screenshotted in the running panel.
- Picture-in-picture: the hover bar is already in the Orbis palette (dark scrim, accent progress, accent badge) through the colour tokens; captured with PrintWindow (`docs/pip-hover-bar.png`). No further restyle.
- Installer 0.3.0 (549 MB) installed silently, smoke-tested (search opens over the pipe, title, ACL, built-in panel via Ctrl+Shift+Y shows Connected), uninstalled: `docs/installer-test.md`.

Not verified / limits:
- The panel's own document in the side panel (as opposed to the same WebUI opened as a tab) was only looked at, not scripted: row checks drove chrome://orbis in a tab. The tab stays visible so the panel's polling views ran there. The app registers `browser.openWorkspace` itself (src/main/index.ts); the harness registered the same capability on the browser control.
- The panel is narrow (about 480 px) beside a 190 px labelled rail, so content is cramped; no auto-collapse to icons yet.
- Customize-chrome panel was not opened in the running browser after the swatch/svg edit.
- Helper token is passed on the browser command line (`--orbis-helper-token`), visible to same-user processes.
- One stray Ctrl+Shift+Y was sent to the desktop when a capture script failed to compile before its foreground check (fixed: the script now stops on error); no other keys were sent outside a verified browser window.
- Widevine, Sync and Safe Browsing remain unavailable (licences/keys).
