import { webContents } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import type { BrowserLibrary } from '../browserLibrary'
import type { WindowControl } from '../browserControl/window'
import { CAPTURE_SCRIPT, RecorderCore, STOP_SCRIPT } from './recorderCore'
import type { RecordingState } from './recorderCore'

export type { RecordingState }

/** The recorder on Orbis's Electron webviews (goes away with them; the shared logic is in recorderCore.ts). */
export class WorkflowRecorder extends RecorderCore {
  private readonly o: { getWindow(): BrowserWindow | null; windowControl: WindowControl; library: BrowserLibrary; emit(state: RecordingState): void }
  private readonly attached = new Map<number, () => void>()
  private stopState: (() => void) | null = null
  private restoreLibrary: (() => void) | null = null
  private libraryTimer: NodeJS.Timeout | null = null

  constructor(options: WorkflowRecorder['o']) {
    super(options.emit)
    this.o = options
  }

  protected begin(): void {
    this.lastState = this.o.windowControl.state
    this.downloadsBefore = new Set(this.o.library.snapshot().downloads.map((d) => d.id))
    const host = this.o.getWindow()?.webContents
    for (const contents of webContents.getAllWebContents()) if (contents.getType() === 'webview' && contents.hostWebContents === host) this.attach(contents)
    this.stopState = this.o.windowControl.onState((next) => this.onBrowserState(next))
    this.restoreLibrary = this.o.library.addListener(() => {
      if (this.libraryTimer) return
      this.libraryTimer = setTimeout(() => {
        this.libraryTimer = null
        this.onDownloads(this.o.library.snapshot().downloads)
      }, 300)
    })
  }

  protected end(): void {
    for (const detach of this.attached.values()) detach()
    this.attached.clear()
    this.stopState?.()
    this.stopState = null
    this.restoreLibrary?.()
    this.restoreLibrary = null
    if (this.libraryTimer) clearTimeout(this.libraryTimer)
  }

  protected setCapture(on: boolean): void {
    for (const id of this.attached.keys()) {
      const contents = webContents.fromId(id)
      if (contents && !contents.isDestroyed()) void contents.executeJavaScript(on ? CAPTURE_SCRIPT : STOP_SCRIPT).catch(() => undefined)
    }
  }

  /** A tab's page, while recording: capture in it now and after each load. */
  attach(contents: WebContents): void {
    if (!this.state.active || this.attached.has(contents.id)) return
    const inject = (): void => {
      if (!this.state.paused && !contents.isDestroyed()) void contents.executeJavaScript(CAPTURE_SCRIPT).catch(() => undefined)
    }
    const onConsole = (event: unknown, ...legacy: unknown[]): void => {
      const e = event as { message?: string }
      const parsed = this.parseMessage(String(e.message ?? legacy[1] ?? ''))
      if (parsed) this.onPageEvent(contents.id, parsed)
    }
    contents.on('dom-ready', inject)
    contents.on('console-message', onConsole as never)
    inject()
    this.attached.set(contents.id, () => {
      if (contents.isDestroyed()) return
      contents.removeListener('dom-ready', inject)
      contents.removeListener('console-message', onConsole as never)
      void contents.executeJavaScript(STOP_SCRIPT).catch(() => undefined)
    })
    contents.once('destroyed', () => this.attached.delete(contents.id))
  }
}
