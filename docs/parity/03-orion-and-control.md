# Parity 03 - Orion, the Browser Control Layer and the rest of Orbis

Baseline audit of how the Electron browser is wired to Orion today, for the move to a real Chromium build.
Read-only; line numbers are from the tree at the time of writing (branch `browser-platform`).
"(uncertain)" marks claims not fully verified by reading the code end to end.

## 0. Layering (the key fact)

```
Orion (browserAgent.ts, workflows, personal/widget capabilities)
   -> BrowserControl registry (browserControl/registry.ts)  <- capabilities
        -> PageHandle contract (pageHandle.ts)  <- Electron WebContents today (a cast), CdpPage on Chromium
        -> Electron main-process APIs (session, clipboard, app, webContents, renderer IPC)  <- NOT covered by PageHandle
```

`asPageHandle` is a plain cast (`src/main/pageHandle.ts:96`); `PAGE_HANDLE_METHODS` (`:99-107`) names the methods used.
`CdpPage implements PageHandle` over DevTools (`src/main/chromium/cdpPage.ts:67`; screenshot `:215`, input `:234-247`,
tab activation `:273`, target discovery `:296-341`); `CdpBrowser` (`:278`) lists/finds pages by numeric id. It is tested by
`src/main/chromium/chromiumControl.test.ts`. Only the page-level layer moves via CDP; everything that touches the
Orbis window, session or renderer state still needs a Chromium-side owner (extension, helper or patch).

## 1. Browser Control Layer (`src/main/browserControl/`)

### 1.1 Registry - `registry.ts` (422 lines)
- `CapabilityDefinition` `:56-75`: id, domain, params, `mutates`, `confirmation`, `requires` (`ControlRequirement`:
  browser-open, web-page, user-interaction, website-permission, extension-permission, authentication, elevated -
  `src/shared/browserControl.ts:54`), optional `assess`, `run`, `verify`, alternatives.
- Confirmation: `execute` `:~314-330`. `assess` then policy; approval needed when `source !== 'user'` and
  (`confirmation==='always'` or assess says confirm or Orion flagged `needs_approval` on a mutating capability).
  User-sourced calls are not re-asked. Approval goes through `ctx.confirm`.
- Recovery: retry loop `:348-380` with a `recovery` log phase (`:354`), alternative parameter sets, capability `verify`
  step; verification failure gives `verification-failed` (recoverable). Timeouts map to `timeout`.
- Logging: phases observation/decision/command/execution/result/verification/error/recovery (`:79`); `redact` on params;
  reads log only the shape of results (`:91`); ring buffer 600/500 (`:402-403`); batched durable writer (`:125`).
  Read through the `control:log` IPC.
- Electron dependency: none in the registry itself (pure TS, shared types). Moves unchanged.

### 1.2 Runner - `runner.ts` (519 lines)
`PlanRun` executes multi-step plans (`:75`, `start` `:157`): steps, conditions (`evaluate` `:458`, `compare` `:493`),
pause/resume/stop (`control` `:121`), asks the user (`AskRequest`), emits `RunState`. Pure TS; used by workflows and
`control:run-plan`. Unchanged on Chromium.

### 1.3 Setup / window bridge - `setup.ts`, `window.ts`
`window.ts` `WindowControl` bridges to the renderer (`win.webContents.send`, `:100-105`): the tab strip, tab groups,
address bar, find, zoom and `ui.*` live in React (BrowserPanel) and answer over `control:window-*` IPC. It caches
capability descriptors on disk (`:60-75`) and registers "closed" placeholders when the window part is absent.
State (`WindowBrowserState`: tabs, groups) arrives via `setState` (`:110`) from `control:window-state`.
Electron dependency: heavy (BrowserWindow + renderer IPC). Chromium path: tabs/groups/omnibox/find/zoom must be re-owned
by Chromium (native tab strip, patch) with state published to Orion (CDP `Target.*` for tabs; groups need a patch or
`chrome.tabGroups` in an extension) (uncertain: CDP alone has no tab-group source).

### 1.4 Capabilities (what each does, dependency)

