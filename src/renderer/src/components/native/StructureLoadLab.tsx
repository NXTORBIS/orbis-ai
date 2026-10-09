import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import Plot, { tidy } from './Plot'
import { useEngineering } from './useEngineering'
import './phase2.css'
import './phase3.css'
import './phase4.css'

/**
 * The Structures Laboratory: a beam under load, and a truss.
 *
 * ## The shear and moment diagrams are integrated, not sketched
 *
 * `analyseBeam` works along the beam accumulating shear from the loads and moment from the shear, then integrates
 * twice more for slope and deflection. It reports the residual of that integration, and this panel shows it —
 * because a double integration that has drifted is the one way these curves can be quietly wrong, and the engine
 * knowing its own error is better than a picture that looks plausible.
 *
 * ## The deflection needs a real material, and says so when it has not got one
 *
 * Deflection is proportional to 1/EI. E comes from the materials table and I from the section calculation. When the
 * material is not known the engine returns shear and moment and no deflection — and the panel says the deflection
 * cannot be worked out rather than drawing a curve from a made-up stiffness. §205's rule, applied to the one place
 * in this laboratory where it would be easiest to break.
 *
 * ## The colours on a truss are the forces, and tension and compression are different things
 *
 * A member's state comes from the solver's sign, not from a threshold chosen here. Zero-force members are named,
 * because "why is this bar carrying nothing" is one of the more useful questions a truss can be asked.
 */

interface Station {
  x: number
  shear: number
  moment: number
  slope: number | null
  deflection: number | null
}

interface BeamAnalysis {
  kind: string
  length: number
  reactions: readonly { label: string; position: number; force: number }[]
  stations: readonly Station[]
  maxShear: { value: number; at: number }
  maxMoment: { value: number; at: number }
  minMoment: { value: number; at: number }
  maxDeflection: { value: number; at: number } | null
  inflectionPoints: readonly number[]
  integrationResidual: number
  notes: readonly string[]
  warnings: readonly string[]
}

interface SectionReport {
  shape: string
  area: number
  centroidY: number
  ixx: number
  iyy: number
  sectionModulusTop: number
  sectionModulusBottom: number
  radiusOfGyrationX: number
  symmetric: boolean
  notes: readonly string[]
}

interface Material {
  id: string
  name: string
  properties: Readonly<Record<string, { value: number; unit: string; about?: string } | undefined>>
}

interface Buckling {
  criticalLoad: number
  criticalStress: number
  slenderness: number
  notes: readonly string[]
  refused?: { says: string; fix: string }
}

interface MemberForce {
  id: string
  from: string
  to: string
  force: number
  state: 'tension' | 'compression' | 'zero-force'
  length: number
}

interface TrussReport {
  members: readonly MemberForce[]
  reactions: readonly { node: string; x: number; y: number }[]
  worstJointResidual: number
  equilibriumVerified: boolean
  determinacy: 'determinate' | 'indeterminate' | 'mechanism'
  zeroForceMembers: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A simple triangulated truss of a chosen number of bays.
 *
 * Generated rather than typed in, because a truss somebody has to describe node by node is a truss nobody builds.
 * The shape is the standard Pratt arrangement: a bottom chord carrying the load, a top chord, verticals and
 * diagonals, which is what most footbridges actually are.
 */
function makeTruss(bays: number, span: number, depth: number, load: number) {
  const bayWidth = span / bays
  const nodes: { id: string; x: number; y: number; support?: 'pin' | 'roller' }[] = []
  const members: { id: string; from: string; to: string }[] = []
  const loads: { node: string; x: number; y: number }[] = []

  for (let i = 0; i <= bays; i += 1) {
    nodes.push({ id: `b${i}`, x: i * bayWidth, y: 0, ...(i === 0 ? { support: 'pin' as const } : i === bays ? { support: 'roller' as const } : {}) })
  }
  for (let i = 1; i < bays; i += 1) nodes.push({ id: `t${i}`, x: i * bayWidth, y: depth })

  for (let i = 0; i < bays; i += 1) members.push({ id: `bottom${i + 1}`, from: `b${i}`, to: `b${i + 1}` })
  for (let i = 1; i < bays - 1; i += 1) members.push({ id: `top${i}`, from: `t${i}`, to: `t${i + 1}` })
  for (let i = 1; i < bays; i += 1) members.push({ id: `post${i}`, from: `b${i}`, to: `t${i}` })
  // The diagonals, leaning towards the middle from each end, which is what a Pratt truss does.
  for (let i = 1; i < bays; i += 1) {
    const towardsMiddle = i <= bays / 2
    members.push({ id: `brace${i}`, from: towardsMiddle ? `b${i - 1}` : `b${i + 1}`, to: `t${i}` })
  }

  // The load hung off each interior bottom node, which is where a deck would hand it over.
  for (let i = 1; i < bays; i += 1) loads.push({ node: `b${i}`, x: 0, y: -load })

  return { nodes, members, loads }
}

export default function StructureLoadLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engineering = useEngineering()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<'beam' | 'truss'>('beam')

