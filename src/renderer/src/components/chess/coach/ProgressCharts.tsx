import { EmptyState, Segmented } from '../../../ui'
import { ACTIVITIES, type ActivityKind } from '../../../../../shared/chess/coach'
import { WINDOW_LABEL, type ProgressReport, type Rate, type Window } from '../../../../../shared/chess/progress'
import { Chart } from './Chart'

/**
 * The measures, with the three kinds of number kept visibly apart.
 *
 * Counts, success rates and completion rates sit in three labelled blocks, and each rate is drawn with both of its
 * numbers beside it rather than as a bare percentage. Accuracy gets its definition printed under it, because the
 * word means something different in every program that uses it and a number with a contested name needs its own
 * one written down.
 */

const WINDOWS: { value: Window; label: string }[] = [
  { value: 'week', label: '7 days' },
  { value: 'fortnight', label: '14 days' },
  { value: 'month', label: '30 days' },
  { value: 'quarter', label: '90 days' },
  { value: 'year', label: '365 days' },
  { value: 'all', label: 'All' }
]

function RateRow({ label, rate }: { label: string; rate: Rate }): React.JSX.Element {
  return (
    <li className={`cw-co-rate-row${rate.firm ? '' : ' cw-co-thin'}`}>
      <span className="cw-co-rate-name">{label}</span>
      <span className="cw-co-rate-value">{rate.value === null ? '—' : `${Math.round(rate.value * 100)}%`}</span>
      <span className="cw-co-rate-of">{rate.hits} of {rate.of}</span>
      <span className="cw-co-dim">{rate.says}</span>
    </li>
  )
}

export function ProgressCharts({
  report,
  window,
  onWindow
}: {
  report: ProgressReport
  window: Window
  onWindow: (window: Window) => void
}): React.JSX.Element {
  const counts = report.counts
  const did = (Object.entries(counts.byActivity) as [ActivityKind, number][]).filter(([, n]) => n > 0)

  return (
    <div className="cw-co-pane">
      <div className="cw-co-range">
        <Segmented
          value={window}
          options={WINDOWS}
          onChange={onWindow}
          label="How far back to measure"
          className="cw-co-tabs"
          optionClass="cw-co-tab"
        />
        <p className="cw-co-lead" role="status">{report.range.label}</p>
      </div>

      <p className="cw-co-dim">{report.says}</p>

      <h4 className="cw-co-title">What you did — counts</h4>
      {counts.attempts === 0
        ? <EmptyState>Nothing recorded in {WINDOW_LABEL[window]}.</EmptyState>
        : (
          <>
            <ul className="cw-co-figures">
              <li><strong>{counts.attempts}</strong><span>sittings</span></li>
              <li><strong>{counts.daysActive}</strong><span>days with something on them</span></li>
              <li><strong>{counts.things}</strong><span>different things worked on</span></li>
              <li><strong>{counts.minutes}</strong><span>minutes, from the {counts.timed} sittings that recorded a time</span></li>
            </ul>
            <ul className="cw-co-breakdown">
              {did.map(([activity, n]) => (
                <li key={activity}><span className="cw-co-count">{n}</span><span>{ACTIVITIES[activity].label}</span></li>
              ))}
            </ul>
            {counts.reopened > 0 && (
              <p className="cw-co-dim">
                {counts.reopened} {counts.reopened === 1 ? 'time' : 'times'} something already finished was opened
                again. That is counted here and nowhere else: it is not activity and it cannot hold a streak up.
              </p>
            )}
          </>
        )}

      <h4 className="cw-co-title">How much came out right — success rates</h4>
      <ul className="cw-co-rates">
        <RateRow label="Came out right" rate={report.success.overall} />
        <RateRow label="Right with no help at all" rate={report.success.clean} />
        {report.success.byActivity.map((one) => <RateRow key={one.activity} label={one.label} rate={one.rate} />)}
      </ul>
      <p className="cw-co-dim">{report.success.says}</p>

      <h4 className="cw-co-title">How much you finished — completion rates</h4>
      <ul className="cw-co-rates">
        <RateRow label="Things started and finished" rate={report.completion.overall} />
        {report.completion.byKind.map((one) => <RateRow key={one.kind} label={one.kind === 'plan-item' ? 'Plan lines' : `${one.kind[0].toUpperCase()}${one.kind.slice(1)}s`} rate={one.rate} />)}
      </ul>
      <p className="cw-co-dim">{report.completion.rule}</p>

      <h4 className="cw-co-title">Accuracy of your moves</h4>
      <p className="cw-co-accuracy">
        <strong>{report.accuracy.value === null ? '—' : `${Math.round(report.accuracy.value * 100)}%`}</strong>
        <span className="cw-co-dim">{report.accuracy.says}</span>
      </p>
      <p className="cw-co-formula">{report.accuracy.formula}</p>
      <ul className="cw-co-caveats">
        {report.accuracy.notes.map((note, index) => <li key={`note-${index}`}>{note}</li>)}
      </ul>
      {(report.accuracy.skipped.tooShallow > 0 || report.accuracy.skipped.noSide > 0) && (
        <p className="cw-co-dim">
          Left out: {report.accuracy.skipped.tooShallow} analysed too shallow to count,
          {' '}{report.accuracy.skipped.noSide} that do not record which side you played.
        </p>
      )}

      {report.series.length > 0 && (
        <>
          <h4 className="cw-co-title">Over time</h4>
          <div className="cw-co-charts">
            {report.series.map((one) => <Chart key={one.key} series={one} />)}
          </div>
        </>
      )}

      <h4 className="cw-co-title">What these numbers are</h4>
      <ul className="cw-co-caveats">
        {report.whatTheseAre.map((line, index) => <li key={`is-${index}`}>{line}</li>)}
      </ul>

      <h4 className="cw-co-title">What they cannot establish</h4>
      <ul className="cw-co-caveats">
        {report.cannotEstablish.map((line, index) => <li key={`cannot-${index}`}>{line}</li>)}
      </ul>

      <details className="cw-co-numbers">
        <summary>How days and weeks are counted</summary>
        <ul className="cw-co-caveats">
          {report.calendarRules.map((line, index) => <li key={`cal-${index}`}>{line}</li>)}
        </ul>
      </details>
    </div>
  )
}
