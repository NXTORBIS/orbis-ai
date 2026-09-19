// Talking to the Orbis helper running on this computer.
//
// The helper writes its port and this run's secret token to helper.json inside this extension's own folder. Only the
// extension can read that file (it is not listed as a web-accessible resource, so no webpage can fetch it), and the
// token is what the helper checks on every request. Nothing here logs or stores the token anywhere else.

let cached = null

async function connection(force = false) {
  if (cached && !force) return cached
  let response
  try {
    response = await fetch(chrome.runtime.getURL('helper.json'), { cache: 'no-store' })
  } catch {
    throw new HelperDown('Orbis is not running. Start it from run-orbis-chromium.bat.')
  }
  if (!response.ok) throw new HelperDown('Orbis is not running. Start it from run-orbis-chromium.bat.')
  const { port, token } = await response.json()
  cached = { url: `http://127.0.0.1:${port}/rpc`, token }
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
