import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import './phase6.css'

/**
 * The Chemistry Calculator — seven calculations behind one set of controls.
 *
 * ## Why the seven are one laboratory rather than seven
 *
 * They are the same arithmetic asked seven ways: a formula gives a molar mass, a molar mass and a mass give moles,
 * moles and a volume give a concentration, a concentration gives a pH. Splitting them up would mean typing the same
 * formula four times and would hide the fact that each answer is the next one's input.
 *
 * ## Every answer carries its units and its caveat
 *
 * A pH is quoted with the hydrogen and hydroxide concentrations it came from, a gas volume with the pressure and
 * temperature it was computed at, a composition by mass with a reminder that by mass is not by count. Those are the
 * places a chemistry answer is most often misread, so they travel with the number rather than sitting in help.
 */

interface MassReport {
  formula: string
  molarMass: number
  composition: readonly { symbol: string; name: string; count: number; massContribution: number; massPercent: number }[]
  notes?: readonly string[]
}

interface CompositionReport {
  formula: string
  molarMass: number
  parts: readonly { symbol: string; name: string; count: number; mass: number; percent: number }[]
  says: string
  notes: readonly string[]
}

interface Said {
  says?: string
  notes?: readonly string[]
}

const WHAT = [
  { id: 'molar-mass', label: 'Molar mass' },
  { id: 'composition', label: '% composition' },
  { id: 'moles', label: 'Moles' },
  { id: 'molarity', label: 'Molarity' },
  { id: 'ph', label: 'pH' },
  { id: 'gas', label: 'Gas law' },
  { id: 'dilution', label: 'Dilution' }
] as const

