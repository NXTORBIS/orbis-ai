// The Orb's hands.
//
// Until now the Orb could ask Orion things and set the browser agent running, which meant that "open a new tab" went
// through a language model deciding to call a tool. That is a long way round for a thing the browser can plainly do,
// and it fails in ways a button does not.
//
// So this is the direct route: the Orb asks the Browser Control Layer what it can do (`browser:capabilities`) and runs
// any one of those by id (`browser:run`). The list is the registry's own, which is what makes the Orb able to reach
// everything -- a capability registered anywhere in Orbis shows up here by being registered, not by this file being
// edited. Today that is a hundred and thirty-odd things: tabs, navigation, zoom, groups, the page itself, capture.
//
// It is not a way round the safety model, and that is the point of routing it through the same layer:
//
//   - the control layer decides what needs asking first, from each capability's own policy
//   - anything consequential emits a confirmation and waits for a real yes; closing the Orb is a no
//   - a capability the browser says is unavailable is shown as unavailable, with the reason it gave
//   - parameters are collected from the capability's own description, so nothing is guessed at
//
// Nothing here has a list of actions written by hand. There is one exception, `QUICK`, which is only an ordering: the
// handful people reach for most, pulled to the top of a list they are already in.

import { call } from './helper.js'

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }

/**
 * The few worth a button of their own, in the order they belong in.
 *
 * Not a whitelist: everything else is still reachable through the search below. These are simply the ones somebody
 * opens the Orb to do, and making them one click rather than one search is the whole difference.
 */
const QUICK = [
  { id: 'tabs.create', label: 'New tab', params: { url: 'about:blank', active: true } },
  { id: 'navigation.back', label: 'Back' },
  { id: 'navigation.forward', label: 'Forward' },
  { id: 'navigation.reload', label: 'Reload' },
  { id: 'zoom.set', label: 'Zoom in', params: { action: 'in' } },
  { id: 'zoom.set', label: 'Zoom out', params: { action: 'out' } },
  { id: 'page.screenshot', label: 'Screenshot' },
  { id: 'tabs.close', label: 'Close tab' }
]

/** What the browser says it can do. Read once when the controls are first opened, and again after anything changes it. */
let known = null
let loading = null

export async function capabilities(force = false) {
  if (known && !force) return known
  if (loading && !force) return loading
  loading = call('browser:capabilities', [{}])
    .then((answer) => {
      known = Array.isArray(answer?.capabilities) ? answer.capabilities : []
      return known
    })
    .catch(() => {
      // The browser did not answer. An empty list is honest; it is not a claim that the browser can do nothing, and
      // the caller says so on screen.
      known = null
      return null
    })
    .finally(() => { loading = null })
  return loading
}

/**
 * Runs one capability.
 *
 * `onConfirm` is given whatever the control layer wants approved and must resolve true or false. There is no default
 * yes: a caller that cannot ask should return false, because an action nobody approved must not happen.
 */
export async function run(id, params, { onConfirm, onStatus } = {}) {
  let pending = null
  try {
    const result = await call('browser:run', [id, params ?? {}], {
      onEvent: (event) => {
        if (event?.type !== 'confirm' || !event.confirmation) return
        pending = event.confirmation
        const decide = onConfirm ? onConfirm(event.confirmation) : Promise.resolve(false)
        Promise.resolve(decide).then(
          (approved) => call('browser:run-answer', [event.confirmation.id, approved === true]).catch(() => undefined),
          () => call('browser:run-answer', [event.confirmation.id, false]).catch(() => undefined)
        )
      }
    })
    onStatus?.(null)
    return { ok: true, data: result?.data ?? null }
  } catch (error) {
    // An approval that was refused is not a failure to report as one; it is the person saying no.
    const message = error?.message || 'The browser could not do that.'
    return { ok: false, error: pending && /refus|approv|cancel/i.test(message) ? 'Not approved.' : message }
  }
}

/** The inputs a capability needs, drawn from its own description. Nothing is invented and nothing is assumed. */
function paramFields(capability) {
  const wrap = el('div', 'orb-params')
  const inputs = new Map()
  for (const [name, spec] of Object.entries(capability.params ?? {})) {
    const row = el('label', 'orb-param')
    row.append(el('span', 'orb-param-name', `${name}${spec.required ? ' *' : ''}`))
    let field
    if (Array.isArray(spec.enum) && spec.enum.length) {
      field = el('select')
      if (!spec.required) field.append(el('option', '', ''))
      for (const option of spec.enum) {
        const o = el('option', '', option)
        o.value = option
        field.append(o)
      }
    } else if (spec.type === 'boolean') {
      field = el('input')
      field.type = 'checkbox'
    } else {
      field = el('input')
      field.type = spec.type === 'number' || spec.type === 'integer' ? 'number' : 'text'
      field.placeholder = spec.description || ''
      // Anything the spec marks private is not remembered by the field and never shown back.
      if (spec.sensitive) field.autocomplete = 'off'
    }
    field.title = spec.description || name
    inputs.set(name, { field, spec })
    row.append(field)
    wrap.append(row)
  }
  return { wrap, read: () => {
    const out = {}
    for (const [name, { field, spec }] of inputs) {
      if (spec.type === 'boolean') { out[name] = field.checked; continue }
      const value = String(field.value ?? '').trim()
      if (!value) continue
      out[name] = spec.type === 'number' || spec.type === 'integer' ? Number(value) : value
    }
    return out
  } }
}

