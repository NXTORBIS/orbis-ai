import { START_FEN, checkFen } from './rules.ts'
import { buildMoves, fingerprintOf, type GameMeta, type GameMove, type GameResult, type PlayerInfo } from './model.ts'

/**
 * Reading and writing chess games as files.
 *
 * PGN is a format, not free text, and it is read here as one: tags, then moves, with comments, variations and
 * annotation marks in between. Two things are kept apart throughout, because a person needs to be told which of them
 * went wrong (Sections 401, 402):
 *
 *   - **Reading**: the file is or is not shaped like a game.
 *   - **Playing**: the moves can or cannot actually be played.
 *
 * A file can be perfectly formed and contain a move that is not legal. That is not a parsing error and must not be
 * reported as one, nor quietly accepted as a game.
 *
 * Nothing here is invented. A game with no date keeps no date.
 */

export type PgnProblem =
  | 'empty'
  | 'no-games'
  | 'bad-tag'
  | 'bad-move-text'
  | 'illegal-move'
  | 'bad-start-position'
  | 'truncated'
  | 'too-large'
  | 'unsupported-variant'

export interface PgnWarning { kind: PgnProblem | 'note'; message: string }

export interface ParsedGame {
  meta: GameMeta
  startFen: string
  moves: GameMove[]
  /** The moves as written, before they were played: kept when the game could not be built. */
  written: string[]
  variant: string
  fingerprint: string
  ok: boolean
  problem?: PgnProblem
  reason?: string
  warnings: PgnWarning[]
  /** Where in the file this game began, for pointing at it. */
  index: number
}

export interface PgnReadResult {
  games: ParsedGame[]
  /** Games that could not be built at all. They are listed, never dropped in silence. */
  failed: number
  warnings: PgnWarning[]
}

export const PGN_LIMITS = {
  bytes: 64 * 1024 * 1024,
  games: 20_000,
  movesPerGame: 2_000,
  commentChars: 20_000
}

/** The variants named in the wild that Orbis does not play. Recognised so they are refused, not misread. */
const KNOWN_VARIANTS = new Set(['standard', 'chess', 'normal', 'classical', 'from position'])

const unescapeTag = (value: string): string => value.replace(/\\(["\\])/g, '$1')

function parseTags(block: string): { tags: Record<string, string>; warnings: PgnWarning[] } {
  const tags: Record<string, string> = {}
  const warnings: PgnWarning[] = []
  const re = /\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) tags[m[1]] = unescapeTag(m[2])
  // A line that looks like a tag but is not one is worth saying, rather than skipping in silence.
  for (const line of block.split(/\r?\n/)) {
    const text = line.trim()
    if (text.startsWith('[') && !/\[\s*[A-Za-z0-9_]+\s+"(?:[^"\\]|\\.)*"\s*\]/.test(text)) {
      warnings.push({ kind: 'bad-tag', message: `This line is not a valid tag and was skipped: ${text.slice(0, 80)}` })
    }
  }
  return { tags, warnings }
}

const asResult = (value: string | undefined): GameResult =>
  value === '1-0' || value === '0-1' || value === '1/2-1/2' ? value : '*'

function player(tags: Record<string, string>, colour: 'White' | 'Black'): PlayerInfo {
  const info: PlayerInfo = {}
  const name = tags[colour]?.trim()
  // "?" is PGN's way of saying it does not know. It is not a name.
  if (name && name !== '?') info.name = name
  const rating = Number.parseInt(tags[`${colour}Elo`] ?? '', 10)
  if (Number.isFinite(rating) && rating > 0) info.rating = rating
  const title = tags[`${colour}Title`]?.trim()
  if (title && title !== '-') info.title = title
  return info
}

const KNOWN_TAGS = new Set([
  'Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'WhiteTitle', 'BlackTitle',
  'ECO', 'Opening', 'TimeControl', 'Termination', 'FEN', 'SetUp', 'Variant'
])

function metaFrom(tags: Record<string, string>): GameMeta {
  const meta: GameMeta = { white: player(tags, 'White'), black: player(tags, 'Black'), result: asResult(tags.Result) }
  const put = (key: keyof GameMeta, value: string | undefined): void => {
    const text = value?.trim()
    if (text && text !== '?' && text !== '????.??.??') (meta as unknown as Record<string, unknown>)[key] = text
  }
  put('event', tags.Event)
  put('site', tags.Site)
  put('date', tags.Date)
  put('round', tags.Round)
  put('eco', tags.ECO)
  put('opening', tags.Opening)
  put('timeControl', tags.TimeControl)
  put('termination', tags.Termination)
  const extra: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags)) if (!KNOWN_TAGS.has(key)) extra[key] = value
  if (Object.keys(extra).length) meta.extra = extra
  return meta
}

