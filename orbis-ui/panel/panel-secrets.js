import { call } from './helper.js'

// Secrets, in the Orbis panel: the same vault Electron Orbis uses, with the same protections as its Secrets screen.
//  - The list is what each secret says about itself (name, kind, provider, username, site). A value is asked for one secret at a
//    time, shown for 20 seconds (like the Orbis window) and then wiped from the page; it is also wiped when the row is redrawn,
//    when it is hidden, when the vault locks and when this tab is left. It is never logged and never stored by the panel.
//  - Copy asks for the value, hands it to the clipboard and drops it. (The Orbis window does not clear the clipboard afterwards
//    either, so neither does this.)
//  - The master password is typed here only to be sent for that one call, and the field is cleared as it is sent.
// Text only, never HTML.

const root = document.getElementById('secrets')
const view = document.getElementById('view-secrets')
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  node.append(...children.filter((c) => c !== null && c !== undefined))
  return node
}
const KINDS = [['apiKey', 'API key'], ['password', 'Password'], ['login', 'Login'], ['note', 'Secure note'], ['recoveryCode', 'Recovery code'], ['custom', 'Custom secret']]
const KIND = Object.fromEntries(KINDS)
const AUTO_LOCK = [[0, 'Immediately'], [60000, '1 minute'], [300000, '5 minutes'], [900000, '15 minutes'], [1800000, '30 minutes'], [3600000, '1 hour'], [-1, 'Never']]
const REVEAL_MS = 20_000
const MARK = { apiKey: '\u2328', password: '\u2022\u2022', login: '\u263A', note: '\u270E', recoveryCode: '\u21BB', custom: '\u2726' }
const MASKED = '•'.repeat(16)

let status = null
let secrets = []
let query = ''
let problem = ''
let notice = ''
let screen = 'list' // list | add | edit | settings | recover
let editing = null
let question = null
/** Timers and cells of the values on screen, so every one can be wiped at once. */
const shown = new Map()

function wipeAll() {
  for (const { timer, cell } of shown.values()) {
    clearTimeout(timer)
    cell.textContent = MASKED
  }
  shown.clear()
}

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    if (err?.code === 'locked') { status = { ...(status || { exists: true }), unlocked: false }; wipeAll() }
    else problem = err?.message || 'That did not work.'
    return null
  }
}


// ---------------------------------------------------------------- the lock, drawn
//
// One drawing for every state of the vault: shut and dim when there is none yet, shut and breathing while it waits
// for the master password, and with its shackle lifted when it is open. Built node by node -- the page does not
// allow markup strings -- and styled in sidebar.css, where the movement lives.
const SVG = 'http://www.w3.org/2000/svg'
const sv = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  n.append(...kids)
  return n
}
function lockArt(mode) {
  const svg = sv('svg', { viewBox: '0 0 120 140', class: `vault-lock ${mode}`, 'aria-hidden': 'true' })
  const defs = sv('defs')
  const body = sv('linearGradient', { id: `vl-body-${mode}`, x1: '0', y1: '0', x2: '1', y2: '1' })
  body.append(sv('stop', { offset: '0', 'stop-color': '#22d3ee' }), sv('stop', { offset: '1', 'stop-color': '#7c5cff' }))
  defs.append(body)
  const halo = sv('circle', { class: 'vl-halo', cx: '60', cy: '78', r: '52' })
  const ring1 = sv('circle', { class: 'vl-ring r1', cx: '60', cy: '78', r: '58', fill: 'none' })
  const ring2 = sv('circle', { class: 'vl-ring r2', cx: '60', cy: '78', r: '66', fill: 'none' })
  const shackle = sv('g', { class: 'vl-shackle' }, sv('path', { d: 'M38 66 V46 a22 22 0 0 1 44 0 V66', fill: 'none', 'stroke-width': '9', 'stroke-linecap': 'round' }))
  const bodyRect = sv('rect', { class: 'vl-body', x: '24', y: '64', width: '72', height: '58', rx: '14', fill: `url(#vl-body-${mode})` })
  const gloss = sv('path', { class: 'vl-gloss', d: 'M30 74 h60', stroke: 'rgba(255,255,255,.35)', 'stroke-width': '3', 'stroke-linecap': 'round' })
  const keyhole = sv('g', { class: 'vl-key' }, sv('circle', { cx: '60', cy: '88', r: '7' }), sv('path', { d: 'M56.5 92 h7 l2 16 h-11 z' }))
  svg.append(defs, halo, ring1, ring2, shackle, bodyRect, gloss, keyhole)
  return svg
}
const hero = (mode, title, line) =>
  el('div', { class: `vault-hero ${mode}` }, lockArt(mode), el('h2', { class: 'vault-title' }, title), el('p', { class: 'vault-line' }, line))

