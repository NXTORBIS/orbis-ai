import { useCallback, useMemo, useState } from 'react'
import { Button, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { ChessStage } from '../ChessStage'
import { MoveList, MoveNav } from '../MoveList'
import { ReviewGraph } from './ReviewGraph'
import { moveNumber, sideToMove } from '../../../../../shared/chess/rules'
import { fenAt, type StoredGame } from '../../../../../shared/chess/model'
import { CLASS_LABEL, formatScore, type Score, type Side } from '../../../../../shared/chess/evaluation'
import { describeSave } from '../../../../../shared/chess/study'
import { writeLine } from '../../../../../shared/chess/analysis'
import type { GameReview as Review, ReviewMove } from '../../../../../shared/chess/review'
import {
  MISSED_WIN_RULE, classBars, coverWords, coverageBar, missedWins, momentChips, passProgress, reviewNotes,
  ringDash, summaryPoints, theoryEnd
} from '../../../../../shared/chess/reviewScreen'
import { REVIEW_DEPTHS, useGameReview } from './useGameReview'
import './review.css'

/**
 * The game report: what happened in a finished game, from what was really searched.
 *
 * The board is the biggest thing on the screen, because the subject is a game of chess. It is drawn by the shared
 * layout -- this screen hands `ChessStage` the board's props and never a size -- so the board grows with the window
 * instead of settling at whatever width the text beside it happened to ask for, which is what the old version of
 * this screen did.
 *
 * Around it: the two accuracy dials and how each side's moves were named, as bars; the opening and the moments that
 * decided the game, as chips you can click to go straight to the position; the evaluation across the whole game
 * under the board; and the move list down the right with a mark beside every move the engine judged.
 *
 * Everything on it is an account of what an engine said about this game, so everything on it is also an account of
 * what nobody asked. Five things here exist only to say so:
 *
 *   - an accuracy dial says how many of that side's moves it covers, and never scales itself up to the rest;
 *   - a move the search could not judge carries no mark at all, rather than a name the numbers will not carry;
 *   - Brilliant and Great are not shown as absent when they were never asked about;
 *   - the graph leaves a blank where nothing was searched, and the caption names the stretch;
 *   - the pass shows how far it has got and never guesses how long the rest will take.
 *
 * No engine is started on opening. A game that was already analysed reviews from the numbers that were kept.
 */

type Panel = 'summary' | 'moments' | 'move' | 'how'

const PANELS: { value: Panel; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'moments', label: 'Moments' },
  { value: 'move', label: 'This move' },
  { value: 'how', label: 'How' }
]

/** The radius and stroke of an accuracy dial, in the SVG's own units. */
const RING = { size: 72, radius: 30, stroke: 7 }
const CIRCUMFERENCE = 2 * Math.PI * RING.radius

export interface GameReviewProps {
  game: StoredGame
  /** The move to open on, when the screen was opened about a particular one. */
  atPly?: number
  onNotify?: (text: string, kind?: NoticeKind) => void
  /** Opens the game in Analysis Studio at this move, when the window offers that. */
  onOpenStudio?: (ply: number) => void
}

