import type { SkillEdits, SkillMatch, SkillPreview, SkillSettings, SkillView } from './skills'
import type { MemoryCategory, MemoryEntry, MemorySettings } from './memory'
import type { OrionSearchSession } from './orionSearch'
import type { SavedSearchSummary } from './searchSessions'
import type { GalaxyEdge, GalaxyGraph, GalaxyNode, GalaxyNodeType, GalaxyView, UserLink } from './galaxy'

export interface GalaxyDescription {
  node: GalaxyNode
  counts: Partial<Record<GalaxyNodeType, number>>
  links: { other: GalaxyNode; edge: GalaxyEdge }[]
}
import type {
  BrowserCommand,
  CapabilityDescriptor,
  CommandResult,
  ControlConfirmRequest,
  Plan,
  RunControl,
  RunState,
  WindowBrowserState,
  WindowRunRequest,
  WindowRunResult, ControlDomain } from './browserControl'
import type { ControlLogEntryView } from './browserControlView'
import type { SidebarLayout } from './browserSidebar'
import type { StepRunView } from './stepPlan'
import type { Feed, Weather } from './widgetData'
import type { SpecializedOutcome } from './searchProviders'
import type { VoiceErrorCode, VoiceModel } from './voiceInput'
import type { WhisperModelId, WhisperDownloadProgress, WhisperHardwareInfo } from './whisperModels'
import type { SecretDetail, SecretInput, SecretSummary, VaultStatus } from './vault'

/** A vault call that could not be done, and why. Never carries anything of the vault. */
export interface VaultError {
  error: string
}

export const isVaultError = (value: unknown): value is VaultError => Boolean(value && typeof value === 'object' && typeof (value as VaultError).error === 'string')

/** What the system says about which browser opens links. */
export interface DefaultBrowserState {
  isDefault: boolean
  /** Whether Orbis can ask at all; false in a development run, where there is no installed application to choose. */
  canAsk: boolean
  why?: string
}
import type { RunControl as WorkflowRunControl, StepRecord } from './browserControl'
import type { ActiveWorkflowRun, RecordingState, Workflow, WorkflowIssue, WorkflowLibrary, WorkflowRunResult, WorkflowRunSummary, WorkflowVersion } from './workflows'
import type { Note, NoteFilter } from './notes'
import type { Task, TaskCounts, TaskFilter, TaskList } from './tasks'
import type { ClipboardSettings, ClipItem, ClipKind } from './clipboardHistory'
import type { Board } from './whiteboard'
import type { Workspace, WorkspaceSummary } from './workspaces'
import type { Profile } from './profiles'
import type { ConfigChange, ExperienceConfig, ExperienceExport, ExperienceHealth, ImportCheck } from './experience'
import type { PlanLine } from './workflowCompile'

export type Role = 'user' | 'assistant'

/** Status the main process sends while an image renders; the chat swaps in the mini games for it. */
export const IMAGE_GEN_STATUS = 'Generating image…'

export interface Attachment {
  name: string
  content: string
  type?: 'text' | 'image'
  mimeType?: string
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  /** Text files attached to a user message; their contents are sent to the model. */
  attachments?: Attachment[]
  /** Sent from the browser's floating assistant: always a task for the browser, never plain chat. */
  browserTask?: boolean
  /** The model's visible reasoning (`reasoning_content` or `<think>` text). */
  reasoning?: string
  /** How long the model spent reasoning before answering. */
  reasoningMs?: number
  /** Model that produced an assistant message. */
  model?: string
  /** Set when generation failed or was cut short. */
  error?: string
  feedback?: 'up' | 'down'
  /** Short follow-up messages offered under an assistant reply; clicking one sends it. */
  suggestions?: string[]
  /** The user's most likely next message, offered as ghost text only when the reply clearly invites it. */
  prediction?: string
  /** What Orbis did in the in-app browser for this reply. */
  steps?: BrowserStep[]
  /** A browser action waiting for the user's approval. */
  confirmation?: BrowserConfirmation
  /** The continuous browser automation (loop or game) this reply ran. */
  automation?: AutomationState
  /** The web research this reply is based on: the actual pages Orion read, which its [n] citations point to. */
  research?: Research
  createdAt: number
}

/** A web page Orion actually read (or found) while researching current information. */
export interface ResearchSource {
  /** Its number in the answer's citations, e.g. 2 for [2]. */
  n: number
  title: string
  /** The exact page, after redirects: what opens in the Orbis browser. */
  url: string
  domain: string
  /** The site's own name, when the page states it. */
  publisher?: string
  /** Dates the page itself states (YYYY-MM-DD). Absent when it shows none; never estimated. */
  published?: string
  updated?: string
  /** What the search engine showed for the page. */
  snippet: string
  /** The parts of the page relevant to the question, kept so follow-ups can refer to them. */
  excerpt: string
  /** The search that found it. */
  query: string
  /** False when the page couldn't be read and only its search snippet was used. */
  read: boolean
}

/** One round of web research for a question. */
export interface Research {
  id: string
  question: string
  queries: string[]
  /** How fresh the information had to be. */
  recency: 'day' | 'week' | 'month' | 'year' | 'any'
  retrievedAt: number
  sources: ResearchSource[]
  /** Why there are no sources, when research found none. */
  problem?: string
  /** Earlier research this reply drew on, rather than new research. */
  reused?: boolean
}

/**
 * A long-running browser automation: repeating work across items, pages or time, or playing a game.
 * Every count here comes from items Orbis verified on the page, never from estimates.
 */
export interface AutomationState {
  id: string
  kind: 'loop' | 'game'
  objective: string
  /** When it ends, in plain words, e.g. "when you say stop" or "after 50 results". */
  stopWhen: string
  status: 'running' | 'waiting-approval' | 'paused' | 'stopped' | 'completed' | 'stuck' | 'failed'
  /** Items (results, Shorts, pages, levels…) verified as processed. */
  completed: number
  total?: number
  unit: string
  /** What Orbis is on now, e.g. a result title or "Level 12". */
  current?: string
  /** Epoch ms when a time-limited automation ends. */
  deadline?: number
  /** Keys of processed items, so nothing is processed twice, including after a resume. */
  processed: string[]
  /** Findings collected along the way. */
  notes: string[]
  /** Browser actions taken so far. */
  actions: number
  /** Short excerpts of the pages visited, so the finish check can spot items that were shown but never processed. */
  pages?: { url: string; text: string }[]
  lastUrl?: string
  /** Why it isn't running any more. */
  reason?: string
  startedAt: number
}

