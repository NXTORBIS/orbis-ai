/**
 * The Orbis offline game library: what games exist, how a page failure is judged (only real network failures offer the
 * games; an HTTP error page is the website's own answer), and the local data kept for them (high scores, favorites,
 * recently played, preferences, saved games). Pure: no browser, no storage.
 */

export type GameId =
  | 'runner'
  | 'space-dodger'
  | 'orb-collector'
  | 'block-breaker'
  | 'snake'
  | 'arcade-shooter'
  | 'flappy'
  | 'memory-match'
  | 'minesweeper'
  | 'number-puzzle'
  | 'reaction-test'
  | 'typing-challenge'

export type GameCategory = 'arcade' | 'puzzle' | 'reaction' | 'strategy' | 'classic' | 'casual' | 'typing'

export interface GameInfo {
  id: GameId
  name: string
  description: string
  icon: string
  categories: GameCategory[]
  controls: string
  /** How scores compare: more points, or a lower time (reaction), or words per minute. */
  score: 'points' | 'lower-ms' | 'wpm'
  /** A game in progress can be saved and continued later. */
  continuable: boolean
}

export const GAMES: GameInfo[] = [
  { id: 'runner', name: 'Orbit Runner', description: 'Leap over crystals and duck past drones as the track speeds up.', icon: '🌠', categories: ['arcade', 'casual'], controls: 'Space / ↑ / W or tap to jump (hold to jump higher)', score: 'points', continuable: false },
  { id: 'space-dodger', name: 'Space Dodger', description: 'Steer through asteroid fields, comets and mines; collect energy for shields.', icon: '🚀', categories: ['arcade'], controls: '← → / A D or move the mouse', score: 'points', continuable: false },
  { id: 'orb-collector', name: 'Orb Collector', description: 'Guide the Orbis orb to energy and multipliers while avoiding hazards.', icon: '🔮', categories: ['arcade', 'casual'], controls: 'Arrows / WASD or move the mouse', score: 'points', continuable: false },
  { id: 'block-breaker', name: 'Block Breaker', description: 'Break every block across levels, with multi-ball, fireballs and more.', icon: '🧱', categories: ['arcade', 'classic'], controls: '← → / A D or the mouse; Space or click to launch', score: 'points', continuable: false },
  { id: 'snake', name: 'Snake', description: 'Grow longer with every bite; chain bites for combos. Mind the walls.', icon: '🐍', categories: ['classic', 'arcade'], controls: 'Arrows / WASD', score: 'points', continuable: false },
  { id: 'arcade-shooter', name: 'Star Sentinel', description: 'Hold the line against enemy waves, power up, and face the boss wave.', icon: '👾', categories: ['arcade', 'classic'], controls: '← → / A D to move, Space to fire', score: 'points', continuable: false },
  { id: 'flappy', name: 'Glide', description: 'One button to rise through the gaps. Gravity does the rest.', icon: '🪽', categories: ['casual', 'arcade'], controls: 'Space / ↑ / click or tap to rise', score: 'points', continuable: false },
  { id: 'memory-match', name: 'Memory Match', description: 'Flip cards and find every pair in as few moves as you can.', icon: '🃏', categories: ['puzzle', 'casual'], controls: 'Click or arrow keys + Enter', score: 'points', continuable: true },
  { id: 'minesweeper', name: 'Minesweeper', description: 'Clear the field without touching a mine. Flag what you suspect.', icon: '💣', categories: ['puzzle', 'strategy', 'classic'], controls: 'Click to reveal, right-click or F to flag', score: 'points', continuable: true },
  { id: 'number-puzzle', name: 'Fusion 2048', description: 'Slide the tiles; matching numbers fuse. Reach 2048 and beyond.', icon: '🔢', categories: ['puzzle', 'strategy'], controls: 'Arrows / WASD or swipe; U to undo', score: 'points', continuable: true },
  { id: 'reaction-test', name: 'Reaction Test', description: 'Wait for GO, then react as fast as you can. No early starts.', icon: '⚡', categories: ['reaction'], controls: 'Click, tap or Space when it says GO', score: 'lower-ms', continuable: false },
  { id: 'typing-challenge', name: 'Typing Challenge', description: 'Type the passage quickly and accurately. Keep your streak alive.', icon: '⌨️', categories: ['typing'], controls: 'Type the text shown', score: 'wpm', continuable: false }
]

export const gameInfo = (id: GameId): GameInfo => GAMES.find((g) => g.id === id)!

