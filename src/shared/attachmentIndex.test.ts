import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chooseContext, contextFrom, passagesOf, scorePassages } from './attachmentIndex.ts'

/**
 * Attachments used to be flattened: every file's text, one after another, until the budget ran out. With one short
 * file that works. With several it fails twice -- the later files are cut to nothing, and the model has to find the
 * relevant paragraph itself inside sixty thousand characters, which is what it is worst at.
 */

const BUDGET = /* chars */ 4000

const CONTRACT = {
  name: 'contract.txt',
  text: [
    'This agreement is made between the parties named below and takes effect on signature.',
    'The supplier shall deliver the goods within thirty days of the order being placed.',
    'Payment terms are net sixty days from the date of a correctly rendered invoice.',
    'Either party may terminate with ninety days written notice to the other.'
  ].join('\n\n')
}

const PRICES = {
  name: 'prices.csv',
  text: ['item,price,currency', 'widget,40000,INR', 'gadget,55000,INR', 'sprocket,12000,INR'].join('\n')
}

const NOTES = { name: 'notes.txt', text: 'Reminder to water the plants on Thursday and to call the plumber about the kitchen tap.' }

test('a file is cut at its own paragraph breaks, because that is where its author changed subject', () => {
  const parts = passagesOf(CONTRACT)
  assert.ok(parts.length >= 1)
  assert.ok(parts.every((one) => one.file === 'contract.txt'))
  assert.ok(parts[0].text.includes('This agreement'))
})

test('a huge unbroken block is cut by length rather than sent whole', () => {
  const parts = passagesOf({ name: 'big.txt', text: Array.from({ length: 400 }, (_, i) => `row ${i} some text here`).join('\n') })
  assert.ok(parts.length > 1, `expected several passages, got ${parts.length}`)
})

test('a word that is in every passage counts for almost nothing; a rare one points at the answer', () => {
  const parts = scorePassages('payment terms invoice', passagesOf(CONTRACT))
  const best = [...parts].sort((a, b) => b.score - a.score)[0]
  assert.ok(best.text.includes('Payment terms'), best.text)
})

test('the part of a file that answers the question is what gets sent, not the whole file', () => {
  const chosen = chooseContext('what are the payment terms?', [CONTRACT], BUDGET)
  const text = contextFrom(chosen)
  assert.ok(text.includes('Payment terms are net sixty days'), text)
})

test('every file gets a hearing, so a long one cannot crowd out the short one with the answer', () => {
  const long = { name: 'long.txt', text: Array.from({ length: 200 }, (_, i) => `Paragraph ${i} about delivery and supply and goods and orders.`).join('\n\n') }
  const chosen = chooseContext('when should I call the plumber?', [long, NOTES], 1500)
  assert.ok(
    chosen.passages.some((one) => one.file === 'notes.txt'),
    `the short file was crowded out: ${chosen.passages.map((p) => p.file).join(', ')}`
  )
})

test('a file that was searched and had nothing is said, not silently dropped', () => {
  const chosen = chooseContext('what are the payment terms?', [CONTRACT, NOTES], BUDGET)
  assert.ok(chosen.nothingIn.includes('notes.txt'), JSON.stringify(chosen.nothingIn))
  assert.ok(contextFrom(chosen).includes('had nothing matching'), 'silence looks like agreement')
})

test('each passage says which file it came from, so an answer can name its source', () => {
  const text = contextFrom(chooseContext('price of a gadget', [PRICES, CONTRACT], BUDGET))
  assert.ok(text.includes('file="prices.csv"'), text.slice(0, 300))
})

test('nothing is reworded: the passages are the files’ own words', () => {
  const text = contextFrom(chooseContext('termination notice', [CONTRACT], BUDGET))
  assert.ok(text.includes('Either party may terminate with ninety days written notice to the other.'), text)
})

test('the budget is respected, so several files cannot push the message past what fits', () => {
  const files = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, text: 'delivery goods order supply payment invoice terms. '.repeat(200) }))
  const chosen = chooseContext('payment terms', files, 2000)
  const total = chosen.passages.reduce((n, one) => n + one.text.length, 0)
  assert.ok(total <= 2000 + 900, `sent ${total}`)
})

test('files with nothing in them are reported rather than quietly ignored', () => {
  const chosen = chooseContext('anything', [{ name: 'empty.txt', text: '   ' }], BUDGET)
  assert.deepEqual(chosen.passages, [])
  assert.deepEqual(chosen.nothingIn, ['empty.txt'])
})

test('a question with no distinctive words still returns the start of each file rather than nothing', () => {
  const chosen = chooseContext('what is it about', [CONTRACT, NOTES], BUDGET)
  assert.ok(chosen.passages.length >= 2, 'both files are represented')
})
