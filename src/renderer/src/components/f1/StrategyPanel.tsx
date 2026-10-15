import { useEffect, useMemo, useState } from 'react'
import { median } from '../../../../shared/f1/time'
import { formatLapTime } from '../../../../shared/f1/time'
import { eligibleLaps, evaluatePlan, pitLaneLoss, stintPace, type PlanStint, type Stint } from '../../../../shared/f1/strategy'
import type { F1Answer, F1Session, F1SessionBundle, F1SessionTiming } from '../../../../shared/f1/types'
import { compoundComparison, pitStopsByTeam, planSensitivity, projectStint, slowStops } from '../../../../shared/f1/analysis'
import { SessionPicker } from './SessionPicker'
import { SourceLine, Waiting, useF1, useKept } from './shared'

export const COMPOUND_COLOUR: Record<string, string> = { SOFT: '#ff4d4d', MEDIUM: '#ffd34d', HARD: '#e8e8e8', INTERMEDIATE: '#4dd36b', WET: '#4d9bff' }

export default function StrategyPanel({ year }: { year: number }): React.JSX.Element {
  const [session, setSession] = useState<F1Session | null>(null)
  const [timing, retryT] = useF1<F1SessionTiming>(session ? () => window.api.f1Timing(session.key, session.endsAt) as Promise<F1Answer<F1SessionTiming>> : null, [session?.key])
  const [bundle, retryB] = useF1<F1SessionBundle>(session ? () => window.api.f1Bundle(session.key, session.endsAt) as Promise<F1Answer<F1SessionBundle>> : null, [session?.key])
  const [driver, setDriver] = useState<number | null>(null)

  const t = timing.state === 'ready' ? timing.answer.data : null
  const b = bundle.state === 'ready' ? bundle.answer.data : null

  const order = useMemo(() => {
    if (!t) return []
    const pos = new Map((b?.result ?? []).map((r) => [r.driverNumber, r.position ?? 999]))
    return t.drivers.slice().sort((x, y) => (pos.get(x.number) ?? 999) - (pos.get(y.number) ?? 999) || x.number - y.number)
  }, [t, b])

  useEffect(() => {
    if (order.length && (driver === null || !order.some((d) => d.number === driver))) setDriver(order[0].number)
  }, [order, driver])

  const maxLap = useMemo(() => (t ? Math.max(1, ...t.laps.map((l) => l.lap)) : 1), [t])
  const stintsOf = (n: number): Stint[] => (b ? b.stints.filter((s) => s.driverNumber === n) : [])
  const pitLaps = (n: number): Set<number> => new Set((b?.pit ?? []).filter((p) => p.driverNumber === n).map((p) => p.lap))

  const paces = useMemo(() => (t && b && driver !== null ? stintsOf(driver).map((s) => stintPace(s, t.laps, pitLaps(driver))) : []), [t, b, driver])
  const loss = b ? pitLaneLoss(b.pit) : null

  // Measured per-compound pace across the whole session, for the calculator's starting assumptions.
  const measured = useMemo(() => {
    const byCompound: Record<string, number[]> = {}
    const wear: Record<string, number[]> = {}
    if (!t || !b) return { pace: {} as Record<string, number>, wear: {} as Record<string, number> }
    for (const d of t.drivers) {
      const pl = pitLaps(d.number)
      for (const s of stintsOf(d.number)) {
        if (!s.compound) continue
        const used = eligibleLaps(t.laps, s, pl)
        for (const l of used) (byCompound[s.compound] ??= []).push(l.duration as number)
        const p = stintPace(s, t.laps, pl)
        if (p.trend && p.trend.n >= 8 && p.trend.r2 > 0.3) (wear[s.compound] ??= []).push(p.trend.perLap)
      }
    }
    const pace: Record<string, number> = {}
    const w: Record<string, number> = {}
    for (const [c, v] of Object.entries(byCompound)) if (v.length >= 10) pace[c] = median(v) as number
    for (const [c, v] of Object.entries(wear)) w[c] = Math.max(0, median(v) as number)
    return { pace, wear: w }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, b])

  return (
    <>
      <div className="f1-controls">
        <SessionPicker year={year} value={session} onChange={setSession} only={['Race', 'Sprint']} />
      </div>
      {session && (timing.state !== 'ready' || bundle.state !== 'ready') && <Waiting load={timing.state !== 'ready' ? timing : bundle} retry={timing.state !== 'ready' ? retryT : retryB} what="the strategy data" />}
      {t && b && (
        <>
          <SourceLine load={bundle} retry={retryB} />
          {b.missing.length > 0 && <p className="f1-note f1-warn">The provider has no {b.missing.join(', ')} for this session, so those parts are left out.</p>}
          <h2 className="f1-h">Tyre strategy</h2>
          {b.stints.length === 0 ? (
            <p className="f1-note">The provider recorded no tyre stints for this session.</p>
          ) : (
            <div className="f1-stints" role="table" aria-label="Tyre stints by driver">
              {order.map((d) => (
                <div key={d.number} role="row" className={`f1-stintrow${driver === d.number ? ' is-on' : ''}`} onClick={() => setDriver(d.number)}>
                  <span className="f1-stintname">{d.code}</span>
                  <div className="f1-stintbar" role="cell">
                    {stintsOf(d.number).map((s) => (
                      <span
                        key={s.stint}
                        className="f1-stint"
                        title={`${s.compound ?? 'Unknown compound'} · laps ${s.lapStart}-${s.lapEnd}${s.tyreAgeAtStart ? ` · began ${s.tyreAgeAtStart} laps old` : ''}`}
                        style={{ left: `${((s.lapStart - 1) / maxLap) * 100}%`, width: `${((s.lapEnd - s.lapStart + 1) / maxLap) * 100}%`, background: s.compound ? COMPOUND_COLOUR[s.compound] : '#555' }}
                      >
                        {s.compound ? s.compound[0] : '?'}
                      </span>
                    ))}
                    {(b.pit ?? [])
                      .filter((p) => p.driverNumber === d.number)
                      .map((p) => (
                        <i key={p.lap} className="f1-pitmark" style={{ left: `${((p.lap - 0.5) / maxLap) * 100}%` }} title={`Pit stop, lap ${p.lap}`} />
                      ))}
                  </div>
                </div>
              ))}
              <p className="f1-legend">
                {Object.entries(COMPOUND_COLOUR).map(([c, col]) => (
                  <span key={c}>
                    <i className="f1-dot" style={{ background: col }} /> {c.toLowerCase()}
                  </span>
                ))}
                <span>
                  <i className="f1-dot" style={{ background: '#555' }} /> not reported
                </span>
              </p>
            </div>
          )}

          <div className="f1-split">
            <div>
              <h2 className="f1-h">Pit stops</h2>
              <PitStopInsights t={t} b={b} />
              {loss && (
                <p className="f1-note">
                  Median time in the pit lane: <b>{loss.median.toFixed(1)} s</b> over {loss.n} measured stops. Pit-lane time is entry line to exit line; stationary time is
                  shorter and is shown where the provider measured it.
                </p>
              )}
              <table className="f1-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th className="num">Lap</th>
                    <th className="num">Pit lane</th>
                    <th className="num">Stationary</th>
                  </tr>
                </thead>
                <tbody>
                  {b.pit.length === 0 && (
                    <tr>
                      <td colSpan={4}>No pit stops were recorded.</td>
                    </tr>
                  )}
                  {b.pit.map((p, i) => (
                    <tr key={i}>
                      <td>{t.drivers.find((d) => d.number === p.driverNumber)?.code ?? p.driverNumber}</td>
                      <td className="num">{p.lap}</td>
                      <td className="num">{p.laneDuration === null ? '–' : `${p.laneDuration.toFixed(1)} s`}</td>
                      <td className="num">{p.stopDuration === null ? '–' : `${p.stopDuration.toFixed(1)} s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h2 className="f1-h">Stint pace · {t.drivers.find((d) => d.number === driver)?.name ?? ''}</h2>
              <table className="f1-table">
                <thead>
                  <tr>
                    <th>Stint</th>
                    <th>Tyre</th>
                    <th className="num">Laps</th>
                    <th className="num">Used</th>
                    <th className="num">Median</th>
                    <th className="num">Best</th>
                    <th className="num">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {paces.map((p) => (
                    <tr key={p.stint.stint}>
                      <td>
                        {p.stint.stint} <small>L{p.stint.lapStart}-{p.stint.lapEnd}</small>
                      </td>
                      <td>{p.stint.compound ?? 'unknown'}</td>
                      <td className="num">{p.laps}</td>
                      <td className="num">{p.eligible}</td>
                      <td className="num">{formatLapTime(p.median)}</td>
                      <td className="num">{formatLapTime(p.best)}</td>
                      <td className="num" title={p.trend ? `fit over ${p.trend.n} laps, R² ${p.trend.r2.toFixed(2)}` : 'too few laps for a trend'}>
                        {p.trend ? `${p.trend.perLap >= 0 ? '+' : ''}${p.trend.perLap.toFixed(3)} s/lap` : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="f1-note">
                &quot;Used&quot; laps have a time, are not out-laps or pit laps, and are not lap 1. The trend is the slope of lap time against tyre age. It mixes tyre wear with
                fuel burning off (which makes cars faster), traffic and track conditions, so it is a description of what happened, not a measurement of tyre wear.
              </p>
            </div>
          </div>

          <StintInsights t={t} b={b} driver={driver} />
          <Calculator key={`${session?.key}-${driver}`} actual={driver === null ? [] : stintsOf(driver)} totalLaps={maxLap} measured={measured} loss={loss?.median ?? null} />
        </>
      )}
    </>
  )
}

function Calculator({
  actual,
  totalLaps,
  measured,
  loss
}: {
  actual: Stint[]
  totalLaps: number
  measured: { pace: Record<string, number>; wear: Record<string, number> }
  loss: number | null
}): React.JSX.Element {
  const compounds = Object.keys(measured.pace)
  const initial: PlanStint[] = actual.length
    ? actual.map((s) => ({ compound: s.compound ?? compounds[0] ?? 'MEDIUM', laps: s.lapEnd - s.lapStart + 1 }))
    : [{ compound: compounds[0] ?? 'MEDIUM', laps: totalLaps }]
  const [plan, setPlan] = useState<PlanStint[]>(initial)
  const [pitLoss, setPitLoss] = useState<number>(loss ?? 22)
  const [pace, setPace] = useState<Record<string, number>>(measured.pace)
  const [wear, setWear] = useState<Record<string, number>>(measured.wear)

  const assumptions = { basePace: pace, wear, pitLoss }
  const result = evaluatePlan(plan, assumptions)
  const baseline = evaluatePlan(initial, assumptions)
  const laps = plan.reduce((t, s) => t + s.laps, 0)
  const update = (i: number, patch: Partial<PlanStint>): void => setPlan(plan.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const allCompounds = Array.from(new Set([...compounds, ...plan.map((s) => s.compound), 'SOFT', 'MEDIUM', 'HARD']))

  return (
    <section className="f1-calc">
      <h2 className="f1-h">What-if strategy</h2>
      <p className="f1-note">
        A hypothetical, not a prediction. It adds up the numbers below: each lap takes the compound&apos;s fresh-tyre pace plus the wear per lap of tyre age, and each stop adds
        the pit-lane time. It does not model fuel, traffic, track evolution, safety cars or what other cars do, and it cannot say what would really have happened.
      </p>
      <table className="f1-table">
        <thead>
          <tr>
            <th>Stint</th>
            <th>Tyre</th>
            <th className="num">Laps</th>
            <th className="num">Fresh pace s</th>
            <th className="num">Wear s/lap</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <select value={s.compound} onChange={(e) => update(i, { compound: e.target.value })} aria-label={`Tyre for stint ${i + 1}`}>
                  {allCompounds.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td className="num">
                <input type="number" min={1} max={totalLaps} value={s.laps} onChange={(e) => update(i, { laps: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label={`Laps in stint ${i + 1}`} />
              </td>
              <td className="num">
                <input type="number" step={0.1} value={pace[s.compound] ?? ''} placeholder="needed" onChange={(e) => setPace({ ...pace, [s.compound]: Number(e.target.value) })} aria-label={`Fresh pace on ${s.compound}`} />
              </td>
              <td className="num">
                <input type="number" step={0.01} value={wear[s.compound] ?? 0} onChange={(e) => setWear({ ...wear, [s.compound]: Number(e.target.value) })} aria-label={`Wear on ${s.compound}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="f1-controls">
        <button type="button" className="f1-btn" onClick={() => setPlan([...plan, { compound: compounds[0] ?? 'MEDIUM', laps: 10 }])} disabled={plan.length >= 5}>
          Add a stint
        </button>
        <button type="button" className="f1-btn" onClick={() => setPlan(plan.slice(0, -1))} disabled={plan.length <= 1}>
          Remove last stint
        </button>
        <button type="button" className="f1-btn" onClick={() => setPlan(initial)}>
          Reset to what happened
        </button>
        <label>
          Pit-lane loss s
          <input type="number" step={0.1} value={pitLoss} onChange={(e) => setPitLoss(Number(e.target.value))} />
        </label>
      </div>
      {laps !== totalLaps && (
        <p className="f1-note f1-warn">
          The stints add up to {laps} laps; the session was {totalLaps}. The comparison below is only meaningful at the same distance.
        </p>
      )}
      {result.missing.length > 0 && <p className="f1-note f1-warn">Needs an assumption: {result.missing.join(', ')}.</p>}
      <SavedPlans plan={plan} pitLoss={pitLoss} onLoad={(p, l) => { setPlan(p); setPitLoss(l) }} />
      <table className="f1-table">
        <tbody>
          <tr>
            <td>This plan</td>
            <td className="num">{result.missing.length ? '–' : formatLapTime(result.totalSeconds)}</td>
            <td className="num">{result.stops} stop{result.stops === 1 ? '' : 's'}</td>
          </tr>
          <tr>
            <td>What happened, with the same assumptions</td>
            <td className="num">{baseline.missing.length ? '–' : formatLapTime(baseline.totalSeconds)}</td>
            <td className="num">{baseline.stops} stop{baseline.stops === 1 ? '' : 's'}</td>
          </tr>
          <tr>
            <td>Difference</td>
            <td className="num">
              {result.missing.length || baseline.missing.length || laps !== totalLaps ? '–' : `${result.totalSeconds - baseline.totalSeconds >= 0 ? '+' : '-'}${Math.abs(result.totalSeconds - baseline.totalSeconds).toFixed(1)} s`}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      <Sensitivity plan={plan} assumptions={assumptions} />
    </section>
  )
}

/** Compounds across the whole session, and where each of the chosen driver's stints was heading, with its spread. */
function StintInsights({ t, b, driver }: { t: F1SessionTiming; b: F1SessionBundle; driver: number | null }): React.JSX.Element {
  const compounds = useMemo(() => {
    const items: { compound: string; median: number | null; laps: number; trend: number | null }[] = []
    for (const d of t.drivers) {
      const pl = new Set(b.pit.filter((p) => p.driverNumber === d.number).map((p) => p.lap))
      for (const st of b.stints.filter((x) => x.driverNumber === d.number)) {
        if (!st.compound) continue
        const p = stintPace(st, t.laps, pl)
        items.push({ compound: st.compound, median: p.median, laps: p.eligible, trend: p.trend && p.trend.n >= 8 && p.trend.r2 > 0.3 ? p.trend.perLap : null })
      }
    }
    return compoundComparison(items).sort((x, y) => (x.pace ?? 999) - (y.pace ?? 999))
  }, [t, b])
  const projections = useMemo(() => {
    if (driver === null) return []
    const pl = new Set(b.pit.filter((p) => p.driverNumber === driver).map((p) => p.lap))
    return b.stints
      .filter((x) => x.driverNumber === driver)
      .map((st) => {
        const used = eligibleLaps(t.laps, st, pl)
        const age0 = st.tyreAgeAtStart ?? 0
        const pr = projectStint(
          used.map((l) => age0 + (l.lap - st.lapStart)),
          used.map((l) => l.duration as number),
          6
        )
        return { st, pr }
      })
      .filter((x) => x.pr !== null)
  }, [t, b, driver])
  return (
    <section>
      <h2 className="f1-h">Compounds in this session</h2>
      {compounds.length === 0 ? (
        <p className="f1-note">No tyre stints were listed for this session.</p>
      ) : (
        <table className="f1-table">
          <thead>
            <tr>
              <th>Tyre</th>
              <th className="num">Stints</th>
              <th className="num">Laps used</th>
              <th className="num">Mean of stint medians</th>
              <th className="num">Typical trend</th>
            </tr>
          </thead>
          <tbody>
            {compounds.map((c) => (
              <tr key={c.compound}>
                <td>
                  <span className="f1-swatch" style={{ background: COMPOUND_COLOUR[c.compound] ?? '#888' }} />
                  {c.compound}
                </td>
                <td className="num">{c.stints}</td>
                <td className="num">{c.laps}</td>
                <td className="num">{formatLapTime(c.pace)}</td>
                <td className="num">{c.wear === null ? '–' : `${c.wear >= 0 ? '+' : ''}${c.wear.toFixed(3)} s/lap`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="f1-note">Different compounds ran at different moments, fuel loads and track conditions, so this is a description of the session, not a ranking of the tyres.</p>
      <h2 className="f1-h">Where the selected driver’s stints were heading</h2>
      {projections.length === 0 ? (
        <p className="f1-note">No stint has enough clean laps (eight, with a real trend) to carry forward.</p>
      ) : (
        projections.map(({ st, pr }) => (
          <div key={st.stint}>
            <p className="f1-note">
              Stint {st.stint} · {st.compound ?? 'unknown'} · laps {st.lapStart}–{st.lapEnd}: {pr!.perLap >= 0 ? '+' : ''}
              {pr!.perLap.toFixed(3)} s per lap of age (R² {pr!.r2.toFixed(2)}, ±{(1.96 * pr!.spread).toFixed(2)} s about the line).
            </p>
            <table className="f1-table">
              <thead>
                <tr>
                  <th>Tyre age</th>
                  <th className="num">Trend</th>
                  <th className="num">Low</th>
                  <th className="num">High</th>
                </tr>
              </thead>
              <tbody>
                {pr!.points.map((x) => (
                  <tr key={x.age}>
                    <td>{x.age} laps</td>
                    <td className="num">{formatLapTime(x.seconds)}</td>
                    <td className="num">{formatLapTime(x.low)}</td>
                    <td className="num">{formatLapTime(x.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      <p className="f1-note">
        A projection carries the stint’s own trend forward and shows only the spread of the laps it came from. It assumes no traffic, safety car or change in fuel effect, so it describes where the trend pointed,
        not what the car would have done.
      </p>
    </section>
  )
}

function Sensitivity({ plan, assumptions }: { plan: PlanStint[]; assumptions: { basePace: Record<string, number>; wear: Record<string, number>; pitLoss: number } }): React.JSX.Element | null {
  const s = planSensitivity(plan, assumptions)
  if (!s) return null
  return (
    <>
      <h3 className="f1-h">How much the answer leans on each assumption</h3>
      <table className="f1-table">
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{`${r.delta >= 0 ? '+' : '-'}${Math.abs(r.delta).toFixed(1)} s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="f1-note">One assumption moved at a time, everything else as set above. A small number means the plan’s total does not depend much on it.</p>
    </>
  )
}

const PLANS_KEY = 'orbis.f1.plans'

/** Plans kept on this computer so a what-if can be picked up again. */
function SavedPlans({ plan, pitLoss, onLoad }: { plan: PlanStint[]; pitLoss: number; onLoad: (p: PlanStint[], pitLoss: number) => void }): React.JSX.Element {
  type Saved = { name: string; plan: PlanStint[]; pitLoss: number }
  const [raw, keep] = useKept('plans', PLANS_KEY)
  const saved = useMemo<Saved[]>(() => {
    try {
      const v = JSON.parse(raw || '[]') as unknown
      return Array.isArray(v) ? (v as Saved[]).filter((x) => x && typeof x.name === 'string' && Array.isArray(x.plan)).slice(0, 20) : []
    } catch {
      return []
    }
  }, [raw])
  const write = (next: Saved[]): void => keep(next.length ? JSON.stringify(next) : '')
  return (
    <div className="f1-controls">
      <button
        type="button"
        className="f1-btn"
        onClick={() => write([...saved, { name: plan.map((x) => `${x.compound[0]}${x.laps}`).join(' · '), plan, pitLoss }].slice(-20))}
      >
        Save this plan
      </button>
      {saved.length > 0 && (
        <label>
          Saved plans
          <select
            value=""
            onChange={(e) => {
              const i = Number(e.target.value)
              if (saved[i]) onLoad(saved[i].plan, saved[i].pitLoss)
            }}
          >
            <option value="">Open…</option>
            {saved.map((x, i) => (
              <option key={`${x.name}-${i}`} value={i}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {saved.length > 0 && (
        <button type="button" className="f1-btn" onClick={() => write([])}>
          Clear saved
        </button>
      )}
    </div>
  )
}

/** Pit-lane time by team, and stops that were far slower than the rest. */
function PitStopInsights({ t, b }: { t: F1SessionTiming; b: F1SessionBundle }): React.JSX.Element | null {
  const teamOf = (n: number): string | null => t.drivers.find((d) => d.number === n)?.team ?? null
  const teams = pitStopsByTeam(b.pit, teamOf)
  const slow = slowStops(b.pit)
  if (b.pit.length === 0) return null
  return (
    <>
      <table className="f1-table">
        <thead>
          <tr>
            <th>Team</th>
            <th className="num">Stops</th>
            <th className="num">Median pit lane</th>
            <th className="num">Best</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((x) => (
            <tr key={x.team}>
              <td>{x.team}</td>
              <td className="num">{x.stops}</td>
              <td className="num">{x.median === null ? '–' : `${x.median.toFixed(1)} s`}</td>
              <td className="num">{x.best === null ? '–' : `${x.best.toFixed(1)} s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {slow.length > 0 ? (
        <p className="f1-note f1-warn">
          Unusually slow: {slow.map((x) => `${t.drivers.find((d) => d.number === x.driverNumber)?.code ?? x.driverNumber} lap ${x.lap} (${x.laneDuration.toFixed(1)} s)`).join(', ')}. A flag is not a verdict: a drive-through, a red flag or a repair looks the same
          in this data.
        </p>
      ) : (
        <p className="f1-note">No stop stands out as unusually slow (needs eight measured stops to say).</p>
      )}
    </>
  )
}
