/**
 * What this computer can actually be woken from, read from the computer rather than assumed.
 *
 * A schedule only happens if Orbis is running when it comes due, and whether that can be arranged depends entirely on
 * how the machine was left: asleep, hibernated, or switched off. Those three have different answers, and the answers
 * are properties of this particular machine's firmware and power plan -- not something to guess at.
 *
 * So this reads `powercfg`, which is part of Windows, and turns what it says into findings a person can act on. The
 * reading and the explaining are separate: `explainPower` is pure and tested, and `readPower` is the small part that
 * runs the command.
 *
 * ## What it will not do
 *
 * **It changes nothing.** Not a power setting, not a firmware setting, not an adapter setting. It reads, and it says
 * what it found. Which settings a computer uses is the owner's business, and a wrong write to a firmware settings
 * area can leave a machine that will not start.
 *
 * **It never guesses when it cannot read.** `powercfg` prints in the language Windows is installed in, so a machine
 * in another language may give text this cannot interpret. That is reported as "Orbis could not tell", never as a
 * cheerful yes or a discouraging no.
 *
 * **It never claims a switched-off computer can be woken.** Nothing in Windows can start a computer that is off,
 * because Windows is not running. That needs the motherboard's own alarm, which is firmware, and the finding says so
 * and names what to look for rather than pretending there is a button here.
 */

/** What `powercfg` said, as facts rather than as prose. Each may be null, meaning it could not be read. */
export interface PowerFacts {
  /** Whether the machine can sleep at all. */
  canSleep: boolean | null
  /** Whether hibernate is available. Often off by default on a laptop, and it is the one that matters most here. */
  canHibernate: boolean | null
  /** Why hibernate is unavailable, in Windows's own words, when it said. */
  hibernateBecause: string | null
  /** Whether a timer may wake the machine, plugged in and on battery. 0 no, 1 yes, 2 only important ones. */
  wakeTimersOnPower: 0 | 1 | 2 | null
  wakeTimersOnBattery: 0 | 1 | 2 | null
  /** Whether Orbis's own wake task is registered. */
  taskRegistered: boolean
  /** Whether this is a machine any of it applies to. */
  windows: boolean
}

export type Standing = 'good' | 'fixable' | 'impossible' | 'unknown'

export interface Finding {
  /** The state the machine might be left in. */
  state: 'sleep' | 'hibernate' | 'shutdown'
  title: string
  standing: Standing
  /** What is true, in plain words. */
  detail: string
  /** What would change it, when anything would. Null when nothing can. */
  todo: string | null
  /** Whether Orbis itself can do the fixing, which for all of these is no except switching its own settings on. */
  orbisCanFix: boolean
}

const FROM_HEX = (raw: string): 0 | 1 | 2 | null => {
  const value = Number.parseInt(raw, 16)
  return value === 0 || value === 1 || value === 2 ? value : null
}

/**
 * Reads the list of sleep states out of `powercfg /a`.
 *
 * Deliberately token-based rather than line-based. The headings are translated on a non-English Windows but the state
 * names -- "Standby (S3)", "Hibernate" -- are not, so looking for those and for which section they fall in survives
 * a translated heading. When neither section can be identified at all, everything comes back null.
 */
export function parseAvailability(output: string): Pick<PowerFacts, 'canSleep' | 'canHibernate' | 'hibernateBecause'> {
  const blocks = output.split(/\r?\n\r?\n/)
  let canSleep: boolean | null = null
  let canHibernate: boolean | null = null
  let hibernateBecause: string | null = null

  /**
   * Which block is which is decided by "not", which is the one word that has to be right.
   *
   * Reading it the wrong way round would tell somebody their computer can hibernate when it cannot, which is worse
   * than admitting the text could not be read -- so anything that does not clearly say either is left as unknown.
   */
  for (const block of blocks) {
    const lower = block.toLowerCase()
    const isAvailable = /available on this system/.test(lower) && !/not available/.test(lower)
    const isUnavailable = /not available on this system/.test(lower)
    if (!isAvailable && !isUnavailable) continue

    const mentionsSleep = /standby \(s[0-3]\)|\bsleep\b|modern standby|s0 low power idle/.test(lower)
    const mentionsHibernate = /hibernat/.test(lower)

    if (mentionsSleep) canSleep = isAvailable ? true : canSleep === true ? true : false
    if (mentionsHibernate) {
      canHibernate = isAvailable ? true : canHibernate === true ? true : false
      if (isUnavailable) {
        // Windows gives a reason under the state, and it is the actionable part: usually that it was never enabled.
        const after = block.slice(lower.indexOf('hibernat'))
        const reason = after.split(/\r?\n/).slice(1).map((l) => l.trim()).find((l) => l.length > 0)
        if (reason) hibernateBecause = reason.slice(0, 200)
      }
    }
  }

  return { canSleep, canHibernate, hibernateBecause }
}

/**
 * Reads the two wake-timer settings out of `powercfg /q` for the wake timer setting.
 *
 * The labels are translated; the hex values are not. So the AC and DC markers are looked for first, and when the
 * text cannot be matched at all the last two hex values in the block are used in order -- which is the order
 * `powercfg` prints them in on every version of Windows.
 */
