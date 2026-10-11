import { ProfileJsonFile } from '../storage/profileJsonFile.ts'
import { join } from 'node:path'
import { dataDirFor } from '../../shared/profiles.ts'
import { grantIsLive, type PermissionGrant, type Scope } from '../../shared/pages/capabilities.ts'
import { isPageId } from '../../shared/pages/identity.ts'
import {
  applicationToJson,
  isApplicationError,
  readApplication,
  type PageApplication
} from '../../shared/pages/application.ts'

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
  /** Applications a profile may keep. A navigation nobody can hold in mind is the real limit; this is the backstop. */
  applications: 200,
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
  /**
   * Applications, held as the JSON their own module writes.
   *
   * Kept as plain JSON rather than as built objects because they are rebuilt through their own constructors on
   * every read. A file that has been hand-edited cannot produce an application that breaks an invariant -- it is
   * dropped instead.
   */
  applications: Record<string, unknown>[]
}

/**
 * A profile that has never used Pages, made fresh each time it is asked for.
 *
 * It used to be a single frozen-by-convention object spread with `{ ...EMPTY }`, which copies one level: `usage`
 * and `approved` are objects, so every profile's "empty" state shared the *same two objects*, and `recordOpen` and
 * `approve` change them in place. One profile's history therefore appeared in another profile that had never
 * opened Pages at all -- and was then written to that profile's file. A function instead of a constant is the
 * whole fix, and the only way to make the sharing impossible rather than remembered.
 */
const empty = (): Saved => ({
  schema: SCHEMA,
  grants: [],
  favourites: [],
  usage: {},
  projects: [],
  approved: {},
  applications: []
})

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
  if (!isObject(raw)) return empty()
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
  // Rebuilt through their own constructors on the way in, so a tampered entry is dropped rather than trusted.
  const applications = (Array.isArray(raw.applications) ? raw.applications : [])
    .filter((one) => !isApplicationError(readApplication(one)))
    .slice(0, STORE_LIMITS.applications) as Record<string, unknown>[]
  return { schema: SCHEMA, grants, favourites, usage, projects, approved, applications }
}

export class PagesStore {
  /**
   * One file per profile, with the cache, the timers and the refusals in `storage/profileJsonFile.ts`.
   *
   * This store and the generated-Pages store beside it had the same hundred lines each: a map of profiles, a dirty
   * set, a timer each, the set of files that must not be written over, and write-beside-then-rename twice -- once
   * for the timed write and once for the one at quitting. Nothing about the behaviour changed when they moved.
   */
  private readonly files: ProfileJsonFile<Saved>

  constructor(userDataPath: string) {
    this.files = new ProfileJsonFile<Saved>({
      fileFor: (profileId) => join(userDataPath, dataDirFor(profileId), FILE),
      empty,
      parse: (text) => cleanSaved(JSON.parse(text)),
      delayMs: FLUSH_MS,
      refusal: () =>
        'Orbis could not make sense of this profile\u2019s Pages file, so nothing was changed. It has been left exactly as it is.'
    })
  }

  /** Everything this profile has decided. Read once and kept, because every question below asks it. */
  read(profileId: string): Promise<Saved> {
    return this.files.read(profileId)
  }

  /**
   * The same read, for something that is about to change this profile's file.
   *
   * A read that is only going to be shown can happily hand back defaults for a file Orbis could not make sense of.
   * A read that is about to be followed by a save cannot: the save will be refused, and the method would have
   * already returned the saved project and `true` -- so the screen says it saved and nothing was written.
   */
  private readForWrite(profileId: string): Promise<Saved> {
    return this.files.forWrite(profileId)
  }

  async flush(): Promise<void> {
    await this.files.flush()
  }

  flushSync(): void {
    this.files.flushSync()
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
    const saved = await this.readForWrite(profileId)
    const cleaned = cleanGrant(grant)
    if (!cleaned) return saved.grants
    const same = (one: PermissionGrant): boolean =>
      one.pageId === cleaned.pageId &&
      one.capabilityId === cleaned.capabilityId &&
      JSON.stringify(one.scope) === JSON.stringify(cleaned.scope)
    saved.grants = [...saved.grants.filter((one) => !same(one)), cleaned].slice(-STORE_LIMITS.grants)
    this.files.touch(profileId)
    return saved.grants
  }

  /** Every grant for a Page and capability marked withdrawn. Marked rather than deleted, so the decision is visible. */
  async revoke(profileId: string, pageId: string, capabilityId?: string): Promise<PermissionGrant[]> {
    const saved = await this.readForWrite(profileId)
    saved.grants = saved.grants.map((one) =>
      one.pageId === pageId && (capabilityId === undefined || one.capabilityId === capabilityId)
        ? { ...one, state: 'revoked' as const }
        : one
    )
    this.files.touch(profileId)
    return saved.grants
  }

  /** Grants that have lapsed, tidied away. Never changes what is allowed -- an expired grant already allowed nothing. */
  async pruneGrants(profileId: string, now: number): Promise<void> {
    // The plain read, not `readForWrite`: this is bookkeeping, not something somebody asked for. Failing to
    // record it must never stop the thing it was recording -- a damaged Pages file would otherwise mean no Page
    // would open at all. Nothing is written either, because the write is still refused further down.
    const saved = await this.read(profileId)
    const before = saved.grants.length
    saved.grants = saved.grants.filter((one) => one.state === 'active' && grantIsLive(one, now))
    if (saved.grants.length !== before) this.files.touch(profileId)
  }

