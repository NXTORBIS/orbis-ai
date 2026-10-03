// The Orbis Command Center.
//
// Everything Orbis can do, in one place, without the browser becoming complicated. The shell is deliberately thin: it
// knows how to find a capability, say whether it can be used, open it, and pin it. What each capability *does* is
// implemented where it always was, and is reached through the same channels as before.
//
// Nothing here is a route somebody wired by hand. The navigation, the search and the Overview are all read from the
// capability registry (src/shared/commandCenter.ts), so a new Orbis feature appears here by being registered, not by
// this file being edited.
//
// Nothing here is invented either. A capability is offered only when the things it needs are actually there; state on
// the Overview is state that was really read. When something cannot be known, it says so rather than guessing.

import { CATEGORIES, CAPABILITIES, MAX_PINS, addPin, addressFor, capabilitiesIn, capabilityById, movePin, normalizePins, removePin, searchCapabilities, unavailableBecause } from './command-registry.js'
import { icon } from './rail/icons.js'
import { call, askBrowser, HelperDown } from './helper.js'

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }


/** Everything the Command Center draws from. Nothing in here is assumed; each field is filled by something that answered. */
const state = {
  /** 'home' or a category id. */
  view: 'home',
  query: '',
  /** What Orbis can do right now. Everything false until something says otherwise. */
  ready: { browser: false, helper: false, key: false, page: false },
  /** Read once on open, and after anything that could change it. */
  facts: { adblock: null, workflows: null, page: null },
  pins: [],
  /** Set while the first read is in flight, so the Overview does not flash "nothing" before it knows. */
  loading: true
}

// ---------------------------------------------------------------- what is actually true

/**
 * Asks Orbis what it can do. Everything is false until something answers; a capability is never offered on the
 * assumption that the thing behind it is probably there.
 */
async function readReadiness() {
  try {
    const ready = await call('browser:task-ready')
    state.ready.helper = true
    state.ready.browser = ready.browser === true
    state.ready.key = ready.key === true
  } catch {
    state.ready = { browser: false, helper: false, key: false, page: false }
    return
  }
  // A real page to act on, as opposed to a new tab or one of Orbis's own pages.
  try {
    const page = await call('browser:do', ['page-read', { maxChars: 1 }])
    const url = String(page?.url ?? '')
    state.ready.page = /^https?:/.test(url)
    state.facts.page = state.ready.page ? { url, title: String(page.title ?? '') } : null
  } catch {
    state.ready.page = false
    state.facts.page = null
  }
}

/** The few things the Overview reports. Each is read; none is assumed; a channel that is not there leaves it unknown. */
async function readFacts() {
  state.facts.adblock = await call('adblock:control', [{ type: 'adblock:state' }]).then(
    (s) => ({ on: s?.enabled !== false }),
    () => null
  )
  state.facts.workflows = await call('workflows:status').then(
    (s) => ({ running: Array.isArray(s?.active) ? s.active.length : 0 }),
    () => null
  )
}

// ---------------------------------------------------------------- pins
//
// The toolbar is the browser's. What is kept here is the order and the choice; the buttons themselves are real Chromium
// actions (chrome/browser/ui/browser_actions.cc), which is why only capabilities with one can be pinned at all.

/**
 * What is pinned, asked of the browser rather than remembered here.
 *
 * The toolbar is the truth. Keeping a list of our own and showing that is how the Command Center ends up promising a
 * button that is not there -- after a reset, another profile, or a pin the browser refused.
 */
async function loadPins() {
  try {
    state.pins = normalizePins(await askBrowser('orbis.pins.get'))
  } catch {
    state.pins = []
  }
}

async function pin(id) {
  const result = addPin(state.pins, id)
  if (!result.ok) return say(result.error)
  await applyPins(result.pins)
}
const unpin = (id) => applyPins(removePin(state.pins, id))
const reorder = (id, delta) => applyPins(movePin(state.pins, id, delta))

/**
 * Hands an order to the browser and shows whatever the toolbar has afterwards.
 *
 * Not what was asked for: what the toolbar ended up with. If the browser refuses, nothing here pretends it happened --
 * a pin that has not reached the toolbar is not a pin.
 */
async function applyPins(wanted) {
  try {
    await askBrowser('orbis.pins.set', wanted)
  } catch {
    say('Orbis could not change the toolbar.')
  }
  await loadPins()
  draw()
}

