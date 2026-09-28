// Does a locked tab really hide itself?
//
//   node scripts/tab-lock-check.mjs
//
// This is the question the whole Tab Lock feature turns on, and no unit test can answer it: the title, the favicon, the
// address and the thumbnail all come from the browser's own objects, and the only way to know they have gone quiet is to
// ask a real browser.
//
// So: start the real Orbis Chromium, open a page with a recognisable title, tell the browser that tab is locked exactly
// the way Orbis does -- chrome.send('orbis.lock.set', ...) from the Orb's page -- and then read back what the browser says
// about it. What must be true afterwards is that the tab is reported as locked, that its title is the generic label, that
// its address is gone, and that unlocking gives all of it back.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXE = 'C:/chromium/src/out/Default/chrome.exe'
const PORT = 9411
const prof = join(process.env.TEMP, 'orbis-tab-lock-check')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The page under test: a local file, so nothing is fetched and the title is one we chose and can look for.
 *
 * A file rather than a `data:` URL, because Chromium does not commit a `data:` URL given on the command line -- the tab
 * exists with no committed address, which is indistinguishable from a locked one and would make this prove nothing.
 */
const SECRET_TITLE = 'Current account 41203'
const PAGE_FILE = join(process.env.TEMP, 'orbis-tab-lock-page.html')
const LABEL = 'Private Tab'

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
  writeFileSync(
    PAGE_FILE,
    `<!doctype html><meta charset="utf-8"><title>${SECRET_TITLE}</title><body style="background:#123;color:#eee">balance 41203</body>`
  )
  // `internal_only_uis_enabled` is what lets chrome://orbis-lock be reached at all in a release build.
  writeFileSync(join(prof, 'Local State'), JSON.stringify({ internal_only_uis_enabled: true }))
  child = spawn(
    EXE,
    [
      `--user-data-dir=${prof}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1280,860',
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

const evaluate = async (sessionId, expression) => {
  const done = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (done.exceptionDetails) {
    throw new Error(done.exceptionDetails.exception?.description ?? done.exceptionDetails.text)
  }
  return done.result?.value
}

/**
 * Asks the browser's own Orbis handler something, the way an Orbis page does.
 *
 * `chrome.send` answers by calling `cr.webUIResponse`, so the reply is caught by putting one there and putting back
 * whatever was there before -- the page's own helper client uses the same hook and must keep working.
 */
const askBrowser = (session, message, args = []) =>
  evaluate(
    session,
    `new Promise((done) => {
       const id = ${JSON.stringify(`probe-${message}-${++id}`)}
       globalThis.cr = globalThis.cr || {}
       const was = globalThis.cr.webUIResponse
       globalThis.cr.webUIResponse = (i, ok, v) => {
         if (i === id) { globalThis.cr.webUIResponse = was; done({ ok, value: v }) }
         else if (was) { was(i, ok, v) }
       }
       chrome.send(${JSON.stringify(message)}, [id${args.length ? ', ' + args.map((a) => JSON.stringify(a)).join(', ') : ''}])
       setTimeout(() => { globalThis.cr.webUIResponse = was; done({ ok: false, value: 'timed out' }) }, 5000)
     })`
  )

const results = []
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  \u2014 ${detail}` : ''}`)
}

try {
  await start()

  // The browser answers on the debugging port before it has finished opening the page it was given, so this waits for the
  // page rather than assuming it is there -- otherwise a slow start looks like a failure.
  let all = await targets()
  let page
  for (let i = 0; i < 40; i++) {
    page = all.find((t) => t.type === 'page' && t.url.startsWith('file:///') && t.url.includes('orbis-tab-lock-page'))
    if (page) break
    await sleep(500)
    all = await targets()
  }
  if (!page) {
    console.log('    targets the browser has:')
    for (const t of all) console.log(`      ${t.type} ${t.url.slice(0, 90)}`)
    throw new Error('the test page is not open')
  }
  const orb = all.find((t) => t.url.startsWith('chrome://orbis-orb'))
  check('the Orb page is in the window, which is how Orbis reaches the browser', Boolean(orb), orb?.url ?? '')
  if (!orb) throw new Error('no Orb page: nothing to send the lock through')

  const pageSession = await attach(page.targetId)
  const orbSession = await attach(orb.targetId)

  // ---- before ----
  // The page has to have committed and set its title before the browser can report it. Waiting for the title rather than a
  // fixed delay, so a slow start does not make this look like a failure.
  for (let i = 0; i < 30; i++) {
    if ((await evaluate(pageSession, 'document.title')) === SECRET_TITLE) break
    await sleep(250)
  }
  const tabsBefore = await askBrowser(orbSession, 'orbis.lock.tabs')
  check(
    'the browser can report its tabs with the id Orbis knows each by',
    tabsBefore.ok && Array.isArray(tabsBefore.value) && tabsBefore.value.length > 0,
    JSON.stringify(tabsBefore.value)
  )
  const row = (tabsBefore.value ?? []).find((t) => String(t.url ?? '').includes('orbis-tab-lock-page'))
  check('the test page is among them, with its real title and address', Boolean(row), row ? row.title : 'not found')
  if (!row) throw new Error('could not find the test page in the browser\u2019s own tab list')
  const tabId = row.tabId
  check('its title is the real one to begin with', row.title === SECRET_TITLE, row.title)

  const lockedBefore = await askBrowser(orbSession, 'orbis.lock.list')
  check('nothing is locked to begin with', lockedBefore.ok && lockedBefore.value.length === 0, JSON.stringify(lockedBefore.value))

  // ---- lock it, exactly the way Orbis does ----
  const set = await evaluate(
    orbSession,
    `new Promise((done) => {
       const id = 'probe-set'
       globalThis.cr = globalThis.cr || {}
       const was = globalThis.cr.webUIResponse
       globalThis.cr.webUIResponse = (i, ok, v) => { if (i === id) { globalThis.cr.webUIResponse = was; done({ ok, value: v }) } else if (was) was(i, ok, v) }
       chrome.send('orbis.lock.set', [id, ${tabId}, true, ${JSON.stringify(LABEL)}, {title:true,favicon:true,url:true,preview:true}])
       setTimeout(() => { globalThis.cr.webUIResponse = was; done({ ok: false, value: 'timed out' }) }, 5000)
     })`
  )
  check('the browser accepted the lock', set.ok && set.value === true, JSON.stringify(set.value))
  await sleep(500)

  // ---- after ----
  const lockedNow = await askBrowser(orbSession, 'orbis.lock.list')
  check(
    'the browser now says that tab is locked',
    lockedNow.ok && Array.isArray(lockedNow.value) && lockedNow.value.includes(tabId),
    JSON.stringify(lockedNow.value)
  )

  const tabsNow = await askBrowser(orbSession, 'orbis.lock.tabs')
  const after = (tabsNow.value ?? []).find((t) => t.tabId === tabId)
  check('the tab is still there -- locking hides it, it does not close it', Boolean(after))
  check('its title is now the generic label', after?.title === LABEL, String(after?.title))
  check('its address is gone', after?.url === '', JSON.stringify(after?.url))

  // The decisive one: nothing anywhere in what the browser says about its tabs gives the page away.
  const said = JSON.stringify(tabsNow.value)
  const leaked = ['41203', 'Current account', 'orbis-tab-lock-page'].filter((g) => said.includes(g))
  check('nothing the browser reports about its tabs gives the page away', leaked.length === 0, leaked.join(', '))

  // And the page itself is still loaded underneath -- the whole point of covering rather than navigating.
  const stillThere = await evaluate(pageSession, 'document.title')
  check('the page underneath is untouched, so unlocking gives back what was there', stillThere === SECRET_TITLE, stillThere)

  // The lock surface is up over it.
  const withLock = await targets()
  const surface = withLock.find((t) => t.url.startsWith('chrome://orbis-lock'))
  check('the lock surface is up over the page', Boolean(surface), surface?.url ?? 'not found')
  if (surface) {
    const lockSession = await attach(surface.targetId)
    await sleep(600)
    const shown = await evaluate(
      lockSession,
      `JSON.stringify({ heading: document.getElementById('lock-heading')?.textContent,
                        body: document.body.innerText.slice(0, 200),
                        field: !!document.getElementById('password') })`
    )
    const drawn = JSON.parse(shown)
    check('it draws a lock screen with a password field', drawn.field === true, JSON.stringify(drawn.heading))
    check(
      'and the lock screen itself says nothing about the page',
      !drawn.body.includes('41203') && !drawn.body.includes('Current account'),
      drawn.body.replace(/\s+/g, ' ').slice(0, 90)
    )
  }

  // ---- unlock, and everything comes back ----
  const clear = await evaluate(
    orbSession,
    `new Promise((done) => {
       const id = 'probe-clear'
       globalThis.cr = globalThis.cr || {}
       const was = globalThis.cr.webUIResponse
       globalThis.cr.webUIResponse = (i, ok, v) => { if (i === id) { globalThis.cr.webUIResponse = was; done({ ok, value: v }) } else if (was) was(i, ok, v) }
       chrome.send('orbis.lock.set', [id, ${tabId}, false, '', {title:true,favicon:true,url:true,preview:true}])
       setTimeout(() => { globalThis.cr.webUIResponse = was; done({ ok: false, value: 'timed out' }) }, 5000)
     })`
  )
  check('the browser accepted the unlock', clear.ok && clear.value === true)
  await sleep(500)

  const back = await askBrowser(orbSession, 'orbis.lock.tabs')
  const restored = (back.value ?? []).find((t) => t.tabId === tabId)
  check('the real title is back', restored?.title === SECRET_TITLE, String(restored?.title))
  check('the real address is back', String(restored?.url ?? '').includes('orbis-tab-lock-page'), String(restored?.url).slice(-40))
  const lockedAfter = await askBrowser(orbSession, 'orbis.lock.list')
  check('and nothing is locked any more', lockedAfter.ok && lockedAfter.value.length === 0, JSON.stringify(lockedAfter.value))

  // The surface's page is deliberately kept rather than destroyed, so locking again is instant and lands where it was.
  // What must be true is that it is no longer being shown -- which the page itself can say, because hiding the view calls
  // WasHidden() on its contents.
  const surfaceStill = (await targets()).find((t) => t.url.startsWith('chrome://orbis-lock'))
  if (surfaceStill) {
    const session = await attach(surfaceStill.targetId)
    const visibility = await evaluate(session, 'document.visibilityState')
    check('the lock surface is no longer shown', visibility === 'hidden', String(visibility))
  } else {
    check('the lock surface is no longer shown', true, 'it went away entirely')
  }
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
