import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * The Ask Orion screen, run.
 *
 * `orbis-ui/panel/panel.js` is compiled into the browser as a resource. Nothing type-checks it and nothing bundles it,
 * so until now the only check on it was that it parses -- and parsing is not the problem these pages have. The problem
 * they have is a screen that draws, looks finished, and is quietly lying: a button that does nothing, a spinner that
 * never ends, a "done" over a step that failed, or an internal diagnostic printed where a sentence for a person should
 * be. None of those is a syntax error.
 *
 * So the view's own code is lifted out of panel.js and run here against a stand-in for the page. There is no browser,
 * which means this says nothing about how any of it looks. What it does say is that every branch executes, and that
 * the words somebody would actually read are the right ones -- including the three that matter most: Orbis is not
 * running, there is no model, and this tab cannot be read.
 *
 * It is anchored on code rather than on comments. If somebody takes `ASK_NO_ORBIS` or `viewFromAddress` out of
 * panel.js, this fails loudly saying it could not find the screen, which is better than passing on nothing.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** The part of panel.js that is this screen, and nothing else of it. */
async function askSource() {
  const source = await readFile(join(HERE, 'panel.js'), 'utf8')
  const from = source.indexOf('const ASK_NO_ORBIS')
  const to = source.indexOf('const opening = viewFromAddress()')
  assert.ok(from > 0 && to > from, 'the Ask screen could not be found in panel.js (look for ASK_NO_ORBIS)')
  return source.slice(from, to)
}

// ---------------------------------------------------------------- the stand-in page

/** Enough of an element for drawing code to build a tree and for a test to read it back. */
class Thing {
  constructor(tag) {
    this.tag = tag
    this.className = ''
    this.children = []
    this.attributes = {}
    this.listeners = {}
    this.own = ''
    this.isConnected = true
    this.disabled = false
    this.hidden = false
    this.style = {}
  }

  set textContent(value) {
    this.own = String(value)
    this.children = []
  }

  get textContent() {
    return this.own || this.children.map((kid) => kid.textContent).join(' ')
  }

  append(...kids) {
    this.children.push(...kids)
  }

  replaceChildren(...kids) {
    this.children = [...kids]
    this.own = ''
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  addEventListener(name, fn) {
    ;(this.listeners[name] ??= []).push(fn)
  }

  fire(name, event = {}) {
    for (const fn of this.listeners[name] ?? []) fn({ preventDefault() {}, stopPropagation() {}, ...event })
  }

  focus() {
    this.focused = true
  }

  /** What the browser does when Enter is pressed in a box inside a form. */
  requestSubmit() {
    this.fire('submit')
  }

  /** Every word drawn, here and below, so a test can ask what a person would read. */
  words() {
    return [this.own, ...this.children.map((kid) => kid.words())].filter(Boolean).join(' | ')
  }

  /** Every class used, here and below. */
  classes(into = new Set()) {
    for (const name of String(this.className).split(/\s+/)) if (name) into.add(name)
    for (const kid of this.children) kid.classes(into)
    return into
  }

  /** Every button, here and below, in the order they were drawn. */
  buttons(into = []) {
    if (this.tag === 'button') into.push(this)
    for (const kid of this.children) kid.buttons(into)
    return into
  }
}

/**
 * The screen, loaded with a page in front of it.
 *
 * `answers` decides what each channel says, so a test can set up Orbis running, Orbis stopped, no model, or a tab that
 * is not a web page -- and `asked` records every call, which is how the approval tests check that an answer went to
 * the channel that asked for it rather than to the other one.
 */
async function screen({ answers = {}, stream = [] } = {}) {
  const block = await askSource()
  const made = new Map()
  for (const id of ['ask-about', 'ask-thread', 'ask-stop', 'ask-send', 'ask-input', 'ask-form', 'view-ask']) made.set(id, new Thing('div'))
  made.get('ask-input').value = ''
  made.get('ask-input').placeholder = ''

  const asked = []
  class HelperDown extends Error {}
  const state = { stream, answers }

  const call = async (channel, args = [], options = {}) => {
    asked.push({ channel, args })
    const reply = state.answers[channel]
    if (reply instanceof Error || (reply && reply.code)) throw reply
    if (channel === 'orb:ask') {
      for (const event of state.stream) options.onEvent?.(event)
      return { answer: '' }
    }
    return typeof reply === 'function' ? reply() : (reply ?? {})
  }

  const document = { createElement: (tag) => new Thing(tag), getElementById: (id) => made.get(id) ?? null }
  const $ = (id) => made.get(id) ?? null
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value))
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
    } catch {
      return null
    }
  }
  const link = (href) => {
    const anchor = new Thing('a')
    anchor.href = href
    return anchor
  }
  const went = []
  const showTab = (name) => void went.push(name)

  const context = { document, HelperDown, call, $, safeUrl, link, showTab, URL, AbortController, Object, String, Boolean, Array, Promise, console, setTimeout }
  const api = vm.runInNewContext(`${block}\n;({ runAsk, drawAsk, askShown, readAskPage, clearAskRun, askState })`, context, { filename: 'panel.js (Ask)' })
  return { api, state, asked, went, HelperDown, about: made.get('ask-about'), thread: made.get('ask-thread'), stop: made.get('ask-stop'), send: made.get('ask-send'), input: made.get('ask-input') }
}

