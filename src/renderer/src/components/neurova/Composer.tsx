import { useEffect, useRef, useState } from 'react'
import { INSTRUMENTS, GENRES, MOODS, SECTIONS, CAPTION_MAX, LYRICS_MAX, LENGTH_RANGE, TEMPO_RANGE, buildCaption, countAgainst, insertSection, parseBounded, toggleChip } from '../../../../shared/neurova/composer'

export interface Composed { brief: string; lyrics: string; caption: string; instrumental: boolean; durationSec: number | undefined }

function Chips({ title, items, chosen, onToggle }: { title: string; items: readonly string[]; chosen: string[]; onToggle: (c: string) => void }): React.JSX.Element {
  return (
    <div className="nv-chipset" role="group" aria-label={title}>
      <strong>{title}</strong>
      {items.map((c) => <button key={c} type="button" className="nv-chip" aria-pressed={chosen.includes(c)} onClick={() => onToggle(c)}>{c}</button>)}
    </div>
  )
}

/** Brief, style chips, tempo, length, instrumental and lyrics. Text is only ever added to, never cut. */
export function Composer({ projectKey, brief: initialBrief, lyrics: initialLyrics, onCommit, onChange, onLyricsBlur }: {
  projectKey: string; brief: string; lyrics: string
  onCommit: (patch: { brief?: string; lyrics?: string }) => void
  onChange: (c: Composed) => void
  onLyricsBlur: (text: string) => void
}): React.JSX.Element {
  const [brief, setBrief] = useState(initialBrief)
  const [lyrics, setLyrics] = useState(initialLyrics)
  const [chips, setChips] = useState<string[]>([])
  const [tempo, setTempo] = useState('')
  const [seconds, setSeconds] = useState('30')
  const [instrumental, setInstrumental] = useState(false)
  const [understood, setUnderstood] = useState<string[]>([])
  const lyricRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setBrief(initialBrief); setLyrics(initialLyrics); setChips([]) }, [projectKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const tempoBpm = parseBounded(tempo, TEMPO_RANGE)
  const durationSec = parseBounded(seconds, LENGTH_RANGE) ?? undefined
  const caption = buildCaption({ brief, chips, tempoBpm })
  const capCount = countAgainst(caption, CAPTION_MAX)
  const lyrCount = countAgainst(lyrics, LYRICS_MAX)

  useEffect(() => { onChange({ brief, lyrics, caption, instrumental, durationSec }) }, [brief, lyrics, caption, instrumental, durationSec]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!brief.trim()) { setUnderstood([]); return }
    const t = setTimeout(() => {
      void window.api.neurovaUnderstand(brief, lyrics || undefined).then((r) => {
        const reqs = (r.requirements as { text: string; kind: string }[] | undefined) ?? []
        const inf = (r.inferred as { text: string; confidence: string }[] | undefined) ?? []
        setUnderstood([
          ...reqs.map((q) => `${q.kind === 'avoid' ? 'Avoid' : q.kind === 'prefer' ? 'Prefer' : 'Needs'}: ${q.text}`),
          ...inf.map((q) => `Guessed (${q.confidence} confidence): ${q.text}`)
        ].slice(0, 8))
      }).catch(() => setUnderstood([]))
    }, 500)
    return () => clearTimeout(t)
  }, [brief, lyrics])

  const tog = (c: string): void => setChips((x) => toggleChip(x, c))
  const addSection = (label: string): void => {
    const el = lyricRef.current
    const r = insertSection(lyrics, label, el ? el.selectionStart : lyrics.length)
    setLyrics(r.text)
    onCommit({ lyrics: r.text })
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.caret, r.caret) })
  }

  return (
    <div className="nv-composer">
      <label className="nv-label">What this song is meant to be
        <textarea value={brief} rows={3} onChange={(e) => setBrief(e.target.value)} onBlur={() => brief !== initialBrief && onCommit({ brief })} />
      </label>
      <span className={`nv-count${capCount.over ? ' is-over' : ''}`} aria-live="polite">
        Description sent to the engine: {capCount.used} of {CAPTION_MAX}{capCount.over ? ` (${-capCount.remaining} too long; it will not be shortened for you)` : ''}
      </span>
      <Chips title="Genre" items={GENRES} chosen={chips} onToggle={tog} />
      <Chips title="Mood" items={MOODS} chosen={chips} onToggle={tog} />
      <Chips title="Instruments" items={INSTRUMENTS} chosen={chips} onToggle={tog} />
      <div className="nv-controls">
        <label className="nv-faint">Tempo (BPM) <input style={{ width: 64 }} value={tempo} inputMode="numeric" placeholder="auto" aria-label="Tempo in beats per minute" onChange={(e) => setTempo(e.target.value)} /></label>
        <label className="nv-faint">Length (s) <input style={{ width: 64 }} value={seconds} inputMode="numeric" aria-label="Length in seconds" onChange={(e) => setSeconds(e.target.value)} /></label>
        <label className="nv-faint"><input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> Instrumental</label>
        {tempo.trim() !== '' && tempoBpm === null && <span className="nv-bad">Tempo must be {TEMPO_RANGE.min} to {TEMPO_RANGE.max}; it is not being sent.</span>}
        {seconds.trim() !== '' && durationSec === undefined && <span className="nv-bad">Length must be {LENGTH_RANGE.min} to {LENGTH_RANGE.max} seconds; the engine default is used.</span>}
      </div>
      {understood.length > 0 && (
        <div>
          <span className="nv-faint">How this was read</span>
          <ul className="nv-understood">{understood.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </div>
      )}
      <div className="nv-chipset" role="group" aria-label="Insert a lyrics section">
        <strong>Lyrics</strong>
        {SECTIONS.map((s) => <button key={s} type="button" className="nv-chip" onClick={() => addSection(s)}>[{s}]</button>)}
      </div>
      <textarea ref={lyricRef} value={lyrics} rows={5} aria-label="Lyrics" disabled={instrumental}
        onChange={(e) => setLyrics(e.target.value)} onBlur={() => { onLyricsBlur(lyrics); if (lyrics !== initialLyrics) onCommit({ lyrics }) }} />
      <span className={`nv-count${lyrCount.over ? ' is-over' : ''}`} aria-live="polite">
        Lyrics: {lyrCount.used} of {LYRICS_MAX}{lyrCount.over ? ` (${-lyrCount.remaining} too long; it will not be shortened for you)` : ''}{instrumental ? ' (not sent, instrumental is on)' : ''}
      </span>
    </div>
  )
}