/** One thing Orbis did (or was stopped from doing) in the in-app browser. */
export interface BrowserStep {
  id: string
  /** Plain description, e.g. "Opened wikipedia.org" or "Clicked “Add to cart”". */
  text: string
  status: 'done' | 'waiting' | 'declined' | 'blocked'
}

/** An action Orbis wants the user to approve before it runs. */
export interface BrowserConfirmation {
  id: string
  /** What Orbis is about to do, e.g. "Click “Place order” on amazon.com". */
  action: string
  /** Why it asks first. */
  reason: string
}

export interface FollowupSuggestions {
  next: string | null
  followups: string[]
}

export interface Conversation {
  id: string
  title: string
  model: string
  /** Never written to disk or listed in history; discarded when the user leaves it. */
  incognito?: boolean
  /** Shown in the sidebar's Pinned section. */
  pinned?: boolean
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export type Theme = 'system' | 'light' | 'dark'
export type ReasoningEffort = 'low' | 'high' | 'max'

export interface Settings {
  /** The renderer never receives the key itself, only whether one is stored. */
  hasApiKey: boolean
  defaultModel: string
  autoFallback: boolean
  reasoningEffort: ReasoningEffort
  systemPrompt: string
  theme: Theme
  /** Shown on assistant messages and used in the system prompt. */
  assistantName: string
  /** Shown on your messages. */
  userName: string
  /** How the assistant addresses you, e.g. "Commander". */
  userTitle: string
  /** Animated background particles and motion effects. */
  effects: boolean
  /** First-launch setup (the welcome screen and name) has been finished on this installation. */
  welcomeCompleted: boolean
  /** The address bar asks the search engine and Orion for predictions (sends the typed text). */
  searchSuggestions: boolean
  /** The address bar suggests from local history, searches, bookmarks and research, and learns from picks. */
  personalizedSuggestions: boolean
  /** Orbis opens its browser (at the saved size) as soon as it starts, instead of the chat. */
  openBrowserOnLaunch: boolean
}

export type SettingsUpdate = Partial<Omit<Settings, 'hasApiKey'>> & {
  /** Empty string clears the stored key. */
  apiKey?: string
}

export interface ModelInfo {
  /** Orbis's id for the model, stored with chats and settings. */
  id: string
  /** The Groq model to call, when it differs from `id` (a variant of a Groq model with its own settings). */
  apiModel?: string
  label: string
  description: string
  /** Accepts the top-level `reasoning_effort` parameter. */
  reasoningEffort: boolean
  /** Expects prior `reasoning_content` echoed back in multi-turn history. */
  echoReasoning: boolean
  /** Supports vision/image input. */
  vision?: boolean
  /** Max tokens per request; older history is trimmed to fit. */
  contextWindow: number
  /** Input tokens per minute Groq's free tier allows, when below the context window; history is trimmed to fit this too. */
  inputTokenLimit?: number
  /** Sends reasoning_effort "none", so the model answers without thinking first. */
  disableReasoning?: boolean
}

export interface ChatRequest {
  requestId: string
  model: string
  /** False keeps the request away from image generation, e.g. when rewriting a prompt. */
  images?: boolean
  /** Overrides the saved reasoning effort (Fast and Reasoning modes). */
  reasoningEffort?: ReasoningEffort
  /** Full history, ending with the new user message. */
  messages: ChatMessage[]
  /** Search the web for the latest user message and give the model the results. */
  webSearch?: boolean
  /** The in-app browser's active page, so requests like "click the first result" can refer to it. */
  browser?: { url: string; title: string }
  /** Asked from the address bar (Ctrl+Enter): answered in text, with research when needed; never runs the browser or makes images. */
  ask?: boolean
}

export type StreamEvent =
  | { type: 'start'; model: string }
  | { type: 'delta'; content?: string; reasoning?: string }
  | { type: 'status'; message: string }
  | { type: 'image'; url: string; prompt: string; seed: number }
  | { type: 'done'; model: string; truncated: boolean }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
  /** Orbis needs a browser tab to work in; the window opens its browser and hands over the active tab. */
  | { type: 'browser-target' }
  | { type: 'step'; step: BrowserStep }
  | { type: 'confirm'; confirmation: BrowserConfirmation }
  | { type: 'confirm-done'; id: string }
  | { type: 'automation'; automation: AutomationState }
  /** The sources this reply is based on, sent before the answer streams. */
  | { type: 'research'; research: Research }

export interface PickedFiles {
  attachments: Attachment[]
  /** Files that were too large or not text. */
  skipped: string[]
}

export interface ImageEditRequest {
  /** Prompt the current image was rendered from. */
  prompt: string
  instruction: string
  seed?: number
}

export interface ImageEditResult {
  url: string
  prompt: string
  seed: number
}

/** Ad blocking strength: Standard (strong, most compatible), Strict (also overlays, uncertain matches, third-party popups), Custom. */
export type AdBlockLevel = 'standard' | 'strict' | 'custom'
/** What gets blocked. "annoyances" covers overlays, cookie notices and anti-adblock walls. */
export interface AdBlockCategories {
  ads: boolean
  trackers: boolean
  annoyances: boolean
  popups: boolean
  redirects: boolean
}
export type AdBlockCategory = keyof AdBlockCategories

export interface AdBlockSettings {
  enabled: boolean
  level: AdBlockLevel
  /** The categories used when level is "custom". */
  custom: AdBlockCategories
  /** Sites (hostnames, subdomains included) where nothing is blocked. */
  siteExceptions: string[]
  /** Resources (host + path prefix) that are always allowed. */
  resourceExceptions: string[]
}

/** One request or action the blocking engine dealt with on a page. */
export interface AdBlockEntry {
  at: number
  category: AdBlockCategory
  url: string
  /** Resource type, e.g. script, image, xhr, popup, navigation. */
  type: string
  /** The filter rule that matched. */
  rule?: string
  action: 'blocked' | 'redirected' | 'allowed-by-exception' | 'uncertain'
}

/** Real blocking results for one browser tab's current page. */
export interface AdBlockPageReport {
  webContentsId: number
  pageUrl: string
  host: string
  siteAllowed: boolean
  counts: Record<AdBlockCategory, number>
  /** Element-hiding rules and scriptlets applied to the page. */
  hidingRules: number
  scriptlets: number
  recent: AdBlockEntry[]
}

export interface AdBlockListInfo {
  id: string
  name: string
  category: 'ads' | 'trackers' | 'annoyances' | 'orbis'
  rules: number
  updatedAt: number
  source: 'bundled' | 'downloaded'
}

import type { HistorySwipeView } from './historySwipe'
import type { Channel, UpdateStatus } from './updates'
import type { SearchResult, SearchVertical } from './orbisSearch'

export interface SearchOutcomeView {
  query: string
  vertical: SearchVertical
  results: SearchResult[]
  wantsAnswer: boolean
  problem: string | null
  tookMs: number
}

export interface UpdateSettingsView {
  channel: Channel
  checkAutomatically: boolean
  downloadAutomatically: boolean
  installAutomatically: boolean
}

export interface UpdateHistoryView {
  version: string
  at: number
  outcome: 'installed' | 'rolled-back' | 'failed'
  note?: string
}

export type DeviceKind = 'usb' | 'hid' | 'serial' | 'bluetooth'

export interface DeviceChoice {
  id: string
  name: string
  /** Who made it, its serial number, where it is plugged in — whatever the device says about itself. */
  detail: string
}

/** A site asking to use a device, waiting for you to pick one or say no. */
export interface DeviceRequest {
  id: string
  origin: string
  kind: DeviceKind
  /** What the site is asking for, in plain words. */
  label: string
  devices: DeviceChoice[]
}

export interface NoticeEntry {
  name: string
  version: string
  license: string
  homepage: string
  /** The licence in full, as it was published. Empty when the package shipped no licence file of its own. */
  text: string
}

export interface Notices {
  generatedAt: string
  orbis: string
  /** Things Orbis uses that are not npm packages: Electron and Chromium, Widevine, the filter lists. */
  others: NoticeEntry[]
  packages: NoticeEntry[]
}

export interface AdBlockState {
  settings: AdBlockSettings
  /** The categories in effect now (all off when ad blocking is off). */
  active: AdBlockCategories
  ready: boolean
  updating: boolean
  /** Filter lists version (ISO time it was assembled). */
  version: string
  updatedAt: number
  checkedAt?: number
  canRollback: boolean
  lists: AdBlockListInfo[]
  /** The last problem with the filter lists (a failed update, a recovered list), if any. */
  notice?: string
}

export type AdBlockEvent =
  | { type: 'stats'; webContentsId: number; counts: Record<AdBlockCategory, number> }
  | { type: 'navigation-blocked'; webContentsId: number; url: string; reason: string }
  | { type: 'state'; state: AdBlockState }

export interface BrowserHistoryEntry {
  url: string
  title: string
  visitedAt: number
}

export interface BrowserBookmark {
  url: string
  title: string
  addedAt: number
}

export interface BrowserDownload {
  id: string
  url: string
  filename: string
  /** Where the file is saved. */
  path: string
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  /** 0 when the server doesn't say. */
  totalBytes: number
  startedAt: number
  finishedAt?: number
}

export type SitePermissionDecision = 'allow' | 'block'

/** A search run from the address bar. */
export interface BrowserSearchEntry {
  query: string
  searchedAt: number
  count: number
}

/** How often the user chose an address-bar suggestion, keyed "u:page" or "q:query". */
export interface BrowserPick {
  count: number
  lastAt: number
}

/** A page set aside to read later. Kept apart from bookmarks: a bookmark is forever, this is a queue. */
export interface ReadingListItem {
  url: string
  title: string
  addedAt: number
  /** When it was marked read. Absent while it is still waiting. */
  readAt?: number
}

/** A page saved to this computer, readable without a connection. */
export interface SavedPage {
  url: string
  title: string
  /** Where it was actually written. */
  path: string
  savedAt: number
}

/** A picture taken of a page. */
export interface PageShot {
  id: string
  url: string
  title: string
  path: string
  at: number
  width: number
  height: number
}

export interface BrowserLibrarySnapshot {
  history: BrowserHistoryEntry[]
  bookmarks: BrowserBookmark[]
  downloads: BrowserDownload[]
  /** Remembered decisions, keyed "origin permission". */
  permissions: Record<string, SitePermissionDecision>
  /** Recent address-bar searches, newest first. */
  searches: BrowserSearchEntry[]
  picks: Record<string, BrowserPick>
  /** The new-tab page's site shortcuts, in the user's order. */
  shortcuts: SiteShortcut[]
  /** Pages set aside to read, newest first. */
  readingList: ReadingListItem[]
  /** Pages saved to this computer, newest first. */
  savedPages: SavedPage[]
  /** Pictures taken of pages, newest first. */
  screenshots: PageShot[]
}

/** A Chrome Web Store extension installed in the Orbis browser. */
export interface InstalledExtension {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  /** Shown as its own button on the browser toolbar. */
  pinned: boolean
  /** A data URL: the extension's current toolbar icon, or its own icon. */
  icon?: string
  /** It has a toolbar button (manifest "action"). */
  hasAction: boolean
  /** The toolbar button's live state for the active tab (only while enabled). */
  action?: {
    title?: string
    badgeText?: string
    badgeBackgroundColor?: [number, number, number, number]
    badgeTextColor?: [number, number, number, number]
    hasPopup: boolean
    enabled: boolean
  }
  optionsUrl?: string
  /** Its page on the Chrome Web Store. */
  homepageUrl: string
  /** What its permissions let it do, in Chrome's wording. */
  warnings: string[]
}

/** The Chrome Web Store asked to install an extension: the user confirms after seeing what it can do. */
export interface ExtensionInstallRequest {
  requestId: string
  id: string
  name: string
  icon?: string
  warnings: string[]
}

/** An installed extension asked for optional permissions (chrome.permissions.request). */
export interface ExtensionPermissionRequest {
  requestId: string
  id: string
  name: string
  warnings: string[]
  permissions: string[]
  origins: string[]
}

/** A browser tab as extensions see it: its id is the page's WebContents id. */
export interface ReportedBrowserTab {
  id: number
  index: number
  url: string
  title: string
  favIconUrl?: string
  active: boolean
  pinned: boolean
  audible: boolean
  muted: boolean
  loading: boolean
}

/** Something an extension asked the Orbis browser to do with its tabs or toolbar. */
export type ExtensionWindowRequest =
  | { kind: 'create-tab'; url?: string; active: boolean; index?: number; pinned?: boolean }
  | { kind: 'update-tab'; tabId: number; url?: string; active?: boolean; pinned?: boolean; muted?: boolean }
  | { kind: 'remove-tabs'; tabIds: number[] }
  | { kind: 'move-tab'; tabId: number; index: number }
  | { kind: 'open-popup'; extensionId: string }

/** A site shortcut on the browser's new-tab page. */
export interface SiteShortcut {
  id: string
  name: string
  url: string
  /** The site's own icon as a data URL; null when the site has none; absent while it is still being fetched. */
  icon?: string | null
  addedAt: number
}

/** A site asking for a permission (camera, location...), waiting for the user's answer. */
export interface BrowserPermissionRequest {
  id: string
  webContentsId: number
  origin: string
  permission: string
  /** What it wants, in plain words: "use your camera and microphone". */
  label: string
}

/** A browser keyboard shortcut, matched in the main process and delivered once. */
export interface BrowserShortcutEvent {
  action: string
  index?: number
  /** The page it was pressed in, when it came from a page. */
  webContentsId?: number
}

export type BrowserDownloadEvent = { type: 'started' | 'done'; download: BrowserDownload }

export interface NxtorbisApi {
  getSettings(): Promise<Settings>
  updateSettings(update: SettingsUpdate): Promise<Settings>
  testApiKey(apiKey?: string): Promise<{ ok: boolean; message: string }>
  listConversations(): Promise<Conversation[]>
  saveConversation(conversation: Conversation): Promise<void>
  deleteConversation(id: string): Promise<void>
  sendChat(request: ChatRequest): Promise<void>
  abortChat(requestId: string): Promise<void>
  onChatEvent(requestId: string, listener: (event: StreamEvent) => void): () => void
  openExternal(url: string): Promise<void>
  /** System-wide CPU load, 0-100. */
  getCpuUsage(): Promise<number>
  pickTextFiles(): Promise<PickedFiles>
  pickImages(): Promise<PickedFiles>
  /**
   * The secrets vault of the profile in use.
   *
   * Every one of these answers either the thing asked for or { error } saying why not. The vault key never leaves the
   * main process, and a value comes back only when one secret is asked for by id.
   */
  /**
   * A goal worked through one step at a time, against the real browser.
   *
   * `startSteps` returns straight away with the run as it begins; everything after that arrives on `onStepsChanged`,
   * already free of parameters, variable values and anything a model was thinking.
   */
  /** The weather for a city, from MET Norway, cached in the main process. A reason instead of a forecast when there is none. */
  widgetWeather(city: string): Promise<{ ok: true; data: Weather; fetchedAt: number; stale: boolean } | { ok: false; reason: string }>
  /** One RSS or Atom feed, as plain headlines, cached in the main process. */
  widgetFeed(url: string): Promise<{ ok: true; data: Feed; fetchedAt: number; stale: boolean } | { ok: false; reason: string }>
  startSteps(goal: string): Promise<StepRunView | null>
  readSteps(runId: string): Promise<StepRunView | null>
  pauseSteps(runId: string): Promise<StepRunView | null>
  resumeSteps(runId: string): Promise<StepRunView | null>
  stopSteps(runId: string): Promise<StepRunView | null>
  skipStep(runId: string): Promise<StepRunView | null>
  /** Says the person has dealt with a challenge. Orbis looks at the page before believing it. */
  stepsVerified(runId: string): Promise<StepRunView | null>
  onStepsChanged(listener: (view: StepRunView) => void): () => void
  /** Learned skills for the profile in use: kept on this computer, saved and reused only when the person says so. */
  skillSettings(): Promise<SkillSettings>
  setSkillSettings(next: Partial<SkillSettings>): Promise<SkillSettings>
  listSkills(): Promise<SkillView[]>
  /** What saving a finished step-by-step run would make. Saves nothing. */
  previewSkill(runId: string): Promise<SkillPreview>
  saveSkill(runId: string, edits?: SkillEdits): Promise<SkillView>
  /** Saved skills that might do what was asked, judged against the page actually open. */
  matchSkills(request: string): Promise<{ matches: SkillMatch[]; reuse: SkillSettings['reuse'] }>
  runSkill(workflowId: string, inputs?: Record<string, string>, request?: string): Promise<ActiveWorkflowRun>
  editSkill(workflowId: string, edits: SkillEdits): Promise<SkillView>
  setSkillEnabled(workflowId: string, enabled: boolean): Promise<SkillView>
  removeSkill(workflowId: string, alsoWorkflow?: boolean): Promise<void>
  removeAllSkills(): Promise<void>
  rollBackSkill(workflowId: string): Promise<SkillView>
  exportSkill(workflowId: string): Promise<string>
  importSkill(json: string): Promise<{ skill: SkillView; warnings: string[] }>
  onSkillsChanged(listener: () => void): () => void
  /** Memory for the profile in use: only what the person asked Orbis to remember, kept on this computer. */
  listMemories(options?: { query?: string; includeArchived?: boolean; category?: MemoryCategory }): Promise<MemoryEntry[]>
  addMemory(text: string, options?: { category?: MemoryCategory; pinned?: boolean }): Promise<MemoryEntry>
  updateMemory(id: string, patch: { text?: string; category?: MemoryCategory; pinned?: boolean; archived?: boolean }): Promise<MemoryEntry>
  removeMemory(id: string): Promise<boolean>
  clearMemories(): Promise<number>
  memorySettings(): Promise<MemorySettings>
  setMemorySettings(next: Partial<MemorySettings>): Promise<MemorySettings>
  onMemoryChanged(listener: () => void): () => void
  /** Orion Search sessions saved for the profile in use. */
  saveSearchSession(session: OrionSearchSession): Promise<SavedSearchSummary | null>
  listSearchSessions(query?: string): Promise<SavedSearchSummary[]>
  getSearchSession(id: string): Promise<OrionSearchSession | null>
  /** The saved session that best matches what earlier research was about. */
  findSearchSession(about: string): Promise<OrionSearchSession | null>
  removeSearchSession(id: string): Promise<boolean>
  clearSearchSessions(): Promise<number>
  onSearchSessionsChanged(listener: () => void): () => void
  /** Galaxy: the profile's own things and their real connections. */
  galaxyView(view?: GalaxyView): Promise<GalaxyGraph>
  galaxyDescribe(id: string): Promise<GalaxyDescription | null>
  galaxyLink(from: string, to: string, note?: string): Promise<UserLink>
  galaxyUnlink(id: string): Promise<boolean>
  /** The selection, written as a message for Orion. Nothing else from the profile is included. */
  galaxyAsk(ids: string[], question: string): Promise<string>
  onGalaxyChanged(listener: () => void): () => void
  /** The profile changed, so the conversations shown belong to someone else now. */
  onConversationsReload(listener: () => void): () => void
  /** Kinds of browser action switched off for Orion, skills and workflows. */
  controlSwitches(): Promise<ControlDomain[]>
  setControlSwitch(domain: ControlDomain, on: boolean): Promise<ControlDomain[]>
  vaultStatus(): Promise<VaultStatus | VaultError>
  vaultQuestion(): Promise<string | null | VaultError>
  vaultCreate(password: string, recovery?: { question: string; answer: string }): Promise<VaultStatus | VaultError>
  vaultUnlock(password: string): Promise<VaultStatus | VaultError>
  vaultLock(): Promise<VaultStatus | VaultError>
  vaultList(): Promise<SecretSummary[] | VaultError>
  vaultReveal(id: string): Promise<SecretDetail | VaultError>
  vaultAdd(secret: SecretInput): Promise<SecretSummary | VaultError>
  vaultUpdate(id: string, secret: SecretInput): Promise<SecretSummary | VaultError>
  vaultRemove(id: string): Promise<void | VaultError>
  vaultChangePassword(current: string, next: string): Promise<VaultStatus | VaultError>
  vaultSetRecovery(password: string, recovery: { question: string; answer: string } | null): Promise<VaultStatus | VaultError>
  vaultRecover(answer: string, password: string): Promise<VaultStatus | VaultError>
  vaultAutoLock(password: string, ms: number): Promise<VaultStatus | VaultError>
  vaultDestroy(password: string): Promise<VaultStatus | VaultError>
  /** Told when the vault locks itself, so the window can clear whatever it was showing. */
  onVaultLocked(listener: () => void): () => void
  /** Whether Orbis is the browser this computer opens links with, as the system reports it. */
  defaultBrowserState(): Promise<DefaultBrowserState>
  /** Registers Orbis as able to open links and opens the system's chooser; resolves what the system says afterwards. */
  requestDefaultBrowser(): Promise<DefaultBrowserState>
  openDefaultAppsSettings(): Promise<boolean>
  /**
   * The words in a recording, transcribed entirely on this machine by the local Whisper model already installed.
   * Rejects with { code, message } saying why when it cannot: a microphone problem, a model that is not installed,
   * or the runtime failing to run. It never answers with words nobody said, and nothing here reaches the network.
   */
  transcribeAudio(
    /** 16 kHz mono 16-bit PCM WAV — what the window's own decoder already turned the recording into. */
    audioBuffer: Uint8Array,
    options?: { model?: VoiceModel; language?: string | null }
  ): Promise<{ ok: true; text: string } | { ok: false; code: VoiceErrorCode; message: string }>
  /** Stops whichever transcription is running, if one is. */
  cancelTranscription(): Promise<void>
  /** What this machine can run Whisper on, and the model size recommended for it. */
  voiceHardware(): Promise<WhisperHardwareInfo | null>
  /** Every Whisper model Orbis knows about, and which of them are installed or downloading right now. */
  whisperModelsStatus(): Promise<{ installed: WhisperModelId[]; downloading: WhisperModelId[] }>
  /** Downloads one model, reporting progress through onWhisperModelProgress until it resolves. */
  downloadWhisperModel(id: WhisperModelId): Promise<{ ok: boolean; message?: string }>
  cancelWhisperModelDownload(id: WhisperModelId): Promise<void>
  /** Removes a model's file from disk. Safe to call on one that was never installed. */
  deleteWhisperModel(id: WhisperModelId): Promise<void>
  /** Whether a model's file on disk still matches the checksum it was recorded with when it finished downloading. */
  verifyWhisperModel(id: WhisperModelId): Promise<boolean>
  onWhisperModelProgress(listener: (progress: WhisperDownloadProgress) => void): () => void
  /** Opens a save dialog for a data: image; resolves false when cancelled. */
  saveImage(dataUrl: string, name: string): Promise<boolean>
  /** Re-renders an image with the edit merged into its prompt, keeping the seed. */
  editImage(request: ImageEditRequest): Promise<ImageEditResult>
  /** Fires when a page in the in-app browser tries to open a new window. */
  onBrowserNewTab(listener: (url: string, options: { background: boolean }) => void): () => void
  popOutBrowser(url: string): Promise<boolean>
  /** Whether protected media (Spotify, Netflix and the like) can play in this build, and what the decryption module says. */
  protectedMedia(): Promise<{ ready: boolean; status: unknown }>
  /** Searches the web for an Orbis Search page. Sends the words and nothing about who asked. */
  /**
   * Searching. "all" is web search; every other category goes to the specialized provider, and comes back as a
   * SpecializedOutcome instead. The page knows which it asked for.
   */
  runSearch(query: string, vertical: SearchVertical): Promise<SearchOutcomeView | SpecializedOutcome>
  /** Whether specialized search is answering, so a category can say it is unavailable rather than hang. */
  specializedSearchHealthy(): Promise<boolean>
  /** Updating Orbis: what is happening, what the user has chosen, and what has been installed before. */
  updateStatus(): Promise<{ status: UpdateStatus; settings: UpdateSettingsView; history: UpdateHistoryView[] } | null>
  checkForUpdates(): Promise<UpdateStatus | null>
  downloadUpdate(): Promise<UpdateStatus | null>
  cancelUpdateDownload(): Promise<UpdateStatus | null>
  /** Saves what is open, closes Orbis and hands over to the installer. */
  restartAndUpdate(): Promise<UpdateStatus | null>
  setUpdateSettings(patch: Partial<UpdateSettingsView>): Promise<UpdateSettingsView | null>
  onUpdateChanged(listener: (status: UpdateStatus) => void): () => void
  /** The licences of everything Orbis is built from, generated at build time from what is installed. */
  notices(): Promise<Notices | null>
  /** The Electron or Chromium licence, which ship as files beside Orbis rather than inside it. */
  licenceFile(which: 'electron' | 'chromium'): Promise<string | null>
  clearBrowserData(): Promise<void>
  /** Wipes private tabs' cookies, storage and cache (their in-memory session), once the last private tab closes. */
  clearPrivateBrowsing(): Promise<void>
  /** A mouse button went down inside a browser page (which the window's document never sees), so open menus can close. */
  onPagePointer(listener: () => void): () => void
  /** Asks to hear (or stop hearing) when the pointer moves inside a browser page; reports are throttled. */
  watchPagePointerMoves(on: boolean): void
  onPagePointerMove(listener: () => void): () => void
  /** New-tab shortcuts: saved in the browser library; the site's icon is fetched in the background. */
  addShortcut(name: string, url: string): Promise<SiteShortcut | null>
  updateShortcut(id: string, name: string, url: string): Promise<SiteShortcut | null>
  removeShortcut(id: string): Promise<void>
  /** Fetches a shortcut's icon again (for one saved while its site couldn't be reached). */
  refreshShortcutIcon(id: string): Promise<void>
  /** Chrome Web Store extensions in the browser. */
  getExtensions(): Promise<InstalledExtension[]>
  onExtensionsChanged(listener: (extensions: InstalledExtension[]) => void): () => void
  setExtensionEnabled(id: string, enabled: boolean): Promise<void>
  setExtensionPinned(id: string, pinned: boolean): Promise<void>
  removeExtension(id: string): Promise<void>
  /** Checks the Web Store for updates to enabled extensions; resolves how many were updated. */
  updateExtensions(): Promise<{ updated: number }>
  /** The user clicked an extension's toolbar button; resolves the popup page to show, if it has one. */
  clickExtensionAction(id: string): Promise<{ popup: string | null }>
  onExtensionInstallRequest(listener: (request: ExtensionInstallRequest) => void): () => void
  onExtensionPermissionRequest(listener: (request: ExtensionPermissionRequest) => void): () => void
  /** An approved extension finished installing (or failed to). */
  onExtensionInstalled(listener: (result: { id: string; name: string; error?: string }) => void): () => void
  answerExtensionPrompt(requestId: string, allow: boolean): void
  /** The browser's tabs, for extensions (private tabs excluded). */
  reportBrowserTabs(tabs: ReportedBrowserTab[]): void
  onExtensionWindowRequest(listener: (message: { requestId: string; request: ExtensionWindowRequest }) => void): () => void
  answerExtensionWindowRequest(requestId: string, result: number | null): void
  /** Predicts the user's next message and follow-ups for the latest assistant reply. */
  suggestFollowups(messages: { role: Role; content: string }[]): Promise<FollowupSuggestions>
  /** A short AI-written chat title for a first message, or null if one couldn't be made. */
  generateTitle(prompt: string): Promise<string | null>
  /** Completes a half-typed message using the chat for context; the result always starts with the draft, or is null. */
  completeDraft(draft: string, messages: { role: Role; content: string }[]): Promise<string | null>
  /** Hands over the browser tab Orbis should control for a chat request (null when there is none). */
  provideBrowserTarget(requestId: string, webContentsId: number | null): Promise<void>
  /** Approves or cancels a browser action Orbis asked about. */
  answerBrowserConfirmation(requestId: string, confirmationId: string, approved: boolean): Promise<void>
  /** Pauses (resumable) or stops a running browser automation. */
  controlAutomation(requestId: string, action: 'pause' | 'stop'): Promise<void>
  /** Adds an instruction to a running browser automation. */
  steerAutomation(requestId: string, text: string): Promise<void>
  /** What a message sent during an automation means for it. */
  classifyAutomationMessage(text: string, objective: string): Promise<'stop' | 'pause' | 'resume' | 'steer' | 'other'>
  /** Ad blocking: its settings, filter lists and state (null until it has started). */
  getAdBlockState(): Promise<AdBlockState | null>
  updateAdBlockSettings(update: Partial<AdBlockSettings>): Promise<AdBlockState | null>
  /** Allow (exception) or stop allowing ads on a site. */
  setAdBlockSite(host: string, allowed: boolean): Promise<AdBlockState | null>
  /** Always allow one resource (its host and path). */
  allowAdBlockResource(url: string): Promise<AdBlockState | null>
  removeAdBlockException(kind: 'site' | 'resource', value: string): Promise<AdBlockState | null>
  /** What was blocked on a browser tab's current page. */
  getAdBlockReport(webContentsId: number): Promise<AdBlockPageReport | null>
  updateAdBlockFilters(): Promise<AdBlockState | null>
  rollbackAdBlockFilters(): Promise<AdBlockState | null>
  onAdBlockEvent(listener: (event: AdBlockEvent) => void): () => void
  /** Browser shortcuts, delivered once per deliberate key press. */
  onBrowserShortcut(listener: (event: BrowserShortcutEvent) => void): () => void
  /** Tells the main process whether the browser (or its URL bar) has focus, so its shortcuts apply there. */
  setBrowserFocus(focused: boolean): void
  getBrowserLibrary(): Promise<BrowserLibrarySnapshot>
  /** Forgets remembered permission answers for one site, or for every site. */
  forgetSitePermissions(origin?: string): Promise<void>
  /** Sets a page aside to read later; false when the address is not a web page. */
  addToReadingList(url: string, title?: string): Promise<boolean>
  setReadingListRead(url: string, read: boolean): Promise<void>
  removeFromReadingList(url: string): Promise<void>
  /** Clears everything already read; resolves how many went. */
  clearReadReadingList(): Promise<number>
  /** Forgets a saved page. The file itself is the user's and stays where it is. */
  forgetSavedPage(path: string): Promise<void>
  /** Keeps a picture of a page beside this profile's browsing data. */
  keepScreenshot(dataUrl: string, url: string, title: string, size?: { width: number; height: number }): Promise<PageShot | null>
  /** One kept picture, as a data URL, or null when the file has gone. */
  readScreenshot(id: string): Promise<string | null>
  /** Removes a kept picture, and its file. */
  removeScreenshot(id: string): Promise<boolean>
  /** How this profile has arranged the browser sidebar. */
  getBrowserSidebar(): Promise<SidebarLayout>
  saveBrowserSidebar(layout: SidebarLayout): Promise<SidebarLayout>
  resetBrowserSidebar(): Promise<SidebarLayout>
  /** Told when the arrangement changes elsewhere — switching profile, say. */
  onBrowserSidebar(listener: (layout: SidebarLayout) => void): () => void
  onBrowserLibrary(listener: (library: BrowserLibrarySnapshot) => void): () => void
  /** Bookmarks the page, or removes its bookmark; resolves to whether it is bookmarked now. */
  toggleBookmark(url: string, title: string): Promise<boolean>
  addBookmarks(pages: { url: string; title: string }[]): Promise<number>
  removeBookmark(url: string): Promise<void>
  removeHistory(url: string): Promise<void>
  clearHistory(): Promise<void>
  /** Remembers a search run from the address bar (never called for incognito chats). */
  recordSearch(query: string): Promise<void>
  removeSearch(query: string): Promise<void>
  clearSearches(): Promise<void>
  /** The user chose an address-bar suggestion with this key ("u:page" or "q:query"). */
  recordSuggestionPick(key: string): Promise<void>
  /** The search engine's suggestions for typed text; empty when web suggestions are off or unavailable. */
  webSuggestions(query: string): Promise<string[]>
  /** Orion's predictions of the query being typed; empty when suggestions are off or unavailable. */
  predictQueries(input: string): Promise<string[]>
  downloadAction(id: string, action: 'open' | 'show' | 'cancel' | 'pause' | 'resume'): Promise<void>
  clearDownloads(): Promise<void>
  onBrowserDownload(listener: (event: BrowserDownloadEvent) => void): () => void
  onBrowserPermission(listener: (request: BrowserPermissionRequest) => void): () => void
  answerBrowserPermission(id: string, allow: boolean, remember: boolean): Promise<void>
  /** Saves a browser tab's page (asks where); resolves false when cancelled or it failed. */
  savePage(webContentsId: number): Promise<boolean>
  /** Turns the Orbis window's fullscreen on, off, or (without a value) toggles it; resolves to the new state. */
  setWindowFullscreen(on?: boolean): Promise<boolean>
  /** Whether the Orbis window is really fullscreen, and changes to it however they happen (F11, Esc, the OS). */
  isWindowFullscreen(): Promise<boolean>
  onWindowFullscreen(listener: (on: boolean) => void): () => void
  /** Settings changed outside the settings screen (by the Browser Control Layer). */
  onSettingsChanged(listener: (settings: Settings) => void): () => void
  /** A site's permission request was answered (from the prompt or through the control layer). */
  onBrowserPermissionAnswered(listener: (id: string) => void): () => void
  /**
   * Two-finger history swiping, as the main process makes sense of it: a preview to follow while the fingers move, and
   * one instruction to navigate when they lift.
   */
  onHistorySwipe(listener: (update: { view: HistorySwipeView; navigate: 'back' | 'forward' | null; webContentsId: number }) => void): () => void
  /** A site is asking to use a device: the window shows the list and the user picks one, or none. */
  onDeviceRequest(listener: (request: DeviceRequest) => void): () => void
  onDeviceAnswered(listener: (id: string) => void): () => void
  answerDeviceRequest(id: string, deviceId: string | null): Promise<boolean>

