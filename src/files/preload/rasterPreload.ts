import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * Preload of the hidden page that renders PDF pages for text recognition
 * (dist/raster/raster.html). It exposes only this narrow channel pair: jobs from
 * the main process and their replies. The page has none of the app's IPC.
 */
contextBridge.exposeInMainWorld('orbisRaster', {
  onJob(listener: (job: unknown) => void): void {
    ipcRenderer.on('raster:job', (_e: IpcRendererEvent, job: unknown) => listener(job));
  },
  reply(id: number, value: unknown): void {
    ipcRenderer.send('raster:reply', { id, ok: true, value });
  },
  fail(id: number, message: string): void {
    ipcRenderer.send('raster:reply', { id, ok: false, message: String(message).slice(0, 600) });
  },
  ready(): void {
    ipcRenderer.send('raster:ready');
  },
});
