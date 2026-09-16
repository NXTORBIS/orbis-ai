import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Putting a new Orbis in place, and putting the old one back when it does not work.
 *
 * Two things make this awkward, and both shape the design. A running application cannot replace its own files on
 * Windows, so whatever does the replacing has to live outside the installation and outlive Orbis. And if the new
 * version will not start at all, nothing inside Orbis is left to notice — so the same outside thing has to watch, and
 * put the old version back on its own.
 *
 * So: Orbis copies its installation aside, writes a short script, starts it detached and quits. The script waits for
 * Orbis to go, runs the installer, starts the new Orbis, and watches. If the new one is not still running a moment
 * later, it puts the copy back and starts that instead. Orbis itself then confirms, on its next start, that what is
 * installed is what was meant to be.
 *
 * The installation is the only thing any of this touches. Profiles live somewhere else entirely and are never part of
 * it — not copied, not replaced, not restored.
 */

/** How long the watchdog gives a new Orbis to still be running before deciding it is broken. */
export const HEALTH_WATCH_SECONDS = 20
/** Room wanted beyond the size of the installation itself, so the copy has somewhere to go. */
export const BACKUP_HEADROOM = 1.2

export interface InstallPlan {
  /** The verified package to run. */
  packagePath: string
  /** Where Orbis is installed, worked out rather than assumed. */
  installDirectory: string
  /** The executable to start afterwards. */
  executablePath: string
  /** Where the copy of the current installation goes. */
  backupDirectory: string
  fromVersion: string
  toVersion: string
}

export type InstallProblem = { ok: false; reason: string }
export type InstallOk = { ok: true }

export interface InstallerOptions {
  /** Starts the watchdog, detached, and returns once it is running rather than once it has finished. */
  spawnDetached(command: string, args: string[]): Promise<void>
  /** How much room the disk has where the copy would go. */
  freeSpace(path: string): Promise<number>
  /** The process id of this Orbis, so the script knows what to wait for. */
  pid: number
  platform?: NodeJS.Platform
}

/** How big a folder is, so the copy is not begun without knowing whether it will fit. */
export async function directorySize(path: string): Promise<number> {
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else {
        try {
          total += (await stat(full)).size
        } catch {
          // A file that vanished between listing and measuring is not worth failing over.
        }
      }
    }
  }
  await walk(path)
  return total
}

/**
 * The script that outlives Orbis. It is deliberately small and does only what cannot be done from inside: wait, run
 * the installer, start the result, and put the old one back if the result does not stay running.
 */
export function watchdogScript(plan: InstallPlan, pid: number, watchSeconds = HEALTH_WATCH_SECONDS): string {
  const q = (text: string): string => `'${text.replace(/'/g, "''")}'`
  return `# Orbis update. Runs after Orbis has closed; puts the previous version back if the new one will not stay up.
$ErrorActionPreference = 'Stop'
$log = ${q(join(plan.backupDirectory, '..', 'update.log'))}
function Note($m) { try { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format s), $m) } catch {} }

Note 'waiting for Orbis to close'
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 300
}
if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) {
  Note 'Orbis is still running; the update has been left alone'
  exit 1
}

Note 'installing ${plan.toVersion}'
$install = Start-Process -FilePath ${q(plan.packagePath)} -ArgumentList '/S' -Wait -PassThru
if ($install.ExitCode -ne 0) {
  Note ("the installer stopped with code " + $install.ExitCode)
  Note 'putting the previous version back'
  Copy-Item -Path (Join-Path ${q(plan.backupDirectory)} '*') -Destination ${q(plan.installDirectory)} -Recurse -Force
  Start-Process -FilePath ${q(plan.executablePath)} -ArgumentList '--orbis-update-failed'
  exit 1
}

Note 'starting the new Orbis'
$started = Start-Process -FilePath ${q(plan.executablePath)} -PassThru
Start-Sleep -Seconds ${watchSeconds}

if ($started.HasExited) {
  Note 'the new Orbis did not stay running; putting the previous version back'
  Copy-Item -Path (Join-Path ${q(plan.backupDirectory)} '*') -Destination ${q(plan.installDirectory)} -Recurse -Force
  Start-Process -FilePath ${q(plan.executablePath)} -ArgumentList '--orbis-update-rolled-back'
  exit 1
}

Note 'the update is in place'
exit 0
`
}

