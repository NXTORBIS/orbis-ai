import {
  applyMove, moveNumber, positionKey, sideToMove, uciLineToSan,
  type ChessMove, type MoveInput
} from './rules.ts'
import {
  addToTree, fenAt, newTree, pathTo, removeBranch, treeProblems,
  type GameMove, type StoredGame, type VariationNode, type VariationTree
} from './model.ts'
import {
  CLASS_LABEL, barFraction, classify, forSide, formatScore, lossFrom,
  type MoveClass, type Score, type Side
} from './evaluation.ts'

/**
 * Looking at a game: the line that was played, the lines that were not, and what the engine said about them.
 *
 * Four rules hold through everything below, and most of the shape of this file comes from them (Sections 101-130):
 *
 *   - **The game is not edited by looking at it.** `session.game` is the record that came out of the store and it is
 *     never touched. Exploring adds branches to a tree; promoting a branch changes which branch the tree calls its
 *     main line; neither writes a move into the game. Saving a game back is a separate, deliberate act somewhere
 *     else, and this module gives it nothing to do by accident (Section 105).
 *
 *   - **A note belongs to a position, not to a row in a list.** Annotations are keyed by node id. Promote a branch,
 *     delete a line, put one back, and the note is still on the move it was written about -- which is not true of
 *     anything keyed by "the 23rd move", because that number means a different move afterwards (Section 118).
 *
 *   - **What was not analysed is not analysed.** The graph has holes in it where nothing was searched, and the holes
 *     are the honest answer. Nothing is interpolated, no missing score becomes a zero, and a move searched too
 *     shallowly to judge is reported as not judged rather than named from a number that cannot carry it
 *     (Sections 111, 114).
 *
 *   - **An engine's answer is only about the position it was asked.** Every update carries the request it belongs to
 *     and the position it was calculated in, and `acceptUpdate` throws away anything that does not match both. A
 *     score shown against the wrong position is worse than no score (Sections 048, 327).
 *
 * There is no engine in here and no clock: it is all plain functions over values, so a whole game's worth of
 * reasoning can be put through a test without a process, a window or a wait.
 */

// ---------------------------------------------------------------- what is kept about a position

/** A person's note on one position. The source's own comment is kept apart, on the move itself. */
export interface Annotation {
  text?: string
  /** !, ?, !! and the rest, as the person chose them. */
  nags?: string[]
  updatedAt: number
}

/** What the engine said about one node of the tree, kept in fuller detail than the tree's own field holds. */
export interface NodeEvaluation {
  /** The position this was calculated in. Kept so a record can be checked against the node it sits on. */
  fen: string
  /** White-positive, as every score in Orbis is. */
  score: Score
  depth: number | null
  /** The engine's best move here, in its own coordinates, when it named one. */
  bestmove?: string | null
  /** The line it gave, in coordinates. Turned into notation when it is shown, against this position. */
  pvUci?: string[]
  engine?: string
  at?: number
  /** True when the engine only gave a bound, so the number is not settled. */
  provisional?: boolean
}

// ---------------------------------------------------------------- the session

export type Reversible =
  | { kind: 'promote'; what: string; cursor: string; moved: { nodeId: string; from: number }[] }
  | { kind: 'annotate'; what: string; cursor: string; nodeId: string; before: Annotation | null }
  | {
      kind: 'remove'
      what: string
      cursor: string
      parentId: string
      index: number
      nodes: VariationNode[]
      annotations: Record<string, Annotation>
      evaluations: Record<string, NodeEvaluation>
    }

export interface AnalysisSession {
  /** The game as the store has it. Nothing in this module ever returns a session with a different one. */
  readonly game: StoredGame
  readonly tree: VariationTree
  /** The nodes of the game as it was played, root first. Fixed when the session opens; exploring never changes it. */
  readonly original: string[]
  /** Where we are looking. */
  readonly cursor: string
  readonly annotations: Record<string, Annotation>
  readonly evaluations: Record<string, NodeEvaluation>
  /** Operations that can be taken back, most recent last. */
  readonly undoStack: Reversible[]
  /** Said plainly when the game itself could not be laid out in full. Null when it could. */
  readonly note: string | null
  /** Used to make the next node id. Kept on the session so ids do not depend on a counter living somewhere else. */
  readonly counter: number
}

const ROOT = 'root'

function ids(start: number): { next: () => string; used: () => number } {
  let n = start
  return {
    next: () => {
      n += 1
      return `n${n}`
    },
    used: () => n
  }
}

/**
 * Opening a game for analysis.
 *
 * The game's moves become the first chain of the tree, so "the main line" is simply the line you get by always
 * taking a node's first child -- which is what `addToTree` appends to and what `promote` reorders. A game carrying a
 * move that cannot be played stops there and says so rather than producing a tree that disagrees with the rules.
 */
export function openSession(game: StoredGame): AnalysisSession {
  const make = ids(0)
  let tree = newTree(game.startFen, ROOT)
  const original: string[] = [ROOT]
  let note: string | null = null
  let at = game.startFen
  for (const [index, move] of game.moves.entries()) {
    const made = applyMove(at, move.uci || move.san)
    if (!made) {
      note = `This game stops being playable at move ${index + 1} (${move.san}), so only the moves before it are laid out.`
      break
    }
    // The stored move is used as it stands, but with the position the rules just produced: a stored FEN that drifted
    // from the move beside it would otherwise be carried into every line built on top of it.
    const added = addToTree(tree, original[original.length - 1], { ...move, san: made.san, uci: made.uci, fen: made.after }, make.next)
    if (!added) break
    tree = added.tree
    original.push(added.nodeId)
    at = made.after
  }
  return {
    game,
    tree,
    original,
    cursor: ROOT,
    annotations: {},
    evaluations: {},
    undoStack: [],
    note,
    counter: make.used()
  }
}

/** The position the cursor is on. */
export function cursorFen(s: AnalysisSession): string {
  return s.tree.nodes[s.cursor]?.fen ?? s.game.startFen
}

export function nodeAt(s: AnalysisSession, nodeId: string): VariationNode | null {
  return s.tree.nodes[nodeId] ?? null
}

/** How far a node is from the start, in moves played. The root is 0. */
export function plyOf(s: AnalysisSession, nodeId: string): number {
  return Math.max(0, pathTo(s.tree, nodeId).length - 1)
}

/** The main line, as node ids: always the first child, all the way down. */
export function mainLine(s: AnalysisSession): string[] {
  const line = [s.tree.rootId]
  const seen = new Set(line)
  let current = s.tree.nodes[s.tree.rootId]
  while (current && current.children.length) {
    const next = current.children[0]
    if (seen.has(next)) break
    seen.add(next)
    line.push(next)
    current = s.tree.nodes[next]
  }
  return line
}

/**
 * Where a node's line left the main line, or null when the node is on it.
 *
 * This is what "leave the branch" needs to know, and it cannot be worked out from the node alone: it is the first
 * step down from the main line on the way to it.
 */
export function branchPoint(s: AnalysisSession, nodeId: string = s.cursor): string | null {
  const path = pathTo(s.tree, nodeId)
  for (let i = 1; i < path.length; i++) {
    const parent = path[i - 1]
    if (parent.children[0] !== path[i].id) return parent.id
  }
  return null
}

