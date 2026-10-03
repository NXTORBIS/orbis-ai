import { selectionAction, type SelectionNeed } from '../../src/shared/selectionActions.ts'
import { selectionRequest } from '../../src/shared/selectionPrompts.ts'
import { readSelection } from '../../src/shared/selectionText.ts'

/**
 * Where a selection action meets the real Orbis.
 *
 * The page side of this feature draws things and knows nothing. This side does the work, and it is deliberately the
 * only side that can: it runs in the extension's worker, which is the only place that holds the address and the
 * one-run secret the Orbis helper checks. A web page cannot reach the helper, cannot learn the token, and cannot ask
 * for an action -- it can only send a message that this file then decides, by itself, whether to honour.
 *
 * Every action here runs something Orbis already has. Nothing is reimplemented:
 *
 *   explaining, summarising, translating, solving, checking  ->  orion:ask, the same Orion the chat uses
 *   searching                                                ->  the browser's own search, through the control layer
 *   opening an address                                       ->  a real Chromium tab
 *   saving                                                   ->  notes:create, the real Notes
 *   sending to a board                                       ->  the real Whiteboard
 *
 * Two checks stand between a message and any of that, and neither can be talked out of:
 *
 * **The action has to exist**, by id, in the one shared list. A message naming anything else is dropped.
 *
 * **The text is read again here.** The page says what was selected; this side decides for itself whether that text
 * looks like a secret, and refuses to send it anywhere if it does. A page that lied about the selection being safe
 * gets nowhere, because its claim is never the thing that is believed.
 */

interface Helper {
  readonly port: number
  readonly token: string
}

let helper: Helper | null = null

/**
 * The helper's address for this run.
 *
 * Put into session storage by the Orbis app the moment it starts the browser, over the debugging pipe it already
 * holds. Session storage is in memory only, is cleared when the browser closes, and is not readable by pages or by
 * other extensions -- which is why it is where the token lives.
 */
async function connection(): Promise<Helper | null> {
  if (helper) return helper
  try {
    const stored = (await chrome.storage.session.get('orbis.helper'))['orbis.helper'] as Helper | undefined
    if (stored && typeof stored.port === 'number' && typeof stored.token === 'string') helper = stored
  } catch {
    helper = null
  }
  return helper
}

/**
 * One request to the helper.
 *
 * The helper answers in lines rather than in one object: any number of `{ event }` lines as something happens, then
 * exactly one `{ result }` or `{ error }` at the end. `onEvent` is given the ones in between, which is how an answer
 * arrives a few words at a time instead of all at once.
 */
async function call(channel: string, args: unknown[], options: { signal?: AbortSignal; onEvent?: (event: Record<string, unknown>) => void } = {}): Promise<unknown> {
  const found = await connection()
  if (!found) throw new Error('Orbis is not running.')
  const response = await fetch(`http://127.0.0.1:${found.port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${found.token}` },
    body: JSON.stringify({ channel, args }),
    signal: options.signal
  })
  if (response.status === 401 || response.status === 403) {
    // The run's secret has changed, which means the browser was restarted under a new helper.
    helper = null
    throw new Error('Orbis is not running.')
  }
  if (!response.ok || !response.body) throw new Error(`Orbis could not do that (${response.status}).`)

  const reader = response.body.getReader()
  const decode = new TextDecoder()
  let rest = ''
  let result: unknown
  let got = false

  const take = (line: string): void => {
    if (line.trim() === '') return
    let parsed: { event?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    if (parsed.error) throw new Error(parsed.error.message ?? 'Orbis could not do that.')
    if (parsed.event && options.onEvent) options.onEvent(parsed.event)
    if ('result' in parsed) {
      result = parsed.result
      got = true
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    rest += decode.decode(value, { stream: true })
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) take(line)
  }
  take(rest)
  if (!got) throw new Error('Orbis stopped before it finished.')
  return result
}

/**
 * Asking Orion, with the answer arriving as it is written.
 *
 * `orion:ask` is the same entry the Orb uses, so the same Auto Mode picks the model and the same routing decides
 * whether a question needs the web, the page as a picture, or only the text in front of it. Nothing about which model
 * to use is decided here.
 *
 * Three of its events matter to a small panel: the pieces of the answer, the line saying what it is doing while there
 * is nothing to show yet, and a refusal. Everything else it can emit -- pictures, browser steps, confirmations --
 * belongs to surfaces this is not, and is ignored rather than half-drawn.
 */
async function ask(question: string, on: { chunk(text: string): void; status(words: string): void }, signal: AbortSignal): Promise<void> {
  let failure = ''
  await call('orion:ask', [{ text: question }], {
    signal,
    onEvent: (event) => {
      const type = typeof event.type === 'string' ? event.type : ''
      if (type === 'delta' && typeof event.content === 'string' && event.content !== '') on.chunk(event.content)
      else if (type === 'status' && typeof event.message === 'string') on.status(event.message)
      else if (type === 'error' && typeof event.message === 'string') failure = event.message
    }
  })
  if (failure !== '') throw new Error(failure)
}

/**
 * Runs something through the browser's own control layer: a real tab, a real page.
 *
 * `action` is a name from the helper's own short list of things a panel may ask the browser to do -- not a capability
 * id. That list is the gate, and it is on the helper's side of the wall, so nothing here can widen it.
 */
async function browser(action: string, args: Record<string, unknown>): Promise<void> {
  const reply = (await call('browser:do', [action, args])) as { ok?: boolean; message?: string } | undefined
  if (reply && reply.ok === false) throw new Error(reply.message ?? 'The browser would not do that.')
}

/**
 * What this Orbis can actually do, right now.
 *
 * Asked of the helper rather than assumed, so an action is never offered on the strength of the code existing. When
 * Orbis is not running the answer is nothing at all, and the palette says so instead of showing buttons that fail.
 */
