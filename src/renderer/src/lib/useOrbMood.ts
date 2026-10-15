import { useEffect, useRef, useState } from 'react'
import { DONE_FOR_MS, orbMood, type OrbMood } from '../../../shared/orbMood'

/**
 * The Orb's mood for the open conversation. `done` is kept for a moment after a reply ends without an error, so the
 * Orb says how it went; it is the only part that needs a timer.
 */
export function useOrbMood(input: { streaming: boolean; hasContent: boolean; failed: boolean; key: string | null }): OrbMood {
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const was = useRef(input.streaming)
  const keyRef = useRef(input.key)

  useEffect(() => {
    // A different conversation starts calm: another chat's finished reply is not this one's.
    if (keyRef.current !== input.key) {
      keyRef.current = input.key
      was.current = input.streaming
      setFinishedAt(null)
      return
    }
    if (was.current && !input.streaming && !input.failed) {
      const t = Date.now()
      setFinishedAt(t)
      setNow(t)
    }
    was.current = input.streaming
  }, [input.streaming, input.failed, input.key])

  useEffect(() => {
    if (finishedAt === null) return
    const t = setTimeout(() => setNow(Date.now()), DONE_FOR_MS + 50)
    return () => clearTimeout(t)
  }, [finishedAt])

  return orbMood({ streaming: input.streaming, hasContent: input.hasContent, failed: input.failed, finishedAt, now })
}
