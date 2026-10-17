import { applyMove, moveNumber, positionKey, sideToMove } from './rules.ts'
import { addToTree, type GameMove, type StoredGame, type VariationNode } from './model.ts'
import { writePgn } from './pgn.ts'
import {
  openSession, recordEvaluation,
  type AnalysisSession, type Annotation, type NodeEvaluation
} from './analysis.ts'
import { formatScore, type Score } from './evaluation.ts'

/**
 * Keeping an analysis: the lines somebody tried, what they wrote about them, and what the engine said.
 *
 * Until this existed, all of it lived in one React component. A person explored six lines, wrote three notes, ran a
 * twenty-minute pass over the game, changed area -- and every bit of it was gone, with no warning and nothing to
 * recover. The game was never at risk, because exploring never touches the game; the work on top of it was lost
 * every single time (Sections 103, 121, 125, 126, 158).
 *
 * ## An analysis is its own record, and that is the point
 *
 * It is kept in its own file, keyed by the game it is about, and it is never written into the game. Two reasons, and
 * the second one is the one worth remembering:
 *
 *   - A game is the game as it was played. A study is what somebody thinks about it. Merging them means that opening
 *     a game to look at it can change it, which is the one thing Analysis Studio exists not to do (Section 105).
 *   - **An analysis that cannot be read must not cost the game.** They are separate files, so a damaged study is a
 *     damaged study: the game still opens, the moves are still there, and the screen says what could not be read
 *     rather than showing an empty board.
 *
 * ## Three rules this whole file is in service of
 *
 * **A note is attached to a position, not to a number.** Notes are keyed by node, and a node is identified by the
 * moves that reach it -- not by the id that happened to be in the file. Restoring maps every stored node onto the
 * node the same moves reach in the reopened session, and a note whose node cannot be reached is dropped and said out
 * loud. It is never moved onto a nearby move, because a note on the wrong move is worse than a note that is gone:
 * one is visibly missing and the other is silently wrong.
 *
 * **A recorded evaluation keeps what it was.** The depth it reached, whether the engine only gave a bound, which
 * engine said it and when. A score read back without its depth is a number pretending to be a judgement, and the
 * report built from it would name moves on evidence that does not exist (Sections 111-116, 421-430).
 *
 * **The game decides whether a study still applies.** A study carries the game's fingerprint. If the game's moves
 * have changed, the stored tree is not grafted on at all: every node in it hangs off a position that no longer
 * follows from the game, so the notes would land on different moves. That refusal is reported, not hidden.
 *
 * `compare.ts` beside this holds the comparison of two end positions, because that needs the opening dataset and
 * this file is read in the main process on every launch.
 */

/** The shape written to the disk. A file from the future is refused rather than read into a worse copy of itself. */
export const STUDY_VERSION = 1

/**
 * How much of one study is kept, and how many studies.
 *
 * Both caps are here because the file is read whole whenever Chess World opens, and both are said out loud when they
 * bite -- a cap that quietly drops the end of somebody's analysis is the same bug as a reader that quietly drops a
 * field. Twenty thousand branches is far more than a person makes by hand; it is a ceiling on a runaway, not a
 * budget. There is deliberately no cap on how many *variations* a position may have.
 */
export const STUDY_CAPS = Object.freeze({ nodes: 20_000, studies: 400, labelChars: 120, noteChars: 20_000, runs: 8 })

/** One node of a saved tree. The children are kept in order, because the first one is what "the main line" means. */
export interface StoredNode {
  id: string
  parentId: string | null
  /** The move that reaches this node from its parent. Null at the starting position only. */
  move: GameMove | null
  fen: string
  children: string[]
  /** What somebody called this branch, when they named one (Section 126). */
  label?: string
}

/**
 * One pass of the engine over a game, recorded so a report can say where it came from (Section 158).
 *
 * The report itself is not stored. It is worked out from the evaluations every time it is shown -- and those are
 * stored, with their depths -- so a stored report would be a second answer to a question that already has one, and
 * the only way the two could disagree is by the stored one being out of date. What a report cannot work out for
 * itself is what was asked of the engine and whether the run finished, so that is what this keeps.
 */
export interface StudyRun {
  id: string
  startedAt: number
  /** Null while it is still going, or when it was interrupted before it could say it had stopped. */
  finishedAt: number | null
  /** The engine as it named itself. Null when it never said. */
  engine: string | null
  /** What was asked of it. */
  asked: { positions: number; quickMs: number; deepMs: number; lines: number }
  /** How many positions came back. */
  answered: number
  /** True only when the run covered every position it set out to. A cancelled run is not a finished one. */
  complete: boolean
  /** The plan's own account of what it covered and what it gave up, in the words the screen showed. */
  notes: string[]
}

export interface StoredStudy {
  /** The same as `gameId`. Here as well because the file is keyed by it and a record must name its own key. */
  id: string
  gameId: string
  /** The game's fingerprint when this was saved. What decides whether the tree may be grafted back on at all. */
  fingerprint: string
  startFen: string
  rootId: string
  nodes: StoredNode[]
  /** Where the person was looking. Restored only when that node is still reachable. */
  cursor: string | null
  annotations: Record<string, Annotation>
  evaluations: Record<string, NodeEvaluation>
  /** The highest node number handed out, so a reopened session cannot reuse an id a note points at. */
  counter: number
  runs: StudyRun[]
  savedAt: number
  version: number
}

