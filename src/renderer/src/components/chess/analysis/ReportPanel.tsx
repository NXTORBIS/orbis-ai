import { Button } from '../../../ui'
import { CLASS_LABEL, formatScore } from '../../../../../shared/chess/evaluation'
import { describeRun, runOutdated, type StudyRun } from '../../../../../shared/chess/study'
import type { AnalysisReport } from '../../../../../shared/chess/analysis'

/**
 * What a whole game came to, as far as it was searched.
 *
 * Every figure on this panel carries what it rests on. A critical moment says why it was chosen and how deeply the
 * position was searched; the coverage line says how many positions were never looked at; the average loss says how
 * many moves it was averaged over. A report that said "accuracy 86%" would be a number nobody could check against
 * anything, so there is not one (Sections 116, 117).
 */

export interface SweepState {
  running: boolean
  done: number
  total: number
  /** What the sweep is doing or has done, in plain words. */
  note: string | null
}

export interface ReportPanelProps {
  report: AnalysisReport
  onJump: (ply: number) => void
  sweep: SweepState
  onSweep: () => void
  onCancel: () => void
  /** False when there is no engine, or no way to hear from it. */
  canSweep: boolean
  whyNot: string | null
  /**
   * The passes of the engine kept with this analysis, oldest first (Section 158).
   *
   * The report itself is worked out from the evaluations every time, so it is always an account of what has been
   * searched. What it cannot say on its own is *which pass* produced those numbers and whether that pass finished,
   * and without it an old report reads exactly like a new one.
   */
  runs?: readonly StudyRun[]
  /** The engine on this computer now, so a run produced by a different one can be labelled as the earlier one. */
  engineNow?: string | null
}

