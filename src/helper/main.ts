import { appendFileSync, mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { newToken } from './auth.ts'
import { createHandlers } from './handlers.ts'
import { createHelperServer } from './server.ts'
import { startBrowserHost } from './browser/host.ts'
import type { BrowserHost } from './browser/host.ts'

/**
 * Starts the Orbis helper.
 *
 *   node --experimental-strip-types src/helper/main.ts --allow-origin chrome://orbis [--allow-origin chrome-extension://<id>]
 *
 * The Groq keys come from the ORBIS_GROQ_API_KEYS environment variable (comma separated), the way a build reads them
 * today; they are handed to the handlers and go nowhere else. Once listening, the helper writes its port and this run's
 * secret token to `helper.json` in its data folder, so the panel's installer can hand them to it. Nothing here prints
 * either the token or a key.
 */

function argValues(name: string): string[] {
  const values: string[] = []
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) values.push(args[++i])
  return values
}

const allowedOrigins = argValues('--allow-origin')
if (!allowedOrigins.length) {
  console.error('Refusing to start with no --allow-origin: with none, no panel could ever be allowed to use the helper.')
  process.exit(2)
}

const dataDir = argValues('--data-dir')[0] ?? join(homedir(), '.orbis-helper')
const apiKeys = (process.env.ORBIS_GROQ_API_KEYS ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean)

/**
 * The helper keeps its own log.
 *
 * It used to be started with its output redirected, which read as the tidy thing to do and quietly broke the browser:
 * redirecting this process's stdout and stderr stops the extra pipe handles reaching Chromium, so the browser starts,
 * runs, and never speaks the protocol Orbis drives it with. Everything looked right and nothing worked. Writing the log
 * here means nobody has to redirect anything.
 */
mkdirSync(dataDir, { recursive: true })
const logFile = join(dataDir, 'helper.log')
const record = (level: string, args: unknown[]): void => {
  const line = `${new Date().toISOString()} ${level} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}${String.fromCharCode(10)}`
  try {
    appendFileSync(logFile, line)
  } catch {
    // A log that cannot be written is not a reason to stop serving.
  }
}
const say = console.log.bind(console)
const complain = console.error.bind(console)
console.log = (...args: unknown[]): void => {
  record('INFO', args)
  say(...args)
}
console.error = (...args: unknown[]): void => {
  record('ERROR', args)
  complain(...args)
}

const token = newToken()

/**
 * The browser the helper holds.
 *
 * Given --chrome, the helper starts Chromium itself and keeps the pipe to it. That pipe is the whole reason Orbis can
 * act on the browser at all: the control layer speaks the DevTools protocol, and with --remote-debugging-pipe the only
 * process that can speak it is the one that started the browser. A debugging port would have done the same job and left
 * the browser open to every other program on the computer, and to any page it ever loads.
 *
 * Without --chrome the helper runs as before, answering everything that does not need a browser, and saying so for the
 * rest. It is read through a function because the browser can be closed and started again under a running helper.
 */
let browserHost: BrowserHost | null = null

const server = createHelperServer({
  token,
  allowedOrigins,
  handlers: createHandlers({
    apiKeys,
    dataDir: join(dataDir, 'personal-data'),
    browser: () => browserHost,
    adblock: { extensionDir: dataDir, listsDir: join(homedir(), '.orbis', 'adblock'), bundledDir: join(import.meta.dirname, '../../resources/adblock') },
    // Speech to text, on this machine. The helper running on its own has no Orbis window to ask, so it runs whisper.cpp
    // itself over the same bundled binary and the same models folder the app uses -- nothing is sent anywhere.
    voice: () => ({ userDataDir: dataDir, resourcesPath: join(import.meta.dirname, '../../resources'), fetchFn: fetch })
  })
})
const { port } = await server.listen()

await mkdir(dataDir, { recursive: true })
await writeFile(join(dataDir, 'helper.json'), JSON.stringify({ port, token, pid: process.pid, startedAt: Date.now() }), { encoding: 'utf8', mode: 0o600 })
console.log(`Orbis helper listening on 127.0.0.1:${port} (details in ${join(dataDir, 'helper.json')})`)

const chrome = argValues('--chrome')[0]
if (chrome) {
  const profileDir = argValues('--profile')[0] ?? join(dataDir, 'browser')
  const extensionId = argValues('--extension-id')[0] ?? ''
  try {
    browserHost = await startBrowserHost({
      chrome,
      profileDir,
      extensionId,
      extensionDir: argValues('--extension-dir')[0],
      urls: argValues('--url'),
      // The browser is told where the helper is on its own command line, so its built-in pages find it without
      // reading a file that may be a moment out of date.
      args: [`--orbis-helper-port=${port}`, `--orbis-helper-token=${token}`, '--enable-features=WebUIToolbar'],
      // When the person closes the browser, Orbis is done: the helper exists to serve it.
      onClosed: () => {
        browserHost = null
        void server.close().then(() => process.exit(0))
      }
    })
    console.log('Orbis browser started; the browser control layer is connected.')
  } catch (err) {
    // Said plainly and fatally: a helper that is up but has no browser looks like a working Orbis that refuses
    // every browser request, which is the hardest kind of failure to read.
    console.error(`Could not start the Orbis browser: ${err instanceof Error ? err.message : String(err)}`)
    await server.close()
    process.exit(3)
  }
}

const stop = (): void => {
  browserHost?.stop()
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
