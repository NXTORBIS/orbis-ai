import { promises as fs, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDirFor } from '../../shared/profiles.ts'
import { grantIsLive, type PermissionGrant, type Scope } from '../../shared/pages/capabilities.ts'
import { isPageId } from '../../shared/pages/identity.ts'

/**
 * What a profile has decided and saved about Pages.
 *
 * Grants, favourites, how often a Page has been opened, and each Page's own saved work. Per profile, in the profile's own
 * folder, like everything else per-profile in Orbis -- so one profile's permissions are never another's and switching
 * profile swaps the whole file rather than merging anything.
 *
 * The register itself is not here. Which Pages exist is rebuilt at start from the build plus whatever the profile has
 * installed; what a profile has *decided* is what needs keeping. Separating the two means a corrupt decisions file cannot
 * make a Page vanish, and a Page being removed from the build cannot silently take a grant with it.
 *
 * Writes are batched and atomic: a favourite toggled a dozen times in a second is one write, and a write interrupted
 * half-way leaves the old file rather than half of the new one.
 */

const FILE = 'pages.json'
const FLUSH_MS = 400
const SCHEMA = 1

/** Caps, so a Page cannot fill the disk through its own project store. */
export const STORE_LIMITS = Object.freeze({
  projectBytes: 2_000_000,
  projectsPerPage: 50,
  grants: 500,
  favourites: 500
})

export interface PageProject {
  projectId: string
  pageId: string
  name: string
  createdAt: number
  updatedAt: number
  /** Whatever the Page put here. Opaque to Orbis, validated only for size and shape. */
  state: Record<string, unknown>
}

interface Saved {
  schema: number
  grants: PermissionGrant[]
  favourites: string[]
  /** How often and when each Page was opened, keyed by page id. Local; never sent anywhere. */
  usage: Record<string, { openCount: number; lastOpenedAt: number }>
  projects: PageProject[]
  /** Page ids whose most recent update has been looked at and accepted. */
  approved: Record<string, string>
}

const EMPTY: Saved = { schema: SCHEMA, grants: [], favourites: [], usage: {}, projects: [], approved: {} }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A scope read back from a file. Anything unrecognised becomes no scope, which grants nothing. */
function cleanScope(raw: unknown): Scope {
  if (!isObject(raw)) return { kind: 'none' }
  switch (raw.kind) {
    case 'origin':
      if (typeof raw.scheme !== 'string' || typeof raw.host !== 'string') return { kind: 'none' }
      return {
        kind: 'origin',
        scheme: raw.scheme === 'http' ? 'http' : 'https',
        host: raw.host.slice(0, 255).toLowerCase(),
        port: typeof raw.port === 'number' && Number.isInteger(raw.port) ? raw.port : null,
        subdomains: raw.subdomains === true
      }
    case 'path':
      if (typeof raw.path !== 'string' || raw.path === '') return { kind: 'none' }
      // A relative part means the path was never resolved. Refused to no scope rather than stored, because an
      // unresolved path cannot be matched safely.
      if (raw.path.split(/[\\/]/).some((part) => part === '.' || part === '..')) return { kind: 'none' }
      return { kind: 'path', path: raw.path.slice(0, 1024), recursive: raw.recursive === true }
    case 'page':
      return typeof raw.pageId === 'string' && isPageId(raw.pageId) ? { kind: 'page', pageId: raw.pageId } : { kind: 'none' }
    default:
      return { kind: 'none' }
  }
}

/** A grant read back from a file. Null when anything about it is wrong, because a wrong grant cannot be trusted to be narrow. */
function cleanGrant(raw: unknown): PermissionGrant | null {
  if (!isObject(raw)) return null
  if (!isPageId(raw.pageId as string)) return null
  if (typeof raw.capabilityId !== 'string' || raw.capabilityId.length > 80) return null
  if (typeof raw.grantedAt !== 'number' || !Number.isFinite(raw.grantedAt) || raw.grantedAt <= 0) return null
  if (typeof raw.pageVersion !== 'string' || raw.pageVersion.length > 24) return null
  const state = raw.state === 'revoked' ? 'revoked' : raw.state === 'expired' ? 'expired' : 'active'
  const expiresAt =
    raw.expiresAt === null || raw.expiresAt === undefined
      ? null
      : typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)
        ? raw.expiresAt
        : null
  return {
    pageId: raw.pageId as string,
    capabilityId: raw.capabilityId,
    scope: cleanScope(raw.scope),
    grantedAt: raw.grantedAt,
    expiresAt,
    source: raw.source === 'system' ? 'system' : 'user',
    pageVersion: raw.pageVersion,
    state
  }
}