async function load() {
  const keepProblem = problem
  const s = await run('secrets:status')
  if (s) status = s
  secrets = []
  if (status?.exists && status.unlocked) {
    const list = await run('secrets:list', query ? [query] : [])
    if (list) secrets = list
  }
  if (keepProblem && !problem) problem = keepProblem
  draw()
}

const password = (label, extra = {}) => el('input', { type: 'password', 'aria-label': label, placeholder: label, autocomplete: 'off', spellcheck: 'false', ...extra })
/** Reads a password field and clears it in the same breath. */
const take = (input) => { const v = input.value; input.value = ''; return v }
const status2 = (s) => { if (s) status = s }

// ---------------------------------------------------------------- the ways in

function setupForm() {
  const pw = password('Master password', { autocomplete: 'new-password' })
  const again = password('Master password again', { autocomplete: 'new-password' })
  const q = el('input', { type: 'text', 'aria-label': 'Recovery question', placeholder: 'Recovery question (optional)', maxlength: '300', autocomplete: 'off' })
  const a = password('Recovery answer')
  return el('form', { class: 'editor vault-card', 'aria-label': 'Make a vault', onsubmit: async (e) => {
    e.preventDefault()
    const first = take(pw)
    const second = take(again)
    const answer = take(a)
    if (first.length < 8) { problem = 'A master password needs at least 8 characters.'; return draw() }
    if (first !== second) { problem = 'Those two are not the same.'; return draw() }
    status2(await run('secrets:create', [first, q.value.trim() && answer ? { question: q.value.trim(), answer } : undefined]))
    await load()
  } },
  hero('none', 'Make your vault', 'The master password is the only way in. It is never stored; if it is lost, the recovery question is the one other way back in.'),
  pw, again, q, a, el('div', { class: 'row' }, el('button', { type: 'submit', class: 'vault-go' }, 'Make the vault')))
}

function unlockForm() {
  const pw = password('Master password', { autocomplete: 'current-password', required: '' })
  const art = hero('locked', 'Vault locked', 'Your keys, passwords and notes are sealed. Enter the master password to open it.')
  return el('form', { class: 'editor vault-card', 'aria-label': 'Unlock the vault', onsubmit: async (e) => {
    e.preventDefault()
    const typed = take(pw)
    if (!typed) return
    art.classList.add('working')
    status2(await run('secrets:unlock', [typed]))
    if (status?.unlocked) {
      // The shackle lifts and the lock goes green before the list replaces it.
      art.className = 'vault-hero open'
      art.querySelector('.vault-lock').setAttribute('class', 'vault-lock open')
      art.querySelector('.vault-title').textContent = 'Vault open'
      art.querySelector('.vault-line').textContent = 'Welcome back.'
      await new Promise((r) => setTimeout(r, 900))
    } else {
      art.classList.remove('working')
      art.classList.add('denied')
      setTimeout(() => art.classList.remove('denied'), 600)
    }
    await load()
  } }, art, pw,
  el('div', { class: 'row' }, el('button', { type: 'submit', class: 'vault-go' }, 'Unlock'), el('button', { type: 'button', onclick: async () => {
    const r = await run('secrets:question')
    question = r ? r.question : null
    screen = 'recover'
    draw()
  } }, 'Forgot password?')))
}

