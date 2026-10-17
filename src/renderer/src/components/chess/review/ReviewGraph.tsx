import { useMemo } from 'react'
import { barFraction, formatScore } from '../../../../../shared/chess/evaluation'
import { graphGaps, graphSegments, type GraphPoint } from '../../../../../shared/chess/analysis'
import type { KeyMoment } from '../../../../../shared/chess/review'

/**
 * The game's evaluation, with a scale on both sides of it.
 *
 * It is drawn as separate runs, broken wherever nothing was searched, for the reason the Studio's graph is: one line
 * through the whole game would put a value on every position, including the ones nobody has calculated. The shaded
 * stretches are the holes, and the caption names them.
 *
 * What this adds to the Studio's graph is the two things it has not got -- a move axis along the bottom and an
 * evaluation scale up the side -- so a point's height can be read rather than guessed, and the key moments marked on
 * it so the list beside it and the picture agree (Section 119).
 *
 * Up is always White, and the graph says so. It does not turn over with the board: every number in Orbis is stored
 * from White's point of view, the scale up the side is written in those numbers, and a graph that flipped while its
 * own labels did not would be the one kind of mistake a picture of an evaluation cannot afford (Section 111).
 */

const WIDTH = 720
const HEIGHT = 150

/** The lines up the side. Level, a pawn either way, three and five: as far apart as the curve allows. */
const RUNGS: readonly number[] = Object.freeze([500, 300, 100, 0, -100, -300, -500])

export interface ReviewGraphProps {
  points: readonly GraphPoint[]
  moments: readonly KeyMoment[]
  /** Where the board is. */
  cursorPly: number | null
  onPick: (ply: number) => void
  /**
   * The move number at a position, for the axis.
   *
   * Handed in rather than worked out from the ply, because half of it cannot be: a game set up from a position
   * starts at whatever move that position is at, and dividing the ply by two would label it from 1 regardless.
   */
  numberAt: (ply: number) => number
}

export function ReviewGraph({ points, moments, cursorPly, onPick, numberAt }: ReviewGraphProps): React.JSX.Element {
  const list = useMemo(() => [...points], [points])
  const segments = useMemo(() => graphSegments(list, { width: WIDTH, height: HEIGHT }), [list])
  const gaps = useMemo(() => graphGaps(list), [list])
  const span = Math.max(1, list.length - 1)
  const analysed = list.filter((one) => one.fraction !== null).length
  const y = (fraction: number): number => (1 - fraction) * HEIGHT
  const x = (ply: number): number => (ply / span) * WIDTH

  const pick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return
    const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
    onPick(Math.round(fraction * span))
  }

  // One number every ten moves, which is a move list's own rhythm and few enough to read.
  const ticks: number[] = []
  for (let ply = 0; ply <= span; ply += 20) ticks.push(ply)
  if (ticks[ticks.length - 1] !== span) ticks.push(span)

  const here = cursorPly === null ? null : list.find((one) => one.ply === cursorPly) ?? null
  const label = analysed === 0
    ? 'The evaluation graph is empty: nothing has been searched yet.'
    : `The evaluation graph, from ${analysed} of ${list.length} positions. Up is White.`
      + (gaps.length ? ` ${gaps.length} stretch${gaps.length === 1 ? '' : 'es'} were not searched and are left blank.` : ' Every position was searched.')

  return (
    <figure className="cw-rv-graph">
      <div className="cw-rv-graph-frame">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label} onClick={pick}>
          <title>{label}</title>
          <rect className="cw-rv-graph-bg" x="0" y="0" width={WIDTH} height={HEIGHT} />
          {gaps.map((gap) => {
            const from = x(gap.from)
            const to = x(gap.to + 1)
            return <rect key={`gap-${gap.from}`} className="cw-rv-graph-gap" x={from} y="0" width={Math.max(1, to - from)} height={HEIGHT} />
          })}
          {RUNGS.map((cp) => (
            <line
              key={`rung-${cp}`}
              className={cp === 0 ? 'cw-rv-graph-mid' : 'cw-rv-graph-rung'}
              x1="0"
              x2={WIDTH}
              y1={y(barFraction({ kind: 'cp', cp }))}
              y2={y(barFraction({ kind: 'cp', cp }))}
            />
          ))}
          {ticks.map((ply) => (
            <line key={`tick-${ply}`} className="cw-rv-graph-tick" x1={x(ply)} x2={x(ply)} y1={HEIGHT - 6} y2={HEIGHT} />
          ))}
          {segments.map((segment) => (
            <g key={`seg-${segment.points[0].ply}`}>
              <polyline className="cw-rv-graph-line" fill="none" points={segment.points.map((one) => `${one.x},${one.y}`).join(' ')} />
              {segment.points.length === 1 && (
                <circle className="cw-rv-graph-dot" cx={segment.points[0].x} cy={segment.points[0].y} r="3" />
              )}
            </g>
          ))}
          {moments.map((moment) => {
            const point = list.find((one) => one.ply === moment.ply)
            if (!point || point.fraction === null) return null
            return <circle key={`moment-${moment.ply}`} className="cw-rv-graph-moment" cx={x(moment.ply)} cy={y(point.fraction)} r="5" />
          })}
          {here && <line className="cw-rv-graph-now" x1={x(here.ply)} x2={x(here.ply)} y1="0" y2={HEIGHT} />}
        </svg>
        {/*
          * The scale is text beside the picture rather than text inside it. The SVG is stretched to the width it is
          * given, and anything drawn in it stretches with it -- which would leave the numbers wider than they are
          * tall on a wide screen and unreadable on a narrow one.
          */}
        <ul className="cw-rv-graph-scale" aria-hidden="true">
          {RUNGS.map((cp) => (
            <li key={`scale-${cp}`} style={{ top: `${(y(barFraction({ kind: 'cp', cp })) / HEIGHT) * 100}%` }}>
              {cp === 0 ? '0.00' : formatScore({ kind: 'cp', cp })}
            </li>
          ))}
        </ul>
      </div>
      <ul className="cw-rv-graph-axis" aria-hidden="true">
        {ticks.map((ply) => (
          <li key={`axis-${ply}`} style={{ left: `${(x(ply) / WIDTH) * 100}%` }}>{numberAt(ply)}</li>
        ))}
      </ul>
      <figcaption className="cw-rv-graph-note">
        {analysed === 0
          ? 'Nothing has been searched yet, so there is nothing to draw.'
          : 'Up the side: how far ahead White is, in pawns, on a scale that puts a forced mate at the very end so one mate'
            + ' does not flatten the rest. Along the bottom: the move number. '
            + (gaps.length
              ? `The blank stretches were never searched (${gaps.map((one) => (one.from === one.to ? `position ${one.from}` : `${one.from}–${one.to}`)).slice(0, 6).join(', ')}${gaps.length > 6 ? ' and more' : ''}); nothing is drawn across them.`
              : `All ${list.length} positions were searched.`)}
      </figcaption>
    </figure>
  )
}
