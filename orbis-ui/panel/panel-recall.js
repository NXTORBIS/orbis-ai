import { call } from './helper.js'

// The pages this person has read, in the Orbis panel. Everything in here came from browsing, so this is where it is
// looked up. Text from a page goes on screen as text only -- never as markup, because a page wrote it.

const root = document.getElementById('recall')

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

let state = { enabled: false, pages: 0, topHosts: [] }
let hits = []
let query = ''
let host = null
let problem = ''
let searching = false
let ready = false

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    // Orbis not running is a different thing from nothing found, and saying so is the difference between a panel that
    // looks empty and one that looks broken.
    problem = err?.message || 'That did not work.'
    return null
  }
}

const when = (at) => {
  const ms = Date.now() - at
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`
  if (ms < 86400000) return `${Math.round(ms / 3600000)} h ago`
  const days = Math.round(ms / 86400000)
  return days < 30 ? `${days} d ago` : new Date(at).toLocaleDateString()
}

async function load() {
  const answer = await run('recall:state', [])
  if (answer) state = { enabled: Boolean(answer.enabled), pages: answer.pages || 0, topHosts: answer.topHosts || [] }
  ready = true
  await list()
}

async function list() {
  if (!state.enabled) {
    hits = []
    draw()
    return
  }
  searching = true
  draw()
  const answer =
    query.trim().length >= 2
      ? await run('recall:search', [query.trim(), { limit: 60, host: host || undefined }])
      : await run('recall:recent', [40, host || undefined])
  searching = false
  hits = answer?.hits ?? []
  draw()
}

let typing = null
function typed(value) {
  query = value
  clearTimeout(typing)
  typing = setTimeout(() => void list(), 220)
}

async function forget(hit) {
  const answer = await run('recall:forget', [hit.id])
  if (!answer) return draw()
  hits = hits.filter((one) => one.id !== hit.id)
  state = { ...state, pages: Math.max(0, state.pages - 1) }
  draw()
}

async function forgetSite(site) {
  // Forgetting a site also stops it being recorded again, because deleting it while leaving it free to come straight
  // back would be a button that appears not to work. The panel says so before it happens.
  if (!confirm(`Forget every page from ${site}, and stop recording it?`)) return
  const answer = await run('recall:forget-site', [site])
  if (!answer) return draw()
  hits = hits.filter((one) => one.host !== site)
  if (host === site) host = null
  await load()
}

function drawRow(hit) {
  return el(
    'li',
    { class: 'rc-item' },
    el(
      'div',
      { class: 'rc-item-head' },
      el('b', {}, hit.title || hit.url),
      el('span', { class: 'rc-item-when' }, when(hit.visitedAt))
    ),
    hit.snippet ? el('p', { class: 'rc-item-snippet' }, hit.snippet) : null,
    el(
      'div',
      { class: 'rc-item-actions' },
      el('button', { type: 'button', class: 'rc-site', onclick: () => { host = hit.host; void list() } }, hit.host),
      el('button', { type: 'button', class: 'rc-act', onclick: () => { location.href = hit.url } }, 'Open'),
      el('button', { type: 'button', class: 'rc-act', onclick: () => void forgetSite(hit.host) }, 'Forget site'),
      el('button', { type: 'button', class: 'rc-act rc-danger', onclick: () => void forget(hit) }, 'Forget')
    )
  )
}

function draw() {
  if (!root) return
  root.replaceChildren()

  if (problem) root.append(el('p', { class: 'rc-problem', role: 'alert' }, problem))

  if (!ready) {
    root.append(el('p', { class: 'rc-quiet' }, 'Reading…'))
    return
  }

  /**
   * Off is a state, not an absence.
   *
   * The panel cannot switch this on -- that decision is made in Settings, where the wording about what is kept and
   * that the file is not encrypted sits beside the switch. So it says where to go rather than offering a shortcut.
   */
  if (!state.enabled) {
    root.append(
      el('h2', { class: 'rc-title' }, 'Orbis is not keeping what you read'),
      el(
        'p',
        { class: 'rc-quiet' },
        'Switched on, Orbis keeps the text of pages you read so you can find them again by what was in them. ' +
          'It stays on this computer, private tabs are never read, and you can delete any of it at any time.'
      ),
      el('p', { class: 'rc-quiet' }, 'Turn it on in Orbis, under Settings → Browsing.')
    )
    return
  }

  root.append(
    el(
      'div',
      { class: 'rc-bar' },
      el('input', {
        type: 'search',
        class: 'rc-search',
        value: query,
        placeholder: 'Search what you have read',
        'aria-label': 'Search what you have read',
        oninput: (e) => typed(e.target.value)
      }),
      host
        ? el('button', { type: 'button', class: 'rc-chip on', onclick: () => { host = null; void list() } }, `${host} ✕`)
        : null
    ),
    el('p', { class: 'rc-quiet rc-count' }, `${state.pages.toLocaleString()} page${state.pages === 1 ? '' : 's'} kept`)
  )

  if (!host && state.topHosts.length > 0 && !query.trim()) {
    root.append(
      el(
        'div',
        { class: 'rc-hosts' },
        ...state.topHosts.map((one) =>
          el('button', { type: 'button', class: 'rc-chip', onclick: () => { host = one.host; void list() } }, `${one.host} ${one.pages}`)
        )
      )
    )
  }

  if (searching) {
    root.append(el('p', { class: 'rc-quiet' }, 'Looking…'))
    return
  }

  if (hits.length === 0) {
    root.append(
      el(
        'p',
        { class: 'rc-quiet' },
        query.trim()
          ? `Nothing you have read matches “${query.trim()}”.`
          : 'Nothing kept yet. A page is kept once you have had it open and in front of you for a few seconds.'
      )
    )
    return
  }

  root.append(el('ul', { class: 'rc-list' }, ...hits.map(drawRow)))
}

draw()

/**
 * Read again whenever this view is actually shown.
 *
 * The panel keeps every view in the page and hides all but one, so this script runs once when the panel opens and
 * would otherwise show whatever was true then -- for ever. Watching the `hidden` attribute is what makes coming back
 * to it show a page read since, and a page forgotten in the Orbis window gone from here.
 *
 * A hook the window could call was the obvious alternative and is what the ticker does; it is not used here because
 * nothing calls that one either, and an uncalled hook is a refresh that looks implemented and never happens.
 */
const section = document.getElementById('view-recall')
if (section) {
  const watcher = new MutationObserver(() => {
    if (!section.hasAttribute('hidden')) void load()
  })
  watcher.observe(section, { attributes: true, attributeFilter: ['hidden'] })
  if (!section.hasAttribute('hidden')) void load()
} else {
  void load()
}
