/**
 * Where a Page's sandbox stops being a policy and becomes a window.
 *
 * `shared/pages/sandbox.ts` decides what a Page frame must be. This file is the part that tells Electron, serves the
 * Page's files, and refuses everything the policy says to refuse. It is the only file in Pages that knows a browser
 * engine exists, and in Chromium it becomes a `WebContents` delegate plus a `URLLoaderFactory` -- which is why every
 * decision it acts on is imported from the other side of the line rather than made here.
 *
 * ## What is actually enforced, and where
 *
 * A policy object is a description. Three separate things have to agree with it for a Page to really be contained, and
 * all three are set here:
 *
 * 1. **The frame's own settings.** `nodeIntegration` off, `contextIsolation` on, `sandbox` on. Without these the rest is
 *    decoration, so `applyPolicy` refuses to build a frame whose settings fail `checkRuntimePolicy`.
 * 2. **The protocol handler.** A Page's files are served from `orbis-page://<pageId>/`, and the handler refuses any path
 *    that escapes the Page's own directory. The CSP travels with the response, so the browser enforces the network
 *    policy itself rather than relying on us to check every request.
 * 3. **The event handlers.** Navigation, new windows, permission requests and downloads are all refused at the point
 *    Chromium asks. A CSP does not cover `window.open` or a permission prompt, so those need their own refusal.
 *
 * Any one of the three missing leaves a hole the other two do not cover. They are listed together here so that is
 * obvious to whoever changes this next.
 */

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { app, ipcMain, session, WebContentsView, type BrowserWindow, type Session, type WebContents } from 'electron'

import {
  admit,
  createSandbox,
  isMessageProblem,
  isSandboxProblem,
  markReady,
  recordFault,
  sandboxHealth,
  settle,
  stopSandbox,
  SANDBOX_LIMITS,
  type Sandbox
} from '../../shared/pages/sandbox.ts'
import type { PageTrust } from '../../shared/pages/capabilities.ts'
import { isPageId } from '../../shared/pages/identity.ts'
import type { ComputeResult, PagesService } from './service.ts'
// Everything this file has to get *right* about serving a Page's files lives next door, with no Electron in it, so it
// can be tested. What is left here is the part that can only be done by talking to the browser engine.
import { PAGE_SCHEME, headersFor, mediaTypeFor, originForPage, resolveWithin, safeUrl } from './serving.ts'

export { PAGE_SCHEME, PAGE_SCHEME_PRIVILEGES, originForPage } from './serving.ts'

/** The channel a Page's bridge talks on. One channel for everything, so there is one place to check. */
export const PAGE_CHANNEL = 'orbis-page:request'
export const PAGE_REPLY_CHANNEL = 'orbis-page:reply'
export const PAGE_READY_CHANNEL = 'orbis-page:ready'

export interface HostedPage {
  sandbox: Sandbox
  view: WebContentsView
  root: string
}

export interface PageHostOptions {
  service: PagesService
  /** Where a Page's files live on disk, by page id. */
  rootFor(pageId: string): string
  profileId(): Promise<string>
  trustFor(pageId: string): Promise<PageTrust>
  grantedFor(pageId: string): Promise<string[]>
  networkOriginsFor?(pageId: string): Promise<string[]>
  developerMode?(): boolean
  now?(): number
}

/**
 * The Pages host.
 *
 * Holds one box per open Page, brokers everything between them and the service, and tears a Page down when it misbehaves.
 */
export class PageHost {
  private readonly o: PageHostOptions
  private readonly open = new Map<string, HostedPage>()
  /** Which page id owns which `WebContents`, so a message's sender proves its identity. */
  private readonly owner = new WeakMap<WebContents, string>()
  private listening = false
  /** The region of the window Pages are shown in, as the renderer last measured it. */
  private area: { x: number; y: number; width: number; height: number } | null = null

