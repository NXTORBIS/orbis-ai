import { DOMMonitor } from '@ghostery/adblocker-content'

/**
 * Runs in every frame of every page. Network rules cannot hide an element or run a site-specific fix, so this asks the
 * Orbis ad-blocking engine (in the extension's worker: the same engine and lists the Electron build used) which
 * elements to hide: once when the frame starts, and again for the ids, classes and links of elements that appear later
 * (ads injected by scripts, infinite scrolling, single-page apps). Only the new features are sent, never the page.
 */
const send = (message: unknown): Promise<unknown> => chrome.runtime.sendMessage(message).catch(() => undefined)

let started = false
async function start(): Promise<void> {
  if (started) return
  started = true
  const enabled = await send({ type: 'adblock:cosmetics', phase: 'start' })
  if (enabled === false) return
  const monitor = new DOMMonitor((update) => {
    if (update.type !== 'features') return
    void send({ type: 'adblock:cosmetics', phase: 'dom', dom: { classes: update.classes, hrefs: update.hrefs, ids: update.ids } })
  })
  monitor.queryAll(window)
  monitor.start(window)
}

if (location.protocol.startsWith('http')) void start()
