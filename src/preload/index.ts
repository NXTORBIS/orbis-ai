import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { NxtorbisApi, ResearchRunView, StreamEvent, VisualArrival } from '../shared/types'

const api: NxtorbisApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (update) => ipcRenderer.invoke('settings:update', update),
  testApiKey: (apiKey) => ipcRenderer.invoke('settings:test-key', apiKey),
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  saveConversation: (conversation) => ipcRenderer.invoke('conversations:save', conversation),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  sendChat: (request) => ipcRenderer.invoke('chat:send', request),
  chanceStore: (operation, document) => ipcRenderer.invoke('chance:store', operation, document),
  jarvisInvoke: (name, payload) => ipcRenderer.invoke('jarvis:invoke', name, payload),
  eyeStart: () => ipcRenderer.invoke('eye:start'),
  footballLeagues: () => ipcRenderer.invoke('football:leagues'),
  footballLive: () => ipcRenderer.invoke('football:live'),
  footballSeason: (league, season) => ipcRenderer.invoke('football:season', league, season),
  footballTable: (league, season) => ipcRenderer.invoke('football:table', league, season),
  footballMatch: (key) => ipcRenderer.invoke('football:match', key),
  footballExtras: (key) => ipcRenderer.invoke('football:extras', key),
  footballTeam: (key) => ipcRenderer.invoke('football:team', key),
  footballStatus: () => ipcRenderer.invoke('football:status'),
  footballFollows: () => ipcRenderer.invoke('football:follows'),
  footballFollowsSet: (next) => ipcRenderer.invoke('football:follows-set', next),
  f1Schedule: (season) => ipcRenderer.invoke('f1:schedule', season),
  f1Results: (season, round) => ipcRenderer.invoke('f1:results', season, round),
  f1Standings: (season, round) => ipcRenderer.invoke('f1:standings', season, round),
  f1Sessions: (year) => ipcRenderer.invoke('f1:sessions', year),
  f1Timing: (sessionKey, endsAt) => ipcRenderer.invoke('f1:timing', sessionKey, endsAt),
  f1Status: () => ipcRenderer.invoke('f1:status'),
  f1Bundle: (sessionKey, endsAt) => ipcRenderer.invoke('f1:bundle', sessionKey, endsAt),
  f1Intervals: (sessionKey, endsAt) => ipcRenderer.invoke('f1:intervals', sessionKey, endsAt),
  f1Telemetry: (sessionKey, driver, from, to) => ipcRenderer.invoke('f1:telemetry', sessionKey, driver, from, to),
  f1Championship: (sessionKey) => ipcRenderer.invoke('f1:championship', sessionKey),
  f1SeasonData: (season) => ipcRenderer.invoke('f1:season-data', season),
  f1Career: (driverId) => ipcRenderer.invoke('f1:career', driverId),
  f1Prefs: () => ipcRenderer.invoke('f1:prefs'),
  f1PrefsSet: (next) => ipcRenderer.invoke('f1:prefs-set', next),
  f1ReportPdf: (title, html) => ipcRenderer.invoke('f1:report-pdf', title, html),
  f1Champions: (season) => ipcRenderer.invoke('f1:champions', season),
  f1CircuitRecords: (circuitId) => ipcRenderer.invoke('f1:circuit-records', circuitId),
  f1Qualifying: (season, round) => ipcRenderer.invoke('f1:qualifying', season, round),
  f1ConstructorSeason: (season, id) => ipcRenderer.invoke('f1:constructor-season', season, id),
  f1TeamRadio: (sessionKey) => ipcRenderer.invoke('f1:team-radio', sessionKey),
  f1Forecast: (lat, long, at) => ipcRenderer.invoke('f1:forecast', lat, long, at),
  f1Archive: (year) => ipcRenderer.invoke('f1:archive', year),
  f1StreamLive: () => ipcRenderer.invoke('f1:stream-live'),
  f1StreamReplay: (path) => ipcRenderer.invoke('f1:stream-replay', path),
  f1StreamControl: (action, value) => ipcRenderer.invoke('f1:stream-control', action, value),
  f1StreamStop: () => ipcRenderer.invoke('f1:stream-stop'),
  f1StreamState: () => ipcRenderer.invoke('f1:stream-state'),
  onF1Stream: (listener) => {
    const handler = (_e: unknown, event: unknown): void => listener(event)
    ipcRenderer.on('f1:stream', handler)
    return () => ipcRenderer.removeListener('f1:stream', handler)
  },
  cosmosStart: () => ipcRenderer.invoke('cosmos:start'),
  cosmosStop: () => ipcRenderer.invoke('cosmos:stop'),
  cosmosRegion: (region) => ipcRenderer.send('cosmos:region', region),
  onCosmosEvent: (listener) => {
    const handler = (_e: unknown, event: unknown): void => listener(event)
    ipcRenderer.on('cosmos:event', handler)
    return () => ipcRenderer.removeListener('cosmos:event', handler)
  },
  abortChat: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
  onChatEvent: (requestId, listener) => {
    const handler = (_event: IpcRendererEvent, id: string, streamEvent: StreamEvent): void => {
      if (id === requestId) listener(streamEvent)
    }
    ipcRenderer.on('chat:event', handler)
    return () => {
      ipcRenderer.removeListener('chat:event', handler)
    }
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  getCpuUsage: () => ipcRenderer.invoke('system:cpu'),
  pickTextFiles: () => ipcRenderer.invoke('files:pick-text'),
  pickImages: () => ipcRenderer.invoke('files:pick-images'),
  accountStatus: () => ipcRenderer.invoke('account:status'),
  accountCreate: (password, name) => ipcRenderer.invoke('account:create', password, name),
  accountUnlock: (password) => ipcRenderer.invoke('account:unlock', password),
  accountLock: () => ipcRenderer.invoke('account:lock'),
  accountVerify: (password) => ipcRenderer.invoke('account:verify', password),
  accountChange: (current, next, name) => ipcRenderer.invoke('account:change', current, next, name),
  marketsState: () => ipcRenderer.invoke('markets:state'),
  // ---- moving a profile between machines
  /**
   * The path on disk of a dropped file.
   *
   * Electron stopped putting `path` on File objects, so this is the supported way to get it. It reads a path and
   * never reads the file; opening it is the main process's job, where the size limits and the checks are.
   */
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  portableChooseDestination: (request) => ipcRenderer.invoke('portable:choose-destination', request),
  portableChoosePackage: () => ipcRenderer.invoke('portable:choose-package'),
  portableState: () => ipcRenderer.invoke('portable:state'),
  portableNeedsPassword: (request) => ipcRenderer.invoke('portable:needs-password', request),
  portableEstimate: (request) => ipcRenderer.invoke('portable:estimate', request),
  portableExport: (request) => ipcRenderer.invoke('portable:export', request),
  portableInspect: (request) => ipcRenderer.invoke('portable:inspect', request),
  portableImport: (request) => ipcRenderer.invoke('portable:import', request),
  portableCancel: () => ipcRenderer.invoke('portable:cancel'),
  portableRecovery: () => ipcRenderer.invoke('portable:recovery'),
  portableRecoveryClear: () => ipcRenderer.invoke('portable:recovery-clear'),
  onPortableProgress: (handler) => {
    const listener = (_event: unknown, progress: unknown): void => handler(progress as never)
    ipcRenderer.on('portable:progress', listener)
    return () => ipcRenderer.removeListener('portable:progress', listener)
  },
  marketsSetEnabled: (enabled) => ipcRenderer.invoke('markets:set-enabled', enabled),
  marketsOpen: (instrumentId) => ipcRenderer.invoke('markets:open', instrumentId),
  marketsClose: (instrumentId) => ipcRenderer.invoke('markets:close', instrumentId),
  marketsDetail: (instrumentId) => ipcRenderer.invoke('markets:detail', instrumentId),
  marketsQuotes: (instrumentIds, refresh) => ipcRenderer.invoke('markets:quotes', instrumentIds, refresh),
  /** Every price as it arrives, batched to one screen refresh. Live, rather than asked for on a timer. */
  onMarketsTick: (listener) => subscribe('markets:tick', listener),
  marketsCandles: (instrumentId, interval, limit) => ipcRenderer.invoke('markets:candles', instrumentId, interval, limit),
  marketsBook: (instrumentId, depth) => ipcRenderer.invoke('markets:book', instrumentId, depth),
  marketsBookOpen: (instrumentId, depth) => ipcRenderer.invoke('markets:book-open', instrumentId, depth),
  marketsBookClose: (instrumentId) => ipcRenderer.invoke('markets:book-close', instrumentId),
  marketsTapeOpen: (instrumentId, limit) => ipcRenderer.invoke('markets:tape-open', instrumentId, limit),
  marketsTape: (instrumentId) => ipcRenderer.invoke('markets:tape', instrumentId),
  marketsTapeClose: (instrumentId) => ipcRenderer.invoke('markets:tape-close', instrumentId),
  marketsDiscover: (options) => ipcRenderer.invoke('markets:discover', options),
  marketsMovers: (kind, limit, filter) => ipcRenderer.invoke('markets:movers', kind, limit, filter),
  marketsWatchlists: () => ipcRenderer.invoke('markets:watchlists'),
  marketsWatchlistCreate: (name) => ipcRenderer.invoke('markets:watchlist-create', name),
  marketsWatchlistRename: (listId, name) => ipcRenderer.invoke('markets:watchlist-rename', listId, name),
  marketsWatchlistRemove: (listId) => ipcRenderer.invoke('markets:watchlist-remove', listId),
  marketsWatchlistAdd: (listId, instrumentId) => ipcRenderer.invoke('markets:watchlist-add', listId, instrumentId),
  marketsWatchlistRemoveItem: (listId, instrumentId) =>
    ipcRenderer.invoke('markets:watchlist-remove-item', listId, instrumentId),
  marketsScreen: (query) => ipcRenderer.invoke('markets:screen', query),
  marketsScreens: () => ipcRenderer.invoke('markets:screens'),
  marketsScreenSave: (name, query, id) => ipcRenderer.invoke('markets:screen-save', name, query, id),
  marketsScreenRemove: (id) => ipcRenderer.invoke('markets:screen-remove', id),
  marketsAlerts: () => ipcRenderer.invoke('markets:alerts'),
  marketsAlertSave: (alert) => ipcRenderer.invoke('markets:alert-save', alert),
  marketsAlertRemove: (id) => ipcRenderer.invoke('markets:alert-remove', id),
  marketsAlertHistoryClear: () => ipcRenderer.invoke('markets:alert-history-clear'),
  marketsPaper: () => ipcRenderer.invoke('markets:paper'),
  marketsPaperStart: (startingCash, currency, replace) =>
    ipcRenderer.invoke('markets:paper-start', startingCash, currency, replace),
  marketsPaperClose: () => ipcRenderer.invoke('markets:paper-close'),
  marketsPaperSettings: (settings) => ipcRenderer.invoke('markets:paper-settings', settings),
  marketsPaperOrder: (order) => ipcRenderer.invoke('markets:paper-order', order),
  marketsPaperCancel: (orderId) => ipcRenderer.invoke('markets:paper-cancel', orderId),
  marketsStrategies: () => ipcRenderer.invoke('markets:strategies'),
  marketsStrategySave: (strategy) => ipcRenderer.invoke('markets:strategy-save', strategy),
  marketsStrategyRemove: (id) => ipcRenderer.invoke('markets:strategy-remove', id),
  marketsBacktest: (strategyId, options) => ipcRenderer.invoke('markets:backtest', strategyId, options),
  marketsBacktestSweep: (strategyId, field, values) =>
    ipcRenderer.invoke('markets:backtest-sweep', strategyId, field, values),
  marketsBacktestRuns: () => ipcRenderer.invoke('markets:backtest-runs'),
  marketsBacktestRunsClear: () => ipcRenderer.invoke('markets:backtest-runs-clear'),
  marketsNews: (options) => ipcRenderer.invoke('markets:news', options),
  marketsLayout: () => ipcRenderer.invoke('markets:layout'),
  marketsSetLayout: (layout) => ipcRenderer.invoke('markets:set-layout', layout),
  marketsFavourites: () => ipcRenderer.invoke('markets:favourites'),
  marketsToggleFavourite: (instrumentId) => ipcRenderer.invoke('markets:favourite', instrumentId),
  marketsClearRecent: () => ipcRenderer.invoke('markets:clear-recent'),
  marketsDrawings: (instrumentId) => ipcRenderer.invoke('markets:drawings', instrumentId),
  marketsDrawingSave: (drawing) => ipcRenderer.invoke('markets:drawing-save', drawing),
  marketsDrawingRemove: (id, instrumentId) => ipcRenderer.invoke('markets:drawing-remove', id, instrumentId),
  marketsDrawingsClear: (instrumentId) => ipcRenderer.invoke('markets:drawings-clear', instrumentId),
  marketsPanels: () => ipcRenderer.invoke('markets:panels'),
  marketsSetPanels: (layout) => ipcRenderer.invoke('markets:set-panels', layout),
  marketsPanelsPreset: (presetId) => ipcRenderer.invoke('markets:panels-preset', presetId),
  marketsPanelsReset: () => ipcRenderer.invoke('markets:panels-reset'),
  marketsTriggers: () => ipcRenderer.invoke('markets:triggers'),
  marketsTriggerSave: (trigger) => ipcRenderer.invoke('markets:trigger-save', trigger),
  marketsTriggerRemove: (id) => ipcRenderer.invoke('markets:trigger-remove', id),
  marketsPatterns: (query, filter) => ipcRenderer.invoke('markets:patterns', query, filter),
  marketsPattern: (patternId) => ipcRenderer.invoke('markets:pattern', patternId),
  marketsPatternDetect: (instrumentId, interval, options) => ipcRenderer.invoke('markets:pattern-detect', instrumentId, interval, options),
  marketsPatternIdentify: (instrumentId, interval, fromTime, toTime) =>
    ipcRenderer.invoke('markets:pattern-identify', instrumentId, interval, fromTime, toTime),
  marketsPatternSettings: () => ipcRenderer.invoke('markets:pattern-settings'),
  marketsPatternSettingsSave: (patch) => ipcRenderer.invoke('markets:pattern-settings-save', patch),
  marketsPatternRules: () => ipcRenderer.invoke('markets:pattern-rules'),
  marketsPatternRuleSave: (rule) => ipcRenderer.invoke('markets:pattern-rule-save', rule),
  marketsPatternRuleRemove: (id) => ipcRenderer.invoke('markets:pattern-rule-remove', id),
  marketsPatternMutesSave: (mutes) => ipcRenderer.invoke('markets:pattern-mutes-save', mutes),
  marketsPatternEvaluate: (instrumentId, interval) => ipcRenderer.invoke('markets:pattern-evaluate', instrumentId, interval),
  marketsPatternDelivered: (key, delivered, note) => ipcRenderer.invoke('markets:pattern-delivered', key, delivered, note),
  marketsPatternHistory: (query) => ipcRenderer.invoke('markets:pattern-history', query),
  marketsPatternHistoryClear: (keys) => ipcRenderer.invoke('markets:pattern-history-clear', keys),
  marketsPatternOutcomes: (query, options) => ipcRenderer.invoke('markets:pattern-outcomes', query, options),
  marketsPatternCompare: (left, right, options) => ipcRenderer.invoke('markets:pattern-compare', left, right, options),
  marketsPatternScan: (instrumentId, interval, options) => ipcRenderer.invoke('markets:pattern-scan', instrumentId, interval, options),
  marketsPatternDigest: (period, from, to) => ipcRenderer.invoke('markets:pattern-digest', period, from, to),
  marketsPatternHealth: () => ipcRenderer.invoke('markets:pattern-health'),
  marketsPatternTimeframes: (instrumentId, direction) => ipcRenderer.invoke('markets:pattern-timeframes', instrumentId, direction),
  marketsMargin: () => ipcRenderer.invoke('markets:margin'),
  marketsSetMargin: (patch) => ipcRenderer.invoke('markets:set-margin', patch),
  marketsCompare: (instrumentIds, interval, limit) =>
    ipcRenderer.invoke('markets:compare', instrumentIds, interval, limit),
  marketsWalkForward: (strategyId, options) => ipcRenderer.invoke('markets:walk-forward', strategyId, options),
  marketsMonteCarlo: (strategyId, options) => ipcRenderer.invoke('markets:monte-carlo', strategyId, options),
  // ---- Orbis Pages
  pagesState: () => ipcRenderer.invoke('pages:state'),
  pagesList: (filter) => ipcRenderer.invoke('pages:list', filter),
  pagesSearch: (query, options) => ipcRenderer.invoke('pages:search', query, options),
  pagesSuggest: (prefix) => ipcRenderer.invoke('pages:suggest', prefix),
  pagesRelated: (pageId) => ipcRenderer.invoke('pages:related', pageId),
  pagesResolve: (url) => ipcRenderer.invoke('pages:resolve', url),
  pagesOpen: (url) => ipcRenderer.invoke('pages:open', url),
  pagesFavourite: (pageId, favourite) => ipcRenderer.invoke('pages:favourite', pageId, favourite),
  pagesDetail: (pageId) => ipcRenderer.invoke('pages:detail', pageId),
  pagesPermissions: (pageId) => ipcRenderer.invoke('pages:permissions', pageId),
  pagesGrant: (pageId, capabilityId, scope, minutes) =>
    ipcRenderer.invoke('pages:grant', pageId, capabilityId, scope, minutes),
  pagesRevoke: (pageId, capabilityId) => ipcRenderer.invoke('pages:revoke', pageId, capabilityId),
  pagesCompute: (request) => ipcRenderer.invoke('pages:compute', request),
  pagesProjects: (pageId) => ipcRenderer.invoke('pages:projects', pageId),
  pagesProjectSave: (pageId, projectId, name, state) =>
    ipcRenderer.invoke('pages:project-save', pageId, projectId, name, state),
  pagesProjectDelete: (pageId, projectId) => ipcRenderer.invoke('pages:project-delete', pageId, projectId),
  pagesLabRun: (pageId, project, only, force) => ipcRenderer.invoke('pages:lab-run', pageId, project, only, force),
  pagesLabPlan: (project, only, cached) => ipcRenderer.invoke('pages:lab-plan', project, only, cached),
  pagesLabStaleness: (project, results) => ipcRenderer.invoke('pages:lab-staleness', project, results),
  pagesLabRerunFrom: (project, results, nodeId) => ipcRenderer.invoke('pages:lab-rerun-from', project, results, nodeId),
  pagesLabHealth: (project, results) => ipcRenderer.invoke('pages:lab-health', project, results),
  pagesApplications: () => ipcRenderer.invoke('pages:applications'),
  pagesApplication: (applicationId) => ipcRenderer.invoke('pages:application', applicationId),
  pagesApplicationSave: (application) => ipcRenderer.invoke('pages:application-save', application),
  pagesApplicationDelete: (applicationId) => ipcRenderer.invoke('pages:application-delete', applicationId),
  pagesApplicationRoute: (applicationId, route) =>
    ipcRenderer.invoke('pages:application-route', applicationId, route),
  pagesHealth: () => ipcRenderer.invoke('pages:health'),
  pagesGenerate: (request, intents) => ipcRenderer.invoke('pages:generate', request, intents),
  pagesGenerateKeep: (pageId) => ipcRenderer.invoke('pages:generate-keep', pageId),
  pagesGenerateDiscard: (pageId) => ipcRenderer.invoke('pages:generate-discard', pageId),
  pagesGenerateTry: (pageId, operation, input) => ipcRenderer.invoke('pages:generate-try', pageId, operation, input),
  pagesGenerateEdit: (pageId, request) => ipcRenderer.invoke('pages:generate-edit', pageId, request),
  pagesGenerateRebuild: (pageId, change) => ipcRenderer.invoke('pages:generate-rebuild', pageId, change),
  pagesGenerateHistory: (pageId) => ipcRenderer.invoke('pages:generate-history', pageId),
  pagesGeneratePublish: (pageId, versionId) => ipcRenderer.invoke('pages:generate-publish', pageId, versionId),
  pagesGenerateWithdraw: (pageId, versionId) => ipcRenderer.invoke('pages:generate-withdraw', pageId, versionId),
  pagesGenerateForget: (pageId) => ipcRenderer.invoke('pages:generate-forget', pageId),
  pagesGenerateSessions: () => ipcRenderer.invoke('pages:generate-sessions'),
  pagesGenerateDocument: (pageId) => ipcRenderer.invoke('pages:generate-document', pageId),
  // A Page written as code: built, opened in the sandbox, closed, and told where on screen it goes.
  pagesCodeBuild: (request) => ipcRenderer.invoke('pages:code-build', request),
  pagesCodeOpen: (pageId) => ipcRenderer.invoke('pages:code-open', pageId),
  pagesCodeHealth: (pageId) => ipcRenderer.invoke('pages:code-health', pageId),
  pagesCodeClose: (pageId) => ipcRenderer.invoke('pages:code-close', pageId),
  // One-way: sent four times a second from a ResizeObserver, and a reply would be a round trip nobody reads.
  pagesCodeRegion: (area) => ipcRenderer.send('pages:code-region', area),
  creationRun: (request) => ipcRenderer.invoke('creation:run', request),
  pagesExport: (pageId, entries, acceptSecrets) =>
    ipcRenderer.invoke('pages:export', pageId, entries, acceptSecrets),
  pagesInspectPackage: (raw, packedBytes) => ipcRenderer.invoke('pages:inspect-package', raw, packedBytes),
  pagesDiagnose: (fault, context) => ipcRenderer.invoke('pages:diagnose', fault, context),
  pagesAudit: (elements) => ipcRenderer.invoke('pages:audit', elements),
  pagesCheckDocument: (document) => ipcRenderer.invoke('pages:check-document', document),
  pagesSearchModule: (query, intents, looksLikeUrl) =>
    ipcRenderer.invoke('pages:search-module', query, intents, looksLikeUrl),
  pagesAnswer: (question) => ipcRenderer.invoke('pages:answer', question),
  pagesParticipants: () => ipcRenderer.invoke('pages:participants'),
  pagesSend: (fromPageId, toPageId, kind, body) =>
    ipcRenderer.invoke('pages:send', fromPageId, toPageId, kind, body),
  marketsDerivatives: (instrumentId, window) => ipcRenderer.invoke('markets:derivatives', instrumentId, window),
  marketsFundingHistory: (instrumentId, limit) =>
    ipcRenderer.invoke('markets:funding-history', instrumentId, limit),
  marketsOiHistory: (instrumentId, window, limit) =>
    ipcRenderer.invoke('markets:oi-history', instrumentId, window, limit),
  marketsLongShort: (instrumentId, window, limit) =>
    ipcRenderer.invoke('markets:long-short', instrumentId, window, limit),
  marketsContracts: (kind) => ipcRenderer.invoke('markets:contracts', kind),
  marketsTapeAnalysis: (instrumentId, options) => ipcRenderer.invoke('markets:tape-analysis', instrumentId, options),
  marketsExperience: () => ipcRenderer.invoke('markets:experience'),
  marketsSetExperience: (patch) => ipcRenderer.invoke('markets:set-experience', patch),
  marketsExperienceOverride: (patch) => ipcRenderer.invoke('markets:experience-override', patch),
  marketsResetExperience: () => ipcRenderer.invoke('markets:reset-experience'),
  marketsExperienceRequest: (said) => ipcRenderer.invoke('markets:experience-request', said),
  marketsLearned: (termId, hint) => ipcRenderer.invoke('markets:learned', termId, hint),
  marketsExplain: (asked) => ipcRenderer.invoke('markets:explain', asked),
  marketsGlossary: (surface) => ipcRenderer.invoke('markets:glossary', surface),
  marketsOnboarding: () => ipcRenderer.invoke('markets:onboarding'),
  marketsOnboardingDraft: (draft) => ipcRenderer.invoke('markets:onboarding-draft', draft),
  marketsOnboardingApply: (draft) => ipcRenderer.invoke('markets:onboarding-apply', draft),
  marketsOnboardingSkip: () => ipcRenderer.invoke('markets:onboarding-skip'),
  marketsOnboardingRestart: () => ipcRenderer.invoke('markets:onboarding-restart'),
  marketsCurrency: () => ipcRenderer.invoke('markets:currency'),
  marketsSetCurrency: (code) => ipcRenderer.invoke('markets:set-currency', code),
  marketsResetCurrency: () => ipcRenderer.invoke('markets:reset-currency'),
  marketsCurrencyOptions: (patch) => ipcRenderer.invoke('markets:currency-options', patch),
  marketsSetTicker: (config) => ipcRenderer.invoke('markets:set-ticker', config),
  marketsStrip: () => ipcRenderer.invoke('markets:strip'),
  marketsStripEnabled: (enabled) => ipcRenderer.invoke('markets:strip-enabled', enabled),
  marketsSearch: (query) => ipcRenderer.invoke('markets:search', query),
  marketsTickerAdd: (instrumentId) => ipcRenderer.invoke('markets:ticker-add', instrumentId),
  marketsTickerRemove: (instrumentId) => ipcRenderer.invoke('markets:ticker-remove', instrumentId),
  marketsAddGroup: (name) => ipcRenderer.invoke('markets:ticker-group', name),
  marketsSetGroup: (groupId) => ipcRenderer.invoke('markets:set-group', groupId),
  marketsRemoveGroup: (groupId) => ipcRenderer.invoke('markets:remove-group', groupId),
  marketsRefresh: () => ipcRenderer.invoke('markets:refresh'),
  onMarketAlert: (listener) => subscribe('markets:alert', listener),
  onMarketTrigger: (listener) => subscribe('markets:trigger', listener),
  onMarketsOpen: (listener) => subscribe('markets:open', listener),
  onMarketsStripChanged: (listener) => subscribe('markets:strip-changed', listener),
  onMarketsShow: (listener) => subscribe('markets:show', listener),
  onOpenArtifact: (listener) => subscribe('artifacts:show', listener),
  /*
   * Notifications: everything through the one door, and no way to make one.
   *
   * There is deliberately no `notify` here. A notification exists because something inside Orbis finished, failed or
   * is waiting -- never because a window asked for one -- so the renderer can read them, mark them, forget them and
   * press their buttons, and that is all it can do.
   */
  notifications: () => ipcRenderer.invoke('notifications:do', 'list'),
  notificationRead: (id: string | null) => ipcRenderer.invoke('notifications:do', 'read', id),
  notificationClear: (id: string | null) => ipcRenderer.invoke('notifications:do', 'clear', id),
  notificationAct: (id: string, action: string) => ipcRenderer.invoke('notifications:do', 'act', id, action),
  /** What the window is showing, so Orbis does not announce what is already in front of somebody. */
  notificationWatching: (what: string | null) => ipcRenderer.invoke('notifications:do', 'watching', what),
  /**
   * Orbis Music, through its one channel.
   *
   * `op` names what to do, and everything is checked on the other side. Nothing here can name a file: adding
   * music opens the operating system's own picker, and the only other thing that touches a disk takes a track id.
   */
  music: (op: string, a?: unknown, b?: unknown, c?: unknown) => ipcRenderer.invoke('music:do', op, a, b, c),
  /**
   * Ambient Intelligence: what Orbis has worked out somebody is doing.
   *
   * Reading only, from the window's point of view -- nothing here records activity. Activity comes off the event
   * bus in the main process, so a renderer cannot write a row into somebody's history.
   */
  ambient: (op: string, a?: unknown, b?: unknown) => ipcRenderer.invoke('ambient:do', op, a, b),
  /** Orbis Courses: one channel, named operations. See `src/main/courses/ipc.ts` for the list. */
  courses: (op: string, a?: unknown, b?: unknown, c?: unknown) => ipcRenderer.invoke('courses:do', op, a, b, c),
  native: (op: string, a?: unknown, b?: unknown, c?: unknown) => ipcRenderer.invoke('native:do', op, a, b, c),
  /** Orbis Choose: one channel, named operations. See `src/main/choose/ipc.ts` for the list. */
  choose: (op: string, asked?: unknown) => ipcRenderer.invoke('choose:do', op, asked),
  // Told when an app's instance changes, so a card on screen can re-read rather than drift out of date.
  onNativeChanged: (listen: (instanceId: string) => void) => {
    const handler = (_event: unknown, instanceId: string): void => listen(instanceId)
    ipcRenderer.on('native:changed', handler)
    return () => ipcRenderer.removeListener('native:changed', handler)
  },
  onAmbientChanged: (listener: (context: unknown) => void) => subscribe('ambient:changed', listener),
  onMusicChanged: (listener: (state: unknown) => void) => subscribe('music:changed', listener),
  onMusicImportProgress: (listener: (progress: unknown) => void) => subscribe('music:import-progress', listener),

  /*
   * Orbis Student.
   *
   * One channel with an operation name, the same way Orbis Music does it: Student has well over a hundred things a
   * surface can ask for, and a channel each would be a hundred lines in the channel map for one feature.
   */
  student: (op: string, a?: unknown, b?: unknown, c?: unknown) => ipcRenderer.invoke('student:do', op, a, b, c),
  onStudentChanged: (listener: () => void) => subscribe('student:changed', listener),
  /** Tells Orbis whether this computer asks for less movement; the main process cannot read that setting itself. */
  systemWantsStillness: (still: boolean) => ipcRenderer.invoke('experience:system-motion', still),
  notificationTest: () => ipcRenderer.invoke('notifications:do', 'test'),
  onNotificationsChanged: (listener: () => void) => subscribe('notifications:changed', listener),
  /** A notification was pressed: the window is told which event it was about and takes the person there. */
  onNotificationOpen: (listener: (what: { id: string; event: string; subject: Record<string, string> }) => void) => subscribe('notifications:open', listener),
  securityLog: () => ipcRenderer.invoke('security:log'),
  clearSecurityLog: () => ipcRenderer.invoke('security:clear-log'),
  profileLockState: () => ipcRenderer.invoke('profile-lock:state'),
  profileLockSave: (policy) => ipcRenderer.invoke('profile-lock:save', policy),
  profileLockNow: () => ipcRenderer.invoke('profile-lock:lock'),
  onAccountLocked: (listener) => subscribe('account:locked', listener),
  tabLockState: () => ipcRenderer.invoke('tab-lock:state'),
  tabLockJudge: (password, name) => ipcRenderer.invoke('tab-lock:judge', password, name),
  tabLockCreateGroup: (name, password, policy) => ipcRenderer.invoke('tab-lock:create-group', name, password, policy),
  tabLockRemoveGroup: (groupId, password) => ipcRenderer.invoke('tab-lock:remove-group', groupId, password),
  tabLockUnlockGroup: (groupId, password) => ipcRenderer.invoke('tab-lock:unlock-group', groupId, password),
  tabLockChangeGroupPassword: (groupId, current, next) => ipcRenderer.invoke('tab-lock:change-group-password', groupId, current, next),
  tabLockResetGroupPassword: (groupId, accountPassword, next) => ipcRenderer.invoke('tab-lock:reset-group-password', groupId, accountPassword, next),
  tabLockSetGroupPolicy: (groupId, policy) => ipcRenderer.invoke('tab-lock:set-group-policy', groupId, policy),
  tabLockSetDefaultPolicy: (policy) => ipcRenderer.invoke('tab-lock:set-default-policy', policy),
  tabLockAddRule: (rule) => ipcRenderer.invoke('tab-lock:add-rule', rule),
  tabLockRemoveRule: (ruleId) => ipcRenderer.invoke('tab-lock:remove-rule', ruleId),
  tabLockSetRules: (rules) => ipcRenderer.invoke('tab-lock:set-rules', rules),
  tabLockProtect: (tabId, groupId) => ipcRenderer.invoke('tab-lock:protect', tabId, groupId),
  tabLockUnprotect: (tabId, password) => ipcRenderer.invoke('tab-lock:unprotect', tabId, password),
  tabLockUnlockTab: (tabId, password) => ipcRenderer.invoke('tab-lock:unlock-tab', tabId, password),
  tabLockLockTab: (tabId) => ipcRenderer.invoke('tab-lock:lock-tab', tabId),
  tabLockSetTabPolicy: (tabId, policy) => ipcRenderer.invoke('tab-lock:set-tab-policy', tabId, policy),
  tabLockLockAll: () => ipcRenderer.invoke('tab-lock:lock-all'),
  tabLockExplain: (tabId) => ipcRenderer.invoke('tab-lock:explain', tabId),
  tabLockCheckLabel: (label, url) => ipcRenderer.invoke('tab-lock:check-label', label, url),
  onTabLockChanged: (listener) => subscribe('tab-lock:changed', listener),
  onTabLockSwept: (listener) => subscribe('tab-lock:swept', listener),
  vaultStatus: () => ipcRenderer.invoke('vault:status'),
  vaultQuestion: () => ipcRenderer.invoke('vault:question'),
  vaultCreate: (password, recovery) => ipcRenderer.invoke('vault:create', password, recovery),
  vaultUnlock: (password) => ipcRenderer.invoke('vault:unlock', password),
  vaultLock: () => ipcRenderer.invoke('vault:lock'),
  vaultList: () => ipcRenderer.invoke('vault:list'),
  vaultReveal: (id) => ipcRenderer.invoke('vault:reveal', id),
  vaultAdd: (secret) => ipcRenderer.invoke('vault:add', secret),
  vaultUpdate: (id, secret) => ipcRenderer.invoke('vault:update', id, secret),
  vaultRemove: (id) => ipcRenderer.invoke('vault:remove', id),
  vaultChangePassword: (current, next) => ipcRenderer.invoke('vault:change-password', current, next),
  vaultSetRecovery: (password, recovery) => ipcRenderer.invoke('vault:set-recovery', password, recovery),
  vaultRecover: (answer, password) => ipcRenderer.invoke('vault:recover', answer, password),
  vaultAutoLock: (password, ms) => ipcRenderer.invoke('vault:auto-lock', password, ms),
  vaultDestroy: (password) => ipcRenderer.invoke('vault:destroy', password),
  onVaultLocked: (listener) => subscribe('vault:locked', listener),
  widgetWeather: (city) => ipcRenderer.invoke('widgets:weather', city),
  widgetFeed: (url) => ipcRenderer.invoke('widgets:feed', url),
  startSteps: (goal) => ipcRenderer.invoke('steps:start', goal),
  readSteps: (runId) => ipcRenderer.invoke('steps:read', runId),
  pauseSteps: (runId) => ipcRenderer.invoke('steps:pause', runId),
  resumeSteps: (runId) => ipcRenderer.invoke('steps:resume', runId),
  stopSteps: (runId) => ipcRenderer.invoke('steps:stop', runId),
  skipStep: (runId) => ipcRenderer.invoke('steps:skip', runId),
  stepsVerified: (runId) => ipcRenderer.invoke('steps:verified', runId),
  onStepsChanged: (listener) => subscribe('steps:changed', listener),
  skillSettings: () => ipcRenderer.invoke('skills:settings'),
  setSkillSettings: (next) => ipcRenderer.invoke('skills:set-settings', next),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  previewSkill: (runId) => ipcRenderer.invoke('skills:preview', runId),
  saveSkill: (runId, edits) => ipcRenderer.invoke('skills:save', runId, edits),
  matchSkills: (request) => ipcRenderer.invoke('skills:match', request),
  runSkill: (workflowId, inputs, request) => ipcRenderer.invoke('skills:run', workflowId, inputs, request),
  editSkill: (workflowId, edits) => ipcRenderer.invoke('skills:edit', workflowId, edits),
  setSkillEnabled: (workflowId, enabled) => ipcRenderer.invoke('skills:set-enabled', workflowId, enabled),
  removeSkill: (workflowId, alsoWorkflow) => ipcRenderer.invoke('skills:remove', workflowId, alsoWorkflow),
  removeAllSkills: () => ipcRenderer.invoke('skills:remove-all'),
  rollBackSkill: (workflowId) => ipcRenderer.invoke('skills:roll-back', workflowId),
  exportSkill: (workflowId) => ipcRenderer.invoke('skills:export', workflowId),
  importSkill: (json) => ipcRenderer.invoke('skills:import', json),
  onSkillsChanged: (listener) => subscribe('skills:changed', listener),
  listMemories: (options) => ipcRenderer.invoke('memory:list', options),
  addMemory: (text, options) => ipcRenderer.invoke('memory:add', text, options),
  updateMemory: (id, patch) => ipcRenderer.invoke('memory:update', id, patch),
  removeMemory: (id) => ipcRenderer.invoke('memory:remove', id),
  clearMemories: () => ipcRenderer.invoke('memory:clear'),
  memorySettings: () => ipcRenderer.invoke('memory:settings'),
  setMemorySettings: (next) => ipcRenderer.invoke('memory:set-settings', next),
  onMemoryChanged: (listener) => subscribe('memory:changed', listener),

  // The pages this person has read, kept on this computer. Nothing here switches the feature on: that is a decision
  // made in settings with the wording in front of them, and `recall:set-settings` is where it happens.
  recallOverview: () => ipcRenderer.invoke('recall:overview'),
  recallSetSettings: (next) => ipcRenderer.invoke('recall:set-settings', next),
  recallSearch: (query, options) => ipcRenderer.invoke('recall:search', query, options),
  recallRecent: (limit, host) => ipcRenderer.invoke('recall:recent', limit, host),
  recallPage: (pageId) => ipcRenderer.invoke('recall:page', pageId),
  recallForget: (pageId) => ipcRenderer.invoke('recall:forget', pageId),
  recallForgetSite: (host, alsoBlock) => ipcRenderer.invoke('recall:forget-site', host, alsoBlock),
  recallForgetBetween: (from, to) => ipcRenderer.invoke('recall:forget-between', from, to),
  recallClear: () => ipcRenderer.invoke('recall:clear'),
  onRecallChanged: (listener) => subscribe('recall:changed', listener),
  // Schedules. Nothing here runs anything: each call names a saved workflow, page, workspace, address, question or
  // reminder, and the scheduler hands it to whichever engine already does that work.
  listSchedules: () => ipcRenderer.invoke('schedules:list'),
  addSchedule: (job) => ipcRenderer.invoke('schedules:add', job),
  updateSchedule: (jobId, patch) => ipcRenderer.invoke('schedules:update', jobId, patch),
  pauseSchedule: (jobId, until) => ipcRenderer.invoke('schedules:pause', jobId, until),
  resumeSchedule: (jobId) => ipcRenderer.invoke('schedules:resume', jobId),
  cancelSchedule: (jobId) => ipcRenderer.invoke('schedules:cancel', jobId),
  removeSchedule: (jobId) => ipcRenderer.invoke('schedules:remove', jobId),
  skipNextRun: (jobId, dueAt) => ipcRenderer.invoke('schedules:skip-next', jobId, dueAt),
  runScheduleNow: (jobId) => ipcRenderer.invoke('schedules:run-now', jobId),
  readSchedulePhrase: (phrase, zone) => ipcRenderer.invoke('schedules:read-phrase', phrase, zone),
  previewSchedule: (schedule, count) => ipcRenderer.invoke('schedules:preview', schedule, count),
  scheduleCapabilities: () => ipcRenderer.invoke('schedules:capabilities'),
  canRunWithComputerOff: (action) => ipcRenderer.invoke('schedules:can-run-offline', action),
  onSchedulesChanged: (listener) => subscribe('schedules:changed', listener),
  upcomingSchedules: (days) => ipcRenderer.invoke('schedules:upcoming', days),
  // What this computer can be woken from, and hibernating it so that it can be. Neither changes a setting.
  schedulePower: () => ipcRenderer.invoke('schedules:power'),
  hibernateNow: () => ipcRenderer.invoke('schedules:hibernate'),
  // A schedule asked for one of Orbis's own Pages, which are hosted in this window.
  onScheduleOpenPage: (listener) => subscribe('schedules:open-page', listener),
  saveSearchSession: (session) => ipcRenderer.invoke('search-sessions:save', session),
  listSearchSessions: (query) => ipcRenderer.invoke('search-sessions:list', query),
  getSearchSession: (id) => ipcRenderer.invoke('search-sessions:get', id),
  findSearchSession: (about) => ipcRenderer.invoke('search-sessions:find', about),
  removeSearchSession: (id) => ipcRenderer.invoke('search-sessions:remove', id),
  clearSearchSessions: () => ipcRenderer.invoke('search-sessions:clear'),
  onSearchSessionsChanged: (listener) => subscribe('search-sessions:changed', listener),
  galaxyView: (view) => ipcRenderer.invoke('galaxy:view', view),
  galaxyDescribe: (id) => ipcRenderer.invoke('galaxy:describe', id),
  galaxyLink: (from, to, note) => ipcRenderer.invoke('galaxy:link', from, to, note),
  galaxyUnlink: (id) => ipcRenderer.invoke('galaxy:unlink', id),
  galaxyAsk: (ids, question) => ipcRenderer.invoke('galaxy:ask', ids, question),
  onGalaxyChanged: (listener) => subscribe('galaxy:changed', listener),
  onConversationsReload: (listener) => subscribe('conversations:reload', listener),
  controlSwitches: () => ipcRenderer.invoke('control:switches'),
  setControlSwitch: (domain, on) => ipcRenderer.invoke('control:set-switch', domain, on),
  controlEffects: () => ipcRenderer.invoke('control:effects'),
  setControlEffect: (effect, rule) => ipcRenderer.invoke('control:set-effect', effect, rule),
  defaultBrowserState: () => ipcRenderer.invoke('default-browser:state'),
  requestDefaultBrowser: () => ipcRenderer.invoke('default-browser:request'),
  openDefaultAppsSettings: () => ipcRenderer.invoke('default-browser:settings'),
  transcribeAudio: (audioBuffer, options) => ipcRenderer.invoke('voice:transcribe', audioBuffer, options),
  cancelTranscription: () => ipcRenderer.invoke('voice:cancel'),
  voiceHardware: () => ipcRenderer.invoke('voice:hardware'),
  pulsarModelsStatus: () => ipcRenderer.invoke('voice:models-status'),
  downloadPulsarModel: (id) => ipcRenderer.invoke('voice:models-download', id),
  cancelPulsarModelDownload: (id) => ipcRenderer.invoke('voice:models-cancel-download', id),
  deletePulsarModel: (id) => ipcRenderer.invoke('voice:models-delete', id),
  verifyPulsarModel: (id) => ipcRenderer.invoke('voice:models-verify', id),
  onPulsarModelProgress: (listener) => subscribe('voice:models-progress', listener),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('image:save', dataUrl, name),
  editImage: (request) => ipcRenderer.invoke('image:edit', request),
  runSearch: (query, vertical) => ipcRenderer.invoke('search:run', query, vertical),
  specializedSearchHealthy: () => ipcRenderer.invoke('search:specialized-health'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdateDownload: () => ipcRenderer.invoke('update:cancel-download'),
  restartAndUpdate: () => ipcRenderer.invoke('update:restart-and-update'),
  setUpdateSettings: (patch) => ipcRenderer.invoke('update:settings', patch),
  onUpdateChanged: (listener) => subscribe('update:changed', listener),
  notices: () => ipcRenderer.invoke('app:notices'),
  licenceFile: (which) => ipcRenderer.invoke('app:licence-file', which),
  suggestFollowups: (messages) => ipcRenderer.invoke('chat:suggest', messages),
  generateTitle: (prompt) => ipcRenderer.invoke('chat:title', prompt),
  exportChat: (kind, title, text) => ipcRenderer.invoke('chat:export', kind, title, text),
  runDoctor: () => ipcRenderer.invoke('app:doctor'),
  completeDraft: (draft, messages) => ipcRenderer.invoke('chat:complete', draft, messages),
  answerBrowserConfirmation: (requestId, confirmationId, approved) => ipcRenderer.invoke('chat:browser-confirm', requestId, confirmationId, approved),
  controlAutomation: (requestId, action) => ipcRenderer.invoke('automation:control', requestId, action),
  steerAutomation: (requestId, text) => ipcRenderer.invoke('automation:steer', requestId, text),
  meetingNotes: () => ipcRenderer.invoke('meetings:do', 'list'),
  meetingNote: (id) => ipcRenderer.invoke('meetings:do', 'get', id),
  saveMeetingNote: (note) => ipcRenderer.invoke('meetings:do', 'save', note),
  removeMeetingNote: (id) => ipcRenderer.invoke('meetings:do', 'remove', id),
  summariseMeetingNote: (id, model) => ipcRenderer.invoke('meetings:do', 'summarise', id, model),
  projectFiles: (projectId) => ipcRenderer.invoke('project-files:do', 'list', projectId),
  addProjectFiles: (projectId) => ipcRenderer.invoke('project-files:do', 'add', projectId),
  removeProjectFile: (projectId, fileId) => ipcRenderer.invoke('project-files:do', 'remove', projectId, fileId),
  exportConversation: (id) => ipcRenderer.invoke('share:export', 'conversation', id),
  exportProject: (id) => ipcRenderer.invoke('share:export', 'project', id),
  importProject: () => ipcRenderer.invoke('share:import-project'),
  researchRuns: () => ipcRenderer.invoke('research:control', 'list'),
  pauseResearch: (id) => ipcRenderer.invoke('research:control', 'pause', id),
  resumeResearch: (id) => ipcRenderer.invoke('research:control', 'resume', id),
  steerResearch: (id, change) => ipcRenderer.invoke('research:control', 'change', id, change),
  // Two values rather than one, so the note travels beside the run it is about.
  onResearchRun: (listener) => {
    const handler = (_event: IpcRendererEvent, view: ResearchRunView, note: string | null): void => listener(view, note)
    ipcRenderer.on('research:run', handler)
    return () => {
      ipcRenderer.removeListener('research:run', handler)
    }
  },
  unfinishedAutomations: () => ipcRenderer.invoke('automation:unfinished'),
  forgetAutomation: (id) => ipcRenderer.invoke('automation:forget', id),
  classifyAutomationMessage: (text, objective) => ipcRenderer.invoke('automation:classify', text, objective),
  chromiumEmbedRegion: (region: { x: number; y: number; width: number; height: number; dpr: number; visible: boolean; viewportWidth?: number }) => ipcRenderer.send('chromium:embed-region', region),
  onChromiumShow: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('chromium:show', listener)
    return () => ipcRenderer.removeListener('chromium:show', listener)
  },
  // The way back to the chat, asked for from inside the browser: the Chat button lives on the browser's own toolbar
  // now, so the browser is what says "show me the chat again".
  onChromiumHide: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('chromium:hide', listener)
    return () => ipcRenderer.removeListener('chromium:hide', listener)
  },
  /**
   * The native menu, and "Ask Orion" from a page.
   *
   * All three of these were already being sent by the main process and listened for by nothing: File > New Chat did
   * nothing, Help > About Orbis did nothing, and the page-side "Ask Orion" handed its question to a channel with no
   * other end. Wired at both ends now.
   */
  onMenuNewChat: (listener: () => void) => {
    const on = (): void => listener()
    ipcRenderer.on('menu:new-chat', on)
    return () => ipcRenderer.removeListener('menu:new-chat', on)
  },
  onMenuAbout: (listener: () => void) => {
    const on = (): void => listener()
    ipcRenderer.on('menu:about', on)
    return () => ipcRenderer.removeListener('menu:about', on)
  },
  onChatAsk: (listener: (text: string) => void) => {
    const on = (_e: unknown, text: string): void => listener(typeof text === 'string' ? text : '')
    ipcRenderer.on('chat:ask', on)
    return () => ipcRenderer.removeListener('chat:ask', on)
  },
  /**
   * A Visual Search arriving from the browser.
   *
   * Somebody selected something on a page, asked Orion about it, and pressed either "Continue in chat" or a
   * laboratory button. The selection comes with it as a picture, because that is what the conversation is about.
   */
  onVisualArrived: (listener: (arrival: VisualArrival) => void) => {
    const on = (_e: unknown, arrival: VisualArrival): void => listener(arrival)
    ipcRenderer.on('visual:arrived', on)
    return () => ipcRenderer.removeListener('visual:arrived', on)
  },
  onChromiumClosed: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('chromium:closed', listener)
    return () => ipcRenderer.removeListener('chromium:closed', listener)
  },
  /** Whether the browser is running at all -- which is not the same as whether its window is in front. */
  onChromiumRunning: (listener: (running: boolean) => void) => {
    const on = (_e: unknown, running: boolean): void => listener(running === true)
    ipcRenderer.on('chromium:running', on)
    return () => ipcRenderer.removeListener('chromium:running', on)
  },
  chromiumOpen: (input: string, options?: { newTab?: boolean; more?: string[] }) => ipcRenderer.invoke('chromium:open', input, options),
  /** Puts the browser's window away and brings this one back. The chat's side of the handoff. */
  chromiumReturnToChat: () => ipcRenderer.invoke('chromium:return-to-chat'),
  getBrowserLibrary: () => ipcRenderer.invoke('library:get'),
  onBrowserLibrary: (listener) => subscribe('library:changed', listener),
  toggleBookmark: (url, title) => ipcRenderer.invoke('library:toggle-bookmark', url, title),
  removeHistory: (url) => ipcRenderer.invoke('library:remove-history', url),
  isWindowFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  onWindowFullscreen: (listener) => subscribe('window:fullscreen-changed', listener),
  addShortcut: (name, url) => ipcRenderer.invoke('shortcuts:add', name, url),
  updateShortcut: (id, name, url) => ipcRenderer.invoke('shortcuts:update', id, name, url),
  removeShortcut: (id) => ipcRenderer.invoke('shortcuts:remove', id),
  refreshShortcutIcon: (id) => ipcRenderer.invoke('shortcuts:refresh-icon', id),
  recordSearch: (query) => ipcRenderer.invoke('library:record-search', query),
  removeSearch: (query) => ipcRenderer.invoke('library:remove-search', query),
  clearSearches: () => ipcRenderer.invoke('library:clear-searches'),
  recordSuggestionPick: (key) => ipcRenderer.invoke('library:record-pick', key),
  webSuggestions: (query) => ipcRenderer.invoke('omnibox:web', query),
  predictQueries: (input) => ipcRenderer.invoke('omnibox:predict', input),
  downloadAction: (id, action) => ipcRenderer.invoke('library:download-action', id, action),
  setWindowFullscreen: (on) => ipcRenderer.invoke('window:fullscreen', on),
  onSettingsChanged: (listener) => subscribe('settings:changed', listener),
  getControlCapabilities: (filter) => ipcRenderer.invoke('control:capabilities', filter),
  getControlState: (parts) => ipcRenderer.invoke('control:state', parts),
  executeControl: (command) => ipcRenderer.invoke('control:execute', command),
  // Running code. The address and key live in settings; nothing here can point the runner anywhere.
  // The research panels in the ported Physics Studio ask Orion a question and read the answer whole.
  physicsAsk: (prompt: string, schema: string | null) => ipcRenderer.invoke('physics:ask', prompt, schema),
  /** Asks for a quiz about something. Comes back checked, or with a reason it was refused. */
  writeQuiz: (asked: { about: string; count: number; difficulty: 'easy' | 'ordinary' | 'hard'; source?: string; from?: string }) =>
    ipcRenderer.invoke('quiz:write', asked),
  /** The same question with a picture of the simulation attached, for things the numbers do not say. */
  physicsLook: (prompt: string, area: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('physics:look', prompt, area),
  executionLanguages: () => ipcRenderer.invoke('execution:languages'),
  executionStarter: (language: string) => ipcRenderer.invoke('execution:starter', language),
  executionReady: () => ipcRenderer.invoke('execution:ready'),
  runCode: (request: { language: string; source: string; stdin: string; predictOnly?: boolean }) => ipcRenderer.invoke('execution:run', request),
  runControlPlan: (plan, source) => ipcRenderer.invoke('control:run-plan', plan, source),
  controlRun: (id, action) => ipcRenderer.invoke('control:run-control', id, action),
  listControlRuns: () => ipcRenderer.invoke('control:runs'),
  getControlLog: (limit) => ipcRenderer.invoke('control:log', limit),
  onControlRunUpdate: (listener) => subscribe('control:run-update', listener),
  setControlScope: (scope, descriptors) => ipcRenderer.send('control:window-scope', scope, descriptors),
  onControlWindowRun: (listener) => subscribe('control:window-run', listener),
  answerControlWindowRun: (callId, result) => ipcRenderer.send('control:window-result', callId, result),
  onControlConfirm: (listener) => subscribe('control:confirm', listener),
  answerControlConfirm: (id, approved) => ipcRenderer.send('control:confirm-answer', id, approved),
  getWorkflowLibrary: () => ipcRenderer.invoke('workflows:library'),
  getWorkflow: (id) => ipcRenderer.invoke('workflows:get', id),
  createWorkflow: (name, templateId) => ipcRenderer.invoke('workflows:create', name, templateId),
  saveWorkflow: (workflow, note) => ipcRenderer.invoke('workflows:save', workflow, note),
  regenerateWorkflowTitle: (id) => ipcRenderer.invoke('workflows:regenerate-title', id),
  renameWorkflow: (id, name) => ipcRenderer.invoke('workflows:rename', id, name),
  duplicateWorkflow: (id) => ipcRenderer.invoke('workflows:duplicate', id),
  removeWorkflow: (id) => ipcRenderer.invoke('workflows:remove', id),
  exportWorkflowFile: (id) => ipcRenderer.invoke('workflows:export-file', id),
  importWorkflowFile: () => ipcRenderer.invoke('workflows:import-file'),
  importWorkflowJson: (json) => ipcRenderer.invoke('workflows:import-json', json),
  workflowVersions: (id) => ipcRenderer.invoke('workflows:versions', id),
  restoreWorkflowVersion: (id, version) => ipcRenderer.invoke('workflows:restore-version', id, version),
  validateWorkflow: (workflow, inputs) => ipcRenderer.invoke('workflows:validate', workflow, inputs),
  planWorkflow: (id) => ipcRenderer.invoke('workflows:plan', id),
  runWorkflow: (id, options) => ipcRenderer.invoke('workflows:run', id, options),
  controlWorkflowRun: (runId, action) => ipcRenderer.invoke('workflows:control', runId, action),
  workflowHistory: (id) => ipcRenderer.invoke('workflows:history', id),
  resumeWorkflowRun: (runId, inputs) => ipcRenderer.invoke('workflows:resume', runId, inputs),
  discardWorkflowCheckpoint: (runId) => ipcRenderer.invoke('workflows:discard-checkpoint', runId),
  draftWorkflow: (instruction, workflowId) => ipcRenderer.invoke('workflows:draft', instruction, workflowId),
  workflowHealth: (workflowId) => ipcRenderer.invoke('workflows:health', workflowId),
  workflowFindings: (workflowId) => ipcRenderer.invoke('workflows:findings', workflowId),
  workflowRepairs: (workflowId) => ipcRenderer.invoke('workflows:repairs', workflowId),
  workflowCompatibility: (workflowId) => ipcRenderer.invoke('workflows:compatibility', workflowId),
  applyWorkflowMigration: (workflowId) => ipcRenderer.invoke('workflows:apply-migration', workflowId),
  workflowsAffectedByUpdate: () => ipcRenderer.invoke('workflows:affected'),
  workflowsWaiting: () => ipcRenderer.invoke('workflows:waiting'),
  unqueueWorkflow: (workflowId) => ipcRenderer.invoke('workflows:unqueue', workflowId),
  startWorkflowRecording: () => ipcRenderer.invoke('workflows:recording-start'),
  pauseWorkflowRecording: (paused) => ipcRenderer.invoke('workflows:recording-pause', paused),
  stopWorkflowRecording: () => ipcRenderer.invoke('workflows:recording-stop'),
  saveWorkflowRecording: (name) => ipcRenderer.invoke('workflows:recording-save', name),
  rememberWorkflowSecret: (workflowId, name, value) => ipcRenderer.invoke('workflows:remember-secret', workflowId, name, value),
  forgetWorkflowSecret: (workflowId, name) => ipcRenderer.invoke('workflows:forget-secret', workflowId, name),
  rememberedWorkflowSecrets: (workflowId) => ipcRenderer.invoke('workflows:remembered-secrets', workflowId),
  onWorkflowsChanged: (listener) => subscribe('workflows:changed', listener),
  onWorkflowRunUpdate: (listener) => subscribe('workflows:run-update', listener),
  onWorkflowStep: (listener) => subscribe('workflows:step', listener),
  onWorkflowRunFinished: (listener) => subscribe('workflows:run-finished', listener),
  onWorkflowNotice: (listener) => subscribe('workflows:notice', listener),
  onWorkflowRecording: (listener) => subscribe('workflows:recording', listener),

  listNotes: (filter) => ipcRenderer.invoke('notes:list', filter),
  noteTags: () => ipcRenderer.invoke('notes:tags'),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  createNote: (patch) => ipcRenderer.invoke('notes:create', patch),
  saveNote: (note) => ipcRenderer.invoke('notes:save', note),
  removeNote: (id) => ipcRenderer.invoke('notes:remove', id),
  archiveNote: (id, archived) => ipcRenderer.invoke('notes:archive', id, archived),
  noteFromPage: () => ipcRenderer.invoke('notes:from-page'),
  exportNotes: (ids) => ipcRenderer.invoke('notes:export', ids),
  importNotes: (json) => ipcRenderer.invoke('notes:import', json),
  onNotesChanged: (listener) => subscribe('notes:changed', listener),

  tasksSnapshot: () => ipcRenderer.invoke('tasks:snapshot'),
  listTasks: (filter) => ipcRenderer.invoke('tasks:list', filter),
  createTask: (patch) => ipcRenderer.invoke('tasks:create', patch),
  saveTask: (task) => ipcRenderer.invoke('tasks:save', task),
  updateTask: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
  completeTask: (id, done) => ipcRenderer.invoke('tasks:complete', id, done),
  removeTask: (id) => ipcRenderer.invoke('tasks:remove', id),
  clearCompletedTasks: (listId) => ipcRenderer.invoke('tasks:clear-completed', listId),
  reorderTasks: (listId, ids) => ipcRenderer.invoke('tasks:reorder', listId, ids),
  saveTaskList: (list) => ipcRenderer.invoke('tasks:save-list', list),
  createTaskList: (patch) => ipcRenderer.invoke('tasks:create-list', patch),
  removeTaskList: (id) => ipcRenderer.invoke('tasks:remove-list', id),
  taskFromPage: (listId) => ipcRenderer.invoke('tasks:from-page', listId),
  onTasksChanged: (listener) => subscribe('tasks:changed', listener),

  clipboardHistory: (query, kind) => ipcRenderer.invoke('clipboard:history', query, kind),
  clipboardSettings: () => ipcRenderer.invoke('clipboard:settings'),
  updateClipboardSettings: (patch) => ipcRenderer.invoke('clipboard:update-settings', patch),
  useClip: (id) => ipcRenderer.invoke('clipboard:use', id),
  pinClip: (id, pinned) => ipcRenderer.invoke('clipboard:pin', id, pinned),
  removeClip: (id) => ipcRenderer.invoke('clipboard:remove', id),
  clearClipboardHistory: (includePinned) => ipcRenderer.invoke('clipboard:clear', includePinned),
  clipboardPaused: (paused) => ipcRenderer.invoke('clipboard:paused', paused),
  onClipboardChanged: (listener) => subscribe('clipboard:changed', listener),

  listBoards: () => ipcRenderer.invoke('whiteboard:list'),
  getBoard: (id) => ipcRenderer.invoke('whiteboard:get', id),
  createBoard: (patch) => ipcRenderer.invoke('whiteboard:create', patch),
  saveBoard: (board) => ipcRenderer.invoke('whiteboard:save', board),
  removeBoard: (id) => ipcRenderer.invoke('whiteboard:remove', id),
  renameBoard: (id, name) => ipcRenderer.invoke('whiteboard:rename', id, name),
  addToBoard: (id, elements) => ipcRenderer.invoke('whiteboard:add', id, elements),
  exportBoardSvg: (id) => ipcRenderer.invoke('whiteboard:export-svg', id),
  addPageToBoard: (id, at) => ipcRenderer.invoke('whiteboard:page-image', id, at),
  onBoardsChanged: (listener) => subscribe('whiteboard:changed', listener),

  neurovaList: () => ipcRenderer.invoke('neurova:list'),
  neurovaCreate: (title, brief, lyrics) => ipcRenderer.invoke('neurova:create', title, brief, lyrics),
  neurovaUpdate: (id, patch) => ipcRenderer.invoke('neurova:update', id, patch),
  neurovaRemove: (id) => ipcRenderer.invoke('neurova:remove', id),
  neurovaImportAudio: (id, name, note) => ipcRenderer.invoke('neurova:import-audio', id, name, note),
  neurovaAnalyse: (id, artifactId) => ipcRenderer.invoke('neurova:analyse', id, artifactId),
  neurovaSelectVersion: (id, versionId) => ipcRenderer.invoke('neurova:select-version', id, versionId),
  neurovaRestoreVersion: (id, versionId) => ipcRenderer.invoke('neurova:restore-version', id, versionId),
  neurovaRemoveVersion: (id, versionId) => ipcRenderer.invoke('neurova:remove-version', id, versionId),
  neurovaExportVersion: (id, versionId) => ipcRenderer.invoke('neurova:export-version', id, versionId),
  neurovaExportPackage: (id) => ipcRenderer.invoke('neurova:export-package', id),
  neurovaImportPackage: () => ipcRenderer.invoke('neurova:import-package'),
  neurovaProcess: (id, versionId, op) => ipcRenderer.invoke('neurova:process', id, versionId, op),
  neurovaTempo: (id, artifactId) => ipcRenderer.invoke('neurova:tempo', id, artifactId),
  neurovaWaveform: (id, artifactId) => ipcRenderer.invoke('neurova:waveform', id, artifactId),
  neurovaLyrics: (text) => ipcRenderer.invoke('neurova:lyrics', text),
  neurovaInterpret: (req) => ipcRenderer.invoke('neurova:interpret', req),
  neurovaEngines: () => ipcRenderer.invoke('neurova:engines'),
  onNeurovaChanged: (listener) => subscribe('neurova:changed', listener),

  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  saveCurrentWorkspace: (name, patch) => ipcRenderer.invoke('workspaces:save-current', name, patch),
  updateWorkspaceFromWindow: (id) => ipcRenderer.invoke('workspaces:update-current', id),
  saveWorkspace: (workspace) => ipcRenderer.invoke('workspaces:save', workspace),
  renameWorkspace: (id, name) => ipcRenderer.invoke('workspaces:rename', id, name),
  removeWorkspace: (id) => ipcRenderer.invoke('workspaces:remove', id),
  duplicateWorkspace: (id) => ipcRenderer.invoke('workspaces:duplicate', id),
  reorderWorkspaces: (ids) => ipcRenderer.invoke('workspaces:reorder', ids),
  planWorkspaceOpen: (id, replace) => ipcRenderer.invoke('workspaces:plan', id, replace),
  openWorkspace: (id, replace) => ipcRenderer.invoke('workspaces:open', id, replace),
  onWorkspacesChanged: (listener) => subscribe('workspaces:changed', listener),

  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  createProfile: (name) => ipcRenderer.invoke('profiles:create', name),
  saveProfile: (profile) => ipcRenderer.invoke('profiles:save', profile),
  renameProfile: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  switchProfile: (id) => ipcRenderer.invoke('profiles:switch', id),
  onProfileChanged: (listener) => subscribe('profiles:changed', listener),
  onProfilesChanged: (listener) => subscribe('profiles:list-changed', listener),

  getExperience: () => ipcRenderer.invoke('experience:get'),
  saveExperience: (config, reason) => ipcRenderer.invoke('experience:save', config, reason),
  experienceHealth: () => ipcRenderer.invoke('experience:health'),
  experienceSnapshots: () => ipcRenderer.invoke('experience:snapshots'),
  restoreExperienceSnapshot: (id) => ipcRenderer.invoke('experience:restore-snapshot', id),
  removeExperienceSnapshot: (id) => ipcRenderer.invoke('experience:remove-snapshot', id),
  resetExperienceSection: (section) => ipcRenderer.invoke('experience:reset-section', section),
  restoreOriginalExperience: () => ipcRenderer.invoke('experience:restore-original'),
  exportExperience: () => ipcRenderer.invoke('experience:export'),
  checkExperienceImport: (raw) => ipcRenderer.invoke('experience:check-import', raw),
  importExperience: (raw, how) => ipcRenderer.invoke('experience:import', raw, how),
  onExperienceChanged: (listener) => subscribe('experience:changed', listener)
}

/** Listens on a channel whose events carry one value; returns the unsubscribe function. */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// The Files frame is a subframe of the app itself; no web page loaded into a frame may receive the bridge.
const where = (globalThis as unknown as { location: { protocol: string; hostname: string } }).location
const ownPage = process.isMainFrame || where.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(where.hostname)
if (ownPage) contextBridge.exposeInMainWorld('api', api)

// Orbis Files bridge — the Files renderer calls window.orbis.invoke / window.orbis.on
const orbis = {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(`files:${channel}`, payload),
  on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, value: unknown): void => listener(value)
    ipcRenderer.on(`files:${channel}`, handler)
    return () => ipcRenderer.removeListener(`files:${channel}`, handler)
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  platform: process.platform,
  initialPath: undefined as string | undefined
}
if (ownPage) contextBridge.exposeInMainWorld('orbis', orbis)
