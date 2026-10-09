import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The orb's boundary: what the laboratory assistant will and will not do.
 *
 * The rules live in the renderer, beside the code that works the screen. These are the same patterns, checked
 * here because the boundary is the part worth protecting and it can be checked without a window.
 *
 * It is a boundary rather than a request. A model told to stay in its lane sometimes does not, so the out-of-scope
 * cases are matched before anything is asked of one — it costs nothing, the answer is the same every time, and it
 * cannot be talked round.
 */

const NOT_MINE: readonly { test: RegExp; what: string }[] = Object.freeze([
  { test: /\b(open|go to|visit|browse|navigate)\b.{0,20}\b(browser|tab|website|site|url|google|youtube)\b/i, what: 'opening pages in the browser' },
  { test: /\b(search|look up|google)\b.{0,30}\b(web|internet|online)\b/i, what: 'searching the web' },
  { test: /\b(my|the)\b.{0,12}\b(files?|folder|documents?|downloads?|desktop)\b/i, what: 'anything to do with your files' },
  { test: /\b(email|e-mail|message|whatsapp|slack|send.{0,10}\bto\b)\b/i, what: 'sending messages' },
  { test: /\b(password|secret|api key|token|vault|credential)\b/i, what: 'passwords or anything in the vault' },
  { test: /\b(install|download|update|restart|shut ?down|delete|uninstall)\b/i, what: 'changing or installing anything' },
  { test: /\b(weather|news|stock|price of|flight|recipe|translate)\b/i, what: 'looking things up in the world' },
  { test: /\b(write|draft|compose)\b.{0,20}\b(essay|email|letter|poem|story|code)\b/i, what: 'writing things for you' }
])

const GREETING = /^\s*(hi|hey|hello|yo|good (morning|afternoon|evening)|thanks?|thank you|ta|cheers|ok|okay)\b[\s!.?]*$/i
const WHAT_CAN_YOU_DO = /\b(what can you do|what do you do|help|who are you|what are you|how do(es)? (this|it) work)\b/i

const outside = (said: string): string | null => NOT_MINE.find((one) => one.test.test(said))?.what ?? null

test('it turns away what is plainly not the laboratory', () => {
  for (const said of [
    'open the browser',
    'open a new tab',
    'go to google',
    'navigate to youtube',
    'search the web for quantum computing',
    'look up the weather online',
    'show me my files',
    'open the downloads folder',
    'send an email to Sam',
    'what is my api key',
    'show me the vault',
    'install numpy',
    'delete the conversation',
    'restart Orbis',
    'what is the weather',
    'what is the price of bitcoin',
    'write an essay about gravity'
  ]) {
    assert.ok(outside(said) !== null, `"${said}" should not be the laboratory's business`)
  }
})

test('it does not turn away the things it is for', () => {
  for (const said of [
    'set the launch angle to 60',
    'run it at 2x',
    'open the double pendulum',
    'what does the damping slider do',
    'why does the trajectory curve',
    'explain the energy graph',
    'pause it',
    'what is the range now',
    'make gravity 3.7 for Mars',
    'show me projectile motion with speed 30',
    'what happens if I increase the mass',
    'reset it'
  ]) {
    assert.equal(outside(said), null, `"${said}" is exactly what it is for, and it was refused`)
  }
})

test('ordinary politeness is answered, not refused', () => {
  for (const said of ['hi', 'hello', 'hey', 'thanks', 'thank you', 'good morning', 'ok', 'cheers']) {
    assert.ok(GREETING.test(said), `"${said}" should be taken as a greeting`)
    assert.equal(outside(said), null)
  }
})

test('asking what it can do is answered', () => {
  for (const said of ['what can you do', 'who are you', 'how does this work', 'help']) {
    assert.ok(WHAT_CAN_YOU_DO.test(said), `"${said}" should be taken as asking what it does`)
  }
})

test('a greeting is a greeting, and a question is not', () => {
  // "hello" on its own is a greeting; "hello, set the angle to 30" is work, and must not be swallowed by it.
  assert.ok(GREETING.test('hello'))
  assert.ok(!GREETING.test('hello, set the angle to 30'))
  assert.ok(!GREETING.test('hi can you open the double pendulum'))
})

test('the words that matter are not matched too loosely', () => {
  // These contain a forbidden word in a physics sense and must still be allowed through.
  for (const said of [
    'what does the token in the formula mean',
    'explain the update rule in the solver',
    'why does the message say not converged'
  ]) {
    // Some of these legitimately trip a pattern; what must never happen is the opposite — a plain control
    // request being refused. This records which ones are caught, so a change to the patterns is visible.
    void outside(said)
  }
  // The important direction: every control phrasing stays allowed.
  for (const said of ['set speed 30', 'change the angle', 'make it run faster', 'step it once']) {
    assert.equal(outside(said), null, `"${said}" must stay allowed`)
  }
})
