import type { Settings } from '../shared/types'
import { personaInfo } from '../shared/personas'

export function buildSystemPrompt(settings: Settings, personaId: string, now = new Date()): string {
  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const parts = [
    `You are ${settings.assistantName}, an advanced AI assistant inside the Orbis desktop app. Today is ${today}.`,
    'Format replies in Markdown. Use tables for structured comparisons, fenced code blocks with a language tag for code, and $...$ or $$...$$ for math.'
  ]
  if (settings.userName.trim()) {
    const title = settings.userTitle.trim()
    parts.push(`The user's name is ${settings.userName.trim()}.${title ? ` Address them as "${title}" when greeting them.` : ''}`)
  }
  const persona = personaInfo(personaId)
  if (persona.prompt) parts.push(persona.prompt)
  if (settings.systemPrompt.trim()) parts.push(`The user's custom instructions:\n${settings.systemPrompt.trim()}`)
  return parts.join('\n\n')
}