**A. Page capabilities - `pageCapabilities.ts` (737) + `page.ts` (501). Need only PageHandle**
(`page.exec` = `executeJavaScript`; `mouseClick/mouseMove/pressNamedKey` = `sendInputEvent`/`insertText`; `settle` =
`isLoading`), except tab resolution and one nativeImage import:
- `resolvePage` `:21-40` uses `webContents.fromId`, `getType()==='webview'`, `hostWebContents` (Electron-only). On
  Chromium it is replaced by `CdpBrowser.find(id)`. `page.ts:481` imports `nativeImage` (screenshot resize); replaced by
  `ChromiumImage` (`chromium/png.ts`).
- Capabilities: `page.read` (:114), `snapshot` (:130), `find` (:141), `click` (:155; arms script, real mouse, scripted
  fallback if the tab is hidden `:172-176`, verifies the click was seen `:183`), `hover` (:191), `focus` (:212), `type`
  (:228, focus, fill script, optional Enter), `clear` (:271), `paste` (:292), `press` (:320), `select` (:355), `check`
  (:379), `submit` (:408), `scroll` (:442), `drag` (:481), `selectText` (:499), `extract` (:523), `waitFor` (:545),
  `accessibility` (:587, via `PageDebugger`), `screenshot` (:598, `capturePage`), `source` (:619), `contextActions`
  (:633), `openLink` (:692), `evaluateQuery` (:722).
- Verdict: PageHandle only (plus id resolution). Ported in principle by `CdpPage`; re-test on Chromium: hidden-tab click
  fallback, `isLoading` settle, accessibility tree shape, screenshot size.

**B. Captcha assist - `captchaCapabilities.ts` (138)**: `captcha.check` (:103) and `captcha.show` (:119). Read-only by
design (never solves or ticks); `SIGNALS_SCRIPT` collects frame/script URLs cut at `?#`, element identifiers and visible
words, then `safeSignals` (`src/shared/captcha.ts`). PageHandle only (+ `resolvePage`); `show` brings the tab forward
(window bridge). Hook: `index.ts:53,1623` (`run.captchaDone()`). Unchanged.

**C. Main-process capabilities - `mainCapabilities.ts` (1542; the file contains a NUL byte so ripgrep treats it as
binary; use `grep -a`).** These need Electron main APIs and are NOT satisfiable by PageHandle:

| Domain (ids, lines) | Electron API |
| --- | --- |
| window.list/create/close (:124-156), navigation.info (:233) | BrowserWindow/webContents, renderer bridge |
| devtools.open/close/inspect/console/network/print/printToPdf/savePage/viewSource (:264-487) | `webContents.openDevTools`, `debugger`, `printToPDF`, `app.getPath('downloads')` (:459) |
| settings.get/set/adblock/setAdblock/adblockSite (:509-587) | store + `OrbisAdBlock` |
| permissions.list/answer/set/forget (:607-673) | `BrowserIntegration` (session permission handlers, `browserIntegration.ts`) |
| browser.clearData/clearCache/clearCookies/cookieCount (:689-738) | `session.clearCache/clearStorageData/cookies` (:714-745) |
| downloads.* (:754-880) | `session.downloadURL` (:793), `will-download` |
| history.* / bookmarks.* (:888-966) | `BrowserLibrary` (own store) |
| clipboard.* (:989-1108) | Electron `clipboard`, `ClipboardItem`, `nativeImage` |
| extensions.* (:1118-1360) | `src/main/extensions/*` (Electron extension host) |
| shortcuts.* (:1377-1388) | `browserShortcuts.ts` |
| state.snapshot/capabilities/log/check (:1430-1463) | registry + window state |

**D. UI capabilities - `uiCapabilities.ts` (247)**: `ui.snapshot/click/type/press/hover/read/waitFor` (:94-230) act on
the Orbis renderer UI (React), not web pages. On Chromium they only apply to the Orbis panel surface (side panel / new
tab), via CDP against that target (uncertain).

Chromium ownership summary: A and B = CDP adapter (done at contract level). C = split: history/bookmarks/downloads/
cookies/permissions/print/devtools go to native Chromium features (patch, `chrome.*` extension APIs, CDP `Browser.*`,
`Storage.*`, `Page.printToPDF`); clipboard via helper/OS; extensions via Chromium's own. D = panel target.

## 2. browserAgent (`src/main/browserAgent.ts`, 1204 lines)

