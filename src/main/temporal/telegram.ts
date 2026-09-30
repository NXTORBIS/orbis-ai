/**
 * Sending a message to yourself on Telegram.
 *
 * Here because a notification needs a screen, and the whole difficulty with schedules is the times there is no screen
 * to show one on. Telegram is the one messaging service that needs no company account, no review process and no
 * server of its own: a bot you make in a minute, a token, and sending is a single web request from this computer.
 *
 * ## What it will not do
 *
 * **It never holds the token.** The token lives in the Secrets Vault, is read at the moment of sending, and is never
 * written into a schedule, a log line or an error message. A schedule says "send me a Telegram"; it does not carry
 * the means to do so.
 *
 * **It never works around a locked vault.** With the vault locked there is no token to read, and that is reported as
 * something waiting to be unlocked rather than worked around or remembered from last time.
 *
 * **It never reads messages, or sends to anybody else by default.** One direction, to a chat id somebody gave.
 */

/** Where the token is looked for in the vault. Matched on the name, so somebody can see what it is for. */
export const TELEGRAM_SECRET = /telegram/i

export interface TelegramReach {
  /** The bot token, read now, or null with a reason. */
  token(): { token: string } | { token: null; because: 'locked' | 'missing' }
  fetch(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
}

/**
 * Sends one message.
 *
 * Telegram answers with JSON that says whether it worked and, when it did not, why in a sentence -- a bad chat id, a
 * revoked token, the bot never having been spoken to. That sentence is passed on, because every one of those needs a
 * different thing from a person and "it did not work" needs nothing from anybody.
 */
export async function sendTelegram(
  reach: TelegramReach,
  chatId: string,
  message: string
): Promise<{ ok: boolean; detail: string }> {
  const held = reach.token()
  if (held.token === null) {
    return held.because === 'locked'
      ? { ok: false, detail: 'The Secrets Vault is locked, so Orbis could not read the Telegram token.' }
      : { ok: false, detail: 'There is no Telegram bot token in the Secrets Vault. Add one named “Telegram”.' }
  }
  if (!chatId.trim()) return { ok: false, detail: 'The schedule has no Telegram chat to send to.' }

  try {
    const response = await reach.fetch(`https://api.telegram.org/bot${held.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Plain text, deliberately: a message assembled from somebody's own words should not be parsed as markup.
      body: JSON.stringify({ chat_id: chatId.trim(), text: message.slice(0, 4000), disable_notification: false })
    })
    const raw = await response.text()
    if (response.ok) return { ok: true, detail: 'Sent on Telegram.' }
    /*
     * The reason, with the token taken out of it.
     *
     * Telegram echoes the request path in some errors, and the path contains the token. Printing that into a job's
     * history would put a live credential in a file that is part of a profile export.
     */
    const why = raw.replace(held.token, '…').slice(0, 200)
    return { ok: false, detail: `Telegram would not send it (${response.status}). ${why}`.trim() }
  } catch (error) {
    const message2 = error instanceof Error ? error.message : 'It did not work.'
    return { ok: false, detail: message2.replace(held.token, '…').slice(0, 200) }
  }
}

/**
 * Posts a message to an address somebody owns.
 *
 * A Slack or Discord incoming webhook, a home-automation hook, a script on a machine they run. `https` only, one
 * method, one body shape, no headers -- a schedule is not a way to make arbitrary requests as somebody.
 */
export async function postWebhook(
  fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>,
  url: string,
  message: string
): Promise<{ ok: boolean; detail: string }> {
  if (!/^https:\/\//i.test(url)) return { ok: false, detail: 'A webhook address must start with https://.' }
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      /*
       * `text` and `content` in one body.
       *
       * Slack reads `text`, Discord reads `content`, and anything else reads whichever it likes. Sending both means
       * the two services people actually have webhooks for work without Orbis needing to know which is which.
       */
      body: JSON.stringify({ text: message.slice(0, 2000), content: message.slice(0, 2000) })
    })
    if (response.ok) return { ok: true, detail: `Posted (${response.status}).` }
    const raw = (await response.text()).slice(0, 200)
    return { ok: false, detail: `The webhook refused it (${response.status}). ${raw}`.trim() }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : 'It did not work.' }
  }
}
