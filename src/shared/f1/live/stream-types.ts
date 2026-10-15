/**
 * What crosses from the stream service to the screen. Shared so both sides agree on it.
 */
import type { LiveSnapshot } from './snapshot.ts'

export type FeedConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped'

export type StreamPhase = 'idle' | 'connecting' | 'live' | 'last-session' | 'waiting' | 'stale' | 'disconnected' | 'replay' | 'loading'

export interface StreamStatus {
  source: 'live' | 'replay' | 'none'
  connection: FeedConnectionState
  phase: StreamPhase
  sessionStatus: string | null
  lastRecordAt: string | null
  ageMs: number | null
  reconnects: number
  records: number
  lastError: string | null
  /** One sentence in plain words about what the screen is showing. */
  message: string
  replay: { durationMs: number; t: number; playing: boolean; speed: number } | null
  loading: { done: number; total: number } | null
}

export interface LiveCar {
  number: string
  /** Position in the feed's own units. */
  x: number
  y: number
  z: number
  onTrack: boolean
  speed: number | null
  rpm: number | null
  gear: number | null
  throttle: number | null
  brake: number | null
  drs: number | null
}

export interface StreamEvent {
  status: StreamStatus
  snapshot: LiveSnapshot
  cars: LiveCar[]
  /** The circuit outline, only when one real lap of position readings allows it. */
  outline: { x: number; y: number }[] | null
}