  // ---------------------------------------------------------------- favourites and usage

  async favourites(profileId: string): Promise<string[]> {
    return (await this.read(profileId)).favourites
  }

  async setFavourite(profileId: string, pageId: string, favourite: boolean): Promise<boolean> {
    const saved = await this.readForWrite(profileId)
    if (!isPageId(pageId)) return false
    const has = saved.favourites.includes(pageId)
    if (favourite && !has) saved.favourites = [...saved.favourites, pageId].slice(-STORE_LIMITS.favourites)
    else if (!favourite && has) saved.favourites = saved.favourites.filter((one) => one !== pageId)
    else return has
    this.files.touch(profileId)
    return favourite
  }

  async usage(profileId: string): Promise<Saved['usage']> {
    return (await this.read(profileId)).usage
  }

  async recordOpen(profileId: string, pageId: string, now: number): Promise<void> {
    if (!isPageId(pageId)) return
    // The plain read, not `readForWrite`: this is bookkeeping, not something somebody asked for. Failing to
    // record it must never stop the thing it was recording -- a damaged Pages file would otherwise mean no Page
    // would open at all. Nothing is written either, because the write is still refused further down.
    const saved = await this.read(profileId)
    const held = saved.usage[pageId] ?? { openCount: 0, lastOpenedAt: 0 }
    saved.usage[pageId] = { openCount: Math.min(1e9, held.openCount + 1), lastOpenedAt: now }
    this.files.touch(profileId)
  }

  // ---------------------------------------------------------------- accepted updates

  async approved(profileId: string): Promise<Record<string, string>> {
    return (await this.read(profileId)).approved
  }

  async approve(profileId: string, pageId: string, version: string): Promise<void> {
    if (!isPageId(pageId)) return
    const saved = await this.readForWrite(profileId)
    saved.approved[pageId] = version.slice(0, 24)
    this.files.touch(profileId)
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

    const saved = await this.readForWrite(profileId)
    const existing = saved.projects.find((one) => one.projectId === cleaned.projectId)
    if (existing) {
      const updated: PageProject = { ...existing, name: cleaned.name, state: cleaned.state, updatedAt: now }
      saved.projects = saved.projects.map((one) => (one.projectId === cleaned.projectId ? updated : one))
      this.files.touch(profileId)
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
    this.files.touch(profileId)
    return { project: cleaned }
  }

  async deleteProject(profileId: string, projectId: string): Promise<boolean> {
    const saved = await this.readForWrite(profileId)
    const before = saved.projects.length
    saved.projects = saved.projects.filter((one) => one.projectId !== projectId)
    if (saved.projects.length === before) return false
    this.files.touch(profileId)
    return true
  }

  /**
   * Everything belonging to a Page, removed.
   *
   * For when a Page is deleted *and* the user asked for its work to go too. Deleting the Page alone never calls this --
   * that is the whole reason it is a separate method.
   */
  /**
   * Every application this profile has, rebuilt and validated.
   *
   * An entry that no longer reads as a valid application is left out rather than returned broken, which is the rule
   * the rest of this store follows: a damaged entry is dropped, never repaired into something plausible.
   */
  async applications(profileId: string): Promise<PageApplication[]> {
    const saved = await this.read(profileId)
    const out: PageApplication[] = []
    for (const raw of saved.applications) {
      const application = readApplication(raw)
      if (!isApplicationError(application)) out.push(application)
    }
    return out
  }

  async application(profileId: string, applicationId: string): Promise<PageApplication | null> {
    const all = await this.applications(profileId)
    return all.find((one) => one.applicationId === applicationId) ?? null
  }

  /**
   * Save an application, replacing any earlier copy.
   *
   * It arrives already built, so it is valid by construction. What is checked here is the profile: an application
   * is saved into the profile that owns it and nowhere else, because a boundary that depends on the caller passing
   * the right id is not a boundary.
   */
  async saveApplication(profileId: string, application: PageApplication): Promise<boolean> {
    if (application.ownerProfile !== profileId) return false
    const saved = await this.readForWrite(profileId)
    const json = applicationToJson(application)
    const index = saved.applications.findIndex((one) => one.applicationId === application.applicationId)
    if (index === -1) {
      if (saved.applications.length >= STORE_LIMITS.applications) return false
      saved.applications = [...saved.applications, json]
    } else {
      saved.applications = saved.applications.map((one, i) => (i === index ? json : one))
    }
    this.files.set(profileId, saved)
    return true
  }

  async deleteApplication(profileId: string, applicationId: string): Promise<boolean> {
    const saved = await this.readForWrite(profileId)
    const left = saved.applications.filter((one) => one.applicationId !== applicationId)
    if (left.length === saved.applications.length) return false
    saved.applications = left
    this.files.set(profileId, saved)
    return true
  }

  async forgetPage(profileId: string, pageId: string): Promise<void> {
    const saved = await this.readForWrite(profileId)
    saved.projects = saved.projects.filter((one) => one.pageId !== pageId)
    saved.grants = saved.grants.filter((one) => one.pageId !== pageId)
    saved.favourites = saved.favourites.filter((one) => one !== pageId)
    delete saved.usage[pageId]
    delete saved.approved[pageId]
    this.files.touch(profileId)
  }

  /** Called when the profile changes, so the next read is from the new profile's file. */
  forget(profileId?: string): void {
    if (profileId === undefined) {
      this.files.drop()
      return
    }
    this.files.drop(profileId)
  }
}
