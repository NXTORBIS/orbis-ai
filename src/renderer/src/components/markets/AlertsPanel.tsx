import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, History, Plus, Search, Trash2, X } from 'lucide-react'
import {
  COOLDOWN_CHOICES,
  describeAlert,
  type Alert,
  type AlertRepeat,
  type AlertSubject,
  type Comparison
} from '../../../../shared/markets/alerts'
import type { AlertsAnswer } from '../../../../main/markets/ipc'
import type { Instrument, QuoteView } from '../../../../shared/markets/instrument'
import type { IndicatorKind } from '../../../../shared/markets/indicators'
import AssetLogo from './AssetLogo'
import { ListRow } from '../../ui'
import type { NoticeKind } from '../../lib/notices'

/**
 * Alerts.
 *
 * Conditions on real markets, judged by the engine as prices arrive rather than by a timer per alert. This panel writes
 * them and shows what they have done; it decides nothing about whether one has fired.
 *
 * Two things it is careful to say:
 *
 *  - **What an alert has actually seen.** The last value it was judged against is shown beside it, so an alert that is
 *    quiet because the market has not reached it looks different from one that is quiet because nothing is arriving.
 *  - **What has fired, and when.** Written down when it happens, so an alert that fired overnight is still there in the
 *    morning rather than being a notification nobody saw.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const COMPARISON_LABEL: Record<Comparison, string> = {
  above: 'goes above',
  below: 'goes below',
  'at-or-above': 'reaches',
  'at-or-below': 'falls to',
  equals: 'is exactly',
  'crosses-above': 'crosses above',
  'crosses-below': 'crosses below',
  'enters-range': 'enters the range',
  'leaves-range': 'leaves the range',
  'changes-by': 'moves by'
}

/**
 * What an alert can watch.
 *
 * Grouped, because the list grew past the point where a flat menu is readable. `needs` says what a subject requires of
 * the market: a funding rate only exists on a contract whose venue publishes one, so offering it for a spot pair would
 * be offering a condition that can never be measured.
 */
const SUBJECTS: {
  id: string
  label: string
  group: string
  /** What the market has to be for this to mean anything. */
  needs?: 'derivatives' | 'book'
  /** Whether it is measured over a window rather than at an instant. */
  windowed?: boolean
  /** The unit, for the hint under the threshold box. */
  unit?: string
}[] = [
  { id: 'price', label: 'Price', group: 'Price' },
  { id: 'change-percent', label: '24h change', group: 'Price', unit: '%' },
  { id: 'volume', label: '24h volume', group: 'Price' },
  { id: 'rsi', label: 'RSI', group: 'Indicators' },
  { id: 'macd', label: 'MACD histogram', group: 'Indicators' },
  { id: 'atr', label: 'ATR', group: 'Indicators' },
  // A fraction of the mid, so one threshold means the same on a market at 84,000 and one at 0.4.
  { id: 'spread', label: 'Bid-ask spread', group: 'Order book', needs: 'book', unit: 'fraction of mid' },
  { id: 'funding', label: 'Funding rate', group: 'Derivatives', needs: 'derivatives', unit: 'fraction' },
  { id: 'open-interest', label: 'Open interest', group: 'Derivatives', needs: 'derivatives', unit: 'contracts' },
  {
    id: 'open-interest-change',
    label: 'Open interest change',
    group: 'Derivatives',
    needs: 'derivatives',
    windowed: true,
    unit: 'fraction'
  },
  { id: 'liquidations', label: 'Liquidations', group: 'Derivatives', needs: 'derivatives', windowed: true, unit: 'quote currency' },
  { id: 'availability', label: 'Market reachable', group: 'Feed' }
]

/** Windows a windowed subject can measure over. */
const WINDOWS: { ms: number; label: string }[] = [
  { ms: 300_000, label: '5 minutes' },
  { ms: 900_000, label: '15 minutes' },
  { ms: 3_600_000, label: '1 hour' },
  { ms: 14_400_000, label: '4 hours' },
  { ms: 86_400_000, label: '24 hours' }
]

