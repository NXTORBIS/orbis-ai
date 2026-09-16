import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKUP_HEADROOM, directorySize, HEALTH_WATCH_SECONDS, Installer, validateInstall, watchdogScript } from './installer.ts'
import type { InstallPlan } from './installer.ts'

async function withTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-installer-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** An installation with a few files in it, and an updates folder beside it, the way the real thing is laid out. */
async function fakeInstall(root: string): Promise<InstallPlan> {
  const installDirectory = join(root, 'Program Files', 'Orbis')
  await mkdir(join(installDirectory, 'resources'), { recursive: true })
  await writeFile(join(installDirectory, 'Orbis.exe'), 'version 1.0.0 executable')
  await writeFile(join(installDirectory, 'resources', 'app.asar'), 'the application')
  const updates = join(root, 'AppData', 'Orbis', 'updates')
  await mkdir(updates, { recursive: true })
  const packagePath = join(updates, 'Orbis-Setup-1.1.0.exe')
  await writeFile(packagePath, 'the installer')
  return {
    packagePath,
    installDirectory,
    executablePath: join(installDirectory, 'Orbis.exe'),
    backupDirectory: join(updates, 'rollback'),
    fromVersion: '1.0.0',
    toVersion: '1.1.0'
  }
}

const installer = (patch: Partial<ConstructorParameters<typeof Installer>[0]> = {}): { installer: Installer; spawned: { command: string; args: string[] }[] } => {
  const spawned: { command: string; args: string[] }[] = []
  return {
    spawned,
    installer: new Installer({
      pid: 4242,
      platform: 'win32',
      freeSpace: async () => 10_000_000_000,
      spawnDetached: async (command, args) => {
        spawned.push({ command, args })
      },
      ...patch
    })
  }
}

test('the installation is copied aside before anything is replaced', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const { installer: it } = installer()
    const result = await it.backup(plan)
    assert.equal(result.ok, true, result.ok ? '' : result.reason)
    assert.equal(await readFile(join(plan.backupDirectory, 'Orbis.exe'), 'utf8'), 'version 1.0.0 executable')
    assert.equal(await readFile(join(plan.backupDirectory, 'resources', 'app.asar'), 'utf8'), 'the application', 'everything, not just the top level')
  })
})

test('an update with no room to keep a copy is not begun', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const size = await directorySize(plan.installDirectory)
    assert.ok(size > 0)
    // Exactly the size of the installation is not enough: the copy wants a little more than that.
    const { installer: it } = installer({ freeSpace: async () => size })
    const result = await it.backup(plan)
    assert.equal(result.ok, false, `${BACKUP_HEADROOM}x the installation is wanted`)
    assert.match(result.ok ? '' : result.reason, /not enough room/)
  })
})

test('an installation that cannot be found is not updated over', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const { installer: it } = installer()
    const result = await it.backup({ ...plan, installDirectory: join(root, 'nowhere') })
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.reason, /could not be found/)
  })
})

test('handing over starts something detached that will outlive Orbis', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const { installer: it, spawned } = installer()
    await it.backup(plan)
    const result = await it.handOver(plan)
    assert.equal(result.ok, true, result.ok ? '' : result.reason)
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0].command, 'powershell.exe')
    assert.ok(spawned[0].args.includes('-File'), 'it runs the script that was written')

    const scriptPath = spawned[0].args.at(-1)!
    const script = await readFile(scriptPath, 'utf8')
    assert.match(script, /waiting for Orbis to close/)
  })
})

test('the script waits for this Orbis to go, installs, and starts what it installed', () => {
  const plan: InstallPlan = {
    packagePath: 'C:/updates/Orbis-Setup-1.1.0.exe',
    installDirectory: 'C:/Program Files/Orbis',
    executablePath: 'C:/Program Files/Orbis/Orbis.exe',
    backupDirectory: 'C:/updates/rollback',
    fromVersion: '1.0.0',
    toVersion: '1.1.0'
  }
  const script = watchdogScript(plan, 4242)
  assert.match(script, /Get-Process -Id 4242/, 'it waits for this Orbis in particular')
  assert.match(script, /Orbis-Setup-1\.1\.0\.exe/)
  assert.match(script, /'\/S'/, 'the installer runs without asking anything')
  assert.match(script, /-Wait/, 'and is waited for rather than left to it')
  assert.match(script, /Start-Process -FilePath 'C:\/Program Files\/Orbis\/Orbis\.exe' -PassThru/)
})

