import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState, Segmented } from '../../../ui'
import { TrainStage } from './TrainStage'
import { Piece } from '../pieces'
import { LineBox } from './LineBox'
import { BlindGame } from './BlindGame'
import { Mic } from './Mic'
import { useSurface } from '../../../lib/surfaces'
import { blindfoldSurface } from '../chessSurfaces'
import { useTrainingStore } from './store'
import {
  appendSolverMove, attemptId, attemptsFor, buildRound, dropLast, ladder, markRound, newDraft, nextFen,
  reconstructionFaults, sayCount, shownLine, solutionLines, summarise, viewRules,
  type BlindLevelId, type BlindMode, type BlindRound, type LineDraft, type Phase, type RoundResult,
  type TrainingSettings
} from '../../../../../shared/chess/trainingView'
import type { Placement } from '../../../../../shared/chess/blindfold'
import { hearSquares } from '../../../../../shared/chess/spoken'
import type { ReadResult } from '../../../../../shared/chess/calculation'
import type { PieceLetter } from '../../../../../shared/chess/rules'
import type { Side } from '../../../../../shared/chess/evaluation'
import type { NoticeKind } from '../../../lib/notices'
import './training.css'

/**
 * Blindfold chess and visualisation (Sections 221-230).
 *
 * Five rungs and a whole game, and the thing all six have in common is the one rule this screen is built around:
 * **hiding the board is a rule, not a style.** `viewRules` decides whether a position may be drawn, this file asks
 * it on every render, and there is no other way for a position to reach the markup. A trainer that drew the board
 * and hid it with CSS would have hidden nothing -- the position would still be in the document, in the
 * accessibility tree, in a tooltip and in a screenshot of the window.
 *
 * ## What is on screen in each phase
 *
 * Looking at the position, then nothing, then the real position again. The round's own question is on screen
 * throughout, and that is not a leak: a line to follow has to be readable or there is nothing to follow, and
 * "name every square this piece can reach" has to name the piece. What is never on screen while the board is away
 * is anything `viewRules` hands back -- and `safeWhileHidden` is what proves it, by refusing any sentence with a
 * square, notation or a castling mark in it.
 *
 * ## The read-out mode is a different exercise and says so
 *
 * Somebody who needs the position read out gets exactly the facts somebody looking at a board gets -- `sayPosition`
 * is the whole board in words, nobody's opinion of it. It is not scored as blindfold work and it does not open the
 * next rung, because calling it blindfold work would be a claim nobody made. The reason is on screen rather than
 * implied.
 *
 * ## Nothing is locked, and nothing is a rating
 *
 * A rung opens when the one before it has been passed with the board away, and a rung that is not open can still be
 * started. The record is counts and sentences: how many goes, what each one established, the highest rung passed
 * with no board. There is no figure for somebody's mental imagery, because nobody can measure that from this.
 */

const MODE_OPTIONS: readonly { value: BlindMode; label: string }[] = [
  { value: 'strict', label: 'No board' },
  { value: 'read-out', label: 'Read the position out' }
]

/** The pieces as characters, for the board somebody builds from memory. No image files, nothing licensed. */

const PIECE_NAME: Readonly<Record<PieceLetter, string>> = Object.freeze({
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn'
})

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

/**
 * The board as somebody remembers it.
 *
 * Deliberately **not** a `Board`. A `Board` draws a position, and the only position there is to draw here is the one
 * being hidden. This draws what the person has put on it and nothing else, which is why its label says so: an empty
 * grid that looks like a board is the one thing on this screen somebody might mistake for the answer.
 */
