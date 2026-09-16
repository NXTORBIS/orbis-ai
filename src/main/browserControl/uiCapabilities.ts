import type { BrowserWindow, WebContents } from 'electron'
import { asPageHandle } from '../pageHandle'
import type { ParamSpec } from '../../shared/browserControl.ts'
import { BrowserControl, fail } from './registry.ts'
import * as page from './page.ts'
import type { Locator } from './page.ts'
import { armClickScript } from './pageCapabilities.ts'

const LOCATOR: ParamSpec = {
  type: 'object',
  description: 'Which Orbis control: any of { ref (from ui.snapshot), selector, role, name (accessible name, e.g. "New tab"), text, label, placeholder, index, exact }.',
  required: true
}

/** Lists the Orbis window's interactive controls (outside web pages), numbered, with where each is. */
const UI_SNAPSHOT = (region: string): string => `(() => {
  const clean = (s, n) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  document.querySelectorAll('[data-orbis-ref]').forEach((el) => el.removeAttribute('data-orbis-ref'));
  const selector = 'button, a[href], input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], [role="combobox"], [role="slider"], [contenteditable="true"]';
  const regionOf = (el) => {
    if (el.closest('[role="alertdialog"], [role="dialog"], .ext-prompt, .control-prompt')) return 'dialog';
    if (el.closest('[role="menu"], .popover')) return 'menu';
    if (el.closest('.browser-tabs-row')) return 'browser toolbar';
    if (el.closest('.url-strip')) return 'address bar';
    if (el.closest('.browser-find')) return 'find bar';
    if (el.closest('.browser-panel')) return 'browser';
    if (el.closest('.sidebar')) return 'sidebar';
    if (el.closest('.system-bar, .systembar')) return 'header';
    return 'chat';
  };
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    const where = regionOf(el);
    if (${JSON.stringify(region)} !== 'all' && !where.includes(${JSON.stringify(region)})) continue;
    const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const name = clean(el.getAttribute('aria-label') || (forLabel && forLabel.innerText) || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || el.value || '', 80);
    n++;
    el.setAttribute('data-orbis-ref', String(n));
    out.push({
      ref: n, region: where, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || undefined, name,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
      pressed: el.getAttribute('aria-pressed') ?? undefined, expanded: el.getAttribute('aria-expanded') ?? undefined,
      checked: el.getAttribute('aria-checked') ?? (el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : undefined),
      selected: el.getAttribute('aria-selected') ?? undefined,
      value: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'password' ? clean(el.value, 80) : undefined
    });
    if (n >= 250) break;
  }
  return out;
})()`

/**
 * Operating the Orbis window's own interface (buttons, menus, dialogs, the tab strip, the address bar, settings,
 * panels) with real mouse and keyboard input, the way the user does. Nothing here adds controls for automation: it finds
 * the real ones by their accessible names and roles. Approving a dialog Orbis shows the user (an extension install, a
 * site permission, an approval card) or pressing a destructive button asks the user first.
 */
