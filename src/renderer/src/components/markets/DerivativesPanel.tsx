import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Flame } from 'lucide-react'
import { asCountdown, formatRate, OI_WINDOWS, untilFunding } from '../../../../shared/markets/derivatives'
import type { DerivativesAnswer } from '../../../../main/markets/ipc'
import type { FundingPoint, OpenInterestPoint } from '../../../../shared/markets/derivatives'
import { Explain, Introduce } from './Explain'
import type { ExperienceState } from './useExperience'
import type { CurrencyState } from './useCurrency'

/**
 * Funding, open interest, mark and index prices, and liquidations, for one contract.
 *
 * Every figure is the venue's own. Where a venue publishes nothing the field shows a dash and the panel says which
 * provider reports what — so a section can be honestly empty instead of quietly filled from something close enough.
 *
 * The three places this panel is careful, each of which is a way it could otherwise lie:
 *
 * **The countdown comes from a published funding time.** No time, no countdown. It never reaches a negative number, and
 * when the published time is long past the panel says the schedule is stale rather than showing a clock stuck at zero.
 *
 * **Basis is the future's price against the venue's index.** Not against a spot price from another provider, which would
 * be a basis between two different markets wearing the name of one.
 *
 * **Liquidations are a window, not a record.** The venue publishes them as a stream and keeps no history, so the panel
 * starts empty, fills as events arrive, and says so. It shows where liquidations *happened* — never where they might.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const WAY_LABEL: Record<string, string> = {
  rising: 'rising',
  falling: 'falling',
  flat: 'flat',
  unknown: 'unknown'
}

const DIRECTION_LABEL: Record<string, string> = {
  'longs-pay': 'Longs pay shorts',
  'shorts-pay': 'Shorts pay longs',
  flat: 'No payment'
}

/** A small line chart of real points. Nothing is drawn when there is nothing to draw. */
function Spark({
  points,
  positiveOk = true,
  label
}: {
  points: { x: number; y: number }[]
  /** When false, a value above zero is drawn in the rising colour and below in the falling one. */
  positiveOk?: boolean
  label: string
}): React.JSX.Element | null {
  if (points.length < 2) return null
  const xs = points.map((one) => one.x)
  const ys = points.map((one) => one.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys, positiveOk ? Math.min(...ys) : 0)
  const maxY = Math.max(...ys, positiveOk ? Math.max(...ys) : 0)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const path = points
    .map((one, i) => {
      const x = ((one.x - minX) / spanX) * 100
      const y = 28 - ((one.y - minY) / spanY) * 26
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const last = ys[ys.length - 1]
  const first = ys[0]
  return (
    <svg className="mk-spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
      {/* Zero, where it falls inside the range, so a funding chart shows which side of nothing it is on. */}
      {minY < 0 && maxY > 0 ? (
        <line x1="0" x2="100" y1={28 - ((0 - minY) / spanY) * 26} y2={28 - ((0 - minY) / spanY) * 26} className="zero" />
      ) : null}
      <path d={path} className={last >= first ? 'up' : 'down'} />
    </svg>
  )
}

export default function DerivativesPanel({
  instrumentId,
  experience,
  currency
}: {
  instrumentId: string
  experience: ExperienceState
  currency: CurrencyState
}): React.JSX.Element {
  const [answer, setAnswer] = useState<DerivativesAnswer | null>(null)
  const [window_, setWindow] = useState('24h')
  const [funding, setFunding] = useState<FundingPoint[]>([])
  const [oi, setOi] = useState<OpenInterestPoint[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const got = await window.api.marketsDerivatives(instrumentId, window_)
    if (!refused(got)) setAnswer(got)
    setLoading(false)
  }, [instrumentId, window_])

  useEffect(() => {
    setLoading(true)
    void load()
    // Funding and open interest move on a schedule of minutes, so this is deliberately slow. The countdown ticks on its
    // own below rather than by re-fetching.
    const timer = globalThis.setInterval(() => void load(), 15_000)
    return () => globalThis.clearInterval(timer)
  }, [load])

  useEffect(() => {
    // One second, for the countdown only. Not a market request.
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000)
    return () => globalThis.clearInterval(timer)
  }, [])

  useEffect(() => {
    void (async () => {
      const [history, interest] = await Promise.all([
        window.api.marketsFundingHistory(instrumentId, 120),
        window.api.marketsOiHistory(instrumentId, window_, 120)
      ])
      setFunding(refused(history) ? [] : history.points)
      setOi(refused(interest) ? [] : interest.points)
    })()
  }, [instrumentId, window_])

  /** Recomputed every second from the answer's own funding, so the clock is live without re-fetching. */
  const remaining = useMemo(() => untilFunding(answer?.funding ?? null, now), [answer?.funding, now])

  if (loading && !answer) {
    return (
      <div className="mk-derivs">
        <p className="mk-quiet">Loading derivatives data…</p>
      </div>
    )
  }

  const available = answer?.available
  const nothing = available && !available.funding && !available.openInterest && !available.liquidations

  if (!answer || nothing) {
    return (
      <div className="mk-derivs">
        <div className="mk-empty-small">
          <p>{answer?.note || 'No configured provider reports derivatives data for this market.'}</p>
          <p className="pw-note is-quiet">
            Funding, open interest and liquidations come from a futures venue. A spot market has none of them — this is a
            fact about the market, not a gap in the data.
          </p>
        </div>
      </div>
    )
  }

  const contract = answer.contract

  return (
    <div className="mk-derivs">
      {experience.get('showDerivatives') === false && experience.get('autoEducation') ? (
        <Introduce term="funding" experience={experience} />
      ) : null}

      {/* ---------------------------------------------------------------- the contract */}
      {contract ? (
        <div className="mk-sub">
          <span>
            Contract <b>{contract.contractType === 'perpetual' ? 'Perpetual' : 'Dated futures'}</b>
          </span>
          <span>
            Status <b className={contract.status === 'trading' ? 'up' : 'down'}>{contract.status}</b>
          </span>
          <span>
            Settles in <b>{contract.settlement || '—'}</b>
          </span>
          {contract.expiresAt !== null ? (
            <span>
              Expires <b>{new Date(contract.expiresAt).toLocaleDateString()}</b>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mk-seg is-small">
        {OI_WINDOWS.map((one) => (
          <button key={one.id} type="button" className={window_ === one.id ? 'on' : ''} onClick={() => setWindow(one.id)}>
            {one.label}
          </button>
        ))}
      </div>

      <div className="mk-derivs-grid">
        {/* ---------------------------------------------------------------- funding */}
        <section className="mk-derivs-card">
          <h4>
            Funding <Explain term="funding" experience={experience} label="the funding rate" />
          </h4>
          {!available?.funding ? (
            <p className="mk-quiet">Not reported for this market.</p>
          ) : answer.funding === null ? (
            <p className="mk-quiet">No rate has arrived yet.</p>
          ) : (
            <>
              <strong className={answer.funding.rate >= 0 ? 'up' : 'down'}>{formatRate(answer.funding.rate)}</strong>
              <span className="mk-quiet">{DIRECTION_LABEL[answer.fundingDirection]}</span>
              <dl>
                <div>
                  <dt>Yearly equivalent</dt>
                  {/* Null without the funding period, rather than assuming the usual eight hours. */}
                  <dd>{answer.fundingAnnualised === null ? '—' : formatRate(answer.fundingAnnualised, 2)}</dd>
                </div>
                <div>
                  <dt>
                    <Clock size={11} /> Next payment
                  </dt>
                  <dd>
                    {answer.fundingStale ? (
                      // Rather than a clock stuck at zero, which reads as the market having stopped.
                      <span className="mk-quiet">Schedule out of date</span>
                    ) : remaining === null ? (
                      <span className="mk-quiet">Not published</span>
                    ) : (
                      asCountdown(remaining)
                    )}
                  </dd>
                </div>
                {answer.funding.intervalMs !== null ? (
                  <div>
                    <dt>Every</dt>
                    <dd>{Math.round(answer.funding.intervalMs / 3_600_000)}h</dd>
                  </div>
                ) : null}
              </dl>
              <Spark
                points={funding.map((one) => ({ x: one.at, y: one.rate }))}
                positiveOk={false}
                label="Funding rate history"
              />
              {funding.length < 2 ? <p className="mk-quiet">Not enough history to chart.</p> : null}
            </>
          )}
        </section>

        {/* ---------------------------------------------------------------- open interest */}
        <section className="mk-derivs-card">
          <h4>
            Open interest <Explain term="openInterest" experience={experience} label="open interest" />
          </h4>
          {!available?.openInterest ? (
            <p className="mk-quiet">Not reported for this market.</p>
          ) : answer.openInterest === null ? (
            <p className="mk-quiet">No reading has arrived yet.</p>
          ) : (
            <>
              <strong>{answer.openInterest.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              <span className="mk-quiet">
                contracts
                {answer.openInterest.notional !== null ? ` · ${currency.money(answer.openInterest.notional).text}` : ''}
              </span>
              <dl>
                <div>
                  <dt>Change over {window_}</dt>
                  <dd className={answer.oiChange && answer.oiChange.absolute >= 0 ? 'up' : 'down'}>
                    {answer.oiChange === null
                      ? '—'
                      : `${answer.oiChange.absolute >= 0 ? '+' : ''}${answer.oiChange.absolute.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                    {answer.oiChange?.fraction !== null && answer.oiChange !== null
                      ? ` (${formatRate(answer.oiChange.fraction, 2)})`
                      : ''}
                  </dd>
                </div>
                <div>
                  {/* Described, never explained. Both facts over the same window, and no claim about the connection. */}
                  <dt>With price</dt>
                  <dd>
                    OI {WAY_LABEL[answer.relationship.oi]}, price {WAY_LABEL[answer.relationship.price]}
                  </dd>
                </div>
              </dl>
              <Spark points={oi.map((one) => ({ x: one.at, y: one.amount }))} label="Open interest history" />
              {oi.length < 2 ? <p className="mk-quiet">Not enough history to chart.</p> : null}
            </>
          )}
        </section>

        {/* ---------------------------------------------------------------- mark, index and basis */}
        <section className="mk-derivs-card">
          <h4>
            Mark and index <Explain term="markPrice" experience={experience} label="the mark price" />
          </h4>
          {!available?.markPrice || answer.marks === null ? (
            <p className="mk-quiet">Not reported for this market.</p>
          ) : (
            <dl>
              <div>
                <dt>Mark</dt>
                <dd>{currency.money(answer.marks.markPrice).text}</dd>
              </div>
              <div>
                <dt>Index</dt>
                <dd>{currency.money(answer.marks.indexPrice).text}</dd>
              </div>
              <div>
                <dt>
                  Basis <Explain term="basis" experience={experience} label="basis" />
                </dt>
                {/* Null without both prices. Never computed against the last trade instead. */}
                <dd className={answer.basis && answer.basis.absolute >= 0 ? 'up' : 'down'}>
                  {answer.basis === null
                    ? '—'
                    : `${currency.money(answer.basis.absolute).text} (${formatRate(answer.basis.fraction, 3)})`}
                </dd>
              </div>
              {answer.basisAnnualised !== null ? (
                <div>
                  <dt>Annualised</dt>
                  <dd>{formatRate(answer.basisAnnualised, 2)}</dd>
                </div>
              ) : null}
            </dl>
          )}
        </section>

        {/* ---------------------------------------------------------------- liquidations */}
        <section className="mk-derivs-card">
          <h4>
            <Flame size={12} /> Liquidations{' '}
            <Explain term="liquidations" experience={experience} label="liquidations" />
          </h4>
          {!available?.liquidations ? (
            <p className="mk-quiet">Not reported for this market.</p>
          ) : (
            <>
              <strong>{currency.money(answer.liquidations.totalNotional).text}</strong>
              <span className="mk-quiet">over {window_}</span>
              <dl>
                <div>
                  <dt>Longs closed</dt>
                  <dd className="down">{currency.money(answer.liquidations.longNotional).text}</dd>
                </div>
                <div>
                  <dt>Shorts closed</dt>
                  <dd className="up">{currency.money(answer.liquidations.shortNotional).text}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd>{answer.liquidations.count.toLocaleString()}</dd>
                </div>
              </dl>
              {answer.liquidations.count === 0 ? (
                <p className="mk-quiet">
                  {/* An empty panel that explains itself, rather than one that looks broken. */}
                  None since this market was opened. The exchange publishes these as they happen and keeps no history, so
                  there is nothing to load.
                </p>
              ) : null}
              {answer.liquidations.partial ? (
                <p className="mk-quiet">Showing the most recent 500 events, so this window may be incomplete.</p>
              ) : null}
              {answer.liquidations.events.length > 0 ? (
                <ul className="mk-liq-list">
                  {[...answer.liquidations.events]
                    .reverse()
                    .slice(0, 12)
                    .map((one, i) => (
                      <li key={`${one.at}-${one.price}-${i}`} className={one.side === 'sell' ? 'down' : 'up'}>
                        <span>{new Date(one.at).toLocaleTimeString()}</span>
                        {/* A long is closed by a sell, said in words rather than left as a side nobody can map. */}
                        <b>{one.side === 'sell' ? 'long' : 'short'}</b>
                        <span>{currency.money(one.notional).text}</span>
                        <span className="mk-quiet">at {currency.money(one.price).text}</span>
                      </li>
                    ))}
                </ul>
              ) : null}
            </>
          )}
        </section>
      </div>

      {answer.note ? <p className="mk-quiet">{answer.note}</p> : null}
    </div>
  )
}
