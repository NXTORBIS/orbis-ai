# Chromium capability audit: what this build can do, and what Orbis does with it

Build: Chrome/154.0.8037.44 (our own Windows build, `C:\chromium\src\out\Default`), Orbis patches applied.
Method: the web-platform, media, device and extension rows below were **probed in a running instance** (`probe-platform`, results in the
"Measured" column); the rest are read from source or the parity audits and are marked *(source)*. Nothing here is assumed from Chrome's feature list.

Classes: KEEP (already used, must stay), MIGRATE (in Electron Orbis, moving to Chromium), ADD (in Chromium, useful, not yet exposed), ADAPT (needs Orbis integration),
INTERNAL (useful inside, not for users), DEFER, UNSUPPORTED (unavailable or needs licensing/keys).

## 1. Web platform (measured in the running browser)

| Capability | Measured | Class | Notes |
|---|---|---|---|
| HTML/CSS/JS, WebAssembly | yes | KEEP | Blink/V8 |
| WebGL / WebGL2 | yes, ANGLE on Intel Iris Xe (D3D11) | KEEP | GPU process works |
| WebGPU | adapter obtained | KEEP | |
| WebRTC, getUserMedia, getDisplayMedia, device enumeration | yes; audioinput, videoinput, audiooutput listed | KEEP | prompts stay Chromium's |
| Service workers, Web/Shared workers, WebSockets, WebTransport, WebCodecs | present (SW *registration* not proven: my probe served the wrong MIME for `sw.js`, so it reported SecurityError) | KEEP | re-test with a real worker (open item) |
| IndexedDB, Cache Storage, localStorage, OPFS, File System Access | yes | KEEP | |
| Clipboard API, Notifications (permission `default`), Push, Geolocation | present | KEEP | permission prompts are Chromium's |
| Bluetooth, USB, Serial, HID, MIDI | present | KEEP | device choosers are Chromium's UI (see ADAPT) |
| Web Share, Payment Request, WebAuthn/passkeys, Credential Management | present | KEEP | |
| Picture-in-Picture, Document PiP, Media Session, Fullscreen, Screen Wake Lock | yes | KEEP / ADD | Orbis could expose PiP from its UI |
| Background Sync, Periodic Sync, Badging, Launch Queue (PWA), EyeDropper, View Transitions | yes | KEEP | |
| Speech synthesis; Speech recognition object | present (recognition depends on Google services, not used: Orbis voice stays local Whisper) | INTERNAL | |
| On-device AI web APIs (`Translator`, `LanguageModel`) | APIs present, model availability not tested | DEFER | do not route Orion through them |
| WebNN | absent | UNSUPPORTED | |

## 2. Media and codecs (measured)

| Capability | Measured | Class | Notes |
|---|---|---|---|
| VP9, AV1, Opus, MP3, FLAC | "probably" | KEEP | most video sites work |
| **H.264 (avc1), AAC, HEVC** | **not supported** | **DECISION NEEDED** | This is the stock Chromium codec set. Many sites serve MP4/H.264 or AAC only. Fixing it means rebuilding with `proprietary_codecs=true ffmpeg_branding="Chrome"`. Those codecs are patent-licensed (H.264, AAC); building and using them personally is common, distributing Orbis with them is a licensing question for you. I have not changed the build. |
| Widevine (DRM) | not available (`NotSupportedError`) | UNSUPPORTED | Needs a Google licence; not bypassed and not copied from Chrome |
| ClearKey | `NotSupportedError` here, because it was probed with H.264 | – | expected to work once H.264 is available |
| PDF viewer | yes: the built-in PDF extension (`mhjfbmd…`) loaded in the tab | KEEP | print/save/search/zoom are the viewer's own |

## 3. Browser pages that exist in the build (measured: each opened as a real page)

settings, history, downloads, bookmarks, extensions, password manager, tab search, reading list (side panel), bookmarks side panel,
history-clusters side panel, profile picker, apps, management, components, crashes, gpu, flags, version, accessibility, net-internals,
serviceworker-internals, webrtc-internals, sync-internals, signin-internals, translate-internals, predictors, media-engagement, device-log, system, inspect, print.
`omnibox`, `discards` and `safe-browsing` open but report "internal debugging pages are currently disabled".

These are the real implementations of History, Downloads, Bookmarks, Extensions, Passwords, Settings and Reading list. Orbis should use them (restyled through
the colour system) instead of rebuilding them. Class: KEEP, with ADAPT for the Orbis look and entry points.

## 4. Extension APIs available to the Orbis extension (measured)

