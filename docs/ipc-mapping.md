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
| `chromium:embed-region` | The renderer's browser view rectangle (CSS pixels, device pixel ratio, visible flag) so Chromium's window sits exactly over it inside the Orbis window | `EmbedController.setRegion`: SetWindowPos on the child HWND (see docs/embedded-browser.md) |
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
| `account:status`, `account:create`, `account:unlock`, `account:lock`, `account:verify`, `account:change` | The password on the account. Mojo onto the same store; the account key never leaves the browser process, and which profile is asked about comes from the profile store rather than from the window either way |
| `vault:status`, `vault:question`, `vault:create`, `vault:unlock`, `vault:lock`, `vault:list`, `vault:reveal`, `vault:add`, `vault:update`, `vault:remove`, `vault:change-password`, `vault:set-recovery`, `vault:recover`, `vault:auto-lock`, `vault:destroy` | The secrets vault. Mojo onto the same store; the key stays in the browser process either way |
| `default-browser:state`, `default-browser:request`, `default-browser:settings` | Whether Orbis opens this computer's links | `shell_integration::win::` — Chromium does exactly this, and by then Orbis is a browser Windows already knows about |
| `search:run`, `search:specialized-health` | Mojo onto the same two providers: web search, and the specialized categories Orbis's own service answers |
| `browser-sidebar:get`, `browser-sidebar:save`, `browser-sidebar:reset` | Mojo onto the same per-profile store. The sidebar is Orbis's own interface, so it stays ours |

### Personal data — Orbis's own, per profile

These were missing from this map until the guard was taught to see them. They are registered through each module's own
`handle` helper rather than by calling `ipcMain.handle` with the channel name, so a check that looked only for the
latter never knew they existed.

| Channel | Becomes |
| --- | --- |
| `notes:list`, `notes:tags`, `notes:get`, `notes:create`, `notes:save`, `notes:remove`, `notes:archive`, `notes:from-page`, `notes:export`, `notes:import` | Notes. Mojo onto the same per-profile store; `notes:from-page` reads the page through the Browser Control Layer, so it needs no new browser access |
| `tasks:snapshot`, `tasks:list`, `tasks:create`, `tasks:save`, `tasks:update`, `tasks:complete`, `tasks:remove`, `tasks:clear-completed`, `tasks:reorder`, `tasks:save-list`, `tasks:create-list`, `tasks:remove-list`, `tasks:from-page` | Tasks and their lists. Mojo onto the same per-profile store |
| `clipboard:history`, `clipboard:settings`, `clipboard:update-settings`, `clipboard:use`, `clipboard:pin`, `clipboard:remove`, `clipboard:clear`, `clipboard:paused` | Clipboard history. Mojo; the watching itself becomes Chromium's own clipboard observer instead of Electron's polling |
| `whiteboard:list`, `whiteboard:get`, `whiteboard:create`, `whiteboard:save`, `whiteboard:remove`, `whiteboard:rename`, `whiteboard:add`, `whiteboard:export-svg`, `whiteboard:page-image` | Whiteboards. Mojo onto the same per-profile store; `whiteboard:page-image` takes its picture through the control layer's screenshot capability |
| `workspaces:list`, `workspaces:save-current`, `workspaces:update-current`, `workspaces:save`, `workspaces:rename`, `workspaces:remove`, `workspaces:duplicate`, `workspaces:reorder`, `workspaces:plan`, `workspaces:open` | Workspaces: a set of tabs, notes and tasks saved together. Mojo; opening one drives the control layer, so the browser side is Chromium's already |
| `profiles:list`, `profiles:create`, `profiles:save`, `profiles:rename`, `profiles:remove`, `profiles:switch` | Browsing profiles. Mojo onto the same store; switching becomes Chromium's own profile switch rather than relaunching a browser Orbis manages |

### Personalisation — the Experience Runtime

