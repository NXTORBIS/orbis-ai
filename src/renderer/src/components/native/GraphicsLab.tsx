import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useCS } from './useCS'
import './phase7.css'

/**
 * The Computer Graphics Laboratory — a shape through the whole pipeline.
 *
 * ## Both projections, from the same stack
 *
 * The difference between perspective and orthographic is one division. Switching between them with everything else
 * held still is the only way that stops being a sentence: the far face of the cube shrinks, or it does not.
 *
 * ## The numbers beside the picture
 *
 * The same four points are shown as they stood in each space — model, world, camera, clip, screen. Watching w stop
 * being 1 at the clip stage, and the divide happen after it, is the part that is genuinely surprising.
 */

interface Stage {
  name: string
  what: string
  sample: readonly { x: number; y: number; z: number; w?: number }[]
}

interface Face {
  points: readonly number[]
  depth: number
  facingAway: boolean
  shade: number
}

interface Report {
  screen: readonly ({ x: number; y: number; depth: number } | null)[]
  edges: readonly (readonly [number, number])[]
  faces: readonly Face[]
  stages: readonly Stage[]
  visible: number
  hidden: number
  says: string
  notes: readonly string[]
}

const WIDTH = 460
const HEIGHT = 340

export default function GraphicsLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useCS()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('picture')

  const shape = String(values.shape ?? 'cube')
  const rotateX = Number(values.rotateX ?? 0.5)
  const rotateY = Number(values.rotateY ?? 0.7)
  const rotateZ = Number(values.rotateZ ?? 0)
  const distance = Number(values.distance ?? 3)
  const fieldOfView = Number(values.fieldOfView ?? 60)
  const projection = (values.orthographic === true ? 'orthographic' : 'perspective') as 'perspective' | 'orthographic'
  const detail = Number(values.detail ?? 12)
  const backFaceCulling = values.backFaceCulling !== false

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({
      kind: 'graphics',
      shape,
      rotateX,
      rotateY,
      rotateZ,
      distance,
      fieldOfView,
      projection,
      detail,
      backFaceCulling,
      width: WIDTH,
      height: HEIGHT
    })
  }, [engine.ready, shape, rotateX, rotateY, rotateZ, distance, fieldOfView, projection, detail, backFaceCulling])

  const held = engine.graphics.value
  const report = (held?.report ?? null) as Report | null
  const shapes = (held?.shapes ?? []) as readonly { id: string; name: string }[]

  // Faces furthest away first, so nearer ones are drawn over them. The painter's method, and it is enough here.
  const painted = report === null ? [] : [...report.faces].filter((one) => !backFaceCulling || !one.facingAway).sort((a, b) => a.depth - b.depth)

  return (
    <LabShell
      title="Computer Graphics"
      summary={report?.says}
      refused={engine.graphics.refused}
      broke={engine.graphics.broke}
      busy={engine.graphics.busy}
      waitingFor="Projecting…"
      ready={held !== null}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'picture', label: 'The picture' },
        { id: 'stages', label: 'The pipeline' },
        { id: 'matrices', label: 'The matrices' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {report !== null && (
            <Facts
              title="This frame"
              rows={[
                ['Shape', shapes.find((one) => one.id === shape)?.name ?? shape],
                ['Points', report.screen.length],
                ['Edges drawn', report.edges.length],
                ['Faces towards you', report.visible],
                ['Faces hidden', report.hidden],
                ['Projection', projection === 'perspective' ? `perspective, ${fieldOfView}°` : 'orthographic']
              ]}
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {showing === 'picture' && report !== null && (
        <>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="p7-scene" role="img" aria-label={report.says}>
            {/* Faces first, shaded by how square-on they are — not a light, and the notes say so. */}
            {painted.map((face, at) => {
              const points = face.points
                .map((one) => report.screen[one])
                .filter((one): one is { x: number; y: number; depth: number } => one !== null)
              if (points.length < 3) return null
              return (
                <polygon
                  key={at}
                  points={points.map((one) => `${one.x.toFixed(1)},${one.y.toFixed(1)}`).join(' ')}
                  className="p7-face"
                  style={{ opacity: 0.12 + face.shade * 0.3 }}
                />
              )
            })}
            {report.edges.map(([a, b], at) => {
              const from = report.screen[a]
              const to = report.screen[b]
              if (from === null || to === null) return null
              return <line key={at} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="p7-edge" />
            })}
            {report.screen.length <= 40 &&
              report.screen.map((one, at) =>
                one === null ? null : <circle key={at} cx={one.x} cy={one.y} r={2.5} className="p7-point" />
              )}
          </svg>
          <p className="p4-says">
            {projection === 'perspective'
              ? 'Perspective: the far side is smaller, because x and y were divided by depth. Switch to orthographic and watch that stop happening.'
              : 'Orthographic: the far side is exactly the size of the near side, because nothing was divided by depth. Switch to perspective to see the difference one division makes.'}
          </p>
        </>
      )}

      {showing === 'stages' && report !== null && (
        <>
          <h4 className="p4-heading">The same four points, in each space</h4>
          {report.stages.map((stage) => (
            <div key={stage.name} className="p7-stage-block">
              <div className="p7-stage-head">
                <strong>{stage.name}</strong>
                <small className="p2-faint">{stage.what}</small>
              </div>
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th scope="col">x</th>
                      <th scope="col">y</th>
                      <th scope="col">z</th>
                      {stage.sample.some((one) => one.w !== undefined) && <th scope="col">w</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {stage.sample.map((one, at) => (
                      <tr key={at}>
                        <td>{Number.isFinite(one.x) ? one.x : 'behind the camera'}</td>
                        <td>{Number.isFinite(one.y) ? one.y : ''}</td>
                        <td>{Number.isFinite(one.z) ? one.z : ''}</td>
                        {one.w !== undefined && <td className="p7-accepting">{one.w}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="p4-says">
            Watch w in the clip row. Everything before it was straight multiplication; the division by w is the next
            step and the only one that is not a matrix — which is exactly why perspective can be a matrix at all.
          </p>
        </>
      )}

      {showing === 'matrices' && held !== null && (
        <>
          <h4 className="p4-heading">The three matrices</h4>
          {Object.entries((held.report as { matrices?: Record<string, readonly number[]> })?.matrices ?? {}).map(([name, matrix]) => (
            <div key={name} className="p7-matrix-block">
              <strong>{name}</strong>
              <table className="p7-matrix">
                <tbody>
                  {[0, 1, 2, 3].map((row) => (
                    <tr key={row}>
                      {[0, 1, 2, 3].map((column) => (
                        <td key={column}>{Number(matrix[row * 4 + column] ?? 0).toFixed(3)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="p4-says">
            Model turns the shape, view moves the world so the camera is at the origin, and projection flattens it.
            Multiplied together they are one matrix, which is why a graphics card can do all three at once.
          </p>
        </>
      )}
    </LabShell>
  )
}
