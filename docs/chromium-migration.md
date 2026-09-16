# Orbis → Chromium migration

Orbis is moving from Electron to a browser built directly from the Chromium source. This document is the plan and the
running status: what each part of Orbis depends on today, what replaces it, and whether it has moved yet.

It is kept honest. A row is only "done" when the feature works against real Chromium and its tests pass. Nothing is
marked done because it compiles.

## The shape of it

```
Orbis today                    Orbis after
-----------                    -----------
Orbis UI                       Orbis UI            (same code, new host)
   ↓                              ↓
Electron main                  Orbis browser layer
   ↓                              ↓
Chromium                       Chromium            (ours, built from source)
```

## What moves and what does not

Measured from the repository, not estimated.

| Layer | Lines | Fate |
| --- | ---: | --- |
| Renderer UI — every pixel of Orbis | 22,805 | Survives. Hosted as WebUI instead of an Electron renderer |
| Shared logic — pure TypeScript, no platform | 6,248 | Survives unchanged |
| Orion and AI | 2,666 | Portable. Talks to Groq, never to Electron |
| Orbis services — profiles, experience, updates, workflows | 4,995 | Mostly portable; needs a process to live in |
| Browser glue — integration, control, adblock, extensions, library | 8,872 | Rewritten against Chromium |

Roughly 78% survives. The rewrite is about 9,000 lines, concentrated in one place.

## The boundary that has to be rebuilt

96 IPC channels across 18 domains are the contract between the Orbis UI and the browser. In Chromium these become
Mojo interfaces and WebUI message handlers. This is the largest mechanical task and the likeliest place for silent
regressions, so each domain is migrated whole, with its probes re-run before it is marked done.

| Domain | Channels | Chromium equivalent |
| --- | ---: | --- |
| library (history, bookmarks, downloads) | 12 | `HistoryService`, `BookmarkModel`, `DownloadManager` |
| browser (tabs, panels, windows) | 8 | `TabStripModel`, `Browser`, `BrowserView` |
| adblock | 8 | `WebRequest` equivalent via `URLLoaderThrottle` |
| control (the Browser Control Layer) | 7 | Direct `WebContents` and `TabStripModel` calls |
| chat, image, voice (Orion) | 10 | Unchanged — a service, not a browser API |
| update | 6 | Unchanged design; new packaging |
| extensions | 6 | Chromium's own extensions system |
| shortcuts, window, omnibox, files, app, auth, settings, conversations, automation | 19 | Mixed; see the table below |

## Feature migration table

Status: `not started` · `in progress` · `done` (works against Chromium, tests pass) · `blocked` (needs a decision or
an external dependency)

| Feature | Current implementation | Electron dependency | Chromium equivalent | Orbis layer | Status | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Tabs, groups, split view | `BrowserPanel.tsx` + `<webview>` | `webContents`, webview tag | `TabStripModel`, `WebContents` | Browser layer | not started | probe-browser, probe-tabs-shortcuts |
| Tab state on switch | webview kept alive | webview tag | Chromium tab lifecycle | Browser layer | not started | probe-tabs-typing |
| Navigation, back/forward | `webview.goBack()` | webview tag | `NavigationController` | Browser layer | not started | probe-swipe |
| Two-finger history swipe | `historySwipe.ts` + `gestureAdapter.ts` | `before-mouse-event` | Chromium overscroll / input pipeline | Browser layer | not started | 24 unit tests |
| History, bookmarks, downloads | `browserLibrary.ts` (own JSON store) | `session`, `DownloadItem` | `HistoryService`, `BookmarkModel`, `DownloadManager` | Browser layer | not started | browserLibrary.test |
| Ad blocking | `@ghostery/adblocker-electron` | `session.webRequest` | `URLLoaderThrottle` + same engine | Browser layer | not started | adblock.test, probe-adblock |
| Extensions | `electron-chrome-web-store` | Electron sessions | Chromium extensions system | Browser layer | blocked — see Decisions | probe-extensions |
| Protected media (Widevine) | castLabs Electron | castLabs build | Own CDM licence + VMP signing | Chromium build | blocked — see Decisions | probe-widevine |
| Device pickers (USB/HID/serial) | `deviceChooser.ts` | session events | Chromium device chooser UI | Browser layer | not started | probe-devices |
| Permissions | `setPermissionRequestHandler` | `session` | `PermissionManager` | Browser layer | not started | probe-control |
| Profiles | `ProfilesStore` + partitions | `session.fromPartition` | Chromium `Profile` / `BrowserContext` | Services | not started | profiles.test, probe-profiles |
| Workspaces | `WorkspacesStore` | none | unchanged | Services | not started | workspaces.test |
| Personalization, themes, widgets | `experience/`, `widgets.ts` | none | unchanged | Services | not started | 40+ unit tests |
| Notes, tasks, clipboard, whiteboard | `personal/` | `clipboard` only | `ui::Clipboard` | Services | not started | 44 unit tests |
| Orion chat, vision, image generation | `nim.ts`, `intent.ts` | none | unchanged | Orion | not started | nim.test, research.test |
| Browser Control Layer | `browserControl/` + renderer capabilities | IPC to webview | Mojo to `WebContents` | Control layer | not started | 81 probe checks |
| Workflows and automation | `workflows/` | control layer | unchanged above a new control layer | Control layer | not started | 21 probe checks |
| Update system | `update/` | `app`, packaging | same design, new packaging | Services | not started | 47 unit tests |
| Internal pages (`orbis://`) | none | — | WebUI + registered scheme | Browser layer | not started | — |
| Orbis Search | none | — | WebUI page + existing `research.ts` | Browser layer | not started | — |

## Decisions needed before Phase 3

These can invalidate an acceptance criterion after months of work, so they are settled first.

1. **Widevine.** castLabs solved this for Electron; a Chromium build of our own needs its own CDM licence from Google
   and VMP signing. Until then, protected media does not play — a regression against what Orbis does today. Long lead
   time, so it starts now.
2. **Chrome Web Store.** Google gates Web Store API access with keys issued to Chrome. Forks fetch extension packages
   directly instead, which is what Orbis already does. "Chrome Web Store extensions" in the official sense is not
   available to a fork; the practice that works today does port.
3. **Google Sign-In.** Orbis already sends a clean Chrome user agent and is still refused. Being a standalone browser
   is likely to fix it, but that is not proven. Tested on a plain Chromium build early, before the migration depends
   on it.

## Build environment

| Requirement | State |
| --- | --- |
| Disk | 227 GB free — enough for a release build, not for a debug build |
| Visual Studio 2022 | Community 17.12 present |
| Windows SDK | **missing — blocks the build** |
| depot_tools | present at `C:\chromium\depot_tools` |
| Machine | 12 cores, 32 GB RAM — first build roughly 4–8 hours, then minutes |

## Phases

1. **Audit** — done. This document.
2. **Architecture** — decide what belongs to Chromium, the Orbis browser layer, Orbis services, Orion and the control
   layer. In progress: enforcing the portable boundary in code, so the surviving 78% provably does not touch Electron.
3. **Chromium foundation** — source tree, build, Orbis branding and packaging.
4. **Browser migration** — tabs, navigation, history, downloads, extensions, permissions, media.
5. **Orbis feature migration** — Orion, the control layer, workflows, profiles, personalization, everything else.
6. **Remove Electron** — only once every row above is done and its tests pass.