| Channel | Becomes |
| --- | --- |
| `experience:get`, `experience:save`, `experience:health`, `experience:snapshots`, `experience:restore-snapshot`, `experience:remove-snapshot`, `experience:reset-section`, `experience:restore-original`, `experience:export`, `experience:check-import`, `experience:import` | How Orbis looks and what the new tab shows. Mojo onto the same store; nothing here touches a tab, a bookmark or a setting, which is what makes restoring a snapshot safe |

### Workflows — the engine, and recording one

| Channel | Becomes |
| --- | --- |
| `workflows:library`, `workflows:get`, `workflows:create`, `workflows:save`, `workflows:regenerate-title`, `workflows:rename`, `workflows:duplicate`, `workflows:remove`, `workflows:export-file`, `workflows:import-file`, `workflows:import-json`, `workflows:versions`, `workflows:restore-version` | The library and a workflow's history. Mojo onto the same per-profile store |
| `workflows:validate`, `workflows:plan`, `workflows:health`, `workflows:findings`, `workflows:repairs`, `workflows:compatibility`, `workflows:apply-migration`, `workflows:affected` | Checking a workflow against the capabilities that actually exist. Mojo onto the same registry — the one the control layer fills, so a workflow is validated against Chromium's real capabilities rather than a list of them |
| `workflows:run`, `workflows:control`, `workflows:history`, `workflows:resume`, `workflows:discard-checkpoint`, `workflows:waiting`, `workflows:unqueue`, `workflows:draft` | Running one. Mojo; the run lives in the browser process and the window watches it, exactly as a step-by-step goal does |
| `workflows:recording-start`, `workflows:recording-pause`, `workflows:recording-stop`, `workflows:recording-save` | Recording what you do into a workflow. Mojo; the recording itself comes from the control layer's own log, so there is nothing browser-specific left to port |
| `workflows:remember-secret`, `workflows:forget-secret`, `workflows:remembered-secrets` | A workflow's use of the secrets vault. Mojo; the secret itself is never sent to the window, only whether one is remembered |

### Markets — the ticker along the bottom of the browser

