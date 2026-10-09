import { useState } from 'react'
import { Camera, Check, Sparkles, X } from 'lucide-react'
import Drafts from './Drafts'
import type { Call } from './useStudent'
import type { NoticeKind } from '../../lib/notices'

/**
 * A photograph of somebody's work, read into words.
 *
 * ## It does not mark the work
 *
 * Reading a picture of an answer and saying it is wrong is the most tempting thing here and the most dangerous: a
 * misread minus sign would tell a student their correct answer is wrong, and they would believe it — it looked at
 * their page. So this reads, and the marking stays where it already is: their own tick, against their own notes.
 *
 * ## What it read is shown before anything is done with it
 *
 * A photograph read wrongly is obvious the moment the words are on screen, and silent if they go straight into a
 * syllabus. So the text comes up first, every time, and the buttons come after it.
 *
 * ## The picture is not kept
 *
 * It goes to be read and is not stored by Student afterwards.
 */

interface Read {
  kind: 'notes' | 'question' | 'worked-answer' | 'timetable' | 'unreadable'
  words: string
  topics: string[]
  unreadable: string | null
}

const KINDS: Record<Read['kind'], string> = {
  notes: 'Looks like notes',
  question: 'Looks like a question',
  'worked-answer': 'Looks like a worked answer',
  timetable: 'Looks like a timetable',
  unreadable: 'Could not read it'
}

export default function Photo({
  call,
  onClose,
  onNotify
}: {
  call: Call
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [read, setRead] = useState<Read | null>(null)
  const [next, setNext] = useState<{ label: string; action: string }[]>([])
  const [why, setWhy] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [drafting, setDrafting] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [into, setInto] = useState({ subject: '', chapter: '' })

  const pick = async (): Promise<void> => {
    const picked = await window.api.pickImages().catch(() => null)
    const image = picked?.attachments?.[0]
    if (!image) return
    setLooking(true)
    setWhy(null)
    const out = await call<{ ok: boolean; read?: Read; next?: { label: string; action: string }[]; why?: string }>(
      'read-photo',
      image.content.startsWith('data:') ? image.content : `data:${image.mimeType || 'image/jpeg'};base64,${image.content}`
    )
    setLooking(false)
    if (!out?.ok || !out.read) {
      setWhy(out?.why ?? 'Nothing came back.')
      return
    }
    setRead(out.read)
    setNext(out.next ?? [])
    setTicked(new Set(out.read.topics))
  }

  const addTopics = async (): Promise<void> => {
    if (!read) return
    const gap = String.fromCharCode(10)
    const lines = [into.subject.trim() || 'General', `  ${into.chapter.trim() || 'From a photo'}`, ...[...ticked].map((one) => `    ${one}`)]
    const out = await call<{ added: number }>('import-syllabus', lines.join(gap))
    onNotify(out && out.added > 0 ? `${out.added} topics added.` : 'Nothing new to add — Orbis already had those.')
  }

  return (
    <div className="st-sheet" role="dialog" aria-modal="true" aria-label="A photo of your work">
      <div className="st-sheet-card">
        <header className="st-challenge-head">
          <div>
            <h3>A photo of your work</h3>
            <p className="st-faint small">
              <Camera size={12} aria-hidden /> Read into words and topics · it never says whether the work is right
            </p>
          </div>
          <button type="button" className="st-icon" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>

        {!read ? (
          <>
            <p className="st-faint small">
              A page of a book, your notes, a question sheet. The picture is read on this computer's behalf and is not
              kept afterwards.
            </p>
            {why ? <p className="st-empty">{why}</p> : null}
            <div className="st-sheet-foot">
              <button type="button" className="st-btn primary" onClick={() => void pick()} disabled={looking}>
                <Camera size={15} aria-hidden /> {looking ? 'Reading it…' : 'Choose a picture'}
              </button>
              <button type="button" className="st-btn quiet" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {read ? (
          <>
            <p className="st-faint small">{KINDS[read.kind]}</p>
            {/* What it read, before anything is done with it. */}
            <p className="st-explained">{read.words}</p>
            {read.unreadable ? <p className="st-faint small">Could not read: {read.unreadable}</p> : null}

            {read.topics.length > 0 ? (
              <>
                <h4>Topics in it</h4>
                <div className="st-row-actions">
                  {read.topics.map((one) => (
                    <button
                      key={one}
                      type="button"
                      className={`st-pill${ticked.has(one) ? ' on' : ''}`}
                      aria-pressed={ticked.has(one)}
                      onClick={() =>
                        setTicked((held) => {
                          const copy = new Set(held)
                          if (copy.has(one)) copy.delete(one)
                          else copy.add(one)
                          return copy
                        })
                      }
                    >
                      {one}
                    </button>
                  ))}
                </div>
                <div className="st-row-actions">
                  <label className="st-field inline">
                    <span>Subject</span>
                    <input value={into.subject} onChange={(e) => setInto({ ...into, subject: e.target.value.slice(0, 80) })} aria-label="Subject" />
                  </label>
                  <label className="st-field inline">
                    <span>Chapter</span>
                    <input value={into.chapter} onChange={(e) => setInto({ ...into, chapter: e.target.value.slice(0, 120) })} aria-label="Chapter" />
                  </label>
                </div>
              </>
            ) : null}

            <div className="st-sheet-foot wrap">
              {next.some((one) => one.action === 'cards') ? (
                <button type="button" className="st-btn primary" onClick={() => setDrafting(read.words)}>
                  <Sparkles size={15} aria-hidden /> Make cards from this
                </button>
              ) : null}
              {read.topics.length > 0 ? (
                <button type="button" className="st-btn" disabled={ticked.size === 0} onClick={() => void addTopics()}>
                  <Check size={15} aria-hidden /> Add {ticked.size} {ticked.size === 1 ? 'topic' : 'topics'}
                </button>
              ) : null}
              <button
                type="button"
                className="st-btn quiet"
                onClick={() => {
                  setRead(null)
                  setNext([])
                }}
              >
                Another picture
              </button>
              <button type="button" className="st-btn quiet" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : null}
      </div>

      {drafting !== null ? (
        <Drafts
          material={drafting}
          call={call}
          onNotify={(message, kind) => onNotify(message, kind)}
          onKept={() => setDrafting(null)}
          onClose={() => setDrafting(null)}
        />
      ) : null}
    </div>
  )
}
