import assert from 'node:assert/strict'
import test from 'node:test'
import { explainPower, parseAvailability, parseWakeTimers, powerSummary, type PowerFacts } from './power.ts'

/**
 * Reading what this computer can be woken from.
 *
 * Most of these are about the two ways of being wrong that matter: telling somebody their computer can hibernate
 * when it cannot, and telling them a switched-off computer will wake. Both leave a schedule that silently never
 * happens, which is the fault this whole layer exists to avoid.
 */

const AVAILABLE = `The following sleep states are available on this system:
    Standby (S3)
    Hibernate
    Fast Startup

The following sleep states are not available on this system:
    Standby (S1)
        The system firmware does not support this standby state.
    Standby (S2)
        The system firmware does not support this standby state.
    Hybrid Sleep
        The hypervisor does not support this standby state.
`

const NO_HIBERNATE = `The following sleep states are available on this system:
    Standby (S3)

The following sleep states are not available on this system:
    Hibernate
        Hibernation has not been enabled.
    Fast Startup
        Hibernation is not available.
`

const MODERN = `The following sleep states are available on this system:
    Standby (S0 Low Power Idle) Network Connected
    Hibernate
    Fast Startup
`

const facts = (over: Partial<PowerFacts> = {}): PowerFacts => ({
  canSleep: true,
  canHibernate: true,
  hibernateBecause: null,
  wakeTimersOnPower: 1,
  wakeTimersOnBattery: 1,
  taskRegistered: true,
  windows: true,
  ...over
})

// ---------------------------------------------------------------- reading what Windows said

test('a computer that can sleep and hibernate reads that way', () => {
  const read = parseAvailability(AVAILABLE)
  assert.equal(read.canSleep, true)
  assert.equal(read.canHibernate, true)
  assert.equal(read.hibernateBecause, null)
})

test('hibernate switched off is read as off, with the reason Windows gave', () => {
  /**
   * The finding that matters most. Hibernate is off by default on a good many laptops, and it is the one state that
   * is both wakeable and feels like being switched off -- so being wrong about it wastes the best answer there is.
   */
  const read = parseAvailability(NO_HIBERNATE)
  assert.equal(read.canSleep, true)
  assert.equal(read.canHibernate, false)
  assert.match(read.hibernateBecause ?? '', /has not been enabled/)
})

test('a modern-standby machine still counts as able to sleep', () => {
  // These never say "Standby (S3)"; they say "Standby (S0 Low Power Idle)", and they do wake for timers.
  const read = parseAvailability(MODERN)
  assert.equal(read.canSleep, true)
  assert.equal(read.canHibernate, true)
})

test('a state listed as available is not undone by appearing in the unavailable list too', () => {
  // "Hibernate" available and "Hybrid Sleep" unavailable sit in the same output; one must not cancel the other.
  const read = parseAvailability(AVAILABLE)
  assert.equal(read.canHibernate, true, 'Hybrid Sleep being unavailable is not hibernate being unavailable')
})

test('text this cannot interpret comes back as unknown, not as a guess', () => {
  /**
   * `powercfg` prints in whatever language Windows was installed in. Guessing either way is worse than admitting it:
   * a wrong yes loses a schedule silently, and a wrong no sends somebody into their BIOS for nothing.
   */
  for (const gibberish of ['', 'Zzz', 'Die folgenden Ruhezustände sind nicht klar']) {
    const read = parseAvailability(gibberish)
    assert.equal(read.canSleep, null, gibberish)
    assert.equal(read.canHibernate, null, gibberish)
  }
})

// ---------------------------------------------------------------- the wake timer setting

test('the two wake-timer settings are read in the right order', () => {
  const output = `  Power Setting GUID: bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d  (Allow wake timers)
    GUID Alias: RTCWAKE
    Possible Setting Index: 000
    Current AC Power Setting Index: 0x00000001
    Current DC Power Setting Index: 0x00000000
`
  const read = parseWakeTimers(output)
  assert.equal(read.wakeTimersOnPower, 1, 'on while plugged in')
  assert.equal(read.wakeTimersOnBattery, 0, 'off on battery, which is the usual laptop default')
})

test('"important timers only" is its own answer, not a yes', () => {
  const output = `Current AC Power Setting Index: 0x00000002
Current DC Power Setting Index: 0x00000002
`
  const read = parseWakeTimers(output)
  assert.equal(read.wakeTimersOnPower, 2)
  assert.equal(read.wakeTimersOnBattery, 2)
})