/**
 * Draws the controls into `host`.
 *
 * `ask` is how a confirmation reaches the person -- the Orb's own approval box -- and `say` is how the outcome is
 * reported. Both are the Orb's, so a control run from here looks like everything else the Orb does.
 */
export function mountControls(host, { ask, say }) {
  host.replaceChildren()
  const search = el('input', 'orb-cap-search')
  search.type = 'search'
  search.placeholder = 'Search everything the browser can do…'
  search.setAttribute('aria-label', 'Search browser controls')
  search.autocomplete = 'off'
  host.append(search)

  const quickRow = el('div', 'orb-quick')
  host.append(quickRow)
  const list = el('div', 'orb-caps')
  host.append(list)
  const note = el('p', 'orb-cap-note')
  host.append(note)

  /** Runs one, and says what happened either way. */
  const go = async (id, params, label) => {
    note.textContent = `${label}…`
    const outcome = await run(id, params, { onConfirm: ask })
    if (outcome.ok) {
      note.textContent = `${label}: done.`
      say?.(`${label}: done.`)
      // Something changed, so what is available may have changed with it.
      void capabilities(true).then(() => draw(search.value))
    } else {
      note.textContent = `${label}: ${outcome.error}`
      say?.(`${label}: ${outcome.error}`)
    }
  }

  /** One row: what it is, what it needs, and whether it can run at all. */
  function row(capability) {
    const item = el('div', `orb-cap${capability.available ? '' : ' off'}`)
    const head = el('button', 'orb-cap-open')
    head.type = 'button'
    head.append(el('span', 'orb-cap-name', capability.name))
    head.append(el('span', 'orb-cap-id', capability.id))
    if (capability.mutates) head.append(el('span', 'orb-cap-tag', 'changes things'))
    item.append(head)

    const detail = el('div', 'orb-cap-detail')
    detail.hidden = true
    detail.append(el('p', 'orb-cap-desc', capability.description || ''))
    if (!capability.available) {
      // The browser's own reason, not a guess at one.
      detail.append(el('p', 'orb-cap-why', capability.unavailableReason || 'This cannot be used right now.'))
    } else {
      const fields = paramFields(capability)
      if (fields.wrap.childElementCount) detail.append(fields.wrap)
      const doIt = el('button', 'primary-btn', 'Run')
      doIt.type = 'button'
      doIt.addEventListener('click', () => void go(capability.id, fields.read(), capability.name))
      detail.append(doIt)
    }
    head.addEventListener('click', () => { detail.hidden = !detail.hidden })
    item.append(detail)
    return item
  }

  function draw(query) {
    const all = known
    quickRow.replaceChildren()
    list.replaceChildren()
    if (all === null) {
      note.textContent = 'The browser is not answering, so Orbis cannot say what it can do.'
      return
    }
    const byId = new Map(all.map((c) => [c.id, c]))
    if (!query.trim()) {
      for (const quick of QUICK) {
        const capability = byId.get(quick.id)
        if (!capability) continue
        const b = el('button', `orb-quick-btn${capability.available ? '' : ' off'}`, quick.label)
        b.type = 'button'
        b.disabled = !capability.available
        b.title = capability.available ? capability.description || quick.label : capability.unavailableReason || 'Not available right now'
        b.addEventListener('click', () => void go(quick.id, quick.params, quick.label))
        quickRow.append(b)
      }
    }
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matches = all.filter((c) => {
      if (!words.length) return true
      const hay = `${c.name} ${c.id} ${c.description} ${c.domain}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    // Available first: something that can be used now is more use than something that cannot.
    matches.sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name))
    for (const capability of matches.slice(0, 60)) list.append(row(capability))
    note.textContent = matches.length
      ? `${matches.length} of ${all.length} things the browser can do.`
      : `Nothing matches “${query.trim()}”.`
  }

  search.addEventListener('input', () => draw(search.value))
  note.textContent = 'Asking the browser what it can do…'
  void capabilities().then(() => draw(''))
  return { refresh: () => void capabilities(true).then(() => draw(search.value)) }
}
