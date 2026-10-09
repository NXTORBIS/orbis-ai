import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * What the browser may ask Orbis Student.
 *
 * ## Why this is a short list
 *
 * The student is in the browser when they are reading, so the useful things from here are: what is happening (am I
 * in a session, how long is left), keep this (a card, a mistake, a page), and start or stop. Everything else —
 * the mastery map, the plan, the reports — is reading and deciding, and that belongs on a screen with room for it.
 *
 * ## What is deliberately not here
 *
 * - **Nothing that reads the learning record.** A page can ask whether a session is running, not what the student
 *   is weak at. Learning history must not be reachable from a web page's process, and the smallest list is the
 *   only reliable way to guarantee that.
 * - **Nothing that weakens a policy.** There is no "allow this site" here. A session's rules are snapshotted when
 *   it starts and a browser surface may not loosen them, or the shield would be advice rather than enforcement.
 * - **No XP, no quests, no streaks.** Saving a card from a page is worth exactly what it is worth, and paying for
 *   it from the browser would make clipping pages the cheapest way to a level.
 *
 * ## Ending a session, though, is here
 *
 * Because the one rule above all the others is that Focus must never be impossible to leave. The student may be
 * mid-page with the Orbis window somewhere behind twelve others, and the way out has to be where they are.
 */

export interface StudentHelperDeps {
  /** What is happening, in the little a page is allowed to know. */
  state(): Promise<{
    running: boolean
    title: string
    subject: string | null
    level: 'light' | 'focus' | 'deep'
    minutesLeft: number | null
    paused: boolean
    locked: boolean
  }>
  /** A card, from something the student selected. */
  saveCard(front: string, back: string, subject: string | null): Promise<{ ok: boolean; why?: string }>
  /** A mistake, from something they got wrong on a page. */
  saveMistake(concept: string, detail: string, subject: string | null): Promise<{ ok: boolean; why?: string }>
  /** A page, into the study library. */
  saveResource(url: string, title: string, subject: string | null): Promise<{ ok: boolean; why?: string; duplicate?: boolean }>
  /** Start a session from where the student already is. */
  start(minutes: number | null, subject: string | null): Promise<{ ok: boolean; why?: string }>
  /** Leave one. Always available, by design. */
  end(): Promise<{ ok: boolean; why?: string }>
  /**
   * Cards drafted from what is on the page, for the student to keep or throw away.
   *
   * Drafts only. Nothing is saved from here: the page hands over text, Orion drafts, and the *window* is where
   * somebody ticks them — a browser surface that wrote straight into a deck would be a web page's process putting
   * things into somebody's revision.
   */
  draftFromPage(): Promise<{ ok: boolean; cards: { front: string; back: string }[]; why?: string }>
}

const words = (value: unknown, limit: number, what: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new HelperError('bad-request', what)
  return value.trim().slice(0, limit)
}

const maybeWords = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  return value.trim().slice(0, limit)
}

const address = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  // Only a real page. A `file:` or a `javascript:` address in a study library is a trap waiting for a future click.
  if (!/^https?:\/\//i.test(text) || text.length > 2048) throw new HelperError('bad-request', 'That is not an address Orbis can save.')
  return text
}

const minutes = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(1, Math.min(600, Math.round(n)))
}

export function createStudentHandlers(getDeps: () => StudentHelperDeps | null | undefined): Record<string, Handler> {
  const need = (): StudentHelperDeps => {
    const deps = getDeps()
    if (!deps) throw new HelperError('unavailable', 'Open Orbis to use Student from here.')
    return deps
  }

  const guarded =
    (run: (a: unknown[]) => Promise<unknown> | unknown): Handler =>
    async (a) => {
      try {
        return await run(a)
      } catch (err) {
        if (err instanceof HelperError) throw err
        // Nothing of the original message: it could carry a title, an address or a line of somebody's notes.
        throw new HelperError('failed', 'That did not work.')
      }
    }

  return {
    'student:state': guarded(async () => need().state()),
    'student:saveCard': guarded(async (a) =>
      need().saveCard(words(a[0], 500, 'What goes on the front?'), words(a[1], 2000, 'What goes on the back?'), maybeWords(a[2], 80))
    ),
    'student:saveMistake': guarded(async (a) =>
      need().saveMistake(words(a[0], 200, 'What was it about?'), words(a[1], 2000, 'What went wrong?'), maybeWords(a[2], 80))
    ),
    'student:saveResource': guarded(async (a) => need().saveResource(address(a[0]), maybeWords(a[1], 300) ?? 'Untitled page', maybeWords(a[2], 80))),
    /*
     * Cards from the page in front of the student.
     *
     * Takes nothing. Orbis reads the real tab itself rather than believing text a page handed it -- a page that
     * could post its own text here could put anything it liked into somebody's revision.
     */
    'student:draftFromPage': guarded(async () => need().draftFromPage()),
    'student:startFocus': guarded(async (a) => need().start(minutes(a[0]), maybeWords(a[1], 80))),
    // No arguments, and never refused for being inconvenient. Leaving must always be possible.
    'student:endFocus': guarded(async () => need().end())
  }
}
