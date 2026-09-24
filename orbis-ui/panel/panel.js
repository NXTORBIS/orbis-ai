import { call, HelperDown } from './helper.js'

// The Orbis side panel. Everything it shows comes from the helper; this file only draws it and sends what is typed.
//
// Text is only ever put on the page as text, never as HTML, so nothing a model, a website or a search result says can
// run as code. A link is only made from an address that is really http or https — a `javascript:` address from a
// page's own data would otherwise be a way in.

const $ = (id) => document.getElementById(id)
const status = $('status')
const messages = $('messages')
const input = $('input')
const send = $('send')
const stop = $('stop')
const modelSelect = $('model')

const MODEL_KEY = 'orbis.model'
let controller = null
let connected = false

// ---------------------------------------------------------------- the chat being held, and the ones held before
//
// The messages on screen are the chat, and the chat is kept in the store the Orbis window itself reads (conversations:*),
// so one started here can be opened there and the other way round. `held` is that chat; there is no second copy of the
// messages to keep in step with it.

const EMPTY_TEXT = 'Ask Orion anything. Everything runs on this computer, with your own key.'
const newId = () => (typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`)

/** The same first-line rule the Orbis window titles a chat by, so a chat is called the same thing in both. */
function titleFrom(text) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return 'New chat'
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line
}

function blankChat() {
  const at = Date.now()
  return { id: newId(), title: '', model: '', messages: [], createdAt: at, updatedAt: at }
}

let held = blankChat()

/** Adds a message to the chat. What Orion is sent is these same messages, so the two can never disagree. */
function remember(role, content) {
  held.messages.push({ id: newId(), role, content, createdAt: Date.now() })
  held.updatedAt = Date.now()
  if (!held.title && role === 'user') held.title = titleFrom(content)
}

/** Keeps the chat. A chat that failed to save is still on screen, so this never interrupts to say so. */
async function keep() {
  if (!held.messages.length) return
  held.model = modelSelect.value || held.model
  try {
    await call('conversations:save', [held])
  } catch {
    // Nothing worth stopping the conversation over; the next exchange tries again.
  }
}

/** Draws the held chat from its messages, so opening an earlier one and carrying on look the same. */
function drawMessages() {
  messages.replaceChildren()
  if (!held.messages.length) {
    const empty = document.createElement('p')
    empty.id = 'empty'
    empty.className = 'empty'
    empty.textContent = EMPTY_TEXT
    messages.append(empty)
    return
  }
  for (const m of held.messages) {
    const el = add(m.role, '')
    // Sources are not kept with a chat, so a [1] in an older answer stays the text it was written as.
    if (m.role === 'assistant') renderAnswer(el, m.content, [])
    else el.textContent = m.content
  }
}

function startNew() {
  controller?.abort()
  held = blankChat()
  drawMessages()
  hideChats()
}

async function openChat(id) {
  controller?.abort()
  let found
  try {
    found = await call('conversations:get', [id])
  } catch {
    return note('That chat could not be opened.', true)
  }
  if (!found) return note('That chat is no longer here.', true)
  held = { ...found, messages: Array.isArray(found.messages) ? found.messages : [] }
  if (held.model) modelSelect.value = held.model
  drawMessages()
  hideChats()
}

function hideChats() {
  $('chats-list').hidden = true
  $('chats').setAttribute('aria-expanded', 'false')
}

/** The chats kept before this one: enough of each to recognise it, and nothing of what was said in it. */
async function showChats() {
  const box = $('chats-list')
  box.hidden = false
  $('chats').setAttribute('aria-expanded', 'true')
  const line = (text) => {
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = text
    return p
  }
  box.replaceChildren(line('Loading…'))
  let list
  try {
    list = await call('conversations:list')
  } catch (err) {
    return void box.replaceChildren(line(err instanceof HelperDown ? 'Start Orbis to see earlier chats.' : 'Earlier chats could not be read.'))
  }
  if (!Array.isArray(list) || !list.length) return void box.replaceChildren(line('No earlier chats yet.'))

  const rows = document.createElement('ul')
  rows.className = 'chats'
  for (const c of list) {
    const row = document.createElement('li')
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'chat-open'
    const title = document.createElement('b')
    title.textContent = c.title || 'New chat'
    const about = document.createElement('small')
    about.textContent = `${c.messages} message${c.messages === 1 ? '' : 's'} · ${new Date(c.updatedAt).toLocaleDateString()}`
    open.append(title, about)
    open.addEventListener('click', () => void openChat(c.id))
    const drop = document.createElement('button')
    drop.type = 'button'
    drop.className = 'chat-drop'
    drop.title = `Delete ${c.title || 'this chat'}`
    drop.setAttribute('aria-label', drop.title)
    drop.textContent = '×'
    drop.addEventListener('click', async () => {
      await call('conversations:remove', [c.id]).catch(() => undefined)
      // The one on screen was just deleted: it would otherwise be written back on the next reply.
      if (c.id === held.id) startNew()
      void showChats()
    })
    row.append(open, drop)
    rows.append(row)
  }
  box.replaceChildren(rows)
}

function setStatus(text, state) {
  status.textContent = text
  status.className = `status ${state ?? ''}`
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

// ---------------------------------------------------------------- Ask

function add(role, text = '') {
  $('empty')?.remove()
  const el = document.createElement('div')
  el.className = `msg ${role}`
  el.textContent = text
  messages.append(el)
  messages.scrollTop = messages.scrollHeight
  return el
}

function note(text, isError = false) {
  const el = document.createElement('div')
  el.className = `note${isError ? ' error' : ''}`
  el.textContent = text
  messages.append(el)
  messages.scrollTop = messages.scrollHeight
}

/** Writes an answer, turning [n] into a link to source n when there is such a source. Rebuilt on every update. */
function renderAnswer(el, text, sources) {
  const byNumber = new Map(sources.map((s) => [s.n, s]))
  const parts = text.split(/(\[\d{1,2}\])/g)
  const nodes = parts.map((part) => {
    const m = /^\[(\d{1,2})\]$/.exec(part)
    const source = m && byNumber.get(Number(m[1]))
    const href = source && safeUrl(source.url)
    if (!href) return document.createTextNode(part)
    const a = link(href, 'cite')
    a.textContent = part
    a.title = source.title
    return a
  })
  el.replaceChildren(...nodes)
}

function renderSources(sources) {
  const box = document.createElement('div')
  box.className = 'sources'
  const heading = document.createElement('h3')
  heading.textContent = 'Sources'
  box.append(heading)
  for (const s of sources) {
    const href = safeUrl(s.url)
    const row = document.createElement('div')
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = `[${s.n}]`
    row.append(n)
    if (href) {
      const a = link(href)
      a.textContent = s.title || s.domain
      row.append(a)
    } else {
      row.append(document.createTextNode(s.title || s.domain))
    }
    const dom = document.createElement('span')
    dom.className = 'dom'
    dom.textContent = ` — ${s.domain}${s.published ? `, ${s.published}` : ''}`
    row.append(dom)
    box.append(row)
  }
  messages.append(box)
  messages.scrollTop = messages.scrollHeight
}

async function connect() {
  try {
    const ping = await call('helper:ping')
    const list = await call('models:list')
    connected = true
    setStatus(ping.hasApiKey ? 'Connected' : 'Connected, but the helper has no Groq key', ping.hasApiKey ? 'ok' : 'down')
    if (!modelSelect.options.length) {
      for (const m of list.models) modelSelect.add(new Option(m.label, m.id))
      const saved = localStorage.getItem(MODEL_KEY)
      modelSelect.value = list.models.some((m) => m.id === saved) ? saved : list.default
    }
  } catch (err) {
    connected = false
    setStatus(err instanceof HelperDown ? err.message : 'Could not reach Orbis.', 'down')
  }
}

modelSelect.addEventListener('change', () => localStorage.setItem(MODEL_KEY, modelSelect.value))

$('new').addEventListener('click', startNew)
$('chats').addEventListener('click', () => {
  if (!$('chats-list').hidden) return hideChats()
  // The list belongs to the Ask view, and the button is in the header on every tab: go where it leads.
  showTab('ask')
  void showChats()
})

stop.addEventListener('click', () => controller?.abort())

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    $('composer').requestSubmit()
  }
})

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text || controller) return
  if (!connected) await connect()
  if (!connected) return note('Orbis is not running, so nothing was sent.', true)

  input.value = ''
  add('user', text)
  remember('user', text)
  const reply = add('assistant')
  reply.classList.add('working')
  let answer = ''
  let sources = []
  let searchStatus = null

  controller = new AbortController()
  send.hidden = true
  stop.hidden = false
  try {
    await call('chat:send', [{ model: modelSelect.value, webSearch: $('web').checked, messages: held.messages.slice(-30) }], {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'delta' && typeof event.content === 'string') {
          searchStatus?.remove()
          searchStatus = null
          answer += event.content
          renderAnswer(reply, answer, sources)
          messages.scrollTop = messages.scrollHeight
        } else if (event.type === 'research') {
          sources = event.research?.sources ?? []
        } else if (event.type === 'error') {
          note(event.message || 'Orion could not answer.', true)
        } else if (event.type === 'status') {
          // Searching-the-web progress is shown in one line that is replaced as it changes, then goes when the answer starts.
          if (!searchStatus) {
            searchStatus = document.createElement('div')
            searchStatus.className = 'note'
            messages.insertBefore(searchStatus, reply)
          }
          searchStatus.textContent = event.message
        }
      }
    })
    if (answer) remember('assistant', answer)
    else held.messages.pop()
  } catch (err) {
    if (controller?.signal.aborted) {
      // Stopped by the person: what was written stays, and the conversation continues from it.
      if (answer) remember('assistant', answer)
      else held.messages.pop()
    } else {
      held.messages.pop()
      note(err?.message || 'That did not work.', true)
    }
  } finally {
    searchStatus?.remove()
    reply.classList.remove('working')
    if (!answer) reply.remove()
    if (sources.length && answer) renderSources(sources)
    controller = null
    send.hidden = false
    stop.hidden = true
    input.focus()
    // Kept after the exchange rather than during it: an answer being written is not yet a thing worth keeping, and a
    // stopped one is — what was written stays, and the chat carries on from it.
    void keep()
  }
})

// ---------------------------------------------------------------- Search

const results = $('results')
let lastQuery = ''
let searching = null

/**
 * Every view has an address. chrome://orbis#galaxy opens Galaxy, chrome://orbis#workflows opens Workflows, and so on — so a
 * feature is a page you can open, link to, bookmark and land on directly, the way chrome://history and chrome://downloads are,
 * rather than something reachable only by clicking a tab inside one panel.
 */
const VIEWS = ['ask', 'search', 'block', 'notes', 'tasks', 'workflows', 'galaxy', 'secrets', 'account']

const viewFromAddress = () => {
  const wanted = (location.hash || '').replace(/^#\/?/, '').toLowerCase()
  return VIEWS.includes(wanted) ? wanted : null
}

function showTab(name) {
  // Every view in the panel, including the rail's own (Tabs, Clipboard, ...), so choosing a tab always hides whichever was in front.
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `view-${name}`
  for (const id of ['ask', 'search', 'block', 'notes', 'tasks', 'workflows', 'galaxy', 'secrets', 'account']) $(`tab-${id}`).setAttribute('aria-selected', String(id === name))
  // Keep the address in step with what is on screen, without adding a history entry
  // for every tab press: the address describes the page, it is not a trail through it.
  if (viewFromAddress() !== name) history.replaceState(null, '', `#${name}`)
  document.dispatchEvent(new CustomEvent('orbis:view', { detail: { name } }))
  if (name === 'block') document.dispatchEvent(new CustomEvent('orbis:blocking-shown'))
  else if (name === 'notes') document.dispatchEvent(new CustomEvent('orbis:notes-shown'))
  else if (name === 'tasks') document.dispatchEvent(new CustomEvent('orbis:tasks-shown'))
  else if (['workflows', 'galaxy', 'secrets'].includes(name)) document.dispatchEvent(new CustomEvent(`orbis:${name}-shown`))
  else if (name === 'search') $('query').focus()
  else input.focus()
}
$('tab-ask').addEventListener('click', () => showTab('ask'))
$('tab-account').addEventListener('click', () => {
  showTab('account')
  // Read afresh every time it is opened: an account can change in another window while this panel sits there.
  document.dispatchEvent(new CustomEvent('orbis:account-shown'))
})
$('tab-search').addEventListener('click', () => showTab('search'))
$('tab-block').addEventListener('click', () => showTab('block'))
$('tab-notes').addEventListener('click', () => showTab('notes'))
$('tab-tasks').addEventListener('click', () => showTab('tasks'))
$('tab-workflows').addEventListener('click', () => showTab('workflows'))
$('tab-galaxy').addEventListener('click', () => showTab('galaxy'))
$('tab-secrets').addEventListener('click', () => showTab('secrets'))

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

$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
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
$('ask-about').addEventListener('click', () => {
  if (!lastQuery) return
  $('web').checked = true
  showTab('ask')
  input.value = lastQuery
  $('composer').requestSubmit()
})

// Open on whatever the address names, so chrome://orbis#galaxy lands on Galaxy rather than on Ask and a click.
const opening = viewFromAddress()
if (opening) showTab(opening)
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