export function onMainLine(s: AnalysisSession, nodeId: string = s.cursor): boolean {
  return branchPoint(s, nodeId) === null
}

/** The alternatives at a node: everything after its first child. */
export function branchesAt(s: AnalysisSession, nodeId: string = s.cursor): { nodeId: string; san: string }[] {
  const node = s.tree.nodes[nodeId]
  if (!node) return []
  return node.children.slice(1).flatMap((id) => {
    const child = s.tree.nodes[id]
    return child?.move ? [{ nodeId: id, san: child.move.san }] : []
  })
}

// ---------------------------------------------------------------- navigation

export function jump(s: AnalysisSession, nodeId: string): AnalysisSession {
  if (!s.tree.nodes[nodeId] || nodeId === s.cursor) return s
  return { ...s, cursor: nodeId }
}

export function first(s: AnalysisSession): AnalysisSession {
  return jump(s, s.tree.rootId)
}

export function prev(s: AnalysisSession): AnalysisSession {
  const node = s.tree.nodes[s.cursor]
  return node?.parentId ? jump(s, node.parentId) : s
}

/** Forward along the line the cursor is already on: its first child. */
export function next(s: AnalysisSession): AnalysisSession {
  const child = s.tree.nodes[s.cursor]?.children[0]
  return child ? jump(s, child) : s
}

/** The end of the line the cursor is on, following first children. */
export function last(s: AnalysisSession): AnalysisSession {
  let at = s.cursor
  const seen = new Set([at])
  for (;;) {
    const child = s.tree.nodes[at]?.children[0]
    if (!child || seen.has(child)) break
    seen.add(child)
    at = child
  }
  return jump(s, at)
}

/** Steps into one of the alternatives at the cursor. */
export function enterBranch(s: AnalysisSession, childId: string): AnalysisSession {
  const node = s.tree.nodes[s.cursor]
  if (!node || !node.children.includes(childId)) return s
  return jump(s, childId)
}

/** Back out of the branch the cursor is in, to the move it hangs off. */
export function leaveBranch(s: AnalysisSession): AnalysisSession {
  const point = branchPoint(s)
  return point ? jump(s, point) : s
}

// ---------------------------------------------------------------- exploring

export interface AddedMove {
  session: AnalysisSession
  nodeId: string
  made: ChessMove
  /** True when this move was already a branch here, so nothing new was created. */
  existing: boolean
}

/**
 * Playing a move from where the cursor is.
 *
 * Illegal comes back as null and nothing changes. A move that is already a branch here moves the cursor onto it
 * rather than making a second copy of it, so trying the same idea twice does not grow the tree.
 */
export function addMove(s: AnalysisSession, move: MoveInput): AddedMove | null {
  const node = s.tree.nodes[s.cursor]
  if (!node) return null
  const made = applyMove(node.fen, move)
  if (!made) return null
  const make = ids(s.counter)
  const game: GameMove = { san: made.san, uci: made.uci, fen: made.after }
  const added = addToTree(s.tree, s.cursor, game, make.next)
  if (!added) return null
  // `addToTree` hands back the tree it was given when the move was already a branch here, which is how we know.
  const existing = added.tree === s.tree
  return {
    session: { ...s, tree: added.tree, cursor: added.nodeId, counter: make.used() },
    nodeId: added.nodeId,
    made,
    existing
  }
}

/** Could this node be promoted, or is it already the main continuation all the way up? */
export function canPromote(s: AnalysisSession, nodeId: string): boolean {
  const path = pathTo(s.tree, nodeId)
  for (let i = 1; i < path.length; i++) {
    if (path[i - 1].children[0] !== path[i].id) return true
  }
  return false
}

/**
 * Making a branch the main line.
 *
 * Deliberate, and it says what it did: every move on the way down to this one becomes its parent's first child, so
 * the whole line becomes the main line rather than only its last move. The previous order is kept on the undo stack,
 * so this is a change that can be taken back exactly -- not re-derived, restored (Section 121).
 */
export function promote(s: AnalysisSession, nodeId: string): AnalysisSession {
  const path = pathTo(s.tree, nodeId)
  if (path.length < 2) return s
  const nodes = { ...s.tree.nodes }
  const moved: { nodeId: string; from: number }[] = []
  for (let i = 1; i < path.length; i++) {
    const parentId = path[i - 1].id
    const childId = path[i].id
    const parent = nodes[parentId]
    if (!parent) continue
    const index = parent.children.indexOf(childId)
    if (index <= 0) continue
    moved.push({ nodeId: childId, from: index })
    const children = [childId, ...parent.children.filter((c) => c !== childId)]
    nodes[parentId] = { ...parent, children }
  }
  if (!moved.length) return s
  const target = s.tree.nodes[nodeId]
  const what = target?.move ? `making ${target.move.san} the main line` : 'making a branch the main line'
  return {
    ...s,
    tree: { ...s.tree, nodes },
    undoStack: [...s.undoStack, { kind: 'promote', what, cursor: s.cursor, moved }]
  }
}

export interface RemoveResult {
  session: AnalysisSession
  removed: string[]
  /** Said plainly when nothing was removed and why. Null when the line went. */
  refused: string | null
}

/**
 * Taking a line out.
 *
 * The game as played cannot be taken out of its own analysis -- that is not an edit of a variation, it is deleting
 * the thing being analysed, and the Library is where a game is removed. Everything else goes, with the notes and
 * evaluations that were on it, and the whole lot is kept so `undo` can put it back where it was.
 */
export function removeLine(s: AnalysisSession, nodeId: string): RemoveResult {
  const node = s.tree.nodes[nodeId]
  if (!node) return { session: s, removed: [], refused: 'That line is not here.' }
  if (!node.parentId) return { session: s, removed: [], refused: 'The starting position cannot be removed.' }
  if (s.original.includes(nodeId)) {
    return { session: s, removed: [], refused: 'That move is part of the game as it was played, so it stays. Remove the game in the Library instead.' }
  }
  const doomed: string[] = []
  const walk = (id: string): void => {
    doomed.push(id)
    for (const child of s.tree.nodes[id]?.children ?? []) walk(child)
  }
  walk(nodeId)
  const parent = s.tree.nodes[node.parentId]
  const index = parent ? parent.children.indexOf(nodeId) : 0
  const kept: VariationNode[] = doomed.flatMap((id) => (s.tree.nodes[id] ? [s.tree.nodes[id]] : []))
  const annotations: Record<string, Annotation> = {}
  const evaluations: Record<string, NodeEvaluation> = {}
  const nextAnnotations = { ...s.annotations }
  const nextEvaluations = { ...s.evaluations }
  for (const id of doomed) {
    if (s.annotations[id]) {
      annotations[id] = s.annotations[id]
      delete nextAnnotations[id]
    }
    if (s.evaluations[id]) {
      evaluations[id] = s.evaluations[id]
      delete nextEvaluations[id]
    }
  }
  const tree = removeBranch(s.tree, nodeId)
  // The cursor may have been standing inside what just went; it falls back to where the line hung off.
  const cursor = doomed.includes(s.cursor) ? node.parentId : s.cursor
  const what = node.move ? `removing the line from ${node.move.san}` : 'removing a line'
  return {
    session: {
      ...s,
      tree,
      cursor,
      annotations: nextAnnotations,
      evaluations: nextEvaluations,
      undoStack: [...s.undoStack, { kind: 'remove', what, cursor: s.cursor, parentId: node.parentId, index: Math.max(0, index), nodes: kept, annotations, evaluations }]
    },
    removed: doomed,
    refused: null
  }
}

