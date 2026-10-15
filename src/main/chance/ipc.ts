import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import type { ChanceStore } from './store.ts'

export interface ChanceIpcOptions {
  store: ChanceStore
  getWindow(): BrowserWindow | null
}

/** Orbis Chance's access to its own saved work. One channel, two named operations. */
export function registerChanceIpc(o: ChanceIpcOptions): void {
  const handle = plainHandle(o)

  handle('chance:store', async (_event, operation, document) => {
    if (operation === 'load') return o.store.load()
    if (operation === 'save') {
      await o.store.save(document)
      return { saved: true }
    }
    throw new Error('Unknown operation.')
  })
}
