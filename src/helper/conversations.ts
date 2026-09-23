import { Store } from '../main/store.ts'
import { currentModelId } from '../shared/models.ts'
import type { Attachment, ChatMessage, Conversation } from '../shared/types'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Chats, for the built-in panel.
 *
 * The helper already answers `chat:send`, so the panel could hold a conversation — but only one, and only until the page
 * was closed. What it could not do is what makes a chat a chat: a list of the earlier ones, opening any of them again, and
 * a reply being added to the one it belongs to. This is that, over the very store the Orbis window keeps its chats in — the
 * same folder, same files, same profile — so a chat started in either place is the same chat in the other.
 *
 * What arrives here came from a page, so it is checked before it is written: a chat is only ever saved as the shape a chat
 * has, within sizes a real one stays inside. An incognito chat is refused outright — it is the one kind that is never
 * written down, and honouring that here matters more than being lenient.
 */

export interface ConversationsDeps {
  /** The app's own store when the helper runs inside Orbis; otherwise the helper opens the same folder itself. */
  store?: () => Pick<Store, 'listConversations' | 'saveConversation' | 'deleteConversation'> | null | undefined
  userData?: string
  profileId?: string
}

const MAX_MESSAGES = 2000
const MAX_CONTENT = 200_000
const MAX_TITLE = 300
const MAX_ATTACHMENTS = 20
const ID = /^[A-Za-z0-9_-]{1,64}$/
const ROLES = new Set(['user', 'assistant', 'system'])

const bad = (why: string): never => {
  throw new HelperError('bad-request', why)
}

const text = (value: unknown, limit: number, what: string): string => {
  if (typeof value !== 'string') bad(`${what} is missing.`)
  const s = value as string
  return s.length > limit ? bad(`${what} is too long.`) : s
}

/** Only the parts of a message that belong to a chat, and only in the shapes they really take. */
function readMessage(value: unknown): ChatMessage {
  if (!value || typeof value !== 'object') bad('A message is not a message.')
  const m = value as Record<string, unknown>
  if (!ID.test(String(m.id ?? ''))) bad('A message has no usable id.')
  if (!ROLES.has(String(m.role))) bad('A message has no usable role.')
  const message: ChatMessage = {
    id: String(m.id),
    role: m.role as ChatMessage['role'],
    content: text(m.content ?? '', MAX_CONTENT, 'A message'),
    createdAt: typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) ? m.createdAt : Date.now()
  }
  if (typeof m.reasoning === 'string') message.reasoning = m.reasoning.slice(0, MAX_CONTENT)
  if (typeof m.reasoningMs === 'number' && Number.isFinite(m.reasoningMs)) message.reasoningMs = m.reasoningMs
  if (typeof m.model === 'string') message.model = currentModelId(m.model)
  if (typeof m.error === 'string') message.error = m.error.slice(0, 2000)
  if (m.feedback === 'up' || m.feedback === 'down') message.feedback = m.feedback
  if (m.browserTask === true) message.browserTask = true
  if (Array.isArray(m.suggestions)) message.suggestions = m.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 6)
  if (Array.isArray(m.attachments)) {
    message.attachments = m.attachments.slice(0, MAX_ATTACHMENTS).map((a): Attachment => {
      const att = (a ?? {}) as Record<string, unknown>
      const attachment: Attachment = { name: text(att.name ?? '', 300, 'An attachment name'), content: text(att.content ?? '', MAX_CONTENT, 'An attachment') }
      if (att.type === 'text' || att.type === 'image') attachment.type = att.type
      if (typeof att.mimeType === 'string') attachment.mimeType = att.mimeType.slice(0, 200)
      return attachment
    })
  }
  return message
}

function readConversation(value: unknown): Conversation {
  if (!value || typeof value !== 'object') bad('That is not a chat.')
  const c = value as Record<string, unknown>
  if (!ID.test(String(c.id ?? ''))) bad('The chat has no usable id.')
  // The one kind that is never written down. Saving it because a page asked would quietly break the promise its name makes.
  if (c.incognito === true) bad('An incognito chat is not saved.')
  const messages = Array.isArray(c.messages) ? c.messages : bad('The chat has no messages.')
  if (messages.length > MAX_MESSAGES) bad('The chat is too long to save.')
  const at = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : Date.now())
  return {
    id: String(c.id),
    title: text(c.title ?? '', MAX_TITLE, 'The title'),
    model: currentModelId(typeof c.model === 'string' ? c.model : ''),
    ...(c.pinned === true ? { pinned: true } : {}),
    messages: messages.map(readMessage),
    createdAt: at(c.createdAt),
    updatedAt: at(c.updatedAt)
  }
}

/** A chat as a list shows it: enough to recognise and choose, without carrying every message to draw a row. */
function summarise(c: Conversation): Record<string, unknown> {
  const last = [...c.messages].reverse().find((m) => m.content.trim())
  return {
    id: c.id,
    title: c.title,
    model: c.model,
    pinned: c.pinned === true,
    messages: c.messages.length,
    preview: (last?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }
}

export function createConversationHandlers(deps: ConversationsDeps): Record<string, Handler> {
  let own: Store | null = null
  const store = () => {
    const shared = deps.store?.()
    if (shared) return shared
    if (!deps.userData) return null
    if (!own) {
      own = new Store(deps.userData)
      if (deps.profileId) own.useProfile(deps.profileId)
    }
    return own
  }
  const need = () => store() ?? bad('There is nowhere to keep chats on this computer.')

  return {
    /** Every chat, newest first, as much of each as a list needs. */
    'conversations:list': async () => (await need().listConversations()).map(summarise),

    /** One chat, whole, to open it again. */
    'conversations:get': async ([id]) => {
      const wanted = String(id ?? '')
      if (!ID.test(wanted)) bad('That is not a chat id.')
      return (await need().listConversations()).find((c) => c.id === wanted) ?? null
    },

    /** Saves a chat as it now stands. The same file the Orbis window reads, so the two never diverge. */
    'conversations:save': async ([conversation]) => {
      const checked = readConversation(conversation)
      await need().saveConversation(checked)
      return summarise(checked)
    },

    'conversations:remove': async ([id]) => {
      const wanted = String(id ?? '')
      if (!ID.test(wanted)) bad('That is not a chat id.')
      await need().deleteConversation(wanted)
      return { ok: true }
    }
  }
}
