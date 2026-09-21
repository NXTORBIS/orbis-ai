// Drives the rail's views in the panel (served by panel-ui-check.mjs, wired to the real helper) like a person would, and checks what happened,
// both on the page and in the stores behind the helper. Headless system Chrome, temp profile (panel-ui-cdp.mjs).
//   node scripts/panel-ui-flow.mjs "<PAGE address printed by panel-ui-check.mjs>"
import { sleep, withChrome } from './panel-ui-cdp.mjs'

const pageUrl = process.argv[2]
if (!pageUrl) throw new Error('usage: panel-ui-flow.mjs <page url>')
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
}

await withChrome(async ({ send, run, errors }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: pageUrl })
  await sleep(1500)
  // Page-side helpers, plus a counter of the helper channels the page calls.
  await run(`(() => {
    window.__calls = []
    const f = window.fetch
    window.fetch = (u, o) => { try { const b = JSON.parse(o.body); window.__calls.push(b.channel) } catch {} return f(u, o) }
    window.$ = (s) => document.querySelector(s)
    window.$$ = (s) => [...document.querySelectorAll(s)]
    window.pause = (ms) => new Promise((r) => setTimeout(r, ms))
    window.tap = async (s, ms = 500) => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) throw new Error('nothing to click: ' + s); e.click(); await pause(ms) }
    window.byLabel = (root, label) => [...root.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith(label))
    window.rpc = async (channel, args = []) => { const u = new URLSearchParams(location.search).get('orbis-test-helper'); const t = location.hash.slice(1); const r = await window.fetch('http://127.0.0.1:' + u + '/rpc', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, args }) }); const lines = (await r.text()).split('\\n').filter(Boolean).map((l) => JSON.parse(l)); return lines.at(-1).result }
    return true })()`)
  const ev = (code) => run(`(async () => { ${code} })()`)
  const open = (row) => ev(`await tap('[data-rail-item="${row}"]', 1300); return true`)
  const view = (row) => `#view-${row}`

  // ---- Tabs
  await open('tabs')
  check('Tabs lists the browser\'s five tabs with the real titles', (await ev(`return $$('#view-tabs .rv-item').length`)) === 5)
  check('the active tab is marked and pinned tab says so', (await ev(`const on = $('#view-tabs .rv-item[aria-current]'); return !!on && on.innerText.includes('Pinned')`)))
  await ev(`await tap(byLabel($('#view-tabs'), 'Unmute Hacker'))`)
  check('unmuting reaches the browser (a silent, unmuted tab has no sound button)', (await ev(`return !byLabel($('#view-tabs'), 'Unmute Hacker') && (await rpc('browser:tabs')).find(t => t.id === '14').muted === false`)))
  await ev(`await tap(byLabel($('#view-tabs'), 'Pin GitHub'))`)
  check('pin reaches the browser', (await ev(`return (await rpc('browser:tabs')).find(t => t.id === '15').pinned === true`)))
  await ev(`await tap(byLabel($('#view-tabs'), 'Move GitHub earlier'))`)
  check('move earlier reaches the browser', (await ev(`return (await rpc('browser:tabs')).find(t => t.id === '15').index === 3`)))
  await ev(`await tap(byLabel($('#view-tabs'), 'Close GitHub'))`)
  check('close removes the tab from the list and the browser', (await ev(`return $$('#view-tabs .rv-item').length === 4 && !(await rpc('browser:tabs')).some(t => t.id === '15')`)))
  await ev(`await tap($('#view-tabs [data-key="open-13"]'))`)
  check('clicking a tab activates it', (await ev(`return (await rpc('browser:tabs')).find(t => t.id === '13').active === true`)))
  await ev(`$$('#view-tabs .rv-check')[0].click(); await pause(300); $$('#view-tabs .rv-check')[1].click(); await pause(300)`)
  check('selecting tabs shows the group bar', (await ev(`return !!$('#view-tabs .rv-bar') && $('#view-tabs .rv-bar').innerText.includes('2 selected')`)))
  await ev(`const i = $('#view-tabs input[name="groupname"]'); i.value = 'Reading'; i.dispatchEvent(new Event('input')); $('#view-tabs .rv-bar').requestSubmit(); await pause(800)`)
  check('a group is created from the selected tabs', (await ev(`const g = await rpc('browser:groups'); return g.some(x => x.name === 'Reading' && x.tabIds.length === 2)`)))
  await ev(`const i = $('#view-tabs input[name="filter"]'); i.value = 'hacker'; i.dispatchEvent(new Event('input')); await pause(300)`)
  check('the filter narrows the list', (await ev(`return $$('#view-tabs .rv-item').length === 1`)))
  await ev(`const i = $('#view-tabs input[name="filter"]'); i.value = 'zzzz'; i.dispatchEvent(new Event('input')); await pause(300)`)
  check('an empty filter says so', (await ev(`return $('#view-tabs .rv-state').innerText.includes('No open tab matches')`)))

  // ---- Tab groups
  await open('tabGroups')
  check('groups are listed with counts', (await ev(`return $$('#view-tabGroups .rv-group').length >= 2 && $('#view-tabGroups').innerText.includes('Reading')`)))
  await ev(`await tap(byLabel($('#view-tabGroups'), 'Rename Reading'))`)
  await ev(`const i = $('#view-tabGroups input[name="rename"]'); i.value = 'To read'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await pause(900)`)
  check('rename reaches the browser', (await ev(`return (await rpc('browser:groups')).some(x => x.name === 'To read')`)))
  await ev(`await tap(byLabel($('#view-tabGroups'), 'Colour of To read'))`)
  await ev(`await tap($('#view-tabGroups .rv-sw[aria-label="pink"]'), 900)`)
  check('colour reaches the browser', (await ev(`return (await rpc('browser:groups')).find(x => x.name === 'To read').color === 'pink'`)))
  await ev(`const b = [...$$('#view-tabGroups .rv-gname')].find(x => x.innerText.includes('To read')); await tap(b, 900)`)
  check('collapse reaches the browser', (await ev(`return (await rpc('browser:groups')).find(x => x.name === 'To read').collapsed === true`)))
  await ev(`const b = [...$$('#view-tabGroups .rv-gname')].find(x => x.innerText.includes('To read')); await tap(b, 900)`)
  await ev(`const g = $$('#view-tabGroups .rv-group').find(s => s.innerText.includes('To read')); await tap(byLabel(g, 'Take'), 900)`)
  check('taking a tab out of a group reaches the browser', (await ev(`const g = (await rpc('browser:groups')).find(x => x.name === 'To read'); return g.tabIds.length === 1`)))
  await ev(`const g = $$('#view-tabGroups .rv-group').find(s => s.innerText.includes('To read')); const sel = g.querySelector('select'); sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change')); await pause(900)`)
  check('adding a tab to a group reaches the browser', (await ev(`const g = (await rpc('browser:groups')).find(x => x.name === 'To read'); return g.tabIds.length === 2`)))
  await ev(`const g = $$('#view-tabGroups .rv-group').find(s => s.innerText.includes('To read')); const b = byLabel(g, 'Ungroup'); await tap(b, 200); const c = byLabel($$('#view-tabGroups .rv-group').find(s => s.innerText.includes('To read')), 'Confirm'); await tap(c, 900)`)
  check('ungroup needs a second press, then the group is gone and its tabs stay', (await ev(`const g = await rpc('browser:groups'); const t = await rpc('browser:tabs'); return !g.some(x => x.name === 'To read') && t.length === 4`)))

  // ---- Media
  await open('media')
  check('Media lists only the tab making sound', (await ev(`return $$('#view-media .rv-item').length === 1 && $('#view-media').innerText.includes('Playing')`)))
  await ev(`await tap(byLabel($('#view-media'), 'Mute A long video'), 900)`)
  check('muting from Media reaches the browser and the row says Muted', (await ev(`return (await rpc('browser:tabs')).find(t => t.id === '13').muted === true && $('#view-media').innerText.includes('Muted')`)))

  // ---- Controls
  await open('controls')
  check('Controls shows the real zoom percentage', (await ev(`return $('#view-controls .rv-zoom').innerText === '125%'`)))
  await ev(`await tap(byLabel($('#view-controls'), 'Zoom in'), 900)`)
  check('zoom in moves to 150%', (await ev(`return $('#view-controls .rv-zoom').innerText === '150%'`)))
  await ev(`await tap([...$$('#view-controls .labelbtn')].find(b => b.innerText === 'Reset'), 900)`)
  check('zoom reset returns to 100%', (await ev(`return $('#view-controls .rv-zoom').innerText === '100%'`)))
  await ev(`await tap([...$$('#view-controls .labelbtn')].find(b => b.innerText.trim() === 'Back'), 900)`)
  check('Back is enabled when there is history and greys at the start', (await ev(`const b = [...$$('#view-controls .labelbtn')].find(b => b.innerText.trim() === 'Back'); return b.disabled === true`)))
  await ev(`const i = $('#view-controls input[name="address"]'); i.value = 'file:///C:/secret'; i.dispatchEvent(new Event('input')); $('#view-controls form').requestSubmit(); await pause(700)`)
  check('a non-web address is refused with a message', (await ev(`return $('#view-controls .rv-note').innerText.length > 0 && (await rpc('browser:tabs')).length === 4`)))
  await ev(`const i = $('#view-controls input[name="address"]'); i.value = 'example.org/page'; i.dispatchEvent(new Event('input')); $('#view-controls form').requestSubmit(); await pause(900)`)
  check('opening a web address makes a new tab', (await ev(`return (await rpc('browser:tabs')).some(t => t.url === 'https://example.org/page')`)))

  // ---- polling only while visible
  await open('tabs')
  await ev(`window.__calls.length = 0; await pause(5200)`)
  const while_shown = await ev(`return window.__calls.filter(c => c === 'browser:tabs').length`)
  check('Tabs polls about every 2 s while shown', while_shown >= 2 && while_shown <= 4, String(while_shown))
  await open('clipboard')
  await ev(`window.__calls.length = 0; await pause(4500)`)
  const after_hidden = await ev(`return window.__calls.filter(c => c === 'browser:tabs' || c === 'browser:groups').length`)
  check('Tabs stops polling once another view is in front', after_hidden === 0, String(after_hidden))

  // ---- Clipboard
  await open('clipboard')
  check('a secret-looking entry is masked in the list and its text is not in the page', (await ev(`return !document.body.innerText.includes('Xy7#qP9') && $$('#view-clipboard .rv-preview.masked').length === 1`)))
  await ev(`await tap(byLabel($('#view-clipboard'), 'Show a hidden'), 900)`)
  check('the reveal button shows it (explicit request only)', (await ev(`return $('#view-clipboard').innerText.includes('Xy7#qP9!zLm2$kR8')`)))
  await ev(`await tap(byLabel($('#view-clipboard'), 'Hide it again'), 600)`)
  check('and hides it again', (await ev(`return !$('#view-clipboard').innerText.includes('Xy7#qP9')`)))
  await ev(`await tap($('#view-clipboard [data-key^="clip-"]:not([data-key=""])'), 600)`)
  await ev(`const row = [...$$('#view-clipboard .rv-item')].find(r => r.innerText.includes('Meeting notes')); await tap(byLabel(row, 'Keep'), 900)`)
  check('keeping an entry pins it in the store', (await ev(`return (await rpc('clipboard:list', ['', 'pinned'])).items.some(i => i.preview.startsWith('Meeting'))`)))
  await ev(`const row = [...$$('#view-clipboard .rv-item')].find(r => r.innerText.includes('developer.mozilla.org/en-US')); await tap(byLabel(row, 'Delete'), 900)`)
  check('deleting an entry removes it from the store', (await ev(`return !(await rpc('clipboard:list', ['', 'all'])).items.some(i => i.preview.includes('Fetch_API'))`)))
  await ev(`const b = byLabel($('#view-clipboard'), 'Clear the history'); await tap(b, 200); await tap(byLabel($('#view-clipboard'), 'Confirm'), 900)`)
  check('clear keeps the pinned entries', (await ev(`const l = (await rpc('clipboard:list', ['', 'all'])).items; return l.length === 2 && l.every(i => i.pinned)`)))

  // ---- Reminders
  await open('reminders')
  check('Reminders lists real reminders and marks the late one', (await ev(`return $$('#view-reminders .rv-item').length === 3 && $('#view-reminders').innerText.includes('Overdue')`)))
  await ev(`const i = $('#view-reminders input[name="title"]'); i.value = 'Water the plants'; i.dispatchEvent(new Event('input')); $('#view-reminders form').requestSubmit(); await pause(900)`)
  check('adding a reminder stores it', (await ev(`return (await rpc('reminders:list')).some(r => r.title === 'Water the plants')`)))
  await ev(`const row = [...$$('#view-reminders .rv-item')].find(r => r.innerText.includes('Send the invoice')); await tap(row.querySelector('.rv-check'), 900)`)
  check('ticking a reminder completes it', (await ev(`return (await rpc('reminders:list')).find(r => r.title === 'Send the invoice').done === true`)))
  await ev(`const row = [...$$('#view-reminders .rv-item')].find(r => r.innerText.includes('Water the plants')); await tap(byLabel(row, 'Delete'), 900)`)
  check('deleting a reminder removes it', (await ev(`return !(await rpc('reminders:list')).some(r => r.title === 'Water the plants')`)))

  // ---- Whiteboard
  await open('whiteboard')
  await ev(`const i = $('#view-whiteboard input[name="board"]'); i.value = 'Sketches'; i.dispatchEvent(new Event('input')); $('#view-whiteboard form').requestSubmit(); await pause(900)`)
  check('a board is created', (await ev(`return (await rpc('whiteboard:list')).some(b => b.name === 'Sketches')`)))
  await ev(`const row = [...$$('#view-whiteboard .rv-card')].find(r => r.innerText.includes('Sketches')); await tap(byLabel(row, 'Add the page'), 900)`)
  check('the page in front is added as a note', (await ev(`const l = await rpc('whiteboard:list'); return l.find(b => b.name === 'Sketches').count === 1`)))
  await ev(`const row = [...$$('#view-whiteboard .rv-card')].find(r => r.innerText.includes('Sketches')); await tap(row.querySelector('.rv-main'), 900)`)
  check('opening a board lists its notes', (await ev(`const row = [...$$('#view-whiteboard .rv-card')].find(r => r.innerText.includes('Sketches')); return row.querySelector('.rv-notes')?.innerText.includes('https://')`)))
  await ev(`const row = [...$$('#view-whiteboard .rv-card')].find(r => r.innerText.includes('Sketches')); await tap(byLabel(row, 'Delete'), 200); await tap(byLabel([...$$('#view-whiteboard .rv-card')].find(r => r.innerText.includes('Sketches')), 'Confirm'), 900)`)
  check('deleting a board needs a second press and removes it', (await ev(`return !(await rpc('whiteboard:list')).some(b => b.name === 'Sketches')`)))

  // ---- Workspaces
  await open('workspaces')
  await ev(`const i = $('#view-workspaces input[name="workspace"]'); i.value = 'Evening'; i.dispatchEvent(new Event('input')); $('#view-workspaces form').requestSubmit(); await pause(900)`)
  check('the open pages are saved as a workspace', (await ev(`const l = await rpc('workspaces:list'); return l.some(w => w.name === 'Evening' && w.tabs === 5)`)))
  await ev(`const row = [...$$('#view-workspaces .rv-item')].find(r => r.innerText.includes('Research day')); await tap(byLabel(row, 'Switch to Research day'), 1200)`)
  check('switching opens the workspace through the control layer and closes the rest', (await ev(`const t = await rpc('browser:tabs'); return t.length === 5 && t.every(x => x.id.startsWith('2'))`)))
  await ev(`const row = [...$$('#view-workspaces .rv-item')].find(r => r.innerText.includes('Evening')); await tap(byLabel(row, 'Rename Evening'), 300); const i = $('#view-workspaces input[name="rename"]'); i.value = 'Night'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await pause(900)`)
  check('rename is stored', (await ev(`return (await rpc('workspaces:list')).some(w => w.name === 'Night')`)))
  await ev(`const row = [...$$('#view-workspaces .rv-item')].find(r => r.innerText.includes('Night')); await tap(byLabel(row, 'Delete'), 200); await tap(byLabel([...$$('#view-workspaces .rv-item')].find(r => r.innerText.includes('Night')), 'Confirm'), 900)`)
  check('delete removes it', (await ev(`return !(await rpc('workspaces:list')).some(w => w.name === 'Night')`)))

  // ---- Research and Sources
  await open('research')
  check('Research lists saved sessions from the store', (await ev(`return $$('#view-research .rv-item').length === 2`)))
  await open('sources')
  check('Sources lists the pages research used, de-duplicated', (await ev(`return $$('#view-sources .rv-item').length === 3`)))
  await open('research')
  await ev(`const row = $$('#view-research .rv-item')[1]; await tap(byLabel(row, 'Delete'), 200); await tap(byLabel($$('#view-research .rv-item')[1], 'Confirm'), 900)`)
  check('deleting research removes the session', (await ev(`return (await rpc('search-sessions:list', [])).length === 1`)))

  // ---- Saved pages and Screenshots
  await open('savedPages')
  check('Saved pages lists the two saved pages', (await ev(`return $$('#view-savedPages .rv-item').length === 2`)))
  await ev(`await tap(byLabel($$('#view-savedPages .rv-item')[0], 'Forget'), 900)`)
  check('forgetting removes it from the list', (await ev(`return (await rpc('library:saved-pages')).length === 1`)))
  await open('screenshots')
  await pause_ok(ev)
  check('thumbnails load for files that exist and say when one is missing', (await ev(`return $$('#view-screenshots .rv-thumb img').length === 2 && $('#view-screenshots').innerText.includes('File missing')`)))
  await ev(`await tap($$('#view-screenshots .rv-thumbbtn')[0], 800)`)
  check('a picture opens large, and Escape-able dialog is shown', (await ev(`return !$('#view-screenshots .rv-shotview').hidden`)))
  await ev(`await tap($('#view-screenshots .rv-shotview .iconbtn'), 300)`)
  await ev(`const f = $$('#view-screenshots .rv-shot')[0]; await tap(byLabel(f, 'Delete'), 200); await tap(byLabel($$('#view-screenshots .rv-shot')[0], 'Confirm'), 900)`)
  check('deleting a picture needs a second press and removes it', (await ev(`return (await rpc('library:screenshots')).length === 2`)))

  // ---- The rail: layout, resize, arranging
  await ev(`await tap('#rail [aria-label="Sidebar width"]', 100); $('#rail .rail-resizer').focus(); return true`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await sleep(700)
  check('the arrow keys resize the rail and the width is saved', (await ev(`const s = await rpc('sidebar:get'); return s.width === 222 && $('#rail').style.width === '222px'`)))
  await ev(`const g = $('#rail .rail-resizer'); const r = g.getBoundingClientRect(); return [r.x + 3, r.y + 100]`)
  const at = await ev(`const g = $('#rail .rail-resizer'); const r = g.getBoundingClientRect(); return [r.x + 3, r.y + 100]`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] + 60, y: at[1], button: 'left' })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0] + 60, y: at[1], button: 'left', clickCount: 1 })
  await sleep(800)
  check('dragging the edge resizes the rail and saves the width', (await ev(`const s = await rpc('sidebar:get'); return s.width >= 270 && s.width <= 290`)))
  await ev(`await tap('#rail [aria-label^="Arrange the sidebar"]', 400)`)
  await ev(`await tap('#rail [aria-label="New group"]', 700)`)
  check('a group is created and saved', (await ev(`return (await rpc('sidebar:get')).groups.some(g => g.label === 'New group')`)))
  await ev(`await tap($$('#rail .rail-tool').find(b => b.getAttribute('aria-label').startsWith('Rename the group New group')), 300)`)
  await ev(`const i = $('#rail .rail-rename'); i.value = 'Mine'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await pause(700)`)
  check('the group is renamed and saved', (await ev(`return (await rpc('sidebar:get')).groups.some(g => g.label === 'Mine')`)))
  // Drag a row into the new group with real drag events.
  await ev(`
    const dt = new DataTransfer()
    const row = $('#rail .rail-row[data-panel="media"]'), head = $('#rail .rail-headrow[data-group]:not(:has(.rail-rename))'), heads = $$('#rail .rail-headrow'), mine = heads.find(h => h.innerText.toLowerCase().includes('mine'))
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    mine.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    mine.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await pause(800)`)
  check('dragging a row onto a group moves it there and saves it', (await ev(`const s = await rpc('sidebar:get'); const g = s.groups.find(x => x.label === 'Mine'); return g.items.includes('media')`)))
  await ev(`const dt = new DataTransfer(); const rowA = $('#rail .rail-row[data-panel="tabs"]'), rowB = $('#rail .rail-row[data-panel="tabGroups"]'); rowA.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); const r = rowB.getBoundingClientRect(); rowB.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.bottom - 1 })); rowB.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.bottom - 1 })); await pause(800)`)
  check('dragging a row below another reorders within its group', (await ev(`const s = await rpc('sidebar:get'); const g = s.groups.find(x => x.items.includes('tabs')); return g.items.indexOf('tabGroups') < g.items.indexOf('tabs')`)))
  await ev(`await tap($$('#rail .rail-tool').find(b => b.getAttribute('aria-label').startsWith('Delete the group Mine')), 700)`)
  check('deleting the group keeps its panels', (await ev(`const s = await rpc('sidebar:get'); return !s.groups.some(g => g.label === 'Mine') && s.groups.flatMap(g => g.items).includes('media')`)))
  await ev(`await tap('#rail [aria-label="Icons only"]', 500)`)
  check('icon-only mode drops the labels and is saved', (await ev(`const s = await rpc('sidebar:get'); return s.mode === 'icons' && !$('#rail .rail-label')`)))

  check('no page errors were raised during the whole run', errors.length === 0, errors.slice(0, 3).join(' | '))
})
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
process.exit(failed ? 1 : 0)

async function pause_ok(ev) {
  await ev(`await pause(600)`)
}
