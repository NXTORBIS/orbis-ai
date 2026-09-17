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
| `browser:focus` | Focuses the browser | `Browser::window()->Show()` |
| `browser:popout` | Opens a page in its own window | `Browser` creation with a single tab |
| `browser:save-page` | Saves the page | `content::WebContents::OnSavePage` |
| `browser:clear-data`, `browser:clear-private` | Clears browsing data | `BrowsingDataRemover` |
| `browser:permission-answer` | Answers a site's request | `permissions::PermissionRequestManager` |
| `browser:device-answer`, `browser:pending-devices` | Picks a USB/HID/serial device | Chromium's device chooser controllers |
| `browser:protected-media` | Whether Widevine is there | `CdmRegistry` |
| `browser:watch-page-moves` | Pointer movement for fullscreen bars | Input observer on `RenderWidgetHost` |
| `window:fullscreen`, `window:is-fullscreen` | Window fullscreen | `FullscreenController` |
| `shell:openExternal` | Opens a link outside Orbis | `platform_util::OpenExternal` |
| `files:pickImages`, `files:pickText` | File dialogs | `ui::SelectFileDialog` |
| `system:cpu` | Load, for the status strip | `base::SystemMonitor` |

### Library — becomes Chromium's own services rather than Orbis's JSON files

This is the one place where Chromium does it better than we do, and the port is a genuine upgrade.

| Channel | Does | Chromium equivalent |
| --- | --- | --- |
| `library:get` | Everything at once | `HistoryService`, `BookmarkModel`, `DownloadManager` |
| `library:toggle-bookmark`, `library:add-bookmarks`, `library:remove-bookmark` | Bookmarks | `BookmarkModel` |
| `library:remove-history`, `library:clear-history` | History | `HistoryService::DeleteURLs` |
| `library:download-action`, `library:clear-downloads` | Downloads | `DownloadItem` (pause, resume, cancel, show) |
| `library:record-search`, `library:remove-search`, `library:clear-searches` | What was searched | Orbis's own; Chromium has no equivalent worth using |
| `library:record-pick` | Which suggestion was taken | Orbis's own, feeds the omnibox ranking |
| `library:forget-permissions` | Forgets a site's remembered answers | `HostContentSettingsMap` |
| `library:reading-add`, `library:reading-read`, `library:reading-remove`, `library:reading-clear-read` | The reading list | Orbis's own; Chromium's reading list is tied to a Google account, ours is not |
| `library:forget-saved-page` | Forgets a saved page | Orbis's own; Chromium saves pages but does not list them |
| `library:keep-screenshot`, `library:read-screenshot`, `library:remove-screenshot` | Pictures kept of pages | Orbis's own |

### Control — the Browser Control Layer, which Orion and workflows both drive

| Channel | Does | Chromium equivalent |
| --- | --- | --- |
| `control:capabilities` | What can be done right now | Unchanged: a registry in the browser process |
| `control:execute` | Does one thing | Mojo call, then the capability acts on `WebContents` / `TabStripModel` |
| `control:state` | What the browser looks like now | Read from `TabStripModel` and `NavigationController` directly |
| `control:confirm-answer` | The user's yes or no | Unchanged |
| `control:run-plan`, `control:run-control`, `control:runs`, `control:log` | Runs a sequence and records it | Unchanged; the steps underneath become Mojo calls |
| `control:window-scope`, `control:window-state`, `control:window-result` | Capabilities the window provides | Removed. In Chromium the browser process owns this state, so the window does not have to lend it |

The last row matters: three channels exist only because Electron's main process cannot see what the window knows.
Chromium's browser process owns the tab strip, so they stop being necessary at all.

### Extensions — becomes Chromium's own extensions system

| Channel | Does | Chromium equivalent |
| --- | --- | --- |
| `extensions:list`, `extensions:remove`, `extensions:set-enabled`, `extensions:update` | Managing them | `ExtensionRegistry`, `ExtensionService` |
| `extensions:click-action`, `extensions:set-pinned` | The toolbar | `ExtensionActionManager`, `ToolbarActionsModel` |
| `extensions:prompt-answer` | Permission prompts | `ExtensionInstallPrompt` |
| `extensions:report-tabs`, `extensions:window-answer` | Answering `chrome.tabs` for extensions | Removed. Chromium implements `chrome.tabs` itself |
| `orbis-ext:call` | Our bridge for extension APIs | Removed, for the same reason |

Three channels disappear because we are currently reimplementing what Chromium already has.

### Ad blocking

| Channel | Does | Chromium equivalent |
| --- | --- | --- |
| `adblock:state`, `adblock:settings`, `adblock:site`, `adblock:allow-resource`, `adblock:remove-exception` | Settings and exceptions | Orbis's own, unchanged |
| `adblock:report` | What was blocked on this page | Unchanged; counted in the throttle |
| `adblock:update`, `adblock:rollback` | The filter lists | Unchanged |
| `@ghostery/adblocker/inject-cosmetic-filters`, `@ghostery/adblocker/is-mutation-observer-enabled` | The engine's own page-side channels | Replaced by a `URLLoaderThrottle` and a renderer-side script |

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
| `vault:status`, `vault:question`, `vault:create`, `vault:unlock`, `vault:lock`, `vault:list`, `vault:reveal`, `vault:add`, `vault:update`, `vault:remove`, `vault:change-password`, `vault:set-recovery`, `vault:recover`, `vault:auto-lock`, `vault:destroy` | The secrets vault. Mojo onto the same store; the key stays in the browser process either way |
| `default-browser:state`, `default-browser:request`, `default-browser:settings` | Whether Orbis opens this computer's links | `shell_integration::win::` — Chromium does exactly this, and by then Orbis is a browser Windows already knows about |
| `search:run`, `search:specialized-health` | Mojo onto the same two providers: web search, and the specialized categories Orbis's own service answers |
| `browser-sidebar:get`, `browser-sidebar:save`, `browser-sidebar:reset` | Mojo onto the same per-profile store. The sidebar is Orbis's own interface, so it stays ours |

### Orion — unchanged

None of these ever touched Electron beyond the channel itself. They are a service that answers questions.

| Channel | Becomes |
| --- | --- |
| `chat:send`, `chat:abort`, `chat:complete`, `chat:title`, `chat:suggest` | Mojo, same service |
| `chat:browser-target`, `chat:browser-confirm` | Mojo, same service |
| `automation:classify`, `automation:control`, `automation:steer` | Mojo, same service |
| `image:edit`, `image:save` | Mojo, same service |
| `voice:transcribe` | Mojo, same service |

## What this tells us about the size of the job

| Kind | Channels | Effort |
| --- | ---: | --- |
| Unchanged behind a new transport (Orion, services) | 41 | Mechanical |
| Ours, kept, but rehosted (adblock, omnibox, searches) | 13 | Small |
| Becomes Chromium's own and gets better (library, extensions, permissions, downloads) | 26 | Real work, real gain |
| Disappears — Chromium already does it | 6 | Deletion |
| Browser plumbing to rebuild | 16 | The migration proper |

Six channels are deleted outright and twenty-six are replaced by something better than what Orbis has now. Only
sixteen are genuine new plumbing.

## Order of work

1. **Orion and services** first (41 channels). They prove the Mojo transport works without touching the browser.
2. **Library** next (12). Moving history, bookmarks and downloads onto Chromium's services is the biggest single
   quality gain and it is self-contained.
3. **Control layer** (10). Orion and workflows both depend on it, and three channels vanish.
4. **Extensions** (9), where five are deleted rather than ported.
5. **Browser plumbing and ad blocking** last, because they are the most engine-specific.