// ---------------------------------------------------------------- notes

/** The note a person wrote on a node, or null. */
export function annotationOf(s: AnalysisSession, nodeId: string): Annotation | null {
  return s.annotations[nodeId] ?? null
}

/** The comment the source file carried on this move, which is not the person's note and is never overwritten by it. */
export function sourceComment(s: AnalysisSession, nodeId: string): string | null {
  return s.tree.nodes[nodeId]?.move?.comment ?? null
}

/**
 * Writing a note on a position.
 *
 * Keyed by node, so the note stays on the move through every promotion, removal and restore. An empty note is no
 * note: it is removed rather than stored as an empty string that reads as "somebody wrote nothing here".
 */
export function annotate(s: AnalysisSession, nodeId: string, patch: { text?: string; nags?: string[] }, now: number): AnalysisSession {
  if (!s.tree.nodes[nodeId]) return s
  const before = s.annotations[nodeId] ?? null
  const text = (patch.text ?? before?.text ?? '').trim()
  const nags = (patch.nags ?? before?.nags ?? []).filter((n) => typeof n === 'string' && n.trim().length > 0).slice(0, 8)
  const annotations = { ...s.annotations }
  if (!text && !nags.length) delete annotations[nodeId]
  else annotations[nodeId] = { ...(text ? { text } : {}), ...(nags.length ? { nags } : {}), updatedAt: now }
  const what = before ? 'changing a note' : text || nags.length ? 'writing a note' : 'clearing a note'
  return { ...s, annotations, undoStack: [...s.undoStack, { kind: 'annotate', what, cursor: s.cursor, nodeId, before }] }
}

export function clearAnnotation(s: AnalysisSession, nodeId: string, now: number): AnalysisSession {
  if (!s.annotations[nodeId]) return s
  return annotate(s, nodeId, { text: '', nags: [] }, now)
}

/**
 * Recording what the engine said about a node.
 *
 * The position is checked first. An evaluation whose FEN is not this node's position is not this node's evaluation,
 * and storing it would put a number under a move it was never about.
 */
export function recordEvaluation(s: AnalysisSession, nodeId: string, evaluation: NodeEvaluation): AnalysisSession {
  const node = s.tree.nodes[nodeId]
  if (!node) return s
  if (positionKey(node.fen) !== positionKey(evaluation.fen)) return s
  const held = s.evaluations[nodeId]
  // A shallower search does not replace a deeper one: the deeper answer is the better evidence.
  if (held && held.depth !== null && evaluation.depth !== null && evaluation.depth < held.depth) return s
  return { ...s, evaluations: { ...s.evaluations, [nodeId]: evaluation } }
}

export function evaluationOf(s: AnalysisSession, nodeId: string): NodeEvaluation | null {
  return s.evaluations[nodeId] ?? null
}

// ---------------------------------------------------------------- undo

/** What `undo` would take back, said plainly, or null when there is nothing. */
export function pendingUndo(s: AnalysisSession): string | null {
  const top = s.undoStack[s.undoStack.length - 1]
  return top ? top.what : null
}

export function undo(s: AnalysisSession): { session: AnalysisSession; what: string | null } {
  const top = s.undoStack[s.undoStack.length - 1]
  if (!top) return { session: s, what: null }
  const undoStack = s.undoStack.slice(0, -1)
  if (top.kind === 'promote') {
    const nodes = { ...s.tree.nodes }
    // Backwards through what was moved, each child put back at the index it came from.
    for (const step of [...top.moved].reverse()) {
      const node = nodes[step.nodeId]
      if (!node?.parentId) continue
      const parent = nodes[node.parentId]
      if (!parent) continue
      const without = parent.children.filter((c) => c !== step.nodeId)
      const index = Math.min(step.from, without.length)
      nodes[node.parentId] = { ...parent, children: [...without.slice(0, index), step.nodeId, ...without.slice(index)] }
    }
    return { session: { ...s, tree: { ...s.tree, nodes }, cursor: s.tree.nodes[top.cursor] ? top.cursor : s.cursor, undoStack }, what: top.what }
  }
  if (top.kind === 'annotate') {
    const annotations = { ...s.annotations }
    if (top.before) annotations[top.nodeId] = top.before
    else delete annotations[top.nodeId]
    return { session: { ...s, annotations, cursor: s.tree.nodes[top.cursor] ? top.cursor : s.cursor, undoStack }, what: top.what }
  }
  const nodes = { ...s.tree.nodes }
  for (const node of top.nodes) nodes[node.id] = node
  const parent = nodes[top.parentId]
  if (parent) {
    const restored = top.nodes[0]?.id
    if (restored && !parent.children.includes(restored)) {
      const index = Math.min(top.index, parent.children.length)
      nodes[top.parentId] = { ...parent, children: [...parent.children.slice(0, index), restored, ...parent.children.slice(index)] }
    }
  }
  return {
    session: {
      ...s,
      tree: { ...s.tree, nodes },
      annotations: { ...s.annotations, ...top.annotations },
      evaluations: { ...s.evaluations, ...top.evaluations },
      cursor: nodes[top.cursor] ? top.cursor : s.cursor,
      undoStack
    },
    what: top.what
  }
}

// ---------------------------------------------------------------- the move list

export interface LineRow {
  nodeId: string
  /** Moves from the start. */
  ply: number
  /** The number shown beside the move. */
  number: number
  /** Who played it. */
  side: Side
  san: string
  /** 0 on the main line, 1 inside a variation, 2 inside a variation of a variation. */
  nesting: number
  main: boolean
  /** True on the first move of a variation, so a list can open a bracket there. */
  startsBranch: boolean
  /** How many variations end at this row. More than one when nested variations finish together. */
  closes: number
  annotation?: Annotation
  evaluation?: NodeEvaluation
  sourceComment?: string
}

/**
 * The move list, in the order a move list reads: the main move, then the alternatives to it, then on.
 *
 * `nesting` and `main` are what tell the main line and the branches apart on screen. They are worked out here, once,
 * from the tree, rather than left to the component to infer from indentation.
 */
