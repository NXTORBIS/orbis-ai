import { call } from './helper.js'

/*
 * Notes, in the Orbis panel: the same notes Electron Orbis keeps, from the helper. Text goes on the page as text only.
 *
 * ## It can now reach everything a note has
 *
 * The helper has always been able to filter by tag, sort, and set a colour; this screen asked for none of them, so a
 * note made in the Orbis window came here with a colour that could not be seen and tags that could not be used to
 * find it. That is the shape of fault worth naming: not a feature that is missing, but one that is there on both
 * sides with nothing in the middle.
 *
 * ## Where a note came from is shown, never followed
 *
 * A note made from a page keeps the address it came from. It is shown as the site's name and is not a link: this
 * page is a panel beside whatever is open, and a note is somebody's own text, so nothing in it navigates anywhere
 * on its own.
 */

const root = document.getElementById('notes')
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
const titleOf = (n) => n.title || (n.body.split('\n').find((l) => l.trim()) || 'Untitled note').replace(/^#+\s*/, '').slice(0, 80)

const COLORS = [
  ['default', 'No colour'],
  ['cyan', 'Cyan'],
  ['green', 'Green'],
  ['amber', 'Amber'],
  ['red', 'Red'],
  ['violet', 'Violet']
]
const SORTS = [
  ['updated', 'Last changed'],
  ['created', 'When made'],
  ['title', 'By name']
]

let notes = []
let tags = []
let query = ''
let tag = ''
let sort = 'updated'
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
  const filter = { query, archived: showArchived, sort, ...(tag ? { tag } : {}) }
  const [found, counted] = await Promise.all([run('notes:list', [filter]), run('notes:tags')])
  if (found) notes = found
  if (counted) tags = counted
  draw()
}

/** Where a note came from, as a name rather than an address, and never as a link. */
const cameFrom = (note) => {
  if (!note.source?.url) return ''
  try {
    return `from ${new URL(note.source.url).hostname.replace(/^www\./, '')}`
  } catch {
    return 'from a page'
  }
}

function editor(note) {
  const title = el('input', { type: 'text', 'aria-label': 'Note title', placeholder: 'Title', maxlength: '200' })
  const body = el('textarea', { 'aria-label': 'Note text', rows: '10', placeholder: 'Write…' })
  const tagsField = el('input', {
    type: 'text',
    'aria-label': 'Tags, separated by commas',
    placeholder: 'Tags, separated by commas',
    list: 'note-tags',
    autocomplete: 'off'
  })
  // The tags this profile already uses, offered rather than imposed: typing a new one still works.
  const known = el('datalist', { id: 'note-tags' }, ...tags.map((one) => el('option', { value: one.tag })))
  const color = el('select', { 'aria-label': 'Colour' }, ...COLORS.map(([value, label]) => el('option', { value }, label)))

  title.value = note?.title ?? ''
  body.value = note?.body ?? ''
  tagsField.value = (note?.tags ?? []).join(', ')
  color.value = note?.color ?? 'default'

  const save = async () => {
    const patch = {
      title: title.value,
      body: body.value,
      tags: tagsField.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      color: color.value
    }
    const saved = note ? await run('notes:update', [note.id, patch]) : await run('notes:create', [patch])
    if (saved) editing = null
    await load()
  }
  const change = (patch) => async () => {
    await run('notes:update', [note.id, patch])
    editing = null
    await load()
  }

  const form = el(
    'form',
    { class: 'editor', 'aria-label': note ? 'Edit note' : 'New note', onsubmit: (e) => (e.preventDefault(), void save()) },
    title,
    body,
    tagsField,
    known,
    el('div', { class: 'row' }, color, note ? el('span', { class: 'muted' }, cameFrom(note)) : null),
    el(
      'div',
      { class: 'row' },
      el('button', { type: 'submit' }, 'Save'),
      el('button', { type: 'button', onclick: () => ((editing = null), draw()) }, 'Cancel'),
      note ? el('button', { type: 'button', onclick: change({ pinned: !note.pinned }) }, note.pinned ? 'Unpin' : 'Pin') : null,
      note ? el('button', { type: 'button', onclick: change({ archived: !note.archived }) }, note.archived ? 'Restore' : 'Archive') : null,
      note
        ? el(
            'button',
            {
              type: 'button',
              class: 'danger',
              onclick: async () => {
                await run('notes:delete', [note.id])
                editing = null
                await load()
              }
            },
            'Delete'
          )
        : null
    )
  )
  queueMicrotask(() => (note ? body : title).focus())
  return form
}

