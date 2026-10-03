import type { SourcePreferences } from './researchSources'
import type { EffectPolicy, EffectRule } from './effectPolicy'
import type { SideEffect } from './browserControl'
import type { ConversationBranch } from './conversationBranch'
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
  WindowRunRequest,
  WindowRunResult, ControlDomain } from './browserControl'
import type { ControlLogEntryView } from './browserControlView'
import type { SidebarLayout } from './browserSidebar'
import type { StepRunView } from './stepPlan'
import type { Feed, Weather } from './widgetData'
import type { SpecializedOutcome } from './searchProviders'
import type { VoiceErrorCode, VoiceModel } from './voiceInput'
import type { DeviceState } from './temporal/capability'
import type { JobCondition, JobPolicies, TemporalAction, TemporalJob } from './temporal/job'
import type { OrbisNotification } from './notifications'
import type { Schedule } from './temporal/recurrence'
import type { LockTrigger, TabLockPolicy } from './tabLock'
import type { ProfileLockPolicy } from './profileLock'
import type { SecurityEvent } from './securityEvents'
import type { RecallOverview } from '../main/knowledge/recallIpc'
import type { RecallHit, RecalledPage, RecallSettings } from './recall'
import type { MarketsState, MarketDetail, DiscoveryAnswer, WatchlistsAnswer, AlertsAnswer, ScreenAnswer, PaperAnswer, StrategiesAnswer, BacktestAnswer, NewsAnswer, CurrencyAnswer, ExperienceAnswer, OnboardingAnswer, DerivativesAnswer, TapeAnswer, BookAnswer, StripAnswer} from '../main/markets/ipc'
import type { Contract, FundingPoint, LongShortRatio, OpenInterestPoint } from './markets/derivatives'
import type { Drawing } from './markets/drawings'
import type { Layout as PanelLayout } from './markets/panels'
import type { MarketTrigger } from './markets/triggers'
import type { MuteRule, PatternAlertRule, PatternFiring } from './markets/patternAlerts'
import type { NearMiss, PatternDetection } from './markets/patternDetect'
import type { PatternContext, TimeframeAgreement, TimeframeContext } from './markets/patternContext'
import type { AnalysisRun, Comparison, ConditionedSummary, Frequency, HistoryQuery, OutcomeSummary, PatternRecord } from './markets/patternHistory'
import type { PatternSettings } from './markets/patternSettings'
import type { CandleFacts, RelativeFacts, SequenceCheck } from './markets/candleGeometry'
import type { MarginSettings, AccountMargin, PositionMargin } from './markets/margin'
import type { IndexedSeries, CompareStat, CorrelationCell } from './markets/compare'
import type { WalkSummary, MonteCarloResult } from './markets/validation'
import type { MarketsExperienceProfile, ExperienceSettings } from './markets/experience'
import type { OnboardingDraft, DraftProblem } from './markets/onboarding'
import type { Explanation } from './markets/glossary'
import type { TickerConfig } from './markets/workspace'
import type { Instrument, QuoteView } from './markets/instrument'
import type { Candle, TradePrint } from './markets/provider'
import type { MarketRow } from './markets/discovery'
import type { SavedScreen } from './markets/screener'
import type { Strategy } from './markets/strategy'
import type { SweepPoint } from './markets/backtest'
import type { BacktestRun, MarketsLayout } from './markets/workspace'
import type {
  ProfileLockDone,
  ProfileLockRefusal,
  ProfileLockState,
  ProfileLockedEvent
} from './profileLockView'
import type {
  TabLockDone,
  TabLockExplanation,
  TabLockGroup,
  TabLockRefusal,
  TabLockState
} from './tabLockView'
import type { PasswordVerdict } from './passwordStrength'
import type { PulsarModelId, PulsarDownloadProgress, PulsarHardwareInfo } from './pulsarModels'
import type { AccountRefusal, AccountStatus } from './account.ts'
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
import type { Finding, HealthReport, Repair } from './workflowHealth'
import type { Migration, Missing } from './workflowCompat'
import type { Note, NoteFilter } from './notes'
import type { Task, TaskCounts, TaskFilter, TaskList } from './tasks'
import type { ClipboardSettings, ClipItem, ClipKind } from './clipboardHistory'
import type { Board } from './whiteboard'
import type { Workspace, WorkspaceSummary } from './workspaces'
import type { Profile } from './profiles'
import type { ConfigChange, ExperienceConfig, ExperienceExport, ExperienceHealth, ImportCheck } from './experience'
import type { ArtifactRef } from './artifacts/model'
import type { PlanLine } from './workflowCompile'

export type Role = 'user' | 'assistant'

/** Status the main process sends while an image renders; the chat swaps in the mini games for it. */
export const IMAGE_GEN_STATUS = 'Generating image…'

/**
 * What the chat says while it is making or changing something it keeps as a file. Each one is sent when that step
 * really starts, never on a timer. Listed here so the window can tell them from a warning and keep them out of the
 * activity log.
 */
export const ARTIFACT_STATUS = Object.freeze({
  writing: 'Writing it…',
  changing: 'Working out the change…',
  drawing: 'Choosing what to draw…',
  reading: 'Reading the file…',
  building: 'Building it and checking the copy…'
})

export const isArtifactStatus = (message: string): boolean =>
  (Object.values(ARTIFACT_STATUS) as string[]).includes(message) || message === 'Planning the parts…' || /^Written \d+ of \d+ parts…$/.test(message)

/**
 * Something Orbis made, changed or drew for this reply, shown in the conversation as a card.
 *
 * Only a handle. The card reads the artifact itself, live, when it is shown -- so a conversation saved to disk and
 * sent back with every message never carries a file's contents, and a card always shows the artifact as it is now.
 */
export interface ChatArtifact {
  ref: ArtifactRef
  /** What happened to it in this reply. */
  action: 'made' | 'changed' | 'drew' | 'kept' | 'shown'
  /** What was done, sentence by sentence, in the engine's own words. */
  did: string[]
  /** The file format the person asked for, when they named one: the card's first download. */
  format?: string
}

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
  /** What Orbis did in the browser for this reply. */
  steps?: BrowserStep[]
  /** A browser action waiting for the user's approval. */
  confirmation?: BrowserConfirmation
  /** The continuous browser automation (loop or game) this reply ran. */
  automation?: AutomationState
  /** The web research this reply is based on: the actual pages Orion read, which its [n] citations point to. */
  research?: Research
  /** What Orbis made, changed or drew for this reply. Handles only; the card reads each one live. */
  artifacts?: ChatArtifact[]
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
  /**
   * Pages dropped because their text repeated a source already kept -- a syndicated copy, a mirror, an AMP page.
   * Recorded rather than silently discarded, so "six sources" never means "the same page six times".
   */
  repeats?: { url: string; sameAs: number }[]
  /**
   * Where the sources state different figures for the same thing, found by comparing what the pages say.
   * Reported, never resolved: Orbis has no way to know which is right.
   */
  conflicts?: { about: string; readings: { n: number; said: string }[] }[]
  /** Pages a site you blocked would have supplied. Said rather than silently dropped. */
  leftOut?: number
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

/** One thing Orbis did (or was stopped from doing) in the browser. */
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
  /** Out of the main list, still there. Kept rather than deleted, so nothing is lost to tidying up. */
  archived?: boolean
  messages: ChatMessage[]
  /**
   * Answers this conversation has had and moved away from.
   *
   * Editing a message or asking for a different answer parks what was there rather than destroying it. See
   * src/shared/conversationBranch.ts -- the rules, and why `messages` stayed a flat list.
   */
  branches?: ConversationBranch[]
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
  /**
   * Which version of the browser's first-launch introduction this installation has already seen. It is written only once the
   * browser has actually come up, so a crash partway through leaves it unwritten and the introduction is shown again rather
   * than silently skipped. Versioned, not a flag, so a later release can deliberately introduce itself again.
   */
  introVersion: number
  /** The address bar asks the search engine and Orion for predictions (sends the typed text). */
  searchSuggestions: boolean
  /** The address bar suggests from local history, searches, bookmarks and research, and learns from picks. */
  personalizedSuggestions: boolean
  /**
   * Which kinds of source research leans towards, and which sites it never reads.
   *
   * A preference decides the order among pages that were really found; it can never produce one. Blocking is
   * absolute, and what it left out is said rather than quietly returning less.
   */
  researchSources: SourcePreferences
  /** Orbis opens its browser (at the saved size) as soon as it starts, instead of the chat. */
  openBrowserOnLaunch: boolean
  /**
   * Orbis keeps running with no window when something is scheduled, instead of quitting.
   *
   * Off by default, because a program that carries on after you close it is not what anybody expects. When it is on
   * there is a tray icon with a way to quit, so it is never running invisibly.
   */
  keepSchedulesRunning: boolean
  /**
   * Windows may wake this computer for the next thing due.
   *
   * Asleep is not off, and a machine that wakes for ninety seconds at eight in the morning is the difference between
   * a schedule happening and a schedule happening whenever somebody next opens the lid. It cannot wake a computer
   * that is fully switched off, and wake timers are often off on battery -- both of which Orbis says rather than
   * implies.
   */
  wakeForSchedules: boolean
}

export type SettingsUpdate = Partial<Omit<Settings, 'hasApiKey'>> & {
  /** Empty string clears the stored key. */
  apiKey?: string
}

export interface ModelInfo {
  /** Orbis's id for the model, stored with chats and settings. */
  id: string
  /** The provider's model to call, when it differs from `id` (a variant with its own settings). */
  apiModel?: string
  /**
   * Which service answers this model. Absent means Groq, which every model predated the second provider.
   *
   * Carried on the model rather than worked out from its name, because a name is a guess: `mistral-small` is
   * Mistral's and `openai/gpt-oss-120b` is not OpenAI's, it is Groq's.
   */
  provider?: 'groq' | 'mistral'
  /**
   * Set when Orbis chooses this model for a particular job rather than a person choosing it in the picker.
   *
   * The vision and code models are here to do one thing each. Offering them as conversation choices would put "ORION
   * Sight" in a list beside a 120-billion-parameter model, where picking it would be a mistake nobody could see they
   * were making -- and letting the ordinary fallback chain reach them would send a Groq request to Mistral's address.
   */
  job?: 'vision' | 'code'
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
  /**
   * What this model is actually good at, in the kinds of work Auto has to choose between.
   *
   * Written here rather than as a list of model ids inside the router. Auto used to name three models directly, which
   * meant retiring one left the router pointing at a model that no longer existed, and a model added to this table
   * could never be chosen however good it was. A model with no strengths listed is never chosen by Auto on purpose;
   * it can still be picked by a person.
   */
  strengths?: ModelStrength[]
  /**
   * How much it can write in one reply, when the service says.
   *
   * Used to choose between models for something long, and by the continuation system to know a reply stopped because
   * it ran out of room rather than because it had finished. Absent means not measured, which is treated as unknown
   * rather than as unlimited.
   */
  maxOutputTokens?: number
}

