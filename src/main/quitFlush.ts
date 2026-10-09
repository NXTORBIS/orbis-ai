/**
 * Saving everything before Orbis closes, and actually waiting for it.
 *
 * Twenty-eight places asked their store to save on the way out and none of them waited:
 * `app.on('before-quit', () => void store.flush())` starts the write and returns, and the process is then free to end
 * in the middle of it. Several of those stores hold work for up to a second and a half before writing it at all, so a
 * note typed just before quitting was routinely lost -- not corrupted, simply never written.
 *
 * This holds the close open instead. The first time quitting is asked for, it is stopped, every save runs, and only
 * then is quitting asked for again -- at which point this stands aside. A save that hangs cannot keep Orbis open for
 * ever: after the time limit the rest are abandoned and closing carries on, because a window that will not close is
 * worse than a file that did not save.
 *
 * Nothing here knows about Electron, so it can be tested without starting an application.
 */

export interface Saving {
  /** What it is, in the words somebody would recognise -- used only when something goes wrong. */
  what: string
  run(): Promise<unknown> | void
}

export interface QuitFlushOptions {
  /** Asks to close again, once everything is saved. */
  quit(): void
  /** How long everything together may take before closing carries on regardless. */
  limitMs?: number
  onProblem?(what: string, err: unknown): void
}

export const QUIT_LIMIT_MS = 5000

export class QuitFlush {
  private readonly jobs: Saving[] = []
  /** True while the saves are running, so a second request to close does not start them again. */
  private saving = false
  /** True once everything has been saved, so the close that follows is let through. */
  private saved = false

  private readonly o: QuitFlushOptions

  constructor(options: QuitFlushOptions) {
    this.o = options
  }

  /** Registers something to save before closing. Added in the order they are built, run all at once. */
  add(what: string, run: () => Promise<unknown> | void): void {
    this.jobs.push({ what, run })
  }

  get count(): number {
    return this.jobs.length
  }

  /**
   * Call from `before-quit`. Returns true when closing must be stopped for now, false when it may go ahead.
   *
   * Three answers, in the order they happen: the first ask is stopped and starts the saving; an ask while saving is
   * stopped too and does nothing; once saved, every ask goes straight through.
   */
  beforeQuit(): boolean {
    if (this.saved) return false
    if (this.saving) return true
    this.saving = true
    void this.runAll().then(() => {
      this.saved = true
      this.o.quit()
    })
    return true
  }

  /** Runs every save at once, waiting no longer than the limit. Exposed so a test can wait for it. */
  async runAll(): Promise<void> {
    const limit = this.o.limitMs ?? QUIT_LIMIT_MS
    const all = Promise.all(
      this.jobs.map(async (job) => {
        try {
          await job.run()
        } catch (err) {
          // One store failing must not stop the others saving, which is why each is caught on its own.
          this.o.onProblem?.(job.what, err)
        }
      })
    )
    let timer: NodeJS.Timeout | undefined
    const giveUp = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.o.onProblem?.('saving everything', new Error(`it took longer than ${limit}ms, so closing carried on`))
        resolve()
      }, limit)
      // Not keeping the process alive on its own account: this timer exists only to stop a hang.
      timer.unref?.()
    })
    await Promise.race([all.then(() => undefined), giveUp])
    if (timer) clearTimeout(timer)
  }

  /** Whether closing is currently being held open. */
  get holding(): boolean {
    return this.saving && !this.saved
  }
}
