// The Orbis panel's home.
//
// ## What this is, and what it replaced
//
// It has no name on screen. It used to call itself the Command Center, above a title bar that already said Orbis, and
// a badge reporting whether Orbis was running -- rows of a 360px panel spent describing the panel. All of that is
// gone. What is left is the one question anybody opens this to answer: what do you want to do?
//
// The shape before this was a list. Eleven headings, fifty-four rows, each a name over a line of explanation, in a
// column narrow enough that four of them filled the screen. Then it was eleven cards, which was tidier and still a
// menu of menus. This is neither: it is a drawer. Everything Orbis can do is here, as icons under short headings,
// four across, the way a phone shows its apps -- so the whole of it is a scroll rather than a hunt through folders,
// and a glance tells you where something is instead of a tap telling you it was somewhere else.
//
//   - **Type and it filters.** The box has the keyboard the moment the panel opens, and the arrow keys and Enter work
//     in it. That is the fastest way in, and everything below it is for when you would rather look than type.
//   - **What is in front of you comes first.** With a real page open, the three things anybody wants with a page are
//     the first thing under the box.
//   - **Nothing reports how it is going.** No "Ready", no "Stopped", no row of lights. If something cannot be done,
//     the thing you touched says why, at the moment you touch it. A panel that reports its own health every second of
//     the day is a panel spending its space on itself.
//
// Nothing was dropped on the way: every capability in the registry is drawn, under its category, and found by the
// search. Nothing here is a route somebody wired by hand either -- it is all read from the capability registry
// (src/shared/commandCenter.ts), so a new Orbis feature appears by being registered.
//
// And nothing here is invented. A capability is dimmed only when the thing behind it really is not there, and the
// reason shown is the reason that was read, never a guess.

import { CATEGORIES, CAPABILITIES, LANES, MAX_PINS, addPin, addressFor, capabilitiesIn, capabilityById, movePin, normalizePins, removePin, searchCapabilities, unavailableBecause } from './command-registry.js'
import { icon } from './rail/icons.js'
import { call, askBrowser } from './helper.js'

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }

/** Everything the drawer draws from. Nothing in here is assumed; each field is filled by something that answered. */
const state = {
  query: '',
  /** Which search result the arrow keys are on. -1 is none. */
  at: -1,
  /** What Orbis can do right now. Everything false until something says otherwise. */
  ready: { browser: false, helper: false, key: false, page: false },
  /** The page in front, when there is one Orbis can act on. */
  page: null,
  pins: [],
  /** True while the first read is in flight, so nothing is dimmed before it has asked. */
  loading: true,
  /**
   * Which lanes are open. Only the first at the start.
   *
   * Eleven headings all open at once is what made this panel one endless scroll: roughly 1,800px, still cut off
   * at the ninth heading, so anything below "Browser" had to be hunted for. Remembered for the session but not
   * written to disk -- which lane somebody left open ten minutes ago is not a preference, and restoring five open
   * lanes on a fresh start would put the scroll straight back.
   */
  open: new Set(['page'])
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
    state.page = null
    return
  }
  // A real page to act on, as opposed to a new tab or one of Orbis's own pages.
  try {
    const page = await call('browser:do', ['page-read', { maxChars: 1 }])
    const url = String(page?.url ?? '')
    state.ready.page = /^https?:/.test(url)
    state.page = state.ready.page ? { url, title: String(page.title ?? '') } : null
  } catch {
    state.ready.page = false
    state.page = null
  }
}

// ---------------------------------------------------------------- pins
//
// The toolbar is the browser's. What is kept here is the order and the choice; the buttons themselves are real Chromium
// actions (chrome/browser/ui/browser_actions.cc), which is why only capabilities with one can be pinned at all.

/**
 * What is pinned, asked of the browser rather than remembered here.
 *
 * The toolbar is the truth. Keeping a list of our own and showing that is how this ends up promising a button that is
 * not there -- after a reset, another profile, or a pin the browser refused.
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

// ---------------------------------------------------------------- saying things

let noticeTimer = 0
/**
 * One line, under the box, for as long as it is worth reading.
 *
 * This is the only place the panel ever says anything about itself, and it only says it because somebody just did
 * something. There is no standing report.
 */
