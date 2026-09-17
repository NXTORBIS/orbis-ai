import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { memorySuggestion } from '../../../shared/memory'

/**
 * "Remember that?" — offered when someone plainly states something about themselves, and only ever offered.
 *
 * Nothing is stored unless the button is pressed. It appears once per thing said, never for questions or guesses, never
 * for anything secret, and never for something Orbis already remembers. Turning memory off in Settings turns this off
 * with it.
 */
export default function MemoryOffer({ message, onNotify }: { message: string | undefined; onNotify(text: string): void }): React.JSX.Element | null {
  const [offer, setOffer] = useState<string | null>(null)
  const dismissed = useRef<Set<string>>(new Set())

  useEffect(() => {
    const candidate = message ? memorySuggestion(message) : null
    if (!candidate || dismissed.current.has(candidate.toLowerCase())) {
      setOffer(null)
      return undefined
    }
    let live = true
    void (async () => {
      const [settings, alreadyKnown] = await Promise.all([window.api.memorySettings(), window.api.listMemories({ query: candidate })])
      if (!live) return
      const known = alreadyKnown.some((m) => m.text.toLowerCase() === candidate.toLowerCase())
      setOffer(settings.enabled && !known ? candidate : null)
    })().catch(() => undefined)
    return () => {
      live = false
    }
  }, [message])

  if (!offer) return null

  const close = (): void => {
    dismissed.current.add(offer.toLowerCase())
    setOffer(null)
  }

  return (
    <div className="memory-offer" role="note">
      <span className="truncate">Remember this? “{offer}”</span>
      <button
        type="button"
        className="memory-offer-yes"
        onClick={() => {
          void window.api
            .addMemory(offer)
            .then(() => onNotify('Saved to memory. You can see and delete it in Settings → Memory.'))
            .catch((err: unknown) => onNotify(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'It could not be saved.'))
          close()
        }}
      >
        <Check size={13} /> Remember
      </button>
      <button type="button" aria-label="Do not remember this" onClick={close}>
        <X size={13} />
      </button>
    </div>
  )
}
