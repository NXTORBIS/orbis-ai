import { useEffect, useRef, useState } from 'react'
import { MessageCircleQuestion, Send, X } from 'lucide-react'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * A tutor that asks instead of telling.
 *
 * ## "Just tell me" is on every turn
 *
 * Always, and it works immediately. A tutor you cannot escape is a trap, and the moment somebody feels trapped by
 * questions they close the app and do not come back to this screen.
 *
 * ## It stops by itself
 *
 * Six questions, or two "I don't know"s in a row, and it gives the explanation instead. Those limits are decided
 * by Orbis rather than by the model, so no amount of prompting can keep somebody in the conversation longer.
 *
 * ## Getting there is understanding, not recall
 *
 * They produced it, which is real — with scaffolding, which is why it is not recorded as recall. The difference
 * matters later, when the mastery map says whether they can do it on their own.
 */

type Turn = { who: 'orbis'; text: string } | { who: 'student'; text: string }

interface Conversation {
  conceptId: string
  topic: string
  turns: Turn[]
  asked: number
  ended: null | 'got-there' | 'told' | 'gave-up' | 'left'
}

export default function Socratic({
  conceptId,
  topic,
  call,
  onClose,
  onNotify
}: {
  conceptId: string
  topic: string
  call: Call
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [saying, setSaying] = useState('')
  const [thinking, setThinking] = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [ending, setEnding] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let stopped = false
    void call<{ ok: boolean; conversation?: Conversation; why?: string }>('socratic-start', conceptId).then((out) => {
      if (stopped) return
      if (out?.ok && out.conversation) setConversation(out.conversation)
      else setWhy(out?.why ?? 'Nothing came back.')
    })
    return () => {
      stopped = true
    }
  }, [call, conceptId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [conversation, explanation])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const send = async (): Promise<void> => {
    if (!conversation || !saying.trim() || thinking) return
    const said = saying.trim()
    setSaying('')
    setThinking(true)
    // Shown straight away, so the conversation does not pause on the student's own words.
    setConversation({ ...conversation, turns: [...conversation.turns, { who: 'student', text: said }] })

    const out = await call<{
      ok: boolean
      conversation: Conversation
      say: string
      stop: null | 'told' | 'gave-up' | 'got-there'
      explanation?: string
    }>('socratic-reply', conversation, said)
    setThinking(false)
    if (!out?.ok) {
      onNotify('Nothing came back. Try again in a moment.', 'warn')
      return
    }
    setConversation(out.conversation)
    if (out.explanation) setExplanation(out.explanation)
    if (out.stop) {
      const said = await call<{ says: string }>('socratic-finished', out.conversation).catch(() => null)
      setEnding(said?.says ?? (out.stop === 'got-there' ? 'You said it yourself, which is the part that sticks.' : ''))
    }
  }

  /** The way out, available at every turn. */
  const justTell = async (): Promise<void> => {
    setThinking(true)
    const out = await call<{ ok: boolean; text?: string; why?: string }>('explain-topic', conceptId)
    setThinking(false)
    if (out?.ok && out.text) {
      setExplanation(out.text)
      setEnding('That one is written out above. Worth coming back to it from memory later.')
      if (conversation) setConversation({ ...conversation, ended: 'told' })
      void call('socratic-finished', { ...conversation, ended: 'told' }).catch(() => undefined)
      return
    }
    onNotify(out?.why ?? 'Nothing came back.', 'warn')
  }

  const over = !!explanation || !!ending

  return (
    <div className="st-sheet" role="dialog" aria-modal="true" aria-label={`Working out ${topic}`}>
      <div className="st-sheet-card">
        <header className="st-challenge-head">
          <div>
            <h3>{topic}</h3>
            <p className="st-faint small">
              <MessageCircleQuestion size={12} aria-hidden /> Orion asks, you answer. It will not give you the answer
              unless you ask for it.
            </p>
          </div>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Leave">
            <X size={16} aria-hidden />
          </button>
        </header>

        {!conversation && !why ? <div className="st-skeleton row" style={{ height: 70 }} /> : null}

        {why ? (
          <>
            <p className="st-empty">{why}</p>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={onClose}>
                Right
              </button>
            </div>
          </>
        ) : null}

        {conversation ? (
          <>
            <ol className="st-turns">
              {conversation.turns.map((turn, index) => (
                <li key={index} className={turn.who === 'orbis' ? 'orbis' : 'student'}>
                  <span className="st-faint small">{turn.who === 'orbis' ? 'Orion' : 'You'}</span>
                  <p>{turn.text}</p>
                </li>
              ))}
              {thinking ? (
                <li className="orbis">
                  <span className="st-faint small">Orion</span>
                  <p className="st-faint">…</p>
                </li>
              ) : null}
            </ol>

            {explanation ? (
              <div className="st-told">
                <span className="st-faint small">The answer</span>
                <p className="st-explained">{explanation}</p>
              </div>
            ) : null}

            {ending ? <p className="st-teach-said">{ending}</p> : null}

            <div ref={bottom} />

            {!over ? (
              <>
                <div className="st-say">
                  <input
                    value={saying}
                    onChange={(e) => setSaying(e.target.value.slice(0, 2000))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    placeholder="Your answer"
                    aria-label="Your answer"
                    disabled={thinking}
                  />
                  <button type="button" className="st-icon" onClick={() => void send()} aria-label="Send" disabled={thinking || !saying.trim()}>
                    <Send size={16} aria-hidden />
                  </button>
                </div>
                <div className="st-row-actions">
                  {/* Every turn. Always works. */}
                  <button type="button" className="st-btn quiet" onClick={() => void justTell()} disabled={thinking}>
                    Just tell me
                  </button>
                  <span className="st-faint small">
                    {conversation.asked} of 6 questions · it stops by itself after that
                  </span>
                </div>
              </>
            ) : (
              <div className="st-sheet-foot">
                <button type="button" className="st-btn primary" onClick={onClose}>
                  Done
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
