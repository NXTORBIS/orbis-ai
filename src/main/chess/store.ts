import { randomUUID } from 'node:crypto'
import { Collection, personalFile } from '../storage/jsonFile.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { START_FEN, checkFen } from '../../shared/chess/rules.ts'
import { buildMoves, fingerprintOf, newGame, type GameMeta, type GameSource, type StoredGame } from '../../shared/chess/model.ts'
import { readPgn, writePgn, type ParsedGame } from '../../shared/chess/pgn.ts'

/**
 * Where a person's chess lives: their games, and nothing else's.
 *
 * It follows the profile, like everything personal in Orbis, so two people on one computer never see each other's
 * games (Sections 008, 441). What is read from disk is checked before it is believed: a record that cannot be read is
 * left alone rather than replaced with an empty game, because "your games came back empty" and "your games are gone"
 * are the same thing to the person who lost them (Section 020).
 */

const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function normalizePlayer(raw: unknown): { name?: string; rating?: number; title?: string } {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: { name?: string; rating?: number; title?: string } = {}
  if (typeof r.name === 'string' && r.name.trim()) out.name = r.name.slice(0, 120)
  const rating = num(r.rating)
  if (rating !== undefined && rating > 0) out.rating = Math.round(rating)
  if (typeof r.title === 'string' && r.title.trim()) out.title = r.title.slice(0, 12)
  return out
}

export function normalizeGame(raw: unknown): StoredGame | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id, 80)
  if (!id) return null
  const startFen = typeof r.startFen === 'string' && checkFen(r.startFen).ok ? r.startFen : START_FEN
  const rawMoves = Array.isArray(r.moves) ? r.moves : []
  // The moves are replayed rather than trusted: a file that has been edited by hand cannot put an illegal game back.
  const written = rawMoves.flatMap((m): { san: string; comment?: string; nag?: string[]; clock?: number }[] => {
    if (!m || typeof m !== 'object') return []
    const move = m as Record<string, unknown>
    const san = str(move.san, 12)
    if (!san) return []
    return [{
      san,
      ...(typeof move.comment === 'string' ? { comment: move.comment.slice(0, 20_000) } : {}),
      ...(Array.isArray(move.nag) ? { nag: move.nag.filter((n): n is string => typeof n === 'string').slice(0, 8) } : {}),
      ...(num(move.clock) !== undefined ? { clock: num(move.clock) as number } : {})
    }]
  })
  const built = buildMoves(startFen, written)
  const meta = (r.meta ?? {}) as Record<string, unknown>
  const normalizedMeta: GameMeta = {
    white: normalizePlayer(meta.white),
    black: normalizePlayer(meta.black),
    result: meta.result === '1-0' || meta.result === '0-1' || meta.result === '1/2-1/2' ? meta.result : '*'
  }
  for (const key of ['event', 'site', 'date', 'round', 'termination', 'timeControl', 'eco', 'opening'] as const) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim()) (normalizedMeta as unknown as Record<string, unknown>)[key] = value.slice(0, 200)
  }
  if (meta.extra && typeof meta.extra === 'object') {
    const extra: Record<string, string> = {}
    for (const [k, v] of Object.entries(meta.extra as Record<string, unknown>)) {
      if (typeof v === 'string') extra[k.slice(0, 40)] = v.slice(0, 400)
    }
    if (Object.keys(extra).length) normalizedMeta.extra = extra
  }
  const source = (r.source && typeof r.source === 'object' ? r.source : { kind: 'import', importedAt: Date.now() }) as GameSource
  return {
    id,
    profileId: str(r.profileId, 80) || DEFAULT_PROFILE_ID,
    source,
    startFen,
    moves: built.moves,
    meta: normalizedMeta,
    variant: str(r.variant, 40) || 'standard',
    createdAt: num(r.createdAt) ?? Date.now(),
    updatedAt: num(r.updatedAt) ?? Date.now(),
    ...(Array.isArray(r.tags) ? { tags: r.tags.filter((t): t is string => typeof t === 'string').slice(0, 40) } : {}),
    ...(r.favourite === true ? { favourite: true } : {}),
    fingerprint: str(r.fingerprint, 40) || fingerprintOf(startFen, built.moves)
  }
}

export interface ImportSummary {
  imported: number
  skippedDuplicates: number
  failed: { index: number; reason: string; white?: string; black?: string }[]
  warnings: string[]
  /** The ids of everything that was actually written, so the caller can open one. */
  ids: string[]
}

export type DuplicatePolicy = 'skip' | 'keep-both'

export class ChessStore {
  private readonly games: Collection<StoredGame>
  private readonly userData: string
  private profileId: string

