import { asPageHandle } from '../pageHandle.ts'
import { detect, safeSignals } from '../../shared/captcha.ts'
import type { PageSignals } from '../../shared/captcha.ts'
import { BrowserControl, fail } from './registry.ts'
import * as page from './page.ts'
import type { PageResolver } from './pageCapabilities.ts'
import type { PageHandle } from '../pageHandle.ts'

/**
 * Looking at a page to see whether it is asking for a person.
 *
 * Everything in this file reads. There is no capability here that ticks a box, answers a puzzle, submits a challenge,
 * or tells a site that verification happened — not because one was left for later, but because Orbis's answer to
 * "are you a person?" is to go and fetch one. What is offered instead is help finding the thing: bring the tab
 * forward, put the challenge on screen. The person does the rest, on the page, themselves.
 *
 * The script below is written to collect as little as it can get away with. It reads the addresses of frames and
 * scripts, the identifying attributes of elements, and visible words — never a form value, never a cookie, never a
 * response body — and what it does collect goes through `safeSignals` before anything else sees it.
 */

/**
 * What the page will say about itself.
 *
 * Addresses are cut at the query string in the page rather than afterwards, so a token in one never crosses into this
 * process at all. Element attributes are limited to the ones that identify a widget: id, class, name and the data
 * attributes providers use. Text is capped, because this is a shape-recognition job and a whole page of prose adds
 * nothing but risk.
 */
export const SIGNALS_SCRIPT = `(() => {
  const cut = (u) => { const s = String(u || ''); const i = s.search(/[?#]/); return i === -1 ? s : s.slice(0, i); };
  const frames = [];
  for (const el of document.querySelectorAll('iframe, frame')) {
    const src = cut(el.getAttribute('src'));
    if (src) frames.push(src);
    if (frames.length >= 30) break;
  }
  const scripts = [];
  for (const el of document.querySelectorAll('script[src]')) {
    const src = cut(el.getAttribute('src'));
    if (src) scripts.push(src);
    if (scripts.length >= 60) break;
  }
  const attributes = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('[id], [class], [name], [data-sitekey], [data-callback]')) {
    for (const value of [el.id, el.getAttribute('class'), el.getAttribute('name')]) {
      for (const part of String(value || '').split(/\\s+/)) {
        if (part && part.length < 60 && !seen.has(part)) { seen.add(part); attributes.push(part); }
      }
    }
    if (attributes.length >= 400) break;
  }
  const text = [];
  const body = document.body;
  if (body) {
    for (const piece of String(body.innerText || '').split(/\\n+/)) {
      const clean = piece.replace(/\\s+/g, ' ').trim();
      if (clean && clean.length < 200) text.push(clean);
      if (text.length >= 80) break;
    }
  }
  return { url: cut(location.href), title: String(document.title || '').slice(0, 200), frames, scripts, attributes, text };
})()`

/** Everything the page is prepared to say about itself, with anything secret-shaped already discarded. */
export async function readSignals(wc: PageHandle, status?: number): Promise<PageSignals> {
  const raw = await page.exec<PageSignals>(wc, SIGNALS_SCRIPT).catch(() => null)
  if (!raw) return safeSignals({ url: wc.getURL(), status })
  return safeSignals({ ...raw, status })
}

/** Puts the challenge on screen, so a person can get at it. Scrolling is not solving. */
const SCROLL_SCRIPT = `(() => {
  const wanted = ['iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="turnstile"]', 'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="arkoselabs"]', 'iframe[src*="funcaptcha"]', 'iframe[src*="awswaf"]', 'iframe[title*="captcha" i]',
    '.g-recaptcha', '.h-captcha', '.cf-turnstile', '.frc-captcha', '#geetest_holder', '[class*="captcha" i]', '[id*="captcha" i]'];
  for (const selector of wanted) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return { found: true, where: selector };
  }
  return { found: false };
})()`

/**
 * Registers what Orbis may do about a challenge, which is look at it and help the person reach it.
 *
 * None of these mutate anything a site would care about, so none of them ask for approval: reading a page and
 * scrolling it are what a browser does. Everything that would actually answer the challenge is left to the person,
 * because it is theirs to answer.
 */
export function registerCaptchaCapabilities(control: BrowserControl, resolve: PageResolver, unavailable: () => string | null = () => null): void {
  const common = { domain: 'captcha' as const, unavailable }
  const target = (ctx: { target?: { tabId?: string; webContentsId?: number } }): PageHandle => resolve(ctx)

  control.register({
    ...common,
    id: 'captcha.check',
    name: 'Check whether a page is asking to verify a person',
    description:
      'Looks at a tab and says whether it is showing a CAPTCHA or a verification challenge, which kind, from which provider, and how sure that is. Reads only: it never answers a challenge, and there is no capability in Orbis that does.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async (_p, ctx) => {
      const found = detect(await readSignals(target(ctx)))
      // The provider, the kind, the confidence and the reasons. Nothing about how it might be answered.
      return { provider: found.provider, kind: found.kind, confidence: found.confidence, present: found.present, reasons: found.reasons }
    }
  })

  control.register({
    ...common,
    id: 'captcha.show',
    name: 'Bring a challenge on screen',
    description: 'Scrolls a verification challenge into view so the person can reach it. It moves the page; it does not touch the challenge.',
    params: {},
    mutates: true,
    confirmation: 'none',
    describe: () => 'Scroll the verification challenge into view',
    run: async (_p, ctx) => {
      const wc = target(ctx)
      const found = await page.exec<{ found: boolean; where?: string }>(asPageHandle(wc), SCROLL_SCRIPT)
      if (!found.found) fail('not-found', 'There is nothing challenge-shaped on this page to scroll to.', true)
      return { shown: true }
    },
    verify: async (_data, _p, ctx) => {
      // Worth saying plainly: this confirms the page was scrolled, and says nothing at all about the challenge itself.
      const found = detect(await readSignals(target(ctx)))
      return { verified: true, detail: found.present ? 'The challenge is on screen and still waiting for a person.' : 'The page no longer shows a challenge.' }
    }
  })
}