interface WrittenMove { san: string; comment?: string; nag?: string[]; clock?: number }

/**
 * Pulling the moves out of the move text.
 *
 * Variations in brackets are skipped here rather than played: they are alternatives somebody wrote down, not the game,
 * and mixing them into the line is how an imported game ends up with moves nobody made. The game's own line is what
 * is built; a study keeps the alternatives (Section 105).
 */
export function readMoveText(text: string): { moves: WrittenMove[]; result?: GameResult; warnings: PgnWarning[] } {
  const warnings: PgnWarning[] = []
  const moves: WrittenMove[] = []
  let result: GameResult | undefined
  let i = 0
  let depth = 0
  let pendingComment: string | undefined
  let pendingNags: string[] = []
  const attach = (): void => {
    if (!moves.length) return
    const last = moves[moves.length - 1]
    if (pendingComment) {
      last.comment = last.comment ? `${last.comment} ${pendingComment}` : pendingComment
      const clock = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(pendingComment)
      if (clock) last.clock = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    }
    if (pendingNags.length) last.nag = [...(last.nag ?? []), ...pendingNags]
    pendingComment = undefined
    pendingNags = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') {
      const end = text.indexOf('}', i)
      if (end === -1) {
        warnings.push({ kind: 'truncated', message: 'A comment was never closed; the rest of the game was ignored.' })
        break
      }
      const body = text.slice(i + 1, end).trim().slice(0, PGN_LIMITS.commentChars)
      if (depth === 0) pendingComment = pendingComment ? `${pendingComment} ${body}` : body
      i = end + 1
      attach()
      continue
    }
    if (ch === ';') {
      const end = text.indexOf('\n', i)
      const body = text.slice(i + 1, end === -1 ? undefined : end).trim()
      if (depth === 0 && body) { pendingComment = pendingComment ? `${pendingComment} ${body}` : body; attach() }
      i = end === -1 ? text.length : end + 1
      continue
    }
    if (ch === '(') { depth += 1; i += 1; continue }
    if (ch === ')') { depth = Math.max(0, depth - 1); i += 1; continue }
    if (ch === '$') {
      const m = /^\$(\d+)/.exec(text.slice(i))
      if (m) { if (depth === 0) { pendingNags.push(`$${m[1]}`); attach() } i += m[0].length; continue }
      i += 1
      continue
    }
    if (/\s/.test(ch)) { i += 1; continue }
    // A move number, with or without dots.
    const number = /^\d+\.(\.\.)?/.exec(text.slice(i))
    if (number) { i += number[0].length; continue }
    const end = /^(1-0|0-1|1\/2-1\/2|\*)/.exec(text.slice(i))
    if (end) {
      if (depth === 0) result = asResult(end[1] === '*' ? '*' : end[1])
      i += end[0].length
      continue
    }
    const token = /^[^\s{};()$]+/.exec(text.slice(i))
    if (!token) { i += 1; continue }
    const word = token[0]
    i += word.length
    if (depth > 0) continue
    // "..." on its own, and other junk, is not a move.
    if (/^\.+$/.test(word)) continue
    const san = word.replace(/[?!]+$/, '')
    const marks = word.slice(san.length)
    if (!/^(O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)[+#]?$/.test(san)) {
      warnings.push({ kind: 'bad-move-text', message: `"${word.slice(0, 20)}" is not a move and was skipped.` })
      continue
    }
    if (moves.length >= PGN_LIMITS.movesPerGame) {
      warnings.push({ kind: 'too-large', message: `This game has more than ${PGN_LIMITS.movesPerGame} moves; the rest was not read.` })
      break
    }
    moves.push({ san, ...(marks ? { nag: [marks] } : {}) })
    attach()
  }
  attach()
  return { moves, ...(result ? { result } : {}), warnings }
}

