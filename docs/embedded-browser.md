# Embedded browser (Chromium inside the Orbis window)

Orbis's browser opens in the same window as the chat, as the Electron browser did. "Return to chat" goes back to the chat; the browser keeps running with its tabs.

## Design
- Renderer: `BrowserView` (App.tsx, `.browser-view`) fills the content area with a header (Return to chat) and a `browser-view-region`. It measures the region (ResizeObserver, window resize, 250 ms poll) and sends it over `chromium:embed-region` (CSS rect, viewport width, DPR, visible).
- Main: `EmbedController` (src/main/chromium/embedController.ts) waits for Chromium's window (`findBrowserWindow(pid)`), then `embedWindow` (src/main/chromium/embed.ts, Win32 through koffi, MIT) strips caption/frame/sysmenu/min/max, sets WS_CHILD, `SetParent` to the Orbis HWND, and `SetWindowPos` places it. The CSS-to-pixel scale is the Orbis client width divided by the renderer viewport width, so display scale, page zoom and forced scale factors are all right without guessing.
- Return to chat: region reports `visible:false`, the child is hidden (`ShowWindow(SW_HIDE)`); the process and tabs live on. `chromium:show` (main to renderer) makes any opener (sidebar, Orion, links, `browser.open`) switch to the view; `chromium:closed` returns to chat.
- Launch passes `--orbis-embedded` (ignored by a Chromium without the matching patch) and does not focus the browser window from the control layer. `ORBIS_BROWSER_WINDOW=separate` restores the old separate window.
- Packaging: `asarUnpack: node_modules/koffi/**`.

## Verified (scripts/embed-check.mjs, real Electron + real Chromium, temp profile)
Child of the Orbis window; exactly covers the region (0-1 px); hide on Return to chat with the process alive; reopen re-shows with the same tabs; child follows an Orbis resize; screenshot of the Orbis window shows the Chromium tab strip, toolbar and page inside it.

## Not done / not verified
- The Chromium-side patch (`--orbis-embedded` frameless: hidden caption buttons, non-draggable caption area) is NOT written or built; without it Chromium's tab strip may reserve caption-button space on the right. Ctrl+N opens a normal top-level window until that patch exists.
- 150% DPI run, multi-monitor DPI moves, IME, touchpad gestures, drag between windows, OS-level omnibox typing, Ctrl+Shift+Y panel and menus/popups while embedded were not verified.
- Native Chromium sits above HTML: Orbis modals hide the browser view while open (settings, shortcuts); other overlays (toasts) can be covered.
- Installer build and installed-app smoke test not run.
