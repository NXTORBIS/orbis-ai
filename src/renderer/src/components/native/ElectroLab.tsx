import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import { Diagram } from './Draw'
import './phase6.css'

/**
 * The Electrochemistry Laboratory — galvanic cells, the Nernst equation, and electrolysis.
 *
 * ## The cell is drawn as a cell
 *
 * Two electrodes, a salt bridge between them, and the direction the electrons actually go. Which electrode is the
 * cathode is not a label somebody types: it is whichever half-reaction has the higher reduction potential, and the
 * drawing follows that. Swap the two and the arrow turns round, which is the fact the diagram exists to carry.
 *
 * ## Standard conditions are stated, not assumed
 *
 * E° is at 1 mol/L, 1 atm and 25°C. The Nernst tab is where those stop being true, and the laboratory shows the
 * standard value and the corrected one together so the size of the correction is visible — usually small, which is
 * itself worth seeing, and occasionally the difference between a cell that works and one that does not.
 */

interface Said {
  says?: string
  notes?: readonly string[]
}

const TABS = [
  { id: 'cell', label: 'Galvanic cell' },
  { id: 'nernst', label: 'Nernst' },
  { id: 'electrolysis', label: 'Electrolysis' }
] as const

export default function ElectroLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('cell')

  const cathode = String(values.cathode ?? 'cu')
  const anode = String(values.anode ?? 'zn')
  const electrons = Number(values.electrons ?? 2)
  const reactionQuotient = Number(values.reactionQuotient ?? 1)
  const temperature = Number(values.temperature ?? 298.15)
  const current = Number(values.current ?? 2)
  const seconds = Number(values.seconds ?? 3600)
  const molarMass = Number(values.molarMass ?? 63.546)

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'electro', what: showing as never, cathode, anode, electrons, reactionQuotient, temperature, current, seconds, molarMass })
  }, [engine.ready, showing, cathode, anode, electrons, reactionQuotient, temperature, current, seconds, molarMass])

  const held = engine.electro.value
  const report = (held?.report ?? null) as (Said & Record<string, unknown>) | null
  const cathodeCell = (report?.cathode ?? null) as { label: string; potential: number } | null
  const anodeCell = (report?.anode ?? null) as { label: string; potential: number } | null
  const standard = typeof report?.standardPotential === 'number' ? (report.standardPotential as number) : null
  const actual = typeof report?.potential === 'number' ? (report.potential as number) : standard

  return (
    <LabShell
      title="Electrochemistry"
      summary={report?.says}
      refused={engine.electro.refused}
      broke={engine.electro.broke}
      busy={engine.electro.busy}
      waitingFor="Working the cell out…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={TABS.map((one) => ({ id: one.id, label: one.label }))}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {showing !== 'electrolysis' && report !== null && (
            <Facts
              title="The cell"
              rows={[
                ['Cathode', cathodeCell ? `${cathodeCell.label} (${cathodeCell.potential} V)` : ''],
                ['Anode', anodeCell ? `${anodeCell.label} (${anodeCell.potential} V)` : ''],
                ['E° cell', standard === null ? '' : `${standard.toFixed(3)} V`],
                ['E cell', actual === null || showing === 'cell' ? '' : `${actual.toFixed(3)} V`],
                ['Electrons', electrons],
                ['ΔG°', typeof report.gibbs === 'number' ? `${(report.gibbs as number).toFixed(2)} kJ/mol` : ''],
                ['Spontaneous', actual === null ? '' : actual > 0 ? 'yes — it runs on its own' : 'no — it would need driving']
              ]}
            />
          )}
          {showing === 'electrolysis' && report !== null && (
            <Facts
              title="What is deposited"
              rows={[
                ['Charge passed', typeof report.charge === 'number' ? `${(report.charge as number).toPrecision(5)} C` : ''],
                ['Moles of electrons', typeof report.molesOfElectrons === 'number' ? (report.molesOfElectrons as number).toPrecision(5) : ''],
                ['Product', typeof report.moles === 'number' ? `${(report.moles as number).toPrecision(5)} mol` : ''],
                ['Mass', typeof report.mass === 'number' ? `${(report.mass as number).toPrecision(5)} g` : '']
              ]}
              about="Faraday's law: the amount deposited is the charge divided by the electrons per ion, times the Faraday constant. Nothing about the metal enters except its molar mass and its charge."
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {showing !== 'electrolysis' && cathodeCell !== null && anodeCell !== null && (
        <>
          <h4 className="p4-heading">The cell, drawn</h4>
          {/*
            * Which side is which is decided by the potentials, not by the names of the controls.
            *
            * Electrons leave the anode and arrive at the cathode, always — so the arrow is drawn from whichever
            * half-cell is being oxidised. Choose two electrodes the wrong way round and the voltage goes negative
            * and the picture says so rather than quietly drawing the cell somebody meant.
            */}
          <Diagram
            height={170}
            nodes={[
              { id: 'anode', label: 'anode', note: `${anodeCell.potential} V`, depth: 0, group: 1 },
              { id: 'bridge', label: 'salt bridge', depth: 1, group: 5 },
              { id: 'cathode', label: 'cathode', note: `${cathodeCell.potential} V`, depth: 2, group: 0 }
            ]}
            edges={[
              { from: 'anode', to: 'bridge', label: 'ions', faint: true },
              { from: 'bridge', to: 'cathode', label: 'ions', faint: true },
              { from: 'anode', to: 'cathode', label: 'electrons', marked: (actual ?? 0) > 0 }
            ]}
            about={
              (actual ?? 0) > 0
                ? `${anodeCell.label} is oxidised and ${cathodeCell.label} is reduced. Electrons go the way the arrow points, through the wire.`
                : 'This way round the voltage is negative, which means the cell as drawn would not run — swap the electrodes.'
            }
          />
          <div className="p4-row">
            <div className={`p4-box${(actual ?? 0) > 0 ? ' found' : ''}`}>
              <span className="p4-box-value">{(actual ?? 0).toFixed(3)}</span>
              <small>volts</small>
            </div>
            {standard !== null && showing === 'nernst' && (
              <div className="p4-box">
                <span className="p4-box-value">{standard.toFixed(3)}</span>
                <small>volts at standard conditions</small>
              </div>
            )}
          </div>
          <p className="p4-says">
            {showing === 'nernst'
              ? 'The Nernst correction is (RT/nF)·ln Q. At room temperature that is about 0.0257/n volts per unit of ln Q, which is why a tenfold concentration change moves a two-electron cell by only about 30 mV.'
              : 'E°cell is the cathode potential minus the anode potential, both read as reductions from the table. Nothing is reversed by hand — reversing the anode is what the subtraction already does.'}
          </p>
        </>
      )}

      {showing === 'electrolysis' && report !== null && (
        <>
          <h4 className="p4-heading">Faraday's law</h4>
          <p className="p4-says">{String(report.says ?? '')}</p>
          <div className="p4-row">
            <div className="p4-box found">
              <span className="p4-box-value">{typeof report.mass === 'number' ? (report.mass as number).toPrecision(4) : '—'}</span>
              <small>grams deposited</small>
            </div>
            <div className="p4-box">
              <span className="p4-box-value">{current}</span>
              <small>amps</small>
            </div>
            <div className="p4-box">
              <span className="p4-box-value">{(seconds / 60).toPrecision(4)}</span>
              <small>minutes</small>
            </div>
          </div>
        </>
      )}
    </LabShell>
  )
}