| Channel | Becomes |
| --- | --- |
| `markets:open`, `markets:close`, `markets:detail` | Opening one market on the Markets page. Mojo; `open` starts the highest-priority subscription the engine has and `close` releases it, so a page that is shut stops costing a stream |
| `markets:quotes` | The last price of a set of instruments, for a list redrawing its rows. Mojo; one call for the set rather than one per row |
| `markets:candles`, `markets:book` | History and depth for one market. Mojo; an interval the provider does not serve is refused rather than quietly swapped for one it does |
| `markets:tape-open`, `markets:tape`, `markets:tape-close` | The trade tape. Mojo; the trade subscription is separate from the price one because a busy pair sends several prints a second and the ticker wants none of them |
| `markets:discover`, `markets:movers` | Movers, volume leaders, the heatmap and breadth. Mojo onto one snapshot of every market, ranked by the one shared module so two panels cannot disagree |
| `markets:watchlists`, `markets:watchlist-create`, `markets:watchlist-rename`, `markets:watchlist-remove`, `markets:watchlist-add`, `markets:watchlist-remove-item` | Watchlists, per profile. Mojo; what is stored is the whole instrument rather than a symbol, so a list read back still knows which exchange's market it meant |
| `markets:screen`, `markets:screens`, `markets:screen-save`, `markets:screen-remove` | The screener and its saved screens. Mojo; a technical condition costs a candle request per market, so the answer carries how many were examined and how many were left out rather than presenting a partial sweep as the market's |
| `markets:alerts`, `markets:alert-save`, `markets:alert-remove`, `markets:alert-history-clear` | Market alerts and what has fired. Mojo onto the same alert engine the runtime judges on; an alert about an instrument no provider can describe is refused rather than saved to never fire |
| `markets:paper`, `markets:paper-start`, `markets:paper-close`, `markets:paper-settings`, `markets:paper-order`, `markets:paper-cancel` | Paper trading and the portfolio built on it, always simulated. Mojo; the order goes to the simulation engine and nowhere near an exchange, and every answer carries the assumptions the result was produced under |
| `markets:strategies`, `markets:strategy-save`, `markets:strategy-remove` | Saved strategies: rules a machine can evaluate the same way twice. Mojo; the version bumps when the rules change and not when the name does, so a stored result can say which rules produced it |
| `markets:backtest`, `markets:backtest-sweep`, `markets:backtest-runs`, `markets:backtest-runs-clear` | Running a strategy over real candles. Mojo onto the deterministic engine; only headline figures are stored, because the detail can be produced again from the same strategy and the same candles |
| `markets:news` | Crypto headlines from publishers' own syndication feeds. Mojo through the one feed reader Orbis already has; a publisher that cannot be reached is named rather than silently missing |
| `markets:layout`, `markets:set-layout` | Where Markets was left: the section, the open market and its chart settings. Mojo onto the same per-profile file, not a second workspace system |
| `markets:currency`, `markets:set-currency`, `markets:reset-currency`, `markets:currency-options` | What money is shown in, per profile. Mojo; the currency is detected from the system locale and never from a location prompt, a manual choice is never revisited, and a converted price carries the rate's own age so a live dollar price through yesterday's rate is not called live |
| `markets:favourites`, `markets:favourite`, `markets:clear-recent` | Markets marked as favourites and what was recently opened. Mojo; ids only, so there is one copy of what a market is, and the recent list is deliberately short rather than a browsing history |
| `markets:drawings`, `markets:drawing-save`, `markets:drawing-remove`, `markets:drawings-clear` | Chart annotations. Mojo; stored in market coordinates -- a time and a price -- never in pixels, which is what makes them survive zooming, resizing and being reopened |
| `markets:panels`, `markets:set-panels`, `markets:panels-preset`, `markets:panels-reset` | How Markets is arranged into panels: a tree of splits with panels at the leaves. Mojo; a leaf naming a panel that no longer exists is dropped and the rest of the layout survives |
| `markets:triggers`, `markets:trigger-save`, `markets:trigger-remove` | What can start a market workflow. Mojo; each fires on the edge rather than the state, so a condition that stays true runs a workflow once. The firing itself is a browser-to-window event, like the alert one, rather than a channel the window asks on |
| `markets:patterns`, `markets:pattern` | The candlestick pattern library: every definition, and one in full with its family. Mojo, and read-only — the library is compiled into the build, so these answer from memory and never touch a provider |
| `markets:pattern-detect` | Examining one market for candlestick formations. Mojo. The candles come from the same cache the chart draws from, so a marker cannot land on a candle the chart does not have |
| `markets:pattern-identify` | What a candle the user selected on the chart actually is. Mojo. Answers with every classification it satisfies rather than choosing one, because an ambiguous candle is genuinely ambiguous |
| `markets:pattern-settings`, `markets:pattern-settings-save` | The detector's switches, and what each one stops. Mojo. Saving releases the detector when the master switch goes off, so nothing keeps running behind a control that says it is not |
| `markets:pattern-rules`, `markets:pattern-rule-save`, `markets:pattern-rule-remove`, `markets:pattern-mutes-save` | Candlestick alert rules and muting. Mojo, and an integration into the alert infrastructure that already exists rather than a second one — these write rules; the firing goes out through the notification path Orbis already has |
| `markets:pattern-evaluate`, `markets:pattern-delivered` | Deciding what should fire for one market, and recording whether delivery actually happened. Two rather than one because a firing is never stored as delivered until something confirms it |
| `markets:pattern-history`, `markets:pattern-history-clear` | Recorded detections, searchable, and forgetting them. Mojo. Clearing the history never touches market data: the candles belong to the cache, the records to the profile |
| `markets:pattern-outcomes`, `markets:pattern-compare` | What price did after past occurrences, and two sets of those measurements side by side. Mojo. Every figure is a measurement of candles that already traded and carries its own sample size; neither channel names a winner |
| `markets:pattern-scan` | Scanning a stretch of history for a pattern. Mojo, cancellable. A run stopped part-way answers as partial with the share it covered, so it cannot sit beside a complete one looking equivalent |
| `markets:pattern-digest` | A summary of what fired over a period. Mojo. Contains only firings that happened; an empty period says so |
| `markets:pattern-health` | What the detector is holding, for diagnostics. Mojo |
| `markets:pattern-timeframes` | The same market on several intervals, each keeping its own reading. Mojo, and deliberately separate from detection so the intervals stay visibly separate rather than collapsing into one verdict |
| `markets:margin`, `markets:set-margin` | Simulated leverage, margin and liquidation. Mojo; Orbis's own model, and every answer carries the assumptions saying it is not an exchange's calculation |
| `markets:compare` | Several markets indexed to a common start. Mojo; absolute prices are never compared, and statistics need enough aligned observations or come back unavailable |
| `markets:walk-forward`, `markets:monte-carlo` | Telling a strategy that worked from one that was fitted. Mojo; walk-forward reports only the stretches the rules had not seen, and the reordering generates nothing and forecasts nothing |
| `markets:book-open`, `markets:book-close` | Following one market's incremental depth stream. Mojo; refcounted, so two panels on one market share one subscription, and a book that cannot prove its sequence is continuous is reloaded from a snapshot rather than shown as current |
| `markets:derivatives`, `markets:funding-history`, `markets:oi-history`, `markets:long-short`, `markets:contracts` | Perpetual and dated futures from Binance's futures API: funding with the venue's own schedule, open interest with its own history, mark and index prices, and positioning with whose it is stated. Mojo; a separate provider from spot, so a perpetual can never be confused with the market it tracks, and every field is null where the venue publishes nothing |
| `markets:tape-analysis` | The trade tape and what it adds up to: large-print threshold, buy and sell pressure over a stated window, aggregation by price or by minute. Mojo; pressure is measured over the whole tape rather than the filtered view, and an unclassified print is never counted as either side |
| `markets:experience`, `markets:set-experience`, `markets:experience-override`, `markets:reset-experience`, `markets:experience-request` | How Markets should behave for this profile: the level, the answers behind it, and the settings somebody set by hand. Mojo onto the same per-profile file; presentation only, and every level reads the same market data through the same gateway |
| `markets:learned`, `markets:explain`, `markets:glossary` | What the words mean, from one glossary, in this profile's vocabulary. Mojo; a term Orbis has no definition for comes back not found rather than invented |
| `markets:onboarding`, `markets:onboarding-draft`, `markets:onboarding-apply`, `markets:onboarding-skip`, `markets:onboarding-restart` | The first-launch questions: the schema, the draft as somebody goes, and applying it in one write. Mojo; the draft is never a profile until it validates, and applying one reconciles subscriptions rather than reconnecting |
| `markets:set-enabled` | Markets on or off for this profile. Mojo; off releases every market subscription and keeps every saved watchlist, alert and ticker group, so it is a switch and not a reset |
| `portable:state`, `portable:needs-password` | What a profile is made of, and whether this selection is private enough to need a password. Pure description, answered from the registry that is compiled in — no engine, no disk, nothing to move |
| `portable:estimate` | Room needed before the work is done. Becomes a Mojo call on the same code; the free-space figure is the only part that is platform-specific |
| `portable:export`, `portable:import` | The only two that touch a profile. Both already take their filesystem as a parameter, so what changes in Chromium is which object is passed in, not the code that uses it. The password crosses here and nothing derived from it comes back |
| `portable:inspect` | A package's manifest without opening the package. The manifest is deliberately unencrypted so this can answer before a password is asked for; keep that property, whatever the transport becomes |
| `portable:choose-destination`, `portable:choose-package` | The system file dialogs. They run in the privileged process on purpose, so the package goes where the person pointed rather than anywhere a renderer names |
| `portable:cancel` | Stops whichever of the two is running. A flag, not a kill |
| `portable:recovery`, `portable:recovery-clear` | Whether an import began and never finished, read on start, and clearing that record once the person has been told. Reads and writes one journal file |
| `markets:state`, `markets:refresh` | What the ticker shows and where the prices came from. Mojo onto the same engine; every answer carries each number's freshness, so nothing is drawn as live that is not |
| `markets:set-ticker`, `markets:ticker-group`, `markets:set-group`, `markets:remove-group` | The ticker's settings and its groups. Mojo onto the same per-profile store |
| `markets:search`, `markets:ticker-add`, `markets:ticker-remove` | Finding an instrument and putting it on the ticker. Mojo; the search goes to whichever providers are configured, and an unconfigured one contributes nothing rather than an empty row |