/**
 * The file: every game's analysis, keyed by the game it is about.
 *
 * One file rather than one per game, because a study is small and the whole lot is read once when Chess World opens.
 * It is its own file and not part of `chess-games.json` for the reason the header gives: a study that cannot be read
 * must not be able to cost somebody the game it was about.
 */
export interface StoredStudies {
  studies: Record<string, StoredStudy>
  /**
   * Records in this file that Orbis could not read, left exactly as they were found.
   *
   * The file is written whole, so a record merely left out of a read is a record deleted from the disk the next time
   * anybody writes a note about any other game. They are carried here instead and never touched -- which is also
   * where one written by a newer Orbis waits for the Orbis that understands it.
   */
  unread?: Record<string, unknown>
}

export const emptyStudies = (): StoredStudies => ({ studies: {} })

// ---------------------------------------------------------------- turning a session into a record

/** What is kept about an open session. The game is not copied into it: the study is about a game, it is not one. */
export function studyFromSession(s: AnalysisSession, now: number, runs: readonly StudyRun[] = []): StoredStudy {
  const nodes: StoredNode[] = []
  for (const node of Object.values(s.tree.nodes)) {
    nodes.push({
      id: node.id,
      parentId: node.parentId,
      move: node.move,
      fen: node.fen,
      children: [...node.children],
      ...(node.label ? { label: node.label } : {})
    })
    if (nodes.length >= STUDY_CAPS.nodes) break
  }
  return {
    id: s.game.id,
    gameId: s.game.id,
    fingerprint: s.game.fingerprint,
    startFen: s.game.startFen,
    rootId: s.tree.rootId,
    nodes,
    cursor: s.cursor,
    annotations: { ...s.annotations },
    evaluations: { ...s.evaluations },
    counter: s.counter,
    runs: runs.slice(-STUDY_CAPS.runs).map((run) => ({ ...run, notes: [...run.notes] })),
    savedAt: now,
    version: STUDY_VERSION
  }
}

/** Is there anything here worth keeping, or is this a game somebody has only looked at? */
export function worthKeeping(s: AnalysisSession): boolean {
  if (Object.keys(s.annotations).length > 0) return true
  if (Object.keys(s.evaluations).length > 0) return true
  // More nodes than the game's own line means at least one branch was tried.
  if (Object.keys(s.tree.nodes).length > s.original.length) return true
  // A promoted branch, or a label, changes the tree without adding to it.
  if (Object.values(s.tree.nodes).some((node) => node.label)) return true
  return s.original.some((id, index) => index > 0 && s.tree.nodes[s.original[index - 1]]?.children[0] !== id)
}

/**
 * Putting one study into the file.
 *
 * The cap drops the analysis that was saved longest ago, and says which game's it was. It is here, in a pure
 * function, rather than in the store, so what happens when somebody has analysed five hundred games can be tested
 * without a disk.
 */
export function putStudy(held: StoredStudies, study: StoredStudy): { value: StoredStudies; notes: string[] } {
  const studies: Record<string, StoredStudy> = { ...held.studies, [study.gameId]: study }
  const notes: string[] = []
  const ids = Object.keys(studies)
  if (ids.length > STUDY_CAPS.studies) {
    const oldest = ids
      .filter((id) => id !== study.gameId)
      .sort((a, b) => (studies[a].savedAt ?? 0) - (studies[b].savedAt ?? 0))
      .slice(0, ids.length - STUDY_CAPS.studies)
    for (const id of oldest) delete studies[id]
    notes.push(`${STUDY_CAPS.studies} games' analyses are as many as are kept, so the ${oldest.length} saved longest ago ${oldest.length === 1 ? 'was' : 'were'} let go: ${oldest.join(', ')}.`)
  }
  return { value: { ...held, studies }, notes }
}

/** Taking one game's analysis out. Said as "nothing to remove" rather than reported as a removal that happened. */
export function dropStudy(held: StoredStudies, gameId: string): { value: StoredStudies; removed: boolean } {
  if (!held.studies[gameId]) return { value: held, removed: false }
  const studies = { ...held.studies }
  delete studies[gameId]
  return { value: { ...held, studies }, removed: true }
}

// ---------------------------------------------------------------- reading one back off the disk

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

const text = (raw: unknown, max: number): string | null =>
  typeof raw === 'string' && raw.trim() !== '' ? raw.slice(0, max) : null

const num = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null)

function readScore(raw: unknown): Score | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'none') return { kind: 'none' }
  if (raw.kind === 'cp' && num(raw.cp) !== null) return { kind: 'cp', cp: raw.cp as number }
  if (raw.kind === 'mate' && num(raw.moves) !== null) return { kind: 'mate', moves: raw.moves as number }
  return null
}

