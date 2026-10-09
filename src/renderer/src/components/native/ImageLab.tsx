import { useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useSystems } from './useSystems'

/**
 * The Image Laboratory.
 *
 * ## Before and after, side by side, always
 *
 * A filter means nothing without what it was applied to. Showing both is the difference between watching a blur and
 * being told about one — and it is what makes an edge detector's output legible, because the edges are only edges
 * relative to the picture they came from.
 *
 * ## The pixels are drawn through a canvas, and nothing else is
 *
 * The engine works on plain bytes and knows nothing about a DOM. This file is the only thing that touches a canvas,
 * and only to put bytes on the screen. So the arithmetic that the tests check is exactly the arithmetic that is
 * drawn.
 */

interface Histogram {
  brightness: readonly number[]
  pixels: number
  darkest: number
  lightest: number
  meanBrightness: number
  clippedDark: number
  clippedLight: number
  says: string
  notes: readonly string[]
}

interface Region {
  id: number
  pixels: number
  left: number
  top: number
  right: number
  bottom: number
  fill: number
}

/** Puts raw bytes on a canvas. The only place in the laboratory that touches one. */
function Pixels({ width, height, data, label }: { width: number; height: number; data: ArrayBuffer; label: string }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const context = element.getContext('2d')
    if (context === null) return
    element.width = width
    element.height = height
    const made = context.createImageData(width, height)
    made.data.set(new Uint8ClampedArray(data))
    context.putImageData(made, 0, 0)
  }, [width, height, data])

  return (
    <figure className="p5-picture">
      {/* Nearest-neighbour scaling, so a pixel stays a pixel when the picture is small. */}
      <canvas ref={canvas} role="img" aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  )
}