test('a translated Windows still gives up its numbers', () => {
  // The labels are translated; the hex values and their order are not, so the last two in order are used.
  const output = `  Netzschalter und Zuklappen
    Aktueller Wert des Netzbetriebs-Einstellungsindex: 0x00000001
    Aktueller Wert des Akkubetriebs-Einstellungsindex: 0x00000000
`
  const read = parseWakeTimers(output)
  assert.equal(read.wakeTimersOnPower, 1)
  assert.equal(read.wakeTimersOnBattery, 0)
})

test('nothing readable comes back as unknown', () => {
  assert.deepEqual(parseWakeTimers('no numbers here'), { wakeTimersOnPower: null, wakeTimersOnBattery: null })
})

// ---------------------------------------------------------------- what it means

test('there is always a finding for each way of leaving the computer', () => {
  const found = explainPower(facts())
  assert.deepEqual(found.map((f) => f.state), ['sleep', 'hibernate', 'shutdown'])
})

test('switching the computer off is impossible, not merely awkward', () => {
  /**
   * The one thing this panel must not soften. Windows is not running, so nothing in it can start the machine, and
   * calling that "fixable" would have somebody waiting for a reminder that cannot arrive.
   */
  const off = explainPower(facts()).find((f) => f.state === 'shutdown')
  assert.ok(off)
  assert.equal(off.standing, 'impossible')
  assert.equal(off.orbisCanFix, false)
  assert.match(off.detail, /can start a computer that is switched off/)
  // And it still says the one thing that would work, which is firmware rather than software.
  assert.match(off.todo ?? '', /Resume by Alarm/)
  assert.match(off.todo ?? '', /hibernate instead/)
})

test('nothing here offers to fix anything itself', () => {
  // Power settings, firmware settings and adapter settings are all the owner's, and a wrong write can be expensive.
  for (const finding of explainPower(facts({ canHibernate: false, wakeTimersOnPower: 0 }))) {
    assert.equal(finding.orbisCanFix, false, finding.title)
  }
})

test('hibernate off is fixable, and the fix says it needs administrator', () => {
  const found = explainPower(facts({ canHibernate: false, hibernateBecause: 'Hibernation has not been enabled.' }))
  const hibernate = found.find((f) => f.state === 'hibernate')
  assert.ok(hibernate)
  assert.equal(hibernate.standing, 'fixable')
  assert.match(hibernate.detail, /not available/)
  assert.match(hibernate.todo ?? '', /powercfg \/hibernate on/)
  assert.match(hibernate.todo ?? '', /administrator/)
})

test('wake timers off makes sleep fixable rather than good', () => {
  const found = explainPower(facts({ wakeTimersOnPower: 0, wakeTimersOnBattery: 0 }))
  const sleep = found.find((f) => f.state === 'sleep')
  assert.equal(sleep?.standing, 'fixable')
  assert.match(sleep?.todo ?? '', /Allow wake timers/)
})

test('on battery only is called out, because that is the usual laptop default', () => {
  const sleep = explainPower(facts({ wakeTimersOnBattery: 0 })).find((f) => f.state === 'sleep')
  assert.equal(sleep?.standing, 'good')
  assert.match(sleep?.todo ?? '', /on battery/)
})

test('a machine that cannot sleep at all says so rather than offering a setting', () => {
  const sleep = explainPower(facts({ canSleep: false })).find((f) => f.state === 'sleep')
  assert.equal(sleep?.standing, 'impossible')
  assert.equal(sleep?.todo, null)
})

test('what could not be read is reported as unknown', () => {
  const found = explainPower(facts({ canSleep: null, canHibernate: null, wakeTimersOnPower: null, wakeTimersOnBattery: null }))
  assert.equal(found.find((f) => f.state === 'sleep')?.standing, 'unknown')
  assert.equal(found.find((f) => f.state === 'hibernate')?.standing, 'unknown')
  assert.match(powerSummary(found), /could not read/)
})

test('anything but Windows gets one honest answer instead of three irrelevant ones', () => {
  const found = explainPower(facts({ windows: false }))
  assert.equal(found.length, 1)
  assert.equal(found[0].standing, 'impossible')
})

test('the summary never says everything is fine when it is not', () => {
  assert.match(powerSummary(explainPower(facts())), /can be woken/)
  assert.match(powerSummary(explainPower(facts({ wakeTimersOnPower: 0 }))), /until something below is changed/)
  assert.match(powerSummary(explainPower(facts({ canHibernate: false }))), /Hibernate needs a change/)
})

test('whether Orbis has a wake booked is said, not assumed', () => {
  assert.match(explainPower(facts({ taskRegistered: true }))[0].detail, /wake booked/)
  assert.match(explainPower(facts({ taskRegistered: false }))[0].detail, /nothing booked/)
})
