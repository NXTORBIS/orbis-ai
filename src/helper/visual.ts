import type { StreamEvent } from '../shared/types'
import { modelFor } from '../shared/providers.ts'
import { visualAction } from '../shared/visual/actions.ts'
import { DEFAULT_QUESTION, MOST_QUESTION, safeAddress, visualPrompt, type AskKind } from '../shared/visual/ask.ts'
import { isKind } from '../shared/visual/kinds.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Where a Visual Search meets the real Orbis.
 *
 * The page side of this feature draws a rectangle and knows nothing. This side does every single thing that leaves
 * the browser, and it is deliberately the only side that can: it answers over the helper, which the extension's
 * worker reaches with this run's secret and a web page cannot reach at all.
 *
 * Nothing here is a new system. Each line hands the work to something Orbis already has:
 *
 *   looking at the selection   ->  `chat:send`, the same Orion the chat uses, with the vision model named
 *   searching for what it is   ->  the browser's own search, through the Browser Control Layer
 *   opening an address         ->  a real Chromium tab, and only after the person has seen where it goes
 *   keeping it                 ->  `notes:create`, the real Notes
 *   a laboratory, the chat     ->  the Orbis window, which owns both
 *
 * Four checks stand between a message and any of that:
 *
 * **The action has to exist**, by id, in the one shared list. Anything else is dropped.
 *
 * **The model has to be able to see.** `modelFor('look')` is asked, not assumed. Left to the ordinary choice a
 * picture went to the text service, where nothing has eyes, and the image was dropped on the way out -- so the
 * answer came back confident and built from nothing. Naming the model is what makes looking actually look.
 *
 * **The image has to be an image.** A data url of a known picture type, under the size limit, and nothing else. The
 * worker is trusted with the token, not with the shape of what it sends.
 *
 * **The answer is never executed.** It is text. An address inside it is parsed and shown before anything opens it,
 * structure inside it is handed to a laboratory the person pressed a button for, and no part of it chooses an action.
 */

export interface VisualDeps {
  /**
   * Whether the person has Visual Search turned on.
   *
   * Asked first and honoured absolutely: with it off, `visual:can` answers that nothing is available and the browser
   * never watches for the drag at all. That is what makes the setting a real one rather than a hidden button -- a
   * page behaves exactly as it would without Orbis.
   */
  on: () => Promise<boolean>
  /** Whether this Orbis has a key for the service that can see. Asked, never assumed. */
  canSee: () => boolean
  /** Ask Orion, with the vision model named and the picture attached. Streams the answer as it is written. */
  ask: (
    input: { prompt: string; image: string; model: string },
    on: { chunk(text: string): void; status(words: string): void },
    signal: AbortSignal
  ) => Promise<void>
  /** The browser, for a search or a tab. Null when there is none, and then those actions are not offered. */
  browser: () => { search(query: string): Promise<void>; open(url: string): Promise<void> } | null
  /** Real Notes. Null when this profile has no data folder, and then Keep is not offered. */
  notes: () => { create(note: { title: string; body: string }): Promise<void> } | null
  /**
   * The Orbis window, for the two things only it can do: carry a selection into the conversation, and open a
   * laboratory with what was read out of the picture. Null when the window is not running -- which is a normal state,
   * and the browser then says so instead of offering a button that does nothing.
   */
  window: () =>
    | {
        /** Put the selection and the answer into the conversation, and bring the window forward. */
        toChat(input: { image: string; question: string; answer: string; title: string; page?: { title?: string; url?: string } }): Promise<void>
        /** Open a Native App with what was read out of the selection. */
        toLab(input: { appId: string; data: Record<string, unknown>; title: string }): Promise<boolean>
      }
    | null
}

/** The picture types a selection can arrive as. PNG is what a capture gives; the others are what a resize may produce. */
const PICTURE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/

/**
 * How large a picture may be, in characters of data url.
 *
 * Six million, which is about four and a half megabytes of image. Chosen to sit inside the helper's own eight-megabyte
 * body limit with the JSON envelope around it -- at eight million exactly, a large crop would have been refused
 * unread by the server, which arrives as a blank failure rather than as "that is too large". Far more than any real
 * crop needs: a selection capped at 1,600 pixels on its long edge is a few hundred kilobytes.
 */
