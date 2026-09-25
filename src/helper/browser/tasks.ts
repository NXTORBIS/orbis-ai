import { runBrowserAgent } from '../../main/browserAgent.ts'
import type { BrowserAgentOptions } from '../../main/browserAgent.ts'
import type { BrowserConfirmation, StreamEvent } from '../../shared/types'
import { HelperError } from '../server.ts'
import type { Handler } from '../server.ts'
import { PendingApprovals } from './host.ts'
import type { BrowserHost } from './host.ts'

/**
 * Asking Orbis to do something in the browser: "open YouTube", "find the download button and click it", "go back".
 *
 * The work is done by the browser agent Orbis already had -- the same one the chat used -- against the real browser the
 * helper now holds (browser/host.ts). It observes the page, decides a step, asks permission when a step is consequential,
 * acts, and checks that the page really changed. Every step the Orb shows is a step that happened.
 *
 * Nothing about this pretends. If the browser is not open, the task is refused with that reason. If a step fails, the
 * failure is what the agent reports. A task that is stopped is stopped, not quietly finished.
 */

export interface BrowserTaskDeps {
  /** The browser, when there is one. Read at call time: it may close between one task and the next. */
  host(): BrowserHost | null | undefined
  apiKeys: string[]
  fetchFn: typeof fetch
  /** The model to plan with, when the caller does not name one. */
  defaultModel: string
}

const MAX_TASK = 2000

/** One task at a time per helper: two agents driving the same tab would fight over it. */
let running: AbortController | null = null
/** Where further instructions go while a task runs. Null when nothing is running. */
let instructionQueue: string[] | null = null

export function createBrowserTaskHandlers(deps: BrowserTaskDeps): Record<string, Handler> {
  const approvals = new PendingApprovals()

  return {
    /**
     * Runs a task. Streams `step`, `automation`, `confirmation`, `status` and `delta` events as they happen; the
     * request ends when the task does.
     */
    'browser:task': async ([request], { emit, signal }) => {
      const req = (request ?? {}) as { task?: unknown; model?: unknown; mode?: unknown; history?: unknown }
      const task = typeof req.task === 'string' ? req.task.trim().slice(0, MAX_TASK) : ''
      if (!task) throw new HelperError('bad-request', 'Say what Orbis should do.')
      if (deps.apiKeys.length === 0) throw new HelperError('no-key', 'The helper has no Groq API key, so nothing can be planned.')

      const host = deps.host()
      if (!host || !host.alive) {
        throw new HelperError('no-browser', 'The Orbis browser is not open, so there is nothing to act on.')
      }
      if (running && !running.signal.aborted) {
        throw new HelperError('busy', 'Orbis is already working in the browser. Stop that first.')
      }

      // The caller's Stop and the helper's own are the same stop.
      const controller = new AbortController()
      running = controller
      signal.addEventListener('abort', () => controller.abort(), { once: true })

      const mode = req.mode === 'loop' || req.mode === 'game' ? req.mode : 'once'
      const history = Array.isArray(req.history)
        ? req.history
            .filter((m): m is { role: string; content: string } => Boolean(m) && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string')
            .slice(-10)
            .map((m) => ({ role: String(m.role) === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))
        : []

      // Anything else said while the task runs is pushed here; the agent drains it between steps. It must exist
      // even when empty -- the agent reads its length without asking whether it is there.
      const instructions: string[] = []
      instructionQueue = instructions

      // An error the agent reports is an error. It is streamed rather than thrown, so it has to be noticed here,
      // or a task that failed would be answered with ok: true.
      let failure: string | null = null
      const watch = (event: StreamEvent): void => {
        if (event && event.type === 'error') failure = event.message ?? 'The task failed.'
        emit(event)
      }

      try {
        await runBrowserAgent({
          task,
          mode,
          model: typeof req.model === 'string' && req.model ? req.model : deps.defaultModel,
          history,
          apiKeys: deps.apiKeys,
          fetchFn: deps.fetchFn as BrowserAgentOptions['fetchFn'],
          signal: controller.signal,
          emit: watch,
          instructions,
          getTarget: () => {
            const live = deps.host()
            if (!live || !live.alive) throw new Error('The Orbis browser was closed.')
            return live.agent.getTarget()
          },
          findPage: (id: number) => deps.host()?.agent.findPage(id) ?? null,
          control: host.control,
          windowControl: {
            get state() {
              return deps.host()?.agent.windowControl.state ?? null
            }
          },
          // An action that needs permission waits here. The answer comes back on browser:task-answer, because a
          // streamed reply has no way back up; until it does, nothing happens.
          confirm: (confirmation: BrowserConfirmation) => {
            watch({ type: 'confirm', confirmation })
            return approvals.ask(confirmation, controller.signal).then((approved) => {
              watch({ type: 'confirm-done', id: confirmation.id })
              return approved
            })
          }
        } as BrowserAgentOptions)
        if (controller.signal.aborted) return { ok: false, aborted: true, error: null }
        return { ok: failure === null, aborted: false, error: failure }
      } finally {
        if (running === controller) running = null
        if (instructionQueue === instructions) instructionQueue = null
      }
    },

    /**
     * Something else to say while the task runs -- "not that one", "the second result". The agent reads it between
     * steps, so it changes what happens next rather than interrupting what is happening.
     */
    'browser:task-say': ([text]) => {
      const said = typeof text === 'string' ? text.trim().slice(0, MAX_TASK) : ''
      if (!said) throw new HelperError('bad-request', 'Say something.')
      if (!instructionQueue) return { heard: false }
      instructionQueue.push(said)
      return { heard: true }
    },

    /** The person's answer to "may I?". Returns whether anything was actually waiting for it. */
    'browser:task-answer': ([id, approved]) => {
      if (typeof id !== 'string' || !id) throw new HelperError('bad-request', 'That is not an approval.')
      return { answered: approvals.answer(id, approved === true) }
    },

    /** Stops whatever is running. Says plainly when there was nothing to stop. */
    'browser:task-stop': () => {
      if (!running || running.signal.aborted) return { stopped: false }
      running.abort()
      return { stopped: true }
    },

    /** Whether a task could run at all: the Orb asks before offering to. */
    'browser:task-ready': () => {
      const host = deps.host()
      return {
        browser: Boolean(host && host.alive),
        key: deps.apiKeys.length > 0,
        busy: Boolean(running && !running.signal.aborted)
      }
    }
  }
}