export function flattenLine(s: AnalysisSession, limit = 20_000): LineRow[] {
  const rows: LineRow[] = []
  const seen = new Set<string>()
  const row = (node: VariationNode, parent: VariationNode, ply: number, nesting: number, main: boolean, startsBranch: boolean): LineRow => ({
    nodeId: node.id,
    ply,
    number: moveNumber(parent.fen),
    side: sideToMove(parent.fen),
    san: node.move?.san ?? '',
    nesting,
    main,
    startsBranch,
    closes: 0,
    ...(s.annotations[node.id] ? { annotation: s.annotations[node.id] } : {}),
    ...(s.evaluations[node.id] ? { evaluation: s.evaluations[node.id] } : {}),
    ...(node.move?.comment ? { sourceComment: node.move.comment } : {})
  })
  const walk = (fromId: string, nesting: number, main: boolean, startPly: number): void => {
    let current = fromId
    let ply = startPly
    while (rows.length < limit) {
      const node = s.tree.nodes[current]
      const firstId = node?.children[0]
      if (!node || !firstId || seen.has(firstId)) break
      const child = s.tree.nodes[firstId]
      if (!child) break
      seen.add(firstId)
      rows.push(row(child, node, ply + 1, nesting, main, false))
      // The alternatives to the move just written come next, each with its whole line, before the main line goes on.
      for (const altId of node.children.slice(1)) {
        if (seen.has(altId) || nesting >= 40) continue
        const alt = s.tree.nodes[altId]
        if (!alt) continue
        seen.add(altId)
        rows.push(row(alt, node, ply + 1, nesting + 1, false, true))
        walk(altId, nesting + 1, false, ply + 1)
        const tail = rows[rows.length - 1]
        if (tail) tail.closes += 1
      }
      current = firstId
      ply += 1
    }
  }
  walk(s.tree.rootId, 0, true, 0)
  return rows
}

/** Whether the tree, the notes and the evaluations still agree with each other (Section 130). */
export function sessionProblems(s: AnalysisSession): string[] {
  const problems = treeProblems(s.tree)
  for (const id of Object.keys(s.annotations)) {
    if (!s.tree.nodes[id]) problems.push(`A note is attached to ${id}, which is not in the tree.`)
  }
  for (const [id, evaluation] of Object.entries(s.evaluations)) {
    const node = s.tree.nodes[id]
    if (!node) problems.push(`An evaluation is attached to ${id}, which is not in the tree.`)
    else if (positionKey(node.fen) !== positionKey(evaluation.fen)) problems.push(`The evaluation on ${id} was calculated in a different position.`)
  }
  for (const id of s.original) {
    if (!s.tree.nodes[id]) problems.push(`The game as played has lost ${id}, so the original line is broken.`)
  }
  return problems
}

/** The game as played, read back off the tree: what the session must still be able to show after any exploring. */
export function originalMoves(s: AnalysisSession): GameMove[] {
  return s.original.slice(1).flatMap((id) => {
    const move = s.tree.nodes[id]?.move
    return move ? [move] : []
  })
}

// ---------------------------------------------------------------- the report

export interface PositionEval {
  /** Which position in the game: 0 is before the first move, 1 is after it. */
  ply: number
  /** The position itself. Checked against the game before the number is used. */
  fen: string
  /** White-positive. */
  score: Score
  depth: number | null
  bestmove?: string | null
  pvUci?: string[]
  engine?: string
  at?: number
  provisional?: boolean
}

export interface GraphPoint {
  ply: number
  /** Null where nothing was analysed. A gap, never filled in. */
  score: Score | null
  depth: number | null
  /** Where to draw it, 0 to 1. Null at a gap. */
  fraction: number | null
}

export interface MoveReportRow {
  ply: number
  san: string
  uci: string
  /** Who played it. */
  mover: Side
  /** The number shown beside it. */
  number: number
  /** The score in the position before the move, White-positive. Null when that position was not analysed. */
  before: Score | null
  /** The score after it. Null when that position was not analysed. */
  after: Score | null
  /** How much was given up, in centipawns, from the mover's point of view. Null when the two cannot be compared. */
  loss: number | null
  klass: MoveClass
  /** Why it is called that -- including "because nothing was searched here". */
  why: string
  /** The depth the judgement rests on: the shallower of the two searches. Null when it is not known. */
  depth: number | null
  analysed: boolean
  /** What the engine would have played instead, when it named a different move. */
  better?: { uci: string; san: string | null }
}

export type CriticalReason = 'missed-mate' | 'walked-into-mate' | 'blunder' | 'mistake' | 'swing'

export interface CriticalMoment {
  ply: number
  san: string
  mover: Side
  number: number
  reason: CriticalReason
  /** Why this moment was picked, in words, so the list is never a bare set of move numbers. */
  explain: string
  /** The depth behind the judgement. Null when it is not known, and then it is said so. */
  depth: number | null
  klass: MoveClass
  loss: number | null
}

export interface MissedMate {
  ply: number
  san: string
  mover: Side
  number: number
  /** How many moves the mate was, as the engine counted it. */
  mateIn: number
  /** The move that would have started it, when the engine named one. */
  mateMove?: { uci: string; san: string | null }
  depth: number | null
}

export interface ReportCoverage {
  /** Positions with an evaluation, out of the positions in the game. */
  analysed: number
  total: number
  /** Positions with nothing at all. */
  notAnalysed: number[]
  /** Positions searched, but not deeply enough to name the move that follows. */
  shallow: number[]
  minDepth: number
}

export interface AnalysisReport {
  gameId: string
  startFen: string
  plies: number
  graph: GraphPoint[]
  moves: MoveReportRow[]
  critical: CriticalMoment[]
  /** Criticial moments found beyond the number asked for, so nothing is hidden silently. */
  moreCritical: number
  missedMates: MissedMate[]
  counts: Record<MoveClass, number>
  /** Average centipawns given up, and how many moves that average rests on. Null when no move could be measured. */
  centipawnLoss: { white: { average: number; from: number } | null; black: { average: number; from: number } | null }
  coverage: ReportCoverage
  /** Evaluations that were handed in but not used, and why. */
  ignored: { ply: number; reason: string }[]
  /** The whole thing in a sentence or two, including what is missing. */
  summary: string
}

export interface ReportOptions {
  /** Below this depth a move is not named. The same default `classify` uses. */
  minDepth?: number
  /** How far the evaluation has to move, in centipawns, to count as a swing. */
  swingCp?: number
  maxCritical?: number
}

const EMPTY_COUNTS = (): Record<MoveClass, number> => ({
  best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, 'missed-mate': 0, unclear: 0
})

const SEVERITY: Record<CriticalReason, number> = {
  'missed-mate': 5,
  'walked-into-mate': 5,
  blunder: 4,
  swing: 3,
  mistake: 2
}

/**
 * Turning recorded evaluations into something a person can read.
 *
 * Everything here is driven by what was actually searched. A ply with no evaluation produces a gap in the graph and
 * an unnamed move in the list; a ply searched to depth 4 produces an unnamed move too, because depth 4 cannot tell a
 * good move from an inaccuracy and pretending otherwise is the most convincing kind of wrong (Sections 111-116).
 */
