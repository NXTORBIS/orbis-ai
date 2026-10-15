import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { plainHandle } from '../ipc/handle.ts'

/**
 * OrbisEye, the live Earth console, run as Orbis's own local service.
 *
 * Its backend is a set of local routes (flights, satellites, terrain, cameras, radio, voice) that a plain page
 * cannot do without, so the server is started here, once, on a free port of this computer, and the window frames
 * its address. It starts when somebody first opens OrbisEye and stops when Orbis quits.
 *
 * The server runs in a child process of its own, using the same Node that runs Orbis, so a fault in it cannot take
 * the application down and its dependencies stay out of the application's.
 */

export interface EyeOptions {
  getWindow(): BrowserWindow | null
  /** Speech keys Orbis already holds, handed to the server as environment rather than written anywhere. */
  groqKeys: readonly string[]
}

type State = { phase: 'idle' } | { phase: 'starting'; wait: Promise<string> } | { phase: 'ready'; url: string } | { phase: 'failed'; why: string }

export function registerEyeIpc(o: EyeOptions): void {
  const handle = plainHandle(o)
  let child: ChildProcess | null = null
  let state: State = { phase: 'idle' }

  const folder = (): string => (app.isPackaged ? join(process.resourcesPath, 'orbiseye') : join(app.getAppPath(), 'orbiseye'))

  const start = (): Promise<string> => {
    const dir = folder()
    const script = join(dir, 'desktop-server.mjs')
    if (!existsSync(script)) return Promise.reject(new Error('OrbisEye is not installed with this copy of Orbis.'))
    if (!existsSync(join(dir, 'node_modules', 'vite'))) return Promise.reject(new Error('OrbisEye has not been set up yet. Run npm install in the orbiseye folder.'))
    return new Promise<string>((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '0', NODE_ENV: 'development' }
      if (o.groqKeys.length > 0) env.GROQ_API_KEYS = o.groqKeys.join(',')
      const proc = spawn(process.execPath, [script], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      child = proc
      let out = ''
      let err = ''
      let settled = false
      const fail = (why: string): void => {
        if (settled) return
        settled = true
        reject(new Error(why))
      }
      proc.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString()
        const match = /http:\/\/127\.0\.0\.1:\d+/.exec(out)
        if (match && !settled) {
          settled = true
          resolve(match[0])
        }
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        err = (err + chunk.toString()).slice(-600)
      })
      proc.once('error', (e) => fail(e.message))
      proc.once('exit', (code) => {
        child = null
        state = { phase: 'idle' }
        fail(err.trim().split('\n').pop() || `OrbisEye stopped (code ${String(code)}).`)
      })
      setTimeout(() => fail('OrbisEye took too long to start.'), 90_000)
    })
  }

  handle('eye:start', async () => {
    if (state.phase === 'ready') return { ok: true, url: state.url }
    if (state.phase === 'starting') {
      try {
        return { ok: true, url: await state.wait }
      } catch (e) {
        return { ok: false, why: e instanceof Error ? e.message : String(e) }
      }
    }
    const wait = start()
    state = { phase: 'starting', wait }
    try {
      const url = await wait
      state = { phase: 'ready', url }
      return { ok: true, url }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      state = { phase: 'failed', why }
      child?.kill()
      child = null
      return { ok: false, why }
    }
  })

  app.on('before-quit', () => {
    child?.kill()
    child = null
  })
}
