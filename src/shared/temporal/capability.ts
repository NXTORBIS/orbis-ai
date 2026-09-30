import { TARGET_OF, type JobCondition, type TemporalAction } from './job.ts'

/**
 * What Orbis can and cannot promise about a schedule.
 *
 * This file exists so that one question has one honest answer: **"will this run while my computer is off?"**
 *
 * For Orbis today the answer is no, for everything. There is no Orbis server, no account that anything runs under, and
 * no authorized connection to a calendar, a mail account or a messaging service. Every action a job can name needs
 * this computer awake, with Orbis running on it.
 *
 * That is a limitation worth stating rather than hiding. A scheduler that accepts "message my team at 9am on Monday"
 * and silently does nothing when the laptop is shut is worse than one that says up front what it needs, because the
 * person only finds out after the moment has passed and cannot be recovered.
 *
 * So the rule here is: **describe the limit, never simulate past it.** Nothing in this file pretends a capability
 * exists, and nothing elsewhere may accept a job whose requirements this file says are unmet.
 */

/** What a job needs in order to run. Read off the action, not chosen. */
export interface Requirements {
  /** This computer awake with Orbis running. True for everything Orbis can do today. */
  needsThisComputer: boolean
  /** Whether the Orbis browser specifically must be running. */
  needsBrowser: boolean
  needsNetwork: boolean
  /** Whether an Orion model key is needed, which the settings may or may not hold. */
  needsModel: boolean
}

export function requirementsOf(action: TemporalAction): Requirements {
  const browser = ['openUrl', 'openWorkspace', 'openPage', 'refreshUrl', 'closeTabs'].includes(action.kind)
  return {
    needsThisComputer: TARGET_OF[action.kind] === 'local',
    needsBrowser: browser,
    // A workflow's own steps may or may not need the network; assuming they might is the safe direction.
    needsNetwork: browser || action.kind === 'orion' || action.kind === 'workflow',
    needsModel: action.kind === 'orion'
  }
}

/** What is actually true of this machine right now. Gathered by the main process; never guessed here. */
export interface DeviceState {
  orbisRunning: boolean
  browserRunning: boolean
  networkAvailable: boolean
  /** Whether the connection is metered, which is what `onWifi` really means to a person. */
  onUnmeteredNetwork: boolean
  onPower: boolean
  /** Null when the machine has no battery, which is not the same as empty. */
  batteryPercent: number | null
  /** Whether the person has been away from the keyboard. */
  idle: boolean
  hasModelKey: boolean
}

export interface Readiness {
  ready: boolean
  /** Why not, in words somebody can act on. Empty when ready. */
  reasons: readonly string[]
  /** Whether waiting will fix it. A missing model key will not fix itself; a closed browser will. */
  willResolveItself: boolean
}

/** Whether this action can run on this machine at this moment. */
export function readiness(action: TemporalAction, device: DeviceState): Readiness {
  const need = requirementsOf(action)
  const reasons: string[] = []
  let selfResolving = true

  if (need.needsThisComputer && !device.orbisRunning) reasons.push('Orbis is not running.')
  if (need.needsBrowser && !device.browserRunning) reasons.push('The Orbis browser is not open.')
  if (need.needsNetwork && !device.networkAvailable) reasons.push('There is no internet connection.')
  if (need.needsModel && !device.hasModelKey) {
    reasons.push('Orion has no model key, so it cannot answer.')
    // Somebody has to go and add one. Waiting achieves nothing, so this is a `blocked` job rather than a waiting one.
    selfResolving = false
  }

  return { ready: reasons.length === 0, reasons, willResolveItself: selfResolving }
}

/** Whether the conditions a person attached are true now. Separate from readiness: these are choices, not needs. */
export function conditionsMet(conditions: readonly JobCondition[], device: DeviceState): Readiness {
  const reasons: string[] = []
  for (const c of conditions) {
    switch (c.kind) {
      case 'onWifi':
        if (!device.onUnmeteredNetwork) reasons.push('This connection is metered, and the job asks for wifi.')
        break
      case 'onPower':
        if (!device.onPower) reasons.push('The computer is not plugged in.')
        break
      case 'batteryAbove':
        // No battery is not a failed battery check: a desktop satisfies "battery above 20%" trivially.
        if (device.batteryPercent !== null && device.batteryPercent < c.percent) {
          reasons.push(`The battery is below ${c.percent}%.`)
        }
        break
      case 'networkAvailable':
        if (!device.networkAvailable) reasons.push('There is no internet connection.')
        break
    }
  }
  return { ready: reasons.length === 0, reasons, willResolveItself: true }
}

