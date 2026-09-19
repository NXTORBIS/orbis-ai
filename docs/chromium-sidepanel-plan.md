# Orbis inside real Chromium: the side-panel route

Why: Google refuses sign-in inside an embedded Electron view, and Orbis wants a real browser it can also customise and
control more deeply. A real Chromium build signs in to Google normally and handles trackpad swipe natively.

The fast route does not rebuild Orbis's shell. It puts Orbis *beside* the pages, in Chromium's side panel:

```text
Chromium (real tabs, real sign-in, native swipe)
   └── Orbis side panel  (the existing React UI, unchanged)
            │  local connection, with a per-run secret token
            ▼
       Orbis helper  (Node, runs on this computer, no cloud)
            └── chat, Search, memory, Galaxy, skills, notes, voice
```

## What the helper can host, checked against the code

Verified — these files import nothing from Electron, so they run in plain Node:

| Area | Files |
| --- | --- |
| Chat and Orion, long-answer continuation | `nim.ts`, `longGeneration.ts`, `compress.ts` |
| Orbis Search and research | `research.ts`, `knowledge/searchSessions.ts` |
| Memory, Galaxy | `knowledge/memory.ts`, `knowledge/galaxyService.ts` |
| Skills | `skillManager.ts` |
| Notes, saved settings and chats | `personal/notes.ts`, `store.ts` |
| Voice (local Whisper) | `whisper/service.ts`, `whisper/modelManager.ts`, `whisper/runtime.ts` |
| Widget feeds | `widgetFeeds.ts` |

Not yet checked: tasks, whiteboard, workspaces, profiles, workflows, the Browser Control Layer. Some use Electron
indirectly (a dialog, a window, a session), so they are not assumed portable.

## What cannot come across in the fast route

These are the parts that need Chromium's own browser process, i.e. the long route:

- The tab bar, sidebar and window Orbis draws itself (Chromium's own toolbar replaces them).
- Ad blocking on the browser session, extensions loading, permissions, downloads, history and bookmarks as Orbis
  manages them today.
- Full Browser Control: an extension reaches pages through a narrower API than Orbis's own webview control.
- The secrets vault, which encrypts with Electron's `safeStorage`. It needs another Windows-native way to protect
  secrets before it can move; until then it stays in Electron Orbis.

## Security rules for the helper (non-negotiable)

- Listens on `127.0.0.1` only, on a random port, with a secret token created each run and shared only with the panel.
- Webpages can never reach it: the panel is an extension page, and the helper refuses any request without the token
  or from another origin.
- Nothing about a page is sent anywhere except what the person asks Orion about, exactly as today.

## Order of work

1. Helper skeleton: WebSocket server, token, the same `window.api` surface for the verified areas above.
2. Panel shim: a `window.api` that speaks to the helper, so the React UI runs unmodified.
3. Load the panel in the built Chromium; test Google sign-in and swipe.
4. Add areas one at a time, each checked against the running Electron Orbis before it counts as done.

Estimates are guesses: a working first slice in days, full parity in months. The Chromium build (`C:\chromium`) is
needed for step 3 only; steps 1 and 2 do not need it.
