import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import './phase6.css'

/**
 * The Organic Explorer — the fourteen functional groups, and how an IUPAC name is built.
 *
 * ## The name is shown being assembled
 *
 * The answer is not just "butan-2-ol". The card shows the stem, the number and the suffix as separate pieces, each
 * saying which of the five rules put it there — because the rules are the thing worth learning and the word is only
 * the result of applying them. Ask for carbon 3 of a three-carbon chain and the laboratory renumbers it to 1 and
 * says that rule 3 is why, rather than silently answering a different question.
 *
 * ## A refusal is still an answer
 *
 * Choose Aromatic and there is no chain name to build, so the naming panel says so by name while the family panel
 * — the reactions, the behaviour, the test — is shown in full. The alternative would be an empty card for three of
 * the fourteen families, which would read as the laboratory being broken rather than the question being wrong.
 */

interface Group {
  id: string
  name: string
  group: string
  general: string
  suffix: string
  prefix: string | null
  example: { formula: string; name: string; everyday: string | null }
  reactions: readonly { does: string; with: string; gives: string }[]
  behaviour: string
  test: string | null
}

interface Named {
  name?: string
  formula?: string
  carbons?: number
  position?: number | null
  molarMass?: number
  parts?: readonly { piece: string; is: string; because: string }[]
  says?: string
  notes?: readonly string[]
  refused?: string
}

interface Rule {
  step: number
  rule: string
  why: string
  example: string
}

