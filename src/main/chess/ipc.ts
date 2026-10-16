import { dialog, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ChessStore } from './store.ts'
import { checkFen } from '../../shared/chess/rules.ts'
import { writePgn } from '../../shared/chess/pgn.ts'
import type { GameMeta, GameMove, GameSource, StoredGame } from '../../shared/chess/model.ts'

/**
 * The window's way in to Chess World.
 *
 * Only this file knows about Electron, so everything underneath it -- the rules, the games, the engine, the live
 * feeds -- stays plain code that can be tested without a window and could move to the browser later
 * (`src/main/portability.test.ts` is what keeps that true).
 *
 * Every channel takes `unknown` and checks it. A renderer is not trusted to send the right shape.
 */

export interface EngineService {
  status(): Promise<{ state: string; detail: string; name?: string; version?: string; path?: string }>
  install(onStatus: (message: string) => void, signal?: AbortSignal): Promise<void>
  analyse(request: { id: string; fen: string; multipv?: number; movetime?: number; depth?: number; nodes?: number }, onUpdate: (update: unknown) => void): Promise<void>
  stop(id?: string): void
  shutdown(): void
}

export interface ChessIpcOptions {
  store: ChessStore
  /** Absent until the engine service is installed and wired; the screen then says the engine is not there. */
  engine: () => EngineService | null
  getWindow(): BrowserWindow | null
  send(channel: string, ...args: unknown[]): void
  handle: <A extends unknown[]>(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: A) => unknown) => void
}

const str = (v: unknown, n = 200): string => (typeof v === 'string' ? v.slice(0, n) : '')

function asMoves(raw: unknown): GameMove[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((m): GameMove[] => {
    if (!m || typeof m !== 'object') return []
    const move = m as Record<string, unknown>
    if (typeof move.san !== 'string' || typeof move.uci !== 'string' || typeof move.fen !== 'string') return []
    return [{
      san: move.san.slice(0, 12),
      uci: move.uci.slice(0, 6),
      fen: move.fen.slice(0, 120),
      ...(typeof move.comment === 'string' ? { comment: move.comment.slice(0, 20_000) } : {}),
      ...(typeof move.clock === 'number' && Number.isFinite(move.clock) ? { clock: move.clock } : {})
    }]
  })
}

