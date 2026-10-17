/**
 * Talking to the Orbis helper from the full-tab music page.
 *
 * **Why this page holds the token itself, when the selection orb and Visual Search deliberately do not.**
 *
 * Those two features draw inside somebody else's web page. The drawing half runs in an isolated world next to
 * untrusted code, so it is given nothing: a second half in the extension's worker holds the address and this run's
 * secret, and decides for itself whether to honour a message. The split is the whole security model there, because
 * the page's claims are never the thing that is believed.
 *
 * This page is not that. It is the extension's own page, on the extension's own origin, and like the built-in Orbis
 * panel (orbis-ui/panel/helper.js, which has exactly this code) it can read `chrome.storage.session` itself. No web
 * page can reach that storage, no other extension can, and it is held in memory only and cleared when the browser
 * closes. A worker hop would move the secret from one trusted context into another trusted context and buy nothing,
 * while making every single list on the page wait for a message round trip. So the split is kept for the one thing
 * that genuinely needs the worker -- opening this tab, which needs `chrome.tabs.create` -- and nothing else.
 *
 * Nothing here writes the token anywhere, logs it, or puts it in an address.
 */

/** The address and the one-run secret, as the Orbis app wrote them the moment it started the browser. */
interface Helper {
  readonly port: number
  readonly token: string
}

let helper: Helper | null = null

/** Thrown when Orbis itself is not running, which is a different thing from a call going wrong. */
export class OrbisNotRunning extends Error {
  constructor(message = 'Orbis is not running. Start it and this page connects by itself.') {
    super(message)
    this.name = 'OrbisNotRunning'
  }
}

/** What a refused call carries back: the helper's own code and its own words, never words written here. */
export interface CallProblem {
  readonly code: string
  readonly message: string
}

async function connection(again = false): Promise<Helper> {
  if (helper && !again) return helper
  helper = null
  // The app writes these over the debugging pipe it already holds, a moment after the browser starts. A tab opened at
  // that very moment can beat the write, so this waits rather than reporting that Orbis is not running -- ten seconds
  // in quarter-second steps, which is what the panel's own helper does and for the same reason.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const stored = (await chrome.storage.session.get('orbis.helper'))['orbis.helper'] as Helper | undefined
      if (stored && typeof stored.port === 'number' && typeof stored.token === 'string') {
        helper = { port: stored.port, token: stored.token }
        return helper
      }
    } catch {
      // Session storage is unreadable, which on this origin means the extension is in a state where nothing will work.
      break
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new OrbisNotRunning()
}

/**
 * One call to one channel.
 *
 * The helper answers in lines rather than in one object: any number of `{ event }` lines while something is
 * happening, then exactly one `{ result }` or `{ error }`. None of the music channels send events today, so in
 * practice a music call is a single line -- but it is read line by line anyway, because a channel that starts
 * sending them should not need this file changed.
 *
 * A 401 means the browser was restarted under a new helper while this tab stayed open, so the address and secret are
 * read again and the call is tried once more. That retry is the difference between a long-lived page and a one-shot
 * worker, and it is why this page does not simply give up the way the selection orb's worker does.
 */
export async function call(channel: string, args: readonly unknown[] = [], options: { signal?: AbortSignal } = {}): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { port, token } = await connection(attempt > 0)
    let response: Response
    try {
      response = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, args }),
        signal: options.signal
      })
    } catch (err) {
      if (options.signal?.aborted) throw err
      if (attempt === 0) continue
      throw new OrbisNotRunning()
    }
    if ((response.status === 401 || response.status === 403) && attempt === 0) continue
    if (response.status === 401 || response.status === 403) throw new OrbisNotRunning()
    if (!response.body) {
      // A refusal before the handler ran is a plain JSON body, not lines. The helper's own words are kept.
      const body = (await response.json().catch(() => null)) as { error?: CallProblem } | null
      throw body?.error ?? { code: `http-${response.status}`, message: 'The helper refused that.' }
    }

    const reader = response.body.getReader()
    const decode = new TextDecoder()
    let rest = ''
    let outcome: { result?: unknown; error?: CallProblem } | null = null

    const take = (line: string): void => {
      if (line.trim() === '') return
      let parsed: { event?: unknown; result?: unknown; error?: CallProblem }
      try {
        parsed = JSON.parse(line) as typeof parsed
      } catch {
        return
      }
      if ('event' in parsed) return
      outcome = parsed
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

    const answer = outcome as { result?: unknown; error?: CallProblem } | null
    if (!answer) throw { code: 'no-answer', message: 'The helper stopped without answering.' } satisfies CallProblem
    if (answer.error) throw answer.error
    return answer.result
  }
  throw new OrbisNotRunning()
}

/** The words to put on screen for anything that came back from a call. Always a sentence, never an object. */
export function problemWords(err: unknown): string {
  if (err instanceof OrbisNotRunning) return err.message
  if (err && typeof err === 'object' && typeof (err as CallProblem).message === 'string') return (err as CallProblem).message
  if (err instanceof Error && err.message) return err.message
  return 'Orbis could not do that.'
}