function cleanProject(raw: unknown): PageProject | null {
  if (!isObject(raw)) return null
  if (typeof raw.projectId !== 'string' || raw.projectId === '' || raw.projectId.length > 80) return null
  if (!isPageId(raw.pageId as string)) return null
  if (!isObject(raw.state)) return null
  return {
    projectId: raw.projectId,
    pageId: raw.pageId as string,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : 'Untitled',
    createdAt: typeof raw.createdAt === 'number' && raw.createdAt > 0 ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt > 0 ? raw.updatedAt : 0,
    state: raw.state
  }
}

/** A saved file read back. Everything unrecognised is dropped rather than repaired. */
export function cleanSaved(raw: unknown): Saved {
  if (!isObject(raw)) return { ...EMPTY }
  const grants = (Array.isArray(raw.grants) ? raw.grants : [])
    .map(cleanGrant)
    .filter((one): one is PermissionGrant => one !== null)
    .slice(0, STORE_LIMITS.grants)
  const favourites = (Array.isArray(raw.favourites) ? raw.favourites : [])
    .filter((one): one is string => typeof one === 'string' && isPageId(one))
    .slice(0, STORE_LIMITS.favourites)
  const usage: Saved['usage'] = {}
  if (isObject(raw.usage)) {
    for (const [pageId, value] of Object.entries(raw.usage)) {
      if (!isPageId(pageId) || !isObject(value)) continue
      usage[pageId] = {
        openCount: typeof value.openCount === 'number' && value.openCount >= 0 ? Math.min(1e9, Math.round(value.openCount)) : 0,
        lastOpenedAt: typeof value.lastOpenedAt === 'number' && value.lastOpenedAt > 0 ? value.lastOpenedAt : 0
      }
    }
  }
  const projects = (Array.isArray(raw.projects) ? raw.projects : [])
    .map(cleanProject)
    .filter((one): one is PageProject => one !== null)
  const approved: Record<string, string> = {}
  if (isObject(raw.approved)) {
    for (const [pageId, version] of Object.entries(raw.approved)) {
      if (isPageId(pageId) && typeof version === 'string' && version.length <= 24) approved[pageId] = version
    }
  }
  return { schema: SCHEMA, grants, favourites, usage, projects, approved }
}

export class PagesStore {
  private readonly root: string
  private readonly cache = new Map<string, Saved>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly dirty = new Set<string>()

  constructor(userDataPath: string) {
    this.root = userDataPath
  }

  private fileFor(profileId: string): string {
    return join(this.root, dataDirFor(profileId), FILE)
  }

  /** Everything this profile has decided. Read once and kept, because every question below asks it. */
  async read(profileId: string): Promise<Saved> {
    const held = this.cache.get(profileId)
    if (held) return held
    let saved: Saved
    try {
      saved = cleanSaved(JSON.parse(await fs.readFile(this.fileFor(profileId), 'utf8')))
    } catch {
      // No file, or one that cannot be read. Starting from defaults is right: nothing here is data that was earned, and
      // a profile with no decisions yet behaves exactly like a corrupt one should.
      saved = { ...EMPTY }
    }
    this.cache.set(profileId, saved)
    return saved
  }

  private touch(profileId: string): void {
    this.dirty.add(profileId)
    const existing = this.timers.get(profileId)
    if (existing) clearTimeout(existing)
    this.timers.set(
      profileId,
      setTimeout(() => {
        void this.flushOne(profileId)
      }, FLUSH_MS)
    )
  }

