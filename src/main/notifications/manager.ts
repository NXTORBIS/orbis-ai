import {
  coalesce,
  deliveryOrder,
  heldSummary,
  isDuplicate,
  notificationFor,
  prune,
  shouldShow,
  unreadCount,
  type AttentionContext,
  type OrbisEvent,
  type OrbisNotification,
  type NotificationStatus
} from '../../shared/notifications.ts'
import type { NotificationsConfig } from '../../shared/experience.ts'

/**
 * The one place in Orbis that decides to interrupt somebody, and the only one that may.
 *
 * Everything that happens publishes an event here. This keeps the history, drops the ones that are the same event
 * twice, holds back what should wait until morning, folds a burst into one line, and hands what is left to whatever
 * can actually put a notification on the screen.
 *
 * It knows nothing about Electron, Windows or notifications as the operating system understands them. That is the
 * `Delivery` below -- one interface, one implementation, and the only code in Orbis allowed to call the system's
 * notification API. Everything that makes this worth testing is on this side of that line.
 *
 * What it refuses to do:
 *
 * **It never invents one.** The only way in is `publish`, and the only things that come out of it are the templates
 * in src/shared/notifications.ts. There is no method here that takes a title and a body.
 *
 * **It never says a task finished.** It says an event was published. The task's own state stays the authority; this
 * is a record of what Orbis was told, not a second copy of what Orbis knows.
 *
 * **It never crosses profiles.** Everything is kept per profile and read per profile. A notification belonging to one
 * can neither be seen nor acted on from another, and switching profile changes what is there.
 */

/** Putting one on the screen. The one thing this cannot do by itself. */
export interface Delivery {
  /** Whether the system will show notifications at all right now. */
  available(): boolean
  /** Shows one. Resolves true only when it was really handed over -- never optimistically. */
  show(one: OrbisNotification, onActivate: (actionId: string) => void): Promise<boolean>
  /** True when the system is suppressing notifications (focus assist, do not disturb). */
  quiet(): boolean
}

/** Keeping the history between runs. Given rather than built, so a test can keep it in memory. */
export interface NotificationStore {
  read(profileId: string): Promise<OrbisNotification[]>
  write(profileId: string, history: readonly OrbisNotification[]): Promise<void>
}

export interface ManagerDeps {
  readonly delivery: Delivery
  readonly store: NotificationStore
  /** The settings for a profile, read fresh each time so a change takes effect at once. */
  settings(profileId: string): NotificationsConfig
  /** What the person is looking at, so Orbis does not announce what is already on their screen. */
  attention(): AttentionContext
  /** Runs what a button says. Given the action and what it is about; returns whether it really happened. */
  act(action: string, one: OrbisNotification): Promise<{ ok: boolean; message?: string }>
  /** Told whenever the history changes, so a window can redraw. */
  onChange?(profileId: string): void
  now?(): number
}

/** How many are kept per profile. Past this the oldest go, and the ones acted on are kept longest. */
export const HISTORY_LIMIT = 300

/** A burst within this long is one burst, and may be folded into a single line. */
const BURST_MS = 4000

/** Pending ones are never allowed past this, so a storm cannot eat the machine. */
const QUEUE_LIMIT = 200

export class NotificationManager {
  private readonly o: ManagerDeps
  private readonly history = new Map<string, OrbisNotification[]>()
  private readonly loaded = new Set<string>()
  /** Held back by quiet hours or by the system being set not to disturb, per profile. */
  private readonly held = new Map<string, OrbisNotification[]>()
  private readonly pending = new Map<string, OrbisNotification[]>()
  private burst: NodeJS.Timeout | null = null
  private saving = 0
  private next = 0

  constructor(deps: ManagerDeps) {
    this.o = deps
  }

  private at(): number {
    return this.o.now ? this.o.now() : Date.now()
  }

  /** Unique within a run, and stable across the one notification's life. */
  private id(): string {
    this.next += 1
    return `n${this.at().toString(36)}${this.next.toString(36)}`
  }

