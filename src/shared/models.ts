import type { ModelInfo } from './types'

/**
 * Groq chat models, each checked with a live streamed completion. Speech, text-to-speech and
 * prompt-guard models are left out because they can't answer chat requests. First entry is the default.
 *
 * `inputTokenLimit` follows Groq's free tier, measured September 2026: 8,000 tokens per minute for the
 * gpt-oss models (prompt plus output budget), 7,000 input tokens per minute for the Qwen models.
 * ORION Pro used Qwen 3.6, which Groq retired in September 2026. It is now the quick variant of its successor,
 * Qwen 3.8 (also behind ORION Ultra): the same model with thinking turned off (`disableReasoning`), so it answers fast.
 * Qwen 3.8 allows 8,000 tokens per minute, so Pro no longer needs a reduced reply budget.
 *
 * ORION Apex and Apex Mini used Groq Compound and Compound Mini, which Groq is retiring on 21 September 2026
 * (their own deprecation notice). Groq never offered a successor with the same built-in web search and code
 * execution, so there is nothing to swap them for — they are removed rather than pointed at a model that cannot
 * do what they did. Orbis's own Search and Browser Control already cover web lookups and running things, without
 * depending on a single Groq model to survive.
 */
export const MODELS: ModelInfo[] = [
  { id: 'openai/gpt-oss-20b', label: 'ORION Core', description: 'Fast and balanced for everyday chats', reasoningEffort: true, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 6000 },
  { id: 'openai/gpt-oss-120b', label: 'ORION Max', description: 'Most capable, with deeper reasoning', reasoningEffort: true, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 6000 },
  { id: 'qwen/qwen3.8-27b', label: 'ORION Ultra', description: 'Strong writing and analysis', reasoningEffort: false, echoReasoning: false, contextWindow: 131042, inputTokenLimit: 6000 },
  { id: 'orion/pro', apiModel: 'qwen/qwen3.8-27b', label: 'ORION Pro', description: 'Quick, well-structured answers', reasoningEffort: false, echoReasoning: false, contextWindow: 131042, inputTokenLimit: 6000, disableReasoning: true },
  { id: 'openai/gpt-oss-safeguard-20b', label: 'ORION Shield', description: 'Safety-focused reasoning', reasoningEffort: false, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 6000 },
  { id: 'allam-2-7b', label: 'ORION Mini', description: 'Lightweight, for short chats (English and Arabic)', reasoningEffort: false, echoReasoning: false, contextWindow: 4096 },
  // Not a Groq model: resolved to one of the models above for each message (shared/modelRoute.ts), never sent to Groq.
  { id: 'orion/auto', label: 'ORION Auto', description: 'Picks the right Orion for each message', reasoningEffort: true, echoReasoning: false, contextWindow: 131072, inputTokenLimit: 6000 }
]

export const DEFAULT_MODEL = MODELS[0].id

/** Models Groq retired, and the Orbis model that took their place, so saved chats and settings carry over. */
const RETIRED_MODELS: Record<string, string> = {
  'qwen/qwen3.6-27b': 'orion/pro',
  // Compound and Compound Mini: retired 21 September 2026, with no equivalent successor. A saved chat that used
  // them moves to Orbis's most capable general model rather than being left pointing at nothing.
  'groq/compound': 'openai/gpt-oss-120b',
  'groq/compound-mini': 'openai/gpt-oss-20b'
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
