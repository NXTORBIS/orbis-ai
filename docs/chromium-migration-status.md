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

## Not done

- Nothing in the running Orbis app calls the Chromium control service yet; Orion still goes through Electron.
- Capabilities still on Electron: permissions and site settings, find in page, clipboard, address-bar capabilities, settings, workflows recorder.
- Orbis-shaped tab strip (colours and radius only so far), Orbis menus, sidebar/assistant, Galaxy/Workflows/Secrets panels.
- Shortcut decisions (Ctrl+N, Ctrl+Shift+N, Ctrl+E, Ctrl+K, Ctrl+B, Ctrl+Shift+O, Ctrl+Shift+M vs Chromium's own).
- Widevine, Safe Browsing and Sync (need Google licences/keys; not faked).
- Removing the Electron browser (only after parity is verified).

## Known differences from the Electron browser

- Private browsing is Chromium's separate-window incognito, not Orbis's in-window private tabs.
- The layout modes are `full` only in the Electron code; no new modes were built (user decision).
- Weather, news, quote and the app-backed new-tab widgets are not on the extension new-tab page (see `docs/newtab-parity.md`).
