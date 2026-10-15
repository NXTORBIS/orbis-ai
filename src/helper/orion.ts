import { classifyIntent } from '../main/intent.ts'
import { detectImageCount, detectImageGenRequest, generateImages, rewriteImagePrompt } from '../main/imagegen.ts'
import { answerContext, runResearch } from '../main/research.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'
import type { BrowserHost } from './browser/host.ts'
import type { Research, StreamEvent } from '../shared/types'

/**
 * Asking Orbis something, and Orbis working out what was meant.
 *
 * The Orb had one way to ask -- plain chat -- so a request for a picture got a paragraph about pictures, and a question
 * about today got yesterday's training data. Everything needed to answer properly already existed: the same intent
 * classifier, image generator, research system and browser agent the Orbis app uses. What was missing was the routing.
 *
 *   "draw a black hole"            -> the image generator
 *   "what happened today"          -> research, with real sources
 *   "open youtube and search lofi" -> the browser agent, acting on the real browser
 *   "explain quantum entanglement" -> Orion, with the model Auto Mode picks
 *
 * None of these is a new system. This decides which of Orbis's own to use, and says which one it chose, so an answer
 * never arrives without it being clear where it came from.
 */

export interface OrionDeps {
  apiKeys: string[]
  fetchFn: typeof fetch
  /** The browser, for page context and for tasks. Null when Orbis is running without one. */
  host(): BrowserHost | null | undefined
  /** Runs a browser task; the same one browser:task uses, so there is one agent. */
  runTask(request: { task: string; history: { role: string; content: string }[] }, ctx: { emit(event: StreamEvent): void; signal: AbortSignal }): Promise<unknown>
  /** Plain chat, with Auto Mode already choosing the model (chat:send). */
  chat(request: Record<string, unknown>, ctx: { emit(event: StreamEvent): void; signal: AbortSignal }): Promise<unknown>
  /**
   * Everything relevant Orbis knows, assembled and budgeted by the Context Engine.
   *
   * Optional, because Orbis running without a browser has little to assemble and nothing here should require one. When
   * it is absent this falls back to describing the page by hand, which is what it did before the engine existed.
   */
  context?(request: { text: string }, signal: AbortSignal): Promise<{ text: string; summary: string }>
}

const NEWLINE = String.fromCharCode(10)
const MAX_ASK = 4000

/**
 * Questions about what something looks like, rather than what it says.
 *
 * In a browser the picture to look at is the page. So when somebody asks what is shown, Orbis takes the page as an
 * image and gives Orion that, instead of answering from the text and hoping they meant the same thing.
 */
const LOOKS_VISUAL = /\b(what (is|are) (shown|this|these)|look(s|ing)? like|in (this|the) (image|picture|photo|screenshot|diagram|chart|graph)|read (this|the) (chart|graph|diagram)|describe (this|the) (page|image|screen)|see (this|the)|colou?rs?|layout)\b/i

/** The page as an image, for a question about how it looks. Null when there is no page or the capture fails. */
async function pageImage(host: BrowserHost | null | undefined): Promise<string | null> {
  if (!host || !host.alive) return null
  try {
    const shot = (await host.control.execute({ capability: 'page.screenshot', params: {}, source: 'user' }, { confirm: async () => true })) as {
      ok: boolean
      data?: { dataUrl?: string; image?: string }
    }
    const data = shot.ok ? (shot.data?.dataUrl ?? shot.data?.image) : null
    return typeof data === 'string' && data.startsWith('data:image/') ? data : null
  } catch {
    return null
  }
}

/** What the browser is looking at, when there is a browser. Never guessed: absent means absent. */
async function currentPage(host: BrowserHost | null | undefined): Promise<{ url: string; title: string; text: string; selection: string } | null> {
  if (!host || !host.alive) return null
  try {
    const page = (await host.control.execute({ capability: 'page.read', params: { maxChars: 12_000 }, source: 'user' }, { confirm: async () => true })) as {
      ok: boolean
      data?: { url?: string; title?: string; text?: string; selection?: string }
    }
    if (!page.ok || !page.data?.url || !/^https?:/.test(String(page.data.url))) return null
    return {
      url: String(page.data.url),
      title: String(page.data.title ?? ''),
      text: String(page.data.text ?? ''),
      selection: String(page.data.selection ?? '')
    }
  } catch {
    return null
  }
}

