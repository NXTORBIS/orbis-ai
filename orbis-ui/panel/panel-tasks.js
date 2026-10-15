import { call } from './helper.js'

/*
 * Tasks, in the Orbis panel: the same tasks and lists Electron Orbis keeps, from the helper. Text only, never HTML.
 *
 * ## Everything a task has can be changed here
 *
 * It could once set a title, notes, a due date and a priority, and that was a problem rather than a limitation:
 * `tasks:update` replaces what it is given, and the editor sent `hasTime: false` every single time. So opening a
 * task due at three o'clock and pressing Save moved it to midnight, with nothing said and no way to put it back.
 * A screen that can show a field it cannot edit is incomplete; one that silently clears it is broken.
 *
 * So the editor now covers the whole task -- the time as well as the day, the steps inside it, how often it comes
 * back, and which list it is in -- and anything it does not change, it does not send.
 *
 * ## The steps are edited in place
 *
 * Subtasks are part of the task, not a thing of their own, so they are added, ticked, renamed and removed inside
 * the editor and saved with it. Ticking a step in the list outside the editor saves immediately, because that is
 * the one thing people do without meaning to open anything.
 */

const root = document.getElementById('tasks')
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
const VIEWS = [['all', 'All'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['completed', 'Done']]
const PRIORITIES = ['none', 'low', 'medium', 'high']
const REPEATS = [['', 'Does not repeat'], ['day', 'Every day'], ['week', 'Every week'], ['month', 'Every month'], ['year', 'Every year']]

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

const two = (n) => String(n).padStart(2, '0')
const dayValue = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
const timeValue = (ms) => {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}
/** A day, and a time on it when there is one. Returns null for no date at all. */
const stampOf = (day, time) => {
  if (!day) return null
  const at = new Date(`${day}T${time && time.length >= 4 ? time : '00:00'}:00`)
  return Number.isFinite(at.getTime()) ? at.getTime() : null
}
const dueText = (t) => {
  if (t.due === undefined) return ''
  const when = new Date(t.due)
  return `Due ${when.toLocaleDateString()}${t.hasTime ? ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`
}
const repeatText = (t) => {
  if (!t.repeat) return ''
  const every = t.repeat.interval > 1 ? `every ${t.repeat.interval} ${t.repeat.every}s` : `every ${t.repeat.every}`
  return `repeats ${every}`
}

/** An id for a step this editor has just made. The store keeps whatever it is given. */
const newStepId = () => `st_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`

function editor(t) {
  /*
   * The steps are held here while the editor is open and saved with everything else, because they are part of the
   * task rather than a thing of their own. A copy, so pressing Cancel really does cancel.
   */
  let steps = t.subtasks.map((one) => ({ ...one }))

  const title = el('input', { type: 'text', 'aria-label': 'Task title', maxlength: '500' })
  const notes = el('textarea', { 'aria-label': 'Task notes', rows: '3', placeholder: 'Notes' })
  const day = el('input', { type: 'date', 'aria-label': 'Due date' })
  const time = el('input', { type: 'time', 'aria-label': 'Due time' })
  const priority = el('select', { 'aria-label': 'Priority' }, ...PRIORITIES.map((p) => el('option', { value: p }, p)))
  const repeatEvery = el('select', { 'aria-label': 'Repeats' }, ...REPEATS.map(([value, label]) => el('option', { value }, label)))
  const repeatEvery2 = el('input', { type: 'number', min: '1', max: '365', step: '1', 'aria-label': 'How many between each repeat' })
  const list = el('select', { 'aria-label': 'List' }, ...snapshot.lists.map((l) => el('option', { value: l.id }, l.name)))
  const stepsBox = el('div', { class: 'steps', 'aria-label': 'Steps' })

  title.value = t.title
  notes.value = t.notes
  priority.value = t.priority
  list.value = t.listId
  if (t.due !== undefined) {
    day.value = dayValue(t.due)
    // The time is kept only when the task has one. A task due "on Tuesday" has no time, and inventing midnight for
    // it would make every such task look like one due at the start of the day.
    if (t.hasTime) time.value = timeValue(t.due)
  }
  repeatEvery.value = t.repeat?.every ?? ''
  repeatEvery2.value = String(t.repeat?.interval ?? 1)

  const drawSteps = () => {
    stepsBox.replaceChildren()
    for (const step of steps) {
      const tick = el('input', {
        type: 'checkbox',
        'aria-label': `${step.done ? 'Not done' : 'Done'}: ${step.title || 'step'}`,
        ...(step.done ? { checked: '' } : {}),
        onchange: (e) => {
          step.done = e.target.checked
        }
      })
      const text = el('input', { type: 'text', value: step.title, 'aria-label': 'Step', maxlength: '500', oninput: (e) => (step.title = e.target.value) })
      stepsBox.append(
        el(
          'div',
          { class: 'row step' },
          tick,
          text,
          el(
            'button',
            {
              type: 'button',
              'aria-label': `Remove the step ${step.title || ''}`.trim(),
              onclick: () => {
                steps = steps.filter((one) => one !== step)
                drawSteps()
              }
            },
            '×'
          )
        )
      )
    }
    const add = el('input', { type: 'text', placeholder: 'Add a step…', 'aria-label': 'Add a step', maxlength: '500' })
    stepsBox.append(
      el(
        'div',
        { class: 'row step' },
        add,
        el(
          'button',
          {
            type: 'button',
            onclick: () => {
              if (!add.value.trim()) return
              steps.push({ id: newStepId(), title: add.value.trim(), done: false })
              drawSteps()
              stepsBox.querySelector('input[aria-label="Add a step"]')?.focus()
            }
          },
          'Add step'
        )
      )
    )
  }
  drawSteps()

  const save = async () => {
    const due = stampOf(day.value, time.value)
    const patch = {
      title: title.value,
      notes: notes.value,
      priority: priority.value,
      listId: list.value,
      due,
      // A time only counts as one when a day was given and a time was typed on it.
      hasTime: due !== null && Boolean(time.value),
      subtasks: steps.filter((one) => one.title.trim() !== ''),
      repeat: repeatEvery.value ? { every: repeatEvery.value, interval: Math.max(1, Math.min(365, Number(repeatEvery2.value) || 1)) } : null
    }
    if (await run('tasks:update', [t.id, patch])) editing = null
    await load()
  }

  const form = el(
    'form',
    { class: 'editor', 'aria-label': 'Edit task', onsubmit: (e) => (e.preventDefault(), void save()) },
    title,
    notes,
    el('div', { class: 'row' }, day, time),
    el('div', { class: 'row' }, priority, list),
    el('div', { class: 'row' }, repeatEvery, repeatEvery2),
    stepsBox,
    el(
      'div',
      { class: 'row' },
      el('button', { type: 'submit' }, 'Save'),
      el('button', { type: 'button', onclick: () => ((editing = null), draw()) }, 'Cancel'),
      el(
        'button',
        {
          type: 'button',
          class: 'danger',
          onclick: async () => {
            await run('tasks:delete', [t.id])
            editing = null
            await load()
          }
        },
        'Delete'
      )
    )
  )
  queueMicrotask(() => title.focus())
  return form
}

function draw() {
  root.replaceChildren()
  const add = el('input', { type: 'text', 'aria-label': 'New task', placeholder: 'Add a task…', maxlength: '500', autocomplete: 'off' })
  root.append(
    el(
      'form',
      {
        class: 'row',
        onsubmit: async (e) => {
          e.preventDefault()
          if (!add.value.trim()) return
          await run('tasks:create', [{ title: add.value, ...(listId ? { listId } : {}) }])
          await load()
          root.querySelector('input[aria-label="New task"]')?.focus()
        }
      },
      add,
      el('button', { type: 'submit' }, 'Add')
    )
  )
  // The numbers that matter at a glance, as tiles that are also the way to those lists.
  const counts = snapshot.counts ?? {}
  const countOf = (id) => (typeof counts[id] === 'number' ? counts[id] : null)
  const tiles = el('div', { class: 'stat-row' })
  for (const [id, label, tone] of [['today', 'Today', 'accent'], ['overdue', 'Overdue', 'danger'], ['upcoming', 'Coming up', 'calm']]) {
    const n = countOf(id)
    tiles.append(
      el(
        'button',
        { type: 'button', class: `stat ${tone}${view === id ? ' on' : ''}`, onclick: () => ((view = id), void load()) },
        el('b', {}, n === null ? '–' : String(n)),
        el('span', {}, label)
      )
    )
  }
  {
    const open = countOf('open')
    const finished = countOf('done')
    const total = countOf('total')
    const share = total ? Math.round((finished / total) * 100) : 0
    const headline = open === null ? 'Your tasks' : open === 0 ? 'All clear' : `${open} to go`
    const sub = total === null ? '' : total === 0 ? 'Nothing planned yet' : `${finished} of ${total} done`
    root.append(
      el(
        'div',
        { class: 'hero-card' },
        el('div', { class: 'ring', style: `--p:${share}` }, el('b', {}, `${share}%`)),
        el('div', { class: 'hero-text' }, el('strong', {}, headline), el('span', {}, sub))
      )
    )
  }
  root.append(tiles)
  const bar = el('div', { class: 'row seg', role: 'group', 'aria-label': 'Show' })
  for (const [id, label] of VIEWS) {
    bar.append(el('button', { type: 'button', 'aria-pressed': String(view === id), onclick: () => ((view = id), void load()) }, label))
  }
  root.append(bar)
  const lists = el(
    'select',
    { 'aria-label': 'List', onchange: (e) => ((listId = e.target.value), void load()) },
    el('option', { value: '' }, 'All lists'),
    ...snapshot.lists.map((l) => el('option', { value: l.id }, l.name))
  )
  lists.value = listId
  root.append(lists)
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (!tasks.length) {
    const quiet = {
      today: ['Nothing due today', 'Enjoy the quiet, or add something above.'],
      overdue: ['Nothing overdue', 'You are all caught up.'],
      upcoming: ['Nothing coming up', 'Give a task a date and it shows here.'],
      completed: ['Nothing finished yet', 'Tick a task and it lands here.']
    }[view] ?? ['No tasks yet', 'Add your first one above.']
    root.append(
      el('div', { class: 'empty-state' }, el('span', { class: 'es-ico', 'aria-hidden': 'true' }, '✓'), el('strong', {}, quiet[0]), el('span', {}, quiet[1]))
    )
  }

  for (const t of tasks) {
    if (editing === t.id) {
      root.append(editor(t))
      continue
    }
    const box = el('input', {
      type: 'checkbox',
      'aria-label': `${t.done ? 'Mark not done' : 'Mark done'}: ${t.title}`,
      ...(t.done ? { checked: '' } : {}),
      onchange: async (e) => {
        await run('tasks:complete', [t.id, e.target.checked])
        await load()
      }
    })
    // What is said about a task, as small labelled chips whose colour says how it stands.
    const chips = []
    const chip = (text, tone) => chips.push(el('span', { class: `chip ${tone}` }, text))
    const now = Date.now()
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    if (t.due !== undefined) {
      const late = !t.done && t.due < (t.hasTime ? now : startOfDay)
      const today = !late && t.due >= startOfDay && t.due < startOfDay + 24 * 3600 * 1000
      chip(dueText(t).replace(/^Due /, ''), t.done ? 'calm' : late ? 'danger' : today ? 'accent' : 'calm')
    }
    if (t.repeat) chip(repeatText(t), 'calm')
    if (t.priority !== 'none') chip(t.priority, t.priority === 'high' ? 'danger' : t.priority === 'medium' ? 'warm' : 'calm')
    // Which list, but only when the list is not already the one being shown.
    if (listId === '' && snapshot.lists.length > 1) {
      const name = snapshot.lists.find((l) => l.id === t.listId)?.name
      if (name) chip(name, 'calm')
    }
    const stepsDone = t.subtasks.filter((s) => s.done).length
    const progress = t.subtasks.length
      ? el(
          'span',
          { class: 'steps-bar', role: 'img', 'aria-label': `${stepsDone} of ${t.subtasks.length} steps done` },
          el('i', { style: `width:${Math.round((stepsDone / t.subtasks.length) * 100)}%` }),
          el('em', {}, `${stepsDone}/${t.subtasks.length}`)
        )
      : null
    root.append(
      el(
        'div',
        { class: `task${t.done ? ' done' : ''}`, 'data-priority': t.priority },
        box,
        el(
          'button',
          { type: 'button', class: 'item', 'aria-label': `Edit task ${t.title}`, onclick: () => ((editing = t.id), draw()) },
          el('strong', {}, t.title || 'Untitled task'),
          chips.length ? el('span', { class: 'chips' }, ...chips) : null,
          progress
        )
      )
    )
  }
  if (view === 'completed' && tasks.length) {
    root.append(
      el(
        'button',
        {
          type: 'button',
          onclick: async () => {
            await run('tasks:clear-completed', listId ? [listId] : [])
            await load()
          }
        },
        'Clear completed'
      )
    )
  }
}

document.addEventListener('orbis:tasks-shown', () => void load())

/*
 * And once, now, if this is the view the panel opened at.
 *
 * The event above is dispatched by `showTab`, which runs as the page loads for whichever view the address names --
 * before this module has been evaluated, so there is nobody listening yet. Without this, landing straight on
 * #tasks drew the frame and nothing in it, and going to another view and back filled it in: a fault that only
 * shows itself to somebody who opens the address directly and does not look twice.
 */
{
  const here = document.getElementById('view-tasks')
  if (here && !here.hidden) void load()
}
