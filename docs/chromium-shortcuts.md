# Chromium shortcuts: decision table

Rule: Chromium's own behaviour wins for every key Chromium has. The Electron-era browser table (deleted with the in-app browser) contained only
standard browser actions, all of which Chromium already provides, so the browser adds no Orbis-only shortcut on a key Chromium uses. The "reserved"
combinations of the old table (Ctrl+N, Ctrl+B, Ctrl+K, Ctrl+Shift+O, Ctrl+, ...) belonged to the Orbis chat window, not to the browser.

| Key | Behaviour in the Chromium build | Decision |
|---|---|---|
| Ctrl+N | New window | Chromium's |
| Ctrl+Shift+N | New incognito window | Chromium's |
| Ctrl+E, Ctrl+K | Search from the address bar | Chromium's |
| Ctrl+B | Not bound to a browser command on Windows Chromium (Ctrl+Shift+B toggles the bookmarks bar) | Chromium's; left free |
| Ctrl+Shift+O | Bookmark manager | Chromium's |
| Ctrl+Shift+M | Profile switcher menu | Chromium's |

Status: this table lists Chromium 154's documented defaults; observed behaviour of the running build is in the two sections below.
Orbis-only shortcut: Ctrl+Shift+Y toggles the Orbis side panel (IDC_SHOW_ORBIS_SIDE_PANEL); no other Orbis-only key exists.

## Observed behaviour (Views 6 verification, real OS input on a temp-profile build, partial)

Method: own pid only, foreground verified before every key (BrowserUi), tab/window counts from CDP /json/list.

| Key | Observed |
|---|---|
| Ctrl+T | +1 tab, target chrome://newtab/ (single press, no double firing) |
| Ctrl+W | -1 tab |
| Ctrl+Shift+T | no change when the closed tab was the New Tab page (not reopened); not tested with a real page |
| Ctrl+N / Ctrl+Shift+N | +1 window each (title "... - Orbis") |
| Ctrl+Shift+O | chrome://bookmarks/ opened |
| Ctrl+L, Ctrl+E, Ctrl+K | omnibox focused (no tab change) |
| Ctrl+F | find bar (Find edit + Close find bar button in UIA) |
| Ctrl+P | print preview (no extra window) |
| Ctrl+Shift+M | profile menu with Customize / Add Orbis profile / Guest / Manage Orbis profiles |
| Ctrl+Shift+Y | Orbis panel: chrome://orbis/ appears as a page target |
| Ctrl+B | nothing (no target/window change) |
| Ctrl+Shift+B | Bookmarks bar toggled |
| F5, Ctrl+R, Ctrl+Tab, Ctrl+2, Ctrl+9 | no tab/window count change (reload/switch; not otherwise observed) |
| F12 | DevTools target appears, second F12 removes it |
| Ctrl+Enter (omnibox, "hello world") | current tab navigated to chrome://orbis-search/#q=hello+world&in=orion (correct) |
| Enter (omnibox, "foo") | chrome://orbis-search/#q=foo |
| Shift+Enter (https://example.com/) | window lost foreground and the Windows "Open with" chooser (OpenWith.exe) appeared: the URL was handed to the shell, but this machine's https handler (Comet ProgId) shows the chooser instead of launching a browser. Not verified further; the dialog then blocked foreground for later tests. |

## Observed behaviour, second pass (Views 6, Orbis build with the panel-key fix)

Method: own pid only, `BrowserUi` (foreground of the pid verified in the same step as every key), temp profiles, CDP to observe (`scripts/orbis-views6-keys.mjs`,
`orbis-views6-keys2.mjs`, `orbis-views6-panel2.mjs`, `orbis-views6-menus.mjs`). Shift+Enter was NOT pressed (it made Windows show an "Open with" dialog earlier).

| Key | Observed |
|---|---|
| Ctrl+T | +1 tab. The CDP target list shows the visible URL `chrome://newtab/`, but the page really is the Orbis new tab page: `location.href` = `chrome://orbis-newtab/`, `document.title` = "New Tab", the tab's navigation history has exactly 1 entry (committed `chrome://orbis-newtab/`, user-typed `chrome://newtab/`), so it is the first and only navigation and no Google page was involved. Screenshot: `docs/views6-shots/keys-ctrlT-ntp.png` (Orbis orb, greeting, search box, shortcuts). The CDP URL is the browser's URL rewriting (the patch shows chrome://newtab in the address bar), not a wrong page. |
| Ctrl+W then Ctrl+Shift+T (a real page, title REAL-B) | the closed tab is reopened with its page (2 page tabs again) |
| F5, Ctrl+R | each reloads: the local page's server hit counter went 1 -> 2 -> 3 |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1, Ctrl+2, Ctrl+9 | active tab changes as expected, observed by `document.visibilityState` per tab: Ctrl+1 first tab, Ctrl+Tab next, Ctrl+Tab next, Ctrl+9 last tab, Ctrl+2 second tab, Ctrl+Shift+Tab previous |
| F11 | window state `fullscreen` (bounds = the whole screen), second F11 back to `normal` with the original bounds |
| Alt+Enter (URL typed in the omnibox) | opens the address in a NEW tab (tabs 3 -> 4, the local server saw exactly one hit) |
| Key held ~1 s (12 key-downs: first, then repeats every ~33 ms after a 500 ms delay, real typematic pattern via SendInput) | Ctrl+T: exactly +1 tab; Ctrl+W: exactly -1 tab; Ctrl+Shift+Y: exactly one toggle; Ctrl+Enter in the omnibox: one navigation. Chromium ignores auto-repeat for these accelerators here, so the Orbis additions (panel toggle, Ctrl+Enter) do not fire repeatedly. Not compared against a stock Chromium build (none was run); no fix needed. |
| Ctrl+Shift+Y | opens the Orbis side panel, the second press closes it, the third opens it again (page width 1186 -> 800 -> 1186 -> 800). Per window: a new window (Ctrl+N) starts without the panel, the key opens it only in the window that got it, the other window is unchanged (checked with the "Close side panel" button in each window's UI Automation tree). |


Bug found and fixed in this pass: while the Orbis panel had keyboard focus (which it does right after Ctrl+Shift+Y), NO browser shortcut worked: Ctrl+Shift+Y
did not close the panel again, Ctrl+N and Ctrl+T did nothing (`docs/views6-shots/panel-press2.png` shows the panel still open after the second press).
Cause: the panel was a plain `views::WebView`, which drops keys the page does not use. Fix: `patches/chromium-orbis-a11y-final.patch` (class `OrbisPanelWebView`
in `side_panel_helper.cc` hands unhandled keys to the window's accelerators, as the other side panels do). Verified after the rebuild with the results above.

Other observations in the same run: the app menu opens with Alt+F, Escape closes it, Down/Up move the highlight (focus reported by UI Automation: "New window Ctrl+N",
"New Incognito window Ctrl+Shift+N"); Shift+F10 in the address bar opens its context menu (Undo/Cut/Copy...), Down moves, Escape closes; F6 focuses the address bar;
Alt+Shift+T focuses the toolbar (Reload first), Tab then goes Site information -> Address and search bar -> Bookmark this tab -> Orbis pinned button ->
profile chip -> app menu -> back to Reload.
