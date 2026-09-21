# New-tab page parity (Electron start page vs the built-in chrome://orbis-newtab, sources orbis-ui/newtab)

Electron (BrowserPanel `browser-newtab`, ShortcutsGrid, WidgetHost, `src/shared/experience.ts` NewTabConfig, `src/shared/widgets.ts`, `src/main/widgetFeeds.ts`): logo, shortcuts grid (max 24, add/edit/remove), widgets (clock, countdown, timer, tasks, notes, bookmarks, downloads, tabs, workspaces, clipboard, whiteboard, quote, games, calculator, greeting, world clock, weather, news, recent), wallpaper (user image data URL or Orbis gradient), greeting using `userName`, clock option, quote option, restore-last-time, quick links.

## Ported (orbis-ui/newtab/*, built into the browser; storage: the page's own localStorage inside the browser profile, so per profile)
- Shortcuts: add/edit/remove, max 24, same address rule as Electron (`siteUrl`); icons via `chrome://favicon2` (local).
- Greeting with a name (set in Customize; the Electron `userName` lives in the app, not reachable from the extension), show/hide.
- Clock: date and time, 12/24-hour, seconds, show/hide.
- Background: Orbis gradients drawn in CSS, or the person's own picture (kept locally, under 2 MB).
- Countdown widget (label + date).
- Most-visited tiles (Chromium's own top sites through the built-in handler; the seeded Chrome Web Store tile is dropped), search through the person's default engine (the same classifier as the address bar).
- Orbis look from the shared tokens (`orbis-tokens.css`, light and dark) and the assistant orb (quick Orion prompt).

## Not ported
- Weather, news: need network feeds (MET Norway, Nominatim, arbitrary feed URLs); would send location or make requests just to render the page.
- Quote: Electron's collection lives in the renderer views; not duplicated to avoid drift.
- Tasks, notes, clipboard, whiteboard, workspaces, games, timer, calculator, world clock, recent, bookmarks/downloads/tabs widgets: backed by Orbis app stores/IPC not reachable from an extension page.
- Restore-last-time: Chromium's own session restore. Private-tab note: not detectable here.
- Themes/density/accent from Experience: not shared with the extension.
Electron settings are not synced to the extension; the page starts at its own honest defaults and empty shortcuts.
