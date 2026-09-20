import type { AdBlockAction } from './intent'

/** What chat needs of the running Orbis browser: its extension's page, where the ad blocker lives. */
export interface AdblockBridge {
  run<T>(expression: string): Promise<T>
}

interface Report {
  pageUrl: string
  siteAllowed: boolean
  counts: Record<string, number>
  hidingRules: number
  scriptlets: number
  recent: { action: string; category: string; type: string; url: string; rule?: string }[]
}
interface State {
  settings: { enabled: boolean; level: string; siteExceptions: string[]; resourceExceptions: string[] }
  active: Record<string, boolean>
  ready: boolean
  report: Report | null
  lists: { version?: string; rulesets?: Record<string, { rules: number }> } | null
}

const WORDS: Record<string, [string, string]> = {
  ads: ['ad', 'ads'],
  trackers: ['tracker', 'trackers'],
  annoyances: ['overlay or anti-adblock element', 'overlays and anti-adblock elements'],
  popups: ['popup', 'popups'],
  redirects: ['ad redirect', 'ad redirects']
}
const word = (category: string, plural: boolean): string => WORDS[category]?.[plural ? 1 : 0] ?? category
const hostOf = (url: string): string => {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

const call = <T>(bridge: AdblockBridge, expression: string): Promise<T> => bridge.run<T>(`globalThis.__orbisAdblock.${expression}`)

/**
 * Runs an ad blocking command from chat on the Orbis browser's ad blocker (the Orbis extension in Chromium) and returns the facts to
 * answer with, taken only from what that blocker reports. What it cannot do from here it says, so the answer never claims it.
 */
export async function adblockCommand(bridge: AdblockBridge, action: AdBlockAction, target: string | null, pageUrl: string | undefined): Promise<string> {
  const host = pageUrl ? hostOf(pageUrl) : ''
  let done = ''
  const named = target && /\.[a-z]{2,}/i.test(target) ? hostOf(target) : ''
  switch (action) {
    case 'allow_site': {
      const site = named || host
      if (!site) done = 'No site was changed: no page is open in the Orbis browser and no site was named.'
      else {
        await call(bridge, `site(${JSON.stringify(site)}, true)`)
        done = `Added a site exception: nothing is blocked on ${site} now. Reload the page for it to take effect.`
      }
      break
    }
    case 'block_site': {
      const site = named || host
      const current = await call<State>(bridge, 'state()')
      if (!site || !current.settings.siteExceptions.includes(site)) done = `${site || 'This site'} had no site exception, so blocking was already on there.`
      else {
        await call(bridge, `site(${JSON.stringify(site)}, false)`)
        done = `Removed the site exception: ads and trackers are blocked on ${site} again. Reload the page for it to take effect.`
      }
      break
    }
    case 'allow_resource':
      done = "Allowing one blocked resource can't be done from chat in the Orbis browser. Allowing the whole site can be: ask to allow ads on the site, or use the ad blocker's own panel to allow a single resource."
      break
    case 'strict':
    case 'standard':
      await call(bridge, `settings(${JSON.stringify({ level: action, enabled: true })})`)
      done = `Ad blocking is now ${action === 'strict' ? 'Strict' : 'Standard'}. It applies to pages as they load.`
      break
    case 'enable':
    case 'disable':
      await call(bridge, `settings(${JSON.stringify({ enabled: action === 'enable' })})`)
      done = action === 'enable' ? 'Turned ad blocking on.' : 'Turned ad blocking off everywhere (site exceptions are kept).'
      break
    case 'update':
      done = "The Orbis browser's filter lists are built into the Orbis extension and come with each Orbis release; there is no separate list update to run from chat."
      break
    case 'report':
      break
  }
  const state = await call<State>(bridge, 'state()')
  const s = state.settings
  const rules = Object.values(state.lists?.rulesets ?? {}).reduce((n, r) => n + r.rules, 0)
  const lines = [
    "Ad blocking facts from the Orbis browser's blocker. Answer only from these facts; never add numbers, resources or reasons that aren't listed.",
    `Ad blocking: ${s.enabled ? `on (${s.level === 'custom' ? 'Custom' : s.level === 'strict' ? 'Strict' : 'Standard'})` : 'off'}${state.ready ? '' : ', filter lists still loading'}. Blocking now: ${Object.keys(state.active).map((c) => `${word(c, true)} ${state.active[c] ? 'on' : 'off'}`).join(', ')}.`,
    `Filter lists: ${rules.toLocaleString('en-US')} rules, version ${state.lists?.version ?? 'unknown'}.`,
    `Site exceptions: ${s.siteExceptions.join(', ') || 'none'}. Resource exceptions: ${s.resourceExceptions.join(', ') || 'none'}.`
  ]
  const report = state.report
  if (!pageUrl) lines.push('No page is open in the Orbis browser.')
  else if (!report) lines.push(`The open page (${pageUrl}) has no blocking record yet: it loaded before blocking started. Reloading it will record what gets blocked.`)
  else {
    const counts = Object.keys(report.counts).map((c) => `${report.counts[c]} ${word(c, report.counts[c] !== 1)}`).join(', ')
    lines.push(`Open page: ${report.pageUrl}. Site exception: ${report.siteAllowed ? 'yes (nothing is blocked here)' : 'no'}. Blocked since it loaded: ${counts}. Element-hiding rules applied: ${report.hidingRules}; scriptlets injected: ${report.scriptlets}.`)
    const acted = report.recent.filter((e) => e.action === 'blocked' || e.action === 'redirected').slice(0, 25)
    if (acted.length) lines.push(`Most recent blocked requests (newest first):\n${acted.map((e) => `- ${e.action} ${word(e.category, false)} (${e.type}) ${e.url} — rule: ${e.rule ?? 'unknown'}`).join('\n')}`)
    const allowed = report.recent.filter((e) => e.action === 'uncertain' || e.action === 'allowed-by-exception').slice(0, 15)
    if (allowed.length) lines.push(`Matched a rule but allowed (uncertain matches kept to avoid breaking the site, or exceptions):\n${allowed.map((e) => `- ${e.action} (${e.type}) ${e.url} — rule: ${e.rule ?? 'unknown'}`).join('\n')}`)
  }
  if (done) lines.push(`Action taken just now: ${done}`)
  return lines.join('\n')
}
