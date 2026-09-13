import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { NxtorbisApi, StreamEvent } from '../shared/types'

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
  pickTextFiles: () => ipcRenderer.invoke('files:pickText')
}

contextBridge.exposeInMainWorld('api', api)