action, bookmarks, browsingData, cookies, debugger, declarativeNetRequest, downloads, history, management, permissions, runtime, scripting, search, sessions,
sidePanel, storage, tabGroups, tabs, topSites, webNavigation, windows.

Not yet declared but available in Chromium and useful: **readingList**, contentSettings (per-site permission defaults), pageCapture (MHTML save), idle, notifications,
system.* (cpu, memory, display, storage), tts, fontSettings, privacy, webRequest (observation only in MV3), commands (extension keyboard shortcuts), alarms, offscreen,
identity (browser sign-in account info; must stay separate from Orbis Chat). Class: ADD, each needs a manifest permission and a decision.

## 5. Feature-by-feature classification (browser UI and services)

| Area | Chromium mechanism | Class | State |
|---|---|---|---|
| Tabs: create, close, activate, pin, mute, move, duplicate, reopen | `chrome.tabs`, `sessions` | MIGRATE | control capabilities done and tested |
| Navigation back/forward/reload/stop/go | CDP page + history | MIGRATE | done and tested |
| Tab groups | `chrome.tabGroups` | MIGRATE | next batch |
| Recently closed tabs and windows | `chrome.sessions.getRecentlyClosed` | MIGRATE / ADD | next batch |
| Windows: create, close, list, state, bounds, fullscreen | `chrome.windows` | MIGRATE | list/create/close done; state/bounds next |
| Downloads: list, start, wait, remove, clear; pause/resume/cancel/open/show/retry | `chrome.downloads` | MIGRATE | first set done; pause/resume/cancel/open/show next |
| History, bookmarks (with folders) | `chrome.history`, `chrome.bookmarks` | MIGRATE | done and tested |
| Reading list | `chrome.readingList` and the built-in side panel | ADD | Electron has a reading list; Chromium's is native. next batch |
| Cookies, clear data | `chrome.cookies`, `browsingData` | MIGRATE | done and tested |
| Zoom (real page zoom, per-site) | `chrome.tabs.setZoom/getZoom` | MIGRATE | next batch |
| Find in page | Chromium's find bar (Views) | ADAPT | no extension API; restyled by colour system; keyboard Ctrl+F is native |
| Print, save as PDF, save page (MHTML), view source | CDP `Page.printToPDF`, `Page.captureSnapshot`, `view-source:` | MIGRATE | next batch; native Ctrl+P preview is Chromium's |
| Permissions and site settings | Chromium's prompts and `chrome://settings/content` | KEEP | listing/answering via `contentSettings` is an ADD |
| Extensions: list, enable, disable, remove, options, permissions | `chrome.management`, `chrome://extensions` | MIGRATE | next batch; installing needs the Web Store (unverified from a non-Google build) |
| Omnibox, predictions, history/bookmark suggestions | Chromium's omnibox controller (WebUI toolbar) | KEEP | verified Enter path; suggestion list styling unverified |
| Ctrl+Enter, Shift+Enter | AI Mode label "Orion"; patched default-browser hand-off | KEEP | Shift+Enter handoff not confirmed by a visible default-browser launch |
| Tab strip | Views tab strip, restyled | KEEP / ADAPT | palette + radius done; the full Orbis tab shape is still open |
| Sign-in, profiles | Chromium's flows, restyled | KEEP | separate from Orbis Chat and Orion by design |
| Private browsing | Chromium incognito (separate window) | ADAPT | differs from Orbis in-window private tabs; decision recorded |
| Session restore, crash recovery | Chromium's | KEEP | |
| DevTools | built-in | KEEP | entry point via Orbis menu is ADAPT |
| PWA install, standalone windows | Chromium's | KEEP / ADD | not tested |
| Safe Browsing | code present; needs Google API key to work | UNSUPPORTED until keys exist | not faked |
| Sync | `chrome://sync-internals` exists; needs Google API keys and sign-in | UNSUPPORTED until configured | not claimed |
| Ad blocking | DNR + page engine | MIGRATE | done and tested |
| Widevine | – | UNSUPPORTED | see section 2 |

## 6. What this audit changes in the plan

1. **Codecs are the biggest real-world gap found**, and it is a licensing decision: see section 2. Everything else in the web platform is present.
2. The built-in pages (history, downloads, bookmarks, extensions, passwords, reading list) are real and themed: Orbis should link to them and restyle them, not rebuild them.
3. Two APIs Orbis had in Electron and Chromium provides natively should be exposed: reading list, and per-site content settings.
4. Open verification items: service-worker registration with a real worker; PWA install; Shift+Enter visible hand-off; suggestion popup styling; touchpad swipe on hardware; Web Store from this build.