function readMove(raw: unknown): GameMove | null {
  if (!isObject(raw)) return null
  const san = text(raw.san, 12)
  const uci = text(raw.uci, 6)
  const fen = text(raw.fen, 120)
  if (san === null || uci === null || fen === null) return null
  return {
    ...raw,
    san,
    uci,
    fen,
    ...(text(raw.comment, STUDY_CAPS.noteChars) ? { comment: raw.comment as string } : {}),
    ...(Array.isArray(raw.nag) ? { nag: raw.nag.filter((one): one is string => typeof one === 'string').slice(0, 8) } : {}),
    ...(num(raw.clock) !== null ? { clock: raw.clock as number } : {})
  } as GameMove
}

function readAnnotation(raw: unknown): Annotation | null {
  if (!isObject(raw)) return null
  const body = text(raw.text, STUDY_CAPS.noteChars)
  const nags = Array.isArray(raw.nags)
    ? raw.nags.filter((one): one is string => typeof one === 'string' && one.trim() !== '').slice(0, 8)
    : []
  // An empty note is no note. Keeping one would read on screen as "somebody wrote nothing here".
  if (body === null && nags.length === 0) return null
  return {
    ...(body === null ? {} : { text: body }),
    ...(nags.length ? { nags } : {}),
    updatedAt: num(raw.updatedAt) ?? 0
  }
}

/**
 * One recorded engine answer.
 *
 * The position and the score are what make it an answer at all, so a record missing either is not read. Everything
 * that makes it a *judgement* rather than a number -- the depth, whether it was only a bound, which engine, when --
 * is kept exactly as it was stored, and a missing depth is read as "not recorded" rather than as zero. `classify`
 * refuses to name a move whose depth is unknown, which is the whole reason the difference matters.
 */
function readEvaluation(raw: unknown): NodeEvaluation | null {
  if (!isObject(raw)) return null
  const fen = text(raw.fen, 120)
  const score = readScore(raw.score)
  if (fen === null || score === null) return null
  const uciList = Array.isArray(raw.pvUci)
    ? raw.pvUci.filter((one): one is string => typeof one === 'string').slice(0, 64)
    : null
  return {
    ...raw,
    fen,
    score,
    depth: num(raw.depth),
    ...(typeof raw.bestmove === 'string' || raw.bestmove === null ? { bestmove: raw.bestmove } : {}),
    ...(uciList && uciList.length ? { pvUci: uciList } : {}),
    ...(text(raw.engine, 120) ? { engine: raw.engine as string } : {}),
    ...(num(raw.at) !== null ? { at: raw.at as number } : {}),
    ...(typeof raw.provisional === 'boolean' ? { provisional: raw.provisional } : {})
  } as NodeEvaluation
}

function readRun(raw: unknown): StudyRun | null {
  if (!isObject(raw)) return null
  const id = text(raw.id, 120)
  const startedAt = num(raw.startedAt)
  if (id === null || startedAt === null) return null
  const asked = isObject(raw.asked) ? raw.asked : {}
  return {
    id,
    startedAt,
    finishedAt: num(raw.finishedAt),
    engine: text(raw.engine, 120),
    asked: {
      positions: Math.max(0, Math.round(num(asked.positions) ?? 0)),
      quickMs: Math.max(0, Math.round(num(asked.quickMs) ?? 0)),
      deepMs: Math.max(0, Math.round(num(asked.deepMs) ?? 0)),
      lines: Math.max(1, Math.round(num(asked.lines) ?? 1))
    },
    answered: Math.max(0, Math.round(num(raw.answered) ?? 0)),
    complete: raw.complete === true,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((one): one is string => typeof one === 'string').slice(0, 24) : []
  }
}

export interface ReadStudy {
  /** Null when there is nothing here that could be read as a study at all. */
  study: StoredStudy | null
  /** What could not be read, in sentences meant to be shown as they are. */
  notes: string[]
}

/**
 * Reading one stored study.
 *
 * It never throws for its own sake: a study that cannot be read costs the study, and the caller decides what that
 * means for the file around it. What it does refuse outright is a record written by a newer Orbis -- reading that
 * would mean writing a shortened copy back the next time somebody wrote a note, which turns a study into a worse
 * version of itself without anybody being told.
 */
