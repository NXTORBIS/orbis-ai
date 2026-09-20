# The Orbis boundary, and what it becomes in Chromium

Every way the Orbis interface asks the application for something. Today these are Electron IPC channels; in the
Chromium browser they become Mojo interfaces and WebUI message handlers.

This file is checked by `src/main/ipcMapping.test.ts`: every channel in the code must appear here, and every channel
here must exist in the code. Neither can drift from the other while the migration is under way.

## How the boundary changes

```
today                                    after
-----                                    -----
renderer  --ipcRenderer.invoke-->        WebUI page  --Mojo-->  browser process
main      --ipcMain.handle-->            C++ handler implementing the interface
```

Three kinds of channel, and each moves differently:

| Kind | What it is | Becomes |
| --- | --- | --- |
| **Browser** | Asks the engine to do something — tabs, navigation, downloads, permissions | A Mojo interface onto Chromium's own browser objects |
| **Service** | Orbis's own data — profiles, notes, personalization, updates | A Mojo interface onto the same TypeScript/Node service, or its C++ port |
| **Orion** | The AI, which never touched the engine | Unchanged. It is a service that happens to answer questions |

The service and Orion channels are the easy two thirds. The browser channels are the migration.

## The map

### Browser — becomes Mojo onto Chromium's browser objects

| Channel | Does | Chromium equivalent |
| --- | --- | --- |
| `chromium:open` | Opens the Orbis browser (Chromium) at an address or a search | `BrowserManager.open`: starts Chromium over a pipe, then a tab |
| `chat:browser-confirm` | The user's yes or no to a browser action Orion proposes in chat | Unchanged: an approval card in the Orbis window |
| `window:fullscreen`, `window:is-fullscreen` | Window fullscreen | `FullscreenController` |
| `shell:openExternal` | Opens a link outside Orbis | `platform_util::OpenExternal` |
| `files:pickImages`, `files:pickText` | File dialogs | `ui::SelectFileDialog` |
| `system:cpu` | Load, for the status strip | `base::SystemMonitor` |

### Library — becomes Chromium's own services rather than Orbis's JSON files

This is the one place where Chromium does it better than we do, and the port is a genuine upgrade.

| Channel | Does | Chromium equivalent |
| --- | --- | --- |
| `library:get` | Everything at once | Orbis's own library plus a copy of Chromium's history, bookmarks and downloads, refreshed on demand (`browserMirror.ts`) |
| `library:toggle-bookmark` | Bookmarks | Bookmarks are Chromium's: this adds or removes the bookmark in the browser through its extension, then refreshes the copy the window shows |
| `library:remove-history` | Removes a page from history | Chromium's history (`history.delete`), then the copy is refreshed |
| `library:download-action` | Show or open a download | Chromium's `chrome.downloads.show` / `open`, through the extension |
| `library:record-search`, `library:remove-search`, `library:clear-searches` | What was searched | Orbis's own; Chromium has no equivalent worth using |
| `library:record-pick` | Which suggestion was taken | Orbis's own, feeds the omnibox ranking |

### Control — the Browser Control Layer, which Orion and workflows both drive

| Channel | Does | Chromium equivalent |
| --- | --- | --- |
| `control:capabilities` | What can be done right now | Unchanged: a registry in the browser process |
| `control:execute` | Does one thing | Mojo call, then the capability acts on `WebContents` / `TabStripModel` |
| `control:state` | What the browser looks like now | Read from `TabStripModel` and `NavigationController` directly |
| `control:confirm-answer` | The user's yes or no | Unchanged |
| `control:run-plan`, `control:run-control`, `control:runs`, `control:log` | Runs a sequence and records it | Unchanged; the steps underneath become Mojo calls |
| `control:window-scope`, `control:window-result` | Capabilities the Orbis window provides (its address bar) | Unchanged: the Orbis window is still Electron, so it lends these. The browser's own tab state is no longer reported by the window: it is read from Chromium |

The window's browser-state report is gone: the window used to report the in-app browser's tabs. The main process now follows Chromium's own tabs (`browserState.ts`).

### Extensions — Chromium's own

All of the extension-management channels (and the extension bridge) are gone with the Electron extension host: Chromium runs extensions itself. What Orbis still does
with them is a control-layer capability set (`extensions.list`, `extensions.setEnabled`, `extensions.remove`) registered by `src/main/chromium`.

### Ad blocking

The blocker is the Orbis extension in Chromium. The Electron session blocker's settings and report channels are gone; chat's ad-blocking commands talk to the extension (`adblockChat.ts`).

### Services — Orbis's own data, hardly touched

