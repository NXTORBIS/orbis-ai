import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import Markdown from './Markdown'
import ResearchSources from './ResearchSources'
import type { ChatMessage, Research, StreamEvent } from '../../../shared/types'

interface Props {
  question: string
  model: string
  persona: string
  /** The browser page open when the question was asked, for questions about it ("summarize this article"). */
  page?: { url: string; title: string }
  onClose(): void
}

type Phase = 'working' | 'done' | 'error' | 'stopped'

/**
 * Orion's answer to a question asked from the address bar (Ctrl+Enter), shown over the browser so the page, its tab
 * and its URL stay exactly as they were. It goes straight to Orion (researching the web when the question needs it),
 * never through the browser orb, and never saves a chat.
 */
export default function OrionAnswer({ question, model, persona, page, onClose }: Props): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const [content, setContent] = useState('')
  const [research, setResearch] = useState<Research>()
  const [status, setStatus] = useState('')
  const [phase, setPhase] = useState<Phase>('working')
  const [error, setError] = useState('')
  const requestRef = useRef<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  // The page as it was when asked; browsing on while Orion answers doesn't change what the question was about.
  const pageRef = useRef(page)

  useEffect(() => {
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setContent('')
    setResearch(undefined)
    setStatus('')
    setError('')
    setPhase('working')
    let finished = false
    const finish = (next: Phase, message = ''): void => {
      if (finished) return
      finished = true
      setPhase(next)
      setError(message)
      setStatus('')
    }
    const unsubscribe = window.api.onChatEvent(requestId, (event: StreamEvent) => {
      switch (event.type) {
        case 'delta':
          if (event.content) {
            setStatus('')
            setContent((text) => text + event.content)
          }
          break
        case 'status':
          setStatus(event.message)
          break
        case 'research':
          setResearch(event.research)
          break
        case 'done':
          finish('done')
          break
        case 'error':
          finish('error', event.message)
          break
        case 'aborted':
          finish('stopped')
          break
      }
    })
    const message: ChatMessage = { id: requestId, role: 'user', content: question, createdAt: Date.now() }
    window.api
      .sendChat({ requestId, model, persona, ask: true, messages: [message], browser: pageRef.current })
      .then(() => finish('done'))
      .catch((err: unknown) => finish('error', err instanceof Error ? err.message : String(err)))
    return () => {
      unsubscribe()
      if (!finished) void window.api.abortChat(requestId)
    }
  }, [question, model, persona, attempt])

  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'nearest' })
  }, [question])

  const retry = (): void => setAttempt((n) => n + 1)
  const failed = phase === 'error' || (phase === 'done' && !content.trim())

  return (
    <section
      ref={panelRef}
      className="orion-answer popover glass"
      role="dialog"
      aria-label="Orion's answer"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="orion-answer-head">
        <Sparkles size={14} className="orion-answer-mark" aria-hidden="true" />
        <span className="orion-answer-q" title={question}>
          {question}
        </span>
        {phase === 'working' ? (
          <button type="button" className="orion-answer-btn" aria-label="Stop answering" title="Stop" onClick={() => requestRef.current && void window.api.abortChat(requestRef.current)}>
            <Square size={11} />
          </button>
        ) : (
          <button type="button" className="orion-answer-btn" aria-label="Ask again" title="Ask again" onClick={retry}>
            <RotateCcw size={13} />
          </button>
        )}
        <button type="button" className="orion-answer-btn" aria-label="Close answer" title="Close (Esc)" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="orion-answer-body" aria-live="polite" aria-busy={phase === 'working'}>
        {phase === 'working' && !content && (
          <p className="orion-answer-status">
            <LoaderCircle size={13} className="spin" aria-hidden="true" />
            {status || 'Orion is thinking…'}
          </p>
        )}
        {phase === 'working' && content && status && <p className="orion-answer-status">{status}</p>}
        {content && <Markdown text={content} sources={research?.sources} />}
        {research && research.sources.length > 0 && <ResearchSources research={research} content={content} streaming={phase === 'working'} />}
        {phase === 'stopped' && <p className="orion-answer-status">Stopped.</p>}
        {failed && (
          <div className="message-error orion-answer-error">
            <span>{phase === 'error' ? error || "Orion couldn't answer that." : "Orion didn't return an answer."}</span>
            <button type="button" className="orion-answer-retry" onClick={retry}>
              <RotateCcw size={12} />
              Try again
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
