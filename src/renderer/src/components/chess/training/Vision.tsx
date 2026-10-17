import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, Field, Segmented } from '../../../ui'
import { Piece } from '../pieces'
import { useTrainingStore } from './store'
import { useBoardRoom } from './boardRoom'
import {
  DEFAULT_VISION_SETUP, LONGEST_ROUND, SHORTEST_ROUND, VISION_DIRECTIONS, VISION_PASS,
  answer, askNow, directionNote, msLeft, newRound, piecesOnBoard, readSquareName, readVisionItem, roundOver,
  squareColour, stop, visionBest, visionItem, visionRows, visionScore, visionVerdict, visionView,
  type VisionDirection, type VisionMark, type VisionRound, type VisionSetup
} from '../../../../../shared/chess/vision'
import { attemptId, attemptsFor, blindPositions } from '../../../../../shared/chess/trainingView'
import { boardSquares } from '../../../../../shared/chess/rules'
import type { Side } from '../../../../../shared/chess/evaluation'
import type { NoticeKind } from '../../../lib/notices'
import './vision.css'

/**
 * Vision: a square is named and you click it, or a square is marked and you name it, against a clock.
 *
 * It is the drill that stops people counting ranks with a finger. Everything that decides anything is in
 * `src/shared/chess/vision.ts`; this screen lays it out and takes the clicks.
 *
 * ## The board is not this screen's decision
 *
 * `visionView` is asked on every render and a piece is drawn only when it hands back a position. There is no other
 * route from a position to the markup here, and `visionView` does not decide it either -- it asks `viewRules` in
 * `trainingView.ts`, which is the one function in Chess World that decides whether a position may be on screen. So
 * a round with the pieces turned off has no piece in the document at all: not hidden with CSS, which would leave it
 * in the accessibility tree, in a tooltip and in a screenshot of the window.
 *
 * ## What a square is called to a screen reader
 *
 * Deliberately not "e4". In "find the square" the square's name *is* the answer, and a button whose accessible name
 * is the answer has handed the drill over to anybody using a screen reader, a tooltip or the inspector. So a square
 * is named by where it is in the drawing -- "row 3, column 5" -- which is exactly what a sighted person can see,
 * and nothing more. Turn the file and rank labels on and the names appear, on the board and in the accessibility
 * tree together, and the round stops being counted. That is the same bargain the blindfold ladder's read-out mode
 * makes.
 *
 * ## The clock is monotonic
 *
 * `performance.now()` for the round, so a round is thirty seconds of real time rather than thirty seconds of
 * whatever the system clock did. `Date.now()` only for the moment a record is filed under.
 */

export interface VisionProps {
  onNotify?: (text: string, kind?: NoticeKind) => void
}

const monotonic = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const SIDE_OPTIONS: readonly { value: Side; label: string }[] = [
  { value: 'w', label: 'From White' },
  { value: 'b', label: 'From Black' }
]

const LENGTHS: readonly number[] = [15, 30, 60, 120]

