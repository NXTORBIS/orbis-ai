import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildable, checkCode, filesFor, MAX_CODE_BYTES } from './codePage.ts'
import type { CodeSpec } from './codePage.ts'

const ok = (over: Partial<CodeSpec> = {}): CodeSpec => ({
  title: 'Bouncing ball',
  purpose: 'Shows a ball bouncing under gravity.',
  body: '<canvas id="c" width="400" height="300"></canvas>',
  style: 'canvas { border-radius: 8px; }',
  script: "const c = document.getElementById('c'); c.getContext('2d').fillRect(0, 0, 10, 10)",
  notes: ['Gravity is constant and air resistance is ignored.'],
  ...over
})

const errorsOf = (spec: Partial<CodeSpec>): string[] => checkCode(spec).filter((p) => p.severity === 'error').map((p) => p.message)

test('an ordinary Page is buildable', () => {
  assert.deepEqual(errorsOf(ok()), [])
  assert.equal(buildable(checkCode(ok())), true)
})

test('nothing at all is refused rather than built empty', () => {
  assert.equal(buildable(checkCode(null)), false)
  assert.equal(buildable(checkCode({})), false)
  assert.equal(buildable(checkCode(ok({ body: '', script: '' }))), false)
})

// ---------------------------------------------------------------- the mistakes that produce a silent Page

test('a script tag in the body is refused, because the content policy would block it silently', () => {
  /*
   * The failure this exists to prevent: the markup loads, the inline script is refused by `script-src 'self'`, and the
   * Page sits there doing nothing with no error anybody sees.
   */
  const why = errorsOf(ok({ body: '<div></div><script>start()</script>' }))
  assert.equal(why.length, 1)
  assert.match(why[0], /inline scripts are blocked/)
})

test('an inline event handler is refused for the same reason', () => {
  assert.match(errorsOf(ok({ body: '<button onclick="go()">Go</button>' }))[0], /inline event handlers/)
})

test('a frame, an object or an external stylesheet is refused', () => {
  assert.equal(errorsOf(ok({ body: '<iframe src="https://x"></iframe>' })).length, 1)
  assert.equal(errorsOf(ok({ body: '<object data="x"></object>' })).length, 1)
  assert.equal(errorsOf(ok({ body: '<link rel="stylesheet" href="https://x/a.css">' })).length, 1)
})

// ---------------------------------------------------------------- what a Page may not reach for

test('a Page does not open its own connections, and is told what to do instead', () => {
  for (const code of ['fetch("https://x")', 'new XMLHttpRequest()', 'new WebSocket("wss://x")', 'new EventSource("/x")']) {
    const why = errorsOf(ok({ script: code }))
    assert.ok(why.length >= 1, code)
    assert.ok(
      why.some((m) => /orbis\.request|grants decide/.test(m)),
      `${code} should say what to do instead, said: ${why.join(' | ')}`
    )
  }
})

test('eval and its relatives are refused before the Page is built, not after', () => {
  // The content policy blocks these at runtime, so a Page using one would fail where nobody can see why.
  for (const code of ['eval("1+1")', 'new Function("return 1")', 'importScripts("/x.js")']) {
    assert.ok(errorsOf(ok({ script: code })).length >= 1, code)
  }
})

test('browser storage is refused, because what a Page remembers belongs to a profile', () => {
  for (const code of ['localStorage.setItem("a","b")', 'sessionStorage.clear()', 'indexedDB.open("x")']) {
    assert.ok(errorsOf(ok({ script: code })).length >= 1, code)
  }
})

test('device capabilities are a permission, not something the code takes', () => {
  for (const code of ['navigator.geolocation.getCurrentPosition(f)', 'navigator.mediaDevices.getUserMedia({})', 'navigator.clipboard.readText()']) {
    assert.ok(errorsOf(ok({ script: code })).length >= 1, code)
  }
})

test('window.open and document.write are refused', () => {
  assert.ok(errorsOf(ok({ script: 'window.open("https://x")' })).length >= 1)
  assert.ok(errorsOf(ok({ script: 'document.write("<p>x</p>")' })).length >= 1)
})

test('a Page that is too large is refused', () => {
  assert.ok(errorsOf(ok({ script: 'x'.repeat(MAX_CODE_BYTES + 1) })).length >= 1)
})

test('forgetting to say what it approximates is a warning, not a refusal', () => {
  // A Page that works and forgot its note is still a working Page.
  const problems = checkCode(ok({ notes: [] }))
  assert.equal(buildable(problems), true)
  assert.ok(problems.some((p) => p.severity === 'warning'))
})

// ---------------------------------------------------------------- the files

test('the files have fixed names, so nothing a model wrote is ever a path', () => {
  const files = filesFor(ok())
  assert.deepEqual(files.map((f) => f.path).sort(), ['index.html', 'page.css', 'page.js'])
})

test('the shell loads the script from its own file, deferred', () => {
  const html = filesFor(ok()).find((f) => f.path === 'index.html')!.content
  assert.match(html, /<script src="page\.js" defer><\/script>/)
  // And never inline, which the content policy would refuse.
  assert.ok(!/<script>[^<]/.test(html))
})

test('the title is escaped, so a title cannot close the tag it sits in', () => {
  const html = filesFor(ok({ title: 'Ball </title><script>alert(1)</script>' })).find((f) => f.path === 'index.html')!.content
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the markup is not reopened by a title')
  assert.match(html, /&lt;script&gt;/)
})

test('the code runs as it was written, inside what Orbis adds around it', () => {
  const js = filesFor(ok({ script: 'const answer = 42' })).find((f) => f.path === 'page.js')!.content
  assert.ok(js.includes('const answer = 42'), 'the code is not edited')
  // Said whether or not the code worked: a Page that reports its own failure is still a Page that started.
  assert.match(js, /window\.orbis\.ready\(\)/)
  assert.match(js, /catch \(error\)/)
  assert.match(js, /unhandledrejection/)
})

test('a Page that throws reports it rather than leaving a blank rectangle', () => {
  const js = filesFor(ok()).find((f) => f.path === 'page.js')!.content
  assert.match(js, /orbis-page-error/)
  const html = filesFor(ok()).find((f) => f.path === 'index.html')!.content
  assert.match(html, /id="orbis-page-error"/)
})

test("Orbis's own style comes first, and the Page may override it", () => {
  const css = filesFor(ok({ style: 'body { background: rebeccapurple; }' })).find((f) => f.path === 'page.css')!.content
  assert.ok(css.indexOf('body { margin: 0;') < css.indexOf('rebeccapurple'), 'the Page has the last word')
})