export default function ImageLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engines = useSystems()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState('picture')

  const source = String(values.source ?? 'checkerboard')
  const size = Number(values.size ?? 128)
  const what = String(values.what ?? 'filter') as 'filter' | 'adjust' | 'threshold' | 'edges' | 'regions'
  const filter = String(values.filter ?? 'gaussian-blur')
  const radius = Number(values.radius ?? 2)
  const edgeHandling = String(values.edgeHandling ?? 'extend')
  const adjustment = String(values.adjustment ?? 'contrast')
  const amount = Number(values.amount ?? 1.5)
  const thresholdMethod = String(values.thresholdMethod ?? 'otsu')
  const level = Number(values.level ?? 128)
  const connectivity = Number(values.connectivity ?? 8) as 4 | 8
  const smallest = Number(values.smallest ?? 8)
  const blurFirst = values.blurFirst !== false
  const edgeThreshold = Number(values.edgeThreshold ?? 0)

  useEffect(() => {
    if (!engines.ready) return
    engines.ask({
      kind: 'image',
      source: source as never,
      width: 0,
      height: 0,
      data: null,
      size,
      what,
      filter: filter as never,
      radius,
      edgeHandling: edgeHandling as never,
      adjustment: adjustment as never,
      amount,
      thresholdMethod: thresholdMethod as never,
      level,
      connectivity,
      smallest,
      blurFirst,
      // Zero means "work it out from the image", which the engine treats as no threshold given.
      edgeThreshold: edgeThreshold > 0 ? edgeThreshold : null
    })
  }, [
    engines.ready,
    source,
    size,
    what,
    filter,
    radius,
    edgeHandling,
    adjustment,
    amount,
    thresholdMethod,
    level,
    connectivity,
    smallest,
    blurFirst,
    edgeThreshold
  ])

  const held = engines.image.value
  const before = held?.before as { width: number; height: number; data: ArrayBuffer } | undefined
  const after = held?.after as { width: number; height: number; data: ArrayBuffer } | null | undefined
  const histogram = (held?.histogram ?? null) as Histogram | null
  const report = (held?.report ?? null) as (Record<string, unknown> & { says?: string; notes?: readonly string[] }) | null
  const regions = (report?.regions ?? null) as readonly Region[] | null

  const tallest = histogram === null ? 1 : Math.max(1, ...histogram.brightness)

  return (
    <LabShell
      title="Image"
      summary={report?.says ?? histogram?.says}
      refused={engines.image.refused}
      broke={engines.image.broke}
      busy={engines.image.busy}
      waitingFor="Working through the pixels…"
      ready={before !== undefined}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'picture', label: 'The picture' },
        { id: 'histogram', label: 'Brightness' },
        ...(regions !== null ? [{ id: 'shapes', label: 'Shapes found' }] : [])
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {histogram !== null && (
            <Facts
              title="The picture"
              rows={[
                ['Pixels', histogram.pixels],
                ['Darkest', histogram.darkest],
                ['Lightest', histogram.lightest],
                ['Average brightness', histogram.meanBrightness.toFixed(1)],
                ['Pure black', histogram.clippedDark],
                ['Pure white', histogram.clippedLight]
              ]}
            />
          )}

          {report !== null && typeof report.multiplications === 'number' && (
            <Facts
              title="What the filter cost"
              rows={[
                ['Multiplications', report.multiplications as number],
                ['Divisor', String(report.divisor ?? '')]
              ]}
            />
          )}

          {report !== null && typeof report.clipped === 'number' && (report.clipped as number) > 0 && (
            <Facts
              title="What was lost"
              rows={[['Values flattened against the ends', report.clipped as number]]}
              about="Those pixels were pushed past the end of the range and cannot be recovered by adjusting back."
            />
          )}

          {report !== null && typeof report.level === 'number' && (
            <Facts
              title="The threshold"
              rows={[
                ['Level', (report.level as number).toFixed(0)],
                ['Chosen by', String(report.method ?? '')],
                ['Came out white', `${(((report.foreground as number) ?? 0) * 100).toFixed(1)}%`]
              ]}
            />
          )}

          {report !== null && typeof report.edgePixels === 'number' && (
            <Facts
              title="The edges"
              rows={[
                ['Edge pixels', report.edgePixels as number],
                ['Threshold used', (report.threshold as number).toFixed(0)]
              ]}
            />
          )}

          {regions !== null && (
            <Facts
              title="Shapes"
              rows={[
                ['Found', regions.length],
                ['Largest', regions.length > 0 ? `${regions[0].pixels.toLocaleString()} pixels` : '—']
              ]}
            />
          )}

          <Notes title="Worth knowing" notes={report?.notes} />
          <Notes title="About the brightness" notes={histogram?.notes} />
        </>
      }
    >
      {showing === 'picture' && before !== undefined && (
        <div className="p5-pictures">
          <Pixels width={before.width} height={before.height} data={before.data} label="before" />
          {after != null && <Pixels width={after.width} height={after.height} data={after.data} label="after" />}
        </div>
      )}

      {showing === 'histogram' && histogram !== null && (
        <>
          <h4 className="p4-heading">How many pixels at each brightness</h4>
          <div className="p5-histogram">
            {histogram.brightness.map((count, level) => (
              <span
                key={level}
                className={`p5-histogram-bar${level === 0 || level === 255 ? ' clipped' : ''}`}
                style={{ height: `${(count / tallest) * 100}%` }}
                title={`${count.toLocaleString()} pixels at ${level}`}
              />
            ))}
          </div>
          <div className="p5-histogram-scale">
            <span>black</span>
            <span>white</span>
          </div>
          <p className="p4-says">{histogram.says}</p>
        </>
      )}

      {showing === 'shapes' && regions !== null && (
        <>
          <h4 className="p4-heading">Each shape found</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th>Shape</th>
                  <th>Pixels</th>
                  <th>Box</th>
                  <th>Fills its box</th>
                </tr>
              </thead>
              <tbody>
                {regions.slice(0, 40).map((one) => (
                  <tr key={one.id}>
                    <td>{one.id}</td>
                    <td className="p4-num">{one.pixels.toLocaleString()}</td>
                    <td className="p4-num">
                      {one.right - one.left + 1} × {one.bottom - one.top + 1}
                    </td>
                    <td className="p4-num">{(one.fill * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p2-faint">
            A circle fills about 79% of the box around it and a square fills 100%, so that column says something about
            the shape without anything here knowing what the shape is.
          </p>
        </>
      )}
    </LabShell>
  )
}
