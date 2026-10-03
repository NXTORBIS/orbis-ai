import { asPageHandle } from '../pageHandle.ts'
import type { PageHandle } from '../pageHandle.ts'
import type { ParamSpec } from '../../shared/browserControl.ts'
import { assessAction } from '../browserSafety.ts'
import { BrowserControl, fail } from './registry.ts'
import type { Assessment, ControlContext } from './registry.ts'
import * as page from './page.ts'
import type { Locator } from './page.ts'

const LOCATOR: ParamSpec = {
  type: 'object',
  description:
    'Which element: any of { ref (number from page.snapshot), selector (CSS), xpath, role (ARIA role), name (accessible name), text, label, placeholder, index (0-based among matches), exact }. The first method that matches is used.',
  required: true
}
const TAB: Record<string, ParamSpec> = {}

/**
 * Whether a locator actually says which element it means.
 *
 * `{}` is an object, and an object is truthy, so an empty locator used to be taken for a real one: every lookup found
 * nothing, and `page.waitFor` sat out its full fifteen seconds waiting for an element that was never described. From
 * the outside that reads as a slow page rather than as a question with nothing in it, so it was tried again, twice.
 *
 * An empty locator is not a locator. Saying so turns a quarter-minute of waiting into an immediate answer that names
 * what is missing.
 */
/** The ways an element can be named. Anything else in a locator is a word nobody here understands. */
const LOCATOR_KEYS = ['ref', 'selector', 'xpath', 'role', 'name', 'text', 'label', 'placeholder'] as const

/**
 * The names a model reaches for that mean one of the above.
 *
 * Found by watching it happen: a plan wrote `{ "css": ".red-card" }`, which is a reasonable thing to call a CSS
 * selector and is not what this layer calls it. Unrecognised, it described nothing -- so the step waited fifteen
 * seconds for an element it had never actually asked for, and the failure said the page never showed what was
 * expected. Accepting the synonym is cheaper for everyone than being right about the spelling.
 */
const LOCATOR_SYNONYMS: Record<string, (typeof LOCATOR_KEYS)[number]> = {
  css: 'selector',
  cssSelector: 'selector',
  query: 'selector',
  querySelector: 'selector',
  path: 'xpath',
  accessibleName: 'name',
  ariaLabel: 'label',
  content: 'text',
  textContent: 'text',
  innerText: 'text'
}

/** A locator with the synonyms folded into the real names, so the rest of this file only knows one vocabulary. */
function asLocator(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[LOCATOR_SYNONYMS[key] ?? key] = v
  }
  return out
}

/** Which keys in a locator mean nothing here, for a complaint that names them. */
function unknownLocatorKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const known = new Set<string>([...LOCATOR_KEYS, 'exact', 'index'])
  return Object.keys(asLocator(value)).filter((key) => !known.has(key))
}

function describesAnElement(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(asLocator(value)).some(([key, v]) => {
    // `exact` and `index` only narrow a match; neither finds one on its own.
    if (key === 'exact' || key === 'index') return false
    if (!(LOCATOR_KEYS as readonly string[]).includes(key)) return false
    if (typeof v === 'string') return v.trim().length > 0
    return v !== undefined && v !== null
  })
}

/** The complaint for a locator that cannot find anything, naming what was wrong with it. */
function whyNotALocator(value: unknown): string {
  const unknown = unknownLocatorKeys(value)
  if (unknown.length) {
    return `A locator has no "${unknown.join('", "')}". Use one of: ${LOCATOR_KEYS.join(', ')}.`
  }
  return 'The locator does not say which element to find. Give a selector, role, name, text or ref.'
}

/** Finds the page a capability acts on: the command's target, or the active tab. Electron and Chromium each provide their own. */
export type PageResolver = (ctx: Pick<ControlContext, 'target'>) => PageHandle

const quote = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return `“${clean.length > 60 ? `${clean.slice(0, 57)}…` : clean}”`
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'this page'
  } catch {
    return 'this page'
  }
}

async function located(wc: PageHandle, locator: unknown): Promise<{ ref: number; method: string; count: number; target: page.TargetInfo }> {
  /*
   * Refused here, before the page is searched, when the locator cannot name anything.
   *
   * Every capability that acts on an element comes through this one function, so this is the place that gets it right
   * once. A locator whose only key is a word this layer does not know -- `css` for a selector, say -- used to be
   * searched for anyway, matched nothing, and came back as "no element matches", which is a true statement about a
   * question nobody asked. Now it says which word was wrong and which words work, which a re-plan can act on.
   */
  if (!describesAnElement(locator)) fail('invalid-params', whyNotALocator(locator))
  const found = await page.locate(asPageHandle(wc), asLocator(locator) as Locator)
  if ('error' in found) fail('not-found', found.error, true)
  return found as { ref: number; method: string; count: number; target: page.TargetInfo }
}

/** Arms a one-time check that a real click reaches the element (or something inside it). */
/*
 * Listens for the click, so afterwards there is evidence it landed rather than a guess.
 *
 * Found through the deep walk, not `document.querySelector`: a plain query cannot see into a shadow root or a frame,
 * so for anything in one no listener was armed, no evidence was ever recorded, and the click fell through to being
 * "verified" by the page happening to be busy. The flag is set on the top window from wherever the element lives, so
 * one place is read afterwards whichever document the element was in.
 */
export const armClickScript = (ref: number): string => `(() => {
  ${page.DEEP}
  const el = orbisDeepOne('[data-orbis-ref="${ref}"]');
  if (!el) return false;
  const top = (() => { try { return window.top || window } catch (e) { return window } })();
  top.__orbisClickSeen = false;
  const seen = () => { try { top.__orbisClickSeen = true } catch (e) { window.__orbisClickSeen = true } };
  for (const type of ['click', 'mousedown', 'pointerdown', 'contextmenu', 'dblclick']) el.addEventListener(type, seen, { once: true, capture: true });
  return true;
})()`

