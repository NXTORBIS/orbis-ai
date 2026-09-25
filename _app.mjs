import { spawn, execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 9333, data = 'C:/chromium/orbis-electron-smoke'
rmSync(data, { recursive: true, force: true })
const electron = (await import('electron')).default
const app = spawn(electron, ['.', `--user-data-dir=${data}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore', cwd: process.cwd() })
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
let page
for (let i = 0; i < 60 && !page; i++) { await sleep(1000); try { page = (await list()).find((t) => t.type === 'page' && !t.url.startsWith('devtools')) } catch {} }
async function conn(t) { const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); let id = 0; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }; return { send: (method, params = {}) => Promise.race([new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) }), sleep(90000).then(() => ({ timeout: true }))]) } }
const c = await conn(page)
const ev = async (expression) => (await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
console.log('window.api.chromiumAvailable =', await ev('window.api.chromiumAvailable'))
console.log('chromiumOpen ->', JSON.stringify(await ev(`window.api.chromiumOpen('how do tides work')`)))
await sleep(10000)
const procs = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'orbis-electron-smoke' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId; "pid " + $_.ProcessId + " | pipe=" + ($_.CommandLine -match 'remote-debugging-pipe') + " | port=" + ($_.CommandLine -match 'remote-debugging-port') + " | window: " + $p.MainWindowTitle }`], { encoding: 'utf8' })
console.log('Orbis Chromium started by the app:\n' + procs.trim())
console.log('in-app browser panel opened? ', await ev(`document.querySelector('.browser-panel') !== null`))
console.log('second open (an address) ->', JSON.stringify(await ev(`window.api.chromiumOpen('example.org')`)))
await sleep(4000)
app.kill(); await sleep(1500)
try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'orbis-electron-smoke' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]) } catch {}
process.exit(0)
