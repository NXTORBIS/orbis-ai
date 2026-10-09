import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import './phase6.css'

/**
 * The Combination Engine — pick elements, see what they make.
 *
 * ## Two lists, never one
 *
 * What is in the table is real and is named. What merely balances by valence is shown separately, unnamed, and said
 * to be arithmetic. The temptation is to show one list of formulas, because it looks more impressive; the result
 * would be a tool that teaches that H₃O and SiN exist. So the two lists are rendered differently on purpose, and
 * the second one carries the engine's own sentence about not knowing.
 *
 * ## The equations are written with real molecules
 *
 * Sodium and chlorine give 2Na + Cl₂ → 2NaCl, not Na + ½Cl₂ → NaCl. The whole equation is doubled rather than a
 * molecule halved, which is what a chemist writes and what the engine does.
 */

interface Prediction {
  formula: string
  name: string | null
  bond: string | null
  molarMass: number
  source: 'known' | 'possible'
  about: string
}

interface Report {
  elements: readonly { symbol: string; name: string; category: string; usual: number | null }[]
  known: readonly Prediction[]
  possible: readonly Prediction[]
  equations: readonly string[]
  says: string
  notes: readonly string[]
}

/** What each bond type means, said once here rather than repeated per row. */
const BONDS: Readonly<Record<string, string>> = Object.freeze({
  ionic: 'electrons transferred — a lattice of ions, not molecules',
  covalent: 'electrons shared between the atoms',
  metallic: 'a sea of delocalised electrons through a lattice of cations',
  'network covalent': 'shared electrons through one continuous structure, so it has no molecules at all'
})

export default function CombinationLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('compounds')

  const elements = String(values.elements ?? 'H, O')

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'combine', elements })
  }, [engine.ready, elements])

  const held = engine.combine.value
  const report = (held?.report ?? null) as Report | null

  return (
    <LabShell
      title="Combination Engine"
      summary={report?.says}
      refused={engine.combine.refused}
      broke={engine.combine.broke}
      busy={engine.combine.busy}
      waitingFor="Looking the combination up…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'compounds', label: 'Compounds' },
        { id: 'equations', label: 'Making them' },
        { id: 'elements', label: 'The elements' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {report !== null && (
            <Facts
              title="What was asked"
              rows={[
                ['Elements', report.elements.map((one) => one.symbol).join(' + ')],
                ['Named compounds', report.known.length],
                ['Balance by valence only', report.possible.length],
                ['Equations written', report.equations.length]
              ]}
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {showing === 'compounds' && report !== null && (
        <>
          <h4 className="p4-heading">Compounds of {report.elements.map((one) => one.symbol).join(' and ')}</h4>
          {report.known.length === 0 ? (
            <p className="p4-says">{report.says}</p>
          ) : (
            <div className="p6-compounds">
              {report.known.map((one) => (
                <div key={one.formula} className="p6-compound">
                  <div className="p6-compound-top">
                    <strong>{one.formula}</strong>
                    <span className="p6-tag">{one.bond}</span>
                  </div>
                  <span>{one.name}</span>
                  <small className="p2-faint">{one.molarMass.toFixed(3)} g/mol</small>
                  <p>{one.about}</p>
                  {one.bond !== null && BONDS[one.bond] !== undefined && <small>{BONDS[one.bond]}</small>}
                </div>
              ))}
            </div>
          )}

          {report.possible.length > 0 && (
            <>
              <h4 className="p4-heading">Balances by valence — not claimed to exist</h4>
              {/*
                * Deliberately a different shape from the list above.
                *
                * These are dashed and unnamed because the one thing that must never happen here is a person reading
                * an arithmetic possibility as a compound somebody has made.
                */}
              <div className="p6-compounds">
                {report.possible.map((one) => (
                  <div key={one.formula} className="p6-compound maybe">
                    <div className="p6-compound-top">
                      <strong>{one.formula}</strong>
                      <span className="p6-tag">unverified</span>
                    </div>
                    <small className="p2-faint">{one.molarMass.toFixed(3)} g/mol by this formula</small>
                    <p>{one.about}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {showing === 'equations' && report !== null && (
        <>
          <h4 className="p4-heading">Making each one from the elements</h4>
          {report.equations.length === 0 ? (
            <p className="p4-says">There is no named compound of these elements in the table, so there is nothing to write an equation for.</p>
          ) : (
            report.equations.map((one) => (
              <div key={one} className="p6-equation">
                {one}
              </div>
            ))
          )}
          <p className="p4-says">
            Hydrogen, nitrogen, oxygen, fluorine, chlorine, bromine and iodine come as pairs of atoms, so they are
            written X₂. When that makes a coefficient come out as a half, the whole equation is doubled instead —
            which is why sodium and chlorine is written 2Na + Cl₂ → 2NaCl.
          </p>
        </>
      )}

      {showing === 'elements' && report !== null && (
        <>
          <h4 className="p4-heading">What was combined</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Usually bonds</th>
                </tr>
              </thead>
              <tbody>
                {report.elements.map((one) => (
                  <tr key={one.symbol}>
                    <td>
                      <strong>{one.symbol}</strong>
                    </td>
                    <td>{one.name}</td>
                    <td className="p2-faint">{one.category}</td>
                    <td>{one.usual === null ? 'no usual number' : `${one.usual} time${one.usual === 1 ? '' : 's'}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p4-says">
            "Usually bonds" is the largest oxidation state the element is tabulated with, and it is what the
            valence arithmetic above uses. It is a guide and not a rule: phosphorus manages five bonds and sulphur
            six, which is exactly why the octet rule is taught as a pattern rather than a law.
          </p>
        </>
      )}
    </LabShell>
  )
}