/** The kinds of work Auto chooses between. Coarse on purpose: a longer list would be guessing. */
export type ModelStrength = 'everyday' | 'code' | 'maths' | 'reasoning' | 'writing' | 'long'

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
  /** The Orbis browser's active page, so requests like "click the first result" can refer to it. */
  browser?: { url: string; title: string }
  /** Asked from the address bar (Ctrl+Enter): answered in text, with research when needed; never runs the browser or makes images. */
  ask?: boolean
  /** The conversation this message belongs to, so what is made for it can be found again from it. */
  conversationId?: string
  /**
   * The cards of the reply this message is being answered again in place of (Regenerate, Resend, an edited question).
   * Pointers only. What they made or changed is undone before the answer is given again.
   */
  replaced?: { artifactId: string; versionId: string; version: number; action: ChatArtifact['action'] }[]
  /** An incognito chat: the conversation is not saved. What is made in it still is, and the reply says so. */
  incognito?: boolean
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
  | { type: 'step'; step: BrowserStep }
  | { type: 'confirm'; confirmation: BrowserConfirmation }
  | { type: 'confirm-done'; id: string }
  | { type: 'automation'; automation: AutomationState }
  /** The sources this reply is based on, sent before the answer streams. */
  | { type: 'research'; research: Research }
  /** Something was made, changed or drawn for this reply. Sent once it has been kept and its copy checked. */
  | { type: 'artifact'; artifact: ChatArtifact }

export interface PickedFiles {
  attachments: Attachment[]
  /** Files that were too large or not text. */
  skipped: string[]
  /** What to tell the person about a file that was read for them or could not be: whole sentences, one per file. */
  notes?: string[]
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

export interface BrowserLibrarySnapshot {
  history: BrowserHistoryEntry[]
  bookmarks: BrowserBookmark[]
  downloads: BrowserDownload[]
  /** Recent address-bar searches, newest first. */
  searches: BrowserSearchEntry[]
  picks: Record<string, BrowserPick>
  /** The new-tab page's site shortcuts, in the user's order. */
  shortcuts: SiteShortcut[]
}

/** A site shortcut on the browser's new-tab page. */
export interface SiteShortcut {
  id: string
  name: string
  url: string
  /** The site's own icon as a data URL; null when the site has none; absent while it is still being fetched. */
  icon?: string | null
  addedAt: number
}

/**
 * An application as the library lists it.
 *
 * Its problems travel with it rather than being a second question, because a caller that has to ask again to learn
 * whether the first answer is usable will sometimes not ask.
 */
export interface PageApplicationSummary {
  applicationId: string
  slug: string
  title: string
  description: string
  pageCount: number
  navigation: { kind: 'page' | 'group'; id: string; label: string; route: string | null; children: unknown[] }[]
  describes: string[]
  problems: { severity: 'error' | 'warning'; kind: string; message: string; subject: string }[]
}

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

  // ---------------------------------------------------------------- schedules
  /** Every schedule in this profile, with its state, what it is next due to do, and what it has done. */
  listSchedules(): Promise<TemporalJob[]>
  /** Keeps a new schedule, or refuses it with every reason at once so a form can show them together. */
  addSchedule(job: {
    name: string
    said?: string
    action: TemporalAction
    schedule: Schedule
    policies?: Partial<JobPolicies>
    conditions?: JobCondition[]
    startPaused?: boolean
  }): Promise<{ ok: true; job: TemporalJob } | { ok: false; problems: string[] }>
  /** Changes part of a schedule, keeping the rest. A patch, never a replacement. */
  updateSchedule(
    jobId: string,
    patch: {
      name?: string
      action?: TemporalAction
      schedule?: Schedule
      conditions?: JobCondition[]
      policies?: Partial<JobPolicies>
    }
  ): Promise<{ ok: true; job: TemporalJob } | { ok: false; problems: string[] }>
  /** Off until switched on, or until a moment. */
  pauseSchedule(jobId: string, until?: number | null): Promise<TemporalJob | null>
  resumeSchedule(jobId: string): Promise<TemporalJob | null>
  /** Stops it for good without deleting its history. */
  cancelSchedule(jobId: string): Promise<TemporalJob | null>
  removeSchedule(jobId: string): Promise<boolean>
  /** Leaves out one occurrence without touching the rule. */
  skipNextRun(jobId: string, dueAt: number): Promise<TemporalJob | null>
  /** Runs it now, leaving the schedule alone. For seeing what it does before trusting it. */
  runScheduleNow(jobId: string): Promise<{ ok: boolean; job?: TemporalJob | null; problems?: string[] }>
  /**
   * Reads a phrase without saving anything, so what Orbis understood can be shown back first.
   *
   * A refusal carries its reason, and something Orbis genuinely cannot do carries what it cannot do and the nearest
   * thing it can.
   */
  readSchedulePhrase(
    phrase: string,
    zone?: string
  ): Promise<
    | {
        ok: true
        action: TemporalAction
        schedule: Schedule
        policies: JobPolicies
        conditions: JobCondition[]
        said: string
        assumedTime: boolean
        preview: { at: number; resolution: 'exact' | 'skipped' | 'ambiguous' }[]
      }
    | { ok: false; why: string; unsupported?: { ask: string; because: string; instead: string | null } }
  >
  /** What a rule will actually do, so "every month on the 31st" can be checked rather than trusted. */
  previewSchedule(
    schedule: Schedule,
    count?: number
  ): Promise<{ occurrences: { at: number; resolution: 'exact' | 'skipped' | 'ambiguous' }[]; said: string }>
  /** What Orbis can and cannot promise about schedules, in one place so every screen says the same thing. */
  scheduleCapabilities(): Promise<{
    zone: string
    device: DeviceState
    unsupported: { ask: string; because: string; instead: string | null }[]
    needsThisComputer: boolean
  }>
  /** The honest answer to "will this run while my computer is off?". */
  canRunWithComputerOff(action: TemporalAction): Promise<string>
  onSchedulesChanged(listener: (job: TemporalJob) => void): () => void
  /** Everything due in the next few days, across every schedule, oldest first. Bounded. */
  upcomingSchedules(days?: number): Promise<
    { jobId: string; name: string; at: number; resolution: 'exact' | 'skipped' | 'ambiguous'; paused: boolean }[]
  >
  /**
   * What this computer can actually be woken from, read from the computer rather than assumed.
   *
   * Nothing here changes a setting. A finding marked `impossible` is genuinely impossible -- switching a computer
   * off is the one that is, because Windows is not running to fire any timer.
   */
  schedulePower(): Promise<{
    facts: {
      canSleep: boolean | null
      canHibernate: boolean | null
      hibernateBecause: string | null
      wakeTimersOnPower: 0 | 1 | 2 | null
      wakeTimersOnBattery: 0 | 1 | 2 | null
      taskRegistered: boolean
      windows: boolean
    }
    findings: {
      state: 'sleep' | 'hibernate' | 'shutdown'
      title: string
      standing: 'good' | 'fixable' | 'impossible' | 'unknown'
      detail: string
      todo: string | null
      orbisCanFix: boolean
    }[]
    summary: string
  }>
  /** Hibernates this computer now, the same way the Start menu does. A hibernated computer can be woken; an off one cannot. */
  hibernateNow(): Promise<{ ok: boolean; detail: string }>
  /** A schedule asked for one of Orbis's own Pages. The address is already resolved. */
  onScheduleOpenPage(listener: (url: string) => void): () => void

