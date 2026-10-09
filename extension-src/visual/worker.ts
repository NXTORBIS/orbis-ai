import { cropFor, enoughPixels, sendSize, type Rect, type Size } from '../../src/shared/visual/geometry.ts'
import { visualAction } from '../../src/shared/visual/actions.ts'

/**
 * Where a Visual Search gets its pixels, and the only side that can reach Orbis.
 *
 * The page side draws a rectangle and knows nothing. This side takes the picture, cuts the selection out of it, and
 * is the only place that holds the helper's address and this run's secret. A web page cannot reach the helper, cannot
 * learn the token, and cannot ask for an action -- it can only send a message that this file then decides, by itself,
 * whether to honour.
 *
 * ## Why the capture happens here and not in the page
 *
 * `chrome.tabs.captureVisibleTab` exists only in the extension's worker, which is the point: the picture of the
 * window is never handed to a content script, so nothing on the page -- including Orbis's own overlay, which runs in
 * an isolated world on that page -- ever holds an image of the whole window. Only the crop goes back, and only to the
 * frame that asked for it.
 *
 * ## Why the scale is measured rather than assumed
 *
 * The capture arrives at the compositor's own scale: the device ratio combined with the page's zoom, rounded
 * somewhere. At 110% zoom on a 1.5x display that is neither 1.5 nor 1.65. So the crop is computed by dividing the
 * image that actually arrived by the viewport it was taken of (`geometry.ts`), which cannot be wrong about it. This
 * was the one thing that could not be got right by reasoning, and the cause of a crop of the wrong part of a page.
 *
 * ## Three things it refuses
 *
 * **A frame that is not the active tab.** The capture is of whichever tab is in front, so a request from a background
 * tab or a different window would return somebody else's page. The sender is checked against the active tab.
 *
 * **A crop with nothing in it.** A blank rectangle is reported as blank rather than sent, because a model given a
 * black square answers about a black square and the person reads that as Orbis being confused.
 *
 * **An action not in the shared list.** By id, every time.
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
async function call(
  channel: string,
  args: unknown[],
  options: { signal?: AbortSignal; onEvent?: (event: Record<string, unknown>) => void } = {}
): Promise<unknown> {
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

// ---------------------------------------------------------------- the picture

/** How long a capture may take before it is treated as a capture that is not going to happen. */
const CAPTURE_WAIT = 8000

/**
 * Chromium allows about two captures a second, and says so by refusing the third.
 *
 * Somebody who selects, looks, and selects again straight away meets that limit -- it is not an edge case, it is the
 * second thing anybody does. So one wait-and-retry is built in, which absorbs the ordinary case, and a second
 * refusal is reported as what it is rather than as "Orbis could not take a picture", which would send them looking
 * for a fault that is not there.
 */
const CAPTURE_GAP = 650
let lastCapture = 0

const rest = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * The visible tab, as a picture.
 *
 * PNG rather than JPEG. A JPEG of 11-pixel text is a JPEG of a smudge, and text is the thing this feature must not
 * soften -- the re-encode at the end is where quality is traded, by which point the crop is small.
 */
async function captureWindow(windowId: number): Promise<string> {
  const once = async (): Promise<string> => {
    const shot = await Promise.race([
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The capture took too long.')), CAPTURE_WAIT))
    ])
    lastCapture = Date.now()
    if (typeof shot !== 'string' || shot === '') throw new Error('Orbis could not take a picture of the window.')
    return shot
  }
  // Spaced out before asking, so the common case never produces a refusal to recover from.
  const since = Date.now() - lastCapture
  if (since < CAPTURE_GAP) await rest(CAPTURE_GAP - since)
  try {
    return await once()
  } catch (failed) {
    const said = failed instanceof Error ? failed.message : ''
    if (!/quota|per_second/i.test(said)) throw failed
    await rest(CAPTURE_GAP)
    return once()
  }
}

/** Whether a cut-out is all one colour, which is what a protected video or a blocked surface comes back as. */
function allOneColour(data: Uint8ClampedArray): boolean {
  if (data.length < 4) return true
  const r = data[0]
  const g = data[1]
  const b = data[2]
  // Every twentieth pixel. Reading all of them is pointless: a region that is not uniform is almost never uniform for
  // its first five per cent either, and this runs on every selection.
  for (let at = 0; at < data.length; at += 80) {
    if (Math.abs(data[at] - r) > 2 || Math.abs(data[at + 1] - g) > 2 || Math.abs(data[at + 2] - b) > 2) return false
  }
  return true
}

interface Crop {
  readonly image: string
  readonly size: Size
  /** The scale the capture arrived at, for the diagnostic line. */
  readonly scale: number
  readonly blank: boolean
}

/**
 * The selection, cut out of the window and sized for sending.
 *
 * All of it in the worker: the whole-window picture is created, cut and dropped here, and never crosses back to a
 * page. `OffscreenCanvas` rather than a document canvas because a worker has no document -- and because it keeps the
 * resize off whatever thread the page is painting on.
 */