export function buildReport(game: Pick<StoredGame, 'id' | 'startFen' | 'moves'>, evaluations: PositionEval[], options: ReportOptions = {}): AnalysisReport {
  const minDepth = options.minDepth ?? 8
  const swingCp = options.swingCp ?? 150
  const maxCritical = options.maxCritical ?? 8
  const plies = game.moves.length
  const ignored: { ply: number; reason: string }[] = []
  const byPly = new Map<number, PositionEval>()

  for (const e of evaluations) {
    if (!Number.isInteger(e.ply) || e.ply < 0 || e.ply > plies) {
      ignored.push({ ply: e.ply, reason: 'That position is not in this game.' })
      continue
    }
    const expected = fenAt(game, e.ply)
    if (positionKey(expected) !== positionKey(e.fen)) {
      ignored.push({ ply: e.ply, reason: `The position does not match this game after ${e.ply} move${e.ply === 1 ? '' : 's'}, so the number is not used.` })
      continue
    }
    const held = byPly.get(e.ply)
    if (held) {
      const a = held.depth ?? -1
      const b = e.depth ?? -1
      if (b < a) {
        ignored.push({ ply: e.ply, reason: 'A deeper search of the same position is being used instead.' })
        continue
      }
      ignored.push({ ply: held.ply, reason: 'Replaced by a deeper search of the same position.' })
    }
    byPly.set(e.ply, e)
  }

  const graph: GraphPoint[] = []
  for (let ply = 0; ply <= plies; ply++) {
    const found = byPly.get(ply)
    graph.push(found
      ? { ply, score: found.score, depth: found.depth, fraction: barFraction(found.score) }
      : { ply, score: null, depth: null, fraction: null })
  }

  const counts = EMPTY_COUNTS()
  const moves: MoveReportRow[] = []
  const missedMates: MissedMate[] = []
  const critical: CriticalMoment[] = []
  const losses: Record<Side, number[]> = { w: [], b: [] }

  for (let ply = 1; ply <= plies; ply++) {
    const move = game.moves[ply - 1]
    const fenBefore = fenAt(game, ply - 1)
    const mover = sideToMove(fenBefore)
    const number = moveNumber(fenBefore)
    const before = byPly.get(ply - 1) ?? null
    const after = byPly.get(ply) ?? null
    const row: MoveReportRow = {
      ply,
      san: move.san,
      uci: move.uci,
      mover,
      number,
      before: before ? before.score : null,
      after: after ? after.score : null,
      loss: null,
      klass: 'unclear',
      why: '',
      depth: null,
      analysed: Boolean(before && after)
    }

    if (!before && !after) row.why = 'Neither position was analysed, so this move is not judged.'
    else if (!before) row.why = 'The position before this move was not analysed, so there is nothing to compare it with.'
    else if (!after) row.why = 'The position after this move was not analysed, so there is nothing to compare it with.'
    else {
      const depths = [before.depth, after.depth].filter((d): d is number => typeof d === 'number')
      const depth = depths.length === 2 ? Math.min(depths[0], depths[1]) : null
      row.depth = depth
      row.loss = lossFrom(before.score, after.score, mover)
      if (before.provisional || after.provisional) {
        row.klass = 'unclear'
        row.why = 'The engine only gave a bound here, so the number is not settled and the move is not named.'
      } else if (depth === null) {
        row.klass = 'unclear'
        row.why = 'The search depth was not recorded, so there is no way to say whether the number can carry a judgement.'
      } else {
        row.klass = classify(before.score, after.score, mover, { depth, minDepth })
        row.why = explainClass(row.klass, row.loss, depth, minDepth)
      }
      const best = before.bestmove ?? null
      if (best && best !== move.uci) {
        const made = applyMove(fenBefore, best)
        row.better = { uci: best, san: made ? made.san : null }
      }
    }

    counts[row.klass] += 1
    if (row.loss !== null && row.klass !== 'unclear') losses[mover].push(row.loss)
    moves.push(row)

    if (row.klass === 'missed-mate' && before) {
      const scoreBefore = forSide(before.score, mover)
      const mateIn = scoreBefore.kind === 'mate' ? Math.abs(scoreBefore.moves) : 0
      const best = before.bestmove ?? null
      const made = best ? applyMove(fenBefore, best) : null
      missedMates.push({
        ply,
        san: move.san,
        mover,
        number,
        mateIn,
        ...(best ? { mateMove: { uci: best, san: made ? made.san : null } } : {}),
        depth: row.depth
      })
    }

    // A critical moment has to be able to say what it rests on. A search too shallow to name the move is too
    // shallow to call the moment critical, so these are only looked for where the evidence holds.
    const trusted = row.analysed && row.depth !== null && row.depth >= minDepth && !before?.provisional && !after?.provisional
    if (trusted) for (const found of criticalFor(row, before, after, mover, swingCp)) critical.push(found)
  }

  // One entry per move, keeping the strongest reason for it.
  const strongest = new Map<number, CriticalMoment>()
  for (const moment of critical) {
    const held = strongest.get(moment.ply)
    if (!held || SEVERITY[moment.reason] > SEVERITY[held.reason]) strongest.set(moment.ply, moment)
  }
  const ranked = [...strongest.values()].sort((a, b) => (SEVERITY[b.reason] - SEVERITY[a.reason]) || ((b.loss ?? 0) - (a.loss ?? 0)) || (a.ply - b.ply))
  const shown = ranked.slice(0, Math.max(0, maxCritical))

  const notAnalysed: number[] = []
  const shallow: number[] = []
  for (let ply = 0; ply <= plies; ply++) {
    const found = byPly.get(ply)
    if (!found) notAnalysed.push(ply)
    else if (found.depth === null || found.depth < minDepth) shallow.push(ply)
  }

  const average = (list: number[]): { average: number; from: number } | null =>
    list.length ? { average: Math.round(list.reduce((a, b) => a + b, 0) / list.length), from: list.length } : null

  const coverage: ReportCoverage = { analysed: byPly.size, total: plies + 1, notAnalysed, shallow, minDepth }

  return {
    gameId: game.id,
    startFen: game.startFen,
    plies,
    graph,
    moves,
    critical: shown,
    moreCritical: Math.max(0, ranked.length - shown.length),
    missedMates,
    counts,
    centipawnLoss: { white: average(losses.w), black: average(losses.b) },
    coverage,
    ignored,
    summary: summarise(coverage, counts, missedMates.length)
  }
}

/** The same report, from a session: the evaluations that sit on the game's own nodes. */
export function reportFromSession(s: AnalysisSession, options: ReportOptions = {}): AnalysisReport {
  const evaluations: PositionEval[] = []
  for (const [ply, nodeId] of s.original.entries()) {
    const found = s.evaluations[nodeId]
    if (!found) continue
    evaluations.push({
      ply,
      fen: found.fen,
      score: found.score,
      depth: found.depth,
      ...(found.bestmove !== undefined ? { bestmove: found.bestmove } : {}),
      ...(found.pvUci ? { pvUci: found.pvUci } : {}),
      ...(found.engine ? { engine: found.engine } : {}),
      ...(found.at !== undefined ? { at: found.at } : {}),
      ...(found.provisional !== undefined ? { provisional: found.provisional } : {})
    })
  }
  return buildReport(s.game, evaluations, options)
}

function explainClass(klass: MoveClass, loss: number | null, depth: number, minDepth: number): string {
  if (klass === 'unclear') {
    if (depth < minDepth) return `Searched only ${depth} deep, which is not enough to name this move; ${minDepth} is the least that would be.`
    return 'A forced mate is involved on one side of this move but not the other, so there is no centipawn number that describes it.'
  }
  if (klass === 'missed-mate') return `A forced mate was there and this move did not take it. Searched ${depth} deep.`
  if (klass === 'best') return `Nothing was better here, as far as a search ${depth} deep can see.`
  const amount = loss === null ? 'something that cannot be measured in centipawns' : `${(loss / 100).toFixed(2)} of a pawn`
  if (klass === 'blunder') return `This gave up ${amount}. Searched ${depth} deep.`
  return `${CLASS_LABEL[klass]}: ${amount} given up, on a search ${depth} deep.`
}

