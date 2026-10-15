import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { isEventChannel, isInvokeChannel } from '../shared/ipc';

/**
 * The only bridge between the sandboxed UI and the main process. It forwards
 * allow-listed channels and nothing else: no Node APIs, no raw ipcRenderer.
 */

function initialPath(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--orbis-initial-path='));
  if (!arg) return undefined;
  try {
    return atob(arg.slice('--orbis-initial-path='.length));
  } catch {
    return undefined;
  }
}

const api = {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!isInvokeChannel(channel)) return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, payload ?? {});
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!isEventChannel(channel)) throw new Error(`Event not allowed: ${channel}`);
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  /** Absolute path of a file dropped from the operating system (Electron ≥ 32 API). */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  platform: process.platform,
  initialPath: initialPath(),
};

contextBridge.exposeInMainWorld('orbis', api);

export type OrbisBridge = typeof api;