/**
 * A data url, decoded without fetching it.
 *
 * `fetch(dataUrl)` is the obvious way and it does not work here: the extension's own content security policy is
 * `connect-src http://127.0.0.1:*`, which exists so that nothing in this worker can reach anywhere but the helper --
 * and a `data:` fetch is a connection like any other, so it came back "Failed to fetch". Decoding the base64 is both
 * allowed and faster, since there was never any point going through the network stack for bytes already in memory.
 */
function bytesOf(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const body = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(body.length)
  for (let at = 0; at < body.length; at += 1) bytes[at] = body.charCodeAt(at)
  const type = /data:([^;,]+)/.exec(head)?.[1] ?? 'image/png'
  return new Blob([bytes], { type })
}

async function cutOut(shot: string, selection: Rect, viewport: Size, pad: number): Promise<Crop> {
  const whole = await createImageBitmap(bytesOf(shot))
  const image = { width: whole.width, height: whole.height }
  const crop = cropFor(selection, image, viewport, pad)
  if (crop.width < 1 || crop.height < 1) {
    whole.close()
    throw new Error('There is nothing in that selection.')
  }

  const send = sendSize(crop)
  const canvas = new OffscreenCanvas(send.width, send.height)
  const paint = canvas.getContext('2d')
  if (!paint) {
    whole.close()
    throw new Error('Orbis could not prepare that picture.')
  }
  // Quality on, because this is where small text is either kept legible or lost.
  paint.imageSmoothingEnabled = true
  paint.imageSmoothingQuality = 'high'
  paint.drawImage(whole, crop.x, crop.y, crop.width, crop.height, 0, 0, send.width, send.height)
  whole.close()

  const pixels = paint.getImageData(0, 0, send.width, send.height).data
  const blank = allOneColour(pixels)

  const out = await canvas.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await out.arrayBuffer())
  let base64 = ''
  // In chunks: `String.fromCharCode(...bytes)` on a few hundred thousand bytes exceeds the argument limit and throws.
  for (let at = 0; at < bytes.length; at += 8192) base64 += String.fromCharCode(...bytes.subarray(at, at + 8192))
  return {
    image: `data:image/png;base64,${btoa(base64)}`,
    size: send,
    scale: viewport.width > 0 ? image.width / viewport.width : 1,
    blank
  }
}

// ---------------------------------------------------------------- messages from the page

interface CaptureAsk {
  rect?: Rect
  viewport?: Size
  pad?: number
  /** Whether a video was inside the selection, which is what tells a blank capture from a protected one. */
  video?: boolean
}

const rectOf = (value: unknown): Rect | null => {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const nums = [r.x, r.y, r.width, r.height]
  if (!nums.every((one) => typeof one === 'number' && Number.isFinite(one))) return null
  if ((r.width as number) <= 0 || (r.height as number) <= 0) return null
  return { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }
}

const sizeOf = (value: unknown): Size | null => {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  if (typeof s.width !== 'number' || typeof s.height !== 'number') return null
  if (s.width <= 0 || s.height <= 0 || s.width > 20_000 || s.height > 20_000) return null
  return { width: s.width, height: s.height }
}

/**
 * Whether this frame may have a picture of the window.
 *
 * The capture is of whichever tab is in front, so the only safe answer is to refuse any request that did not come
 * from that tab. Without this, a selection left over in a background tab would have come back holding a picture of
 * the page the person is actually looking at.
 */
async function senderIsInFront(sender: chrome.runtime.MessageSender): Promise<number | null> {
  const tab = sender.tab
  if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return null
  try {
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId })
    if (!active || active.id !== tab.id) return null
    return tab.windowId
  } catch {
    return null
  }
}

async function capture(ask: CaptureAsk, sender: chrome.runtime.MessageSender): Promise<{ ok: true; data: Crop } | { ok: false; code: string; message: string }> {
  const rect = rectOf(ask.rect)
  const viewport = sizeOf(ask.viewport)
  if (!rect || !viewport) return { ok: false, code: 'no-capture', message: 'That selection is not one Orbis can read.' }

  const windowId = await senderIsInFront(sender)
  if (windowId === null) return { ok: false, code: 'no-capture', message: 'That page is no longer the one in front.' }

  const pad = typeof ask.pad === 'number' && ask.pad >= 0 && ask.pad <= 64 ? ask.pad : 0
  let shot: string
  try {
    shot = await captureWindow(windowId)
  } catch (failed) {
    const said = failed instanceof Error ? failed.message : ''
    // Chromium refuses the capture outright on a surface it protects, rather than returning a blank one.
    if (/protected|not allowed|cannot (be )?capture/i.test(said)) {
      return { ok: false, code: 'protected', message: 'This page does not allow what you selected to be captured.' }
    }
    if (/quota|per_second/i.test(said)) {
      return { ok: false, code: 'capture-busy', message: 'Orbis can only photograph the page a couple of times a second.' }
    }
    return { ok: false, code: 'no-capture', message: said || 'Orbis could not take a picture of the window.' }
  }

  let crop: Crop
  try {
    crop = await cutOut(shot, rect, viewport, pad)
  } catch (failed) {
    return { ok: false, code: 'no-capture', message: failed instanceof Error ? failed.message : 'Orbis could not cut that out.' }
  }

  if (!enoughPixels(crop.size)) return { ok: false, code: 'too-small', message: 'That selection is very small.' }
  if (crop.blank) {
    /*
     * A capture that came back as one flat colour.
     *
     * Reported rather than sent, and the reason given depends on what was under the selection: a video there means
     * protected content, which is the usual cause, and no video there means something else blanked it. Sending it
     * would get a confident answer about a black rectangle, which reads as Orbis being broken.
     */
    return ask.video === true
      ? { ok: false, code: 'protected', message: 'That part of the page came back blank. Protected video is the usual reason.' }
      : { ok: false, code: 'no-capture', message: 'That part of the page came back blank.' }
  }
  return { ok: true, data: crop }
}

