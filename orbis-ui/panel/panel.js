import { askBrowser, call, HelperDown } from './helper.js'
import { mountOmnibox } from './omnibox-ui.js'
import { mountCommandCenter } from './command-center.js'
import { hasView, showView } from './rail/index.js'
import { CAPABILITIES, PANEL_VIEWS, RAIL_VIEWS } from './command-registry.js'

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

/**
 * How Orbis is, kept rather than shown.
 *
 * There was a badge in the title bar for this -- Ready, No model, Stopped -- and it is gone. Nothing about how the
 * panel is getting on belongs on screen while somebody is trying to use it; the thing they touch says why it could
 * not be done, at the moment they touch it.
 *
 * The states themselves are kept, and so is this, because the panel is connected to from several places and each of
 * them says how it went. There is simply nowhere on screen for it to land any more.
 */
function setStatus(name) {
  const it = RUNTIME_STATES[name] ?? RUNTIME_STATES.unreachable
  if (!status) return
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
//
// This list is no longer written here. It is PANEL_VIEWS in the capability registry, because the copy that used to
// live on this line is what made eighteen rows of the Command Center dead clicks: the registry offered Tabs, Media,
// Clipboard and eleven more, this array had never heard of any of them, so `#tabs` was not recognised and the panel
// fell back to the Command Center. Clicking "Tabs" opened the screen you clicked it from. One list cannot disagree
// with itself.
const VIEWS = PANEL_VIEWS

/**
 * The view a name means, spelled the way the page spells it, or null for a name this page does not have.
 *
 * Two sets, not one. PANEL_VIEWS are the sections written into index.html; the rail's own views (Tabs, Tab groups,
 * Media, Controls, Saved pages, Screenshots, Reminders, Clipboard, Whiteboard, Research, Sources, Workspaces) are
 * built in JavaScript by rail/browser.js and rail/stores.js and added to the page as it loads. Both are addresses.
 *
 * Matched without case, and the page's own spelling is what comes back. The rail's names have capitals in them --
 * tabGroups, savedPages -- and an address somebody typed or a tab restored has whatever case it has, so comparing a
 * lowercased address against `tabGroups` would never match and #tabGroups would land on the Command Center again,
 * which is the whole bug this is here to end.
 */
const viewNamed = (raw) => {
  const name = String(raw || '').toLowerCase()
  if (!name) return null
  if (VIEWS.includes(name)) return name
  return RAIL_VIEWS.find((one) => one.toLowerCase() === name) ?? null
}

const viewFromAddress = () => {
  // The hash is how a person names a view; ?view= is how the browser does, when a toolbar button opens this page over
  // the tab and wants it already showing one thing. Either way it is the same set of names and the same landing.
  const hash = (location.hash || '').replace(/^#\/?/, '')
  return viewNamed(hash) ?? viewNamed(new URLSearchParams(location.search).get('view'))
}

// How the surface moves this page once it is up. Opening the Command Center a second time must not reload it -- that
// would throw away whatever was typed into it -- so the browser calls in instead of navigating.
window.orbisGoTo = (view) => {
  showTab(viewNamed(view) ?? 'home')
}

/**
 * Show one view.
 *
 * `landing` is true for the very first call, where the view is whatever the address already named. That one replaces
 * the address instead of pushing it: pushing would put an entry in front of the page's own arrival, so the first Back
 * would appear to do nothing.
 */
function showTab(name, landing = false) {
  /*
   * A rail view belongs to the rail.
   *
   * Its section is in this page like any other, but revealing it is only half the job: the view has to be told it is
   * on screen so it reads the browser or the store behind it and starts its polling, and that is what `showView` in
   * rail/ui.js does. Nothing in the panel ever called it. The rail's twelve views -- 900 working lines of Tabs, Tab
   * groups, Media, Controls and the seven that read a store -- were built, registered, and reachable by nothing,
   * while this very loop hid them again on every move. So the address goes to them now, and the address is still
   * written down afterwards, because a view you cannot link to or go Back from is not really a view.
   */
  if (!VIEWS.includes(name) && hasView(name)) {
    showView(name)
    markWhere(name)
    if (viewFromAddress() !== name) history[landing ? 'replaceState' : 'pushState'](null, '', `#${name}`)
    return
  }
  // Every view in the panel, including the rail's own (Tabs, Clipboard, ...), so choosing a tab always hides whichever was in front.
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `view-${name}`
  for (const id of VIEWS) $(`tab-${id}`)?.setAttribute('aria-selected', String(id === name))
  markWhere(name)
  // Keep the address in step with what is on screen, and leave a history entry so Back returns to the view you came
  // from. It used to `replaceState`, on the reasoning that the address describes the page rather than a trail through
  // it -- but the comment above promises a view is "a page you can open, link to, bookmark and land on directly", and
  // a page you cannot go Back from is not one of those. Back left the panel entirely instead.
  if (viewFromAddress() !== name) history[landing ? 'replaceState' : 'pushState'](null, '', `#${name}`)
  document.dispatchEvent(new CustomEvent('orbis:view', { detail: { name } }))
  if (name === 'block') document.dispatchEvent(new CustomEvent('orbis:blocking-shown'))
  else if (name === 'notes') document.dispatchEvent(new CustomEvent('orbis:notes-shown'))
  else if (name === 'tasks') document.dispatchEvent(new CustomEvent('orbis:tasks-shown'))
  else if (['workflows', 'galaxy', 'secrets', 'music'].includes(name)) document.dispatchEvent(new CustomEvent(`orbis:${name}-shown`))
  // Read afresh every time it is opened, however it was opened: the name can change
  // in the Orbis window while this panel sits here.
  else if (name === 'account') document.dispatchEvent(new CustomEvent('orbis:account-shown'))
  else if (name === 'home') {
    void commandCenter?.refresh()
    // The box is the way to everything here, so it starts with the keyboard. Not on a touch screen, where focusing an
    // input raises the on-screen keyboard over the thing somebody just opened.
    commandCenter?.focusSearch()
  }
  // Which page the question is about is read afresh every time this screen is opened: the tab in front can change
  // while the panel sits here, and the answer has to be about the page that is there now.
  else if (name === 'ask') askShown()
  else if (name === 'search') $('query').focus()
  // Nothing on the end of that chain. There used to be `else input.focus()`, and `input` is declared nowhere in this
  // file -- it was left behind when the chat box was taken out. Two views fall through to it, Pages you have read and
  // Schedules, and both threw a ReferenceError. Landing on chrome://orbis#recall threw it while the module was still
  // being read, so the lines after this one never ran: no hashchange listener, no `connect()`, a panel that never
  // reached Orbis at all. A dead `else` is worth more attention than a dead row.
}
/**
 * What a view is called, in the words the Command Center uses for it.
 *
 * Read from the registry rather than written down here, so a view cannot end up with one name in the list you chose it
 * from and another in the bar above it. A view nothing in the registry points at keeps its own name.
 */
const VIEW_NAMES = (() => {
  const names = {}
  for (const capability of CAPABILITIES) {
    const target = capability.target
    if ((target.kind === 'panel' || target.kind === 'view') && names[target.view] === undefined) {
      names[target.view] = capability.name
    }
  }
  return names
})()

const titleCase = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/**
 * Draws the top bar for the view that is showing.
 *
 * On the home there is no bar at all. A row saying "Orbis" over a side panel the browser has already labelled Orbis
 * is a row spent on nothing. Inside a view it carries the way back and the name of what you are looking at, which are
 * both things you cannot work out from the screen.
 */
function markWhere(name) {
  const bar = $('pan-bar')
  const back = $('pan-back')
  const where = $('pan-where')
  const home = name === 'home'
  if (back) back.hidden = home
  // Over a page this is a dialog, and a dialog with a close button needs a title beside it to say what is being
  // closed. In the side panel the browser's own chrome is that title, so there it stays empty.
  const surface = document.documentElement.classList.contains('surface')
  if (where) where.textContent = home ? (surface ? 'Orbis' : '') : (VIEW_NAMES[name] ?? titleCase(name))
  if (bar) bar.hidden = home && !surface
}

$('pan-back')?.addEventListener('click', () => showTab('home'))

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

// One navigation: the Command Center. There used to be a rail beside it saying the same eleven things, and the two
// had to be kept in step with each other for no gain -- at panel width the rail was eleven unlabelled icons anyway.
const commandCenter = mountCommandCenter($('view-home'))

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
      // Shift+Enter has already stopped this page navigating, so failing quietly here leaves the keystroke a dead end.
      // Only web addresses can be handed to another browser, so anything else was words: search for them here.
      $('query').value = target
      $('search-form').requestSubmit()
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

// ---------------------------------------------------------------- Ask Orion, about this page

/*
 * Orion, about the page in front of you.
 *
 * Three things in one screen -- ask a question about this page, get the short version of it, give Orbis something to
 * do on it -- because they are three uses of one request rather than three systems. Orbis already has the one place
 * that decides which of those a sentence is: `orb:ask` in the helper. It looks at the real tab through the Browser
 * Control Layer, hands a plain question to the router that does research, vision and chat, plans anything that has to
 * happen in the browser against the capabilities the browser says it really has right now, and reports each step only
 * once the browser has confirmed it. Writing a second router here is how two answers to the same question start to
 * differ, so there is not one.
 *
 * Where the page's own words come from matters, and they never come from here. The panel sends the question and
 * nothing else; the page is read inside Orbis by the `page.read` capability (src/helper/orb/perceive.ts, and
 * `currentPage` in src/helper/orion.ts) and put into the prompt as evidence. So a page cannot smuggle instructions
 * through this panel, and this panel cannot claim to have read a page it did not.
 *
 * Nothing here is drawn from hope. The page named along the top is the page the control layer just read. The steps are
 * the steps that happened. When Orbis is not running, has no model, or the tab is not something that can be read,
 * that is what it says -- not a spinner that never ends.
 */

/**
 * What this screen says when Orbis itself is not there, written here rather than taken from the error.
 *
 * `HelperDown` carries "Orbis is not running. Start it from run-orbis-chromium.bat." -- a launcher instruction with a
 * batch filename in it, meant for whoever is debugging the launcher. The Orb learned this the hard way: it was
 * printing that sentence into the panel as though the assistant had said it.
 */
const ASK_NO_ORBIS = 'Orbis is not running, so there is nothing to ask. This connects by itself once Orbis starts.'
const ASK_NO_MODEL = 'Orbis is running, but no model has been set up yet. Add one in the Orbis window and this works.'

/**
 * The marks a step can carry, and they are five different things: confirmed, happening, did not work, not reached
 * yet, and waiting for an answer. A spinner on all of them would say none of those.
 */
const ASK_MARKS = { done: '✓', running: '●', failed: '✕', planned: '○', waiting: '⏸' }

/** A node, built rather than written. innerHTML throws on these pages, and it should. */
const node = (tag, className, text) => {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text !== undefined) n.textContent = text
  return n
}

/** Everything this screen shows. Set in one place and drawn in one place; nothing is written straight into the page. */
const askState = {
  /** What was asked, kept above the answer: an answer with no question over it is just a paragraph. */
  request: '',
  /** 'idle' | 'working' | 'done' | 'error' | 'stopped' */
  phase: 'idle',
  status: '',
  steps: [],
  /** Which step's detail is open. One at a time: this is a panel, not a report. */
  openStep: null,
  answer: '',
  sources: [],
  image: null,
  confirmation: null,
  /** A question back, when only the person can settle something. Not a failure, so not kept with one. */
  needs: '',
  error: '',
  /** The page the control layer last read, as { url, title }. Null when there is none it can read. */
  page: null,
  /** Why there is no page, in the words shown. Empty while there is one. */
  pageWhy: 'Looking at the tab…'
}

let askRun = null
let askDraft = ''
/**
 * The paragraph the answer is being written into, while one is streaming.
 *
 * Kept so a word arriving does not rebuild the thread. Rebuilding on every delta would throw away the step whose
 * detail somebody has just opened, and -- because the thread is a live region -- would ask a screen reader to read
 * the whole conversation again twenty times a second. Growing the text of one paragraph is both the cheap thing and
 * the polite one.
 */
let askAnswerNode = null
/** What the box asks for. The three choices change it, because what to type is different for each of them. */
let askPlaceholder = 'Ask about this page…'

/** Everything about one request, cleared. Used before a new one, and by "Ask something else". */
function clearAskRun() {
  askState.request = ''
  askState.phase = 'idle'
  askState.status = ''
  askState.steps = []
  askState.openStep = null
  askState.answer = ''
  askState.sources = []
  askState.image = null
  askState.confirmation = null
  askState.needs = ''
  askState.error = ''
  askAnswerNode = null
}

/** A failure, in words for a person. The code is a diagnostic and the screen is not a log. */
function askProblem(err) {
  if (err instanceof HelperDown) return ASK_NO_ORBIS
  const code = err && typeof err === 'object' ? String(err.code ?? '') : ''
  if (code === 'no-key') return ASK_NO_MODEL
  if (code === 'no-browser') return 'The Orbis browser is not connected, so there is no page to act on.'
  // 404 from the helper arrives as this: the channel is not in this copy of Orbis at all.
  if (code === 'no-answer') return 'Orbis did not answer. It may still be starting.'
  const said = err && typeof err === 'object' && typeof err.message === 'string' ? err.message : ''
  return said || 'That did not work.'
}

/**
 * Which page this is about, read now rather than remembered.
 *
 * `orb:state` is the Orb's own answer to that question, so the panel and the Orb can never disagree about which tab is
 * in front. Behind it is one read of the `page.read` capability through the Browser Control Layer.
 *
 * Only a web page counts. A new tab, a settings page or one of Orbis's own pages is not something Orion can read, and
 * saying so beats naming it and then answering about nothing. A question that is not about the page still works, which
 * is why this is a note rather than a locked screen.
 */
async function readAskPage() {
  askState.page = null
  askState.pageWhy = 'Looking at the tab…'
  drawAsk()
  try {
    const now = await call('orb:state')
    const address = safeUrl(now?.page?.url)
    if (!now?.browser) askState.pageWhy = 'The Orbis browser is not connected, so there is no page to read.'
    else if (!address) askState.pageWhy = 'This tab is not a web page, so there is nothing on it to read. A question still works.'
    else {
      askState.page = { url: address, title: String(now.page.title ?? '') }
      askState.pageWhy = ''
    }
  } catch (err) {
    askState.pageWhy = askProblem(err)
  }
  drawAsk()
}

function drawAskAbout() {
  const host = $('ask-about')
  host.replaceChildren()
  host.append(node('span', 'ask-about-label', 'About'))
  if (!askState.page) {
    host.append(node('span', 'ask-about-why', askState.pageWhy))
    return
  }
  const title = node('span', 'ask-about-title', askState.page.title || askState.page.url)
  // The whole address on hover: the title is what a page calls itself, and that is not always where you are.
  title.title = askState.page.url
  host.append(title, node('span', 'ask-about-host', new URL(askState.page.url).hostname))
}

/** Puts the cursor where the rest of the request goes, and says what goes there. */
function askType(placeholder) {
  askPlaceholder = placeholder
  const box = $('ask-input')
  box.placeholder = placeholder
  box.focus()
}

/**
 * The three things this screen is for, offered as three choices rather than as a blank box.
 *
 * Only one of them is a complete request on its own, so only one of them runs: "Summarise this page" needs nothing
 * from anybody. The other two are a request with the sentence missing, so they put the cursor in the box and say what
 * belongs there. A button that claimed to start something it had not been told yet would be the dishonest option, and
 * the summarise button is disabled with the reason on it when there is no page to summarise.
 */
function askChoices() {
  const box = node('div', 'ask-choices')
  box.append(node('h2', 'ask-choices-head', 'Orion, about this page'))
  const havePage = Boolean(askState.page)
  const choices = [
    { name: 'Ask about this page', note: 'Type the question below.', chosen: () => askType('Ask about this page…') },
    {
      name: 'Summarise this page',
      note: havePage ? 'Starts now, from what the page says.' : askState.pageWhy,
      needsPage: true,
      chosen: () => void runAsk('Summarise this page')
    },
    {
      name: 'Do something on this page',
      note: 'Type what to do. Every step it takes is shown as it happens.',
      chosen: () => askType('What should Orbis do on this page?')
    }
  ]
  for (const choice of choices) {
    const button = node('button', 'ask-choice')
    button.type = 'button'
    button.append(node('span', 'ask-choice-name', choice.name), node('span', 'ask-choice-note', choice.note))
    if (choice.needsPage && !havePage) {
      button.disabled = true
      button.title = askState.pageWhy
    }
    button.addEventListener('click', choice.chosen)
    box.append(button)
  }
  return box
}

/**
 * What a step actually did, when somebody asks for it.
 *
 * The capability it used, what it was given, and how the browser confirmed it -- which is the reason to believe the
 * tick. Never the reasoning behind the plan: that is not a record of anything that happened.
 */
function askStepDetail(step) {
  const lines = []
  if (step.capability) lines.push(['Action', String(step.capability)])
  if (step.params && typeof step.params === 'object') {
    const shown = Object.entries(step.params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .slice(0, 4)
      .map(([name, value]) => `${name}: ${String(value).slice(0, 80)}`)
      .join('  ·  ')
    if (shown) lines.push(['With', shown])
  }
  const checked = step.result && step.result.verification
  if (checked && checked.detail) lines.push([checked.verified ? 'Confirmed' : 'Not confirmed', String(checked.detail)])
  const failed = step.failure || (step.result && step.result.error)
  if (failed && failed.message) lines.push(['Why not', String(failed.message)])
  if (step.tries > 1) lines.push(['Tries', String(step.tries)])
  return lines
}

/**
 * The steps, as the control loop reported them.
 *
 * A step reads `done` only once the browser confirmed it, so a tick here means the browser agrees -- nothing is marked
 * finished because a command was sent. Steps not reached yet are shown too, so somebody watching can see where they
 * are in something rather than only what just happened.
 */
function askSteps() {
  const run = node('section', 'ask-run')
  run.setAttribute('aria-label', 'What Orbis is doing')
  const finished = askState.steps.filter((step) => step.status === 'done').length
  run.append(node('p', 'ask-run-count', `${finished} of ${askState.steps.length} done`))
  const list = node('ol', 'ask-steps')
  for (const step of askState.steps) {
    const status = step.status || 'planned'
    const item = node('li', `ask-step ${status}`)
    const row = node('button', 'ask-step-row')
    row.type = 'button'
    row.append(node('span', 'ask-step-mark', ASK_MARKS[status] ?? '○'))
    row.append(node('span', 'ask-step-name', step.text || step.name || ''))
    const detail = askStepDetail(step)
    const open = askState.openStep === step.id
    if (detail.length) {
      row.append(node('span', 'ask-step-more', open ? '−' : '+'))
      row.setAttribute('aria-expanded', String(open))
    }
    row.addEventListener('click', () => {
      askState.openStep = open ? null : step.id
      drawAsk()
    })
    item.append(row)
    if (open && detail.length) {
      const box = node('div', 'ask-step-detail')
      for (const [label, value] of detail) {
        const line = node('div', 'ask-step-line')
        line.append(node('span', 'ask-step-label', label), node('span', 'ask-step-value', value))
        box.append(line)
      }
      item.append(box)
    }
    list.append(item)
  }
  run.append(list)
  return run
}

/** An approval. The action is waiting for this and nothing happens until it is answered. */
function askApproval(waiting) {
  const box = node('div', 'ask-approve')
  box.setAttribute('role', 'alertdialog')
  box.setAttribute('aria-label', 'Approve this action')
  box.append(node('div', 'ask-approve-head', 'Orbis wants to:'))
  box.append(node('p', 'ask-approve-what', String(waiting.action ?? '')))
  box.append(node('p', 'ask-approve-why', `${String(waiting.reason ?? '')} Nothing happens until you approve.`))
  const actions = node('div', 'ask-actions')
  const no = node('button', 'ask-btn', 'Cancel')
  no.type = 'button'
  const yes = node('button', 'ask-btn primary', 'Approve')
  yes.type = 'button'
  no.addEventListener('click', () => answerAsk(false))
  yes.addEventListener('click', () => answerAsk(true))
  actions.append(no, yes)
  box.append(actions)
  return box
}

/** The pages an answer was read from, when it was read from pages. Only a real web address becomes a link. */
function askSources() {
  const box = node('div', 'ask-sources')
  box.append(node('h3', '', 'Read from'))
  const list = node('ol', 'ask-source-list')
  for (const source of askState.sources) {
    const href = safeUrl(source?.url)
    const item = node('li')
    if (href) {
      const anchor = link(href)
      anchor.textContent = source.title || href
      item.append(anchor)
    } else {
      item.append(node('span', '', String(source?.title ?? 'A source with no address')))
    }
    list.append(item)
  }
  box.append(list)
  return box
}

function drawAskThread() {
  const host = $('ask-thread')
  host.replaceChildren()
  askAnswerNode = null

  if (!askState.request) {
    host.append(askChoices())
    return
  }

  host.append(node('p', 'ask-asked', askState.request))
  if (askState.phase === 'working' && askState.status) host.append(node('p', 'ask-status', askState.status))
  if (askState.steps.length) host.append(askSteps())
  if (askState.confirmation) host.append(askApproval(askState.confirmation))
  if (askState.sources.length) host.append(askSources())
  if (askState.image) {
    const figure = node('figure', 'ask-image')
    const picture = node('img')
    picture.src = askState.image.url
    picture.alt = askState.image.prompt || 'The picture Orbis made'
    figure.append(picture)
    if (askState.image.prompt) figure.append(node('figcaption', '', askState.image.prompt))
    host.append(figure)
  }
  if (askState.answer) {
    askAnswerNode = node('p', 'ask-answer', askState.answer)
    host.append(askAnswerNode)
  }
  // Something only the person can settle -- which of two things was meant, or a question back. Its own box, because
  // it is not a failure and a red one would read as the request having gone wrong.
  if (askState.needs) host.append(node('p', 'ask-needs', askState.needs))
  if (askState.error) host.append(node('p', 'ask-problem', askState.error))
  if (askState.phase === 'stopped') host.append(node('p', 'ask-status', 'Stopped. Nothing further was done.'))

  // The way back to the three choices. Without it, the first question hides them for the rest of the session, and
  // "Summarise this page" -- the one of the three that needs nothing typed -- would be reachable only by typing it.
  if (askState.phase !== 'working') {
    const again = node('button', 'ask-again', 'Ask something else')
    again.type = 'button'
    again.addEventListener('click', () => {
      clearAskRun()
      askPlaceholder = 'Ask about this page…'
      drawAsk()
      // The page may have changed while that answer was being read, so this is the moment to look again.
      void readAskPage()
    })
    host.append(again)
  }
}

function drawAsk() {
  // This page and its markup are two resources compiled into the browser, and a build that updated one and not the
  // other is a real state. Nothing is drawn rather than throwing halfway through the module and taking the rest of
  // the panel -- the address bar, the Command Center, the connection to Orbis -- down with it.
  if (!$('ask-thread') || !$('ask-about')) return
  const working = askState.phase === 'working'
  drawAskAbout()
  drawAskThread()
  $('ask-stop').hidden = !working
  $('ask-send').disabled = working || !askDraft.trim()
  $('ask-input').placeholder = working ? 'Orion is working. Stop it to ask something else.' : askPlaceholder
}

/**
 * Answers an approval, on whichever channel asked for it.
 *
 * A step the Orb's own loop is running answers on `orb:answer`; one the browser agent raised inside a task answers on
 * the agent's. The ids differ, and sending an answer to the wrong one leaves the action waiting for ever for an answer
 * that has already been given.
 */
function answerAsk(approved) {
  const waiting = askState.confirmation
  askState.confirmation = null
  drawAsk()
  if (!waiting) return
  const channel = String(waiting.id ?? '').startsWith('orb-') ? 'orb:answer' : 'browser:task-answer'
  // The run is streaming on its own request, so the answer travels on another. If this fails nothing was approved,
  // which is the safe way for an approval to fail.
  call(channel, [waiting.id, approved === true]).catch(() => {
    askState.error = 'Orbis could not be told your answer, so nothing was done.'
    askState.phase = 'error'
    drawAsk()
  })
}

/** Every event the run streams. The shapes are the Orb's, because it is the same loop answering. */
function onAskEvent(event) {
  const it = (event ?? {})
  if (it.type === 'status' && typeof it.message === 'string') {
    askState.status = it.message
  } else if (it.type === 'plan' && Array.isArray(it.steps)) {
    // The plan, before anything runs: what Orbis worked out it would have to do.
    askState.steps = it.steps.map((step) => ({ ...step, text: step.name, status: 'planned' }))
    askState.status = `${it.steps.length} step${it.steps.length === 1 ? '' : 's'} planned`
  } else if (it.type === 'step' && it.step) {
    const at = askState.steps.findIndex((step) => step.id === it.step.id)
    if (at >= 0) askState.steps[at] = it.step
    else askState.steps.push(it.step)
  } else if (it.type === 'confirm' && it.confirmation) {
    askState.confirmation = it.confirmation
    askState.status = 'Waiting for your approval'
  } else if (it.type === 'confirm-done') {
    askState.confirmation = null
  } else if (it.type === 'delta' && typeof it.content === 'string') {
    askState.answer += it.content
    // The paragraph already on the page grows, and nothing else is touched. Only the first word of an answer needs
    // the thread redrawn, because that is the one that has to create the paragraph.
    if (askAnswerNode && askAnswerNode.isConnected) {
      askAnswerNode.textContent = askState.answer
      return
    }
  } else if (it.type === 'answer' && typeof it.text === 'string') {
    askState.answer = it.text
  } else if (it.type === 'research' && it.research) {
    askState.sources = Array.isArray(it.research.sources) ? it.research.sources.slice(0, 6) : []
  } else if (it.type === 'image' && it.url) {
    askState.image = { url: it.url, prompt: it.prompt || '' }
  } else if (it.type === 'context' && it.because) {
    askState.status = `Using ${it.because}`
  } else if (it.type === 'refused-step' && it.why) {
    // Something Orbis cannot do, said out loud rather than quietly left out of the plan.
    askState.steps.push({ id: `x${askState.steps.length}`, text: `${it.name}: ${it.why}`, status: 'failed' })
  } else if (it.type === 'refused' && it.why) {
    askState.error = it.why
    askState.phase = 'error'
  } else if (it.type === 'recovery') {
    const said = { retry: 'trying again', 're-perceive': 'looking again', 're-plan': 'finding another way', 'ask-user': 'needs you', 'give-up': 'cannot go on' }[it.decision] ?? it.decision
    askState.status = `${it.step}: ${said}`
  } else if (it.type === 'ask-user' && it.question) {
    // Something only the person can settle -- which of two things "it" meant. The request stops here and the question
    // is what is shown; the box below is where the answer goes, as another request.
    askState.needs = it.question
    askState.phase = 'done'
  } else if (it.type === 'outcome') {
    // What really happened, verified or not. Never a cheerful ending over a failed step.
    if (typeof it.text === 'string' && it.text && !askState.answer) askState.answer = it.text
    askState.phase = it.status === 'done' ? 'done' : 'error'
    if (it.status !== 'done' && typeof it.text === 'string') askState.error = it.text
  } else if (it.type === 'error') {
    askState.error = it.message || 'Orbis could not do that.'
    askState.phase = 'error'
  } else {
    return
  }
  drawAsk()
}

/**
 * Sends the request, and shows what comes back as it comes back.
 *
 * One channel: `orb:ask`. A question goes to the router that already does research, vision and plain chat; a task goes
 * through the Browser Control Layer with each step confirmed. Which of those it is, is Orbis's decision and not this
 * screen's.
 */
async function runAsk(text) {
  const request = String(text ?? '').trim()
  if (!request || askRun) return
  clearAskRun()
  askState.request = request
  askState.phase = 'working'
  askState.status = 'Looking at the browser…'
  askRun = new AbortController()
  const mine = askRun
  drawAsk()
  try {
    await call('orb:ask', [request], { signal: mine.signal, onEvent: onAskEvent })
    if (askState.phase === 'working') askState.phase = askState.answer || askState.steps.length ? 'done' : 'error'
    // A run that ends having said nothing at all is a failure, and saying nothing about it would be the worst of both.
    if (askState.phase === 'error' && !askState.error && !askState.answer) {
      askState.error = 'Orbis did nothing and said nothing. Nothing was changed.'
    }
  } catch (err) {
    if (mine.signal.aborted) {
      askState.phase = 'stopped'
      askState.status = ''
    } else {
      askState.phase = 'error'
      askState.error = askProblem(err)
    }
  } finally {
    if (askRun === mine) askRun = null
    askState.status = ''
    drawAsk()
  }
}

// Behind one guard, for the same reason `drawAsk` has one: a missing element here would throw while the module is
// still being read, and everything after it in this file would never run.
if ($('view-ask') && $('ask-form')) {
  $('ask-input').addEventListener('input', (event) => {
    askDraft = event.target.value
    $('ask-send').disabled = askState.phase === 'working' || !askDraft.trim()
  })

  $('ask-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      $('ask-form').requestSubmit()
    } else if (event.key === 'Escape') {
      // Escape leaves this screen for the Command Center. Stopped here so it does not also close the surface the
      // Command Center may be drawn on -- leaving by one key press at a time is the predictable version.
      event.preventDefault()
      event.stopPropagation()
      showTab('home')
    }
  })

  $('view-ask').addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    showTab('home')
  })

  $('ask-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const text = askDraft.trim()
    if (!text) return
    askDraft = ''
    $('ask-input').value = ''
    void runAsk(text)
  })

  $('ask-stop').addEventListener('click', () => {
    askRun?.abort()
    // Ending the stream on its own would leave the browser halfway through a task, so the task is told to stop too.
    void call('browser:task-stop').catch(() => {
      // Nothing was running in the browser, or this Orbis has no browser to stop. Either way nothing to say.
    })
  })
}

/**
 * The screen was opened. Which page it is about is read every time, because the tab in front can change while the
 * panel sits here, and an answer about the page you were looking at a minute ago is worse than no answer.
 */
function askShown() {
  void readAskPage()
  $('ask-input')?.focus()
}

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
