import { askBrowser, call, HelperDown } from './helper.js'
import { mountOmnibox } from './omnibox-ui.js'
import { mountCommandCenter, show as showCommandCenter, useRail } from './command-center.js'
import { mountRail } from './rail-nav.js'

// The Orbis side panel. Everything it shows comes from the helper; this file only draws it and sends what is typed.
//
// Text is only ever put on the page as text, never as HTML, so nothing a model, a website or a search result says can
// run as code. A link is only made from an address that is really http or https — a `javascript:` address from a
// page's own data would otherwise be a way in.

const $ = (id) => document.getElementById(id)
const status = $('status')

let controller = null
let connected = false

/**
 * What the dot beside the Orbis name in the header is saying.
 *
 * `state` is the class panel.css draws: `ok` green, `warn` amber, `down` red. The page opens on the "Connecting…" in
 * index.html and lands on one of these as soon as it has asked the helper anything.
 */
const RUNTIME_STATES = {
  ready: { label: 'Ready', detail: 'Orbis is running on this computer.', state: 'ok' },
  'no-key': {
    label: 'No model',
    detail: 'Orbis is running, but no model has been set up yet. Add one in the Orbis window.',
    state: 'warn'
  },
  down: { label: 'Stopped', detail: 'Orbis is not running. Start Orbis and this connects by itself.', state: 'down' },
  unreachable: { label: 'No answer', detail: 'Orbis is running but did not answer. It may still be starting.', state: 'down' }
}

function setStatus(name) {
  const it = RUNTIME_STATES[name] ?? RUNTIME_STATES.unreachable
  status.textContent = it.label
  status.title = it.detail
  status.className = `status ${it.state}`
  // Working is the ordinary case, and the ordinary case does not need a badge. A strip that permanently says
  // "Connecting..." or "Ready" is a row of browser space spent telling a person what they can already see; this says
  // something only when something is wrong, which is the only time the answer is worth the space.
  status.hidden = it.state === 'ok'
}

/** The address if it is a web address, otherwise null. */
function safeUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function link(href, className) {
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  if (className) a.className = className
  return a
}


/**
 * Ask Orbis whether it is there, and say so in the header.
 *
 * There is nothing here about which model Orion uses. There used to be, filling a `<select>` from `models:list` --
 * and the `<select>` was removed from this page without the code that filled it, so `modelSelect` and `MODEL_KEY`
 * were read every time and declared nowhere. The `ReferenceError` landed in the catch below, *after* `connected` had
 * been set true, so every load ended with `connected = false` and a header reading "Orbis is running but did not
 * answer" on a machine where Orbis was answering perfectly well.
 *
 * It was worse than a wrong header: `connected` gates the panel's web search (which reported "Orbis is not running,
 * so nothing was searched") and its workspace suggestions (which silently returned none). One undeclared variable
 * made three features look broken and the retry loop repeated it every four seconds for ever.
 *
 * So this asks the one question the header actually answers, and nothing else. A panel that wants a model picker can
 * add one along with the markup to put it in.
 */
async function connect() {
  try {
    const ping = await call('helper:ping')
    connected = true
    setStatus(ping.hasApiKey ? 'ready' : 'no-key')
  } catch (err) {
    connected = false
    // The error's own words never reach the header: it is a diagnostic, and the header is not a log.
    setStatus(err instanceof HelperDown ? 'down' : 'unreachable')
  }
}

// ---------------------------------------------------------------- Search

const results = $('results')
let lastQuery = ''
let searching = null

/**
 * Every view has an address. chrome://orbis#galaxy opens Galaxy, chrome://orbis#workflows opens Workflows, and so on — so a
 * feature is a page you can open, link to, bookmark and land on directly, the way chrome://history and chrome://downloads are,
 * rather than something reachable only by clicking a tab inside one panel.
 */
// 'home' is the Command Center, and it is where the panel opens: everything Orbis can do, and the way to each of
// them. The rest are the places it leads to, each still reachable by its own address as before.
const VIEWS = ['home', 'search', 'block', 'recall', 'notes', 'tasks', 'workflows', 'galaxy', 'secrets', 'account']

