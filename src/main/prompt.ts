import type { Settings } from '../shared/types'

export function buildSystemPrompt(settings: Settings, now = new Date()): string {
  const today = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
  const parts = [
    `You are ${settings.assistantName}. Today is ${today}.`,
    'Use Markdown: tables for comparisons, code blocks with language tags, $...$ for math.'
  ]
  if (settings.userName.trim()) {
    parts.push(`User: ${settings.userName.trim()}${settings.userTitle.trim() ? ` (${settings.userTitle.trim()})` : ''}`)
  }
  if (settings.systemPrompt.trim()) parts.push(settings.systemPrompt.trim())
  return parts.join('\n\n')
}
