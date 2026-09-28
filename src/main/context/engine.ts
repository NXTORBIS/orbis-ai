import { assemble, describe, render } from '../../shared/contextEngine.ts'
import type { Assembled, ContextBudget, ContextGap, ContextItem, ContextKind } from '../../shared/contextEngine.ts'
import { asFailure } from '../../shared/orbisError.ts'

/**
 * Gathering what Orbis knows, from the things that really know it.
 *
 * The rules about what context is worth sending live in src/shared/contextEngine.ts and touch nothing. This is the
 * other half: the part that talks to the Browser Control Layer, the stores on disk and the event bus, and turns what
 * they say into items those rules can weigh.
 *
 * Splitting it this way is what makes the rules testable at all -- and it means a new source of context is a provider
 * added to a list, rather than another place that decides for itself how much of a page is too much.
 *
 * Three things this does that a plain `Promise.all` over the sources would not:
 *
 *   - **A provider that fails becomes a gap, not a silence.** If the page cannot be read, the model is told the page
 *     could not be read. The alternative is an answer written as though the page had been read and found blank, which
 *     is the most expensive kind of wrong.
 *   - **A provider that hangs does not hang the answer.** Reading a page goes over a debugging pipe to a renderer that
 *     may be busy or paused. There is a deadline, and passing it is a gap like any other failure.
 *   - **Providers cannot see each other.** They run together and independently, so none can come to depend on another
 *     having run first, and the order they are listed in cannot change an answer.
 */

export interface ContextRequest {
  /** What the person asked, which is what relevance is judged against. */
  text: string
  /** Whose context this is. A provider that cannot name the profile returns nothing rather than another profile's. */
  profileId?: string
  /** Where the work is happening, when that is known. */
  workspaceId?: string
  /** How much of the model's window this may use. */
  budget?: ContextBudget
  /** Longest wait for any one source. */
  deadlineMs?: number
}

export interface ContextProvider {
  /** For the gap message and for logs, so a failure names the thing that failed. */
  name: string
  /** What it provides. Used only to describe a failure; the items say their own kinds. */
  kind: ContextKind
  gather(request: ContextRequest, signal: AbortSignal): Promise<ContextItem[]>
}

/**
 * Long enough for a page read over the debugging pipe on a busy renderer; short enough that nobody waits on a source
 * that is never going to answer. Reading is not the slow part of answering, and must not become it.
 */
export const DEFAULT_DEADLINE_MS = 2500

/** One provider's result: what it found, or why it did not. */
type Outcome = { items: ContextItem[] } | { gap: ContextGap }

/** Thrown by the deadline rather than by the provider, so the two are told apart in the gap that results. */
class Overdue extends Error {}

/**
 * Runs one provider under a deadline, and turns anything going wrong into a gap.
 *
 * The deadline is a **race**, not merely a signal. Sending an abort and awaiting the provider anyway would only work
 * for providers that bother to check it -- and one that does not would hang the whole answer forever, which is the
 * failure this deadline exists to prevent. So the signal is sent, so a cooperative provider stops doing pointless work,
 * and the race is what actually guarantees an answer arrives.
 *
 * A provider abandoned this way may still be running. That is accepted: it holds no lock and its result is discarded,
 * which is a better outcome than the person waiting on it.
 */
async function runOne(provider: ContextProvider, request: ContextRequest, outerSignal: AbortSignal | undefined, deadlineMs: number): Promise<Outcome> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  outerSignal?.addEventListener('abort', onAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const items = await Promise.race([
      provider.gather(request, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Overdue(`${provider.name} did not answer within ${deadlineMs}ms`))
        }, deadlineMs)
      })
    ])
    return { items: Array.isArray(items) ? items.filter((i): i is ContextItem => Boolean(i) && typeof i.text === 'string' && i.text.length > 0) : [] }
  } catch (error) {
    // The taxonomy is used here so a gap reads the same whether the browser refused, the disk failed or time ran out.
    const failure = asFailure(error, provider.name)
    const why =
      error instanceof Overdue
        ? `${provider.name} did not answer in time, so it is not part of this.`
        : `${provider.name} could not be read: ${failure.message}`
    return { gap: { kind: provider.kind, why } }
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onAbort)
  }
}

export interface ContextResult extends Assembled {
  /** Ready to put in front of a question. Empty when there was nothing worth saying. */
  text: string
  /** A few words for the person, so what was used about them is visible rather than implied. */
  summary: string
}

/**
 * Everything relevant that Orbis knows, ready for a model.
 *
 * `providers` is a list rather than a fixed set because what Orbis knows depends on where it is running. The helper
 * serving pages has a browser and no task store; the Orbis window has the stores and may have no browser. Each passes
 * what it has, and nothing pretends to a source it does not have.
 */
export async function gatherContext(
  request: ContextRequest,
  providers: ContextProvider[],
  options: { signal?: AbortSignal; now?: number } = {}
): Promise<ContextResult> {
  const deadline = request.deadlineMs ?? DEFAULT_DEADLINE_MS
  const outcomes = await Promise.all(providers.map((provider) => runOne(provider, request, options.signal, deadline)))

  const items: ContextItem[] = []
  const gaps: ContextGap[] = []
  for (const outcome of outcomes) {
    if ('gap' in outcome) gaps.push(outcome.gap)
    else items.push(...outcome.items)
  }

  const assembled = assemble(request.text, items, {
    ...(request.budget ? { budget: request.budget } : {}),
    gaps,
    ...(options.now !== undefined ? { now: options.now } : {})
  })

  return { ...assembled, text: render(assembled), summary: describe(assembled) }
}
