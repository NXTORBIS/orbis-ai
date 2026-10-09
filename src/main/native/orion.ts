import {
  appIntentInstructions,
  appIntentUser,
  mightWantAnApp,
  readAppIntent,
  sayCannot,
  sayOpened,
  type AppIntent,
  type OpenApp
} from '../../shared/native/intent.ts'
import type { ChatNativeApp } from '../../shared/native/chat.ts'
import { readLabRequest, valuesFor } from '../../shared/native/labRequest.ts'
import type { Native } from './service.ts'

/**
 * Orion opening a Native App.
 *
 * ## The whole flow, and where each decision is made
 *
 * ```
 * message
 *    ↓  mightWantAnApp          cheap, here-ish: spares the model call for plain conversation
 *    ↓  askQuick                a model, shown the catalogue and what is already open
 *    ↓  readAppIntent           field by field; an invented capability becomes "none"
 *    ↓  native.openApp          the registry resolves the capability, or refuses
 *    ↓  parameters.setAll       units and ranges checked; a bad value refuses the whole open
 *    ↓  a reference on the reply
 * ```
 *
 * Only the model step is a judgement. Everything after it is a check, and every check can say no.
 *
 * ## It never describes what the app shows
 *
 * `sayOpened` is one short sentence. Orion has not looked at the simulation and a sentence about a trajectory it has
 * not seen is exactly the invention this platform is built to avoid — the app is on screen, where the person can see
 * it far better than any description.
 *
 * ## Nothing opens when nothing fits
 *
 * A capability no app provides comes back as a refusal with a sentence, and Orion answers the question normally. That
 * is the correct outcome far more often than opening something approximately right.
 */

export interface NativeOrionDeps {
  native: Native
  /** The same quick-question route the Creation Engine uses. One model path, not two. */
  askQuick(instructions: string, user: string, signal?: AbortSignal): Promise<{ json: Record<string, unknown> } | { failed: string }>
}

export interface Turn {
  message: string
  conversationId: string | null
  messageId: string | null
  history: readonly { role: 'user' | 'assistant'; content: string }[]
  signal?: AbortSignal
}

export interface Outcome {
  /** Attached to the reply. Empty when nothing was opened. */
  apps: readonly ChatNativeApp[]
  /** A sentence for Orion to say, or null when it should simply answer. */
  says: string | null
  /** True when something was opened or changed, so the caller knows the reply is about an app. */
  acted: boolean
}

const NOTHING: Outcome = Object.freeze({ apps: Object.freeze([]), says: null, acted: false })

export class NativeOrion {
  private readonly o: NativeOrionDeps

  constructor(deps: NativeOrionDeps) {
    this.o = deps
  }

  /**
   * Whether this message wants an app, decided and then carried out.
   *
   * Returns `NOTHING` for everything that is not plainly a request, including every failure: a model that could not be
   * reached, an answer that did not parse, a capability nothing provides. In each of those Orion answers normally,
   * which is the behaviour somebody would expect anyway.
   */
  async consider(turn: Turn): Promise<Outcome> {
    const message = turn.message.trim()
    if (!message) return NOTHING

    /*
     * A message that names one of the laboratories' own topics opens it, with no model involved.
     *
     * The topic names are a list Orbis holds. Matching against a list is not a judgement, and asking a model to
     * do it only adds a way to get it wrong -- which is what happened: "open collision of two objects" came back
     * as something to look up, and Orbis opened the browser instead of the simulation it already had.
     *
     * It is also faster, and it works with no key set at all.
     */
    const named = readLabRequest(message)
    if (named) {
      const straight = await this.openNamed(named, turn)
      if (straight) return straight
      // It could not be opened. Fall through rather than giving up: the model may place it somewhere else.
    }

    if (!mightWantAnApp(message)) return NOTHING

    const [offered, open] = await Promise.all([this.o.native.offerToOrion(), Promise.resolve(this.openHere(turn.conversationId))])
    if (offered.length === 0) return NOTHING
    if (turn.signal?.aborted) return NOTHING

    const answer = await this.o.askQuick(appIntentInstructions(), appIntentUser(offered, open, turn.history), turn.signal)
    if (turn.signal?.aborted) return NOTHING
    if ('failed' in answer) {
      // No model could be asked. Nothing is opened on a guess: unlike making a file, opening an app takes over half
      // the screen, so the plain-request fallback the Creation Engine has would be the wrong trade here.
      console.warn(`[native] the quick question about a chat message could not be asked: ${answer.failed}`)
      return NOTHING
    }

    const intent = readAppIntent(answer.json, offered, open)
    if (intent.act === 'none') return NOTHING

    return intent.act === 'configure' ? this.carryOutConfigure(intent) : this.carryOutOpen(intent, turn)
  }