export default function OrganicLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('groups')

  const group = String(values.group ?? 'alcohol')
  const carbons = Number(values.carbons ?? 4)
  const position = Number(values.position ?? 2)
  const upTo = Number(values.upTo ?? 8)

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'organic', group, carbons, position, upTo })
  }, [engine.ready, group, carbons, position, upTo])

  const held = engine.organic.value
  const groups = (held?.groups ?? []) as readonly Group[]
  const rules = (held?.rules ?? []) as readonly Rule[]
  const named = (held?.named ?? null) as Named | null
  const series = (held?.series ?? []) as readonly Named[]
  const chosen = groups.find((one) => one.id === group) ?? null

  return (
    <LabShell
      title="Organic Explorer"
      summary={named?.says ?? chosen?.behaviour}
      refused={engine.organic.refused}
      broke={engine.organic.broke}
      busy={engine.organic.busy}
      waitingFor="Building the name…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'groups', label: 'Functional groups' },
        { id: 'name', label: 'Naming' },
        { id: 'series', label: 'Homologous series' },
        { id: 'rules', label: 'The rules' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {chosen !== null && (
            <>
              <Facts
                title={chosen.name}
                rows={[
                  ['The group', chosen.group],
                  ['General formula', chosen.general],
                  ['Name ends in', chosen.suffix],
                  ['As a prefix', chosen.prefix ?? '—'],
                  ['Example', `${chosen.example.name}, ${chosen.example.formula}`]
                ]}
                about={chosen.example.everyday === null ? undefined : `Better known as ${chosen.example.everyday}.`}
              />
              {chosen.test !== null && (
                <div className="p3-panel">
                  <h4>Telling it is there</h4>
                  <p className="p2-faint">{chosen.test}</p>
                </div>
              )}
            </>
          )}
          {named !== null && named.refused === undefined && showing === 'name' && (
            <Facts
              title="The compound"
              rows={[
                ['Name', named.name ?? ''],
                ['Formula', named.formula ?? ''],
                ['Carbons', named.carbons ?? ''],
                ['Group on carbon', named.position === null || named.position === undefined ? 'the end — no number needed' : named.position],
                ['Molar mass', named.molarMass === undefined ? '' : `${named.molarMass.toFixed(3)} g/mol`]
              ]}
            />
          )}
          <Notes title="Worth knowing" notes={named?.notes} />
        </>
      }
    >
      {showing === 'groups' && (
        <>
          <h4 className="p4-heading">The fourteen families</h4>
          <div className="p6-groups">
            {groups.map((one) => (
              <div key={one.id} className={`p6-group${one.id === group ? ' here' : ''}`}>
                <div className="p6-group-top">
                  <strong>{one.name}</strong>
                  <code>{one.group}</code>
                </div>
                <span className="p2-faint">{one.general} · ends in {one.suffix}</span>
                <p>{one.behaviour}</p>
                <ul className="p6-reactions">
                  {one.reactions.map((two) => (
                    <li key={two.does}>
                      <strong>{two.does}</strong> with {two.with} → {two.gives}
                    </li>
                  ))}
                </ul>
                <small>
                  {one.example.name}, {one.example.formula}
                  {one.example.everyday === null ? '' : ` — ${one.example.everyday}`}
                </small>
              </div>
            ))}
          </div>
        </>
      )}

      {showing === 'name' && named !== null && (
        <>
          {named.refused !== undefined ? (
            <>
              <h4 className="p4-heading">No chain name for this family</h4>
              <p className="p4-says">{named.refused}</p>
              <p className="p2-faint">
                The family itself is on the left and under Functional groups — its reactions and its test are the
                same whether or not a name can be built from a chain length.
              </p>
            </>
          ) : (
            <>
              <h4 className="p4-heading">{named.name}</h4>
              {/*
                * The pieces, in the order they are written.
                *
                * Each one carries the rule that put it there, so the card reads as a derivation rather than as a
                * lookup — which is the only reason to show the parts at all.
                */}
              <div className="p6-parts">
                {(named.parts ?? []).map((one, at) => (
                  <div key={`${one.piece}-${at}`} className="p6-part">
                    <strong>{one.piece}</strong>
                    <span>{one.is}</span>
                    <small>{one.because}</small>
                  </div>
                ))}
              </div>
              <div className="p6-equation">
                {named.name} · {named.formula} · {named.molarMass?.toFixed(3)} g/mol
              </div>
              <p className="p4-says">{named.says}</p>
            </>
          )}
        </>
      )}

      {showing === 'series' && (
        <>
          <h4 className="p4-heading">{chosen?.name ?? 'The family'}, member by member</h4>
          {series.length === 0 ? (
            <p className="p4-says">This family is not one a series is built for — its name is not made from a chain length.</p>
          ) : (
            <>
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th scope="col">Carbons</th>
                      <th scope="col">Name</th>
                      <th scope="col">Formula</th>
                      <th scope="col">Molar mass (g/mol)</th>
                      <th scope="col">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((one, at) => (
                      <tr key={one.name} className={one.carbons === carbons ? 'p6-here' : undefined}>
                        <td>{one.carbons}</td>
                        <td>{one.name}</td>
                        <td>{one.formula}</td>
                        <td>{one.molarMass?.toFixed(3)}</td>
                        <td className="p2-faint">
                          {at === 0 || one.molarMass === undefined || series[at - 1].molarMass === undefined
                            ? '—'
                            : `+${(one.molarMass - (series[at - 1].molarMass ?? 0)).toFixed(3)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p4-says">
                Every step up the series adds CH₂, which is 14.027 g/mol — so the difference column is the same number
                all the way down. That constant step is what makes it a homologous series, and it is why the members
                share their chemistry and differ steadily in boiling point.
              </p>
            </>
          )}
        </>
      )}

      {showing === 'rules' && (
        <>
          <h4 className="p4-heading">How an IUPAC name is built</h4>
          <ol className="p6-rules">
            {rules.map((one) => (
              <li key={one.step}>
                <strong>{one.rule}</strong>
                <span>{one.why}</span>
                <code>{one.example}</code>
              </li>
            ))}
          </ol>
          <p className="p4-says">
            These five are the ones this laboratory applies, in this order. Branches, rings, more than one functional
            group and anything stereochemical need further rules and are outside what it will name.
          </p>
        </>
      )}
    </LabShell>
  )
}
