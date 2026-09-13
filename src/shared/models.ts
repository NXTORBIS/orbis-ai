import type { ModelInfo } from './types'

export const MODELS: ModelInfo[] = [
  {
    id: 'orion-local',
    label: 'ORION',
    description: 'Your AI system running locally on this computer.',
    reasoningEffort: false,
    echoReasoning: false,
    provider: 'orion'
  }
]

export const DEFAULT_MODEL = MODELS[0].id

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? { id, label: id, description: '', reasoningEffort: false, echoReasoning: false }
}

export function modelLabel(id: string): string {
  return modelInfo(id).label
}

export function isLocalModel(id: string): boolean {
  return modelInfo(id).provider === 'orion'
}

/** Models served by NIM (all NVIDIA models have been removed; only ORION remains). */
export const NIM_MODELS: ModelInfo[] = []
