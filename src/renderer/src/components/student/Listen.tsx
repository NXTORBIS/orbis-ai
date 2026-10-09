import { useCallback, useEffect, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { voiceInput } from '../../lib/voiceInput'
import { isBusy } from '../../../../shared/voiceInput'
import { EXAMPLES, understand, type Command } from '../../../../shared/student/speech'
import type { NoticeKind } from '../../lib/notices'

/**
 * Telling Student what to do out loud.
 *
 * ## It repeats what it heard before it acts
 *
 * Every command shows as a sentence — "Starting 25 minutes on Physics" — and then happens. Voice that acts
 * silently is voice nobody trusts twice, and a misheard word with no warning is how somebody ends up with a
 * fifty-minute timer they did not ask for.
 *
 * ## It never guesses
 *
 * The sentence is matched against a short list of things people say. Anything else comes back as "I did not catch
 * that", with what it did hear, rather than being handed to a model to interpret. A model guessing at "stop"
 * mid-session is a thing that loses work.
 *
 * ## Nothing here deletes anything
 *
 * There is no spoken command that destroys a card, a board or a record — a microphone is the one input where a
 * misheard word is likely, so the destructive things stay behind a press.
 */

export default function Listen({
  onCommand,
  onNotify
}: {
  onCommand(command: Command): void | Promise<void>
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    return voiceInput.onChange((status) => {
      // Busy covers every stage between asking for the microphone and the words coming back.
      setListening(isBusy(status.state))
    })
  }, [])

  const act = useCallback(
    async (text: string | null): Promise<void> => {
      if (!text || !text.trim()) {
        setHeard(null)
        onNotify('Nothing came through.', 'warn')
        return
      }
      const out = understand(text)
      setHeard(text.trim())
      if (!out) {
        // Said back, so somebody can see whether it was the hearing or the phrase that went wrong.
        onNotify(`Did not catch a command in "${text.trim().slice(0, 60)}". Press the microphone and try one of the examples.`, 'warn')
        setShowHelp(true)
        return
      }
      onNotify(out.says)
      await onCommand(out.command)
    },
    [onCommand, onNotify]
  )

  const listen = async (): Promise<void> => {
    if (listening) {
      await voiceInput.stop()
      return
    }
    setHeard(null)
    await voiceInput.start({
      target: 'chat',
      // Stops by itself when the sentence ends: nobody wants to hold a button to say "stop".
      endOnSilence: true,
      onTranscript: (text) => void act(text)
    })
  }

  return (
    <div className="st-listen">
      <button
        type="button"
        className={`st-icon${listening ? ' on' : ''}`}
        aria-label={listening ? 'Stop listening' : 'Say what you want'}
        title={listening ? 'Listening — say it now' : 'Say what you want'}
        aria-pressed={listening}
        onClick={() => void listen()}
      >
        {listening ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
      </button>

      {heard ? (
        <span className="st-faint small" role="status">
          “{heard}”
        </span>
      ) : null}

      {showHelp ? (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label="What you can say">
          <div className="st-sheet-card tight">
            <h3>What you can say</h3>
            <p className="st-faint small">
              These are matched by their words, not interpreted — so anything outside this list comes back as not
              caught rather than as a guess.
            </p>
            <ul className="st-examples">
              {EXAMPLES.map((one) => (
                <li key={one}>“{one}”</li>
              ))}
            </ul>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={() => setShowHelp(false)}>
                Right
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
