import { useMemo } from 'react'

/**
 * The pictures the laboratories draw with.
 *
 * ## Why these exist
 *
 * Every laboratory could already say what happened. None of them could show it. A scheduler reported an average
 * waiting time where it should draw who had the processor and when; a pipeline reported a stall count where it should
 * draw the stall; a network reported a hop count where it should draw the network. Numbers in a table are the summary
 * of a thing somebody wanted to watch, and a laboratory that only summarises is a report, not a laboratory.
 *
 * So: five shapes, shared, because a Gantt chart of a scheduler and a Gantt chart of a pipeline are the same picture,
 * and two copies of a picture is two places for an axis to be wrong.
 *
 * ## Nothing here decides anything
 *
 * Every one of these takes what an engine already worked out and turns it into SVG. None of them computes a value,
 * rounds one, or leaves one out because it would look untidy. A cell with no value is drawn empty rather than filled
 * with a guess, and a scale that has to cover an outlier covers it.
 *
 * ## Why SVG rather than a canvas
 *
 * These are diagrams, not photographs: tens or hundreds of shapes, each of which wants a title and a colour that
 * follows the theme. The one laboratory that really is a photograph -- the Image Laboratory -- uses a canvas, which is
 * correct for it and wrong for everything here.
 */

/** Orbis's own series colours, so every picture in every laboratory agrees with every other. */
export const TONES = ['var(--cyan)', '#f0a33a', '#37d67a', '#c08bf0', '#e05c5c', '#5cc8e0', '#e8c547', '#8fa6ff'] as const

const tone = (at: number): string => TONES[((at % TONES.length) + TONES.length) % TONES.length]

// ---------------------------------------------------------------- a timeline of who had what

export interface Bar {
  /** The row this belongs in: a process, a resource, a worker. */
  row: string
  start: number
  end: number
  /** What to write in it, when it fits. Defaults to the row's name. */
  label?: string
  /** Which colour. Bars of one row share a tone unless this says otherwise. */
  group?: number
  /** Drawn hatched: idle, waiting, a bubble. */
  idle?: boolean
}

export interface GanttProps {
  bars: readonly Bar[]
  /** The rows, in the order they should be stacked. Rows with no bars are still drawn, which is itself a fact. */
  rows: readonly string[]
  xLabel?: string
  /** Vertical lines with a word under them: a deadline, a quantum boundary, a context switch. */
  marks?: readonly { at: number; label?: string }[]
  about?: string
}

/**
 * Who had the thing, and when.
 *
 * Used by the scheduler (which process had the processor), the pipeline (which instruction was in which stage) and
 * anything else where the answer is a period of time belonging to somebody.
 */
export function Gantt({ bars, rows, xLabel = 'time', marks = [], about }: GanttProps): React.JSX.Element {
  /*
   * A narrow drawing surface on purpose.
   *
   * These are drawn into a card about 380px wide, and an SVG laid out at 640 is scaled down by nearly half -- which
   * takes an 11px label with it, to six pixels. Laying it out close to the size it is shown at keeps the text the
   * size the stylesheet says.
   */
  const width = 440
  const left = 78
  const rowHeight = 28
  const top = 6
  const height = top + rows.length * rowHeight + 30

  const last = Math.max(1, ...bars.map((one) => one.end), ...marks.map((one) => one.at))
  const span = width - left - 12
  const at = (value: number): number => left + (value / last) * span

  const groupOf = new Map(rows.map((one, index) => [one, index]))

  return (
    <figure className="na-draw">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`A timeline of ${rows.length} rows`} className="na-svg">
        {rows.map((row, index) => (
          <g key={row}>
            <line x1={left} x2={width - 12} y1={top + index * rowHeight + rowHeight} y2={top + index * rowHeight + rowHeight} className="na-rule" />
            <text x={left - 8} y={top + index * rowHeight + rowHeight * 0.68} className="na-row-label" textAnchor="end">
              {row}
            </text>
          </g>
        ))}

        {marks.map((mark, index) => (
          <g key={`${mark.at}-${index}`}>
            <line x1={at(mark.at)} x2={at(mark.at)} y1={top} y2={top + rows.length * rowHeight} className="na-mark" />
            {mark.label !== undefined && (
              <text x={at(mark.at)} y={top + rows.length * rowHeight + 22} className="na-tick" textAnchor="middle">
                {mark.label}
              </text>
            )}
          </g>
        ))}

        {bars.map((bar, index) => {
          const row = groupOf.get(bar.row) ?? 0
          const x = at(bar.start)
          const w = Math.max(1.5, at(bar.end) - x)
          const y = top + row * rowHeight + 4
          const colour = bar.idle ? 'var(--glass-border)' : tone(bar.group ?? row)
          return (
            <g key={`${bar.row}-${bar.start}-${index}`}>
              <rect x={x} y={y} width={w} height={rowHeight - 9} rx={3} fill={colour} opacity={bar.idle ? 0.35 : 0.85}>
                <title>{`${bar.label ?? bar.row}: ${bar.start} to ${bar.end}`}</title>
              </rect>
              {w > 26 && (
                <text x={x + w / 2} y={y + rowHeight * 0.48} className="na-in-bar" textAnchor="middle">
                  {bar.label ?? bar.row}
                </text>
              )}
            </g>
          )
        })}

        <text x={left + span / 2} y={height - 4} className="na-axis" textAnchor="middle">
          {xLabel}
        </text>
      </svg>
      {about !== undefined && <figcaption className="na-draw-note">{about}</figcaption>}
    </figure>
  )
}