  // Orbis Browser Control Layer
  /** What Orbis can do right now. */
  getControlCapabilities(filter?: { domain?: string; query?: string; availableOnly?: boolean }): Promise<CapabilityDescriptor[]>
  /** The real browser state, read now (all parts, or the named ones). */
  getControlState(parts?: string[]): Promise<Record<string, unknown>>
  /** Carries out a command: validated, approved when consequential, verified. */
  executeControl(command: BrowserCommand): Promise<CommandResult>
  runControlPlan(plan: Plan, source?: 'user' | 'automation'): Promise<RunState>
  controlRun(id: string, action: RunControl): Promise<boolean>
  listControlRuns(): Promise<RunState[]>
  getControlLog(limit?: number): Promise<ControlLogEntryView[]>
  onControlRunUpdate(listener: (state: RunState) => void): () => void
  /** The window's browser state, sent whenever it changes. */
  reportControlState(state: WindowBrowserState): void
  /** The capabilities one part of the window provides (an empty list removes them). */
  setControlScope(scope: string, descriptors: CapabilityDescriptor[]): void
  onControlWindowRun(listener: (request: WindowRunRequest) => void): () => void
  answerControlWindowRun(callId: string, result: WindowRunResult): void
  onControlConfirm(listener: (request: ControlConfirmRequest) => void): () => void
  answerControlConfirm(id: string, approved: boolean): void