The strip itself does not use these: it is a browser page and reads through the helper, whose channels are a separate boundary from the Electron IPC counted here. The window edits, the strip reads.

### Security activity — what Orbis recorded about its own security

| Channel | Becomes |
| --- | --- |
| `security:log`, `security:clear-log` | Read and cleared, and nothing else — an event is recorded by the code that does the thing, so no channel can put one in the log that did not happen. Mojo onto the same per-profile file. Nothing in it is an address, a page or a credential: the shape has no field for one |

### Profile Lock — Orbis itself, behind the account password

| Channel | Becomes |
| --- | --- |
| `profileLock:state`, `profileLock:save`, `profileLock:lock` | When Orbis locks itself, and locking it now. Mojo onto the same store — the policy lives in `account.lock` beside the password that opens it, so there is one account-security file rather than two. In Chromium the triggers become its own session and idle observers instead of Electron's `powerMonitor`, which is the same operating-system notification either way |

### Orbis Pages — Orbis's own interactive destinations

A Page is a real address (`orbis://pages/<slug>`) rather than a tab inside a panel, so in Chromium these become a WebUI
host plus a Mojo interface onto the same TypeScript service. The register is rebuilt from the build at every start; only
what a profile has *decided* is persisted, which is why permissions and projects are the parts with their own channels.