  private async load(profileId: string): Promise<OrbisNotification[]> {
    if (!this.loaded.has(profileId)) {
      /*
       * A history that will not read is not a reason to stop.
       *
       * Notifications are a way of telling somebody about work; they are never the work. Orbis starting with an empty
       * notification list is a small loss, and Orbis not starting is a large one.
       */
      const read = await this.o.store.read(profileId).catch(() => [] as OrbisNotification[])
      this.history.set(profileId, prune(read, HISTORY_LIMIT, this.at()) as OrbisNotification[])
      this.loaded.add(profileId)
    }
    return this.history.get(profileId) ?? []
  }

  private async save(profileId: string): Promise<void> {
    const history = this.history.get(profileId) ?? []
    this.saving += 1
    try {
      await this.o.store.write(profileId, history)
    } catch {
      // Already in memory and already shown. Losing the record of it is not worth interrupting anything for.
    } finally {
      this.saving -= 1
    }
    this.o.onChange?.(profileId)
  }

  /**
   * Something happened.
   *
   * The only way a notification comes into being. Returns the one it made, or null -- and null is the common answer,
   * because most of what Orbis does is not worth a noise.
   */
  async publish(event: OrbisEvent): Promise<OrbisNotification | null> {
    const one = notificationFor({ ...event, at: event.at ?? this.at() }, this.id())
    if (!one) return null

    const history = await this.load(one.profileId)
    // The same event twice -- a retry, a restart part-way through, two listeners on one state change -- is one event.
    if (isDuplicate(one, history)) return null

    history.unshift(one)
    this.history.set(one.profileId, prune(history, HISTORY_LIMIT, this.at()) as OrbisNotification[])

    const verdict = shouldShow(one, this.o.settings(one.profileId), { ...this.o.attention(), doNotDisturb: this.o.delivery.quiet() }, this.at())
    if (!verdict.show) {
      this.mark(one.id, one.profileId, verdict.hold ? 'held' : 'suppressed')
      if (verdict.hold) this.hold(one)
      await this.save(one.profileId)
      return one
    }

    this.queue(one)
    await this.save(one.profileId)
    return one
  }

  private hold(one: OrbisNotification): void {
    const waiting = this.held.get(one.profileId) ?? []
    waiting.push(one)
    this.held.set(one.profileId, waiting.slice(-QUEUE_LIMIT))
  }

  /**
   * Waits a moment before showing.
   *
   * Three downloads finishing within a second of each other is one thing that happened. The wait is short enough that
   * a single notification still feels immediate, and long enough that a burst arrives as a burst.
   */
  private queue(one: OrbisNotification): void {
    const waiting = this.pending.get(one.profileId) ?? []
    if (waiting.length >= QUEUE_LIMIT) waiting.shift()
    waiting.push(one)
    this.pending.set(one.profileId, waiting)
    if (this.burst) return
    this.burst = setTimeout(() => {
      this.burst = null
      void this.flush()
    }, BURST_MS)
    // A timer that keeps a process alive to say "your download finished" is a timer that stops a computer sleeping.
    this.burst.unref?.()
  }

  /** Shows what is waiting: urgent first, and a run of like things as one line. */
  private async flush(): Promise<void> {
    for (const [profileId, waiting] of [...this.pending]) {
      this.pending.delete(profileId)
      if (waiting.length === 0) continue
      const ordered = deliveryOrder(waiting)

      const byGroup = new Map<string, OrbisNotification[]>()
      for (const one of ordered) byGroup.set(one.group, [...(byGroup.get(one.group) ?? []), one])

      for (const group of byGroup.values()) {
        const folded = group.length > 1 ? coalesce(group) : null
        if (folded) {
          // Shown as the first of them, carrying the summary: pressing it opens that one, which is the group's home.
          await this.deliver({ ...group[0]!, title: folded.title, body: folded.body })
          for (const one of group.slice(1)) this.mark(one.id, one.profileId, 'delivered')
          void this.save(profileId)
          continue
        }
        for (const one of group) await this.deliver(one)
      }
      void this.save(profileId)
    }
  }

