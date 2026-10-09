import { useEffect, useMemo, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import { useScience } from './useScience'
import type { Molecule, MoleculeReport } from '../../../../shared/compute/molecules'
import './phase2.css'
import './phase3.css'

/**
 * The Molecular Explorer.
 *
 * ## It draws a structure, not a picture
 *
 * The molecule arrives from the engine as atoms with three-dimensional positions and bonds with orders, and this
 * projects them. So the bend in water is 104.5° because the engine put the atoms there, and methane's tetrahedron
 * is a tetrahedron rather than four lines drawn at pleasing angles.
 *
 * Rotation is a real rotation of those coordinates, not a sprite being turned, which is why the depth ordering and
 * the bond foreshortening are right.
 *
 * ## It says what the picture is
 *
 * The note under the viewport is the engine's own: the positions come from idealised VSEPR directions and covalent
 * radii, and are a visualisation rather than a measured or minimised structure. §117 of the brief asks for exactly
 * that, and a molecular viewer that implied otherwise would be the most convincing kind of wrong.
 *
 * ## Chemistry that cannot exist is refused with the reason
 *
 * Not greyed out, not silently ignored. "Oxygen cannot take another bond: it has 2 and cannot have more than 2" is
 * the answer to "why is this invalid", which is the question the brief asks the builder to answer.
 */

/** Element colours, close to the CPK convention chemistry has used since the 1950s. */
const COLOURS: Readonly<Record<string, string>> = Object.freeze({
  H: '#eef3f8',
  C: '#4a5058',
  N: '#3a63d8',
  O: '#e2483c',
  F: '#58c47a',
  Cl: '#3fb855',
  Br: '#9a4a2a',
  I: '#7a3fa8',
  S: '#e0b63a',
  P: '#e08a3a',
  Na: '#8f62e0',
  K: '#7a4fd0',
  Mg: '#45b06a',
  Ca: '#4aa860',
  Fe: '#c06a3a',
  B: '#d9a08a',
  Si: '#c8a06a'
})

/** Drawn radius, in ångströms, roughly proportional to the van der Waals radius. */
const SIZES: Readonly<Record<string, number>> = Object.freeze({
  H: 0.32, C: 0.6, N: 0.56, O: 0.52, F: 0.47, Cl: 0.75, Br: 0.85, I: 0.98,
  S: 0.8, P: 0.8, Na: 1.1, K: 1.3, Mg: 0.9, Ca: 1.1, Fe: 0.9, B: 0.6, Si: 0.8
})

const colourFor = (symbol: string): string => COLOURS[symbol] ?? '#9aa4b0'
const sizeFor = (symbol: string): number => SIZES[symbol] ?? 0.6

export default function MoleculeLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const science = useScience()
  const values = instance?.values ?? {}

  const id = String(values.molecule ?? 'water')
  const style = String(values.style ?? 'ball-and-stick')
  const spin = Number(values.spin ?? 25)
  const tilt = Number(values.tilt ?? 15)
  const labels = values.labels !== false
  const showLonePairs = values.showLonePairs === true

  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (science.ready) science.ask({ kind: 'molecule', id })
  }, [science.ready, id])

  const held = science.molecule.value as { molecule: Molecule; report: MoleculeReport } | null
  const molecule = held?.molecule ?? null
  const report = held?.report ?? null

  // The laid-out copy carries the positions; the engine returns it inside the report's own layout step.
  const placed = useMemo(() => molecule?.atoms.filter((one) => one.at) ?? [], [molecule])

  return (
    <section className="p2 p3" aria-label="Molecular Explorer">
      <header className="p2-bar">
        <strong>{molecule?.name ?? 'Molecule'}</strong>
        {report && (
          <span className="p2-faint">
            {report.formula.formula} · {report.formula.molarMass} g/mol
            {report.formula.conventional ? ' (conventional atomic weights)' : ''}
          </span>
        )}
      </header>

      {science.molecule.refused && (
        <p className="p2-refused" role="status">
          <strong>{science.molecule.refused.says}</strong> {science.molecule.refused.fix}
        </p>
      )}
      {science.molecule.broke && <p className="p2-refused" role="status">{science.molecule.broke}</p>}

      <div className="p3-split">
        <div>
          <div className="p2-stage p3-viewport">
            {molecule && placed.length > 0 ? (
              <MoleculeView
                molecule={molecule}
                report={report}
                style={style}
                spin={spin}
                tilt={tilt}
                labels={labels}
                lonePairs={showLonePairs}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <p className="p2-faint">{science.molecule.busy ? 'Building it…' : 'Nothing to show yet.'}</p>
            )}
          </div>

          {/* The engine's own note about what the positions are. Never paraphrased. */}
          {report && <p className="p3-note">{report.note}</p>}

          {/* A textual summary of the structure, so the viewport is not the only way to read it. */}
          {molecule && report && (
            <p className="p2-faint" role="status">
              {molecule.atoms.length} atoms, {molecule.bonds.length} bonds. {report.structure.says} {report.valence.summary}
            </p>
          )}
        </div>

        <div className="p3-side">
          {report && <Facts report={report} />}
          {molecule && report && selected && <Inspector molecule={molecule} report={report} atomId={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters definitions={instance.definitions} shown={instance.shown} values={instance.values} onSet={onConfigure} busy={science.molecule.busy} />
        </details>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- the viewport

/**
 * The molecule, projected.
 *
 * Rotation about the vertical axis, then a tilt, then an orthographic projection — enough to read a shape, and it
 * keeps parallel bonds parallel, which a perspective projection would not. Atoms are drawn back to front so the
 * near ones overlap the far ones, which is the whole of the depth cue.
 */
function MoleculeView({
  molecule,
  report,
  style,
  spin,
  tilt,
  labels,
  lonePairs,
  selected,
  onSelect
}: {
  molecule: Molecule
  report: MoleculeReport | null
  style: string
  spin: number
  tilt: number
  labels: boolean
  lonePairs: boolean
  selected: string | null
  onSelect(id: string | null): void
}): React.JSX.Element {
  const projected = useMemo(() => {
    const a = (spin * Math.PI) / 180
    const b = (tilt * Math.PI) / 180
    return molecule.atoms
      .filter((one) => one.at)
      .map((one) => {
        const { x, y, z } = one.at as { x: number; y: number; z: number }
        // About the y axis, then about the x axis.
        const x1 = x * Math.cos(a) + z * Math.sin(a)
        const z1 = -x * Math.sin(a) + z * Math.cos(a)
        const y2 = y * Math.cos(b) - z1 * Math.sin(b)
        const z2 = y * Math.sin(b) + z1 * Math.cos(b)
        return { atom: one, x: x1, y: -y2, depth: z2 }
      })
      // Back to front, so nearer atoms are drawn over further ones.
      .sort((p, q) => p.depth - q.depth)
  }, [molecule, spin, tilt])

  const at = useMemo(() => new Map(projected.map((one) => [one.atom.id, one])), [projected])

  const xs = projected.map((one) => one.x)
  const ys = projected.map((one) => one.y)
  const pad = 1.4
  const minX = Math.min(...xs, 0) - pad
  const maxX = Math.max(...xs, 0) + pad
  const minY = Math.min(...ys, 0) - pad
  const maxY = Math.max(...ys, 0) + pad

  const scale = style === 'space-filling' ? 1.9 : style === 'wireframe' ? 0.22 : 1
  const geometryAt = new Map((report?.geometry ?? []).map((one) => [one.atomId, one]))

  return (
    <svg
      className="p3-molecule"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      role="img"
      aria-label={`${molecule.name ?? 'molecule'}: ${molecule.atoms.length} atoms, ${molecule.bonds.length} bonds`}
    >
      {/* Bonds first, so atoms sit over them. */}
      {molecule.bonds.map((bond) => {
        const a = at.get(bond.from)
        const b = at.get(bond.to)
        if (!a || !b) return null
        // A double or triple bond is drawn as parallel lines, offset perpendicular to the bond.
        const dx = b.x - a.x
        const dy = b.y - a.y
        const length = Math.hypot(dx, dy) || 1
        const nx = -dy / length
        const ny = dx / length
        const lines = bond.order === 3 ? [-0.08, 0, 0.08] : bond.order === 2 ? [-0.06, 0.06] : [0]
        return (
          <g key={bond.id}>
            {lines.map((offset, index) => (
              <line
                key={index}
                x1={a.x + nx * offset}
                y1={a.y + ny * offset}
                x2={b.x + nx * offset}
                y2={b.y + ny * offset}
                className={`p3-bond${bond.aromatic ? ' aromatic' : ''}`}
              />
            ))}
          </g>
        )
      })}

      {projected.map((one) => {
        const radius = sizeFor(one.atom.symbol) * scale
        const geometry = geometryAt.get(one.atom.id)
        return (
          <g key={one.atom.id} className={`p3-atom${selected === one.atom.id ? ' picked' : ''}`}>
            <circle
              cx={one.x}
              cy={one.y}
              r={radius}
              fill={colourFor(one.atom.symbol)}
              onClick={() => onSelect(selected === one.atom.id ? null : one.atom.id)}
              role="button"
              tabIndex={0}
              aria-label={`${one.atom.symbol}${geometry ? `, ${geometry.shape}` : ''}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(selected === one.atom.id ? null : one.atom.id)
                }
              }}
            />
            {/* Lone pairs as small marks, which is what bends water and makes ammonia a pyramid. */}
            {lonePairs && geometry && geometry.lonePairs > 0 &&
              Array.from({ length: geometry.lonePairs }, (_, index) => {
                const angle = (index / geometry.lonePairs) * Math.PI * 2 + Math.PI / 4
                return (
                  <circle
                    key={index}
                    cx={one.x + Math.cos(angle) * (radius + 0.22)}
                    cy={one.y + Math.sin(angle) * (radius + 0.22)}
                    r={0.07}
                    className="p3-lone"
                  />
                )
              })}
            {labels && style !== 'space-filling' && (
              <text x={one.x} y={one.y + radius * 0.35} className="p3-atom-label" style={{ fontSize: `${radius * 0.9}px` }}>
                {one.atom.symbol}
              </text>
            )}
            {one.atom.charge !== 0 && (
              <text x={one.x + radius * 0.8} y={one.y - radius * 0.6} className="p3-charge">
                {one.atom.charge > 0 ? `${one.atom.charge > 1 ? one.atom.charge : ''}+` : `${one.atom.charge < -1 ? Math.abs(one.atom.charge) : ''}−`}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------- the facts

function Facts({ report }: { report: MoleculeReport }): React.JSX.Element {
  const centres = report.geometry.filter((one) => one.bonded >= 2)
  return (
    <div className="p3-panel">
      <h4>What it is</h4>
      <dl className="p3-facts">
        <dt>Formula</dt>
        <dd>{report.formula.formula}</dd>
        <dt>Molar mass</dt>
        <dd>{report.formula.molarMass} g/mol</dd>
        {centres.length > 0 && (
          <>
            <dt>Shape</dt>
            <dd>{centres.map((one) => `${one.symbol}: ${one.shape}`).join('; ')}</dd>
          </>
        )}
        {centres.some((one) => one.measuredAngle !== null) && (
          <>
            <dt>Bond angle</dt>
            <dd>
              {centres
                .filter((one) => one.measuredAngle !== null)
                .map((one) => `${one.measuredAngle}° measured${one.idealAngle !== null && Math.abs((one.measuredAngle ?? 0) - one.idealAngle) > 0.5 ? `, ${one.idealAngle}° by VSEPR` : ''}`)
                .join('; ')}
            </dd>
          </>
        )}
        <dt>Polarity</dt>
        <dd>
          {report.polarity.polar === null ? 'not settled by connectivity' : report.polarity.polar ? 'polar' : 'no overall dipole'}
        </dd>
        <dt>Most polar bond</dt>
        <dd>{report.polarity.largestDifference} on the Pauling scale</dd>
      </dl>
      <p className="p2-faint">{report.polarity.says}</p>
      {report.formula.conventional && (
        <p className="p2-faint">
          The mass rests on conventional atomic weights for {report.formula.conventionalFor.join(', ')}, whose natural
          isotopic composition varies by sample.
        </p>
      )}
    </div>
  )
}

/** One atom, inspected. Domain-specific: valence, lone pairs, shape, neighbours. */
function Inspector({
  molecule,
  report,
  atomId,
  onClose
}: {
  molecule: Molecule
  report: MoleculeReport
  atomId: string
  onClose(): void
}): React.JSX.Element | null {
  const atom = molecule.atoms.find((one) => one.id === atomId)
  if (!atom) return null
  const geometry = report.geometry.find((one) => one.atomId === atomId)
  const valence = report.valence.atoms.find((one) => one.atomId === atomId)
  const neighbours = molecule.bonds
    .filter((one) => one.from === atomId || one.to === atomId)
    .map((one) => {
      const otherId = one.from === atomId ? one.to : one.from
      const other = molecule.atoms.find((two) => two.id === otherId)
      return { symbol: other?.symbol ?? '?', order: one.order, aromatic: one.aromatic === true }
    })

  return (
    <div className="p3-panel">
      <h4>
        {atom.symbol}
        <button type="button" className="p3-close" onClick={onClose} aria-label="Stop inspecting this atom">
          ×
        </button>
      </h4>
      <dl className="p3-facts">
        <dt>Bonds used</dt>
        <dd>{valence?.used ?? 0}</dd>
        {valence && valence.usual !== null && (
          <>
            <dt>Usually</dt>
            <dd>{valence.usual}</dd>
          </>
        )}
        {geometry && (
          <>
            <dt>Lone pairs</dt>
            <dd>{geometry.lonePairs}</dd>
            <dt>Shape here</dt>
            <dd>{geometry.shape}</dd>
          </>
        )}
        {atom.charge !== 0 && (
          <>
            <dt>Formal charge</dt>
            <dd>
              {atom.charge > 0 ? '+' : ''}
              {atom.charge}
            </dd>
          </>
        )}
        <dt>Bonded to</dt>
        <dd>
          {neighbours.length === 0
            ? 'nothing'
            : neighbours.map((one) => `${one.symbol}${one.order === 2 ? ' (double)' : one.order === 3 ? ' (triple)' : ''}${one.aromatic ? ' aromatic' : ''}`).join(', ')}
        </dd>
      </dl>
      {valence && <p className="p2-faint">{valence.says}</p>}
      {geometry && <p className="p2-faint">{geometry.says}</p>}
    </div>
  )
}