export function registerUiCapabilities(control: BrowserControl, getWindow: () => BrowserWindow | null): void {
  const host = (): WebContents => {
    const win = getWindow()
    if (!win || win.isDestroyed()) fail('unavailable', 'The Orbis window is not open.', true)
    return win!.webContents
  }
  const unavailable = (): string | null => (getWindow() ? null : 'The Orbis window is not open.')
  const common = { domain: 'ui' as const, unavailable }

  const locateUi = async (locator: unknown): Promise<{ ref: number; target: page.TargetInfo; guarded: string | null }> => {
    const wc = host()
    const found = await page.locate(asPageHandle(wc), (locator ?? {}) as Locator)
    if ('error' in found) fail('not-found', found.error, true)
    const { ref, target } = found as { ref: number; target: page.TargetInfo }
    const guarded = await page.exec<string | null>(asPageHandle(wc),
      `(() => { const el = document.querySelector('[data-orbis-ref="${ref}"]'); if (!el) return null;
        if (el.tagName === 'WEBVIEW') return 'web page';
        if (el.closest('.ext-prompt')) return 'the extension permission prompt';
        if (el.closest('.browser-permission')) return 'a site permission request';
        if (el.closest('.orb-confirm, .confirm-card, .control-prompt')) return 'an approval Orbis is asking you for';
        if (el.closest('[role="alertdialog"]')) return 'a dialog asking you to decide';
        if (el.classList.contains('danger') || el.closest('.danger')) return 'a destructive control';
        return null; })()`
    )
    if (guarded === 'web page') fail('invalid-params', 'That is a web page, not Orbis interface. Use page capabilities for web pages.')
    return { ref, target, guarded }
  }

  control.register({
    ...common,
    id: 'ui.snapshot',
    name: 'Snapshot the Orbis interface',
    description: "Lists Orbis's interactive controls (not web page content) with refs, names, roles, states and where they are: browser toolbar, address bar, menu, dialog, find bar, sidebar, chat, header.",
    params: { region: { type: 'string', description: 'all (default), browser, address bar, menu, dialog, sidebar, chat…' } },
    mutates: false,
    confirmation: 'none',
    run: (p) => page.exec(asPageHandle(host()), UI_SNAPSHOT(String(p.region ?? 'all')))
  })

  control.register({
    ...common,
    id: 'ui.click',
    name: 'Click an Orbis control',
    description: 'Clicks a real Orbis control (for example the "New tab" button, a menu item, a tab) with a real mouse click. Approving an Orbis prompt or pressing a destructive control asks the user first.',
    params: { locator: LOCATOR, button: { type: 'string', description: 'left (default) or right', enum: ['left', 'right'] } },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Click ${JSON.stringify(p.locator)} in Orbis`,
    assess: async (p, ctx) => {
      if (ctx.source === 'user') return { decision: 'run', reason: '' }
      const { guarded } = await locateUi(p.locator)
      return guarded ? { decision: 'confirm', reason: `It is ${guarded}.` } : { decision: 'run', reason: '' }
    },
    run: async (p) => {
      const wc = host()
      const { ref, target } = await locateUi(p.locator)
      await page.exec(asPageHandle(wc), armClickScript(ref))
      const button = p.button === 'right' ? 'right' : 'left'
      // A minimized or covered Orbis window gets no pointer input; the control's own click is used then (only one of the two).
      const hidden = (await page.exec<string>(asPageHandle(wc), 'document.visibilityState').catch(() => 'visible')) === 'hidden'
      if ((target.covered || hidden) && button === 'left') await page.exec(asPageHandle(wc), `document.querySelector('[data-orbis-ref="${ref}"]')?.click()`)
      else page.mouseClick(asPageHandle(wc), target.x, target.y, button)
      return { ref, control: { name: target.label, tag: target.tag, role: target.role } }
    },
    verify: async () => {
      await page.sleep(120)
      const seen = await page.exec<boolean>(asPageHandle(host()), 'window.__orbisClickSeen === true', 2000).catch(() => false)
      return { verified: seen, detail: seen ? 'The control received the click.' : 'The click did not reach the control.' }
    }
  })

  control.register({
    ...common,
    id: 'ui.type',
    name: 'Type into an Orbis field',
    description: "Types into an Orbis text field (the address bar, find bar, chat box, settings fields…), replacing its text unless append is true; submit presses Enter.",
    params: {
      locator: LOCATOR,
      text: { type: 'string', description: 'The text.', required: true, sensitive: true },
      append: { type: 'boolean', description: 'Add to the existing text.' },
      submit: { type: 'boolean', description: 'Press Enter afterwards.' }
    },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const wc = host()
      const { ref, target } = await locateUi(p.locator)
      if (!target.editable) fail('invalid-params', `“${target.label}” is not a text field.`)
      const focused = await page.exec<boolean>(asPageHandle(wc), `(() => { const el = document.querySelector('[data-orbis-ref="${ref}"]'); el.focus(); ${p.append ? "if (typeof el.setSelectionRange === 'function') el.setSelectionRange(el.value.length, el.value.length);" : "if (typeof el.select === 'function') el.select();"} return document.activeElement === el; })()`)
      if (!focused) fail('failed', "Couldn't focus that field.", true)
      const before = p.append ? await page.exec<string>(asPageHandle(wc), `document.querySelector('[data-orbis-ref="${ref}"]').value ?? ''`) : ''
      await wc.insertText(String(p.text))
      if (p.submit) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
        wc.sendInputEvent({ type: 'char', keyCode: '\r' })
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      }
      return { ref, existingLength: before.length, submitted: p.submit === true }
    },
    verify: async (data, p) => {
      const r = data as { ref: number; existingLength: number; submitted: boolean }
      if (r.submitted) return { verified: true, detail: 'Typed and pressed Enter.' }
      const value = await page.exec<string | null>(asPageHandle(host()), `(() => { const el = document.querySelector('[data-orbis-ref="${r.ref}"]'); return el ? (el.isContentEditable ? el.innerText : el.value) : null; })()`).catch(() => null)
      const ok = value !== null && value.slice(r.existingLength).startsWith(String(p.text).slice(0, 200))
      return { verified: ok, detail: ok ? 'The field holds the typed text.' : 'The field does not hold the typed text.' }
    }
  })

  control.register({
    ...common,
    id: 'ui.press',
    name: 'Press a key in Orbis',
    description: `Presses a key in the Orbis interface (to move through menus, confirm, or close with Escape): ${Object.keys(page.KEY_CODES).join(', ')}, letters and digits. Ctrl/Alt combinations are not sent: use the matching capability (shortcuts.invoke) so no shortcut is triggered twice.`,
    params: { key: { type: 'string', description: 'The key.', required: true }, shift: { type: 'boolean', description: 'With Shift.' } },
    mutates: true,
    confirmation: 'none',
    run: (p) => {
      const keyCode = page.keyCodeOf(String(p.key)) ?? fail('invalid-params', `Unsupported key ${String(p.key)}.`)
      const wc = host()
      const modifiers = p.shift ? (['shift'] as const) : ([] as const)
      wc.sendInputEvent({ type: 'keyDown', keyCode: keyCode!, modifiers: [...modifiers] })
      if (String(p.key).length === 1 || p.key === 'Enter' || p.key === 'Space') wc.sendInputEvent({ type: 'char', keyCode: p.key === 'Enter' ? '\r' : p.key === 'Space' ? ' ' : String(p.key), modifiers: [...modifiers] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: keyCode!, modifiers: [...modifiers] })
      return { key: p.key }
    },
    verify: async () => ({ verified: true, detail: `Delivered to ${String(await page.exec<string>(asPageHandle(host()), `(document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName)) || 'the window'`).catch(() => 'the window'))}.` })
  })

  control.register({
    ...common,
    id: 'ui.hover',
    name: 'Hover an Orbis control',
    description: 'Moves the mouse over an Orbis control (to show its tooltip or hover state).',
    params: { locator: LOCATOR },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const { ref, target } = await locateUi(p.locator)
      page.mouseMove(asPageHandle(host()), target.x, target.y)
      return { ref }
    },
    verify: async (data) => {
      await page.sleep(100)
      const hovered = await page.exec<boolean>(asPageHandle(host()), `document.querySelector('[data-orbis-ref="${(data as { ref: number }).ref}"]')?.matches(':hover') === true`).catch(() => false)
      return { verified: hovered, detail: hovered ? 'The pointer is over it.' : 'The pointer is not over it.' }
    }
  })

  control.register({
    ...common,
    id: 'ui.read',
    name: 'Read an Orbis control',
    description: "Reads an Orbis control's text, value and state (pressed, expanded, checked, selected, disabled).",
    params: { locator: LOCATOR },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const { ref } = await locateUi(p.locator)
      return page.exec(asPageHandle(host()),
        `(() => { const el = document.querySelector('[data-orbis-ref="${ref}"]'); return { text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 2000), value: el.type === 'password' ? undefined : el.value, name: el.getAttribute('aria-label') || el.getAttribute('title') || undefined, disabled: el.disabled || el.getAttribute('aria-disabled') === 'true', pressed: el.getAttribute('aria-pressed'), expanded: el.getAttribute('aria-expanded'), checked: el.getAttribute('aria-checked') ?? (el.type === 'checkbox' ? el.checked : null), selected: el.getAttribute('aria-selected') }; })()`
      )
    }
  })

  control.register({
    ...common,
    id: 'ui.waitFor',
    name: 'Wait for an Orbis control',
    description: 'Waits until an Orbis control appears (or disappears, with gone: true), such as a menu opening or a dialog closing.',
    params: { locator: LOCATOR, gone: { type: 'boolean', description: 'Wait for it to disappear.' }, timeoutMs: { type: 'integer', description: 'Default 10000.' } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const end = Date.now() + Math.min(Number(p.timeoutMs) || 10_000, 120_000)
      for (let delay = 100; ; delay = Math.min(delay * 1.5, 800)) {
        if (ctx.signal?.aborted) fail('aborted', 'Stopped.')
        const found = await page.exec<{ ref?: number }>(asPageHandle(host()), page.locateScript(p.locator as Locator), 3000).catch((): { ref?: number } => ({}))
        if (p.gone ? !found.ref : found.ref) return { met: true }
        if (Date.now() > end) fail('timeout', `The control ${p.gone ? 'is still there' : 'never appeared'}.`, true)
        await page.sleep(delay)
      }
    }
  })
}