/** Splits a file into its games: a run of tags followed by its move text. */
function splitGames(text: string): { tags: string; moves: string }[] {
  const games: { tags: string; moves: string }[] = []
  const lines = text.split(/\r?\n/)
  let tags: string[] = []
  let moves: string[] = []
  let inTags = false
  const push = (): void => {
    if (tags.length || moves.join(' ').trim()) games.push({ tags: tags.join('\n'), moves: moves.join('\n') })
    tags = []
    moves = []
  }
  for (const line of lines) {
    const text2 = line.trim()
    const isTag = text2.startsWith('[') && text2.endsWith(']')
    if (isTag) {
      // A tag after move text means the previous game has ended.
      if (!inTags && moves.join('').trim()) push()
      inTags = true
      tags.push(line)
      continue
    }
    inTags = false
    moves.push(line)
  }
  push()
  return games.filter((g) => g.tags.trim() || g.moves.trim())
}

/** Reads a whole file. One bad game never stops the good ones. */
export function readPgn(text: string, opts: { limit?: number } = {}): PgnReadResult {
  const warnings: PgnWarning[] = []
  if (!text || !text.trim()) return { games: [], failed: 0, warnings: [{ kind: 'empty', message: 'The file is empty.' }] }
  if (text.length > PGN_LIMITS.bytes) {
    return { games: [], failed: 0, warnings: [{ kind: 'too-large', message: 'This file is larger than Orbis will read in one go.' }] }
  }
  const blocks = splitGames(text)
  if (!blocks.length) return { games: [], failed: 0, warnings: [{ kind: 'no-games', message: 'No games were found in this file.' }] }
  const limit = Math.min(opts.limit ?? PGN_LIMITS.games, PGN_LIMITS.games)
  const games: ParsedGame[] = []
  let failed = 0
  for (const [index, block] of blocks.entries()) {
    if (games.length >= limit) {
      warnings.push({ kind: 'too-large', message: `The file holds more than ${limit} games; the rest were not read.` })
      break
    }
    const { tags, warnings: tagWarnings } = parseTags(block.tags)
    const meta = metaFrom(tags)
    const written = readMoveText(block.moves)
    if (written.result && meta.result === '*') meta.result = written.result
    const variantTag = (tags.Variant ?? '').trim().toLowerCase()
    const variant = variantTag && !KNOWN_VARIANTS.has(variantTag) ? variantTag : 'standard'
    const startFen = tags.FEN?.trim() || START_FEN
    const base: Omit<ParsedGame, 'ok' | 'moves' | 'fingerprint'> = {
      meta,
      startFen,
      written: written.moves.map((m) => m.san),
      variant,
      warnings: [...tagWarnings, ...written.warnings],
      index
    }
    if (variant !== 'standard') {
      failed += 1
      games.push({ ...base, ok: false, moves: [], fingerprint: '', problem: 'unsupported-variant', reason: `This game is ${variant}, which Orbis does not play. It was kept as written and not read as ordinary chess.` })
      continue
    }
    if (tags.FEN && !checkFen(startFen).ok) {
      failed += 1
      games.push({ ...base, ok: false, moves: [], fingerprint: '', problem: 'bad-start-position', reason: checkFen(startFen).reason ?? 'The starting position is not valid.' })
      continue
    }
    const built = buildMoves(startFen, written.moves)
    if (!built.ok) {
      failed += 1
      const at = built.failedAt
      games.push({
        ...base,
        ok: false,
        moves: built.moves,
        fingerprint: '',
        problem: 'illegal-move',
        reason: at ? `Move ${Math.floor(at.index / 2) + 1}${at.index % 2 === 0 ? '' : '…'} "${at.move}" cannot be played in the position it reaches. The ${built.moves.length} legal moves before it were kept.` : 'A move could not be played.'
      })
      continue
    }
    games.push({ ...base, ok: true, moves: built.moves, fingerprint: fingerprintOf(startFen, built.moves) })
  }
  return { games, failed, warnings }
}

