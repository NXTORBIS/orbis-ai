import { call } from './helper.js'

// Notes, in the Orbis panel: the same notes Electron Orbis keeps, from the helper. Text goes on the page as text only.

const root = document.getElementById('notes')
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  node.append(...children.filter((c) => c !== null && c !== undefined))
  return node
}
const titleOf = (n) => n.title || (n.body.split('\n').find((l) => l.trim()) || 'Untitled note').replace(/^#+\s*/, '').slice(0, 80)

let notes = []
let query = ''
let showArchived = false
let editing = null // a note id, or 'new'
let problem = ''

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    problem = err?.message || 'That did not work.'
    return null
  }
}
async function load() {
  const found = await run('notes:list', [{ query, archived: showArchived }])
  if (found) notes = found
  draw()
}

function editor(note) {
  const title = el('input', { type: 'text', 'aria-label': 'Note title', placeholder: 'Title', maxlength: '200' })
  const body = el('textarea', { 'aria-label': 'Note text', rows: '8', placeholder: 'Write…' })
  const tags = el('input', { type: 'text', 'aria-label': 'Tags, separated by commas', placeholder: 'Tags, separated by commas' })
  title.value = note?.title ?? ''
  body.value = note?.body ?? ''
  tags.value = (note?.tags ?? []).join(', ')
  const save = async () => {
    const patch = { title: title.value, body: body.value, tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) }
    const saved = note ? await run('notes:update', [note.id, patch]) : await run('notes:create', [patch])
    if (saved) editing = null
    await load()
  }
  const change = (patch) => async () => {
    await run('notes:update', [note.id, patch])
    editing = null
    await load()
  }
  const form = el('form', { class: 'editor', 'aria-label': note ? 'Edit note' : 'New note', onsubmit: (e) => { e.preventDefault(); void save() } },
    title, body, tags,
    el('div', { class: 'row' },
      el('button', { type: 'submit' }, 'Save'),
      el('button', { type: 'button', onclick: () => { editing = null; draw() } }, 'Cancel'),
      note ? el('button', { type: 'button', onclick: change({ pinned: !note.pinned }) }, note.pinned ? 'Unpin' : 'Pin') : null,
      note ? el('button', { type: 'button', onclick: change({ archived: !note.archived }) }, note.archived ? 'Restore' : 'Archive') : null,
      note ? el('button', { type: 'button', class: 'danger', onclick: async () => { await run('notes:delete', [note.id]); editing = null; await load() } }, 'Delete') : null))
  queueMicrotask(() => (note ? body : title).focus())
  return form
}

function draw() {
  root.replaceChildren()
  const search = el('input', { type: 'search', 'aria-label': 'Search notes', placeholder: 'Search notes…', autocomplete: 'off' })
  search.value = query
  let timer = null
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = search.value; void load() }, 200) })
  root.append(el('div', { class: 'row' }, search, el('button', { type: 'button', onclick: () => { editing = 'new'; draw() } }, 'New note')),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', ...(showArchived ? { checked: '' } : {}), onchange: (e) => { showArchived = e.target.checked; void load() } }), 'Show archived'))
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (editing === 'new') root.append(editor(null))
  if (!notes.length && editing !== 'new') root.append(el('p', { class: 'empty' }, query ? 'No notes match.' : showArchived ? 'No archived notes.' : 'No notes yet.'))
  for (const n of notes) {
    if (editing === n.id) { root.append(editor(n)); continue }
    root.append(el('button', { type: 'button', class: 'item', 'aria-label': `Open note ${titleOf(n)}`, onclick: () => { editing = n.id; draw() } },
      el('strong', {}, `${n.pinned ? '[pinned] ' : ''}${titleOf(n)}`),
      el('span', { class: 'muted' }, n.body.replace(/\s+/g, ' ').slice(0, 120)),
      n.tags.length ? el('span', { class: 'muted' }, n.tags.map((t) => `#${t}`).join(' ')) : null))
  }
}

document.addEventListener('orbis:notes-shown', () => void load())