export function searchGames(query: string, category?: GameCategory | 'all' | 'favorites', favorites: GameId[] = []): GameInfo[] {
  const q = query.trim().toLowerCase()
  return GAMES.filter((g) => {
    if (category === 'favorites' && !favorites.includes(g.id)) return false
    if (category && category !== 'all' && category !== 'favorites' && !g.categories.includes(category)) return false
    return !q || `${g.name} ${g.description} ${g.categories.join(' ')}`.toLowerCase().includes(q)
  })
}

// ---------------------------------------------------------------- page failures

export type LoadFailureKind = 'no-internet' | 'dns' | 'refused' | 'timeout' | 'unreachable' | 'other'

/**
 * Whether a failed load is a network problem (no connection, DNS, refused, timed out, unreachable), from Chromium's net
 * error code. Other failures (certificates, blocked pages, aborted loads) are not "offline", and HTTP errors such as 404
 * or 500 never reach here: the site answered.
 */
export function classifyLoadFailure(code: number): { offline: boolean; kind: LoadFailureKind; reason: string } {
  switch (code) {
    case -106:
    case -21:
      return { offline: true, kind: 'no-internet', reason: 'No internet connection' }
    case -105:
    case -137:
      return { offline: true, kind: 'dns', reason: "The site's address couldn't be found (DNS)" }
    case -102:
      return { offline: true, kind: 'refused', reason: 'The server refused the connection' }
    case -118:
    case -7:
      return { offline: true, kind: 'timeout', reason: 'The connection timed out' }
    case -109:
    case -104:
    case -101:
    case -100:
    case -130:
    case -15:
      return { offline: true, kind: 'unreachable', reason: "The server couldn't be reached" }
    default:
      return { offline: false, kind: 'other', reason: 'The page failed to load' }
  }
}

// ---------------------------------------------------------------- stored data

export interface ScoreRecord {
  best: number
  bestAt: number
  lastScore: number
  lastPlayedAt: number
  plays: number
  /** Game-specific records: best time or WPM, accuracy, average reaction, difficulty. */
  extra?: { bestAccuracy?: number; averageMs?: number; attempts?: number; difficulty?: string; bestStreak?: number }
}

export interface OfflineGamesPrefs {
  /** What a network failure shows: the error page (with the games one click away), a game straight away, or a question. */
  behavior: 'error-page' | 'auto-launch' | 'ask'
  /** Which game auto-launch opens. */
  launchGame: 'default' | 'random' | 'last' | 'daily'
  defaultGame: GameId
  sound: boolean
  music: boolean
  reducedMotion: 'system' | 'on' | 'off'
  highContrast: boolean
  showScore: boolean
  showHighScore: boolean
  /** Reload the page by itself when the connection comes back. */
  autoRetry: boolean
  difficulty: 'easy' | 'normal' | 'hard'
}

export interface OfflineGamesData {
  schemaVersion: 1
  prefs: OfflineGamesPrefs
  scores: Partial<Record<GameId, ScoreRecord>>
  favorites: GameId[]
  recent: { gameId: GameId; playedAt: number; score: number }[]
  /** Games in progress (only the continuable ones). */
  saved: Partial<Record<GameId, { state: unknown; savedAt: number }>>
}

export const DEFAULT_PREFS: OfflineGamesPrefs = {
  behavior: 'error-page',
  launchGame: 'daily',
  defaultGame: 'runner',
  sound: true,
  music: false,
  reducedMotion: 'system',
  highContrast: false,
  showScore: true,
  showHighScore: true,
  autoRetry: false,
  difficulty: 'normal'
}

const IDS = new Set<string>(GAMES.map((g) => g.id))
const isId = (v: unknown): v is GameId => typeof v === 'string' && IDS.has(v)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)

