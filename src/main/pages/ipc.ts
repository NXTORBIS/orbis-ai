import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  categoryTree,
  listPages,
  pageById,
  recentPages,
  registryHealth,
  relatedPages,
  searchPages,
  suggestPages,
  tagCounts,
  type PageStatus,
  type RegisteredPage
} from '../../shared/pages/registry.ts'
import { describeRequests, type PageManifest } from '../../shared/pages/manifest.ts'
import { versionToText } from '../../shared/pages/identity.ts'
import { originScope, type Scope } from '../../shared/pages/capabilities.ts'
import type { PagesService } from './service.ts'
import type { GeneratedPages } from './generated.ts'

/**
 * How the Orbis interface asks about Pages.
 *
 * Thin on purpose: every channel here resolves the profile itself and then calls the service, which is where the rules
 * are. Nothing decides anything at this layer, because a decision made here would be a second copy of a rule that already
 * exists in `capabilities.ts` -- and the copy is the one that ends up wrong.
 *
 * The sender is checked on every channel. A Page runs in a web page; a web page must not be able to reach these by
 * guessing a channel name.
 */

export interface PagesIpcOptions {
  service: PagesService
  profileId(): Promise<string>
  getWindow(): BrowserWindow | null
  /**
   * Building Pages that do not exist yet.
   *
   * Optional, and absent is a working state rather than a broken one: a build with no model configured has nothing to
   * offer, and the channels below say so rather than not existing. A channel that disappears depending on
   * configuration is one the interface has to guess about.
   */
  generated?: GeneratedPages
}

/** What the renderer gets for one Page. Deliberately not the whole registry entry -- notes and trust stay inside. */
export interface PageCard {
  pageId: string
  slug: string
  url: string
  title: string
  description: string
  kind: string
  icon: string
  version: string
  categories: string[]
  tags: string[]
  status: PageStatus
  offline: boolean
  favourite: boolean
  openCount: number
  lastOpenedAt: number | null
  limitations: string[]
  summary: string
  /** Why it is not available, when it is not. Empty otherwise. */
  note: string
}

const cardFor = (page: RegisteredPage): PageCard => ({
  pageId: page.identity.pageId,
  slug: page.identity.slug,
  url: page.identity.canonicalUrl,
  title: page.manifest.title,
  description: page.manifest.description,
  kind: page.manifest.kind,
  icon: page.manifest.icon,
  version: versionToText(page.manifest.version),
  categories: page.manifest.categories,
  tags: page.manifest.tags,
  status: page.status,
  offline: page.manifest.offline,
  favourite: page.favourite,
  openCount: page.openCount,
  lastOpenedAt: page.lastOpenedAt,
  limitations: page.manifest.limitations,
  summary: page.manifest.search.summary,
  note: page.note
})

