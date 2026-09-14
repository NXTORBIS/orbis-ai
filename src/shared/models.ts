import type { ModelInfo } from './types'

/** ORION models (Groq production, console.groq.com/docs/models). First entry is the default. */
export const MODELS: ModelInfo[] = [
  {
    id: 'meta-llama/llama-prompt-guard-2-22m',
    label: 'ORION Nano',
    description: 'Safety / lightweight',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'allam-2-7b',
    label: 'ORION Mini',
    description: 'Lightweight general',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'ORION Core',
    description: 'Balanced',
    reasoningEffort: true,
    echoReasoning: false
  },
  {
    id: 'qwen/qwen3.6-27b',
    label: 'ORION Pro',
    description: 'Advanced',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'qwen/qwen3.8-27b',
    label: 'ORION Ultra',
    description: 'More advanced',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'ORION Max',
    description: 'Highest-capability general model',
    reasoningEffort: true,
    echoReasoning: false
  },
  {
    id: 'groq/compound',
    label: 'ORION Apex',
    description: 'Advanced compound/tool-use',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'groq/compound-mini',
    label: 'ORION Apex Mini',
    description: 'Faster compound/tool-use',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'openai/gpt-oss-safeguard-20b',
    label: 'ORION Shield',
    description: 'Safety',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'meta-llama/llama-prompt-guard-2-86m',
    label: 'ORION Guard',
    description: 'Prompt security',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'whisper-large-v3',
    label: 'ORION Listen',
    description: 'Speech → text',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'whisper-large-v3-turbo',
    label: 'ORION Listen Turbo',
    description: 'Fast speech → text',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'canopylabs/orpheus-v1-english',
    label: 'ORION Voice',
    description: 'English text → speech',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'canopylabs/orpheus-arabic-saudi',
    label: 'ORION Voice Arabic',
    description: 'Arabic text → speech',
    reasoningEffort: false,
    echoReasoning: false
  },
  {
    id: 'llava-1.5-7b-hf',
    label: 'ORION Vision',
    description: 'Image analysis & understanding',
    reasoningEffort: false,
    echoReasoning: false
  }
]

export const DEFAULT_MODEL = MODELS[2].id // ORION Core - balanced model for Auto mode

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? { id, label: id, description: '', reasoningEffort: false, echoReasoning: false }
}

export function modelLabel(id: string): string {
  return modelInfo(id).label
}
