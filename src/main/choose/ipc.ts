import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import { cleanChange, type Change } from '../../shared/choose/update.ts'
import type { Detail } from '../../shared/choose/detect.ts'
import type { DecisionSort } from '../../shared/choose/types.ts'
import type { Choose } from './service.ts'

/**
 * What the window may ask Orbis Choose.
 *
 * One channel with an operation name, the same shape Courses, Student, Music and Ambient Intelligence use. The
 * handler checks the sender, coerces what arrived, and hands it on; every decision about what a decision *is* lives
 * in the service and the shared engine, where there are tests around it.
 *
 * ## Nothing is trusted on the way in
 *
 * A change from a control on the card goes through the same coercion as one Orion wrote, because a control that
 * could write a value no sentence could is a second way into the decision with its own rules -- and it would be
 * the one with no checks on it.
 *
 * ## The window never names a channel
 *
 * `src/preload/index.ts` turns these operations into named methods, as everywhere else in Orbis. The renderer
 * calls `window.api.choose('start', ...)` and does not know this file exists.
 */

export interface ChooseIpcOptions {
  choose: Choose
  getWindow(): BrowserWindow | null
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const words = (value: unknown, most: number): string => (typeof value === 'string' ? value.slice(0, most) : '')
const flag = (value: unknown): boolean => value === true

const SORTS: readonly DecisionSort[] = ['buying', 'what-to-build-first', 'learning', 'time', 'technical', 'high-stakes', 'other']
const DETAILS: readonly Detail[] = ['everything', 'why-not', 'how-it-worked', 'what-would-change-it']

export function registerChooseIpc(o: ChooseIpcOptions): void {
  const handle = plainHandle(o)

  handle('choose:do', async (_event, operation, payload) => {
    const what = words(operation, 30)
    const asked = object(payload)
    const conversationId = words(asked.conversationId, 80)
    const message = words(asked.message, 4000)
    /* A card says which comparison it is, so its buttons work on that one and not on whichever is most recent. */
    const decisionId = words(asked.decisionId, 80)
    const onThisOne = decisionId === '' ? {} : { decisionId }

    switch (what) {
      case 'start': {
        if (conversationId === '') return { problem: 'There is no conversation to work in.', fix: 'Start a message first.', failed: 'no conversation' }
        return o.choose.start({
          conversationId,
          message,
          said: words(asked.said, 12_000),
          before: list(asked.before).map((one) => words(one, 2000)).filter((one) => one.trim() !== '').slice(-8),
          sort: (typeof asked.sort === 'string' && (SORTS as readonly string[]).includes(asked.sort) ? asked.sort : 'other') as DecisionSort,
          named: list(asked.named).map((one) => words(one, 70)).filter((one) => one.trim() !== '').slice(0, 6),
          ...(flag(asked.justDecide) ? { justDecide: true } : {})
        })
      }

      case 'change':
        return o.choose.change({ conversationId, message })

      case 'what-if':
        return o.choose.whatIf({ conversationId, message })

      case 'adjust': {
        /*
         * Up to eight at once, because a control may be two changes -- "make reliability the most important" moves
         * one importance and is one change, but a reset is several -- and a list of hundreds is not a control.
         */
        const changes = list(asked.changes)
          .slice(0, 8)
          .map((one) => cleanChange(one))
          .filter((one): one is Change => one !== null)
        return o.choose.adjust({ conversationId, ...onThisOne, changes })
      }

      case 'explain': {
        const of = (typeof asked.of === 'string' && (DETAILS as readonly string[]).includes(asked.of) ? asked.of : 'everything') as Detail
        return o.choose.explain({ conversationId, ...onThisOne, of, message })
      }

      case 'just-decide':
        return o.choose.justDecide({ conversationId, message })

      case 'keep':
        return o.choose.keep({ conversationId, ...onThisOne })

      case 'kept':
        return o.choose.kept()

      case 'reopen':
        return o.choose.reopen({ decisionId: words(asked.decisionId, 80), conversationId, message })

      case 'forget':
        return o.choose.forget({ decisionId: words(asked.decisionId, 80) })

      case 'sketch':
        return o.choose.sketch(conversationId)

      default:
        return { problem: 'Orbis does not know how to do that.', fix: '', failed: `unknown operation ${what}` }
    }
  })
}