test('the script puts the old version back if the installer fails, or if the new Orbis will not stay running', () => {
  const plan: InstallPlan = {
    packagePath: 'C:/updates/s.exe',
    installDirectory: 'C:/Program Files/Orbis',
    executablePath: 'C:/Program Files/Orbis/Orbis.exe',
    backupDirectory: 'C:/updates/rollback',
    fromVersion: '1.0.0',
    toVersion: '1.1.0'
  }
  const script = watchdogScript(plan, 1, 20)
  // The installer itself going wrong.
  assert.match(script, /ExitCode -ne 0/)
  // And the case nothing inside Orbis could ever catch: the new version not starting at all.
  assert.match(script, /Start-Sleep -Seconds 20/)
  assert.match(script, /HasExited/)
  assert.equal((script.match(/putting the previous version back/g) ?? []).length, 2, 'both ways back are covered')
  assert.match(script, /--orbis-update-rolled-back/, 'and the Orbis that comes back knows why')
  assert.equal(HEALTH_WATCH_SECONDS > 0, true)
})

test('a path with a quote in it cannot break out of the script', () => {
  const plan: InstallPlan = {
    packagePath: "C:/updates/it's here.exe",
    installDirectory: "C:/Program Files/O'rbis",
    executablePath: "C:/Program Files/O'rbis/Orbis.exe",
    backupDirectory: 'C:/updates/rollback',
    fromVersion: '1.0.0',
    toVersion: '1.1.0'
  }
  const script = watchdogScript(plan, 1)
  assert.match(script, /'C:\/updates\/it''s here\.exe'/, 'a quote is doubled rather than ending the string')
  assert.doesNotMatch(script, /it's here\.exe'\s*-/, 'the argument does not end early')
})

test('putting the previous version back restores what was copied', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const { installer: it } = installer()
    await it.backup(plan)

    // A bad install: the executable is replaced with something broken and a file goes missing.
    await writeFile(plan.executablePath, 'a broken 1.1.0')
    await rm(join(plan.installDirectory, 'resources', 'app.asar'), { force: true })

    const restored = await it.restore(plan)
    assert.equal(restored.ok, true, restored.ok ? '' : restored.reason)
    assert.equal(await readFile(plan.executablePath, 'utf8'), 'version 1.0.0 executable')
    assert.equal(await readFile(join(plan.installDirectory, 'resources', 'app.asar'), 'utf8'), 'the application')
  })
})

test('there is nothing to go back to when no copy was made, and that is said plainly', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const { installer: it } = installer()
    const result = await it.restore(plan)
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.reason, /no copy of the previous version/)
  })
})

test('clearing up removes the updater’s own leavings and nothing else', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const { installer: it } = installer()
    await it.backup(plan)
    await it.handOver(plan)
    await it.cleanUp(plan)

    assert.equal(await directorySize(plan.backupDirectory), 0, 'the copy is gone')
    await assert.rejects(() => readFile(plan.packagePath), 'and so is the package')
    // The installation itself is untouched.
    assert.equal(await readFile(plan.executablePath, 'utf8'), 'version 1.0.0 executable')
  })
})

test('an update is only successful if what is running is what was installed', () => {
  assert.equal(validateInstall({ runningVersion: '1.1.0', expectedVersion: '1.1.0', profilesReadable: true }).ok, true)

  // An installer that quietly did nothing would otherwise look like success.
  const wrong = validateInstall({ runningVersion: '1.0.0', expectedVersion: '1.1.0', profilesReadable: true })
  assert.equal(wrong.ok, false)
  assert.match(wrong.ok ? '' : wrong.reason, /1\.1\.0 was expected.*1\.0\.0 is running/)

  const unreadable = validateInstall({ runningVersion: '1.1.0', expectedVersion: '1.1.0', profilesReadable: false })
  assert.equal(unreadable.ok, false)
  assert.match(unreadable.ok ? '' : unreadable.reason, /profiles could not be read/)
})

test('updating is refused outright where it is not yet supported, rather than half-attempted', async () => {
  await withTemp(async (root) => {
    const plan = await fakeInstall(root)
    const { installer: it, spawned } = installer({ platform: 'darwin' })
    const result = await it.handOver(plan)
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.reason, /only supported on Windows/)
    assert.equal(spawned.length, 0, 'nothing was started')
  })
})
