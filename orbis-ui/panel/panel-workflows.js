import { call } from './helper.js'

// Workflows, in the Orbis panel: the same workflows, engine and run history Electron Orbis uses, through the helper.
// Text only, never HTML. The panel is shown names, plain-language steps, step settings (secret-looking values masked) and
// progress; never a run's variables. Editing a workflow's steps is done in Orbis; here they can be read, run, followed,
// paused, stopped, resumed, scheduled, renamed, copied, archived, deleted, restored to an older version, or drafted by Orion.

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

const FILTERS = [['all', 'All'], ['scheduled', 'Scheduled'], ['archived', 'Archived']]
let workflows = []
let active = []
let checkpoints = []
let canRemember = false
let canDraft = false
let opened = null // id of the workflow whose steps are open
let detail = null
let versions = null
let asking = null // id of the workflow whose inputs are being filled in
let renaming = null
let drafting = false
let filter = 'all'
let search = ''
let problem = ''
let notice = ''
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
const seconds = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`)
const scheduleText = (w) => (!w.schedule ? 'No schedule' : w.schedule.enabled ? (w.nextRun ? `Next run ${when(w.nextRun)}` : `${w.schedule.kind}, nothing left to run`) : `Schedule off (${w.schedule.kind})`)
const progressText = (r) => {
  const bits = [r.status.replace(/-/g, ' ')]
  if (r.stepCount) bits.push(`step ${Math.min((r.stepIndex ?? 0) + 1, r.stepCount)} of ${r.stepCount}`)
  else if (r.step) bits.push(`step ${r.step}`)
  if (r.action) bits.push(r.action)
  if (r.iteration) bits.push(`round ${r.iteration}`)
  if (r.waitingFor) bits.push(r.waitingFor.message)
  if (r.error) bits.push(r.error)
  return bits.join(' · ')
}
const shownWorkflows = () => workflows.filter((w) => {
  if (filter === 'archived' ? !w.archived : w.archived) return false
  if (filter === 'scheduled' && !(w.schedule && w.schedule.enabled)) return false
  const q = search.trim().toLowerCase()
  return !q || `${w.name} ${w.description} ${(w.tags || []).join(' ')}`.toLowerCase().includes(q)
})

async function load() {
  const [list, rec] = await Promise.all([run('workflows:list', [{ archived: true }]), call('workflows:record-state').catch(() => null)])
  if (list) {
    workflows = list.workflows
    active = list.active
    checkpoints = list.checkpoints
    canRemember = list.canRememberSecrets
    canDraft = list.canDraft
    ready = true
  }
  if (rec) recording = rec
  if (opened) await loadDetail()
  draw()
  poll()
}
async function loadDetail() {
  detail = await run('workflows:get', [opened])
  versions = await run('workflows:versions', [opened])
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

async function start(w, values, remember = {}) {
  for (const [name, value] of Object.entries(remember)) if (value) await run('workflows:remember-secret', [w.id, name, value])
  const result = await run('workflows:run', [w.id, { inputs: values }])
  if (result && !result.ok) problem = [result.message, ...result.issues.map((i) => `${i.path ? `Step ${i.path}: ` : ''}${i.message}`)].filter((x, i, a) => a.indexOf(x) === i).join(' — ')
  asking = null
  await load()
}

function inputForm(w, remembered) {
  const fields = w.inputs.map((i) => {
    const isBool = i.type === 'boolean'
    const isSecret = i.type === 'secret'
    const input = isBool
      ? el('input', { type: 'checkbox', 'aria-label': i.label || i.name })
      : el('input', { type: isSecret ? 'password' : i.type === 'number' ? 'number' : 'text', 'aria-label': i.label || i.name, autocomplete: 'off', ...(i.required && !(isSecret && remembered.includes(i.name)) ? { required: '' } : {}) })
    if (i.default !== undefined && !isSecret) isBool ? (input.checked = i.default === true) : (input.value = String(i.default))
    const remember = isSecret && canRemember ? el('input', { type: 'checkbox', 'aria-label': `Remember ${i.label || i.name}` }) : null
    return { i, input, remember }
  })
  const form = el('form', { class: 'editor', 'aria-label': `Inputs for ${w.name}`, onsubmit: (e) => {
    e.preventDefault()
    const values = {}
    const remember = {}
    for (const { i, input, remember: r } of fields) {
      if (i.type === 'boolean') values[i.name] = input.checked
      else if (input.value !== '') {
        values[i.name] = i.type === 'number' ? Number(input.value) : input.value
        if (r?.checked) remember[i.name] = input.value
      }
      if (i.type === 'secret') input.value = ''
    }
    void start(w, values, remember)
  } },
  ...fields.map(({ i, input, remember }) => el('label', { class: 'check' }, `${i.label || i.name}${i.required ? ' *' : ''}${i.type === 'secret' && remembered.includes(i.name) ? ' (remembered)' : ''}`, input, remember ? el('span', { class: 'muted' }, ' remember ') : null, remember)),
  el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Run'), el('button', { type: 'button', onclick: () => { asking = null; draw() } }, 'Cancel'),
    ...remembered.map((name) => el('button', { type: 'button', 'aria-label': `Forget remembered ${name}`, onclick: async () => { await run('workflows:forget-secret', [w.id, name]); await load() } }, `Forget ${name}`))))
  return form
}

function stepsView(w) {
  if (!detail || detail.id !== w.id) return el('p', { class: 'muted' }, 'Loading the steps…')
  const box = el('div', { class: 'steps-box' })
  if (detail.lines.length) {
    const list = el('ol', { class: 'steps', 'aria-label': 'What it does' })
    for (const l of detail.lines) list.append(el('li', { class: l.disabled ? 'off' : '', style: `margin-left:${l.depth * 14}px` }, `${l.path}. ${l.text}`, l.approval !== 'never' ? el('span', { class: 'muted' }, ' · asks you first') : null))
    box.append(list)
  }
  if (detail.steps.length) {
    box.append(el('span', { class: 'muted' }, 'Step details'))
    for (const s of detail.steps) {
      const facts = [
        s.capability ? ['Does', s.capability] : null, s.waitMs !== undefined ? ['Waits', seconds(s.waitMs)] : null, s.saveAs ? ['Saves as', s.saveAs] : null,
        s.optional ? ['Optional', 'a failure is skipped'] : null, s.retries ? ['Retries', String(s.retries)] : null, s.timeoutMs ? ['Time limit', seconds(s.timeoutMs)] : null,
        s.enabled ? null : ['Switched off', 'skipped'], s.description ? ['Note', s.description] : null,
        ...Object.entries(s.params || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
      ].filter(Boolean)
      box.append(el('details', { class: 'step', style: `margin-left:${s.depth * 14}px` },
        el('summary', {}, `${s.path}. ${s.name} `, el('span', { class: 'muted' }, `(${s.type})`)),
        ...facts.map(([k, v]) => el('div', { class: 'fact' }, el('span', { class: 'muted' }, `${k}: `), v))))
    }
  }
  for (const i of detail.issues) box.append(el('div', { class: i.level === 'error' ? 'problem' : 'muted' }, i.message))
  if (detail.history.length) {
    box.append(el('span', { class: 'muted' }, 'Recent runs'))
    for (const h of detail.history.slice(0, 5)) {
      box.append(el('details', { class: 'step' },
        el('summary', {}, `${h.status} · ${when(h.finishedAt)} · ${seconds(h.durationMs)} · ${h.trigger}`, h.error ? el('span', { class: 'problem' }, ` — ${h.error}`) : null),
        ...h.steps.map((s) => el('div', { class: 'fact' }, el('span', { class: s.status === 'failed' ? 'problem' : 'muted' }, `${s.path} ${s.label}: ${s.status}${s.attempts > 1 ? `, ${s.attempts} tries` : ''} · ${seconds(s.durationMs)}`), s.error ? el('span', { class: 'problem' }, ` ${s.error}`) : null))))
    }
  }
  if (versions && versions.length > 1) {
    const pick = el('select', { 'aria-label': 'Older version' }, ...versions.map((v) => el('option', { value: String(v.version) }, `Version ${v.version}, ${when(v.savedAt)}${v.note ? ` (${v.note})` : ''}, ${v.steps} steps`)))
    box.append(el('div', { class: 'row' }, pick, el('button', { type: 'button', onclick: async () => {
      if (!confirm('Restore this version? The current one is kept in the history.')) return
      await run('workflows:restore-version', [w.id, Number(pick.value)])
      notice = 'Version restored.'
      await load()
    } }, 'Restore')))
  }
  return box
}

function card(w) {
  const running = active.some((r) => r.workflowId === w.id)
  const meta = [`${w.steps} step${w.steps === 1 ? '' : 's'}`, scheduleText(w), w.runs ? `${w.runs} run${w.runs === 1 ? '' : 's'}${w.lastRun ? `, last ${w.lastRun.status}` : ''}` : 'Never run'].join(' · ')
  const head = el('button', { type: 'button', class: 'item', 'aria-expanded': String(opened === w.id), onclick: async () => {
    opened = opened === w.id ? null : w.id
    detail = null
    versions = null
    draw()
    if (opened) { await loadDetail(); draw() }
  } }, el('strong', {}, `${w.favorite ? '★ ' : ''}${w.name}${w.archived ? ' (archived)' : ''}`), w.description ? el('span', { class: 'muted' }, w.description) : null, el('span', { class: 'muted' }, meta))
  const box = el('div', { class: 'wf' })
  if (renaming === w.id) {
    const name = el('input', { type: 'text', 'aria-label': 'Workflow name', maxlength: '120', value: w.name })
    box.append(el('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); await run('workflows:rename', [w.id, name.value]); renaming = null; await load() } }, name,
      el('button', { type: 'submit' }, 'Save'), el('button', { type: 'button', onclick: () => { renaming = null; draw() } }, 'Cancel')))
    queueMicrotask(() => name.focus())
  } else box.append(head)
  box.append(el('div', { class: 'row' },
    el('button', { type: 'button', disabled: running || w.archived ? '' : null, onclick: async () => {
      if (w.inputs.length) { asking = w.id; opened = opened; draw() } else void start(w, {})
    } }, running ? 'Running…' : 'Run'),
    w.schedule && !w.archived ? el('label', { class: 'check' }, el('input', { type: 'checkbox', ...(w.schedule.enabled ? { checked: '' } : {}), 'aria-label': `Schedule for ${w.name}`, onchange: async (e) => { await run('workflows:set-enabled', [w.id, e.target.checked]); await load() } }), 'Scheduled') : null,
    el('button', { type: 'button', 'aria-label': `Rename ${w.name}`, onclick: () => { renaming = w.id; draw() } }, 'Rename'),
    el('button', { type: 'button', 'aria-label': `Duplicate ${w.name}`, onclick: async () => { await run('workflows:duplicate', [w.id]); notice = 'Copied.'; await load() } }, 'Duplicate'),
    el('button', { type: 'button', 'aria-label': `${w.archived ? 'Restore' : 'Archive'} ${w.name}`, onclick: async () => { await run('workflows:archive', [w.id, !w.archived]); await load() } }, w.archived ? 'Restore' : 'Archive'),
    el('button', { type: 'button', class: 'danger', 'aria-label': `Delete ${w.name}`, onclick: async () => {
      if (!confirm(`Delete “${w.name}” and its history? This cannot be undone.`)) return
      await run('workflows:remove', [w.id])
      if (opened === w.id) opened = null
      await load()
    } }, 'Delete')))
  if (asking === w.id) {
    const form = el('div', {}, el('p', { class: 'muted' }, 'Loading…'))
    box.append(form)
    void run('workflows:remembered-secrets', [w.id]).then((names) => form.replaceWith(inputForm(w, names || [])))
  }
  if (opened === w.id) box.append(stepsView(w))
  return box
}

function draftForm() {
  const text = el('textarea', { 'aria-label': 'Describe the workflow', rows: '3', placeholder: 'Describe what it should do. Orion writes the steps; nothing runs until you review and start it.', maxlength: '4000' })
  let busy = false
  return el('form', { class: 'editor', 'aria-label': 'Draft a workflow with Orion', onsubmit: async (e) => {
    e.preventDefault()
    if (busy || !text.value.trim()) return
    busy = true
    notice = 'Orion is drafting…'
    draw()
    const made = await run('workflows:draft', [text.value])
    drafting = false
    if (made) { notice = 'Orion drafted the workflow. Review the steps before running it.'; opened = made.id; detail = null; filter = 'all' }
    await load()
  } }, text, el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Draft it'), el('button', { type: 'button', onclick: () => { drafting = false; draw() } }, 'Cancel')))
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
  if (canDraft) bar.append(el('button', { type: 'button', onclick: () => { drafting = !drafting; draw() } }, 'Draft with Orion'))
  bar.append(el('button', { type: 'button', onclick: () => void load() }, 'Refresh'))
  root.append(bar)
  if (drafting) root.append(draftForm())
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (notice) { root.append(el('div', { class: 'muted', role: 'status' }, notice)); notice = '' }

  for (const r of active) {
    const paused = r.status === 'paused' || r.status === 'waiting-user'
    const control = (action, label) => el('button', { type: 'button', 'aria-label': `${label} ${r.workflow}`, onclick: async () => { await run('workflows:control', [r.runId, action]); await load() } }, label)
    root.append(el('div', { class: 'run', role: 'status' },
      el('strong', {}, `Running: ${r.workflow}`), el('span', { class: 'muted' }, progressText(r)),
      el('div', { class: 'row' }, paused ? control('resume', 'Resume') : control('pause', 'Pause'), control('skip', 'Skip step'), control('step', 'Step'),
        el('button', { type: 'button', class: 'danger', 'aria-label': `Stop ${r.workflow}`, onclick: async () => { await run('workflows:stop', [r.runId]); await load() } }, 'Stop'))))
  }
  for (const c of checkpoints) {
    root.append(el('div', { class: 'run', role: 'status' },
      el('strong', {}, `Interrupted: ${c.workflow}`), el('span', { class: 'muted' }, `Stopped before step ${c.nextStep}, ${when(c.savedAt)}. Nothing before it is done again.`),
      el('div', { class: 'row' },
        el('button', { type: 'button', onclick: async () => {
          const r = await run('workflows:resume', [c.runId])
          if (r && !r.ok) problem = r.message
          await load()
        } }, 'Continue'),
        el('button', { type: 'button', onclick: async () => { await run('workflows:discard-checkpoint', [c.runId]); await load() } }, 'Discard'))))
  }

  const find = el('input', { type: 'search', 'aria-label': 'Search workflows', placeholder: 'Search workflows…', autocomplete: 'off', value: search, oninput: (e) => { search = e.target.value; drawList() } })
  const seg = el('div', { class: 'row seg', role: 'group', 'aria-label': 'Show' }, ...FILTERS.map(([id, label]) => el('button', { type: 'button', 'aria-pressed': String(filter === id), onclick: () => { filter = id; draw() } }, label)))
  root.append(el('div', { class: 'row' }, find), seg)
  root.append(el('div', { id: 'wf-list', class: 'wf-list' }))
  drawList()
  if (search) queueMicrotask(() => { const f = root.querySelector('input[type="search"]'); f?.focus(); f?.setSelectionRange(search.length, search.length) })
}

function drawList() {
  const list = root.querySelector('#wf-list')
  if (!list) return
  list.replaceChildren()
  const items = shownWorkflows()
  if (ready && !items.length) list.append(el('p', { class: 'empty' }, workflows.length ? 'Nothing matches that.' : 'No workflows yet. Make one in Orbis, draft one with Orion, or record one.'))
  for (const w of items) list.append(card(w))
}

document.addEventListener('orbis:workflows-shown', () => void load())
