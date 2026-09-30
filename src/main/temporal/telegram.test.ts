import assert from 'node:assert/strict'
import test from 'node:test'
import { postWebhook, sendTelegram, type TelegramReach } from './telegram.ts'

/**
 * Reaching somewhere that is not this computer's screen.
 *
 * Most of these are about the token: that it is read at the moment of sending, that a locked vault is a wait rather
 * than a failure to work around, and above all that it never appears in anything written down. A job's history ends
 * up in a profile export, so a credential printed into an error message is a credential handed to whoever receives
 * that file.
 */

const TOKEN = '123456:AAHfakefakefakefakefakefakefakefake'

function reach(over: Partial<TelegramReach> = {}, replies: { ok: boolean; status: number; body: string }[] = []): TelegramReach & { sent: { url: string; body: string }[] } {
  const sent: { url: string; body: string }[] = []
  let call = 0
  return {
    sent,
    token: () => ({ token: TOKEN }),
    fetch: async (url, init) => {
      sent.push({ url, body: init.body })
      const reply = replies[call++] ?? { ok: true, status: 200, body: '{"ok":true}' }
      return { ok: reply.ok, status: reply.status, text: async () => reply.body }
    },
    ...over
  }
}

test('a message is sent as plain text, to the chat that was given', async () => {
  const r = reach()
  const result = await sendTelegram(r, ' 987654 ', 'Time to stretch')
  assert.equal(result.ok, true)
  assert.equal(r.sent.length, 1)
  const body = JSON.parse(r.sent[0].body)
  assert.equal(body.chat_id, '987654', 'trimmed')
  assert.equal(body.text, 'Time to stretch')
  // Plain text on purpose: a message made of somebody's own words should not be read as markup.
  assert.ok(!('parse_mode' in body))
})

test('a locked vault is something to unlock, not something to fail at', async () => {
  const r = reach({ token: () => ({ token: null, because: 'locked' }) })
  const result = await sendTelegram(r, '1', 'x')
  assert.equal(result.ok, false)
  assert.match(result.detail, /Vault is locked/)
  assert.equal(r.sent.length, 0, 'and nothing was sent')
})

test('a missing token says what to add and what to call it', async () => {
  const r = reach({ token: () => ({ token: null, because: 'missing' }) })
  const result = await sendTelegram(r, '1', 'x')
  assert.match(result.detail, /no Telegram bot token/)
  assert.match(result.detail, /named/)
})

test('the token never appears in what is written down', async () => {
  /**
   * The one that matters. Telegram echoes the request path in some errors, and the path contains the token -- so a
   * failure written straight into a job's history puts a live credential into a file that is part of a profile
   * export.
   */
  const r = reach({}, [{ ok: false, status: 401, body: `{"description":"Unauthorized for https://api.telegram.org/bot${TOKEN}/sendMessage"}` }])
  const result = await sendTelegram(r, '1', 'x')
  assert.equal(result.ok, false)
  assert.ok(!result.detail.includes(TOKEN), result.detail)
  assert.match(result.detail, /401/)
})

test('a thrown error is also stripped of the token', async () => {
  const r = reach({
    fetch: async () => {
      throw new Error(`socket hang up calling https://api.telegram.org/bot${TOKEN}/sendMessage`)
    }
  })
  const result = await sendTelegram(r, '1', 'x')
  assert.ok(!result.detail.includes(TOKEN), result.detail)
})

test("Telegram's own reason is passed on, because each one needs something different", async () => {
  const r = reach({}, [{ ok: false, status: 400, body: '{"description":"Bad Request: chat not found"}' }])
  const result = await sendTelegram(r, '1', 'x')
  assert.match(result.detail, /chat not found/)
})

test('a schedule with no chat sends nothing', async () => {
  const r = reach()
  const result = await sendTelegram(r, '   ', 'x')
  assert.equal(result.ok, false)
  assert.equal(r.sent.length, 0)
})

test('a very long message is cut rather than refused', async () => {
  // Telegram refuses anything over about four thousand characters, and losing the reminder entirely is worse.
  const r = reach()
  await sendTelegram(r, '1', 'x'.repeat(9000))
  assert.equal(JSON.parse(r.sent[0].body).text.length, 4000)
})

// ---------------------------------------------------------------- webhooks

test('a webhook is posted to with both the field names that matter', async () => {
  const sent: { url: string; body: string }[] = []
  const result = await postWebhook(
    async (url, init) => {
      sent.push({ url, body: init.body })
      return { ok: true, status: 204, text: async () => '' }
    },
    'https://hooks.example/abc',
    'Backup finished'
  )
  assert.equal(result.ok, true)
  const body = JSON.parse(sent[0].body)
  // Slack reads `text`, Discord reads `content`. Sending both means the two people actually have work untouched.
  assert.equal(body.text, 'Backup finished')
  assert.equal(body.content, 'Backup finished')
})

test('a webhook that is not https is refused before anything is sent', async () => {
  let called = false
  const result = await postWebhook(
    async () => {
      called = true
      return { ok: true, status: 200, text: async () => '' }
    },
    'http://hooks.example/abc',
    'x'
  )
  assert.equal(result.ok, false)
  assert.equal(called, false, 'nothing left this computer in the clear')
  assert.match(result.detail, /https/)
})

test('a refusal carries the status and what the other end said', async () => {
  const result = await postWebhook(
    async () => ({ ok: false, status: 404, text: async () => 'no such hook' }),
    'https://hooks.example/gone',
    'x'
  )
  assert.equal(result.ok, false)
  assert.match(result.detail, /404/)
  assert.match(result.detail, /no such hook/)
})

test('a network failure is a failure with a reason, not a crash', async () => {
  const result = await postWebhook(
    async () => {
      throw new Error('getaddrinfo ENOTFOUND hooks.example')
    },
    'https://hooks.example/abc',
    'x'
  )
  assert.equal(result.ok, false)
  assert.match(result.detail, /ENOTFOUND/)
})
