// chrome.storage.local access for the new-tab page (per browser profile). Values are re-validated on every read.
import { normalizeSettings, normalizeShortcuts } from './newtab-logic.js'

const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})))
const set = (obj) => new Promise((res, rej) => chrome.storage.local.set(obj, () => (chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res())))

export async function load() {
  const v = await get(['orbisNtSettings', 'orbisNtShortcuts', 'orbisNtImage'])
  return { settings: normalizeSettings(v.orbisNtSettings), shortcuts: normalizeShortcuts(v.orbisNtShortcuts), image: typeof v.orbisNtImage === 'string' && v.orbisNtImage.startsWith('data:image/') ? v.orbisNtImage : '' }
}
export const saveSettings = (s) => set({ orbisNtSettings: s })
export const saveShortcuts = (l) => set({ orbisNtShortcuts: l })
export const saveImage = (dataUrl) => set({ orbisNtImage: dataUrl })