export function readStudy(raw: unknown): ReadStudy {
  const notes: string[] = []
  if (!isObject(raw)) return { study: null, notes }
  const gameId = text(raw.gameId, 80) ?? text(raw.id, 80)
  if (gameId === null) {
    return { study: null, notes: ['A saved analysis did not say which game it was about, so it could not be read. Nothing else was touched.'] }
  }
  const version = num(raw.version)
  if (version !== null && version > STUDY_VERSION) {
    return {
      study: null,
      notes: [`The saved analysis of one game was written by a newer Orbis (version ${version}, and this one reads ${STUDY_VERSION}), so it has been left exactly as it is rather than read into something this version understands. Nothing was deleted.`]
    }
  }
  const rootId = text(raw.rootId, 80) ?? 'root'
  const startFen = text(raw.startFen, 120) ?? ''
  const nodes: StoredNode[] = []
  let lostNodes = 0
  if (Array.isArray(raw.nodes)) {
    for (const row of raw.nodes) {
      if (nodes.length >= STUDY_CAPS.nodes) break
      if (!isObject(row)) { lostNodes += 1; continue }
      const id = text(row.id, 80)
      if (id === null) { lostNodes += 1; continue }
      const move = row.move === null || row.move === undefined ? null : readMove(row.move)
      const fen = text(row.fen, 120)
      // Every node but the start is a move, and a move with no position is not a node of a tree.
      if (fen === null || (id !== rootId && move === null)) { lostNodes += 1; continue }
      nodes.push({
        id,
        parentId: text(row.parentId, 80),
        move,
        fen,
        children: Array.isArray(row.children) ? row.children.filter((one): one is string => typeof one === 'string').slice(0, STUDY_CAPS.nodes) : [],
        ...(text(row.label, STUDY_CAPS.labelChars) ? { label: row.label as string } : {})
      })
    }
  } else if (raw.nodes !== undefined) {
    notes.push('The branches of a saved analysis were not a list, so none of them could be read. The notes and evaluations in the same record were kept.')
  }
  if (lostNodes > 0) {
    notes.push(`${lostNodes} branch${lostNodes === 1 ? '' : 'es'} of a saved analysis could not be read and were left out. Everything else in it was kept.`)
  }
  if (Array.isArray(raw.nodes) && raw.nodes.length > STUDY_CAPS.nodes) {
    notes.push(`A saved analysis has ${raw.nodes.length} branches and ${STUDY_CAPS.nodes} is as many as are read, so the rest were left out.`)
  }

  const annotations: Record<string, Annotation> = {}
  let lostNotes = 0
  if (isObject(raw.annotations)) {
    for (const [id, value] of Object.entries(raw.annotations)) {
      const one = readAnnotation(value)
      if (one === null) { lostNotes += 1; continue }
      annotations[id] = one
    }
  }
  if (lostNotes > 0) notes.push(`${lostNotes} saved note${lostNotes === 1 ? '' : 's'} could not be read and were left out.`)

  const evaluations: Record<string, NodeEvaluation> = {}
  let lostEvals = 0
  if (isObject(raw.evaluations)) {
    for (const [id, value] of Object.entries(raw.evaluations)) {
      const one = readEvaluation(value)
      if (one === null) { lostEvals += 1; continue }
      evaluations[id] = one
    }
  }
  if (lostEvals > 0) {
    notes.push(`${lostEvals} recorded engine answer${lostEvals === 1 ? '' : 's'} could not be read and were left out. A score without the position it was calculated in is not an answer about anything.`)
  }

  const runs = Array.isArray(raw.runs)
    ? raw.runs.map((row) => readRun(row)).filter((one): one is StudyRun => one !== null).slice(-STUDY_CAPS.runs)
    : []

  return {
    study: {
      ...raw,
      id: gameId,
      gameId,
      fingerprint: text(raw.fingerprint, 80) ?? '',
      startFen,
      rootId,
      nodes,
      cursor: text(raw.cursor, 80),
      annotations,
      evaluations,
      counter: Math.max(0, Math.round(num(raw.counter) ?? nodes.length)),
      runs,
      savedAt: num(raw.savedAt) ?? 0,
      version: STUDY_VERSION
    } as StoredStudy,
    notes
  }
}

// ---------------------------------------------------------------- putting one back on a game

export interface RestoredStudy {
  session: AnalysisSession
  /** True when a saved tree was grafted on. False means the session is the game and nothing else. */
  restored: boolean
  /** What could not be put back, and why, in sentences meant to be shown (Section 130). */
  notes: string[]
  /** How many branches, notes and engine answers came back. For saying so rather than leaving it to be noticed. */
  counts: { branches: number; notes: number; evaluations: number }
}

