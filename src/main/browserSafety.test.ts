import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessAction } from './browserSafety.ts'
import type { ElementInfo } from './browserSafety.ts'

const el = (overrides: Partial<ElementInfo>): ElementInfo => ({
  tag: 'button',
  label: '',
  inForm: false,
  searchForm: false,
  submits: false,
  editable: false,
  ...overrides
})

const searchBox = el({ tag: 'input', type: 'search', name: 'search', label: 'Search Wikipedia', editable: true, inForm: true, searchForm: true })

test('searching runs without asking', () => {
  assert.equal(assessAction({ kind: 'type', element: searchBox, text: 'black holes', submit: true, flagged: false }).decision, 'run')
  assert.equal(assessAction({ kind: 'key', key: 'Enter', element: searchBox, flagged: false }).decision, 'run')
  const searchButton = el({ label: 'Search', submits: true, inForm: true, searchForm: true })
  assert.equal(assessAction({ kind: 'click', element: searchButton, flagged: false }).decision, 'run')
})

test('ordinary browsing runs without asking', () => {
  const article = el({ tag: 'a', href: 'https://en.wikipedia.org/wiki/Black_hole', label: 'Black hole' })
  const orders = el({ tag: 'a', href: 'https://www.amazon.com/orders', label: 'Order history' })
  const email = el({ tag: 'input', type: 'email', name: 'email', label: 'Email', editable: true, inForm: true })
  assert.equal(assessAction({ kind: 'click', element: article, flagged: false }).decision, 'run')
  assert.equal(assessAction({ kind: 'click', element: orders, flagged: false }).decision, 'run')
  assert.equal(assessAction({ kind: 'type', element: email, text: 'me@example.com', submit: false, flagged: false }).decision, 'run')
  assert.equal(assessAction({ kind: 'select', element: el({ tag: 'select', label: 'Size' }), option: 'Medium', flagged: false }).decision, 'run')
})

test('purchases, sending, posting, deleting and logging in ask first', () => {
  for (const label of ['Place order', 'Buy now', 'Send', 'Post', 'Delete', 'Book now', 'Sign in', 'Subscribe', 'Confirm booking']) {
    assert.equal(assessAction({ kind: 'click', element: el({ label }), flagged: false }).decision, 'confirm', label)
  }
  const deleteLink = el({ tag: 'a', href: 'https://example.com/account/delete', label: 'Delete account' })
  assert.equal(assessAction({ kind: 'click', element: deleteLink, flagged: false }).decision, 'confirm')
})

test('submitting a form other than a search asks first', () => {
  const submit = el({ label: 'Continue', submits: true, inForm: true })
  const message = el({ tag: 'textarea', label: 'Write a comment', editable: true, inForm: true })
  assert.equal(assessAction({ kind: 'click', element: submit, flagged: false }).decision, 'confirm')
  assert.equal(assessAction({ kind: 'type', element: message, text: 'Nice post', submit: true, flagged: false }).decision, 'confirm')
  assert.equal(assessAction({ kind: 'key', key: 'Enter', element: message, flagged: false }).decision, 'confirm')
  assert.equal(assessAction({ kind: 'key', key: 'Enter', element: el({ label: 'Buy now' }), flagged: false }).decision, 'confirm')
})

test('passwords, codes and payment details are never typed', () => {
  const fields = [
    el({ tag: 'input', type: 'password', label: 'Password', editable: true }),
    el({ tag: 'input', autocomplete: 'cc-number', label: 'Card', editable: true }),
    el({ tag: 'input', name: 'otp', label: 'Enter the code', editable: true }),
    el({ tag: 'input', label: 'CVV', editable: true })
  ]
  for (const element of fields) {
    assert.equal(assessAction({ kind: 'type', element, text: '1234', submit: false, flagged: false }).decision, 'block', element.label)
  }
})

test('asks whenever the model is unsure about an otherwise ordinary action', () => {
  const link = el({ tag: 'a', href: 'https://example.com/next', label: 'Next' })
  assert.equal(assessAction({ kind: 'click', element: link, flagged: true }).decision, 'confirm')
  assert.equal(assessAction({ kind: 'select', element: el({ tag: 'select', label: 'Plan' }), option: 'Pro', flagged: true }).decision, 'confirm')
})
