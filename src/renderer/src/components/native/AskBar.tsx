import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { answer, type LabReply } from './labAssistant'

/**
 * The orb that lets you keep talking to Orion while a lab is full page.
 *
 * ## Why it exists
 *
 * Full page covers the conversation. Without this, opening a studio would mean losing the ability to ask anything
 * until you closed it again — so the one thing the window is for would be the one thing you could not do.
 *
 * ## It is a circle until you want it
 *
 * At rest it is a small glowing orb in the corner, turning slowly. Hovering or focusing it grows it into a field
 * you can type in, and it settles back when you leave. A bar across the bottom would take a strip of the lab for
 * ever to serve something used occasionally; a circle takes almost nothing and says what it is.
 *
 * It stays visible rather than hiding: the glow and the slow turn are there so it reads as live and reachable,
 * not so it draws the eye away from the simulation.
 *
 * ## It does not carry the message itself
 *
 * The card is several components below the chat, and threading a send function down through all of them to reach
 * one input would couple the whole path together. This announces what was typed, and the shell — which already
 * owns sending — hears it.
 */

/**
 * Announced when something in a lab wants the conversation behind it to hear a message.
 *
 * The orb no longer uses this — it answers for itself, because its answers are about the lab in front of you and
 * sending them to a conversation hidden behind the lab would put them where they cannot be read. It is kept
 * because the shell listens for it and it is the right way for a lab to reach the chat.
 */
export const ASK_EVENT = 'orbis:ask-from-lab'

export default function AskBar({ about }: { about: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [thinking, setThinking] = useState(false)
  /*
   * What it last said, shown above the pill.
   *
   * The orb answers here rather than in the conversation. It is about the laboratory in front of you, and sending
   * every "what does this slider do" into the chat would bury the conversation in it — and the answer would be
   * behind the lab, where it cannot be read.
   */
  const [reply, setReply] = useState<LabReply | null>(null)
  const box = useRef<HTMLTextAreaElement | null>(null)
  const leaving = useRef<number | null>(null)

  /*
   * Grows with what is typed, up to a few lines, then scrolls.
   *
   * Measured after the next frame, and only while the orb is open. Measuring it closed reads the height of a box
   * that is clipped to nothing, which came back far too large — and the orb opened as a tall slab instead of a
   * pill, with the mark and the send button pushed to opposite corners.
   */
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    if (!open) {
      el.style.height = ''
      return undefined
    }
    const size = (): void => {
      // While the pill is still widening the box is only a few pixels across, so anything in it wraps to a dozen
      // lines and the measurement comes back at the ceiling. Below a readable width, one line is the right answer.
      if (el.clientWidth < 120) {
        el.style.height = '24px'
        return
      }
      el.style.height = 'auto'
      el.style.height = `${Math.max(24, Math.min(el.scrollHeight, 110))}px`
    }
    const frame = requestAnimationFrame(size)
    // Again once the pill has finished opening, which is when the width is finally real.
    const orb = el.closest('.na-orb')
    orb?.addEventListener('transitionend', size)
    const settled = window.setTimeout(size, 420)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settled)
      orb?.removeEventListener('transitionend', size)
    }
  }, [text, open])

  // Opening is only worth anything if the caret lands in the box.
  useEffect(() => {
    if (open) box.current?.focus()
  }, [open])

  const show = (): void => {
    if (leaving.current !== null) {
      window.clearTimeout(leaving.current)
      leaving.current = null
    }
    setOpen(true)
  }

  // A small delay on the way out, so crossing a corner of the orb does not slam it shut mid-reach.
  const hide = (): void => {
    /*
     * It also stays open while it is thinking, and while an answer is still on screen.
     *
     * Without that, moving the pointer off the orb after pressing send closed it 350ms later and the answer
     * arrived into a collapsed circle — asked, answered, and never seen. An answer waits to be dismissed.
     */
    if (focused || thinking || reply !== null || text.trim() !== '') return
    if (leaving.current !== null) window.clearTimeout(leaving.current)
    leaving.current = window.setTimeout(() => {
      setOpen(false)
      leaving.current = null
    }, 350)
  }

  const send = (): void => {
    const asked = text.trim()
    if (asked === '' || thinking) return
    setText('')
    setThinking(true)
    setReply(null)
    void (async () => {
      try {
        setReply(await answer(asked))
      } catch (error) {
        setReply({
          says: `Something went wrong here: ${error instanceof Error ? error.message : String(error)}`,
          did: [],
          declined: []
        })
      } finally {
        setThinking(false)
      }
    })()
  }

  return (
    <div
      className={`na-orb${open ? ' open' : ''}${focused ? ' at' : ''}${thinking ? ' busy' : ''}`}
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      {/* What it said, above the pill. Only while the orb is open, so it never covers the lab uninvited. */}
      {open && (reply !== null || thinking) && (
        <div className="na-orb-reply" role="status">
          {thinking ? (
            <span className="na-orb-thinking">Thinking…</span>
          ) : (
            <>
              <p className="na-orb-says">{reply?.says}</p>
              {(reply?.did.length ?? 0) > 0 && (
                <ul className="na-orb-did">
                  {reply?.did.map((one) => (
                    <li key={one}>{one}</li>
                  ))}
                </ul>
              )}
              {(reply?.declined.length ?? 0) > 0 && (
                <ul className="na-orb-declined">
                  {reply?.declined.map((one) => (
                    <li key={one}>{one}</li>
                  ))}
                </ul>
              )}
              <button type="button" className="na-orb-dismiss" aria-label="Clear this" onClick={() => setReply(null)}>
                ×
              </button>
            </>
          )}
        </div>
      )}
      {/* The ring is its own element so it can turn for ever without dragging the text round with it. */}
      <span className="na-orb-ring" aria-hidden />
      <span className="na-orb-glow" aria-hidden />

      <button
        type="button"
        className="na-orb-face"
        aria-label={open ? 'Ask Orion' : `Ask Orion about ${about}`}
        aria-expanded={open}
        title={`Ask Orion about ${about}`}
        onClick={show}
        onFocus={show}
      >
        {/* Orion's mark: a ring with a core, drawn rather than an icon so it can breathe on its own. */}
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
          <circle className="na-orb-o" cx="12" cy="12" r="7.5" fill="none" strokeWidth="1.6" />
          <circle className="na-orb-core" cx="12" cy="12" r="2.6" />
          <path className="na-orb-tail" d="M17.4 17.4 L21 21" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
      </button>

      <div className="na-orb-field">
        <textarea
          ref={box}
          className="na-orb-box"
          value={text}
          rows={1}
          spellCheck={false}
          placeholder={thinking ? 'Thinking…' : `Ask about ${about}, or tell it what to run…`}
          aria-label={`Ask Orion about ${about}`}
          tabIndex={open ? 0 : -1}
          onFocus={() => {
            setFocused(true)
            show()
          }}
          onBlur={() => {
            setFocused(false)
            hide()
          }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; shift-enter is a new line, the same way the main composer behaves.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
            // Escape clears, then closes — so one press never undoes two things at once, and never the lab.
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (text !== '') setText('')
              else {
                setOpen(false)
                box.current?.blur()
              }
            }
          }}
        />
        <button
          type="button"
          className="na-orb-send"
          aria-label="Ask"
          title="Ask (Enter)"
          tabIndex={open ? 0 : -1}
          disabled={text.trim() === '' || thinking}
          onClick={send}
        >
          <ArrowUp size={14} aria-hidden />
        </button>
      </div>
    </div>
  )
}
