import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { AudioLines, Square } from 'lucide-react'
import { endingNote, next, OFF, shouldListen, statusOf, type Conversation, type ConversationEvent } from '../../../shared/voiceConversation'
import { voiceInput } from '../lib/voiceInput'
import { speech } from '../lib/speak'
import type { NoticeKind } from '../lib/notices'

/**
 * Talking with Orbis rather than dictating to it.
 *
 * Voice was push-to-talk: hold the key, speak, let go, read the answer. The loop -- it answers out loud, then listens
 * again without being asked -- is what this adds, and it is the whole difference between dictation and a
 * conversation.
 *
 * It uses the one microphone and the one voice that already exist. What is here is only the turn-taking: start
 * listening, hand the words to the chat, wait for the answer, say it, listen again. Where it stops is decided in
 * src/shared/voiceConversation.ts, where it can be tested -- including that every state has a way out.
 */
export default function VoiceConversation({
  onSay,
  lastAnswer,
  answering,
  onNotify
}: {
  /** Sends what was heard as a message. */
  onSay(text: string): void
  /** The latest finished answer, so it can be read out. Null while one is still being written. */
  lastAnswer: string | null
  /** Whether an answer is being written right now. */
  answering: boolean
  onNotify(text: string, kind?: NoticeKind): void
}): ReactElement {
  const [talk, setTalk] = useState<Conversation>(OFF)
  const talkRef = useRef(talk)
  talkRef.current = talk
  /** The answer already read out, so the same one is never read twice. */
  const spoken = useRef<string | null>(null)

  const move = useCallback((event: ConversationEvent) => setTalk((now) => next(now, event)), [])

  // Listening: one recording per turn, through the one voice service.
  useEffect(() => {
    if (!shouldListen(talk)) return
    let dropped = false
    /*
     * One turn.
     *
     * The recording ends itself when the person stops talking -- nobody is holding a key down in a conversation, so a
     * turn that waits to be ended never ends. The words come back through the service's own callback, because when it
     * stops itself there is no caller waiting for them.
     */
    void voiceInput
      .start({
        target: 'chat',
        endOnSilence: true,
        onTranscript: (text) => {
          if (dropped) return
          const said = (text ?? '').trim()
          if (!said) return move({ type: 'nothing-heard' })
          move({ type: 'heard', text: said })
          onSay(said)
          move({ type: 'answering' })
        }
      })
      .catch(() => !dropped && move({ type: 'failed' }))

    return () => {
      dropped = true
      void voiceInput.cancel()
    }
  }, [talk, move, onSay])

  // The answer, read out once it is finished.
  useEffect(() => {
    if (talk.state !== 'thinking' || answering) return
    const answer = lastAnswer ?? ''
    if (!answer || answer === spoken.current) return
    spoken.current = answer
    move({ type: 'answered', text: answer })
  }, [talk.state, answering, lastAnswer, move])

  useEffect(() => {
    if (talk.state !== 'speaking') return
    const answer = spoken.current ?? ''
    // Interrupting is handled by the voice service itself: the microphone opening stops whatever is being said.
    const started = speech.speak('conversation', answer, () => move({ type: 'spoke-to-the-end' }))
    if (!started) move({ type: 'spoke-to-the-end' })
  }, [talk.state, move])

  // Ending, whichever way it happened.
  useEffect(() => {
    if (talk.state !== 'off') return
    speech.stop('asked')
    const note = endingNote(talk)
    if (note) onNotify(note)
  }, [talk, onNotify])

  const on = talk.state !== 'off'
  const status = statusOf(talk)

  return (
    <div className="voice-talk">
      <button
        type="button"
        className={`icon-btn${on ? ' on' : ''}`}
        aria-pressed={on}
        aria-label={on ? 'Stop talking with Orbis' : 'Talk with Orbis'}
        title={on ? 'Stop talking with Orbis' : 'Talk with Orbis — it answers out loud and listens again'}
        onClick={() => move({ type: on ? 'stop' : 'start' })}
      >
        {on ? <Square size={15} aria-hidden="true" /> : <AudioLines size={16} aria-hidden="true" />}
      </button>
      {status && (
        <span className="voice-talk-status" role="status">
          {status}
        </span>
      )}
    </div>
  )
}