// ---------------------------------------------------------------- a grid of cells

export interface Cell {
  column: number
  row: number
  /** What to write in it. Empty means an empty cell, which is drawn empty. */
  text?: string
  /** 0 and above picks a tone; -1 draws it plain; -2 draws it as a fault. */
  group?: number
  title?: string
}

export interface CellGridProps {
  columns: readonly string[]
  rows: readonly string[]
  cells: readonly Cell[]
  about?: string
  /** How wide a column is, in pixels. Narrow for a pipeline with forty cycles. */
  cellWidth?: number
}

/**
 * A grid where the position means something: a stage against a cycle, a frame against a reference, a set against a way.
 *
 * The pipeline diagram every processor course draws by hand, and the page-frame table every operating-systems course
 * draws by hand, are the same grid.
 */
export function CellGrid({ columns, rows, cells, about, cellWidth = 30 }: CellGridProps): React.JSX.Element {
  const left = 76
  const cellHeight = 24
  const top = 22
  const width = left + columns.length * cellWidth + 10
  const height = top + rows.length * cellHeight + 24

  return (
    <figure className="na-draw">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="A grid" className="na-svg" preserveAspectRatio="xMinYMin meet">
        {columns.map((column, index) => (
          <text key={`c${index}`} x={left + index * cellWidth + cellWidth / 2} y={top - 7} className="na-tick" textAnchor="middle">
            {column}
          </text>
        ))}
        {rows.map((row, index) => (
          <text key={`r${index}`} x={left - 8} y={top + index * cellHeight + cellHeight * 0.68} className="na-row-label" textAnchor="end">
            {row}
          </text>
        ))}
        {cells.map((cell, index) => {
          const x = left + cell.column * cellWidth
          const y = top + cell.row * cellHeight
          const fill = cell.group === undefined || cell.group === -1 ? 'transparent' : cell.group === -2 ? '#e05c5c' : tone(cell.group)
          return (
            <g key={`${cell.column}-${cell.row}-${index}`}>
              <rect x={x + 1} y={y + 1} width={cellWidth - 2} height={cellHeight - 2} rx={3} fill={fill} opacity={fill === 'transparent' ? 1 : 0.8} className="na-cell">
                {cell.title !== undefined && <title>{cell.title}</title>}
              </rect>
              {cell.text !== undefined && cell.text !== '' && (
                <text x={x + cellWidth / 2} y={y + cellHeight * 0.68} className="na-in-cell" textAnchor="middle">
                  {cell.text}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {about !== undefined && <figcaption className="na-draw-note">{about}</figcaption>}
    </figure>
  )
}

// ---------------------------------------------------------------- things joined to other things

export interface Node {
  id: string
  label: string
  /** Which column to place it in. Left out, the layout works one out from the links. */
  depth?: number
  /** 0 and above picks a tone. */
  group?: number
  /** Written small under the name: a value, an address, a state. */
  note?: string
}

export interface Edge {
  from: string
  to: string
  label?: string
  /** Drawn thick and in the accent: a chosen route, a critical path, an active wire. */
  marked?: boolean
  /** Drawn dashed and faint: a link that is down, a wire that is undriven. */
  faint?: boolean
}

export interface DiagramProps {
  nodes: readonly Node[]
  edges: readonly Edge[]
  about?: string
  height?: number
}

/**
 * Boxes joined by lines, laid out left to right by how far each is from an input.
 *
 * A logic circuit, a network, and a neural network are all this picture. The layout is the simplest one that is
 * honest: depth by longest path from something with no inputs, then spread evenly down each column. It makes no
 * attempt to avoid crossings -- a tidier layout that moved a node would be saying something about the circuit that
 * the circuit does not say.
 */
export function Diagram({ nodes, edges, about, height = 260 }: DiagramProps): React.JSX.Element {
  const placed = useMemo(() => {
    const depth = new Map<string, number>()
    for (const node of nodes) if (node.depth !== undefined) depth.set(node.id, node.depth)

    if (depth.size !== nodes.length) {
      const incoming = new Map<string, string[]>()
      for (const node of nodes) incoming.set(node.id, [])
      for (const edge of edges) incoming.get(edge.to)?.push(edge.from)
      // Bounded by the node count: a cycle cannot push the walk past that, and a logic circuit may well have one.
      for (let round = 0; round < nodes.length + 1; round += 1) {
        let moved = false
        for (const node of nodes) {
          if (node.depth !== undefined) continue
          const feeders = incoming.get(node.id) ?? []
          const known = feeders.map((one) => depth.get(one)).filter((one): one is number => one !== undefined)
          const want = feeders.length === 0 ? 0 : known.length === 0 ? 0 : Math.max(...known) + 1
          if (depth.get(node.id) !== want) {
            depth.set(node.id, want)
            moved = true
          }
        }
        if (!moved) break
      }
    }

    const columns = new Map<number, Node[]>()
    for (const node of nodes) {
      const at = depth.get(node.id) ?? 0
      const held = columns.get(at)
      if (held) held.push(node)
      else columns.set(at, [node])
    }
    const deepest = Math.max(0, ...columns.keys())
    const tallest = Math.max(1, ...[...columns.values()].map((one) => one.length))
    const out = new Map<string, { x: number; y: number }>()
    for (const [at, held] of columns) {
      held.forEach((node, index) => {
        out.set(node.id, {
          x: deepest === 0 ? 0.5 : 0.08 + (at / deepest) * 0.84,
          y: (index + 1) / (held.length + 1)
        })
      })
    }
    return { positions: out, tallest }
  }, [nodes, edges])

  const width = 440
  const tall = Math.max(height, placed.tallest * 46 + 30)
  const boxWidth = 74
  const boxHeight = 36
  const where = (id: string): { x: number; y: number } => {
    const found = placed.positions.get(id) ?? { x: 0.5, y: 0.5 }
    return { x: found.x * width, y: found.y * tall }
  }

  return (
    <figure className="na-draw">
      <svg viewBox={`0 0 ${width} ${tall}`} role="img" aria-label={`${nodes.length} things and ${edges.length} connections`} className="na-svg">
        {edges.map((edge, index) => {
          const a = where(edge.from)
          const b = where(edge.to)
          const midX = (a.x + b.x) / 2
          return (
            <g key={`${edge.from}-${edge.to}-${index}`}>
              <path
                d={`M ${a.x + boxWidth / 2} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x - boxWidth / 2} ${b.y}`}
                className={`na-edge${edge.marked ? ' marked' : ''}${edge.faint ? ' faint' : ''}`}
                fill="none"
              />
              {edge.label !== undefined && (
                <text x={midX} y={(a.y + b.y) / 2 - 4} className="na-edge-label" textAnchor="middle">
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}
        {nodes.map((node) => {
          const p = where(node.id)
          return (
            <g key={node.id}>
              <rect
                x={p.x - boxWidth / 2}
                y={p.y - boxHeight / 2}
                width={boxWidth}
                height={boxHeight}
                rx={7}
                fill={node.group === undefined ? 'var(--panel-2, rgba(255,255,255,0.04))' : tone(node.group)}
                opacity={node.group === undefined ? 1 : 0.8}
                className="na-node"
              >
                <title>{node.note ? `${node.label} — ${node.note}` : node.label}</title>
              </rect>
              <text x={p.x} y={node.note === undefined ? p.y + 4 : p.y - 2} className="na-node-label" textAnchor="middle">
                {node.label}
              </text>
              {node.note !== undefined && (
                <text x={p.x} y={p.y + 11} className="na-node-note" textAnchor="middle">
                  {node.note}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {about !== undefined && <figcaption className="na-draw-note">{about}</figcaption>}
    </figure>
  )
}

// ---------------------------------------------------------------- digital waveforms

export interface Wave {
  name: string
  /** One value per tick. */
  values: readonly boolean[]
}

/**
 * Square waves, one row per signal, the way a logic analyser draws them.
 *
 * A counter's output as a table of ones and zeros is a table somebody has to read a row at a time. As waveforms the
 * doubling period of each bit is simply visible, which is the whole thing a counter is for.
 */
export function Waves({ waves, about }: { waves: readonly Wave[]; about?: string }): React.JSX.Element {
  const left = 70
  const perTick = Math.max(6, Math.min(26, 560 / Math.max(1, waves[0]?.values.length ?? 1)))
  const rowHeight = 34
  const width = left + (waves[0]?.values.length ?? 0) * perTick + 12
  const height = waves.length * rowHeight + 24

  return (
    <figure className="na-draw">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${waves.length} signals over time`} className="na-svg" preserveAspectRatio="xMinYMin meet">
        {waves.map((wave, index) => {
          const base = index * rowHeight + rowHeight - 8
          const high = index * rowHeight + 8
          let d = `M ${left} ${wave.values[0] ? high : base}`
          wave.values.forEach((on, tick) => {
            const x = left + tick * perTick
            const y = on ? high : base
            d += ` L ${x} ${y} L ${x + perTick} ${y}`
          })
          return (
            <g key={wave.name}>
              <text x={left - 8} y={index * rowHeight + rowHeight / 2 + 4} className="na-row-label" textAnchor="end">
                {wave.name}
              </text>
              <path d={d} className="na-wave" fill="none" />
            </g>
          )
        })}
      </svg>
      {about !== undefined && <figcaption className="na-draw-note">{about}</figcaption>}
    </figure>
  )
}

// ---------------------------------------------------------------- points, and what a model decided about them

export interface Dot {
  x: number
  y: number
  /** Which class it belongs to. Picks the tone. */
  group: number
}

export interface ScatterProps {
  dots: readonly Dot[]
  /**
   * A square grid of model outputs covering the same area, drawn behind the points.
   *
   * This is what makes a classifier visible: the regions it would put each part of the plane into, with the data on
   * top of them. Absent when the model cannot be asked about a point it has not seen.
   *
   * Row-major **from the top**, the way the workers build it: the first row is the highest value of the vertical
   * axis. Drawing it from the bottom instead would flip every boundary upside down against its own data, which is
   * the kind of wrong that still looks plausible.
   */
  field?: { size: number; values: readonly number[]; least: number; most: number } | null
  xLabel?: string
  yLabel?: string
  about?: string
}

export function Scatter({ dots, field = null, xLabel = 'feature 1', yLabel = 'feature 2', about }: ScatterProps): React.JSX.Element {
  const size = 320
  const pad = 26

  const bounds = useMemo(() => {
    if (!dots.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    const xs = dots.map((one) => one.x)
    const ys = dots.map((one) => one.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    // A margin, so a point on the edge is a point rather than half a point on the axis.
    const padX = (maxX - minX || 1) * 0.06
    const padY = (maxY - minY || 1) * 0.06
    return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY }
  }, [dots])

  const toX = (value: number): number => pad + ((value - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * (size - pad * 2)
  const toY = (value: number): number => size - pad - ((value - bounds.minY) / (bounds.maxY - bounds.minY || 1)) * (size - pad * 2)

  return (
    <figure className="na-draw">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${dots.length} points`} className="na-svg na-scatter">
        {field !== null && field.size > 1 && (
          <g opacity={0.45}>
            {Array.from({ length: field.size * field.size }, (_, index) => {
              const column = index % field.size
              const row = Math.floor(index / field.size)
              const value = field.values[index]
              if (value === undefined) return null
              const span = (size - pad * 2) / field.size
              const share = field.most === field.least ? 0.5 : (value - field.least) / (field.most - field.least)
              return (
                <rect
                  key={index}
                  x={pad + column * span}
                  y={pad + row * span}
                  width={span + 0.5}
                  height={span + 0.5}
                  fill={share > 0.5 ? TONES[0] : TONES[1]}
                  opacity={Math.abs(share - 0.5) * 1.6}
                />
              )
            })}
          </g>
        )}

        <rect x={pad} y={pad} width={size - pad * 2} height={size - pad * 2} className="na-frame" fill="none" />
        {dots.map((dot, index) => (
          <circle key={index} cx={toX(dot.x)} cy={toY(dot.y)} r={3} fill={tone(dot.group)} className="na-dot">
            <title>{`${dot.x.toFixed(3)}, ${dot.y.toFixed(3)} — group ${dot.group}`}</title>
          </circle>
        ))}
        <text x={size / 2} y={size - 6} className="na-axis" textAnchor="middle">
          {xLabel}
        </text>
        <text x={10} y={size / 2} className="na-axis" textAnchor="middle" transform={`rotate(-90 10 ${size / 2})`}>
          {yLabel}
        </text>
      </svg>
      {about !== undefined && <figcaption className="na-draw-note">{about}</figcaption>}
    </figure>
  )
}