export function registerChessIpc(o: ChessIpcOptions): void {
  const { store, handle } = o

  handle('chess:games', () => store.all())
  handle('chess:game', (_e, id: unknown) => store.get(str(id, 80)))
  handle('chess:search', (_e, query: unknown) => store.search(str(query, 200)))

  handle('chess:create', (_e, input: unknown) => {
    const i = (input ?? {}) as { source?: GameSource; startFen?: string; meta?: Partial<GameMeta>; variant?: string }
    const source: GameSource = i.source && typeof i.source === 'object' && typeof (i.source as { kind?: unknown }).kind === 'string'
      ? i.source
      : { kind: 'custom-position' }
    const startFen = typeof i.startFen === 'string' && checkFen(i.startFen).ok ? i.startFen : undefined
    return store.create({ source, ...(startFen ? { startFen } : {}), ...(i.meta ? { meta: i.meta } : {}), ...(i.variant ? { variant: str(i.variant, 40) } : {}) })
  })

  /** The moves of a game as they now stand. The whole line is sent, so a game cannot end up half saved. */
  handle('chess:save-moves', async (_e, id: unknown, moves: unknown, meta: unknown) => {
    const game = await store.get(str(id, 80))
    if (!game) throw new Error('That game is not here any more.')
    const next: StoredGame = {
      ...game,
      moves: asMoves(moves),
      meta: { ...game.meta, ...((meta ?? {}) as Partial<GameMeta>) }
    }
    return store.save(next)
  })

  handle('chess:update', (_e, id: unknown, patch: unknown) => {
    const p = (patch ?? {}) as { meta?: Partial<GameMeta>; tags?: unknown; favourite?: unknown }
    return store.update(str(id, 80), {
      ...(p.meta ? { meta: p.meta } : {}),
      ...(Array.isArray(p.tags) ? { tags: p.tags.filter((t): t is string => typeof t === 'string').slice(0, 40) } : {}),
      ...(typeof p.favourite === 'boolean' ? { favourite: p.favourite } : {})
    })
  })

  handle('chess:remove', (_e, id: unknown) => store.remove(str(id, 80)))

  /** Brings in a file the person chooses. The answer says exactly what happened to every game in it. */
  handle('chess:import-pgn', async () => {
    const win = o.getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a PGN file',
      properties: ['openFile'],
      filters: [{ name: 'Chess games', extensions: ['pgn'] }, { name: 'All files', extensions: ['*'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return null
    const path = picked.filePaths[0]
    const text = await readFile(path, 'utf8')
    const summary = await store.importPgn(text, { file: basename(path) })
    o.send('chess:games-changed')
    return summary
  })

  /** Reads a file the person has already chosen elsewhere (Files, a drop), by path. */
  handle('chess:import-pgn-text', async (_e, text: unknown, name: unknown) => {
    const body = typeof text === 'string' ? text : ''
    if (!body.trim()) throw new Error('There is nothing to import.')
    const summary = await store.importPgn(body, { file: str(name, 200) || 'pasted text' })
    o.send('chess:games-changed')
    return summary
  })

  handle('chess:export-pgn', async (_e, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string').slice(0, 5000) : []
    if (!list.length) return null
    const text = list.length === 1 ? await store.exportPgn(list[0]) : await store.exportMany(list)
    if (!text) return null
    const first = await store.get(list[0])
    const name = list.length === 1 && first
      ? `${(first.meta.white.name ?? 'White')} vs ${(first.meta.black.name ?? 'Black')}`.replace(/[^\w\s-]/g, '').trim().slice(0, 60)
      : `orbis-chess-${list.length}-games`
    const win = o.getWindow()
    const options: Electron.SaveDialogOptions = { title: 'Save games', defaultPath: `${name || 'game'}.pgn`, filters: [{ name: 'Chess games', extensions: ['pgn'] }] }
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return null
    await writeFile(picked.filePath, text, 'utf8')
    return picked.filePath
  })

  /** One game written out without saving it anywhere: for copying. */
  handle('chess:to-pgn', async (_e, id: unknown) => {
    const game = await store.get(str(id, 80))
    return game ? writePgn(game) : null
  })

  // ---- the engine

  handle('chess:engine-status', async () => {
    const engine = o.engine()
    if (!engine) return { state: 'not-installed', detail: 'The chess engine has not been set up on this computer yet.' }
    return engine.status()
  })

  handle('chess:engine-install', async () => {
    const engine = o.engine()
    if (!engine) throw new Error('The chess engine cannot be set up in this build.')
    void engine.install((message) => o.send('chess:engine-progress', message)).then(
      () => o.send('chess:engine-changed'),
      (err: unknown) => o.send('chess:engine-failed', err instanceof Error ? err.message : 'The engine could not be set up.')
    )
    return true
  })

  /**
   * Asks the engine about a position.
   *
   * Every answer carries the request it belongs to and the position it was about, so an answer that arrives after the
   * board has moved on can be thrown away rather than shown against the wrong position (Sections 048, 327).
   */
  handle('chess:analyse', async (_e, request: unknown) => {
    const engine = o.engine()
    if (!engine) throw new Error('The chess engine is not set up, so there is nothing to ask.')
    const r = (request ?? {}) as Record<string, unknown>
    const fen = str(r.fen, 120)
    const check = checkFen(fen)
    if (!check.ok) throw new Error(check.reason ?? 'That position cannot be analysed.')
    const id = str(r.id, 80) || `an-${Date.now()}`
    const limits = {
      id,
      fen,
      ...(typeof r.multipv === 'number' ? { multipv: Math.max(1, Math.min(5, Math.round(r.multipv))) } : {}),
      ...(typeof r.movetime === 'number' ? { movetime: Math.max(50, Math.min(600_000, Math.round(r.movetime))) } : {}),
      ...(typeof r.depth === 'number' ? { depth: Math.max(1, Math.min(40, Math.round(r.depth))) } : {}),
      ...(typeof r.nodes === 'number' ? { nodes: Math.max(1000, Math.min(1e10, Math.round(r.nodes))) } : {})
    }
    await engine.analyse(limits, (update) => o.send('chess:analysis', update))
    return id
  })

  handle('chess:stop-analysis', (_e, id: unknown) => {
    o.engine()?.stop(str(id, 80) || undefined)
    return true
  })
}

/** Where the engine and its licence live, outside the application's own folder. */
export const chessHome = (userData: string): string => join(userData, 'chess')