  private async flushOne(profileId: string): Promise<void> {
    const timer = this.timers.get(profileId)
    if (timer) clearTimeout(timer)
    this.timers.delete(profileId)
    if (!this.dirty.delete(profileId)) return
    const saved = this.cache.get(profileId)
    if (!saved) return
    const file = this.fileFor(profileId)
    await fs.mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    // Write beside, then move: an interrupted write leaves the old file rather than half of the new one.
    await fs.writeFile(temporary, JSON.stringify(saved), 'utf8')
    await fs.rename(temporary, file)
  }

  /** Everything pending, written now. Called on quit, where there is no time for a timer. */
  async flush(): Promise<void> {
    await Promise.all([...this.dirty].map((profileId) => this.flushOne(profileId)))
  }

  /** The synchronous version, for the very end of the process where promises will not be waited on. */
  flushSync(): void {
    for (const profileId of [...this.dirty]) {
      const saved = this.cache.get(profileId)
      if (!saved) continue
      try {
        const file = this.fileFor(profileId)
        mkdirSync(dirname(file), { recursive: true })
        const temporary = `${file}.tmp`
        writeFileSync(temporary, JSON.stringify(saved), 'utf8')
        renameSync(temporary, file)
      } catch {
        // Nothing useful to do at this point in the process, and throwing would stop the rest from being written.
      }
      this.dirty.delete(profileId)
    }
  }

  // ---------------------------------------------------------------- grants

  async grants(profileId: string): Promise<PermissionGrant[]> {
    return (await this.read(profileId)).grants
  }

  /**
   * A grant recorded.
   *
   * Replaces any earlier grant for the same Page, capability and scope, rather than stacking: two grants for one thing
   * means a revocation has to find both, and the one it misses is the one that matters.
   */
  async grant(profileId: string, grant: PermissionGrant): Promise<PermissionGrant[]> {
    const saved = await this.read(profileId)
    const cleaned = cleanGrant(grant)
    if (!cleaned) return saved.grants
    const same = (one: PermissionGrant): boolean =>
      one.pageId === cleaned.pageId &&
      one.capabilityId === cleaned.capabilityId &&
      JSON.stringify(one.scope) === JSON.stringify(cleaned.scope)
    saved.grants = [...saved.grants.filter((one) => !same(one)), cleaned].slice(-STORE_LIMITS.grants)
    this.touch(profileId)
    return saved.grants
  }

  /** Every grant for a Page and capability marked withdrawn. Marked rather than deleted, so the decision is visible. */
  async revoke(profileId: string, pageId: string, capabilityId?: string): Promise<PermissionGrant[]> {
    const saved = await this.read(profileId)
    saved.grants = saved.grants.map((one) =>
      one.pageId === pageId && (capabilityId === undefined || one.capabilityId === capabilityId)
        ? { ...one, state: 'revoked' as const }
        : one
    )
    this.touch(profileId)
    return saved.grants
  }

  /** Grants that have lapsed, tidied away. Never changes what is allowed -- an expired grant already allowed nothing. */
  async pruneGrants(profileId: string, now: number): Promise<void> {
    const saved = await this.read(profileId)
    const before = saved.grants.length
    saved.grants = saved.grants.filter((one) => one.state === 'active' && grantIsLive(one, now))
    if (saved.grants.length !== before) this.touch(profileId)
  }

  // ---------------------------------------------------------------- favourites and usage

  async favourites(profileId: string): Promise<string[]> {
    return (await this.read(profileId)).favourites
  }

  async setFavourite(profileId: string, pageId: string, favourite: boolean): Promise<boolean> {
    const saved = await this.read(profileId)
    if (!isPageId(pageId)) return false
    const has = saved.favourites.includes(pageId)
    if (favourite && !has) saved.favourites = [...saved.favourites, pageId].slice(-STORE_LIMITS.favourites)
    else if (!favourite && has) saved.favourites = saved.favourites.filter((one) => one !== pageId)
    else return has
    this.touch(profileId)
    return favourite
  }

  async usage(profileId: string): Promise<Saved['usage']> {
    return (await this.read(profileId)).usage
  }

  async recordOpen(profileId: string, pageId: string, now: number): Promise<void> {
    if (!isPageId(pageId)) return
    const saved = await this.read(profileId)
    const held = saved.usage[pageId] ?? { openCount: 0, lastOpenedAt: 0 }
    saved.usage[pageId] = { openCount: Math.min(1e9, held.openCount + 1), lastOpenedAt: now }
    this.touch(profileId)
  }