  // ---------------------------------------------------------------- the pages this person has read
  /** What is stored and what the settings are: the one call a screen needs to draw itself. */
  recallOverview(): Promise<RecallOverview | { error: string; message?: string }>
  /** Changes the settings. Switching it off empties the index, which the interface says before the switch is thrown. */
  recallSetSettings(next: Partial<RecallSettings>): Promise<RecallOverview | { error: string; message?: string }>
  /** Searches the text of pages that were read. Only excerpts come back, never whole pages. */
  recallSearch(
    query: string,
    options?: { limit?: number; host?: string; since?: number }
  ): Promise<{ hits: RecallHit[] } | { error: string; message?: string }>
  /** The most recently read pages, for browsing rather than searching. */
  recallRecent(limit?: number, host?: string): Promise<{ hits: RecallHit[] } | { error: string; message?: string }>
  /** One page in full. The only way the whole text of a page leaves the index. */
  recallPage(pageId: string): Promise<{ page: RecalledPage | null } | { error: string; message?: string }>
  recallForget(pageId: string): Promise<{ forgotten: boolean } | { error: string; message?: string }>
  /** Forgets a site, and optionally never records it again — which is what people mean by "forget this site". */
  recallForgetSite(
    host: string,
    alsoBlock?: boolean
  ): Promise<({ forgotten: number } & RecallOverview) | { error: string; message?: string }>
  /** Forgets everything read in a window of time, for "delete the last hour". */
  recallForgetBetween(
    from: number,
    to: number
  ): Promise<({ forgotten: number } & RecallOverview) | { error: string; message?: string }>
  recallClear(): Promise<({ forgotten: number } & RecallOverview) | { error: string; message?: string }>
  onRecallChanged(listener: () => void): () => void  /** Orion Search sessions saved for the profile in use. */
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
  /** What Orbis may do on your behalf, by kind of effect rather than by area of the browser. */
  controlEffects(): Promise<EffectPolicy>
  setControlEffect(effect: SideEffect, rule: EffectRule): Promise<EffectPolicy>
  /**
   * The password on this profile's account.
   *
   * Which profile is never passed: the main process reads it from the profile store, so a window cannot ask about
   * another profile's account.
   */
  accountStatus(): Promise<AccountStatus | AccountRefusal>
  accountCreate(password: string, name: string): Promise<AccountStatus | AccountRefusal>
  accountUnlock(password: string): Promise<AccountStatus | AccountRefusal>
  accountLock(): Promise<AccountStatus | AccountRefusal>
  /** Checks a password without unlocking, for authorising something. */
  accountVerify(password: string): Promise<{ ok: boolean } | AccountRefusal>
  accountChange(current: string, next: string, name: string): Promise<AccountStatus | AccountRefusal>
  /**
   * Tab Lock: private tabs behind their own password.
   *
   * Which profile is never passed, for the same reason the account's is not. Every call answers with the whole tab-lock
   * state, so a screen never draws half of it -- and never with a locked tab's address, whatever it asked for.
   */
  /**
   * Profile Lock: Orbis itself, behind the account password.
   *
   * A different layer from Tab Lock, and a different one from the account password that opens it. Which profile is never
   * passed, for the same reason as everywhere else in this section.
   */
  /**
   * What Orbis has recorded about its own security.
   *
   * Read and cleared, and nothing else: events are recorded by the code that does the thing, so a window cannot put an
   * event in the log that did not happen. Nothing in the log is an address, a page or a credential -- the shape has no
   * field for one.
   */
  /**
   * Markets: the bottom strip and what it shows.
   *
   * Every call answers with the whole state, so a screen never draws half of it. Which profile is never passed -- the main
   * process reads it from the profile store, as everywhere else.
   */
  marketsState(): Promise<MarketsState | { error: string; message?: string }>
  // ---------------------------------------------------------------- moving a profile between machines
  /** Everything the transfer screen needs to draw itself: the categories, what cannot travel, and why. */
  /** Where a dropped file sits on disk, or an empty string when that cannot be established. */
  pathForFile(file: File): string
  /** Asks where to save, through the system dialog. Null when the person cancelled. */
  portableChooseDestination(request: { name: string }): Promise<{ path: string | null }>
  /** Asks which package to open. Null when the person cancelled. */
  portableChoosePackage(): Promise<{ path: string | null }>
  portableState(): Promise<PortableTransferState | { error: string; message?: string }>
  /** Whether this selection has to be protected by a password, and which parts of it forced that. */
  portableNeedsPassword(request: { categoryIds: string[] }): Promise<{ required: boolean; because: string[] } | { error: string; message?: string }>
  /** How much room the export will need, worked out before doing any of it. */
  portableEstimate(request: { profileName: string; categoryIds: string[]; destination: string }): Promise<PortableEstimate | { error: string; message?: string }>
  /**
   * Writes the package.
   *
   * The password goes in and nothing derived from it comes back. It is never stored and never appears in any answer.
   */
  portableExport(request: {
    profileName: string
    categoryIds: string[]
    purpose: 'transfer' | 'backup' | 'snapshot'
    password: string | null
    destination: string
  }): Promise<PortableExportResult | { error: string; message?: string }>
  /** Reads a package's manifest without opening it, so a person can see what it holds before typing a password. */
  portableInspect(request: { path: string }): Promise<PortableInspection | { error: string; message?: string }>
  /** Brings a package in. Nothing reaches the profile until all of it is ready to. */
  portableImport(request: {
    path: string
    categoryIds: string[]
    mode: 'replace' | 'merge'
    password: string | null
  }): Promise<PortableImportResult | { error: string; message?: string; rolledBack?: boolean | null }>
  /** Stops whichever of the two is running. */
  portableCancel(): Promise<{ cancelled: boolean; message: string }>
  /** Whether an import began and never finished, read on start. */
  portableRecovery(): Promise<PortableRecovery | { error: string; message?: string }>
  portableRecoveryClear(): Promise<{ cleared: boolean }>
  /** Progress while an export or import runs. Pushed rather than polled: either can take a while. */
  onPortableProgress(handler: (progress: PortableProgress) => void): () => void

  /** The master switch. Off releases every market subscription and keeps every saved choice. */
  marketsSetEnabled(enabled: boolean): Promise<MarketsState | { error: string; message?: string }>

  // ---------------------------------------------------------------- the Markets page
  /** Opens a market: starts watching it and answers with what its provider can actually be asked for. */
  marketsOpen(instrumentId: string): Promise<MarketDetail | { error: string; message?: string }>
  /** Releases what an open market was holding. */
  marketsClose(instrumentId: string): Promise<{ closed: boolean } | { error: string; message?: string }>
  marketsDetail(instrumentId: string): Promise<MarketDetail | { error: string; message?: string }>
  /** The last price of each of these, for a list redrawing its rows without asking a provider per row. */
  marketsQuotes(
    instrumentIds: string[],
    /** Ask a provider for anything that has never been priced, rather than answering from what is held. */
    refresh?: boolean
  ): Promise<
    { quotes: { instrumentId: string; quote: QuoteView | null }[]; connection: string } | { error: string; message?: string }
  >
  /**
   * Every price as it arrives, rather than on a timer.
   *
   * One message per screen refresh, each carrying the newest price for each instrument that moved in that beat.
   * Nothing worth seeing is dropped: within one refresh the latest price *is* the price, and a screen cannot show
   * more than it paints.
   */
  onMarketsTick(listener: (events: unknown[]) => void): () => void
  marketsCandles(
    instrumentId: string,
    interval: string,
    limit?: number
  ): Promise<{ instrumentId: string; interval: string; candles: Candle[] } | { error: string; message?: string }>
  /** The book, with whether it is provably current and whether the venue streams depth at all. */
  marketsBook(instrumentId: string, depth?: number): Promise<BookAnswer | { error: string; message?: string }>
  marketsBookOpen(instrumentId: string, depth?: number): Promise<BookAnswer | { error: string; message?: string }>
  marketsBookClose(instrumentId: string): Promise<{ closed: boolean } | { error: string; message?: string }>
  /** Opens the tape: seeds it from recent trades and starts streaming prints for this instrument only. */
  marketsTapeOpen(instrumentId: string, limit?: number): Promise<{ trades: TradePrint[] } | { error: string; message?: string }>
  marketsTape(instrumentId: string): Promise<{ trades: TradePrint[] } | { error: string; message?: string }>
  marketsTapeClose(instrumentId: string): Promise<{ closed: boolean } | { error: string; message?: string }>
  /** Movers, volume leaders, the heatmap and breadth, from one snapshot of every market. */
  marketsDiscover(options?: {
    limit?: number
    tiles?: number
    filter?: { quoteCurrency?: string; minQuoteVolume?: number; text?: string }
  }): Promise<DiscoveryAnswer | { error: string; message?: string }>
  marketsMovers(
    kind: string,
    limit?: number,
    filter?: { quoteCurrency?: string; minQuoteVolume?: number; text?: string }
  ): Promise<{ kind: string; rows: MarketRow[] } | { error: string; message?: string }>
  marketsWatchlists(): Promise<WatchlistsAnswer | { error: string; message?: string }>
  marketsWatchlistCreate(name: string): Promise<WatchlistsAnswer | { error: string; message?: string }>
  marketsWatchlistRename(listId: string, name: string): Promise<WatchlistsAnswer | { error: string; message?: string }>
  marketsWatchlistRemove(listId: string): Promise<WatchlistsAnswer | { error: string; message?: string }>
  marketsWatchlistAdd(listId: string, instrumentId: string): Promise<WatchlistsAnswer | { error: string; message?: string }>
  marketsWatchlistRemoveItem(
    listId: string,
    instrumentId: string
  ): Promise<WatchlistsAnswer | { error: string; message?: string }>

  // ---------------------------------------------------------------- screener and alerts
  /** Runs a screen. Technical conditions cost a request per market, so the answer says what it examined and what it left out. */
  marketsScreen(query: unknown): Promise<ScreenAnswer | { error: string; message?: string }>
  marketsScreens(): Promise<{ screens: SavedScreen[] } | { error: string; message?: string }>
  marketsScreenSave(
    name: string,
    query: unknown,
    id?: string
  ): Promise<{ screens: SavedScreen[]; saved: SavedScreen } | { error: string; message?: string }>
  marketsScreenRemove(id: string): Promise<{ screens: SavedScreen[] } | { error: string; message?: string }>
  marketsAlerts(): Promise<AlertsAnswer | { error: string; message?: string }>
  marketsAlertSave(alert: unknown): Promise<AlertsAnswer | { error: string; message?: string }>
  marketsAlertRemove(id: string): Promise<AlertsAnswer | { error: string; message?: string }>
  marketsAlertHistoryClear(): Promise<AlertsAnswer | { error: string; message?: string }>

  // ---------------------------------------------------------------- paper trading, always simulated
  marketsPaper(): Promise<PaperAnswer | { error: string; message?: string }>
  /** Starts a simulated account. Refuses to replace one with trades in it unless `replace` says so. */
  marketsPaperStart(
    startingCash: number,
    currency?: string,
    replace?: boolean
  ): Promise<PaperAnswer | { error: string; message?: string }>
  marketsPaperClose(): Promise<PaperAnswer | { error: string; message?: string }>
  marketsPaperSettings(settings: {
    slippage?: number
    feeRate?: number
    allowShort?: boolean
  }): Promise<PaperAnswer | { error: string; message?: string }>
  /** Places a simulated order. Nothing here reaches an exchange; there is no credential that could. */
  marketsPaperOrder(order: {
    instrumentId: string
    side: 'buy' | 'sell'
    type: 'market' | 'limit' | 'stop' | 'stop-limit'
    quantity: number
    limitPrice?: number
    stopPrice?: number
  }): Promise<(PaperAnswer & { outcome: { detail: string; state: string } }) | { error: string; message?: string }>
  marketsPaperCancel(orderId: string): Promise<PaperAnswer | { error: string; message?: string }>

  // ---------------------------------------------------------------- strategies and backtesting
  marketsStrategies(): Promise<StrategiesAnswer | { error: string; message?: string }>
  marketsStrategySave(
    strategy: unknown
  ): Promise<(StrategiesAnswer & { saved: Strategy }) | { error: string; message?: string }>
  marketsStrategyRemove(id: string): Promise<StrategiesAnswer | { error: string; message?: string }>
  /** Runs a strategy over real candles. Deterministic: the same inputs give the same result. */
  marketsBacktest(
    strategyId: string,
    options?: {
      bars?: number
      startingCash?: number
      slippage?: number
      feeRate?: number
      outOfSamplePercent?: number
    }
  ): Promise<BacktestAnswer | { error: string; message?: string }>
  /** Sweeps one risk parameter. The warning it returns matters as much as the numbers. */
  marketsBacktestSweep(
    strategyId: string,
    field: 'stopLossPercent' | 'takeProfitPercent' | 'trailingStopPercent',
    values: number[]
  ): Promise<{ points: SweepPoint[]; warning: string } | { error: string; message?: string }>
  marketsBacktestRuns(): Promise<{ runs: BacktestRun[] } | { error: string; message?: string }>
  marketsBacktestRunsClear(): Promise<{ runs: BacktestRun[] } | { error: string; message?: string }>