export function ReportPanel({ report, onJump, sweep, onSweep, onCancel, canSweep, whyNot, runs = [], engineNow = null }: ReportPanelProps): React.JSX.Element {
  const { coverage, counts, centipawnLoss } = report
  const named = (Object.keys(counts) as (keyof typeof counts)[]).filter((k) => k !== 'unclear' && counts[k] > 0)

  return (
    <section className="cw-an-report" aria-label="The report">
      <div className="cw-an-row">
        {/* Stopping comes first: a sweep in progress keeps the engine busy, which is itself a reason `canSweep` is
            false, and hiding the button behind that would leave no way to stop what is running. */}
        {sweep.running
          ? <Button size="small" kind="danger" onClick={onCancel}>Stop analysing the game</Button>
          : canSweep
            ? <Button size="small" kind="primary" onClick={onSweep}>Analyse the whole game</Button>
            : <p className="cw-an-warn">{whyNot ?? 'The engine is not available, so a whole-game pass cannot be run.'}</p>}
      </div>

      {sweep.running && (
        <p className="cw-an-progress" role="status">
          {sweep.done} of {sweep.total} positions searched. {sweep.note ?? ''}
        </p>
      )}
      {!sweep.running && sweep.note && <p className="cw-an-faint" role="status">{sweep.note}</p>}

      <p className="cw-an-summary">{report.summary}</p>

      {/*
        * Where these numbers came from.
        *
        * A report reopened a week later is built from the same recorded answers, so it is still true -- but it is
        * not the result of a search run just now, and a screen that does not say so lets it pass for one. The last
        * pass is named with what it was asked to do, and anything that has changed since is said under it
        * (Section 158).
        */}
      {runs.length > 0 && (
        <>
          <h4 className="cw-an-h">Where these numbers came from</h4>
          <p className="cw-an-faint">{describeRun(runs[runs.length - 1])}</p>
          {(() => {
            const stale = runOutdated(runs[runs.length - 1], { engine: engineNow, evaluations: report.coverage.analysed })
            return stale ? <p className="cw-an-warn">{stale}</p> : null
          })()}
          {runs.length > 1 && (
            <ul className="cw-an-ignored" aria-label="Earlier passes over this game">
              {runs.slice(0, -1).reverse().map((run) => <li key={run.id}>{describeRun(run)}</li>)}
            </ul>
          )}
        </>
      )}

      <dl className="cw-an-figures">
        <div>
          <dt>Positions analysed</dt>
          <dd>{coverage.analysed} of {coverage.total}</dd>
        </div>
        <div>
          <dt>Searched too shallowly to judge</dt>
          <dd>{coverage.shallow.length === 0 ? 'none' : `${coverage.shallow.length} (under depth ${coverage.minDepth})`}</dd>
        </div>
        <div>
          <dt>Average given up, White</dt>
          <dd>{centipawnLoss.white ? `${(centipawnLoss.white.average / 100).toFixed(2)} of a pawn over ${centipawnLoss.white.from} moves` : 'not measured'}</dd>
        </div>
        <div>
          <dt>Average given up, Black</dt>
          <dd>{centipawnLoss.black ? `${(centipawnLoss.black.average / 100).toFixed(2)} of a pawn over ${centipawnLoss.black.from} moves` : 'not measured'}</dd>
        </div>
      </dl>

      {named.length > 0 && (
        <ul className="cw-an-counts" aria-label="Moves by kind">
          {named.map((kind) => <li key={kind}><span>{CLASS_LABEL[kind]}</span><strong>{counts[kind]}</strong></li>)}
        </ul>
      )}
      {counts.unclear > 0 && (
        <p className="cw-an-faint">
          {counts.unclear} move{counts.unclear === 1 ? '' : 's'} are not named, because what was searched does not
          support naming them.
        </p>
      )}

      <h4 className="cw-an-h">Critical moments</h4>
      {report.critical.length === 0
        ? <p className="cw-an-faint">None found in what has been analysed so far.</p>
        : (
          <ul className="cw-an-critical">
            {report.critical.map((moment) => (
              <li key={moment.ply}>
                <button type="button" className="cw-an-jump" onClick={() => onJump(moment.ply)}>
                  {moment.number}{moment.mover === 'w' ? '.' : '…'}{moment.san}
                </button>
                <span className="cw-an-why">{moment.explain}</span>
                <span className="cw-an-depth">{moment.depth === null ? 'depth not recorded' : `depth ${moment.depth}`}</span>
              </li>
            ))}
          </ul>
        )}
      {report.moreCritical > 0 && (
        <p className="cw-an-faint">{report.moreCritical} more were found and are not listed here.</p>
      )}

      {report.missedMates.length > 0 && (
        <>
          <h4 className="cw-an-h">Forced mates that were missed</h4>
          <ul className="cw-an-critical">
            {report.missedMates.map((missed) => (
              <li key={missed.ply}>
                <button type="button" className="cw-an-jump" onClick={() => onJump(missed.ply)}>
                  {missed.number}{missed.mover === 'w' ? '.' : '…'}{missed.san}
                </button>
                <span className="cw-an-why">
                  Mate in {missed.mateIn} was there{missed.mateMove?.san ? `, starting with ${missed.mateMove.san}` : ''}.
                </span>
                <span className="cw-an-depth">{missed.depth === null ? 'depth not recorded' : `depth ${missed.depth}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {report.ignored.length > 0 && (
        <>
          <h4 className="cw-an-h">Numbers that were not used</h4>
          <ul className="cw-an-ignored">
            {report.ignored.slice(0, 8).map((one, index) => (
              <li key={`${one.ply}-${index}`}>Position {one.ply}: {one.reason}</li>
            ))}
          </ul>
        </>
      )}

      {coverage.notAnalysed.length > 0 && (
        <p className="cw-an-faint">
          Not analysed at all: {summarisePlies(coverage.notAnalysed)}.
        </p>
      )}

      {report.graph.some((p) => p.score !== null) && (
        <p className="cw-an-faint">
          Last figure recorded: {formatScore(report.graph.filter((p) => p.score !== null).slice(-1)[0]?.score ?? { kind: 'none' })} for White.
        </p>
      )}
    </section>
  )
}

/** "1-4, 9, 20-31" rather than a list of forty numbers. */
function summarisePlies(plies: number[]): string {
  const runs: string[] = []
  let start: number | null = null
  let last: number | null = null
  for (const ply of plies) {
    if (start === null || last === null) { start = ply; last = ply; continue }
    if (ply === last + 1) { last = ply; continue }
    runs.push(start === last ? String(start) : `${start}–${last}`)
    start = ply
    last = ply
  }
  if (start !== null && last !== null) runs.push(start === last ? String(start) : `${start}–${last}`)
  return runs.slice(0, 10).join(', ') + (runs.length > 10 ? ' and more' : '')
}
