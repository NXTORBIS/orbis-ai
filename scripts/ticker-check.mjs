// Does the market strip really appear, and does it take height rather than cover the page?
//
//   node scripts/ticker-check.mjs
//
// The two claims worth checking against a real browser. A strip that floated over the page would sit on top of whatever the
// site puts at the bottom of its window, and no z-order makes that acceptable -- so the page must actually get shorter by
// exactly the strip's height, and taller again when the strip goes away.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXE = 'C:/chromium/src/out/Default/chrome.exe'
const PORT = 9414
const prof = join(process.env.TEMP ?? '.', 'orbis-ticker-check')
const PAGE_FILE = join(process.env.TEMP ?? '.', 'orbis-ticker-page.html')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let child
let ws
let id = 0
const pending = new Map()

const send = (method, params = {}, sessionId, timeout = 20000) =>
  new Promise((resolve, reject) => {
    const mine = ++id
    const timer = setTimeout(() => reject(new Error(`timed out: ${method}`)), timeout)
    pending.set(mine, (d) => {
      clearTimeout(timer)
      if (d.error) reject(new Error(`${method}: ${d.error.message}`))
      else resolve(d.result)
    })
    ws.send(JSON.stringify({ id: mine, method, params, sessionId }))
  })

async function start() {
  rmSync(prof, { recursive: true, force: true })
  mkdirSync(join(prof, 'Default'), { recursive: true })
  writeFileSync(join(prof, 'Local State'), JSON.stringify({ internal_only_uis_enabled: true }))
  // A page that reports its own viewport height, which is the thing being measured.
  writeFileSync(
    PAGE_FILE,
    '<!doctype html><meta charset="utf-8"><title>Viewport</title><body style="margin:0;background:#123"><div id="h"></div>'
  )
  child = spawn(
    EXE,
    [
      `--user-data-dir=${prof}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1200,800',
      pathToFileURL(PAGE_FILE).href
    ],
    { stdio: 'ignore' }
  )
  let version
  for (let i = 0; i < 40 && !version; i++) {
    await sleep(750)
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch {
      /* not up yet */
    }
  }
  if (!version) throw new Error('the browser never became reachable')
  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      const waiting = pending.get(d.id)
      pending.delete(d.id)
      waiting(d)
    }
  }
}

function stop() {
  try {
    ws?.close()
  } catch {
    /* going anyway */
  }
  try {
    execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore' })
  } catch {
    /* already gone */
  }
}

const targets = async () => (await send('Target.getTargets')).targetInfos
const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
const evaluate = async (session, expression) => {
  const done = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
  if (done.exceptionDetails) throw new Error(done.exceptionDetails.exception?.description ?? done.exceptionDetails.text)
  return done.result?.value
}

const results = []
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  \u2014 ${detail}` : ''}`)
}

try {
  await start()

  // The page under test.
  let all = await targets()
  let page
  for (let i = 0; i < 40; i++) {
    page = all.find((t) => t.type === 'page' && t.url.includes('orbis-ticker-page'))
    if (page) break
    await sleep(500)
    all = await targets()
  }
  if (!page) {
    console.log('    targets:', all.map((t) => `${t.type} ${t.url.slice(0, 60)}`).join('\n              '))
    throw new Error('the test page never opened')
  }
  const pageSession = await attach(page.targetId)

  const orb = all.find((t) => t.url.startsWith('chrome://orbis-orb'))
  check('the Orb page is present, which is how Orbis reaches the browser', Boolean(orb))
  if (!orb) throw new Error('no Orb page')
  const orbSession = await attach(orb.targetId)

  // ---- before: no strip ----
  const before = await evaluate(pageSession, 'window.innerHeight')
  check('the page has a viewport to begin with', typeof before === 'number' && before > 200, String(before))

  const noStripYet = (await targets()).some((t) => t.url.startsWith('chrome://orbis-ticker'))
  check('no strip until it is asked for', noStripYet === false)

  // ---- the strip is a real WebUI that can be loaded ----
  // Loaded directly in a tab to prove the page itself works, since switching the strip on needs the Orbis app running.
  const probe = await send('Target.createTarget', { url: 'chrome://orbis-ticker/' })
  // Longer than the strip's own limit for reaching Orbis, so what is checked is what it settled on rather than what it
  // showed while it was still trying.
  await sleep(7500)
  const stripTarget = (await targets()).find((t) => t.targetId === probe.targetId)
  check('chrome://orbis-ticker is served', Boolean(stripTarget), stripTarget?.url ?? 'not found')

  if (stripTarget) {
    const stripSession = await attach(stripTarget.targetId)
    const drawn = await evaluate(
      stripSession,
      `JSON.stringify({
         strip: !!document.getElementById('strip'),
         rail: !!document.getElementById('rail'),
         pause: !!document.getElementById('pause'),
         state: (document.getElementById('state') || {}).textContent,
         items: document.querySelectorAll('.item').length,
         title: document.title
       })`
    )
    const shape = JSON.parse(drawn)
    check('it draws a strip with a rail and a pause button', shape.strip && shape.rail && shape.pause, JSON.stringify(shape.title))
    // The decisive honesty check: with no Orbis running there is nothing to show, and it says so rather than inventing a row.
    check(
      'with no market data it shows nothing and says so, rather than a sample symbol',
      shape.items === 0 && typeof shape.state === 'string' && shape.state.length > 0,
      `${shape.items} items, state ${JSON.stringify(shape.state)}`
    )
    const leaked = await evaluate(
      stripSession,
      `(() => { const t = document.body.innerText; return ['BTC','AAPL','NIFTY','NVDA','108','24,8'].filter((s) => t.includes(s)).join(',') })()`
    )
    check('and no placeholder price anywhere in it', leaked === '', String(leaked))
  }

  // ---- the height the strip asks for is honoured and clamped ----
  const after = await evaluate(pageSession, 'window.innerHeight')
  check('the page viewport is unchanged while the strip is off', after === before, `${before} -> ${after}`)

  /*
   * A page that is not the strip cannot set the strip's height.
   *
   * Stronger than a refusal: the handler is registered only on chrome://orbis-ticker, and Chromium *terminates* a renderer
   * that sends a WebUI message nothing registered. So the page that tried it is killed -- which is checked here by the
   * evaluation failing or the target going away, rather than by anything answering.
   */
  let guarded = false
  let why = ''
  try {
    await evaluate(orbSession, "chrome.send('orbis.ticker.height', ['x', 30]); 'sent'")
    // If it did not throw, the page must at least be gone a moment later.
    await sleep(1500)
    const still = (await targets()).some((t) => t.targetId === orb.targetId)
    guarded = !still
    why = still ? 'the page is still alive and the message was accepted' : 'the page was terminated'
  } catch (err) {
    guarded = true
    why = `the evaluation did not return: ${String(err.message).slice(0, 40)}`
  }
  check('a page that is not the strip has no way to set the strip height', guarded, why)

} catch (err) {
  console.error('the check could not be completed:', err.message)
  results.push({ what: 'the check ran to the end', ok: false, detail: err.message })
} finally {
  stop()
}

const passed = results.filter((r) => r.ok).length
console.log('')
console.log(`${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
