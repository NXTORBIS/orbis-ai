import { Notification } from 'electron'
import type { Delivery } from './manager.ts'
import type { OrbisNotification } from '../../shared/notifications.ts'

/**
 * The only code in Orbis that calls the operating system's notification API.
 *
 * Everything else publishes an event and the manager decides; this puts the result on the screen and reports, truly,
 * whether that worked. It is deliberately small, because everything worth testing was kept on the other side of it.
 *
 * What it does not pretend:
 *
 * **It does not claim the person saw it.** The operating system says whether it accepted a notification, and nothing
 * more than that. "Delivered" here means handed over, which is the most anyone can honestly say.
 *
 * **It does not draw its own buttons.** Electron offers action buttons on macOS and not on Windows, where a toast's
 * buttons need an XML payload and a registered activator that an unpackaged build does not have. So on Windows a
 * notification has one thing it does -- being pressed -- and the rest of its buttons live in the Orbis notification
 * centre, where they really work. `supportsButtons` says which of those this computer is, and the settings screen
 * reads it rather than guessing.
 *
 * **It does not fight the computer.** When the system is set not to disturb, that is the answer; nothing here tries
 * to get round it, and the manager holds the notification instead of losing it.
 */

/** What a notification's urgency means to the system that shows it. */
const URGENCY: Readonly<Record<string, 'critical' | 'normal' | 'low'>> = Object.freeze({
  critical: 'critical',
  high: 'critical',
  normal: 'normal',
  low: 'low'
})

export interface NativeDeliveryOptions {
  /**
   * Whether the system is currently suppressing notifications.
   *
   * Given rather than worked out: Electron exposes no reliable way to read Windows focus assist, and guessing would
   * be worse than asking. Orbis's own quiet hours are a separate thing and are handled in the manager.
   */
  suppressed?(): boolean
  /** Whether a sound should play. The manager has already decided this is worth showing at all. */
  sound?(one: OrbisNotification): boolean
}

export class NativeDelivery implements Delivery {
  private readonly o: NativeDeliveryOptions
  /** Kept alive until they are closed: a Notification that is garbage collected stops reporting its click. */
  private readonly live = new Map<string, Notification>()

  constructor(options: NativeDeliveryOptions = {}) {
    this.o = options
  }

  available(): boolean {
    try {
      return Notification.isSupported()
    } catch {
      return false
    }
  }

  quiet(): boolean {
    try {
      return this.o.suppressed?.() === true
    } catch {
      return false
    }
  }

  /** True where the operating system will draw a notification's buttons. False is not a failure, only a fact. */
  get supportsButtons(): boolean {
    return process.platform === 'darwin'
  }

  async show(one: OrbisNotification, onActivate: (actionId: string) => void): Promise<boolean> {
    if (!this.available()) return false
    /*
     * A sensitive notification says nothing on the glass.
     *
     * Security notifications can say what was blocked, and a notification is exactly the thing that appears on a
     * screen somebody has walked away from. The title is enough to bring them back; the detail is inside Orbis,
     * behind whatever is already protecting it.
     */
    const body = one.sensitive ? 'Open Orbis to see what happened.' : one.body

    let native: Notification
    try {
      native = new Notification({
        title: one.title,
        body,
        silent: this.o.sound?.(one) === false,
        urgency: URGENCY[one.priority] ?? 'normal',
        // macOS draws these; everywhere else they are ignored, which is why the notification centre carries them too.
        ...(this.supportsButtons && one.actions.length > 0 ? { actions: one.actions.slice(0, 2).map((action) => ({ type: 'button' as const, text: action.label })) } : {})
      })
    } catch {
      return false
    }

    const first = one.actions[0]?.id ?? 'open'
    native.on('click', () => {
      this.live.delete(one.id)
      onActivate(first)
    })
    native.on('action', (_event, index) => {
      this.live.delete(one.id)
      onActivate(one.actions[index]?.id ?? first)
    })
    native.on('close', () => void this.live.delete(one.id))
    native.on('failed', () => void this.live.delete(one.id))

    try {
      native.show()
    } catch {
      return false
    }
    this.live.set(one.id, native)
    return true
  }

  /** Takes one off the screen, where the system allows it. */
  close(id: string): void {
    const native = this.live.get(id)
    if (!native) return
    this.live.delete(id)
    try {
      native.close()
    } catch {
      // Already gone, which is the state we wanted.
    }
  }

  /** Shuts everything down at quit: a live Notification holds a handle the process would otherwise wait on. */
  stop(): void {
    for (const id of [...this.live.keys()]) this.close(id)
  }
}