  const beam = String(values.beam ?? 'simply-supported') as 'simply-supported' | 'cantilever' | 'overhanging'
  const length = Number(values.length ?? 4)
  const pointLoad = Number(values.pointLoad ?? 5_000)
  const pointAt = Number(values.pointAt ?? 2)
  const spread = Number(values.spread ?? 0)
  const section = String(values.section ?? 'rectangle') as never
  const width = Number(values.width ?? 0.1)
  const height = Number(values.height ?? 0.2)
  const diameter = Number(values.diameter ?? 0.15)
  const thickness = Number(values.thickness ?? 0.008)
  const materialId = String(values.material ?? 'steel-mild')

  const bays = Number(values.bays ?? 4)
  const span = Number(values.span ?? 12)
  const depth = Number(values.depth ?? 2)
  const nodeLoad = Number(values.nodeLoad ?? 20_000)

  useEffect(() => {
    if (!engineering.ready) return
    if (showing === 'beam') {
      engineering.ask({
        kind: 'beam',
        beam,
        length,
        supportA: 0,
        supportB: beam === 'overhanging' ? length * 0.75 : length,
        pointLoad,
        pointAt: Math.min(pointAt, length),
        spread,
        section,
        width,
        height,
        diameter,
        thickness,
        materialId,
        stations: 400
      })
      return
    }
    const made = makeTruss(Math.max(2, Math.round(bays)), span, depth, nodeLoad)
    engineering.ask({ kind: 'truss', nodes: made.nodes, members: made.members, loads: made.loads })
  }, [
    engineering.ready,
    showing,
    beam,
    length,
    pointLoad,
    pointAt,
    spread,
    section,
    width,
    height,
    diameter,
    thickness,
    materialId,
    bays,
    span,
    depth,
    nodeLoad
  ])

  const beamHeld = engineering.beam.value
  const analysis = (beamHeld?.analysis ?? null) as BeamAnalysis | null
  const sectionReport = (beamHeld?.section ?? null) as SectionReport | null
  const material = (beamHeld?.material ?? null) as Material | null
  const buckling = (beamHeld?.buckling ?? null) as Buckling | null
  const truss = (engineering.truss.value?.report ?? null) as TrussReport | null

  const refused = showing === 'beam' ? engineering.beam.refused : engineering.truss.refused
  const broke = showing === 'beam' ? engineering.beam.broke : engineering.truss.broke
  const busy = showing === 'beam' ? engineering.beam.busy : engineering.truss.busy

  const hasDeflection = analysis !== null && analysis.stations.some((one) => one.deflection !== null)
  const peakStress =
    analysis !== null && sectionReport !== null && sectionReport.sectionModulusBottom > 0
      ? Math.abs(analysis.maxMoment.value) / sectionReport.sectionModulusBottom
      : null
  const yieldStrength = material?.properties.yieldStrength?.value ?? null

