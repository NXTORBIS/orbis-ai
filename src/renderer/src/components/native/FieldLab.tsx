import { useEffect, useMemo } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import { useScience } from './useScience'
import './phase2.css'
import './phase3.css'

/**
 * The Field Laboratory.
 *
 * ## Every arrow is a computation
 *
 * Each grid point is a separate call into the electrostatics or gravitation engine, summing the contribution of
 * every source. Nothing is interpolated between points and nothing is drawn from a formula for how a field "looks":
 * a seventeen-by-seventeen grid is 289 field calculations, and the laboratory says how many.
 *
 * ## A point on a source is left out rather than invented
 *
 * The field at a point charge is infinite. The engine refuses that point and this reports how many were skipped,
 * because drawing a very large arrow there would be a made-up number in the one place the physics has none.
 *
 * ## Equal-length arrows are a choice, and it is stated
 *
 * An inverse-square field near a source swamps everything else, so direction becomes unreadable at true scale. The
 * normalised view is the default and says that it hides magnitude; the shaded potential is the honest picture of how
 * strong the field is.
 */

interface Sample {
  x: number
  y: number
  fx: number
  fy: number
  magnitude: number
  potential: number
}

interface ElectricResult {
  samples: readonly Sample[]
  strongest: number
  skipped: number
  note: string
}

/** The gravitational engine's own grid shape, which differs from the electric one. */
interface GravityResult {
  samples: readonly { position: { x: number; y: number }; field: { x: number; y: number }; magnitude: number; potential: number }[]
  strongest: number
  skipped: number
}

/** Sources read from the text box: "strength x y", one per line or separated by semicolons. */
function readSources(text: string): { sources: { strength: number; x: number; y: number }[]; problems: string[] } {
  const sources: { strength: number; x: number; y: number }[] = []
  const problems: string[] = []
  const lines = text
    .split(/[;\n]+/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0)

  lines.forEach((line, at) => {
    const parts = line.split(/[\s,]+/).filter((one) => one.length > 0)
    if (parts.length < 3) {
      problems.push(`Line ${at + 1} ("${line}") needs three numbers: strength, x, y.`)
      return
    }
    const [strength, x, y] = parts.map(Number)
    if (![strength, x, y].every((one) => Number.isFinite(one))) {
      problems.push(`Line ${at + 1} ("${line}") has something that is not a number in it.`)
      return
    }
    sources.push({ strength, x, y })
  })

  return { sources, problems }
}