  private async deliver(one: OrbisNotification): Promise<void> {
    if (!this.o.delivery.available()) {
      /*
       * Nowhere to show it.
       *
       * Recorded as delivered nowhere rather than as delivered. The difference matters: somebody looking at why they
       * were not told should find the real answer, and the notification centre inside Orbis still has it.
       */
      this.mark(one.id, one.profileId, 'failed')
      return
    }
    const shown = await this.o.delivery.show(one, (actionId) => void this.activate(one.id, one.profileId, actionId)).catch(() => false)
    this.mark(one.id, one.profileId, shown ? 'delivered' : 'failed')
  }

  private mark(id: string, profileId: string, status: NotificationStatus, read?: boolean): void {
    const history = this.history.get(profileId)
    if (!history) return
    const at = history.findIndex((one) => one.id === id)
    if (at < 0) return
    history[at] = { ...history[at]!, status, ...(read === undefined ? {} : { read }) }
  }

  /**
   * Somebody pressed one.
   *
   * Everything is checked again here, because a notification can outlive the thing it was about by days: it still
   * exists, it belongs to this profile, the button is one it really offered, and the thing it refers to is still
   * there. Only then does anything happen.
   */
  async activate(id: string, profileId: string, actionId: string): Promise<{ ok: boolean; message?: string }> {
    const history = await this.load(profileId)
    const one = history.find((n) => n.id === id)
    if (!one) return { ok: false, message: 'That notification is no longer here.' }
    if (one.profileId !== profileId) return { ok: false, message: 'That notification belongs to another profile.' }

    if (actionId === 'dismiss') {
      this.mark(id, profileId, 'dismissed', true)
      await this.save(profileId)
      return { ok: true }
    }
    // Only a button it actually offered. An id arriving from anywhere else is not a button, whatever it says.
    if (!one.actions.some((action) => action.id === actionId)) return { ok: false, message: 'That is not something this can do.' }
    if (one.expiresAt !== null && one.expiresAt <= this.at() && actionId !== 'open') {
      return { ok: false, message: 'That is no longer available.' }
    }

    const result = await this.o.act(actionId, one).catch((err: unknown) => ({ ok: false, message: err instanceof Error ? err.message : 'That did not work.' }))
    this.mark(id, profileId, result.ok ? 'actioned' : 'failed', true)
    await this.save(profileId)
    return result
  }

  /** Quiet hours have ended, or the system has stopped suppressing: say what was held back, in one line. */
  async releaseHeld(profileId: string): Promise<void> {
    const waiting = this.held.get(profileId) ?? []
    if (waiting.length === 0) return
    this.held.delete(profileId)
    const summary = heldSummary(waiting)
    if (!summary) return
    const first = waiting[0]!
    await this.deliver({ ...first, title: summary.title, body: summary.body })
    for (const one of waiting.slice(1)) this.mark(one.id, one.profileId, 'delivered')
    await this.save(profileId)
  }

  async list(profileId: string): Promise<readonly OrbisNotification[]> {
    return prune(await this.load(profileId), HISTORY_LIMIT, this.at())
  }

  async unread(profileId: string): Promise<number> {
    return unreadCount(await this.list(profileId))
  }

  async markRead(profileId: string, id: string | null): Promise<void> {
    const history = await this.load(profileId)
    for (let i = 0; i < history.length; i++) {
      if (id === null || history[i]!.id === id) history[i] = { ...history[i]!, read: true }
    }
    await this.save(profileId)
  }

  /**
   * Forgets the history.
   *
   * The notifications and nothing else. The workflows, downloads, files and research they were about are untouched --
   * a notification is a note saying something happened, not the thing that happened.
   */
  async clear(profileId: string, id: string | null): Promise<void> {
    const history = await this.load(profileId)
    this.history.set(profileId, id === null ? [] : history.filter((one) => one.id !== id))
    await this.save(profileId)
  }

  /** What this computer can really do, asked rather than assumed. */
  capabilities(): { native: boolean; quiet: boolean } {
    return { native: this.o.delivery.available(), quiet: this.o.delivery.quiet() }
  }

  /** Stops the one timer. Called at quit so a pending burst cannot hold the process open. */
  stop(): void {
    if (this.burst) clearTimeout(this.burst)
    this.burst = null
  }

  /** True while a write is in flight, so a test can wait for one without sleeping. */
  get busy(): boolean {
    return this.saving > 0
  }
}
