import type { AppSize } from './manifest.ts'

/**
 * How a Native App belongs to a conversation.
 *
 * ## A message carries a pointer, never a state
 *
 * This is the pattern the Creation Engine already uses for artifacts, and it is kept for the same reason: a message
 * holds `{ appId, instanceId }` and the card reads the live instance when it is drawn. So
 *
 * - a conversation does not get slower as more apps appear in it, because nothing large was ever written into it;
 * - an app whose state has moved on shows what it holds *now*, not what it held when the reply was written;
 * - an app that has been closed says so, calmly, instead of offering buttons that would fail.
 *
 * Serialising a simulation into a chat message would mean a hundred-message conversation carrying a hundred copies of
 * state that is already stored once. §46 of the brief says it directly, and `ChatArtifact` in `shared/types.ts` is the
 * precedent.
 *
 * ## Where the app actually lives
 *
 * In the conversation. Not in a separate Labs window, not in a panel beside it. Everything in this file exists to make
 * "the chat is the workspace" true rather than aspirational — which is why the reference carries the conversation and
 * message it is attached to, and why reopening finds the existing instance instead of making a second one.
 *
 * Pure.
 */

/** What happened to an app in a given reply. */
export type AppAct = 'opened' | 'configured' | 'ran' | 'reopened'

/**
 * The pointer a message carries.
 *
 * Small on purpose. Everything else about the app — its parameters, its results, whether it is running — is read from
 * the instance, which is the only copy.
 */
export interface ChatNativeApp {
  appId: string
  instanceId: string
  act: AppAct
  /** The app version at the time of the reply, so a card can say the app has changed since. */
  appVersion: number
  /** What was set, in words, for the one-line summary under the card. Never the values themselves. */
  did: readonly string[]
  /** The size it was opened at. The user may change it; this is only the starting point. */
  openedAt: AppSize
}

export const isChatNativeApp = (value: unknown): value is ChatNativeApp =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).appId === 'string' &&
  typeof (value as Record<string, unknown>).instanceId === 'string'

/**
 * A reference read back out of a stored conversation.
 *
 * Conversations are stored on disk and may be older than this build, so every field is checked. A reference that does
 * not read is dropped rather than rendered: a card with no instance id is a card whose buttons all fail.
 */
export function readReference(raw: unknown): ChatNativeApp | null {
  if (!raw || typeof raw !== 'object') return null
  const one = raw as Record<string, unknown>
  const appId = typeof one.appId === 'string' ? one.appId : ''
  const instanceId = typeof one.instanceId === 'string' ? one.instanceId : ''
  if (!appId || !instanceId) return null

  const act = one.act
  const openedAt = one.openedAt
  return {
    appId,
    instanceId,
    act: act === 'configured' || act === 'ran' || act === 'reopened' ? act : 'opened',
    appVersion: typeof one.appVersion === 'number' && Number.isInteger(one.appVersion) && one.appVersion > 0 ? one.appVersion : 1,
    did: Array.isArray(one.did) ? one.did.filter((two): two is string => typeof two === 'string').slice(0, 8) : [],
    openedAt: openedAt === 'expanded' || openedAt === 'workspace' ? openedAt : 'compact'
  }
}

export const readReferences = (raw: unknown): readonly ChatNativeApp[] =>
  Array.isArray(raw) ? raw.map(readReference).filter((one): one is ChatNativeApp => one !== null) : []

// ---------------------------------------------------------------- what a card should show

/** Everything the card needs to know about the instance behind it, as the renderer receives it. */
export interface CardFacts {
  exists: boolean
  phase: string
  appVersion: number
  size: AppSize
  /** Set when the instance failed, so the card can offer recovery rather than a broken app. */
  failure: { says: string; recovery: string } | null
  /**
   * Whether the app keeps anything between runs.
   *
   * The closed card has to know. Promising that reopening "restores what it held" for an app that saves nothing is a
   * small lie that somebody finds out by clicking, and the honest version of that sentence is one word different.
   */
  persists: boolean
}