function RecallEntry({
  placements, onChange
}: { placements: readonly Placement[]; onChange: (next: readonly Placement[]) => void }): React.JSX.Element {
  const [square, setSquare] = useState<string | null>(null)
  const bySquare = useMemo(() => new Map(placements.map((one) => [one.square, one])), [placements])

  const put = useCallback((side: Side, type: PieceLetter): void => {
    if (square === null) return
    onChange([...placements.filter((one) => one.square !== square), { square, side, type }])
    setSquare(null)
  }, [square, placements, onChange])

  const clear = useCallback((): void => {
    if (square === null) return
    onChange(placements.filter((one) => one.square !== square))
    setSquare(null)
  }, [square, placements, onChange])

  return (
    <div className="cw-tr-recall">
      <p className="cw-tr-recall-label">
        The board as you remember it. Nothing on it comes from the real position — it is all yours.
      </p>
      <div className="cw-tr-grid" role="group" aria-label="The board as you remember it">
        {RANKS.map((rank) => FILES.map((file) => {
          const name = `${file}${rank}`
          const there = bySquare.get(name)
          const dark = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 1
          return (
            <button
              key={name}
              type="button"
              className={`cw-tr-sq${dark ? ' cw-tr-sq-dark' : ''}${name === square ? ' cw-tr-sq-on' : ''}`}
              aria-label={there ? `${name}, you put ${there.side === 'w' ? 'White' : 'Black'}'s ${PIECE_NAME[there.type]} here` : `${name}, empty`}
              aria-pressed={name === square}
              onClick={() => setSquare(name === square ? null : name)}
            >
              {there && <Piece color={there.side} type={there.type} className="cw-tr-man" />}
            </button>
          )
        }))}
      </div>
      <div className="cw-tr-palette" role="group" aria-label={square === null ? 'Pick a square first' : `What is on ${square}`}>
        {square === null
          ? <p className="cw-tr-faint">Pick a square, then say what is on it.</p>
          : (
            <>
              <p className="cw-tr-faint">What is on {square}?</p>
              {(['w', 'b'] as const).map((side) => (
                <div key={side} className="cw-tr-palette-row">
                  <span className="cw-tr-palette-side">{side === 'w' ? 'White' : 'Black'}</span>
                  {(['k', 'q', 'r', 'b', 'n', 'p'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="cw-tr-palette-piece"
                      aria-label={`${side === 'w' ? 'White' : 'Black'}'s ${PIECE_NAME[type]} on ${square}`}
                      onClick={() => put(side, type)}
                    >
                      <Piece color={side} type={type} className="cw-tr-man" />
                    </button>
                  ))}
                </div>
              ))}
              <Button size="tiny" kind="quiet" onClick={clear}>Nothing is on {square}</Button>
            </>
          )}
      </div>
      <p className="cw-tr-faint">
        {placements.length === 0
          ? 'Nothing placed yet.'
          : `${placements.length} ${placements.length === 1 ? 'piece' : 'pieces'} placed.`}
        {placements.length > 0 && (
          <>
            {' '}
            <Button size="tiny" kind="quiet" onClick={() => onChange([])}>Clear the board</Button>
          </>
        )}
      </p>
    </div>
  )
}