function criticalFor(row: MoveReportRow, before: PositionEval | null, after: PositionEval | null, mover: Side, swingCp: number): CriticalMoment[] {
  if (!before || !after) return []
  const base = { ply: row.ply, san: row.san, mover, number: row.number, depth: row.depth, klass: row.klass, loss: row.loss }
  const found: CriticalMoment[] = []
  const b = forSide(before.score, mover)
  const a = forSide(after.score, mover)
  const depthWords = row.depth === null ? 'at a depth that was not recorded' : `on a search ${row.depth} deep`

  if (row.klass === 'missed-mate') {
    found.push({ ...base, reason: 'missed-mate', explain: `${row.san} let a forced mate slip, ${depthWords}.` })
  }
  if (a.kind === 'mate' && a.moves < 0 && !(b.kind === 'mate' && b.moves < 0)) {
    found.push({ ...base, reason: 'walked-into-mate', explain: `${row.san} walked into a forced mate, ${depthWords}.` })
  }
  if (row.klass === 'blunder') {
    const amount = row.loss === null ? 'a great deal' : `${(row.loss / 100).toFixed(2)} of a pawn`
    found.push({ ...base, reason: 'blunder', explain: `${row.san} gave up ${amount}, ${depthWords}.` })
  } else if (row.klass === 'mistake') {
    const amount = row.loss === null ? 'a good deal' : `${(row.loss / 100).toFixed(2)} of a pawn`
    found.push({ ...base, reason: 'mistake', explain: `${row.san} cost ${amount}, ${depthWords}.` })
  }
  // A swing: the game changed hands. Both scores have to be ordinary numbers for this to mean anything, and they
  // have to end up on opposite sides of level -- a drop from +6 to +4 is not the game changing hands.
  if (b.kind === 'cp' && a.kind === 'cp') {
    const moved = Math.abs(b.cp - a.cp)
    const crossed = (b.cp > 0 && a.cp < 0) || (b.cp < 0 && a.cp > 0)
    if (crossed && moved >= swingCp) {
      found.push({
        ...base,
        reason: 'swing',
        explain: `After ${row.san} the game changed hands: ${formatScore(before.score)} became ${formatScore(after.score)}, ${depthWords}.`
      })
    }
  }
  return found
}

function summarise(coverage: ReportCoverage, counts: Record<MoveClass, number>, mates: number): string {
  const parts: string[] = [`${coverage.analysed} of ${coverage.total} positions analysed.`]
  const named: string[] = []
  if (counts.blunder) named.push(`${counts.blunder} blunder${counts.blunder === 1 ? '' : 's'}`)
  if (counts.mistake) named.push(`${counts.mistake} mistake${counts.mistake === 1 ? '' : 's'}`)
  if (counts.inaccuracy) named.push(`${counts.inaccuracy} inaccurac${counts.inaccuracy === 1 ? 'y' : 'ies'}`)
  if (mates) named.push(`${mates} forced mate${mates === 1 ? '' : 's'} missed`)
  if (named.length) parts.push(`${named.join(', ')}.`)
  if (counts.unclear) parts.push(`${counts.unclear} move${counts.unclear === 1 ? ' is' : 's are'} not judged, because what was searched does not support a judgement.`)
  if (coverage.notAnalysed.length) parts.push(`${coverage.notAnalysed.length} position${coverage.notAnalysed.length === 1 ? '' : 's'} were not analysed at all.`)
  return parts.join(' ')
}

// ---------------------------------------------------------------- planning a whole-game sweep

export interface PlanBudget {
  /** All the engine time there is for this game, in milliseconds. */
  totalMs: number
  /** Time for one position in the quick pass. Taken down towards `floorMs` before anything is skipped. */
  quickMs?: number
  /** Time for one position in the deeper pass. */
  deepMs?: number
  /** The least time a quick look is worth giving. Below this the position is skipped instead. */
  floorMs?: number
  /** How much of the budget is held back for the deeper pass, 0 to 1. */
  deepShare?: number
  multipv?: number
  deepMultipv?: number
}

export interface PlanStep {
  /** Which position: 0 is before the first move. */
  ply: number
  fen: string
  pass: 'quick' | 'deep'
  limits: { movetime?: number; depth?: number }
  multipv: number
  /** Why this position is being searched. */
  reason: string
  /** The id the answer must carry to be accepted. */
  requestId: string
}

export interface QuickPlan {
  gameId: string
  steps: PlanStep[]
  /** Positions the budget does not reach at all. */
  skipped: number[]
  /** Everything the quick pass covers is shallow until the deeper pass reaches it. */
  shallowOnly: number[]
  msEach: number
  estimatedMs: number
  /** Held back for the deeper pass. */
  reservedDeepMs: number
  budgetMs: number
  /** What the plan will and will not manage, in plain words. */
  notes: string[]
}

const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n))

/**
 * The first pass: a quick look at every position the budget can reach.
 *
 * The one thing this must not do is stride through the game taking every third position. Naming a move needs the
 * position before it *and* the position after it, so a strided pass can name nothing at all -- it would spend the
 * whole budget and produce a report with every move unjudged. So the time per position comes down first, and when
 * even that is not enough the pass gives up the opening and covers a run to the end of the game, which is the part
 * where a search changes what anybody does next. What it gave up is listed, not glossed over (Sections 123-126).
 */
export function planQuickPass(game: Pick<StoredGame, 'id' | 'startFen' | 'moves'>, budget: PlanBudget, runId?: string): QuickPlan {
  const total = game.moves.length + 1
  const quickMs = Math.max(1, Math.round(budget.quickMs ?? 200))
  const floorMs = Math.max(1, Math.round(budget.floorMs ?? 50))
  const deepShare = clamp(budget.deepShare ?? 0.5, 0, 0.9)
  const multipv = clamp(Math.round(budget.multipv ?? 1), 1, 5)
  const budgetMs = Math.max(0, Math.round(budget.totalMs))
  const reservedDeepMs = Math.round(budgetMs * deepShare)
  const quickBudget = budgetMs - reservedDeepMs
  const notes: string[] = []

  const wanted = quickMs * total
  let msEach = quickMs
  if (wanted > quickBudget && total > 0) {
    msEach = Math.floor(quickBudget / total)
    if (msEach >= floorMs) {
      notes.push(`There is not enough time for ${quickMs} milliseconds a position, so each one gets ${msEach}.`)
    } else {
      msEach = floorMs
    }
  }
  msEach = Math.max(floorMs, msEach)

  const affordable = msEach > 0 ? Math.floor(quickBudget / msEach) : 0
  const covered = clamp(affordable, 0, total)
  const start = total - covered
  const steps: PlanStep[] = []
  const skipped: number[] = []
  const prefix = runId && runId.trim() ? runId.trim() : game.id

  for (let ply = 0; ply < total; ply++) {
    if (ply < start) {
      skipped.push(ply)
      continue
    }
    steps.push({
      ply,
      fen: fenAt(game, ply),
      pass: 'quick',
      limits: { movetime: msEach },
      multipv,
      reason: 'A first look, so the shape of the game is known before anything is searched properly.',
      requestId: `${prefix}:q${ply}`
    })
  }

  if (skipped.length) {
    notes.push(`The budget covers ${covered} of ${total} positions, so the first ${skipped.length} are not searched at all: the opening is where a search tells you least.`)
  }
  if (!steps.length) {
    notes.push('The budget does not cover a single position, so nothing can be analysed with it.')
  }
  notes.push('Everything in this pass is a quick look. No move is named from it until the deeper pass has been over the candidates.')

  return {
    gameId: game.id,
    steps,
    skipped,
    shallowOnly: steps.map((s) => s.ply),
    msEach,
    estimatedMs: steps.length * msEach,
    reservedDeepMs,
    budgetMs,
    notes
  }
}

