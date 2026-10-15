import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'

/**
 * The lookups some Toolkit tools make: response headers, a domain's registration, exchange rates, a video's details,
 * a key's validity, PDF editing. They were backend functions in the app these tools came from; they run here, in
 * this process, as the same code. A name outside this list is refused.
 */
const FUNCTIONS = {
  netCheck: () => import('./functions/netCheck.ts'),
  fxRates: () => import('./functions/fxRates.ts'),
  apiKeyCheck: () => import('./functions/apiKeyCheck.ts'),
  videoMeta: () => import('./functions/videoMeta.ts'),
  pdfTools: () => import('./functions/pdfTools.ts')
} as const

export function registerJarvisIpc(o: { getWindow(): BrowserWindow | null }): void {
  const handle = plainHandle(o)
  handle('jarvis:invoke', async (_event, name, payload) => {
    if (typeof name !== 'string' || !(name in FUNCTIONS)) return { error: 'That lookup is not available.' }
    const mod = await FUNCTIONS[name as keyof typeof FUNCTIONS]()
    const request = new Request('http://orbis.local/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {})
    })
    const response = await mod.default(request)
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return { error: 'The lookup returned something unreadable.' }
    }
  })
}
