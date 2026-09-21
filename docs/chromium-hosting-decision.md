# Where the Orbis UI lives in Chromium: the decision

Date: 2026-09-20. Chromium 154.0.8037.44, our own Windows build (`C:\chromium\src`).

This decision was made after reading the Electron browser as the functional baseline (`docs/parity/01-browser-ui.md`,
`02-browser-services.md`, `03-orion-and-control.md`), the Chromium UI audit (`docs/chromium-ui-audit.md`), and after building and
testing the pieces below in the real Chromium build. The Electron code is a behavioural reference, not an architecture to keep.

## The question

Should the Orbis window become Chromium's own browser window, restyled and extended from inside (Chromium's WebUI and
browser-chrome architecture), or is a different Chromium-native hosting architecture better?

## Options weighed

| | A. Chromium's own browser window, Orbis-styled from inside | B. Orbis shell that embeds Chromium web contents (CEF / content-shell style embedder) | C. Keep Electron for the shell, Chromium only for pages |
|---|---|---|---|
| Real Chromium browser state (tabs, omnibox, predictions, history, bookmarks, downloads, permissions, profiles, sign-in) | All of it, because it is the real browser | Only what Orbis re-implements. Every one of those systems would have to be rebuilt, or lost | Not real: Electron cannot host the real browser |
| Extensions (MV3, Web Store, permissions, popups) | Native | Not available in an embedder without rebuilding the extension system | Limited |
| Google sign-in, sync | Works (confirmed by the user in this build) | Would need to be rebuilt; the reason for leaving Electron in the first place | Blocked (Electron cannot sign in) |
| Omnibox predictions from Chromium | Native. The WebUI location bar is a view over the real omnibox controller | Lost, or a parallel engine (forbidden) | Lost |
| Swipe, media, PDF, DevTools, printing, PWAs, DRM path | Native | Each re-implemented or lost | Partly |
| Orbis look | Achievable and partly proven (below) | Total freedom | Total freedom |
| Cost of following Chromium updates | A stack of small patches; the reapply script handles a sync; conflicts are possible | Lower for UI, but the browser features are then ours to maintain | n/a |
| Feature loss risk (the user's absolute rule) | Lowest | Highest | Highest (it is the current problem) |

## Decision

**A, done progressively and honestly.** Keep Chromium's real browser window and give it the Orbis identity from the inside.
Do not build a separate Orbis shell around embedded web contents, and do not keep Electron as the shell.

The Orbis UI is delivered through five Chromium-native layers, each of which keeps the underlying Chromium capability:

1. **Colour system (done, tested).** `patches/chromium-orbis-color-palette.patch` sets the Orbis palette in Chromium's shared sys-colour mixer.
   Every Views surface and every WebUI page that reads those tokens takes it, and the launcher forces dark mode.
2. **WebUI toolbar and address bar (done for look and typing, partly tested).** Chromium 154 ships a WebUI toolbar
   (`--enable-features=WebUIToolbar`) whose location bar is a *view* over the browser's real omnibox controller and whose suggestions popup is WebUI
   too. Restyling it keeps Chromium's predictions. Enter on a URL and on a query, and the Orion chip, were verified.
   Shift+Enter (system default browser) is patched. Ctrl+Enter is Chromium's own AI Mode, labelled Orion (user decision).
3. **Native tab strip, restyled (radius and colours done).** No WebUI tab strip exists in 154. Replacing the Views tab strip would mean
   re-implementing drag, groups, pinning, muting, audio and loading indicators, cross-window moves and restore, which is the definition of
   feature-loss risk. So the tab strip stays Chromium's and is restyled through the colour system and `tab_style.cc`.
   Revisit only if Chromium ships a WebUI tab strip, or if a specific Orbis tab behaviour cannot be met.
4. **Side panel (built in, phase 1b).** Orbis's panel is `chrome://orbis`, a WebUI compiled into the browser and hosted by Chromium's native side panel
   (toolbar button, app menu, Ctrl+Shift+Y); it replaces the extension-hosted UI. The app starts the browser with `--orbis-helper-port` / `--orbis-helper-token`;
   only the `chrome://orbis` document can read them (`chrome.send('orbis.getHelper')`, answered by a handler that exists only in that WebUI; never in a URL),
   its CSP allows `connect-src` only to `http://127.0.0.1:<that port>`, and the helper answers origin `chrome://orbis` (plus the component's own pages) with the token.
   Ad blocking is a **component extension** (id gcaebckmlhiagfagcplpjmibhkhjljab, `chrome/browser/extensions/component_loader.cc`) loaded from
   `resources/orbis_extension` (built from `extension/` by `scripts/stage-orbis-extension.mjs`): not listed in chrome://extensions, not removable, no toolbar
   button or side panel. `--orbis-extension-dir` runs it from a writable copy so filter-list updates keep working; `--load-extension` is used only when
   `ORBIS_DEV_EXTENSION=1`. The panel's Blocking tab reaches the worker through the helper (`adblock:control`, run by the app's ExtensionBridge over CDP).
   **Phase 2: the new tab page and Orbis Search are built in too.** `chrome://orbis-newtab` and `chrome://orbis-search` are WebUIs of the same `orbis` target
   (`orbis_ui.cc`; sources `orbis-ui/newtab`, `orbis-ui/results`, shared `orbis-ui/panel/helper.js`, `orb.js`). The extension keeps only the ad blocker (no page files,
   no `chrome_url_overrides`, no helper connection in session storage). One message handler serves the three pages: `orbis.getHelper` (all three; port and token
   are given to those documents only, judged by the frame's real address, never to any other page), `orbis.search` and `orbis.mostVisited` (new tab page only: the search
   goes through the AutocompleteClassifier, i.e. the person's own default engine, exactly as the address bar), `orbis.openPanel` (new tab and results, to show the
   native side panel). CSP `connect-src` is the loopback helper port only; images may come from https and from `chrome://favicon2`. The helper answers the origins
   `chrome://orbis`, `chrome://orbis-newtab`, `chrome://orbis-search`.
   **The new tab page URL** (`chrome/browser/search/search.cc`, `NewTabURLDetails::ForProfile`) is `chrome://orbis-newtab/` for every non-incognito profile whatever the
   search engine is, so `chrome://newtab` (Ctrl+T, the new tab button, a new window, startup) is rewritten to it before a navigation starts: the Google NTP
   (`chrome://new-tab-page`) and the third party NTP are never loaded, not even briefly. Verified by DevTools: the first main-frame navigation of a new tab is
   `chrome://orbis-newtab/` with no other request. (The tab's visible/virtual URL stays `chrome://newtab/`, so the omnibox is empty there, as in every browser.)
   **Default search** is `chrome://orbis-search/#q={searchTerms}` (`chromium-orbis-default-search.patch`). The query is in the fragment and a first navigation to a
   `chrome://` page with a fragment works (the extension-page `ERR_UNKNOWN_URL_SCHEME` quirk does not exist here; tested). Profiles whose default is the earlier
   `chrome-extension://gcaebck.../results.html` engine are moved to it once (`orbis.default_search_scheme_migrated`); explicit choices of any other engine are kept.
   **Ctrl+Enter** in the omnibox is an Orion answer inside Orbis (`chromium-orbis-newtab-and-orion.patch`: `OpenAiMode` opens `chrome://orbis-search/#q=...&in=orion`);
   **Shift+Enter** opens the destination in the system default browser (`chromium-orbis-shift-enter.patch`).
5. **Product identity (done).** Product name, strings, logo, icons and the new-tab page (Chromium's own `chrome_url_overrides`, local, Orbis logo, no Google).

Control and intelligence sit beside this, not inside it:

- **Browser Control Layer on Chromium:** `PageHandle` (Orion's contract) is implemented over the DevTools protocol by `CdpPage`; the control layer's own page
  code was run unchanged against real Chromium and passes (8 tests). One control layer, not two.
- **Ad blocker:** same lists and same engine as Electron, enforced through Chromium's declarativeNetRequest plus page filtering; tested in the real build.

## What this means for Electron

Electron stays only until parity is verified, as a reference and as the build that ships today. It is not a runtime fallback of the Chromium build and
nothing in `src/main/chromium/` or `extension*/` depends on it. When the checklist below is green, the Electron browser path is deleted, not hidden.

## Baseline defects found in the Electron browser: fix, do not port

From `docs/parity/02-browser-services.md`: the saved-pages list is never populated; clear-browsing-data only clears the default partition; deleting a
profile does not clear its storage; pop-out windows always use the default profile; private-tab downloads are recorded; "clear finished" also drops paused downloads.
The Chromium versions of these are Chromium's own behaviour, which is correct.

## Parity: the state of the checklist

Sources: the three parity documents (each ends in a feature table). Summary of status:

- **Native in Chromium, no Orbis work beyond looks:** tab basics, pin, mute, groups, find, zoom, fullscreen, context menus, downloads, history, bookmarks, permission
  prompts, extensions, DevTools, printing, PDF, PWA, site data controls, profiles, sign-in.
- **Done and tested:** Orbis look (palette, toolbar, tab radius, picker), product name and logo, new-tab page, ad blocker (network, page, popups, real statistics),
  Browser Control page layer over CDP, Shift+Enter.
- **Needs Chromium patches (not started):** Ask Orion entries in menus, Orion and research rows in omnibox suggestions (Chromium's prediction stays the source;
  extra rows only if added without replacing it), the mic button, per-profile private tabs in-window (Chromium's incognito is a separate window by design; adopt
  Chromium's behaviour and document the difference), the Orbis-only menu entries.
- **Needs Orbis UI in the side panel:** Orion chat (started), Notes, Tasks, Galaxy, Workflows, Secrets, the assistant orb, mobile view.
- **Needs the control layer moved:** `mainCapabilities.ts` (cookies, downloads, permissions, clipboard, extensions, devtools, history and bookmarks), the tab list and
  `readOpenPage`, tab groups and the private flag (extension APIs `tabs`, `tabGroups`, `downloads`, `history`, `bookmarks`, `cookies` are available to the Orbis extension), and
  the workflow recorder (hooks Electron's webview attach event).
- **Decisions needed from the user:** shortcut conflicts with Chromium's own keys (Ctrl+N, Ctrl+Shift+N, Ctrl+E, Ctrl+K, Ctrl+B, Ctrl+Shift+O, Ctrl+Shift+M);
  Widevine (licence); the layout modes (`full` only is real; user chose no new modes).
- **Unverified:** split view in 154; precision-touchpad swipe on hardware; the Web Store from this build; geolocation; download pause/resume over CDP.

## Order of work from here

1. Control layer on Chromium: tab/window/download/history/bookmark/permission capabilities through the Orbis extension + `CdpBrowser`, each tested against the real build.
2. Orbis side-panel panels (Orion first, then Notes/Tasks/Galaxy/Workflows/Secrets).
3. The Chromium patches above, one at a time, each with a regression run.
4. Switch Orion's page handle and the research/tab plumbing to Chromium; run the parity checklist.
5. Remove the Electron browser path; build; test again.

## Risks stated plainly

- Every UI change is a patch on a Chromium fork. A Chromium update means re-applying and re-testing them. The patches are small and isolated for this reason.
- The Orbis look inside Chromium's own window will not be pixel-identical to the Electron UI. Where Chromium's structure differs (Views tab strip shape, native menus), Orbis colours, radius and type are applied and the structure is kept.
- This decision assumes no-loss of Chromium features outranks pixel-matching the old Electron layout.