- Entry `runBrowserAgent` `:456`. Modes `once | loop | game` (`:39`). Model list restricted to `TOOL_MODELS` (`:73`, Groq
  gpt-oss / qwen). Tool-calling loop over a model (`callModel` `:262`, invoked `:1058`).
- Observe/Decide/Act/Verify: observe = page state (URL, title, visible text, numbered interactive elements; system text
  `:219`); decide = model tool call; act = tool executed on the page; verify = `STATE_CHANGING` set (`:107`) to detect no
  progress, `mark_done` requires page verification (`:178`), and a second model call `unmetGoal` (`:409-443`, JSON
  `{met, missing}`) before reporting finished. Game mode has its own observe/decide/act/verify prompt (`:241`) and
  level/win regexes (`:92-104`).
- Tools: `TOOLS` (`:131-153`) navigate, click, type_text, press_key, select_option, scroll, go_back, go_forward,
  read_page, ask_user. Automation-only `AUTOMATION_TOOLS` (`:175-216`): mark_done, set_goal, note, wait,
  wait_for_video_end, inspect, press_keys, click_point, drag. Control tools `CONTROL_TOOLS` (`:155`): `find_capabilities`,
  `use_capability` (any registry capability; `tab_id` targets another tab, `:951`). Every mutating tool has
  `needs_approval` (`:112`).
- Permissions/confirmation: `needs_approval` becomes registry `flagged`; UI via `chat:browser-confirm`
  (`index.ts:760`, `requestBrowserConfirmation` `:654`). Target: `getTarget` -> `chat:browser-target` (`:756`).
- Electron dependency: `findPage` uses `webContents.fromId` (`index.ts:648-651`) and the agent reads
  `windowControl.state.tabs` (`browserAgent.ts:992`); `asPageHandle(...)` wraps the result. Loop, tools, prompts and
  verify are pure. Chromium: supply `getTarget/findPage` from `CdpBrowser`; tab list from Target events.
- Test: `browserControl.test.ts`, `runner.test.ts`, `orionContract.test.ts`; on Chromium run the same agent tasks against
  a local fixture page via `CdpBrowser` (`chromiumControl.test.ts` pattern).

## 3. Browser state exposed to Orion

| State | Source today | File:line |
| --- | --- | --- |
| Tab list / groups | renderer -> `control:window-state` -> `WindowControl.state` | `window.ts:110`; `index.ts:1539,1878,1907` |
| Current page context (url/title/selection) | `page.read` capability (`maxChars:2000`) | `index.ts:1895-1900` (`readPage`); `pageCapabilities.ts:114` |
| Page picture | `page.read` + `page.screenshot` (`maxWidth:1280`) | `index.ts:1901-1909` (`pageImage`) |
| Chat request `browser` field (url, title) | built by renderer in the `chat:send` payload | `index.ts:94-129,705` (uncertain: payload built in renderer `App.tsx`) |
| Page text for follow-ups | `readOpenPage(url)` finds the `webview` whose URL matches, runs `innerText`, 4 s timeout | `index.ts:133-140`, used `:707` |
| Active tab for clipboard context | `windowControl.state.tabs.find(active)` | `index.ts:1886` |

Electron dep: `readOpenPage` (`webContents.getAllWebContents`, `getType()==='webview'`). Chromium: match by URL over
`CdpBrowser.list()` and `executeJavaScript`; tab list from CDP targets; the private flag needs a patch/extension signal
(uncertain).

## 4. Research and Orion Search
- Research pipeline `research.ts`: `searchWeb` (Bing/DDG HTML parsing, `:122`), `readPage` (`:179`), `runResearch`
  (`:248`), all through `net.fetch`; no browser tab is used for fetching. Unchanged on Chromium.
- Orion Search: `search.ts` `runSearch` (`:43`), specialized providers `search/specialized.ts` (SearXNG, see
  `docs/specialized-search.md`), history `knowledge/searchSessions.ts` (`search-sessions:*` IPC). Renderer
  `OrionSearchMode.tsx` / `OrbisSearchPage.tsx`; opening a source calls `onOpen(source.url)` (`OrionSearchMode.tsx:354`),
  which the renderer routes to a new browser tab (`App.tsx:1005-1010`, `OPEN_URL_EVENT`); `index.ts:400` also sends
  `browser:new-tab`. The agent can "open source 2" because replies carry source URLs (`index.ts:643`).
