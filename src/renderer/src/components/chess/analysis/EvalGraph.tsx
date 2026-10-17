import { useMemo } from 'react'
import { graphGaps, graphSegments, type GraphPoint } from '../../../../../shared/chess/analysis'

/**
 * The evaluation, as a bar and as a graph.
 *
 * The graph is drawn as separate runs, with the stretches that were never searched shaded and left empty. A single
 * line through the whole game would be easier to draw and would put a value on every position, including the ones
 * nobody has ever calculated -- which is exactly the kind of invention this screen must not commit (Section 112).
 */

const WIDTH = 700
const HEIGHT = 110

export interface EvalGraphProps {
  points: GraphPoint[]
  /** Where the board is, so the graph can mark it. */
  cursorPly: number | null
  onPick: (ply: number) => void
}

export function EvalGraph({ points, cursorPly, onPick }: EvalGraphProps): React.JSX.Element {
  const segments = useMemo(() => graphSegments(points, { width: WIDTH, height: HEIGHT }), [points])
  const gaps = useMemo(() => graphGaps(points), [points])
  const span = Math.max(1, points.length - 1)
  const analysed = points.filter((p) => p.fraction !== null).length

  const pick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return
    const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
    onPick(Math.round(fraction * span))
  }

  const here = cursorPly === null ? null : points.find((p) => p.ply === cursorPly) ?? null
  const label = analysed === 0
    ? 'The evaluation graph is empty: nothing has been analysed yet.'
    : `The evaluation graph, from ${analysed} of ${points.length} positions. ${gaps.length ? `${gaps.length} stretch${gaps.length === 1 ? '' : 'es'} were not analysed.` : 'Every position was analysed.'}`

  return (
    <figure className="cw-an-graph">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label} onClick={pick}>
        <title>{label}</title>
        <rect className="cw-an-graph-bg" x="0" y="0" width={WIDTH} height={HEIGHT} />
        {gaps.map((gap) => {
          const x = (gap.from / span) * WIDTH
          const to = ((gap.to + 1) / span) * WIDTH
          return <rect key={`gap-${gap.from}`} className="cw-an-graph-gap" x={x} y="0" width={Math.max(1, to - x)} height={HEIGHT} />
        })}
        <line className="cw-an-graph-mid" x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} />
        {segments.map((segment) => (
          <g key={`seg-${segment.points[0].ply}`}>
            <polyline
              className="cw-an-graph-line"
              points={segment.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
            />
            {segment.points.length === 1 && <circle className="cw-an-graph-dot" cx={segment.points[0].x} cy={segment.points[0].y} r="3" />}
          </g>
        ))}
        {here && (
          <line
            className="cw-an-graph-now"
            x1={(here.ply / span) * WIDTH}
            y1="0"
            x2={(here.ply / span) * WIDTH}
            y2={HEIGHT}
          />
        )}
      </svg>
      <figcaption className="cw-an-graph-note">
        {analysed === 0
          ? 'Nothing analysed yet, so there is nothing to draw.'
          : gaps.length
            ? `Shaded stretches were not analysed: ${gaps.map((g) => (g.from === g.to ? `position ${g.from}` : `${g.from}–${g.to}`)).slice(0, 6).join(', ')}${gaps.length > 6 ? ' and more' : ''}. Nothing is drawn across them.`
            : `Every one of the ${points.length} positions has been analysed.`}
      </figcaption>
    </figure>
  )
}
