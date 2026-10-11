import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Gauge, ShieldAlert, ShieldCheck } from 'lucide-react'
import { MAX_LEVERAGE, type AccountMargin, type MarginSettings, type PositionMargin } from '../../../../shared/markets/margin'
import type { NoticeKind } from '../../lib/notices'
import { Introduce } from './Explain'
import type { CurrencyState } from './useCurrency'
import type { ExperienceState } from './useExperience'

/**
 * The simulated margin picture.
 *
 * Every number here is Orbis's model and not an exchange's, and the panel says so where somebody is most likely to act
 * on one: beside the liquidation price, not in a footnote underneath. A liquidation price read as a fact is the single
 * most expensive misunderstanding this screen could cause, so the caveat travels with the figure.
 *
 * Leverage is **off by default** and turning it on is a deliberate act with a warning attached, because a simulation
 * that quietly leveraged a position would be teaching the wrong lesson about the most consequential decision there is.
 *
 * A position with no leverage has **no** liquidation price, and this shows that as "cannot be liquidated" rather than
 * as a dash — a dash reads as missing data, and the difference matters.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

interface Answer {
  settings: MarginSettings
  account: AccountMargin
  positions: { instrumentId: string; margin: PositionMargin | null }[]
  assumptions: string[]
}

/** How close to being closed out. Drives the colour, and nothing is red until it genuinely is close. */
const risk = (ratio: number | null): 'none' | 'comfortable' | 'tight' | 'critical' => {
  if (ratio === null) return 'none'
  if (ratio >= 3) return 'comfortable'
  if (ratio >= 1.5) return 'tight'
  return 'critical'
}

