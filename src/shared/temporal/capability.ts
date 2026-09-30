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
  /** Whether a Telegram bot token is needed. Held in the Secrets Vault, never in the schedule. */
  needsTelegramToken: boolean
}

export function requirementsOf(action: TemporalAction): Requirements {
  const browser = ['openUrl', 'openWorkspace', 'openPage', 'refreshUrl', 'closeTabs'].includes(action.kind)
  return {
    /*
     * Everything needs this computer today, including the two marked `external`.
     *
     * The target says where an action *could* run; this says where it *does*. They differ for a webhook and a
     * Telegram message, and conflating them would have Orbis promise something no part of it can deliver.
     */
    needsThisComputer: true,
    needsBrowser: browser,
    // A workflow's own steps may or may not need the network; assuming they might is the safe direction.
    needsNetwork: browser || ['orion', 'workflow', 'webhook', 'telegram'].includes(action.kind),
    needsModel: action.kind === 'orion',
    needsTelegramToken: action.kind === 'telegram'
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
  /** Whether a Telegram bot token has been put in the vault. */
  hasTelegramToken: boolean
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
  if (need.needsTelegramToken && !device.hasTelegramToken) {
    // Same shape: a missing token is a thing to go and fix, not a thing to wait for.
    reasons.push('There is no Telegram bot token in the Secrets Vault, so Orbis cannot send the message.')
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
    ask: 'Run this while my computer is switched off.',
    because: 'Everything Orbis schedules runs on this computer. There is no Orbis server to run it anywhere else.',
    instead: 'Orbis runs it the moment the computer is on again, and says how late it was.'
  },
  {
    ask: 'Run this while my computer is asleep.',
    /*
     * Asleep is not off, and this is the one of these that has an answer.
     *
     * Kept separate from being switched off for exactly that reason -- answering both with "no" would be wrong, and
     * answering both with "yes" would be worse.
     */
    because:
      'A sleeping computer can be woken for it, if you switch on "Wake this computer for a schedule" in Settings.' +
      ' Windows will not honour that while wake timers are off for the power plan, which on a laptop usually means' +
      ' while it is on battery.',
    instead: 'With that off, Orbis runs it when the computer next wakes and says how late it was.'
  },
  {
    ask: 'Send a WhatsApp message on a schedule.',
    because:
      'Sending on WhatsApp officially needs a business account and an approved template. Anything else means an' +
      ' unofficial client, which gets the number banned.',
    instead: 'Telegram works: a bot token in the Secrets Vault and a chat id, and Orbis can send you a message there.'
  },
  {
    ask: 'Post to Slack or Discord on a schedule.',
    because: 'Orbis has no connection to either, and no permission to act in your accounts.',
    instead:
      'Both let you make an incoming webhook, which is an address you own. Give Orbis that and it can post to it as' +
      ' an ordinary web request.'
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
    ask: 'Keep running after I close the Orbis window.',
    because:
      'The scheduler lives inside Orbis, so by default closing the window stops the clock. Switching on "Keep' +
      ' schedules running when you close Orbis" in Settings leaves it running with no window instead, with a tray' +
      ' icon and a way to quit.',
    instead: 'With that off, Orbis catches up on what was missed the next time it opens.'
  },
  {
    ask: 'Run to the second, exactly.',
    because:
      'A computer can sleep, be busy, or be woken late, so nothing here promises a precise instant. Schedules are' +
      ' checked about every half minute.',
    instead: 'Orbis records the moment each run actually happened, so nothing is guessed about afterwards.'
  },
  {
    ask: 'Only run when I am on wifi.',
    because:
      'Orbis cannot tell a metered connection from an unmetered one on this computer. It can only tell whether' +
      ' you are connected at all.',
    instead: 'Orbis will run it whenever there is a connection.'
  },
  {
    ask: 'Buy, sell or transfer anything on a schedule.',
    because: 'Orbis will not move money or place an order, whether asked now or asked for later.',
    instead: 'Orbis can open the page at that moment so you can decide then.'
  }
])

/**
 * Whether this action is one that *could* run somewhere other than this computer.
 *
 * Not whether it does -- nothing does, because there is no Orbis server. This is the difference between "this can
 * never run off your machine" and "this needs somewhere to run and there is nowhere yet", which are different
 * answers and deserve different words.
 */
export function couldRunElsewhere(action: TemporalAction): boolean {
  return TARGET_OF[action.kind] === 'external'
}

/**
 * The honest answer to "can this run while my computer is off?".
 *
 * A single function so that one sentence is used everywhere, rather than each screen writing its own hedge.
 */
export function answerAboutOffline(action: TemporalAction): string {
  if (couldRunElsewhere(action)) {
    return (
      'Not today. This one is only a web request, so it is the kind of thing that could run somewhere else -- but' +
      ' there is no Orbis server, so it runs here. Orbis can stay running with no window, and can wake a sleeping' +
      ' computer, if you switch both on in Settings.'
    )
  }
  return (
    'No. This runs on this computer, so it needs Orbis running. Orbis can stay running with no window, and can wake' +
    ' a sleeping computer, if you switch both on in Settings — but a computer that is switched off cannot be woken,' +
    ' and Orbis will run it when you next open it and say how late it was.'
  )
}

/** Whether a request in somebody's words is one of the things Orbis cannot do. Simple word overlap, deliberately. */
export function findUnsupported(said: string): Unsupported | null {
  const text = said.toLowerCase()
  const groups: readonly [readonly string[], number][] = [
    [['whatsapp'], 2],
    [['slack', 'discord'], 3],
    [['email', 'e-mail', 'mail to', 'send an email'], 4],
    [['calendar', 'google cal', 'outlook'], 5],
    /*
     * About the machine, not the person.
     *
     * "While I'm asleep" is not on either list, and deliberately: somebody asleep at three in the morning with their
     * computer on is a schedule Orbis keeps perfectly well, and refusing it would be wrong.
     */
    [['computer is off', 'laptop is off', 'pc is off', 'shut down', 'switched off', 'turned off', 'powered off'], 0],
    [['is asleep', 'while it sleeps', 'sleeping', 'sleep mode', 'lid is closed', 'lid closed'], 1],
    [['buy ', 'sell ', 'transfer ', 'invest ', 'order '], 9]
  ]
  for (const [words, index] of groups) {
    if (words.some((w) => text.includes(w))) return UNSUPPORTED[index]
  }
  return null
}
