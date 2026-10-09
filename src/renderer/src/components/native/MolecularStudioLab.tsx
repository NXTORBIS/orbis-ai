import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import './phase6.css'

/**
 * The Molecular Studio — a formula taken apart.
 *
 * ## The bars are the answer, not decoration
 *
 * Water is two hydrogens and one oxygen, and it is 88.8% oxygen by mass. Those two sentences are the same molecule
 * and they feel like different ones, which is the single most useful thing a composition view can show. So the bar
 * is drawn to the mass percentage while the count sits beside it, and the gap between them is the point.
 *
 * ## The gallery is weighed by the same parser
 *
 * Every row in the gallery had its formula parsed by the parser that answers the typed formula, so a gallery row
 * and a typed formula can never disagree. A row whose formula would not parse is left out rather than shown with a
 * blank weight.
 */

interface Part {
  symbol: string
  name: string
  count: number
  mass?: number
  percent?: number
  massContribution?: number
  massPercent?: number
}

interface Report {
  formula: string
  composition: readonly Part[]
  molarMass: number
  molarMassUncertainty: number
  totalAtoms: number
  empiricalFormula: string
  isEmpirical: boolean
  charge: number
  notes: readonly string[]
  warnings: readonly string[]
}

interface GalleryRow {
  formula: string
  name: string
  molarMass: number
  atoms: number
  bond: string
}

/** The two shapes the composition can arrive in, read into one. The percent engine renames its fields. */
const share = (one: Part): { mass: number; percent: number } => ({
  mass: one.mass ?? one.massContribution ?? 0,
  percent: one.percent ?? one.massPercent ?? 0
})

export default function MolecularStudioLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('breakdown')

  const formula = String(values.formula ?? 'H2O')

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'molecular', formula })
  }, [engine.ready, formula])

  const held = engine.molecular.value
  const report = (held?.report ?? null) as Report | null
  const gallery = (held?.gallery ?? []) as readonly GalleryRow[]
  const heaviest = report === null ? null : [...report.composition].sort((a, b) => share(b).percent - share(a).percent)[0] ?? null

  return (
    <LabShell
      title="Molecular Studio"
      summary={
        report === null
          ? undefined
          : `${report.formula} weighs ${report.molarMass.toFixed(3)} g/mol, has ${report.totalAtoms} atom${report.totalAtoms === 1 ? '' : 's'} in a formula unit${heaviest === null ? '' : `, and is ${share(heaviest).percent.toFixed(2)}% ${heaviest.name.toLowerCase()} by mass`}.`
      }
      refused={engine.molecular.refused}
      broke={engine.molecular.broke}
      busy={engine.molecular.busy}
      waitingFor="Taking the formula apart…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'breakdown', label: 'Breakdown' },
        { id: 'composition', label: 'By mass' },
        { id: 'gallery', label: 'Gallery' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {report !== null && (
            <Facts
              title={report.formula}
              rows={[
                ['Molar mass', `${report.molarMass.toFixed(4)} ± ${report.molarMassUncertainty.toFixed(4)} g/mol`],
                ['Atoms per unit', report.totalAtoms],
                ['Different elements', report.composition.length],
                ['Simplest ratio', report.isEmpirical ? `${report.empiricalFormula} — already simplest` : report.empiricalFormula],
                ['Charge', report.charge === 0 ? 'neutral' : report.charge > 0 ? `+${report.charge}` : String(report.charge)]
              ]}
              about="The uncertainty is the one carried by the atomic weights themselves, which depend on the isotope mix of the sample."
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
          <Notes title="Careful" notes={report?.warnings} />
        </>
      }
    >
      {showing === 'breakdown' && report !== null && (
        <>
          <div className="p6-equation">
            {report.formula} = {report.molarMass.toFixed(3)} g/mol
          </div>
          <h4 className="p4-heading">Element by element</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Element</th>
                  <th scope="col">Atoms</th>
                  <th scope="col">Mass each</th>
                  <th scope="col">Mass contributed</th>
                </tr>
              </thead>
              <tbody>
                {report.composition.map((one) => {
                  const of = share(one)
                  return (
                    <tr key={one.symbol}>
                      <td>
                        <strong>{one.symbol}</strong> <span className="p2-faint">{one.name}</span>
                      </td>
                      <td>{one.count}</td>
                      <td className="p2-faint">{(of.mass / Math.max(1, one.count)).toFixed(4)}</td>
                      <td>{of.mass.toFixed(4)} g/mol</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="p4-says">
            {report.isEmpirical
              ? `${report.formula} is already in its simplest whole-number ratio, so the empirical and molecular formulas are the same.`
              : `The simplest ratio is ${report.empiricalFormula}. An analysis that measures composition alone can only ever give that — the molecular formula needs a molar mass as well, which is why both are reported here.`}
          </p>
        </>
      )}

      {showing === 'composition' && report !== null && (
        <>
          <h4 className="p4-heading">Share of the mass</h4>
          {/*
            * Bar width is the mass percentage, drawn against a fixed 180px, with the atom count next to it.
            *
            * Water is two thirds hydrogen by atom count and a ninth of it by mass, and seeing both numbers on one
            * row is the whole reason this view exists.
            */}
          <div className="p6-shares">
            {report.composition.map((one) => {
              const of = share(one)
              return (
                <div key={one.symbol} className="p6-share">
                  <span className="p6-share-name">
                    <strong>{one.symbol}</strong> {one.name}
                  </span>
                  <span className="p6-bar" style={{ width: `${Math.max(2, (of.percent / 100) * 180)}px` }} aria-hidden="true" />
                  <span className="p6-share-value">{of.percent.toFixed(2)}%</span>
                  <small className="p2-faint">
                    {one.count} atom{one.count === 1 ? '' : 's'} ·{' '}
                    {((one.count / Math.max(1, report.totalAtoms)) * 100).toFixed(1)}% of the atoms
                  </small>
                </div>
              )
            })}
          </div>
          {heaviest !== null && (
            <p className="p4-says">
              {heaviest.name} carries most of the weight here — {share(heaviest).percent.toFixed(2)}% of it, from{' '}
              {heaviest.count} of the {report.totalAtoms} atoms. Mass share and atom share are different questions,
              and the two columns above are why they rarely give the same answer.
            </p>
          )}
        </>
      )}

      {showing === 'gallery' && (
        <>
          <h4 className="p4-heading">{gallery.length} compounds, already weighed</h4>
          <div className="p6-gallery">
            {gallery.map((one) => (
              <div key={one.formula} className={`p6-tile${one.formula === formula ? ' here' : ''}`}>
                <strong>{one.formula}</strong>
                <span>{one.name}</span>
                <small className="p2-faint">
                  {one.molarMass.toFixed(2)} g/mol · {one.atoms} atoms
                </small>
                <span className="p6-tag">{one.bond}</span>
              </div>
            ))}
          </div>
          <p className="p4-says">
            Every weight here was worked out by the same parser that answers the formula you type, so nothing in this
            gallery can disagree with the breakdown above. Type any of these formulas into the controls to take it
            apart.
          </p>
        </>
      )}
    </LabShell>
  )
}