export default function MarginPanel({
  experience,
  currency,
  onNotify
}: {
  experience: ExperienceState
  currency: CurrencyState
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState('')
  const [arming, setArming] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.marketsMargin()
      if (refused(result)) {
        setProblem(result.message ?? 'The margin picture could not be worked out.')
        setAnswer(null)
        return
      }
      setProblem('')
      setAnswer(result)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Re-read while positions move, so the distance to liquidation is not a number from five minutes ago.
    const timer = setInterval(() => void load(), 15_000)
    return () => clearInterval(timer)
  }, [load])

  const patch = useCallback(
    async (change: Partial<MarginSettings>) => {
      const result = await window.api.marketsSetMargin(change)
      if (refused(result)) {
        onNotify(result.message ?? 'That could not be changed', 'error')
        return
      }
      await load()
    },
    [load, onNotify]
  )

  const settings = answer?.settings
  const account = answer?.account
  const level = risk(account?.marginRatio ?? null)
  const money = (value: number | null | undefined): string => currency.money(value).text

  return (
    <section className="mk-margin" aria-label="Margin">
      <Introduce experience={experience} term="leverage" />

      {/* The warning sits above the switch, not below it. Somebody reading downward meets it before the control. */}
      <div className="mk-margin-warn" role="note">
        <ShieldAlert size={15} />
        <div>
          <b>Everything here is simulated.</b> Orbis works these numbers out from a simple model. A real exchange uses
          its own mark price, tiers maintenance margin by position size, and has an insurance fund and partial
          liquidation — none of which are here. A liquidation price on this screen is not a price anybody will close you
          at.
        </div>
      </div>

      <div className="mk-margin-controls">
        <label className="mk-switch">
          <input
            type="checkbox"
            checked={settings?.enabled === true}
            onChange={(event) => {
              if (event.target.checked) {
                // Turning it on is a deliberate act, so it asks once rather than flipping on a stray click.
                setArming(true)
                return
              }
              void patch({ enabled: false })
            }}
          />
          <span>Simulate margin and leverage</span>
        </label>

        {arming && (
          <div className="mk-margin-arm" role="alertdialog" aria-label="Turn on leverage">
            <p>
              With leverage on, a position can be closed out by the simulation before the price comes back. That is the
              point of it — it is what leverage does in a real account too.
            </p>
            <div>
              <button
                type="button"
                className="mk-primary"
                onClick={() => {
                  setArming(false)
                  void patch({ enabled: true })
                }}
              >
                Turn it on
              </button>
              <button type="button" onClick={() => setArming(false)}>
                Leave it off
              </button>
            </div>
          </div>
        )}

        {settings?.enabled && (
          <label className="mk-margin-lever">
            <span>
              Leverage <b>{settings.leverage}×</b>
            </span>
            <input
              type="range"
              min={1}
              max={MAX_LEVERAGE}
              step={1}
              value={settings.leverage}
              onChange={(event) => void patch({ leverage: Number(event.target.value) })}
              aria-label={`Leverage, ${settings.leverage} times`}
            />
            <span className="mk-quiet">
              At {settings.leverage}× a move of {(100 / settings.leverage).toFixed(1)}% against a position wipes out what
              was set aside for it.
            </span>
          </label>
        )}
      </div>

      {problem !== '' && <p className="mk-problem">{problem}</p>}
      {loading && !answer && <p className="mk-quiet">Working it out…</p>}

      {account && (
        <>
          <div className={`mk-margin-health is-${level}`}>
            {level === 'critical' ? <AlertTriangle size={16} /> : level === 'none' ? <ShieldCheck size={16} /> : <Gauge size={16} />}
            <div>
              <strong>
                {level === 'none'
                  ? 'Nothing requires maintenance margin'
                  : level === 'comfortable'
                    ? 'Comfortable'
                    : level === 'tight'
                      ? 'Getting tight'
                      : 'Close to being closed out'}
              </strong>
              <span className="mk-quiet">
                {account.marginRatio === null
                  ? settings?.enabled
                    ? 'No open position needs maintenance margin, so there is nothing to be close to.'
                    : 'Leverage is off, so no position here can be liquidated at all.'
                  : `Equity is ${account.marginRatio.toFixed(2)}× what this model would require before closing a position.`}
              </span>
            </div>
          </div>

          <div className="mk-stats">
            {[
              ['Equity', money(account.equity)],
              ['Gross exposure', money(account.grossNotional)],
              // Net is worth its own box: a hedged book reads as small here and large under gross, and the gap is the point.
              ['Net exposure', money(account.netNotional)],
              ['Margin set aside', money(account.marginUsed)],
              ['Maintenance required', money(account.maintenanceRequired)],
              [
                'Effective leverage',
                account.effectiveLeverage === null ? '—' : `${account.effectiveLeverage.toFixed(2)}×`
              ]
            ].map(([label, value]) => (
              <div key={label} className="mk-stat">
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>

          {account.atRisk.length > 0 && (
            <p className="mk-problem">
              <AlertTriangle size={13} /> Under this model {account.atRisk.length === 1 ? 'this position would' : 'these positions would'}{' '}
              already be closed out at the prices given: {account.atRisk.join(', ')}.
            </p>
          )}

          {account.missingPrices.length > 0 && (
            <p className="mk-problem">
              No current price for {account.missingPrices.join(', ')}, so {account.missingPrices.length === 1 ? 'it is' : 'they are'}{' '}
              left out of every figure above rather than valued at a guess.
            </p>
          )}

          {answer.positions.length === 0 ? (
            <p className="mk-quiet">No open positions. Open one in the paper account and it will appear here.</p>
          ) : (
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col">Notional</th>
                    <th scope="col">Set aside</th>
                    <th scope="col">Unrealised</th>
                    <th scope="col">Liquidation</th>
                    <th scope="col">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {answer.positions.map((one) => (
                    <tr key={one.instrumentId}>
                      <th scope="row">{one.instrumentId.split(':').pop() ?? one.instrumentId}</th>
                      {one.margin === null ? (
                        <td colSpan={5} className="mk-quiet">
                          Could not be valued — no current price.
                        </td>
                      ) : (
                        <>
                          <td>{money(one.margin.notional)}</td>
                          <td>{money(one.margin.initialMargin)}</td>
                          <td className={one.margin.unrealised >= 0 ? 'mk-up' : 'mk-down'}>{money(one.margin.unrealised)}</td>
                          <td>
                            {/*
                              * "Cannot be liquidated" rather than a dash. A dash reads as missing data; this is a fact
                              * about an unleveraged position, and it is the reassuring one.
                              */}
                            {one.margin.liquidationPrice === null ? (
                              <span className="mk-quiet">cannot be liquidated</span>
                            ) : (
                              <b title="Orbis's model, not an exchange's">{money(one.margin.liquidationPrice)}</b>
                            )}
                          </td>
                          <td>
                            {one.margin.distanceFraction === null ? (
                              <span className="mk-quiet">—</span>
                            ) : (
                              <span className={Math.abs(one.margin.distanceFraction) < 0.1 ? 'mk-down' : ''}>
                                {(one.margin.distanceFraction * 100).toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ul className="mk-assumptions">
            {answer.assumptions.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