  // Workflows
  getWorkflowLibrary(): Promise<WorkflowLibrary>
  getWorkflow(id: string): Promise<Workflow | null>
  createWorkflow(name: string, templateId?: string): Promise<Workflow>
  saveWorkflow(workflow: Workflow, note?: string): Promise<Workflow>
  /** Asks Orion for a new name now; null when Orion could not answer, in which case the name is unchanged. */
  regenerateWorkflowTitle(id: string): Promise<Workflow | null>
  /** A name the user chose. Orbis stops naming this workflow until they ask it to again. */
  renameWorkflow(id: string, name: string): Promise<Workflow>
  duplicateWorkflow(id: string): Promise<Workflow>
  removeWorkflow(id: string): Promise<void>
  /** Asks where to save; resolves the file path, or null when cancelled. */
  exportWorkflowFile(id: string): Promise<string | null>
  importWorkflowFile(): Promise<{ workflow: Workflow; issues: WorkflowIssue[] } | null>
  importWorkflowJson(json: string): Promise<{ workflow: Workflow; issues: WorkflowIssue[] }>
  workflowVersions(id: string): Promise<WorkflowVersion[]>
  restoreWorkflowVersion(id: string, version: number): Promise<Workflow>
  validateWorkflow(workflow: Workflow, inputs?: Record<string, unknown>): Promise<WorkflowIssue[]>
  planWorkflow(id: string): Promise<{ lines: PlanLine[]; issues: WorkflowIssue[] }>
  runWorkflow(id: string, options?: { inputs?: Record<string, unknown>; debug?: boolean }): Promise<WorkflowRunResult>
  controlWorkflowRun(runId: string, action: WorkflowRunControl): Promise<boolean>
  workflowHistory(id?: string): Promise<WorkflowRunSummary[]>
  resumeWorkflowRun(runId: string, inputs?: Record<string, unknown>): Promise<WorkflowRunResult>
  discardWorkflowCheckpoint(runId: string): Promise<void>
  /** Orion drafts a workflow from words, or changes an existing one; nothing is saved until the user saves it. */
  draftWorkflow(instruction: string, workflowId?: string): Promise<Workflow>
  startWorkflowRecording(): Promise<RecordingState>
  pauseWorkflowRecording(paused: boolean): Promise<RecordingState>
  stopWorkflowRecording(): Promise<RecordingState>
  saveWorkflowRecording(name: string): Promise<Workflow>
  rememberWorkflowSecret(workflowId: string, name: string, value: string): Promise<void>
  forgetWorkflowSecret(workflowId: string, name?: string): Promise<void>
  rememberedWorkflowSecrets(workflowId: string): Promise<string[]>
  onWorkflowsChanged(listener: () => void): () => void
  onWorkflowRunUpdate(listener: (run: ActiveWorkflowRun) => void): () => void
  onWorkflowStep(listener: (event: { runId: string; workflowId: string; record: StepRecord }) => void): () => void
  onWorkflowRunFinished(listener: (summary: WorkflowRunSummary) => void): () => void
  onWorkflowNotice(listener: (notice: { workflowId: string; message: string }) => void): () => void
  onWorkflowRecording(listener: (state: RecordingState) => void): () => void

