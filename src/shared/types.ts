export type Role = 'user' | 'assistant'

export interface Attachment {
  name: string
  content: string
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
  createdAt: number
}

export type ChatMode = 'auto' | 'fast' | 'advanced' | 'reasoning' | 'custom'

export interface Conversation {
  id: string
  title: string
  model: string
  mode: ChatMode
  persona: string
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
  /** Animated particles and cursor glow. */
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
  | { type: 'done'; model: string; truncated: boolean }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

export interface PickedFiles {
  attachments: Attachment[]
  /** Files that were too large or not text. */
  skipped: string[]
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
}