  // ---------------------------------------------------------------- news, and where Markets was left
  /** Crypto headlines from publishers' own feeds. Names the sources that could not be reached rather than going quiet. */
  marketsNews(options?: {
    limit?: number
    asset?: string
  }): Promise<NewsAnswer | { error: string; message?: string }>
  marketsLayout(): Promise<MarketsLayout | { error: string; message?: string }>
  marketsSetLayout(layout: Partial<MarketsLayout>): Promise<MarketsLayout | { error: string; message?: string }>

  // ---------------------------------------------------------------- what money is shown in
  /** The display currency, the rate it converts through, and how much to believe the conversion. */
  /** Favourites and what was recently opened, with whatever prices the engine already holds. */
  /** A market condition started a workflow. Said, so it is visible rather than something that happened silently. */
  onMarketTrigger(
    listener: (event: { id: string; describe: string; instrumentId: string; value: number | null }) => void
  ): () => void
  marketsFavourites(): Promise<
    | {
        favourites: { instrumentId: string; instrument: Instrument | null }[]
        recent: { instrumentId: string; instrument: Instrument | null }[]
        quotes: { instrumentId: string; quote: QuoteView | null }[]
      }
    | { error: string; message?: string }
  >
  marketsToggleFavourite(instrumentId: string): Promise<{ favourite: boolean } | { error: string; message?: string }>
  marketsClearRecent(): Promise<{ cleared: boolean } | { error: string; message?: string }>
  /** Chart annotations, stored in market coordinates so they survive zooming and reopening. */
  marketsDrawings(instrumentId: string): Promise<{ drawings: Drawing[] } | { error: string; message?: string }>
  marketsDrawingSave(
    drawing: Partial<Drawing>
  ): Promise<{ drawing: Drawing; drawings: Drawing[] } | { error: string; message?: string }>
  marketsDrawingRemove(
    id: string,
    instrumentId: string
  ): Promise<{ drawings: Drawing[] } | { error: string; message?: string }>
  marketsDrawingsClear(instrumentId?: string): Promise<{ drawings: Drawing[] } | { error: string; message?: string }>
  /** How the panels are arranged, and the arrangements on offer. */
  marketsPanels(): Promise<
    | { layout: PanelLayout; presets: { id: string; name: string; describe: string }[] }
    | { error: string; message?: string }
  >
  marketsSetPanels(layout: PanelLayout): Promise<{ layout: PanelLayout } | { error: string; message?: string }>
  marketsPanelsPreset(presetId: string): Promise<{ layout: PanelLayout } | { error: string; message?: string }>
  marketsPanelsReset(): Promise<{ layout: PanelLayout } | { error: string; message?: string }>
  /** What can start a market workflow. Each fires on the edge, never on the state. */
  marketsTriggers(): Promise<
    { triggers: { trigger: MarketTrigger; describe: string }[] } | { error: string; message?: string }
  >
  marketsTriggerSave(
    trigger: Partial<MarketTrigger>
  ): Promise<{ trigger: MarketTrigger; triggers: MarketTrigger[] } | { error: string; message?: string }>
  marketsTriggerRemove(id: string): Promise<{ triggers: MarketTrigger[] } | { error: string; message?: string }>
  // ---------------------------------------------------------------- candlestick patterns

