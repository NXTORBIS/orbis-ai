import { FiltersEngine } from '@ghostery/adblocker'
import { AdBlockCore, activeCategories, hostOf, normalizeSettings, type EngineCategory } from '../src/main/adblock/blocker.ts'
import type { AdBlockCategory, AdBlockSettings } from '../src/shared/types'

/**
 * Orbis ad blocking inside Chromium.
 *
 *   network    Chromium blocks matching requests itself (declarativeNetRequest static rulesets built from Orbis's lists),
 *              before any request is made. Which rulesets are on follows the settings.
 *   page       the same Ghostery engines Electron Orbis used give element-hiding CSS and scriptlets for each frame.
 *   popups     new tabs opened by a page, and page-initiated redirects, are checked with AdBlockCore.popup()/navigation().
 *   statistics every real match Chromium reports (onRuleMatchedDebug) is recorded in AdBlockCore, which is the one place
 *              the counts come from. Nothing is counted that was not blocked.
 */

const core = new AdBlockCore()
const RULESET_CATEGORY: Record<string, AdBlockCategory> = { ads: 'ads', 'ads-strict': 'ads', trackers: 'trackers', 'trackers-strict': 'trackers', annoyances: 'annoyances', 'annoyances-strict': 'annoyances' }
const SETTINGS_KEY = 'orbis.adblock.settings'
const PAGES_KEY = 'orbis.adblock.pages'
const url = (path: string): string => chrome.runtime.getURL(`adblock/${path}`)

// ---------------------------------------------------------------- start-up

/**
 * Starting up, network protection first.
 *
 * These are two jobs of very different weight, and they used to be one. Loading the cosmetic engines means fetching
 * three multi-megabyte binaries and deserialising them; enabling the network rulesets means one storage read and one
 * `updateEnabledRulesets` call. They were sequenced so that the second waited for the first, which meant the layer
 * that stops an advertisement *before it is fetched* came up behind the layer that hides one *after it has arrived*.
 *
 * Measured on a real build, that left about four seconds from launch in which a page loaded its advertising normally:
 * at 2.9s a known ad script still loaded, at 3.9s it was blocked. A browser that is unprotected for the first page
 * somebody opens is, from where they are sitting, a browser without an ad blocker.
 *
 * So the order is now the order of the priorities: settings, then the network rulesets, then -- separately, and
 * without anything waiting on it -- the cosmetic engines. Nothing was removed; the slow half simply stopped holding
 * the fast half up.
 */
let settingsReady: Promise<void> | null = null
let enginesReady: Promise<void> | null = null

/** The fast half: what the person chose, and the browser's own network rules put into effect. */
async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  core.settings = normalizeSettings(stored[SETTINGS_KEY])
  const session = await chrome.storage.session.get(PAGES_KEY).catch(() => ({}) as Record<string, unknown>)
  if (Array.isArray(session[PAGES_KEY])) core.importPages(session[PAGES_KEY] as [number, unknown][])
}

/** The slow half: the cosmetic engines, for the elements that survive the network layer. */
async function loadEngines(): Promise<void> {
  try {
    const engines: Partial<Record<EngineCategory, FiltersEngine>> = {}
    // Together rather than one after another: they are independent files and nothing reads one before the others.
    const loaded = await Promise.all(
      (['ads', 'trackers', 'annoyances'] as const).map(async (category) => {
        const response = await fetch(url(`engines/${category}.bin`))
        return response.ok ? ([category, FiltersEngine.deserialize(new Uint8Array(await response.arrayBuffer()))] as const) : null
      })
    )
    for (const entry of loaded) if (entry) engines[entry[0]] = entry[1]
    const popupHosts = (await (await fetch(url('popup-hosts.json'))).json()) as string[]
    core.setEngines(engines, popupHosts)
  } catch {
    // No lists built yet: the network rulesets still work; page filtering starts once the lists are built.
  }
}

const whenSettings = (): Promise<void> => (settingsReady ??= loadSettings())
const whenEngines = (): Promise<void> => (enginesReady ??= loadEngines())
/** Kept for the callers that genuinely need everything, such as answering a question about the lists themselves. */
const whenReady = (): Promise<void> => Promise.all([whenSettings(), whenEngines()]).then(() => undefined)

/**
 * The first thing that happens, on every start: turn the network rules on.
 *
 * Before the engines, before the badges, before anything that can wait. `applyExceptions` comes with it because an
 * exception the person set is part of being correct, not part of being fast -- protection that ignores their
 * allowlist for four seconds is its own kind of wrong.
 */
async function protectNow(): Promise<void> {
  await whenSettings()
  await applyRulesets()
  await applyExceptions()
}
void protectNow()
// Started here rather than awaited anywhere: the cosmetic layer arrives when it arrives.
void whenEngines()

