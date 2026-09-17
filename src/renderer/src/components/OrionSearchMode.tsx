import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, ExternalLink, History, Loader, Plus, Sparkles, Square, Trash2 } from 'lucide-react'
import {
  addSources,
  addTurn,
  buildAsk,
  changesTopic,
  constraintIn,
  isFollowUp,
  newSearchSession,
  referencedItems,
  wantsFreshResearch,
  withConstraint,
  withTopic
} from '../../../shared/orionSearch'
import type { OrionSearchSession } from '../../../shared/orionSearch'
import { resumeRequest } from '../../../shared/searchSessions'
import type { SavedSearchSummary } from '../../../shared/searchSessions'
import { AUTO_MODEL } from '../../../shared/modelRoute'
import type { SearchOutcomeView } from '../../../shared/types'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { SiteIcon } from './SearchMedia'
import type { NoticeKind } from '../App'

/**
 * Orion in Orbis Search: asking, and then asking again.
 *
 * A search is rarely one question. This keeps the thread of one — what was asked, what came back, which sources it
 * came from, what is being talked about and what conditions are in force — so that "which is cheaper" can be answered
 * without anybody repeating themselves, and "the third one" means the third one.
 *
 * It is not Orbis Chat and never becomes it. No conversation is created, nothing is written to the chat store, and no
 * chat is ever read into it: a question here is answered from what this session found. Chat is somewhere else, about
 * something else, and the two never see each other.
 */

export interface OrionSearchModeProps {
  /** The query the page was opened with. A new one starts a new session. */
  query: string
  onOpen(url: string): void
  onNotify?(message: string, kind?: NoticeKind): void
}

interface Asking {
  question: string
  text: string
  done: boolean
  /** Whether the web was searched again for this one. */
  researched: boolean
}