export default function ChemCalculatorLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('molar-mass')

  const formula = String(values.formula ?? 'H2SO4')
  const grams = Number(values.grams ?? 10)
  const moles = Number(values.moles ?? 0.5)
  const litres = Number(values.litres ?? 2)
  const concentration = Number(values.concentration ?? 0.1)
  const acidKind = String(values.acidKind ?? 'strong-acid') as 'strong-acid' | 'weak-acid' | 'strong-base' | 'weak-base'
  const k = Number(values.k ?? 0.000018)
  const pressure = Number(values.pressure ?? 101325)
  const volume = Number(values.volume ?? 0.0224)
  const temperature = Number(values.temperature ?? 273.15)
  const c1 = Number(values.c1 ?? 1)
  const v1 = Number(values.v1 ?? 0.1)
  const c2 = Number(values.c2 ?? 0.25)

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({
      kind: 'calculator',
      what: showing as never,
      formula,
      grams,
      moles,
      litres,
      concentration,
      acidKind,
      k,
      pressure,
      volume,
      temperature,
      c1,
      v1,
      c2
    })
  }, [engine.ready, showing, formula, grams, moles, litres, concentration, acidKind, k, pressure, volume, temperature, c1, v1, c2])

  const held = engine.calculator.value
  const report = (held?.report ?? null) as (Said & Partial<MassReport> & Partial<CompositionReport> & Record<string, unknown>) | null

  const summary =
    report === null
      ? undefined
      : typeof report.says === 'string'
        ? report.says
        : typeof report.molarMass === 'number'
          ? `${String(report.formula)} weighs ${report.molarMass.toFixed(3)} g/mol`
          : undefined

  return (
    <LabShell
      title="Chemistry Calculator"
      summary={summary}
      refused={engine.calculator.refused}
      broke={engine.calculator.broke}
      busy={engine.calculator.busy}
      waitingFor="Working it out…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={WHAT.map((one) => ({ id: one.id, label: one.label }))}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {showing === 'ph' && report !== null && typeof report.ph === 'number' && (
            <Facts
              title="The solution"
              rows={[
                ['pH', (report.ph as number).toFixed(3)],
                ['pOH', (report.poh as number).toFixed(3)],
                ['[H⁺]', `${(report.hydrogen as number).toExponential(3)} mol/L`],
                ['[OH⁻]', `${(report.hydroxide as number).toExponential(3)} mol/L`],
                ['It is', String(report.kind)]
              ]}
            />
          )}
          {showing === 'gas' && report !== null && typeof report.moles === 'number' && (
            <Facts
              title="The gas"
              rows={[
                ['Amount', `${(report.moles as number).toPrecision(5)} mol`],
                ['Volume', `${((report.volume as number) * 1000).toPrecision(5)} L`],
                ['Pressure', `${((report.pressure as number) / 101325).toPrecision(5)} atm`],
                ['Temperature', `${(report.temperature as number).toPrecision(5)} K`]
              ]}
            />
          )}
          {showing === 'dilution' && report !== null && typeof report.added === 'number' && (
            <Facts
              title="The dilution"
              rows={[
                ['From', `${(report.c1 as number).toPrecision(4)} mol/L`],
                ['To', `${(report.c2 as number).toPrecision(4)} mol/L`],
                ['Starting volume', `${(report.v1 as number).toPrecision(4)} L`],
                ['Final volume', `${(report.v2 as number).toPrecision(4)} L`],
                ['Solvent to add', `${(report.added as number).toPrecision(4)} L`]
              ]}
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {(showing === 'molar-mass' || showing === 'composition') && report !== null && typeof report.molarMass === 'number' && (
        <>
          <h4 className="p4-heading">{String(report.formula)}</h4>
          <div className="p4-row">
            <div className="p4-box found">
              <span className="p4-box-value">{(report.molarMass as number).toFixed(3)}</span>
              <small>g/mol</small>
            </div>
          </div>

          <h4 className="p4-heading">What it is made of</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Element</th>
                  <th scope="col">How many</th>
                  <th scope="col">Mass</th>
                  <th scope="col">Share by mass</th>
                </tr>
              </thead>
              <tbody>
                {(showing === 'composition'
                  ? ((report.parts ?? []) as CompositionReport['parts']).map((one) => ({
                      name: one.name,
                      symbol: one.symbol,
                      count: one.count,
                      mass: one.mass,
                      percent: one.percent
                    }))
                  : ((report.composition ?? []) as MassReport['composition']).map((one) => ({
                      name: one.name,
                      symbol: one.symbol,
                      count: one.count,
                      mass: one.massContribution,
                      percent: one.massPercent
                    }))
                ).map((one) => (
                  <tr key={one.symbol}>
                    <th scope="row">
                      {one.symbol} <span className="p2-faint">{one.name}</span>
                    </th>
                    <td>{one.count}</td>
                    <td>{one.mass.toFixed(3)} g</td>
                    <td>
                      <span className="p6-bar" style={{ width: `${Math.max(2, one.percent)}%` }} aria-hidden="true" />
                      {one.percent.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showing === 'moles' && report !== null && (
        <>
          <h4 className="p4-heading">Mass and amount</h4>
          <p className="p4-says">{String(report.says ?? '')}</p>
        </>
      )}

      {showing === 'molarity' && report !== null && typeof report.molarity === 'number' && (
        <>
          <h4 className="p4-heading">Concentration</h4>
          <div className="p4-row">
            <div className="p4-box found">
              <span className="p4-box-value">{(report.molarity as number).toPrecision(4)}</span>
              <small>mol/L</small>
            </div>
            <div className="p4-box">
              <span className="p4-box-value">{(report.moles as number).toPrecision(4)}</span>
              <small>mol</small>
            </div>
            <div className="p4-box">
              <span className="p4-box-value">{(report.litres as number).toPrecision(4)}</span>
              <small>L</small>
            </div>
          </div>
        </>
      )}

      {showing === 'ph' && report !== null && typeof report.ph === 'number' && (
        <>
          <h4 className="p4-heading">Where it sits on the scale</h4>
          {/* The scale drawn, because a pH is a position on it and a bare number is not. */}
          <div className="p6-scale" role="img" aria-label={`pH ${(report.ph as number).toFixed(2)}`}>
            <div className="p6-scale-bar" />
            <div className="p6-scale-mark" style={{ left: `${Math.max(0, Math.min(100, ((report.ph as number) / 14) * 100))}%` }}>
              <span>{(report.ph as number).toFixed(2)}</span>
            </div>
            <div className="p6-scale-ticks">
              {[0, 2, 4, 6, 7, 8, 10, 12, 14].map((one) => (
                <span key={one} style={{ left: `${(one / 14) * 100}%` }}>
                  {one}
                </span>
              ))}
            </div>
          </div>
          <p className="p4-says">{String(report.says ?? '')}</p>
        </>
      )}

      {showing === 'gas' && report !== null && typeof report.moles === 'number' && (
        <>
          <h4 className="p4-heading">PV = nRT</h4>
          <p className="p4-says">{String(report.says ?? '')}</p>
        </>
      )}

      {showing === 'dilution' && report !== null && typeof report.added === 'number' && (
        <>
          <h4 className="p4-heading">C₁V₁ = C₂V₂</h4>
          <p className="p4-says">{String(report.says ?? '')}</p>
        </>
      )}
    </LabShell>
  )
}