export class Installer {
  private readonly o: InstallerOptions

  constructor(options: InstallerOptions) {
    this.o = options
  }

  /**
   * Copies the installation aside so there is something to go back to. Nothing is installed until this has worked:
   * an update with no way back is not one worth starting.
   */
  async backup(plan: InstallPlan): Promise<InstallOk | InstallProblem> {
    const size = await directorySize(plan.installDirectory)
    if (size === 0) return { ok: false, reason: 'the Orbis installation could not be found' }
    const free = await this.o.freeSpace(plan.backupDirectory)
    if (free < size * BACKUP_HEADROOM) {
      return { ok: false, reason: `there is not enough room to keep a copy of the current version (${Math.ceil((size * BACKUP_HEADROOM) / 1_000_000)} MB needed)` }
    }
    try {
      await rm(plan.backupDirectory, { recursive: true, force: true })
      await mkdir(plan.backupDirectory, { recursive: true })
      await cp(plan.installDirectory, plan.backupDirectory, { recursive: true })
    } catch (err) {
      return { ok: false, reason: `the current version could not be copied (${err instanceof Error ? err.message : String(err)})` }
    }
    return { ok: true }
  }

  /**
   * Hands over to the watchdog and returns. Orbis is expected to quit immediately afterwards: everything from here
   * happens outside it.
   */
  async handOver(plan: InstallPlan): Promise<InstallOk | InstallProblem> {
    if ((this.o.platform ?? process.platform) !== 'win32') {
      return { ok: false, reason: 'installing updates is only supported on Windows so far' }
    }
    const scriptPath = join(plan.backupDirectory, '..', 'install.ps1')
    try {
      await mkdir(join(plan.backupDirectory, '..'), { recursive: true })
      await writeFile(scriptPath, watchdogScript(plan, this.o.pid), 'utf8')
      await this.o.spawnDetached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath])
    } catch (err) {
      return { ok: false, reason: `the update could not be started (${err instanceof Error ? err.message : String(err)})` }
    }
    return { ok: true }
  }

  /** Puts the copy back, for the case where Orbis itself is the one that noticed something was wrong. */
  async restore(plan: InstallPlan): Promise<InstallOk | InstallProblem> {
    try {
      if ((await directorySize(plan.backupDirectory)) === 0) return { ok: false, reason: 'there is no copy of the previous version to go back to' }
      await cp(plan.backupDirectory, plan.installDirectory, { recursive: true, force: true })
    } catch (err) {
      return { ok: false, reason: `the previous version could not be put back (${err instanceof Error ? err.message : String(err)})` }
    }
    return { ok: true }
  }

  /** Clears away what an update leaves behind. Never touches anything but the updater's own folder. */
  async cleanUp(plan: InstallPlan): Promise<void> {
    await rm(plan.backupDirectory, { recursive: true, force: true }).catch(() => undefined)
    await rm(plan.packagePath, { force: true }).catch(() => undefined)
    await rm(join(plan.backupDirectory, '..', 'install.ps1'), { force: true }).catch(() => undefined)
  }
}

/**
 * Whether what is now installed is what was meant to be. Called by the new Orbis on its first start after an update:
 * being able to run at all is most of the answer, but the version has to be right as well, or an installer that
 * quietly did nothing would look like success.
 */
export function validateInstall(o: { runningVersion: string; expectedVersion: string; profilesReadable: boolean }): InstallOk | InstallProblem {
  if (o.runningVersion !== o.expectedVersion) {
    return { ok: false, reason: `Orbis ${o.expectedVersion} was expected after the update, but ${o.runningVersion} is running` }
  }
  if (!o.profilesReadable) return { ok: false, reason: 'your Orbis profiles could not be read after the update' }
  return { ok: true }
}