export interface DeepCandidate {
  /** The move the deeper search is about. */
  ply: number
  /** How much moved here, in centipawns, or null when a mate score is involved and no number describes it. */
  magnitude: number | null
  /** Why this move is a candidate. */
  why: string
}

export interface DeepPlan {
  gameId: string
  steps: PlanStep[]
  candidates: DeepCandidate[]
  /** Candidates the budget could not reach, and why they were left. */
  notDeepened: { ply: number; why: string }[]
  estimatedMs: number
  budgetMs: number
  notes: string[]
}

/**
 * The second pass: the positions worth searching properly.
 *
 * Which ones those are cannot be decided before the first pass, so this takes its results. A candidate needs *both*
 * its positions searched deeply, because that is what naming a move takes -- so each candidate costs two searches,
 * and the plan says so rather than promising twice what it can do.
 */
export function planDeeper(
  game: Pick<StoredGame, 'id' | 'startFen' | 'moves'>,
  budget: PlanBudget,
  quick: PositionEval[],
  runId?: string
): DeepPlan {
  const deepMs = Math.max(1, Math.round(budget.deepMs ?? 1500))
  const deepShare = clamp(budget.deepShare ?? 0.5, 0, 0.9)
  const multipv = clamp(Math.round(budget.deepMultipv ?? 3), 1, 5)
  const budgetMs = Math.round(Math.max(0, budget.totalMs) * deepShare)
  const prefix = runId && runId.trim() ? runId.trim() : game.id
  // A low floor on purpose: the quick pass is shallow by design, so the report it feeds is read for where the
  // numbers moved, not for the names it puts on moves.
  const report = buildReport(game, quick, { minDepth: 1 })
  const candidates: DeepCandidate[] = []

  for (const row of report.moves) {
    if (!row.analysed) continue
    const magnitude = row.loss
    if (row.klass === 'missed-mate') {
      candidates.push({ ply: row.ply, magnitude: null, why: `A mate may have been missed at ${row.san}; a quick look cannot settle that.` })
      continue
    }
    if (row.before?.kind === 'mate' || row.after?.kind === 'mate') {
      candidates.push({ ply: row.ply, magnitude: null, why: `A mate score appears around ${row.san}, which a quick look is not enough to trust.` })
      continue
    }
    if (magnitude !== null && magnitude >= 60) {
      candidates.push({ ply: row.ply, magnitude, why: `The evaluation moved ${(magnitude / 100).toFixed(2)} of a pawn at ${row.san}.` })
    }
  }

  // Mates first, then the biggest movements.
  const ranked = [...candidates].sort((a, b) => {
    if ((a.magnitude === null) !== (b.magnitude === null)) return a.magnitude === null ? -1 : 1
    return (b.magnitude ?? 0) - (a.magnitude ?? 0) || a.ply - b.ply
  })

  const steps: PlanStep[] = []
  const asked = new Set<number>()
  const notDeepened: { ply: number; why: string }[] = []
  const room = deepMs > 0 ? Math.floor(budgetMs / deepMs) : 0

  for (const candidate of ranked) {
    const need = [candidate.ply - 1, candidate.ply].filter((p) => p >= 0 && p <= game.moves.length && !asked.has(p))
    if (steps.length + need.length > room) {
      notDeepened.push({ ply: candidate.ply, why: 'There was no time left in the budget for it.' })
      continue
    }
    for (const ply of need) {
      asked.add(ply)
      steps.push({
        ply,
        fen: fenAt(game, ply),
        pass: 'deep',
        limits: { movetime: deepMs },
        multipv,
        reason: candidate.why,
        requestId: `${prefix}:d${ply}`
      })
    }
  }

  const notes: string[] = []
  notes.push(`${ranked.length} move${ranked.length === 1 ? '' : 's'} came out of the quick pass as worth a proper look.`)
  notes.push('Each one needs the position before it and the position after it, because that is what naming a move takes.')
  if (notDeepened.length) notes.push(`${notDeepened.length} of them do not fit in the budget and stay as they are, named from the quick pass or not named at all.`)
  if (!ranked.length) notes.push('Nothing in the quick pass moved far enough to be worth searching again.')

  return { gameId: game.id, steps, candidates: ranked, notDeepened, estimatedMs: steps.length * deepMs, budgetMs, notes }
}

/** What a finished sweep did and did not reach, measured against the plan it ran from. */
export function planCoverage(
  game: Pick<StoredGame, 'id' | 'startFen' | 'moves'>,
  plan: { steps: PlanStep[] },
  got: PositionEval[]
): { asked: number[]; answered: number[]; missing: number[]; unasked: number[] } {
  const asked = [...new Set(plan.steps.map((s) => s.ply))].sort((a, b) => a - b)
  const have = new Set(got.filter((e) => positionKey(e.fen) === positionKey(fenAt(game, e.ply))).map((e) => e.ply))
  const answered = asked.filter((p) => have.has(p))
  const missing = asked.filter((p) => !have.has(p))
  const unasked: number[] = []
  for (let ply = 0; ply <= game.moves.length; ply++) if (!asked.includes(ply)) unasked.push(ply)
  return { asked, answered, missing, unasked }
}

// ---------------------------------------------------------------- matching the engine's answers

/** The shape the engine service sends on `chess:analysis`. Only the fields this module uses are named. */
export interface EngineUpdate {
  requestId: string
  fen: string
  score: Score
  depth: number | null
  seldepth?: number | null
  nodes: number | null
  nps: number | null
  timeMs: number | null
  pvSan: string[] | null
  pvUci: string[]
  multipv: number
  bound: 'lower' | 'upper' | null
  complete: boolean
  bestmove?: string | null
  bestmoveSan?: string | null
  note?: string | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function readScore(raw: unknown): Score | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind === 'none') return { kind: 'none' }
  if (r.kind === 'cp' && typeof r.cp === 'number' && Number.isFinite(r.cp)) return { kind: 'cp', cp: r.cp }
  if (r.kind === 'mate' && typeof r.moves === 'number' && Number.isFinite(r.moves)) return { kind: 'mate', moves: r.moves }
  return null
}

