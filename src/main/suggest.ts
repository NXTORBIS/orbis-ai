import type { FollowupSuggestions } from '../shared/types'
import { GROQ_BASE_URL } from './nim.ts'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const FOLLOWUP_INSTRUCTIONS = [
  'You predict what a user will type next in a chat with the AI assistant Orbis.',
  'Read the conversation and reply with JSON only, shaped {"next": string | null, "followups": string[]}.',
  '"next" is the single message the user is most likely to send next, written in their own voice and language, at most 12 words.',
  'Set "next" to null unless the last reply clearly invites one obvious continuation: it asked the user a question, offered choices, or left a task half done. Never guess generic filler.',
  '"followups" is exactly 3 distinct, specific messages the user might send next, each at most 8 words and grounded in the last reply. No generic prompts such as "Tell me more" or "Thanks".',
  'Every message is the user speaking to Orbis, never Orbis speaking.'
].join(' ')

const TITLE_INSTRUCTIONS = [
  'You name chats. Given the first message a user sent to the AI assistant Orbis, write a short title for the conversation.',
  'Reply with JSON only, shaped {"title": string}.',
  'The title is 2 to 6 words, captures the specific topic or task, and uses the same language as the message.',
  'Use Title Case for English; for other languages capitalize only the first word and proper nouns.',
  'No quotes, emojis, or trailing punctuation. Do not start with words like "Chat about", "Question on" or "Help with".'
].join(' ')

const COMPLETE_INSTRUCTIONS = [
  'You are the autocomplete in the message box of the AI assistant Orbis. The user is mid-way through typing a message.',
  'Read the recent conversation (it may be empty) and the draft, work out what the user is actually asking for, and finish the message the way they most likely intend:',
  'a specific continuation, refinement, or the useful next part of the request, fitted to this topic and conversation.',
  'Reply with JSON only, shaped {"completion": string | null}.',
  '"completion" is the full message: it MUST start with the draft copied exactly, character for character, followed by your addition of 3 to 16 words.',
  'If the draft ends mid-word, finish that word first. Keep the user\'s voice, language and tone. Never answer the question and never write as Orbis.',
  'Avoid generic filler such as "please", "in detail" or "tell me more" unless nothing more specific fits.',
  'A draft that is already a complete request still gets a completion that makes it sharper, e.g. "Explain black holes" -> "Explain black holes in simple terms with an analogy."',
  'Set "completion" to null only when the draft is gibberish or too fragmentary to guess any intent.'
].join(' ')

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(data:image\/[^)]+\)/g

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
  return text && text.length <= maxLength ? text : null
}