function say(message) {
  const notice = $('cc-notice')
  if (!notice) return
  notice.textContent = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.textContent = '' }, 6000)
}

// ---------------------------------------------------------------- going places

/**
 * What choosing a capability does.
 *
 * A panel view stays here. A page is opened by the browser. A `do` capability is the browser performing something, and
 * the only thing said afterwards is what the browser actually reported: if the handler refuses -- no page, no address,
 * policy -- the refusal is what appears, not a confirmation.
 */
function go(capability) {
  const why = state.loading ? null : unavailableBecause(capability, state.ready)
  // Dimmed, not removed, and touching it says why. That sentence is the whole of what this panel reports about
  // itself, and it arrives when somebody asked for it rather than sitting on screen all day.
  if (why) return say(`${capability.name}: ${why}`)

  /*
   * A panel view and a rail view are both views of this very page, so both are reached by putting the name in the
   * address and letting the panel's own routing do the rest.
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
    say(`${capability.name} is in the Orbis window, not the browser.`)
    return
  }
  if (capability.target.kind === 'do') return perform(capability)
  if (capability.target.kind === 'ask') return askOrbis(capability)
  const address = addressFor(capability)
  askBrowser('orbis.open', address).catch(() => { location.href = address })
}

/**
 * Something Orbis does, asked of Orbis.
 *
 * What is said afterwards comes from what actually happened -- how many tabs locked, or the reason it could not --
 * rather than from having sent the request. A message that appears whether or not the work happened is the kind of
 * thing that makes somebody believe a tab is locked when it is not.
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

// ---------------------------------------------------------------- the drawer

/**
 * One capability, as a tile: the icon, and its name under it.
 *
 * No line of explanation. Fifty-four explanations is what made the old screen a wall, and the names were doing the
 * work anyway -- "Tabs", "Downloads", "Lock this tab". What a thing is stays in its tooltip, and the search still
 * reads it, so nothing was lost but the clutter.
 */
function tile(capability) {
  const why = state.loading ? null : unavailableBecause(capability, state.ready)
  const cell = el('div', `cc-cell${why ? ' off' : ''}`)

  const b = el('button', 'cc-tile')
  b.type = 'button'
  const art = el('span', 'cc-tile-art')
  art.append(icon(capability.icon, 20))
  b.append(art, el('span', 'cc-tile-name', capability.name))
  b.title = why ? `${capability.name} — ${why}` : `${capability.name} — ${capability.description}`
  b.setAttribute('aria-label', why ? `${capability.name}. ${why}` : capability.name)
  b.addEventListener('click', () => go(capability))
  cell.append(b)

  if (capability.pinnable) {
    const pinned = state.pins.includes(capability.id)
    const p = el('button', `cc-pin${pinned ? ' on' : ''}`)
    p.type = 'button'
    p.append(icon('pin', 13))
    p.title = pinned ? `Unpin ${capability.name} from the toolbar` : `Pin ${capability.name} to the toolbar`
    p.setAttribute('aria-pressed', String(pinned))
    p.setAttribute('aria-label', p.title)
    p.addEventListener('click', (e) => { e.stopPropagation(); return pinned ? unpin(capability.id) : pin(capability.id) })
    cell.append(p)
  }
  return cell
}

/**
 * The page in front of you, and the three things anybody would want with it.
 *
 * Drawn only when there really is a page Orbis can act on. A card saying "no page here" would be the standing report
 * this panel does not have.
 */
function pageRow() {
  if (!state.page) return null
  const card = el('section', 'cc-page')
  const title = el('p', 'cc-page-title', state.page.title || state.page.url)
  title.title = state.page.url
  card.append(title)

  const row = el('div', 'cc-page-acts')
  for (const id of ['ask', 'orbSummarise', 'copyLink']) {
    const capability = capabilityById(id)
    if (!capability) continue
    const b = el('button', 'cc-act')
    b.type = 'button'
    b.append(icon(capability.icon, 15), el('span', '', capability.name))
    b.title = capability.description
    b.addEventListener('click', () => go(capability))
    row.append(b)
  }
  card.append(row)
  return card
}

/** What is pinned to the toolbar, in the order the toolbar has. */
function pinRow() {
  if (!state.pins.length) return null
  const block = el('section', 'cc-group')
  block.append(el('h2', 'cc-h', 'On the toolbar'))
  const row = el('div', 'cc-pins')
  state.pins.forEach((id, at) => {
    const capability = capabilityById(id)
    if (!capability) return
    const chip = el('div', 'cc-chip')
    const open = el('button', 'cc-chip-open'); open.type = 'button'
    open.append(icon(capability.icon, 15), el('span', '', capability.name))
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
  block.append(row)
  block.append(el('p', 'cc-quiet', `Beside the address bar. ${state.pins.length} of ${MAX_PINS}.`))
  return block
}

/** Everything, as a drawer: short headings, and the things under them. */
/**
 * One lane: a row you can press, and its contents when it is open.
 *
 * The row is the whole control -- not a chevron you have to hit -- and it says three things without being opened:
 * what the lane is, what sort of thing is in it, and how many of them. The count is drawn from the registry at
 * the moment of drawing, so it cannot drift from what is inside.
 */
function lane(one) {
  const items = CAPABILITIES.filter((c) => c.lane === one.id)
  if (!items.length) return null

  const section = el('section', `cc-lane${state.open.has(one.id) ? ' open' : ''}`)
  const head = el('button', 'cc-lane-row')
  head.type = 'button'
  head.setAttribute('aria-expanded', String(state.open.has(one.id)))
  head.setAttribute('aria-controls', `cc-lane-${one.id}`)

  const art = el('span', 'cc-lane-art')
  art.append(icon(one.icon, 16))
  const words = el('span', 'cc-lane-words')
  words.append(el('span', 'cc-lane-name', one.label), el('span', 'cc-lane-hint', one.hint))
  const count = el('span', 'cc-lane-count', String(items.length))
  const chev = el('span', 'cc-lane-chev')
  chev.append(icon('chevronDown', 14))
  head.append(art, words, count, chev)
  head.addEventListener('click', () => {
    if (state.open.has(one.id)) state.open.delete(one.id)
    else state.open.add(one.id)
    drawDrawer()
  })
  section.append(head)

  const body = el('div', 'cc-lane-body')
  body.id = `cc-lane-${one.id}`
  if (!state.open.has(one.id)) body.hidden = true

  /*
   * The categories become the sub-headings inside an open lane.
   *
   * One taxonomy in the registry and one view of it here, rather than two competing copies. A heading is only
   * drawn when the lane holds more than one category -- a single heading over the whole of a lane repeats the
   * lane's own name and costs a row.
   */
  const groups = CATEGORIES.map((category) => [category, items.filter((c) => c.category === category.id)]).filter(([, list]) => list.length)
  for (const [category, list] of groups) {
    if (groups.length > 1) {
      const h = el('h3', 'cc-sub', category.label)
      h.title = category.blurb
      body.append(h)
    }
    const grid = el('div', 'cc-grid')
    for (const capability of list) grid.append(tile(capability))
    body.append(grid)
  }
  section.append(body)
  return section
}

function drawDrawer() {
  const main = $('cc-main')
  main.replaceChildren()

  const page = pageRow()
  if (page) main.append(page)
  const pins = pinRow()
  if (pins) main.append(pins)

  for (const one of LANES) {
    const section = lane(one)
    if (section) main.append(section)
  }
}

// ---------------------------------------------------------------- searching

/** What the arrow keys are moving over. Kept so Enter opens the row that is marked, not whatever was first. */
let hits = []

function resultRow(capability, marked) {
  const why = state.loading ? null : unavailableBecause(capability, state.ready)
  const row = el('div', `cc-item${why ? ' off' : ''}${marked ? ' at' : ''}`)
  const open = el('button', 'cc-open')
  open.type = 'button'
  const art = el('span', 'cc-row-art')
  art.append(icon(capability.icon, 17))
  const words = el('span', 'cc-words')
  words.append(el('strong', '', capability.name), el('span', 'cc-desc', why ?? capability.description))
  open.append(art, words)
  open.title = why ?? capability.description
  open.addEventListener('click', () => go(capability))
  row.append(open)
  return row
}

function drawSearch() {
  const box = $('cc-results')
  box.replaceChildren()
  hits = searchCapabilities(state.query, state.ready)
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
          box.replaceChildren(el('p', 'cc-quiet', 'Orion suggests:'), resultRow(found, false))
        } catch {
          said.textContent = 'Orion could not answer.'
          ask.disabled = false
        }
      })
      box.append(ask, said)
    }
    return
  }
  hits.forEach((hit, index) => box.append(resultRow(hit.capability, index === state.at)))
}

