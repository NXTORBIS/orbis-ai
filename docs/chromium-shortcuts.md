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

Status: this table lists Chromium 154's documented defaults. It has NOT been verified key by key with OS-level input in the running build;
the verification pass is still to do. No Orbis-only shortcut has been added (the panel has no keyboard command yet).

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

Not verified: Alt+Enter, F11, key-hold repeat, Ctrl+Shift+Y toggle-off and per-window panel state (harness aborted by the foreground guard).