  constructor(userData: string, profileId: string = DEFAULT_PROFILE_ID) {
    this.userData = userData
    this.profileId = profileId
    this.games = new Collection<StoredGame>(personalFile(userData, profileId, 'chess-games.json'), normalizeGame, 20_000)
  }

  async useProfile(profileId: string): Promise<void> {
    this.profileId = profileId
    await this.games.usePath(personalFile(this.userData, profileId, 'chess-games.json'))
  }

  flush(): Promise<void> { return this.games.flush() }

  async all(): Promise<StoredGame[]> {
    const list = await this.games.all()
    return list.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Promise<StoredGame | null> { return this.games.get(id) }

  async create(o: { source: GameSource; startFen?: string; meta?: Partial<GameMeta>; variant?: string }): Promise<StoredGame> {
    const game = newGame({ id: randomUUID(), profileId: this.profileId, source: o.source, ...(o.startFen ? { startFen: o.startFen } : {}), ...(o.meta ? { meta: o.meta } : {}), now: Date.now(), ...(o.variant ? { variant: o.variant } : {}) })
    return this.games.put(game)
  }

  /** Saves a game's moves and result. The fingerprint follows the moves, so it always names what is really there. */
  async save(game: StoredGame): Promise<StoredGame> {
    const next: StoredGame = { ...game, updatedAt: Date.now(), fingerprint: fingerprintOf(game.startFen, game.moves) }
    return this.games.put(next)
  }

  async update(id: string, patch: { meta?: Partial<GameMeta>; tags?: string[]; favourite?: boolean }): Promise<StoredGame | null> {
    const game = await this.games.get(id)
    if (!game) return null
    return this.save({ ...game, ...patch, meta: { ...game.meta, ...(patch.meta ?? {}) } })
  }

  remove(id: string): Promise<boolean> { return this.games.remove(id) }

  /**
   * Bringing games in from a file.
   *
   * Every game is reported: the ones that came in, the ones already here, and the ones that could not be played, with
   * the move that stopped them. Nothing is dropped in silence (Sections 154, 402, 432).
   */
  async importPgn(text: string, source: { file?: string }, policy: DuplicatePolicy = 'skip'): Promise<ImportSummary> {
    const read = readPgn(text)
    const summary: ImportSummary = { imported: 0, skippedDuplicates: 0, failed: [], warnings: read.warnings.map((w) => w.message), ids: [] }
    const existing = new Set((await this.games.all()).map((g) => g.fingerprint))
    const now = Date.now()
    for (const parsed of read.games) {
      if (!parsed.ok) {
        summary.failed.push({
          index: parsed.index,
          reason: parsed.reason ?? 'This game could not be read.',
          ...(parsed.meta.white.name ? { white: parsed.meta.white.name } : {}),
          ...(parsed.meta.black.name ? { black: parsed.meta.black.name } : {})
        })
        continue
      }
      if (policy === 'skip' && existing.has(parsed.fingerprint)) { summary.skippedDuplicates += 1; continue }
      const game: StoredGame = {
        id: randomUUID(),
        profileId: this.profileId,
        source: { kind: 'import', ...(source.file ? { file: source.file } : {}), importedAt: now },
        startFen: parsed.startFen,
        moves: parsed.moves,
        meta: parsed.meta,
        variant: parsed.variant,
        createdAt: now,
        updatedAt: now,
        fingerprint: parsed.fingerprint
      }
      await this.games.put(game)
      existing.add(parsed.fingerprint)
      summary.imported += 1
      summary.ids.push(game.id)
      for (const warning of parsed.warnings) summary.warnings.push(`Game ${parsed.index + 1}: ${warning.message}`)
    }
    return summary
  }

  /** One game as a file. */
  async exportPgn(id: string): Promise<string | null> {
    const game = await this.games.get(id)
    return game ? writePgn(game) : null
  }

  /** Several games in one file, in the order asked for. */
  async exportMany(ids: string[]): Promise<string> {
    const parts: string[] = []
    for (const id of ids) {
      const game = await this.games.get(id)
      if (game) parts.push(writePgn(game))
    }
    return parts.join('\n')
  }

  /** Searching the person's own games. Everything it matches on is something actually stored. */
  async search(query: string): Promise<StoredGame[]> {
    const text = query.trim().toLowerCase()
    if (!text) return []
    const all = await this.all()
    return all.filter((g) => {
      const fields = [
        g.meta.white.name, g.meta.black.name, g.meta.event, g.meta.site, g.meta.opening, g.meta.eco, g.meta.date,
        ...(g.tags ?? [])
      ]
      return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(text))
    })
  }
}

export type { ParsedGame }