  // ---------------------------------------------------------------- accepted updates

  async approved(profileId: string): Promise<Record<string, string>> {
    return (await this.read(profileId)).approved
  }

  async approve(profileId: string, pageId: string, version: string): Promise<void> {
    if (!isPageId(pageId)) return
    const saved = await this.read(profileId)
    saved.approved[pageId] = version.slice(0, 24)
    this.touch(profileId)
  }

  // ---------------------------------------------------------------- each Page's own work

  async projects(profileId: string, pageId?: string): Promise<PageProject[]> {
    const all = (await this.read(profileId)).projects
    return pageId === undefined ? all : all.filter((one) => one.pageId === pageId)
  }

  async project(profileId: string, projectId: string): Promise<PageProject | null> {
    return (await this.read(profileId)).projects.find((one) => one.projectId === projectId) ?? null
  }

  /**
   * A Page's saved work, written.
   *
   * The size is checked before it is stored, not after: a Page that has already filled memory with its state has already
   * done the damage. Over the limit is an error the Page is told about rather than a silent truncation, because silently
   * keeping half of somebody's work is the worst of the available outcomes.
   */
  async saveProject(
    profileId: string,
    project: Omit<PageProject, 'createdAt' | 'updatedAt'>,
    now: number
  ): Promise<{ project: PageProject } | { error: string; message: string }> {
    const cleaned = cleanProject({ ...project, createdAt: now, updatedAt: now })
    if (!cleaned) return { error: 'invalid', message: 'That is not something a Page can save.' }

    let size: number
    try {
      size = JSON.stringify(cleaned.state).length
    } catch {
      // Circular, or something that will not serialise. Refused, because it would fail at write time instead.
      return { error: 'invalid', message: 'That project contains something Orbis cannot save.' }
    }
    if (size > STORE_LIMITS.projectBytes) {
      return {
        error: 'too-large',
        message: `That project is ${Math.round(size / 1000)} kB, and a Page may save at most ${Math.round(STORE_LIMITS.projectBytes / 1000)} kB.`
      }
    }

    const saved = await this.read(profileId)
    const existing = saved.projects.find((one) => one.projectId === cleaned.projectId)
    if (existing) {
      const updated: PageProject = { ...existing, name: cleaned.name, state: cleaned.state, updatedAt: now }
      saved.projects = saved.projects.map((one) => (one.projectId === cleaned.projectId ? updated : one))
      this.touch(profileId)
      return { project: updated }
    }

    const mine = saved.projects.filter((one) => one.pageId === cleaned.pageId)
    if (mine.length >= STORE_LIMITS.projectsPerPage) {
      return {
        error: 'too-many',
        message: `This Page already has ${mine.length} saved projects, which is the most it may keep.`
      }
    }
    saved.projects = [...saved.projects, cleaned]
    this.touch(profileId)
    return { project: cleaned }
  }

  async deleteProject(profileId: string, projectId: string): Promise<boolean> {
    const saved = await this.read(profileId)
    const before = saved.projects.length
    saved.projects = saved.projects.filter((one) => one.projectId !== projectId)
    if (saved.projects.length === before) return false
    this.touch(profileId)
    return true
  }

  /**
   * Everything belonging to a Page, removed.
   *
   * For when a Page is deleted *and* the user asked for its work to go too. Deleting the Page alone never calls this --
   * that is the whole reason it is a separate method.
   */
  async forgetPage(profileId: string, pageId: string): Promise<void> {
    const saved = await this.read(profileId)
    saved.projects = saved.projects.filter((one) => one.pageId !== pageId)
    saved.grants = saved.grants.filter((one) => one.pageId !== pageId)
    saved.favourites = saved.favourites.filter((one) => one !== pageId)
    delete saved.usage[pageId]
    delete saved.approved[pageId]
    this.touch(profileId)
  }

  /** Called when the profile changes, so the next read is from the new profile's file. */
  forget(profileId?: string): void {
    if (profileId === undefined) {
      this.cache.clear()
      return
    }
    this.cache.delete(profileId)
  }
}
