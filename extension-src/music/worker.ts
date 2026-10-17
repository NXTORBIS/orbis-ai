/**
 * The one thing the music page needs a worker for: opening itself.
 *
 * The page talks to Orbis directly, because it is the extension's own page on the extension's own origin and can read
 * the helper's address out of session storage the way the built-in Orbis panel does. The reasoning is written out at
 * the top of `helper.ts`.
 *
 * What it cannot do is open a tab. `chrome.tabs.create` exists only in the extension's worker, and the helper's own
 * way of opening an address refuses anything that is not http or https -- deliberately, so nothing Orbis is asked to
 * open can be an extension page. So the panel, the start page and the Orb ask this worker instead, and it is the only
 * side that can turn that request into a tab.
 *
 * It honours exactly one message and ignores everything else. Anything arriving from a web page is dropped: a message
 * with no sender id, or one from a sender that is not this extension, never gets as far as the tab call.
 */

const PAGE = 'music.html'

interface OpenMessage {
  readonly kind: 'orbis-music/open'
  /** Which screen to land on, as the page's own address reads it, e.g. '#/library'. Optional. */
  readonly at?: string
}

const isOpen = (message: unknown): message is OpenMessage =>
  typeof message === 'object' && message !== null && (message as { kind?: unknown }).kind === 'orbis-music/open'

/** A screen name and nothing else. An address handed in from elsewhere is never put into a tab unchecked. */
const safeAt = (at: unknown): string => (typeof at === 'string' && /^#\/[a-z-]{1,24}(\/[^\s"']{0,200})?$/.test(at) ? at : '')

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!isOpen(message)) return undefined
  // Only this extension's own pages may ask. A content script in a web page has a tab but belongs to a page, so it is
  // refused: it would be a web page choosing to open an Orbis screen.
  if (sender.id !== chrome.runtime.id || sender.tab) {
    reply({ ok: false, message: 'Only Orbis can open Orbis Music.' })
    return true
  }
  const url = chrome.runtime.getURL(PAGE) + safeAt(message.at)
  // One tab, not one per press: a music page already open is brought forward with the asked-for screen, because two
  // tabs each playing their own idea of what is playing is exactly the confusion this page is built to avoid.
  void (async () => {
    try {
      const open = await chrome.tabs.query({ url: chrome.runtime.getURL(PAGE) })
      const already = open[0]
      if (already?.id !== undefined) {
        await chrome.tabs.update(already.id, { active: true, url })
        if (already.windowId !== undefined) await chrome.windows.update(already.windowId, { focused: true })
      } else {
        await chrome.tabs.create({ url, active: true })
      }
      reply({ ok: true })
    } catch (err) {
      reply({ ok: false, message: err instanceof Error ? err.message : 'Orbis Music could not be opened.' })
    }
  })()
  return true
})
