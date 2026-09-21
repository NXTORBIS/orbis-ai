// Per-profile storage for the new tab page (chrome://orbis-newtab keeps its own localStorage inside the browser profile).
// Values are re-validated on every read.
import { normalizeSettings, normalizeShortcuts } from './newtab-logic.js'

const get = async (keys) => Object.fromEntries(keys.map((k) => { try { const v = localStorage.getItem(k); return [k, v === null ? undefined : JSON.parse(v)] } catch { return [k, undefined] } }))
const set = async (obj) => { for (const [k, v] of Object.entries(obj)) localStorage.setItem(k, JSON.stringify(v)) }

export async function load() {
  const v = await get(['orbisNtSettings', 'orbisNtShortcuts', 'orbisNtImage'])
  return { settings: normalizeSettings(v.orbisNtSettings), shortcuts: normalizeShortcuts(v.orbisNtShortcuts), image: typeof v.orbisNtImage === 'string' && v.orbisNtImage.startsWith('data:image/') ? v.orbisNtImage : '' }
}
export const saveSettings = (s) => set({ orbisNtSettings: s })
export const saveShortcuts = (l) => set({ orbisNtShortcuts: l })
export const saveImage = (dataUrl) => set({ orbisNtImage: dataUrl })
