import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import Plot from './Plot'
import './phase6.css'

/**
 * The Reaction Laboratory — balancing, energy, equilibrium, rate and Arrhenius.
 *
 * ## Five tabs that are one argument
 *
 * Balance the equation, find out whether it releases energy, find out how far it goes, find out how fast, and find
 * out how the speed changes with temperature. That is the order a reaction is actually asked about, and each tab
 * takes what the one before it established.
 *
 * ## The energy tab plots ΔG against temperature, not a single number
 *
 * ΔG = ΔH − TΔS is a straight line, and where it crosses zero is the temperature at which a reaction stops being
 * spontaneous. A single value at 298 K hides the crossing entirely — and the crossing is the reason ice melts and
 * ammonia is made hot. The line is drawn from the ΔH and ΔS the engine just reported, so the chart and the figure
 * under it cannot disagree.
 */

interface Said {
  says?: string
  notes?: readonly string[]
}

const TABS = [
  { id: 'balance', label: 'Balance it' },
  { id: 'energy', label: 'Energy' },
  { id: 'equilibrium', label: 'How far' },
  { id: 'rate', label: 'How fast' },
  { id: 'arrhenius', label: 'With temperature' }
] as const

export default function ReactionsLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('balance')

  const equation = String(values.equation ?? 'H2 + O2 -> H2O')
  const reactants = String(values.reactants ?? 'H2, 0, 130.7\nO2, 0, 205.2')
  const products = String(values.products ?? 'H2O, -285.8, 69.9')
  const temperature = Number(values.temperature ?? 298.15)
  const constant = Number(values.constant ?? 4)
  const order = Number(values.order ?? 1)
  const rateConstant = Number(values.rateConstant ?? 0.1)
  const initialConcentration = Number(values.initialConcentration ?? 1)
  const duration = Number(values.duration ?? 50)
  const activationEnergy = Number(values.activationEnergy ?? 50)
  const preExponential = Number(values.preExponential ?? 1e10)

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({
      kind: 'reaction',
      what: showing as never,
      equation,
      reactants,
      products,
      temperature,
      constant,
      order,
      rateConstant,
      initialConcentration,
      duration,
      activationEnergy,
      preExponential
    })
  }, [engine.ready, showing, equation, reactants, products, temperature, constant, order, rateConstant, initialConcentration, duration, activationEnergy, preExponential])

  const held = engine.reaction.value
  const report = (held?.report ?? null) as (Said & Record<string, unknown>) | null
  const series = (held?.series ?? []) as readonly { x: number; y: number }[]

  const crossover =
    report !== null && typeof report.enthalpy === 'number' && typeof report.entropy === 'number' && report.entropy !== 0
      ? ((report.enthalpy as number) * 1000) / (report.entropy as number)
      : null

  return (
    <LabShell
      title="Reaction Laboratory"
      summary={report?.says}
      refused={engine.reaction.refused}
      broke={engine.reaction.broke}
      busy={engine.reaction.busy}
      waitingFor="Working the reaction out…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={TABS.map((one) => ({ id: one.id, label: one.label }))}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {showing === 'energy' && report !== null && typeof report.enthalpy === 'number' && (
            <Facts
              title="At this temperature"
              rows={[
                ['ΔH', `${(report.enthalpy as number).toFixed(2)} kJ/mol`],
                ['ΔS', typeof report.entropy === 'number' ? `${(report.entropy as number).toFixed(2)} J/(mol·K)` : ''],
                ['ΔG', typeof report.gibbs === 'number' ? `${(report.gibbs as number).toFixed(2)} kJ/mol` : ''],
                ['Spontaneous', typeof report.gibbs === 'number' ? ((report.gibbs as number) < 0 ? 'yes, ΔG < 0' : 'no, ΔG > 0') : ''],
                ['ΔG = 0 at', crossover === null ? 'never — the sign never changes' : `${crossover.toFixed(1)} K`]
              ]}
              about={
                crossover !== null && crossover > 0
                  ? 'Above that temperature the entropy term wins and the sign flips. That crossing is why a reaction can be spontaneous hot and not cold.'
                  : undefined
              }
            />
          )}
          {showing === 'rate' && report !== null && (
            <Facts
              title="The rate law"
              rows={[
                ['Order', order],
                ['Rate law', order === 0 ? 'rate = k' : order === 1 ? 'rate = k[A]' : 'rate = k[A]²'],
                ['Units of k', order === 0 ? 'mol/(L·s)' : order === 1 ? '1/s' : 'L/(mol·s)'],
                ['Half-life', typeof report.halfLife === 'number' ? `${(report.halfLife as number).toPrecision(4)} s` : '']
              ]}
              about={
                order === 1
                  ? 'Only a first-order half-life is independent of the starting concentration, which is why radioactive decay has one number and a second-order reaction does not.'
                  : undefined
              }
            />
          )}
          {showing === 'arrhenius' && report !== null && (
            <Facts
              title="Arrhenius"
              rows={[
                ['Activation energy', `${activationEnergy} kJ/mol`],
                ['Pre-exponential', preExponential.toExponential(2)],
                ['k at this T', typeof report.rateConstant === 'number' ? (report.rateConstant as number).toExponential(3) : '']
              ]}
              about="The plot is ln k against 1000/T. A straight line is the test that a reaction obeys Arrhenius at all, and its slope is −Ea/R."
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {showing === 'balance' && report !== null && (
        <>
          <h4 className="p4-heading">Balanced</h4>
          <p className="p6-equation">{String(report.balanced ?? report.says ?? '')}</p>
          {Array.isArray(report.coefficients) && (
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th scope="col">Species</th>
                    <th scope="col">Coefficient</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.coefficients as readonly { formula: string; coefficient: number }[]).map((one) => (
                    <tr key={one.formula}>
                      <th scope="row">{one.formula}</th>
                      <td>{one.coefficient}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="p4-says">
            Balancing is conservation of atoms, solved as simultaneous equations — not guessed at. Every element on
            the left appears the same number of times on the right, or the equation is refused.
          </p>
        </>
      )}

      {showing === 'energy' && series.length > 0 && (
        <>
          <h4 className="p4-heading">ΔG against temperature</h4>
          <Plot
            series={[{ id: 'gibbs', label: 'ΔG', points: series }]}
            xLabel="temperature (K)"
            yLabel="ΔG (kJ/mol)"
            zero={0}
            height={200}
            markers={crossover !== null && crossover > 200 && crossover < 800 ? [{ x: crossover, label: 'ΔG = 0' }] : []}
            about="Below the line the reaction goes on its own; above it, it does not. The crossing is ΔH/ΔS."
          />
        </>
      )}

      {showing === 'equilibrium' && report !== null && (
        <>
          <h4 className="p4-heading">At equilibrium</h4>
          <p className="p4-says">{String(report.says ?? '')}</p>
          {Array.isArray(report.species) && (
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th scope="col">Species</th>
                    <th scope="col">Started at</th>
                    <th scope="col">Ended at</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.species as readonly { formula: string; initial: number; final: number }[]).map((one) => (
                    <tr key={one.formula}>
                      <th scope="row">{one.formula}</th>
                      <td>{one.initial.toPrecision(4)}</td>
                      <td>{one.final.toPrecision(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showing === 'rate' && series.length > 0 && (
        <>
          <h4 className="p4-heading">How the concentration falls</h4>
          <Plot
            series={[{ id: 'a', label: '[A]', points: series }]}
            xLabel="time (s)"
            yLabel="[A] (mol/L)"
            height={200}
            about={
              order === 0
                ? 'Zero order is a straight line: the rate does not depend on how much is left, so it falls at a constant speed and then stops dead.'
                : order === 1
                  ? 'First order is an exponential: every half-life removes half of whatever is left, however much that is.'
                  : 'Second order falls fast at first and then crawls, because the rate depends on the square of what is left.'
            }
          />
        </>
      )}

      {showing === 'arrhenius' && series.length > 0 && (
        <>
          <h4 className="p4-heading">The Arrhenius plot</h4>
          <Plot
            series={[{ id: 'lnk', label: 'ln k', points: series }]}
            xLabel="1000 / T (1/K)"
            yLabel="ln k"
            height={200}
            about="A straight line, and that is the test. Its slope is −Ea/R, so the steeper it is the more the reaction cares about temperature."
          />
        </>
      )}
    </LabShell>
  )
}