export default function FieldLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const science = useScience()
  const values = instance?.values ?? {}

  const of = String(values.kind ?? 'electric') === 'gravitational' ? 'gravitational' : 'electric'
  const extent = Number(values.extent ?? 5)
  const resolution = Number(values.resolution ?? 17)
  const show = String(values.show ?? 'vectors')
  const normalise = values.normalise !== false

  const { sources, problems } = useMemo(() => readSources(String(values.sources ?? '')), [values.sources])

  useEffect(() => {
    if (!science.ready || sources.length === 0 || problems.length > 0) return
    science.ask({ kind: 'field', of, sources, extent, resolution })
  }, [science.ready, of, extent, resolution, JSON.stringify(sources), problems.length])

  // Both engines are normalised to one shape here, so the drawing code has one case.
  const samples: readonly Sample[] = useMemo(() => {
    const held = science.field.value
    if (!held) return []
    if (of === 'electric') return (held as ElectricResult).samples ?? []
    const gravity = held as GravityResult
    return (gravity.samples ?? []).map((one) => ({
      x: one.position.x,
      y: one.position.y,
      fx: one.field.x,
      fy: one.field.y,
      magnitude: one.magnitude,
      potential: one.potential
    }))
  }, [science.field.value, of])

  const strongest = (science.field.value as { strongest?: number } | null)?.strongest ?? 0
  const skipped = (science.field.value as { skipped?: number } | null)?.skipped ?? 0
  const engineNote = (science.field.value as { note?: string } | null)?.note ?? ''

  return (
    <section className="p2 p3" aria-label="Field Laboratory">
      <header className="p2-bar">
        <strong>{of === 'electric' ? 'Electric field' : 'Gravitational field'}</strong>
        <span className="p2-faint">
          {sources.length} source{sources.length === 1 ? '' : 's'} · {resolution}×{resolution} grid ·{' '}
          {samples.length.toLocaleString('en-GB')} points computed
        </span>
      </header>

      {problems.length > 0 && (
        <p className="p2-refused" role="status">
          <strong>The sources could not be read.</strong> {problems[0]}
        </p>
      )}
      {sources.length === 0 && problems.length === 0 && (
        <p className="p2-refused" role="status">
          <strong>There are no sources, so there is no field.</strong> Add one: strength, then x and y.
        </p>
      )}
      {science.field.refused && (
        <p className="p2-refused" role="status">
          <strong>{science.field.refused.says}</strong> {science.field.refused.fix}
        </p>
      )}
      {science.field.broke && <p className="p2-refused" role="status">{science.field.broke}</p>}

      <div className="p3-split">
        <div>
          <div className="p2-stage p3-viewport">
            {samples.length > 0 ? (
              <FieldView samples={samples} sources={sources} extent={extent} strongest={strongest} show={show} normalise={normalise} of={of} />
            ) : (
              <p className="p2-faint">{science.field.busy ? 'Computing the grid…' : 'Nothing computed yet.'}</p>
            )}
          </div>

          {/* What the picture is, and what it leaves out. */}
          <p className="p3-note">
            Every arrow is a separate sum over all {sources.length} source{sources.length === 1 ? '' : 's'}; nothing is
            interpolated.{' '}
            {normalise
              ? 'Arrows are drawn the same length so the direction is readable, which hides how fast the strength falls — the shaded potential shows that.'
              : 'Arrow length is proportional to strength, so arrows far from a source are very short.'}
            {engineNote ? ` ${engineNote}` : ''}
          </p>
        </div>

        <div className="p3-side">
          <div className="p3-panel">
            <h4>Measured</h4>
            <dl className="p3-facts">
              <dt>Points</dt>
              <dd>{samples.length.toLocaleString('en-GB')}</dd>
              <dt>Strongest</dt>
              <dd>
                {strongest > 0 ? strongest.toExponential(3) : '—'} {of === 'electric' ? 'N/C' : 'N/kg'}
              </dd>
              <dt>Skipped</dt>
              <dd>{skipped}</dd>
              <dt>Potential range</dt>
              <dd>
                {samples.length > 0
                  ? `${Math.min(...samples.map((one) => one.potential)).toExponential(2)} to ${Math.max(...samples.map((one) => one.potential)).toExponential(2)}`
                  : '—'}
              </dd>
            </dl>
            <p className="p2-faint">
              {of === 'electric'
                ? 'Field in newtons per coulomb, potential in volts.'
                : 'Field in newtons per kilogram, potential in joules per kilogram. Gravitational potential is always negative, because the zero is taken at infinity.'}
            </p>
          </div>

          <div className="p3-panel">
            <h4>Assumptions</h4>
            <ul className="p3-assumptions">
              <li>Point sources, in a plane.</li>
              <li>No conductors, no dielectrics, no induced charge.</li>
              <li>{of === 'electric' ? 'Vacuum permittivity.' : 'Newtonian gravity — no relativistic correction.'}</li>
              <li>Static: nothing here moves or radiates.</li>
            </ul>
          </div>
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters definitions={instance.definitions} shown={instance.shown} values={instance.values} onSet={onConfigure} busy={science.field.busy} />
        </details>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- the view

function FieldView({
  samples,
  sources,
  extent,
  strongest,
  show,
  normalise,
  of
}: {
  samples: readonly Sample[]
  sources: readonly { strength: number; x: number; y: number }[]
  extent: number
  strongest: number
  show: string
  normalise: boolean
  of: string
}): React.JSX.Element {
  const span = extent * 2
  // One cell of the grid, used to size both the arrows and the shaded squares.
  const step = samples.length > 1 ? span / (Math.round(Math.sqrt(samples.length)) - 1 || 1) : span

  const potentials = samples.map((one) => one.potential)
  const lowest = Math.min(...potentials)
  const highest = Math.max(...potentials)
  const spread = highest - lowest || 1

  return (
    <svg
      className="p3-field"
      viewBox={`${-extent - step} ${-extent - step} ${span + step * 2} ${span + step * 2}`}
      role="img"
      aria-label={`${of} field around ${sources.length} sources, ${samples.length} points computed`}
    >
      {/* The potential, shaded. Drawn first so arrows sit over it. */}
      {(show === 'potential' || show === 'both') && (
        <g className="p3-potential">
          {samples.map((one, at) => {
            const share = (one.potential - lowest) / spread
            return (
              <rect
                key={at}
                x={one.x - step / 2}
                y={-one.y - step / 2}
                width={step}
                height={step}
                fill={`hsl(${210 - share * 180}, 70%, ${18 + share * 34}%)`}
                opacity={0.75}
              />
            )
          })}
        </g>
      )}

      {/* The field. Arrow length is either normalised or proportional, and the panel says which. */}
      {(show === 'vectors' || show === 'both') && (
        <g>
          {samples.map((one, at) => {
            const length = one.magnitude === 0 ? 0 : normalise ? step * 0.42 : Math.min(step * 0.9, (one.magnitude / (strongest || 1)) * step * 0.9)
            if (length <= 0) return null
            const scale = length / one.magnitude
            // SVG y grows downwards, so the field's y is negated to keep the physics the right way up.
            const dx = one.fx * scale
            const dy = -one.fy * scale
            const tipX = one.x + dx
            const tipY = -one.y + dy
            const head = Math.min(step * 0.16, length * 0.42)
            const angle = Math.atan2(dy, dx)
            return (
              <g key={at}>
                <line x1={one.x} y1={-one.y} x2={tipX} y2={tipY} className="p3-arrow" />
                <polygon
                  className="p3-arrow-head"
                  points={[
                    `${tipX},${tipY}`,
                    `${tipX - head * Math.cos(angle - 0.45)},${tipY - head * Math.sin(angle - 0.45)}`,
                    `${tipX - head * Math.cos(angle + 0.45)},${tipY - head * Math.sin(angle + 0.45)}`
                  ].join(' ')}
                />
              </g>
            )
          })}
        </g>
      )}

      {/* The sources, with their sign written on as well as coloured. */}
      {sources.map((one, at) => (
        <g key={at} className={`p3-source ${one.strength >= 0 ? 'positive' : 'negative'}`}>
          <circle cx={one.x} cy={-one.y} r={step * 0.38} />
          <text x={one.x} y={-one.y + step * 0.17} style={{ fontSize: `${step * 0.5}px` }}>
            {of === 'gravitational' ? 'm' : one.strength >= 0 ? '+' : '−'}
          </text>
        </g>
      ))}
    </svg>
  )
}
