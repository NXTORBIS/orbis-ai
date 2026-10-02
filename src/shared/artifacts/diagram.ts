import { emptyArtifact, type Artifact, type ArtifactObject, type Connector } from '../pages/builders.ts'

/**
 * A flowchart from nodes and edges, laid out.
 *
 * The thing a model may propose is small and structural: boxes with labels, arrows between them with optional labels,
 * and which boxes are the start, the end or a decision. Positions are never proposed; they are worked out here, by
 * level -- every node sits one column to the right of the furthest node that points at it -- so a flow reads left to
 * right and a loop back is drawn as a loop rather than an overlap. What comes out is the builders' own `Artifact`,
 * which is editable structure, not a picture.
 */

export const DIAGRAM_LIMITS = Object.freeze({ nodes: 120, edges: 300, label: 80 })

export type NodeShape = 'step' | 'decision' | 'start' | 'end'

export interface FlowNode {
  id: string
  label: string
  shape: NodeShape
}

export interface FlowEdge {
  from: string
  to: string
  label: string
}

export interface FlowProposal {
  title: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

const COLUMN = 220
const ROW = 96
const WIDTH = 160
const HEIGHT = 56

/**
 * The column each node sits in: one past the furthest column among the nodes that point at it.
 *
 * A loop back -- "no, try again" from a decision to an earlier step -- must not push the earlier step to the right of
 * the decision it feeds. So the edges are walked first from the start nodes, in the order given, and any edge that
 * lands on a node still on the walk's own path is a back-edge and is left out of the levelling. What remains has no
 * cycles, and the longest path to each node is its column.
 */
export function levelsOf(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((one) => one.id))
  const usable = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to)
  const outOf = new Map<string, FlowEdge[]>()
  for (const edge of usable) outOf.set(edge.from, [...(outOf.get(edge.from) ?? []), edge])

  // Back-edges, found by a depth-first walk that starts at the nodes nothing points to, then at anything unvisited.
  const back = new Set<FlowEdge>()
  const state = new Map<string, 'walking' | 'done'>()
  const walk = (id: string): void => {
    state.set(id, 'walking')
    for (const edge of outOf.get(id) ?? []) {
      const at = state.get(edge.to)
      if (at === 'walking') back.add(edge)
      else if (at === undefined) walk(edge.to)
    }
    state.set(id, 'done')
  }
  const pointedAt = new Set(usable.map((edge) => edge.to))
  for (const one of nodes) if (!pointedAt.has(one.id)) walk(one.id)
  for (const one of nodes) if (!state.has(one.id)) walk(one.id)

  const into = new Map<string, string[]>()
  for (const edge of usable) {
    if (back.has(edge)) continue
    into.set(edge.to, [...(into.get(edge.to) ?? []), edge.from])
  }
  const level = new Map<string, number>()
  const depth = (id: string): number => {
    const known = level.get(id)
    if (known !== undefined) return known
    const parents = into.get(id) ?? []
    const value = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(depth))
    level.set(id, value)
    return value
  }
  for (const one of nodes) depth(one.id)
  return level
}

export function flowToArtifact(proposal: FlowProposal, id = 'diagram'): Artifact {
  const artifact = emptyArtifact(id, 'flowchart', proposal.title, 1)
  const levels = levelsOf(proposal.nodes, proposal.edges)
  const rowsUsed = new Map<number, number>()
  const layerId = artifact.layers[0]?.id ?? 'main'
  const objects: ArtifactObject[] = proposal.nodes.map((node) => {
    const column = levels.get(node.id) ?? 0
    const row = rowsUsed.get(column) ?? 0
    rowsUsed.set(column, row + 1)
    return {
      id: node.id,
      type: node.shape,
      box: { x: column * COLUMN, y: row * ROW, width: WIDTH, height: HEIGHT },
      text: node.label,
      fields: {},
      layerId,
      groupId: null,
      locked: false,
      hidden: false
    }
  })
  const byId = new Map(objects.map((one) => [one.id, one]))
  const route = router(objects)
  const connectors: Connector[] = proposal.edges
    .filter((edge) => byId.has(edge.from) && byId.has(edge.to))
    .map((edge, i) => ({ id: `c${i + 1}`, from: edge.from, to: edge.to, type: 'next', text: edge.label, layerId, waypoints: route(byId.get(edge.from)!, byId.get(edge.to)!) }))
  return { ...artifact, objects, connectors }
}

/** How far outside the boxes each loop-back lane runs; a second loop on the same side gets its own lane further out. */
const LANE = 28

type Point = { x: number; y: number }

/**
 * Where an arrow bends.
 *
 * A forward arrow is a straight line and has no bends. A loop back -- to the same column or an earlier one -- drawn
 * straight would run through every box between its ends, so it is taken round them: under the boxes when nothing sits
 * below either end, over them when nothing sits above, and otherwise out through the gap between columns, along a lane
 * under everything, and in through the gap beside the target. The gaps and the lanes never hold a box, so a routed
 * loop crosses other arrows at most, never a box.
 */
function router(objects: readonly ArtifactObject[]): (from: ArtifactObject, to: ArtifactObject) => Point[] {
  const top = Math.min(...objects.map((one) => one.box.y))
  const bottom = Math.max(...objects.map((one) => one.box.y + one.box.height))
  const sameColumn = (a: ArtifactObject, b: ArtifactObject): boolean => a.box.x === b.box.x
  const clearBelow = (one: ArtifactObject): boolean => !objects.some((other) => other !== one && sameColumn(other, one) && other.box.y > one.box.y)
  const clearAbove = (one: ArtifactObject): boolean => !objects.some((other) => other !== one && sameColumn(other, one) && other.box.y < one.box.y)
  const middle = (one: ArtifactObject): number => one.box.x + one.box.width / 2
  const gap = (COLUMN - WIDTH) / 2
  let under = 0
  let over = 0

  return (from, to) => {
    if (from === to) {
      // A step that leads back to itself: a small loop under its own box.
      const y = from.box.y + from.box.height + LANE
      return [
        { x: middle(from) + from.box.width / 4, y },
        { x: middle(from) - from.box.width / 4, y }
      ]
    }
    if (to.box.x > from.box.x) return []
    if (clearBelow(from) && clearBelow(to)) {
      under += 1
      const y = bottom + LANE * under
      return [
        { x: middle(from), y },
        { x: middle(to), y }
      ]
    }
    if (clearAbove(from) && clearAbove(to)) {
      over += 1
      const y = top - LANE * over
      return [
        { x: middle(from), y },
        { x: middle(to), y }
      ]
    }
    under += 1
    const y = bottom + LANE * under
    const out = from.box.x + from.box.width + gap
    const back = to.box.x - gap
    const fromY = from.box.y + from.box.height / 2
    const toY = to.box.y + to.box.height / 2
    return [
      { x: out, y: fromY },
      { x: out, y },
      { x: back, y },
      { x: back, y: toY }
    ]
  }
}