async function applyRulesets(): Promise<void> {
  const active = core.active()
  const strict = core.settings.level === 'strict'
  const enable: string[] = []
  for (const category of ['ads', 'trackers', 'annoyances'] as const) {
    if (!active[category]) continue
    enable.push(category)
    if (strict) enable.push(`${category}-strict`)
  }
  const all = Object.keys(RULESET_CATEGORY)
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: all.filter((id) => !enable.includes(id)) })
}

/** Site and resource exceptions are dynamic allow rules, so Chromium honours them in its own network layer. */
async function applyExceptions(): Promise<void> {
  const rules: chrome.declarativeNetRequest.Rule[] = []
  let id = 1
  for (const site of core.settings.siteExceptions) {
    rules.push({ id: id++, priority: 100, action: { type: 'allowAllRequests' as chrome.declarativeNetRequest.RuleActionType }, condition: { requestDomains: [site], resourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[] } })
  }
  for (const key of core.settings.resourceExceptions) {
    rules.push({ id: id++, priority: 100, action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType }, condition: { urlFilter: `||${key}`, isUrlFilterCaseSensitive: false } })
  }
  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules })
}

async function persistSettings(): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: core.settings })
  await applyRulesets()
  await applyExceptions()
  await refreshBadges()
}

// On install and on every browser start, the network rules go on first. `persistSettings` then does the rest --
// badges and storage -- which are not worth a single unprotected request.
chrome.runtime.onInstalled.addListener(() => void protectNow().then(persistSettings))
chrome.runtime.onStartup.addListener(() => void protectNow().then(persistSettings))

// ---------------------------------------------------------------- statistics: real matches only

let savePages: ReturnType<typeof setTimeout> | undefined
core.onStats = (tabId) => {
  void updateBadge(tabId)
  clearTimeout(savePages)
  savePages = setTimeout(() => void chrome.storage.session.set({ [PAGES_KEY]: core.exportPages() }).catch(() => undefined), 1500)
}

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  const category = RULESET_CATEGORY[info.rule.rulesetId]
  if (!category || info.request.tabId < 0) return
  core.recordExternal(info.request.tabId, { category, url: info.request.url, type: info.request.type, rule: `${info.rule.rulesetId} #${info.rule.ruleId}`, action: 'blocked' })
})

async function updateBadge(tabId: number): Promise<void> {
  // The component has no toolbar button (the count is shown in the built-in panel), so there is no badge to set.
  if (!chrome.action) return
  const report = core.report(tabId)
  const total = report ? report.counts.ads + report.counts.trackers + report.counts.annoyances + report.counts.popups + report.counts.redirects : 0
  await chrome.action.setBadgeText({ tabId, text: core.settings.enabled && total ? (total > 999 ? '999+' : String(total)) : '' }).catch(() => undefined)
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#3fd8ff' }).catch(() => undefined)
}
async function refreshBadges(): Promise<void> {
  for (const tab of await chrome.tabs.query({})) if (tab.id !== undefined) await updateBadge(tab.id)
}

// ---------------------------------------------------------------- pages, popups, redirects

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0 && /^https?:/i.test(d.url)) void whenReady().then(() => core.startPage(d.tabId, d.url))
})
chrome.tabs.onRemoved.addListener((tabId) => core.dropPage(tabId))

/** A page-initiated navigation or redirect that lands on an ad or tracking server sends the tab back to where it was. */
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return
  const q = d.transitionQualifiers
  const pageInitiated = d.transitionType === 'link' || q.includes('client_redirect') || q.includes('server_redirect')
  if (!pageInitiated || q.includes('from_address_bar') || q.includes('forward_back')) return
  void whenReady().then(async () => {
    const verdict = core.navigation({ url: d.url, webContentsId: d.tabId, redirect: q.some((x) => x.endsWith('redirect')) })
    if (verdict.block) await chrome.tabs.goBack(d.tabId).catch(() => undefined)
  })
})

const opened = new Map<number, number>()
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
  opened.set(d.tabId, d.sourceTabId)
  void checkPopup(d.tabId, d.url)
})
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0 && opened.has(d.tabId)) void checkPopup(d.tabId, d.url)
})
async function checkPopup(tabId: number, popupUrl: string): Promise<void> {
  const source = opened.get(tabId)
  if (source === undefined || !/^https?:/i.test(popupUrl)) return
  await whenReady()
  const opener = await chrome.tabs.get(source).catch(() => undefined)
  const verdict = core.popup({ url: popupUrl, webContentsId: source, openerUrl: opener?.url })
  if (verdict.block) {
    opened.delete(tabId)
    await chrome.tabs.remove(tabId).catch(() => undefined)
  }
}
chrome.tabs.onRemoved.addListener((tabId) => opened.delete(tabId))

