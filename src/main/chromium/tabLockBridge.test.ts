import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lockedInBrowser, orbPages, pushLock, type OrbisPage } from './tabLockBridge.ts'

/**
 * Carrying a lock decision into the browser.
 *
 * Small, and worth testing anyway: this is the one step between "Orbis has locked the tab" and "the browser has stopped
 * showing its title", and every way it can go wrong is silent. A message sent to the wrong page, a label that escapes
 * the string it is in, or a failure that takes down the thing that locked the tab -- none of those would raise an error
 * anywhere.
 */

const page = (url: string): OrbisPage & { ran: string[] } => {
  const ran: string[] = []
  return {
    ran,
    getURL: () => url,
    executeJavaScript: async (code) => {
      ran.push(code)
      return true
    }
  }
}

const HIDING = { title: true, favicon: true, url: true, preview: true }

test('only the Orb pages are spoken to', () => {
  const pages = [
    page('https://bank.example/'),
    page('chrome://orbis-orb/'),
    page('chrome://orbis/'),
    page('chrome://orbis-newtab/'),
    page('chrome://orbis-orb/index.html')
  ]
  const found = orbPages(pages)
  assert.equal(found.length, 2)
  assert.ok(found.every((p) => p.getURL().startsWith('chrome://orbis-orb')))
})

test('a page that has gone away while we were looking at it is skipped, not thrown over', () => {
  const gone: OrbisPage = {
    getURL: () => {
      throw new Error('the target is closed')
    },
    executeJavaScript: async () => true
  }
  const ok = page('chrome://orbis-orb/')
  assert.deepEqual(orbPages([gone, ok]), [ok])
})

test('every Orb page is told, not only the first', async () => {
  // They are per window, and a window whose Orb page had not finished loading would otherwise never hear.
  const a = page('chrome://orbis-orb/')
  const b = page('chrome://orbis-orb/')
  assert.equal(await pushLock([a, b, page('https://x.example/')], { tabId: 4, locked: true, label: 'Private', hiding: HIDING }), true)
  assert.equal(a.ran.length, 1)
  assert.equal(b.ran.length, 1)
})

test('the message names the tab, the state, the label and what to hide', async () => {
  const a = page('chrome://orbis-orb/')
  await pushLock([a], { tabId: 41, locked: true, label: 'Private', hiding: { title: true, favicon: false, url: true, preview: true } })
  const sent = a.ran[0]
  assert.ok(sent.startsWith('chrome.send("orbis.lock.set", ['))
  assert.ok(sent.includes('41'))
  assert.ok(sent.includes('true'))
  assert.ok(sent.includes('"Private"'))
  assert.ok(sent.includes('"favicon":false'))
})

test('a label cannot end the string it is in and become code', async () => {
  // The label is the only part of this a person writes, so it is the only part that has to be proved safe.
  const a = page('chrome://orbis-orb/')
  const nasty = '");alert(1);chrome.send("orbis.lock.set",["x",1,false,"'
  await pushLock([a], { tabId: 1, locked: true, label: nasty, hiding: HIDING })
  const sent = a.ran[0]
  assert.ok(!sent.includes('alert(1)') || sent.includes('\\"'), 'the quotes were not escaped')
  // Decisive: what was sent parses as one call with one argument list, and the label survives as data.
  const args = JSON.parse(sent.slice(sent.indexOf('['), sent.lastIndexOf(']') + 1))
  assert.equal(args.length, 5)
  assert.equal(args[3], nasty)
})

test('with no Orb page there is nothing to tell, and that is said rather than thrown', async () => {
  assert.equal(await pushLock([], { tabId: 1, locked: true, label: '', hiding: HIDING }), false)
  assert.equal(
    await pushLock([page('https://bank.example/')], { tabId: 1, locked: true, label: '', hiding: HIDING }),
    false
  )
})

test('a page that refuses does not take down the lock', async () => {
  // The tab is already locked everywhere the main process can enforce it. A browser that could not be told must not turn
  // that into an exception somewhere up the stack.
  const broken: OrbisPage = {
    getURL: () => 'chrome://orbis-orb/',
    executeJavaScript: async () => {
      throw new Error('the renderer is gone')
    }
  }
  assert.equal(await pushLock([broken], { tabId: 1, locked: true, label: '', hiding: HIDING }), false)
})

test('one page failing does not stop another from being told', async () => {
  const broken: OrbisPage = {
    getURL: () => 'chrome://orbis-orb/',
    executeJavaScript: async () => {
      throw new Error('gone')
    }
  }
  const ok = page('chrome://orbis-orb/')
  assert.equal(await pushLock([broken, ok], { tabId: 1, locked: true, label: '', hiding: HIDING }), true)
  assert.equal(ok.ran.length, 1)
})

test('unlocking is carried the same way as locking', async () => {
  const a = page('chrome://orbis-orb/')
  await pushLock([a], { tabId: 7, locked: false, label: 'Private', hiding: HIDING })
  const args = JSON.parse(a.ran[0].slice(a.ran[0].indexOf('['), a.ran[0].lastIndexOf(']') + 1))
  assert.equal(args[1], 7)
  assert.equal(args[2], false)
})

// ---------------------------------------------------------------- checking the two sides agree

test('what the browser believes is asked for, and read back as numbers', async () => {
  const answering: OrbisPage = {
    getURL: () => 'chrome://orbis-orb/',
    executeJavaScript: async () => [4, 7, 'nonsense', 11]
  }
  assert.deepEqual(await lockedInBrowser([answering]), [4, 7, 11])
})

test('no Orb page means "nobody to ask", which is not the same as "nothing is locked"', async () => {
  // Null rather than an empty list, deliberately: a caller that treated "could not ask" as "nothing is locked" would
  // conclude the browser had nothing to hide.
  assert.equal(await lockedInBrowser([]), null)
  assert.equal(await lockedInBrowser([page('https://x.example/')]), null)
})

test('an answer that is not a list is not an answer', async () => {
  const odd: OrbisPage = { getURL: () => 'chrome://orbis-orb/', executeJavaScript: async () => null }
  assert.equal(await lockedInBrowser([odd]), null)
})