export function parseWakeTimers(output: string): Pick<PowerFacts, 'wakeTimersOnPower' | 'wakeTimersOnBattery'> {
  const ac = /\bAC\b[^\n]*?(0x[0-9a-fA-F]{1,8})/.exec(output)
  const dc = /\bDC\b[^\n]*?(0x[0-9a-fA-F]{1,8})/.exec(output)
  if (ac && dc) {
    return { wakeTimersOnPower: FROM_HEX(ac[1]), wakeTimersOnBattery: FROM_HEX(dc[1]) }
  }
  const all = [...output.matchAll(/0x[0-9a-fA-F]{1,8}/g)].map((m) => m[0])
  if (all.length >= 2) {
    return {
      wakeTimersOnPower: FROM_HEX(all[all.length - 2]),
      wakeTimersOnBattery: FROM_HEX(all[all.length - 1])
    }
  }
  return { wakeTimersOnPower: null, wakeTimersOnBattery: null }
}

const TIMER_WORDS = (value: 0 | 1 | 2 | null): string => {
  if (value === null) return 'Orbis could not tell'
  if (value === 0) return 'off'
  if (value === 2) return 'on for important timers only'
  return 'on'
}

/**
 * What the facts mean for each way of leaving the computer.
 *
 * Three findings, always, in the order somebody would think about them. Each says where it stands and what would
 * change it, and the one that cannot be changed from here says so plainly rather than being left out.
 */
export function explainPower(facts: PowerFacts): Finding[] {
  if (!facts.windows) {
    return [
      {
        state: 'sleep',
        title: 'Waking this computer',
        standing: 'impossible',
        detail: 'Waking a computer for a schedule is something Orbis can only arrange on Windows.',
        todo: null,
        orbisCanFix: false
      }
    ]
  }

  const findings: Finding[] = []

  // ---- asleep
  const timersOff = facts.wakeTimersOnPower === 0
  const batteryOff = facts.wakeTimersOnBattery === 0
  findings.push({
    state: 'sleep',
    title: 'If you leave it asleep',
    standing:
      facts.canSleep === false
        ? 'impossible'
        : facts.wakeTimersOnPower === null
          ? 'unknown'
          : timersOff
            ? 'fixable'
            : 'good',
    detail:
      facts.canSleep === false
        ? 'This computer cannot sleep, so there is nothing to wake it from.'
        : `Wake timers are ${TIMER_WORDS(facts.wakeTimersOnPower)} while plugged in, and ` +
          `${TIMER_WORDS(facts.wakeTimersOnBattery)} on battery.` +
          (facts.taskRegistered ? ' Orbis has a wake booked for the next thing due.' : ' Orbis has nothing booked.'),
    todo: timersOff
      ? 'Turn on “Allow wake timers” in Windows power options, under Sleep, for the plan you use.'
      : batteryOff
        ? 'On battery, wake timers are off, so a laptop running on battery will not wake. Plugged in it will.'
        : null,
    orbisCanFix: false
  })

  // ---- hibernated
  findings.push({
    state: 'hibernate',
    title: 'If you leave it hibernated',
    standing: facts.canHibernate === null ? 'unknown' : facts.canHibernate ? (timersOff ? 'fixable' : 'good') : 'fixable',
    detail:
      facts.canHibernate === false
        ? `Hibernate is not available on this computer. ${facts.hibernateBecause ?? 'Windows did not say why.'}`
        : facts.canHibernate
          ? 'Hibernate is available, and a hibernated computer can be woken by a timer — so this is the closest thing' +
            ' to switching it off while still keeping your schedules.'
          : 'Orbis could not tell whether hibernate is available.',
    todo:
      facts.canHibernate === false
        ? 'Run “powercfg /hibernate on” in a terminal as administrator. Orbis will not do this for you: it is a' +
          ' change to your computer’s settings, and it needs administrator.'
        : timersOff
          ? 'Wake timers are off, so turn those on too — otherwise nothing will wake it.'
          : null,
    orbisCanFix: false
  })

  // ---- switched off
  findings.push({
    state: 'shutdown',
    title: 'If you switch it off',
    /*
     * Not "fixable", because nothing here can fix it.
     *
     * Windows is not running, so no timer inside Windows can start the machine. Only the motherboard's own alarm can,
     * and that is firmware: no program can set it safely, because where it lives differs by board and by firmware
     * version, and a wrong write there can leave a computer that will not start.
     */
    standing: 'impossible',
    detail:
      'Nothing in Orbis, or in Windows, can start a computer that is switched off. Orbis runs what was due the next' +
      ' time you turn it on, and says how late it was.',
    todo:
      'Only the motherboard can do it: look for “Resume by Alarm”, “Wake on RTC” or “Auto Power On” in your BIOS' +
      ' setup, under power management. Or hibernate instead of switching off, which keeps your schedules and uses no' +
      ' more power.',
    orbisCanFix: false
  })

  return findings
}

/** The one sentence to put at the top, given the findings. */
export function powerSummary(findings: readonly Finding[]): string {
  const sleep = findings.find((f) => f.state === 'sleep')
  const hibernate = findings.find((f) => f.state === 'hibernate')
  if (sleep?.standing === 'good' && hibernate?.standing === 'good') {
    return 'This computer can be woken for a schedule from sleep or hibernate. Only switching it off stops them.'
  }
  if (sleep?.standing === 'good') return 'This computer can be woken from sleep. Hibernate needs a change first.'
  if (sleep?.standing === 'unknown') return 'Orbis could not read this computer’s power settings.'
  return 'This computer will not be woken for a schedule until something below is changed.'
}
