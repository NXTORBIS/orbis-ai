import { mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../../shared/profiles.ts'
import {
  CACHE_SCHEMA,
  DEFAULT_CACHE_LIMITS,
  REJECTION_PLAIN,
  better,
  chooseEvictions,
  emptyCounters,
  fit,
  keyFor,
  servable,
  type AnalysisAsk,
  type CacheCounters,
  type CacheLimits,
  type CacheSize,
  type CachedAnalysis,
  type EvictionCandidate,
  type Rejection
} from '../../shared/chess/analysisCache.ts'

/**
 * Where the engine's answers are kept, on this computer, per profile.
 *
 * ## Why this is a database and not a JSON file
 *
 * Everything else Chess World remembers is a JSON file, because `JsonFile` is small, atomic and easy to reason
 * about -- and because the five files in `data.ts` are each written a handful of times a sitting. This one is not
 * like them. It is written every time a search finishes, which on an analysis board is every two seconds, and it
 * grows to tens of thousands of rows of variations. `JsonFile` holds the whole file in memory and rewrites all of it
 * on every save, so after an hour of analysis each finished search would rewrite megabytes of text -- which is the
 * exact cost `data.ts` splits itself into five files to avoid, except here it would be one file rewritten constantly.
 *
 * So it is SQLite, through Node's own `node:sqlite`, which is already how `src/main/knowledge/` keeps the reading
 * index for the same reason. That buys three things this needs and a JSON file cannot give: one row written per
 * search instead of a whole file, an index on the position so a lookup is a seek rather than a scan of everything
 * stored, and `SUM(bytes)` and `ORDER BY last_used_at` so the size and the eviction order are **counted** rather
 * than worked out by loading the lot.
 *
 * ## It is allowed to be lost, and nothing else here is
 *
 * This is the one store in Orbis holding nothing a person wrote. Every row can be produced again by asking the
 * engine, so losing the file costs time and nothing else. That is what makes two things safe here that would be
 * indefensible anywhere else in Chess World: a file written by an older format is emptied and started again rather
 * than migrated, and a file that is really damaged is moved aside and a new one started.
 *
 * What is *not* allowed, here as everywhere, is pretending. A file that is merely unreadable -- locked by antivirus,
 * being copied by a backup -- is left exactly where it is. The cache then reports a problem and switches itself off
 * for the rest of the session: every lookup is a miss, every search runs, nothing is written over anything. Analysis
 * carries on being correct and slow, which is the right way for a cache to fail.
 *
 * ## What it refuses to evict
 *
 * The position on the board is the one answer that must never be dropped to make room. There is no need to guess
 * which that is: it is the last thing looked up. So the handful of buckets most recently touched are protected, along
 * with anything pinned, and `chooseEvictions` is given both and may not drop either.
 */

/**
 * How many of the questions most recently asked about are kept out of eviction.
 *
 * Eight, because an analysis board shows one position and a few lines off it, and a sweep through a game moves
 * through them in order. It means the cache cannot be pushed below eight answers by its own size limit, which is
 * immaterial against a limit of twenty thousand and is the right way round: a cache that frees room by dropping the
 * position on the screen is worse than no cache.
 */
const RECENT_PROTECTED = 8

type Row = Record<string, unknown>

const num = (v: unknown): number => Number(v ?? 0)

const nullableNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Node's SQLite reports rows touched as a number or a bigint depending on the size. Every caller wants a count. */
const changed = (result: { changes: number | bigint }): number => Number(result.changes)

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS analysis (
    bucket TEXT PRIMARY KEY,
    position TEXT NOT NULL,
    halfmove INTEGER NOT NULL,
    variant TEXT NOT NULL,
    engine_version TEXT,
    engine_build TEXT,
    options TEXT NOT NULL,
    status TEXT NOT NULL,
    depth INTEGER,
    nodes INTEGER,
    elapsed_ms INTEGER,
    lines_count INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL
  );
  /* The lookup index. A position is looked up on its own, not on the whole key, so a lookup that finds nothing
     usable can still say what it did find and why that was not it. */
  CREATE INDEX IF NOT EXISTS analysis_position ON analysis (position);
  CREATE INDEX IF NOT EXISTS analysis_used ON analysis (last_used_at);
  CREATE INDEX IF NOT EXISTS analysis_engine ON analysis (engine_version, engine_build);
`

export type CacheLook =
  | { kind: 'hit'; entry: CachedAnalysis; lookupMs: number }
  | {
      kind: 'miss'
      because: 'nothing-stored' | 'nothing-usable' | 'no-key' | 'unavailable'
      /** Why each answer that was found for this position could not be used. */
      rejected: readonly Rejection[]
      /** Said plainly, for the line a screen shows when it ran a fresh search instead. */
      explain: string
      lookupMs: number
    }

export type CacheKeep =
  | { kind: 'stored'; replaced: boolean; bucket: string }
  | { kind: 'refused'; because: string }

export interface AnalysisCacheOptions {
  now?: () => number
  limits?: Partial<CacheLimits>
  /** How many recently asked questions are kept out of eviction. `RECENT_PROTECTED` when absent. */
  protect?: number
}

export class AnalysisCacheStore {
  private readonly userData: string
  private profileId: string
  private readonly now: () => number
  private readonly limits: CacheLimits
  private readonly protectCount: number
  private db: DatabaseSync | null = null
  /** True once opening has been tried. Null means not tried yet; false means do not try again this session. */
  private usable: boolean | null = null
  private damage: string | null = null
  private counters: CacheCounters = emptyCounters()
  /** The questions most recently asked about. Never evicted: this is what somebody is looking at. */
  private recent: string[] = []

  constructor(userData: string, profileId: string = DEFAULT_PROFILE_ID, o: AnalysisCacheOptions = {}) {
    this.userData = userData
    this.profileId = profileId
    this.now = o.now ?? Date.now
    this.limits = { ...DEFAULT_CACHE_LIMITS, ...(o.limits ?? {}) }
    this.protectCount = Math.max(1, Math.floor(o.protect ?? RECENT_PROTECTED))
  }

  get profile(): string {
    return this.profileId
  }

  /**
   * Where this profile's answers are kept. One file per profile, so two people never share an evaluation.
   *
   * `chess-analysis/`, not `chess/`: that one holds the downloaded engine and its licence and is shared across
   * profiles, and for the default profile the two folders would be the same folder. The path is spelt out here in
   * the same shape every other store in `src/main` uses, so the transfer guard in
   * `src/shared/portable/registry.test.ts` can see it rather than having to be told about it.
   */
  path(profileId: string = this.profileId): string {
    return join(this.userData, dataDirFor(profileId), 'chess-analysis', 'cache.db')
  }

  /** What went wrong, in words somebody can be shown. Null when nothing did. */
  problem(): string | null {
    return this.damage
  }

  /** False when the cache switched itself off because something is wrong with its file. */
  available(): boolean {
    this.open()
    return this.db !== null
  }

  useProfile(profileId: string): void {
    if (profileId === this.profileId) return
    this.close()
    this.profileId = profileId
    this.usable = null
    this.damage = null
    this.recent = []
    // The counters are about this session's cache behaviour, not about one profile's, so they are kept.
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      /* already gone; there is nothing to flush -- every write here is committed when it is made */
    }
    this.db = null
  }

  /**
   * Opens the file, once.
   *
   * The three cases are kept apart deliberately. A file that opens is used. A file that is damaged is moved aside
   * under its own name with the time on it and a new one started -- which is only allowed because every row in it
   * can be produced again by asking the engine. A file that merely cannot be opened is left completely alone and the
   * cache is switched off for the session.
   */
  private open(): DatabaseSync | null {
    if (this.db) return this.db
    if (this.usable === false) return null
    this.usable = false
    const file = this.path()
    try {
      mkdirSync(dirname(file), { recursive: true })
    } catch (err) {
      this.damage = `Orbis could not make the folder the chess analysis cache lives in, so answers are not being kept this session: ${why(err)}.`
      return null
    }
    try {
      this.db = this.start(file)
      this.usable = true
      return this.db
    } catch (err) {
      if (damaged(err)) {
        const moved = this.moveAside(file)
        try {
          this.db = this.start(file)
          this.usable = true
          this.damage = moved
            ? `The chess analysis cache could not be read, so it was moved to ${moved} and a new one started. Nothing a person wrote is kept in it -- every answer in it can be worked out again by asking the engine.`
            : 'The chess analysis cache could not be read and could not be moved aside, so answers are not being kept this session.'
          return this.db
        } catch (second) {
          this.damage = `The chess analysis cache could not be opened even after being moved aside, so answers are not being kept this session: ${why(second)}.`
          return null
        }
      }
      // Something is there that nobody has read. Nothing is written over it, and nothing pretends it is not there.
      this.damage = `Orbis could not open the chess analysis cache, so every position is being searched afresh this session: ${why(err)}. Another program may be holding the file.`
      return null
    }
  }

  private start(file: string): DatabaseSync {
    const db = new DatabaseSync(file)
    try {
      return this.prepare(db)
    } catch (err) {
      /*
       * The handle is closed before the failure is passed on.
       *
       * Opening a file that is not a database succeeds and only the first statement fails, which leaves the handle
       * open and the file locked -- and on Windows the rename that moves the damaged file aside then fails with
       * EBUSY, so the cache stays broken for ever. Closing it here is what makes the recovery possible at all.
       */
      try {
        db.close()
      } catch {
        /* it never really opened; there is nothing to close */
      }
      throw err
    }
  }

  private prepare(db: DatabaseSync): DatabaseSync {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    db.exec(SCHEMA)
    const row = db.prepare(`SELECT value FROM cache_meta WHERE key = 'cache_schema'`).get() as Row | undefined
    const stored = row ? Number.parseInt(String(row.value), 10) : null
    if (stored !== null && Number.isFinite(stored) && stored !== CACHE_SCHEMA) {
      /*
       * A format change empties it rather than migrating it.
       *
       * Everywhere else in Orbis that would be wrong: a file written by a newer version is left alone because
       * reading it anyway means writing a worse copy back. Here there is nothing to write a worse copy of. An
       * answer this format cannot read is an answer the engine can give again in two seconds, so starting over is
       * cheaper and safer than a migration nobody can test against a file that does not exist yet.
       */
      db.exec('DELETE FROM analysis;')
    }
    db.prepare(`INSERT INTO cache_meta (key, value) VALUES ('cache_schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(String(CACHE_SCHEMA))
    return db
  }

  private moveAside(file: string): string | null {
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-')
    const to = `${file}.unreadable-${stamp}`
    try {
      renameSync(file, to)
      return to
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- looking one up

  /**
   * The stored answer to an ask, or a miss that says why.
   *
   * Looked up by position rather than by the whole key, on purpose. A lookup keyed on everything would come back
   * empty when the engine had been upgraded, and "nothing stored" and "there is an answer here but it came from
   * Stockfish 16" are completely different things to a person waiting and to a developer reading the counters. So
   * every answer stored for this position is considered, `servable` judges each one, and when none of them fits the
   * reasons are counted and said.
   */
  look(ask: AnalysisAsk): CacheLook {
    const started = this.now()
    const spent = (): number => Math.max(0, this.now() - started)
    const key = keyFor(ask)
    if (key.kind === 'no-key') {
      // Not counted as a lookup: nothing was looked up. Counting it would make the hit rate a lie.
      return { kind: 'miss', because: 'no-key', rejected: [], explain: key.because, lookupMs: spent() }
    }
    const db = this.open()
    if (!db) {
      return {
        kind: 'miss',
        because: 'unavailable',
        rejected: [],
        explain: this.damage ?? 'The stored answers are not available, so this position is being searched afresh.',
        lookupMs: spent()
      }
    }
    this.counters.lookups += 1
    let rows: Row[]
    try {
      rows = db
        .prepare(
          `SELECT * FROM analysis WHERE position = ?
           ORDER BY (status = 'complete') DESC, depth DESC, lines_count DESC, last_used_at DESC
           LIMIT 16`
        )
        .all(key.key.position) as Row[]
    } catch (err) {
      this.counters.readFailures += 1
      this.counters.misses += 1
      this.counters.lookupMs += spent()
      return {
        kind: 'miss',
        because: 'unavailable',
        rejected: [],
        explain: `The stored answers could not be read, so this position is being searched afresh: ${why(err)}.`,
        lookupMs: spent()
      }
    }
    const rejected: Rejection[] = []
    for (const row of rows) {
      const entry = this.decode(row)
      if (!entry) continue
      const verdict = servable(entry, ask, { now: this.now(), maxAgeMs: this.limits.maxAgeMs })
      if (verdict.usable) {
        const at = this.now()
        try {
          db.prepare('UPDATE analysis SET last_used_at = ?, uses = uses + 1 WHERE bucket = ?').run(at, entry.bucket)
        } catch (err) {
          // The answer is good; only the bookkeeping failed. It is served, and the failure is counted rather than
          // turned into a miss -- throwing away a correct answer over a failed counter would be the wrong trade.
          this.counters.writeFailures += 1
          void err
        }
        this.counters.hits += 1
        this.counters.lookupMs += spent()
        this.touch(entry.bucket)
        return { kind: 'hit', entry: { ...entry, lastUsedAt: at, uses: entry.uses + 1 }, lookupMs: spent() }
      }
      rejected.push({ bucket: entry.bucket, reason: verdict.reason, because: verdict.because })
      this.counters.rejected[verdict.reason] = (this.counters.rejected[verdict.reason] ?? 0) + 1
    }
    this.counters.misses += 1
    this.counters.lookupMs += spent()
    this.touch(key.key.bucket)
    if (!rejected.length) {
      return { kind: 'miss', because: 'nothing-stored', rejected, explain: 'Nothing has been stored for this position yet.', lookupMs: spent() }
    }
    const first = rejected[0]
    return {
      kind: 'miss',
      because: 'nothing-usable',
      rejected,
      explain: `There ${rejected.length === 1 ? 'is an answer' : `are ${rejected.length} answers`} stored for this position and ${rejected.length === 1 ? 'it was' : 'none was'} used: ${first.because}`,
      lookupMs: spent()
    }
  }

  // ---------------------------------------------------------------- keeping one

  /**
   * Keeps an answer, or says why it was not kept.
   *
   * Four refusals, each counted: an answer with no settled score, an answer too big even cut down, an answer worse
   * than the one already stored for the same question, and a write that failed. The third is the one Section 429 is
   * about: a search that was stopped and whose half-finished numbers arrive after a finished search must not land on
   * top of it.
   */
  keep(entry: CachedAnalysis): CacheKeep {
    if (entry.bound !== null || entry.score.kind === 'none') {
      this.counters.refusedUnsettled += 1
      return {
        kind: 'refused',
        because: entry.bound !== null
          ? 'The engine only said that score was above or below a limit, so there is no settled evaluation to keep.'
          : 'That search produced no score, so there is nothing to keep.'
      }
    }
    const db = this.open()
    if (!db) {
      return { kind: 'refused', because: this.damage ?? 'The stored answers are not available, so nothing was kept.' }
    }
    const fitted = fit(entry, this.limits)
    if (fitted.kind === 'too-big') {
      this.counters.refusedTooBig += 1
      return { kind: 'refused', because: fitted.because }
    }
    const next = fitted.entry
    let held: CachedAnalysis | null = null
    let heldPinned = false
    try {
      const row = db.prepare('SELECT * FROM analysis WHERE bucket = ?').get(next.bucket) as Row | undefined
      if (row) {
        held = this.decode(row)
        heldPinned = num(row.pinned) === 1
      }
    } catch (err) {
      this.counters.readFailures += 1
      return { kind: 'refused', because: `What is already stored for this position could not be read, so nothing was written over it: ${why(err)}.` }
    }
    if (held) {
      // Something was already here, so this position has been searched again. Counted, because a cache that is
      // never hit for a position it already holds is a cache whose key is wrong.
      this.counters.reanalysed += 1
      if (!better(next, held)) {
        this.counters.superseded += 1
        return {
          kind: 'refused',
          because: held.status === 'complete' && next.status !== 'complete'
            ? 'A finished answer for this position is already stored, so the stopped search was not written over it.'
            : 'A better answer for this position is already stored, so this one was not written over it.'
        }
      }
    }
    const at = this.now()
    // A pin belongs to the question, not to one answer to it, so a better answer keeps it. `uses` starts again,
    // because nothing has yet been served from this answer and saying otherwise would be inventing a count.
    const stored: CachedAnalysis = { ...next, pinned: heldPinned || next.pinned, lastUsedAt: at, uses: 0 }
    try {
      db.prepare(
        `INSERT INTO analysis
           (bucket, position, halfmove, variant, engine_version, engine_build, options, status, depth, nodes,
            elapsed_ms, lines_count, pinned, bytes, created_at, last_used_at, uses, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bucket) DO UPDATE SET
           halfmove = excluded.halfmove, status = excluded.status, depth = excluded.depth, nodes = excluded.nodes,
           elapsed_ms = excluded.elapsed_ms, lines_count = excluded.lines_count, bytes = excluded.bytes,
           created_at = excluded.created_at, last_used_at = excluded.last_used_at, uses = 0,
           payload = excluded.payload`
      ).run(
        stored.bucket,
        stored.position,
        stored.halfmove,
        stored.variant,
        stored.engineVersion,
        stored.engineBuild,
        stored.options,
        stored.status,
        stored.depth,
        stored.nodes,
        stored.elapsedMs,
        stored.lines.length,
        stored.pinned ? 1 : 0,
        stored.bytes,
        stored.createdAt,
        stored.lastUsedAt,
        0,
        JSON.stringify(stored)
      )
    } catch (err) {
      this.counters.writeFailures += 1
      return { kind: 'refused', because: `That answer could not be stored, so it will be worked out again next time: ${why(err)}.` }
    }
    this.counters.stored += 1
    if (held) this.counters.replaced += 1
    this.touch(stored.bucket)
    this.prune()
    return { kind: 'stored', replaced: held !== null, bucket: stored.bucket }
  }

  /** Keeps one answer out of eviction, or stops. A pin belongs to a question, not to an answer. */
  pin(bucket: string, on = true): boolean {
    const db = this.open()
    if (!db) return false
    try {
      return changed(db.prepare('UPDATE analysis SET pinned = ? WHERE bucket = ?').run(on ? 1 : 0, bucket)) > 0
    } catch {
      this.counters.writeFailures += 1
      return false
    }
  }

  // ---------------------------------------------------------------- staying inside its size

  /**
   * Drops what has to be dropped, and nothing else.
   *
   * Run after a write rather than on a timer, so the file cannot grow past its size between two tidies. What may be
   * dropped is decided by `chooseEvictions`, which is given the questions most recently looked up and may not drop
   * any of them -- the position on the board is the last thing looked up, so it is always in that list.
   */
  prune(): number {
    const db = this.open()
    if (!db) return 0
    /*
     * The cheap question first.
     *
     * This runs after every finished search, so it must not cost anything when there is nothing to do -- and almost
     * always there is nothing to do. Three totals answer it without building a single object; only when one of them
     * is past its limit is the list of what could go actually loaded.
     */
    try {
      const totals = db
        .prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(bytes), 0) AS bytes, MIN(created_at) AS oldest FROM analysis')
        .get() as Row | undefined
      if (totals) {
        const oldest = nullableNum(totals.oldest)
        const within =
          num(totals.entries) <= this.limits.maxEntries &&
          num(totals.bytes) <= this.limits.maxBytes &&
          (oldest === null || this.now() - oldest <= this.limits.maxAgeMs)
        if (within) return 0
      }
    } catch (err) {
      this.counters.readFailures += 1
      void err
      return 0
    }
    let candidates: EvictionCandidate[]
    try {
      const rows = db
        .prepare('SELECT bucket, bytes, last_used_at, created_at, status, pinned FROM analysis')
        .all() as Row[]
      candidates = rows.map((row) => ({
        bucket: String(row.bucket),
        bytes: num(row.bytes),
        lastUsedAt: num(row.last_used_at),
        createdAt: num(row.created_at),
        status: String(row.status) as CachedAnalysis['status'],
        pinned: num(row.pinned) === 1
      }))
    } catch (err) {
      this.counters.readFailures += 1
      void err
      return 0
    }
    const dropping = chooseEvictions(candidates, this.limits, { now: this.now(), keep: new Set(this.recent) })
    if (!dropping.length) return 0
    try {
      const statement = db.prepare('DELETE FROM analysis WHERE bucket = ? AND pinned = 0')
      let gone = 0
      for (const one of dropping) gone += changed(statement.run(one.bucket))
      this.counters.evicted += gone
      return gone
    } catch (err) {
      this.counters.writeFailures += 1
      void err
      return 0
    }
  }

  /**
   * Drops the answers that came from an engine this is no longer running, a few at a time.
   *
   * This is the bounded cleanup Section 424 asks for instead of a global wipe. The answers are already segregated by
   * engine in the key, so none of them can be served by mistake -- they are only taking up room, and there is no
   * reason to spend a long pause on them at the moment somebody upgrades.
   */
  forgetOtherEngines(version: string | null, build: string | null, batch = 500): number {
    const db = this.open()
    if (!db) return 0
    if (!version && !build) return 0
    try {
      const gone = changed(
        db
          .prepare(
            `DELETE FROM analysis WHERE pinned = 0 AND bucket IN (
               SELECT bucket FROM analysis
               WHERE pinned = 0
                 AND (COALESCE(engine_version, '') <> ? OR COALESCE(engine_build, '') <> ?)
               LIMIT ?
             )`
          )
          .run(version ?? '', build ?? '', batch)
      )
      this.counters.evicted += gone
      return gone
    } catch (err) {
      this.counters.writeFailures += 1
      void err
      return 0
    }
  }

  /** Forgets everything. Safe here and nowhere else in Chess World: every row can be worked out again. */
  clear(): number {
    const db = this.open()
    if (!db) return 0
    try {
      const gone = changed(db.prepare('DELETE FROM analysis').run())
      this.recent = []
      return gone
    } catch {
      this.counters.writeFailures += 1
      return 0
    }
  }

  // ---------------------------------------------------------------- what it is doing

  size(): CacheSize {
    const db = this.open()
    const empty: CacheSize = { entries: 0, bytes: 0, oldestAt: null, newestAt: null, unfinished: 0, pinned: 0 }
    if (!db) return empty
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS entries, COALESCE(SUM(bytes), 0) AS bytes, MIN(created_at) AS oldest,
                  MAX(created_at) AS newest,
                  SUM(CASE WHEN status != 'complete' THEN 1 ELSE 0 END) AS unfinished,
                  SUM(pinned) AS pinned
           FROM analysis`
        )
        .get() as Row | undefined
      if (!row) return empty
      return {
        entries: num(row.entries),
        bytes: num(row.bytes),
        oldestAt: nullableNum(row.oldest),
        newestAt: nullableNum(row.newest),
        unfinished: num(row.unfinished),
        pinned: num(row.pinned)
      }
    } catch {
      this.counters.readFailures += 1
      return empty
    }
  }

  /** The counters as they stand. A copy, so nothing outside can change what was counted. */
  stats(): CacheCounters {
    return { ...this.counters, rejected: { ...this.counters.rejected } }
  }

  /** The refusal reasons in the words a developer reading them would use, paired with the counts. */
  rejections(): { reason: string; plain: string; count: number }[] {
    return Object.entries(this.counters.rejected)
      .map(([reason, count]) => ({ reason, plain: REJECTION_PLAIN[reason] ?? reason, count }))
      .sort((a, b) => b.count - a.count)
  }

  /** Starts the counting again. For a developer measuring one thing, never on its own. */
  resetCounters(): void {
    this.counters = emptyCounters()
  }

  /** What is protected from eviction right now, so a diagnostics panel can show that it really is. */
  protected(): readonly string[] {
    return [...this.recent]
  }

  // ---------------------------------------------------------------- the small private parts

  private touch(bucket: string): void {
    this.recent = [bucket, ...this.recent.filter((b) => b !== bucket)].slice(0, this.protectCount)
  }

  /**
   * One row back into an answer.
   *
   * Null when the stored text cannot be made sense of. That row is left exactly where it is -- it is one answer out
   * of thousands, the lookup carries on to the next, and the failure is counted so a file quietly filling up with
   * unreadable rows is visible instead of silent.
   */
  private decode(row: Row): CachedAnalysis | null {
    try {
      const parsed: unknown = JSON.parse(String(row.payload))
      if (!parsed || typeof parsed !== 'object') return null
      const entry = parsed as CachedAnalysis
      if (typeof entry.bucket !== 'string' || typeof entry.position !== 'string' || !entry.score) return null
      return {
        ...entry,
        lines: Array.isArray(entry.lines) ? entry.lines : [],
        pvUci: Array.isArray(entry.pvUci) ? entry.pvUci : [],
        pinned: num(row.pinned) === 1,
        uses: num(row.uses),
        lastUsedAt: num(row.last_used_at),
        bytes: num(row.bytes)
      }
    } catch {
      this.counters.readFailures += 1
      return null
    }
  }
}

const why = (err: unknown): string => (err instanceof Error ? err.message : 'it could not be read')

/** Whether the file itself is the problem, rather than something holding it. Only then is it moved aside. */
function damaged(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    message.includes('not a database') ||
    message.includes('malformed') ||
    message.includes('corrupt') ||
    message.includes('disk image')
  )
}

/**
 * Where this profile's kept answers live, relative to the profile's folder.
 *
 * Deliberately not in any transfer category, and this is where to say why. It is the engine's own answers, worked
 * out rather than written by anybody, and every row of it is keyed to the exact engine binary on this computer --
 * so a profile carried to another machine would be carrying megabytes that its own engine would refuse on the first
 * lookup. Working them out again is both cheaper and more honest than shipping them.
 */
export const CHESS_ANALYSIS_CACHE_FILE = 'chess-analysis/cache.db'
