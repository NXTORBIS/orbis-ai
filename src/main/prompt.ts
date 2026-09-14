import type { Settings } from '../shared/types'
import { personaInfo } from '../shared/personas'

export function buildSystemPrompt(settings: Settings, personaId: string, now = new Date()): string {
  const today = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
  const parts = [
    `You are ${settings.assistantName}. Today is ${today}.`,
    'Use Markdown: tables for comparisons, code blocks with language tags, $...$ for math.'
  ]
  if (settings.userName.trim()) {
    parts.push(`User: ${settings.userName.trim()}${settings.userTitle.trim() ? ` (${settings.userTitle.trim()})` : ''}`)
  }
  const persona = personaInfo(personaId)
  if (persona.prompt) parts.push(persona.prompt)
  if (settings.systemPrompt.trim()) parts.push(settings.systemPrompt.trim())
  return parts.join('\n\n')
}