/** What Visual Search can do, asked of Orbis rather than assumed. Nothing at all when Orbis is not running. */
async function capabilities(): Promise<{ can: string[]; model: string | null; on: boolean; says: string }> {
  const found = await connection()
  // `on: true` when Orbis cannot be reached at all, deliberately: not reachable is not the same as switched off, and
  // the page uses `on` to decide whether to watch for the gesture. Treating "no answer" as off would have left the
  // gesture dead on every page opened before Orbis came up.
  if (!found) return { can: [], model: null, on: true, says: 'Orbis is not running.' }
  try {
    const got = (await call('visual:can', [])) as { can?: unknown; model?: unknown; on?: unknown; says?: unknown }
    return {
      can: Array.isArray(got?.can) ? got.can.filter((one): one is string => typeof one === 'string') : [],
      model: typeof got?.model === 'string' ? got.model : null,
      on: got?.on !== false,
      says: typeof got?.says === 'string' ? got.says : ''
    }
  } catch {
    helper = null
    return { can: [], model: null, on: true, says: 'Orbis is not running.' }
  }
}

/** An action, run by Orbis. The id is checked here as well, so a message naming anything else gets nowhere. */
async function act(message: Record<string, unknown>): Promise<unknown> {
  const action = visualAction(String(message.action ?? ''))
  if (!action) throw new Error('Orbis does not have that action.')
  return call('visual:act', [message])
}

chrome.runtime.onMessage.addListener((message: { kind?: string } & Record<string, unknown>, sender, reply) => {
  if (message?.kind === 'orbis-visual/can') {
    void capabilities().then((data) => reply({ ok: true, data }))
    return true
  }
  if (message?.kind === 'orbis-visual/capture') {
    void capture(message as CaptureAsk, sender).then((got) =>
      got.ok ? reply({ ok: true, data: got.data }) : reply({ ok: false, code: got.code, message: got.message })
    )
    return true
  }
  if (message?.kind === 'orbis-visual/act') {
    void act(message).then(
      (data) => reply({ ok: true, data }),
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
 * going away stops the request rather than leaving it writing into nothing. The run number comes back on every
 * message: the page uses it to recognise an answer from a selection it has already moved on from.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'orbis-visual') return
  const running = new Map<string, AbortController>()

  port.onMessage.addListener((message: { kind?: string; id?: string } & Record<string, unknown>) => {
    const id = String(message.id ?? '')
    if (message.kind === 'orbis-visual/stop') {
      running.get(id)?.abort()
      running.delete(id)
      return
    }
    if (message.kind !== 'orbis-visual/ask' || id === '' || running.has(id)) return

    const send = (part: Record<string, unknown>): void => {
      try {
        port.postMessage({ id, ...part })
      } catch {
        // The page is gone. The abort below is what stops the work.
      }
    }

    const stop = new AbortController()
    running.set(id, stop)
    void call(
      'visual:ask',
      [
        {
          image: message.image,
          question: message.question,
          kind: message.ask,
          page: message.page,
          into: message.into,
          at: message.at
        }
      ],
      {
        signal: stop.signal,
        onEvent: (event) => {
          const type = typeof event.type === 'string' ? event.type : ''
          if (type === 'delta' && typeof event.content === 'string' && event.content !== '') send({ chunk: event.content })
          else if (type === 'status' && typeof event.message === 'string') send({ status: event.message })
          else if (type === 'error' && typeof event.message === 'string') send({ failed: event.message })
        }
      }
    ).then(
      (result) => {
        running.delete(id)
        const got = (result ?? {}) as { model?: unknown; reply?: unknown; aborted?: unknown }
        if (got.aborted === true) return
        send({ done: true, model: typeof got.model === 'string' ? got.model : null, reply: typeof got.reply === 'string' ? got.reply : '' })
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
