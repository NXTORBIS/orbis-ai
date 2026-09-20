import { call } from './helper.js'

// Tasks, in the Orbis panel: the same tasks and lists Electron Orbis keeps, from the helper. Text only, never HTML.

const root = document.getElementById('tasks')
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
const VIEWS = [['all', 'All'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['completed', 'Done']]
const PRIORITIES = ['none', 'low', 'medium', 'high']

let snapshot = { lists: [], tasks: [], counts: {} }
let tasks = []
let view = 'all'
let listId = ''
let problem = ''
let editing = null

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
  const filter = { view, ...(listId ? { listId } : {}) }
  const [snap, found] = await Promise.all([run('tasks:snapshot'), run('tasks:list', [filter])])
  if (snap) snapshot = snap
  if (found) tasks = found
  draw()
}
const dueText = (t) => (t.due === undefined ? '' : `Due ${new Date(t.due).toLocaleDateString()}${t.hasTime ? ' ' + new Date(t.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`)
const dayStamp = (value) => (value ? new Date(`${value}T00:00:00`).getTime() : null)
const dayValue = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function editor(t) {
  const title = el('input', { type: 'text', 'aria-label': 'Task title', maxlength: '500' })
  const notes = el('textarea', { 'aria-label': 'Task notes', rows: '3', placeholder: 'Notes' })
  const due = el('input', { type: 'date', 'aria-label': 'Due date' })
  const priority = el('select', { 'aria-label': 'Priority' }, ...PRIORITIES.map((p) => el('option', { value: p }, p)))
  title.value = t.title
  notes.value = t.notes
  priority.value = t.priority
  if (t.due !== undefined) due.value = dayValue(t.due)
  const save = async () => {
    const patch = { title: title.value, notes: notes.value, priority: priority.value, due: dayStamp(due.value), hasTime: false }
    if (await run('tasks:update', [t.id, patch])) editing = null
    await load()
  }
  const form = el('form', { class: 'editor', 'aria-label': 'Edit task', onsubmit: (e) => { e.preventDefault(); void save() } }, title, notes,
    el('div', { class: 'row' }, due, priority),
    el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Save'), el('button', { type: 'button', onclick: () => { editing = null; draw() } }, 'Cancel'),
      el('button', { type: 'button', class: 'danger', onclick: async () => { await run('tasks:delete', [t.id]); editing = null; await load() } }, 'Delete')))
  queueMicrotask(() => title.focus())
  return form
}

function draw() {
  root.replaceChildren()
  const add = el('input', { type: 'text', 'aria-label': 'New task', placeholder: 'Add a task…', maxlength: '500', autocomplete: 'off' })
  root.append(el('form', { class: 'row', onsubmit: async (e) => {
    e.preventDefault()
    if (!add.value.trim()) return
    await run('tasks:create', [{ title: add.value, ...(listId ? { listId } : {}) }])
    await load()
    root.querySelector('input[aria-label="New task"]')?.focus()
  } }, add, el('button', { type: 'submit' }, 'Add')))
  const bar = el('div', { class: 'row seg', role: 'group', 'aria-label': 'Show' })
  for (const [id, label] of VIEWS) bar.append(el('button', { type: 'button', 'aria-pressed': String(view === id), onclick: () => { view = id; void load() } }, label))
  root.append(bar)
  const lists = el('select', { 'aria-label': 'List', onchange: (e) => { listId = e.target.value; void load() } }, el('option', { value: '' }, 'All lists'), ...snapshot.lists.map((l) => el('option', { value: l.id }, l.name)))
  lists.value = listId
  root.append(lists)
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (!tasks.length) root.append(el('p', { class: 'empty' }, 'Nothing here.'))
  for (const t of tasks) {
    if (editing === t.id) { root.append(editor(t)); continue }
    const box = el('input', { type: 'checkbox', 'aria-label': `${t.done ? 'Mark not done' : 'Mark done'}: ${t.title}`, ...(t.done ? { checked: '' } : {}), onchange: async (e) => { await run('tasks:complete', [t.id, e.target.checked]); await load() } })
    const detail = [dueText(t), t.priority !== 'none' ? `${t.priority} priority` : '', t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} steps` : ''].filter(Boolean).join(' · ')
    root.append(el('div', { class: `task${t.done ? ' done' : ''}` }, box,
      el('button', { type: 'button', class: 'item', 'aria-label': `Edit task ${t.title}`, onclick: () => { editing = t.id; draw() } },
        el('strong', {}, t.title || 'Untitled task'), el('span', { class: 'muted' }, detail))))
  }
  if (view === 'completed' && tasks.length) root.append(el('button', { type: 'button', onclick: async () => { await run('tasks:clear-completed', listId ? [listId] : []); await load() } }, 'Clear completed'))
}

document.addEventListener('orbis:tasks-shown', () => void load())
