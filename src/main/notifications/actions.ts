import type { OrbisNotification } from '../../shared/notifications.ts'

/**
 * What pressing a notification does.
 *
 * A notification carries an action's **name** and the **ids** of what it is about, and nothing else. It never carries
 * a path to run, a command, or anything that could become one: the name is looked up here, in a table written at
 * startup, and if it is not in the table nothing happens. That is the whole of the security model for notification
 * actions, and it is why this file exists rather than each notification carrying its own behaviour.
 *
 * Everything here is given to Orbis by Orbis. A handler that is not supplied -- an updater that is not running, a
 * workflow engine that failed to start -- means the button politely says it cannot, rather than appearing to work.
 *
 * Three things every handler must do, because a notification can outlive what it is about by days:
 *
 *   - check the thing still exists, and say so plainly when it does not;
 *   - never do something consequential that the rest of Orbis would have asked about first;
 *   - report what really happened, not that a message was sent.
 */

export interface ActionResult {
  ok: boolean
  message?: string
}

/** What each button needs in order to work. Anything missing simply makes that button say it cannot. */
export interface ActionHandlers {
  /**
   * Brings Orbis forward and takes the person to the thing a notification is about.
   *
   * The one general destination. It is given the event name and the ids, and the window works out where that is --
   * so the list of places a notification can send somebody is the list of screens Orbis has, and nothing else.
   */
  open?(one: OrbisNotification): Promise<ActionResult>
  /** Opens a file that was downloaded or made. Must check it is still there. */
  openFile?(path: string): Promise<ActionResult>
  /** Shows a file where it lives. Must check it is still there. */
  showInFolder?(path: string): Promise<ActionResult>
  /** Brings the browser to the tab that is waiting for a person. */
  openChallenge?(one: OrbisNotification): Promise<ActionResult>
  /** Runs something again, through whatever owns it, with that owner's own rules about whether it is safe to. */
  retry?(one: OrbisNotification): Promise<ActionResult>
  /** Runs a missed scheduled job now. */
  runNow?(one: OrbisNotification): Promise<ActionResult>
  /** Restarts Orbis to finish an update. */
  restart?(): Promise<ActionResult>
  /** Stops whatever is waiting -- a workflow paused on a challenge nobody wants to do. */
  stop?(one: OrbisNotification): Promise<ActionResult>
}

const missing = (what: string): ActionResult => ({ ok: false, message: `${what} is not available right now.` })

/**
 * Builds the table.
 *
 * Returns the one function the manager calls. Nothing outside this file can add to the table after it is built, so a
 * notification arriving later can never name an action that was not decided on at startup.
 */
export function notificationActions(handlers: ActionHandlers): (action: string, one: OrbisNotification) => Promise<ActionResult> {
  const table: Record<string, (one: OrbisNotification) => Promise<ActionResult>> = {
    open: async (one) => (handlers.open ? handlers.open(one) : missing('Opening it')),
    'open-file': async (one) => {
      const path = one.subject.path
      if (!path) return { ok: false, message: 'There is no file to open.' }
      return handlers.openFile ? handlers.openFile(path) : missing('Opening files')
    },
    'show-in-folder': async (one) => {
      const path = one.subject.path
      if (!path) return { ok: false, message: 'There is no file to show.' }
      return handlers.showInFolder ? handlers.showInFolder(path) : missing('Showing files')
    },
    'open-challenge': async (one) => (handlers.openChallenge ? handlers.openChallenge(one) : handlers.open ? handlers.open(one) : missing('Opening it')),
    retry: async (one) => (handlers.retry ? handlers.retry(one) : missing('Trying again')),
    'run-now': async (one) => (handlers.runNow ? handlers.runNow(one) : missing('Running it now')),
    restart: async () => (handlers.restart ? handlers.restart() : missing('Restarting')),
    stop: async (one) => (handlers.stop ? handlers.stop(one) : missing('Stopping it'))
  }

  return async (action, one) => {
    const run = Object.prototype.hasOwnProperty.call(table, action) ? table[action] : undefined
    // Not in the table is not an error to explain away: it is simply not a thing a notification can do.
    if (!run) return { ok: false, message: 'That is not something Orbis can do from a notification.' }
    try {
      return await run(one)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'That did not work.' }
    }
  }
}

/** The names that exist. Used by the tests, and by the template guard that stops one offering a button nothing runs. */
export const ACTION_IDS: readonly string[] = Object.freeze(['open', 'open-file', 'show-in-folder', 'open-challenge', 'retry', 'run-now', 'restart', 'stop', 'dismiss'])
