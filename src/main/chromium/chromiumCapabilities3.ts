import type { ParamSpec } from '../../shared/browserControl.ts'
import { fail } from '../browserControl/registry.ts'
import type { ChromiumCapabilityDeps } from './chromiumCapabilities.ts'
import type { CdpPage } from './cdpPage.ts'

/**
 * Site permissions and find-in-page on real Chromium.
 *
 * Chromium asks for camera, location and the rest with its own prompts, and keeps its own site settings: the person answers those
 * in the browser. What Orion and automations may do is set a site's permission the way an extension can (Chromium's content-settings
 * API), which the browser then enforces. The extension can only list and forget the rules it made itself (the API cannot enumerate
 * the person's own choices), so this lists exactly those and says so.
 */

const str = (description: string, required = false, extra: Partial<ParamSpec> = {}): ParamSpec => ({ type: 'string', description, required, ...extra })
const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })

/** Orbis's permission names, and the content settings each one is in Chromium. */
export const PERMISSION_SETTINGS: Record<string, string[]> = {
  media: ['camera', 'microphone'],
  camera: ['camera'],
  microphone: ['microphone'],
  geolocation: ['location'],
  notifications: ['notifications'],
  'clipboard-read': ['clipboard'],
  popups: ['popups'],
  'automatic-downloads': ['automaticDownloads']
}

const STORE = 'orbis.sitePermissions'

