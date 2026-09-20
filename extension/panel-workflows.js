import { call } from './helper.js'

// Workflows, in the Orbis panel: the same workflows, engine and run history Electron Orbis uses, through the helper.
// Text only, never HTML. The panel is shown names, plain-language steps and progress; never a run's variables.

const root = document.getElementById('workflows')
const view = document.getElementById('view-workflows')
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

let workflows = []
let active = []
let opened = null // id of the workflow whose steps are open
let detail = null
let asking = null // id of the workflow whose inputs are being filled in
let problem = ''
let recording = { available: false, active: false, paused: false, steps: 0 }
let ready = false
let timer = null

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    problem = err?.message || 'That did not work.'
    return null
  }
}

const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const scheduleText = (w) => (!w.schedule ? 'No schedule' : w.schedule.enabled ? (w.nextRun ? `Next run ${when(w.nextRun)}` : `${w.schedule.kind}, nothing left to run`) : `Schedule off (${w.schedule.kind})`)
const progressText = (r) => {
  const bits = [r.status.replace(/-/g, ' ')]
  if (r.stepCount) bits.push(`step ${Math.min((r.stepIndex ?? 0) + 1, r.stepCount)} of ${r.stepCount}`)
  else if (r.step) bits.push(`step ${r.step}`)
  if (r.iteration) bits.push(`round ${r.iteration}`)
  if (r.waitingFor) bits.push(r.waitingFor.message)
  if (r.error) bits.push(r.error)
  return bits.join(' · ')
}

async function load() {
  const [list, rec] = await Promise.all([run('workflows:list'), call('workflows:record-state').catch(() => null)])
  if (list) {
    workflows = list.workflows
    active = list.active
    ready = true
  }
  if (rec) recording = rec
  if (opened) detail = await run('workflows:get', [opened])
  draw()
  poll()
}

// While a run is going, its progress is refreshed; the panel is quiet when nothing is running or the tab is not showing.
function poll() {
  clearTimeout(timer)
  if (view.hidden || !(active.length || recording.active)) return
  timer = setTimeout(async () => {
    const [status, rec] = await Promise.all([run('workflows:status'), call('workflows:record-state').catch(() => null)])
    if (status) {
      const ended = active.some((r) => !status.active.some((n) => n.runId === r.runId))
      active = status.active
      if (ended) return void load()
    }
    if (rec) recording = rec
    draw()
    poll()
  }, 1500)
}

async function start(w, values) {
  const result = await run('workflows:run', [w.id, { inputs: values }])
  if (result && !result.ok) problem = [result.message, ...result.issues.map((i) => `${i.path ? `Step ${i.path}: ` : ''}${i.message}`)].filter((x, i, a) => a.indexOf(x) === i).join(' — ')
  asking = null
  await load()
}

function inputForm(w) {
  const fields = w.inputs.map((i) => {
    const input = i.type === 'boolean'
      ? el('input', { type: 'checkbox', 'aria-label': i.label || i.name })
      : el('input', { type: i.type === 'secret' ? 'password' : i.type === 'number' ? 'number' : 'text', 'aria-label': i.label || i.name, autocomplete: 'off', ...(i.required ? { required: '' } : {}) })
    if (i.default !== undefined) i.type === 'boolean' ? (input.checked = i.default === true) : (input.value = String(i.default))
    return { i, input }
  })
  const form = el('form', { class: 'editor', 'aria-label': `Inputs for ${w.name}`, onsubmit: (e) => {
    e.preventDefault()
    const values = {}
    for (const { i, input } of fields) {
      if (i.type === 'boolean') values[i.name] = input.checked
      else if (input.value !== '') values[i.name] = i.type === 'number' ? Number(input.value) : input.value
    }
    void start(w, values)
  } },
  ...fields.map(({ i, input }) => el('label', { class: 'check' }, i.label || i.name, input)),
  el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Run'), el('button', { type: 'button', onclick: () => { asking = null; draw() } }, 'Cancel')))
  return form
}

function stepsView() {
  if (!detail) return el('p', { class: 'muted' }, 'Loading the steps…')
  const list = el('ol', { class: 'steps' })
  for (const l of detail.lines) list.append(el('li', { class: l.disabled ? 'off' : '', style: `margin-left:${l.depth * 14}px` }, `${l.path}. ${l.text}`, l.approval !== 'never' ? el('span', { class: 'muted' }, ' · asks you first') : null))
  const box = el('div', { class: 'steps-box' }, list)
  for (const i of detail.issues) box.append(el('div', { class: i.level === 'error' ? 'problem' : 'muted' }, i.message))
  if (detail.history.length) box.append(el('div', { class: 'muted' }, 'Recent: ' + detail.history.slice(0, 3).map((h) => `${h.status} ${when(h.finishedAt)}`).join(' · ')))
  return box
}

function draw() {
  root.replaceChildren()
  const bar = el('div', { class: 'row' })
  if (recording.available) {
    bar.append(el('button', { type: 'button', class: recording.active ? 'danger' : '', 'aria-pressed': String(recording.active), onclick: async () => {
      const state = await run(recording.active ? 'workflows:record-stop' : 'workflows:record-start')
      if (state) recording = state
      await load()
    } }, recording.active ? `Stop recording (${recording.steps} steps)` : 'Record'))
  } else {
    bar.append(el('button', { type: 'button', disabled: '', title: 'Recording is not connected in this build.' }, 'Record'))
  }
  bar.append(el('button', { type: 'button', onclick: () => void load() }, 'Refresh'))
  root.append(bar)
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))

  for (const r of active) {
    root.append(el('div', { class: 'run', role: 'status' },
      el('strong', {}, `Running: ${r.workflow}`), el('span', { class: 'muted' }, progressText(r)),
      el('button', { type: 'button', class: 'danger', 'aria-label': `Stop ${r.workflow}`, onclick: async () => { await run('workflows:stop', [r.runId]); await load() } }, 'Stop')))
  }
  if (ready && !workflows.length) root.append(el('p', { class: 'empty' }, 'No workflows yet. Make one in Orbis, or record one.'))
  for (const w of workflows) {
    const running = active.some((r) => r.workflowId === w.id)
    const meta = [`${w.steps} step${w.steps === 1 ? '' : 's'}`, scheduleText(w), w.runs ? `${w.runs} run${w.runs === 1 ? '' : 's'}${w.lastRun ? `, last ${w.lastRun.status}` : ''}` : 'Never run'].join(' · ')
    const card = el('div', { class: 'wf' },
      el('button', { type: 'button', class: 'item', 'aria-expanded': String(opened === w.id), onclick: async () => { opened = opened === w.id ? null : w.id; detail = null; draw(); if (opened) { detail = await run('workflows:get', [opened]); draw() } } },
        el('strong', {}, w.name), w.description ? el('span', { class: 'muted' }, w.description) : null, el('span', { class: 'muted' }, meta)),
      el('div', { class: 'row' },
        el('button', { type: 'button', disabled: running ? '' : null, onclick: () => { if (w.inputs.length) { asking = w.id; draw() } else void start(w, {}) } }, running ? 'Running…' : 'Run'),
        w.schedule ? el('label', { class: 'check' }, el('input', { type: 'checkbox', ...(w.schedule.enabled ? { checked: '' } : {}), 'aria-label': `Schedule for ${w.name}`, onchange: async (e) => { await run('workflows:set-enabled', [w.id, e.target.checked]); await load() } }), 'Scheduled') : null))
    if (asking === w.id) card.append(inputForm(w))
    if (opened === w.id) card.append(stepsView())
    root.append(card)
  }
}

document.addEventListener('orbis:workflows-shown', () => void load())
