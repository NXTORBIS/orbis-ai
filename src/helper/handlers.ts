import type { ChatMessage, ReasoningEffort, StreamEvent } from '../shared/types'
import { currentModelId, DEFAULT_MODEL, MODELS } from '../shared/models.ts'
import { resolveModel } from '../shared/modelRoute.ts'
import { streamChat } from '../main/nim.ts'
import { generateWithContinuation } from '../main/longGeneration.ts'
import { runSearch } from '../main/search.ts'
import { endpointFromEnvironment, SearxngProvider } from '../main/search/specialized.ts'
import { answerContext, runResearch } from '../main/research.ts'
import { isSpecialized } from '../shared/searchProviders.ts'
import type { Research } from '../shared/types'
import { createAdblockHandlers } from './adblock/service.ts'
import { createPersonalHandlers } from './personal.ts'
import { createSecretsHandlers } from './secrets.ts'
import type { SecretsDeps } from './secrets.ts'
import { createWorkflowHandlers } from './workflows.ts'
import type { WorkflowsDeps } from './workflows.ts'
import { createSearchSessionHandlers } from './searchSessions.ts'
import type { SearchSessionsDeps } from './searchSessions.ts'
import { createGalaxyHandlers } from './galaxy.ts'
import type { GalaxyDeps } from './galaxy.ts'
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
  /** Where the extension and the filter lists live, when the helper manages the ad blocker's lists. */
  /** This profile's own data folder for notes and tasks; without it those channels do not exist. */
  dataDir?: string
  /**
   * The app's own vault, workflow engine and Galaxy, when the helper runs inside Orbis. Each is read at call time (they may come
   * into being after the helper does); returning null answers the panel with "not ready". Without them those channels do not exist.
   */
  secrets?: () => SecretsDeps | null | undefined
  workflows?: () => WorkflowsDeps | null | undefined
  galaxy?: () => GalaxyDeps | null | undefined
  /** Saved Orion Search sessions: the app's own store when given, else the helper opens the same database under dataDir. */
  searchSessions?: SearchSessionsDeps['store']
  profileId?: string
  adblock?: { extensionDir: string; listsDir: string; bundledDir: string }
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
  const doFetch = (url: string, init?: RequestInit): Promise<Response> => (deps.fetchFn ?? fetch)(url, init)
  // Orbis Search is two providers: ordinary web search, and a specialized one for every other category. Neither can
  // break the other — a category that cannot be reached says so and web search carries on.
  const specialized = new SearxngProvider({ endpoint: endpointFromEnvironment(), fetchFn: doFetch })

  return {
    ...createSearchSessionHandlers({ store: deps.searchSessions, userData: deps.dataDir, profileId: deps.profileId, apiKeys: deps.apiKeys, fetchFn: doFetch }),
    ...(deps.dataDir ? createPersonalHandlers({ dataDir: deps.dataDir }) : {}),
    ...(deps.secrets ? createSecretsHandlers(deps.secrets) : {}),
    ...(deps.workflows ? createWorkflowHandlers(deps.workflows) : {}),
    ...(deps.galaxy ? createGalaxyHandlers(deps.galaxy) : {}),
    ...(deps.adblock ? createAdblockHandlers({ ...deps.adblock, fetchFn: doFetch }) : {}),
    /** Whether the helper is there and the token works. Says nothing about the person's data. */
    'helper:ping': () => ({ ok: true, version: deps.version ?? 'dev', hasApiKey: deps.apiKeys.length > 0 }),

    /** The models Orion can use, from the one list Electron Orbis uses too, so the two can never disagree. */
    'models:list': () => ({ default: DEFAULT_MODEL, models: MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description })) }),

    /** Orbis Search: the same two providers Electron Orbis uses, for the category the person picked. */
    'search:run': async ([query, vertical], { signal }) => {
      const words = typeof query === 'string' ? query.slice(0, 300) : ''
      const asked = typeof vertical === 'string' ? vertical : 'all'
      if (isSpecialized(asked as never)) return specialized.search(asked as never, words)
      return runSearch({ query: words, vertical: 'all', fetchFn: doFetch, signal })
    },
    'search:specialized-health': () => specialized.check(),

    /**
     * Ask Orion. Streams the same events the Electron window receives (`start`, `delta`, `done`…) and ends with the
     * model that answered. A long request continues past one call's output limit exactly as it does in Electron.
     */
    'chat:send': async ([request], { emit, signal }) => {
      const req = (request ?? {}) as { model?: unknown; messages?: unknown; systemPrompt?: unknown; reasoningEffort?: unknown; webSearch?: unknown }
      if (deps.apiKeys.length === 0) throw new HelperError('no-key', 'The helper has no Groq API key.')
      const messages = readMessages(req.messages)
      const last = messages[messages.length - 1]
      if (last.role !== 'user') throw new HelperError('bad-request', 'The last message must be from the person.')

      // With web search on, Orion answers from real pages, read now, and says which page each claim came from. The
      // sources go to the panel first, so it can show them while the answer streams.
      let conversation = messages
      if (req.webSearch === true) {
        const research: Research = await runResearch({
          question: last.content,
          queries: [last.content.trim().slice(0, 200)],
          recency: 'any',
          fetchFn: doFetch,
          signal,
          onStatus: (message) => emit({ type: 'status', message })
        })
        if (signal.aborted) return { model: null, aborted: true }
        if (research.sources.length) {
          emit({ type: 'research', research })
          const context = answerContext({ research, earlier: undefined, browser: undefined, onScreen: undefined, pageText: null, includePage: false })
          // Kept inside the person's own message, so the sources sit right next to the question they answer.
          conversation = [...messages.slice(0, -1), { ...last, content: `${context}\n\nQuestion: ${last.content}` }]
        } else {
          emit({ type: 'status', message: `Couldn't get current sources: ${research.problem ?? 'nothing usable was found'}. Answering without them.` })
        }
      }

      const requested = currentModelId(typeof req.model === 'string' ? req.model : undefined)
      const route = resolveModel(requested, { text: last.content, attachmentChars: 0, turns: messages.length })
      const effort = EFFORTS.has(req.reasoningEffort as ReasoningEffort) ? (req.reasoningEffort as ReasoningEffort) : 'high'
      const systemPrompt = typeof req.systemPrompt === 'string' ? req.systemPrompt.slice(0, 20_000) : ''

      await generateWithContinuation({
        messages: conversation,
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
