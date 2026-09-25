import { launchOrbisChromium } from '../../main/chromium/service.ts'
import type { ChromiumControl } from '../../main/chromium/service.ts'
import type { BrowserConfirmation } from '../../shared/types'
import type { PageHandle } from '../../main/pageHandle.ts'

/**
 * The helper's own browser.
 *
 * This is the bridge that was missing. Every capability Orbis has for driving a browser -- a hundred of them, from
 * `tabs.create` to `page.click` to `downloads.list` -- was already written, already tested, and already free of
 * Electron. What none of it had, once Orbis became its own Chromium, was a connection: the helper ran beside a browser
 * it could not reach, so anything asked of the browser failed with "The browser is not ready."
 *
 * So the helper starts the browser. Chromium becomes a child process, connected over the pipe `--remote-debugging-pipe`
 * gives its parent, and the whole control layer is registered on that connection. Nothing listens on the network for
 * this: a debugging port would let any program on the computer drive the browser, and a page in the browser could reach
 * it too. Only the process holding the pipe can, and that is the helper.
 *
 * The helper does not decide what to do with the browser. It holds the connection and answers for it; Orion decides,
 * the control layer checks, and the person approves anything consequential.
 */

export interface BrowserHostOptions {
  /** The Chromium executable Orbis runs. */
  chrome: string
  /** This profile's browser data folder. */
  profileDir: string
  /** Development only: the Orbis extension as an unpacked folder. */
  extensionDir?: string
  /** The Orbis extension's fixed id. */
  extensionId: string
  /** Pages to open at start. */
  urls?: string[]
  /** Anything else for the browser's command line. */
  args?: string[]
  /** Called when the browser goes away, so the helper can stop offering what it can no longer do. */
  onClosed?: () => void
}

/** What the handlers may use. Deliberately small: the connection is not handed out. */
export interface BrowserHost {
  readonly control: ChromiumControl['control']
  readonly agent: ChromiumControl['agent']
  readonly bridge: ChromiumControl['bridge']
  /** True while the browser is really there. Everything else checks this first. */
  readonly alive: boolean
  stop(): void
}

class LiveBrowserHost implements BrowserHost {
  private closed = false
  // Written out rather than declared in the constructor: the helper runs as TypeScript stripped of its types, and a
  // parameter property is a type that also does something, which stripping cannot keep.
  private readonly service: ChromiumControl & { process: { kill(): boolean } }

  constructor(service: ChromiumControl & { process: { kill(): boolean } }) {
    this.service = service
  }

  get control(): ChromiumControl['control'] {
    return this.service.control
  }
  get agent(): ChromiumControl['agent'] {
    return this.service.agent
  }
  get bridge(): ChromiumControl['bridge'] {
    return this.service.bridge
  }
  get alive(): boolean {
    return !this.closed
  }
  markClosed(): void {
    this.closed = true
  }
  stop(): void {
    this.closed = true
    this.service.stop()
  }
}

/**
 * Starts Chromium and the control layer on it. Rejects if the browser cannot be started or cannot be reached: a host
 * that exists but controls nothing would report every capability as available and fail at each one.
 */
export async function startBrowserHost(o: BrowserHostOptions): Promise<BrowserHost> {
  let host: LiveBrowserHost | undefined
  const service = await launchOrbisChromium({
    chrome: o.chrome,
    profileDir: o.profileDir,
    extensionDir: o.extensionDir,
    extensionId: o.extensionId,
    urls: o.urls,
    args: o.args,
    onClosed: () => {
      host?.markClosed()
      o.onClosed?.()
    }
  })
  host = new LiveBrowserHost(service)
  return host
}

/**
 * The confirmations a task is waiting on.
 *
 * A task runs on one request and streams what it is doing; the answer to "may I?" arrives on a different request,
 * because a streamed answer has no way back up. This keeps the two ends together, and it is the only way an approval
 * can be given: an action waits here until the person says yes, and is refused if they say no or if the task ends.
 */
export class PendingApprovals {
  private readonly waiting = new Map<string, (approved: boolean) => void>()

  ask(confirmation: BrowserConfirmation, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean): void => {
        if (!this.waiting.delete(confirmation.id)) return
        resolve(approved)
      }
      this.waiting.set(confirmation.id, settle)
      // A task that is stopped does not leave an action hanging on an approval nobody will give.
      signal.addEventListener('abort', () => settle(false), { once: true })
    })
  }

  /**
   * Returns false when nothing was waiting for that id, so a stray answer is not mistaken for an approval.
   *
   * Only a literal `true` approves. The answer arrives over a wire and is whatever the caller sent; anything else --
   * the string "yes", a 1, an object -- is a no. A gate that accepted whatever looked truthy would be a gate that let
   * a malformed message spend somebody's money.
   */
  answer(id: string, approved: boolean): boolean {
    const settle = this.waiting.get(id)
    if (!settle) return false
    settle(approved === true)
    return true
  }

  get size(): number {
    return this.waiting.size
  }
}

/** The tab a task works on: the one the person is looking at. Throws with the reason when there is no browser. */
export async function targetPage(host: BrowserHost | null | undefined): Promise<PageHandle> {
  if (!host || !host.alive) throw new Error('The Orbis browser is not open.')
  return host.agent.getTarget()
}