const MOST_IMAGE = 6_000_000

const ASK_KINDS = new Set<AskKind>(['ask', 'identify', 'explain', 'read', 'translate', 'summarise', 'solve', 'extract'])

function picture(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new HelperError('bad-request', 'Visual Search needs a picture.')
  if (value.length > MOST_IMAGE) throw new HelperError('bad-request', 'That picture is too large to send.')
  if (!PICTURE.test(value)) throw new HelperError('bad-request', 'That is not a picture Orbis can send.')
  return value
}

function words(value: unknown, most: number): string {
  return typeof value === 'string' ? value.slice(0, most) : ''
}

/** A page's own words, trimmed. Only the title and the address, and only when they are there. */
function pageOf(value: unknown): { title?: string; url?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as { title?: unknown; url?: unknown }
  const title = words(raw.title, 200)
  const url = words(raw.url, 400)
  if (title === '' && url === '') return undefined
  return { ...(title ? { title } : {}), ...(url ? { url } : {}) }
}

export function createVisualHandlers(get: () => VisualDeps | null | undefined): Record<string, Handler> {
  const deps = (): VisualDeps => {
    const found = get()
    if (!found) throw new HelperError('unavailable', 'Visual Search is not available.')
    return found
  }

  return {
    /**
     * What Visual Search can do, right now.
     *
     * Asked rather than assumed, every time, because the answer genuinely changes: the window opens and closes under
     * a running browser, and a profile without a data folder has no Notes. The page draws its bar from this, so an
     * action that is not in this answer is never drawn at all.
     */
    'visual:can': async () => {
      const d = deps()
      if (!(await d.on())) return { can: [], model: null, on: false, says: 'Visual Search is turned off in Settings.' }
      const can: string[] = ['page']
      if (d.canSee()) can.push('eyes')
      if (d.browser()) can.push('browser')
      if (d.notes()) can.push('notes')
      if (d.window()) can.push('window')
      const eyes = d.canSee() ? modelFor('look', { groq: false, mistral: true }) : null
      return {
        can,
        on: true,
        /** Which model would look, so the result card can say so quietly. Null when nothing can. */
        model: eyes?.model ?? null,
        /** Said on screen when there is nothing that can see, so the reason is never a mystery. */
        says: d.canSee() ? '' : 'Orbis has no key for the service that can look at an image.'
      }
    },

    /**
     * Look at a selection and answer about it.
     *
     * Streams `delta` and `status` exactly as the chat does, so the page can show the answer arriving rather than a
     * spinner. Ends with the model that answered, which is the only honest way for the card to name it.
     */
    'visual:ask': async ([input], { emit, signal }) => {
      const d = deps()
      if (!(await d.on())) throw new HelperError('unavailable', 'Visual Search is turned off in Settings.')
      if (!d.canSee()) throw new HelperError('no-key', 'Orbis has no key for the service that can look at an image.')
      const raw = (input ?? {}) as Record<string, unknown>
      const image = picture(raw.image)
      const kindName = words(raw.kind, 20) as AskKind
      const kind: AskKind = ASK_KINDS.has(kindName) ? kindName : 'ask'
      const asked = words(raw.question, MOST_QUESTION).trim()
      const eyes = modelFor('look', { groq: false, mistral: true })
      if (!eyes) throw new HelperError('no-key', 'Nothing here can look at an image.')

      const prompt = visualPrompt({
        kind,
        question: kind === 'ask' ? (asked === '' ? DEFAULT_QUESTION : asked) : asked,
        page: pageOf(raw.page),
        into: words(raw.into, 40) || undefined,
        at: words(raw.at, 20) || undefined
      })

      let text = ''
      await d.ask(
        { prompt, image, model: eyes.model },
        {
          chunk: (chunk) => {
            text += chunk
            emit({ type: 'delta', content: chunk } as StreamEvent)
          },
          status: (said) => emit({ type: 'status', message: said } as StreamEvent)
        },
        signal
      )
      if (signal.aborted) return { model: eyes.model, aborted: true }
      // An empty answer is reported as empty rather than as a success with nothing in it, which is what made a
      // malformed vision request look like a working feature that had nothing to say.
      if (text.trim() === '') throw new HelperError('no-answer', 'Nothing came back from looking at that.')
      return { model: eyes.model, reply: text }
    },

    /**
     * Do something with what was found.
     *
     * One channel for all of them, with the action's id checked against the shared list first -- so the set of things
     * a page can cause is exactly the set of things in that list, and widening it means editing a file that is tested.
     */
    'visual:act': async ([input]) => {
      const d = deps()
      if (!(await d.on())) throw new HelperError('unavailable', 'Visual Search is turned off in Settings.')
      const raw = (input ?? {}) as Record<string, unknown>
      const action = visualAction(words(raw.action, 40))
      if (!action) throw new HelperError('bad-request', 'Orbis does not have that action.')

      switch (action.id) {
        case 'search': {
          const browser = d.browser()
          if (!browser) throw new HelperError('unavailable', 'The browser is not available.')
          const query = words(raw.query, 300).trim()
          if (query === '') throw new HelperError('bad-request', 'There is nothing to search for.')
          await browser.search(query)
          return { ok: true }
        }
        case 'similar': {
          const browser = d.browser()
          if (!browser) throw new HelperError('unavailable', 'The browser is not available.')
          const query = words(raw.query, 300).trim()
          if (query === '') throw new HelperError('bad-request', 'There is nothing to look for.')
          /*
           * Searched for by what Orion said it is, not by the picture.
           *
           * Orbis has no reverse-image search and will not pretend to: this is a web search for the identification,
           * and the page says so in those words next to the button. A row that called this "find visually similar
           * images" would be claiming a capability that does not exist.
           */
          await browser.search(`${query} similar`)
          return { ok: true, how: 'Searched for what Orion identified, not for the picture itself.' }
        }
        case 'open': {
          const browser = d.browser()
          if (!browser) throw new HelperError('unavailable', 'The browser is not available.')
          const url = safeAddress(words(raw.url, 400))
          if (!url) throw new HelperError('bad-request', 'That is not an address Orbis can open.')
          await browser.open(url)
          return { ok: true, url }
        }
        case 'note': {
          const notes = d.notes()
          if (!notes) throw new HelperError('unavailable', 'Notes are not available.')
          const title = words(raw.title, 80).trim() || 'From the screen'
          const body = words(raw.body, 40_000)
          if (body.trim() === '') throw new HelperError('bad-request', 'There is nothing to keep yet.')
          await notes.create({ title, body })
          return { ok: true }
        }
        case 'chat': {
          const window = d.window()
          if (!window) throw new HelperError('unavailable', 'The Orbis window is not open.')
          await window.toChat({
            image: picture(raw.image),
            question: words(raw.question, MOST_QUESTION),
            answer: words(raw.answer, 40_000),
            title: words(raw.title, 80),
            page: pageOf(raw.page)
          })
          return { ok: true }
        }
        case 'lab': {
          const window = d.window()
          if (!window) throw new HelperError('unavailable', 'The Orbis window is not open.')
          const appId = words(raw.appId, 60)
          if (!/^[a-z][a-z0-9-]{1,59}$/.test(appId)) throw new HelperError('bad-request', 'That is not a laboratory.')
          // `found`, not `kind`: the message's own `kind` is the action envelope, and using one name for both let the
          // category overwrite the routing.
          const kind = words(raw.found, 30)
          if (!isKind(kind)) throw new HelperError('bad-request', 'Orbis does not know that kind of thing.')
          const data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? (raw.data as Record<string, unknown>) : null
          // Nothing structured means nothing to open it with, and a laboratory opened empty is worse than no button.
          if (!data || Object.keys(data).length === 0) throw new HelperError('bad-request', 'There is nothing read out of that to open.')
          const opened = await window.toLab({ appId, data, title: words(raw.title, 80) })
          if (!opened) throw new HelperError('unavailable', 'That laboratory could not be opened.')
          return { ok: true }
        }
        default:
          throw new HelperError('bad-request', `${action.label} does not run here.`)
      }
    }
  }
}
