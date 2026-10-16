import { START_FEN, applyMove, checkFen } from './rules.ts'
import type { Score } from './evaluation.ts'

/**
 * What a chess game is, once Orbis has it.
 *
 * One shape serves a game against the engine, an imported file, a finished broadcast and a position set up by hand,
 * because they are the same thing afterwards: a starting position and a line of legal moves. What differs is where it
 * came from and what may be done with it, and that is said plainly in `source` and `kind` rather than left for each
 * screen to guess (Sections 014, 019, 152).
 *
 * Two rules hold everywhere below:
 *
 *   - What is not known is left out. A game with no date has no date; it does not get today's.
 *   - Moves are kept as moves, not as a notation string. Notation depends on the position it was written in, so text
 *     alone cannot be replayed safely.
 */

export type GameSource =
  | { kind: 'local-engine'; engine: string; level?: string }
  | { kind: 'import'; file?: string; importedAt: number }
  | { kind: 'broadcast'; provider: string; providerGameId: string; eventId?: string; retrievedAt: number; url?: string }
  | { kind: 'custom-position' }
  | { kind: 'study' }

export interface PlayerInfo {
  /** Absent when the record does not say. Never filled in with "Unknown" as if it were a name. */
  name?: string
  rating?: number
  title?: string
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*'

export interface GameMeta {
  event?: string
  site?: string
  /** As the source wrote it, which may be partial ("2026.??.??"). */
  date?: string
  round?: string
  white: PlayerInfo
  black: PlayerInfo
  result: GameResult
  /** Why the game ended, when that is known beyond the result itself. */
  termination?: string
  timeControl?: string
  eco?: string
  opening?: string
  /** Tags the source carried that Orbis has no field for. Kept so an export can give them back. */
  extra?: Record<string, string>
}

/** One move in a stored game: the move itself, plus anything written about it. */
export interface GameMove {
  san: string
  uci: string
  /** The position after this move. Stored so a game can be shown without replaying it from the start. */
  fen: string
  /** Seconds left on the clock after the move, when the source said. */
  clock?: number
  /** A comment the source carried, kept apart from anything Orbis worked out. */
  comment?: string
  /** !, ?, !!, ?? and the rest, as the source wrote them. */
  nag?: string[]
}

export interface StoredGame {
  id: string
  profileId: string
  source: GameSource
  /** Where the game starts. The usual position for most games, a set-up one for the rest. */
  startFen: string
  /** The game as it was played. Analysis lines live in a study, not here, so a game cannot be edited by exploring it. */
  moves: GameMove[]
  meta: GameMeta
  /** 'standard' unless a variant was identified. A variant Orbis cannot play is still recorded, not reinterpreted. */
  variant: string
  createdAt: number
  updatedAt: number
  /** Set by the person, not by a source. */
  tags?: string[]
  favourite?: boolean
  /** A fingerprint of the start and the moves, for recognising the same game arriving twice. */
  fingerprint: string
}

export type SessionKind = 'play' | 'analysis' | 'puzzle' | 'training' | 'watch'

/** What may be done in a session. A broadcast cannot take your moves; a puzzle does not resign (Sections 019, 081). */
export const SESSION_RIGHTS: Record<SessionKind, { userMoves: boolean; engineMoves: boolean; resign: boolean; variations: boolean }> = {
  play: { userMoves: true, engineMoves: true, resign: true, variations: false },
  analysis: { userMoves: true, engineMoves: false, resign: false, variations: true },
  puzzle: { userMoves: true, engineMoves: true, resign: false, variations: false },
  training: { userMoves: true, engineMoves: true, resign: false, variations: true },
  watch: { userMoves: false, engineMoves: false, resign: false, variations: true }
}

/** A line of moves that is not the game: an alternative somebody tried (Sections 105, 121). */
export interface VariationNode {
  id: string
  parentId: string | null
  /** The move that leads here, from the parent's position. Null at the root. */
  move: GameMove | null
  fen: string
  children: string[]
  comment?: string
  label?: string
  /** What the engine said about this position, when it has been asked. */
  evaluation?: { score: Score; depth?: number; engine?: string; at: number }
}

export interface VariationTree {
  rootId: string
  nodes: Record<string, VariationNode>
}

/** A hash of what makes a game that game: where it started and what was played (Section 431). */
export function fingerprintOf(startFen: string, moves: { uci: string }[]): string {
  const text = `${startFen.trim().split(/\s+/).slice(0, 4).join(' ')}|${moves.map((m) => m.uci).join(' ')}`
  // A small, stable, non-cryptographic hash: this names a record, it does not protect one.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export interface BuildResult {
  ok: boolean
  moves: GameMove[]
  /** Where it stopped being legal, when it did: the move number and what was written there. */
  failedAt?: { index: number; move: string; fen: string }
}

/**
 * Turning written moves into a game, by playing them.
 *
 * Nothing is trusted here. A file can be perfectly formed and still contain a move that cannot be played, and the
 * difference matters: the first is a reading problem, the second is a chess problem, and a person needs to be told
 * which (Sections 401, 407).
 */
export function buildMoves(startFen: string, written: { san: string; comment?: string; nag?: string[]; clock?: number }[]): BuildResult {
  if (!checkFen(startFen).ok) return { ok: false, moves: [] }
  const moves: GameMove[] = []
  let fen = startFen
  for (const [index, entry] of written.entries()) {
    const made = applyMove(fen, entry.san)
    if (!made) return { ok: false, moves, failedAt: { index, move: entry.san, fen } }
    fen = made.after
    moves.push({
      san: made.san,
      uci: made.uci,
      fen,
      ...(entry.comment ? { comment: entry.comment } : {}),
      ...(entry.nag?.length ? { nag: entry.nag } : {}),
      ...(entry.clock !== undefined ? { clock: entry.clock } : {})
    })
  }
  return { ok: true, moves }
}

/** A new, empty game record. */
export function newGame(o: {
  id: string
  profileId: string
  source: GameSource
  startFen?: string
  meta?: Partial<GameMeta>
  now: number
  variant?: string
}): StoredGame {
  const startFen = o.startFen && checkFen(o.startFen).ok ? o.startFen : START_FEN
  return {
    id: o.id,
    profileId: o.profileId,
    source: o.source,
    startFen,
    moves: [],
    meta: { white: {}, black: {}, result: '*', ...o.meta },
    variant: o.variant ?? 'standard',
    createdAt: o.now,
    updatedAt: o.now,
    fingerprint: fingerprintOf(startFen, [])
  }
}

/** The position after a given number of moves. Index 0 is before anything was played. */
export function fenAt(game: Pick<StoredGame, 'startFen' | 'moves'>, ply: number): string {
  if (ply <= 0) return game.startFen
  const move = game.moves[Math.min(ply, game.moves.length) - 1]
  return move ? move.fen : game.startFen
}

/** The moves written out the way a move list shows them: a number, White's move, Black's move. */
export function movePairs(game: Pick<StoredGame, 'startFen' | 'moves'>): { number: number; white?: GameMove; black?: GameMove; whitePly?: number; blackPly?: number }[] {
  const first = Number.parseInt(game.startFen.trim().split(/\s+/)[5] ?? '1', 10) || 1
  const blackFirst = game.startFen.trim().split(/\s+/)[1] === 'b'
  const rows: { number: number; white?: GameMove; black?: GameMove; whitePly?: number; blackPly?: number }[] = []
  let number = first
  let index = 0
  if (blackFirst && game.moves.length) {
    rows.push({ number, black: game.moves[0], blackPly: 1 })
    index = 1
    number += 1
  }
  while (index < game.moves.length) {
    const row: { number: number; white?: GameMove; black?: GameMove; whitePly?: number; blackPly?: number } = { number }
    row.white = game.moves[index]
    row.whitePly = index + 1
    if (game.moves[index + 1]) {
      row.black = game.moves[index + 1]
      row.blackPly = index + 2
    }
    rows.push(row)
    index += 2
    number += 1
  }
  return rows
}

/** A fresh tree holding only the starting position. */
export function newTree(fen: string, id = 'root'): VariationTree {
  return { rootId: id, nodes: { [id]: { id, parentId: null, move: null, fen, children: [] } } }
}

/** Adds a move to a node, reusing a branch that already plays that move rather than making a second one. */
export function addToTree(tree: VariationTree, parentId: string, move: GameMove, makeId: () => string): { tree: VariationTree; nodeId: string } | null {
  const parent = tree.nodes[parentId]
  if (!parent) return null
  const existing = parent.children.map((c) => tree.nodes[c]).find((c) => c?.move?.uci === move.uci)
  if (existing) return { tree, nodeId: existing.id }
  const id = makeId()
  const node: VariationNode = { id, parentId, move, fen: move.fen, children: [] }
  return {
    tree: {
      ...tree,
      nodes: {
        ...tree.nodes,
        [parentId]: { ...parent, children: [...parent.children, id] },
        [id]: node
      }
    },
    nodeId: id
  }
}

/** The moves from the root down to a node. */
export function pathTo(tree: VariationTree, nodeId: string): VariationNode[] {
  const path: VariationNode[] = []
  let current = tree.nodes[nodeId]
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? tree.nodes[current.parentId] : undefined as never
  }
  return path
}