/** Reads stored data, dropping anything malformed and filling defaults, so broken data never breaks the games. */
export function normalizeData(raw: unknown): OfflineGamesData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<OfflineGamesData> & { prefs?: Partial<OfflineGamesPrefs> }
  const p = (r.prefs && typeof r.prefs === 'object' ? r.prefs : {}) as Partial<OfflineGamesPrefs>
  const scores: OfflineGamesData['scores'] = {}
  for (const [id, s] of Object.entries(r.scores && typeof r.scores === 'object' ? r.scores : {})) {
    if (!isId(id) || !s || typeof s !== 'object') continue
    const record = s as Partial<ScoreRecord>
    scores[id] = { best: num(record.best), bestAt: num(record.bestAt), lastScore: num(record.lastScore), lastPlayedAt: num(record.lastPlayedAt), plays: Math.max(0, Math.round(num(record.plays))), ...(record.extra && typeof record.extra === 'object' ? { extra: record.extra } : {}) }
  }
  const saved: OfflineGamesData['saved'] = {}
  for (const [id, s] of Object.entries(r.saved && typeof r.saved === 'object' ? r.saved : {})) {
    if (isId(id) && gameInfo(id).continuable && s && typeof s === 'object' && 'state' in s) saved[id] = { state: (s as { state: unknown }).state, savedAt: num((s as { savedAt?: number }).savedAt) }
  }
  return {
    schemaVersion: 1,
    prefs: {
      behavior: pick(p.behavior, ['error-page', 'auto-launch', 'ask'] as const, DEFAULT_PREFS.behavior),
      launchGame: pick(p.launchGame, ['default', 'random', 'last', 'daily'] as const, DEFAULT_PREFS.launchGame),
      defaultGame: isId(p.defaultGame) ? p.defaultGame : DEFAULT_PREFS.defaultGame,
      sound: typeof p.sound === 'boolean' ? p.sound : DEFAULT_PREFS.sound,
      music: typeof p.music === 'boolean' ? p.music : DEFAULT_PREFS.music,
      reducedMotion: pick(p.reducedMotion, ['system', 'on', 'off'] as const, DEFAULT_PREFS.reducedMotion),
      highContrast: p.highContrast === true,
      showScore: p.showScore !== false,
      showHighScore: p.showHighScore !== false,
      autoRetry: p.autoRetry === true,
      difficulty: pick(p.difficulty, ['easy', 'normal', 'hard'] as const, DEFAULT_PREFS.difficulty)
    },
    scores,
    favorites: [...new Set(Array.isArray(r.favorites) ? r.favorites.filter(isId) : [])],
    recent: (Array.isArray(r.recent) ? r.recent : []).filter((x) => x && isId(x.gameId)).map((x) => ({ gameId: x.gameId, playedAt: num(x.playedAt), score: num(x.score) })).slice(0, 12),
    saved
  }
}

/** Whether a new score beats the record (lower is better for reaction times). */
export function beats(gameId: GameId, score: number, best: number | undefined): boolean {
  if (best === undefined) return true
  return gameInfo(gameId).score === 'lower-ms' ? score > 0 && score < best : score > best
}

/** Records a finished game: plays, last score, recent list, and a new best when it is one. */
export function recordScore(data: OfflineGamesData, gameId: GameId, score: number, extra: ScoreRecord['extra'] | undefined, now = Date.now()): { data: OfflineGamesData; newBest: boolean } {
  const current = data.scores[gameId]
  const newBest = beats(gameId, score, current?.best)
  const record: ScoreRecord = {
    best: newBest ? score : current!.best,
    bestAt: newBest ? now : current!.bestAt,
    lastScore: score,
    lastPlayedAt: now,
    plays: (current?.plays ?? 0) + 1,
    ...(extra || current?.extra ? { extra: { ...current?.extra, ...extra } } : {})
  }
  return {
    newBest,
    data: { ...data, scores: { ...data.scores, [gameId]: record }, recent: [{ gameId, playedAt: now, score }, ...data.recent.filter((r) => r.gameId !== gameId)].slice(0, 12) }
  }
}

/** Today's game: the same for the whole day, different from yesterday's where possible, computed locally. */
export function gameOfTheDay(date: Date, available: GameId[] = GAMES.map((g) => g.id)): GameId {
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
  return available[(hash >>> 0) % available.length]
}

export function randomGame(available: GameId[] = GAMES.map((g) => g.id), exclude?: GameId, random = Math.random): GameId {
  const choices = available.length > 1 && exclude ? available.filter((id) => id !== exclude) : available
  return choices[Math.floor(random() * choices.length) % choices.length]
}

/** Which game auto-launch opens, from the preference. */
export function launchChoice(data: OfflineGamesData, now: Date, random = Math.random): GameId {
  switch (data.prefs.launchGame) {
    case 'default':
      return data.prefs.defaultGame
    case 'random':
      return randomGame(undefined, data.recent[0]?.gameId, random)
    case 'last':
      return data.recent[0]?.gameId ?? data.prefs.defaultGame
    case 'daily':
      return gameOfTheDay(now)
  }
}
