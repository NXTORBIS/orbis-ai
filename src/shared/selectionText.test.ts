import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { analysisExcerpt, readSelection, selectionPreview, ANALYSIS_LIMIT } from './selectionText.ts'
import { buildPalette, selectionAction, SELECTION_ACTIONS, type SelectionNeed } from './selectionActions.ts'
import { selectionRequest, translateAsk, REWRITE_TONES, TRANSLATE_INTO } from './selectionPrompts.ts'

const ALL: SelectionNeed[] = ['orion', 'search', 'notes', 'whiteboard', 'browser', 'clipboard']
const place = { url: 'https://example.org/article', title: 'An article' }

// ---------------------------------------------------------------- what the selection is

test('ordinary writing is prose, and is left exactly as it was', () => {
  const raw = '  The rain in Spain   stays mainly on the plain.  '
  const got = readSelection(raw)
  assert.equal(got.kind, 'prose')
  assert.equal(got.raw, raw, 'the selection itself must never be rewritten')
  assert.equal(got.normalized, 'The rain in Spain stays mainly on the plain.')
  assert.equal(got.words, 9)
})

test('one word on its own is a word, and several are not', () => {
  assert.equal(readSelection('entanglement').kind, 'word')
  assert.equal(readSelection('quantum entanglement').kind, 'prose')
})

test('code needs more than one sign of being code', () => {
  assert.equal(readSelection('const total = items.reduce((a, b) => a + b, 0);').kind, 'code')
  assert.equal(readSelection('function greet(name) {\n  return `hi ${name}`\n}').kind, 'code')
  // A sentence with a semicolon is still a sentence.
  assert.equal(readSelection('He came; she left.').kind, 'prose')
})

test('an equation is numbers and operators, not a sentence containing them', () => {
  assert.equal(readSelection('3x^2 + 5x - 2 = 0').kind, 'math')
  assert.equal(readSelection('sqrt(144) / 12').kind, 'math')
  assert.equal(readSelection('I have 2 apples and 3 pears').kind, 'prose')
})

test('a web address needs a scheme or a path', () => {
  assert.equal(readSelection('https://example.org/page?q=1').kind, 'url')
  assert.equal(readSelection('www.example.org').kind, 'url')
  assert.equal(readSelection('example.org/docs').kind, 'url')
  // A bare host could as easily be a name somebody wants searched, so it is not somewhere to go.
  assert.notEqual(readSelection('example.org').kind, 'url')
})

test('an email address is its own thing', () => {
  assert.equal(readSelection('someone@example.org').kind, 'email')
})

test('rows and columns are data', () => {
  assert.equal(readSelection('Jan\t12\t4\nFeb\t15\t7\nMar\t9\t3').kind, 'data')
  assert.equal(readSelection('a, b, c').kind, 'prose', 'one line is not a table')
})

test('dates are recognised in the forms people write them', () => {
  for (const one of ['2026-10-03', '3/10/2026', '12 March 2026', 'Mar 3, 2026']) {
    assert.equal(readSelection(one).kind, 'date', one)
  }
})

test('an address is a number, a street and a street word', () => {
  assert.equal(readSelection('221B Baker Street').kind, 'address')
  assert.equal(readSelection('Baker Street').kind, 'prose')
})

test('the script is reported, and never guessed for Latin text', () => {
  assert.equal(readSelection('வணக்கம் உலகம்').language, 'ta')
  assert.equal(readSelection('こんにちは').language, 'ja')
  assert.equal(readSelection('Hello there').language, null, 'Latin letters cannot tell you the language')
})

// ---------------------------------------------------------------- what must not be sent

