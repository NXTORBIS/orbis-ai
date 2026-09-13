import type { ModelInfo } from './types'

export const MODELS: ModelInfo[] = [
  {
    id: 'orion-99-plus-int8',
    label: 'ORION 99%+ (INT8)',
    description: 'ORION 99%+ Superintelligence - 2.7ms inference, 99.01% blended accuracy',
    reasoningEffort: false,
    echoReasoning: false,
    provider: 'orion'
  },
  {
    id: 'orion-99-plus-fp16',
    label: 'ORION 99%+ (FP16)',
    description: 'ORION 99%+ Superintelligence - 50ms inference, balanced performance',
    reasoningEffort: false,
    echoReasoning: false,
    provider: 'orion'
  },
  {
    id: 'orion-99-plus-full',
    label: 'ORION 99%+ (Full Precision)',
    description: 'ORION 99%+ Superintelligence - maximum precision, highest quality',
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