export function createOrionHandlers(deps: OrionDeps): Record<string, Handler> {
  return {
    /**
     * One question, answered by whichever part of Orbis should answer it. Streams the same events as chat:send, plus a
     * `status` saying which way it went, so nothing about the routing is hidden.
     */
    'orion:ask': async ([request], { emit, signal }) => {
      const req = (request ?? {}) as { text?: unknown; history?: unknown; seed?: unknown }
      const text = typeof req.text === 'string' ? req.text.trim().slice(0, MAX_ASK) : ''
      if (!text) throw new HelperError('bad-request', 'Ask something.')
      if (deps.apiKeys.length === 0) throw new HelperError('no-key', 'Orion has no API key.')

      const history = Array.isArray(req.history)
        ? req.history
            .filter((m): m is { role: string; content: string } => Boolean(m) && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string')
            .slice(-10)
            .map((m) => ({ role: String(m.role) === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))
        : []

      // ---- a picture, asked for in words rather than by naming a command
      const drawn = detectImageGenRequest(text)
      if (drawn) {
        emit({ type: 'status', message: 'Making a picture…' })
        const seed = typeof req.seed === 'number' && Number.isFinite(req.seed) ? req.seed : undefined
        // A follow-up ("make it darker") is the earlier prompt with the change folded in, so the picture stays the same picture.
        const prompt = seed === undefined ? drawn : await rewriteImagePrompt(drawn, text, deps.apiKeys, deps.fetchFn as never).catch(() => drawn)
        const wanted = seed === undefined ? detectImageCount(text).count : 1
        const made = await generateImages(prompt, wanted, seed, { signal, onStatus: (message) => emit({ type: 'status', message }) })
        if (signal.aborted || made.cancelled) return { routed: 'image', aborted: true }
        if (made.results.length === 0) throw new HelperError('failed', made.errors[0]?.message ?? 'The picture could not be made.')
        for (const image of made.results) emit({ type: 'image', url: image.dataUrl, prompt, seed: image.seed })
        if (made.errors.length > 0) emit({ type: 'status', message: `Made ${made.results.length} of ${wanted} pictures: ${made.errors[0].message}` })
        emit({ type: 'done', model: null, truncated: false })
        return { routed: 'image', seed: made.results[0].seed }
      }

      const page = await currentPage(deps.host())
      const messages = [...history, { role: 'user', content: text }]
      const intent = await classifyIntent(messages, page ? { url: page.url, title: page.title } : undefined, undefined, deps.apiKeys, deps.fetchFn as never).catch(() => null)

      // ---- something to do in the browser
      if (intent?.kind === 'browse') {
        const host = deps.host()
        if (!host || !host.alive) {
          emit({ type: 'error', message: 'That needs the browser, and the browser is not open.' })
          return { routed: 'browse', ok: false }
        }
        emit({ type: 'status', message: 'Working in the browser…' })
        await deps.runTask({ task: intent.task || text, history }, { emit, signal })
        return { routed: 'browse' }
      }

      // ---- a question about now, which needs reading rather than remembering
      if (intent?.kind === 'answer' && intent.research) {
        emit({ type: 'status', message: 'Reading the web…' })
        const research: Research = await runResearch({
          question: text,
          queries: intent.research.queries,
          recency: intent.research.recency,
          fetchFn: deps.fetchFn as never,
          signal,
          onStatus: (message) => emit({ type: 'status', message })
        })
        if (signal.aborted) return { routed: 'research', aborted: true }
        if (research.sources.length) {
          // The sources go first, so they can be shown while the answer is still arriving.
          emit({ type: 'research', research })
          const context = answerContext({ research, earlier: undefined, browser: undefined, onScreen: undefined, pageText: null, includePage: false })
          await deps.chat({ messages: [...history, { role: 'user', content: `${context}\n\nQuestion: ${text}` }] }, { emit, signal })
          return { routed: 'research', sources: research.sources.length }
        }
        emit({ type: 'status', message: `Couldn't get current sources: ${research.problem ?? 'nothing usable was found'}. Answering without them.` })
      }

      // ---- otherwise Orion answers, with the page in front of the person when the question is about it
      // ---- a question about how the page looks, which words cannot answer
      if (page && LOOKS_VISUAL.test(text)) {
        emit({ type: 'status', message: 'Looking at the page…' })
        const shot = await pageImage(deps.host())
        if (shot) {
          await deps.chat(
            {
              messages: [
                ...history,
                { role: 'user', content: `This is ${page.title || page.url}, as it looks now.${NEWLINE}${NEWLINE}${text}`, attachments: [{ name: 'page.png', type: 'image', content: shot }] }
              ]
            },
            { emit, signal }
          )
          return { routed: 'vision' }
        }
        // No picture, so say so rather than answering as though one had been looked at.
        emit({ type: 'status', message: 'The page could not be captured, so this is from its text.' })
      }

      const usePage = page && (intent?.kind === 'answer' ? intent.usePage !== false : true)

      /**
       * What Orbis knows, assembled once by the Context Engine rather than composed by hand here.
       *
       * What this replaced was a string built in this function: the page's address, title and either the selection or
       * twelve thousand characters of text. That worked, and it was also the third place in Orbis deciding for itself
       * how much of a page is too much, with no budget, no provenance, nothing said when the page could not be read,
       * and the person's own memory and tasks left out entirely. The engine answers all of that in one place.
       *
       * The classifier still has the last word on whether the page is wanted at all: somebody asking an unrelated
       * question while a page happens to be open is not asking about the page.
       */
      let assembled: { text: string; summary: string } | null = null
      if (deps.context && usePage) {
        assembled = await deps.context({ text }, signal).catch(() => null)
        if (assembled?.summary && assembled.text) emit({ type: 'status', message: `Using ${assembled.summary}.` })
      }

      // Without the engine, or with nothing it could say, the page alone -- the behaviour from before it existed.
      const about = assembled?.text
        ? `${assembled.text}${NEWLINE}${NEWLINE}`
        : usePage && page
        ? `This is the page the person is looking at.\nAddress: ${page.url}\nTitle: ${page.title}\n${page.selection.trim() ? `They have selected:\n${page.selection.trim().slice(0, 5000)}` : `The page reads:\n${page.text.slice(0, 12_000)}`}\n\n`
          : ''
      await deps.chat({ messages: [...history, { role: 'user', content: about ? `${about}Question: ${text}` : text }] }, { emit, signal })
      return { routed: about ? (assembled?.text ? 'context' : 'page') : 'chat' }
    }
  }
}