export type CardState =
  /** Mount it. */
  | { show: 'app'; size: AppSize }
  /** It was closed. Offer to open it again; its saved states are intact. */
  | { show: 'closed'; says: string }
  /** It failed. Offer what the failure says, not a retry button that would fail the same way. */
  | { show: 'failed'; says: string; recovery: string }
  /** The instance is gone — a restart without persistence, or a swept closed instance. */
  | { show: 'gone'; says: string }
  /** The app itself is no longer in this build. */
  | { show: 'retired'; says: string }

/**
 * What a card in the conversation should render.
 *
 * One function so the chat has one answer rather than four components each deciding. The states are deliberately
 * distinct: "closed" and "gone" look the same to a user who is not told, and they are not the same — one reopens with
 * its state, the other starts fresh — so saying which is the difference between a confusing card and a clear one.
 */
export function cardState(facts: CardFacts | null, appExists: boolean): CardState {
  if (!appExists) {
    return {
      show: 'retired',
      says: 'That app is not part of this version of Orbis any more. Anything it saved is still in your experiments.'
    }
  }
  if (!facts || !facts.exists) {
    return { show: 'gone', says: 'This app is no longer open. Opening it again starts it fresh.' }
  }
  if (facts.failure) return { show: 'failed', says: facts.failure.says, recovery: facts.failure.recovery }
  if (facts.phase === 'closed') {
    return {
      show: 'closed',
      says: facts.persists ? 'Closed. Opening it again restores what it held.' : 'Closed. Opening it again starts it fresh.'
    }
  }
  return { show: 'app', size: facts.size }
}

/**
 * Whether the card should say the app has changed since the reply.
 *
 * Shown rather than hidden: a card drawn under a six-month-old message by a newer version of the app is showing
 * something the reply was not about, and a reader deserves to know which.
 */
export function movedOn(reference: ChatNativeApp, currentVersion: number): string | null {
  if (currentVersion <= reference.appVersion) return null
  return `This app has been updated since this reply (it was version ${reference.appVersion}, now ${currentVersion}).`
}

// ---------------------------------------------------------------- reopening

/**
 * Whether asking for an app again should reuse what is open or start a new one.
 *
 * The question matters because both wrong answers are bad. Reusing when the person meant a second one mutates the
 * experiment they were comparing against; starting a new one when they meant the same one leaves two cards in the
 * conversation claiming to be the same thing.
 *
 * The rule: an app already open *in this conversation*, not closed, and not asked for with different values, is the one
 * they mean. Anything else is new.
 */
export function reuseOrOpen(
  open: readonly { instanceId: string; appId: string; conversationId: string | null; phase: string }[],
  want: { appId: string; conversationId: string | null; configure?: Readonly<Record<string, unknown>> }
): { reuse: string } | { open: true } {
  if (want.configure && Object.keys(want.configure).length > 0) return { open: true }

  const found = open.find(
    (one) => one.appId === want.appId && one.conversationId === want.conversationId && one.phase !== 'closed'
  )
  return found ? { reuse: found.instanceId } : { open: true }
}

/**
 * How many apps a conversation should keep mounted at once.
 *
 * Beyond this the oldest are left as cards that mount on demand. A conversation with thirty live simulations in it is
 * one where scrolling costs thirty frames of work per frame, and virtualising by hand is cheaper than discovering that.
 */
export const MOST_MOUNTED = 6

/**
 * Which of a conversation's apps should actually be mounted.
 *
 * Most recent first, and anything that is running stays mounted regardless of its position — unmounting a running
 * computation to save a frame is how somebody loses a result they were waiting for.
 */
export function mounted(
  apps: readonly { instanceId: string; phase: string; touchedAt: number }[],
  most = MOST_MOUNTED
): readonly string[] {
  const running = apps.filter((one) => one.phase === 'running')
  const rest = apps
    .filter((one) => one.phase !== 'running' && one.phase !== 'closed')
    .sort((a, b) => b.touchedAt - a.touchedAt)

  const out = new Set(running.map((one) => one.instanceId))
  for (const one of rest) {
    if (out.size >= Math.max(most, running.length)) break
    out.add(one.instanceId)
  }
  return [...out]
}
