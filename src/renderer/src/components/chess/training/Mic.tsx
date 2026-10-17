import { useCallback, useState } from 'react'
import { Button } from '../../../ui'
import { useVoiceInput } from '../../../hooks/useVoiceInput'
import type { Heard } from '../../../../../shared/chess/spoken'

/**
 * A microphone for one answer box (Section 224).
 *
 * The one place in Chess World where speaking is the natural way to answer: somebody holding a position in their
 * head and looking at nothing has no reason to be looking at a keyboard either.
 *
 * It is Orbis's own microphone -- the same service the chat box and the address bar use, recording and transcribing
 * on this machine, nothing leaving the computer. The only thing particular to here is the target, `chess`, which is
 * what stops a square spoken into this box turning up in the search box: the voice service hands a transcript back
 * only to the input that started the session.
 *
 * ## Typing always works
 *
 * This button is never the only way to answer. It is not drawn at all on a machine that cannot record, and words it
 * cannot make sense of are put in the box as they were heard for somebody to correct. Nothing is ever lost to a
 * microphone that did not work.
 *
 * ## It asks rather than guesses
 *
 * `hear` is `hearSquares` or `hearMove` from `spoken.ts`, and when the words could mean two different legal moves it
 * comes back as a question. The readings are offered as buttons; nothing is entered until one is picked. A trainer
 * that marked somebody wrong for a move they never made would teach them to distrust the marking.
 */

export interface MicProps {
  /** Which box the words belong to. Unique per box on screen. */
  inputId: string
  /** How to read the words: a list of squares, or a move against one position. */
  hear: (spoken: string) => Heard
  /** Given the text when the words came to exactly one answer. */
  onHeard: (text: string) => void
  /** Whether the button may be pressed at all. */
  disabled?: boolean
  /** What the button is for, said for anybody who cannot see the box it sits beside. */
  label: string
}

export function Mic({ inputId, hear, onHeard, disabled = false, label }: MicProps): React.JSX.Element | null {
  const voice = useVoiceInput('chess', { inputId })
  const [said, setSaid] = useState<string | null>(null)
  const [choices, setChoices] = useState<readonly string[]>([])

  const press = useCallback(async (): Promise<void> => {
    setChoices([])
    const words = await voice.toggle()
    // Null is the start of a recording, or a recording that produced nothing. Neither is worth a message.
    if (words === null) {
      setSaid(null)
      return
    }
    const heard = hear(words)
    setSaid(heard.says)
    if (heard.ok) {
      onHeard(heard.text)
      setChoices([])
      return
    }
    setChoices(heard.choices)
    // Words that are not an answer still go in the box, as they were heard, so they can be corrected by hand
    // rather than said again.
    if (heard.fault === 'not-understood' && heard.heard) onHeard(heard.heard)
  }, [voice, hear, onHeard])

  // No microphone on this machine means no button, rather than a button that cannot work.
  if (!voice.available) return null

  return (
    <div className="cw-tr-mic">
      <Button
        size="small"
        kind={voice.recording ? 'primary' : 'normal'}
        on={voice.recording}
        busy={voice.transcribing}
        busyLabel="Listening…"
        disabled={disabled}
        aria-label={label}
        onClick={() => void press()}
      >
        {voice.recording ? 'Stop and use it' : 'Speak it'}
      </Button>
      {voice.error !== null && <p className="cw-tr-mic-bad" role="status">{voice.error}</p>}
      {said !== null && <p className="cw-tr-mic-said" role="status">{said}</p>}
      {choices.length > 0 && (
        <div className="cw-tr-mic-choices" role="group" aria-label="Which did you mean">
          {choices.map((one) => (
            <Button
              key={one}
              size="tiny"
              onClick={() => {
                onHeard(one)
                setChoices([])
                setSaid(`Using ${one}.`)
              }}
            >
              {one}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export default Mic
