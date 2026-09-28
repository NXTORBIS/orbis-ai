/**
 * The bridge a Page talks to, and the only way out of its box.
 *
 * This runs in the Page's frame but in a separate JavaScript world, so the Page can call what is exposed here and cannot
 * reach anything else -- not `require`, not `ipcRenderer`, not the objects this file closes over. That separation is what
 * `contextIsolation` buys, and it is why the whole surface is one function.
 *
 * ## What is deliberately absent
 *
 * - **Any way to say who you are.** A Page sends an operation and a payload. There is no page id, no capability list and
 *   no trust level, because the host attaches all three from the frame the message arrived on. A Page that could name
 *   itself could name another Page.
 * - **Any way to send code.** The payload is cloned across the boundary, and a function does not survive being cloned.
 *   A Page that wants a model evaluated sends an expression as text and the trusted side compiles it with an
 *   interpreter.
 * - **Any second channel.** One channel, one handler, one place where the checks happen.
 *
 * ## What it does on the Page's behalf
 *
 * Correlation ids are generated here rather than accepted from the Page, so two calls cannot collide on one id and get
 * each other's answers. Pending calls are bounded, because a Page that fires requests in a loop would otherwise grow
 * this map until the frame runs out of memory -- and it would be this file's fault, not the Page's.
 */

import { contextBridge, ipcRenderer } from 'electron'

const REQUEST = 'orbis-page:request'
const REPLY = 'orbis-page:reply'
const READY = 'orbis-page:ready'

/** Matches the host's ceiling. Kept in step by being the same number in both places, stated in both. */
const MAX_PENDING = 8
/** How long the bridge waits before giving up on a reply. Longer than the host's own limit, so the host answers first. */
const REPLY_TIMEOUT_MS = 20_000

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Pending>()
let counter = 0

ipcRenderer.on(REPLY, (_event, payload: unknown) => {
  if (typeof payload !== 'object' || payload === null) return
  const record = payload as { id?: unknown; ok?: unknown; message?: unknown }
  if (typeof record.id !== 'string') return
  const waiting = pending.get(record.id)
  if (!waiting) return
  pending.delete(record.id)
  clearTimeout(waiting.timer)

  if (record.ok === true) {
    waiting.resolve((payload as { value?: unknown }).value ?? null)
    return
  }
  // A refusal comes back as a rejection, so a Page can use try/catch rather than checking a flag it might forget.
  const error = new Error(typeof record.message === 'string' ? record.message : 'That request was refused.')
  error.name = typeof (payload as { error?: unknown }).error === 'string' ? String((payload as { error: string }).error) : 'refused'
  waiting.reject(error)
})

/**
 * One request to Orbis.
 *
 * Resolves with the answer, or rejects with a message written for the person using the Page. The `name` of a rejection
 * is the reason -- `not-allowed`, `rate-limited`, `bad-input` and so on -- so a Page can tell "you did not ask for this
 * capability" apart from "that number was not a number".
 */
async function request(operation: unknown, payload: unknown): Promise<unknown> {
  if (typeof operation !== 'string' || operation === '') {
    throw new Error('An operation name is needed.')
  }
  if (pending.size >= MAX_PENDING) {
    throw new Error(`This Page already has ${MAX_PENDING} requests waiting, which is as many as it may have at once.`)
  }

  // Generated here, never taken from the Page: two calls sharing an id would get each other's answers.
  counter += 1
  const id = `${counter}`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Orbis did not answer that request in time.'))
    }, REPLY_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })

    try {
      // Structured-cloned across the boundary. A function does not survive that, which is the point.
      ipcRenderer.send(REQUEST, { id, operation, payload })
    } catch (cause) {
      pending.delete(id)
      clearTimeout(timer)
      // Almost always a payload holding something that cannot be cloned, which is worth saying plainly.
      reject(new Error(cause instanceof Error ? `That request could not be sent: ${cause.message}` : 'That request could not be sent.'))
    }
  })
}

contextBridge.exposeInMainWorld('orbis', {
  /** Ask Orbis to do something. The only way out of this Page. */
  request,
  /**
   * Tell Orbis this Page has finished starting.
   *
   * Nothing is accepted before this, and a Page that never calls it is stopped: a Page that never starts is one whose
   * code failed before it ran, and leaving it there looking like it is about to work helps nobody.
   */
  ready(): void {
    ipcRenderer.send(READY)
  }
})
