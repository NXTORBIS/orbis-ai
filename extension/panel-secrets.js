import { call } from './helper.js'

// Secrets, in the Orbis panel: the same vault Electron Orbis uses. The panel lists what each secret says about itself (its name,
// what it is for, its site) and can add, rename, set a NEW value, or delete. It is never sent a secret's value, so it cannot
// show or copy one: to read a secret, open Orbis. The master password is typed here only to unlock, and is not kept.

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

let status = null
let secrets = []
let query = ''
let problem = ''
let screen = 'list' // list | add | edit
let editing = null

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    if (err?.code === 'locked') status = { ...(status || { exists: true }), unlocked: false }
    else problem = err?.message || 'That did not work.'
    return null
  }
}

async function load() {
  const s = await run('secrets:status')
  if (s) status = s
  secrets = []
  if (status?.exists && status.unlocked) {
    const list = await run('secrets:list', query ? [query] : [])
    if (list) secrets = list
  }
  draw()
}

function form(secret) {
  const adding = !secret
  const f = {
    kind: el('select', { 'aria-label': 'Kind' }, ...KINDS.map(([id, label]) => el('option', { value: id }, label))),
    name: el('input', { type: 'text', 'aria-label': 'Name', placeholder: 'Name', maxlength: '120', autocomplete: 'off', required: '' }),
    provider: el('input', { type: 'text', 'aria-label': 'What it is for', placeholder: 'For (Groq, GitHub…)', maxlength: '120', autocomplete: 'off' }),
    website: el('input', { type: 'text', 'aria-label': 'Website', placeholder: 'Website', maxlength: '500', autocomplete: 'off' }),
    username: el('input', { type: 'text', 'aria-label': 'Username', placeholder: 'Username', maxlength: '120', autocomplete: 'off' }),
    value: el('input', { type: 'password', 'aria-label': adding ? 'Secret value' : 'New value', placeholder: adding ? 'The secret' : 'New value (leave empty to keep the current one)', autocomplete: 'new-password', spellcheck: 'false' })
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
    if (f.value.value) body.value = f.value.value
    const done = adding ? await run('secrets:add', [body]) : await run('secrets:update', [secret.id, body])
    f.value.value = '' // forgotten as soon as it is sent
    if (done) { screen = 'list'; editing = null }
    await load()
  }
  const form = el('form', { class: 'editor', 'aria-label': adding ? 'Add a secret' : 'Edit secret', onsubmit: (e) => { e.preventDefault(); void save() } },
    f.kind, f.name, f.provider, f.website, f.username, f.value,
    el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Save'), el('button', { type: 'button', onclick: () => { f.value.value = ''; screen = 'list'; editing = null; draw() } }, 'Cancel'),
      adding ? null : el('button', { type: 'button', class: 'danger', onclick: async () => {
        if (!confirm(`Delete “${secret.name}”? This cannot be undone.`)) return
        await run('secrets:delete', [secret.id])
        screen = 'list'; editing = null
        await load()
      } }, 'Delete')))
  queueMicrotask(() => f.name.focus())
  return form
}

function unlockForm() {
  const password = el('input', { type: 'password', 'aria-label': 'Master password', placeholder: 'Master password', autocomplete: 'current-password', required: '' })
  return el('form', { class: 'editor', 'aria-label': 'Unlock the vault', onsubmit: async (e) => {
    e.preventDefault()
    const pw = password.value
    password.value = ''
    if (!pw) return
    const s = await run('secrets:unlock', [pw])
    if (s) status = s
    const said = problem
    await load()
    if (said) { problem = said; draw() }
  } }, el('strong', {}, 'Vault locked'), password, el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Unlock')))
}

function draw() {
  root.replaceChildren()
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (!status) return root.append(el('p', { class: 'empty' }, problem ? '' : 'Opening…'))
  if (!status.exists) return root.append(el('p', { class: 'empty' }, 'No vault on this profile yet. Make one in Orbis (Secrets), then come back.'))
  if (!status.unlocked) return root.append(unlockForm())

  const search = el('input', { type: 'search', 'aria-label': 'Search secrets', placeholder: `Search ${status.count ?? secrets.length} secrets`, autocomplete: 'off', value: query, onchange: (e) => { query = e.target.value; void load() } })
  root.append(el('div', { class: 'row' }, search,
    el('button', { type: 'button', onclick: () => { screen = screen === 'add' ? 'list' : 'add'; editing = null; draw() } }, 'Add'),
    el('button', { type: 'button', onclick: async () => { const s = await run('secrets:lock'); if (s) status = s; await load() } }, 'Lock')))
  if (screen === 'add') root.append(form(null))
  if (!secrets.length && screen !== 'add') root.append(el('p', { class: 'empty' }, query ? 'Nothing matches that.' : 'Nothing kept here yet.'))
  for (const s of secrets) {
    if (screen === 'edit' && editing === s.id) { root.append(form(s)); continue }
    const detail = [KIND[s.kind] || s.kind, s.provider, s.username, s.website].filter(Boolean).join(' · ')
    root.append(el('button', { type: 'button', class: 'item', 'aria-label': `Edit secret ${s.name}`, onclick: () => { screen = 'edit'; editing = s.id; draw() } },
      el('strong', {}, (s.favorite ? '★ ' : '') + s.name), el('span', { class: 'muted' }, detail)))
  }
  root.append(el('p', { class: 'muted' }, 'Values are never shown here. Open Orbis to read or copy one.'))
}

// The list is not left in the page when the tab is left: leaving locks nothing, but nothing lingers on screen either.
new MutationObserver(() => { if (view.hidden) { secrets = []; root.replaceChildren() } }).observe(view, { attributes: true, attributeFilter: ['hidden'] })
document.addEventListener('orbis:secrets-shown', () => { screen = 'list'; editing = null; void load() })
