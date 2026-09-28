// Does page.type submit when it goes through control.execute, as the agent does?
import { spawn, execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { startChromiumControl } from './service.ts'

const CHROME = 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve('C:/Users/ksran/Downloads/Orbis AI desktop app/extension')
const EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  res.writeHead(200, { 'Content-Type': 'text/html' })
  if (url.pathname === '/results') res.end(`<!doctype html><title>Results</title><h1>Results for ${url.searchParams.get('q')}</h1>`)
  else res.end('<!doctype html><title>Shop</title><h1>Orbis shop</h1><form action="/results"><label>Search products<input name="q" type="text"></label><button type="submit">Go</button></form>')
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

const port = 9863
const profile = join(process.env.TEMP ?? '.', 'orbis-probe-exec')
rmSync(profile, { recursive: true, force: true })
const chrome = spawn(
  CHROME,
  [`--user-data-dir=${profile}`, `--orbis-extension-dir=${EXTENSION}`, `--remote-debugging-port=${port}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore' }
)

const service = await startChromiumControl({ port, extensionId: EXTENSION_ID, waitMs: 60_000 })
const run = (capability: string, params: Record<string, unknown>) =>
  service.control.execute({ capability, params, target: {} }, { source: 'orion', confirm: async () => true })

await sleep(1500)
console.log('navigate  :', JSON.stringify(await run('navigation.go', { url: `${base}/` })).slice(0, 160))
await sleep(600)

const looked = await run('page.read', { maxChars: 400 })
console.log('read      :', JSON.stringify(looked.data).slice(0, 200))

const typed = await run('page.type', { locator: { label: 'Search products' }, text: 'blue chair', submit: true })
console.log('type      :', JSON.stringify(typed).slice(0, 300))

for (let i = 0; i < 30; i++) {
  const where = await run('page.read', { maxChars: 120 })
  const text = JSON.stringify(where.data)
  if (text.includes('results')) break
  await sleep(200)
}
const after = await service.agent.getTarget()
console.log('url after :', after.getURL())

service.stop()
try {
  execSync(`taskkill /F /PID ${chrome.pid} /T`, { stdio: 'ignore' })
} catch {
  /* already gone */
}
server.close()
