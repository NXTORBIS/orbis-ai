/** ORION API request/response types and IPC types. */

export type OrionState = 'stopped' | 'starting' | 'loading' | 'ready' | 'busy' | 'stopping' | 'crashed' | 'failed' | 'error'

export interface OrionStatus {
  state: OrionState
  uptime: number
  pid?: number
  memory?: {
    used: number
    available: number
  }
  error?: string
}

export interface HealthResponse {
  status: 'ok' | 'error'
  backends: Record<string, 'ready' | 'loading' | 'error' | 'unavailable'>
  uptime?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  session?: string
  max_tokens?: number
  temperature?: number
}

export interface ChatResponse {
  id: string
  model: string
  choices: Array<{
    message: { role: string; content: string }
    finish_reason: string | null
  }>
  orion?: {
    trace_id: string
    intent: string
    expert: string
    tools_used: string[]
    citations: string[]
    verified?: boolean
  }
}

export interface VisionRequest {
  image: string // base64-encoded image
  prompt: string
  session?: string
  max_tokens?: number
}

export interface VisionResponse {
  description: string
  objects?: string[]
  text?: string // OCR result
  confidence?: number
}

export interface GenerateRequest {
  prompt: string
  negative_prompt?: string
  steps?: number
  guidance_scale?: number
  seed?: number
  width?: number
  height?: number
}

export interface GenerateResponse {
  image: string // base64-encoded PNG
  seed: number
}

export interface ModelsResponse {
  data: Array<{
    id: string
    backend: string
  }>
}

export interface OrionError extends Error {
  code?: string
  statusCode?: number
  path?: string
}

export interface ProcessInfo {
  pid: number
  uptime: number
  memory: number // bytes
  rss: number // resident set size
}
