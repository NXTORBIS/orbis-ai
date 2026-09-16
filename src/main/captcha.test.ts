import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  abandon,
  actions,
  askUser,
  assistance,
  captchaStep,
  detect,
  isOpen,
  notice,
  publicEncounter,
  reappeared,
  recheck,
  safeSignals,
  verified,
  REAPPEAR_LIMIT,
  STOP_AT,
  WAIT_LIMIT_MS
} from '../shared/captcha.ts'
import type { CaptchaEncounter, PageSignals } from '../shared/captcha.ts'

const where = { id: 'c1', tabId: 'tab-1', profileId: 'default', url: 'https://shop.example.com/checkout' }

const recaptchaPage: PageSignals = {
  url: 'https://shop.example.com/checkout',
  frames: ['https://www.google.com/recaptcha/api2/anchor?k=abc'],
  attributes: ['g-recaptcha', 'recaptcha-checkbox-border'],
  text: ['Complete your order', "I'm not a robot"]
}

const clearPage: PageSignals = { url: 'https://shop.example.com/checkout', frames: [], attributes: ['order-summary'], text: ['Complete your order', 'Pay now'] }

test('a real challenge is recognised, with a provider and a reason a person can read', () => {
  const found = detect(recaptchaPage)
  assert.equal(found.provider, 'recaptcha')
  assert.equal(found.kind, 'checkbox')
  assert.equal(found.present, true)
  assert.ok(found.confidence >= STOP_AT)
  assert.ok(found.reasons.some((r) => r.includes('reCAPTCHA')))
})

test('each provider is told apart by what it loads', () => {
  const cases: [string, string][] = [
    ['https://js.hcaptcha.com/1/api.js', 'hcaptcha'],
    ['https://challenges.cloudflare.com/turnstile/v0/api.js', 'turnstile'],
    ['https://client-api.arkoselabs.com/v2/enforcement.js', 'arkose'],
    ['https://d1.awswaf.com/captcha.js', 'aws-waf'],
    ['https://static.geetest.com/static/js/gt.js', 'geetest'],
    ['https://api.friendlycaptcha.com/widget.js', 'friendly']
  ]
  for (const [script, provider] of cases) {
    const found = detect({ url: 'https://site.example/login', scripts: [script] })
    assert.equal(found.provider, provider, script)
    assert.ok(found.confidence >= STOP_AT, `${script} should be enough on its own`)
  }
})

test('an ordinary page is not a challenge', () => {
  const found = detect(clearPage)
  assert.equal(found.present, false)
  assert.equal(found.confidence, 0)
  assert.equal(notice(found, where), null, 'nothing is opened over a page with nothing on it')
})

test('a page that merely talks about CAPTCHAs does not stop anybody', () => {
  const article = detect({
    url: 'https://blog.example.com/how-captchas-work',
    text: ['Most people have clicked “I’m not a robot” at some point', 'Here is how a security check works']
  })
  assert.equal(article.present, false, 'words alone are a guess, not a challenge')
  assert.ok(article.confidence < STOP_AT)
})

test('words plus a widget is enough, where either alone is not', () => {
  const words = detect({ url: 'https://site.example/x', text: ['Verify you are human'] })
  const widget = detect({ url: 'https://site.example/x', attributes: ['h-captcha'] })
  const both = detect({ url: 'https://site.example/x', text: ['Verify you are human'], attributes: ['h-captcha'] })
  assert.ok(words.confidence < STOP_AT)
  assert.ok(widget.confidence < STOP_AT)
  assert.ok(both.confidence >= STOP_AT, 'two small agreements are worth more than either')
})

test('an interstitial is recognised without any provider at all', () => {
  const found = detect({ url: 'https://site.example/cdn-cgi/challenge-platform/h/b/orchestrate', text: ['Checking your browser before accessing the site'], status: 403 })
  assert.equal(found.present, true)
  assert.equal(found.kind, 'interstitial')
})

test('a puzzle is described as a puzzle, not as a box to tick', () => {
  const found = detect({ ...recaptchaPage, text: ['Select all images with traffic lights'] })
  assert.equal(found.kind, 'challenge')
  assert.match(assistance(notice(found, where)!), /puzzle/)
})

// ---------------------------------------------------------------- secrets

test('an answer to a challenge is thrown away before it can be stored', () => {
  const token = 'A'.repeat(60)
  const dirty: PageSignals = {
    url: `https://site.example/verify?g-recaptcha-response=${token}&next=/home`,
    frames: [`https://www.google.com/recaptcha/api2/anchor?k=site-key&token=${token}`],
    attributes: ['g-recaptcha', `data-callback-token-${token}`],
    text: ['Verify you are human', `g-recaptcha-response ${token}`]
  }
  const clean = JSON.stringify(safeSignals(dirty))
  assert.ok(!clean.includes(token), 'nothing token-shaped survives')
  assert.ok(!clean.includes('g-recaptcha-response'), 'nor does the field it came in')
  assert.ok(clean.includes('google.com/recaptcha'), 'what is needed to recognise it does')

  // And it still works: dropping the secret does not stop it being recognised.
  const found = detect(dirty)
  assert.equal(found.provider, 'recaptcha')
  assert.equal(found.present, true)
  assert.ok(!JSON.stringify(found).includes(token))

  const opened = notice(found, { ...where, url: dirty.url })!
  assert.ok(!JSON.stringify(publicEncounter(opened)).includes(token))
  assert.equal(opened.url, 'https://site.example/verify', 'an address is kept without its query string')
})