export function registerPagesIpc(o: PagesIpcOptions): void {
  const handle = (channel: string, run: (profileId: string, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== o.getWindow()?.webContents) throw new Error('Not allowed.')
      try {
        return await run(await o.profileId(), ...args)
      } catch (err) {
        // A code and a sentence. Never a stack, and never a path.
        return { error: 'failed', message: err instanceof Error && err.message.length < 200 ? err.message : 'That did not work.' }
      }
    })
  }

  const str = (value: unknown, max = 200): string => (typeof value === 'string' ? value.slice(0, max) : '')
  const count = (value: unknown, low: number, high: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback

  // ---------------------------------------------------------------- what exists

  /** Everything a Pages screen needs in one answer, so opening the library is one round trip. */
  handle('pages:state', async (id) => {
    const state = await o.service.state(id)
    return {
      pages: listPages(state, { profileId: id }).map(cardFor),
      unavailable: listPages(state, { profileId: id, status: 'any' })
        .filter((one) => one.status !== 'available')
        .map(cardFor),
      recent: recentPages(state, id, 8).map(cardFor),
      favourites: listPages(state, { profileId: id, favourite: true }).map(cardFor),
      categories: categoryTree(state, id),
      tags: tagCounts(state, id).slice(0, 40),
      // Problems registering a built-in Page are shown rather than hidden: a missing Page with no explanation is worse.
      problems: o.service.problems()
    }
  })

  handle('pages:health', async (id) => {
    const state = await o.service.state(id)
    return { health: registryHealth(state), problems: o.service.problems() }
  })

  handle('pages:list', async (id, filter) => {
    const state = await o.service.state(id)
    const given = (filter && typeof filter === 'object' ? filter : {}) as Record<string, unknown>
    return {
      pages: listPages(state, {
        profileId: id,
        category: given.category === undefined ? undefined : str(given.category, 120),
        tag: given.tag === undefined ? undefined : str(given.tag, 40),
        kind: given.kind === undefined ? undefined : str(given.kind, 40),
        favourite: typeof given.favourite === 'boolean' ? given.favourite : undefined,
        offline: typeof given.offline === 'boolean' ? given.offline : undefined
      }).map(cardFor)
    }
  })

  // ---------------------------------------------------------------- finding one

  handle('pages:search', async (id, query, options) => {
    const state = await o.service.state(id)
    const given = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
    const results = searchPages(state, str(query, 200), {
      profileId: id,
      limit: count(given.limit, 1, 50, 20),
      offlineOnly: given.offlineOnly === true,
      category: given.category === undefined ? undefined : str(given.category, 120)
    })
    return {
      results: results.map((one) => ({ page: cardFor(one.page), score: one.score, matched: one.matched }))
    }
  })

  handle('pages:suggest', async (id, prefix) => ({
    suggestions: suggestPages(await o.service.state(id), str(prefix, 80), id, 5).map(cardFor)
  }))

  handle('pages:related', async (id, pageId) => ({
    related: relatedPages(await o.service.state(id), str(pageId, 80), id, 6).map((one) => ({
      page: cardFor(one.page),
      matched: one.matched
    }))
  }))

  // ---------------------------------------------------------------- opening one

  /**
   * An address resolved without opening it.
   *
   * For the router: it needs to know whether an address is a Page before it decides where to send it, and asking must not
   * count as a visit.
   */
  handle('pages:resolve', async (id, url) => {
    const resolved = await o.service.resolve(id, str(url, 2048))
    if (!resolved.found) {
      return { found: false, reason: resolved.reason, message: resolved.message }
    }
    return {
      found: true,
      page: cardFor(resolved.page),
      route: resolved.address.route,
      params: resolved.address.params,
      fragment: resolved.address.fragment,
      redirectedFrom: resolved.redirectedFrom,
      canonicalUrl: resolved.canonicalUrl
    }
  })

  handle('pages:open', async (id, url) => {
    const resolved = await o.service.open(id, str(url, 2048))
    if (!resolved.found) return { found: false, reason: resolved.reason, message: resolved.message }
    return {
      found: true,
      page: cardFor(resolved.page),
      route: resolved.address.route,
      params: resolved.address.params,
      canonicalUrl: resolved.canonicalUrl,
      redirectedFrom: resolved.redirectedFrom
    }
  })

  handle('pages:favourite', async (id, pageId, favourite) => ({
    favourite: await o.service.favourite(id, str(pageId, 80), favourite === true)
  }))

  // ---------------------------------------------------------------- what a Page may do

  handle('pages:permissions', async (id, pageId) => {
    const wanted = str(pageId, 80)
    const summary = await o.service.permissions(id, wanted)
    if (!summary) return { error: 'not-found', message: 'There is no Page with that id.' }
    const manifest: PageManifest | null = o.service.manifestFor(wanted)
    return {
      permissions: summary,
      // What the Page asked for and why, described from the capability registry rather than from the Page's own words.
      requests: manifest ? describeRequests(manifest) : []
    }
  })

  /**
   * A permission granted after somebody answered.
   *
   * The scope arrives as text and is parsed here, because an unparseable scope has to become a refusal rather than a
   * wider grant. A network scope that cannot be read is not "all origins"; it is nothing.
   */
  handle('pages:grant', async (id, pageId, capabilityId, scopeText, minutes) => {
    let scope: Scope = { kind: 'none' }
    const given = str(scopeText, 512)
    if (given !== '') {
      const parsed = originScope(given)
      if (!parsed) {
        return { granted: false, message: 'That is not an address Orbis can limit a permission to.' }
      }
      scope = parsed
    }
    const lifetime = count(minutes, 0, 60 * 24 * 365, 0)
    const result = await o.service.grant(
      id,
      str(pageId, 80),
      str(capabilityId, 80),
      scope,
      lifetime === 0 ? null : Date.now() + lifetime * 60_000
    )
    if (!result.granted) return { granted: false, message: result.message }
    return { granted: true, permissions: await o.service.permissions(id, str(pageId, 80)) }
  })

  handle('pages:revoke', async (id, pageId, capabilityId) => {
    await o.service.revoke(id, str(pageId, 80), capabilityId === undefined ? undefined : str(capabilityId, 80))
    return { permissions: await o.service.permissions(id, str(pageId, 80)) }
  })

  // ---------------------------------------------------------------- doing the work

  /**
   * The one door to the computational engines.
   *
   * Every operation is checked against the Page's capabilities before an engine is touched. There is no second route, so a
   * Page without `computation.units` cannot convert anything however it asks.
   */
  handle('pages:compute', async (id, request) => {
    const given = (request && typeof request === 'object' ? request : {}) as Record<string, unknown>
    return o.service.run(id, {
      pageId: str(given.pageId, 80),
      operation: str(given.operation, 60),
      input: given.input && typeof given.input === 'object' ? (given.input as Record<string, unknown>) : {}
    })
  })

  // ---------------------------------------------------------------- what a Page has saved

  handle('pages:projects', async (id, pageId) => ({ projects: await o.service.projects(id, str(pageId, 80)) }))

  handle('pages:project-save', async (id, pageId, projectId, name, state) => {
    const result = await o.service.saveProject(
      id,
      str(pageId, 80),
      projectId === null || projectId === undefined ? null : str(projectId, 80),
      str(name, 120) || 'Untitled',
      state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
    )
    if (!result.ok) return { saved: false, error: result.error, message: result.message }
    return { saved: true, project: result.project, projects: await o.service.projects(id, str(pageId, 80)) }
  })

  handle('pages:project-delete', async (id, pageId, projectId) => {
    const deleted = await o.service.deleteProject(id, str(projectId, 80))
    return { deleted, projects: await o.service.projects(id, str(pageId, 80)) }
  })

  // ---------------------------------------------------------------- the rest of the platform

  /**
   * A Page packed up for export.
   *
   * `acceptSecrets` is only ever true because a person was shown each finding and chose to include it. The renderer
   * cannot set it without having asked, and a Page cannot set it at all -- this channel is the app's, not a Page's.
   */
  handle('pages:export', async (id, pageId, entries, acceptSecrets) => {
    const list = Array.isArray(entries) ? entries.slice(0, 500) : []
    const cleaned = list
      .map((one) => (one && typeof one === 'object' ? (one as Record<string, unknown>) : {}))
      .filter((one) => typeof one.path === 'string' && typeof one.content === 'string')
      .map((one) => ({ path: String(one.path).slice(0, 255), content: String(one.content) }))
    return o.service.exportPage(id, str(pageId, 80), cleaned, acceptSecrets === true)
  })

  /** A package described so somebody can decide about it. Nothing is installed and nothing is granted. */
  handle('pages:inspect-package', async (_id, raw, packedBytes) =>
    o.service.inspectPackage(raw, typeof packedBytes === 'number' && packedBytes > 0 ? packedBytes : undefined)
  )

  /** A fault turned into advice, with the cost of each recovery attached to it. */
  handle('pages:diagnose', async (id, fault, context) => {
    const given = (fault && typeof fault === 'object' ? fault : {}) as Record<string, unknown>
    const where = (context && typeof context === 'object' ? context : {}) as Record<string, unknown>
    return o.service.diagnose(
      id,
      {
        kind: str(given.kind, 40) as never,
        detail: str(given.detail, 400),
        at: typeof given.at === 'number' ? given.at : Date.now(),
        pageId: str(given.pageId, 80) || undefined,
        repeats: count(given.repeats, 1, 1000, 1)
      },
      {
        hasCheckpoint: where.hasCheckpoint === true,
        hasUnsavedWork: where.hasUnsavedWork === true,
        everStarted: where.everStarted !== false
      }
    )
  })

  /** An accessibility audit, which never comes back as a pass. */
  handle('pages:audit', async (_id, elements) => {
    const list = Array.isArray(elements) ? elements.slice(0, 2000) : []
    return o.service.audit(list as never)
  })

  /** A built Page checked before it is allowed to run. */
  handle('pages:check-document', async (_id, document) => {
    const given = (document && typeof document === 'object' ? document : {}) as Record<string, unknown>
    return o.service.checkDocument({
      fields: Array.isArray(given.fields) ? (given.fields.slice(0, 400) as never) : [],
      components: Array.isArray(given.components) ? (given.components.slice(0, 400) as never) : [],
      computations: Array.isArray(given.computations) ? (given.computations.slice(0, 200) as never) : []
    })
  })

  /** Who can receive what. Only what each Page declared, never inferred. */
  handle('pages:participants', async (id) => ({ participants: await o.service.participants(id) }))

  /**
   * One Page's message to another.
   *
   * The sender is named by the caller here because this channel is the app's, not a Page's -- a Page's own messages
   * arrive through the sandbox bridge, where the identity comes from the frame and cannot be claimed.
   */
  handle('pages:send', async (id, fromPageId, toPageId, kind, body) =>
    o.service.sendBetweenPages(id, str(fromPageId, 80), str(toPageId, 80), str(kind, 64), body)
  )

  /**
   * A question answered by an engine where it can be.
   *
   * `computed: false` means "answer this the ordinary way", not "there is no answer". The distinction matters: the
   * caller must not present a refusal to route as a refusal to answer.
   */
  handle('pages:answer', async (id, question) => o.service.answerQuestion(id, str(question, 400)))

  /** Which Pages, if any, answer a search better than the results they would displace. */
  handle('pages:search-module', async (id, query, intents, looksLikeUrl) => {
    const list = Array.isArray(intents) ? intents.slice(0, 16) : []
    const cleaned = list
      .map((one) => (one && typeof one === 'object' ? (one as Record<string, unknown>) : {}))
      .filter((one) => typeof one.intent === 'string')
      .map((one) => ({
        intent: String(one.intent).slice(0, 40) as never,
        confidence: typeof one.confidence === 'number' && Number.isFinite(one.confidence) ? Math.min(1, Math.max(0, one.confidence)) : 0
      }))
    return o.service.searchModule(id, str(query, 400), cleaned, looksLikeUrl === true)
  })

  // ---------------------------------------------------------------- Pages that did not exist yet
  //
  // Building is deliberately several calls rather than one. A Page is built, looked at, and only then kept -- and
  // each of those is something somebody decided, so each is something they can decline.

  const noGenerator = { error: 'unavailable', message: 'Building Pages is not available here.' }

  handle('pages:generate', async (id, request, intents) => {
    if (!o.generated) return noGenerator
    const read = Array.isArray(intents)
      ? (intents as unknown[])
          .filter((one): one is { intent: string; confidence: number } => typeof one === 'object' && one !== null)
          .slice(0, 4)
          .map((one) => ({ intent: String(one.intent) as never, confidence: count(one.confidence, 0, 1, 0) }))
      : undefined
    const built = await o.generated.build(id, str(request, 400), { intents: read })
    return {
      stage: built.session.stage,
      sessionId: built.session.sessionId,
      // The stages it went through, so a screen can show what happened rather than only how it ended.
      history: built.session.history,
      failure: built.session.failure,
      gates: built.session.validation?.gates ?? [],
      because: built.because,
      insteadOpen: built.insteadOpen,
      page:
        built.page === null
          ? null
          : { pageId: built.page.pageId, manifest: built.page.manifest, document: built.page.document }
    }
  })

  handle('pages:generate-keep', async (id, pageId) => {
    if (!o.generated) return noGenerator
    return o.generated.keep(id, str(pageId, 80))
  })

  handle('pages:generate-discard', async (_id, pageId) => {
    if (!o.generated) return noGenerator
    return { discarded: o.generated.discard(str(pageId, 80)) }
  })

  handle('pages:generate-rebuild', async (id, pageId, change) => {
    if (!o.generated) return noGenerator
    const result = await o.generated.rebuild(id, str(pageId, 80), str(change, 300))
    return {
      message: result.message,
      version: result.version === null ? null : { versionId: result.version.versionId, version: versionToText(result.version.version), reason: result.version.reason },
      changes: result.difference?.changes ?? [],
      wantsMore: result.difference?.wantsMore ?? false,
      newCapabilities: result.difference?.newCapabilities ?? [],
      dropped: result.carried?.dropped ?? [],
      stage: result.session?.stage ?? 'failed'
    }
  })

  handle('pages:generate-history', async (id, pageId) => {
    if (!o.generated) return noGenerator
    const history = await o.generated.history(id, str(pageId, 80))
    if (history === null) return { error: 'not-found', message: 'There is no such Page.' }
    return {
      publishedVersionId: history.publishedVersionId,
      forkedFrom: history.forkedFrom,
      versions: history.versions.map((one) => ({
        versionId: one.versionId,
        parentVersionId: one.parentVersionId,
        version: versionToText(one.version),
        state: one.state,
        reason: one.reason,
        createdAt: one.createdAt,
        title: one.manifest.title
      }))
    }
  })

  handle('pages:generate-publish', async (id, pageId, versionId) => {
    if (!o.generated) return noGenerator
    return o.generated.publish(id, str(pageId, 80), str(versionId, 40))
  })

  handle('pages:generate-withdraw', async (id, pageId, versionId) => {
    if (!o.generated) return noGenerator
    return o.generated.withdraw(id, str(pageId, 80), str(versionId, 40))
  })

  handle('pages:generate-forget', async (id, pageId) => {
    if (!o.generated) return noGenerator
    return { forgotten: await o.generated.forget(id, str(pageId, 80)) }
  })

  handle('pages:generate-sessions', async (id) => {
    if (!o.generated) return noGenerator
    return {
      sessions: (await o.generated.sessions(id)).map((one) => ({
        sessionId: one.sessionId,
        request: one.request,
        stage: one.stage,
        updatedAt: one.updatedAt,
        message: one.failure?.message ?? ''
      }))
    }
  })

  /** The document a generated Page opens as, for the runtime that renders it. */
  handle('pages:generate-document', async (id, pageId) => {
    const document = await o.service.documentFor(id, str(pageId, 80))
    if (document === null) return { error: 'not-found', message: 'That Page has nothing to open.' }
    return { document }
  })

  // ---------------------------------------------------------------- one Page, in full

  /** Everything about a single Page, for its own screen. One round trip rather than four. */
  handle('pages:detail', async (id, pageId) => {
    const wanted = str(pageId, 80)
    const state = await o.service.state(id)
    const page = pageById(state, wanted)
    if (!page) return { error: 'not-found', message: 'There is no Page with that id.' }
    const manifest = page.manifest
    return {
      page: cardFor(page),
      requests: describeRequests(manifest),
      permissions: await o.service.permissions(id, wanted),
      projects: await o.service.projects(id, wanted),
      related: relatedPages(state, wanted, id, 6).map((one) => ({ page: cardFor(one.page), matched: one.matched })),
      dependencies: manifest.dependencies.map((one) => ({
        id: one.id,
        atLeast: versionToText(one.atLeast),
        optional: one.optional
      })),
      languages: manifest.languages
    }
  })
}
