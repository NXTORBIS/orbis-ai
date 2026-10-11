import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WAKE_TASK_NAME, wakeTaskXml } from './wake.ts'

/**
 * Asking Windows to wake this computer for the next thing Orbis has scheduled.
 *
 * The decisions -- whether a wake is worth asking for, when, and what to say about it -- are all in `wake.ts`, which
 * is pure. This is only the part that talks to the operating system, and it is deliberately small.
 *
 * It uses Task Scheduler, through `schtasks`, which is on every Windows install. Nothing is downloaded, nothing runs
 * as administrator, and the task is a per-user one: it can only do what the person could do themselves.
 *
 * ## What it will not do
 *
 * **It never touches anything but its own task.** One name, replaced and deleted. It does not read, change or list
 * anybody else's tasks, and it makes no change to power settings or security settings of any kind.
 *
 * **It never claims the machine will wake.** Whether a wake timer is honoured is a power-plan setting and, on a
 * laptop, usually off on battery. So this reports what it did -- the task exists -- and the wording alongside says
 * plainly what that does not guarantee.
 *
 * **It never leaves a task behind.** When nothing is scheduled the task is removed, so a machine does not keep
 * waking for an Orbis that has nothing to do.
 */

export interface WakeOutcome {
  ok: boolean
  /** What happened, in words somebody can act on. */
  detail: string
}

/** Whether this is a machine where any of it applies. */
export function wakeIsPossible(platform: string = process.platform): boolean {
  return platform === 'win32'
}

function run(args: readonly string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('schtasks', [...args], { windowsHide: true, timeout: 15_000 }, (error, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`.trim()
      resolve({ ok: !error, output: output.slice(0, 400) })
    })
  })
}

/**
 * Registers, or replaces, the one wake task.
 *
 * Written as XML to a temporary file because the flag that matters -- wake the computer to run this -- has no
 * command-line switch. The file is removed afterwards whatever happens, since it holds the path to Orbis and there
 * is no reason for it to linger.
 */
export async function applyWake(at: number, command: string, args: readonly string[] = []): Promise<WakeOutcome> {
  if (!wakeIsPossible()) return { ok: false, detail: 'Waking the computer for a schedule is only possible on Windows.' }

  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'orbis-wake-'))
    const path = join(dir, 'wake.xml')
    // UTF-16 with a byte order mark, which is what Task Scheduler's own exports are and what it reads reliably.
    await writeFile(path, `﻿${wakeTaskXml(at, command, args)}`, 'utf16le')
    const result = await run(['/Create', '/TN', WAKE_TASK_NAME, '/XML', path, '/F'])
    if (!result.ok) {
      return {
        ok: false,
        detail: `Windows would not accept the wake task. ${result.output || 'It gave no reason.'}`.slice(0, 300)
      }
    }
    return { ok: true, detail: 'Windows will wake this computer for the next thing due.' }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : 'The wake task could not be written.' }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined)
  }
}

/** Removes the task. Not finding one is a success: the point is that it is gone. */
export async function clearWake(): Promise<WakeOutcome> {
  if (!wakeIsPossible()) return { ok: true, detail: 'There was nothing to remove.' }
  const result = await run(['/Delete', '/TN', WAKE_TASK_NAME, '/F'])
  if (!result.ok && !/cannot find|does not exist/i.test(result.output)) {
    return { ok: false, detail: `The wake task could not be removed. ${result.output}`.slice(0, 300) }
  }
  return { ok: true, detail: 'This computer will not be woken for schedules.' }
}

/** Whether the task is there, for a screen that should not claim more than it knows. */
export async function wakeExists(): Promise<boolean> {
  if (!wakeIsPossible()) return false
  return (await run(['/Query', '/TN', WAKE_TASK_NAME])).ok
}
