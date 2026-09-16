import { useCallback, useEffect, useRef, useState } from 'react'
import { voiceInput } from '../lib/voiceInput'
import { isCapturing } from '../../../shared/voiceInput'
import type { VoiceInputConfig, VoiceState, VoiceTarget } from '../../../shared/voiceInput'

/**
 * A microphone, for one input.
 *
 * Every microphone in Orbis uses this, and this uses the one voice service, so there is a single implementation of
 * recording and a single place speech becomes text. What it adds is the part that is particular to an input: the
 * transcript it returns is only ever this input's, because the service is asked whether the session running is the
 * one this input started.
 */

export interface VoiceInputHandle {
  /** This input is the one recording. Another input recording leaves this false. */
  recording: boolean
  /** This input's recording is being transcribed. */
  transcribing: boolean
  state: VoiceState
  /** How long this input has been recording, for showing the time. */
  recordingMs: number
  /** Why the last attempt stopped, when it stopped badly. Cleared when another starts. */
  error: string | null
  /** Whether this machine can record at all; a microphone button is not offered when it cannot. */
  available: boolean
  /** Starts, or stops and returns the words. Null when there are none — cancelled, silence, or a failure. */
  toggle(): Promise<string | null>
  cancel(): Promise<void>
}

export function useVoiceInput(target: VoiceTarget, options: { inputId?: string; config?: Partial<VoiceInputConfig> } = {}): VoiceInputHandle {
  const [status, setStatus] = useState(() => voiceInput.getStatus())
  const [available, setAvailable] = useState(false)
  const { inputId } = options
  const config = useRef(options.config)
  config.current = options.config

  useEffect(() => voiceInput.onChange(setStatus), [])
  useEffect(() => {
    let alive = true
    void voiceInput.isAvailable().then((can) => alive && setAvailable(can))
    return () => {
      alive = false
    }
  }, [])

  // A session belonging to another input is none of this one's business.
  const mine = voiceInput.isFor(target, inputId)

  const toggle = useCallback(async (): Promise<string | null> => {
    if (mine && isCapturing(status.state)) return voiceInput.stop()
    await voiceInput.start({ target, ...(inputId ? { inputId } : {}), ...(config.current ? { config: config.current } : {}) })
    return null
  }, [mine, status.state, target, inputId])

  const cancel = useCallback(async (): Promise<void> => {
    if (mine) await voiceInput.cancel()
  }, [mine])

  // Leaving the screen mid-recording releases the microphone rather than leaving it open.
  useEffect(() => {
    return () => {
      if (voiceInput.isFor(target, inputId) && isCapturing(voiceInput.getState())) void voiceInput.cancel()
    }
  }, [target, inputId])

  return {
    recording: mine && isCapturing(status.state),
    transcribing: mine && status.state === 'processing',
    state: mine ? status.state : 'idle',
    recordingMs: mine ? status.recordingMs : 0,
    error: mine && status.error ? status.error.message : null,
    available,
    toggle,
    cancel
  }
}
