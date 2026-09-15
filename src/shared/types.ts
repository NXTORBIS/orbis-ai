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
  persona: string
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
  persona: string
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

export type AuthStatus = 'unconfigured' | 'signed-out' | 'waiting' | 'signing-in' | 'signed-in'

/** Account sign-in as the window sees it: never any code or token. */
export interface AuthState {
  status: AuthStatus
  /** The provider in use, e.g. "Google". */
  provider?: string
  user?: { name: string; email: string; picture?: string }
  /** Why the last attempt failed. */
  error?: string
  /** Something worth knowing about a successful sign-in. */
  notice?: string
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
  /** Remembered decisions, keyed "origin permission". */
  permissions: Record<string, SitePermissionDecision>
  /** Recent address-bar searches, newest first. */
  searches: BrowserSearchEntry[]
  picks: Record<string, BrowserPick>
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
  transcribeAudio(audioBuffer: Uint8Array): Promise<string>
  /** Opens a save dialog for a data: image; resolves false when cancelled. */
  saveImage(dataUrl: string, name: string): Promise<boolean>
  /** Re-renders an image with the edit merged into its prompt, keeping the seed. */
  editImage(request: ImageEditRequest): Promise<ImageEditResult>
  /** Fires when a page in the in-app browser tries to open a new window. */
  onBrowserNewTab(listener: (url: string, options: { background: boolean }) => void): () => void
  popOutBrowser(url: string): Promise<boolean>
  clearBrowserData(): Promise<void>
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
  getAuthState(): Promise<AuthState>
  /** Opens the system browser to sign in; resolves once it is waiting for the browser. */
  signIn(): Promise<AuthState>
  cancelSignIn(): Promise<void>
  signOut(): Promise<void>
  onAuthState(listener: (state: AuthState) => void): () => void
}