test('things that look like secrets are caught', () => {
  assert.equal(readSelection('sk-live-ABCDEFGHIJKLMNOPQRSTUV').risk, 'secret')
  assert.equal(readSelection('ghp_abcdefghijklmnopqrstuvwxyz0123').risk, 'secret')
  assert.equal(readSelection('AKIAIOSFODNN7EXAMPLE').risk, 'secret')
  assert.equal(readSelection('-----BEGIN RSA PRIVATE KEY-----').risk, 'secret')
  assert.equal(readSelection('api_key = 8sdf7sdfkjh23kjh').risk, 'secret')
})

test('a card number is caught by its checksum, and a number of the same length is not', () => {
  assert.equal(readSelection('4242 4242 4242 4242').risk, 'card')
  assert.equal(readSelection('1234 5678 1234 5678').risk, 'none', 'this fails the checksum, so it is not a card number')
})

test('a password box is refused whatever is in it', () => {
  assert.equal(readSelection('hello', { inPasswordField: true }).risk, 'password-field')
})

test('ordinary writing about secrets is not treated as a secret', () => {
  assert.equal(readSelection('My API key is in the drawer upstairs.').risk, 'none')
  assert.equal(readSelection('Enter your password to continue.').risk, 'none')
  assert.equal(readSelection('The password reset link expires in an hour.').risk, 'none')
})

// ---------------------------------------------------------------- long selections

test('a long selection is excerpted from both ends and says how much is missing', () => {
  const raw = `${'a'.repeat(ANALYSIS_LIMIT * 2)}THE-END`
  const got = analysisExcerpt(raw)
  assert.equal(got.shortened, true)
  assert.ok(got.text.endsWith('THE-END'), 'the end of a passage carries the conclusion and must survive')
  assert.ok(got.text.includes('characters of the selection are not shown'))
  assert.ok(got.text.length < raw.length)
})

test('a selection that fits is not touched', () => {
  const got = analysisExcerpt('short')
  assert.equal(got.shortened, false)
  assert.equal(got.text, 'short')
})

test('a selection only just over the limit is sent whole rather than explained', () => {
  // The note saying what is missing is longer than the few characters leaving it out would save.
  const got = analysisExcerpt('a'.repeat(ANALYSIS_LIMIT + 5))
  assert.equal(got.shortened, false)
  assert.equal(got.text.length, ANALYSIS_LIMIT + 5)
})

test('the preview is short and ends with an ellipsis when it had to be cut', () => {
  assert.equal(selectionPreview('a short one'), 'a short one')
  const long = selectionPreview('word '.repeat(60))
  assert.ok(long.length <= 90)
  assert.ok(long.endsWith('…'))
})

// ---------------------------------------------------------------- which actions appear

test('a sensitive selection loses everything that would send it away', () => {
  const reading = readSelection('sk-live-ABCDEFGHIJKLMNOPQRSTUV')
  const palette = buildPalette({ reading, available: ALL })
  const shown = [...palette.top, ...palette.more]
  assert.ok(shown.length > 0, 'the local actions stay')
  assert.ok(
    shown.every((one) => !one.sends),
    `nothing that sends the text away may be offered, got ${shown.map((o) => o.id).join(', ')}`
  )
  assert.ok(shown.some((one) => one.id === 'copy'), 'copying it is still fine')
  assert.equal(palette.withheld, 'secret')
})

test('an action is not offered when what it needs is missing', () => {
  const reading = readSelection('Quantum entanglement is a physical phenomenon that occurs often.')
  const withoutOrion = buildPalette({ reading, available: ['browser', 'search', 'clipboard'] })
  const shown = [...withoutOrion.top, ...withoutOrion.more].map((one) => one.id)
  assert.ok(!shown.includes('explain'), 'Explain needs Orion')
  assert.ok(!shown.includes('note'), 'Save to Notes needs Notes')
  assert.ok(shown.includes('search'))
})

test('code is offered code actions first, and is not offered translating', () => {
  const reading = readSelection('const total = items.reduce((a, b) => a + b, 0);')
  const palette = buildPalette({ reading, available: ALL })
  assert.equal(palette.top[0]?.id, 'explain-code')
  const shown = [...palette.top, ...palette.more].map((one) => one.id)
  assert.ok(!shown.includes('translate'))
  assert.ok(!shown.includes('summarise'))
})

