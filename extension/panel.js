import { call, HelperDown } from './helper.js'

// The Orbis side panel. Everything it shows comes from the helper; this file only draws it and sends what is typed.
// Text is only ever put on the page as text (never as HTML), so nothing a model or a webpage says can run as code.

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

  controller = new AbortController()
  send.hidden = true
  stop.hidden = false
  try {
    await call('chat:send', [{ model: modelSelect.value, messages: history.slice(-30) }], {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'delta' && typeof event.content === 'string') {
          answer += event.content
          reply.textContent = answer
          messages.scrollTop = messages.scrollHeight
        } else if (event.type === 'error') {
          note(event.message || 'Orion could not answer.', true)
        } else if (event.type === 'status') {
          note(event.message)
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
    reply.classList.remove('working')
    if (!answer) reply.remove()
    controller = null
    send.hidden = false
    stop.hidden = true
    input.focus()
  }
})

connect()
// While the helper is not running, keep looking for it so the panel comes alive by itself when it starts.
setInterval(() => {
  if (!connected) void connect()
}, 4000)
