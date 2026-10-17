import { useState } from 'react'
import { Button } from '../../../ui'
import { readPasted, type LoadedPosition } from '../../../../../shared/chess/analysisBoard'

/**
 * Getting a position in and out of the analysis board.
 *
 * The analysis board could only ever show a game out of your Library, so "have a look at this position" meant
 * saving a game first, and there was no way at all to copy the position back out. This is the panel that fixes
 * both: the position as a FEN, the line as a PGN, both copyable, and a box you can paste either one into.
 *
 * A pasted board is a scratch board, and the panel says so in one line rather than letting it look like one of your
 * games. Nothing pasted here is written to your Library: `readPasted` reads it, the screen holds it, and leaving
 * the scratch board puts your own game back exactly as it was.
 */

export interface PositionPanelProps {
  /** The position in front of you, which is what gets copied. */
  fen: string
  /** The line as a PGN, worked out only when it is asked for. */
  pgn: () => { text: string; omitted: string[] }
  onLoad: (loaded: LoadedPosition) => void
  /** Said back to the person: what happened, in their own words. */
  onSay: (text: string, bad?: boolean) => void
  /** Set when a scratch board is what is on screen now. */
  scratch: { kind: 'fen' | 'pgn'; name: string | null; notes: readonly string[] } | null
  /** Leaving the scratch board and going back to the game. */
  onLeaveScratch: () => void
}

export function PositionPanel({ fen, pgn, onLoad, onSay, scratch, onLeaveScratch }: PositionPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const copy = (text: string, said: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => onSay(said),
      () => onSay('Orbis could not put that on the clipboard.', true)
    )
  }

  const load = (): void => {
    const read = readPasted(draft)
    if (!read.ok) {
      setProblem(read.problem)
      return
    }
    setProblem(null)
    setDraft('')
    onLoad(read.loaded)
  }

  return (
    <section className="cw-an-pos" aria-label="The position">
      {scratch && (
        <div className="cw-an-pos-scratch">
          <p className="cw-an-pos-scratchline" role="status">
            A scratch board{scratch.name ? `: ${scratch.name}` : ''}. It is not in your Library and nothing on it is
            being saved.
          </p>
          {scratch.notes.map((one) => <p className="cw-an-warn" key={one}>{one}</p>)}
          <Button size="tiny" onClick={onLeaveScratch}>Back to your game</Button>
        </div>
      )}

      <div className="cw-an-pos-out">
        <label className="cw-an-pos-label" htmlFor="cw-an-fen-out">This position (FEN)</label>
        <input id="cw-an-fen-out" className="cw-an-pos-fen" readOnly value={fen} spellCheck={false} />
        <div className="cw-an-row">
          <Button size="tiny" onClick={() => copy(fen, 'The position is on the clipboard.')}>Copy the position</Button>
          <Button
            size="tiny"
            onClick={() => {
              const written = pgn()
              copy(written.text, `Copied as PGN. What PGN cannot carry: ${written.omitted.join(' ')}`)
            }}
          >
            Copy the line as PGN
          </Button>
        </div>
      </div>

      <div className="cw-an-pos-in">
        <label className="cw-an-pos-label" htmlFor="cw-an-paste">Paste a position or a game</label>
        <textarea
          id="cw-an-paste"
          className="cw-an-pos-paste"
          rows={4}
          spellCheck={false}
          placeholder="A FEN, or a PGN"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setProblem(null) }}
        />
        <div className="cw-an-row">
          <Button size="small" kind="primary" disabled={!draft.trim()} onClick={load}>Put it on the board</Button>
          {draft && <Button size="small" kind="quiet" onClick={() => { setDraft(''); setProblem(null) }}>Clear</Button>}
        </div>
        {/* What was wrong with it, in the words the reader gave: which of the two it failed to be, and why. */}
        {problem && <p className="cw-an-warn" role="alert">{problem}</p>}
      </div>
    </section>
  )
}

export default PositionPanel