// ---------------------------------------------------------------- page filtering: element hiding and scriptlets

const ranScriptlets = new Map<string, Set<string>>()

async function cosmetics(sender: chrome.runtime.MessageSender, message: { phase: 'start' | 'dom'; dom?: { classes?: string[]; hrefs?: string[]; ids?: string[] } }): Promise<boolean> {
  await whenReady()
  const tabId = sender.tab?.id
  const frameId = sender.frameId ?? 0
  const frameUrl = sender.url
  if (tabId === undefined || !frameUrl || !core.settings.enabled || !core.ready) return false
  const { styles, scripts } = core.cosmetics(frameUrl, message.phase === 'start' ? undefined : (message.dom ?? {}), tabId)
  const target = { tabId, frameIds: [frameId] }
  for (const css of styles) await chrome.scripting.insertCSS({ target, css, origin: 'USER' }).catch(() => undefined)
  const key = `${tabId}:${frameId}:${frameUrl}`
  const ran = ranScriptlets.get(key) ?? new Set<string>()
  ranScriptlets.set(key, ran)
  if (ranScriptlets.size > 300) ranScriptlets.delete(ranScriptlets.keys().next().value!)
  for (const script of scripts) {
    if (ran.has(script)) continue
    ran.add(script)
    // Runs in the page's own world, as scriptlets need to; a scriptlet that cannot run must not break the page.
    await chrome.scripting
      .executeScript({
        target,
        world: 'MAIN',
        injectImmediately: true,
        func: (code: string) => {
          try {
            new Function(code)()
          } catch {
            /* ignored on purpose */
          }
        },
        args: [script]
      })
      .catch(() => undefined)
  }
  return true
}

// ---------------------------------------------------------------- messages from the page filter and from the Orbis panel

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
}

async function state(tabId?: number): Promise<unknown> {
  await whenReady()
  const index = await fetch(url('index.json'))
    .then((r) => r.json())
    .catch(() => null)
  const tab = tabId === undefined ? await currentTab() : await chrome.tabs.get(tabId).catch(() => undefined)
  return {
    settings: core.settings,
    active: activeCategories(core.settings),
    ready: core.ready,
    tab: tab?.id === undefined ? null : { id: tab.id, url: tab.url ?? '', host: hostOf(tab.url ?? '') },
    report: tab?.id === undefined ? null : core.report(tab.id),
    lists: index
  }
}

// The same operations for Orbis itself (the app's control layer runs code in this worker), not reachable from web pages.
;(globalThis as Record<string, unknown>).__orbisAdblock = {
  state: async () => (await whenReady(), state()),
  settings: async (update: Partial<AdBlockSettings>) => {
    await whenReady()
    core.updateSettings(update)
    await persistSettings()
    return state()
  },
  site: async (host: string, allowed: boolean) => {
    await whenReady()
    core.setSite(host, allowed)
    await persistSettings()
    return state()
  },
  resource: async (resourceUrl: string) => {
    await whenReady()
    core.allowResource(resourceUrl)
    await persistSettings()
    return state()
  },
  removeException: async (kind: 'site' | 'resource', value: string) => {
    await whenReady()
    core.removeException(kind, value)
    await persistSettings()
    return state()
  },
  reloadLists: () => {
    setTimeout(() => chrome.runtime.reload(), 50)
    return null
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string; [k: string]: unknown }, sender, reply) => {
  if (!message || typeof message.type !== 'string' || !message.type.startsWith('adblock:')) return false
  const isPanel = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false
  void (async () => {
    if (message.type === 'adblock:cosmetics') return reply(await cosmetics(sender, message as never))
    // Everything below changes settings or reveals what was blocked, so it is for Orbis's own pages only.
    if (!isPanel) return reply({ error: 'not allowed' })
    await whenReady()
    switch (message.type) {
      case 'adblock:state':
        return reply(await state(message.tabId as number | undefined))
      case 'adblock:settings':
        core.updateSettings(message.update as Partial<AdBlockSettings>)
        await persistSettings()
        return reply(await state())
      case 'adblock:site':
        core.setSite(String(message.host), Boolean(message.allowed))
        await persistSettings()
        return reply(await state())
      case 'adblock:resource':
        core.allowResource(String(message.url))
        await persistSettings()
        return reply(await state())
      case 'adblock:remove-exception':
        core.removeException(message.kind === 'site' ? 'site' : 'resource', String(message.value))
        await persistSettings()
        return reply(await state())
      case 'adblock:reload-lists':
        return reply(chrome.runtime.reload())
      default:
        return reply({ error: 'unknown request' })
    }
  })()
  return true
})