function recoverForm() {
  if (question === null) {
    return el('div', { class: 'editor' }, el('strong', {}, 'Forgot master password'),
      el('p', { class: 'muted' }, 'This vault has no recovery question, so there is no way to open it without the master password. That is what makes it a vault: nobody, including Orbis, can read it without that password.'),
      el('div', { class: 'row' }, el('button', { type: 'button', onclick: () => { screen = 'list'; problem = ''; draw() } }, 'Back')))
  }
  const answer = password('Answer')
  const pw = password('New master password', { autocomplete: 'new-password' })
  return el('form', { class: 'editor', 'aria-label': 'Recover the vault', onsubmit: async (e) => {
    e.preventDefault()
    const a = take(answer)
    const n = take(pw)
    if (n.length < 8) { problem = 'A master password needs at least 8 characters.'; return draw() }
    const s = await run('secrets:recover', [a, n])
    if (s) { status = s; screen = 'list' }
    await load()
  } }, el('strong', {}, 'Recover the vault'), el('p', { class: 'muted' }, question), answer, pw,
  el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Recover'), el('button', { type: 'button', onclick: () => { screen = 'list'; problem = ''; draw() } }, 'Back')))
}

// ---------------------------------------------------------------- settings

function settingsForm() {
  const box = el('div', { class: 'editor', 'aria-label': 'Vault settings' }, el('strong', {}, 'Vault settings'))
  // auto-lock
  const lockPw = password('Master password')
  const lockSel = el('select', { 'aria-label': 'Lock after' }, ...AUTO_LOCK.map(([ms, label]) => el('option', { value: String(ms) }, label)))
  lockSel.value = String(status.autoLockMs ?? 300000)
  box.append(el('form', { class: 'sub', onsubmit: async (e) => {
    e.preventDefault()
    const s = await run('secrets:auto-lock', [take(lockPw), Number(lockSel.value)])
    if (s) { status = s; notice = 'Auto-lock changed.' }
    await load()
  } }, el('label', { class: 'check' }, 'Lock itself after', lockSel), lockPw, el('button', { type: 'submit' }, 'Change auto-lock')))
  // master password
  const cur = password('Current master password')
  const next = password('New master password', { autocomplete: 'new-password' })
  box.append(el('form', { class: 'sub', onsubmit: async (e) => {
    e.preventDefault()
    const c = take(cur)
    const n = take(next)
    if (n.length < 8) { problem = 'A master password needs at least 8 characters.'; return draw() }
    const s = await run('secrets:change-password', [c, n])
    if (s) { status = s; notice = 'Master password changed.' }
    await load()
  } }, el('span', { class: 'muted' }, 'Change the master password'), cur, next, el('button', { type: 'submit' }, 'Change password')))
  // recovery
  const rpw = password('Master password')
  const rq = el('input', { type: 'text', 'aria-label': 'Recovery question', placeholder: 'Recovery question', maxlength: '300', autocomplete: 'off' })
  const ra = password('Recovery answer')
  box.append(el('form', { class: 'sub', onsubmit: async (e) => {
    e.preventDefault()
    const p = take(rpw)
    const answer = take(ra)
    const s = await run('secrets:set-recovery', [p, rq.value.trim() && answer ? { question: rq.value.trim(), answer } : null])
    if (s) { status = s; notice = s.hasRecovery ? 'Recovery question set.' : 'Recovery removed.' }
    await load()
  } }, el('span', { class: 'muted' }, status.hasRecovery ? 'A recovery question is set. Change it, or leave it empty to remove it.' : 'No recovery question is set.'), rpw, rq, ra, el('button', { type: 'submit' }, 'Save recovery')))
  // delete the vault
  const dpw = password('Master password')
  box.append(el('form', { class: 'sub', onsubmit: async (e) => {
    e.preventDefault()
    const p = take(dpw)
    if (!p) return
    if (!confirm('Delete this vault and every secret in it? This cannot be undone.')) return
    const s = await run('secrets:destroy', [p])
    if (s) { status = s; screen = 'list'; wipeAll() }
    await load()
  } }, el('span', { class: 'muted' }, 'Delete the vault and everything in it'), dpw, el('button', { type: 'submit', class: 'danger' }, 'Delete the vault')))
  box.append(el('div', { class: 'row' }, el('button', { type: 'button', onclick: () => { screen = 'list'; draw() } }, 'Done')))
  return box
}

// ---------------------------------------------------------------- one secret

function form(secret) {
  const adding = !secret
  const f = {
    kind: el('select', { 'aria-label': 'Kind' }, ...KINDS.map(([id, label]) => el('option', { value: id }, label))),
    name: el('input', { type: 'text', 'aria-label': 'Name', placeholder: 'Name', maxlength: '120', autocomplete: 'off', required: '' }),
    provider: el('input', { type: 'text', 'aria-label': 'What it is for', placeholder: 'For (Groq, GitHub…)', maxlength: '120', autocomplete: 'off' }),
    website: el('input', { type: 'text', 'aria-label': 'Website', placeholder: 'Website', maxlength: '500', autocomplete: 'off' }),
    username: el('input', { type: 'text', 'aria-label': 'Username', placeholder: 'Username', maxlength: '120', autocomplete: 'off' }),
    value: password(adding ? 'Secret value' : 'New value (leave empty to keep the current one)', { 'aria-label': adding ? 'Secret value' : 'New value', autocomplete: 'new-password' })
  }
  if (secret) {
    f.kind.value = secret.kind
    f.name.value = secret.name
    f.provider.value = secret.provider || ''
    f.website.value = secret.website || ''
    f.username.value = secret.username || ''
  }
  const save = async () => {
    const body = { kind: f.kind.value, name: f.name.value, provider: f.provider.value, website: f.website.value, username: f.username.value }
    const v = take(f.value)
    if (v) body.value = v
    const done = adding ? await run('secrets:add', [body]) : await run('secrets:update', [secret.id, body])
    if (done) { screen = 'list'; editing = null }
    await load()
  }
  const el2 = el('form', { class: 'editor', 'aria-label': adding ? 'Add a secret' : 'Edit secret', onsubmit: (e) => { e.preventDefault(); void save() } },
    f.kind, f.name, f.provider, f.website, f.username, f.value,
    el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Save'), el('button', { type: 'button', onclick: () => { f.value.value = ''; screen = 'list'; editing = null; draw() } }, 'Cancel'),
      adding ? null : el('button', { type: 'button', class: 'danger', onclick: async () => {
        if (!confirm(`Delete “${secret.name}”? This cannot be undone.`)) return
        await run('secrets:delete', [secret.id])
        screen = 'list'; editing = null
        await load()
      } }, 'Delete')))
  queueMicrotask(() => f.name.focus())
  return el2
}

