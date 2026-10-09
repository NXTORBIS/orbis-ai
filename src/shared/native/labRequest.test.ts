import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readLabRequest, readSettings, readSpeed, readPlaying, valuesFor } from './labRequest.ts'
import { CHEMISTRY_MODULES } from '../chemistry/modules.ts'

/**
 * What the chat makes of a message asking for a laboratory.
 *
 * This is the part that was wrong in the way that mattered: "open collision of 2 objects animation" went to a
 * model, came back as something to search for, and Orbis opened the browser instead of the simulation it already
 * had. The topic names are a list Orbis holds, so matching them is checkable — which is what this does.
 */

test('a message naming a topic opens that topic', () => {
  for (const [said, expected] of [
    ['open projectile motion', 'Projectile Motion'],
    ['show me the double pendulum', 'Double Pendulum'],
    ['run projectile motion', 'Projectile Motion'],
    ['simulate the double pendulum', 'Double Pendulum']
  ] as const) {
    const got = readLabRequest(said)
    assert.ok(got, `"${said}" should open something`)
    assert.equal(got.app, 'physics-studio')
    assert.equal(got.opens, expected, `"${said}" opened ${got.opens}`)
  }
})

test('the words around the topic do not stop it being found', () => {
  // This is the exact phrasing that was going to the browser.
  const got = readLabRequest('open collision of 2 objects animation')
  assert.ok(got, 'it must find a laboratory for this, not a web search')
  assert.equal(got.app, 'physics-studio')
  assert.match(got.opens, /collision/i, `it opened "${got.opens}"`)
})

test('a value asked for in the same sentence is carried across', () => {
  const got = readLabRequest('open projectile motion with initial velocity 30')
  assert.ok(got)
  assert.match(got.settings, /initial velocity = 30/)
})

test('a number said in words is understood too', () => {
  assert.match(readSettings('initial velocity thirty'), /initial velocity = 30/)
  assert.match(readSettings('set the mass to five'), /mass = 5/)
})

test('the count of objects in the scene is not mistaken for a control', () => {
  // "collision of 2 objects" describes what is colliding. Setting a control to 2 from it would be invented.
  const settings = readSettings('open collision of 2 objects animation')
  assert.ok(!/= 2\b/.test(settings), `it invented a setting: "${settings}"`)
})

test('a run speed is a speed, not one of the simulation’s controls', () => {
  assert.equal(readSpeed('run it at 2x'), 2)
  assert.equal(readSpeed('play at 0.5x speed'), 0.5)
  assert.equal(readSpeed('set the launch speed to 30'), undefined)
  // And it must not also land in the settings.
  assert.ok(!/= 2\b/.test(readSettings('open projectile motion at 2x')))
})

test('starting and stopping are read, and silence means neither', () => {
  assert.equal(readPlaying('run projectile motion'), true)
  assert.equal(readPlaying('pause it'), false)
  assert.equal(readPlaying('set the angle to 40'), undefined)
})

test('a question is answered, not opened', () => {
  for (const said of [
    'what is projectile motion',
    'why does a pendulum swing',
    'how does collision work',
    'explain the double pendulum',
    'who discovered gravity'
  ]) {
    assert.equal(readLabRequest(said), null, `"${said}" is a question and must be answered`)
  }
})

test('a question that also asks to see it does open it', () => {
  // "what does projectile motion look like, show me" is both. The asking for it on screen wins.
  const got = readLabRequest('show me what projectile motion looks like')
  assert.ok(got, 'asking to be shown it is a request to open it')
})

test('ordinary conversation opens nothing', () => {
  for (const said of [
    'hello',
    'thanks',
    'how are you',
    'write me an email',
    'what is the weather',
    'open the browser',
    'open google'
  ]) {
    const got = readLabRequest(said)
    assert.equal(got, null, `"${said}" must not open a laboratory (it opened ${got?.opens})`)
  }
})

test('a chemistry module is found the same way', () => {
  for (const [said, expected] of [
    ['open the periodic table', 'Periodic Table'],
    ['show me spectroscopy', 'Spectroscopy'],
    ['open chemical kinetics', 'Chemical Kinetics'],
    ['run electrochemistry', 'Electrochemistry']
  ] as const) {
    const got = readLabRequest(said)
    assert.ok(got, `"${said}" should open something`)
    assert.equal(got.app, 'chemistry-studio', `"${said}" opened ${got.app}`)
    assert.equal(got.opens, expected)
  }
})

test('all twenty-six modules are built, so all of them open', () => {
  /*
   * `visualization` and `research` used to be marked unfinished in their own registry, and this test asserted
   * they were never opened. Both are built now, so opening them is the correct behaviour and the old assertion
   * was the thing that had become wrong.
   */
  for (const [said, expected] of [
    ['open chemical visualization', 'visualization'],
    ['open the research workspace', 'research']
  ] as const) {
    const got = readLabRequest(said)
    assert.ok(got, `"${said}" should open something now`)
    assert.equal(got.app, 'chemistry-studio')
    assert.equal(got.id, expected)
  }
})

test('a module that were ever marked unfinished again would still be refused', () => {
  // The rule outlives the two that needed it: nothing marked `soon` is opened, because there is nothing behind it.
  const unfinished = CHEMISTRY_MODULES.filter((one) => one.soon)
  assert.equal(unfinished.length, 0, 'all modules are built, so there should be none marked unfinished')
  // And the reader only ever offers built ones, which is what makes the rule hold without being restated.
  for (const one of CHEMISTRY_MODULES) {
    const got = readLabRequest(`open ${one.name}`)
    if (one.soon) assert.equal(got, null, `${one.name} is unfinished and must not open`)
  }
})

test('the values handed to the studio are in the shape its parameters take', () => {
  const physics = readLabRequest('open projectile motion with initial velocity 30 at 2x')
  assert.ok(physics)
  const values = valuesFor(physics)
  assert.equal(values.topic, 'Projectile Motion')
  assert.match(String(values.settings), /initial velocity = 30/)
  assert.equal(values.speed, 2)

  const chemistry = readLabRequest('open chemical kinetics')
  assert.ok(chemistry)
  const theirs = valuesFor(chemistry)
  assert.equal(theirs.module, 'Chemical Kinetics')
  // A chemistry module has no run speed; offering one would be a parameter the studio does not have.
  assert.equal(theirs.speed, undefined)
})

test('a very long message is a passage to discuss, not a request', () => {
  assert.equal(readLabRequest('open ' + 'projectile motion '.repeat(40)), null)
})
