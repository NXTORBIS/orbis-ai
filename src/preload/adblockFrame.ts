import { ipcRenderer, webFrame } from 'electron'

/**
 * Runs in every frame of the in-app browser. When ad blocking gets stronger, resources a page loaded while blocking was
 * off can still sit in this renderer's in-memory cache, and loads served from it never reach the request filter. Orbis
 * asks each tab to drop that cache, so the next page load is filtered. Nothing is reloaded.
 */
ipcRenderer.on('orbis-adblock:clear-memory-cache', () => webFrame.clearCache())