/** The clipboard API, or (when the browser will not allow it here) a select-and-copy on a field that exists for an instant. */
async function toClipboard(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch { /* fall through */ }
  const t = document.createElement('textarea')
  t.value = value
  t.setAttribute('readonly', '')
  t.style.cssText = 'position:fixed;left:-1000px;opacity:0'
  document.body.append(t)
  t.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  t.value = ''
  t.remove()
  return ok
}

function row(s) {
  const cell = el('code', { class: 'vault-value', 'aria-live': 'polite' }, MASKED)
  const hide = () => {
    const held = shown.get(s.id)
    if (held) clearTimeout(held.timer)
    shown.delete(s.id)
    cell.textContent = MASKED
    reveal.textContent = 'Reveal'
    reveal.setAttribute('aria-label', `Reveal ${s.name}`)
  }
  const reveal = el('button', { type: 'button', 'aria-label': `Reveal ${s.name}`, onclick: async () => {
    if (shown.has(s.id)) return hide()
    const r = await run('secrets:reveal', [s.id])
    if (!r) return draw()
    cell.textContent = r.value || '(nothing in it)'
    r.value = ''
    shown.set(s.id, { cell, timer: setTimeout(hide, REVEAL_MS) })
    reveal.textContent = 'Hide'
    reveal.setAttribute('aria-label', `Hide ${s.name}`)
  } }, 'Reveal')
  const copy = el('button', { type: 'button', 'aria-label': `Copy ${s.name}`, onclick: async () => {
    const r = await run('secrets:reveal', [s.id])
    if (!r) return draw()
    if (await toClipboard(r.value)) notice = `${s.name} copied.`
    else problem = 'That could not be copied.'
    r.value = ''
    draw()
  } }, 'Copy')
  const detail = [KIND[s.kind] || s.kind, s.provider, s.username, s.website].filter(Boolean).join(' · ')
  return el('div', { class: `secret kind-${s.kind}` },
    el('span', { class: 'secret-mark', 'aria-hidden': 'true' }, MARK[s.kind] || '\u26BF'),
    el('div', { class: 'item' }, el('strong', {}, (s.favorite ? '\u2605 ' : '') + s.name), el('span', { class: 'muted' }, detail), cell),
    el('div', { class: 'row' }, reveal, copy, el('button', { type: 'button', 'aria-label': `Edit ${s.name}`, onclick: () => { wipeAll(); screen = 'edit'; editing = s.id; draw() } }, 'Edit')))
}