const viewFromAddress = () => {
  // The hash is how a person names a view; ?view= is how the browser does, when a toolbar button opens this page over
  // the tab and wants it already showing one thing. Either way it is the same set of names and the same landing.
  const hash = (location.hash || '').replace(/^#\/?/, '').toLowerCase()
  if (VIEWS.includes(hash)) return hash
  const asked = (new URLSearchParams(location.search).get('view') || '').toLowerCase()
  return VIEWS.includes(asked) ? asked : null
}

// How the surface moves this page once it is up. Opening the Command Center a second time must not reload it -- that
// would throw away whatever was typed into it -- so the browser calls in instead of navigating.
window.orbisGoTo = (view) => {
  const wanted = String(view || '').toLowerCase()
  showTab(VIEWS.includes(wanted) ? wanted : 'home')
}

/**
 * Show one view.
 *
 * `landing` is true for the very first call, where the view is whatever the address already named. That one replaces
 * the address instead of pushing it: pushing would put an entry in front of the page's own arrival, so the first Back
 * would appear to do nothing.
 */
function showTab(name, landing = false) {
  // Every view in the panel, including the rail's own (Tabs, Clipboard, ...), so choosing a tab always hides whichever was in front.
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `view-${name}`
  for (const id of VIEWS) $(`tab-${id}`)?.setAttribute('aria-selected', String(id === name))
  // Keep the address in step with what is on screen, and leave a history entry so Back returns to the view you came
  // from. It used to `replaceState`, on the reasoning that the address describes the page rather than a trail through
  // it -- but the comment above promises a view is "a page you can open, link to, bookmark and land on directly", and
  // a page you cannot go Back from is not one of those. Back left the panel entirely instead.
  if (viewFromAddress() !== name) history[landing ? 'replaceState' : 'pushState'](null, '', `#${name}`)
  document.dispatchEvent(new CustomEvent('orbis:view', { detail: { name } }))
  if (name === 'block') document.dispatchEvent(new CustomEvent('orbis:blocking-shown'))
  else if (name === 'notes') document.dispatchEvent(new CustomEvent('orbis:notes-shown'))
  else if (name === 'tasks') document.dispatchEvent(new CustomEvent('orbis:tasks-shown'))
  else if (['workflows', 'galaxy', 'secrets'].includes(name)) document.dispatchEvent(new CustomEvent(`orbis:${name}-shown`))
  // Read afresh every time it is opened, however it was opened: the name can change
  // in the Orbis window while this panel sits here.
  else if (name === 'account') document.dispatchEvent(new CustomEvent('orbis:account-shown'))
  else if (name === 'home') void commandCenter?.refresh()
  else if (name === 'search') $('query').focus()
  else input.focus()
}
// The sidebar is the only navigation now; the row of tabs that repeated it is gone.
// These listeners are kept behind a guard so the panel still works if the row ever
// comes back — and so removing it cannot take the panel down with it.
for (const id of VIEWS) {
  $(`tab-${id}`)?.addEventListener('click', () => showTab(id))
}

// The Command Center is built once, when the panel loads, and asked to read the world again whenever it is shown.
// Over the page, or in the side panel. The Command Center is the same thing either way; as a surface it is drawn on a
// backdrop, takes the whole window, and Escape puts it away -- the page behind it was never touched, so there it still is.
const asSurface = new URLSearchParams(location.search).get('surface') === 'overlay'
if (asSurface) {
  document.documentElement.classList.add('surface')
  document.getElementById('cc-close')?.addEventListener('click', () => {
    askBrowser('orbis.command.close').catch(() => { /* not the surface: nothing to close */ })
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    // Escape belongs to whatever is in front: a dialog, or a search box with something in it, answers first.
    if (document.querySelector('dialog[open]')) return
    const box = document.querySelector('.cc-search')
    if (box && document.activeElement === box && box.value) return
    e.preventDefault()
    askBrowser('orbis.command.close').catch(() => { /* not the surface: nothing to close */ })
  })
}

// One navigation. The rail says where to go; the Command Center shows what is there. Choosing a category always lands
// on the Command Center, so the rail's mark and the panel agree about where you are.
const commandCenter = mountCommandCenter($('view-home'))
const rail = mountRail($('rail'), (view) => {
  showTab('home')
  showCommandCenter(view)
})
useRail(rail)

function renderResults(outcome) {
  results.replaceChildren()
  if (!outcome.results?.length) {
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = outcome.problem || 'Nothing was found.'
    results.append(p)
    return
  }
  for (const r of outcome.results) {
    const href = safeUrl(r.url)
    if (!href) continue
    const a = link(href, 'result')
    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = r.title || r.url
    const site = document.createElement('span')
    site.className = 'site'
    site.textContent = r.site || new URL(href).hostname
    const snippet = document.createElement('span')
    snippet.className = 'snippet'
    snippet.textContent = r.snippet || ''
    a.append(title, site, snippet)
    results.append(a)
  }
  if (typeof outcome.tookMs === 'number') {
    const took = document.createElement('div')
    took.className = 'took'
    took.textContent = `${outcome.results.length} results in ${(outcome.tookMs / 1000).toFixed(1)}s`
    results.append(took)
  }
}

/**
 * Live predictions under the search box, from Chromium's real autocomplete providers.
 *
 * The box used to do nothing until Enter. Now every keystroke starts a real `AutocompleteController` query in the
 * browser, and what comes back -- search suggestions, history, URLs, bookmarks, keywords, open tabs -- is merged with
 * the one thing Chromium cannot know about, this person's workspaces, and drawn in Orbis's own design.
 *
 * Submitting still works exactly as it did, for plain words with no row chosen.
 */
const omnibox = mountOmnibox({
  input: $('query'),
  // The same helper the rest of the panel talks to. This is what makes the microphone real rather than decorative:
  // without it the control is not shown at all.
  call: (channel, args = []) => call(channel, args),
  /** Workspaces, which Chromium has never heard of. Its own providers already cover history, bookmarks and tabs. */
  orbisSuggestions: async (text) => {
    const words = text.trim().toLowerCase()
    if (!words || !connected) return []
    try {
      const spaces = await call('workspaces:list', [])
      return (Array.isArray(spaces) ? spaces : [])
        .filter((w) => String(w.name ?? '').toLowerCase().includes(words))
        .slice(0, 5)
        .map((w, i) => ({
          id: `ws:${w.id}`,
          kind: 'workspace',
          text: w.name,
          // The real count, from the real workspace. Never a placeholder.
          detail: `${w.tabs} ${w.tabs === 1 ? 'tab' : 'tabs'}${w.current ? ' — current' : ''}`,
          workspaceId: w.id,
          score: 100 - i
        }))
    } catch {
      // Orbis not running is not a reason to show nothing: the native rows stand on their own.
      return []
    }
  },
  onSearch: (query) => {
    $('query').value = query
    $('search-form').requestSubmit()
  },
  onAskOrion: (query) => {
    $('query').value = query
  },
  onOpenExternally: (target) => {
    void call('browser:openExternal', [target]).catch(() => {
      // Nothing opened rather than something opened in the wrong place.
    })
  },
  onOrbisAction: (candidate) => {
    if (candidate.action === 'OPEN_WORKSPACE') {
      const id = String(candidate.id ?? '').replace(/^OPEN_WORKSPACE:/, '')
      void call('workspaces:open', [id, false]).catch(() => {})
    }
  }
})

$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  omnibox.dismiss()
  const query = $('query').value.trim()
  if (!query) return
  searching?.abort()
  searching = new AbortController()
  const mine = searching
  lastQuery = query
  results.replaceChildren()
  const wait = document.createElement('p')
  wait.className = 'empty'
  wait.textContent = 'Searching…'
  results.append(wait)
  $('search-actions').hidden = true
  try {
    if (!connected) await connect()
    if (!connected) throw new HelperDown('Orbis is not running, so nothing was searched.')
    const outcome = await call('search:run', [query, 'all'], { signal: mine.signal })
    if (mine.signal.aborted) return
    renderResults(outcome)
    $('search-actions').hidden = !outcome.results?.length
  } catch (err) {
    if (mine.signal.aborted) return
    results.replaceChildren()
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = err?.message || 'The search did not work.'
    results.append(p)
  }
})

// From results to an answer: the same question, asked with the web read first so the answer names its sources.

// Open on whatever the address names, so chrome://orbis#galaxy lands on Galaxy rather than on Ask and a click.
// With no address, the Command Center: the panel opens on everything Orbis can do rather than on one of them.
const opening = viewFromAddress()
showTab(opening ?? 'home', true)
// And follow the address afterwards: going back, or pasting a different one, moves the view.
window.addEventListener('hashchange', () => {
  const wanted = viewFromAddress()
  if (wanted) showTab(wanted)
})

connect()
// While the helper is not running, keep looking for it so the panel comes alive by itself when it starts.
setInterval(() => {
  if (!connected) void connect()
}, 4000)