function draw() {
  root.replaceChildren()

  const search = el('input', { type: 'search', 'aria-label': 'Search notes', placeholder: 'Search notes…', autocomplete: 'off' })
  search.value = query
  let timer = null
  search.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => ((query = search.value), void load()), 200)
  })
  root.append(el('div', { class: 'row' }, search, el('button', { type: 'button', onclick: () => ((editing = 'new'), draw()) }, 'New note')))

  const sortBy = el('select', { 'aria-label': 'Order', onchange: (e) => ((sort = e.target.value), void load()) }, ...SORTS.map(([value, label]) => el('option', { value }, label)))
  sortBy.value = sort
  root.append(
    el(
      'div',
      { class: 'row' },
      sortBy,
      el(
        'label',
        { class: 'check' },
        el('input', { type: 'checkbox', ...(showArchived ? { checked: '' } : {}), onchange: (e) => ((showArchived = e.target.checked), void load()) }),
        'Show archived'
      )
    )
  )

  /*
   * The tags this profile actually uses, with how many notes each is on. Only drawn when there are any: a row of
   * nothing is a row that says this screen is missing something.
   */
  if (tags.length) {
    const row = el('div', { class: 'row seg', role: 'group', 'aria-label': 'Filter by tag' })
    row.append(el('button', { type: 'button', 'aria-pressed': String(tag === ''), onclick: () => ((tag = ''), void load()) }, 'All'))
    for (const one of tags.slice(0, 12)) {
      row.append(
        el('button', { type: 'button', 'aria-pressed': String(tag === one.tag), onclick: () => ((tag = tag === one.tag ? '' : one.tag), void load()) }, `#${one.tag} ${one.count}`)
      )
    }
    root.append(row)
  }

  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (editing === 'new') root.append(editor(null))
  if (!notes.length && editing !== 'new') {
    root.append(
      el('p', { class: 'empty' }, query || tag ? 'No notes match.' : showArchived ? 'No archived notes.' : 'No notes yet.')
    )
  }

  for (const n of notes) {
    if (editing === n.id) {
      root.append(editor(n))
      continue
    }
    const detail = [n.tags.length ? n.tags.map((t) => `#${t}`).join(' ') : '', cameFrom(n)].filter(Boolean).join(' · ')
    root.append(
      el(
        'button',
        {
          type: 'button',
          class: `item note-${n.color ?? 'default'}`,
          'aria-label': `Open note ${titleOf(n)}`,
          onclick: () => ((editing = n.id), draw())
        },
        el('strong', {}, `${n.pinned ? '★ ' : ''}${titleOf(n)}`),
        el('span', { class: 'muted' }, n.body.replace(/\s+/g, ' ').slice(0, 120)),
        detail ? el('span', { class: 'muted' }, detail) : null
      )
    )
  }
}

document.addEventListener('orbis:notes-shown', () => void load())

/*
 * And once, now, if this is the view the panel opened at.
 *
 * The event above is dispatched by `showTab`, which runs as the page loads for whichever view the address names --
 * before this module has been evaluated, so there is nobody listening yet. Without this, landing straight on
 * #notes drew the frame and nothing in it, and going to another view and back filled it in: a fault that only
 * shows itself to somebody who opens the address directly and does not look twice.
 */
{
  const here = document.getElementById('view-notes')
  if (here && !here.hidden) void load()
}
