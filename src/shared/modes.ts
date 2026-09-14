import type { ChatMode, ReasoningEffort } from './types'
import { DEFAULT_MODEL } from './models'

export interface ModeInfo {
  id: ChatMode
  label: string
  description: string
  /** Fixed model for this mode; Customize uses the conversation's chosen model. */
  model?: string
  reasoningEffort?: ReasoningEffort
}

export const MODES: ModeInfo[] = [
  { id: 'auto', label: 'Auto', model: DEFAULT_MODEL, description: 'ORION Core — balanced & capable' },
  { id: 'custom', label: 'Customize', description: 'Choose a model' }
]

export function modeInfo(id: ChatMode | undefined): ModeInfo {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}

export function newChatMode(defaultModel: string): { mode: ChatMode; model: string } {
  return defaultModel === DEFAULT_MODEL ? { mode: 'auto', model: DEFAULT_MODEL } : { mode: 'custom', model: defaultModel }
}