| Channel | Becomes |
| --- | --- |
| `pages:state` | Everything the library needs in one answer: available Pages, unavailable ones with the reason, recents, favourites, the category tree and the tags in use. Mojo onto `PagesService` |
| `pages:list` | The same register, filtered by category, tag, kind, favourite or whether it works offline |
| `pages:search`, `pages:suggest` | Finding a Page. The index is derived from the register and lives in the same process, so this stays a local call rather than becoming a network one. `pages:suggest` is the narrower one the address bar uses |
| `pages:related` | Other Pages sharing a subject or a tag. From real metadata, so a Page with nothing in common returns nothing |
| `pages:resolve` | An address read without counting as a visit — what the router asks before it decides where to send something. Becomes the WebUI host's own URL handler |
| `pages:open` | The same, and records the visit. In Chromium the navigation is Chromium's; this remains the service call that resolves the slug and notes it was opened |
| `pages:favourite` | A favourite, kept in the profile's own file |
| `pages:detail` | One Page in full: what it asks for, what it is actually allowed, what it has saved, what it relates to, and what it depends on |
| `pages:permissions` | What a Page may do, built from the decisions rather than from its manifest — so the list shows what is true and not what was requested |
| `pages:grant`, `pages:revoke` | Recording an answered prompt, and withdrawing it. Becomes Mojo onto the same policy engine; the trusted prompt itself is already browser UI rather than Page content |
| `pages:compute` | The one door to the computational engines. Every operation is checked against the Page's capabilities before an engine runs, so there is no second route to reach one. In Chromium this is the interface a Page's renderer is given, narrowed to the operations it has been granted |
| `pages:projects`, `pages:project-save`, `pages:project-delete` | A Page's own saved work, in the profile's own store, size-capped before it is written |
| `pages:health` | The register checked against itself, for diagnostics: duplicate addresses, duplicate ids, aliases pointing at nothing |
| `pages:export` | A Page packed up as a file, scanned for anything that looks like a credential and refused if one is found. Becomes Mojo onto the same packer; the file dialog is already browser UI |
| `pages:inspect-package` | A package described so somebody can decide about it. Nothing is installed and nothing is granted by this call, which is why it is separate from anything that writes |
| `pages:diagnose` | A fault turned into advice, with what each recovery costs attached. Pure, so it moves unchanged; only who reports the fault changes |
| `pages:audit` | An accessibility audit of a Page's own elements. In Chromium the elements could come from the accessibility tree instead of from the Page describing itself, which would make it better rather than different |
| `pages:check-document` | A Page built in the builder, checked before it may run. Pure, and the builder is Orbis UI either way |
| `pages:search-module` | Which Pages, if any, answer a search better than the results they would displace. Becomes part of the results page the search host already builds |
| `pages:answer` | A question answered by an engine where it can be, so Orion never produces a number it could have computed. Runs as the Page that owns the operation, so the same capability check applies |
| `pages:participants` | Who can send to whom: what each Page declared it accepts, and which may send at all. Only what is declared, never inferred |
| `pages:send` | One Page's message to another, checked from both ends. The app's channel, not a Page's -- a Page's own messages arrive through the sandbox bridge where the identity comes from the frame and cannot be claimed |

