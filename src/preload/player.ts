import { contextBridge, ipcRenderer } from 'electron'

/**
 * The bridge for the hidden Orbis Music player window.
 *
 * Four things, and nothing else: hear a command, say what the audio element reports, say a track finished, say the
 * player is ready. The player page has no business reading the library, touching files or reaching the network, so
 * none of that is here -- it cannot ask for what it is not given.
 */

export interface PlayerBridge {
  onCommand(listener: (command: unknown) => void): void
  report(state: unknown): void
  finished(trackId: string | null): void
  /** What a track sounds like, measured from its samples, or why it could not be. */
  measured(trackId: string, features: unknown, problem: string | null): void
  ready(): void
}

const bridge: PlayerBridge = {
  onCommand: (listener) => {
    ipcRenderer.on('music:player-command', (_event, command: unknown) => listener(command))
  },
  report: (state) => ipcRenderer.send('music:player-report', state),
  finished: (trackId) => ipcRenderer.send('music:player-finished', trackId),
  measured: (trackId, features, problem) => ipcRenderer.send('music:player-measured', trackId, features, problem),
  ready: () => ipcRenderer.send('music:player-ready')
}

contextBridge.exposeInMainWorld('player', bridge)
