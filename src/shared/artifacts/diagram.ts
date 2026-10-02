import { emptyArtifact, type Artifact, type ArtifactObject, type Connector } from '../pages/builders.ts'

/**
 * A flowchart from nodes and edges, laid out.
 *
 * The thing a model may propose is small and structural: boxes with labels, arrows between them with optional labels,
 * and which boxes are the start, the end or a decision. Positions are never proposed; they are worked out here, by
 * level -- every node sits one level past the furthest node that points at it -- so a flow reads in one direction
 * (across the page when it is short, down it when it is long) and a loop back is drawn as a loop, not an overlap. What comes out is the builders' own `Artifact`,
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

/** A flow with more levels than this runs down the page; a short one runs across it. */
const ACROSS_UP_TO = 5

/** How far apart boxes sit along the flow and across it, for each direction. */
const PITCH = Object.freeze({
  across: { along: COLUMN, beside: ROW },
  down: { along: ROW, beside: COLUMN - 20 }
})

export function flowToArtifact(proposal: FlowProposal, id = 'diagram'): Artifact {
  const artifact = emptyArtifact(id, 'flowchart', proposal.title, 1)
  const levels = levelsOf(proposal.nodes, proposal.edges)
  const depth = Math.max(0, ...levels.values()) + 1
  // A flow of many steps drawn left to right is one long strip, shrunk until nobody can read the labels. Past a few
  // levels it runs down the page instead, which is also the way a long procedure is usually drawn.
  const direction: 'across' | 'down' = depth > ACROSS_UP_TO ? 'down' : 'across'
  const pitch = PITCH[direction]
  const used = new Map<number, number>()
  const layerId = artifact.layers[0]?.id ?? 'main'
  const objects: ArtifactObject[] = proposal.nodes.map((node) => {
    const level = levels.get(node.id) ?? 0
    const place = used.get(level) ?? 0
    used.set(level, place + 1)
    return {
      id: node.id,
      type: node.shape,
      box: direction === 'across' ? { x: level * pitch.along, y: place * pitch.beside, width: WIDTH, height: HEIGHT } : { x: place * pitch.beside, y: level * pitch.along, width: WIDTH, height: HEIGHT },
      text: node.label,
      fields: {},
      layerId,
      groupId: null,
      locked: false,
      hidden: false
    }
  })
  const byId = new Map(objects.map((one) => [one.id, one]))
  const route = router(objects, direction)
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
 * A forward arrow is a straight line and has no bends. A loop back -- to the same level or an earlier one -- drawn
 * straight would run through every box between its ends, so it is taken round them: along a lane on one side of the
 * flow when nothing sits on that side of either end, along the other side when that is clear, and otherwise out
 * through the gap between levels, along a lane past everything, and in through the gap before the target. The gaps
 * and the lanes never hold a box, so a routed loop crosses other arrows at most, never a box.
 *
 * Worked out in the flow's own terms -- `u` along the flow, `v` across it -- and turned into x and y at the end, so
 * a flow that runs across the page and one that runs down it are the same routing and cannot drift apart.
 */
function router(objects: readonly ArtifactObject[], direction: 'across' | 'down'): (from: ArtifactObject, to: ArtifactObject) => Point[] {
  const across = direction === 'across'
  // A box in flow terms: where it starts and how long it is along the flow, and the same across it.
  const flow = (one: ArtifactObject): { u: number; uSize: number; v: number; vSize: number } =>
    across ? { u: one.box.x, uSize: one.box.width, v: one.box.y, vSize: one.box.height } : { u: one.box.y, uSize: one.box.height, v: one.box.x, vSize: one.box.width }
  const point = (u: number, v: number): Point => (across ? { x: u, y: v } : { x: v, y: u })
  const boxes = objects.map(flow)
  const first = Math.min(...boxes.map((one) => one.v))
  const last = Math.max(...boxes.map((one) => one.v + one.vSize))
  const sameLevel = (a: ArtifactObject, b: ArtifactObject): boolean => flow(a).u === flow(b).u
  const clearAfter = (one: ArtifactObject): boolean => !objects.some((other) => other !== one && sameLevel(other, one) && flow(other).v > flow(one).v)
  const clearBefore = (one: ArtifactObject): boolean => !objects.some((other) => other !== one && sameLevel(other, one) && flow(other).v < flow(one).v)
  const pitch = PITCH[direction]
  let after = 0
  let before = 0

  return (from, to) => {
    const a = flow(from)
    const b = flow(to)
    const aMid = a.u + a.uSize / 2
    const bMid = b.u + b.uSize / 2
    if (from === to) {
      // A step that leads back to itself: a small loop on the far side of its own box.
      const v = a.v + a.vSize + LANE
      return [point(aMid + a.uSize / 4, v), point(aMid - a.uSize / 4, v)]
    }
    if (b.u > a.u) return []
    if (clearAfter(from) && clearAfter(to)) {
      after += 1
      const v = last + LANE * after
      return [point(aMid, v), point(bMid, v)]
    }
    if (clearBefore(from) && clearBefore(to)) {
      before += 1
      const v = first - LANE * before
      return [point(aMid, v), point(bMid, v)]
    }
    after += 1
    const v = last + LANE * after
    const gap = (pitch.along - a.uSize) / 2
    const out = a.u + a.uSize + gap
    const back = b.u - gap
    return [point(out, a.v + a.vSize / 2), point(out, v), point(back, v), point(back, b.v + b.vSize / 2)]
  }
}