test('cookies, headers and passwords are not in the detector to begin with, and are dropped if handed to it', () => {
  const clean = JSON.stringify(
    safeSignals({
      url: 'https://site.example/x',
      attributes: ['cf_clearance', 'Authorization', 'input-password', 'session-id', 'x-api-key'],
      text: ['Set-Cookie: a=b', 'normal words']
    })
  )
  for (const secret of ['cf_clearance', 'Authorization', 'password', 'session', 'x-api-key', 'Set-Cookie']) {
    assert.ok(!clean.includes(secret), secret)
  }
  assert.ok(clean.includes('normal words'))
})

test('the only thing an encounter says about verification is whether it happened', () => {
  const opened = notice(detect(recaptchaPage), where)!
  const done = recheck(askUser(opened), clearPage)
  assert.equal(verified(done), true)
  assert.equal(typeof verified(done), 'boolean', 'a yes or a no, never a value')
  const shown = JSON.stringify(publicEncounter(done))
  assert.ok(!/token/i.test(shown), 'the word does not even appear')
})

// ---------------------------------------------------------------- the encounter

test('a challenge is finished when it is gone from the page, and not before', () => {
  let e = notice(detect(recaptchaPage), where)!
  assert.equal(e.state, 'present')
  e = askUser(e)
  assert.equal(e.state, 'awaiting-user')
  assert.ok(isOpen(e))

  // Still showing: still not done, whatever anybody says.
  e = recheck(e, recaptchaPage)
  assert.equal(e.state, 'awaiting-user')
  assert.equal(verified(e), false)
  assert.equal(e.checks, 1)

  // Gone: done.
  e = recheck(e, clearPage)
  assert.equal(e.state, 'solved')
  assert.equal(verified(e), true)
  assert.equal(isOpen(e), false)
})

test('a challenge that stands too long stops being waited for', () => {
  const opened = askUser(notice(detect(recaptchaPage), where)!, 1000)
  const late = recheck(opened, recaptchaPage, 1000 + WAIT_LIMIT_MS + 1)
  assert.equal(late.state, 'expired')
  assert.equal(verified(late), false)
  assert.match(late.note ?? '', /five minutes/)
})

test('a site that keeps asking is left alone rather than pushed at', () => {
  let e = notice(detect(recaptchaPage), where)!
  for (let i = 1; i < REAPPEAR_LIMIT; i++) {
    e = reappeared(e)
    assert.equal(e.state, 'present', 'it is asked of the person again')
  }
  e = reappeared(e)
  assert.equal(e.state, 'failed')
  assert.match(e.note ?? '', /may not want this done automatically/)
  assert.equal(verified(e), false)
})

test('a solved challenge cannot be talked back out of, and an abandoned one is not solved', () => {
  const solved = recheck(askUser(notice(detect(recaptchaPage), where)!), clearPage)
  assert.equal(abandon(solved, 'the run ended').state, 'solved')
  assert.equal(recheck(solved, recaptchaPage).state, 'solved')

  const dropped = abandon(askUser(notice(detect(recaptchaPage), where)!), 'the run was stopped')
  assert.equal(dropped.state, 'abandoned')
  assert.equal(verified(dropped), false)
})

test('a merely suspected challenge is opened but does not claim to be one', () => {
  const faint = detect({ url: 'https://site.example/x', attributes: ['h-captcha'] })
  const e = notice(faint, where)
  assert.equal(e?.state, 'suspected')
  assert.equal(verified(e!), false)
})

test('what Orbis offers is help finding it, never answering it', () => {
  const e = askUser(notice(detect(recaptchaPage), where)!)
  const offered = actions(e)
  assert.deepEqual(offered, ['focus-tab', 'scroll-to', 'skip', 'stop'])
  for (const action of offered) {
    assert.ok(!/solve|answer|bypass|auto/i.test(action), action)
  }
  assert.deepEqual(actions(recheck(e, clearPage)), [], 'nothing is offered about a challenge that is gone')
})

test('what the person is told names the site and what to do, without telling them the answer', () => {
  const said = assistance(notice(detect(recaptchaPage), where)!)
  assert.match(said, /shop\.example\.com/)
  assert.match(said, /Tick the box on the page/)
  assert.match(said, /Orbis will carry on/)
})

test('a challenge becomes an ordinary step that waits for a person, in the tab it is in', () => {
  const e = notice(detect(recaptchaPage), where)!
  const step = captchaStep(e)
  assert.equal(step.target.tabId, 'tab-1')
  assert.match(step.intent, /shop\.example\.com/)
  assert.equal(step.needsUser, assistance(e))
  assert.ok(!('capability' in step), 'there is no capability that answers a challenge')
})

test('one tab is not another: encounters carry their tab and profile', () => {
  const a = notice(detect(recaptchaPage), where)!
  const b = notice(detect(recaptchaPage), { ...where, id: 'c2', tabId: 'tab-2', profileId: 'work' })!
  assert.notEqual(a.tabId, b.tabId)
  assert.notEqual(a.profileId, b.profileId)
  const solvedA: CaptchaEncounter = recheck(askUser(a), clearPage)
  assert.equal(verified(solvedA), true)
  assert.equal(verified(b), false, 'a challenge dealt with in one tab is not dealt with in another')
})