export function Vision({ onNotify }: VisionProps = {}): React.JSX.Element {
  const kept = useTrainingStore()
  // How big the grid may be, measured off the box it sits in. The same measurement every board in Chess World uses.
  const room = useBoardRoom()
  const [setup, setSetup] = useState<VisionSetup>(DEFAULT_VISION_SETUP)
  const [round, setRound] = useState<VisionRound | null>(null)
  const [now, setNow] = useState(() => monotonic())
  const [mark, setMark] = useState<VisionMark | null>(null)
  const [typed, setTyped] = useState('')
  const filed = useRef<string>('')
  const opened = useRef(false)
  /*
   * The round as it is now.
   *
   * An answer has to be read against the round it was given in, and it has a side effect -- the mark on screen --
   * so it cannot be worked out inside a state updater: React may call an updater twice, and a function it calls
   * twice must do nothing but return a value.
   */
  const roundRef = useRef<VisionRound | null>(null)

  const hold = useCallback((next: VisionRound | null) => {
    roundRef.current = next
    setRound(next)
  }, [])

  // Where you left off. The direction and the side are in the record already, so there is nothing new to store.
  useEffect(() => {
    if (opened.current || kept.loading) return
    opened.current = true
    const mine = kept.store.attempts.filter((one) => one.area === 'vision')
    const last = mine[mine.length - 1]
    const read = last ? readVisionItem(last.item) : null
    if (read) setSetup((was) => ({ ...was, direction: read.direction, from: read.from }))
  }, [kept.loading, kept.store.attempts])

  const past = useMemo(() => attemptsFor(kept.store, 'vision', visionItem(setup)), [kept.store, setup])
  const best = useMemo(() => visionBest(past), [past])
  const note = directionNote(setup.direction)

  const running = round !== null && !roundOver(round, now)
  const score = useMemo(() => (round ? visionScore(round, now) : null), [round, now])
  const rules = useMemo(() => visionView({ setup, fen: round?.fen ?? null }), [setup, round])
  const ask = round && running ? askNow(round) : null

  // The clock on screen. It tells the round what time it is; the round works the rest out.
  useEffect(() => {
    if (!running) return undefined
    const id = window.setInterval(() => setNow(monotonic()), 100)
    return () => window.clearInterval(id)
  }, [running])

  /*
   * The record, once, when the round is over.
   *
   * Guarded by the round's own start time rather than by a boolean: a second round started in the same visit has a
   * different start, so it files its own record, and a redraw of a finished round files nothing.
   */
  useEffect(() => {
    if (!round || !score) return
    if (!roundOver(round, now)) return
    const key = `${round.startedAt}`
    if (filed.current === key) return
    filed.current = key
    if (score.asked === 0) return
    const at = Date.now()
    kept.record({
      id: attemptId(at),
      at,
      area: 'vision',
      item: visionItem(round.setup),
      seed: round.seed,
      // Read off the view rule. This screen has no opinion about whether the round counted.
      strict: score.scored,
      verdict: visionVerdict(round, score),
      passed: score.passed,
      right: score.right,
      outOf: score.asked,
      ms: score.ms
    })
    onNotify?.(
      score.passed ? `Passed: ${VISION_PASS.says.toLowerCase()}` : `${score.right} right, ${score.wrong} missed.`,
      'info'
    )
  }, [round, score, now, kept, onNotify])

  const begin = useCallback(() => {
    const seed = Math.floor(Math.random() * 1_000_000)
    const chosen = setup.pieces ? positionFor(seed) : null
    const started = monotonic()
    setMark(null)
    setTyped('')
    setNow(started)
    hold(newRound(setup, { seed, now: started, ...(chosen ? { fen: chosen } : {}) }))
  }, [setup, hold])

  const give = useCallback((given: string) => {
    const was = roundRef.current
    if (!was) return
    const got = answer(was, given, monotonic())
    if (got.mark) setMark(got.mark)
    hold(got.round)
    setTyped('')
    setNow(monotonic())
  }, [hold])

  const onTyped = useCallback((text: string) => {
    const read = readSquareName(text)
    if (read) give(read)
    else setTyped(text.slice(0, 4))
  }, [give])

  const change = useCallback((over: Partial<VisionSetup>) => {
    setSetup((was) => ({ ...was, ...over }))
    // A setting changed mid-round would mean a round scored under rules it was not played under.
    hold(null)
    setMark(null)
  }, [hold])

  const rows = useMemo(() => visionRows(setup.from), [setup.from])
  const pieces = useMemo(
    () => new Map(rules.boardFen === null ? [] : boardSquares(rules.boardFen).map((one) => [one.square, one])),
    [rules.boardFen]
  )

  const clickable = running && setup.direction === 'find-the-square'
  const seconds = Math.ceil((round ? msLeft(round, now) : setup.seconds * 1000) / 1000)

  return (
    <div className="cw-vi">
      <aside className="cw-vi-side" aria-label="How the round is set up">
        <p className="cw-vi-asks">{note.asks}</p>

        <Field
          label="Which way round"
          hint="A square is named and you find it, or a square is marked and you name it."
          className="cw-vi-field"
          labelClassName="cw-vi-field-name"
          hintClassName="cw-vi-field-note"
          as="fieldset"
        >
          {() => (
            <Segmented<VisionDirection>
              value={setup.direction}
              options={VISION_DIRECTIONS.map((one) => ({ value: one.id, label: one.title }))}
              onChange={(direction) => change({ direction })}
              label="Which way round"
              className="cw-vi-seg"
              optionClass="cw-vi-tab"
            />
          )}
        </Field>

        <Field
          label="Whose side of the board"
          hint="Seen from Black, h1 is at the top left. That is the half people get wrong."
          className="cw-vi-field"
          labelClassName="cw-vi-field-name"
          hintClassName="cw-vi-field-note"
          as="fieldset"
        >
          {() => (
            <Segmented<Side>
              value={setup.from}
              options={SIDE_OPTIONS}
              onChange={(from) => change({ from })}
              label="Whose side of the board"
              className="cw-vi-seg"
              optionClass="cw-vi-tab"
            />
          )}
        </Field>

        <Field
          label="How long a round lasts"
          className="cw-vi-field"
          labelClassName="cw-vi-field-name"
          hintClassName="cw-vi-field-note"
          hint={`Between ${SHORTEST_ROUND} seconds and ${LONGEST_ROUND}.`}
          as="fieldset"
        >
          {() => (
            <Segmented<string>
              value={String(setup.seconds)}
              options={LENGTHS.map((one) => ({ value: String(one), label: `${one}s` }))}
              onChange={(value) => change({ seconds: Number(value) })}
              label="How long a round lasts"
              className="cw-vi-seg"
              optionClass="cw-vi-tab"
            />
          )}
        </Field>

        <div className="cw-vi-toggles">
          <Chip on={setup.coordinates} onClick={() => change({ coordinates: !setup.coordinates })}>
            File and rank labels
          </Chip>
          <Chip on={setup.pieces} onClick={() => change({ pieces: !setup.pieces })}>
            Pieces on the board
          </Chip>
        </div>
        {setup.coordinates && (
          <p className="cw-vi-warn" role="status">
            With the labels on, the answer is on the screen. Rounds like this are kept but are not counted.
          </p>
        )}

        <p className="cw-vi-pass">To pass: {VISION_PASS.says}</p>
        <p className="cw-vi-best">{best.says}</p>
        {past.length > 0 && (
          <details className="cw-vi-past">
            <summary>{past.length === 1 ? 'The one round so far' : `The last ${Math.min(past.length, 8)} rounds`}</summary>
            <ul>
              {[...past].slice(-8).reverse().map((one) => (
                <li key={one.id}>{one.verdict}</li>
              ))}
            </ul>
          </details>
        )}
        {kept.readProblem !== null && <p className="cw-vi-warn" role="status">{kept.readProblem}</p>}
        {kept.saveProblem !== null && <p className="cw-vi-warn" role="status">{kept.saveProblem}</p>}
      </aside>

      <section className="cw-vi-main" aria-label="Finding squares">
        <div className="cw-vi-head">
          {ask ? (
            <p className="cw-vi-ask">
              {setup.direction === 'find-the-square' ? (
                <>
                  <span className="cw-vi-ask-label">Click</span>
                  <strong className="cw-vi-ask-square">{ask.square}</strong>
                </>
              ) : (
                <span className="cw-vi-ask-label">Name the marked square</span>
              )}
            </p>
          ) : (
            <p className="cw-vi-ask">
              <span className="cw-vi-ask-label">{round ? 'That round is over.' : note.title}</span>
            </p>
          )}
          <div className="cw-vi-dials">
            <span className="cw-vi-dial">
              {/* "Left" on its own, beside a count, reads as a direction. */}
              <span className="cw-vi-dial-name">Time left</span>
              <span className="cw-vi-dial-value">{running ? `${seconds}s` : '—'}</span>
            </span>
            <span className="cw-vi-dial">
              <span className="cw-vi-dial-name">Found</span>
              <span className="cw-vi-dial-value">{score ? score.right : 0}</span>
            </span>
            <span className="cw-vi-dial">
              <span className="cw-vi-dial-name">Missed</span>
              <span className="cw-vi-dial-value">{score ? score.wrong : 0}</span>
            </span>
          </div>
        </div>

        {/*
          * The board, measured off the room it has rather than capped at 460 pixels.
          *
          * It is this screen's own grid and not the shared `Board`, on purpose: the shared board names every square
          * in its accessible name, and in this drill the name of the square is the answer. So the squares here are
          * named by where they are in the drawing -- "row 3, column 5" -- which is exactly what somebody looking at
          * it can see. What the shared board does give is the size, and `useBoardRoom` takes that same measurement
          * so this grid is as large as any other board in Chess World.
          */}
        <div className="cw-vi-boardwrap" ref={room.ref}>
          <div
            className={`cw-vi-board${clickable ? ' is-live' : ''}`}
            role="grid"
            aria-label={rules.label}
            style={{ width: `${room.side}px`, height: `${room.side}px` }}
          >
            {rows.map((row, rowAt) => (
              <div className="cw-vi-rank" role="row" key={row[0]}>
                {row.map((square, colAt) => {
                  const piece = pieces.get(square)
                  const marked = setup.direction === 'name-the-square' && ask?.square === square
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      key={square}
                      className={`cw-vi-sq ${squareColour(square)}${marked ? ' is-asked' : ''}`}
                      aria-label={rules.coordinates ? square : `row ${rowAt + 1}, column ${colAt + 1}`}
                      disabled={!clickable}
                      onClick={clickable ? () => give(square) : undefined}
                    >
                      {rules.coordinates && <span className="cw-vi-name">{square}</span>}
                      {piece && <Piece color={piece.color} type={piece.type} className="cw-vi-piece" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="cw-vi-boardnotes">
          {room.tight && (
            <p className="cw-vi-why" role="status">
              The window is too small for the board to fit. Make it wider, or close a panel.
            </p>
          )}
          {rules.because !== null && <p className="cw-vi-why">{rules.because}</p>}
          {round?.piecesNote != null && <p className="cw-vi-why">{round.piecesNote}</p>}
          {/*
            * The position written out, for anybody who needs it read. It used to be a paragraph sitting under the
            * board all the time, which was the clearest case of the owner's complaint on this screen: the board is
            * right there, and the sentence was saying the same thing again. It is now asked for.
            */}
          {rules.boardFen !== null && (
            <details className="cw-vi-readout">
              <summary>The position in words</summary>
              <p className="cw-vi-why">{piecesOnBoard(rules.boardFen)}</p>
            </details>
          )}
        </div>

        {running && setup.direction === 'name-the-square' && (
          <div className="cw-vi-type">
            <label htmlFor="cw-vi-input">Its name</label>
            <input
              id="cw-vi-input"
              className="cw-vi-input"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              onChange={(event) => onTyped(event.target.value)}
              placeholder="e4"
            />
            <span className="cw-vi-type-note">Type the file then the rank. It goes in as soon as it reads as a square.</span>
          </div>
        )}

        {mark !== null && (
          <p className={`cw-vi-mark${mark.right ? ' is-right' : ' is-wrong'}`} role="status">
            {mark.says}
          </p>
        )}

        <div className="cw-vi-controls">
          <Button kind="primary" size="small" onClick={begin}>
            {round ? 'Go again' : 'Start a round'}
          </Button>
          {running && (
            <Button
              size="small"
              onClick={() => {
                const was = roundRef.current
                if (was) hold(stop(was, monotonic()))
                setNow(monotonic())
              }}
            >
              Stop
            </Button>
          )}
        </div>

        {round && !running && score && (
          <div className="cw-vi-report" role="status">
            <h4 className="cw-vi-report-head">
              {score.asked === 0
                ? 'Nothing was answered.'
                : score.passed
                  ? 'Passed.'
                  : `${score.right} right, ${score.wrong} missed.`}
            </h4>
            <dl className="cw-vi-figures">
              <div>
                <dt>Squares a minute</dt>
                <dd>{score.perMinute === null ? 'not enough to say' : score.perMinute}</dd>
              </div>
              <div>
                <dt>Average on a right one</dt>
                <dd>{score.msPerRight === null ? 'none were right' : `${(score.msPerRight / 1000).toFixed(1)}s`}</dd>
              </div>
              <div>
                <dt>Longest run</dt>
                <dd>{score.bestRun}</dd>
              </div>
            </dl>
            <ul className="cw-vi-says">
              {score.says.map((one) => (
                <li key={one}>{one}</li>
              ))}
            </ul>
            {round.answers.some((one) => !one.right) && (
              <details className="cw-vi-missed">
                <summary>The ones that were missed</summary>
                <ul>
                  {round.answers.filter((one) => !one.right).map((one) => (
                    <li key={one.at}>
                      {one.square} — you said {one.given === '' ? 'nothing' : one.given}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * A position to put behind the squares.
 *
 * The blindfold ladder's own positions, which are either the gym's composed ones or lines replayed through the
 * rules -- so nothing here is a FEN somebody typed from memory. `newRound` checks whatever this hands back anyway
 * and leaves it out if it cannot be played from.
 */
function positionFor(seed: number): string | null {
  const all = blindPositions()
  if (all.length === 0) return null
  return all[Math.abs(seed) % all.length].fen
}
