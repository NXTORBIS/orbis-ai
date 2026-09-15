import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ChatMessage } from '../../../shared/types'

interface Props {
  /** The chat's messages; the rail has one tick per message the user sent. */
  messages: ChatMessage[]
  scrollRef: RefObject<HTMLDivElement | null>
  userName: string
}

const preview = (text: string): string => text.replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]').replace(/\s+/g, ' ').trim() || '(attachment)'

/**
 * A slim rail beside the chat: one tick per message the user sent. The tick for the part of the chat on screen is
 * highlighted, hovering a tick previews the message, and clicking it scrolls there.
 */
export default function ChatRail({ messages, scrollRef, userName }: Props): React.JSX.Element | null {
  const asked = messages.filter((m) => m.role === 'user')
  const [current, setCurrent] = useState(-1)
  const [hover, setHover] = useState<{ index: number; top: number } | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  const slot = (id: string): HTMLElement | null => scrollRef.current?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`) ?? null
  const box = (id: string): HTMLElement | null => {
    const s = slot(id)
    return (s?.firstElementChild as HTMLElement | null) ?? s
  }

  // The current message is the last one whose top has passed a line a third of the way down the chat.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3
        let index = -1
        asked.forEach((m, i) => {
          const el = box(m.id)
          if (el && el.getBoundingClientRect().top <= line) index = i
        })
        const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4
        setCurrent(atBottom ? asked.length - 1 : Math.max(0, index))
      })
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
    // Re-measured whenever the messages change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, messages])

  if (asked.length < 2) return null

  const go = (index: number): void => {
    const target = asked[Math.max(0, Math.min(asked.length - 1, index))]
    const scroller = scrollRef.current
    const el = target && box(target.id)
    if (!scroller || !el) return
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    setCurrent(Math.max(0, Math.min(asked.length - 1, index)))
  }

  const show = (index: number, el: HTMLElement): void => {
    const rail = railRef.current?.getBoundingClientRect()
    const tick = el.getBoundingClientRect()
    if (rail) setHover({ index, top: tick.top + tick.height / 2 - rail.top })
  }

  const hovered = hover ? asked[hover.index] : undefined

  return (
    <nav className="chat-rail" aria-label="Your messages in this chat" ref={railRef} onMouseLeave={() => setHover(null)}>
      <button type="button" className="chat-rail-step" aria-label="Previous message" title="Previous message" disabled={current <= 0} onClick={() => go(current - 1)}>
        <ChevronUp size={14} />
      </button>
      <ol className="chat-rail-ticks">
        {asked.map((m, i) => (
          <li key={m.id}>
            <button
              type="button"
              className={`chat-rail-tick${i === current ? ' current' : ''}`}
              aria-label={`Message ${i + 1}: ${preview(m.content).slice(0, 80)}`}
              aria-current={i === current ? 'true' : undefined}
              onMouseEnter={(e) => show(i, e.currentTarget)}
              onFocus={(e) => show(i, e.currentTarget)}
              onBlur={() => setHover(null)}
              onClick={() => go(i)}
            >
              <span />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="chat-rail-step" aria-label="Next message" title="Next message" disabled={current >= asked.length - 1} onClick={() => go(current + 1)}>
        <ChevronDown size={14} />
      </button>
      {hover && hovered && (
        <div className="chat-rail-card glass" style={{ top: hover.top }} aria-hidden="true">
          <span className="chat-rail-card-name">{userName}</span>
          <span className="chat-rail-card-text">{preview(hovered.content)}</span>
        </div>
      )}
    </nav>
  )
}