// ---------------------------------------------------------------- drawing

let noticeTimer = 0
function say(message) {
  const notice = $('cc-notice')
  if (!notice) return
  notice.textContent = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.textContent = '' }, 6000)
}

/** One capability, as a row you can open and pin. */
function capabilityRow(capability) {
  const why = unavailableBecause(capability, state.ready)
  const row = el('div', `cc-item${why ? ' cc-off' : ''}`)

  const open = el('button', 'cc-open')
  open.type = 'button'
  open.append(icon(capability.icon, 20))
  const words = el('span', 'cc-words')
  words.append(el('strong', '', capability.name), el('span', 'cc-desc', why ?? capability.description))
  open.append(words)
  open.disabled = Boolean(why)
  open.title = why ? `${capability.name}: ${why}` : capability.description
  open.addEventListener('click', () => go(capability))
  row.append(open)

  if (capability.pinnable) {
    const pinned = state.pins.includes(capability.id)
    const b = el('button', `cc-pin${pinned ? ' on' : ''}`)
    b.type = 'button'
    b.append(icon('pin', 15))
    b.title = pinned ? `Unpin ${capability.name} from the toolbar` : `Pin ${capability.name} to the toolbar`
    b.setAttribute('aria-pressed', String(pinned))
    b.setAttribute('aria-label', b.title)
    b.addEventListener('click', () => (pinned ? unpin(capability.id) : pin(capability.id)))
    row.append(b)
  }
  return row
}

/**
 * What choosing a capability does.
 *
 * A panel view stays here. A page is opened by the browser. A `do` capability is the browser performing something, and
 * the only thing said afterwards is what the browser actually reported: if the handler refuses -- no page, no address,
 * policy -- the refusal is what appears, not a confirmation.
 */