### Tab Lock — private tabs behind their own password

| Channel | Becomes |
| --- | --- |
| `tabLock:state`, `tabLock:judge`, `tabLock:checkLabel`, `tabLock:explain` | What is protected, whether a password is strong enough, whether a label would give the site away, and why a tab is locked. Mojo; no answer here ever carries a page's address or title |
| `tabLock:createGroup`, `tabLock:removeGroup`, `tabLock:unlockGroup`, `tabLock:changeGroupPassword`, `tabLock:resetGroupPassword` | The tab passwords themselves. Mojo onto the same store; the key never leaves the browser process, and the account password is the only way back into a forgotten one |
| `tabLock:setGroupPolicy`, `tabLock:setDefaultPolicy`, `tabLock:setTabPolicy`, `tabLock:addRule`, `tabLock:removeRule`, `tabLock:setRules` | When a tab locks, and which sites are protected automatically. Mojo onto the same store |
| `tabLock:protect`, `tabLock:unprotect`, `tabLock:lockTab`, `tabLock:unlockTab`, `tabLock:lockAll` | Locking and unlocking. Mojo; in Chromium the hiding itself belongs to the tab strip and the address bar rather than to anything Orbis draws, which is what finally makes a locked tab's title, icon, address, hover card and thumbnail unavailable rather than merely unpainted |

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
| Orbis's own services (vault, account, settings, conversations, updates, sidebar layout, widgets, shortcuts, files, system) | 51 | Unchanged |
| Personal data (notes, tasks, clipboard history, whiteboards, workspaces, profiles) | 56 | Unchanged, except clipboard watching, which becomes Chromium's own |
| Workflows (library, validation, running, recording, secrets) | 43 | Unchanged; validation already runs against the control layer's real registry |
| Personalisation (the Experience Runtime) | 11 | Unchanged |
| Tab Lock | 21 | The deciding and the credentials are unchanged; the hiding is already Chromium's, in `TabData` and the address bar's delegate |
| Profile Lock | 3 | Unchanged; the operating-system events become Chromium's own observers |
| Security activity | 2 | Unchanged |
| Markets | 9 | Unchanged; the providers are HTTP and WebSocket either way |
| Orbis Pages | 26 | A WebUI host plus Mojo onto the same service; `pages:compute` is the narrow interface a Page's renderer gets, and the Page frames themselves are `WebContents` with a `URLLoaderFactory` for their own origin |
| Control layer | 12 | Unchanged; the browser side is Chromium's capabilities |
| Library (Orbis's own memory of searches, shortcuts and picks, plus a copy of Chromium's lists) | 8 | Small |
| Opening the Orbis browser, window fullscreen | 4 | Small |

291 channels in all.

That total jumped from 131 without one channel being added to reach it: 123 of them were registered through each
module's own sender-checking `handle` helper, and the test that keeps this map honest was looking only for
`ipcMain.handle`. It now looks for both. A map describing half the boundary while reporting a confident total was worse
than no total at all, so the figure above is the first one worth trusting.
