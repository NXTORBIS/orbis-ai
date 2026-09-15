import type { ModelInfo } from './types'

/**
 * Groq chat models, each checked with a live streamed completion. Speech, text-to-speech and
 * prompt-guard models are left out because they can't answer chat requests. First entry is the default.
 *
 * `inputTokenLimit` follows Groq's free tier, measured September 2026: 8,000 tokens per minute for the
 * gpt-oss models (prompt plus output budget), 7,000 input tokens per minute for the Qwen models, and
 * 70,000 per minute for Compound, whose own web results also have to fit, so its history is kept short.
 * ORION Pro used Qwen 3.6, which Groq retired in September 2026. It is now the quick variant of its successor,
 * Qwen 3.8 (also behind ORION Ultra): the same model with thinking turned off (`disableReasoning`), so it answers fast.
 * Qwen 3.8 allows 8,000 tokens per minute, so Pro no longer needs a reduced reply budget.
 */
export const MODELS: ModelInfo[] = [
  { id: 'openai/gpt-oss-20b', label: 'ORION Core', description: 'Fast and balanced for everyday chats', reasoningEffort: true, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 6000 },
  { id: 'openai/gpt-oss-120b', label: 'ORION Max', description: 'Most capable, with deeper reasoning', reasoningEffort: true, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 6000 },
  { id: 'qwen/qwen3.8-27b', label: 'ORION Ultra', description: 'Strong writing and analysis', reasoningEffort: false, echoReasoning: false, contextWindow: 131042, inputTokenLimit: 6000 },
  { id: 'orion/pro', apiModel: 'qwen/qwen3.8-27b', label: 'ORION Pro', description: 'Quick, well-structured answers', reasoningEffort: false, echoReasoning: false, contextWindow: 131042, inputTokenLimit: 6000, disableReasoning: true },
  { id: 'groq/compound', label: 'ORION Apex', description: 'Can search the web and run code', reasoningEffort: false, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 4000 },
  { id: 'groq/compound-mini', label: 'ORION Apex Mini', description: 'Quicker web search and code', reasoningEffort: false, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 4000 },
  { id: 'openai/gpt-oss-safeguard-20b', label: 'ORION Shield', description: 'Safety-focused reasoning', reasoningEffort: false, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 6000 },
  { id: 'allam-2-7b', label: 'ORION Mini', description: 'Lightweight, for short chats (English and Arabic)', reasoningEffort: false, echoReasoning: false, contextWindow: 4096 }
]

export const DEFAULT_MODEL = MODELS[0].id

/** Models Groq retired, and the Orbis model that took their place, so saved chats and settings carry over. */
const RETIRED_MODELS: Record<string, string> = {
  'qwen/qwen3.6-27b': 'orion/pro'
}

export function isKnownModel(id: string): boolean {
  return MODELS.some((m) => m.id === id)
}

/** A stored model id brought up to date: retired models become their replacement; unknown ids become the default. */
export function currentModelId(id: string | undefined): string {
  if (id && isKnownModel(id)) return id
  return (id && RETIRED_MODELS[id]) || DEFAULT_MODEL
}

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => m.id === (RETIRED_MODELS[id] ?? id)) ?? { id, label: id, description: '', reasoningEffort: false, echoReasoning: false, contextWindow: 8192 }
}

export function modelLabel(id: string): string {
  return modelInfo(id).label
}