/** Removes a branch and everything under it. The root cannot be removed. */
export function removeBranch(tree: VariationTree, nodeId: string): VariationTree {
  const node = tree.nodes[nodeId]
  if (!node || !node.parentId) return tree
  const doomed = new Set<string>()
  const walk = (id: string): void => {
    doomed.add(id)
    for (const child of tree.nodes[id]?.children ?? []) walk(child)
  }
  walk(nodeId)
  const nodes: Record<string, VariationNode> = {}
  for (const [id, n] of Object.entries(tree.nodes)) {
    if (doomed.has(id)) continue
    nodes[id] = { ...n, children: n.children.filter((c) => !doomed.has(c)) }
  }
  return { ...tree, nodes }
}

/** Checks a tree is sound: no loops, no orphans, and every move legal from its parent (Section 130). */
export function treeProblems(tree: VariationTree): string[] {
  const problems: string[] = []
  const root = tree.nodes[tree.rootId]
  if (!root) return ['The tree has no starting position.']
  const seen = new Set<string>()
  const walk = (id: string, depth: number): void => {
    if (depth > 10_000) { problems.push('The tree is nested too deeply to be real.'); return }
    if (seen.has(id)) { problems.push(`The branch ${id} appears twice, so the tree loops.`); return }
    seen.add(id)
    const node = tree.nodes[id]
    if (!node) { problems.push(`A branch refers to ${id}, which is not there.`); return }
    if (node.move) {
      const parent = node.parentId ? tree.nodes[node.parentId] : null
      if (!parent) problems.push(`The branch ${id} has lost its parent.`)
      else if (!applyMove(parent.fen, node.move.uci)) problems.push(`${node.move.san} cannot be played in the position it is attached to.`)
    }
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(tree.rootId, 0)
  for (const id of Object.keys(tree.nodes)) if (!seen.has(id)) problems.push(`The branch ${id} is not reachable from the start.`)
  return problems
}