export function GameReview({ game, atPly, onNotify, onOpenStudio }: GameReviewProps): React.JSX.Element {
  const state = useGameReview({ game, ...(atPly === undefined ? {} : { atPly }) })
  const [panel, setPanel] = useState<Panel>('summary')
  const [orientation, setOrientation] = useState<Side>('w')
  const { review, run, engine, keeping } = state

  const fen = fenAt(game, state.ply)
  const played = state.ply > 0 ? game.moves[state.ply - 1] : null
  const here = useMemo(() => review.moves.find((row) => row.ply === state.ply) ?? null, [review.moves, state.ply])
  /*
   * The engine's best line from the position the move was played in, written out in SAN. Taken from the lines the
   * pass really kept for that position, keyed the same way the review keys them (the position before the move). Null
   * when nothing was searched there, so the panel says so instead of showing a line from nowhere.
   */
  const bestLine = useMemo((): string | null => {
    if (!here) return null
    const set = state.alternatives.find((one) => one.ply === here.ply - 1) ?? null
    const top = set ? (set.lines.find((one) => one.multipv === 1) ?? set.lines[0]) : undefined
    if (!top || top.pvUci.length === 0) return null
    const written = writeLine(here.fenBefore, top.pvUci, 12)
    return written.legal && written.text ? written.text : null
  }, [here, state.alternatives])
  // The move number at a position, asked of the rules: a game set up from a position does not start at move one.
  const numberAt = useCallback((ply: number) => moveNumber(fenAt(game, Math.max(0, ply - 1))), [game])

  const notes = useMemo(() => reviewNotes(review.moves), [review.moves])
  const sans = useMemo(() => game.moves.map((one) => one.san), [game])
  const chips = useMemo(() => momentChips(review.key), [review.key])
  const theory = useMemo(() => theoryEnd(review.book), [review.book])
  const progress = passProgress(run)

  /*
   * The score beside the board is the one the engine gave for the position on the board, and nothing else. A
   * position nobody searched hands the board a score of 'none', which draws stripes and a dash rather than a bar at
   * the middle -- the difference between "level" and "nobody has looked".
   */
  const scoreHere: Score = useMemo(() => {
    const point = review.report.graph.find((one) => one.ply === state.ply)
    return point && point.score ? point.score : { kind: 'none' }
  }, [review.report.graph, state.ply])

  const say = (text: string, kind?: NoticeKind): void => { onNotify?.(text, kind) }

  const startRun = (): void => {
    state.start()
    say(`Searching every position of this game to depth ${state.depth}.`)
  }

  const flip = useCallback(() => setOrientation((one) => (one === 'w' ? 'b' : 'w')), [])

  return (
    <div className="cw-rv-root">
      <header className="cw-rv-bar">
        <div className="cw-rv-bar-run">
          {run.running
            ? <Button size="small" kind="danger" onClick={state.cancel}>Stop the pass</Button>
            : <Button size="small" kind="primary" disabled={!state.canRun} onClick={startRun}>Review this game</Button>}
          <Segmented
            label="How deeply to search each position"
            className="cw-rv-depths"
            optionClass="cw-rv-depth"
            litClass="on"
            value={String(state.depth)}
            options={REVIEW_DEPTHS.map((one) => ({ value: String(one), label: `Depth ${one}` }))}
            onChange={(value) => state.setDepth(Number(value))}
          />
        </div>
        {/* How far the pass has got: a bar and a line of words, and never a guess at the time left. */}
        <div className="cw-rv-bar-progress">
          {progress.share !== null && (
            <span className="cw-rv-meter" role="img" aria-label={progress.words}>
              <span style={{ width: `${progress.percent ?? 0}%` }} />
            </span>
          )}
          <span className="cw-rv-bar-words" role="status">{progress.words}</span>
        </div>
        <span className="cw-rv-keep" title={describeSave(keeping.state)}>{describeSave(keeping.state)}</span>
      </header>

      {state.whyNot && <p className="cw-rv-warn">{state.whyNot}</p>}
      {/* Shown whether the pass was stopped or finished: a finished pass that says nothing about itself is a mystery. */}
      {run.note && !run.running && <p className={run.stopped ? 'cw-rv-warn' : 'cw-rv-faint'}>{run.note}</p>}

      <ChessStage
        className="cw-rv-stage"
        label="The game being reviewed"
        board={{
          fen,
          orientation,
          interactive: false,
          lastMove: played ? { from: played.uci.slice(0, 2), to: played.uci.slice(2, 4) } : null,
          evalBar: { score: scoreHere, text: formatScore(scoreHere) },
          label: 'The game being reviewed'
        }}
        above={(
          <div className="cw-rv-strip">
            <span className="cw-rv-chip is-opening" title={review.book.says}>{theory.chip}</span>
            {chips.map((chip) => (
              <button
                key={chip.ply}
                type="button"
                className={`cw-rv-chip is-moment${chip.ply === state.ply ? ' is-here' : ''}`}
                title={chip.title}
                onClick={() => state.jumpTo(chip.ply)}
              >
                {chip.label}
              </button>
            ))}
            {chips.length === 0 && <span className="cw-rv-chip is-quiet">No moment moved the graph far enough yet</span>}
          </div>
        )}
        below={(
          <div className="cw-rv-below">
            <MoveNav ply={state.ply} total={game.moves.length} onJump={state.jumpTo} onFlip={flip}>
              {onOpenStudio && (
                <Button size="tiny" onClick={() => onOpenStudio(state.ply)}>Open in the Studio</Button>
              )}
            </MoveNav>
            <ReviewGraph
              points={review.report.graph}
              moments={review.key.moments}
              cursorPly={state.ply}
              onPick={state.jumpTo}
              numberAt={numberAt}
            />
          </div>
        )}
        left={<SideCard review={review} onJump={state.jumpTo} />}
        right={(
          <div className="cw-rv-right">
            <MoveList
              moves={sans}
              ply={state.ply}
              onJump={state.jumpTo}
              notes={notes}
              firstSide={sideToMove(game.startFen)}
              firstNumber={moveNumber(game.startFen)}
              empty="This game has no moves."
              className="cw-rv-list"
            />
            <Segmented
              label="What to show"
              className="cw-rv-tabs"
              optionClass="cw-rv-tab"
              litClass="on"
              value={panel}
              options={PANELS}
              onChange={setPanel}
            />
            <div className="cw-rv-pane">
              {panel === 'summary' && <SummaryPane review={review} onJump={state.jumpTo} engineName={engine.status?.name ?? null} />}
              {panel === 'moments' && <MomentsPane review={review} onJump={state.jumpTo} at={state.ply} />}
              {panel === 'move' && <MovePane row={here} bestLine={bestLine} />}
              {panel === 'how' && <HowPane review={review} />}
            </div>
          </div>
        )}
      />
    </div>
  )
}

