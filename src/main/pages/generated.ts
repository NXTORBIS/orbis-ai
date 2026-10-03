/**
 * Everything the application does with a generated Page after it has been built.
 *
 * `generationService.ts` builds one. `generatedStore.ts` keeps it. `versioning.ts` decides what a new version means.
 * This is the part that puts those three together and is the only thing the IPC layer talks to -- so there is one
 * place that knows the order things happen in, and the rules stay where they are tested.
 *
 * ## Building does not keep
 *
 * `build` produces a Page and stores nothing. Keeping it is a separate call, because a generated Page is something
 * somebody should look at before it joins their library: the whole feature is a model writing a calculator, and the
 * moment that becomes automatic is the moment somebody's library fills with Pages they never asked for and cannot
 * tell apart from the ones they did.
 *
 * ## Publishing is a decision, and going back is exact
 *
 * A new version arrives as a draft beside the one in use. Publishing it is a second call. That is not ceremony: a
 * regenerated Page is a Page a model rewrote, and the version that already worked has to still be there when the
 * rewrite turns out to be subtly worse. Going back is publishing the old node, not building it again.
 */

import { makePageId } from '../../shared/pages/identity.ts'
import { bus } from '../eventBus.ts'
import type { PageManifest } from '../../shared/pages/manifest.ts'
import type { PageDocument } from '../../shared/pages/builder.ts'
import type { GenerationSession } from '../../shared/pages/generation.ts'
import type { QueryIntent } from '../../shared/pages/search.ts'
import type { Change, ChangeProblem } from '../../shared/pages/changes.ts'
import {
  carryValues,
  isVersionError,
  lineage,
  nodeById,
  openableNode,
  publish as publishVersion,
  regenerate,
  startGraph,
  withdraw as withdrawVersion,
  type Carried,
  type Difference,
  type PageVersionNode
} from '../../shared/pages/versioning.ts'
import { GenerationService, type GenerationServiceOptions } from './generationService.ts'
import { GeneratedStore } from './generatedStore.ts'

export interface Built {
  /** What happened, stage by stage, for a screen that was waiting. */
  session: GenerationSession
  /** Present only when something was built. Not kept until somebody says so. */
  page: { pageId: string; manifest: PageManifest; document: PageDocument } | null
  /** When an existing Page answers this instead, its address. */
  insteadOpen: string | null
  /** Why, in words. */
  because: readonly string[]
}

export interface GeneratedPagesOptions extends Omit<GenerationServiceOptions, 'random'> {
  store: GeneratedStore
  random(): string
}

export class GeneratedPages {
  private readonly service: GenerationService
  private readonly store: GeneratedStore
  private readonly o: GeneratedPagesOptions
  /** Pages built and not yet kept, so keeping one does not mean building it twice. */
  private readonly pending = new Map<string, { manifest: PageManifest; document: PageDocument; spec: unknown }>()

