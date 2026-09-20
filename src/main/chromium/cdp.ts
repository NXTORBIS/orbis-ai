import { EventEmitter } from 'node:events'

/**
 * A connection to the Chromium browser's own remote-debugging protocol (Chrome DevTools Protocol), the same protocol
 * DevTools itself speaks. This is how the Browser Control Layer reaches real Chromium tabs. It is a thin, honest wire:
 * every command is really sent, every answer really comes back, and if the browser goes away, everything pending fails.
 */
export class CdpError extends Error {
  readonly code?: number
  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

export interface CdpEvent {
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

export class CdpConnection extends EventEmitter {
  private nextId = 1
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(err: Error): void; timer: NodeJS.Timeout }>()
  private closed = false

  private readonly ws: WebSocket

  private constructor(ws: WebSocket) {
    super()
    this.ws = ws
    ws.addEventListener('message', (message) => this.onMessage(String(message.data)))
    ws.addEventListener('close', () => this.onClose())
    ws.addEventListener('error', () => this.onClose())
  }

  static async open(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CdpError('The browser did not accept the connection.')), timeoutMs)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new CdpError('Could not connect to the browser.'))
      })
    })
    return new CdpConnection(ws)
  }

  get isOpen(): boolean {
    return !this.closed
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new CdpError('The browser connection is closed.'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpError(`${method} did not answer in ${Math.round(timeoutMs / 1000)}s.`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  close(): void {
    this.onClose()
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }

  private onMessage(text: string): void {
    let message: { id?: number; result?: unknown; error?: { message: string; code: number }; method?: string; params?: Record<string, unknown>; sessionId?: string }
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new CdpError(message.error.message, message.error.code))
      else entry.resolve(message.result ?? {})
    } else if (message.method) {
      this.emit('event', { method: message.method, params: message.params ?? {}, sessionId: message.sessionId } satisfies CdpEvent)
    }
  }

  private onClose(): void {
    if (this.closed) return
    this.closed = true
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new CdpError('The browser connection closed.'))
    }
    this.pending.clear()
    this.emit('close')
  }
}