function go(capability) {
  /*
   * A panel view and a rail view are both views of this very page, so both are reached by putting the name in the
   * address and letting the panel's own routing do the rest.
   *
   * A `view` row used not to come in here at all: it fell through to the bottom of this function and was handed to
   * the browser as `chrome://orbis/#tabs`, which reloaded this page at a name the page did not recognise, so it
   * landed on the Command Center. Fifteen rows behaved that way, and from the outside the Command Center looked like
   * it was opening the Command Center.
   *
   * Setting a hash that is already the hash fires no `hashchange`, so when the view is already the current address
   * the panel is asked directly instead -- otherwise choosing Tabs twice would do nothing the second time.
   */
  if (capability.target.kind === 'panel' || capability.target.kind === 'view') {
    const view = capability.target.view
    if (location.hash.replace(/^#\/?/, '').toLowerCase() === view.toLowerCase()) window.orbisGoTo?.(view)
    else location.hash = `#${view}`
    return
  }
  if (capability.target.kind === 'app') {
    // Reached only if something bypasses the row's own disabled state: the Orbis window is the only place this lives,
    // and the browser has no way to open it there. Saying so beats opening something else and calling it that.
    say(`${capability.name} is in the Orbis window, not the browser.`)
    return
  }
  if (capability.target.kind === 'do') {
    perform(capability)
    return
  }
  if (capability.target.kind === 'ask') {
    askOrbis(capability)
    return
  }
  const address = addressFor(capability)
  askBrowser('orbis.open', address).catch(() => { location.href = address })
}

/**
 * Something Orbis does, asked of Orbis.
 *
 * What is said afterwards comes from what actually happened -- how many tabs locked, or the reason it could not -- rather
 * than from having sent the request. A message that appears whether or not the work happened is the kind of thing that
 * makes somebody believe a tab is locked when it is not.
 */
function askOrbis(capability) {
  call(capability.target.channel, []).then(
    (result) => {
      const count = result && typeof result.locked === 'number' ? result.locked : null
      if (capability.id === 'lockAllTabs') {
        say(count === 0 ? 'Nothing was left to lock.' : `Locked ${count} tab${count === 1 ? '' : 's'}.`)
      } else if (capability.id === 'lockTab') {
        say(result && result.locked ? 'This tab is locked.' : 'This tab has no tab password yet.')
      } else {
        say('Orbis is locked.')
      }
    },
    (err) => say((err && err.message) || `${capability.name} could not be done here.`)
  )
}

/** What each `do` capability says once the browser has actually done it. Nothing is said before that. */
const DONE = { copyLink: (url) => `Copied ${url}` }

function perform(capability) {
  askBrowser(capability.target.message).then(
    (result) => {
      const done = DONE[capability.id]
      if (done) say(done(typeof result === 'string' ? result : ''))
    },
    () => say(`${capability.name} could not be done here.`)
  )
}

/**
 * Asking in words.
 *
 * When what somebody typed matches nothing, Orion is asked which of Orbis's capabilities they meant -- and it is given
 * the list to choose from. It picks an id or says none; it cannot answer with a feature Orbis does not have, because
 * the only answers accepted are ones already in the registry. A guess that is not on the list is discarded.
 */
async function askOrion(query) {
  const menu = CAPABILITIES.map((c) => `${c.id}: ${c.name} — ${c.description}`).join(String.fromCharCode(10))
  const prompt = [
    'These are the things Orbis can do:',
    menu,
    '',
    `Somebody asked: ${query}`,
    '',
    'Reply with the single id that best answers them, and nothing else. If none of them does, reply exactly: none.'
  ].join(String.fromCharCode(10))

  const answer = await new Promise((resolve, reject) => {
    let text = ''
    call('chat:send', [{ webSearch: false, messages: [{ role: 'user', content: prompt }] }], {
      onEvent: (event) => { if (event.type === 'delta' && typeof event.content === 'string') text += event.content }
    }).then(() => resolve(text), reject)
  })
  const said = String(answer).trim().toLowerCase().replace(/[^a-z]/g, '')
  return CAPABILITIES.find((c) => c.id.toLowerCase() === said) ?? null
}

function drawSearch() {
  const box = $('cc-results')
  box.replaceChildren()
  const hits = searchCapabilities(state.query, state.ready)
  if (!hits.length) {
    box.append(el('p', 'cc-quiet', `Nothing in Orbis matches “${state.query}”.`))
    // Words rather than a name: Orion is asked which capability was meant. Only offered when it could answer at all.
    if (state.ready.helper && state.ready.key && state.query.trim().split(/\s+/).length > 1) {
      const ask = el('button', 'cc-ask'); ask.type = 'button'
      ask.append(icon('orion', 16), el('span', '', 'Ask Orion what you mean'))
      const said = el('p', 'cc-quiet')
      ask.addEventListener('click', async () => {
        ask.disabled = true
        said.textContent = 'Asking Orion…'
        const asked = state.query
        try {
          const found = await askOrion(asked)
          if (state.query !== asked) return
          if (!found) { said.textContent = `Orbis has nothing for “${asked}”.`; ask.disabled = false; return }
          said.textContent = ''
          box.replaceChildren(el('p', 'cc-quiet', `Orion suggests:`), capabilityRow(found))
        } catch {
          said.textContent = 'Orion could not answer.'
          ask.disabled = false
        }
      })
      box.append(ask, said)
    }
    return
  }
  for (const hit of hits) box.append(capabilityRow(hit.capability))
}

/** The Overview: what Orbis can do, what it is doing, and the way to the rest. */
function drawHome() {
  const main = $('cc-main')
  main.replaceChildren()

  // ---- what is pinned, and what could be
  const quick = el('section', 'cc-block')
  quick.append(el('h2', 'cc-h', 'Quick access'))
  if (state.pins.length) {
    const row = el('div', 'cc-pins')
    state.pins.forEach((id, at) => {
      const capability = capabilityById(id)
      if (!capability) return
      const chip = el('div', 'cc-chip')
      const open = el('button', 'cc-chip-open'); open.type = 'button'
      open.append(icon(capability.icon, 18), el('span', '', capability.name))
      open.addEventListener('click', () => go(capability))
      const left = el('button', 'cc-chip-move', '‹'); left.type = 'button'; left.title = 'Move left'
      left.setAttribute('aria-label', `Move ${capability.name} left`)
      left.disabled = at === 0
      left.addEventListener('click', () => reorder(id, -1))
      const right = el('button', 'cc-chip-move', '›'); right.type = 'button'; right.title = 'Move right'
      right.setAttribute('aria-label', `Move ${capability.name} right`)
      right.disabled = at === state.pins.length - 1
      right.addEventListener('click', () => reorder(id, 1))
      const off = el('button', 'cc-chip-move', '✕'); off.type = 'button'; off.title = 'Unpin'
      off.setAttribute('aria-label', `Unpin ${capability.name}`)
      off.addEventListener('click', () => unpin(id))
      chip.append(open, left, right, off)
      row.append(chip)
    })
    quick.append(row)
    quick.append(el('p', 'cc-quiet', `These sit beside the address bar. ${state.pins.length} of ${MAX_PINS}.`))
  } else {
    quick.append(el('p', 'cc-quiet', 'Nothing is pinned. Pin what you reach for and it appears beside the address bar.'))
  }
  main.append(quick)

  // ---- what Orbis is doing, as far as it could be read
  const now = el('section', 'cc-block')
  now.append(el('h2', 'cc-h', 'Right now'))
  const facts = el('dl', 'cc-facts')
  const fact = (label, value) => { facts.append(el('dt', '', label), el('dd', '', value)) }

  fact('Browser', state.ready.browser ? 'Connected' : 'Not connected')
  fact('Orion', !state.ready.helper ? 'Orbis is not running' : state.ready.key ? 'Ready' : 'Unavailable')
  fact('This page', state.facts.page ? (state.facts.page.title || state.facts.page.url) : 'Nothing Orbis can act on')
  // Read, or not known. Never a cheerful "ON" that nothing confirmed.
  fact('Ad blocking', state.facts.adblock === null ? 'Not known' : state.facts.adblock.on ? 'On' : 'Off')
  fact(
    'Workflows',
    state.facts.workflows === null ? 'Not known' : state.facts.workflows.running ? `${state.facts.workflows.running} running` : 'None running'
  )
  now.append(facts)
  main.append(now)

  // ---- everything else, laid out the way Orbis lays out settings: one surface, headings down it, every row visible.
  //
  // It used to be nine buttons that led to nine lists, which meant the answer to "where is Whiteboard" was a guess at
  // which of nine words contained it. Nothing was gained by the hiding: the whole registry is forty-one rows, which is
  // a page to scroll, not a place to get lost in. So the categories became headings and the features came out from
  // behind them. The rail still narrows this to one heading when you ask it to; that is a filter, not the only way in.
  for (const category of CATEGORIES) {
    const items = capabilitiesIn(category.id)
    if (!items.length) continue
    main.append(categorySection(category, items))
  }
}

/** One heading and the rows under it: a category, shown rather than linked to. */
function categorySection(category, items) {
  const block = el('section', 'cc-section')
  const head = el('div', 'cc-sec-head')
  head.append(icon(category.icon, 17), el('h3', 'cc-sec-title', category.label), el('p', 'cc-sec-blurb', category.blurb))
  block.append(head)
  const list = el('div', 'cc-list')
  for (const capability of items) list.append(capabilityRow(capability))
  block.append(list)
  return block
}

/**
 * What a category can say about itself, beyond listing what is in it.
 *
 * Each line is read from the system that owns it, through the channel that system already answers on. A category with
 * nothing to report shows nothing: there is no line of encouragement standing in for a fact.
 */
const CATEGORY_FACTS = {
  automation: async () => {
    const [list, status] = await Promise.all([
      call('workflows:list').catch(() => null),
      call('workflows:status').catch(() => null)
    ])
    const out = []
    if (list) out.push([`${list.length} workflow${list.length === 1 ? '' : 's'}`, list.length ? '' : 'None yet'])
    if (status) {
      const running = Array.isArray(status.active) ? status.active.length : 0
      out.push(['Running now', running ? String(running) : 'None'])
    }
    return out
  },
  workspace: async () => {
    const [tasks, spaces] = await Promise.all([
      call('tasks:list', [{ done: false }]).catch(() => null),
      call('workspaces:list').catch(() => null)
    ])
    const out = []
    if (tasks) out.push(['Still to do', String(tasks.length)])
    if (spaces) out.push(['Workspaces', String(spaces.length)])
    return out
  },
  research: async () => {
    const notes = await call('notes:list', [{}]).catch(() => null)
    return notes ? [['Notes', String(notes.length)]] : []
  },
  capture: async () => {
    const [shots, pages] = await Promise.all([
      call('library:screenshots').catch(() => null),
      call('library:saved-pages').catch(() => null)
    ])
    const out = []
    if (shots) out.push(['Screenshots', String(shots.length)])
    if (pages) out.push(['Saved pages', String(pages.length)])
    return out
  },
  protection: async () => {
    const out = []
    if (state.facts.adblock !== null) out.push(['Ad blocking', state.facts.adblock.on ? 'On' : 'Off'])
    if (state.facts.page) out.push(['This page', state.facts.page.title || state.facts.page.url])
    return out
  },
  browser: async () => {
    const tabs = await call('browser:tabs').catch(() => null)
    return tabs ? [['Open tabs', String(tabs.length)]] : []
  },
  ai: async () => [['Orion', !state.ready.helper ? 'Orbis is not running' : state.ready.key ? 'Ready' : 'Unavailable']]
}

/** One category, opened. */
function drawCategory(id) {
  const category = CATEGORIES.find((c) => c.id === id)
  const main = $('cc-main')
  main.replaceChildren()
  if (!category) { state.view = 'home'; return drawHome() }

  const back = el('button', 'cc-back'); back.type = 'button'
  back.append(icon('back', 16), el('span', '', 'Command Center'))
  back.addEventListener('click', () => show('home'))
  main.append(back)

  const head = el('header', 'cc-cat-head')
  head.append(el('h2', 'cc-title', category.label), el('p', 'cc-desc', category.blurb))
  main.append(head)

  // What this part of Orbis has to report, read from the systems that own it. Drawn when it answers, and not before.
  const facts = el('dl', 'cc-facts')
  main.append(facts)
  const report = CATEGORY_FACTS[category.id]
  if (report) {
    const asked = category.id
    void report().then((rows) => {
      if (state.view !== asked) return
      for (const [label, value] of rows) {
        if (!value) continue
        facts.append(el('dt', '', label), el('dd', '', value))
      }
    }, () => { /* the system did not answer; the category still lists what it holds */ })
  }

  const list = el('div', 'cc-list')
  for (const capability of capabilitiesIn(category.id)) list.append(capabilityRow(capability))
  main.append(list)
}

/**
 * Shows the Command Center's home, or one category. The rail calls this, and so does anything here that moves between
 * them, so the rail's mark and what is on screen can never disagree.
 */
export function show(view) {
  state.view = view
  state.query = ''
  const box = document.querySelector('.cc-search')
  if (box) box.value = ''
  rail?.pointAt(view)
  draw()
}

function draw() {
  if (state.query.trim()) {
    $('cc-main').hidden = true
    $('cc-results').hidden = false
    drawSearch()
    return
  }
  $('cc-results').hidden = true
  $('cc-main').hidden = false
  if (state.view === 'home') drawHome()
  else drawCategory(state.view)
}

// ---------------------------------------------------------------- the shell

/** The rail, so the Command Center can keep its mark in step. Set when the panel mounts both. */
let rail = null
export function useRail(it) { rail = it }

export function mountCommandCenter(root) {
  root.replaceChildren()
  root.classList.add('cc')

  const head = el('header', 'cc-head')
  const mark = el('img', 'cc-logo'); mark.src = 'orbis-ring.png'; mark.alt = ''; mark.width = 26; mark.height = 26
  head.append(mark, el('h1', 'cc-name', 'Command Center'))
  root.append(head)

  const find = el('div', 'cc-find')
  const input = el('input', 'cc-search')
  input.type = 'search'
  input.placeholder = 'Search features, settings and actions…'
  input.setAttribute('aria-label', 'Search everything Orbis can do')
  input.autocomplete = 'off'
  input.spellcheck = false
  input.addEventListener('input', () => { state.query = input.value; draw() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; state.query = ''; draw() }
    if (e.key === 'Enter') {
      const first = searchCapabilities(state.query, state.ready)[0]
      if (first && !unavailableBecause(first.capability, state.ready)) go(first.capability)
    }
  })
  find.append(input)
  root.append(find)


  const notice = el('p', 'cc-notice'); notice.id = 'cc-notice'; notice.setAttribute('role', 'status')
  root.append(notice)
  const results = el('div', 'cc-results'); results.id = 'cc-results'; results.hidden = true
  const main = el('div', 'cc-body'); main.id = 'cc-main'
  root.append(results, main)

  draw()

  // What Orbis can do is read once on opening, then the Overview is drawn again with what came back.
  void (async () => {
    await loadPins()
    await readReadiness()
    await readFacts()
    state.loading = false
    draw()
  })()

  return {
    /** Re-read on returning to the Command Center: what was true a minute ago may not be. */
    refresh: async () => {
      await loadPins()
      await readReadiness()
      await readFacts()
      draw()
    }
  }
}