export function registerSitePermissionCapabilities(d: ChromiumCapabilityDeps): void {
  const { control, bridge } = d
  const call = <T>(expression: string): Promise<T> => bridge.run<T>(expression)
  const json = (v: unknown): string => JSON.stringify(v)
  type Rule = { origin: string; permission: string; decision: string }
  const rules = async (): Promise<Rule[]> => (await call<Rule[] | undefined>(`chrome.storage.local.get(${json(STORE)}).then((r) => r[${json(STORE)}])`)) ?? []
  const saveRules = (list: Rule[]): Promise<unknown> => call(`chrome.storage.local.set({ [${json(STORE)}]: ${json(list)} })`)
  const originOf = (value: unknown): string => {
    try {
      const u = new URL(String(value))
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme')
      return u.origin
    } catch {
      return fail('invalid-params', 'origin must be a site address such as https://example.com.', true)
    }
  }
  const settingsFor = (permission: string): string[] => PERMISSION_SETTINGS[permission] ?? fail('invalid-params', `Unknown permission "${permission}". Use one of: ${Object.keys(PERMISSION_SETTINGS).join(', ')}.`, true)
  const apply = (setting: string, origin: string, decision: string): Promise<unknown> =>
    call(`new Promise((ok) => chrome.contentSettings[${json(setting)}].set({ primaryPattern: ${json(`${origin}/*`)}, setting: ${json(decision)}, scope: 'regular' }, ok))`)
  const current = (setting: string, url: string): Promise<string | undefined> =>
    call<{ setting?: string } | undefined>(`new Promise((ok) => chrome.contentSettings[${json(setting)}].get({ primaryUrl: ${json(url)} }, ok))`).then((r) => r?.setting)

  control.register({
    id: 'permissions.list',
    domain: 'permissions',
    name: 'Site permissions Orbis set',
    description: "Permission decisions Orbis has set for sites (camera, location, notifications…). Chromium's own prompts and the person's other choices are in the browser's site settings and are not listed here.",
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => ({ remembered: await rules(), pending: [] })
  })

  control.register({
    id: 'permissions.set',
    effects: ['write', 'authenticate'],
    domain: 'permissions',
    name: 'Set a site permission',
    description: 'Allows, blocks or resets (ask) a site permission such as media, geolocation or notifications, enforced by the browser. Allowing is a security change, so Orbis asks first.',
    params: { origin: str('Site origin, e.g. https://example.com.', true), permission: str(`One of: ${Object.keys(PERMISSION_SETTINGS).join(', ')}.`, true), decision: str('allow, block or ask', true, { enum: ['allow', 'block', 'ask'] }) },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `${p.decision === 'allow' ? 'Always allow' : p.decision === 'block' ? 'Always block' : 'Ask again for'} ${String(p.origin)} to use ${String(p.permission)}`,
    assess: (p) => (p.decision === 'allow' ? { decision: 'confirm', reason: 'This lets the site use it without asking.' } : { decision: 'run', reason: '' }),
    run: async (p) => {
      const origin = originOf(p.origin)
      const permission = String(p.permission)
      const decision = String(p.decision)
      if (!['allow', 'block', 'ask'].includes(decision)) fail('invalid-params', 'decision must be allow, block or ask.', true)
      for (const setting of settingsFor(permission)) await apply(setting, origin, decision)
      const kept = (await rules()).filter((r) => !(r.origin === origin && r.permission === permission))
      if (decision !== 'ask') kept.push({ origin, permission, decision })
      await saveRules(kept)
      return { origin, permission, decision }
    },
    verify: async (data) => {
      const { origin, permission, decision } = data as Rule
      const seen = await Promise.all(settingsFor(permission).map((s) => current(s, `${origin}/`)))
      return { verified: seen.every((v) => v === decision), detail: `The browser now says: ${seen.join(', ')}.` }
    }
  })

  control.register({
    id: 'permissions.forget',
    effects: ['delete'],
    domain: 'permissions',
    name: 'Forget site permissions Orbis set',
    description: "Resets the permission decisions Orbis set, for one site or every site, so the browser asks again. The person's own choices in the browser's site settings are not touched.",
    params: { origin: str('Only this site (default: all sites Orbis set).') },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Forget the permissions Orbis set ${p.origin ? `for ${String(p.origin)}` : 'for every site'}`,
    run: async (p) => {
      const all = await rules()
      const origin = p.origin ? originOf(p.origin) : null
      const doomed = all.filter((r) => !origin || r.origin === origin)
      for (const r of doomed) for (const setting of settingsFor(r.permission)) await apply(setting, r.origin, 'ask')
      await saveRules(all.filter((r) => !doomed.includes(r)))
      return { forgotten: doomed.length }
    },
    verify: async (_d, p) => {
      const left = (await rules()).filter((r) => !p.origin || r.origin === originOf(p.origin)).length
      return { verified: left === 0, detail: left ? `${left} decisions remain.` : 'Forgotten.' }
    }
  })
}

/** Page-text search on the real page: how many places the words appear, and the one the page is scrolled to. */
export function registerFindInPage(d: ChromiumCapabilityDeps & { activePage(): Promise<CdpPage> }): void {
  d.control.register({
    id: 'find.text',
    domain: 'find',
    name: 'Find text on the page',
    description: 'Counts where some text appears on the page of the active tab and scrolls to one of the matches.',
    params: { text: str('The text to find.', true), index: int('Which match to scroll to, from 1 (default 1).') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const text = String(p.text ?? '')
      if (!text.trim()) fail('invalid-params', 'Say what text to find.', true)
      const page = await d.activePage()
      const send = (m: string, params?: Record<string, unknown>): Promise<any> => page.debugger.sendCommand(m, params)
      await send('DOM.enable')
      await send('DOM.getDocument', { depth: 0 })
      const { searchId, resultCount } = await send('DOM.performSearch', { query: text })
      let at = 0
      try {
        if (resultCount > 0) {
          at = Math.min(Math.max(1, Number(p.index) || 1), resultCount)
          const { nodeIds } = await send('DOM.getSearchResults', { searchId, fromIndex: at - 1, toIndex: at })
          await send('DOM.scrollIntoViewIfNeeded', { nodeId: nodeIds[0] }).catch(() => undefined)
        }
      } finally {
        await send('DOM.discardSearchResults', { searchId }).catch(() => undefined)
      }
      return { text, matches: resultCount, at }
    }
  })
}
