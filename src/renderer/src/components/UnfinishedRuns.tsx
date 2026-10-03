import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { History, X } from 'lucide-react'
import type { AutomationState } from '../../../shared/types'

interface Unfinished {
  id: string
  conversationId: string
  said: string
  state: AutomationState
}

/**
 * What Orbis was in the middle of when it last closed.
 *
 * A long automation -- working through fifty results, playing a game -- used to keep everything it had done in memory
 * and in the conversation. Orbis closing unexpectedly lost the list of what had already been handled, so picking it
 * up meant doing all of it again, which for anything that acts on a page is worse than not picking it up at all.
 *
 * What this offers is carefully limited. It says where each run got to and takes you to the conversation it belongs
 * to; it does not carry on by itself and it does not claim carrying on will work. The page has almost certainly moved
 * on since, and that is a judgement for the person looking at it, not for a line of code that cannot see it.
 */
export default function UnfinishedRuns({ onOpen }: { onOpen(conversationId: string): void }): ReactElement | null {
  const [runs, setRuns] = useState<Unfinished[]>([])

  const load = useCallback(() => {
    void window.api
      .unfinishedAutomations()
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [])

  // Asked once, when Orbis starts. These are from a previous run: nothing new appears here while this one is open.
  useEffect(load, [load])

  if (runs.length === 0) return null

  const forget = (id: string): void => {
    setRuns((was) => was.filter((one) => one.id !== id))
    void window.api.forgetAutomation(id).catch(() => undefined)
  }

  return (
    <aside className="unfinished" aria-label="Unfinished work">
      <div className="unfinished-head">
        <History size={13} aria-hidden="true" />
        <b>Orbis was partway through {runs.length === 1 ? 'something' : `${runs.length} things`}</b>
      </div>
      <ul>
        {runs.map((one) => (
          <li key={one.id}>
            <button
              type="button"
              className="unfinished-open"
              onClick={() => {
                onOpen(one.conversationId)
                forget(one.id)
              }}
            >
              {one.said}
            </button>
            <button type="button" className="icon-btn" aria-label={`Forget "${one.said}"`} onClick={() => forget(one.id)}>
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="view-muted small">
        Opening one takes you to the chat it came from, with what it already did. The page will have moved on, so Orbis does not carry on by itself.
      </p>
    </aside>
  )
}
