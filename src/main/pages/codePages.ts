import { makePageId } from '../../shared/pages/identity.ts'
import { CodeGeneration } from './codeGeneration.ts'
import type { CodeGenerationOptions } from './codeGeneration.ts'
import { CodeStore } from './codeStore.ts'
import type { PageHost } from './host.ts'

/**
 * Pages written as code, from a sentence to something on the screen.
 *
 * Four things happen and each belongs somewhere else, which is why this file is short: a model writes the parts
 * (`CodeGeneration`), the parts become three files (`filesFor`), the files are written under a profile (`CodeStore`),
 * and the files are served into a sandboxed view (`PageHost`). This is the sequence, and nothing else.
 *
 * A built Page is not a kept Page. Building writes the files and opens them so somebody can look; keeping is a
 * separate decision, because the whole point of showing it is that it might be wrong. Nothing here registers a Page
 * in the library.
 */

export interface CodePagesOptions extends CodeGenerationOptions {
  host: PageHost
  store: CodeStore
  /** Page ids, from the same source the rest of Pages uses, so a code Page's id is not a different kind of thing. */
  random(): string
}

export interface CodeBuildResult {
  ok: boolean
  pageId?: string
  title?: string
  purpose?: string
  notes?: readonly string[]
  /** Everything that was wrong, when nothing could be built. */
  problems?: string[]
  /** What each attempt said, so a failure can be read rather than guessed at. */
  attempts?: { said: string; problems: string[] }[]
  reason?: string
  message?: string
}

export class CodePages {
  private readonly o: CodePagesOptions
  private readonly generation: CodeGeneration
  /** What was built this session, so opening one does not have to find it on disk and guess whether it is current. */
  private readonly built = new Map<string, { title: string; purpose: string }>()

  constructor(options: CodePagesOptions) {
    this.o = options
    this.generation = new CodeGeneration(options)
  }

  /** Builds a Page for a request and writes its files. It is not open and not kept; both are separate. */
  async build(request: string): Promise<CodeBuildResult> {
    const outcome = await this.generation.build(request)
    if (!outcome.files || !outcome.spec) {
      return {
        ok: false,
        reason: 'not-built',
        message: 'This could not be written as a Page.',
        problems: outcome.problems.map((p) => p.message),
        attempts: outcome.attempts
      }
    }

    /*
     * The same kind of id as every other Page.
     *
     * Invented as `code_...` at first, and the host refused it -- correctly: a Page id has one shape, checked wherever
     * one arrives from outside, and a second shape would mean every check had to learn about a second shape. A code
     * Page is a Page.
     */
    const pageId = makePageId(this.o.random())
    await this.o.store.write(pageId, outcome.files)
    this.built.set(pageId, { title: outcome.spec.title, purpose: outcome.spec.purpose })

    return {
      ok: true,
      pageId,
      title: outcome.spec.title,
      purpose: outcome.spec.purpose,
      notes: outcome.spec.notes,
      // Warnings survive: a Page that works and forgot to say what it approximates is still worth saying so about.
      problems: outcome.problems.map((p) => p.message)
    }
  }

  /**
   * Opens a built Page in the sandbox. The host decides whether it is allowed to run; this only asks.
   *
   * The window's type is taken from the host rather than imported from Electron. This file forwards a window and
   * never touches one, and naming Electron here would make a file that has no business knowing which engine Orbis
   * runs on depend on it -- which is exactly what the portability guard exists to catch.
   */
  async open(window: Parameters<PageHost['openPage']>[0], pageId: string): Promise<{ ok: boolean; error?: string; message?: string; health?: unknown }> {
    if (!this.built.has(pageId)) {
      /*
       * Only a Page built in this session, deliberately.
       *
       * Files on disk from an older run may have been written by a different version of the shell, and a Page is
       * cheap to build again. Opening whatever happens to be in a folder is how a stale Page comes back looking
       * current.
       */
      return { ok: false, error: 'not-built', message: 'That Page was not built in this session. Build it again.' }
    }
    const opened = await this.o.host.openPage(window, pageId)
    if ('error' in opened) return { ok: false, error: opened.error, message: opened.message }
    /*
     * How the Page is doing, returned with the open.
     *
     * The host stops a Page that never calls `ready()`, so "it opened" and "its code ran" are different facts and the
     * second is the one worth knowing. Without this the only way to tell them apart was to wait and see whether the
     * Page was still there, which is evidence nobody can read.
     */
    return { ok: true, health: this.o.host.health(pageId) }
  }

  /** Closes a Page. A close is not a fault, and the host records it as neither. */
  close(pageId: string): boolean {
    return this.o.host.close(pageId)
  }

  /** How a Page is doing now, which is a different answer from the one `open` gave. */
  health(pageId: string): unknown {
    return this.o.host.health(pageId)
  }

  /** Where in the window Pages are shown. Passed straight through: the host applies it to every open Page. */
  place(area: { x: number; y: number; width: number; height: number } | null): void {
    this.o.host.place(area)
  }
}
