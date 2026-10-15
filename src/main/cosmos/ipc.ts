import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { plainHandle, plainListen } from '../ipc/handle.ts'
import { findWindowByClass, hwndFromHandle } from '../chromium/embed.ts'
import { EmbedController, parseRegion } from '../chromium/embedController.ts'
import { advance, INITIAL, needsPerson, parseLine, parseProblem, STAGES, type ProgressState } from './progress.ts'

/**
 * ORBIS COSMOS: the Gaia Sky simulation, run as Orbis's own program.
 *
 * It is a Java program, so it runs in a process of its own (a fault in it cannot take the application down) and its
 * window is placed inside the Orbis window the way the browser's is. What the loading screen shows is what the
 * program itself prints as it starts -- see progress.ts -- so nothing on that screen is a guess.
 *
 * Gaia Sky keeps its settings and its data packs under the user's home folder. Orbis gives it a home of its own
 * (`-Duser.home`), so it never reads or writes a separate Gaia Sky installation's files and they never read ours.
 *
 * It starts when somebody opens COSMOS and stops when they leave, which gives its memory back.
 */

export interface CosmosOptions {
  getWindow(): BrowserWindow | null
}

/** What the screen is told, in the order things happen. */
export type CosmosEvent =
  | { kind: 'stage'; stage: string; detail: string | null; fraction: number; current: string | null }
  | { kind: 'attention' }
  | { kind: 'ready' }
  | { kind: 'failed'; why: string }

type Phase = 'idle' | 'starting' | 'ready' | 'failed'

const MAIN_CLASS = 'gaiasky.desktop.GaiaSkyDesktop'
/** The window class GLFW (the windowing library under Gaia Sky 3) gives its windows. */
const WINDOW_CLASS = 'GLFW30'

