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
- New-tab page features: shortcuts, greeting, clock, background, countdown (pure logic tested; UI not seen).
- Orbis Search results page as Chromium's default search (see below).

## In progress

- **Orbis Search as the default search engine.** Chromium patch `patches/chromium-orbis-default-search.patch` makes "Orbis Search" the first (default)
  engine; its results page is `extension/results.html` (mirrors the Electron results page: search box, verticals, results with real sites, Orion
  on request with real sources, and an explicit "try Google instead"). Existing profiles keep the engine they already have until it is chosen once
  in Settings; new profiles default to Orbis.

## Chromium is now Orbis's browser (2026-09-20)

When a Chromium build is installed, the Orbis app opens Chromium for everything that used to open the in-app browser (address bar, links, research sources, "open the browser", `browser.open`) and Orion's browser agent works in Chromium's tabs. Verified on the real app: from the Orbis window, `chromiumOpen('how do tides work')` started Chromium with `--remote-debugging-pipe` (no port), whose window title was the Orbis Search results. The in-app browser panel did not open. Chromium is started per Orbis profile (own data folder), with the extension copied to a folder Orbis owns and the helper running inside Orbis. `ORBIS_BROWSER=electron` is a developer switch that keeps the old in-app browser reachable until it is removed; nothing falls back to it automatically. Not done: shipping Chromium and the extension inside the installer (electron-builder resources), the Electron renderer's browser UI still exists in the source, and the remaining capability families.

## Finished since (2026-09-20, verified on the real browser unless noted)

- Packaging: `npm run stage:browser` builds the ad-block assets and extension bundles and stages Chromium (`resources/chromium`, about 1.6 GB); `electron-builder` ships it with the extension. A packaged copy of the app started Chromium over the pipe and opened the Orbis Search results. Orbis grants the browser's sandbox read access to its own browser folder when it is missing (needed outside the dev build). The NSIS installer itself was not run.
- Ad blocker: the lists' page scripts and element hiding run before the page's own scripts (CDP-paused loads); a monetized YouTube video showed no ad with it and an ad without.
- Capabilities on Chromium: site permissions (only those Orbis set), find text, clipboard copy from the page, console and network capture, navigation details, ad-blocker settings. Developer-tools window (`devtools.open/close/inspect`) is reported unavailable: a pipe-controlled browser cannot open it.
- Workflow recording on Chromium (link click, typing, password never recorded, Enter, new tab). Not recorded: tab groups; downloads are polled and not covered by a test.
- Side panel: Workflows, Galaxy and Secrets tabs (secret values never reach the panel; no reveal or copy). Galaxy omits meteors, linking, and Ask Orion / save actions.
- Renderer: the in-app browser UI (`BrowserPanel` and its sidebar, toolbar, tab menu and orb) is deleted; `ORBIS_BROWSER=electron` and webview support are gone. Open browser actions go only to Chromium.

## Not done

- Main-process Electron browser code is still in the source but no longer reachable from the interface: `browserIntegration`, `extensions/manager`, `adblock/electron`, `BrowserLibrary`, the Electron capability set in `browserControl/mainCapabilities.ts`, and dead `.browser-*` styles. Chat features (ad-block chat commands, library data) still use some of it, so removing it is its own careful change.
- Address bar and menus stay Chromium's own (restyled), per `docs/chromium-hosting-decision.md`; no Orbis-drawn tab strip. A program cannot drive Chromium's omnibox over the pipe (Orion navigates with `navigation.*`/`tabs.create`).
- Shortcut decisions (Ctrl+N, Ctrl+Shift+N, Ctrl+E, Ctrl+K, Ctrl+B, Ctrl+Shift+O, Ctrl+Shift+M vs Chromium's own).
- Widevine, Safe Browsing and Sync (need Google licences/keys; not faked). H.264/AAC ship enabled: redistribution needs patent-licence awareness.
- Existing profiles keep Google as their search engine until Orbis Search is chosen once in Settings.

## Known differences from the Electron browser

- Private browsing is Chromium's separate-window incognito, not Orbis's in-window private tabs.
- The layout modes are `full` only in the Electron code; no new modes were built (user decision).
- Weather, news, quote and the app-backed new-tab widgets are not on the extension new-tab page (see `docs/newtab-parity.md`).
