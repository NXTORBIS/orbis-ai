import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { dataDirFor } from '../../shared/profiles.ts'
import { NotificationManager } from './manager.ts'
import { NativeDelivery } from './native.ts'
import { FileNotificationStore } from './store.ts'
import { notificationActions, type ActionHandlers } from './actions.ts'
import type { AttentionContext, OrbisEvent, OrbisNotification } from '../../shared/notifications.ts'
import type { NotificationsConfig } from '../../shared/experience.ts'

/**
 * Builds Orbis's notification system and hands back the one thing the rest of Orbis needs: `publish`.
 *
 * Everything in Orbis that finishes something, fails at something or is waiting for somebody calls `publish` with a
 * fact. Nothing else. No part of Orbis constructs a notification, chooses its urgency, decides whether to interrupt,
 * or touches the operating system -- all of that is behind this one call, which is the point of the whole thing.
 */

export interface NotificationsSetup {
  /** Where this profile's things live, so the history sits beside them. */
  userData: string
  /** The profile everything belongs to, read fresh so a switch takes effect at once. */
  profileId(): string
  settings(): NotificationsConfig
  /** What the person is looking at, so Orbis does not announce what is already on their screen. */
  attention(): AttentionContext
  /** Whether the computer is set not to disturb. Absent means Orbis does not know, which is not the same as no. */
  suppressed?(): boolean
  handlers: ActionHandlers
  onChange?(profileId: string): void
}

export interface Notifications {
  /** Something happened. Returns what it became, or null when it was not worth a noise. */
  publish(event: Omit<OrbisEvent, 'profileId'> & { profileId?: string }): Promise<OrbisNotification | null>
  list(profileId?: string): Promise<readonly OrbisNotification[]>
  unread(profileId?: string): Promise<number>
  markRead(id: string | null, profileId?: string): Promise<void>
  clear(id: string | null, profileId?: string): Promise<void>
  activate(id: string, actionId: string, profileId?: string): Promise<{ ok: boolean; message?: string }>
  /** Say what quiet hours held back. Called when they end. */
  releaseHeld(profileId?: string): Promise<void>
  /** What this computer can really do. Asked, never assumed. */
  capabilities(): { native: boolean; buttons: boolean; quiet: boolean }
  /** Sends a real notification through the real system, so somebody can see whether it works. */
  test(): Promise<{ ok: boolean; message: string }>
  flush(): Promise<void>
  stop(): void
}

/** A file that is really there. Used before claiming a notification can open one. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function createNotifications(setup: NotificationsSetup): Notifications {
  const delivery = new NativeDelivery({ suppressed: setup.suppressed })
  // `dataDirFor` gives the folder relative to userData: "." for the first profile, "profiles/<id>" for the rest.
  const store = new FileNotificationStore((profileId) => join(setup.userData, dataDirFor(profileId), 'notifications.json'))

  /*
   * Every handler checks before it claims.
   *
   * A notification about a file can be days old, and the file can have been moved, renamed or deleted since. Opening
   * one that is no longer there must say so rather than failing somewhere deeper with nothing on screen.
   */
  const handlers: ActionHandlers = {
    ...setup.handlers,
    openFile: async (path) => {
      if (!(await exists(path))) return { ok: false, message: 'That file is not there any more.' }
      return setup.handlers.openFile ? setup.handlers.openFile(path) : { ok: false, message: 'Opening files is not available right now.' }
    },
    showInFolder: async (path) => {
      if (!(await exists(path))) return { ok: false, message: 'That file is not there any more.' }
      return setup.handlers.showInFolder ? setup.handlers.showInFolder(path) : { ok: false, message: 'Showing files is not available right now.' }
    }
  }

  const manager = new NotificationManager({
    delivery,
    store,
    settings: () => setup.settings(),
    attention: () => setup.attention(),
    act: notificationActions(handlers),
    onChange: setup.onChange
  })

  const who = (profileId?: string): string => profileId ?? setup.profileId()

  return {
    publish: (event) => manager.publish({ ...event, profileId: event.profileId ?? setup.profileId() }),
    list: (profileId) => manager.list(who(profileId)),
    unread: (profileId) => manager.unread(who(profileId)),
    markRead: (id, profileId) => manager.markRead(who(profileId), id),
    clear: (id, profileId) => manager.clear(who(profileId), id),
    activate: (id, actionId, profileId) => manager.activate(id, who(profileId), actionId),
    releaseHeld: (profileId) => manager.releaseHeld(who(profileId)),
    capabilities: () => ({ ...manager.capabilities(), buttons: delivery.supportsButtons }),
    /**
     * The test from Settings.
     *
     * A real notification through the real system -- not a message drawn inside Orbis that looks like one. The point
     * of the button is to find out whether the operating system will show Orbis's notifications at all, and a
     * pretend one answers the opposite of the question being asked.
     */
    test: async () => {
      if (!delivery.available()) return { ok: false, message: 'This computer is not showing notifications for Orbis.' }
      const one = await manager.publish({
        type: 'system.problem',
        profileId: setup.profileId(),
        fields: { title: 'Orbis notifications are working', reason: 'This is the test you asked for.' }
      })
      if (!one) return { ok: false, message: 'Orbis could not make the test notification.' }
      return { ok: true, message: 'Sent. If nothing appears, check notifications for Orbis in Windows settings.' }
    },
    flush: () => store.flush(),
    stop: () => {
      manager.stop()
      delivery.stop()
    }
  }
}

export type { ActionHandlers } from './actions.ts'
export { NotificationManager } from './manager.ts'