/** Asks a fast Groq model for a JSON object, rotating keys on rate limits. Returns null on any failure. */
export async function requestJson(
  system: string,
  user: string,
  apiKeys: string[],
  fetchFn: FetchFn,
  timeoutMs = 15_000
): Promise<Record<string, unknown> | null> {
  // These helper calls are optional extras; bad input means "no answer", never a crash of the chat request.
  if (!Array.isArray(apiKeys) || typeof fetchFn !== 'function') return null
  for (const key of apiKeys) {
    let res: Response
    try {
      res = await fetchFn(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          reasoning_effort: 'low',
          max_completion_tokens: 800,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch {
      return null
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) continue
    if (!res.ok) {
      // A key whose organization Groq restricted fails every request; the next key can answer.
      if (/restricted/i.test(await res.text().catch(() => ''))) continue
      return null
    }
    try {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const parsed: unknown = JSON.parse(json.choices?.[0]?.message?.content ?? '')
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return null
}

/** Predicts the user's likely next message and a few follow-ups. Returns empty results on any failure. */
export async function suggestFollowups(messages: { role: string; content: string }[], apiKeys: string[], fetchFn: FetchFn): Promise<FollowupSuggestions> {
  const empty: FollowupSuggestions = { next: null, followups: [] }
  const recent = messages.slice(-6)
  if (!recent.length || recent.at(-1)?.role !== 'assistant') return empty
  const transcript = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Orbis'}: ${m.content.replace(IMAGE_MARKDOWN, '[generated image: $1]').slice(0, 1500)}`)
    .join('\n\n')
  const lastUser = [...recent].reverse().find((m) => m.role === 'user')?.content.trim().toLowerCase()

  const parsed = await requestJson(FOLLOWUP_INSTRUCTIONS, transcript, apiKeys, fetchFn)
  if (!parsed) return empty
  const seen = new Set<string>()
  const followups = (Array.isArray(parsed.followups) ? parsed.followups : [])
    .map((f) => clean(f, 80))
    .filter((f): f is string => {
      if (!f) return false
      const k = f.toLowerCase()
      if (seen.has(k) || k === lastUser) return false
      seen.add(k)
      return true
    })
    .slice(0, 3)
  const next = clean(parsed.next, 120)
  return { next: next && next.toLowerCase() !== lastUser ? next : null, followups }
}

/**
 * Completes the message the user is typing, using the conversation for context.
 * Returns the full message (always beginning with the draft exactly), or null when there's no useful completion.
 */
export async function completeDraft(
  draft: string,
  messages: { role: string; content: string }[],
  apiKeys: string[],
  fetchFn: FetchFn
): Promise<string | null> {
  if (draft.trim().length < 3 || draft.length > 600) return null
  const transcript = messages
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Orbis'}: ${m.content.replace(IMAGE_MARKDOWN, '[generated image: $1]').slice(0, 1200)}`)
    .join('\n\n')
  const parsed = await requestJson(
    COMPLETE_INSTRUCTIONS,
    `Conversation so far:\n${transcript || '(new chat)'}\n\nDraft: ${JSON.stringify(draft)}`,
    apiKeys,
    fetchFn
  )
  const raw = typeof parsed?.completion === 'string' ? parsed.completion.replace(/\s+/g, ' ') : ''
  if (!raw) return null
  // The ghost text can only extend what's typed, so anything that rewrites the draft is dropped.
  const typed = draft.replace(/\s+/g, ' ')
  if (!raw.toLowerCase().startsWith(typed.trimEnd().toLowerCase())) return null
  let rest = raw.slice(typed.trimEnd().length)
  if (typed.endsWith(' ')) rest = rest.replace(/^ /, '')
  rest = rest.replace(/^["'“”]+|["'“”]+$/g, '').trimEnd()
  if (rest.trim().length < 2 || rest.length > 160) return null
  return draft + rest
}

const PREDICT_INSTRUCTIONS = [
  'You power the address bar of the Orbis browser, a single box for web addresses and searches. The user is still typing.',
  'Reply with JSON only, shaped {"completions": string[]}.',
  'Give up to 4 distinct web searches the user most likely intends, most likely first. Each must begin with the typed text (finish a half-typed word first) and add a specific, useful ending, at most 10 words in total.',
  'Prefer popular, current and concrete intents over generic ones. Keep the user\'s language. No URLs, quotes, numbering or commentary, and never answer the query.',
  'Return an empty list when the text is gibberish.'
].join(' ')

/** Orion's guesses at the search being typed in the address bar. Returns an empty list on any failure. */
export async function predictQueries(input: string, apiKeys: string[], fetchFn: FetchFn): Promise<string[]> {
  const typed = input.replace(/\s+/g, ' ').trimStart()
  if (typed.trim().length < 3 || typed.length > 120) return []
  const parsed = await requestJson(PREDICT_INSTRUCTIONS, `Typed so far: ${JSON.stringify(typed)}`, apiKeys, fetchFn, 6_000)
  const seen = new Set([typed.trim().toLowerCase()])
  return (Array.isArray(parsed?.completions) ? parsed.completions : [])
    .map((c) => clean(c, 90))
    .filter((c): c is string => {
      if (!c || /^https?:\/\//i.test(c) || !c.toLowerCase().startsWith(typed.trim().toLowerCase().split(' ')[0])) return false
      const key = c.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 4)
}

/** A short AI-written title for a chat, based on its first message. Returns null on any failure. */
export async function generateTitle(prompt: string, apiKeys: string[], fetchFn: FetchFn): Promise<string | null> {
  const message = prompt.trim().slice(0, 2000)
  if (!message) return null
  const parsed = await requestJson(TITLE_INSTRUCTIONS, message, apiKeys, fetchFn)
  const title = clean(parsed?.title, 60)?.replace(/[.!?,;:]+$/, '')
  return title && title.split(' ').length <= 8 ? title : null
}