export default function OrionSearchMode({ query, onOpen, onNotify }: OrionSearchModeProps): React.JSX.Element {
  const [session, setSession] = useState<OrionSearchSession | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [draft, setDraft] = useState('')
  const live = useRef<{ session: OrionSearchSession | null; busy: boolean }>({ session: null, busy: false })
  const stopRef = useRef<(() => void) | null>(null)
  const followRef = useRef<HTMLTextAreaElement>(null)
  const voice = useVoiceInput('search', { inputId: 'orion-follow-up' })
  const [earlier, setEarlier] = useState<SavedSearchSummary[] | null>(null)
  live.current.session = session

  // Research is saved as it happens, so it is still there after Orbis closes and can be picked up again.
  const keep = useCallback((next: OrionSearchSession) => {
    setSession(next)
    if (next.turns.length) void window.api.saveSearchSession(next).catch(() => undefined)
  }, [])

  const showEarlier = useCallback(() => {
    void window.api
      .listSearchSessions()
      .then(setEarlier)
      .catch(() => setEarlier([]))
  }, [])

  const reopen = useCallback(
    async (id: string) => {
      const found = await window.api.getSearchSession(id).catch(() => null)
      setEarlier(null)
      if (!found) return onNotify?.('That research is no longer saved.', 'warn')
      stopRef.current?.()
      live.current.busy = false
      setAsking(null)
      setSession(found)
    },
    [onNotify]
  )

  /**
   * One question in the session.
   *
   * Research happens first when the question needs it — the first question always, and later ones when they ask how
   * things are now. Then Orion is asked, with this session's own context and nothing else.
   */
  const ask = useCallback(
    async (question: string, options: { starting?: boolean } = {}) => {
      const text = question.trim()
      if (!text || live.current.busy) return
      live.current.busy = true
      stopRef.current?.()

      let current = live.current.session
      if (!current || options.starting) current = newSearchSession('default', text)
      else if (changesTopic(text)) current = withTopic(current, text)

      const constraint = constraintIn(text)
      if (constraint && current.turns.length) current = withConstraint(current, constraint)

      // The first question always looks; later ones look again only when they are asking about now.
      const fresh = !current.turns.length || wantsFreshResearch(text)
      setAsking({ question: text, text: '', done: false, researched: fresh })

      if (fresh) {
        // The words to search are the question, plus what the session is about when the question leans on it.
        const lean = isFollowUp(text, current) && current.topic ? `${current.topic} ${text}` : text
        const found = (await window.api.runSearch(lean, 'all').catch(() => null)) as SearchOutcomeView | null
        if (found && 'results' in found && found.results.length) {
          const { sources } = addSources(current, found.results, current.turns.length)
          current = { ...current, sources }
        }
      }

      const context = buildAsk(current, text, { fresh })
      const requestId = `os${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      let answer = ''

      const off = window.api.onChatEvent(requestId, (event) => {
        if (event.type === 'delta') {
          answer += event.content ?? ''
          setAsking((now) => (now && now.question === text ? { ...now, text: answer } : now))
        } else if (event.type === 'done' || event.type === 'error') {
          off()
          stopRef.current = null
          live.current.busy = false
          const finished = answer.trim()
          setAsking(null)
          if (!finished) {
            onNotify?.('Orion could not answer just now.', 'warn')
            setSession(current)
            return
          }
          const used = referencedItems(text, current.sources.length)
          keep(addTurn(current, { id: requestId, question: text, answer: finished, used, researched: fresh, at: Date.now() }))
        }
      })
      stopRef.current = () => {
        off()
        live.current.busy = false
        void window.api.abortChat(requestId).catch(() => undefined)
      }

      // A standalone request: no conversation is made, and nothing here reaches Orbis Chat.
      void window.api
        .sendChat({ requestId, model: AUTO_MODEL, ask: true, images: false, messages: [{ id: requestId, role: 'user', content: context.prompt, createdAt: Date.now() }] })
        .catch(() => {
          off()
          live.current.busy = false
          setAsking(null)
          onNotify?.('Orion could not be reached.', 'warn')
        })
      setSession(current)
    },
    [onNotify, keep]
  )

  // A new query from the address bar starts a new session; a follow-up continues the one there is. "Continue my research
  // on …" reopens the saved session it means, rather than starting from nothing.
  const started = useRef('')
  useEffect(() => {
    const text = query.trim()
    if (!text || started.current === text) return
    started.current = text
    const about = resumeRequest(text)
    if (!about) {
      void ask(text, { starting: true })
      return
    }
    void window.api
      .findSearchSession(about)
      .catch(() => null)
      .then((found) => {
        if (found) {
          setSession(found)
          onNotify?.(`Picked up your research on ${found.topic}.`, 'info')
        } else {
          onNotify?.(`There is no saved research about ${about}, so this starts a new search.`, 'info')
          void ask(about, { starting: true })
        }
      })
  }, [query, ask, onNotify])

  useEffect(() => () => stopRef.current?.(), [])

  const send = (): void => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void ask(text)
  }

  const speak = async (): Promise<void> => {
    const spoken = await voice.toggle()
    if (spoken) {
      setDraft((current) => (current.trim() ? `${current.trimEnd()} ${spoken}` : spoken))
      requestAnimationFrame(() => followRef.current?.focus())
    } else if (voice.error) {
      onNotify?.(voice.error, 'warn')
    }
  }

  const turns = session?.turns ?? []
  const busy = Boolean(asking)

  return (
    <section className="oorion" aria-label="Orion search">
      {earlier && (
        <div className="oorion-earlier" role="dialog" aria-label="Earlier research">
          <div className="oorion-earlier-head">
            <h4>Earlier research</h4>
            <button type="button" onClick={() => setEarlier(null)}>
              Close
            </button>
          </div>
          {earlier.length === 0 ? (
            <p className="oorion-earlier-empty">Nothing saved yet. Research is saved here as you ask.</p>
          ) : (
            <ul>
              {earlier.map((item) => (
                <li key={item.id}>
                  <button type="button" className="oorion-earlier-open" onClick={() => void reopen(item.id)}>
                    <b className="truncate">{item.title}</b>
                    <small>
                      {item.turns} {item.turns === 1 ? 'question' : 'questions'} · {item.sources} sources · {new Date(item.updatedAt).toLocaleDateString()}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="oorion-earlier-remove"
                    aria-label={`Delete saved research: ${item.title}`}
                    onClick={() => void window.api.removeSearchSession(item.id).then(showEarlier)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {turns.length === 0 && !asking && (
        <div className="oorion-head">
          <button type="button" className="oorion-new" onClick={showEarlier}>
            <History size={13} /> Earlier research
          </button>
        </div>
      )}

      {turns.length > 0 && (
        <div className="oorion-head">
          <span className="oorion-topic truncate">{session?.topic}</span>
          <button type="button" className="oorion-new" title="Research saved earlier" onClick={showEarlier}>
            <History size={13} /> Earlier
          </button>
          <button
            type="button"
            className="oorion-new"
            title="Start a search that knows nothing about this one"
            onClick={() => {
              stopRef.current?.()
              live.current.busy = false
              setAsking(null)
              setSession(null)
              started.current = ''
              setDraft('')
              onOpen('orbis://search')
            }}
          >
            <Plus size={13} /> New search
          </button>
        </div>
      )}

      <ol className="oorion-thread">
        {turns.map((turn) => (
          <li key={turn.id} className="oorion-turn">
            <p className="oorion-question">{turn.question}</p>
            <div className="oorion-answer">
              <h3>
                <Sparkles size={13} aria-hidden="true" /> Orion
                {turn.researched && <small>searched the web</small>}
              </h3>
              <p>{turn.answer}</p>
            </div>
          </li>
        ))}

        {asking && (
          <li className="oorion-turn">
            <p className="oorion-question">{asking.question}</p>
            <div className="oorion-answer">
              <h3>
                <Sparkles size={13} aria-hidden="true" /> Orion
                {asking.researched && <small>searching the web…</small>}
              </h3>
              <p>
                {asking.text}
                <span className="osearch-caret" aria-hidden="true" />
              </p>
            </div>
          </li>
        )}
      </ol>

      {/* Everything found in this session, numbered once, so a citation means the same thing in every answer. */}
      {session && session.sources.length > 0 && (
        <section className="oorion-sources" aria-label="Sources in this search">
          <h4>Sources</h4>
          <ol>
            {session.sources.map((source, i) => (
              <li key={source.url}>
                <button type="button" onClick={() => onOpen(source.url)} title={source.snippet}>
                  <span className="oorion-number">{i + 1}</span>
                  <SiteIcon url={source.url} size={14} />
                  <span className="oorion-source-text">
                    <b className="truncate">{source.title}</b>
                    <small className="truncate">{source.site}</small>
                  </span>
                  <ExternalLink size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <form
        className="oorion-ask"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          ref={followRef}
          rows={1}
          value={draft}
          placeholder={turns.length ? 'Ask a follow-up…' : 'Ask Orion…'}
          aria-label="Ask Orion a follow-up in this search"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        {voice.available && (
          <button type="button" className={`oorion-mic${voice.recording ? ' recording' : ''}`} aria-label={voice.recording ? 'Stop recording' : 'Speak instead of typing'} disabled={voice.transcribing} onClick={() => void speak()}>
            {voice.recording ? <Square size={13} /> : <Sparkles size={14} />}
          </button>
        )}
        {busy ? (
          <button
            type="button"
            className="oorion-send"
            aria-label="Stop"
            title="Stop"
            onClick={() => {
              stopRef.current?.()
              setAsking(null)
            }}
          >
            <Loader size={15} className="spin" />
          </button>
        ) : (
          <button type="submit" className="oorion-send" aria-label="Ask" disabled={!draft.trim()}>
            <ArrowUp size={15} />
          </button>
        )}
      </form>
    </section>
  )
}