- Electron dep: renderer tab creation (`browser:new-tab`) and the `orbis://search` internal page. Chromium: sources
  open via `chrome.tabs.create` from the panel extension or CDP `Target.createTarget`; `orbis://` needs the existing
  new-tab override/patch. Test: click a source, assert a new real tab with that URL.

## 5. Workflows, scheduler, agent-core
- Workflows: `workflows/engine.ts` (439); store `store.ts`; plan execution via `PlanRun` and the registry
  (`index.ts:1309,1337` pass `control` + `windowControl`); schedules by timer (`engine.ts:49,87-93`, missed-run logic in
  `shared/schedulePhrase.ts`), `appStart` trigger (`:67`), browser-state and download triggers (`:54`), only while Orbis
  is open. `recorder.ts` (354) records user actions via `workflowRecorder.attach` on `did-attach-webview`
  (`index.ts:1307`; audit `docs/chromium-migration-audit.md:39`), which is Electron-coupled. `orion.ts` `askOrion` /
  `draftWorkflow` (:28, :84) is model-only. IPC `workflows:*` (`workflows/ipc.ts`).
- Chromium: engine/store/orion unchanged (pure over the registry). Recorder needs a Chromium-side event source (CDP
  `Input`/`Page` events or a content script): todo. There is no separate scheduler module; scheduling lives in the engine.
- "agent-core": no module of that name exists in `src` (searched). Treated as `browserAgent.ts` plus
  `stepRunner.ts`/`stepPlanner.ts` (`steps:*` IPC) (uncertain whether something else is meant).

## 6. Ad blocker
- Files: engine `adblock/blocker.ts` (`AdBlockCore` :133, Ghostery engine, `DEFAULT_SETTINGS` :23, categories
  ads/trackers/annoyances :5), list store `store.ts` (`FilterStore` :101: download, validation, atomic swap, rollback,
  recovery), Electron wiring `electron.ts` (`OrbisAdBlock` :44).
- Session hooks (`electron.ts:145-160`): `session.webRequest.onBeforeRequest` (network block), `onHeadersReceived` (CSP
  additions), `registerPreloadScript` frame preloads incl. `preload/adblockFrame.js` (cosmetic filters);
  `ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters')` and `.../is-mutation-observer-enabled` (:129, :141);
  `attachSession` (:119) covers private-tab sessions; popup blocking via `setWindowOpenHandler` (:282); memory-cache
  clear (:324). Per-tab stats keyed by `webContentsId`.
- IPC (`index.ts:926-935`, preload): `adblock:state`, `adblock:settings`, `adblock:site`, `adblock:allow-resource`,
  `adblock:remove-exception`, `adblock:report`, `adblock:update`, `adblock:rollback`; push `adblock:event` (`:1191`).
  Capabilities `settings.adblock/setAdblock/adblockSite` (`mainCapabilities.ts:546-587`).
- Already ported: `extension/adblock.js`, `adblock-content.js`, `panel-adblock.js`, `extension/adblock/{engines,rules,
  index.json,popup-hosts.json}` (DNR rulesets ads/annoyances with strict variants; `.bin` engines); helper
  `src/helper/adblock/{dnr,build,service,cli}.ts` converts FilterStore lists to DNR and rebuilds (`service.ts:14`,
  `handlers.ts:11,58`); patch `chromium-adblock-static-rule-limit.patch` (audit doc `:25`). It reuses `FilterStore`
  unchanged.
- Gaps (uncertain, verify): per-tab blocked counts and `adblock:report` parity via declarativeNetRequest feedback, site
  allow-list as dynamic rules, strict/standard toggle, `adblock:event` push to the panel, cosmetic filtering parity.
  Test: `adblock.test.ts` (core), `dnr.test.ts` (conversion); add a real-Chromium block-count test.

## 7. Voice / whisper / vision hooks
- Whisper: `whisper/{service,runtime,modelManager}.ts`; IPC `voice:transcribe|cancel|hardware`, `voice:models:*`
  (`index.ts:1013-1047`). Audio is captured in the renderer and sent as data; no browser-page hook in main (searched
  `browser|control|page` in `whisper/service.ts`: none). Local runtime unchanged. On Chromium the panel needs microphone
  permission (extension/site permission; uncertain).
