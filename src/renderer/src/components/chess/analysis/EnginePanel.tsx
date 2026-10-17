import { Button, Field, Segmented } from '../../../ui'
import { useSurface } from '../../../lib/surfaces'
import { enginePanelSurface } from '../chessSurfaces'
import { formatScore } from '../../../../../shared/chess/evaluation'
import { bestLine, type EngineWatch } from '../../../../../shared/chess/analysis'
import { depthWords, lineMoves } from '../../../../../shared/chess/analysisBoard'
import { positionKey } from '../../../../../shared/chess/rules'
import type { EngineAnalysis } from './useEngineAnalysis'

/**
 * Asking the engine about the position on the board.
 *
 * Three things on this panel are refusals rather than features, and all three matter more than the numbers:
 *
 *   - With no engine on the computer it says so and offers to fetch one. Nothing else on the screen stops working.
 *   - With no way to receive the engine's answers it says that too, in those words, and does not offer to search.
 *   - When the answers in hand were calculated in a different position from the one on the board, they are not
 *     shown as this position's numbers. They are labelled as belonging to a position we have left.
 */

export type LimitKind = 'time' | 'depth'

export interface EngineSettings {
  limit: LimitKind
  /** Milliseconds. */
  movetime: number
  depth: number
  lines: number
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = { limit: 'time', movetime: 3000, depth: 20, lines: 3 }

const TIMES = [500, 1000, 3000, 10_000, 30_000]
const DEPTHS = [12, 16, 20, 24, 30]

export interface EnginePanelProps {
  engine: EngineAnalysis
  /** The position on the board right now. */
  fen: string
  settings: EngineSettings
  onSettings: (next: EngineSettings) => void
  onInstall: () => void
  busy: boolean
  /**
   * Walking into one of the engine's lines: the moves up to and including the one that was pressed. Without it the
   * moves are still shown, as text, which is what every engine panel in Chess World used to be.
   */
  onFollow?: (uci: readonly string[], upTo: number) => void
}

export function EnginePanel({ engine, fen, settings, onSettings, onInstall, busy, onFollow }: EnginePanelProps): React.JSX.Element {
  const { watch } = engine
  const mine = watch.fen !== null && positionKey(watch.fen) === positionKey(fen)
  const top = bestLine(watch)

  /**
   * One search of the position on the board.
   *
   * `limits` is what was asked for beyond the pickers, and it is put on the pickers before the search runs: a panel
   * saying "depth 20" while a search at depth 30 is running would be the screen disagreeing with itself. Everything
   * -- the button, and Orbis -- goes through this one function, so there is one way a search is asked for.
   */
  const askWith = (limits: { depth?: number; movetime?: number; lines?: number }): Promise<EngineWatch> => {
    const next: EngineSettings = {
      ...settings,
      ...(limits.lines === undefined ? {} : { lines: limits.lines }),
      ...(limits.depth === undefined ? {} : { limit: 'depth' as const, depth: limits.depth }),
      ...(limits.movetime === undefined ? {} : { limit: 'time' as const, movetime: limits.movetime })
    }
    if (next.limit !== settings.limit || next.depth !== settings.depth || next.movetime !== settings.movetime || next.lines !== settings.lines) onSettings(next)
    return engine.runOne({
      fen,
      multipv: next.lines,
      ...(next.limit === 'time' ? { movetime: next.movetime } : { depth: next.depth })
    })
  }

  const ask = (): void => {
    void askWith({})
  }

  /*
   * What Orbis itself may do on this panel.
   *
   * Registered here rather than on the Study screen because the panel really is only on screen while it is the one
   * showing, and a control that is offered and no longer there is the fault this product has suffered most. The
   * Study screen names it as something it can open, with the control that opens it.
   *
   * `analyse` waits for the engine's own answer and hands it back, which is what makes it the one action here that
   * can be confirmed rather than merely carried out: the answer is the engine's, not the screen's.
   */
  useSurface(
    enginePanelSurface({
      limit: () => settings.limit,
      thinkMs: () => settings.movetime,
      depth: () => settings.depth,
      lines: () => settings.lines,
      set: (change) => onSettings({ ...settings, ...change }),
      ask: async (limits) => {
        const got = await askWith(limits)
        const best = bestLine(got)
        return {
          complete: got.complete,
          depthReached: best?.depth ?? null,
          score: best && best.score.kind !== 'none' ? formatScore(best.score) : null,
          best: got.bestmoveSan ?? got.bestmove ?? null,
          lines: got.lines.length,
          // A bound is a limit rather than a verdict, and whatever the search itself said about what it could not do.
          note: [best?.bound ? 'That score is a bound, not a settled one.' : null, got.note].filter(Boolean).join(' ') || null
        }
      },
      stop: engine.stop,
      running: () => engine.running,
      whyNot: () =>
        !engine.ready
          ? 'There is no chess engine on this computer yet. Everything else on the Study screen works without one.'
          : !engine.bridged
            ? 'The engine is installed, but this window cannot receive its answers, so a search would produce no numbers.'
            : null,
      status: () =>
        engine.status
          ? engine.status.state === 'ready'
            ? `${engine.status.name ?? 'The engine'}${engine.status.version ? ` ${engine.status.version}` : ''} is ready.`
            : engine.status.detail
          : 'The chess engine has not been set up on this computer yet.',
      // Only the answer for the position actually on the board. Numbers from a position the board has left are
      // never shown as this one's.
      answer: () => (mine && top && top.score.kind !== 'none' ? { score: formatScore(top.score), depth: top.depth, best: watch.bestmoveSan ?? watch.bestmove ?? null } : null)
    })
  )

  return (
    <section className="cw-an-engine" aria-label="The engine">
      <p className="cw-an-status" role="status">
        {engine.status
          ? engine.status.state === 'ready'
            ? `${engine.status.name ?? 'The engine'}${engine.status.version ? ` ${engine.status.version}` : ''} is ready.`
            : engine.status.detail
          : 'The chess engine has not been set up on this computer yet.'}
      </p>

      {!engine.ready && (
        <>
          <p className="cw-an-faint">
            Orbis analyses through Stockfish, a separate free program under its own licence, so it is not part of the
            Orbis download. It is fetched once, onto this computer, when you ask for it. Everything else on this
            screen — the board, the lines you try, your notes — works without it.
          </p>
          <div className="cw-an-row">
            <Button size="small" disabled={busy} onClick={onInstall}>Set up the chess engine</Button>
            <Button size="small" kind="quiet" onClick={engine.reload}>Check again</Button>
          </div>
        </>
      )}

      {engine.ready && !engine.bridged && (
        <p className="cw-an-warn" role="status">
          The engine is installed, but this window cannot receive its answers: nothing here is listening on
          <code> chess:analysis</code>. A search would produce no numbers, so it is not offered. Everything else on
          this screen still works.
        </p>
      )}

      {engine.ready && engine.bridged && (
        <>
          <Segmented
            label="Search by"
            className="cw-an-seg"
            optionClass="cw-an-tab"
            litClass="on"
            value={settings.limit}
            options={[{ value: 'time', label: 'Time' }, { value: 'depth', label: 'Depth' }]}
            onChange={(limit) => onSettings({ ...settings, limit })}
          />
          <p className="cw-an-faint">
            {settings.limit === 'time' ? 'A fixed amount of thinking time.' : 'A fixed depth, however long it takes.'}
          </p>

          {settings.limit === 'time' ? (
            <Field label="Thinking time" className="cw-an-field">
              {(wiring) => (
                <select
                  id={wiring.id}
                  className="cw-an-select"
                  value={settings.movetime}
                  onChange={(e) => onSettings({ ...settings, movetime: Number(e.target.value) })}
                >
                  {TIMES.map((ms) => <option key={ms} value={ms}>{ms < 1000 ? `${ms} milliseconds` : `${ms / 1000} seconds`}</option>)}
                </select>
              )}
            </Field>
          ) : (
            <Field label="Depth" className="cw-an-field">
              {(wiring) => (
                <select
                  id={wiring.id}
                  className="cw-an-select"
                  value={settings.depth}
                  onChange={(e) => onSettings({ ...settings, depth: Number(e.target.value) })}
                >
                  {DEPTHS.map((d) => <option key={d} value={d}>{d} deep</option>)}
                </select>
              )}
            </Field>
          )}

          <Field label="Lines" className="cw-an-field" hint="How many different continuations to show.">
            {(wiring) => (
              <select
                id={wiring.id}
                className="cw-an-select"
                aria-describedby={wiring['aria-describedby']}
                value={settings.lines}
                onChange={(e) => onSettings({ ...settings, lines: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? 'one line' : `${n} lines`}</option>)}
              </select>
            )}
          </Field>

          <div className="cw-an-row">
            <Button size="small" kind="primary" disabled={busy || engine.running} onClick={ask}>
              Ask about this position
            </Button>
            <Button size="small" disabled={!engine.running} onClick={engine.stop}>Stop</Button>
          </div>
        </>
      )}

      {engine.problem && (
        <p className="cw-an-warn" role="alert">
          {engine.problem} <button type="button" className="cw-an-link" onClick={engine.clearProblem}>Clear</button>
        </p>
      )}

      {watch.requestId !== null && (
        <div className="cw-an-lines" aria-label="What the engine says">
          {!mine && (
            <p className="cw-an-faint">
              These numbers were calculated in a position the board has left, so they are not shown as this
              position&rsquo;s. Ask again to see this one.
            </p>
          )}
          {mine && !watch.lines.length && <p className="cw-an-faint">{engine.running ? 'Thinking…' : 'The engine gave no line for this position.'}</p>}
          {/*
            * Each line is a row of moves you can press, not a sentence to read.
            *
            * Pressing the third move of a line plays the first three into the analysis as a variation, which is
            * what makes the engine's answer somewhere to go rather than something to copy out by hand. The moves
            * come from `lineMoves`, which asks the rules for every one of them and stops at the first that will not
            * play -- so a line that was cut says so instead of offering moves that do not exist.
            */}
          {mine && watch.lines.map((line) => {
            const walked = lineMoves(watch.fen ?? fen, line.pvUci)
            return (
              <div key={line.multipv} className="cw-an-line">
                <strong className={`cw-an-line-score${line.bound ? ' is-provisional' : ''}`}>{formatScore(line.score)}</strong>
                <span className="cw-an-line-depth">{depthWords(line.depth)}</span>
                <span className="cw-an-line-moves">
                  {walked.moves.length === 0 && '—'}
                  {walked.moves.map((move) => (
                    <button
                      key={move.step}
                      type="button"
                      className="cw-an-line-move"
                      disabled={!onFollow}
                      title={onFollow ? `Play the line up to ${move.san}` : 'The moves of this line'}
                      onClick={() => onFollow?.(line.pvUci, move.step)}
                    >
                      {move.san}
                    </button>
                  ))}
                </span>
                {line.bound && <span className="cw-an-line-note">a bound, not a settled score</span>}
                {!walked.whole && walked.moves.length > 0 && (
                  <span className="cw-an-line-note">
                    {walked.moves.length} of the {walked.given} moves the engine gave are shown; the rest could not be
                    played out from here.
                  </span>
                )}
              </div>
            )
          })}
          {mine && top && watch.complete && (
            <p className="cw-an-faint">
              {watch.bestmoveSan
                ? `Best move: ${watch.bestmoveSan}.`
                : watch.bestmove
                  ? `Best move: ${watch.bestmove}.`
                  : 'The engine named no best move here.'}
              {watch.note ? ` ${watch.note}` : ''}
            </p>
          )}
          {watch.ignored > 0 && (
            <p className="cw-an-faint">
              {watch.ignored} answer{watch.ignored === 1 ? '' : 's'} were about another request or another position and
              were not used.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