  constructor(options: GeneratedPagesOptions) {
    this.o = options
    this.store = options.store
    this.service = new GenerationService(options)
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  /** Every generated Page this profile has, as the register wants them. */
  async forRegistry(profileId: string): Promise<{ manifest: PageManifest; document: PageDocument }[]> {
    const out: { manifest: PageManifest; document: PageDocument }[] = []
    for (const graph of await this.store.graphs(profileId)) {
      const node = openableNode(graph)
      // A Page whose every version was withdrawn opens as nothing. Left out rather than shown as broken, because it
      // was taken out of use deliberately and putting it back would undo that.
      if (node !== null) out.push({ manifest: node.manifest, document: node.document })
    }
    return out
  }

  async build(
    profileId: string,
    request: string,
    options: { intents?: readonly { intent: QueryIntent; confidence: number }[]; looksLikeUrl?: boolean } = {}
  ): Promise<Built> {
    const outcome = await this.service.generate(profileId, request, options)
    await this.store.putSession(profileId, outcome.session)

    const resolution = outcome.resolution
    const insteadOpen =
      resolution !== null && (resolution.action === 'open' || resolution.action === 'configure')
        ? resolution.suggestion.page.identity.canonicalUrl
        : null

    if (outcome.compiled === null || outcome.session.stage !== 'ready') {
      return {
        session: outcome.session,
        page: null,
        insteadOpen,
        because: outcome.session.failure === null ? (resolution?.because ?? []) : [outcome.session.failure.message]
      }
    }
    const pageId = outcome.compiled.manifest.pageId
    this.pending.set(pageId, { manifest: outcome.compiled.manifest, document: outcome.compiled.document, spec: outcome.compiled.spec })
    return {
      session: outcome.session,
      page: { pageId, manifest: outcome.compiled.manifest, document: outcome.compiled.document },
      insteadOpen: null,
      because: outcome.compiled.warnings.map((one) => one.message)
    }
  }

  /**
   * A built Page kept, and opened.
   *
   * Published immediately, unlike a later version: there is nothing for it to supersede and nothing to compare it
   * against, so leaving it a draft would mean a Page somebody asked to keep that does not open.
   */
  async keep(profileId: string, pageId: string): Promise<{ kept: boolean; message: string; url: string | null }> {
    const built = this.pending.get(pageId)
    if (built === undefined) {
      return { kept: false, message: 'That Page is no longer waiting to be kept. Build it again.', url: null }
    }
    const graph = startGraph({
      pageId,
      versionId: `v_${this.o.random()}`.slice(0, 40),
      spec: built.spec as never,
      manifest: built.manifest,
      document: built.document,
      now: this.now()
    })
    const published = publishVersion(graph, graph.nodes[0].versionId)
    if (isVersionError(published)) return { kept: false, message: published.message, url: null }

    const saved = await this.store.putGraph(profileId, published)
    if (!saved.saved) return { kept: false, message: saved.message, url: null }
    this.pending.delete(pageId)
    /*
     * Announced here and nowhere earlier.
     *
     * A Page is ready when it has been compiled, published and written -- not when a model finished writing one. Every
     * step above can still refuse, so this is the first line at which saying "your Page is ready" is true.
     */
    bus.publish('orbisPage.ready', { pageId, title: built.manifest.title, slug: built.manifest.slug }, { source: 'pages', profileId })
    return { kept: true, message: '', url: `orbis://pages/${built.manifest.slug}` }
  }

  /** A built Page thrown away. */
  discard(pageId: string): boolean {
    return this.pending.delete(pageId)
  }

  /**
   * One calculation, for a Page that has been built and not yet kept.
   *
   * This exists because `pages:compute` resolves the Page in the register first, and a Page waiting to be kept is not
   * in the register -- so the preview somebody is deciding about could not run a single calculation, and every answer
   * on it read "nothing yet". Which is the worst possible thing for that screen to say: it is the screen whose entire
   * job is to show what the Page does before anybody commits to it.
   *
   * It is not a way round the permission check. The operation must be one the pending Page's own manifest asked for,
   * and that manifest's capabilities were derived from its calculations and checked by the gates before it got here.
   * A Page that is not pending has no entry, so this reaches nothing.
   */
  tryOperation(pageId: string, operation: string, input: Record<string, unknown>): { ok: true; value: unknown } | { ok: false; message: string } {
    const built = this.pending.get(pageId)
    if (built === undefined) return { ok: false, message: 'That Page is no longer waiting to be kept.' }
    const needed = Object.prototype.hasOwnProperty.call(this.o.allOperations, operation) ? this.o.allOperations[operation] : undefined
    if (needed === undefined) return { ok: false, message: `Orbis Pages have no operation called "${operation}".` }
    if (!built.manifest.capabilities.includes(needed)) {
      return { ok: false, message: `This Page did not ask for ${needed}, so it cannot do that.` }
    }
    try {
      return { ok: true, value: this.o.runOperation(operation, input) }
    } catch (err) {
      return { ok: false, message: err instanceof Error && err.message.length < 400 ? err.message : 'That calculation did not work.' }
    }
  }

  // ---------------------------------------------------------------- later versions

  /**
   * A Page built again, from what it is now and what somebody wants changed.
   *
   * The request given to the model is the change in the person's words, with the Page's own purpose in front of it,
   * because "make the chart logarithmic" on its own is not something anything could build.
   */
  async rebuild(
    profileId: string,
    pageId: string,
    change: string
  ): Promise<{ version: PageVersionNode | null; difference: Difference | null; carried: Carried | null; message: string; session: GenerationSession | null }> {
    const graph = await this.store.graph(profileId, pageId)
    if (graph === null) return { version: null, difference: null, carried: null, message: 'There is no such Page.', session: null }
    const from = openableNode(graph)
    if (from === null) return { version: null, difference: null, carried: null, message: 'That Page has no version in use.', session: null }

    const outcome = await this.service.generate(profileId, `${from.spec.purpose}\n\nChange it: ${change}`.slice(0, 400), {
      // A rebuild is not a search. Whatever exists in the library, this Page is the thing being changed.
      intents: [{ intent: 'calculation', confidence: 1 }]
    })
    await this.store.putSession(profileId, outcome.session)
    if (outcome.compiled === null || outcome.session.stage !== 'ready') {
      return {
        version: null,
        difference: null,
        carried: null,
        message: outcome.session.failure?.message ?? 'It could not be built again.',
        session: outcome.session
      }
    }

    const result = regenerate(
      graph,
      from.versionId,
      {
        versionId: `v_${this.o.random()}`.slice(0, 40),
        spec: outcome.compiled.spec,
        // The new version keeps the Page's identity. A regenerated Page is the same Page, and a new id would break
        // every bookmark, note and workflow that referred to it.
        manifest: { ...outcome.compiled.manifest, pageId, slug: from.manifest.slug },
        document: outcome.compiled.document
      },
      change,
      this.now()
    )
    if (isVersionError(result)) return { version: null, difference: null, carried: null, message: result.message, session: outcome.session }

    const saved = await this.store.putGraph(profileId, result.graph)
    if (!saved.saved) return { version: null, difference: null, carried: null, message: saved.message, session: outcome.session }
    return { version: result.node, difference: result.difference, carried: result.carried, message: '', session: outcome.session }
  }

  /**
   * A small change to a Page, made without writing the Page again.
   *
   * The whole point is what it does *not* do. `rebuild` hands the request to a model along with the Page's purpose
   * and takes whatever comes back, so asking for a different label can return a different calculation and nobody
   * would look for that. This applies a named edit to the specification that already exists, and the parts nobody
   * mentioned are not touched because nothing on this path can touch them.
   *
   * ## Nothing here can damage the Page somebody is using
   *
   * Every step that could fail happens before the version graph is touched: the request is recognised, the change
   * set is checked against the live specification, applied to a copy, and compiled. Only when all of that has
   * worked does a new version exist -- and it is created as a **draft**, so the version people open is still the
   * old one until somebody publishes it. A failed edit leaves the graph exactly as it was.
   *
   * ## Not every request is one of these
   *
   * When `applyChange` does not recognise the request it says so rather than guessing, and `recognised` comes back
   * false. The caller decides whether to fall back to a rebuild; that decision is not made here, because "this
   * needs a model" and "this failed" are different answers and collapsing them would hide real failures behind a
   * regeneration.
   */
  async edit(
    profileId: string,
    pageId: string,
    request: string
  ): Promise<{
    version: PageVersionNode | null
    applied: readonly Change[]
    problems: readonly ChangeProblem[]
    /** False when this is not an edit that can be made directly, so the caller may rebuild instead. */
    recognised: boolean
    carried: Carried | null
    message: string
  }> {
    const nothing = { version: null, applied: [], problems: [], carried: null }
    const graph = await this.store.graph(profileId, pageId)
    if (graph === null) return { ...nothing, recognised: true, message: 'There is no such Page.' }
    const from = openableNode(graph)
    if (from === null) return { ...nothing, recognised: true, message: 'That Page has no version in use.' }

    const outcome = await this.service.applyChange(profileId, from.spec, request)
    if (!outcome.ok) {
      return {
        ...nothing,
        recognised: outcome.recognised,
        problems: outcome.problems,
        message: outcome.message
      }
    }

    const result = regenerate(
      graph,
      from.versionId,
      {
        versionId: `v_${this.o.random()}`.slice(0, 40),
        spec: outcome.built.spec,
        // The same Page, changed. A new id would break every bookmark, note and workflow that referred to it, and
        // the slug is kept for the same reason.
        manifest: { ...outcome.built.manifest, pageId, slug: from.manifest.slug },
        document: outcome.built.document
      },
      request,
      this.now()
    )
    if (isVersionError(result)) {
      return { ...nothing, recognised: true, message: result.message }
    }

    const saved = await this.store.putGraph(profileId, result.graph)
    if (!saved.saved) return { ...nothing, recognised: true, message: saved.message }
    return {
      version: result.node,
      applied: outcome.applied,
      problems: [],
      recognised: true,
      carried: result.carried,
      message: ''
    }
  }

  async publish(profileId: string, pageId: string, versionId: string): Promise<{ published: boolean; message: string }> {
    const graph = await this.store.graph(profileId, pageId)
    if (graph === null) return { published: false, message: 'There is no such Page.' }
    const result = publishVersion(graph, versionId)
    if (isVersionError(result)) return { published: false, message: result.message }
    const saved = await this.store.putGraph(profileId, result)
    return saved.saved ? { published: true, message: '' } : { published: false, message: saved.message }
  }

  async withdraw(profileId: string, pageId: string, versionId: string): Promise<{ withdrawn: boolean; message: string }> {
    const graph = await this.store.graph(profileId, pageId)
    if (graph === null) return { withdrawn: false, message: 'There is no such Page.' }
    const result = withdrawVersion(graph, versionId)
    if (isVersionError(result)) return { withdrawn: false, message: result.message }
    const saved = await this.store.putGraph(profileId, result)
    return { withdrawn: saved.saved, message: saved.message }
  }

  async forget(profileId: string, pageId: string): Promise<boolean> {
    return this.store.deleteGraph(profileId, pageId)
  }

  // ---------------------------------------------------------------- reading

  /** One Page's history, newest first, with what each version was asked to be. */
  async history(profileId: string, pageId: string): Promise<{ versions: PageVersionNode[]; publishedVersionId: string | null; forkedFrom: string | null } | null> {
    const graph = await this.store.graph(profileId, pageId)
    if (graph === null) return null
    const newest = openableNode(graph)
    const walked = newest === null ? [] : lineage(graph, newest.versionId)
    // A history that refers to itself is shown as the versions that exist, unordered, rather than not at all. The
    // walk is how they are *drawn*, and failing to draw it should not hide the Pages.
    const versions = isVersionError(walked) ? [...graph.nodes] : walked
    return { versions, publishedVersionId: graph.publishedVersionId, forkedFrom: graph.forkedFrom }
  }

  /** What would happen to somebody's typed values if a version were published. Asked before, not discovered after. */
  async wouldCarry(
    profileId: string,
    pageId: string,
    versionId: string,
    values: Readonly<Record<string, unknown>>
  ): Promise<Carried | null> {
    const graph = await this.store.graph(profileId, pageId)
    if (graph === null) return null
    const from = openableNode(graph)
    const to = nodeById(graph, versionId)
    if (from === null || to === null) return null
    return carryValues(from.spec, to.spec, values)
  }

  async sessions(profileId: string): Promise<readonly GenerationSession[]> {
    return this.store.sessions(profileId, this.now())
  }

  /** A fresh page id, for whoever needs one before there is a Page. */
  newPageId(): string {
    return makePageId(this.o.random())
  }

  async flush(): Promise<void> {
    await this.store.flush()
  }

  flushSync(): void {
    this.store.flushSync()
  }

  profileChanged(): void {
    this.store.forget()
    this.pending.clear()
  }
}