function draw() {
  wipeAll() // nothing revealed survives a redraw
  root.replaceChildren()
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (notice) { root.append(el('div', { class: 'muted', role: 'status' }, notice)); notice = '' }
  if (!status) return void root.append(el('p', { class: 'empty' }, problem ? '' : 'Opening…'))
  if (!status.exists) return void root.append(setupForm())
  if (!status.unlocked) return void root.append(screen === 'recover' ? recoverForm() : unlockForm())
  if (screen === 'settings') return void root.append(settingsForm())

  const search = el('input', { type: 'search', 'aria-label': 'Search secrets', placeholder: `Search ${status.count ?? secrets.length} secrets`, autocomplete: 'off', value: query, onchange: (e) => { query = e.target.value; void load() } })
  const count = status.count ?? secrets.length
  root.append(el('div', { class: 'vault-open-head' }, lockArt('open'), el('div', {}, el('strong', { class: 'vault-title' }, 'Vault open'), el('span', { class: 'vault-line' }, `${count} ${count === 1 ? 'secret' : 'secrets'} kept safe`))))
  root.append(el('div', { class: 'row vault-tools' }, search,
    el('button', { type: 'button', onclick: () => { screen = screen === 'add' ? 'list' : 'add'; editing = null; draw() } }, 'Add'),
    el('button', { type: 'button', onclick: () => { screen = 'settings'; draw() } }, 'Settings'),
    el('button', { type: 'button', onclick: async () => { const s = await run('secrets:lock'); status2(s); await load() } }, 'Lock')))
  if (screen === 'add') root.append(form(null))
  if (!secrets.length && screen !== 'add') root.append(el('p', { class: 'empty' }, query ? 'Nothing matches that.' : 'Nothing kept here yet.'))
  for (const s of secrets) root.append(screen === 'edit' && editing === s.id ? form(s) : row(s))
  root.append(el('p', { class: 'muted' }, 'A value is shown for 20 seconds when you reveal it, then hidden again.'))
}

// Nothing lingers on screen when the tab is left, and a locked vault shows nothing.
new MutationObserver(() => { if (view.hidden) { wipeAll(); secrets = []; root.replaceChildren() } }).observe(view, { attributes: true, attributeFilter: ['hidden'] })
document.addEventListener('orbis:secrets-shown', () => { screen = 'list'; editing = null; void load() })

/*
 * And once, now, if this is the view the panel opened at.
 *
 * The event above is dispatched by `showTab`, which runs as the page loads for whichever view the address names --
 * before this module has been evaluated, so there is nobody listening yet. Without this, landing straight on
 * #secrets drew the frame and nothing in it, and going to another view and back filled it in: a fault that only
 * shows itself to somebody who opens the address directly and does not look twice.
 */
{
  const here = document.getElementById('view-secrets')
  if (here && !here.hidden) void load()
}