/** A node id maker that cannot collide with the ones a session already handed out. */
function idsFrom(start: number): { next: () => string; used: () => number } {
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
 * Opening a game with its saved analysis on it.
 *
 * The session is built from the game first, every time. That is what keeps the promise that a damaged study cannot
 * cost the game: whatever happens below, the moves, the main line and the report are the game's own.
 *
 * Then the stored tree is grafted on, move by move, through the rules -- not trusted. Each stored node is *mapped*
 * onto the node that the same moves reach in the new session, and the notes and evaluations are moved onto the
 * mapped ids. That is why a note cannot end up on the wrong move: the mapping is by position reached, not by the id
 * that happened to be written down. A stored move that cannot be played from its parent takes its own line out and
 * is named; everything beside it still comes back (Section 130).
 */
export function restoreStudy(game: StoredGame, study: StoredStudy | null): RestoredStudy {
  const base = openSession(game)
  const nothing = { branches: 0, notes: 0, evaluations: 0 }
  if (!study) return { session: base, restored: false, notes: [], counts: nothing }

  if (study.gameId !== game.id) {
    return {
      session: base,
      restored: false,
      counts: nothing,
      notes: [`The saved analysis found here was about a different game (${study.gameId}), so it has not been opened on this one.`]
    }
  }
  if (study.fingerprint && study.fingerprint !== game.fingerprint) {
    return {
      session: base,
      restored: false,
      counts: nothing,
      notes: ['This game\'s moves have changed since its analysis was saved, so the saved lines have not been put back: every one of them hangs off a position the game no longer reaches, and the notes would end up on different moves. The saved analysis is still on the disk and untouched.']
    }
  }

  const stored = new Map<string, StoredNode>()
  for (const node of study.nodes) if (!stored.has(node.id)) stored.set(node.id, node)
  const root = stored.get(study.rootId)
  const notes: string[] = []
  if (!root) {
    return {
      session: base,
      restored: false,
      counts: nothing,
      notes: ['The saved analysis has no starting position, so there was no tree to put back. The game itself is here in full.']
    }
  }
  if (positionKey(root.fen) !== positionKey(game.startFen)) {
    return {
      session: base,
      restored: false,
      counts: nothing,
      notes: ['The saved analysis starts from a different position than this game does, so it has not been put back. The game itself is here in full.']
    }
  }

  // Everything the graft needs: the tree as it grows, which stored node became which session node, and what to say.
  let tree = base.tree
  const map = new Map<string, string>([[study.rootId, base.tree.rootId]])
  const make = idsFrom(Math.max(base.counter, 0))
  const order: { parentId: string; children: string[] }[] = []
  const seen = new Set<string>([study.rootId])
  let unplayable = 0
  let orphaned = 0
  let branches = 0

  const walk = (storedParentId: string): void => {
    const parent = stored.get(storedParentId)
    const sessionParentId = map.get(storedParentId)
    if (!parent || !sessionParentId) return
    const wanted: string[] = []
    for (const childId of parent.children) {
      const child = stored.get(childId)
      if (!child) { orphaned += 1; continue }
      if (seen.has(childId)) { orphaned += 1; continue }
      seen.add(childId)
      if (!child.move) { orphaned += 1; continue }
      const here = tree.nodes[sessionParentId]
      if (!here) continue
      const made = applyMove(here.fen, child.move.uci || child.move.san)
      if (!made) {
        unplayable += 1
        notes.push(`${child.move.san} cannot be played in the position it was saved against, so that line and everything under it were left out. The rest of the analysis came back.`)
        continue
      }
      // The stored move is used, but with the position the rules just produced: a stored FEN that had drifted from
      // the move beside it would otherwise be carried into every line built on top of it.
      const added = addToTree(tree, sessionParentId, { ...child.move, san: made.san, uci: made.uci, fen: made.after }, make.next)
      if (!added) continue
      const reused = added.tree === tree
      tree = added.tree
      if (!reused) branches += 1
      map.set(childId, added.nodeId)
      // Two stored branches that play the same move from the same position are one branch. Listing it twice would
      // make a tree that says it loops, so the second mention is dropped here rather than found later.
      if (!wanted.includes(added.nodeId)) wanted.push(added.nodeId)
      if (child.label) {
        const node = tree.nodes[added.nodeId]
        if (node) tree = { ...tree, nodes: { ...tree.nodes, [added.nodeId]: { ...node, label: child.label } } }
      }
      walk(childId)
    }
    if (wanted.length) order.push({ parentId: sessionParentId, children: wanted })
  }
  walk(study.rootId)

  /*
   * The order of a node's children is not decoration: the first child is what every screen means by the main line,
   * and promoting a branch is exactly a change to that order. So it is restored, with anything the stored record did
   * not mention kept after it rather than dropped -- which is what keeps the game's own next move in the tree even
   * if a stored node had forgotten it.
   */
  for (const row of order) {
    const node = tree.nodes[row.parentId]
    if (!node) continue
    const rest = node.children.filter((id) => !row.children.includes(id))
    const children = [...row.children, ...rest]
    if (children.length === node.children.length && children.every((id, i) => id === node.children[i])) continue
    tree = { ...tree, nodes: { ...tree.nodes, [row.parentId]: { ...node, children } } }
  }

  if (orphaned > 0) {
    notes.push(`${orphaned} saved branch${orphaned === 1 ? '' : 'es'} pointed at a move that is not in the file, so ${orphaned === 1 ? 'it was' : 'they were'} left out. Everything that could be reached from the start came back.`)
  }

  let session: AnalysisSession = {
    ...base,
    tree,
    cursor: base.tree.rootId,
    annotations: {},
    evaluations: {},
    counter: make.used()
  }

  let keptNotes = 0
  let lostNotes = 0
  const annotations: Record<string, Annotation> = {}
  for (const [storedId, annotation] of Object.entries(study.annotations)) {
    const nodeId = map.get(storedId)
    if (!nodeId || !session.tree.nodes[nodeId]) { lostNotes += 1; continue }
    annotations[nodeId] = annotation
    keptNotes += 1
  }
  session = { ...session, annotations }
  if (lostNotes > 0) {
    notes.push(`${lostNotes} saved note${lostNotes === 1 ? '' : 's'} belonged to a move that is no longer in the analysis, so ${lostNotes === 1 ? 'it has' : 'they have'} been left out rather than moved onto another move.`)
  }

  let keptEvals = 0
  let lostEvals = 0
  let wrongPosition = 0
  for (const [storedId, evaluation] of Object.entries(study.evaluations)) {
    const nodeId = map.get(storedId)
    const node = nodeId ? session.tree.nodes[nodeId] : null
    if (!node) { lostEvals += 1; continue }
    if (positionKey(node.fen) !== positionKey(evaluation.fen)) { wrongPosition += 1; continue }
    // Through `recordEvaluation`, so there is one place that decides whether an answer may sit on a node.
    session = recordEvaluation(session, node.id, evaluation)
    keptEvals += 1
  }
  if (lostEvals > 0) {
    notes.push(`${lostEvals} recorded engine answer${lostEvals === 1 ? '' : 's'} belonged to a move that is no longer in the analysis and ${lostEvals === 1 ? 'was' : 'were'} left out.`)
  }
  if (wrongPosition > 0) {
    notes.push(`${wrongPosition} recorded engine answer${wrongPosition === 1 ? ' was' : 's were'} calculated in a different position than the move ${wrongPosition === 1 ? 'it is' : 'they are'} saved against, so ${wrongPosition === 1 ? 'it has' : 'they have'} been left out. A score shown against the wrong position is worse than no score.`)
  }

  const cursor = study.cursor ? map.get(study.cursor) : null
  if (cursor && session.tree.nodes[cursor]) session = { ...session, cursor }

  return {
    session,
    restored: true,
    notes,
    counts: { branches, notes: keptNotes, evaluations: keptEvals }
  }
}

// ---------------------------------------------------------------- deciding whether to write

/**
 * A short name for exactly what is in a study, so a save that would change nothing is not sent.
 *
 * This is what stops a note being written to the disk once per keystroke and once per redraw. It names a record; it
 * does not protect one, so it is a small non-cryptographic hash and nothing rests on it being hard to forge.
 */
export function studyDigest(study: StoredStudy): string {
  const parts: string[] = [study.gameId, study.fingerprint, study.rootId, study.cursor ?? '-']
  for (const node of study.nodes) {
    parts.push(`${node.id}<${node.parentId ?? '-'}:${node.move?.uci ?? '-'}:${node.label ?? ''}:${node.children.join('.')}`)
  }
  for (const [id, annotation] of Object.entries(study.annotations).sort((a, b) => a[0].localeCompare(b[0]))) {
    parts.push(`a${id}:${annotation.text ?? ''}:${(annotation.nags ?? []).join('')}`)
  }
  for (const [id, evaluation] of Object.entries(study.evaluations).sort((a, b) => a[0].localeCompare(b[0]))) {
    const score = evaluation.score.kind === 'cp' ? `cp${evaluation.score.cp}` : evaluation.score.kind === 'mate' ? `m${evaluation.score.moves}` : 'none'
    parts.push(`e${id}:${score}:${evaluation.depth ?? '-'}:${evaluation.engine ?? '-'}:${evaluation.provisional === true ? 'b' : ''}`)
  }
  for (const run of study.runs) parts.push(`r${run.id}:${run.answered}:${run.complete ? 'y' : 'n'}`)
  const body = parts.join('|')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

/**
 * Where the saving of a session stands.
 *
 * Section 103 asks for one of two things and will not take neither: either the work is kept by itself, or the screen
 * says plainly that it is not. This is how the screen says which.
 */
export type SaveState =
  | { kind: 'reading' }
  /** Nothing has been explored, so there is nothing to keep yet. */
  | { kind: 'empty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /** Changed since the last save, and the save is coming. */
  | { kind: 'pending' }
  /** Nothing was written, and this is why. The one state that must never be shown as saved. */
  | { kind: 'refused'; why: string }

export function describeSave(state: SaveState): string {
  if (state.kind === 'reading') return 'Looking for anything you saved about this game.'
  if (state.kind === 'empty') return 'Nothing to keep yet. Your lines and notes are saved as you make them.'
  if (state.kind === 'saving') return 'Saving your lines and notes.'
  if (state.kind === 'pending') return 'Not saved yet.'
  if (state.kind === 'refused') return state.why
  const when = new Date(state.at)
  const hours = String(when.getHours()).padStart(2, '0')
  const minutes = String(when.getMinutes()).padStart(2, '0')
  return `Your lines and notes are saved, as at ${hours}:${minutes}.`
}

// ---------------------------------------------------------------- what a run was (Section 158)

/** A run read back, said in words: what was asked of the engine and what came back. */
export function describeRun(run: StudyRun): string {
  const when = new Date(run.startedAt)
  const date = `${when.getDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][when.getMonth()]}`
  const engine = run.engine ? run.engine : 'an engine that did not name itself'
  const shape = `${run.asked.quickMs}ms a position first, then ${run.asked.deepMs}ms on the ones where the numbers moved`
  const how = run.complete
    ? `covered all ${run.asked.positions} positions`
    : `stopped after ${run.answered} of ${run.asked.positions} positions`
  return `${date}: ${engine}, ${shape}. It ${how}.`
}

/**
 * Why a saved report may no longer be the answer, when it is not.
 *
 * Three things make an earlier run stale, and none of them makes it worthless -- which is why this returns a sentence
 * to show beside the report rather than hiding it. Null when nothing has changed since.
 */
export function runOutdated(run: StudyRun, now: { engine: string | null; evaluations: number }): string | null {
  const said: string[] = []
  if (run.engine && now.engine && run.engine !== now.engine) {
    said.push(`it was produced by ${run.engine} and the engine on this computer is now ${now.engine}`)
  }
  if (!run.complete) said.push('it stopped before it covered every position it set out to')
  if (now.evaluations > run.answered) {
    said.push(`${now.evaluations - run.answered} more position${now.evaluations - run.answered === 1 ? ' has' : 's have'} been searched since`)
  }
  if (!said.length) return null
  return `This is the earlier run, not a new one: ${said.join(', and ')}. What it found is still what it found.`
}

// ---------------------------------------------------------------- naming a branch (Section 126)

/**
 * Putting a name on a branch.
 *
 * A name is extra, never a replacement: the moves are still the moves, and a branch with no name reads exactly as it
 * did before. An empty name is no name rather than a stored empty string.
 *
 * It is deliberately not on the undo stack. That stack holds changes to the analysis itself -- a promotion, a
 * removal, a note -- and each entry has to be able to put the tree back exactly. A name is one word in one place and
 * typing the old one back is the whole of undoing it, so adding it would have meant a person's rename getting in the
 * way of taking back the line they removed a moment earlier.
 */
export function labelBranch(s: AnalysisSession, nodeId: string, label: string): AnalysisSession {
  const node = s.tree.nodes[nodeId]
  if (!node) return s
  const clean = label.trim().slice(0, STUDY_CAPS.labelChars)
  if ((node.label ?? '') === clean) return s
  const next: VariationNode = { ...node }
  if (clean) next.label = clean
  else delete next.label
  return { ...s, tree: { ...s.tree, nodes: { ...s.tree.nodes, [nodeId]: next } } }
}

export function labelOf(s: AnalysisSession, nodeId: string): string | null {
  return s.tree.nodes[nodeId]?.label ?? null
}

export interface BranchEntry {
  nodeId: string
  label: string | null
  /** The move the branch starts with, written as it reads: "12… Nf3". */
  startsWith: string
  /** Moves from the start of the game to the branch's first move. */
  ply: number
  /** How deep inside other branches it sits. 0 for an alternative to a main-line move. */
  depth: number
  /** How many moves are in the branch, following its own main continuation. */
  length: number
  /** True when this line is the game as it was played, sitting as a variation because something was promoted. */
  played: boolean
  /** How many notes are on this line, including the ones on its own sub-branches. */
  notes: number
}

/**
 * Every branch in the tree, as a list somebody can read and sort (Section 126).
 *
 * A branch is a node that is not its parent's first child -- that is what makes it an alternative rather than the
 * continuation. The move list shows the same tree nested; this shows it as a list, which is what a study with forty
 * branches in it needs. There is no cap on how many there may be.
 */
export function branchList(s: AnalysisSession): BranchEntry[] {
  const out: BranchEntry[] = []
  const original = new Set(s.original)
  const lengthOf = (nodeId: string): number => {
    let count = 0
    let at = nodeId
    const seen = new Set([at])
    for (;;) {
      const child = s.tree.nodes[at]?.children[0]
      if (!child || seen.has(child)) break
      seen.add(child)
      count += 1
      at = child
    }
    return count + 1
  }
  const notesUnder = (nodeId: string): number => {
    let count = 0
    const stack = [nodeId]
    const seen = new Set(stack)
    while (stack.length) {
      const at = stack.pop() as string
      if (s.annotations[at]) count += 1
      for (const child of s.tree.nodes[at]?.children ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        stack.push(child)
      }
    }
    return count
  }
  const walk = (nodeId: string, ply: number, depth: number): void => {
    const node = s.tree.nodes[nodeId]
    if (!node) return
    for (const [index, childId] of node.children.entries()) {
      const child = s.tree.nodes[childId]
      if (!child) continue
      if (index > 0 && child.move) {
        out.push({
          nodeId: childId,
          label: child.label ?? null,
          startsWith: `${moveNumber(node.fen)}${sideToMove(node.fen) === 'w' ? '.' : '…'}${child.move.san}`,
          ply: ply + 1,
          depth,
          length: lengthOf(childId),
          played: original.has(childId),
          notes: notesUnder(childId)
        })
      }
      walk(childId, ply + 1, index > 0 ? depth + 1 : depth)
    }
  }
  walk(s.tree.rootId, 0, 0)
  return out
}

export type BranchOrder = 'where' | 'name' | 'length'

/** The same branches in a chosen order. A branch with no name goes last under "name", rather than first as "". */
export function sortBranches(entries: readonly BranchEntry[], order: BranchOrder): BranchEntry[] {
  const list = [...entries]
  if (order === 'name') {
    return list.sort((a, b) => {
      if ((a.label === null) !== (b.label === null)) return a.label === null ? 1 : -1
      return (a.label ?? '').localeCompare(b.label ?? '') || a.ply - b.ply
    })
  }
  if (order === 'length') return list.sort((a, b) => b.length - a.length || a.ply - b.ply)
  return list.sort((a, b) => a.ply - b.ply || a.depth - b.depth)
}

// ---------------------------------------------------------------- writing a study out (Section 129)

export interface StudyPgn {
  text: string
  /** What PGN cannot carry, said plainly. This is never an empty list for a study with anything in it. */
  omitted: string[]
}

/**
 * A study as PGN: the lines in brackets, the notes in braces.
 *
 * What this is honest about matters more than what it writes. PGN carries moves, comments and move marks, and that
 * is all it carries, so three things somebody has here do not survive the trip and the list says so rather than the
 * export claiming to be complete:
 *
 *   - **The engine's answers.** PGN has no field that keeps a score *with* the depth it reached, the engine that
 *     produced it and whether it was only a bound. A bare number in a comment reads as a settled judgement, which is
 *     exactly what an unsettled one is not, so none is written. The saved analysis keeps them.
 *   - **Which line was the game.** PGN's main line is this study's main line. If a branch has been promoted, the
 *     game as it was played is written as a variation, and nothing in the file says it was the game.
 *   - **A branch's name.** There is no name for a variation in PGN, so a name is written as the first comment inside
 *     the branch. A reader will show it as a comment, because that is what it now is.
 */
export function writeStudyPgn(s: AnalysisSession): StudyPgn {
  const head = writePgn({ ...s.game, moves: [] }).split('\n\n')[0]
  const tokens: string[] = []
  const seen = new Set<string>([s.tree.rootId])

  const put = (parent: VariationNode, node: VariationNode, forceNumber: boolean): void => {
    if (!node.move) return
    const white = sideToMove(parent.fen) === 'w'
    if (white) tokens.push(`${moveNumber(parent.fen)}.`)
    else if (forceNumber) tokens.push(`${moveNumber(parent.fen)}...`)
    tokens.push(node.move.san)
    const annotation = s.annotations[node.id]
    for (const nag of annotation?.nags ?? []) tokens.push(nag)
    for (const nag of node.move.nag ?? []) tokens.push(nag)
    const said: string[] = []
    if (node.label) said.push(`Line: ${node.label}`)
    if (node.move.comment) said.push(`From the file: ${node.move.comment}`)
    if (annotation?.text) said.push(annotation.text)
    if (said.length) tokens.push(`{${said.join(' — ').replace(/[{}]/g, '')}}`)
  }

  const walk = (fromId: string, forceNumber: boolean): void => {
    let at = fromId
    let force = forceNumber
    for (;;) {
      const parent = s.tree.nodes[at]
      const firstId = parent?.children[0]
      if (!parent || !firstId || seen.has(firstId)) break
      const child = s.tree.nodes[firstId]
      if (!child?.move) break
      seen.add(firstId)
      put(parent, child, force)
      force = false
      for (const altId of parent.children.slice(1)) {
        const alt = s.tree.nodes[altId]
        if (!alt?.move || seen.has(altId)) continue
        seen.add(altId)
        tokens.push('(')
        put(parent, alt, true)
        walk(altId, false)
        tokens.push(')')
      }
      at = firstId
    }
  }
  // The first move written always carries its number, because a game that starts from a set-up position can start
  // with a Black move -- and "e5" with no number in front of it reads as White's first move to anybody and anything.
  walk(s.tree.rootId, true)
  tokens.push(s.game.meta.result)

  const body: string[] = []
  let line = ''
  for (const token of tokens) {
    if (line.length + token.length + 1 > 80) { body.push(line); line = '' }
    line = line ? `${line} ${token}` : token
  }
  if (line) body.push(line)

  const omitted: string[] = []
  const evaluations = Object.keys(s.evaluations).length
  if (evaluations) {
    omitted.push(`The ${evaluations} recorded engine answer${evaluations === 1 ? '' : 's'} ${evaluations === 1 ? 'is' : 'are'} not written out. PGN has no field that keeps a score with the depth it reached, the engine that produced it and whether it was only a bound, and a bare number in a comment would read as settled. They stay in your saved analysis.`)
  }
  const promoted = s.original.some((id, index) => index > 0 && s.tree.nodes[s.original[index - 1]]?.children[0] !== id)
  if (promoted) {
    omitted.push('A line you promoted is the main line of this file, so the game as it was played is written as a variation. Nothing in PGN says which one was the game.')
  }
  const labels = Object.values(s.tree.nodes).filter((node) => node.label).length
  if (labels) {
    omitted.push(`${labels} branch name${labels === 1 ? '' : 's'} ${labels === 1 ? 'is' : 'are'} written as the first comment inside the branch, because PGN has no name for a variation.`)
  }
  omitted.push('Where you were looking, and what each pass of the engine was asked to do, are not part of PGN. They stay in your saved analysis.')

  return { text: `${head}\n\n${body.join('\n')}\n`, omitted }
}

/** The scores in a study, written out for a person to read, with what each one rests on. Nothing is rounded away. */
export function describeEvaluation(evaluation: NodeEvaluation | null): string {
  if (!evaluation) return 'Not searched.'
  const parts: string[] = [formatScore(evaluation.score)]
  parts.push(evaluation.depth === null ? 'at a depth that was not recorded' : `${evaluation.depth} deep`)
  if (evaluation.provisional) parts.push('a bound, not a settled score')
  if (evaluation.engine) parts.push(`from ${evaluation.engine}`)
  return parts.join(', ')
}
