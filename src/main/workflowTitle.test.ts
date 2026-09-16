import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideTitle,
  hasEnoughToName,
  MAX_TITLE,
  needsTitle,
  preferTitle,
  redact,
  shortenTitle,
  titleContext,
  titleIdentity,
  validateTitle,
  visibleLength
} from '../shared/workflowTitle.ts'
import { newWorkflow } from '../shared/workflows.ts'
import type { Workflow, WorkflowStep } from '../shared/workflows'
import type { TitleState } from '../shared/workflowTitle'

const action = (capability: string, params: Record<string, unknown> = {}): WorkflowStep =>
  ({ id: capability, name: capability, type: 'action', capability, params }) as WorkflowStep

const make = (changes: Partial<Workflow> = {}): Workflow & TitleState => ({ ...newWorkflow('Untitled workflow', 'w1', 1000), ...changes })

test('a title is only saved when it is one somebody could read', () => {
  assert.equal(validateTitle('Daily Email Summary'), 'Daily Email Summary')
  assert.equal(validateTitle('  "Price Change Monitor."  '), 'Price Change Monitor', 'quotes and trailing stops are not part of a name')
  assert.equal(validateTitle('Daily\nNews   Summary'), 'Daily News Summary')

  assert.equal(validateTitle('ab'), null, 'too short to mean anything')
  assert.equal(validateTitle('x'.repeat(41)), null, 'past the hard limit')
  assert.equal(validateTitle(''), null)
  assert.equal(validateTitle(null), null)
  assert.equal(validateTitle(42), null)
})

test('the names that say nothing are never saved, whoever produced them', () => {
  for (const nothing of ['Untitled', 'Untitled workflow', 'New Workflow', 'Workflow', 'Workflow 2', 'workflow3', 'Automation', 'Task 1', 'My workflow', 'Draft']) {
    assert.equal(validateTitle(nothing), null, `${nothing} is not a name`)
    assert.equal(needsTitle({ name: nothing }), true, `${nothing} means it still needs naming`)
  }
  assert.equal(needsTitle({ name: 'Daily Email Summary' }), false)
  assert.equal(needsTitle({ name: '   ' }), true)
})

test('a name is measured in what a person sees, not in bytes', () => {
  assert.equal(visibleLength('Daily Email Summary'), 19)
  // Tamil writes several code points as one character somebody sees; the count follows the eye, not the encoding.
  assert.equal(visibleLength('காலை செய்தி'), 6)
  assert.ok(visibleLength('காலை செய்தி') < [...'காலை செய்தி'].length, 'fewer characters than code points')
  assert.equal(visibleLength('🇮🇳 Daily'), 7, 'a flag is one character')

  // Right up to the limit, in a script where bytes and characters differ wildly.
  const tamil = 'அ'.repeat(MAX_TITLE)
  assert.equal(validateTitle(tamil), tamil, 'forty visible characters is forty, whatever the encoding')
  assert.equal(validateTitle('அ'.repeat(MAX_TITLE + 1)), null)
})

test('a name that is written in another language is left in that language', () => {
  // Nothing here translates or transliterates; validation only measures and tidies.
  for (const title of ['காலை செய்தி சுருக்கம்', 'दैनिक समाचार सारांश', 'Résumé des actualités']) {
    assert.equal(validateTitle(title), title)
  }
})

test('a name that is too long loses filler, not its meaning', () => {
  assert.equal(shortenTitle('Monitor Website Price Changes and Notify Me'), 'Monitor Website Price Changes Notify Me')
  assert.equal(shortenTitle('Every Morning Check My Gmail for Important Emails'), 'Every Morning Check Gmail for Important')

  // Whatever comes back is a valid title, and never cut through a word.
  for (const long of [
    'Every Morning Check My Gmail for Important Emails and Summarize Them All',
    'Collect All of the Technology Articles and Summarize Them for Me Please'
  ]) {
    const short = shortenTitle(long)
    assert.ok(short && visibleLength(short) <= MAX_TITLE, `${long} -> ${short}`)
    assert.ok(long.toLowerCase().includes(short!.split(' ')[0].toLowerCase()), 'it still begins with the subject')
    assert.ok(!short!.endsWith(' '), 'no dangling cut')
  }

  assert.equal(shortenTitle('x'.repeat(60)), null, 'one enormous word cannot be shortened into sense')
  assert.equal(shortenTitle('Daily Email Summary'), 'Daily Email Summary', 'one that already fits is left alone')
})

