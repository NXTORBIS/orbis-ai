import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { wallInTheWay } from './orbSafety.ts'

const article = 'Rotational motion is the motion of a body around an axis. '.repeat(80)

test('a sign-in wall is recognised as a door, not as a missing button', () => {
  const found = wallInTheWay({ url: 'https://example.com/x', title: 'Sign in', text: 'Please sign in to continue.' })
  assert.equal(found?.what, 'sign-in')
})

test('a human-verification page is recognised, and is never something to get past', () => {
  for (const text of ['Verify you are human', "I'm not a robot", 'Checking your browser before accessing']) {
    assert.equal(wallInTheWay({ url: 'https://example.com', title: '', text })?.what, 'captcha', text)
  }
})

test('an address that is a sign-in page is one, whatever it says', () => {
  for (const url of ['https://example.com/login', 'https://x.com/signin?next=/a', 'https://y.org/account/login/', 'https://z.net/oauth/authorize?id=1']) {
    assert.equal(wallInTheWay({ url, title: '', text: '' })?.what, 'sign-in', url)
  }
})

test('an article that mentions signing in is still an article', () => {
  /*
   * The failure this guards against is the detector looking for reasons to stop. "Sign in" is in the corner of most of
   * the web, and a task abandoned over a page header is worse than the failure the detector was added to explain.
   */
  assert.equal(wallInTheWay({ url: 'https://example.com/physics', title: 'Rotational motion', text: `Please sign in to continue. ${article}` }), null)
})

test('an ordinary page is not a door', () => {
  assert.equal(wallInTheWay({ url: 'https://example.com/pricing', title: 'Pricing', text: 'Our plans start at nothing.' }), null)
  assert.equal(wallInTheWay(null), null)
})

test('a challenge is recognised even on a long page, because that is how a challenge appears', () => {
  // Unlike a sign-in wall, an interstitial is often injected over a full page by a network in front of the site.
  assert.equal(wallInTheWay({ url: 'https://example.com/a', title: 'Just a moment', text: `Checking your browser. ${article}` })?.what, 'captcha')
})