test('an equation is offered Solve first', () => {
  const palette = buildPalette({ reading: readSelection('3x^2 + 5x - 2 = 0'), available: ALL })
  assert.equal(palette.top[0]?.id, 'solve')
})

test('a web address is offered Open first', () => {
  const palette = buildPalette({ reading: readSelection('https://example.org/page'), available: ALL })
  assert.equal(palette.top[0]?.id, 'open')
})

test('one word is offered Define, and a paragraph is not', () => {
  const word = buildPalette({ reading: readSelection('entanglement'), available: ALL })
  assert.ok(word.top.some((one) => one.id === 'define'))
  const para = buildPalette({ reading: readSelection('word '.repeat(60)), available: ALL })
  assert.ok(![...para.top, ...para.more].some((one) => one.id === 'define'), 'defining a paragraph means nothing')
})

test('summarising needs enough text to be worth it', () => {
  const little = buildPalette({ reading: readSelection('Two words here.'), available: ALL })
  assert.ok(![...little.top, ...little.more].some((one) => one.id === 'summarise'))
  const lots = buildPalette({ reading: readSelection('word '.repeat(40)), available: ALL })
  assert.ok([...lots.top, ...lots.more].some((one) => one.id === 'summarise'))
})

test('translating is dropped when the text is already in your language', () => {
  const reading = readSelection('வணக்கம் உலகம், இது ஒரு சோதனை ஆகும்.')
  const forTamilReader = buildPalette({ reading, available: ALL, ownLanguage: 'ta' })
  assert.ok(![...forTamilReader.top, ...forTamilReader.more].some((one) => one.id === 'translate'))
  const forOthers = buildPalette({ reading, available: ALL, ownLanguage: 'en' })
  assert.ok([...forOthers.top, ...forOthers.more].some((one) => one.id === 'translate'))
})

test('pinned actions come first and hidden ones never appear', () => {
  const reading = readSelection('Quantum entanglement is a physical phenomenon that occurs often enough.')
  const palette = buildPalette({ reading, available: ALL, pinned: ['copy', 'search'], hidden: ['explain'] })
  assert.equal(palette.top[0]?.id, 'copy')
  assert.equal(palette.top[1]?.id, 'search')
  assert.ok(![...palette.top, ...palette.more].some((one) => one.id === 'explain'))
})

test('the palette keeps the top short and puts the rest behind More', () => {
  const reading = readSelection('word '.repeat(50))
  const palette = buildPalette({ reading, available: ALL, top: 4 })
  assert.equal(palette.top.length, 4)
  assert.ok(palette.more.length > 0)
  const ids = [...palette.top, ...palette.more].map((one) => one.id)
  assert.equal(new Set(ids).size, ids.length, 'no action may appear twice')
})

test('every action in the catalogue is reachable by its id and names a real icon', () => {
  for (const one of SELECTION_ACTIONS) {
    assert.equal(selectionAction(one.id)?.id, one.id)
    assert.ok(one.label.length <= 20, `${one.id} has a label too long for the palette`)
    assert.ok(one.icon !== '', `${one.id} has no icon`)
    assert.ok(one.needs.length > 0, `${one.id} claims to need nothing, which cannot be right`)
  }
})

// ---------------------------------------------------------------- what Orion is asked

test('the question carries the selected text and says what to do with it', () => {
  const reading = readSelection('Quantum entanglement is a physical phenomenon.')
  const got = selectionRequest('explain', reading, place)
  assert.ok(got.ask.includes('Quantum entanglement is a physical phenomenon.'))
  assert.ok(got.ask.includes('Explain what this means'))
  assert.equal(got.usedPage, false, 'explaining a sentence does not need to know where it was read')
})