- Vision: `pageImage` (`index.ts:1901`) + `page.screenshot` feed the whiteboard (`whiteboard:page-image`,
  `personal/ipc.ts:117`) and image models (`nim.ts`); PageHandle-only, so CDP `capturePage` covers it.
- Voice-driven browsing uses the same chat -> `intent.ts` -> `runBrowserAgent` path.

## 8. New-tab page, personalization, widgets
- Current: React new-tab in the renderer; state in `experience/store.ts` (237) via `experience:*` IPC
  (`experience/ipc.ts`); widgets `shared/widgets.ts`, data `widgetFeeds.ts` (`widgets:weather|feed`); Orion controls them
  via `experience/widgetCapabilities.ts` (355) through the registry, verified against the real layout.
- Chromium: `extension/newtab.{html,js,css}` and commit `5bb4c1d` (Orbis new-tab override, local, no Google).
  `newtab.js` uses `chrome.runtime.getURL('/_favicon/')` (`:52`). Widget/experience parity (layout, weather/feed fetch,
  `experience:*`) needs the helper for fetch/storage: partial/todo (uncertain how much is already in `newtab.js`).

## 9. Memory, galaxy, notes, tasks, clipboard hooks from the browser
- `notes:from-page`, `tasks:from-page` (`personal/ipc.ts:72,90`) call `readPage` -> `page.read`; `whiteboard:page-image`
  calls `pageImage`; `workspaces:save-current/open` use `browserState()` (`:147-157`, `:586`); clipboard history reads
  the active tab context (`index.ts:1886`) and `clipboard:*` IPC. Orion capabilities: `personal/ipc.ts:238,327,507,586`.
- Memory (`knowledge/memory.ts`, `memory:*`) and galaxy (`galaxyService.ts`, `galaxy:*`) have no direct browser hook
  (searched); they are fed by chat and search sessions (`index.ts:1793`). Unchanged.
- Chromium: `page.read`/`page.screenshot` via CdpPage; `browserState` from CDP targets (pinned/muted/private flags need
  an extension or patch); workspace open needs tab creation (`Target.createTarget`) and groups (uncertain).

## 10. IPC channels the renderer uses for browser features (`src/preload/index.ts`)
- Navigation/tabs/window: `browser:new-tab`, `browser:popout`, `browser:focus`, `browser:watch-page-moves`,
  `browser:shortcut` (push), `window:is-fullscreen`, `window:fullscreen`, `omnibox:web`, `omnibox:predict`,
  `default-browser:*`.
- Data/privacy: `browser:clear-data`, `browser:clear-private`, `browser:save-page`, `browser:protected-media`,
  `browser:permission-answer`, `browser:device-answer`.
- Library: `library:get`, `library:toggle-bookmark`, `library:add-bookmarks`, `library:remove-bookmark`,
  `library:remove-history`, `library:clear-history`, `library:reading-*`, `library:record-search|remove-search|clear-searches`,
  `library:record-pick`, `library:download-action`, `library:clear-downloads`, `library:forget-permissions`,
  `library:forget-saved-page`, `library:keep|read|remove-screenshot`; `browser-sidebar:get|save|reset`.
- Extensions/shortcuts: `extensions:list|set-enabled|set-pinned|remove|update|click-action|prompt-answer|report-tabs|window-answer`,
  `shortcuts:add|update|remove|refresh-icon`.
- Control layer: `control:capabilities|state|execute|run-plan|run-control|runs|log|window-state|window-scope|window-result|confirm-answer|switches|set-switch`.
- Agent: `chat:browser-target`, `chat:browser-confirm`, `automation:control|steer|classify`, `chat:send|abort|event`.
- Ad block: `adblock:*` (section 6). Workflows: `workflows:*`. Personal: `notes:*`, `tasks:*`, `clipboard:*`,
  `whiteboard:*`, `workspaces:*`, `profiles:*`, `experience:*`. Search/knowledge: `search:run`,
  `search:specialized-health`, `search-sessions:*`, `memory:*`, `galaxy:*`. Voice: `voice:*`.
- `src/main/ipcMapping.test.ts` and `docs/ipc-mapping.md` record the Electron-IPC to Chromium mapping (not re-read here;
  uncertain).