/** Moves the mark through the results and keeps it on screen. */
function move(delta) {
  if (!hits.length) return
  state.at = state.at < 0 ? (delta > 0 ? 0 : hits.length - 1) : (state.at + delta + hits.length) % hits.length
  drawSearch()
  $('cc-results')?.querySelector('.at')?.scrollIntoView({ block: 'nearest' })
}

/** Opens whatever the arrow keys are on, or the first result when they have not been used. */
function openMarked() {
  const hit = hits[state.at >= 0 ? state.at : 0]
  if (hit) go(hit.capability)
}

// ---------------------------------------------------------------- the shell

/** Clears the search and shows the drawer. The panel's routing calls this when it lands here. */
export function show() {
  state.query = ''
  state.at = -1
  const box = document.querySelector('.cc-search')
  if (box) box.value = ''
  draw()
}

function draw() {
  const searching = state.query.trim().length > 0
  $('cc-main').hidden = searching
  $('cc-results').hidden = !searching
  if (searching) drawSearch()
  else drawDrawer()
}

export function mountCommandCenter(root) {
  root.replaceChildren()
  root.classList.add('cc')

  // No title of its own. The bar above already says Orbis, and a panel that announces itself twice is a panel with
  // one row less for what it is actually for.
  const find = el('div', 'cc-find')
  const field = el('div', 'cc-field')
  field.append(icon('search', 16))
  const input = el('input', 'cc-search')
  input.type = 'search'
  input.placeholder = 'What do you need?'
  input.setAttribute('aria-label', 'Search everything Orbis can do')
  input.autocomplete = 'off'
  input.spellcheck = false
  input.addEventListener('input', () => { state.query = input.value; state.at = -1; draw() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation()
      input.value = ''
      state.query = ''
      state.at = -1
      draw()
      return
    }
    if (!state.query.trim()) return
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); openMarked() }
  })
  field.append(input)
  find.append(field)
  root.append(find)

  const notice = el('p', 'cc-notice'); notice.id = 'cc-notice'; notice.setAttribute('role', 'status')
  root.append(notice)
  const results = el('div', 'cc-results'); results.id = 'cc-results'; results.hidden = true
  const main = el('div', 'cc-body'); main.id = 'cc-main'
  root.append(results, main)

  draw()

  // What Orbis can do is read once on opening, then the drawer is drawn again with what came back.
  void (async () => {
    await loadPins()
    await readReadiness()
    state.loading = false
    draw()
  })()

  return {
    /** Re-read on returning here: what was true a minute ago may not be. */
    refresh: async () => {
      await loadPins()
      await readReadiness()
      draw()
    },
    /** The panel hands the keyboard here when this comes to the front. */
    focusSearch: () => {
      const box = root.querySelector('.cc-search')
      if (box && !matchMedia('(pointer: coarse)').matches) box.focus()
    }
  }
}
