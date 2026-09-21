// Talking to the Orbis helper running on this computer.
//
// Where the port and this run's secret token come from depends on where this runs:
//  - in the built-in chrome://orbis page, from the browser itself: the page asks with chrome.send('orbis.getHelper') and only
//    that page is ever answered (the browser never puts them in an address or in any other page);
//  - in an extension page (only when developing with ORBIS_DEV_EXTENSION=1), from the extension worker's
//    session storage, which only the extension can read and which lives in memory only.
// The token is what the helper checks on every request. Nothing here logs or stores the token anywhere else.

let cached = null
// Shared by every copy of this file on the page (a bundled page script and a module each carry one), so a reply is always delivered
// to the copy that asked.
const webUi = (globalThis.__orbisWebUi ??= { next: 1, callbacks: new Map() })
const webUiCallbacks = webUi.callbacks

// The browser answers chrome.send('orbis.getHelper') by calling cr.webUIResponse(id, ok, value).
if (typeof chrome !== 'undefined' && typeof chrome.send === 'function' && !(globalThis.cr && globalThis.cr.webUIResponse)) {
  globalThis.cr = globalThis.cr || {}
  globalThis.cr.webUIResponse = (id, ok, value) => {
    const waiting = webUiCallbacks.get(id)
    if (!waiting) return
    webUiCallbacks.delete(id)
    ok ? waiting.resolve(value) : waiting.reject(value)
  }
}

// Asks the browser's built-in Orbis handler (C++, chrome://orbis*) something and waits for its answer.
export function askBrowser(message, ...args) {
  return new Promise((resolve, reject) => {
    const id = `orbis${webUi.next++}`
    webUiCallbacks.set(id, { resolve, reject })
    chrome.send(message, [id, ...args])
  })
}
const fromBrowser = () => askBrowser('orbis.getHelper')

async function fromExtension() {
  // The worker sets this a moment after the browser starts; a page opened at that very moment waits briefly for it.
  for (let i = 0; i < 40; i++) {
    const stored = (await chrome.storage.session.get('orbis.helper'))['orbis.helper']
    if (stored && stored.port && stored.token) return stored
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

// TEST ONLY: the panel checked in an ordinary browser tab, served by scripts/panel-ui-check.mjs. The handoff is the address
//   http://127.0.0.1:<page port>/index.html?orbis-test-helper=<helper port>#<token>
// and is accepted only on an http: page whose host is exactly 127.0.0.1. In the shipped built-in page (chrome://orbis) the protocol is
// chrome:, so this returns null and the browser's own handoff above is the only way in; it cannot weaken it.
function fromTestAddress() {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return null
  const port = new URLSearchParams(location.search).get('orbis-test-helper') || ''
  const token = location.hash.slice(1)
  return /^\d{2,5}$/.test(port) && /^[\w-]{16,200}$/.test(token) ? { port: Number(port), token } : null
}

async function connection(force = false) {
  if (cached && !force) return cached
  let found = fromTestAddress()
  try {
    if (!found) found = typeof chrome !== 'undefined' && chrome.storage?.session ? await fromExtension() : typeof chrome !== 'undefined' && chrome.send ? await fromBrowser() : null
  } catch {
    found = null
  }
  if (!found || !found.port || !found.token) throw new HelperDown('Orbis is not running. Start it from run-orbis-chromium.bat.')
  cached = { url: `http://127.0.0.1:${found.port}/rpc`, token: found.token }
  return cached
}

export class HelperDown extends Error {}

/**
 * Calls one channel. `onEvent` receives each streamed event as it arrives; the returned promise resolves with the
 * final result or rejects with { code, message }. Aborting the signal (the Stop button) ends the request, which tells
 * the helper to stop too.
 */
export async function call(channel, args = [], { onEvent, signal } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { url, token } = await connection(attempt > 0)
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, args }),
        signal
      })
    } catch (err) {
      if (signal?.aborted) throw err
      // The helper may have been restarted with a new port and token; read them again once before giving up.
      if (attempt === 0) continue
      throw new HelperDown('Orbis is not running. Start it from run-orbis-chromium.bat.')
    }
    if (response.status === 401 && attempt === 0) continue
    if (!response.ok && !response.body) throw { code: `http-${response.status}`, message: 'The helper refused that.' }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    let outcome = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        if (!line) continue
        const message = JSON.parse(line)
        if ('event' in message) onEvent?.(message.event)
        else outcome = message
      }
    }
    if (!outcome) throw { code: 'no-answer', message: 'The helper stopped without answering.' }
    if ('error' in outcome) throw outcome.error
    return outcome.result
  }
  throw new HelperDown('Orbis could not sign in to its helper.')
}
