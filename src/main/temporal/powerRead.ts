import { execFile } from 'node:child_process'
import { explainPower, parseAvailability, parseWakeTimers, powerSummary, type Finding, type PowerFacts } from './power.ts'
import { wakeExists, wakeIsPossible } from './windowsWake.ts'

/**
 * Asking this computer what it can be woken from, and putting it to sleep in a way that can be.
 *
 * Two commands, both part of Windows, both read-only except the one that hibernates -- and that one is an action
 * somebody asked for, not a setting being changed behind their back.
 *
 * The reading and the meaning are apart on purpose: `power.ts` decides what the answers mean and is tested without a
 * computer, and this file is the small part that runs `powercfg`.
 *
 * ## What it will not do
 *
 * **It changes no setting.** Not power, not firmware, not a network adapter. `powercfg /hibernate on` needs
 * administrator and is a change to somebody's computer; Orbis prints the command and lets them decide. The one thing
 * it will do is hibernate now, when asked, which is the same thing the Start menu does.
 *
 * **It never reports a hibernate that did not happen.** If hibernate is switched off, the command fails, and that
 * failure is passed on with what Windows said rather than a hopeful "done".
 */

/** The wake-timer setting, by the ids Windows uses. Not translated, unlike everything it prints. */
const SLEEP_GROUP = '238c9fa8-0aad-41ed-83f4-97be242c8f20'
const WAKE_TIMERS = 'bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d'

function run(command: string, args: readonly string[], timeout = 10_000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(command, [...args], { windowsHide: true, timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout ?? ''}${stderr ?? ''}`.trim() })
    })
  })
}

export interface PowerReport {
  facts: PowerFacts
  findings: Finding[]
  summary: string
}

/** What this computer can be woken from, read now. */
export async function readPower(): Promise<PowerReport> {
  if (!wakeIsPossible()) {
    const facts: PowerFacts = {
      canSleep: null,
      canHibernate: null,
      hibernateBecause: null,
      wakeTimersOnPower: null,
      wakeTimersOnBattery: null,
      taskRegistered: false,
      windows: false
    }
    const findings = explainPower(facts)
    return { facts, findings, summary: powerSummary(findings) }
  }

  const [states, timers, task] = await Promise.all([
    run('powercfg', ['/a']),
    run('powercfg', ['/q', 'SCHEME_CURRENT', SLEEP_GROUP, WAKE_TIMERS]),
    wakeExists()
  ])

  const facts: PowerFacts = {
    ...parseAvailability(states.ok ? states.output : ''),
    ...parseWakeTimers(timers.ok ? timers.output : ''),
    taskRegistered: task,
    windows: true
  }
  const findings = explainPower(facts)
  return { facts, findings, summary: powerSummary(findings) }
}

/**
 * Hibernates now.
 *
 * `shutdown /h` is exactly what the Start menu's own Hibernate does: the session is written to disk and the machine
 * powers down. Nothing is lost, and a timer can wake it -- which is the whole reason for offering it.
 */
export async function hibernateNow(): Promise<{ ok: boolean; detail: string }> {
  if (!wakeIsPossible()) return { ok: false, detail: 'Orbis can only hibernate a Windows computer.' }
  const result = await run('shutdown', ['/h'], 8000)
  if (result.ok) return { ok: true, detail: 'Hibernating.' }
  /**
   * The usual reason is that hibernate was never switched on.
   *
   * Said with the fix rather than as a bare failure, because "it did not work" leaves somebody nowhere and the fix
   * is one command they can run themselves.
   */
  const hint = /not enabled|hiberfil|1717|不支持|nicht/i.test(result.output)
    ? ' Hibernate is probably switched off: run “powercfg /hibernate on” in a terminal as administrator.'
    : ''
  return { ok: false, detail: `Windows would not hibernate.${hint} ${result.output}`.trim().slice(0, 300) }
}