/** A page in front of the person, as orb:state reports one. */
const ON_A_PAGE = { 'orb:state': { browser: true, page: { url: 'https://example.com/a', title: 'A page' } } }

/**
 * What was asked of Orbis, as plain strings.
 *
 * Strings rather than the objects themselves, because the arguments were built inside the sandbox the screen runs in
 * and so carry its own Array and Object. A deep comparison against ordinary ones fails on that alone -- same
 * contents, different prototype -- which is a true statement about two sandboxes and nothing at all about Orbis.
 */
const trace = (it) => it.asked.map((one) => `${one.channel} ${JSON.stringify([...one.args])}`)

// ---------------------------------------------------------------- what it offers before anything is asked

test('the page it is about is the page Orbis just read', async () => {
  const it = await screen({ answers: ON_A_PAGE })
  await it.api.readAskPage()
  assert.match(it.about.words(), /A page/)
  assert.match(it.about.words(), /example\.com/)
  // orb:state and nothing else. The page's own text never crosses to this screen: it is read inside Orbis by the
  // page.read capability and put into the prompt there, which is what keeps a page from talking to the model through
  // this panel.
  assert.deepEqual(it.asked.map((one) => one.channel), ['orb:state'])
})

test('all three things this screen does are offered by name', async () => {
  const it = await screen({ answers: ON_A_PAGE })
  await it.api.readAskPage()
  const words = it.thread.words()
  for (const choice of ['Ask about this page', 'Summarise this page', 'Do something on this page']) {
    assert.match(words, new RegExp(choice.replace(/ /g, ' ')), `${choice} is not offered`)
  }
  assert.equal(it.send.disabled, true, 'Ask can be pressed with an empty box')
})

// ---------------------------------------------------------------- a question

test('a streamed answer arrives whole, with the question kept above it', async () => {
  const it = await screen({
    answers: ON_A_PAGE,
    stream: [
      { type: 'status', message: 'Reading the page…' },
      { type: 'delta', content: 'It is ' },
      { type: 'delta', content: 'about cats.' },
      { type: 'outcome', status: 'done', text: 'Answered.' }
    ]
  })
  await it.api.runAsk('What is this page about?')
  assert.match(it.thread.words(), /What is this page about\?/)
  assert.match(it.thread.words(), /It is about cats\./)
  assert.equal(it.stop.hidden, true, 'Stop is still offered after the run ended')
  // The way back to the three choices, so the first question does not hide them for good.
  assert.match(it.thread.words(), /Ask something else/)
})

test('a source is only ever a link when it is really a web address', async () => {
  const it = await screen({
    answers: ON_A_PAGE,
    stream: [
      { type: 'research', research: { sources: [{ url: 'https://example.com/a', title: 'A page' }, { url: 'javascript:alert(1)', title: 'Nasty' }] } },
      { type: 'outcome', status: 'done', text: 'Answered.' }
    ]
  })
  await it.api.runAsk('what happened today')
  const anchors = []
  const walk = (thing) => {
    if (thing.tag === 'a') anchors.push(thing)
    thing.children.forEach(walk)
  }
  walk(it.thread)
  assert.equal(anchors.length, 1, 'a javascript: address was made into a link')
  assert.equal(anchors[0].href, 'https://example.com/a')
  // Still shown, as text: a source that cannot be opened is a fact about the answer, not something to hide.
  assert.match(it.thread.words(), /Nasty/)
})

