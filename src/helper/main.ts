import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { newToken } from './auth.ts'
import { createHandlers } from './handlers.ts'
import { createHelperServer } from './server.ts'

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

const token = newToken()
const server = createHelperServer({ token, allowedOrigins, handlers: createHandlers({ apiKeys, dataDir: join(dataDir, 'personal-data'), adblock: { extensionDir: dataDir, listsDir: join(homedir(), '.orbis', 'adblock'), bundledDir: join(import.meta.dirname, '../../resources/adblock') } }) })
const { port } = await server.listen()

await mkdir(dataDir, { recursive: true })
await writeFile(join(dataDir, 'helper.json'), JSON.stringify({ port, token, pid: process.pid, startedAt: Date.now() }), { encoding: 'utf8', mode: 0o600 })
console.log(`Orbis helper listening on 127.0.0.1:${port} (details in ${join(dataDir, 'helper.json')})`)

const stop = (): void => {
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