export function registerCosmosIpc(o: CosmosOptions): void {
  const handle = plainHandle(o)
  const listen = plainListen(o)
  const embed = new EmbedController(() => {
    const w = o.getWindow()
    return w && !w.isDestroyed() ? hwndFromHandle(w.getNativeWindowHandle()) : null
  })

  let child: ChildProcess | null = null
  let phase: Phase = 'idle'
  let progress: ProgressState = INITIAL
  let details: Record<string, string> = {}
  let failure = ''
  let attention = false
  /** The first-start Enter presses: stopped as soon as the program says it has begun downloading. */
  let enterTimer: NodeJS.Timeout | null = null

  const folder = (): string => (app.isPackaged ? join(process.resourcesPath, 'cosmos') : join(app.getAppPath(), 'cosmos'))
  const buildDir = (): string => join(folder(), '.build')
  /** The simulation's own home folder: its settings, and the data packs it downloads on the first run. */
  const homeDir = (): string => process.env.ORBIS_COSMOS_HOME || join(app.getPath('userData'), 'cosmos', 'home')
  const pidFile = (): string => join(app.getPath('userData'), 'cosmos', 'running.pid')

  const send = (e: CosmosEvent): void => {
    const w = o.getWindow()
    if (w && !w.isDestroyed()) w.webContents.send('cosmos:event', e)
  }

  /**
   * The Java runtime itself. JAVA_HOME if set; otherwise whichever `java` is on the PATH, asked where its own home is.
   *
   * Asked, rather than used as found, because on Windows the `java.exe` that an installer puts on the PATH is often a
   * small launcher that starts the real one as a second process. The window, and anything that has to be stopped, belongs
   * to the second one, so the process Orbis starts must be the real runtime.
   */
  function findJava(): string | null {
    const exe = 'java.exe'
    const fromHome = (home: string | undefined): string | null => (home && existsSync(join(home, 'bin', exe)) ? join(home, 'bin', exe) : null)
    const env = fromHome(process.env.JAVA_HOME)
    if (env) return env
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      if (!dir || !existsSync(join(dir, exe))) continue
      // The runtime prints its properties on stderr, so both streams are read.
      const r = spawnSync(join(dir, exe), ['-XshowSettings:properties', '-version'], { encoding: 'utf8', timeout: 15000 })
      const real = fromHome(/java\.home = (.+)/.exec(`${r.stdout}
${r.stderr}`)?.[1]?.trim())
      if (real) return real
    }
    return null
  }

  /**
   * A simulation left behind by an Orbis that was ended without a chance to stop it (killed, crashed, power cut).
   * Windows does not end a child with its parent, and this one holds a few gigabytes. Only a process whose command
   * line is the simulation's own main class is ever ended -- never one that merely has the recorded number.
   */
  function reapStale(): void {
    try {
      const pid = Number(readFileSync(pidFile(), 'utf8').trim())
      rmSync(pidFile(), { force: true })
      if (!Number.isInteger(pid) || pid <= 0) return
      const cmd = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', timeout: 8000 })
      if (cmd.includes(MAIN_CLASS)) process.kill(pid)
    } catch {
      // nothing recorded, or it is already gone
    }
  }

  function fail(why: string): void {
    if (phase === 'failed') return
    phase = 'failed'
    failure = why
    embed.detach()
    send({ kind: 'failed', why })
  }

  function launch(): void {
    phase = 'starting'
    progress = INITIAL
    details = {}
    failure = ''
    attention = false

    let manifest: { jar: string; libraries: { file: string }[] } | null = null
    try {
      manifest = JSON.parse(readFileSync(join(buildDir(), 'build.json'), 'utf8'))
    } catch {
      manifest = null
    }
    if (!manifest || !existsSync(join(buildDir(), manifest.jar))) {
      return fail('ORBIS COSMOS has not been built yet. Run "npm run cosmos:build" once, then open it again.')
    }
    reapStale()
    const java = findJava()
    if (!java) return fail('ORBIS COSMOS needs Java 21 or newer to run, and none was found on this computer. Install a Java runtime, then open it again.')

    const home = homeDir()
    try {
      mkdirSync(home, { recursive: true })
      mkdirSync(join(app.getPath('userData'), 'cosmos'), { recursive: true })
    } catch (e) {
      return fail(`The simulation's folder could not be created: ${e instanceof Error ? e.message : String(e)}`)
    }

    const assets = join(folder(), 'assets').replace(/\\/g, '/') + '/'
    const classpath = [join(buildDir(), manifest.jar), join(buildDir(), 'lib', '*'), join(folder(), 'assets')].join(delimiter)
    const args = [
      '-Xms1g',
      '-Xmx4g',
      '-XX:+UseZGC',
      `-Duser.home=${home}`,
      `-Dassets.location=${assets}`,
      '-Dorg.slf4j.simpleLogger.defaultLogLevel=info',
      '-cp',
      classpath,
      MAIN_CLASS,
      // Skip the welcome screen (it downloads what is missing by itself) and do not open the scripting port.
      '-s',
      '-n'
    ]

    const proc = spawn(java, args, { cwd: home, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
    child = proc
    try {
      if (proc.pid) writeFileSync(pidFile(), String(proc.pid))
    } catch {
      // the record is only a safety net
    }
    let problem = ''
    let tail = ''

    // The simulation's own output of the last run, kept beside Orbis's data so a failure can be looked at afterwards.
    const logFile = join(app.getPath('userData'), 'cosmos', 'last-run.log')
    try {
      writeFileSync(logFile, '')
    } catch {
      // diagnostics only
    }
    const onLine = (line: string): void => {
      try {
        appendFileSync(logFile, line + '\n')
      } catch {
        // diagnostics only
      }
      if (!attention && needsPerson(line)) {
        attention = true
        send({ kind: 'attention' })
        // On the first start Gaia Sky waits at its data screen for Enter (open the list, then start the default set).
        // Orbis presses it, a few times and only until the download is under way, so a first start needs no click.
        let presses = 0
        enterTimer = setInterval(() => {
          presses += 1
          embed.attachedWindow?.postKey(13)
          if (presses >= 8 && enterTimer) {
            clearInterval(enterTimer)
            enterTimer = null
          }
        }, 3000)
      }
      if (enterTimer && /DownloadHelper - (Downloading|Reading)/.test(line)) {
        clearInterval(enterTimer)
        enterTimer = null
      }
      const hit = parseLine(line)
      if (hit) {
        progress = advance(progress, hit)
        if (hit.detail) details[hit.stage] = hit.detail
        send({ kind: 'stage', stage: hit.stage, detail: hit.detail, fraction: progress.fraction, current: progress.current })
        if (hit.stage === 'ready' && phase === 'starting') {
          phase = 'ready'
          send({ kind: 'ready' })
        }
        return
      }
      problem = parseProblem(line) ?? problem
    }
    const feed = (chunk: Buffer): void => {
      tail += chunk.toString('utf8')
      const lines = tail.split(/\r?\n/)
      tail = lines.pop() ?? ''
      lines.forEach(onLine)
    }
    proc.stdout?.on('data', feed)
    proc.stderr?.on('data', feed)
    proc.once('error', (e) => fail(`Java could not be started: ${e.message}`))
    proc.once('exit', (code) => {
      if (child === proc) child = null
      embed.detach()
      rmSync(pidFile(), { force: true })
      try {
        appendFileSync(logFile, `-- exited with code ${String(code)}\n`)
      } catch {
        // diagnostics only
      }
      if (phase === 'starting') fail(problem || `The simulation stopped before it finished starting (exit code ${String(code)}).`)
      else if (phase === 'ready') phase = 'idle'
    })

    // Its window appears a moment after the process; once it does it is placed inside Orbis, wherever the screen says.
    if (proc.pid) {
      const note = (m: string): void => {
        try {
          appendFileSync(join(app.getPath('userData'), 'cosmos', 'embed.log'), `${new Date().toISOString()} ${m}
`)
        } catch {
          // diagnostics only
        }
      }
      let logged = false
      embed.attach(proc.pid, 180_000, (pid) => {
        const h = findWindowByClass(pid, WINDOW_CLASS)
        if (h && !logged) {
          logged = true
          note(`window found ${String(h)} for pid ${pid}`)
          setTimeout(() => {
            const a = embed.attachedWindow
            note(a ? `embedded ${String(a.hwnd)} parent=${String(a.parent())}` : 'NOT embedded after 3s')
          }, 3000).unref()
        }
        return h
      }, true)
    }
  }

  function stop(): void {
    if (enterTimer) clearInterval(enterTimer)
    enterTimer = null
    embed.detach()
    const proc = child
    child = null
    if (proc && proc.exitCode === null) {
      try {
        proc.kill()
      } catch {
        // already gone
      }
    }
    rmSync(pidFile(), { force: true })
    phase = 'idle'
    progress = INITIAL
  }

  const snapshot = (): { phase: Phase; fraction: number; attention: boolean; current: string | null; details: Record<string, string>; why: string; stages: readonly { id: string; label: string; done: string }[] } => ({
    phase,
    fraction: progress.fraction,
    current: progress.current,
    details,
    why: failure,
    attention,
    stages: STAGES
  })

  handle('cosmos:start', () => {
    if (phase === 'idle' || phase === 'failed') launch()
    return snapshot()
  })
  handle('cosmos:stop', () => {
    stop()
    return { ok: true }
  })
  listen('cosmos:region', (_event, region: unknown) => {
    const r = parseRegion(region)
    if (r) embed.setRegion(r)
  })

  app.on('before-quit', stop)
}