async function capabilities(): Promise<SelectionNeed[]> {
  const found = await connection()
  if (!found) return []
  try {
    await call('helper:ping', [])
  } catch {
    helper = null
    return []
  }
  const can: SelectionNeed[] = ['orion', 'search', 'clipboard']
  // Each of the rest is claimed only if its own side answers.
  await Promise.all([
    call('notes:list', [{ limit: 1 }])
      .then(() => void can.push('notes'))
      .catch(() => undefined),
    call('whiteboard:list', [])
      .then(() => void can.push('whiteboard'))
      .catch(() => undefined),
    call('browser:tabs', [])
      .then(() => void can.push('browser'))
      .catch(() => undefined)
  ])
  return can
}

interface Job {
  action: string
  text: string
  url: string
  title: string
  extra: string
}

/** A web address Orbis is willing to open. Anything that is not plainly http or https is refused. */
function safeAddress(text: string): string | null {
  const trimmed = text.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname === '') return null
  return parsed.toString()
}

/** The actions that finish on their own: no answer to stream, just a thing that did or did not happen. */
async function doAction(job: Job): Promise<void> {
  const action = selectionAction(job.action)
  if (!action) throw new Error('Orbis does not have that action.')
  const reading = readSelection(job.text)
  if (action.sends && reading.risk !== 'none') throw new Error('Orbis will not send this anywhere.')

  switch (action.id) {
    case 'open': {
      const address = safeAddress(reading.normalized)
      if (!address) throw new Error('That is not an address Orbis can open.')
      await browser('open', { url: address })
      return
    }
    case 'search': {
      // Orbis Search, which is the browser's own results page, rather than a search engine chosen here.
      await browser('search', { query: reading.normalized })
      return
    }
    case 'note': {
      const made = (await call('notes:create', [
        {
          title: reading.normalized.slice(0, 80) || 'From a page',
          body: `${job.text}\n\n— ${job.title || job.url}\n${job.url}`,
          tags: []
        }
      ])) as { id?: string } | undefined
      if (!made || typeof made.id !== 'string') throw new Error('Orbis could not save that note.')
      return
    }
    case 'whiteboard': {
      const boards = (await call('whiteboard:list', [])) as { id?: string; name?: string }[] | undefined
      const board = Array.isArray(boards) ? boards.find((one) => typeof one.id === 'string') : undefined
      const id = board?.id ?? ((await call('whiteboard:create', ['From the web'])) as { id?: string } | undefined)?.id
      if (typeof id !== 'string') throw new Error('Orbis could not find a board to add this to.')
      await call('whiteboard:add-text', [id, job.text, job.title ? `${job.title} — ${job.url}` : job.url])
      return
    }
    default:
      throw new Error(`${action.label} does not run here.`)
  }
}

/** The one-shot messages from the page. Everything that streams goes over a port instead; see below. */
chrome.runtime.onMessage.addListener((message: { kind?: string } & Partial<Job>, _sender, reply) => {
  if (message?.kind === 'orbis-selection/can') {
    void capabilities().then(
      (can) => reply({ ok: true, data: can }),
      () => reply({ ok: true, data: [] })
    )
    return true
  }
  if (message?.kind === 'orbis-selection/do') {
    void doAction({
      action: String(message.action ?? ''),
      text: String(message.text ?? ''),
      url: String(message.url ?? ''),
      title: String(message.title ?? ''),
      extra: String(message.extra ?? '')
    }).then(
      () => reply({ ok: true }),
      (failed: unknown) => reply({ ok: false, message: failed instanceof Error ? failed.message : 'Orbis could not do that.' })
    )
    return true
  }
  return false
})

/**
 * The answers.
 *
 * One port per question, so a question can be stopped without touching any other, and so the page closing or the tab
 * going away stops the request rather than leaving it writing into nothing.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'orbis-selection') return
  const running = new Map<string, AbortController>()

  port.onMessage.addListener((message: { kind?: string; id?: string } & Partial<Job>) => {
    const id = String(message.id ?? '')
    if (message.kind === 'orbis-selection/stop') {
      running.get(id)?.abort()
      running.delete(id)
      return
    }
    if (message.kind !== 'orbis-selection/ask' || id === '' || running.has(id)) return

    const action = selectionAction(String(message.action ?? ''))
    const reading = readSelection(String(message.text ?? ''))
    const send = (part: Record<string, unknown>): void => {
      try {
        port.postMessage({ id, ...part })
      } catch {
        // The page is gone. The abort below is what stops the work.
      }
    }
    if (!action || !action.sends) {
      send({ failed: 'Orbis does not have that action.' })
      return
    }
    if (reading.risk !== 'none') {
      send({ failed: 'Orbis will not send this anywhere.' })
      return
    }

    const stop = new AbortController()
    running.set(id, stop)
    let question: string
    try {
      question = selectionRequest(action.id, reading, { url: String(message.url ?? ''), title: String(message.title ?? '') }, String(message.extra ?? '')).ask
    } catch (failed) {
      running.delete(id)
      send({ failed: failed instanceof Error ? failed.message : 'Orbis could not ask that.' })
      return
    }

    void ask(question, { chunk: (chunk) => send({ chunk }), status: (words) => send({ status: words }) }, stop.signal).then(
      () => {
        running.delete(id)
        send({ done: true })
      },
      (failed: unknown) => {
        running.delete(id)
        if (stop.signal.aborted) return
        send({ failed: failed instanceof Error ? failed.message : 'Orion could not answer.' })
      }
    )
  })

  port.onDisconnect.addListener(() => {
    for (const stop of running.values()) stop.abort()
    running.clear()
  })
})
