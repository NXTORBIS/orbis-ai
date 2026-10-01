import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpolate, redact, validateParams } from '../../shared/browserControl.ts'
import type { Plan, RunState } from '../../shared/browserControl.ts'
import { BrowserControl, fail } from './registry.ts'
import { PlanRun, compare } from './runner.ts'

const approve = async (): Promise<boolean> => true
const decline = async (): Promise<boolean> => false

/** A tiny real state for the tests: a list of tabs the capabilities change. */
function makeControl(): { control: BrowserControl; tabs: string[] } {
  const tabs: string[] = []
  const control = new BrowserControl()
  control.registerState('tabs', () => [...tabs])
  control.register({
    id: 'tabs.create',
    domain: 'tabs',
    name: 'Open a tab',
    description: 'Opens a new tab',
    params: { url: { type: 'string', description: 'address', required: true } },
    mutates: true,
    confirmation: 'none',
    observe: () => tabs.length,
    run: (p) => {
      tabs.push(String(p.url))
      return { id: String(tabs.length) }
    },
    verify: (_d, p, _c, before) => ({ verified: tabs.length === (before as number) + 1 && tabs.at(-1) === p.url, detail: 'tab count grew' })
  })
  control.register({
    id: 'tabs.close',
    domain: 'tabs',
    name: 'Close a tab',
    description: 'Closes a tab',
    params: { url: { type: 'string', description: 'address', required: true } },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Close ${String(p.url)}`,
    run: (p) => {
      const i = tabs.indexOf(String(p.url))
      if (i < 0) fail('not-found', 'No such tab.')
      tabs.splice(i, 1)
    }
  })
  control.register({
    id: 'state.check',
    domain: 'state',
    name: 'Check a condition',
    description: 'Evaluates a condition against real state',
    params: { condition: { type: 'object', description: 'condition', required: true } },
    mutates: false,
    confirmation: 'none',
    run: (p) => {
      const c = p.condition as { check: string; url?: string; count?: number }
      if (c.check === 'tabExists') return { value: tabs.includes(String(c.url)) }
      return { value: false }
    }
  })
  return { control, tabs }
}

test('params are validated against the capability spec', () => {
  const spec = { url: { type: 'string' as const, description: 'u', required: true }, n: { type: 'integer' as const, description: 'n' }, mode: { type: 'string' as const, description: 'm', enum: ['a', 'b'] } }
  assert.equal(validateParams(spec, { url: 'x' }), null)
  assert.match(validateParams(spec, {}) ?? '', /required/)
  assert.match(validateParams(spec, { url: 'x', n: 1.5 }) ?? '', /whole number/)
  assert.match(validateParams(spec, { url: 'x', mode: 'c' }) ?? '', /one of/)
  assert.match(validateParams(spec, { url: 'x', extra: 1 }) ?? '', /Unknown parameter/)
})

test('interpolation keeps types for whole references and fills text for partial ones', () => {
  const vars = { list: [1, 2], page: { title: 'Hello' }, n: 3 }
  assert.deepEqual(interpolate('{{list}}', vars), [1, 2])
  assert.equal(interpolate('Title: {{page.title}} ({{n}})', vars), 'Title: Hello (3)')
  assert.deepEqual(interpolate({ a: ['{{n}}'] }, vars), { a: [3] })
  assert.equal(interpolate('{{missing}} x', vars), ' x')
})

test('redaction hides secrets and sensitive fields', () => {
  const out = redact({ password: 'hunter2', apiKey: 'k', text: 'typed', note: 'fine' }, new Set(['text'])) as Record<string, unknown>
  assert.equal(out.password, '[redacted]')
  assert.equal(out.apiKey, '[redacted]')
  assert.equal(out.text, '[redacted]')
  assert.equal(out.note, 'fine')
})

test('a mutating command succeeds only when verification against real state passes', async () => {
  const { control, tabs } = makeControl()
  const result = await control.execute({ capability: 'tabs.create', params: { url: 'https://a.test' } }, { confirm: approve })
  assert.equal(result.ok, true)
  assert.equal(result.verification?.verified, true)
  assert.deepEqual(tabs, ['https://a.test'])
  assert.deepEqual(await control.snapshot(['tabs']), { tabs: ['https://a.test'] })
})

test('unknown capabilities and bad params give structured errors', async () => {
  const { control } = makeControl()
  const unknown = await control.execute({ capability: 'tabs.teleport' }, { confirm: approve })
  assert.equal(unknown.error?.code, 'unknown-capability')
  assert.match(unknown.error?.message ?? '', /Similar: .*tabs\./)
  const bad = await control.execute({ capability: 'tabs.create', params: {} }, { confirm: approve })
  assert.equal(bad.error?.code, 'invalid-params')
})

test('consequential capabilities ask Orion and automations first, but not the user', async () => {
  const { control, tabs } = makeControl()
  tabs.push('https://a.test', 'https://b.test')
  let asked = ''
  const declined = await control.execute({ capability: 'tabs.close', params: { url: 'https://a.test' }, source: 'orion' }, { confirm: async (r) => ((asked = r.action), false) })
  assert.equal(declined.error?.code, 'declined')
  assert.equal(asked, 'Close https://a.test')
  assert.deepEqual(tabs, ['https://a.test', 'https://b.test'])
  const approved = await control.execute({ capability: 'tabs.close', params: { url: 'https://a.test' }, source: 'automation' }, { confirm: approve })
  assert.equal(approved.ok, true)
  const byUser = await control.execute({ capability: 'tabs.close', params: { url: 'https://b.test' }, source: 'user' }, { confirm: decline })
  assert.equal(byUser.ok, true)
  assert.deepEqual(tabs, [])
})

test('retries use alternatives and report how many attempts it took', async () => {
  const control = new BrowserControl()
  const seen: string[] = []
  control.register({
    id: 'page.click',
    domain: 'page',
    name: 'Click',
    description: 'Clicks an element',
    params: { selector: { type: 'string', description: 's' } },
    mutates: true,
    confirmation: 'none',
    run: (p) => {
      seen.push(String(p.selector))
      if (p.selector !== '#real') fail('not-found', 'No element.', true)
      return { clicked: true }
    }
  })
  const result = await control.execute({ capability: 'page.click', params: { selector: '#old' }, retry: { attempts: 2, delayMs: 1, alternatives: [{ selector: '#real' }] } }, { confirm: approve })
  assert.equal(result.ok, true)
  assert.equal(result.attempts, 3)
  assert.deepEqual(seen, ['#old', '#old', '#real'])
  assert.ok(control.recentLog().some((e) => e.phase === 'recovery'))
})

test('discovery lists capabilities with availability and searches them', () => {
  const { control } = makeControl()
  control.register({ id: 'window.minimize', domain: 'window', name: 'Minimize', description: 'Minimizes the window', params: {}, mutates: true, confirmation: 'none', unavailable: () => 'No window.', run: () => undefined })
  const found = control.list({ query: 'close tab' })
  assert.equal(found[0].id, 'tabs.close')
  const win = control.describe('window.minimize')
  assert.equal(win?.available, false)
  assert.equal(win?.unavailableReason, 'No window.')
  assert.equal(control.list({ availableOnly: true }).some((d) => d.id === 'window.minimize'), false)
})

test('plans pass data between steps, branch on real state and repeat for each item', async () => {
  const { control, tabs } = makeControl()
  const states: RunState[] = []
  const plan: Plan = {
    name: 'open list',
    variables: { urls: ['https://a.test', 'https://b.test', 'https://c.test'] },
    steps: [
      { repeat: { forEach: '{{urls}}', as: 'url' }, steps: [{ do: 'tabs.create', params: { url: '{{url}}' }, saveAs: 'last' }] },
      { if: { check: 'tabExists', url: 'https://b.test' }, then: [{ set: { sawB: true } }], else: [{ set: { sawB: false } }] },
      { set: { summary: 'last tab {{last.id}}' } }
    ]
  }
  const run = new PlanRun(plan, { control, source: 'automation', confirm: approve, emit: (s) => states.push(s) })
  const final = await run.start()
  assert.equal(final.status, 'completed')
  assert.deepEqual(tabs, ['https://a.test', 'https://b.test', 'https://c.test'])
  assert.equal(final.variables.sawB, true)
  assert.equal(final.variables.summary, 'last tab 3')
  assert.ok(states.some((s) => s.iteration === 3 && s.totalIterations === 3))
})

test('a failed critical step stops the run with its error; optional steps do not', async () => {
  const { control } = makeControl()
  const run = new PlanRun(
    { name: 'close', steps: [{ do: 'tabs.close', params: { url: 'nope' }, optional: true }, { do: 'tabs.close', params: { url: 'nope' } }, { set: { after: true } }] },
    { control, source: 'user', confirm: approve, emit: () => undefined }
  )
  const final = await run.start()
  assert.equal(final.status, 'failed')
  assert.equal(final.error?.code, 'not-found')
  assert.equal(final.variables.after, undefined)
})

test('runs can be paused, resumed and stopped after the current iteration', async () => {
  const { control, tabs } = makeControl()
  let run: PlanRun
  let paused = false
  run = new PlanRun(
    { name: 'forever', steps: [{ repeat: { forever: true }, steps: [{ do: 'tabs.create', params: { url: 'https://x.test/{{index}}' } }] }] },
    {
      control,
      source: 'automation',
      confirm: approve,
      emit: (s) => {
        if (s.iteration === 2 && !paused) {
          paused = true
          run.control('pause')
          setTimeout(() => run.control('resume'), 20)
        }
        if (s.iteration === 4) run.control('stop-after-iteration')
      }
    }
  )
  const final = await run.start()
  assert.equal(final.status, 'stopped')
  assert.equal(tabs.length, 4)
  assert.equal(paused, true)
})

test('repeat until and while use conditions; compare handles numbers, text and patterns', async () => {
  const { control, tabs } = makeControl()
  const final = await new PlanRun(
    { name: 'until', steps: [{ repeat: { until: { check: 'tabExists', url: 'https://x.test/2' }, max: 10 }, steps: [{ do: 'tabs.create', params: { url: 'https://x.test/{{index}}' } }] }] },
    { control, source: 'user', confirm: approve, emit: () => undefined }
  ).start()
  assert.equal(final.status, 'completed')
  assert.equal(tabs.length, 3)
  assert.equal(compare(10, '>', '9'), true)
  assert.equal(compare('Hello World', 'contains', 'world'), true)
  assert.equal(compare('order-1234', 'matches', '^order-\\d+$'), true)
  assert.equal(compare([1, 2], 'contains', 2), true)
})

test('a kind of action switched off is refused for Orion and automations, but never for the person', async () => {
  const { control } = makeControl()
  control.setSwitchedOff(['tabs'])
  assert.deepEqual(control.switchedOff(), ['tabs'])

  const listed = control.list({}, 'automation').find((c) => c.id === 'tabs.create')!
  assert.equal(listed.available, false, 'nothing can be planned around it')
  assert.match(listed.unavailableReason ?? '', /Switched off in Settings/)

  const refused = await control.execute({ capability: 'tabs.create', params: { url: 'https://example.com' } }, { source: 'automation', confirm: async () => true })
  assert.equal(refused.ok, false)
  assert.equal(refused.error?.code, 'blocked')
  assert.match(refused.error?.message ?? '', /switched off in Settings/)

  const mine = await control.execute({ capability: 'tabs.create', params: { url: 'https://example.com' } }, { source: 'user', confirm: async () => true })
  assert.equal(mine.ok, true, 'the person acting in Orbis is not blocked by it')

  control.setSwitchedOff([])
  assert.equal(control.list({}, 'automation').find((c) => c.id === 'tabs.create')!.available, true)
})

// ---------------------------------------------------------------- finding the right capability

test('a search for a thing puts the capabilities that are about it first', () => {
  /**
   * The list this returns is the menu the Orb plans from, so its order decides what the Orb reaches for.
   *
   * It used to count a word anywhere in the id, name, description or domain, which gave every capability that merely
   * mentioned a tab the same score of 1 and let alphabetical order decide. Asked for "tab", the browser answered
   * `browser.shortcut` before `tabs.create` -- and the Orb, asked to open a tab, sent a keystroke.
   */
  const control = new BrowserControl()
  control.register({
    id: 'tabs.create',
    domain: 'tabs',
    name: 'Open a tab',
    description: 'Opens a new tab',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: () => ({ ok: true })
  })
  control.register({
    id: 'browser.shortcut',
    domain: 'browser',
    name: 'Press a keyboard shortcut',
    // Mentions tabs, and is not about them. This is exactly the row that used to win.
    description: 'Sends a keyboard shortcut to the browser, such as the one that opens a tab or closes a tab',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: () => ({ ok: true })
  })
  control.register({
    id: 'captcha.check',
    domain: 'captcha',
    name: 'Check for human verification',
    description: 'Looks at the current tab for a verification challenge',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => ({ ok: true })
  })

  const found = control.list({ query: 'tab' }).map((d) => d.id)
  assert.equal(found[0], 'tabs.create', `got ${found.join(', ')}`)
  assert.ok(found.indexOf('tabs.create') < found.indexOf('browser.shortcut'))
  assert.ok(found.indexOf('tabs.create') < found.indexOf('captcha.check'))
})

test('a singular finds a plural domain, because nobody types the domain name', () => {
  const control = new BrowserControl()
  control.register({
    id: 'tabs.create',
    domain: 'tabs',
    name: 'Open a tab',
    description: 'Opens one',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: () => ({ ok: true })
  })
  assert.deepEqual(control.list({ query: 'tab' }).map((d) => d.id), ['tabs.create'])
  assert.deepEqual(control.list({ query: 'tabs' }).map((d) => d.id), ['tabs.create'])
})

test('a capability that only talks about something still appears, below the ones that do it', () => {
  // Being last is right; being absent would be wrong, because sometimes the mention is the answer.
  const control = new BrowserControl()
  control.register({
    id: 'downloads.list',
    domain: 'downloads',
    name: 'List downloads',
    description: 'What has been downloaded, and from which tab',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => ({ ok: true })
  })
  assert.deepEqual(control.list({ query: 'tab' }).map((d) => d.id), ['downloads.list'])
})

test('with no query, everything is listed', () => {
  const { control } = makeControl()
  assert.ok(control.list({}).length >= 2)
})