// ---------------------------------------------------------------- a task on the page

test('a task shows the steps that happened, the one that was refused, and no cheerful ending', async () => {
  const it = await screen({
    answers: ON_A_PAGE,
    stream: [
      { type: 'plan', steps: [{ id: 's1', name: 'Open the page', capability: 'tabs.create' }, { id: 's2', name: 'Click Accept', capability: 'page.click' }] },
      { type: 'step', step: { id: 's1', text: 'Open the page', capability: 'tabs.create', status: 'done', result: { verification: { verified: true, detail: 'The address changed.' } } } },
      { type: 'refused-step', name: 'Sign in', why: 'Orbis will not type a password for you.' },
      { type: 'step', step: { id: 's2', text: 'Click Accept', capability: 'page.click', status: 'failed', failure: { message: 'Nothing matched.' } } },
      { type: 'outcome', status: 'failed', text: '1 of 2 steps were finished.' }
    ]
  })
  await it.api.runAsk('accept the cookie banner')
  const words = it.thread.words()
  assert.match(words, /Open the page/)
  assert.match(words, /Click Accept/)
  assert.match(words, /Orbis will not type a password for you\./)
  assert.match(words, /1 of 2 steps were finished\./)
  assert.ok(it.thread.classes().has('ask-problem'), 'a failed task was not shown as a failure')
  // The count is of what is on screen, and the refused step is on screen as a failed one.
  assert.match(words, /1 of 3 done/)
})

test("a step's detail is how the browser confirmed it, not what the plan hoped", async () => {
  const it = await screen({
    answers: ON_A_PAGE,
    stream: [
      { type: 'step', step: { id: 's1', text: 'Open the page', capability: 'tabs.create', status: 'done', params: { url: 'https://example.com' }, result: { verification: { verified: true, detail: 'The address changed.' } } } },
      { type: 'outcome', status: 'done', text: 'Done.' }
    ]
  })
  await it.api.runAsk('open example.com')
  it.api.askState.openStep = 's1'
  it.api.drawAsk()
  const words = it.thread.words()
  assert.match(words, /tabs\.create/)
  assert.match(words, /Confirmed/)
  assert.match(words, /The address changed\./)
  assert.match(words, /url: https:\/\/example\.com/)
})

test('an approval is answered on the channel that asked for it, and on no other', async () => {
  const it = await screen({ answers: ON_A_PAGE, stream: [{ type: 'outcome', status: 'done', text: 'Done.' }] })
  await it.api.runAsk('click accept')

  // The Orb's own loop raises ids beginning orb-, and answers on orb:answer.
  it.api.askState.confirmation = { id: 'orb-s2-ab12cd', action: 'Click Accept', reason: 'This changes the page.' }
  it.api.drawAsk()
  assert.match(it.thread.words(), /Nothing happens until you approve\./)
  it.asked.length = 0
  it.thread.buttons().find((b) => b.textContent === 'Approve').fire('click')
  await new Promise((settle) => setTimeout(settle, 0))
  assert.deepEqual(trace(it), ['orb:answer ["orb-s2-ab12cd",true]'])

  // One the browser agent raised inside a task has its own id, and answers on the agent's channel. Sending it to the
  // other one leaves the action waiting for ever for an answer that has already been given.
  it.api.askState.confirmation = { id: 'conf-99', action: 'Click', reason: 'Because.' }
  it.api.drawAsk()
  it.asked.length = 0
  it.thread.buttons().find((b) => b.textContent === 'Cancel').fire('click')
  await new Promise((settle) => setTimeout(settle, 0))
  assert.deepEqual(trace(it), ['browser:task-answer ["conf-99",false]'])
})

// ---------------------------------------------------------------- the honest failures

