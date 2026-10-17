import { useCallback, useEffect, useMemo, useState } from 'react'
import { Camera, Check, Pencil, Play, Plus, Sparkles, Trash2, X } from 'lucide-react'
import Drafts from './Drafts'
import Photo from './Photo'
import Hints, { type Question } from './Hints'
import TeachBack from './TeachBack'
import type { Call } from './useStudent'
import type { Flashcard } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'
import { SearchBox } from '../../ui'

/**
 * Cards: the questions a student writes for themselves.
 *
 * ## Why this screen had to exist
 *
 * Orbis already tested people on their own cards — the chapter test is built from nothing else — and there was no
 * way to write one. The cards could only arrive from the browser, so for anybody using the Orbis window the test
 * said "there is nothing of your own to test you on" for ever, which is true and useless.
 *
 * ## Practising is the same machinery as everywhere else
 *
 * The hint ladder, the self-marking and what an attempt proves are shared with the chapter test, so a card answered
 * after being shown its answer records as reading here too. One set of rules about what counts, in one place.
 *
 * ## A card may name a topic, and is not guessed at
 *
 * If a card says which concept it is about, practising it moves that concept's mastery. If it does not, practice
 * still counts on the card and claims nothing about any topic — Orbis does not read the words and decide.
 */

const NEW_CARD = { front: '', back: '', deck: 'Default', subject: '', conceptId: '' }

