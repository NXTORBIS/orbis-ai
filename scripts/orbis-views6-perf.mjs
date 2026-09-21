// Views 6 (E): performance medians of N runs (fresh temp profile each). Own pid only; OS input through BrowserUi.
//   node scripts/orbis-views6-perf.mjs [runs=5]  -> prints JSON + a markdown table
import { execSync } from 'node:child_process'
import { launch, sleep } from './orbis-views6-lib.mjs'
const RUNS = +(process.argv[2] || 5)
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN }
const proc = (pid) => JSON.parse(execSync(`powershell -NoProfile -Command "$p=Get-Process -Id ${pid}; $w=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter 'IDProcess=${pid}'; @{cpu=$p.TotalProcessorTime.TotalSeconds; pws=$w.WorkingSetPrivate; ws=$p.WorkingSet64} | ConvertTo-Json -Compress"`, { encoding: 'utf8' }))
const tree = (pid) => JSON.parse(execSync(`powershell -NoProfile -Command "$ids=@(${pid}); $all=Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId; do { $n=$all | ?{ $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | %{ $_.ProcessId }; $ids+=$n } while ($n); $sum=0; foreach($i in $ids){ $w=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter \\"IDProcess=$i\\"; $sum+=[int64]$w.WorkingSetPrivate }; @{n=$ids.Count; pws=$sum} | ConvertTo-Json -Compress"`, { encoding: 'utf8' }))
const M = { cpu1first: [], startup: [], newtab_cdp: [], newtab_key: [], omnibox: [], panel: [], pws1: [], cpu1: [], pws10: [], cpu10: [], tree1: [], tree10: [] }
const fcp = (b, s) => b.eval(s, `(async()=>{for(let i=0;i<100;i++){const p=performance.getEntriesByName('first-contentful-paint')[0]; if(p) return performance.timeOrigin+p.startTime; await new Promise(r=>setTimeout(r,50))}return 0})()`)
for (let run = 1; run <= RUNS; run++) {
  const spawnedAt = Date.now()
  const b = await launch({ name: 'perf', url: 'about:blank' }); b.spawnedAt = spawnedAt
  const log = (...a) => console.error(`run ${run}`, ...a)
  try {
    // spawn -> first tab commit: document timeOrigin + responseStart of the first tab
    const first = (await b.pages())[0]; const s0 = await b.attach(first.id)
    const st = await b.eval(s0, 'performance.timeOrigin + (performance.getEntriesByType("navigation")[0]?.responseStart || 0)')
    M.startup.push(st - b.spawnedAt)
    // 1 tab idle 30 s
    await sleep(1500)
    const c0 = proc(b.pid); const t0 = Date.now(); await sleep(30000); const c1 = proc(b.pid); const dt = (Date.now() - t0) / 1000
    M.cpu1first.push(((c1.cpu - c0.cpu) / dt) * 100)   // the first 30 s still contain startup work (component/filter-list loading)
    const c2 = proc(b.pid); const t2 = Date.now(); await sleep(30000); const c3 = proc(b.pid); const dt2 = (Date.now() - t2) / 1000
    M.pws1.push(c3.pws / 1048576); M.cpu1.push(((c3.cpu - c2.cpu) / dt2) * 100); M.tree1.push(tree(b.pid).pws / 1048576)
    // new tab through CDP
    let t = Date.now(); const r = await b.send('Target.createTarget', { url: 'chrome://newtab/' }); const s1 = await b.attach(r.result.targetId)
    const f1 = await fcp(b, s1); M.newtab_cdp.push(f1 - t)
    await b.send('Target.activateTarget', { targetId: r.result.targetId })
    // omnibox popup latency: type then poll UIA rows
    const w = await b.win(); await b.ui.press(w, 'ctrl+l'); await sleep(600)
    t = Date.now(); await b.ui.type(w, 'orb'); let rows = []
    for (let i = 0; i < 40 && !rows.length; i++) { rows = await b.ui.suggestions(w); }
    M.omnibox.push(Date.now() - t); await b.ui.press(w, 'escape'); await b.ui.press(w, 'escape')
    // panel open (first open of this process)
    const seen = new Set((await b.list()).map((x) => x.id)); t = Date.now(); await b.ui.press(w, 'ctrl+shift+y')
    let pt; for (let i = 0; i < 100 && !pt; i++) { pt = (await b.list()).find((x) => !seen.has(x.id) && x.url.startsWith('chrome://orbis/')); if (!pt) await sleep(20) }
    if (pt) { const ps = await b.attach(pt.id); const f = await fcp(b, ps); M.panel.push(f - t) }
    await sleep(800)
    // new tab through the OS key (includes BrowserUi's foreground check)
    const before = new Set((await b.list()).map((x) => x.id)); t = Date.now(); await b.ui.press(w, 'ctrl+t')
    let nt; for (let i = 0; i < 100 && !nt; i++) { nt = (await b.list()).find((x) => !before.has(x.id) && x.type === 'page'); if (!nt) await sleep(20) }
    if (nt) { const ns = await b.attach(nt.id); const f = await fcp(b, ns); M.newtab_key.push(f - t) }
    // 10 tabs
    for (let i = 0; (await b.pages()).length < 10 && i < 12; i++) await b.send('Target.createTarget', { url: `data:text/html,<title>t${i}</title>tab ${i}` })
    await sleep(8000)
    const d0 = proc(b.pid); const u0 = Date.now(); await sleep(30000); const d1 = proc(b.pid); const du = (Date.now() - u0) / 1000
    M.pws10.push(d1.pws / 1048576); M.cpu10.push(((d1.cpu - d0.cpu) / du) * 100); M.tree10.push(tree(b.pid).pws / 1048576)
    log('done', (await b.pages()).length, 'tabs')
  } catch (e) { log('ERR', e.message) } finally { b.kill(); await sleep(1500) }
}
const f = (n) => (Number.isFinite(n) ? n.toFixed(1) : 'n/a')
const rows = [
  ['spawn -> first tab commit (ms)', M.startup], ['new tab via Target.createTarget -> first contentful paint (ms)', M.newtab_cdp], ['new tab via Ctrl+T (OS key) -> first contentful paint (ms)', M.newtab_key],
  ['omnibox popup: typing "orb" -> suggestion rows readable through UIA (ms)', M.omnibox], ['Orbis panel: Ctrl+Shift+Y -> panel first contentful paint (ms)', M.panel],
  ['browser process private working set, 1 tab, after 30 s idle (MB)', M.pws1], ['browser process CPU, first 30 s after launch, 1 tab (% of one core; startup work included)', M.cpu1first], ['browser process CPU over a 30 s idle window at 30-60 s after launch, 1 tab (% of one core)', M.cpu1],
  ['browser process private working set, 10 tabs, after 30 s idle (MB)', M.pws10], ['browser process CPU over the 30 s idle, 10 tabs (% of one core)', M.cpu10],
  ['whole process tree private working set, 1 tab (MB)', M.tree1], ['whole process tree private working set, 10 tabs (MB)', M.tree10]]
console.log(JSON.stringify(M))
console.log('| Metric | Median | Runs (n) | Min | Max |\n|---|---|---|---|---|')
for (const [k, a] of rows) console.log(`| ${k} | ${f(med(a))} | ${a.length} | ${f(Math.min(...a))} | ${f(Math.max(...a))} |`)