export default GameReview

// ---------------------------------------------------------------- the dials and the bars

/** The two accuracies as dials, and what each side's moves were called, as bars. No table, no paragraph. */
function SideCard({ review, onJump }: { review: Review; onJump: (ply: number) => void }): React.JSX.Element {
  const letGo = missedWins(review.moves)
  const coverage = coverageBar(review.report.coverage)
  const whiteBars = classBars(review.counts.w)
  const blackBars = classBars(review.counts.b)
  return (
    <div className="cw-rv-side">
      <div className="cw-rv-dials">
        {(['w', 'b'] as const).map((side) => <Dial key={side} review={review} side={side} />)}
      </div>

      <div className="cw-rv-bars" aria-label="What the moves were called">
        {whiteBars.map((bar, index) => {
          const black = blackBars[index]
          return (
            <div className={`cw-rv-barrow${bar.unjudged ? ' is-unjudged' : ''}`} key={bar.klass}>
              <span className="cw-rv-barlabel">{CLASS_LABEL[bar.klass]}</span>
              <span className="cw-rv-bartrack" aria-hidden="true">
                <span className={`cw-rv-barfill is-${bar.klass} is-white`} style={{ width: `${Math.round(bar.share * 100)}%` }} />
                <span className={`cw-rv-barfill is-${bar.klass} is-black`} style={{ width: `${Math.round((black?.share ?? 0) * 100)}%` }} />
              </span>
              <span className="cw-rv-barcount">
                {bar.count}<span className="cw-rv-barsep">/</span>{black?.count ?? 0}
              </span>
            </div>
          )
        })}
      </div>
      <p className="cw-rv-legend">Each row: White above, Black below. The longest bar is the commonest name.</p>

      {review.counts.w.brilliant + review.counts.b.brilliant + review.counts.w.great + review.counts.b.great > 0 && (
        <ul className="cw-rv-awards">
          {review.counts.w.brilliant > 0 && <li><b>!!</b> White, {review.counts.w.brilliant} brilliant</li>}
          {review.counts.b.brilliant > 0 && <li><b>!!</b> Black, {review.counts.b.brilliant} brilliant</li>}
          {review.counts.w.great > 0 && <li><b>!</b> White, {review.counts.w.great} great</li>}
          {review.counts.b.great > 0 && <li><b>!</b> Black, {review.counts.b.great} great</li>}
        </ul>
      )}
      {review.awards.asked === 0 && <p className="cw-rv-warn is-small">{review.awards.says}</p>}

      {letGo.length > 0 && (
        <div className="cw-rv-letgo">
          <h3 className="cw-rv-h">A win let go</h3>
          <ul className="cw-rv-letgo-list">
            {letGo.slice(0, 4).map((one) => (
              <li key={one.ply}>
                <button type="button" className="cw-rv-jump" title={one.says} onClick={() => onJump(one.ply)}>
                  {one.number}{one.mover === 'w' ? '.' : '…'}{one.san}
                  <span className="cw-rv-jump-sub">{formatScore(one.before, one.mover)} &rarr; {formatScore(one.after, one.mover)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="cw-rv-coverage">
        <span className="cw-rv-meter" role="img" aria-label={coverage.words}>
          <span style={{ width: `${Math.round(coverage.share * 100)}%` }} />
        </span>
        <span className="cw-rv-bar-words">{coverage.words}</span>
      </div>
    </div>
  )
}

function Dial({ review, side }: { review: Review; side: Side }): React.JSX.Element {
  const accuracy = review.accuracy[side]
  const dash = ringDash(accuracy.value, CIRCUMFERENCE)
  const name = side === 'w' ? 'White' : 'Black'
  const middle = RING.size / 2
  return (
    <section className={`cw-rv-dial${dash === null ? ' is-unknown' : ''}`} aria-label={`${name}'s accuracy`}>
      <svg viewBox={`0 0 ${RING.size} ${RING.size}`} role="img" aria-label={accuracy.says}>
        <circle className="cw-rv-dial-track" cx={middle} cy={middle} r={RING.radius} strokeWidth={RING.stroke} fill="none" />
        {/* No figure means no ring at all. A ring at nought would read as "every move was bad". */}
        {dash && (
          <circle
            className={`cw-rv-dial-fill is-${side}`}
            cx={middle}
            cy={middle}
            r={RING.radius}
            strokeWidth={RING.stroke}
            fill="none"
            strokeDasharray={`${dash.drawn} ${dash.blank}`}
            transform={`rotate(-90 ${middle} ${middle})`}
          />
        )}
        <text className="cw-rv-dial-text" x={middle} y={middle + 4} textAnchor="middle">
          {dash === null ? '—' : `${dash.percent}%`}
        </text>
      </svg>
      <span className="cw-rv-dial-who">{name}</span>
      <span className="cw-rv-dial-sub" title={accuracy.says}>{coverWords(accuracy)}</span>
    </section>
  )
}

// ---------------------------------------------------------------- the panes

function SummaryPane(
  { review, onJump, engineName }: { review: Review; onJump: (ply: number) => void; engineName: string | null }
): React.JSX.Element {
  const points = summaryPoints(review)
  return (
    <div className="cw-rv-stack">
      <ul className="cw-rv-points">
        {points.map((point, index) => (
          <li key={`${index}-${point.text.slice(0, 12)}`} className={`is-${point.tone}`}>
            {point.ply === null
              ? <span>{point.text}</span>
              : <button type="button" className="cw-rv-jump is-line" onClick={() => onJump(point.ply as number)}>{point.text}</button>}
          </li>
        ))}
      </ul>
      {review.nextSteps.length > 0 && (
        <>
          <h3 className="cw-rv-h">What to work on</h3>
          <ul className="cw-rv-steps">
            {review.nextSteps.map((step) => (
              <li key={step.ply}>
                <button type="button" className="cw-rv-jump is-line" onClick={() => onJump(step.ply)}>{step.what}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="cw-rv-faint">
        {review.report.summary}
        {engineName ? ` Searched by ${engineName}.` : ' The engine did not say what it was called.'}
      </p>
    </div>
  )
}

function MomentsPane(
  { review, onJump, at }: { review: Review; onJump: (ply: number) => void; at: number }
): React.JSX.Element {
  if (review.key.moments.length === 0) {
    return <p className="cw-rv-faint">{review.key.rule}</p>
  }
  return (
    <ol className="cw-rv-moments">
      {review.key.moments.map((moment) => (
        <li key={moment.ply} className={moment.ply === at ? 'is-here' : undefined}>
          <button type="button" className="cw-rv-moment" onClick={() => onJump(moment.ply)}>
            <span className="cw-rv-moment-at">{moment.number}{moment.mover === 'w' ? '.' : '…'}{moment.san}</span>
            <span className="cw-rv-moment-swing">{formatScore(moment.before)} &rarr; {formatScore(moment.after)}</span>
            {moment.better?.san && <span className="cw-rv-moment-better">Engine: {moment.better.san}</span>}
            {moment.line && <span className="cw-rv-moment-line">{moment.line}</span>}
          </button>
        </li>
      ))}
      {review.key.more > 0 && (
        <li className="cw-rv-moments-more">
          {review.key.more} more move{review.key.more === 1 ? '' : 's'} moved the graph as far and are not listed.
        </li>
      )}
    </ol>
  )
}

/** What is known about the move on the board: what it was called, what it cost, what the engine preferred. */
function MovePane({ row, bestLine }: { row: ReviewMove | null; bestLine: string | null }): React.JSX.Element {
  if (!row) return <p className="cw-rv-faint">The position the game started from. Step forward to look at a move.</p>
  return (
    <>
    {bestLine && row.better?.san && (
      <p className="cw-rv-bestline"><b>{row.better.san}</b> {bestLine}</p>
    )}
    <dl className="cw-rv-facts">
      <div><dt>Move</dt><dd>{row.number}{row.mover === 'w' ? '.' : '…'}{row.san}</dd></div>
      <div><dt>Called</dt><dd>{row.label}</dd></div>
      <div>
        <dt>Score</dt>
        <dd>
          {row.before === null ? '—' : formatScore(row.before)} &rarr; {row.after === null ? '—' : formatScore(row.after)}
        </dd>
      </div>
      <div><dt>Gave up</dt><dd>{row.loss === null ? 'not a centipawn figure' : `${(row.loss / 100).toFixed(2)} pawns`}</dd></div>
      <div><dt>Depth</dt><dd>{row.depth === null ? 'no depth recorded' : String(row.depth)}</dd></div>
      {row.better?.san && <div><dt>Engine</dt><dd>{row.better.san}</dd></div>}
      {row.book && <div><dt>Theory</dt><dd>{row.book.eco} {row.book.name}</dd></div>}
      <div className="cw-rv-facts-wide"><dt>Why</dt><dd>{row.why}</dd></div>
      <div className="cw-rv-facts-wide"><dt>Award</dt><dd>{row.awardWhy}</dd></div>
    </dl>
    </>
  )
}

function HowPane({ review }: { review: Review }): React.JSX.Element {
  return (
    <div className="cw-rv-stack">
      <h3 className="cw-rv-h">The accuracy figure</h3>
      <p className="cw-rv-formula">{review.accuracy.w.formula}</p>
      <ul className="cw-rv-rules">
        {review.accuracy.w.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
      <h3 className="cw-rv-h">A win let go</h3>
      <p className="cw-rv-faint">{MISSED_WIN_RULE}</p>
      <h3 className="cw-rv-h">The rest of it</h3>
      <ul className="cw-rv-rules">
        {review.rules.map((rule) => <li key={rule}>{rule}</li>)}
      </ul>
    </div>
  )
}