  constructor(options: PageHostOptions) {
    this.o = options
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  /**
   * The protocol handler for a session.
   *
   * Registered per session so a Page in one profile cannot read another profile's files even if it somehow guessed a
   * page id: the root comes from this host, and this host belongs to one profile.
   */
  registerProtocol(target: Session = session.defaultSession): void {
    target.protocol.handle(PAGE_SCHEME, async (request) => {
      const url = new URL(request.url)
      const pageId = url.hostname
      if (!isPageId(pageId)) return new Response('Not found', { status: 404 })
      const hosted = this.open.get(pageId)
      if (!hosted) return new Response('Not found', { status: 404 })

      // Only ever GET. A Page's own files are not something anything should be posting to.
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

      const path = resolveWithin(hosted.root, url.pathname)
      if (path === null) {
        this.fault(pageId, 'policy-violation', `A request for "${url.pathname}" would have read outside the Page's own files.`)
        return new Response('Forbidden', { status: 403 })
      }

      let body: Buffer
      try {
        body = await readFile(path)
      } catch {
        return new Response('Not found', { status: 404 })
      }

      return new Response(new Uint8Array(body), {
        status: 200,
        headers: headersFor(hosted.sandbox.content.header, mediaTypeFor(path))
      })
    })
  }

  /**
   * Where in the window a Page is shown, as the window itself measures it.
   *
   * The renderer owns the layout, so it is the only thing that knows where the Page area actually is -- and it moves
   * when a sidebar opens, when the window resizes, when the zoom changes. Kept here and applied to every open Page,
   * so a Page opened later lands in the right place without the renderer having to say it again.
   */
  place(area: { x: number; y: number; width: number; height: number } | null): void {
    this.area = area
    for (const hosted of this.open.values()) {
      if (area === null || area.width < 1 || area.height < 1) {
        // Zero-sized rather than hidden: a Page that is not on screen should stop painting, and a view with no area does.
        hosted.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
        continue
      }
      hosted.view.setBounds({ x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) })
    }
  }

  /** The one channel Pages talk on, listened to once. */
  listen(): void {
    if (this.listening) return
    this.listening = true

    ipcMain.on(PAGE_READY_CHANNEL, (event) => {
      const pageId = this.owner.get(event.sender)
      if (pageId === undefined) return
      const hosted = this.open.get(pageId)
      if (!hosted) return
      this.open.set(pageId, { ...hosted, sandbox: markReady(hosted.sandbox) })
    })

    ipcMain.on(PAGE_CHANNEL, (event, raw: unknown) => {
      // The identity comes from which `WebContents` sent this, never from the message. A Page has no way to claim to be
      // another one, because there is nowhere in a message to put a claim.
      const pageId = this.owner.get(event.sender)
      if (pageId === undefined) return
      void this.handle(pageId, event.sender, raw)
    })
  }