  // Notes
  listNotes(filter?: NoteFilter): Promise<Note[]>
  noteTags(): Promise<{ tag: string; count: number }[]>
  getNote(id: string): Promise<Note | null>
  createNote(patch?: Partial<Note>): Promise<Note>
  saveNote(note: Note): Promise<Note>
  removeNote(id: string): Promise<boolean>
  archiveNote(id: string, archived: boolean): Promise<Note>
  noteFromPage(): Promise<Note>
  exportNotes(ids?: string[]): Promise<string>
  importNotes(json: string): Promise<Note[]>
  onNotesChanged(listener: () => void): () => void

  // Tasks
  tasksSnapshot(): Promise<{ lists: TaskList[]; tasks: Task[]; counts: TaskCounts }>
  listTasks(filter?: TaskFilter): Promise<Task[]>
  createTask(patch?: Partial<Task>): Promise<Task>
  saveTask(task: Task): Promise<Task>
  updateTask(id: string, patch: Partial<Task>): Promise<Task>
  completeTask(id: string, done: boolean): Promise<{ task: Task; repeated: boolean }>
  removeTask(id: string): Promise<boolean>
  clearCompletedTasks(listId?: string): Promise<number>
  reorderTasks(listId: string, ids: string[]): Promise<Task[]>
  saveTaskList(list: TaskList): Promise<TaskList>
  createTaskList(patch?: Partial<TaskList>): Promise<TaskList>
  removeTaskList(id: string): Promise<boolean>
  taskFromPage(listId?: string): Promise<Task>
  onTasksChanged(listener: () => void): () => void