export default function Cards({
  call,
  onNotify
}: {
  call: Call
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [cards, setCards] = useState<Flashcard[]>([])
  const [concepts, setConcepts] = useState<{ id: string; name: string; subject: string | null }[]>([])
  const [query, setQuery] = useState('')
  const [deck, setDeck] = useState<string | null>(null)
  const [editing, setEditing] = useState<(typeof NEW_CARD & { id?: string }) | null>(null)
  const [run, setRun] = useState<{
    cards: Flashcard[]
    at: number
    shown: boolean
    /** Help taken on the card in front of them, cleared with every card. */
    rungs: ('where' | 'shape' | 'half' | 'all')[]
    right: number
    says: string | null
  } | null>(null)
  const [explaining, setExplaining] = useState<Question | null>(null)
  /** Drafting from a piece of material, when Orion is set up. */
  const [canGenerate, setCanGenerate] = useState(false)
  const [pasting, setPasting] = useState<string | null>(null)
  const [drafting, setDrafting] = useState<string | null>(null)
  /** Looking at a picture is a different key from the writing, so it is a separate question. */
  const [canLook, setCanLook] = useState(false)
  const [photo, setPhoto] = useState(false)
  const [ready, setReady] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const [held, known] = await Promise.all([call<Flashcard[]>('flashcards'), call<{ id: string; name: string; subject: string | null }[]>('concepts-with-mastery')])
    setCards(Array.isArray(held) ? held : [])
    setConcepts(Array.isArray(known) ? known.map((one) => ({ id: one.id, name: one.name, subject: one.subject })) : [])
    setReady(true)
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void call<{ ok: boolean }>('can-generate').then((out) => setCanGenerate(out?.ok === true))
    void call<{ ok: boolean }>('can-look').then((out) => setCanLook(out?.ok === true))
  }, [call])

  const decks = useMemo(() => [...new Set(cards.map((one) => one.deck || 'Default'))].sort(), [cards])

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return cards
      .filter((one) => (deck ? (one.deck || 'Default') === deck : true))
      .filter((one) => (words ? `${one.front} ${one.back} ${one.subject ?? ''}`.toLowerCase().includes(words) : true))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [cards, deck, query])

  const save = async (): Promise<void> => {
    if (!editing) return
    const front = editing.front.trim()
    const back = editing.back.trim()
    if (!front || !back) {
      onNotify('A card needs both halves.', 'warn')
      return
    }
    await call('save-flashcard', {
      ...(editing.id ? { id: editing.id } : {}),
      front,
      back,
      deck: editing.deck.trim() || 'Default',
      subject: editing.subject.trim() || null,
      conceptId: editing.conceptId || null
    })
    setEditing(null)
    onNotify(editing.id ? 'Card saved.' : 'Card added.')
    await load()
  }

  const remove = async (card: Flashcard): Promise<void> => {
    await call('remove-flashcard', card.id)
    onNotify('Card deleted.')
    await load()
  }

  // ---------------------------------------------------------------- practising

  const startRun = (): void => {
    if (shown.length === 0) return
    /*
     * Least practised first, then the oldest.
     *
     * Not shuffled: a run that is random each time keeps asking the same easy three. The ones answered least are
     * the ones worth seeing, and this is a plain ordering anybody can check rather than a hidden algorithm.
     */
    const order = [...shown].sort((a, b) => a.practised - b.practised || (a.lastPractisedAt ?? 0) - (b.lastPractisedAt ?? 0))
    setRun({ cards: order, at: 0, shown: false, rungs: [], right: 0, says: null })
  }

  const mark = async (right: boolean): Promise<void> => {
    if (!run) return
    const card = run.cards[run.at]
    const out = await call<{ run: number; says: string | null }>('practised-card', {
      id: card.id,
      right,
      rungs: run.rungs,
      sittingId: `cards:${card.deck}`
    })
    const next = run.at + 1
    if (next >= run.cards.length) {
      onNotify(`${run.right + (right ? 1 : 0)} of ${run.cards.length} from memory.`)
      setRun(null)
      await load()
      return
    }
    setRun({ ...run, at: next, shown: false, rungs: [], right: run.right + (right ? 1 : 0), says: out?.says ?? null })
  }

  const card = run ? run.cards[run.at] : null

  return (
    <div className="st-cards-page">
      <header className="st-section-head">
        <div>
          <h2>Cards</h2>
          <p className="st-faint">
            Questions you write for yourself. These are what Orbis tests you on — it never writes a question of its own.
          </p>
        </div>
        <div className="st-row-right">
          <button type="button" className="st-btn" disabled={shown.length === 0} onClick={startRun}>
            <Play size={15} aria-hidden /> Practise {shown.length > 0 ? `(${shown.length})` : ''}
          </button>
          {canGenerate ? (
            <button type="button" className="st-btn" onClick={() => setPasting('')}>
              <Sparkles size={15} aria-hidden /> From my notes
            </button>
          ) : null}
          {canLook ? (
            <button type="button" className="st-btn" onClick={() => setPhoto(true)}>
              <Camera size={15} aria-hidden /> From a photo
            </button>
          ) : null}
          <button type="button" className="st-btn primary" onClick={() => setEditing({ ...NEW_CARD, deck: deck ?? 'Default' })}>
            <Plus size={15} aria-hidden /> New card
          </button>
        </div>
      </header>

      {ready && cards.length === 0 ? (
        <p className="view-empty">
          No cards yet. Write one for something you keep forgetting — a question on the front, the answer on the back.
          Chapter tests are built from these.
        </p>
      ) : null}

      {cards.length > 0 ? (
        <div className="st-cards-filters">
          <SearchBox
            value={query}
            onChange={(next) => setQuery(next.slice(0, 120))}
            label="Search your cards"
            maxLength={120}
            className="st-cards-find"
          />
          <div className="st-row-actions">
            <button type="button" className={`st-pill${deck === null ? ' on' : ''}`} aria-pressed={deck === null} onClick={() => setDeck(null)}>
              All ({cards.length})
            </button>
            {decks.map((one) => (
              <button key={one} type="button" className={`st-pill${deck === one ? ' on' : ''}`} aria-pressed={deck === one} onClick={() => setDeck(one)}>
                {one} ({cards.filter((two) => (two.deck || 'Default') === one).length})
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ul className="st-card-list">
        {shown.map((one) => {
          const named = concepts.find((two) => two.id === one.conceptId)
          return (
            <li key={one.id}>
              <div className="st-card-text">
                <strong>{one.front}</strong>
                <p>{one.back}</p>
                <span className="st-faint small">
                  {one.deck || 'Default'}
                  {one.subject ? ` · ${one.subject}` : ''}
                  {named ? ` · ${named.name}` : ''}
                  {/* Where it came from, said plainly wherever the card is shown. */}
                  {one.origin === 'web' ? ' · kept while browsing' : one.origin === 'orion' ? ' · written by Orion' : ''}
                  {one.practised > 0 ? ` · ${one.recalled} of ${one.practised} from memory` : ' · not practised yet'}
                </span>
              </div>
              <div className="st-row-right">
                <button
                  type="button"
                  className="st-icon"
                  aria-label={`Edit: ${one.front}`}
                  onClick={() =>
                    setEditing({
                      id: one.id,
                      front: one.front,
                      back: one.back,
                      deck: one.deck || 'Default',
                      subject: one.subject ?? '',
                      conceptId: one.conceptId ?? ''
                    })
                  }
                >
                  <Pencil size={15} aria-hidden />
                </button>
                <button type="button" className="st-icon" aria-label={`Delete: ${one.front}`} onClick={() => void remove(one)}>
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {ready && cards.length > 0 && shown.length === 0 ? <p className="st-empty">No cards match that.</p> : null}

      {/* ---- writing one */}
      {editing ? (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label={editing.id ? 'Edit card' : 'New card'}>
          <div className="st-sheet-card">
            <header className="st-challenge-head">
              <h3>{editing.id ? 'Edit this card' : 'A new card'}</h3>
              <button type="button" className="st-icon" aria-label="Close" onClick={() => setEditing(null)}>
                <X size={16} aria-hidden />
              </button>
            </header>

            <label className="st-field">
              <span>The question</span>
              <textarea rows={2} value={editing.front} onChange={(e) => setEditing({ ...editing, front: e.target.value.slice(0, 1000) })} aria-label="The question" />
            </label>
            <label className="st-field">
              <span>The answer</span>
              <textarea rows={4} value={editing.back} onChange={(e) => setEditing({ ...editing, back: e.target.value.slice(0, 2000) })} aria-label="The answer" />
            </label>
            <div className="st-row-actions">
              <label className="st-field inline">
                <span>Deck</span>
                <input value={editing.deck} onChange={(e) => setEditing({ ...editing, deck: e.target.value.slice(0, 80) })} aria-label="Deck" list="st-deck-names" />
                <datalist id="st-deck-names">
                  {decks.map((one) => (
                    <option key={one} value={one} />
                  ))}
                </datalist>
              </label>
              <label className="st-field inline">
                <span>Subject</span>
                <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value.slice(0, 80) })} aria-label="Subject" />
              </label>
            </div>

            {/* Optional, and never guessed: a card only counts toward a topic when the student says which. */}
            <label className="st-field">
              <span>About a topic? (optional)</span>
              <select value={editing.conceptId} onChange={(e) => setEditing({ ...editing, conceptId: e.target.value })} aria-label="The topic this card is about">
                <option value="">Not tied to one</option>
                {concepts.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.subject ? `${one.subject} — ${one.name}` : one.name}
                  </option>
                ))}
              </select>
              <small>Practising a card that names a topic is what moves that topic on the mastery map.</small>
            </label>

            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={() => void save()}>
                <Check size={15} aria-hidden /> {editing.id ? 'Save' : 'Add it'}
              </button>
              <button type="button" className="st-btn quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- practising */}
      {run && card ? (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label="Practising your cards">
          <div className="st-sheet-card">
            <header className="st-challenge-head">
              <div>
                <h3>Practice</h3>
                <p className="st-faint small">
                  {run.at + 1} of {run.cards.length}
                  {card.practised > 0 ? ` · seen ${card.practised} ${card.practised === 1 ? 'time' : 'times'}` : ' · first time'}
                </p>
              </div>
              <button type="button" className="st-icon" aria-label="Stop practising" onClick={() => setRun(null)}>
                <X size={16} aria-hidden />
              </button>
            </header>

            <div className="st-challenge-progress" aria-hidden>
              <span className="st-bar">
                <span style={{ width: `${((run.at + 1) / run.cards.length) * 100}%` }} />
              </span>
            </div>

            <p className="st-challenge-ask">{card.front}</p>

            {run.shown ? (
              <p className="st-challenge-answer">{card.back}</p>
            ) : (
              <>
                <Hints
                  question={{ ask: card.front, answer: card.back, source: 'flashcard', conceptId: card.conceptId }}
                  call={call}
                  taken={run.rungs}
                  onTaken={(rung) => setRun({ ...run, rungs: run.rungs.includes(rung) ? run.rungs : [...run.rungs, rung] })}
                  onTeachBack={() => setExplaining({ ask: card.front, answer: card.back, source: 'flashcard', conceptId: card.conceptId })}
                />
                <button type="button" className="st-btn" onClick={() => setRun({ ...run, shown: true })}>
                  Show the answer
                </button>
              </>
            )}

            {run.shown ? (
              <div className="st-row-actions">
                <button type="button" className="st-btn primary" onClick={() => void mark(true)}>
                  <Check size={15} aria-hidden /> I had it
                </button>
                <button type="button" className="st-btn" onClick={() => void mark(false)}>
                  Not quite
                </button>
              </div>
            ) : null}

            {run.says ? <p className="st-challenge-says">{run.says}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Paste or read in the material first, so you see exactly what Orion will be working from. */}
      {pasting !== null ? (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label="Make cards from your notes">
          <div className="st-sheet-card">
            <h3>Cards from your notes</h3>
            <p className="st-faint small">
              Paste a page of notes, or read a file in. Orion drafts the cards and you keep the ones that are right —
              nothing is saved until you tick it.
            </p>
            <textarea
              className="st-syllabus"
              rows={10}
              value={pasting}
              onChange={(e) => setPasting(e.target.value.slice(0, 20_000))}
              placeholder="Paste your notes here"
              aria-label="Your notes"
            />
            <div className="st-sheet-foot wrap">
              <button type="button" className="st-btn primary" disabled={pasting.trim().length < 40} onClick={() => setDrafting(pasting)}>
                <Sparkles size={15} aria-hidden /> Draft the cards
              </button>
              <button
                type="button"
                className="st-btn"
                onClick={() =>
                  void window.api
                    .pickTextFiles()
                    .then((picked) => {
                      const files = picked?.attachments ?? []
                      if (files.length === 0) return
                      const gap = String.fromCharCode(10)
                      setPasting(files.map((one) => `${one.name}${gap}${one.content}`).join(gap + gap).slice(0, 20_000))
                    })
                    .catch(() => onNotify('That file could not be read.', 'warn'))
                }
              >
                Read a file
              </button>
              <button type="button" className="st-btn quiet" onClick={() => setPasting(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {drafting !== null ? (
        <Drafts
          material={drafting}
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onKept={() => {
            setPasting(null)
            void load()
          }}
          onClose={() => setDrafting(null)}
        />
      ) : null}

      {photo ? (
        <Photo
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onClose={() => {
            setPhoto(false)
            void load()
          }}
        />
      ) : null}

      {explaining ? (
        <TeachBack question={explaining} call={call} onNotify={(message, kind) => onNotify(message, kind)} onClose={() => setExplaining(null)} />
      ) : null}
    </div>
  )
}