  private async handle(pageId: string, sender: WebContents, raw: unknown): Promise<void> {
    const hosted = this.open.get(pageId)
    if (!hosted) return

    const admitted = admit(hosted.sandbox, raw, KNOWN, this.now())
    if (isMessageProblem(admitted)) {
      // The Page gets its own correlation id back where it sent a usable one, so a refusal lands on the right promise.
      const id = typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : null
      this.reply(sender, { id, ok: false, error: admitted.error, message: admitted.message })
      if (admitted.error === 'rate-limited') {
        this.open.set(pageId, {
          ...hosted,
          sandbox: recordFault(hosted.sandbox, { kind: 'over-budget', detail: admitted.message }, this.now())
        })
      }
      return
    }

    this.open.set(pageId, { ...hosted, sandbox: admitted.sandbox })
    const { request } = admitted

    let result: ComputeResult
    try {
      const profileId = await this.o.profileId()
      result = await Promise.race([
        this.o.service.run(profileId, {
          pageId,
          operation: request.operation,
          input: (request.payload ?? {}) as Record<string, unknown>
        }),
        new Promise<ComputeResult>((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: false,
                operation: request.operation,
                error: 'timed-out',
                message: `That took longer than the ${SANDBOX_LIMITS.operationMs / 1000} seconds one request is allowed.`
              }),
            SANDBOX_LIMITS.operationMs
          )
        )
      ])
    } catch {
      result = { ok: false, operation: request.operation, error: 'failed', message: 'That did not work.' }
    }

    const after = this.open.get(pageId)
    if (after) this.open.set(pageId, { ...after, sandbox: settle(after.sandbox, request.id) })
    this.reply(sender, { id: request.id, ...result })
  }

  private reply(sender: WebContents, payload: Record<string, unknown>): void {
    if (sender.isDestroyed()) return
    sender.send(PAGE_REPLY_CHANNEL, payload)
  }

  /**
   * A Page opened in its own box.
   *
   * The settings are taken from the sandbox policy rather than written here, and the view is only built once
   * `createSandbox` has checked them. A frame built from settings that failed the check would be a frame nothing
   * protects.
   */
  async openPage(window: BrowserWindow, pageId: string): Promise<HostedPage | { error: string; message: string }> {
    const existing = this.open.get(pageId)
    if (existing) return existing

    const made = createSandbox({
      pageId,
      profileId: await this.o.profileId(),
      trust: await this.o.trustFor(pageId),
      granted: await this.o.grantedFor(pageId),
      selfOrigin: originForPage(pageId),
      networkOrigins: (await this.o.networkOriginsFor?.(pageId)) ?? [],
      developerMode: this.o.developerMode?.() ?? false,
      now: this.now()
    })
    if (isSandboxProblem(made)) return { error: made.error, message: made.message }

    const view = new WebContentsView({
      webPreferences: {
        // Straight from the policy. Written as separate lines rather than spread so that every one of them is visible
        // here: this is the list somebody will read when they want to know what a Page can do.
        nodeIntegration: made.policy.nodeIntegration,
        contextIsolation: made.policy.contextIsolation,
        sandbox: made.policy.sandbox,
        webSecurity: made.policy.webSecurity,
        preload: join(app.getAppPath(), 'out', 'preload', 'page.js'),
        // Off regardless: a Page that can read the clipboard by calling a DOM method has gone round the capability check.
        spellcheck: false,
        devTools: made.policy.allowDevTools,
        // No shared process between Pages, so one crashing or looping cannot reach another.
        partition: `page-${pageId}`,
        backgroundThrottling: true,
        webviewTag: false,
        nodeIntegrationInSubFrames: false,
        enableWebSQL: false
      }
    })

    const contents = view.webContents
    this.owner.set(contents, pageId)
    const hosted: HostedPage = { sandbox: made, view, root: this.o.rootFor(pageId) }
    this.open.set(pageId, hosted)

    this.applyEventPolicy(pageId, contents)
    this.registerProtocol(contents.session)
    this.listen()

    window.contentView.addChildView(view)
    /*
     * Somewhere to be, before anything is loaded.
     *
     * A child view added without bounds is zero by zero: the Page loads, runs, and is invisible -- which looks exactly
     * like a Page that failed. The window's own size is the honest default until the part of the window that shows
     * Pages measures itself and says where it is (`place`).
     */
    const whole = window.getContentBounds()
    view.setBounds(this.area ?? { x: 0, y: 0, width: whole.width, height: whole.height })
    await contents.loadURL(`${originForPage(pageId)}/index.html`)

    // A Page that never says it is ready is a Page whose code failed before it ran, and it is stopped rather than left
    // sitting there looking like it is about to work.
    setTimeout(() => {
      const current = this.open.get(pageId)
      if (current && current.sandbox.state === 'starting') {
        this.stop(pageId, 'startup-timeout', 'This Page did not finish starting, which usually means its code failed before it ran.')
      }
    }, SANDBOX_LIMITS.startupMs)

    return hosted
  }

  /**
   * The refusals a content policy cannot make.
   *
   * A CSP governs what a document loads. It says nothing about `window.open`, about a permission prompt, about a
   * download, or about the frame navigating itself somewhere else -- so each of those is refused here, at the point
   * Chromium asks. Every one of them is a way out of the box that the policy header alone leaves open.
   */
  private applyEventPolicy(pageId: string, contents: WebContents): void {
    // A Page is one document. It does not browse.
    contents.on('will-navigate', (event, url) => {
      if (url.startsWith(`${originForPage(pageId)}/`)) return
      event.preventDefault()
      this.fault(pageId, 'policy-violation', `This Page tried to navigate to ${safeUrl(url)}, which a Page cannot do.`)
    })
    contents.on('will-redirect', (event) => event.preventDefault())

    // Nor does it open windows.
    contents.setWindowOpenHandler(({ url }) => {
      this.fault(pageId, 'policy-violation', `This Page tried to open a window at ${safeUrl(url)}, which a Page cannot do.`)
      return { action: 'deny' }
    })

    // Camera, microphone, location and the rest go through the capability system or not at all. A DOM prompt would be a
    // second way to ask, and a second way to ask is a way round the first.
    contents.session.setPermissionRequestHandler((_contents, permission, callback) => {
      this.fault(pageId, 'policy-violation', `This Page asked the browser directly for "${permission}". Pages ask Orbis, which asks you.`)
      callback(false)
    })
    contents.session.setPermissionCheckHandler(() => false)
    contents.session.setDevicePermissionHandler(() => false)

    // Nothing a Page does writes a file. Exports go through `files.export`, which is a capability with a prompt.
    contents.session.on('will-download', (event) => {
      event.preventDefault()
      this.fault(pageId, 'policy-violation', 'This Page tried to download a file. Exports go through Orbis so you can see what is being saved.')
    })

    contents.on('render-process-gone', (_event, details) => {
      this.stop(pageId, 'crashed', `This Page stopped running (${details.reason}).`)
    })
    contents.on('unresponsive', () => {
      this.fault(pageId, 'operation-timeout', 'This Page has stopped responding.')
    })
  }

  private fault(pageId: string, kind: 'policy-violation' | 'operation-timeout' | 'over-budget', detail: string): void {
    const hosted = this.open.get(pageId)
    if (!hosted) return
    this.open.set(pageId, { ...hosted, sandbox: recordFault(hosted.sandbox, { kind, detail }, this.now()) })
  }

  /** A Page stopped. A stopped box never restarts; opening the Page again builds a new one. */
  stop(pageId: string, kind: 'startup-timeout' | 'crashed' | 'policy-violation' = 'crashed', detail = 'This Page was stopped.'): void {
    const hosted = this.open.get(pageId)
    if (!hosted) return
    const stopped = stopSandbox(hosted.sandbox, { kind, detail }, this.now())
    this.open.set(pageId, { ...hosted, sandbox: stopped })
    if (!hosted.view.webContents.isDestroyed()) hosted.view.webContents.close()
  }

  /**
   * A Page closed and forgotten.
   *
   * Without recording a fault, which it used to: closing went through `stop` as a crash, so a Page somebody shut on
   * purpose appeared in its own health as having fallen over. The record is read when deciding whether a Page is
   * trustworthy, and a person's decision is not evidence about the Page.
   */
  close(pageId: string): boolean {
    const hosted = this.open.get(pageId)
    if (!hosted) return false
    if (!hosted.view.webContents.isDestroyed()) hosted.view.webContents.close()
    this.open.delete(pageId)
    return true
  }

  health(pageId: string): ReturnType<typeof sandboxHealth> | null {
    const hosted = this.open.get(pageId)
    return hosted ? sandboxHealth(hosted.sandbox, this.now()) : null
  }

  /** Every open Page and how it is doing, for the diagnostics panel. */
  everything(): { pageId: string; health: ReturnType<typeof sandboxHealth> }[] {
    return [...this.open.entries()].map(([pageId, hosted]) => ({
      pageId,
      health: sandboxHealth(hosted.sandbox, this.now())
    }))
  }
}

/** Filled by `setKnownOperations` at start, so the host and the service cannot disagree about what exists. */
let KNOWN: ReadonlySet<string> = new Set()

export function setKnownOperations(operations: Iterable<string>): void {
  KNOWN = new Set(operations)
}
