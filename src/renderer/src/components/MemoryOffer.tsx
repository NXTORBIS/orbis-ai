import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { memorySuggestion } from '../../../shared/memory'
import { preferenceQuestion, type StandingPreference, standingPreference } from '../../../shared/preferences'

/**
 * "Remember that?" — offered when someone plainly states something about themselves, and only ever offered.
 *
 * Nothing is stored unless the button is pressed. It appears once per thing said, never for questions or guesses, never
 * for anything secret, and never for something Orbis already remembers. Turning memory off in Settings turns this off
 * with it.
 *
 * Two kinds of thing are noticed, and a standing way of working is the stronger of the two: "always answer in short
 * bullet points", "call me Sam", "never use emojis" (see shared/preferences.ts). It is offered with a Preference tag and
 * a worded "Not now", and on Remember it is pinned, so it travels with every answer rather than only the ones whose
 * wording happens to match it. Plain facts about the person (shared/memory.ts) are offered as they always were.
 */
export default function MemoryOffer({ message, onNotify }: { message: string | undefined; onNotify(text: string): void }): React.JSX.Element | null {
  const [offer, setOffer] = useState<{ text: string; preference: StandingPreference | null } | null>(null)
  const dismissed = useRef<Set<string>>(new Set())

  useEffect(() => {
    // A standing preference ("always answer in bullets") is offered first, and kept pinned so it is always in view of Orion.
    const preference = message ? standingPreference(message) : null
    const candidate = preference?.text ?? (message ? memorySuggestion(message) : null)
    if (!candidate || dismissed.current.has(candidate.toLowerCase())) {
      setOffer(null)
      return undefined
    }
    let live = true
    void (async () => {
      const [settings, alreadyKnown] = await Promise.all([window.api.memorySettings(), window.api.listMemories({ query: candidate })])
      if (!live) return
      const known = alreadyKnown.some((m) => m.text.toLowerCase() === candidate.toLowerCase())
      setOffer(settings.enabled && !known ? { text: candidate, preference } : null)
    })().catch(() => undefined)
    return () => {
      live = false
    }
  }, [message])

  if (!offer) return null

  const close = (): void => {
    dismissed.current.add(offer.text.toLowerCase())
    setOffer(null)
  }

  return (
    <div className="memory-offer" role="note">
      {offer.preference ? <span className="pref-offer-tag">Preference</span> : null}
      <span className="truncate">{offer.preference ? preferenceQuestion(offer.preference) : `Remember this? “${offer.text}”`}</span>
      <button
        type="button"
        className="memory-offer-yes"
        onClick={() => {
          void window.api
            // A standing preference is pinned, so it is always among the memories Orion is given, not only the relevant ones.
            .addMemory(offer.text, offer.preference ? { category: 'preference', pinned: true, fromSuggestion: true } : { fromSuggestion: true })
            .then(() =>
              onNotify(
                offer.preference
                  ? 'Remembered as a preference. Orion is told about it from now on; Settings → Memory to change or remove it.'
                  : 'Saved to memory. You can see and delete it in Settings → Memory.'
              )
            )
            .catch((err: unknown) => onNotify(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'It could not be saved.'))
          close()
        }}
      >
        <Check size={13} /> Remember
      </button>
      {offer.preference ? (
        <button type="button" className="pref-offer-no" onClick={close}>
          Not now
        </button>
      ) : (
        <button type="button" aria-label="Do not remember this" onClick={close}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}