const INTERVALS = ['5m', '15m', '1h', '4h', '1d']

const COOLDOWN_LABEL = (ms: number): string => {
  if (ms === 0) return 'no cooldown'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`
  return 'a day'
}

/** The subject a choice in the menu stands for. Indicators carry their series, because MACD has three. */
const subjectFor = (
  id: string,
  interval: string,
  windowMs: number,
  side: 'long' | 'short' | 'both'
): AlertSubject => {
  if (id === 'price' || id === 'change-percent' || id === 'volume') return { kind: id }
  if (id === 'spread' || id === 'funding' || id === 'open-interest' || id === 'availability') {
    return { kind: id } as AlertSubject
  }
  if (id === 'open-interest-change') return { kind: 'open-interest-change', windowMs }
  if (id === 'liquidations') return { kind: 'liquidations', windowMs, side }
  if (id === 'macd') return { kind: 'indicator', indicator: 'macd', series: 'histogram', interval }
  return { kind: 'indicator', indicator: id as IndicatorKind, interval }
}

/** Whether a subject is one of the indicator kinds, which are the only ones that need a candle interval. */
const INDICATOR_IDS = new Set(['rsi', 'macd', 'atr'])

const number = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) >= 1000 ? 2 : 6 })
    : '—'

export default function AlertsPanel({
  onOpenMarket,
  onNotify,
  /** The market the detail pane has open, so a new alert starts on the one being looked at. */
  current
}: {
  onOpenMarket(instrumentId: string): void
  onNotify(message: string, kind?: NoticeKind): void
  current: Instrument | null
}): React.JSX.Element {
  const [state, setState] = useState<AlertsAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // The form.
  const [target, setTarget] = useState<Instrument | null>(current)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Instrument[]>([])
  const [subject, setSubject] = useState('price')
  const [comparison, setComparison] = useState<Comparison>('crosses-above')
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [interval, setInterval_] = useState('1h')
  const [repeat, setRepeat] = useState<AlertRepeat>('once')
  const [cooldown, setCooldown] = useState(COOLDOWN_CHOICES[2])
  /** For the windowed subjects: over how long, and for liquidations, which side. */
  const [windowMs, setWindowMs] = useState(3_600_000)
  const [side, setSide] = useState<'long' | 'short' | 'both'>('both')
  /**
   * The value the condition has to come back through before it may fire again.
   *
   * Empty means none, which is what every alert had before. Its whole purpose is the price that sits on a level: "above
   * 100" on something oscillating between 99.99 and 100.01 fires for ever without one.
   */
  const [reset, setReset] = useState('')
  const [label, setLabel] = useState('')

  const load = useCallback(async () => {
    const got = await window.api.marketsAlerts()
    if (!refused(got)) setState(got)
  }, [])

  useEffect(() => {
    void load()
    // Prices move, and the value an alert was last judged against moves with them.
    const timer = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (current) setTarget(current)
  }, [current])

  useEffect(() => {
    const wanted = query.trim()
    if (wanted.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      void window.api.marketsSearch(wanted).then((got) => setResults(refused(got) ? [] : got.results))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const run = async (call: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const got = await call()
      if (refused(got)) {
        onNotify(got.message ?? 'That did not work.', 'error')
        return
      }
      setState(got as AlertsAnswer)
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!target) {
      onNotify('Choose a market for the alert first.', 'error')
      return
    }
    const threshold = Number(value)
    if (!Number.isFinite(threshold)) {
      // No invented default: an alert with no threshold would be a condition that can never be judged.
      onNotify('That alert needs a number to compare against.', 'error')
      return
    }
    const ranged = comparison === 'enters-range' || comparison === 'leaves-range'
    const upper = Number(value2)
    if (ranged && !Number.isFinite(upper)) {
      onNotify('A range needs both ends.', 'error')
      return
    }
    await run(() =>
      window.api.marketsAlertSave({
        instrumentId: target.instrumentId,
        label: label.trim(),
        subject: subjectFor(subject, interval, windowMs, side),
        comparison,
        value: threshold,
        value2: ranged ? upper : undefined,
        // Undefined rather than zero when the box is empty: zero is a re-arm level somebody might actually want.
        reset: reset.trim() === '' || !Number.isFinite(Number(reset)) ? undefined : Number(reset),
        repeat,
        cooldownMs: cooldown,
        dailyLimit: 0,
        enabled: true
      })
    )
    setValue('')
    setValue2('')
    setLabel('')
    onNotify('Alert saved')
  }

  const instrumentOf = (instrumentId: string): Instrument | undefined =>
    state?.instruments.find((one) => one.instrumentId === instrumentId)

  const quoteOf = (instrumentId: string): QuoteView | null =>
    state?.quotes.find((one) => one.instrumentId === instrumentId)?.quote ?? null

  /**
   * What the alert is watching, as it stands.
   *
   * The alert's own memory where it has one, because that is the number the condition is judged against. Falling back to
   * the live price would show something the alert has not seen.
   */
  const seenBy = (alert: Alert): string => {
    if (typeof alert.lastValue === 'number' && Number.isFinite(alert.lastValue)) return number(alert.lastValue)
    const quote = quoteOf(alert.instrumentId)
    if (alert.subject.kind === 'price') return number(quote?.last)
    if (alert.subject.kind === 'change-percent') return number(quote?.changePercent)
    if (alert.subject.kind === 'volume') return number(quote?.volume)
    return '—'
  }

  const alerts = state?.alerts ?? []
  const history = state?.history ?? []
  const ranged = comparison === 'enters-range' || comparison === 'leaves-range'
  // Only the indicator subjects are computed from candles, so only they need an interval. The others are read from
  // the quote, the book or the contract as they arrive.
  const needsInterval = INDICATOR_IDS.has(subject)
  const chosenSubject = SUBJECTS.find((one) => one.id === subject)
  const needsWindow = chosenSubject?.windowed === true
  const isLiquidations = subject === 'liquidations'
  // Hysteresis only means anything for a one-sided threshold. A range already has two edges.
  const canReset =
    comparison === 'above' ||
    comparison === 'below' ||
    comparison === 'at-or-above' ||
    comparison === 'at-or-below' ||
    comparison === 'crosses-above' ||
    comparison === 'crosses-below'

  return (
    <div className="mk-alerts">
      {/* ---------------------------------------------------------------- making one */}
      <div className="mk-alert-form">
        <h4>New alert</h4>

        <div className="mk-alert-target">
          {target ? (
            <span className="mk-chip">
              <AssetLogo instrument={target} size="small" />
              <b>{target.symbol}</b>
              <span className="mk-name">{target.name}</span>
              <button type="button" className="tl-icon" aria-label="Choose another market" onClick={() => setTarget(null)}>
                <X size={11} />
              </button>
            </span>
          ) : (
            <div className="mk-search">
              <Search size={13} />
              <input value={query} aria-label="Which market the alert is about" placeholder="Which market?" maxLength={60} onChange={(e) => setQuery(e.target.value)} />
              {results.length > 0 && (
                <ul className="mk-results">
                  {results.slice(0, 8).map((one) => (
                    <li key={one.instrumentId}>
                      <button
                        type="button"
                        onClick={() => {
                          setTarget(one)
                          setQuery('')
                          setResults([])
                        }}
                      >
                        <b>{one.symbol}</b>
                        <span className="mk-name">{one.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="mk-alert-row">
          <select value={subject} aria-label="What to watch" onChange={(e) => setSubject(e.target.value)}>
            {[...new Set(SUBJECTS.map((one) => one.group))].map((group) => (
              <optgroup key={group} label={group}>
                {SUBJECTS.filter((one) => one.group === group).map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {needsWindow && (
            <select
              value={String(windowMs)}
              aria-label="Over how long"
              onChange={(e) => setWindowMs(Number(e.target.value))}
            >
              {WINDOWS.map((one) => (
                <option key={one.ms} value={one.ms}>
                  over {one.label}
                </option>
              ))}
            </select>
          )}
          {isLiquidations && (
            <select value={side} aria-label="Which side" onChange={(e) => setSide(e.target.value as typeof side)}>
              <option value="both">both sides</option>
              <option value="long">longs</option>
              <option value="short">shorts</option>
            </select>
          )}
          {needsInterval && (
            <select value={interval} aria-label="On which candles" onChange={(e) => setInterval_(e.target.value)}>
              {INTERVALS.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          )}
          <select value={comparison} aria-label="Condition" onChange={(e) => setComparison(e.target.value as Comparison)}>
            {(Object.keys(COMPARISON_LABEL) as Comparison[]).map((one) => (
              <option key={one} value={one}>
                {COMPARISON_LABEL[one]}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={value}
            placeholder="value"
            aria-label="Threshold"
            onChange={(e) => setValue(e.target.value)}
          />
          {ranged && (
            <input
              type="number"
              value={value2}
              placeholder="to"
              aria-label="Upper end of the range"
              onChange={(e) => setValue2(e.target.value)}
            />
          )}
          {canReset && (
            <input
              type="number"
              value={reset}
              placeholder="re-arm at"
              title="The value it has to come back through before it can fire again. Leave empty for none."
              aria-label="Re-arm value"
              onChange={(e) => setReset(e.target.value)}
            />
          )}
        </div>

        {chosenSubject?.unit && (
          <p className="pw-note is-quiet">
            {chosenSubject.label} is measured in {chosenSubject.unit}
            {chosenSubject.unit === 'fraction' || chosenSubject.unit === 'fraction of mid'
              ? ' — 0.001 is a tenth of a percent'
              : ''}
            .
            {chosenSubject.needs === 'derivatives' &&
              ' Only a contract whose venue publishes it can be measured, so this will never fire on a spot pair.'}
            {chosenSubject.needs === 'book' && ' It needs an order book, which not every provider supplies.'}
          </p>
        )}

        {/*
          * Said where the control is, not in a footnote. Somebody who has just typed a re-arm value is the person who
          * needs to know what it does, and they are looking here.
          */}
        {canReset && reset.trim() !== '' && (
          <p className="pw-note is-quiet">
            After it fires, this stays quiet until the value passes back through {reset}. Without that, a price sitting
            on a level fires every cooldown for ever.
          </p>
        )}

        <div className="mk-alert-row">
          <label className="mk-inline">
            <span>Repeat</span>
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as AlertRepeat)}>
              <option value="once">once, then stop</option>
              <option value="every-time">every time</option>
              <option value="daily">once a day</option>
            </select>
          </label>
          <label className="mk-inline">
            <span>Cooldown</span>
            <select value={String(cooldown)} onChange={(e) => setCooldown(Number(e.target.value))}>
              {COOLDOWN_CHOICES.map((ms) => (
                <option key={ms} value={ms}>
                  {COOLDOWN_LABEL(ms)}
                </option>
              ))}
            </select>
          </label>
          <input
            value={label}
            placeholder="Name it (optional)"
            maxLength={80}
            aria-label="Alert name"
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="button" className="queue-btn small" disabled={busy || !target} onClick={() => void save()}>
            <Plus size={13} /> Add alert
          </button>
        </div>
        {/* Crossing conditions need a previous value, so they fire on the transition rather than every tick above it. */}
        {(comparison === 'crosses-above' || comparison === 'crosses-below') && (
          <p className="pw-note is-quiet">
            A crossing fires on the move through the level, not repeatedly while it stays there. It needs one reading
            before it can judge the next, so it will not fire on the very first price it sees.
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------------- what is set */}
      <div className="mk-alert-list">
        <div className="mk-alert-head">
          <h4>
            {alerts.length} alert{alerts.length === 1 ? '' : 's'}
          </h4>
          <button type="button" className="queue-btn tiny ghost" onClick={() => setShowHistory((on) => !on)}>
            <History size={12} /> {showHistory ? 'Hide history' : `History (${history.length})`}
          </button>
        </div>

        {alerts.length === 0 ? (
          <div className="mk-empty-small">
            <p>No alerts yet.</p>
            <p className="pw-note is-quiet">
              An alert is judged as prices arrive, not on a timer, so it fires when the market does.
            </p>
          </div>
        ) : (
          <ul className="mk-rows">
            {alerts.map((alert) => {
              const instrument = instrumentOf(alert.instrumentId)
              const symbol = instrument?.symbol ?? alert.instrumentId
              return (
                /*
                 * The row, the part you press and the two pieces of text come from ListRow; the symbol travels with
                 * the logo because `.mk-row-name > b` is a direct-child rule and a wrapper would lose it.
                 *
                 * The two buttons stay where they are, as children rather than as `actions`. ListRow draws actions
                 * through IconButton, which always carries `.icon-btn`, and `.icon-btn.small` outranks `.tl-icon` on
                 * width, height and corner — 24px at radius 7 would become 26px at radius 6. Day one has to look
                 * identical, so they keep their own class and their own names.
                 */
                <ListRow
                  key={alert.id}
                  className={`mk-row mk-alert${alert.enabled ? '' : ' is-off'}`}
                  mainClassName="mk-row-name"
                  name={`${symbol} — ${alert.label || describeAlert(alert, symbol)}`}
                  icon={
                    <>
                      <AssetLogo symbol={symbol} size="small" />
                      <b>{symbol}</b>
                    </>
                  }
                  title={alert.label || describeAlert(alert, symbol)}
                  titleClassName="mk-name"
                  onSelect={() => onOpenMarket(alert.instrumentId)}
                >
                  <span className="mk-alert-now" title="The last value this alert was judged against">
                    now {seenBy(alert)}
                  </span>
                  <span className="mk-quiet">
                    {alert.lastFiredAt
                      ? `fired ${new Date(alert.lastFiredAt).toLocaleString()}`
                      : 'not fired yet'}
                  </span>
                  <button
                    type="button"
                    className="tl-icon"
                    aria-label={alert.enabled ? `Pause ${symbol} alert` : `Resume ${symbol} alert`}
                    title={alert.enabled ? 'Pause' : 'Resume'}
                    onClick={() => void run(() => window.api.marketsAlertSave({ ...alert, enabled: !alert.enabled }))}
                  >
                    {alert.enabled ? <Bell size={13} /> : <BellOff size={13} />}
                  </button>
                  <button
                    type="button"
                    className="tl-icon"
                    aria-label={`Delete ${symbol} alert`}
                    onClick={() => void run(() => window.api.marketsAlertRemove(alert.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </ListRow>
              )
            })}
          </ul>
        )}

        {showHistory && (
          <div className="mk-history">
            <div className="mk-alert-head">
              <h5>What has fired</h5>
              {history.length > 0 && (
                <button
                  type="button"
                  className="queue-btn tiny ghost"
                  onClick={() => void run(() => window.api.marketsAlertHistoryClear())}
                >
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="mk-quiet">Nothing has fired yet.</p>
            ) : (
              <ul className="mk-rows">
                {history.map((one) => (
                  <ListRow
                    key={one.id}
                    className="mk-row"
                    mainClassName="mk-row-name"
                    name={`${one.symbol || one.instrumentId} — ${one.label}`}
                    icon={
                      <>
                        <AssetLogo symbol={one.symbol} size="small" />
                        <b>{one.symbol || one.instrumentId}</b>
                      </>
                    }
                    title={one.label}
                    titleClassName="mk-name"
                    onSelect={() => onOpenMarket(one.instrumentId)}
                  >
                    {/* The value that met the condition, at the moment it did. */}
                    <span className="mk-price">at {number(one.value)}</span>
                    <span className="mk-quiet">{new Date(one.at).toLocaleString()}</span>
                  </ListRow>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
