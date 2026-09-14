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
  createdAt: number
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
}

export type SettingsUpdate = Partial<Omit<Settings, 'hasApiKey'>> & {
  /** Empty string clears the stored key. */
  apiKey?: string
}

export interface ModelInfo {
  id: string
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
}

export interface ChatRequest {
  requestId: string
  model: string
  persona: string
  /** Overrides the saved reasoning effort (Fast and Reasoning modes). */
  reasoningEffort?: ReasoningEffort
  /** Full history, ending with the new user message. */
  messages: ChatMessage[]
  /** Search the web for the latest user message and give the model the results. */
  webSearch?: boolean
}

export type StreamEvent =
  | { type: 'start'; model: string }
  | { type: 'delta'; content?: string; reasoning?: string }
  | { type: 'status'; message: string }
  | { type: 'image'; url: string; prompt: string; seed: number }
  | { type: 'done'; model: string; truncated: boolean }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

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
  onBrowserNewTab(listener: (url: string) => void): () => void
  popOutBrowser(url: string): Promise<boolean>
  clearBrowserData(): Promise<void>
  /** Predicts the user's next message and follow-ups for the latest assistant reply. */
  suggestFollowups(messages: { role: Role; content: string }[]): Promise<FollowupSuggestions>
  /** A short AI-written chat title for a first message, or null if one couldn't be made. */
  generateTitle(prompt: string): Promise<string | null>
  /** Completes a half-typed message using the chat for context; the result always starts with the draft, or is null. */
  completeDraft(draft: string, messages: { role: Role; content: string }[]): Promise<string | null>
}