  /**
   * Opens the laboratory a message named, with the values it asked for.
   *
   * Returns null when it could not be opened, so the caller can still ask the model. A refusal from the studio
   * itself -- a speed outside its range, a control it has not got -- is reported rather than swallowed, because
   * the person said it and can correct it.
   */
  private async openNamed(
    named: ReturnType<typeof readLabRequest> & object,
    turn: Turn
  ): Promise<Outcome | null> {
    const made = await this.o.native.openApp({
      appId: named.app,
      conversationId: turn.conversationId,
      messageId: turn.messageId,
      configure: valuesFor(named)
    })
    if (!('instance' in made)) return null

    if (made.reused) return { apps: [], says: made.says, acted: true }

    return {
      apps: [
        {
          appId: made.instance.appId,
          instanceId: made.instance.id,
          act: 'opened',
          appVersion: made.instance.appVersion,
          did: made.applied.map((id) => `${id} ${made.instance.described[id] ?? ''}`.trim()),
          openedAt: made.instance.size
        }
      ],
      says: sayOpened(
        made.instance.appName,
        made.applied.map((id) => `${id} to ${made.instance.described[id] ?? ''}`.trim())
      ),
      acted: true
    }
  }

  private openHere(conversationId: string | null): readonly OpenApp[] {
    if (!conversationId) return []
    return this.o.native
      .conversation(conversationId)
      .filter((one) => one.phase !== 'closed')
      .map((one) => ({ instanceId: one.id, name: one.appName, settings: one.shown }))
  }

  private async carryOutOpen(intent: AppIntent, turn: Turn): Promise<Outcome> {
    const made = await this.o.native.openApp({
      capability: intent.capability ?? undefined,
      conversationId: turn.conversationId,
      messageId: turn.messageId,
      configure: intent.values
    })

    if (!('instance' in made)) {
      /*
       * It could not be opened, and why matters.
       *
       * A capability nothing provides is said plainly and Orion carries on answering. A value that was refused — a
       * gravity given as a mass, an angle of four hundred degrees — is worth repeating, because the person said it and
       * can correct it.
       */
      const refused = made.warnings && made.warnings.length > 0 ? ` ${made.warnings[0]}` : ''
      return {
        apps: [],
        says: made.failure?.error === 'unknown-app' ? sayCannot(intent.request) : `${made.says}${refused}`,
        acted: false
      }
    }

    if (made.reused) {
      // Already open here. Said, rather than silently adding a second identical card.
      return { apps: [], says: made.says, acted: true }
    }

    return {
      apps: [
        {
          appId: made.instance.appId,
          instanceId: made.instance.id,
          act: 'opened',
          appVersion: made.instance.appVersion,
          // What was actually applied, which is not always what was asked for.
          did: made.applied.map((id) => `${id} ${made.instance.described[id] ?? ''}`.trim()),
          openedAt: made.instance.size
        }
      ],
      says: sayOpened(made.instance.appName, made.applied.map((id) => `${id} to ${made.instance.described[id] ?? ''}`.trim())),
      acted: true
    }
  }

  private async carryOutConfigure(intent: AppIntent): Promise<Outcome> {
    if (!intent.instanceId || Object.keys(intent.values).length === 0) return NOTHING

    const made = await this.o.native.configure(intent.instanceId, intent.values)
    if ('ok' in made) {
      const refused = made.warnings && made.warnings.length > 0 ? made.warnings[0] : made.says
      return { apps: [], says: refused, acted: false }
    }
    if (made.changed.length === 0) return { apps: [], says: 'Those were already the values.', acted: true }

    const said = made.changed.map((id) => `${id} to ${made.instance.described[id] ?? ''}`.trim())
    return { apps: [], says: `Set ${said.join(' and ')} in ${made.instance.appName}.`, acted: true }
  }
}
