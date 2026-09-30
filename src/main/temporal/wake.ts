import type { TemporalJob } from '../../shared/temporal/job.ts'

/**
 * Keeping the clock alive, and waking a sleeping computer for it.
 *
 * Orbis has no server, so a schedule only happens while Orbis is running. Two things narrow that gap a long way
 * without any server at all, and this file is the part of both that can be decided and tested without touching the
 * operating system:
 *
 * **Closing the window need not stop the clock.** Today it does -- the last window closing quits Orbis. If somebody
 * has asked for their schedules to keep going, Orbis can stay running with nothing on screen instead.
 *
 * **Asleep is not off.** Windows can wake a sleeping machine to run something. So Orbis can ask it to, for the one
 * moment its next schedule is due, and go back to sleep afterwards.
 *
 * ## What it will not do
 *
 * **It never keeps Orbis running invisibly without saying so.** Staying alive is asked for, and when it happens
 * there is a tray icon with a way to quit. A process that keeps running with no way to see or stop it is not a
 * feature.
 *
 * **It never claims a machine can be woken when it cannot.** Powered fully off, hibernated with wake timers
 * disabled, or a laptop on battery with the setting off -- none of those can be woken, and the wording says so
 * rather than implying the schedule will happen.
 *
 * **It never asks for one wake per schedule.** One task, for the next due moment, rewritten as that moment changes.
 * A dozen schedules do not become a dozen tasks.
 */

/** The name the task goes under. One task, replaced, never a growing collection. */
export const WAKE_TASK_NAME = 'Orbis\\OrbisWake'

/**
 * How far ahead a wake is worth asking for.
 *
 * Something due in two minutes will still be due when the machine wakes on its own, and a wake every couple of
 * minutes is how a laptop never actually sleeps. Something more than a fortnight away is not worth a standing task.
 */
export const WAKE_SOONEST_MS = 5 * 60_000
export const WAKE_FURTHEST_MS = 14 * 86_400_000

/** Whether Orbis should stay running with its window closed, and why. */
export function shouldStayAlive(
  jobs: readonly TemporalJob[],
  asked: boolean
): { stay: boolean; because: string } {
  if (!asked) return { stay: false, because: 'Schedules stop when you close Orbis, because that is how it is set.' }
  const live = jobs.filter((j) => j.nextRunAt !== null && j.state !== 'cancelled' && j.state !== 'paused')
  if (live.length === 0) {
    // Nothing to stay alive *for*. Staying anyway would be a process running for no reason.
    return { stay: false, because: 'Nothing is scheduled, so Orbis has no reason to keep running.' }
  }
  return {
    stay: true,
    because: `Orbis is still running for ${live.length} schedule${live.length === 1 ? '' : 's'}. Quit it from the tray.`
  }
}

/** The next moment worth waking the machine for, or null when there is none. */
export function earliestWake(jobs: readonly TemporalJob[], now: number): number | null {
  let soonest: number | null = null
  for (const job of jobs) {
    if (job.state === 'cancelled' || job.state === 'paused') continue
    const at = job.nextRunAt
    if (at === null) continue
    // Too soon to be worth a wake, or too far off to hold a standing task for.
    if (at - now < WAKE_SOONEST_MS || at - now > WAKE_FURTHEST_MS) continue
    if (soonest === null || at < soonest) soonest = at
  }
  return soonest
}

/** Local wall time in the format Task Scheduler wants, which is a local time with no zone on it. */
export function taskTime(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

/** XML characters that would otherwise end the document early. */
function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The task, as Task Scheduler's own XML.
 *
 * XML rather than `schtasks` arguments because the flag that matters -- wake the computer to run this -- has no
 * command-line switch. Everything else here is about being a well-behaved guest: one run, no retries, a short time
 * limit, and it does not start if the machine is already busy shutting down.
 */
export function wakeTaskXml(at: number, command: string, args: readonly string[] = []): string {
  const argText = args.join(' ')
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Wakes this computer for the next thing Orbis has scheduled. Orbis rewrites it as that moment changes, and removes it when nothing is scheduled.</Description>
    <URI>\\${escaped(WAKE_TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${taskTime(at)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <!-- The whole point of the task. Without this it simply runs late, when the machine happens to wake. -->
    <WakeToRun>true</WakeToRun>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowHardTerminate>true</AllowHardTerminate>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escaped(command)}</Command>${argText ? `\n      <Arguments>${escaped(argText)}</Arguments>` : ''}
    </Exec>
  </Actions>
</Task>
`
}

/**
 * What to say about waking, given what is actually known.
 *
 * Written here rather than on the screen so that the caveats cannot drift apart from each other, and so the wording
 * never implies more than the operating system will really do.
 */
export function wakeWording(at: number | null): string {
  if (at === null) return 'Nothing is close enough to be worth waking this computer for.'
  const when = new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })
  return (
    `Windows will wake this computer at ${when} for the next thing due. It cannot be woken if it is fully switched` +
    ' off, or if wake timers are turned off for the power plan — on a laptop they are often off on battery.'
  )
}