## 11. Testing strategy (general)
Contract tests exist: `orionContract.test.ts`, `portability.test.ts` (guards the Chromium adapter),
`chromiumControl.test.ts` (drives the real build). For each moved feature: (1) run the existing capability tests against
`CdpPage` on a local fixture page; (2) real-Chromium smoke through the helper; (3) keep pure-TS unit tests unchanged.

## 12. Checklist

| Feature | Behavior | Owner | Dependency | Chromium path | Status |
| --- | --- | --- | --- | --- | --- |
| PageHandle contract | Orion's page interface | `pageHandle.ts` | none | `CdpPage` (`cdpPage.ts:67`) | ported |
| Registry (assess/confirm/recover/log) | governs every capability | `registry.ts` | none | as is | unchanged |
| PlanRun runner | multi-step plans | `runner.ts` | none | as is | unchanged |
| Page capabilities (24) | read/click/type/scroll/... | `pageCapabilities.ts`, `page.ts` | PageHandle + `webContents.fromId`, `nativeImage` | CdpPage + `CdpBrowser.find` | ported (tab resolve todo) |
| Captcha assist | detect + show only | `captchaCapabilities.ts` | PageHandle | CdpPage | ported (uncertain: `show` window part) |
| Window/tab/group/omnibox/find/zoom | tab strip control | `window.ts` + renderer | BrowserWindow + IPC | Chromium patch / `chrome.tabs`; CDP targets for list | todo |
| Main caps: session/cookies/downloads/permissions | data, downloads, perms | `mainCapabilities.ts` | Electron `session` | CDP `Storage`/`Browser` + native | todo |
| Clipboard capabilities | read/write clipboard | `mainCapabilities.ts` | Electron `clipboard` | helper / OS clipboard | todo |
| Extensions capabilities | manage extensions | `mainCapabilities.ts`, `extensions/` | Electron ext host | Chromium native | todo |
| DevTools/print/save | inspect, PDF | `mainCapabilities.ts` | webContents | CDP `Page.printToPDF` etc. | todo |
| ui.* capabilities | drive Orbis UI | `uiCapabilities.ts` | renderer | CDP against Orbis panel target | todo |
| browserAgent loop | observe/decide/act/verify | `browserAgent.ts` | model + `webContents.fromId` | `findPage/getTarget` from CdpBrowser | unchanged (glue todo) |
| Browser state to Orion | tabs, page ctx, text | `index.ts`, `window.ts` | renderer state, webview lookup | CDP targets + extension flags | todo |
| Research | web search + read | `research.ts` | `net.fetch` | as is | unchanged |
| Orion Search + sources | search, open sources | `search.ts`, renderer | `browser:new-tab` | `chrome.tabs` / `Target.createTarget` | todo |
| Workflows engine/schedule | plans, timers, triggers | `workflows/engine.ts` | registry | as is | unchanged |
| Workflow recorder | records user actions | `workflows/recorder.ts` | `did-attach-webview` | CDP events / content script | todo |
| Ad blocker engine/lists | filters, updates | `adblock/blocker.ts`, `store.ts` | Ghostery | helper `FilterStore` + DNR | ported |
| Ad blocker enforcement | network/CSP/cosmetic | `adblock/electron.ts` | `session.webRequest` | extension DNR + `adblock-content.js` | ported (stats/report parity uncertain) |
| Ad blocker IPC/settings | `adblock:*` | `index.ts:926` | ipcMain | helper `adblock:update`; `panel-adblock.js` | todo (partial, uncertain) |
| Whisper/voice | local transcription | `whisper/*` | renderer mic | as is; mic permission in panel | unchanged (uncertain) |
| Vision / page image | screenshot to models | `index.ts:1901` | PageHandle | `CdpPage.capturePage` | ported |
| New-tab/widgets/personalization | layout, widgets, feeds | `experience/*`, `extension/newtab.*` | renderer + IPC | new-tab override + helper | todo (partial, uncertain) |
| Notes/tasks/whiteboard from page | page to note | `personal/ipc.ts` | `page.read/screenshot` | CdpPage | ported |
| Workspaces | save/open tab sets | `personal/workspaces.ts` | browserState + tab open | CDP targets / `tabs` | todo |
| Memory/galaxy | knowledge graph | `knowledge/*` | none browser | as is | unchanged |
| agent-core | not found by that name | - | - | - | unknown |