const actionName = (target: page.TargetInfo): string => quote(target.label || (target.href ? page.displayUrl(target.href) : target.tag))

/**
 * Webpage control through the Browser Control Layer: reading, finding elements, clicking, typing, choosing, checking,
 * submitting, scrolling, dragging, selecting text, extracting data, waiting, the accessibility tree, screenshots and
 * the page's source. Consequential page actions (submitting non-search forms, buying, sending, signing in…) are judged
 * by the same safety policy as Orion's browser agent and need the user's approval; passwords, payment details and
 * one-time codes are never typed by Orbis.
 */
export function registerPageCapabilities(control: BrowserControl, resolve: PageResolver): void {
  const tab = (ctx: ControlContext): PageHandle => resolve(ctx)
  const pageUnavailable = (ctx: Pick<ControlContext, 'target'>): string | null => {
    try {
      resolve(ctx)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'No page.'
    }
  }
  const safety = async (params: Record<string, unknown>, ctx: ControlContext, kind: 'click' | 'type' | 'select' | 'key'): Promise<Assessment> => {
    if (ctx.source === 'user') return { decision: 'run', reason: '' }
    const wc = tab(ctx)
    let element = null
    if (params.locator) {
      const found = await page.locate(asPageHandle(wc), params.locator as Locator)
      if (!('error' in found)) element = found.target
    } else element = await page.exec<page.TargetInfo | null>(asPageHandle(wc), page.ACTIVE_SCRIPT).catch(() => null)
    // Without an element there is nothing to act on: the action itself reports that it wasn't found.
    if (!element && kind !== 'key') return { decision: ctx.flagged ? 'confirm' : 'run', reason: ctx.flagged ? 'Orbis thinks this action could have an effect outside the browser.' : '' }
    const verdict = assessAction(
      kind === 'type'
        ? { kind: 'type', element: element!, text: String(params.text ?? ''), submit: params.submit === true, flagged: ctx.flagged === true }
        : kind === 'select'
          ? { kind: 'select', element: element!, option: String(params.option ?? ''), flagged: ctx.flagged === true }
          : kind === 'key'
            ? { kind: 'key', key: (params.keys as string[] | undefined)?.includes('Enter') ? 'Enter' : String((params.keys as string[] | undefined)?.[0] ?? ''), element, flagged: ctx.flagged === true }
            : { kind: 'click', element: element!, flagged: ctx.flagged === true }
    )
    return { decision: verdict.decision, reason: 'reason' in verdict ? verdict.reason : '' }
  }
  const common = { domain: 'page' as const, requires: ['web-page' as const], unavailable: pageUnavailable }

  control.register({
    ...common,
    id: 'page.read',
    name: 'Read the page',
    description: "Reads the tab's current URL, title, visible text and the text the user has selected.",
    params: { maxChars: { type: 'integer', description: 'Most text to return (default 20000).' }, ...TAB },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const read = await page.exec<{ url: string; title: string; text: string }>(asPageHandle(wc), page.extractScript(undefined, undefined, undefined, 1), 20_000)
      const selection = await page.exec<string>(asPageHandle(wc), `String(window.getSelection() || '').slice(0, 5000)`, 5_000).catch(() => '')
      return { ...read, text: read.text.slice(0, Math.min(Number(p.maxChars) || 20_000, 100_000)), selection, loading: wc.isLoading() }
    }
  })

  control.register({
    ...common,
    id: 'page.snapshot',
    name: 'Snapshot interactive elements',
    description: 'Numbers the visible interactive elements (links, buttons, fields…) with their labels and values, for refs in later actions.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async (_p, ctx) => page.snapshot(asPageHandle(tab(ctx)))
  })

  control.register({
    ...common,
    id: 'page.find',
    name: 'Find an element',
    description: 'Finds an element by ref, CSS selector, XPath, role, accessible name, text, label or placeholder; returns its ref, how it was found, how many matched and what it is.',
    params: { locator: LOCATOR },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const found = await located(tab(ctx), p.locator)
      return { ref: found.ref, method: found.method, matches: found.count, element: found.target }
    }
  })

  control.register({
    ...common,
    id: 'page.click',
    name: 'Click an element',
    description: 'Clicks an element with a real mouse click (button: left, right or middle; clickCount 2 double-clicks). Asks first when the click submits, buys, sends, deletes or signs in.',
    params: { locator: LOCATOR, button: { type: 'string', description: 'left (default), right or middle', enum: ['left', 'right', 'middle'] }, clickCount: { type: 'integer', description: '1 (default) or 2 for a double-click' } },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Click ${JSON.stringify(p.locator)}`,
    assess: (p, ctx) => safety(p, ctx, 'click'),
    observe: async (_p, ctx) => ({ url: tab(ctx).getURL() }),
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      await page.exec(asPageHandle(wc), armClickScript(found.ref))
      const button = (p.button as page.MouseButton | undefined) ?? 'left'
      const count = Math.min(2, Math.max(1, Number(p.clickCount) || 1))
      // Pointer input only reaches a page that is on screen. When something covers the element's centre, or the page is
      // hidden (the window is minimized or covered), the element's own click is used instead: exactly one click, never both.
      const hidden = (await page.exec<string>(asPageHandle(wc), 'document.visibilityState').catch(() => 'visible')) === 'hidden'
      const scripted = (found.target.covered || hidden) && button === 'left'
      if (hidden && button !== 'left') fail('unavailable', 'The page is hidden (Orbis is minimized or covered), so a right or middle click can’t be delivered. Show Orbis and try again.', true)
      // The same deep walk: an element in a shadow root or a frame was simply not found here, so the fallback click
      // did nothing at all and the action reported success having done nothing.
      if (scripted)
        await page.exec(
          asPageHandle(wc),
          `(() => { ${page.DEEP} const el = orbisDeepOne('[data-orbis-ref="${found.ref}"]'); if (!el) return false; el.${count === 2 ? "dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))" : 'click()'}; return true })()`
        )
      else page.mouseClick(asPageHandle(wc), found.target.x, found.target.y, button, count)
      return { element: found.target, method: found.method, delivered: scripted ? 'element click' : 'pointer' }
    },
    verify: async (data, _p, ctx, before) => {
      const wc = tab(ctx)
      await page.sleep(250)
      /*
       * What counts as evidence that the click landed.
       *
       * The address changing does: a click that navigated plainly reached something. The page merely being busy does
       * NOT, and used to -- which meant a click on an element nothing could reach was reported as verified whenever
       * the page happened to be loading at that moment. That is the exact shape of a false success, so it is gone.
       */
      const navigated = wc.getURL() !== (before as { url: string }).url
      const seen = navigated || (await page.exec<boolean>(asPageHandle(wc), 'window.__orbisClickSeen === true', 3000).catch(() => false))
      await page.settle(asPageHandle(wc), ctx.signal, true)
      return { verified: seen, detail: seen ? `The click reached ${actionName((data as { element: page.TargetInfo }).element)}${navigated ? ' and the page navigated' : ''}.` : 'The click did not reach the element (something may be covering it, or the page changed).' }
    }
  })

  control.register({
    ...common,
    id: 'page.hover',
    name: 'Hover over an element',
    description: 'Moves the mouse over an element (to open hover menus or tooltips).',
    params: { locator: LOCATOR },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      page.mouseMove(asPageHandle(wc), found.target.x, found.target.y)
      return { ref: found.ref }
    },
    verify: async (data, _p, ctx) => {
      await page.sleep(150)
      const hovered = await page.exec<boolean>(asPageHandle(tab(ctx)), `(() => { const el = document.querySelector('[data-orbis-ref="${(data as { ref: number }).ref}"]'); return !!el && (el.matches(':hover') || !!el.querySelector(':hover')); })()`).catch(() => false)
      return { verified: hovered, detail: hovered ? 'The element is under the pointer.' : 'The pointer is not over the element.' }
    }
  })

  control.register({
    ...common,
    id: 'page.focus',
    name: 'Focus an element',
    description: 'Puts keyboard focus on an element.',
    params: { locator: LOCATOR },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      if (!(await page.exec<boolean>(asPageHandle(wc), page.focusScript(found.ref)))) fail('failed', "That element can't take focus.", true)
      return { ref: found.ref, element: found.target }
    }
  })

  control.register({
    ...common,
    id: 'page.type',
    name: 'Type into a field',
    description: 'Types text into a field (replacing its contents unless append is true); submit presses Enter afterwards. Never types passwords, payment details or one-time codes.',
    params: {
      locator: LOCATOR,
      text: { type: 'string', description: 'The text to type.', required: true, sensitive: true },
      append: { type: 'boolean', description: 'Add to the existing text instead of replacing it.' },
      submit: { type: 'boolean', description: 'Press Enter afterwards.' }
    },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Type ${quote(String(p.text))} into ${JSON.stringify(p.locator)}${p.submit ? ' and press Enter' : ''}`,
    assess: (p, ctx) => safety(p, ctx, 'type'),
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      if (!found.target.editable) fail('invalid-params', `${actionName(found.target)} is not a text field.`)
      const text = String(p.text)
      if (p.append) await page.exec(asPageHandle(wc), `(() => { const el = document.querySelector('[data-orbis-ref="${found.ref}"]'); el.focus(); if (typeof el.setSelectionRange === 'function' && el.value !== undefined) el.setSelectionRange(el.value.length, el.value.length); return true; })()`)
      else if (!(await page.exec<boolean>(asPageHandle(wc), page.focusScript(found.ref)))) fail('failed', "Couldn't focus that field.", true)
      const existing = p.append ? String((await page.exec<string>(asPageHandle(wc), `document.querySelector('[data-orbis-ref="${found.ref}"]').value ?? ''`).catch(() => '')) ?? '') : ''
      await wc.insertText(text)
      // Typed input doesn't always land (for example when the tab isn't focused); set the value directly if it didn't.
      await page.exec(asPageHandle(wc), page.fillScript(found.ref, existing + text))
      if (p.submit) {
        // Quiet first, then Enter.
        //
        // A key event goes to whatever the page is at the moment it arrives, and a page that is still loading has no form
        // to submit yet. Waiting costs almost nothing on a page that is already quiet.
        //
        // `pressNamedKey` now waits for the key to be delivered before it returns, which is the part that actually
        // matters here -- it used to return with the key still queued, so the verification below read the page before the
        // press had happened.
        //
        // Deliberately not a retry. Pressing Enter twice on a form that is not a search is a second order, a second
        // message or a second payment, and no amount of convenience is worth that.
        await page.settle(asPageHandle(wc), ctx.signal)
        const fromUrl = wc.getURL()
        await page.pressNamedKey(asPageHandle(wc), 'Enter')
        // And wait for the submission to become a navigation, or to turn out not to be one.
        await page.settleSubmission(asPageHandle(wc), fromUrl, ctx.signal)
      }
      // What was typed is never part of the result (it can be private); verification reads it from the call's own parameters.
      return { ref: found.ref, existingLength: existing.length, submitted: p.submit === true }
    },
    verify: async (data, p, ctx) => {
      const d = data as { ref: number; existingLength: number; submitted: boolean }
      if (d.submitted) {
        await page.settle(asPageHandle(tab(ctx)), ctx.signal)
        return { verified: true, detail: 'Typed and pressed Enter; the page handled the submission.' }
      }
      const value = await page.exec<string | null>(asPageHandle(tab(ctx)), `(() => { const el = document.querySelector('[data-orbis-ref="${d.ref}"]'); return el ? (el.isContentEditable ? el.innerText : el.value) : null; })()`).catch(() => null)
      const normal = (s: string): string => s.replace(/\s+/g, ' ').trim()
      const ok = value !== null && normal(value.slice(d.existingLength)) === normal(String(p.text))
      return { verified: ok, detail: ok ? `The field now holds the ${String(p.text).length} typed characters.` : 'The field does not hold the typed text.' }
    }
  })

  control.register({
    ...common,
    id: 'page.clear',
    name: 'Clear a field',
    description: 'Empties a text field.',
    params: { locator: LOCATOR },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      await page.exec(asPageHandle(wc), page.focusScript(found.ref))
      await page.exec(asPageHandle(wc), page.fillScript(found.ref, ''))
      return { ref: found.ref }
    },
    verify: async (data, _p, ctx) => {
      const value = await page.exec<string | null>(asPageHandle(tab(ctx)), `(() => { const el = document.querySelector('[data-orbis-ref="${(data as { ref: number }).ref}"]'); return el ? (el.isContentEditable ? el.innerText : el.value) : null; })()`).catch(() => null)
      return { verified: value === '' || value?.trim() === '', detail: value === '' ? 'The field is empty.' : 'The field still has text.' }
    }
  })

  control.register({
    ...common,
    id: 'page.paste',
    name: 'Paste into a field',
    description: 'Pastes the clipboard into a field, as Ctrl+V would.',
    params: { locator: LOCATOR },
    mutates: true,
    confirmation: 'none',
    observe: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      return { ref: found.ref, before: await page.exec<string>(asPageHandle(wc), `document.querySelector('[data-orbis-ref="${found.ref}"]').value ?? document.querySelector('[data-orbis-ref="${found.ref}"]').innerText`).catch(() => '') }
    },
    run: async (_p, ctx, before) => {
      const wc = tab(ctx)
      const { ref } = before as { ref: number }
      if (!(await page.exec<boolean>(asPageHandle(wc), `(() => { const el = document.querySelector('[data-orbis-ref="${ref}"]'); if (!el) return false; el.focus(); return document.activeElement === el; })()`))) fail('failed', "Couldn't focus that field.", true)
      wc.paste()
      return { ref }
    },
    verify: async (_d, _p, ctx, before) => {
      await page.sleep(200)
      const b = before as { ref: number; before: string }
      const now = await page.exec<string>(asPageHandle(tab(ctx)), `document.querySelector('[data-orbis-ref="${b.ref}"]').value ?? document.querySelector('[data-orbis-ref="${b.ref}"]').innerText`).catch(() => b.before)
      return { verified: now !== b.before, detail: now !== b.before ? 'The field changed with the pasted content.' : 'Nothing was pasted (the clipboard may be empty).' }
    }
  })

  control.register({
    ...common,
    id: 'page.press',
    name: 'Press keys',
    description: `Presses keys in the page in order, as real keyboard input to the focused element (or a located one): ${Object.keys(page.KEY_CODES).join(', ')}, letters and digits; with optional modifiers. Page keys never trigger browser or Orion shortcuts.`,
    params: {
      keys: { type: 'array', description: 'Key names in order.', required: true },
      modifiers: { type: 'array', description: 'Any of shift, control, alt, meta.' },
      holdMs: { type: 'integer', description: 'Hold each key this long.' },
      locator: { ...LOCATOR, required: false, description: 'Focus this element first (optional).' }
    },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Press ${(p.keys as string[]).join(', ')}`,
    assess: (p, ctx) => safety(p, ctx, 'key'),
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const keys = (p.keys as unknown[]).map(String).slice(0, 30)
      const bad = keys.filter((k) => !page.keyCodeOf(k))
      if (bad.length) fail('invalid-params', `Unsupported keys: ${bad.join(', ')}.`)
      if (p.locator) {
        const found = await located(wc, p.locator)
        await page.exec(asPageHandle(wc), `document.querySelector('[data-orbis-ref="${found.ref}"]')?.focus()`)
      }
      const modifiers = ((p.modifiers as string[] | undefined) ?? []).filter((m): m is 'shift' | 'control' | 'alt' | 'meta' => ['shift', 'control', 'alt', 'meta'].includes(m))
      for (const key of keys) {
        if (ctx.signal?.aborted) break
        await page.pressNamedKey(asPageHandle(wc), key, Math.min(Number(p.holdMs) || 0, 3000), modifiers)
        await page.sleep(60)
      }
      await page.settle(asPageHandle(wc), ctx.signal, true)
      return { pressed: keys, focused: await page.exec(asPageHandle(wc), page.ACTIVE_SCRIPT).catch(() => null), url: wc.getURL() }
    }
  })

  control.register({
    ...common,
    id: 'page.select',
    name: 'Choose a dropdown option',
    description: 'Chooses an option in a <select> dropdown by its text or value.',
    params: { locator: LOCATOR, option: { type: 'string', description: 'Option text or value.', required: true } },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Choose ${quote(String(p.option))} in ${JSON.stringify(p.locator)}`,
    assess: (p, ctx) => safety(p, ctx, 'select'),
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      const result = String(await page.exec(asPageHandle(wc), page.selectScript(found.ref, String(p.option))))
      if (!result.startsWith('ok:')) fail(result.includes('no option') ? 'not-found' : 'invalid-params', `Couldn't choose it: ${result}.`, result.includes('no option'))
      return { ref: found.ref, chosen: result.slice(3) }
    },
    verify: async (data, _p, ctx) => {
      const d = data as { ref: number; chosen: string }
      const now = await page.exec<string>(asPageHandle(tab(ctx)), `(() => { const el = document.querySelector('[data-orbis-ref="${d.ref}"]'); return el && el.options[el.selectedIndex] ? el.options[el.selectedIndex].text.trim() : ''; })()`).catch(() => '')
      return { verified: now === d.chosen, detail: now === d.chosen ? `${quote(d.chosen)} is selected.` : `The dropdown shows ${quote(now)}.` }
    }
  })

  control.register({
    ...common,
    id: 'page.check',
    name: 'Check or uncheck',
    description: 'Sets a checkbox, radio button or switch to checked (true) or unchecked (false), clicking it only when needed.',
    params: { locator: LOCATOR, checked: { type: 'boolean', description: 'The state wanted.', required: true } },
    mutates: true,
    confirmation: 'when-consequential',
    assess: (p, ctx) => safety(p, ctx, 'click'),
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      const state = `(() => { const el = document.querySelector('[data-orbis-ref="${found.ref}"]'); if (!el) return null; if ('checked' in el && (el.type === 'checkbox' || el.type === 'radio')) return el.checked; const a = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed'); return a === null ? null : a === 'true'; })()`
      const current = await page.exec<boolean | null>(asPageHandle(wc), state)
      if (current === null) fail('invalid-params', `${actionName(found.target)} isn't a checkbox, radio button or switch.`)
      if (current !== p.checked) {
        const hidden = (await page.exec<string>(asPageHandle(wc), 'document.visibilityState').catch(() => 'visible')) === 'hidden'
        if (found.target.covered || hidden) await page.exec(asPageHandle(wc), `document.querySelector('[data-orbis-ref="${found.ref}"]').click()`)
        else page.mouseClick(asPageHandle(wc), found.target.x, found.target.y)
      }
      await page.sleep(150)
      return { ref: found.ref, now: await page.exec<boolean | null>(asPageHandle(wc), state), wanted: p.checked }
    },
    verify: (data) => {
      const d = data as { now: boolean | null; wanted: boolean }
      return { verified: d.now === d.wanted, detail: d.now === d.wanted ? `It is ${d.wanted ? 'checked' : 'unchecked'}.` : `It is still ${d.now ? 'checked' : 'unchecked'}.` }
    }
  })

  control.register({
    ...common,
    id: 'page.submit',
    name: 'Submit a form',
    description: 'Submits the form an element belongs to (with its own submit button when it has one). Asks first unless it is a search.',
    params: { locator: LOCATOR },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Submit the form at ${JSON.stringify(p.locator)}`,
    assess: async (p, ctx) => {
      if (ctx.source === 'user') return { decision: 'run', reason: '' }
      const found = await page.locate(asPageHandle(tab(ctx)), p.locator as Locator)
      if ('error' in found) return { decision: 'run', reason: '' }
      const verdict = assessAction({ kind: 'click', element: { ...found.target, submits: true, inForm: true }, flagged: ctx.flagged === true })
      return { decision: verdict.decision, reason: 'reason' in verdict ? verdict.reason : '' }
    },
    observe: async (_p, ctx) => ({ url: tab(ctx).getURL() }),
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      const outcome = await page.exec<string>(asPageHandle(wc), `(() => { const el = document.querySelector('[data-orbis-ref="${found.ref}"]'); const form = el && (el.tagName === 'FORM' ? el : el.form || el.closest('form')); if (!form) return 'no form'; window.__orbisSubmitted = false; form.addEventListener('submit', () => { window.__orbisSubmitted = true; }, { once: true, capture: true }); const button = el.matches('button, input[type=submit], input[type=image]') ? el : form.querySelector('button[type=submit], input[type=submit], button:not([type])'); if (typeof form.requestSubmit === 'function') form.requestSubmit(button || undefined); else form.submit(); return 'ok'; })()`)
      if (outcome !== 'ok') fail('invalid-params', 'That element is not in a form.')
      return { ref: found.ref }
    },
    verify: async (_d, _p, ctx, before) => {
      const wc = tab(ctx)
      await page.sleep(300)
      const navigated = wc.getURL() !== (before as { url: string }).url || wc.isLoading()
      const submitted = navigated || (await page.exec<boolean>(asPageHandle(wc), 'window.__orbisSubmitted === true', 3000).catch(() => false))
      await page.settle(asPageHandle(wc), ctx.signal)
      return { verified: submitted, detail: submitted ? `The form was submitted${navigated ? ` and the page moved to ${wc.getURL()}` : ''}.` : 'The form did not submit (the page may have blocked it, for example for a missing field).' }
    }
  })

  control.register({
    ...common,
    id: 'page.scroll',
    name: 'Scroll',
    description: 'Scrolls the page (or the feed under the centre) up or down by a screen, to the top or bottom, or brings an element into view.',
    params: { direction: { type: 'string', description: 'down, up, top or bottom', enum: ['down', 'up', 'top', 'bottom'] }, locator: { ...LOCATOR, required: false, description: 'Scroll this element into view instead.' } },
    mutates: true,
    confirmation: 'none',
    observe: async (_p, ctx) => page.exec<{ url: string; top: number; height: number; textLength: number }>(asPageHandle(tab(ctx)), page.VIEW_SCRIPT),
    run: async (p, ctx) => {
      const wc = tab(ctx)
      if (p.locator) {
        const found = await located(wc, p.locator)
        await page.exec(asPageHandle(wc), `document.querySelector('[data-orbis-ref="${found.ref}"]').scrollIntoView({ block: 'center', behavior: 'instant' })`)
        return { intoView: found.ref }
      }
      const direction = String(p.direction ?? 'down')
      if (direction === 'top' || direction === 'bottom') await page.exec(asPageHandle(wc), `window.scrollTo({ top: ${direction === 'top' ? 0 : 'document.documentElement.scrollHeight'}, behavior: 'instant' })`)
      else if (!(await page.exec<string | null>(asPageHandle(wc), page.scrollScript(direction === 'down')).catch(() => null))) {
        const view = await page.exec<{ width: number; view: number }>(asPageHandle(wc), page.VIEW_SCRIPT)
        wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(view.width / 2), y: Math.round(view.view / 2), deltaX: 0, deltaY: direction === 'down' ? -view.view : view.view })
      }
      await page.settle(asPageHandle(wc), ctx.signal, true)
      return { direction }
    },
    verify: async (data, _p, ctx, before) => {
      const d = data as { intoView?: number }
      const wc = tab(ctx)
      if (d.intoView) {
        const inView = await page.exec<boolean>(asPageHandle(wc), `(() => { const r = document.querySelector('[data-orbis-ref="${d.intoView}"]').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })()`).catch(() => false)
        return { verified: inView, detail: inView ? 'The element is on screen.' : 'The element is still off screen.' }
      }
      const b = before as { url: string; top: number; height: number; textLength: number }
      const now = await page.exec<typeof b>(asPageHandle(wc), page.VIEW_SCRIPT).catch(() => b)
      const moved = now.top !== b.top || now.url !== b.url || now.height !== b.height || now.textLength !== b.textLength
      return { verified: true, detail: moved ? `Scrolled to ${now.top}px of ${now.height}px${now.height > b.height ? '; more content loaded' : ''}.` : 'Already at the end: scrolling had no effect.' }
    }
  })

  control.register({
    ...common,
    id: 'page.drag',
    name: 'Drag and drop',
    description: 'Drags one element onto another with real mouse movement.',
    params: { from: LOCATOR, to: LOCATOR },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const from = await located(wc, p.from)
      const to = await located(wc, p.to)
      await page.mouseDrag(asPageHandle(wc), from.target.x, from.target.y, to.target.x, to.target.y)
      await page.settle(asPageHandle(wc), ctx.signal, true)
      return { from: from.target, to: to.target }
    }
  })

  control.register({
    ...common,
    id: 'page.selectText',
    name: 'Select text',
    description: "Selects an element's text, or the first occurrence of some text inside it.",
    params: { locator: LOCATOR, text: { type: 'string', description: 'Only this part of the text (optional).' } },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      return page.exec<string>(asPageHandle(wc),
        `(() => { const el = document.querySelector('[data-orbis-ref="${found.ref}"]'); const want = ${JSON.stringify(p.text ?? null)}; const sel = getSelection(); sel.removeAllRanges(); const range = document.createRange();
          if (!want) { range.selectNodeContents(el); sel.addRange(range); return sel.toString(); }
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
          while ((node = walker.nextNode())) { const i = node.textContent.toLowerCase().indexOf(want.toLowerCase()); if (i >= 0) { range.setStart(node, i); range.setEnd(node, i + want.length); sel.addRange(range); return sel.toString(); } }
          return ''; })()`
      )
    },
    verify: (data, p) => {
      const text = String(data ?? '')
      const ok = text.length > 0 && (!p.text || text.toLowerCase() === String(p.text).toLowerCase())
      return { verified: ok, detail: ok ? `Selected ${quote(text)}.` : 'Nothing matching was selected.' }
    }
  })

  control.register({
    ...common,
    id: 'page.extract',
    name: 'Extract data',
    description: 'Extracts from the elements a CSS selector matches: their text (or an attribute such as href, value, src), or a row of named fields per element ({ "title": "h3", "link": "a@href" }). Without a selector, the whole page text.',
    params: {
      selector: { type: 'string', description: 'CSS selector for the elements.' },
      attribute: { type: 'string', description: 'text (default), value, href, html or any attribute name.' },
      fields: { type: 'object', description: 'Named fields: sub-selector, optionally "@attribute".' },
      limit: { type: 'integer', description: 'Most elements (default 100, up to 1000).' }
    },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const result = await page.exec<Record<string, unknown>>(asPageHandle(tab(ctx)), page.extractScript(p.selector as string | undefined, p.fields as Record<string, string> | undefined, p.attribute as string | undefined, Math.min(Number(p.limit) || 100, 1000)))
      if (typeof result.error === 'string') fail('invalid-params', result.error)
      return result
    }
  })

  control.register({
    ...common,
    id: 'page.waitFor',
    name: 'Wait for the page',
    description: 'Waits until the page shows (or stops showing) an element or text, reaches a URL, or finishes loading. Checks efficiently on demand for up to timeoutMs.',
    params: {
      locator: { ...LOCATOR, required: false, description: 'An element to wait for.' },
      gone: { type: 'boolean', description: 'Wait for the element or text to disappear instead.' },
      text: { type: 'string', description: 'Text to wait for on the page.' },
      urlMatches: { type: 'string', description: 'A regular expression (or plain text) the URL must match.' },
      loaded: { type: 'boolean', description: 'Wait for loading to finish.' },
      timeoutMs: { type: 'integer', description: 'Give up after this long (default 15000, up to 120000).' }
    },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const deadline = Date.now() + Math.min(Number(p.timeoutMs) || 15_000, 120_000)
      const gone = p.gone === true
      const urlRe = typeof p.urlMatches === 'string' ? (() => { try { return new RegExp(p.urlMatches as string, 'i') } catch { return null } })() : null
      for (let delay = 150; ; delay = Math.min(delay * 1.5, 1000)) {
        if (ctx.signal?.aborted) fail('aborted', 'Stopped.')
        if (wc.isDestroyed()) fail('not-found', 'The tab closed while waiting.')
        const checks: boolean[] = []
        if (p.loaded) checks.push(!wc.isLoading())
        if (p.urlMatches) checks.push(urlRe ? urlRe.test(wc.getURL()) : wc.getURL().includes(String(p.urlMatches)))
        if (p.locator !== undefined && p.locator !== null) {
          // Refused rather than waited on: an empty locator can never match, so waiting for it is waiting for nothing.
          if (!describesAnElement(p.locator)) {
            fail('invalid-params', `${whyNotALocator(p.locator)} Or leave it out and wait for loading instead.`)
          }
          const found = await page.exec<{ ref?: number }>(asPageHandle(wc), page.locateScript(asLocator(p.locator) as Locator), 4000).catch((): { ref?: number } => ({}))
          checks.push(gone ? !found.ref : Boolean(found.ref))
        }
        if (typeof p.text === 'string') {
          const has = await page.exec<boolean>(asPageHandle(wc), `(document.body ? document.body.innerText : '').toLowerCase().includes(${JSON.stringify((p.text as string).toLowerCase())})`, 4000).catch(() => false)
          checks.push(gone ? !has : has)
        }
        if (!checks.length) fail('invalid-params', 'Say what to wait for: locator, text, urlMatches or loaded.')
        if (checks.every(Boolean)) return { met: true, url: wc.getURL() }
        if (Date.now() > deadline) {
          /*
           * A wait that ran out says whether the page has frames on it.
           *
           * A script runs in one document, and an iframe is a different one -- so a control inside an embedded
           * player, a payment form or a meeting's pre-join panel is not slow to appear, it is somewhere this cannot
           * look. "The page never showed what was expected" is true of this document and sends the Orb off waiting
           * again, or re-planning against a page that does not contain the thing.
           *
           * Only asked once the wait has failed, so an ordinary wait costs nothing.
           */
          const frames = await page
            .exec<number>(asPageHandle(wc), "document.querySelectorAll('iframe, frame').length", 2000)
            .catch(() => 0)
          const seconds = Math.round((Number(p.timeoutMs) || 15_000) / 1000)
          const inFrame = frames
            ? ` This page has ${frames} frame${frames === 1 ? '' : 's'} on it, and anything inside a frame is in a different document that this cannot reach.`
            : ''
          fail('timeout', `Waited ${seconds}s: the page never showed what was expected.${inFrame}`, true)
        }
        await page.sleep(delay)
      }
    }
  })

  control.register({
    ...common,
    id: 'page.accessibility',
    name: 'Read the accessibility tree',
    description: "Reads Chromium's accessibility tree for the page (roles, names, values), for pages whose DOM is hard to read.",
    params: { limit: { type: 'integer', description: 'Most nodes (default 400).' } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => page.accessibilityTree(asPageHandle(tab(ctx)), Math.min(Number(p.limit) || 400, 2000))
  })

  control.register({
    ...common,
    id: 'page.screenshot',
    name: 'Screenshot the page',
    description: 'Captures what the tab shows, as a PNG data URL (scaled to at most maxWidth), for visual checks when structured state is not enough.',
    params: { maxWidth: { type: 'integer', description: 'Scale down to this width (default 1280).' } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      let image = await page.withTimeout(asPageHandle(wc).capturePage(), 8000).catch(() => null)
      // A hidden page (Orbis minimized or covered) isn't composited; the DevTools protocol can still render a frame of it.
      if (!image || image.isEmpty()) image = await page.debuggerScreenshot(asPageHandle(wc)).catch(() => null)
      if (!image || image.isEmpty()) fail('failed', "The page couldn't be captured (it may still be loading).", true)
      const size = image!.getSize()
      const width = Math.min(size.width, Number(p.maxWidth) || 1280)
      const scaled = width < size.width ? image!.resize({ width }) : image!
      return { dataUrl: scaled.toDataURL(), width: scaled.getSize().width, height: scaled.getSize().height }
    }
  })

  control.register({
    ...common,
    id: 'page.source',
    name: "Read the page's HTML",
    description: "The page's current HTML (after scripts ran), up to maxChars.",
    params: { maxChars: { type: 'integer', description: 'Default 100000.' } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const html = await page.exec<string>(asPageHandle(tab(ctx)), 'document.documentElement.outerHTML')
      return { length: html.length, html: html.slice(0, Math.min(Number(p.maxChars) || 100_000, 1_000_000)) }
    }
  })

  control.register({
    ...common,
    id: 'page.contextActions',
    name: "What an element's right-click menu offers",
    description: "Lists what the page's right-click menu offers for an element (link, image, text field, selection or page) as capabilities to run, including installed extensions' items.",
    params: { locator: { ...LOCATOR, required: false, description: 'The element (default: the page itself).' } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const info = p.locator
        ? await (async () => {
            const found = await located(wc, p.locator)
            return page.exec<{ link?: string; image?: string; editable: boolean; selection: string }>(asPageHandle(wc), `(() => { const el = document.querySelector('[data-orbis-ref="${found.ref}"]'); const a = el.closest('a[href]'); const img = el.tagName === 'IMG' ? el : null; return { link: a ? a.href : undefined, image: img ? img.currentSrc || img.src : undefined, editable: el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName), selection: String(getSelection()) }; })()`)
          })()
        : await page.exec<{ link?: string; image?: string; editable: boolean; selection: string }>(asPageHandle(wc), `({ editable: false, selection: String(getSelection()) })`)
      const actions: { label: string; capability: string; params: Record<string, unknown> }[] = []
      if (info.link) {
        actions.push(
          { label: 'Open link in new tab', capability: 'tabs.create', params: { url: info.link } },
          { label: 'Open link in background tab', capability: 'tabs.create', params: { url: info.link, active: false } },
          { label: 'Open link in new window', capability: 'window.create', params: { url: info.link } },
          { label: 'Copy link address', capability: 'clipboard.write', params: { text: info.link } },
          { label: 'Save link as…', capability: 'downloads.start', params: { url: info.link } }
        )
      }
      if (info.image) {
        actions.push(
          { label: 'Open image in new tab', capability: 'tabs.create', params: { url: info.image } },
          { label: 'Copy image', capability: 'clipboard.copyImageFromPage', params: { locator: p.locator } },
          { label: 'Copy image address', capability: 'clipboard.write', params: { text: info.image } },
          { label: 'Save image as…', capability: 'downloads.start', params: { url: info.image } }
        )
      }
      if (info.editable) actions.push({ label: 'Paste', capability: 'page.paste', params: { locator: p.locator } }, { label: 'Clear', capability: 'page.clear', params: { locator: p.locator } })
      if (info.selection.trim()) {
        actions.push(
          { label: 'Copy', capability: 'clipboard.copyFromPage', params: {} },
          { label: `Search Google for “${info.selection.trim().slice(0, 30)}”`, capability: 'tabs.create', params: { url: `https://www.google.com/search?q=${encodeURIComponent(info.selection.trim())}` } }
        )
      }
      if (!info.link && !info.image && !info.editable && !info.selection.trim()) {
        actions.push(
          { label: 'Back', capability: 'navigation.back', params: {} },
          { label: 'Forward', capability: 'navigation.forward', params: {} },
          { label: 'Reload', capability: 'navigation.reload', params: {} },
          { label: 'Save page as…', capability: 'devtools.savePage', params: {} },
          { label: 'Print…', capability: 'devtools.print', params: {} },
          { label: 'View page source', capability: 'devtools.viewSource', params: {} }
        )
      }
      actions.push({ label: 'Inspect', capability: 'devtools.inspect', params: { locator: p.locator ?? { selector: 'body' } } })
      const extensionItems = control.has('extensions.contextMenuItems')
        ? await control.execute({ capability: 'extensions.contextMenuItems', params: { linkUrl: info.link, srcUrl: info.image, editable: info.editable, selectionText: info.selection || undefined }, target: ctx.target, source: ctx.source }, { confirm: ctx.confirm, signal: ctx.signal })
        : null
      return { element: info, actions, extensionItems: extensionItems?.ok ? extensionItems.data : [] }
    }
  })

  control.register({
    ...common,
    id: 'page.openLink',
    name: 'Open a link',
    description: 'Opens a link element: in this tab (following it), a new tab, or a new window.',
    params: { locator: LOCATOR, where: { type: 'string', description: 'this-tab (default), new-tab, background-tab or new-window', enum: ['this-tab', 'new-tab', 'background-tab', 'new-window'] } },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await located(wc, p.locator)
      const href = await page.exec<string | null>(asPageHandle(wc), `(() => { const el = document.querySelector('[data-orbis-ref="${found.ref}"]'); const a = el && el.closest('a[href]'); return a ? a.href : null; })()`)
      if (!href || !/^https?:/i.test(href)) fail('invalid-params', `${actionName(found.target)} is not a web link.`)
      const where = String(p.where ?? 'this-tab')
      const command =
        where === 'new-window'
          ? { capability: 'window.create', params: { url: href } }
          : where === 'this-tab'
            ? { capability: 'navigation.go', params: { url: href } }
            : { capability: 'tabs.create', params: { url: href, active: where === 'new-tab' } }
      const result = await control.execute({ ...command, target: ctx.target, source: ctx.source }, { confirm: ctx.confirm, signal: ctx.signal })
      if (!result.ok) fail(result.error?.code ?? 'failed', result.error?.message ?? "Couldn't open the link.", result.error?.recoverable)
      return { href, where, result: result.data, verification: result.verification }
    },
    verify: (data) => {
      const d = data as { verification?: { verified: boolean; detail: string } }
      return d.verification ?? { verified: true, detail: 'Opened.' }
    }
  })

  control.register({
    ...common,
    id: 'page.evaluateQuery',
    name: 'Query element state',
    description: 'Reads the state of the elements a CSS selector matches (tag, text, value, checked, disabled, visible, attributes), without changing anything.',
    params: { selector: { type: 'string', description: 'CSS selector.', required: true }, limit: { type: 'integer', description: 'Default 50.' } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) =>
      page.exec(asPageHandle(tab(ctx)),
        `(() => { ${page.DEEP} let nodes; try { nodes = orbisDeep(${JSON.stringify(p.selector)}); } catch (e) { return { error: e.message }; }
          return { count: nodes.length, elements: nodes.slice(0, ${Math.min(Number(p.limit) || 50, 500)}).map((el) => { const r = el.getBoundingClientRect(); const password = el.type === 'password'; return { tag: el.tagName.toLowerCase(), id: el.id || undefined, text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200), value: password ? undefined : el.value, checked: el.checked, disabled: el.disabled, visible: r.width > 0 && r.height > 0, attributes: Object.fromEntries([...el.attributes].filter((a) => !/^on/i.test(a.name) && a.name !== 'style').slice(0, 20).map((a) => [a.name, a.value.slice(0, 200)])) }; }) }; })()`
      )
  })

  // A page action's host for messages, e.g. "on github.com".
  void hostOf
}