const escapeTag = (value: string): string => value.replace(/[\\"]/g, '\\$&')

function tagPair(name: string, value: string | undefined): string | null {
  if (value === undefined || value === '') return null
  return `[${name} "${escapeTag(String(value))}"]`
}

/** Writes a game back out. Everything Orbis holds that PGN can carry goes in; nothing is made up to fill a tag. */
export function writePgn(game: { meta: GameMeta; startFen: string; moves: GameMove[]; variant?: string }): string {
  const meta = game.meta
  const lines: (string | null)[] = [
    tagPair('Event', meta.event ?? '?'),
    tagPair('Site', meta.site ?? '?'),
    tagPair('Date', meta.date ?? '????.??.??'),
    tagPair('Round', meta.round ?? '?'),
    tagPair('White', meta.white.name ?? '?'),
    tagPair('Black', meta.black.name ?? '?'),
    tagPair('Result', meta.result)
  ]
  if (meta.white.rating) lines.push(tagPair('WhiteElo', String(meta.white.rating)))
  if (meta.black.rating) lines.push(tagPair('BlackElo', String(meta.black.rating)))
  if (meta.white.title) lines.push(tagPair('WhiteTitle', meta.white.title))
  if (meta.black.title) lines.push(tagPair('BlackTitle', meta.black.title))
  if (meta.eco) lines.push(tagPair('ECO', meta.eco))
  if (meta.opening) lines.push(tagPair('Opening', meta.opening))
  if (meta.timeControl) lines.push(tagPair('TimeControl', meta.timeControl))
  if (meta.termination) lines.push(tagPair('Termination', meta.termination))
  if (game.variant && game.variant !== 'standard') lines.push(tagPair('Variant', game.variant))
  // A game that does not start from the usual position says so, or its moves cannot be replayed.
  if (game.startFen && game.startFen !== START_FEN) {
    lines.push(tagPair('SetUp', '1'))
    lines.push(tagPair('FEN', game.startFen))
  }
  for (const [key, value] of Object.entries(meta.extra ?? {})) lines.push(tagPair(key, value))

  const first = Number.parseInt((game.startFen || START_FEN).trim().split(/\s+/)[5] ?? '1', 10) || 1
  const blackFirst = (game.startFen || START_FEN).trim().split(/\s+/)[1] === 'b'
  const tokens: string[] = []
  let number = first
  for (const [index, move] of game.moves.entries()) {
    const isWhite = blackFirst ? index % 2 === 1 : index % 2 === 0
    if (isWhite) tokens.push(`${number}.`)
    else if (index === 0) tokens.push(`${number}...`)
    tokens.push(move.san)
    for (const nag of move.nag ?? []) tokens.push(nag)
    if (move.comment) tokens.push(`{${move.comment.replace(/[{}]/g, '')}}`)
    if (!isWhite) number += 1
  }
  tokens.push(meta.result)

  // PGN wraps at 80 columns by convention, and a reader is happier for it.
  const body: string[] = []
  let line = ''
  for (const token of tokens) {
    if (line.length + token.length + 1 > 80) { body.push(line); line = '' }
    line = line ? `${line} ${token}` : token
  }
  if (line) body.push(line)
  return `${lines.filter(Boolean).join('\n')}\n\n${body.join('\n')}\n`
}