test('Orbis not running is said for a person, never as the launcher instruction the error carries', async () => {
  const it = await screen()
  it.state.answers['orb:state'] = new it.HelperDown('Orbis is not running. Start it from run-orbis-chromium.bat.')
  await it.api.readAskPage()
  assert.match(it.about.words(), /This connects by itself once Orbis starts\./)
  assert.doesNotMatch(it.about.words(), /\.bat/, 'a batch filename reached the screen')
  assert.doesNotMatch(it.thread.words(), /\.bat/)
})

test('no model is said as no model, rather than as something that went wrong', async () => {
  const it = await screen({ answers: { 'orb:ask': { code: 'no-key', message: 'Orion has no API key.' } } })
  await it.api.runAsk('anything')
  assert.match(it.thread.words(), /no model has been set up yet/)
})

test('with no browser the page is said to be unreadable, and only the choice that needs one is held back', async () => {
  const it = await screen({ answers: { 'orb:state': { browser: false, page: null } } })
  await it.api.readAskPage()
  assert.match(it.about.words(), /browser is not connected/)
  const choices = it.thread.buttons()
  const summarise = choices.find((one) => one.words().includes('Summarise this page'))
  assert.equal(summarise.disabled, true, 'Summarise could be pressed with nothing to summarise')
  assert.match(String(summarise.title ?? ''), /browser is not connected/, 'the reason is not on the button')
  // A question still works without a browser, so the other two are not disabled -- and nor is the way back.
  assert.ok(choices.filter((one) => !one.disabled).length >= 2)
})

test('a tab that is not a web page says so instead of being named as one', async () => {
  const it = await screen({ answers: { 'orb:state': { browser: true, page: { url: 'chrome://orbis-newtab/', title: 'New tab' } } } })
  await it.api.readAskPage()
  assert.match(it.about.words(), /not a web page/)
  assert.doesNotMatch(it.about.words(), /New tab/, 'a page Orion cannot read was named as the page in question')
})

test('a run that says nothing at all is reported as a failure, not as an answer', async () => {
  const it = await screen({ answers: ON_A_PAGE, stream: [] })
  await it.api.runAsk('say nothing')
  assert.match(it.thread.words(), /Orbis did nothing and said nothing\./)
})

test('a question back is not dressed as a failure', async () => {
  const it = await screen({ answers: ON_A_PAGE, stream: [{ type: 'ask-user', question: 'Which of the two links did you mean?' }] })
  await it.api.runAsk('open the second one')
  assert.ok(it.thread.classes().has('ask-needs'), 'a question back was not given its own box')
  assert.ok(!it.thread.classes().has('ask-problem'), 'a question back was shown as an error')
  assert.match(it.thread.words(), /Which of the two links did you mean\?/)
})

// ---------------------------------------------------------------- the keyboard

test('Enter sends what was typed, Shift and Enter does not, and Escape leaves', async () => {
  const it = await screen({ answers: ON_A_PAGE, stream: [{ type: 'outcome', status: 'done', text: 'Done.' }] })
  await it.api.readAskPage()

  // Typing is what makes the button usable. It was disabled a moment ago with an empty box.
  it.input.value = 'what is this'
  it.input.fire('input', { target: it.input })
  assert.equal(it.send.disabled, false, 'Ask stayed disabled with something typed')

  // Shift and Enter is a new line, so nothing is sent.
  it.asked.length = 0
  it.input.fire('keydown', { key: 'Enter', shiftKey: true })
  assert.deepEqual(trace(it), [], 'Shift and Enter sent the question instead of starting a new line')

  // Enter sends, and what is sent is what was typed.
  it.input.fire('keydown', { key: 'Enter', shiftKey: false })
  await new Promise((settle) => setTimeout(settle, 0))
  assert.deepEqual(trace(it), ['orb:ask ["what is this"]'])
  assert.equal(it.input.value, '', 'the box kept the question after sending it')

  // Escape leaves this screen for the Command Center, and does not also close whatever it is drawn on.
  it.went.length = 0
  it.input.fire('keydown', { key: 'Escape' })
  assert.deepEqual(it.went, ['home'])
})

test('opening the screen puts the cursor in the box', async () => {
  const it = await screen({ answers: ON_A_PAGE })
  it.api.askShown()
  assert.equal(it.input.focused, true)
})