  // Clipboard history
  clipboardHistory(query?: string, kind?: ClipKind | 'all' | 'pinned'): Promise<ClipItem[]>
  clipboardSettings(): Promise<ClipboardSettings>
  updateClipboardSettings(patch: Partial<ClipboardSettings>): Promise<ClipboardSettings>
  useClip(id: string): Promise<ClipItem>
  pinClip(id: string, pinned: boolean): Promise<ClipItem | null>
  removeClip(id: string): Promise<boolean>
  clearClipboardHistory(includePinned?: boolean): Promise<number>
  clipboardPaused(paused?: boolean): Promise<{ paused: boolean; lastSkipped: string | null }>
  onClipboardChanged(listener: () => void): () => void

  // Whiteboards
  listBoards(): Promise<(Omit<Board, 'elements'> & { count: number })[]>
  getBoard(id: string): Promise<Board | null>
  createBoard(patch?: Partial<Board>): Promise<Board>
  saveBoard(board: Board): Promise<Board>
  removeBoard(id: string): Promise<boolean>
  renameBoard(id: string, name: string): Promise<Board>
  addToBoard(id: string, elements: unknown[]): Promise<Board>
  exportBoardSvg(id: string): Promise<{ name: string; svg: string }>
  addPageToBoard(id: string, at?: { x: number; y: number }): Promise<Board>
  onBoardsChanged(listener: () => void): () => void

