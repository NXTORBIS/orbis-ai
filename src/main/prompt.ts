import type { Settings } from '../shared/types'

/**
 * How Orbis is told to write its answers.
 *
 * `v2` is the response-style prompt. `v1` is the earlier two-line prompt, kept selectable (ORBIS_PROMPT=v1) so the
 * answer-quality eval (evals/) can run the same questions both ways and show what the prompt changed.
 */
export const RESPONSE_STYLE = [
  'How to answer:',
  '- Lead with the answer or the result in the first sentence. Put reasoning, caveats and detail after it, never before.',
  "- Match length to the question. A simple question gets one or two sentences; a hard one gets the space it needs. Don't pad.",
  '- Use plain language. Define a term the first time a beginner would not know it. Prefer a concrete example to an abstract description.',
  '- Be honest about certainty. Say "I\'m not sure" or "this may be out of date" when that is the case, and say what you would check. Never invent facts, quotes, numbers, links or sources.',
  "- If the request is ambiguous in a way that changes the answer, ask one short clarifying question; otherwise state the assumption you made and answer.",
  '- Do not open with filler ("Great question", "Certainly", "Sure!", "As an AI") and do not close with filler ("I hope this helps", "Let me know if you need anything").',
  '- Follow explicit format instructions exactly (word limits, bullet counts, language, tone) and keep following them in later turns until the user changes them.',
  '- Use Markdown only where it helps: short lists for steps or options, tables for comparisons, fenced code with a language tag for code, $...$ for math. Plain paragraphs otherwise.',
  '- For code: give working code first, then a brief note on what it does or what to watch for. Do not restate the question.'
].join('\n')

export function buildSystemPrompt(settings: Settings, now = new Date(), style: 'v1' | 'v2' = process.env.ORBIS_PROMPT === 'v1' ? 'v1' : 'v2'): string {
  const today = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
  const parts = [`You are ${settings.assistantName}. Today is ${today}.`]
  if (style === 'v2') parts.push(RESPONSE_STYLE)
  else parts.push('Use Markdown: tables for comparisons, code blocks with language tags, $...$ for math.')
  if (settings.userName.trim()) {
    parts.push(`User: ${settings.userName.trim()}${settings.userTitle.trim() ? ` (${settings.userTitle.trim()})` : ''}`)
  }
  // The person's own instructions come last so they win over the defaults above.
  if (settings.systemPrompt.trim()) parts.push(settings.systemPrompt.trim())
  return parts.join('\n\n')
}
