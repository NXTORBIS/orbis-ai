import type { ChatMessage, ReasoningEffort, StreamEvent } from '../shared/types'
import { currentModelId, DEFAULT_MODEL, MODELS } from '../shared/models.ts'
import { resolveModel } from '../shared/modelRoute.ts'
import { streamChat } from '../main/nim.ts'
import { generateWithContinuation } from '../main/longGeneration.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * The channels the helper answers.
 *
 * Each is the same thing Electron Orbis answers on `ipcMain`, run by the same code — nim.ts, longGeneration.ts and the
 * rest are already free of Electron — so a fix to one is a fix to both. This is the skeleton: the first real channels,
 * enough to prove the whole path (panel → token → helper → Orion → streamed answer) before the rest are moved over
 * one at a time.
 */

export interface HandlerDeps {
  /** The person's own Groq keys, given to the helper when it starts and never sent back to the panel. */
  apiKeys: string[]
  /** Overridable so tests never reach the network. */
  fetchFn?: typeof fetch
  version?: string
}

const ROLES = new Set(['user', 'assistant'])
const MAX_MESSAGES = 200
const MAX_CONTENT = 400_000
const EFFORTS = new Set<ReasoningEffort>(['low', 'high', 'max'])

/** A conversation from the panel, checked: the panel is trusted with the token, not with the shape of what it sends. */
function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) throw new HelperError('bad-request', 'Expected a conversation of 1 to 200 messages.')
  return value.map((raw, i): ChatMessage => {
    const m = raw as Partial<ChatMessage> | null
    if (!m || typeof m !== 'object' || !ROLES.has(m.role as string) || typeof m.content !== 'string' || m.content.length > MAX_CONTENT) {
      throw new HelperError('bad-request', `Message ${i + 1} is not a valid message.`)
    }
    return { id: typeof m.id === 'string' ? m.id.slice(0, 80) : `m${i}`, role: m.role as ChatMessage['role'], content: m.content, createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now() }
  })
}

export function createHandlers(deps: HandlerDeps): Record<string, Handler> {
  return {
    /** Whether the helper is there and the token works. Says nothing about the person's data. */
    'helper:ping': () => ({ ok: true, version: deps.version ?? 'dev', hasApiKey: deps.apiKeys.length > 0 }),

    /** The models Orion can use, from the one list Electron Orbis uses too, so the two can never disagree. */
    'models:list': () => ({ default: DEFAULT_MODEL, models: MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description })) }),

    /**
     * Ask Orion. Streams the same events the Electron window receives (`start`, `delta`, `done`…) and ends with the
     * model that answered. A long request continues past one call's output limit exactly as it does in Electron.
     */
    'chat:send': async ([request], { emit, signal }) => {
      const req = (request ?? {}) as { model?: unknown; messages?: unknown; systemPrompt?: unknown; reasoningEffort?: unknown }
      if (deps.apiKeys.length === 0) throw new HelperError('no-key', 'The helper has no Groq API key.')
      const messages = readMessages(req.messages)
      const last = messages[messages.length - 1]
      if (last.role !== 'user') throw new HelperError('bad-request', 'The last message must be from the person.')

      const requested = currentModelId(typeof req.model === 'string' ? req.model : undefined)
      const route = resolveModel(requested, { text: last.content, attachmentChars: 0, turns: messages.length })
      const effort = EFFORTS.has(req.reasoningEffort as ReasoningEffort) ? (req.reasoningEffort as ReasoningEffort) : 'high'
      const systemPrompt = typeof req.systemPrompt === 'string' ? req.systemPrompt.slice(0, 20_000) : ''

      await generateWithContinuation({
        messages,
        emit: (event: StreamEvent) => emit(event),
        signal,
        runSegment: (segmentMessages, segmentEmit) =>
          streamChat({
            apiKeys: deps.apiKeys,
            model: route.model,
            messages: segmentMessages,
            systemPrompt,
            reasoningEffort: effort,
            autoFallback: true,
            signal,
            emit: segmentEmit,
            fetchFn: (url, init) => (deps.fetchFn ?? fetch)(url, init)
          })
      })
      return { model: route.model }
    }
  }
}