test('nothing secret reaches a name or the words Orion is given', () => {
  assert.match(redact('Send the password abc123 to Bob'), /\[removed\]/)
  assert.match(redact('Use api key = sk-abcdefghijklmnop'), /\[removed\]/)
  assert.match(redact('Open https://user:hunter2@intranet.example/reports'), /\[removed\]/)
  assert.match(redact('token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), /\[removed\]/)
  assert.doesNotMatch(redact('Summarise my unread email'), /\[removed\]/, 'ordinary words are left alone')

  // A candidate carrying something secret-shaped is refused outright rather than saved with a hole in it.
  assert.equal(validateTitle('Send password abc123'), null)

  const workflow = make({
    description: 'Send the password hunter2 to the new starter',
    steps: [action('page.type', { text: 'password is hunter2', url: 'https://mail.example.com' })]
  })
  const context = titleContext(workflow)
  assert.ok(!context.includes('hunter2'), 'the prompt never carries it either')
  assert.match(context, /\[removed\]/)
})

test('what a workflow is for is what it does, not how it does it', () => {
  const base = make({
    schedule: { enabled: true, kind: 'daily', at: 8 * 3600_000 },
    steps: [action('browser.open', { url: 'https://mail.google.com' }), action('page.read', { selector: '.msg' })]
  })
  const before = titleIdentity(base)

  // Everything here is implementation. None of it may change the name.
  const fiddled = make({
    schedule: { enabled: true, kind: 'daily', at: 9 * 3600_000 + 1800_000 },
    steps: [
      { ...action('browser.open', { url: 'https://mail.google.com' }), name: 'Open the mail', retry: { times: 5 }, timeoutMs: 60_000 } as unknown as WorkflowStep,
      action('page.read', { selector: '#different-selector' }),
      { id: 'w', name: 'Wait a moment', type: 'wait', ms: 4000 } as unknown as WorkflowStep,
      { id: 's', name: 'Set a thing', type: 'set', variable: 'n', value: 3 } as unknown as WorkflowStep
    ]
  })
  assert.equal(titleIdentity(fiddled), before, 'a later hour, new selectors, retries, a delay and a variable are not a new workflow')

  // Ordering equivalent steps is not a new workflow either.
  const reordered = make({ ...base, steps: [base.steps[1], base.steps[0]] })
  assert.equal(titleIdentity(reordered), before)
})

test('a workflow that becomes a different thing has a different identity', () => {
  const base = make({ steps: [action('browser.open', { url: 'https://mail.google.com' })] })
  const identity = titleIdentity(base)

  assert.notEqual(titleIdentity(make({ steps: base.steps, schedule: { enabled: true, kind: 'daily', at: 0 } })), identity, 'it now runs on a schedule')
  assert.notEqual(titleIdentity(make({ steps: base.steps, trigger: { type: 'appStart' } })), identity, 'something else sets it off')
  assert.notEqual(titleIdentity(make({ steps: [action('browser.open', { url: 'https://news.example.com' })] })), identity, 'it is about another service')
  assert.notEqual(
    titleIdentity(make({ steps: [...base.steps, { id: 'o', name: 'Ask', type: 'orion', prompt: 'Summarise', include: [], expects: 'value', saveAs: 'x' } as unknown as WorkflowStep] })),
    identity,
    'it now summarises, which it did not before'
  )
  assert.notEqual(titleIdentity(make({ steps: base.steps, outputs: [{ name: 'summary', type: 'string' } as never] })), identity, 'it now produces something')
})

test('Orion is told the purpose, not the plumbing', () => {
  const workflow = make({
    description: 'Every morning, read the technology news and summarise it',
    schedule: { enabled: true, kind: 'daily', at: 8 * 3600_000 },
    steps: [
      action('browser.open', { url: 'https://news.ycombinator.com' }),
      { id: 'o', name: 'Summarise', type: 'orion', prompt: 'Summarise the technology stories', include: ['pageText'], expects: 'value', saveAs: 'summary' } as unknown as WorkflowStep,
      { id: 'w', name: 'Pause', type: 'wait', ms: 500 } as unknown as WorkflowStep
    ],
    outputs: [{ name: 'summary', type: 'string' } as never]
  })
  const context = titleContext(workflow)
  assert.match(context, /Every morning/)
  assert.match(context, /Schedule: daily/)
  assert.match(context, /news\.ycombinator\.com/)
  assert.match(context, /Produces: summary/)
  assert.ok(!context.includes('Pause'), 'a delay is not part of what it is for')
  assert.ok(context.length < 2600, 'and it stays short enough to be a prompt')
})

test('when to ask Orion for a name, and when to leave it alone', () => {
  const rich = { schedule: { enabled: true, kind: 'daily' as const, at: 0 }, steps: [action('browser.open', { url: 'https://mail.google.com' })] }

  // Nothing to describe yet.
  assert.equal(decideTitle(make()).generate, false)
  assert.equal(hasEnoughToName(make()), false)

  // Unnamed, and enough of a workflow to describe.
  const fresh = make(rich)
  assert.equal(decideTitle(fresh).generate, true)

  // Named by Orion, unchanged since.
  const settled = make({ ...rich, name: 'Daily Email Summary', titleSource: 'ai', lastTitleContext: titleIdentity(make(rich)) })
  assert.equal(decideTitle(settled).generate, false)

  // Named by Orion, and now a different thing.
  const changed = make({ ...settled, steps: [action('browser.open', { url: 'https://news.example.com' })] })
  assert.equal(decideTitle(changed).generate, true)

  // Named by the user: never touched, however much it changes.
  const theirs = make({ ...changed, titleSource: 'user' })
  assert.equal(decideTitle(theirs).generate, false)
  assert.equal(decideTitle(make({ ...rich, name: 'Untitled workflow', titleSource: 'user' })).generate, false, 'even an empty-looking name is theirs if they chose it')
})

test('a new name has to be better than the old one, not merely different', () => {
  assert.equal(preferTitle('Daily Email Summary', 'Daily Email Summary'), 'Daily Email Summary')
  assert.equal(preferTitle('Daily Email Summary', 'Email Summary Daily'), 'Daily Email Summary', 'the same words rearranged is churn, not an improvement')
  assert.equal(preferTitle('Daily Email Summary', 'Morning News Digest'), 'Morning News Digest', 'a genuinely different name wins')
  assert.equal(preferTitle('Daily Email Summary', null), 'Daily Email Summary', 'a failed generation changes nothing')
  assert.equal(preferTitle('Untitled workflow', 'Daily Email Summary'), 'Daily Email Summary')
})

test('two workflows may share a name; the id is what tells them apart', () => {
  // Nothing here appends a number, because "Daily News Summary" is the right name for both of them.
  assert.equal(validateTitle('Daily News Summary'), 'Daily News Summary')
  assert.equal(preferTitle('Daily News Summary', 'Daily News Summary'), 'Daily News Summary')
})