/**
 * Reading an update that arrived from the main process.
 *
 * It crosses a process boundary as a plain value, so it is checked rather than trusted. A value missing the two
 * fields that make an answer attributable -- the request and the position -- is not an answer at all and comes back
 * as null; a missing number comes back as null rather than as zero.
 */
export function readUpdate(raw: unknown): EngineUpdate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.requestId !== 'string' || typeof r.fen !== 'string') return null
  const score = readScore(r.score)
  if (!score) return null
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    requestId: r.requestId,
    fen: r.fen,
    score,
    depth: num(r.depth),
    seldepth: num(r.seldepth),
    nodes: num(r.nodes),
    nps: num(r.nps),
    timeMs: num(r.timeMs),
    pvSan: Array.isArray(r.pvSan) ? strings(r.pvSan) : null,
    pvUci: strings(r.pvUci),
    multipv: num(r.multipv) ?? 1,
    bound: r.bound === 'lower' || r.bound === 'upper' ? r.bound : null,
    complete: r.complete === true,
    ...(typeof r.bestmove === 'string' || r.bestmove === null ? { bestmove: r.bestmove } : {}),
    ...(typeof r.bestmoveSan === 'string' || r.bestmoveSan === null ? { bestmoveSan: r.bestmoveSan } : {}),
    ...(typeof r.note === 'string' || r.note === null ? { note: r.note } : {})
  }
}

export interface EngineLine {
  multipv: number
  score: Score
  depth: number | null
  nodes: number | null
  nps: number | null
  timeMs: number | null
  pvUci: string[]
  pvSan: string[] | null
  bound: 'lower' | 'upper' | null
}

export interface EngineWatch {
  /** What was asked. Null when nothing is being waited for. */
  requestId: string | null
  /** The position it was asked about. */
  fen: string | null
  lines: EngineLine[]
  complete: boolean
  bestmove: string | null
  bestmoveSan: string | null
  note: string | null
  /** How many updates were thrown away for not matching. Counted so a silent mismatch can be seen, not guessed at. */
  ignored: number
}

export function watchFor(requestId: string, fen: string): EngineWatch {
  return { requestId, fen, lines: [], complete: false, bestmove: null, bestmoveSan: null, note: null, ignored: 0 }
}

export const noWatch = (): EngineWatch => ({
  requestId: null, fen: null, lines: [], complete: false, bestmove: null, bestmoveSan: null, note: null, ignored: 0
})

/**
 * Taking in one update from the engine, if it is ours.
 *
 * Two things are checked and both have to hold: the request id, and the position. The id alone is not enough -- ids
 * get reused across a sweep of a game -- and the position alone is not enough either, because the same position can
 * be asked about twice with different limits. Anything that fails either check is counted and dropped.
 */
export function acceptUpdate(watch: EngineWatch, update: EngineUpdate): EngineWatch {
  if (!watch.requestId || !watch.fen) return { ...watch, ignored: watch.ignored + 1 }
  if (update.requestId !== watch.requestId) return { ...watch, ignored: watch.ignored + 1 }
  if (positionKey(update.fen) !== positionKey(watch.fen)) return { ...watch, ignored: watch.ignored + 1 }
  const line: EngineLine = {
    multipv: Math.max(1, update.multipv),
    score: update.score,
    depth: update.depth,
    nodes: update.nodes,
    nps: update.nps,
    timeMs: update.timeMs,
    pvUci: update.pvUci,
    pvSan: update.pvSan,
    bound: update.bound
  }
  const lines = watch.lines.filter((l) => l.multipv !== line.multipv)
  lines.push(line)
  lines.sort((a, b) => a.multipv - b.multipv)
  return {
    ...watch,
    lines,
    complete: watch.complete || update.complete,
    bestmove: update.bestmove !== undefined ? update.bestmove : watch.bestmove,
    bestmoveSan: update.bestmoveSan !== undefined ? update.bestmoveSan : watch.bestmoveSan,
    note: update.note !== undefined ? update.note : watch.note
  }
}

/** The line the engine likes best, or null when it has not said anything usable yet. */
export function bestLine(watch: EngineWatch): EngineLine | null {
  return watch.lines.find((l) => l.multipv === 1) ?? watch.lines[0] ?? null
}

/** What an update is worth recording about a position, once it has been accepted. */
export function evaluationFromWatch(watch: EngineWatch, engine?: string, at?: number): NodeEvaluation | null {
  const line = bestLine(watch)
  if (!line || !watch.fen) return null
  if (line.score.kind === 'none') return null
  return {
    fen: watch.fen,
    score: line.score,
    depth: line.depth,
    bestmove: watch.bestmove ?? line.pvUci[0] ?? null,
    ...(line.pvUci.length ? { pvUci: line.pvUci } : {}),
    ...(engine ? { engine } : {}),
    ...(at !== undefined ? { at } : {}),
    ...(line.bound ? { provisional: true } : {})
  }
}

/**
 * A line written out the way a person reads one: "15.Nf3 Bb4 16.O-O".
 *
 * It is walked move by move against the position, because notation depends on the position it is written in. A move
 * in the line that cannot be played stops the writing there, and the caller is told how far it got.
 */
export function writeLine(fen: string, uciMoves: string[], limit = 12): { text: string; legal: boolean; shown: number } {
  const read = uciLineToSan(fen, uciMoves.slice(0, limit))
  let number = moveNumber(fen)
  let side = sideToMove(fen)
  const parts: string[] = []
  for (const san of read.san) {
    if (side === 'w') parts.push(`${number}.${san}`)
    else {
      if (!parts.length) parts.push(`${number}...${san}`)
      else parts.push(san)
      number += 1
    }
    side = side === 'w' ? 'b' : 'w'
  }
  return { text: parts.join(' '), legal: read.legal && uciMoves.length <= limit, shown: read.san.length }
}

// ---------------------------------------------------------------- drawing the graph

export interface GraphSegment {
  points: { x: number; y: number; ply: number }[]
}

/**
 * The evaluation graph as runs of points, broken wherever nothing was analysed.
 *
 * Returning segments rather than one path is the whole point: a single path would join the point before a gap to the
 * point after it with a straight line, and that line is an evaluation nobody ever calculated (Section 112).
 */
export function graphSegments(points: GraphPoint[], size: { width: number; height: number }): GraphSegment[] {
  const span = Math.max(1, points.length - 1)
  const segments: GraphSegment[] = []
  let run: { x: number; y: number; ply: number }[] = []
  for (const point of points) {
    if (point.fraction === null) {
      if (run.length) segments.push({ points: run })
      run = []
      continue
    }
    run.push({
      x: (point.ply / span) * size.width,
      y: (1 - point.fraction) * size.height,
      ply: point.ply
    })
  }
  if (run.length) segments.push({ points: run })
  return segments
}

/** Where the gaps are, as runs of plies, for saying so on screen rather than only leaving a hole. */
export function graphGaps(points: GraphPoint[]): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = []
  let start: number | null = null
  for (const point of points) {
    if (point.fraction === null) {
      if (start === null) start = point.ply
    } else if (start !== null) {
      gaps.push({ from: start, to: point.ply - 1 })
      start = null
    }
  }
  if (start !== null) gaps.push({ from: start, to: points[points.length - 1]?.ply ?? start })
  return gaps
}
