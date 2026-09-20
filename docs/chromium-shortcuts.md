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
