/**
 * A minimal SignalR Core client, just enough for Formula 1's public live-timing stream.
 *
 * What it speaks: POST /negotiate, a WebSocket with the connection token, the JSON hub protocol (records end with
 * 0x1E), one invocation (`Subscribe` with the feed names) whose completion carries the current state of every feed,
 * and then `feed` messages carrying changes. Ping records keep the connection alive.
 *
 * It does not know about timing: it hands (feed, change) pairs to a callback. Electron-free and given its network
 * pieces as parameters, so reconnecting, silence detection and protocol handling are tested with a fake socket.
 *
 * The stream is unofficial (the same one F1's own web app and the FastF1 project use); it needs no account or key.
 */

const RS = '\u001e'

import type { FeedConnectionState } from '../../../shared/f1/live/stream-types.ts'
export type { FeedConnectionState }

export interface SocketLike {
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (ev: { data?: unknown; code?: number; reason?: string }) => void): void
}
export type SocketFactory = (url: string, init: { headers: Record<string, string> }) => SocketLike

export interface NegotiateResponse {
  ok: boolean
  status: number
  cookies: string
  body: { connectionToken?: string; connectionId?: string } | null
}

export interface FeedClientOptions {
  feeds: string[]
  /** POSTs to the negotiate address and answers what came back. */
  negotiate: () => Promise<NegotiateResponse>
  /** The WebSocket address for a token. */
  socketUrl: (token: string) => string
  socket: SocketFactory
  onSnapshot: (state: Record<string, unknown>) => void
  onChange: (feed: string, change: unknown) => void
  onState: (state: FeedConnectionState, detail?: string) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** No record at all for this long means the connection is dead even though the socket is open. */
  silenceMs?: number
  pingEveryMs?: number
}

export class FeedClient {
  private socket: SocketLike | null = null
  private wanted = false
  private attempt = 0
  private lastRecordAt = 0
  private pingTimer: unknown = null
  private watchTimer: unknown = null
  private retryTimer: unknown = null
  private readonly o: Required<Omit<FeedClientOptions, 'feeds' | 'negotiate' | 'socketUrl' | 'socket' | 'onSnapshot' | 'onChange' | 'onState'>> & FeedClientOptions
  /** Counts for the diagnostics panel. */
  readonly stats = { reconnects: 0, records: 0, lastRecordAt: null as number | null, lastError: null as string | null }

  constructor(options: FeedClientOptions) {
    this.o = {
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      silenceMs: 45_000,
      pingEveryMs: 15_000,
      ...options
    }
  }

  start(): void {
    if (this.wanted) return
    this.wanted = true
    this.attempt = 0
    void this.connect()
  }

  stop(): void {
    this.wanted = false
    this.teardown()
    this.o.onState('stopped')
  }

  /** The wait before reconnect number `attempt`: 1 s, 2 s, 4 s ... capped at 30 s. */
  static backoff(attempt: number): number {
    return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1))
  }

  private teardown(): void {
    if (this.pingTimer !== null) this.o.clearTimer(this.pingTimer)
    if (this.watchTimer !== null) this.o.clearTimer(this.watchTimer)
    if (this.retryTimer !== null) this.o.clearTimer(this.retryTimer)
    this.pingTimer = this.watchTimer = this.retryTimer = null
    const s = this.socket
    this.socket = null
    try {
      s?.close()
    } catch {
      // already closed
    }
  }

  private fail(why: string): void {
    this.stats.lastError = why
    this.teardown()
    if (!this.wanted) return
    this.attempt += 1
    this.stats.reconnects += 1
    this.o.onState('reconnecting', why)
    this.retryTimer = this.o.setTimer(() => void this.connect(), FeedClient.backoff(this.attempt))
  }

  private async connect(): Promise<void> {
    if (!this.wanted) return
    this.o.onState(this.attempt === 0 ? 'connecting' : 'reconnecting')
    let neg: NegotiateResponse
    try {
      neg = await this.o.negotiate()
    } catch {
      return this.fail('The live-timing service could not be reached.')
    }
    if (!this.wanted) return
    const token = neg.body?.connectionToken
    if (!neg.ok || !token) return this.fail(`The live-timing service refused the connection (${neg.status}).`)

    let socket: SocketLike
    try {
      socket = this.o.socket(this.o.socketUrl(token), { headers: { 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip,identity', ...(neg.cookies ? { Cookie: neg.cookies } : {}) } })
    } catch {
      return this.fail('The live-timing connection could not be opened.')
    }
    this.socket = socket
    this.lastRecordAt = this.o.now()
    let handshaken = false

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS)
    })
    socket.addEventListener('message', (ev) => {
      this.lastRecordAt = this.o.now()
      this.stats.lastRecordAt = this.lastRecordAt
      for (const part of String(ev.data ?? '').split(RS)) {
        if (!part) continue
        let m: Record<string, unknown>
        try {
          m = JSON.parse(part) as Record<string, unknown>
        } catch {
          continue
        }
        this.stats.records += 1
        if (!handshaken) {
          handshaken = true
          if (typeof m.error === 'string') return this.fail(`The live-timing service rejected the handshake: ${m.error}`)
          socket.send(JSON.stringify({ type: 1, invocationId: '1', target: 'Subscribe', arguments: [this.o.feeds] }) + RS)
          continue
        }
        this.handle(m)
      }
    })
    socket.addEventListener('error', () => this.fail('The live-timing connection had an error.'))
    socket.addEventListener('close', () => {
      if (this.wanted && this.socket === socket) this.fail('The live-timing connection closed.')
    })

    const schedule = (): void => {
      this.pingTimer = this.o.setTimer(() => {
        try {
          this.socket?.send(JSON.stringify({ type: 6 }) + RS)
        } catch {
          // the close handler will deal with it
        }
        schedule()
      }, this.o.pingEveryMs)
    }
    schedule()
    const watch = (): void => {
      this.watchTimer = this.o.setTimer(() => {
        if (this.o.now() - this.lastRecordAt > this.o.silenceMs) return this.fail('The live-timing connection went silent.')
        watch()
      }, Math.min(5000, this.o.silenceMs))
    }
    watch()
  }

  private handle(m: Record<string, unknown>): void {
    const type = m.type
    if (type === 3) {
      // Completion of Subscribe: the current state of every feed.
      if (typeof m.error === 'string') return this.fail(`The live-timing subscription failed: ${m.error}`)
      this.attempt = 0
      this.o.onState('connected')
      const result = m.result
      if (result && typeof result === 'object') this.o.onSnapshot(result as Record<string, unknown>)
    } else if (type === 1 && m.target === 'feed' && Array.isArray(m.arguments)) {
      const [feed, change] = m.arguments as [unknown, unknown]
      if (typeof feed === 'string') this.o.onChange(feed, change)
    } else if (type === 7) {
      this.fail('The live-timing service closed the connection.')
    }
    // type 6 is the service's ping; nothing to do.
  }
}