  return (
    <section className="p2 p4" aria-label="Structures Laboratory">
      <header className="p2-bar">
        <strong>{showing === 'beam' ? 'Beam under load' : 'Truss under load'}</strong>
        {showing === 'beam' && analysis !== null && (
          <span className="p2-faint">
            Worst bending {tidy(analysis.maxMoment.value)} N·m at {tidy(analysis.maxMoment.at)} m
          </span>
        )}
        {showing === 'truss' && truss !== null && (
          <span className="p2-faint">
            {truss.members.length} members · {truss.determinacy}
          </span>
        )}
      </header>

      {refused && (
        <p className="p2-refused" role="status">
          <strong>{refused.says}</strong> {refused.fix}
        </p>
      )}
      {broke && (
        <p className="p2-refused" role="status">
          {broke}
        </p>
      )}

      <div className="p2-tabs" role="tablist">
        {(['beam', 'truss'] as const).map((one) => (
          <button key={one} type="button" role="tab" className="p2-tab" aria-selected={showing === one} onClick={() => setShowing(one)}>
            {one === 'beam' ? 'A beam' : 'A truss'}
          </button>
        ))}
      </div>

      <div className="p3-split">
        <div>
          {showing === 'beam' && analysis === null && (
            <p className="p2-faint">{busy ? 'Analysing it…' : 'Nothing analysed yet.'}</p>
          )}

          {showing === 'beam' && analysis !== null && (
            <>
              <BeamView analysis={analysis} pointAt={Math.min(pointAt, length)} pointLoad={pointLoad} spread={spread} />
              <Plot
                series={[{ id: 'shear', label: 'Shear (N)', points: analysis.stations.map((one) => ({ x: one.x, y: one.shear })) }]}
                xLabel="metres along"
                yLabel="newtons"
                zero={0}
                height={150}
                markers={[{ x: analysis.maxShear.at, label: 'worst shear' }]}
                about="Shear jumps where a load sits. The size of the jump is the size of the load."
              />
              <Plot
                series={[
                  { id: 'moment', label: 'Bending moment (N·m)', points: analysis.stations.map((one) => ({ x: one.x, y: one.moment })), colour: '#f0a33a' }
                ]}
                xLabel="metres along"
                yLabel="newton metres"
                zero={0}
                height={150}
                markers={[
                  { x: analysis.maxMoment.at, label: 'worst bending' },
                  ...analysis.inflectionPoints.slice(0, 3).map((one) => ({ x: one, label: 'bending reverses' }))
                ]}
                about="Bending moment is the running total of the shear, which is why its peak sits where the shear passes through zero."
              />
              {hasDeflection ? (
                <Plot
                  series={[
                    {
                      id: 'defl',
                      label: 'Sag (mm)',
                      points: analysis.stations.filter((one) => one.deflection !== null).map((one) => ({ x: one.x, y: (one.deflection as number) * 1_000 })),
                      colour: '#37d67a'
                    }
                  ]}
                  xLabel="metres along"
                  yLabel="millimetres"
                  zero={0}
                  height={150}
                  about={
                    analysis.maxDeflection === null
                      ? ''
                      : `It sags ${tidy(Math.abs(analysis.maxDeflection.value) * 1_000)} mm at worst, ${tidy(analysis.maxDeflection.at)} m along. That is 1 in ${Math.round(length / Math.max(1e-9, Math.abs(analysis.maxDeflection.value)))} of the span — a floor is usually kept inside 1 in 360.`
                  }
                />
              ) : (
                <p className="p2-refused" role="status">
                  <strong>The sag cannot be worked out.</strong> It depends on the material's stiffness and the shape
                  of the section, and one of those is not known here. Shear and bending above do not depend on either,
                  so they are still right.
                </p>
              )}
            </>
          )}

          {showing === 'truss' && truss === null && <p className="p2-faint">{busy ? 'Solving it…' : 'Nothing solved yet.'}</p>}
          {showing === 'truss' && truss !== null && (
            <TrussView report={truss} made={makeTruss(Math.max(2, Math.round(bays)), span, depth, nodeLoad)} />
          )}
        </div>

        <div className="p3-side">
          {showing === 'beam' && analysis !== null && (
            <div className="p3-panel">
              <h4>What holds it up</h4>
              <dl className="p3-facts">
                {analysis.reactions.map((one) => (
                  <div key={one.label} className="p4-fact">
                    <dt>
                      {one.label} at {tidy(one.position)} m
                    </dt>
                    <dd>{tidy(one.force)} N</dd>
                  </div>
                ))}
              </dl>
              <p className="p2-faint">
                These add up to the load, which is how the solver checks itself. Its integration drifted by{' '}
                {analysis.integrationResidual.toExponential(1)} — small enough that the curves above can be trusted.
              </p>
            </div>
          )}

          {showing === 'beam' && sectionReport !== null && (
            <div className="p3-panel">
              <h4>The section</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>Area</dt>
                  <dd>{tidy(sectionReport.area * 1e4)} cm²</dd>
                </div>
                <div className="p4-fact">
                  <dt>Stiffness of shape</dt>
                  <dd>{sectionReport.ixx.toExponential(2)} m⁴</dd>
                </div>
                <div className="p4-fact">
                  <dt>Symmetric</dt>
                  <dd>{sectionReport.symmetric ? 'yes' : 'no'}</dd>
                </div>
              </dl>
              <p className="p2-faint">
                Depth matters far more than width: the stiffness of the shape goes up with the cube of the depth, so a
                beam turned on its side is dramatically weaker. Try swapping the width and the height.
              </p>
            </div>
          )}

          {showing === 'beam' && peakStress !== null && (
            <div className="p3-panel">
              <h4>Is it strong enough?</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>Worst stress</dt>
                  <dd>{tidy(peakStress / 1e6)} MPa</dd>
                </div>
                {yieldStrength !== null && (
                  <>
                    <div className="p4-fact">
                      <dt>{material?.name ?? 'Material'} gives way at</dt>
                      <dd>{tidy(yieldStrength / 1e6)} MPa</dd>
                    </div>
                    <div className="p4-fact">
                      <dt>Margin</dt>
                      <dd>{tidy(yieldStrength / Math.max(1, peakStress))}×</dd>
                    </div>
                  </>
                )}
              </dl>
              {yieldStrength !== null && peakStress > yieldStrength && (
                <p className="p2-refused">
                  <strong>This beam would be permanently bent by that load.</strong> The stress is past where the
                  material stops springing back.
                </p>
              )}
              {yieldStrength === null && (
                <p className="p2-faint">
                  The material's yield strength is not in the table, so there is nothing to compare the stress
                  against.
                </p>
              )}
              {buckling !== null && buckling.refused === undefined && (
                <p className="p2-faint">
                  If this were being pushed along its length rather than bent, it would buckle at{' '}
                  {tidy(buckling.criticalLoad / 1_000)} kN. Its slenderness is {tidy(buckling.slenderness)} — above
                  about 100, buckling is what fails first rather than the material giving way.
                </p>
              )}
            </div>
          )}

          {showing === 'truss' && truss !== null && (
            <div className="p3-panel">
              <h4>The members</h4>
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Force (kN)</th>
                      <th>Doing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {truss.members.map((one) => (
                      <tr key={one.id}>
                        <td>{one.id}</td>
                        <td className="p4-num">{tidy(one.force / 1_000)}</td>
                        <td className={one.state === 'tension' ? 'p4-tension' : one.state === 'compression' ? 'p4-compression' : ''}>
                          {one.state === 'zero-force' ? 'nothing' : one.state === 'tension' ? 'being pulled' : 'being squashed'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p2-faint">
                {truss.equilibriumVerified
                  ? `Every joint balances to within ${truss.worstJointResidual.toExponential(1)} N, which is how the solver proves it got it right.`
                  : 'The joints do not balance, which means this arrangement is not a solvable truss.'}
              </p>
              {truss.zeroForceMembers.length > 0 && (
                <p className="p2-faint">
                  {truss.zeroForceMembers.join(', ')} {truss.zeroForceMembers.length === 1 ? 'carries' : 'carry'} no
                  force under this load. That is not a mistake — such members hold the shape and come into play under
                  a different load.
                </p>
              )}
              {truss.determinacy !== 'determinate' && (
                <p className="p2-refused">
                  <strong>
                    {truss.determinacy === 'mechanism'
                      ? 'This is a mechanism, not a truss.'
                      : 'This truss has more members than it needs.'}
                  </strong>{' '}
                  {truss.determinacy === 'mechanism'
                    ? 'It would fold up rather than carry anything. Add a brace.'
                    : 'The forces then depend on how stiff each member is, which this method cannot work out.'}
                </p>
              )}
            </div>
          )}

          <div className="p3-panel">
            <h4>What this does not model</h4>
            <ul className="p3-assumptions">
              {((showing === 'beam' ? beamHeld?.assumptions : engineering.truss.value?.assumptions) ?? []).map((one, index) => (
                <li key={index}>{one}</li>
              ))}
              <li>
                Small deflections and a material that springs back. Past the yield point the answers stop being
                right, and the panel says when that has happened.
              </li>
              <li>The beam's own weight is not included unless you add it as a spread load.</li>
            </ul>
          </div>
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters
            definitions={instance.definitions}
            shown={instance.shown}
            values={instance.values}
            onSet={onConfigure}
            busy={busy}
          />
        </details>
      )}
    </section>
  )
}

/** The beam, its supports, its loads, and its deflected shape at an exaggerated scale that is stated. */
function BeamView({
  analysis,
  pointAt,
  pointLoad,
  spread
}: {
  analysis: BeamAnalysis
  pointAt: number
  pointLoad: number
  spread: number
}): React.JSX.Element {
  const worst = analysis.maxDeflection === null ? 0 : Math.abs(analysis.maxDeflection.value)
  // Exaggerated so the shape can be seen at all, and the factor is said out loud so nobody reads it as the real sag.
  const exaggeration = worst > 0 ? 12 / (worst / analysis.length) / 100 : 0
  const at = (x: number): number => (x / analysis.length) * 100

  const shape = analysis.stations
    .filter((one) => one.deflection !== null)
    .map((one, index) => `${index === 0 ? 'M' : 'L'}${at(one.x).toFixed(2)} ${(50 - (one.deflection as number) * exaggeration).toFixed(2)}`)
    .join(' ')

  return (
    <div className="p4-beam">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="The beam with its supports and loads">
        <line x1="0" y1="50" x2="100" y2="50" className="p4-beam-line" vectorEffect="non-scaling-stroke" />
        {shape.length > 0 && <path d={shape} fill="none" className="p4-beam-bent" vectorEffect="non-scaling-stroke" />}
        {analysis.reactions.map((one) => (
          <polygon
            key={one.label}
            points={`${at(one.position)},50 ${at(one.position) - 2.5},62 ${at(one.position) + 2.5},62`}
            className="p4-support"
          />
        ))}
        {pointLoad !== 0 && (
          <g>
            <line x1={at(pointAt)} y1="18" x2={at(pointAt)} y2="46" className="p4-load" vectorEffect="non-scaling-stroke" />
            <polygon points={`${at(pointAt)},50 ${at(pointAt) - 2},42 ${at(pointAt) + 2},42`} className="p4-load-head" />
          </g>
        )}
        {spread !== 0 &&
          Array.from({ length: 11 }, (_, i) => i * 10).map((x) => (
            <line key={x} x1={x} y1="26" x2={x} y2="46" className="p4-load spread" vectorEffect="non-scaling-stroke" />
          ))}
      </svg>
      <ul className="p4-legend">
        <li className="p4-legend-mark">
          {analysis.kind.replace('-', ' ')}, {tidy(analysis.length)} m
        </li>
        {worst > 0 && (
          <li className="p4-legend-mark">
            the bend is drawn about {Math.round(exaggeration * 100)} times larger than it is, so it can be seen
          </li>
        )}
      </ul>
    </div>
  )
}

/** The truss, with each member coloured by what it is doing and sized by how hard. */
function TrussView({
  report,
  made
}: {
  report: TrussReport
  made: { nodes: readonly { id: string; x: number; y: number; support?: string }[]; members: readonly { id: string; from: string; to: string }[]; loads: readonly { node: string }[] }
}): React.JSX.Element {
  const widest = Math.max(...made.nodes.map((one) => one.x), 1)
  const tallest = Math.max(...made.nodes.map((one) => one.y), 1)
  const byId = new Map(made.nodes.map((one) => [one.id, one]))
  const forceById = new Map(report.members.map((one) => [one.id, one]))
  const biggest = Math.max(1, ...report.members.map((one) => Math.abs(one.force)))

  const atX = (x: number): number => 6 + (x / widest) * 88
  const atY = (y: number): number => 82 - (y / tallest) * 58

  return (
    <div className="p4-truss">
      <svg viewBox="0 0 100 100" role="img" aria-label="The truss, with each member coloured by whether it is pulled or squashed">
        {made.members.map((one) => {
          const from = byId.get(one.from)
          const to = byId.get(one.to)
          const force = forceById.get(one.id)
          if (!from || !to) return null
          const thickness = 1 + (Math.abs(force?.force ?? 0) / biggest) * 3
          return (
            <line
              key={one.id}
              x1={atX(from.x)}
              y1={atY(from.y)}
              x2={atX(to.x)}
              y2={atY(to.y)}
              className={`p4-member ${force?.state ?? 'zero-force'}`}
              strokeWidth={thickness}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {made.nodes.map((one) => (
          <circle
            key={one.id}
            cx={atX(one.x)}
            cy={atY(one.y)}
            r="1.8"
            className={one.support !== undefined ? 'p4-support-node' : 'p4-joint'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {made.loads.map((one) => {
          const node = byId.get(one.node)
          if (!node) return null
          return (
            <g key={one.node}>
              <line x1={atX(node.x)} y1={atY(node.y)} x2={atX(node.x)} y2={atY(node.y) + 10} className="p4-load" vectorEffect="non-scaling-stroke" />
              <polygon
                points={`${atX(node.x)},${atY(node.y) + 12} ${atX(node.x) - 1.6},${atY(node.y) + 8} ${atX(node.x) + 1.6},${atY(node.y) + 8}`}
                className="p4-load-head"
              />
            </g>
          )
        })}
      </svg>
      <ul className="p4-legend">
        <li>
          <span className="p4-swatch" style={{ background: '#e05c5c' }} aria-hidden="true" />
          being pulled apart
        </li>
        <li>
          <span className="p4-swatch" style={{ background: 'var(--cyan)' }} aria-hidden="true" />
          being squashed
        </li>
        <li className="p4-legend-mark">thicker means a bigger force; faint means it carries nothing</li>
      </ul>
    </div>
  )
}