| Channel | Becomes |
| --- | --- |
| `settings:get`, `settings:update`, `settings:testKey` | Mojo onto the same store |
| `conversations:list`, `conversations:save`, `conversations:delete` | Mojo onto the same store |
| `update:status`, `update:check`, `update:download`, `update:cancel-download`, `update:restart-and-update`, `update:settings` | Mojo onto the same update manager; the installer changes, the manager does not |
| `shortcuts:add`, `shortcuts:remove`, `shortcuts:update`, `shortcuts:refresh-icon` | Mojo onto the same store |
| `app:notices`, `app:licence-file` | Mojo; the licence files ship beside the browser |
| `omnibox:predict`, `omnibox:web` | Mojo onto the same ranking, which is ours and better suited to Orbis than Chromium's |
| `widgets:weather`, `widgets:feed` | Weather and news for new-tab widgets, fetched and cached in the browser process. Mojo onto the same fetcher |
| `steps:start`, `steps:read`, `steps:pause`, `steps:resume`, `steps:stop`, `steps:skip`, `steps:verified` | A goal worked through one step at a time. Mojo; the run lives in the browser process and the window only watches it |
| `skills:settings`, `skills:set-settings`, `skills:list`, `skills:preview`, `skills:save`, `skills:match`, `skills:run`, `skills:edit`, `skills:set-enabled`, `skills:remove`, `skills:remove-all`, `skills:roll-back`, `skills:export`, `skills:import` | Learned skills. Mojo onto the same skill store; a skill is a workflow, so running one goes through the workflow engine and the Browser Control Layer like any other |
| `memory:list`, `memory:add`, `memory:update`, `memory:remove`, `memory:clear`, `memory:settings`, `memory:set-settings` | Memory. Mojo onto the same per-profile SQLite store; nothing about it depends on Electron |
| `search-sessions:save`, `search-sessions:list`, `search-sessions:get`, `search-sessions:find`, `search-sessions:remove`, `search-sessions:clear` | Saved Orion Search sessions. Mojo onto the same per-profile SQLite store |
| `galaxy:view`, `galaxy:describe`, `galaxy:link`, `galaxy:unlink`, `galaxy:ask` | Galaxy. Mojo onto the same per-profile service; the map is built from the stores and only the person's own links are kept |
| `control:switches`, `control:set-switch` | What Orion may do at all. Mojo onto the same capability registry |
| `vault:status`, `vault:question`, `vault:create`, `vault:unlock`, `vault:lock`, `vault:list`, `vault:reveal`, `vault:add`, `vault:update`, `vault:remove`, `vault:change-password`, `vault:set-recovery`, `vault:recover`, `vault:auto-lock`, `vault:destroy` | The secrets vault. Mojo onto the same store; the key stays in the browser process either way |
| `default-browser:state`, `default-browser:request`, `default-browser:settings` | Whether Orbis opens this computer's links | `shell_integration::win::` — Chromium does exactly this, and by then Orbis is a browser Windows already knows about |
| `search:run`, `search:specialized-health` | Mojo onto the same two providers: web search, and the specialized categories Orbis's own service answers |
| `browser-sidebar:get`, `browser-sidebar:save`, `browser-sidebar:reset` | Mojo onto the same per-profile store. The sidebar is Orbis's own interface, so it stays ours |

### Orion — unchanged

None of these ever touched Electron beyond the channel itself. They are a service that answers questions.

| Channel | Becomes |
| --- | --- |
| `chat:send`, `chat:abort`, `chat:complete`, `chat:title`, `chat:suggest` | Mojo, same service |
| `automation:classify`, `automation:control`, `automation:steer` | Mojo, same service |
| `image:edit`, `image:save` | Mojo, same service |
| `voice:transcribe`, `voice:cancel`, `voice:hardware` | Mojo, same service |
| `voice:models:status`, `voice:models:download`, `voice:models:cancelDownload`, `voice:models:delete`, `voice:models:verify` | Mojo, same service |

Download progress is pushed to the window as it happens over its own channel (named voice colon models colon
progress), sent rather than handled — there is nothing for the window to ask back, only something to be told — the
same way Galaxy and workspace changes already are.

## What this tells us about the size of the job

The Electron in-app browser is gone (`docs/electron-removal.md`), and with it the browser channels that existed only to drive it:
tabs' focus and pop-out windows, permission and device prompts, the extension host, the Electron ad blocker's settings and report, and the
library's reading list, saved pages, pictures of pages and download bookkeeping. What is left is what the Orbis window itself asks for.

| Kind | Channels | Effort |
| --- | ---: | --- |
| Orion and what it uses (chat, automation, steps, images, voice, memory, skills, search, Galaxy, omnibox) | 62 | Unchanged behind a new transport |
| Orbis's own services (vault, settings, conversations, updates, sidebar layout, widgets, shortcuts, files, system) | 45 | Unchanged |
| Control layer | 12 | Unchanged; the browser side is Chromium's capabilities |
| Library (Orbis's own memory of searches, shortcuts and picks, plus a copy of Chromium's lists) | 8 | Small |
| Opening the Orbis browser, window fullscreen | 4 | Small |

131 channels in all.
