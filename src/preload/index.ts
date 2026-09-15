import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AdBlockEvent, NxtorbisApi, StreamEvent } from '../shared/types'

const api: NxtorbisApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (update) => ipcRenderer.invoke('settings:update', update),
  testApiKey: (apiKey) => ipcRenderer.invoke('settings:testKey', apiKey),
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  saveConversation: (conversation) => ipcRenderer.invoke('conversations:save', conversation),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  sendChat: (request) => ipcRenderer.invoke('chat:send', request),
  abortChat: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
  onChatEvent: (requestId, listener) => {
    const handler = (_event: IpcRendererEvent, id: string, streamEvent: StreamEvent): void => {
      if (id === requestId) listener(streamEvent)
    }
    ipcRenderer.on('chat:event', handler)
    return () => {
      ipcRenderer.removeListener('chat:event', handler)
    }
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getCpuUsage: () => ipcRenderer.invoke('system:cpu'),
  pickTextFiles: () => ipcRenderer.invoke('files:pickText'),
  pickImages: () => ipcRenderer.invoke('files:pickImages'),
  transcribeAudio: (audioBuffer) => ipcRenderer.invoke('voice:transcribe', audioBuffer),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('image:save', dataUrl, name),
  editImage: (request) => ipcRenderer.invoke('image:edit', request),
  onBrowserNewTab: (listener) => {
    const handler = (_event: IpcRendererEvent, url: string, options?: { background?: boolean }): void => listener(url, { background: options?.background === true })
    ipcRenderer.on('browser:new-tab', handler)
    return () => {
      ipcRenderer.removeListener('browser:new-tab', handler)
    }
  },
  popOutBrowser: (url) => ipcRenderer.invoke('browser:popout', url),
  clearBrowserData: () => ipcRenderer.invoke('browser:clear-data'),
  suggestFollowups: (messages) => ipcRenderer.invoke('chat:suggest', messages),
  generateTitle: (prompt) => ipcRenderer.invoke('chat:title', prompt),
  completeDraft: (draft, messages) => ipcRenderer.invoke('chat:complete', draft, messages),
  provideBrowserTarget: (requestId, webContentsId) => ipcRenderer.invoke('chat:browser-target', requestId, webContentsId),
  answerBrowserConfirmation: (requestId, confirmationId, approved) => ipcRenderer.invoke('chat:browser-confirm', requestId, confirmationId, approved),
  controlAutomation: (requestId, action) => ipcRenderer.invoke('automation:control', requestId, action),
  steerAutomation: (requestId, text) => ipcRenderer.invoke('automation:steer', requestId, text),
  classifyAutomationMessage: (text, objective) => ipcRenderer.invoke('automation:classify', text, objective),
  getAdBlockState: () => ipcRenderer.invoke('adblock:state'),
  updateAdBlockSettings: (update) => ipcRenderer.invoke('adblock:settings', update),
  setAdBlockSite: (host, allowed) => ipcRenderer.invoke('adblock:site', host, allowed),
  allowAdBlockResource: (url) => ipcRenderer.invoke('adblock:allow-resource', url),
  removeAdBlockException: (kind, value) => ipcRenderer.invoke('adblock:remove-exception', kind, value),
  getAdBlockReport: (webContentsId) => ipcRenderer.invoke('adblock:report', webContentsId),
  updateAdBlockFilters: () => ipcRenderer.invoke('adblock:update'),
  rollbackAdBlockFilters: () => ipcRenderer.invoke('adblock:rollback'),
  onAdBlockEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, event: AdBlockEvent): void => listener(event)
    ipcRenderer.on('adblock:event', handler)
    return () => {
      ipcRenderer.removeListener('adblock:event', handler)
    }
  },
  onBrowserShortcut: (listener) => subscribe('browser:shortcut', listener),
  setBrowserFocus: (focused) => ipcRenderer.send('browser:focus', focused),
  getBrowserLibrary: () => ipcRenderer.invoke('library:get'),
  onBrowserLibrary: (listener) => subscribe('library:changed', listener),
  toggleBookmark: (url, title) => ipcRenderer.invoke('library:toggle-bookmark', url, title),
  addBookmarks: (pages) => ipcRenderer.invoke('library:add-bookmarks', pages),
  removeBookmark: (url) => ipcRenderer.invoke('library:remove-bookmark', url),
  removeHistory: (url) => ipcRenderer.invoke('library:remove-history', url),
  clearHistory: () => ipcRenderer.invoke('library:clear-history'),
  getAuthState: () => ipcRenderer.invoke('auth:state'),
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('auth:cancel'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  onAuthState: (listener) => subscribe('auth:changed', listener),
  recordSearch: (query) => ipcRenderer.invoke('library:record-search', query),
  removeSearch: (query) => ipcRenderer.invoke('library:remove-search', query),
  clearSearches: () => ipcRenderer.invoke('library:clear-searches'),
  recordSuggestionPick: (key) => ipcRenderer.invoke('library:record-pick', key),
  webSuggestions: (query) => ipcRenderer.invoke('omnibox:web', query),
  predictQueries: (input) => ipcRenderer.invoke('omnibox:predict', input),
  downloadAction: (id, action) => ipcRenderer.invoke('library:download-action', id, action),
  clearDownloads: () => ipcRenderer.invoke('library:clear-downloads'),
  onBrowserDownload: (listener) => subscribe('browser:download', listener),
  onBrowserPermission: (listener) => subscribe('browser:permission', listener),
  answerBrowserPermission: (id, allow, remember) => ipcRenderer.invoke('browser:permission-answer', id, allow, remember),
  savePage: (webContentsId) => ipcRenderer.invoke('browser:save-page', webContentsId),
  setWindowFullscreen: (on) => ipcRenderer.invoke('window:fullscreen', on)
}

/** Listens on a channel whose events carry one value; returns the unsubscribe function. */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
