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
let history = []
let controller = null
let connected = false

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

$('new').addEventListener('click', () => {
  controller?.abort()
  history = []
  messages.replaceChildren()
  const empty = document.createElement('p')
  empty.id = 'empty'
  empty.className = 'empty'
  empty.textContent = 'Ask Orion anything. Everything runs on this computer, with your own key.'
  messages.append(empty)
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
  history.push({ role: 'user', content: text })
  const reply = add('assistant')
  reply.classList.add('working')
  let answer = ''
  let sources = []
  let searchStatus = null

  controller = new AbortController()
  send.hidden = true
  stop.hidden = false
  try {
    await call('chat:send', [{ model: modelSelect.value, webSearch: $('web').checked, messages: history.slice(-30) }], {
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
    if (answer) history.push({ role: 'assistant', content: answer })
    else history.pop()
  } catch (err) {
    if (controller?.signal.aborted) {
      // Stopped by the person: what was written stays, and the conversation continues from it.
      if (answer) history.push({ role: 'assistant', content: answer })
      else history.pop()
    } else {
      history.pop()
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
  }
})

// ---------------------------------------------------------------- Search

const results = $('results')
let lastQuery = ''
let searching = null

function showTab(name) {
  for (const id of ['ask', 'search', 'block', 'notes', 'tasks']) {
    $(`view-${id}`).hidden = id !== name
    $(`tab-${id}`).setAttribute('aria-selected', String(id === name))
  }
  if (name === 'block') document.dispatchEvent(new CustomEvent('orbis:blocking-shown'))
  else if (name === 'notes') document.dispatchEvent(new CustomEvent('orbis:notes-shown'))
  else if (name === 'tasks') document.dispatchEvent(new CustomEvent('orbis:tasks-shown'))
  else if (name === 'search') $('query').focus()
  else input.focus()
}
$('tab-ask').addEventListener('click', () => showTab('ask'))
$('tab-search').addEventListener('click', () => showTab('search'))
$('tab-block').addEventListener('click', () => showTab('block'))
$('tab-notes').addEventListener('click', () => showTab('notes'))
$('tab-tasks').addEventListener('click', () => showTab('tasks'))

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

connect()
// While the helper is not running, keep looking for it so the panel comes alive by itself when it starts.
setInterval(() => {
  if (!connected) void connect()
}, 4000)
