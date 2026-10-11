import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Circle, FileText, Info, Mic, Square, Trash2, X } from 'lucide-react'
import { SplitView } from '../ui'
import { atText, mustStop, summaryNote, titleFrom, WHAT_IT_HEARS, withPart, type Meeting } from '../../../shared/meeting'
import { voiceInput } from '../lib/voiceInput'
import { newId } from '../lib/utils'
import type { NoticeKind } from '../lib/notices'

/**
 * Notes Orbis takes while somebody talks.
 *
 * The honest shape of this is stated on the screen and not only in the code: **Orbis hears this computer's microphone
 * and nothing else.** It is not in the call and it cannot tell voices apart. That makes it a very good notebook and a
 * bad minute-taker, and saying so before anybody presses record is the difference between a useful tool and a summary
 * with half a meeting missing that nobody realises is missing.
 *
 * The words are transcribed on this machine by the local model, in stretches between pauses -- which is a real thing
 * that happened, unlike a guess at who was speaking. The audio is never kept.
 *
 * A summary is Orion reading the transcript afterwards, and is marked as that. Anything it claims somebody said they
 * would do has to quote words that really appear, or it is dropped and the dropping is reported.
 */
export default function MeetingView({ onClose, onNotify }: { onClose(): void; onNotify(text: string, kind?: NoticeKind): void }): ReactElement {
  const [notes, setNotes] = useState<Meeting[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [recording, setRecording] = useState<Meeting | null>(null)
  const [busy, setBusy] = useState(false)
  const live = useRef<Meeting | null>(null)
  live.current = recording

  const load = useCallback(() => {
    void window.api
      .meetingNotes()
      .then((done) => setNotes(done.notes ?? []))
      .catch(() => setNotes([]))
  }, [])
  useEffect(load, [load])

  /** One stretch of talking: the recording ends itself at a pause, and the next one starts straight after. */
  const listen = useCallback(() => {
    void voiceInput
      .start({
        target: 'chat',
        endOnSilence: true,
        onTranscript: (text) => {
          const now = live.current
          if (!now) return
          const next = withPart(now, text ?? '', Date.now(), newId())
          const stop = mustStop(next, Date.now())
          setRecording(next)
          if (stop) {
            onNotify(stop)
            void finish(next)
            return
          }
          listen()
        }
      })
      .catch(() => {
        onNotify('The microphone stopped, so the note stopped with it.', 'error')
        const now = live.current
        if (now) void finish(now)
      })
  }, [onNotify])

  const finish = useCallback(
    async (note: Meeting) => {
      void voiceInput.cancel()
      setRecording(null)
      if (!note.parts.length) return onNotify('Nothing was said, so there is no note to keep.')
      const done: Meeting = { ...note, endedAt: Date.now(), title: note.title || titleFrom(note, note.startedAt) }
      await window.api.saveMeetingNote(done)
      load()
      setOpenId(done.id)
    },
    [load, onNotify]
  )

  const start = (): void => {
    const note: Meeting = { id: newId(), title: '', startedAt: Date.now(), endedAt: null, parts: [] }
    setRecording(note)
    live.current = note
    setOpenId(null)
    listen()
  }

  // Leaving the screen stops the microphone rather than leaving it open behind a closed window.
  useEffect(
    () => () => {
      void voiceInput.cancel()
    },
    []
  )

  const open = notes.find((one) => one.id === openId) ?? null

  const summarise = (note: Meeting): void => {
    setBusy(true)
    void window.api
      .summariseMeetingNote(note.id)
      .then((done) => {
        if (!done.ok) return onNotify(done.message ?? 'That could not be read.', 'error')
        if (done.note) onNotify(done.note)
        load()
      })
      .finally(() => setBusy(false))
  }

  return (
    <section className="view meeting-view">
      <header className="view-head">
        <h2>Notes</h2>
        <div className="view-actions">
          {recording ? (
            <button type="button" className="queue-btn primary" onClick={() => void finish(recording)}>
              <Square size={14} aria-hidden="true" /> Stop
            </button>
          ) : (
            <button type="button" className="queue-btn primary" onClick={start}>
              <Mic size={14} aria-hidden="true" /> Start a note
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Close notes" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Said before anybody records, every time, because finding it out afterwards is finding it out too late. */}
      <p className="meeting-hears">
        <Info size={13} aria-hidden="true" /> {WHAT_IT_HEARS}
      </p>

      {recording && (
        <div className="meeting-live" role="status">
          <Circle size={10} aria-hidden="true" className="meeting-dot" />
          <b>Listening</b>
          <span className="view-muted">
            {recording.parts.length === 0 ? 'Nothing said yet' : `${recording.parts.length} part${recording.parts.length === 1 ? '' : 's'} so far`}
          </span>
          <div className="meeting-parts">
            {recording.parts.slice(-4).map((one) => (
              <p key={one.id}>
                <span className="view-muted small">{atText(one.at)}</span> {one.text}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Neither half of this screen had a name, so moving around by region gave "region, region" and you had to
          go in and read to find out which one was the list. */}
      <SplitView
        className="meeting-body"
        listLabel="Your notes"
        listClassName="meeting-list"
        listAs="ul"
        detailLabel={open ? open.title || 'Note' : 'The note you pick'}
        detailClassName="meeting-detail"
        list={
          <>
          {notes.length === 0 && !recording && <li className="view-muted">No notes yet.</li>}
          {notes.map((one) => (
            <li key={one.id} className={one.id === openId ? 'on' : ''}>
              <button type="button" onClick={() => setOpenId(one.id)}>
                <FileText size={13} aria-hidden="true" />
                <span className="truncate">{one.title || 'Note'}</span>
                <small className="view-muted">{new Date(one.startedAt).toLocaleString()}</small>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Delete ${one.title || 'this note'}`}
                onClick={() => void window.api.removeMeetingNote(one.id).then(() => (setOpenId((now) => (now === one.id ? null : now)), load()))}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
          </>
        }
        nothingPicked={<p className="view-muted">Pick a note, or start one.</p>}
        detail={
          open && (
            <>
              <div className="meeting-detail-head">
                <h3>{open.title || 'Note'}</h3>
                <button type="button" className="queue-btn small" disabled={busy} onClick={() => summarise(open)}>
                  {busy ? 'Reading…' : open.summary ? 'Read it again' : 'Summarise and find actions'}
                </button>
              </div>

              {open.summary && (
                <div className="meeting-summary">
                  {/* Marked as a reading, always: the transcript below is what was actually said. */}
                  <p className="view-muted small">{summaryNote(open.summary, 0)}</p>
                  {open.summary.points.length > 0 && (
                    <>
                      <h4>What was talked about</h4>
                      <ul>
                        {open.summary.points.map((one) => (
                          <li key={one}>{one}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <h4>Things to do</h4>
                  {open.summary.actions.length === 0 ? (
                    <p className="view-muted">Nobody said they would do anything.</p>
                  ) : (
                    <ul>
                      {open.summary.actions.map((one) => (
                        <li key={one.what}>
                          {one.what} <q className="view-muted small">{one.from}</q>
                        </li>
                      ))}
                    </ul>
                  )}
                  {open.summary.decisions.length > 0 && (
                    <>
                      <h4>Decided</h4>
                      <ul>
                        {open.summary.decisions.map((one) => (
                          <li key={one.what}>
                            {one.what} <q className="view-muted small">{one.from}</q>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              <h4>What was said</h4>
              <div className="meeting-parts">
                {open.parts.map((one) => (
                  <p key={one.id}>
                    <span className="view-muted small">{atText(one.at)}</span> {one.text}
                  </p>
                ))}
              </div>
            </>
          )
        }
      />
    </section>
  )
}