test('checking a claim is told where it was read, and summarising is not', () => {
  const reading = readSelection('The company doubled its revenue last year, according to the report.')
  assert.equal(selectionRequest('check', reading, place).usedPage, true)
  assert.ok(selectionRequest('check', reading, place).ask.includes('example.org'))
  assert.equal(selectionRequest('summarise', readSelection('word '.repeat(40)), place).usedPage, false)
})

test('Ask uses what was typed, and falls back to something sensible when nothing was', () => {
  const reading = readSelection('A sentence.')
  assert.ok(selectionRequest('ask', reading, place, 'Turn this into a formal email.').ask.startsWith('Turn this into a formal email.'))
  assert.ok(selectionRequest('ask', reading, place, '   ').ask.startsWith('Answer this about the text below.'))
})

test('a long selection tells Orion that the middle is missing', () => {
  const reading = readSelection('x'.repeat(ANALYSIS_LIMIT + 500))
  const got = selectionRequest('summarise', reading, place)
  assert.ok(got.ask.includes('the middle of it is left out'))
})

test('an action that sends nothing has nothing to ask', () => {
  const reading = readSelection('hello')
  assert.throws(() => selectionRequest('copy', reading, place), /does not send/)
  assert.throws(() => selectionRequest('nonsense', reading, place), /no selection action/)
})

test('the choices offered for rewriting and translating are real and distinct', () => {
  assert.equal(new Set(REWRITE_TONES.map((one) => one.id)).size, REWRITE_TONES.length)
  assert.equal(new Set(TRANSLATE_INTO.map((one) => one.id)).size, TRANSLATE_INTO.length)
  assert.ok(translateAsk('ta').includes('Tamil'))
  assert.ok(translateAsk('xx').includes('xx'), 'an unknown code is passed through rather than invented')
})

test('the contextual surface offers understand it, find it, hand it on — in that order', () => {
  const palette = buildPalette({ reading: readSelection('Artificial intelligence is transforming education.'), available: ['orion', 'search', 'browser', 'clipboard'] })
  assert.deepEqual(palette.primary.map((one) => one.id), ['ask', 'search', 'share'])
  assert.deepEqual(palette.primary.map((one) => one.label), ['Ask Orion', 'Search in Orbis', 'Share highlighted'])
})

test('the three are the same three wherever you are, whatever the text is', () => {
  for (const text of ['https://example.org/a', 'const x = items.map((i) => i.id)', '2 + 2 = 4', 'A plain sentence about things.']) {
    const palette = buildPalette({ reading: readSelection(text), available: ['orion', 'search', 'browser', 'clipboard'] })
    assert.deepEqual(palette.primary.map((one) => one.id), ['ask', 'search', 'share'], text)
  }
})

test('one of the three that cannot run here is left out rather than drawn and refused', () => {
  const noOrion = buildPalette({ reading: readSelection('Some words here.'), available: ['search', 'browser', 'clipboard'] })
  assert.deepEqual(noOrion.primary.map((one) => one.id), ['search', 'share'])
  const nothing = buildPalette({ reading: readSelection('Some words here.'), available: [] })
  assert.deepEqual(nothing.primary, [])
})

test('a selection that looks like a secret keeps the local three and loses the one that sends', () => {
  const risky = buildPalette({ reading: readSelection('sk_live_abcdefghij1234567890'), available: ['orion', 'search', 'browser', 'clipboard'] })
  assert.ok(!risky.primary.some((one) => one.id === 'ask'), 'nothing that leaves the machine is offered')
  assert.ok(risky.primary.some((one) => one.id === 'share'), 'handing it on yourself is still yours to do')
})

test('the fuller palette keeps its own ordering, which the three do not disturb', () => {
  const url = buildPalette({ reading: readSelection('https://example.org/a'), available: ['orion', 'search', 'browser', 'clipboard'] })
  assert.equal(url.top[0].id, 'open', 'Open still leads for an address')
})