  /**
   * The candlestick pattern library.
   *
   * The rules come across as sentences, never as functions: the detector runs in the main process and a renderer that
   * could evaluate a rule would be a second detector that eventually disagrees with the first.
   */
  marketsPatterns(
    query?: string,
    filter?: { category?: string; direction?: string; formationLength?: number }
  ): Promise<
    | {
        libraryVersion: number
        patterns: {
          id: string
          name: string
          aliases: string[]
          category: string
          direction: string
          formationLength: number
          describe: string
          version: number
          specialises: string[]
          related: string[]
          confirmation: string | null
          invalidation: string | null
          rules: { id: string; describe: string; required: boolean }[]
          contextRules: { id: string; describe: string; required: boolean }[]
        }[]
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  marketsPattern(patternId: string): Promise<
    | {
        pattern: {
          id: string
          name: string
          aliases: string[]
          category: string
          direction: string
          formationLength: number
          describe: string
          version: number
          confirmation: string | null
          invalidation: string | null
          emphasis: number[]
          rules: { id: string; describe: string; required: boolean }[]
          contextRules: { id: string; describe: string; required: boolean }[]
        }
        broaderThan: { id: string; name: string }[]
        moreSpecificThan: { id: string; name: string }[]
        related: { id: string; name: string }[]
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  /** Examine one market. `found` is confirmed formations; `developing` can never be confirmed. */
  marketsPatternDetect(
    instrumentId: string,
    interval: string,
    options?: { limit?: number; developing?: boolean }
  ): Promise<
    | {
        instrumentId: string
        symbol: string
        exchange: string
        interval: string
        found: {
          detection: PatternDetection
          context: PatternContext | null
          timeframeAgreement: TimeframeAgreement | null
          match: 'low' | 'moderate' | 'high'
          explain: string[]
        }[]
        developing: {
          detection: PatternDetection
          context: PatternContext | null
          timeframeAgreement: TimeframeAgreement | null
          match: 'low' | 'moderate' | 'high'
          explain: string[]
        }[]
        nearMisses: NearMiss[]
        examined: number
        skipped: string | null
        describe: string
        candleCheck: SequenceCheck
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  /** What a candle the user selected actually is. Every classification it satisfies, not one chosen for them. */
  marketsPatternIdentify(
    instrumentId: string,
    interval: string,
    fromTime: number,
    toTime: number
  ): Promise<
    | {
        at: number
        candle: Candle
        geometry: CandleFacts
        relative: RelativeFacts
        classifications: {
          patternId: string
          patternName: string
          structuralMatch: number
          match: 'low' | 'moderate' | 'high'
          alsoMatches: string[]
          explain: string[]
        }[]
        preferred: string[]
        nearMisses: NearMiss[]
        describe: string
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  /** The switches, and what each one actually stops. */
  marketsPatternSettings(): Promise<
    | { settings: PatternSettings; defaults: PatternSettings; whatStops: Record<string, string>; assumptions: readonly string[] }
    | { error: string; message?: string }
  >
  marketsPatternSettingsSave(
    patch: Partial<PatternSettings>
  ): Promise<{ settings: PatternSettings; whatStops: Record<string, string> } | { error: string; message?: string }>
  marketsPatternRules(): Promise<
    | { rules: { rule: PatternAlertRule; problems: { field: string; describe: string }[] }[]; mutes: MuteRule[]; assumptions: readonly string[] }
    | { error: string; message?: string }
  >
  marketsPatternRuleSave(
    rule: Partial<PatternAlertRule>
  ): Promise<
    { rule: PatternAlertRule; problems: { field: string; describe: string }[]; rules: PatternAlertRule[] } | { error: string; message?: string }
  >
  marketsPatternRuleRemove(id: string): Promise<{ rules: PatternAlertRule[] } | { error: string; message?: string }>
  marketsPatternMutesSave(mutes: MuteRule[]): Promise<{ mutes: MuteRule[] } | { error: string; message?: string }>
  /** Decide what should fire for one market. Nothing here delivers; `marketsPatternDelivered` records what did. */
  marketsPatternEvaluate(
    instrumentId: string,
    interval: string
  ): Promise<
    | {
        fired: { firing: PatternFiring; patternName: string; symbol: string; interval: string; explain: string[] }[]
        refused: { ruleId: string; patternId: string; reason: string; describe: string }[]
        describe: string
      }
    | { error: string; message?: string }
  >
  marketsPatternDelivered(
    key: string,
    delivered: boolean,
    note: string
  ): Promise<{ firings: PatternFiring[] } | { error: string; message?: string }>
  marketsPatternHistory(query?: HistoryQuery): Promise<
    | {
        records: PatternRecord[]
        total: number
        considered: number
        excludedBy: { condition: string; count: number }[]
        describe: string
        frequency: Frequency
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  marketsPatternHistoryClear(
    keys?: string[]
  ): Promise<{ removed: number; orphanedSnapshots: string[]; describe: string } | { error: string; message?: string }>
  /** Measurements of what price did after past occurrences. Never a probability, always with its sample size. */
  marketsPatternOutcomes(
    query?: HistoryQuery,
    options?: { forwardCandles?: number; conditionOn?: string }
  ): Promise<
    | {
        occurrences: number
        summary: OutcomeSummary
        conditioned: ConditionedSummary[]
        unmeasurable: { key: string; why: string }[]
        describe: string
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  marketsPatternCompare(
    left: HistoryQuery & { label?: string },
    right: HistoryQuery & { label?: string },
    options?: { forwardCandles?: number }
  ): Promise<(Comparison & { assumptions: readonly string[] }) | { error: string; message?: string }>
  marketsPatternScan(
    instrumentId: string,
    interval: string,
    options?: { limit?: number; patternIds?: string[]; mode?: string }
  ): Promise<
    | {
        run: AnalysisRun & { partial: boolean; describe: string }
        occurrences: { detection: PatternDetection; match: 'low' | 'moderate' | 'high'; context: PatternContext | null }[]
        notes: string[]
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  marketsPatternDigest(
    period?: 'quarter-hour' | 'hour' | 'day',
    from?: number,
    to?: number
  ): Promise<
    | {
        digest: {
          period: string
          from: number
          to: number
          total: number
          byPattern: { patternId: string; count: number }[]
          byMarket: { instrumentId: string; count: number }[]
          byDirection: Record<string, number>
          busiestInterval: string | null
          describe: string
        }
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  marketsPatternHealth(): Promise<
    | {
        enabled: boolean
        held: { markets: number; detections: number }
        rules: number
        records: number
        firings: number
        mutes: number
        libraryVersion: number
        patterns: number
        assumptions: readonly string[]
      }
    | { error: string; message?: string }
  >
  /** The other intervals, each keeping its own reading. Never merged into one verdict. */
  marketsPatternTimeframes(
    instrumentId: string,
    direction?: 'bullish' | 'bearish' | 'neutral'
  ): Promise<(TimeframeContext & { assumptions: readonly string[] }) | { error: string; message?: string }>
  /** The simulated margin picture. Every figure comes with the assumptions, because a liquidation price is a model's. */
  marketsMargin(): Promise<
    | {
        settings: MarginSettings
        account: AccountMargin
        positions: { instrumentId: string; margin: PositionMargin | null }[]
        assumptions: string[]
      }
    | { error: string; message?: string }
  >
  marketsSetMargin(
    patch: Partial<MarginSettings>
  ): Promise<{ settings: MarginSettings } | { error: string; message?: string }>
  /** Several markets, indexed to a common start — because absolute prices are not comparable. */
  marketsCompare(
    instrumentIds: string[],
    interval?: string,
    limit?: number
  ): Promise<
    | {
        interval: string
        indexed: IndexedSeries[]
        stats: CompareStat[]
        correlations: CorrelationCell[]
        missing: string[]
        assumptions: string[]
      }
    | { error: string; message?: string }
  >
  /** Parameters judged on stretches they had not seen. The headline is the out-of-sample figure. */
  marketsWalkForward(
    strategyId: string,
    options?: { windows?: number; trainRatio?: number; anchored?: boolean; limit?: number }
  ): Promise<{ summary: WalkSummary; assumptions: string[] } | { error: string; message?: string }>
  /** The same trades in different orders. Generates nothing and forecasts nothing. */
  marketsMonteCarlo(
    strategyId: string,
    options?: { runs?: number; seed?: number; limit?: number }
  ): Promise<
    { trades: number; result: MonteCarloResult; assumptions: string[] } | { error: string; message?: string }
  >
  /**
   * Everything about one contract's derivatives state, in one answer.
   *
   * Every field is null where the venue does not publish it, and `available` says which panels can exist at all -- so a
   * derivatives section is absent rather than empty.
   */
  marketsDerivatives(
    instrumentId: string,
    window?: string
  ): Promise<DerivativesAnswer | { error: string; message?: string }>
  marketsFundingHistory(
    instrumentId: string,
    limit?: number
  ): Promise<{ points: FundingPoint[]; available: boolean } | { error: string; message?: string }>
  marketsOiHistory(
    instrumentId: string,
    window?: string,
    limit?: number
  ): Promise<{ points: OpenInterestPoint[]; available: boolean } | { error: string; message?: string }>
  /** Positioning, with whose it is stated: accounts net long is not long open interest. */
  marketsLongShort(
    instrumentId: string,
    window?: string,
    limit?: number
  ): Promise<{ points: LongShortRatio[]; available: boolean } | { error: string; message?: string }>
  marketsContracts(kind?: string): Promise<{ contracts: Contract[] } | { error: string; message?: string }>
  /** The trade tape with its analysis. Pressure is measured over the whole tape, never the filtered view. */
  marketsTapeAnalysis(
    instrumentId: string,
    options?: { filter?: string; threshold?: number; window?: string; priceBucket?: number; timeBucket?: number }
  ): Promise<TapeAnswer | { error: string; message?: string }>
  /** How Markets should behave for this profile: the answers, the resolved settings, and whether setup is still owed. */
  marketsExperience(): Promise<ExperienceAnswer | { error: string; message?: string }>
  marketsSetExperience(
    patch: Partial<MarketsExperienceProfile>
  ): Promise<ExperienceAnswer | { error: string; message?: string }>
  /** One setting, set by hand. Recorded as an override so no preset later undoes it. */
  marketsExperienceOverride(
    patch: Partial<ExperienceSettings>
  ): Promise<ExperienceAnswer | { error: string; message?: string }>
  marketsResetExperience(): Promise<ExperienceAnswer | { error: string; message?: string }>
  /** Reads a sentence as a request to change the experience, and changes nothing. Null when it was not one. */
  marketsExperienceRequest(said: string): Promise<
    | { patch: Partial<MarketsExperienceProfile> | null; applied: boolean; experience: ExperienceAnswer }
    | { error: string; message?: string }
  >
  marketsLearned(termId: string, hint?: boolean): Promise<ExperienceAnswer | { error: string; message?: string }>
  /** One definition, in this profile's vocabulary. Not found rather than invented. */
  marketsExplain(
    asked: string
  ): Promise<
    { found: boolean; explanation: Explanation | null; terminology: string } | { error: string; message?: string }
  >
  marketsGlossary(
    surface?: string
  ): Promise<{ terminology: string; terms: Explanation[] } | { error: string; message?: string }>
  marketsOnboarding(): Promise<OnboardingAnswer | { error: string; message?: string }>
  marketsOnboardingDraft(draft: OnboardingDraft): Promise<OnboardingAnswer | { error: string; message?: string }>
  marketsOnboardingApply(draft: OnboardingDraft): Promise<
    | { ok: boolean; problems: DraftProblem[]; missing?: number; experience: ExperienceAnswer }
    | { error: string; message?: string }
  >
  marketsOnboardingSkip(): Promise<ExperienceAnswer | { error: string; message?: string }>
  marketsOnboardingRestart(): Promise<ExperienceAnswer | { error: string; message?: string }>
  marketsCurrency(): Promise<CurrencyAnswer | { error: string; message?: string }>
  /** Chooses one by hand. Recorded as manual, so detection never reaches for it again. */
  marketsSetCurrency(code: string): Promise<CurrencyAnswer | { error: string; message?: string }>
  marketsResetCurrency(): Promise<CurrencyAnswer | { error: string; message?: string }>
  marketsCurrencyOptions(patch: {
    favourites?: string[]
    compact?: boolean
  }): Promise<CurrencyAnswer | { error: string; message?: string }>
  marketsSetTicker(config: Partial<TickerConfig>): Promise<MarketsState | { error: string; message?: string }>
  /** The strip along the bottom: what it draws, and the subscription that keeps it moving. */
  marketsStrip(): Promise<StripAnswer | { error: string; message?: string }>
  /** The strip's own on/off, reached from the strip's close button and from Settings. */
  marketsStripEnabled(enabled: boolean): Promise<MarketsState | { error: string; message?: string }>
  /**
   * The strip was switched off somewhere else.
   *
   * There are two strips reading one setting, so closing the one along the bottom of the browser has to reach the one
   * along the bottom of this window. Without this the window's strip would keep moving after the browser's had gone,
   * and the setting would disagree with the screen until something else happened to re-read it.
   */
  onMarketsStripChanged(listener: () => void): () => void
  /**
   * Whether the browser is running at all.
   *
   * Not the same as whether its window is in front: as a window of its own it goes on running while the chat is being
   * used, which is what lets going back to it keep every tab. The chat says so while it is running, and says nothing
   * when it is not.
   */
  onChromiumRunning(listener: (running: boolean) => void): () => void
  /** Puts the browser's window away and brings the chat back. The chat's side of the handoff. */
  chromiumReturnToChat(): Promise<{ ok: boolean }>
  marketsSearch(query: string): Promise<{ results: Instrument[] } | { error: string; message?: string }>
  marketsTickerAdd(instrumentId: string): Promise<MarketsState | { error: string; message?: string }>
  marketsTickerRemove(instrumentId: string): Promise<MarketsState | { error: string; message?: string }>
  marketsAddGroup(name: string): Promise<MarketsState | { error: string; message?: string }>
  marketsSetGroup(groupId: string): Promise<MarketsState | { error: string; message?: string }>
  marketsRemoveGroup(groupId: string): Promise<MarketsState | { error: string; message?: string }>
  marketsRefresh(): Promise<MarketsState | { error: string; message?: string }>
  /** An alert fired. Carries the label and the value, never anything about a page. */
  onMarketAlert(listener: (event: { id: string; label: string; symbol: string; value: number }) => void): () => void
  /** The strip asked the window to open something: a chart, a watchlist, an alert, or the group chooser. */
  onMarketsOpen(listener: (event: { what: string; instrumentId: string }) => void): () => void
  /** Orion, the Orb or a workflow asking for a market to be brought up on screen. */
  onMarketsShow(listener: (event: { instrumentId: string; section?: string }) => void): () => void
  /**
   * The browser's search page asking for something you made to be opened on the Create screen.
   *
   * `artifacts:show`, not `artifacts:open`: the browser's own channel for asking is already called that, and one
   * name with two meanings is a bug waiting for whoever reads it next.
   */
  onOpenArtifact(listener: (artifactId: string) => void): () => void
  /*
   * Notifications.
   *
   * No way to make one, on purpose: a notification exists because something in Orbis finished, failed or is waiting.
   * The window reads them, marks them, forgets them and presses their buttons.
   */
  notifications(): Promise<{ ok: boolean; items?: OrbisNotification[]; unread?: number; can?: { native: boolean; buttons: boolean; quiet: boolean }; message?: string }>
  notificationRead(id: string | null): Promise<{ ok: boolean }>
  notificationClear(id: string | null): Promise<{ ok: boolean }>
  notificationAct(id: string, action: string): Promise<{ ok: boolean; message?: string }>
  notificationWatching(what: string | null): Promise<{ ok: boolean }>
  notificationTest(): Promise<{ ok: boolean; message: string }>
  onNotificationsChanged(listener: () => void): () => void
  onNotificationOpen(listener: (what: { id: string; event: string; subject: Record<string, string> }) => void): () => void
  securityLog(): Promise<SecurityEvent[] | AccountRefusal>
  clearSecurityLog(): Promise<{ ok: true } | AccountRefusal>
  profileLockState(): Promise<ProfileLockState | ProfileLockRefusal>
  profileLockSave(policy: Partial<ProfileLockPolicy>): Promise<ProfileLockDone | ProfileLockRefusal>
  /** Locks Orbis now. Always works, even with Profile Lock switched off: somebody asked. */
  profileLockNow(): Promise<ProfileLockDone | ProfileLockRefusal>
  /** Orbis locked itself. Carries why, so the unlock screen can say so rather than looking like a fault. */
  onAccountLocked(listener: (event: ProfileLockedEvent) => void): () => void
  tabLockState(): Promise<TabLockState | TabLockRefusal>
  tabLockJudge(password: string, name: string): Promise<PasswordVerdict>
  tabLockCreateGroup(name: string, password: string, policy?: Partial<TabLockPolicy>): Promise<{ group: TabLockGroup; state: TabLockState } | TabLockRefusal>
  tabLockRemoveGroup(groupId: string, password: string): Promise<TabLockDone | TabLockRefusal>
  tabLockUnlockGroup(groupId: string, password: string): Promise<TabLockDone | TabLockRefusal>
  tabLockChangeGroupPassword(groupId: string, current: string, next: string): Promise<TabLockDone | TabLockRefusal>
  /** The account password is the only way back into a forgotten tab password. */
  tabLockResetGroupPassword(groupId: string, accountPassword: string, next: string): Promise<TabLockDone | TabLockRefusal>
  tabLockSetGroupPolicy(groupId: string, policy: Partial<TabLockPolicy>): Promise<TabLockDone | TabLockRefusal>
  tabLockSetDefaultPolicy(policy: Partial<TabLockPolicy>): Promise<TabLockDone | TabLockRefusal>
  tabLockAddRule(rule: { pattern: string; groupId: string; enabled?: boolean; schedule?: unknown }): Promise<TabLockDone | TabLockRefusal>
  tabLockRemoveRule(ruleId: string): Promise<TabLockDone | TabLockRefusal>
  tabLockSetRules(rules: unknown): Promise<TabLockDone | TabLockRefusal>
  tabLockProtect(tabId: number, groupId: string): Promise<TabLockDone | TabLockRefusal>
  /** Taking protection off needs the password too: it is as much a decision as putting it on. */
  tabLockUnprotect(tabId: number, password: string): Promise<TabLockDone | TabLockRefusal>
  tabLockUnlockTab(tabId: number, password: string): Promise<TabLockDone | TabLockRefusal>
  tabLockLockTab(tabId: number): Promise<TabLockDone | TabLockRefusal>
  tabLockSetTabPolicy(tabId: number, policy: Partial<TabLockPolicy> | null): Promise<TabLockDone | TabLockRefusal>
  /** Everything protected, locked, and every tab password closed. */
  tabLockLockAll(): Promise<(TabLockDone & { count: number }) | TabLockRefusal>
  tabLockExplain(tabId: number): Promise<TabLockExplanation | TabLockRefusal>
  /** Whether a label somebody is typing would give the site away. */
  tabLockCheckLabel(label: string, url: string): Promise<{ reveals: boolean }>
  /** A tab locked or unlocked. Carries no address and no title of the page -- only the tab, and why. */
  onTabLockChanged(listener: (change: { tabId: number; locked: boolean; reason: LockTrigger | null; label: string }) => void): () => void
  /** Several tabs locked at once: the computer locked, it slept, Orbis started, or somebody asked for everything. */
  onTabLockSwept(listener: (event: { count: number; reason: LockTrigger }) => void): () => void
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
   * The words in a recording, transcribed entirely on this machine by the local Pulsar model already installed.
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
  /** What this machine can run Pulsar on, and the model size recommended for it. */
  voiceHardware(): Promise<PulsarHardwareInfo | null>
  /** Every Pulsar model Orbis knows about, and which of them are installed or downloading right now. */
  pulsarModelsStatus(): Promise<{ installed: PulsarModelId[]; downloading: PulsarModelId[] }>
  /** Downloads one model, reporting progress through onPulsarModelProgress until it resolves. */
  downloadPulsarModel(id: PulsarModelId): Promise<{ ok: boolean; message?: string }>
  cancelPulsarModelDownload(id: PulsarModelId): Promise<void>
  /** Removes a model's file from disk. Safe to call on one that was never installed. */
  deletePulsarModel(id: PulsarModelId): Promise<void>
  /** Whether a model's file on disk still matches the checksum it was recorded with when it finished downloading. */
  verifyPulsarModel(id: PulsarModelId): Promise<boolean>
  onPulsarModelProgress(listener: (progress: PulsarDownloadProgress) => void): () => void
  /** Opens a save dialog for a data: image; resolves false when cancelled. */
  saveImage(dataUrl: string, name: string): Promise<boolean>
  /** Re-renders an image with the edit merged into its prompt, keeping the seed. */
  editImage(request: ImageEditRequest): Promise<ImageEditResult>
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
  /** New-tab shortcuts: saved in the browser library; the site's icon is fetched in the background. */
  addShortcut(name: string, url: string): Promise<SiteShortcut | null>
  updateShortcut(id: string, name: string, url: string): Promise<SiteShortcut | null>
  removeShortcut(id: string): Promise<void>
  /** Fetches a shortcut's icon again (for one saved while its site couldn't be reached). */
  refreshShortcutIcon(id: string): Promise<void>
  /** Predicts the user's next message and follow-ups for the latest assistant reply. */
  suggestFollowups(messages: { role: Role; content: string }[]): Promise<FollowupSuggestions>
  /** A short AI-written chat title for a first message, or null if one couldn't be made. */
  generateTitle(prompt: string): Promise<string | null>
  /** Completes a half-typed message using the chat for context; the result always starts with the draft, or is null. */
  completeDraft(draft: string, messages: { role: Role; content: string }[]): Promise<string | null>
  /** Approves or cancels a browser action Orbis asked about. */
  answerBrowserConfirmation(requestId: string, confirmationId: string, approved: boolean): Promise<void>
  /** Pauses (resumable) or stops a running browser automation. */
  controlAutomation(requestId: string, action: 'pause' | 'stop'): Promise<void>
  /** Adds an instruction to a running browser automation. */
  steerAutomation(requestId: string, text: string): Promise<void>
  /**
   * Long automations Orbis was in the middle of when it last closed, newest first.
   *
   * Each says where it got to, in words. Nothing here is a promise that carrying on will work -- the page has almost
   * certainly moved on -- and anything more than a few hours old is not offered at all.
   */
  unfinishedAutomations(): Promise<{ id: string; conversationId: string; said: string; state: AutomationState }[]>
  /** Forgets one, because it was carried on with or because it was not wanted. */
  forgetAutomation(id: string): Promise<void>
  /** What a message sent during an automation means for it. */
  classifyAutomationMessage(text: string, objective: string): Promise<'stop' | 'pause' | 'resume' | 'steer' | 'other'>
  /** Opens an address as a page, or searches anything else with Orbis Search, in Orbis's Chromium (started if needed). */
  chromiumEmbedRegion(region: { x: number; y: number; width: number; height: number; dpr: number; visible: boolean; viewportWidth?: number }): void
  onChromiumShow(callback: () => void): () => void
  /** The browser asked to be put away and the chat shown; the browser stays open behind it. */
  onChromiumHide(callback: () => void): () => void
  onChromiumClosed(callback: () => void): () => void
  chromiumOpen(input: string, options?: { newTab?: boolean; more?: string[] }): Promise<{ ok: boolean; detail: string }>
  getBrowserLibrary(): Promise<BrowserLibrarySnapshot>
  /** How this profile has arranged the browser sidebar. */
  getBrowserSidebar(): Promise<SidebarLayout>
  saveBrowserSidebar(layout: SidebarLayout): Promise<SidebarLayout>
  resetBrowserSidebar(): Promise<SidebarLayout>
  /** Told when the arrangement changes elsewhere — switching profile, say. */
  onBrowserSidebar(listener: (layout: SidebarLayout) => void): () => void
  onBrowserLibrary(listener: (library: BrowserLibrarySnapshot) => void): () => void
  /** Bookmarks the page, or removes its bookmark; resolves to whether it is bookmarked now. */
  toggleBookmark(url: string, title: string): Promise<boolean>
  removeHistory(url: string): Promise<void>
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
  /** Turns the Orbis window's fullscreen on, off, or (without a value) toggles it; resolves to the new state. */
  setWindowFullscreen(on?: boolean): Promise<boolean>
  /** Whether the Orbis window is really fullscreen, and changes to it however they happen (F11, Esc, the OS). */
  isWindowFullscreen(): Promise<boolean>
  onWindowFullscreen(listener: (on: boolean) => void): () => void
  /** Settings changed outside the settings screen (by the Browser Control Layer). */
  onSettingsChanged(listener: (settings: Settings) => void): () => void

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
  draftWorkflow(instruction: string, workflowId?: string): Promise<{ workflow: Workflow; issues: WorkflowIssue[] }>
  /** How a workflow is actually doing, from its own run history. */
  workflowHealth(workflowId: string): Promise<HealthReport>
  /** What its runs show is worth changing, measured rather than guessed. */
  workflowFindings(workflowId: string): Promise<Finding[]>
  /** What to change about one that keeps failing. Proposals for a person; nothing is applied on its own. */
  workflowRepairs(workflowId: string): Promise<Repair[]>
  /** Whether it still fits this Orbis, and what it would take. */
  workflowCompatibility(workflowId: string): Promise<{ ok: boolean; why: string; problems: Missing[]; migration: Migration }>
  /** Applies a migration the person accepted, as an ordinary save with a version history entry. */
  applyWorkflowMigration(workflowId: string): Promise<Workflow>
  /** Which workflows an Orbis change has broken, found together rather than one failure at a time. */
  workflowsAffectedByUpdate(): Promise<{ workflow: Workflow; problems: Missing[] }[]>
  /** Workflows waiting for the browser to be free, and what each is waiting on. */
  workflowsWaiting(): Promise<{ workflowId: string; queuedAt: number; reason: string }[]>
  /** Takes one out of the queue without running it. */
  unqueueWorkflow(workflowId: string): Promise<boolean>
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
  listProfiles(): Promise<{ profiles: Profile[]; activeId: string }>
  createProfile(name: string): Promise<Profile>
  saveProfile(profile: Profile): Promise<Profile>
  renameProfile(id: string, name: string): Promise<Profile>
  removeProfile(id: string): Promise<{ removed: boolean; reason?: string }>
  switchProfile(id: string): Promise<{ profile: Profile }>
  onProfileChanged(listener: (change: { profile: Profile }) => void): () => void
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

  // ---------------------------------------------------------------- Orbis Pages

  /** Everything the Pages library needs in one answer. */
  pagesState(): Promise<
    | {
        pages: PageCard[]
        unavailable: PageCard[]
        recent: PageCard[]
        favourites: PageCard[]
        categories: PageCategoryNode[]
        tags: { tag: string; count: number }[]
        problems: { slug: string; message: string }[]
      }
    | { error: string; message?: string }
  >
  pagesList(filter?: {
    category?: string
    tag?: string
    kind?: string
    favourite?: boolean
    offline?: boolean
  }): Promise<{ pages: PageCard[] } | { error: string; message?: string }>
  pagesSearch(
    query: string,
    options?: { limit?: number; offlineOnly?: boolean; category?: string }
  ): Promise<{ results: PageSearchHit[] } | { error: string; message?: string }>
  pagesSuggest(prefix: string): Promise<{ suggestions: PageCard[] } | { error: string; message?: string }>
  pagesRelated(
    pageId: string
  ): Promise<{ related: { page: PageCard; matched: string[] }[] } | { error: string; message?: string }>
  /** Reads an address without counting it as a visit, for the router. */
  pagesResolve(url: string): Promise<PageResolution | { error: string; message?: string }>
  pagesOpen(url: string): Promise<PageResolution | { error: string; message?: string }>
  pagesFavourite(
    pageId: string,
    favourite: boolean
  ): Promise<{ favourite: boolean } | { error: string; message?: string }>
  pagesDetail(pageId: string): Promise<
    | {
        page: PageCard
        requests: { name: string; risk: string; reason: string }[]
        permissions: PagePermission[] | null
        projects: PageProjectSummary[]
        related: { page: PageCard; matched: string[] }[]
        dependencies: { id: string; atLeast: string; optional: boolean }[]
        languages: string[]
      }
    | { error: string; message?: string }
  >
  pagesPermissions(pageId: string): Promise<
    | { permissions: PagePermission[]; requests: { name: string; risk: string; reason: string }[] }
    | { error: string; message?: string }
  >
  /**
   * Records a permission after somebody has answered.
   *
   * `scope` limits it -- an origin, for a network capability. An empty string means the capability has no scope; a scope
   * Orbis cannot read becomes a refusal rather than a wider grant.
   */
  pagesGrant(
    pageId: string,
    capabilityId: string,
    scope?: string,
    minutes?: number
  ): Promise<{ granted: boolean; message?: string; permissions?: PagePermission[] | null }>
  pagesRevoke(
    pageId: string,
    capabilityId?: string
  ): Promise<{ permissions: PagePermission[] | null } | { error: string; message?: string }>
  /**
   * The one door to the computational engines.
   *
   * Every operation is checked against the Page's capabilities before an engine runs, so a Page without the capability an
   * operation needs is refused whatever it asks for.
   */
  pagesCompute(request: {
    pageId: string
    operation: string
    input: Record<string, unknown>
  }): Promise<PageComputeResult>
  pagesProjects(pageId: string): Promise<{ projects: PageProjectSummary[] } | { error: string; message?: string }>
  pagesProjectSave(
    pageId: string,
    projectId: string | null,
    name: string,
    state: Record<string, unknown>
  ): Promise<
    | { saved: true; project: PageProjectSummary; projects: PageProjectSummary[] }
    | { saved: false; error: string; message: string }
    | { error: string; message?: string }
  >
  pagesProjectDelete(
    pageId: string,
    projectId: string
  ): Promise<{ deleted: boolean; projects: PageProjectSummary[] } | { error: string; message?: string }>
  pagesHealth(): Promise<
    | { health: PageRegistryHealth; problems: { slug: string; message: string }[] }
    | { error: string; message?: string }
  >
  // ---------------------------------------------------------------- several Pages as one application

  // ---------------------------------------------------------------- the Lab

  /**
   * Run a graph of engine calls in dependency order.
   *
   * `needs` lists the capabilities the project would require and the Page does not hold. It comes back with the
   * refusal so a Page can ask for them rather than guessing why the run did not start.
   */
  pagesLabRun(
    pageId: string,
    project: Record<string, unknown>,
    only?: string[],
    force?: boolean
  ): Promise<
    | { ok: true; execution: Record<string, unknown>; events: Record<string, unknown>[] }
    | { ok: false; error: string; message: string; needs: string[] }
    | { error: string; message?: string }
  >
  pagesLabPlan(
    project: Record<string, unknown>,
    only?: string[],
    cached?: string[]
  ): Promise<Record<string, unknown> | { error: string; message?: string }>
  pagesLabStaleness(
    project: Record<string, unknown>,
    results: Record<string, unknown>[]
  ): Promise<Record<string, unknown> | { error: string; message?: string }>
  pagesLabRerunFrom(
    project: Record<string, unknown>,
    results: Record<string, unknown>[],
    nodeId: string
  ): Promise<Record<string, unknown> | { error: string; message?: string }>
  pagesLabHealth(
    project: Record<string, unknown>,
    results: Record<string, unknown>[]
  ): Promise<Record<string, unknown> | { error: string; message?: string }>

  pagesApplications(): Promise<
    { applications: PageApplicationSummary[] } | { error: string; message?: string }
  >
  pagesApplication(
    applicationId: string
  ): Promise<{ application: Record<string, unknown> | null } | { error: string; message?: string }>
  pagesApplicationSave(
    application: Record<string, unknown>
  ): Promise<
    | { saved: true; applicationId: string; applications: PageApplicationSummary[] }
    | { saved: false; error: string; message: string }
    | { error: string; message?: string }
  >
  pagesApplicationDelete(
    applicationId: string
  ): Promise<
    { deleted: boolean; applications: PageApplicationSummary[] } | { error: string; message?: string }
  >
  pagesApplicationRoute(
    applicationId: string,
    route: string
  ): Promise<
    | { ok: true; pageId: string; label: string; params: Record<string, string>; url: string }
    | { ok: false; error: string; message: string }
    | { error: string; message?: string }
  >


  // ---------------------------------------------------------------- Pages that did not exist yet

  /**
   * A Page built for a request nothing in the library answers.
   *
   * `page` is null whenever nothing was built, and `because` says why -- which covers a request that was never a
   * Page, one an existing Page answers (`insteadOpen`), and one that was built and failed its checks. Nothing is
   * kept by this call.
   */
  pagesGenerate(
    request: string,
    intents?: readonly { intent: string; confidence: number }[]
  ): Promise<
    | {
        stage: string
        sessionId: string
        history: { stage: string; at: number; note: string }[]
        failure: { code: string; message: string; problems: string[] } | null
        gates: { gate: string; outcome: string; because: string[] }[]
        because: string[]
        insteadOpen: string | null
        page: {
          pageId: string
          manifest: {
            slug: string
            title: string
            description: string
            icon: string
            capabilities: string[]
            capabilityReasons: Record<string, string>
            limitations: string[]
            categories: string[]
          }
          document: unknown
        } | null
      }
    | { error: string; message?: string }
  >
  pagesGenerateKeep(pageId: string): Promise<{ kept: boolean; message: string; url: string | null } | { error: string; message?: string }>
  pagesGenerateDiscard(pageId: string): Promise<{ discarded: boolean } | { error: string; message?: string }>
  /** One calculation for a Page that is built and not yet kept, which the register does not know about. */
  pagesGenerateTry(
    pageId: string,
    operation: string,
    input: Record<string, unknown>
  ): Promise<{ ok: true; value: unknown } | { ok: false; message: string } | { error: string; message?: string }>
  /** A Page built again. Adds a version beside the one in use; it does not replace it. */
  /**
   * A named edit to a generated Page, applied without writing the Page again.
   *
   * `recognised: false` means the request is not one of the edits that can be made directly -- the caller may fall
   * back to `pagesGenerateRebuild`. It is not an error, and the two are kept apart so a real failure cannot hide
   * behind a regeneration.
   */
  pagesGenerateEdit(
    pageId: string,
    request: string
  ): Promise<
    | {
        recognised: boolean
        applied: { op: string; target: string; to: unknown; reason: string }[]
        problems: { at: string; code: string; message: string }[]
        message: string
        version: { versionId: string; version: string; reason: string | null; state: string } | null
        dropped: { name: string; label: string; why: string }[]
      }
    | { error: string; message?: string }
  >
  pagesGenerateRebuild(
    pageId: string,
    change: string
  ): Promise<
    | {
        message: string
        version: { versionId: string; version: string; reason: string | null } | null
        changes: { kind: string; what: string; name: string; message: string }[]
        wantsMore: boolean
        newCapabilities: string[]
        dropped: { name: string; label: string; why: string }[]
        stage: string
      }
    | { error: string; message?: string }
  >
  pagesGenerateHistory(pageId: string): Promise<
    | {
        publishedVersionId: string | null
        forkedFrom: string | null
        versions: {
          versionId: string
          parentVersionId: string | null
          version: string
          state: string
          reason: string | null
          createdAt: number
          title: string
        }[]
      }
    | { error: string; message?: string }
  >
  pagesGeneratePublish(pageId: string, versionId: string): Promise<{ published: boolean; message: string } | { error: string; message?: string }>
  pagesGenerateWithdraw(pageId: string, versionId: string): Promise<{ withdrawn: boolean; message: string } | { error: string; message?: string }>
  pagesGenerateForget(pageId: string): Promise<{ forgotten: boolean } | { error: string; message?: string }>
  pagesGenerateSessions(): Promise<
    | { sessions: { sessionId: string; request: string; stage: string; updatedAt: number; code: string; message: string }[] }
    | { error: string; message?: string }
  >
  /** The document a generated Page opens as. */
  pagesGenerateDocument(pageId: string): Promise<{ document: unknown } | { error: string; message?: string }>
  /**
   * Builds a Page out of code for a request.
   *
   * A different kind of Page from the generated ones above, and said so on purpose: that route builds a calculator
   * out of engines Orbis tested, and this one builds a web page a model wrote. Both are honest; only one of them is
   * about correctness.
   */
  pagesCodeBuild(request: string): Promise<{
    ok: boolean
    pageId?: string
    title?: string
    purpose?: string
    notes?: readonly string[]
    problems?: string[]
    attempts?: { said: string; problems: string[] }[]
    reason?: string
    message?: string
  }>
  /** Opens a built code Page. `health` says whether its code actually ran, which is a different fact from it opening. */
  pagesCodeOpen(pageId: string): Promise<{ ok: boolean; error?: string; message?: string; health?: unknown }>
  /** How an open code Page is doing. The answer changes after the open returns, which is why it is asked separately. */
  pagesCodeHealth(pageId: string): Promise<unknown>
  pagesCodeClose(pageId: string): Promise<{ ok: boolean }>
  /** Where on screen a code Page is shown. One-way: it is sent on every move and nothing waits for it. */
  pagesCodeRegion(area: { x: number; y: number; width: number; height: number; visible: boolean }): void

  /**
   * Every artifact operation, through one door.
   *
   * The operation is named in the request (`artifact.kinds`, `artifact.create`, `artifact.list`, `artifact.read`,
   * `artifact.export`, `artifact.remove`) and the answer is an envelope: read `ok` before anything inside. Content
   * never comes back whole -- a record and a bounded preview do -- and a save goes to a file chosen in a dialog that
   * runs in the main process, read back and checked before it is reported.
   */
  creationRun(request: Record<string, unknown>): Promise<
    { ok: true; operation: string; value: unknown } | { ok: false; operation: string; error: string; message: string; detail?: unknown }
  >

  /**
   * A Page packed up as a file.
   *
   * Refused when the scan finds something that looks like a credential. `acceptSecrets` is only ever true because
   * somebody was shown each finding and chose to include it anyway.
   */
  pagesExport(
    pageId: string,
    entries: { path: string; content: string }[],
    acceptSecrets: boolean
  ): Promise<
    | { ok: true; package: unknown; secrets: PageSecretFinding[]; notes: string[] }
    | { ok: false; error: string; message: string }
    | { error: string; message?: string }
  >

  /** A package described so somebody can decide about it. Nothing is installed and nothing is granted by this call. */
  pagesInspectPackage(
    raw: unknown,
    packedBytes?: number
  ): Promise<
    | {
        ok: true
        manifest: unknown
        files: number
        requested: { id: string; name: string; description: string; risk: string }[]
        unknownCapabilities: string[]
        /** Whether the checksum matched. Means "not corrupted", never "not tampered with". */
        intact: boolean
        warnings: string[]
        beforeYouDecide: string[]
      }
    | { ok: false; error: string; message: string }
    | { error: string; message?: string }
  >

  /** A fault turned into advice, with what each recovery costs attached to it. */
  pagesDiagnose(
    fault: { kind: string; detail: string; at?: number; pageId?: string; repeats?: number },
    context?: { hasCheckpoint?: boolean; hasUnsavedWork?: boolean; everStarted?: boolean }
  ): Promise<
    | {
        ok: true
        source: string
        summary: string
        consequence: string
        actionable: boolean
        recurring: boolean
        suggestions: { action: string; label: string; cost: string; automatic: boolean }[]
      }
    | { error: string; message?: string }
  >

  /** An accessibility audit. It never comes back as a pass, and `cannotCheck` is the part that says why. */
  pagesAudit(
    elements: PageAuditElement[]
  ): Promise<
    | {
        ok: true
        findings: { severity: string; element: string; problem: string; fix: string; rule: string }[]
        checked: string[]
        cannotCheck: string[]
        counts: Record<string, number>
        headline: string
      }
    | { error: string; message?: string }
  >

  /** A Page built in the builder, checked before it may run. */
  pagesCheckDocument(
    document: unknown
  ): Promise<
    | {
        ok: true
        problems: { at: string; severity: 'error' | 'warning'; message: string; code: string }[]
        canRun: boolean
        operations: string[]
        unusedFields: string[]
      }
    | { error: string; message?: string }
  >

  /**
   * A question answered by an engine where it can be.
   *
   * `computed: false` means answer it the ordinary way, not that there is no answer. A model must never produce a
   * number it could have computed, and this is the call that decides which case a question is.
   */
  pagesAnswer(
    question: string
  ): Promise<
    | {
        ok: true
        computed: true
        text: string
        operation: string
        understood: string
        notes: string[]
        pageId: string
        pageTitle: string
      }
    | { ok: true; computed: false; because: string }
    | { error: string; message?: string }
  >

  /** Who can receive what from another Page. Only what each Page declared. */
  pagesParticipants(): Promise<
    | {
        participants: {
          pageId: string
          title: string
          slug: string
          running: boolean
          accepts: { kind: string; describe: string; replies: boolean }[]
          canSend: boolean
        }[]
      }
    | { error: string; message?: string }
  >

  /**
   * One Page's message to another.
   *
   * Both ends have to agree: the sender needs `page.send` and the receiver must have declared it accepts that kind.
   * Every reason a message cannot be delivered gives the same answer, because the differences between them are a map
   * of what is installed.
   */
  pagesSend(
    fromPageId: string,
    toPageId: string,
    kind: string,
    body: unknown
  ): Promise<
    | { ok: true; to: string; kind: string; hops: number; expectsReply: boolean; notes: string[] }
    | { ok: false; error: string; message: string }
    | { error: string; message?: string }
  >

  /** Which Pages, if any, answer a search better than the results they would displace. */
  pagesSearchModule(
    query: string,
    intents: { intent: string; confidence: number }[],
    looksLikeUrl: boolean
  ): Promise<
    | { ok: true; show: boolean; rank: number; heading: string; because: string; suggestions: PageSuggestionCard[] }
    | { error: string; message?: string }
  >
}

/** Something in an export that looked like a credential. Never carries the value itself. */
export interface PageSecretFinding {
  entry: string
  looksLike: string
  line: number
}

/** An element as a Page describes itself for an accessibility audit. */
export interface PageAuditElement {
  id: string
  role: string
  name?: string
  keyboardReachable?: boolean
  focusOrder?: number
  foreground?: string
  background?: string
  fontPixels?: number
  bold?: boolean
  width?: number
  height?: number
  colourOnly?: boolean
  animates?: boolean
  respectsReducedMotion?: boolean
  alternativeText?: string
  decorative?: boolean
}

/** A Page offered as an answer to a search, with the reason it was chosen. */
export interface PageSuggestionCard {
  pageId: string
  slug: string
  title: string
  summary: string
  icon: string
  confidence: number
  /** Every signal that contributed, in words. Shown, so a wrong suggestion can be seen to be wrong. */
  because: string[]
  prefill: string | null
}

// ---------------------------------------------------------------- Orbis Pages

/**
 * One Page, as the interface sees it.
 *
 * Deliberately not the whole registry entry: the trust level stays in the main process, because it is not the renderer's
 * business and anything sent to the renderer eventually gets displayed.
 */
export interface PageCard {
  pageId: string
  slug: string
  /** The canonical address. What a bookmark should store. */
  url: string
  title: string
  description: string
  kind: string
  icon: string
  version: string
  categories: string[]
  tags: string[]
  status: 'available' | 'archived' | 'needs-review' | 'incompatible' | 'blocked'
  /** Whether everything it does works with no network. */
  offline: boolean
  favourite: boolean
  openCount: number
  lastOpenedAt: number | null
  /** What the Page says it cannot do. Shown rather than discovered. */
  limitations: string[]
  summary: string
  /** Why it is not available, when it is not. Empty otherwise. */
  note: string
}

export interface PageSearchHit {
  page: PageCard
  score: number
  /** Which signals fired, so a ranking can be explained rather than trusted. */
  matched: string[]
}

export interface PageCategoryNode {
  path: string
  name: string
  /** Pages filed directly here. */
  count: number
  /** Pages here or anywhere below. */
  total: number
  children: PageCategoryNode[]
}

export interface PagePermission {
  capabilityId: string
  name: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  /** What is actually true now, rather than what the Page asked for. */
  outcome: 'allow' | 'deny' | 'prompt' | 'unavailable'
  scope: string
  message: string
}

export type PageResolution =
  | {
      found: true
      page: PageCard
      /** The Page's own navigation within itself. */
      route: string[]
      params: Record<string, string>
      fragment?: string
      canonicalUrl: string
      /** Set when an old address redirected here. */
      redirectedFrom: string | null
    }
  | { found: false; reason: 'bad-address' | 'not-found' | 'unavailable'; message: string }

export type PageComputeResult =
  | { ok: true; operation: string; value: unknown }
  | { ok: false; operation: string; error: string; message: string; capability?: string }

export interface PageProjectSummary {
  projectId: string
  pageId: string
  name: string
  createdAt: number
  updatedAt: number
  state: Record<string, unknown>
}

export interface PageRegistryHealth {
  pages: number
  available: number
  archived: number
  needsReview: number
  incompatible: number
  danglingAliases: string[]
  duplicateSlugs: string[]
  duplicateIds: string[]
  healthy: boolean
}

// ---------------------------------------------------------------- moving a profile between machines

export interface PortableCategoryView {
  id: string
  label: string
  describe: string
  portability: string
  sensitivity: string
  /** False for anything tied to this machine. Shown and never silently dropped. */
  canTravel: boolean
  mergeable: boolean
  requiresReauthentication: boolean
  userAction: string | null
  why: string | null
}

export interface PortableTransferState {
  categories: PortableCategoryView[]
  everything: string[]
  excluded: { id: string; label: string; why: string }[]
  protectionNotes: string[]
  assumptions: string[]
}

export interface PortableEstimate {
  contentBytes: number
  files: number
  packageBytes: number
  freeBytes: number | null
  enoughRoom: boolean | null
  why: string
}

export interface PortableProgress {
  stage: string
  category: string | null
  filesDone?: number
  filesTotal?: number
  bytesDone?: number
  bytesTotal?: number
  message: string
}

export interface PortableExportResult {
  destination: string
  bytes: number
  manifest: { packageId: string; createdAt: number; profileName: string; categories: { id: string; disposition: string; count: number; note: string }[]; encryption: { encrypted: boolean } }
  complete: { complete: boolean; missing: string[]; describe: string }
  addedDependencies: string[]
  failures: { categoryId: string; message: string }[]
  notes: string[]
}

export interface PortableInspection {
  manifest: PortableExportResult['manifest'] & { createdByVersion: string; profileId: string }
  summary: { describe: string } & Record<string, unknown>
  compatibility: { importable: boolean; willRestore: string[]; cannotUse: { id: string; why: string }[]; userActions: { id: string; label: string; action: string }[]; describe: string }
  encrypted: boolean
  blocking: string[]
  notes: string[]
  sizeBytes: number
}

export interface PortableImportResult {
  categories: { categoryId: string; status: string; filesWritten: number; added: number | null; kept: number; notes: string[] }[]
  actions: { id: string; label: string; action: string }[]
  actionsAfterImport: { id: string; label: string; action: string }[]
  filesWritten: number
  notes: string[]
}

export interface PortableRecovery {
  interrupted: boolean
  startedAt: number | null
  packageId: string | null
  paths: { scope: string; path: string }[]
  why: string
}
