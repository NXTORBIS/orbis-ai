import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { CdpConnection } from './cdp.ts'

/**
 * Starts Orbis's Chromium as a child process and connects to it over a pipe.
 *
 * The browser is started with `--remote-debugging-pipe`, not a debugging port: nothing listens on the network, so no other program
 * on the computer and no web page can take control of the browser. Only the process that started it holds the pipe.
 */

export interface LaunchOptions {
  /** The Chromium executable. */
  chrome: string
  /** This Orbis profile's own browser data folder (profiles never share one). */
  profileDir: string
  /**
   * Development only: load the Orbis extension from a folder as an ordinary unpacked extension. Normally there is none: Orbis's
   * extension is a component built into the browser (it is not listed in chrome://extensions and cannot be removed).
   */
  extensionDir?: string
  /** Pages to open at start. */
  urls?: string[]
  /** Anything else to pass the browser. */
  args?: string[]
}

export interface LaunchedChromium {
  process: ChildProcess
  connection: CdpConnection
  /** Resolves when the browser has exited (the person closed it, or it crashed). */
  exited: Promise<number | null>
}

export function launchChromium(o: LaunchOptions): LaunchedChromium {
  const args = [
    `--user-data-dir=${o.profileDir}`,
    ...(o.extensionDir ? [`--load-extension=${o.extensionDir}`] : []),
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-dark-mode',
    ...(o.args ?? []),
    ...(o.urls ?? [])
  ]
  const child = spawn(o.chrome, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: false })
  const toBrowser = child.stdio[3] as Writable | null
  const fromBrowser = child.stdio[4] as Readable | null
  if (!toBrowser || !fromBrowser) {
    child.kill()
    throw new Error('Could not open the connection to the browser.')
  }
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.once('error', () => resolve(null))
  })
  return { process: child, connection: CdpConnection.fromPipe(toBrowser, fromBrowser), exited }
}