  // Workspaces
  listWorkspaces(): Promise<{ workspaces: (Workspace & { summary: WorkspaceSummary })[]; currentId: string | null }>
  saveCurrentWorkspace(name: string, patch?: Partial<Workspace>): Promise<Workspace>
  updateWorkspaceFromWindow(id: string): Promise<Workspace>
  saveWorkspace(workspace: Workspace): Promise<Workspace>
  renameWorkspace(id: string, name: string): Promise<Workspace>
  removeWorkspace(id: string): Promise<boolean>
  duplicateWorkspace(id: string): Promise<Workspace>
  reorderWorkspaces(ids: string[]): Promise<Workspace[]>
  planWorkspaceOpen(id: string, replace?: boolean): Promise<{ open: number; close: number; keep: number }>
  openWorkspace(id: string, replace?: boolean): Promise<{ opened: number; groups: number; name: string }>
  onWorkspacesChanged(listener: () => void): () => void

  // Profiles
  listProfiles(): Promise<{ profiles: Profile[]; activeId: string; partition: string }>
  createProfile(name: string): Promise<Profile>
  saveProfile(profile: Profile): Promise<Profile>
  renameProfile(id: string, name: string): Promise<Profile>
  removeProfile(id: string): Promise<{ removed: boolean; reason?: string }>
  switchProfile(id: string): Promise<{ profile: Profile; partition: string }>
  onProfileChanged(listener: (change: { profile: Profile; partition: string }) => void): () => void
  onProfilesChanged(listener: () => void): () => void

  // The Experience Runtime (personalisation)
  getExperience(): Promise<ExperienceConfig>
  saveExperience(config: ExperienceConfig, reason?: string): Promise<{ config: ExperienceConfig; changes: ConfigChange[] }>
  experienceHealth(): Promise<ExperienceHealth>
  experienceSnapshots(): Promise<{ id: string; reason: string; takenAt: number; summary: string[] }[]>
  restoreExperienceSnapshot(id: string): Promise<ExperienceConfig>
  removeExperienceSnapshot(id: string): Promise<boolean>
  resetExperienceSection(section: string): Promise<ExperienceConfig>
  restoreOriginalExperience(): Promise<{ config: ExperienceConfig; wasDefault: boolean }>
  exportExperience(): Promise<ExperienceExport>
  checkExperienceImport(raw: unknown): Promise<ImportCheck & { changes?: ConfigChange[] }>
  importExperience(raw: unknown, how?: 'replace' | 'merge'): Promise<{ config: ExperienceConfig; changes: ConfigChange[] }>
  onExperienceChanged(listener: (config: ExperienceConfig) => void): () => void
}