// ---------------------------------------------------------------- what Orbis cannot do at all

/**
 * The things people reasonably ask a scheduler for that Orbis genuinely cannot do.
 *
 * Each is a real absence, not a missing feature behind a flag. They are written down here so that the answer is the
 * same wherever somebody asks -- the Orb, the schedule screen, Orion in conversation -- and so that adding one later
 * means removing a line from this list rather than discovering that six places disagreed.
 */
export interface Unsupported {
  /** What somebody might ask for, in their words. */
  ask: string
  /** Why it cannot happen. Plain, specific, and about Orbis rather than about the request. */
  because: string
  /** The nearest thing Orbis can actually do, or null when there is none worth offering. */
  instead: string | null
}

export const UNSUPPORTED: readonly Unsupported[] = Object.freeze([
  {
    ask: 'Run this while my computer is off, or asleep.',
    because: 'Everything Orbis schedules runs on this computer. There is no Orbis server to run it anywhere else.',
    instead: 'Orbis can run it the moment the computer wakes up, and say how late it was.'
  },
  {
    ask: 'Send a WhatsApp, Slack or Telegram message on a schedule.',
    because: 'Orbis has no connection to any messaging service, and no permission to act in your accounts.',
    instead: 'Orbis can remind you at that moment, and open the conversation ready for you to send it.'
  },
  {
    ask: 'Send an email on a schedule.',
    because: 'Orbis has no mail account and no permission to send as you.',
    instead: 'Orbis can remind you, and open your mail with the message drafted.'
  },
  {
    ask: 'Read my calendar, or put something on it.',
    because: 'Orbis has no calendar connection.',
    instead: 'Orbis keeps its own schedules, which are separate from your calendar.'
  },
  {
    ask: 'Keep running after I close Orbis.',
    because: 'The scheduler lives inside Orbis, so closing it stops the clock.',
    instead: 'Orbis catches up on what was missed the next time it opens.'
  },
  {
    ask: 'Run to the second, exactly.',
    because:
      'A computer can sleep, be busy, or be woken late, so nothing here promises a precise instant. Schedules are' +
      ' checked about every half minute.',
    instead: 'Orbis records the moment each run actually happened, so nothing is guessed about afterwards.'
  },
  {
    ask: 'Buy, sell or transfer anything on a schedule.',
    because: 'Orbis will not move money or place an order, whether asked now or asked for later.',
    instead: 'Orbis can open the page at that moment so you can decide then.'
  }
])

/**
 * The honest answer to "can this run while my computer is off?".
 *
 * A single function so that one sentence is used everywhere, rather than each screen writing its own hedge.
 */
export function answerAboutOffline(action: TemporalAction): string {
  const need = requirementsOf(action)
  if (!need.needsThisComputer) return 'This can run without your computer being on.'
  return 'No. This runs on this computer, so it needs Orbis open. If it is not, Orbis will run it when you next open it.'
}

/** Whether a request in somebody's words is one of the things Orbis cannot do. Simple word overlap, deliberately. */
export function findUnsupported(said: string): Unsupported | null {
  const text = said.toLowerCase()
  const groups: readonly [readonly string[], number][] = [
    [['whatsapp', 'slack', 'telegram', 'discord', 'text my', 'message my', 'dm '], 1],
    [['email', 'e-mail', 'mail to', 'send an email'], 2],
    [['calendar', 'google cal', 'outlook'], 3],
    [['computer is off', 'laptop is off', 'while im asleep', "while i'm asleep", 'when my pc is off', 'shut down'], 0],
    [['buy ', 'sell ', 'transfer ', 'invest ', 'order '], 6]
  ]
  for (const [words, index] of groups) {
    if (words.some((w) => text.includes(w))) return UNSUPPORTED[index]
  }
  return null
}
