// @ts-expect-error The page's own way of talking to Orbis: a plain script beside this one in the built page.
import { call } from './helper.js'
import type { WidgetLink } from './api.ts'
import type { WidgetBoardState, WidgetCommand, WidgetCommandResult, WidgetEvent, WidgetFeed, WidgetFeedRequest, WidgetRendered, WidgetReply, WidgetRequest, WidgetSource } from '../../../src/shared/widgetFeed.ts'
import { WIDGET_CHANNELS } from '../../../src/shared/widgetFeed.ts'

/**
 * The start page's one connection to Orbis.
 *
 * Every part of the page -- the board, the gallery, the studio -- reads how things stand from here, so there is one
 * copy of it and they cannot show different things. Nothing here holds a second board of its own: a change is asked
 * for, and what comes back is what is drawn.
 *
 * The page is created with the browser window, which is earlier than the Orbis window it has to ask, so a single
 * attempt would nearly always miss. It keeps trying, quietly, waiting longer each time -- and until it has an
 * answer it says so, because an empty board shown as though it were the answer is the one thing to avoid.
 */

type Listener = (state: WidgetBoardState | null, connected: boolean) => void

const WATCH_WAIT_FROM = 500
const WATCH_WAIT_TO = 15_000
/** How often what the page has drawn is reported, at most. Orion reads it; nothing else does. */
const REPORT_EVERY = 400

export function createLink(): WidgetLink {
  let state: WidgetBoardState | null = null
  let connected = false
  const listeners = new Set<Listener>()
  const feedListeners = new Set<(source: WidgetSource) => void>()
  /** One request per thing asked for at the same moment: eight cards asking for the tasks is one question. */
  const asking = new Map<string, Promise<WidgetFeed>>()
  let lastReport = 0
  let reportTimer = 0
  let reportWanted: WidgetRendered | null = null

  const tell = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener(state, connected)
      } catch (err) {
        // One part of the page failing to take an update must not stop the others being told.
        console.error('[widgets] a part of the page could not be brought up to date', err)
      }
    }
  }

  const take = (event: WidgetEvent): void => {
    if (event.type === 'state') {
      state = event.state
      connected = true
      tell()
      return
    }
    for (const listener of [...feedListeners]) {
      try {
        listener(event.source)
      } catch {
        // A card that has gone away. It drops its own listener when it does.
      }
    }
  }

  /**
   * Watches Orbis for as long as the page is open.
   *
   * `widgets:watch` never answers: it sends how things stand and then every change. When it ends -- Orbis closed,
   * the helper restarted -- the page is no longer sure of anything, says so, and starts again after a wait that
   * grows, so a closed Orbis is not asked twenty times a second.
   */
  const watch = async (): Promise<void> => {
    for (let wait = WATCH_WAIT_FROM; ; wait = Math.min(Math.round(wait * 1.7), WATCH_WAIT_TO)) {
      try {
        await call(WIDGET_CHANNELS.watch, [], { onEvent: (event: unknown) => take(event as WidgetEvent) })
      } catch {
        // Orbis is not up, or has stopped. Either way the page keeps what it last knew and says it is not sure.
      }
      if (connected) {
        connected = false
        tell()
      }
      await new Promise((done) => setTimeout(done, wait))
    }
  }

  void watch()

  const act = async (request: WidgetRequest): Promise<WidgetReply> => {
    try {
      const reply = (await call(WIDGET_CHANNELS.act, [request])) as WidgetReply
      if (reply && reply.ok) {
        state = reply.state
        connected = true
        tell()
      }
      return reply
    } catch (err) {
      return { ok: false, error: 'no-orbis', message: reasonOf(err) }
    }
  }

  const feed = async (request: WidgetFeedRequest): Promise<WidgetFeed> => {
    const key = JSON.stringify(request)
    const already = asking.get(key)
    if (already) return already
    const asked = (async (): Promise<WidgetFeed> => {
      try {
        return (await call(WIDGET_CHANNELS.data, [request])) as WidgetFeed
      } catch (err) {
        return { source: request.source, status: 'unavailable', value: null, at: 0, error: reasonOf(err) }
      } finally {
        asking.delete(key)
      }
    })()
    asking.set(key, asked)
    return asked
  }

  return {
    state: () => state,
    connected: () => connected,
    subscribe: (listener) => {
      listeners.add(listener)
      // Told at once, so a part that is mounted late is not blank until the next change.
      try {
        listener(state, connected)
      } catch (err) {
        console.error('[widgets] a part of the page could not be started', err)
      }
      return () => listeners.delete(listener)
    },
    act,
    feed,
    onFeed: (listener) => {
      feedListeners.add(listener)
      return () => feedListeners.delete(listener)
    },
    run: async (command: WidgetCommand): Promise<WidgetCommandResult> => {
      try {
        return (await call(WIDGET_CHANNELS.do, [command])) as WidgetCommandResult
      } catch (err) {
        return { ok: false, message: reasonOf(err) }
      }
    },
    report: (rendered: WidgetRendered) => {
      // Sent at most a few times a second: the board reports after every layout, and a drag is a great many of those.
      reportWanted = rendered
      const since = Date.now() - lastReport
      if (since >= REPORT_EVERY) return void send()
      if (reportTimer) return
      reportTimer = setTimeout(send, REPORT_EVERY - since) as unknown as number
    }
  }

  function send(): void {
    clearTimeout(reportTimer)
    reportTimer = 0
    const rendered = reportWanted
    reportWanted = null
    if (!rendered) return
    lastReport = Date.now()
    void call(WIDGET_CHANNELS.rendered, [rendered]).catch(() => {
      // Nobody is listening. What the page has drawn is on the screen either way.
    })
  }
}

/** Why something did not work, in words a person can read. */
function reasonOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    const message = (err as { message: string }).message
    if (/not running|could not sign in|still starting/i.test(message)) return 'Orbis is not running, so the widgets cannot be changed.'
    return message
  }
  return 'Orbis is not running, so the widgets cannot be changed.'
}