export interface BlindfoldProps {
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export function Blindfold({ onNotify }: BlindfoldProps = {}): React.JSX.Element {
  const kept = useTrainingStore()

  const [level, setLevel] = useState<BlindLevelId>('locate')
  const [playingGame, setPlayingGame] = useState(false)
  const [phase, setPhase] = useState<Phase>('ready')
  const [round, setRound] = useState<BlindRound | null>(null)
  const [seed, setSeed] = useState(1)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [placements, setPlacements] = useState<readonly Placement[]>([])
  const [draft, setDraft] = useState<LineDraft | null>(null)
  const [result, setResult] = useState<RoundResult | null>(null)
  const [leftToStudy, setLeftToStudy] = useState(0)
  const [changed, setChanged] = useState<string | null>(null)
  const startedAt = useRef(0)

  const settings = kept.store.settings
  const rungs = useMemo(() => ladder(kept.store), [kept.store])
  const here = useMemo(() => rungs.find((one) => one.level.id === level) ?? rungs[0], [rungs, level])
  const told = useMemo(() => summarise(kept.store), [kept.store])

  /** Whether the position may be on screen, asked afresh on every render. */
  const view = useMemo(() => {
    const fen = round
      ? round.kind === 'track' ? round.startFen : round.fen
      : ''
    if (!fen) return null
    return viewRules({
      level,
      phase,
      mode: settings.mode,
      fen,
      ...(round && round.kind === 'track' ? { doneFen: round.finalFen } : {})
    })
  }, [round, level, phase, settings.mode])

  const begin = useCallback((pick?: number): void => {
    const next = pick ?? Math.floor(Math.random() * 1_000_000) + 1
    const built = buildRound(level, { seed: next, questions: settings.questions, mostPieces: settings.mostPieces })
    if (built === null) {
      // A level that cannot be built is said rather than papered over with an empty round that looks like a
      // working one. It happens: "name every square" needs a piece with two squares to go to.
      onNotify?.(
        'A round of this could not be built from the positions you have allowed. Letting positions have more pieces is usually the thing.',
        'error'
      )
      return
    }
    setSeed(next)
    setRound(built)
    setAnswers({})
    setText('')
    setPlacements([])
    setDraft(built.kind === 'solve' ? newDraft(built.fen) : null)
    setResult(null)
    setChanged(null)
    startedAt.current = Date.now()
    setLeftToStudy(Math.max(5, settings.studySeconds))
    setPhase('studying')
  }, [level, settings.questions, settings.mostPieces, settings.studySeconds, onNotify])

  // The look at the position, counted down. One second at a time so the number on screen is the number left.
  useEffect(() => {
    if (phase !== 'studying') return undefined
    if (leftToStudy <= 0) {
      setPhase('answering')
      return undefined
    }
    const id = window.setTimeout(() => setLeftToStudy((left) => left - 1), 1000)
    return () => window.clearTimeout(id)
  }, [phase, leftToStudy])

  /*
   * What Orbis itself may do here.
   *
   * How the position is given is kept in the record rather than on screen, so it is set through the record, which is
   * what the picker itself does. `begin` says for itself when a level cannot be built from the positions somebody
   * has allowed, and Orbis is told that rather than being left with a round that never arrived.
   */
  useSurface(
    blindfoldSurface({
      level: () => level,
      setLevel,
      mode: () => settings.mode,
      setMode: (next) => kept.settings({ mode: next }),
      phase: () => phase,
      begin: () => begin(),
      standing: () => told.says,
      playingGame: () => playingGame,
      setPlayingGame
    })
  )

  const finish = useCallback((): void => {
    if (!round || !view) return
    const marked = markRound(round, {
      answers,
      text,
      placements,
      ...(draft ? { line: draft.texts } : {})
    })
    setResult(marked)
    setPhase('done')
    const now = Date.now()
    kept.record({
      id: attemptId(now),
      at: now,
      area: 'blindfold',
      item: level,
      seed,
      // The one thing the record is about. Read off the view rule, never decided here.
      strict: view.scored,
      verdict: marked.says,
      passed: marked.passed,
      right: marked.right,
      outOf: marked.outOf,
      ...(startedAt.current > 0 ? { ms: Math.max(0, now - startedAt.current) } : {})
    })
    onNotify?.(
      marked.passed ? `Passed: ${marked.rule.toLowerCase()}` : marked.says,
      'info'
    )
  }, [round, view, answers, text, placements, draft, kept, level, seed, onNotify])

  /** One setting at a time, and the screen says which one moved (Section 226). */
  const nudge = useCallback((which: keyof TrainingSettings, by: number): void => {
    if (which === 'questions') {
      const next = Math.max(1, Math.min(12, settings.questions + by))
      kept.settings({ questions: next })
      setChanged(`Questions a round: ${next}. Nothing else changed.`)
      return
    }
    if (which === 'studySeconds') {
      const next = Math.max(5, Math.min(300, settings.studySeconds + by))
      kept.settings({ studySeconds: next })
      setChanged(`Time to look at the position: ${next} seconds. Nothing else changed.`)
      return
    }
    const next = Math.max(4, Math.min(64, settings.mostPieces + by))
    kept.settings({ mostPieces: next })
    setChanged(`Most pieces in a position: ${next}. Nothing else changed.`)
  }, [settings, kept])

  /**
   * What the record suggests practising, from the record and nothing else.
   *
   * Three goes in a row that did not pass is a fact; what it means is a guess, so it is offered as one. Nothing
   * here is a figure for anybody's visual memory.
   */
  const suggestion = useMemo(() => {
    const mine = attemptsFor(kept.store, 'blindfold', level)
    if (mine.length < 3) return null
    const last = mine.slice(-3)
    if (last.every((one) => !one.passed)) {
      return `The last three goes at this one did not pass. Fewer questions, less to remember, or a position with fewer pieces would each make it smaller — and each is one setting above.`
    }
    if (last.every((one) => one.passed && one.strict)) {
      return `The last three goes all passed with the board away. More questions, or a position with more pieces, would make it bigger.`
    }
    return null
  }, [kept.store, level])

  const answersFor = useMemo(() => (round && round.kind === 'solve' ? solutionLines(round.exercise) : []), [round])

  /**
   * The line for the top rung, and the position its next move belongs to.
   *
   * Asked of `trainingView` rather than worked out here, for the same reason the Gym asks: which position a move
   * belongs to is not a thing a screen should have an opinion about. Here it is always both sides -- solving with
   * no board means writing the defence too -- but it is asked all the same, so the two screens cannot drift.
   */
  const solving = round !== null && round.kind === 'solve' ? round.exercise : null
  const shown = useMemo(
    () => (solving && draft ? shownLine(solving, draft, 'both-sides') : null),
    [solving, draft]
  )
  const writeAgainst = useMemo(
    () => (solving && draft ? nextFen(solving, draft, 'both-sides') : ''),
    [solving, draft]
  )

  const addMoves = useCallback((texts: readonly string[]): ReadResult | null => {
    if (!solving || !draft) return null
    let next = draft
    for (const text of texts) {
      const out = appendSolverMove(solving, next, 'both-sides', text)
      if (!out.added) {
        setDraft(next)
        return out.read
      }
      next = out.draft
    }
    setDraft(next)
    return null
  }, [solving, draft])

  if (playingGame) {
    return (
      <div className="cw-tr-blind">
        <aside className="cw-tr-side" aria-label="Blindfold levels">
          <Button size="small" onClick={() => setPlayingGame(false)}>Back to the levels</Button>
          <p className="cw-tr-says">
            A whole game with the board hidden. It sits beside the ladder rather than on it: a game is not scored out
            of a number of questions, and what it establishes is said in words at the end of it.
          </p>
        </aside>
        <section className="cw-tr-main" aria-label="A game with the board hidden">
          <BlindGame onNotify={onNotify} onFinished={(attempt) => kept.record(attempt)} />
        </section>
      </div>
    )
  }

  return (
    <div className="cw-tr-blind">
      <aside className="cw-tr-side" aria-label="Blindfold levels">
        <p className="cw-tr-says">{told.says}</p>
        {told.reached !== null && <p className="cw-tr-faint">Highest passed with the board away: {told.reached.title}.</p>}
        <ul className="cw-tr-items">
          {rungs.map((rung) => (
            <li key={rung.level.id}>
              <button
                type="button"
                className={`cw-tr-item${rung.level.id === level ? ' cw-tr-item-on' : ''}`}
                aria-current={rung.level.id === level ? 'true' : undefined}
                /*
                 * Picking a rung, and starting the one you are already on.
                 *
                 * Clicking the rung that is already chosen used to do nothing whatsoever -- the level was already
                 * that, the round was already cleared and the phase was already ready -- so the first row of the
                 * ladder was a dead control on the screen somebody lands on. Pressing a row you are already on now
                 * starts it, which is what the row reads as.
                 */
                onClick={() => {
                  if (rung.level.id === level && phase === 'ready') {
                    begin()
                    return
                  }
                  setLevel(rung.level.id)
                  setRound(null)
                  setPhase('ready')
                  setResult(null)
                }}
              >
                <strong>{rung.level.order}. {rung.level.title}</strong>
                <small>{rung.says}</small>
                {/* Only on the chosen row, because it is only the chosen row the press starts. */}
                {rung.level.id === level && phase === 'ready' && (
                  <small className="cw-tr-faint">Press again to start a round of this.</small>
                )}
                {rung.attempts > 0 && (
                  <small className="cw-tr-faint">
                    {rung.attempts} {rung.attempts === 1 ? 'go' : 'goes'}
                    {rung.passedStrict ? ', passed with no board' : rung.passedAnyhow ? ', passed with the position read out' : ''}
                  </small>
                )}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="cw-tr-item" onClick={() => setPlayingGame(true)}>
              <strong>A whole game, board hidden</strong>
              <small>Play Orbis's engine with nothing on screen. Untimed, and every look at the board is counted.</small>
            </button>
          </li>
        </ul>
      </aside>

      <section className="cw-tr-main" aria-label="Blindfold training">
        {kept.readProblem !== null && (
          <p className="cw-tr-warn" role="status">{kept.readProblem} Nothing from this visit is being saved.</p>
        )}
        {kept.saveProblem !== null && <p className="cw-tr-warn" role="status">{kept.saveProblem}</p>}

        <header className="cw-tr-head">
          <h3 className="cw-tr-title">{here.level.title}</h3>
          <p className="cw-tr-meta">
            <span className="cw-tr-faint">{here.level.asks}</span>
          </p>
          <p className="cw-tr-meta">
            <span className="cw-tr-badge">Passes when: {here.level.passes.toLowerCase()}</span>
            {/* Said only once a round is open and the view rule has actually said it is not scored. Before that
                there is nothing to be scored or not scored, and saying so would be a claim about nothing. */}
            {view !== null && !view.scored && <span className="cw-tr-badge">Not scored as blindfold work</span>}
          </p>
        </header>

        {phase === 'ready' && (
          <div className="cw-tr-setup">
            <p className="cw-tr-note">{here.says}</p>
            <Segmented
              label="How the position is kept from you"
              className="cw-tr-seg"
              optionClass="cw-tr-tab"
              litClass="on"
              value={settings.mode}
              options={MODE_OPTIONS}
              onChange={(next) => {
                kept.settings({ mode: next })
                setChanged(next === 'strict'
                  ? 'The board goes off screen and is not described. Scored.'
                  : 'The board goes off screen and the position is written out instead. A different exercise, so it is not scored as blindfold work and it does not open the next level.')
              }}
            />
            <div className="cw-tr-dials">
              <div className="cw-tr-dial">
                <span className="cw-tr-dial-name">Time to look</span>
                <span className="cw-tr-dial-value">{settings.studySeconds}s</span>
                <Button size="tiny" onClick={() => nudge('studySeconds', -5)} aria-label="Less time to look">Less</Button>
                <Button size="tiny" onClick={() => nudge('studySeconds', 5)} aria-label="More time to look">More</Button>
              </div>
              <div className="cw-tr-dial">
                <span className="cw-tr-dial-name">Questions</span>
                <span className="cw-tr-dial-value">{settings.questions}</span>
                <Button size="tiny" onClick={() => nudge('questions', -1)} aria-label="Fewer questions">Fewer</Button>
                <Button size="tiny" onClick={() => nudge('questions', 1)} aria-label="More questions">More</Button>
              </div>
              <div className="cw-tr-dial">
                <span className="cw-tr-dial-name">Most pieces</span>
                <span className="cw-tr-dial-value">{settings.mostPieces}</span>
                <Button size="tiny" onClick={() => nudge('mostPieces', -2)} aria-label="Fewer pieces in the position">Fewer</Button>
                <Button size="tiny" onClick={() => nudge('mostPieces', 2)} aria-label="More pieces in the position">More</Button>
              </div>
            </div>
            {changed !== null && <p className="cw-tr-note" role="status">{changed}</p>}
            {suggestion !== null && <p className="cw-tr-note" role="status">{suggestion}</p>}
            <div className="cw-tr-go">
              <Button kind="primary" onClick={() => begin()}>Start a round</Button>
              <Button kind="quiet" onClick={() => begin(seed)} disabled={seed === 1}>The same round again</Button>
            </div>
            <p className="cw-tr-faint">
              Every round is built from a number, so the same round can be had again — which is the only way a
              complaint about one can be looked into.
            </p>
          </div>
        )}

        {round !== null && view !== null && phase !== 'ready' && (
          <>
            {phase === 'studying' && (
              <p className="cw-tr-count" role="status">
                Look at it. {leftToStudy} {leftToStudy === 1 ? 'second' : 'seconds'} left.
                {' '}
                <Button size="small" kind="quiet" onClick={() => setLeftToStudy(0)}>I have it</Button>
              </p>
            )}

            {/*
              * The position, as big as the room allows, or the place it is not -- at exactly the same size, so the
              * screen does not jump when it comes back at the end of a round. The board used to be capped at 420
              * pixels here beside a panel; `TrainStage` hands it to the shared layout instead, which measures the
              * room the board really has.
              */}
            <TrainStage
              label="The position"
              className="cw-tr-stage"
              board={view.boardFen !== null
                ? { fen: view.boardFen, interactive: false, label: view.label }
                : null}
              away={{ label: view.label, because: view.because }}
              below={
                <>
                  {/* The position in words, for anybody who needs it read. Exactly the facts a board gives. */}
                  {view.readOut !== '' && <p className="cw-tr-readout" role="status">{view.readOut}</p>}
                  {round.kind === 'reconstruct' && phase !== 'done' && (
                    <p className="cw-tr-faint">{round.pieces} pieces on it. That is all you are told.</p>
                  )}
                </>
              }
              right={<div className="cw-tr-aside">
                {/*
                  * The round's own question, which is not a leak: a line nobody can read is a line nobody can
                  * follow. It waits until the board has gone, though -- a line beside the position it starts from
                  * can be played out by eye, which is a different exercise. Whether the board has gone is the view
                  * rule's answer, asked here rather than guessed from the phase.
                  */}
                {round.kind === 'track' && view.boardFen === null && (
                  <div className="cw-tr-moves">
                    <p className="cw-tr-moves-label">Follow this line in your head. It is {round.says}.</p>
                    <p className="cw-tr-moves-list">{round.san.join(' ')}</p>
                  </div>
                )}
                {round.kind === 'track' && view.boardFen !== null && phase === 'studying' && (
                  <p className="cw-tr-faint">
                    Look at the position. The line to follow appears when the board goes.
                  </p>
                )}
                {round.kind === 'moves-from' && <p className="cw-tr-ask">{round.ask}</p>}
                {round.kind === 'solve' && <p className="cw-tr-ask">{round.prompt}</p>}

                {phase === 'answering' && (
                  <>
                    {(round.kind === 'locate' || round.kind === 'track') && (
                      <ol className="cw-tr-questions">
                        {round.questions.map((question) => (
                          <li key={question.id} className="cw-tr-question">
                            <label className="cw-tr-enter-field">
                              <span className="cw-tr-enter-name">{question.ask}</span>
                              <input
                                className="cw-tr-enter-box"
                                value={answers[question.id] ?? ''}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) => setAnswers((now) => ({ ...now, [question.id]: event.target.value }))}
                              />
                            </label>
                            <Mic
                              inputId={`cw-blind-${level}-${question.id}`}
                              label={`Speak the answer to: ${question.ask}`}
                              hear={hearSquares}
                              onHeard={(heard) => setAnswers((now) => ({ ...now, [question.id]: heard }))}
                            />
                          </li>
                        ))}
                      </ol>
                    )}

                    {round.kind === 'moves-from' && (
                      <>
                        <label className="cw-tr-enter-field">
                          <span className="cw-tr-enter-name">Every square it can go to</span>
                          <input
                            className="cw-tr-enter-box"
                            value={text}
                            placeholder="d4 e5 f6"
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) => setText(event.target.value)}
                          />
                        </label>
                        <Mic
                          inputId={`cw-blind-${level}-squares`}
                          label="Speak the squares"
                          hear={hearSquares}
                          onHeard={(heard) => setText((now) => (now.trim() ? `${now.trim()} ${heard}` : heard))}
                        />
                        <p className="cw-tr-faint">
                          Both halves are marked and reported apart: a square you missed is something not seen, and a
                          square that is not there is something imagined.
                        </p>
                      </>
                    )}

                    {round.kind === 'reconstruct' && (
                      <RecallEntry placements={placements} onChange={setPlacements} />
                    )}

                    {round.kind === 'solve' && draft !== null && shown !== null && (
                      <LineBox
                        entry={shown}
                        nextFen={writeAgainst}
                        written={draft.texts.length}
                        onAdd={addMoves}
                        onUndo={() => setDraft(dropLast(draft))}
                        onRestart={() => setDraft(newDraft(round.fen))}
                        micId={`cw-blind-solve-${round.id}`}
                        label="Write the line out, both sides, with no board."
                      />
                    )}

                    <div className="cw-tr-controls">
                      <Button kind="primary" onClick={finish}>Mark it</Button>
                      <Button size="small" kind="quiet" onClick={() => { setRound(null); setPhase('ready') }}>
                        Give up on this round
                      </Button>
                    </div>
                  </>
                )}

                {phase === 'done' && result !== null && (
                  <div className="cw-tr-report">
                    <h4 className="cw-tr-report-head">{result.passed ? 'Passed.' : 'Not this time.'}</h4>
                    <p className="cw-tr-yours">{result.says}</p>
                    <p className="cw-tr-faint">Passes when: {result.rule.toLowerCase()}</p>
                    {!view.scored && (
                      <p className="cw-tr-faint">
                        The position was written out for this round, which is a different exercise. It is kept, and it
                        does not open the next level.
                      </p>
                    )}

                    {result.questions.length > 0 && (
                      <ul className="cw-tr-marks" aria-label="Each answer">
                        {result.questions.map((one) => (
                          <li key={one.id} className={one.right ? 'cw-tr-right' : 'cw-tr-wrong'}>
                            <span className="cw-tr-mark-ask">{one.ask}</span>
                            <span className="cw-tr-mark-says">{one.says}</span>
                            {!one.right && <span className="cw-tr-faint">You said: {one.given || 'nothing'}</span>}
                          </li>
                        ))}
                      </ul>
                    )}

                    {result.recall !== null && (
                      <div className="cw-tr-recallscore">
                        <p className="cw-tr-worth">{result.recall.says}</p>
                        <p className="cw-tr-faint">{result.recall.rule}</p>
                        {reconstructionFaults(result.recall).length === 0
                          ? <p className="cw-tr-right">Every square right.</p>
                          : (
                            <ul className="cw-tr-marks" aria-label="Where it differed">
                              {reconstructionFaults(result.recall).map((one) => (
                                <li key={one.square} className="cw-tr-wrong">
                                  <span className="cw-tr-mark-says">{one.says}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                      </div>
                    )}

                    {result.comparison !== null && (
                      <>
                        <p className="cw-tr-yours">{result.comparison.says}</p>
                        {round.kind === 'solve' && (
                          <div className="cw-tr-answers">
                            <p className="cw-tr-answers-label">
                              {answersFor.length === 1 ? 'The answer:' : `All ${sayCount(answersFor.length)} answering lines:`}
                            </p>
                            <ul>{answersFor.map((one) => <li key={one.text}>{one.text}</li>)}</ul>
                          </div>
                        )}
                      </>
                    )}

                    {round.kind === 'track' && (
                      <div className="cw-tr-moves">
                        <p className="cw-tr-moves-label">The line, and the position it reached, are both above now.</p>
                        <p className="cw-tr-moves-list">{round.san.join(' ')}</p>
                      </div>
                    )}

                    <div className="cw-tr-controls">
                      <Button size="small" kind="primary" onClick={() => begin()}>Another round</Button>
                      <Button size="small" onClick={() => begin(seed)}>This round again</Button>
                      <Button size="small" kind="quiet" onClick={() => { setRound(null); setPhase('ready') }}>
                        Change the settings
                      </Button>
                    </div>
                    <p className="cw-tr-faint">
                      Going again keeps this go. The first one is the only one that says whether you could do it
                      unaided, so it is never written over.
                    </p>
                  </div>
                )}
              </div>}
            />
          </>
        )}

        {round === null && phase !== 'ready' && (
          <EmptyState>No round is open. Start one above.</EmptyState>
        )}
      </section>
    </div>
  )
}

export default Blindfold
