/**
 * Converts the network rules of the Orbis filter lists (EasyList syntax, the same lists the Electron blocker reads) into
 * Chromium declarativeNetRequest rules, so that Chromium's own network layer does the blocking, before a request is made.
 *
 * Nothing here guesses: a rule that DNR cannot express exactly is not converted, and is counted in `skipped` with the
 * reason, so what the Chromium build blocks is always exactly what the report says it blocks.
 */

export type DnrResourceType = 'main_frame' | 'sub_frame' | 'stylesheet' | 'script' | 'image' | 'font' | 'object' | 'xmlhttprequest' | 'ping' | 'media' | 'websocket' | 'other'

export interface DnrRule {
  id: number
  priority: number
  action: { type: 'block' | 'allow' | 'allowAllRequests' }
  condition: {
    urlFilter?: string
    regexFilter?: string
    isUrlFilterCaseSensitive?: boolean
    resourceTypes?: DnrResourceType[]
    excludedResourceTypes?: DnrResourceType[]
    domainType?: 'firstParty' | 'thirdParty'
    initiatorDomains?: string[]
    excludedInitiatorDomains?: string[]
    excludedRequestDomains?: string[]
    requestMethods?: string[]
  }
}

/** How the rule behaves for first-party requests, which decides which ruleset it belongs to (see `Converted`). */
export interface Converted {
  /** Rules for Standard blocking (and Strict, which enables both sets). */
  standard: Omit<DnrRule, 'id'>[]
  /** Extra rules only Strict blocking enables: the first-party versions of generic rules Standard leaves alone. */
  strictExtra: Omit<DnrRule, 'id'>[]
  skipped: Record<string, number>
  total: number
}

const TYPES: Record<string, DnrResourceType> = {
  script: 'script', image: 'image', stylesheet: 'stylesheet', css: 'stylesheet', xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest',
  subdocument: 'sub_frame', frame: 'sub_frame', ping: 'ping', media: 'media', font: 'font', object: 'object', websocket: 'websocket', other: 'other',
  document: 'main_frame', doc: 'main_frame'
}
/** Resource types where a generic rule matching the site's own request may be the site's own functionality (as in blocker.ts). */
const FUNCTIONAL: DnrResourceType[] = ['xmlhttprequest', 'script', 'sub_frame', 'websocket']
/** Options that change what a rule does beyond block/allow, which DNR cannot express the same way here. */
const UNSUPPORTED = ['redirect', 'redirect-rule', 'removeparam', 'queryprune', 'csp', 'replace', 'header', 'ipaddress', 'permissions', 'to', 'all', 'popup', 'inline-script', 'inline-font', 'genericblock', 'generichide', 'elemhide', 'specifichide', 'empty', 'mp4', 'cname', 'uritransform', 'urltransform', 'network', 'strict1p', 'strict3p', 'important-x']

const HOST = /^[a-z0-9.-]+$/i

function skip(skipped: Record<string, number>, reason: string): null {
  skipped[reason] = (skipped[reason] ?? 0) + 1
  return null
}

/** The rule in `line` as DNR rules, or null (with the reason counted). Only network rules are looked at. */
export function convertLine(line: string, skipped: Record<string, number>): { rule: Omit<DnrRule, 'id'>; generic: boolean; functionalOnly: boolean } | null {
  let text = line.trim()
  if (!text || text.startsWith('!') || text.startsWith('[')) return null
  // Cosmetic, scriptlet and HTML filters are the engine's job (they are applied inside the page), not the network layer's.
  if (/#[@?$%]?#|#@?\$#|#@?%#/.test(text) || /##/.test(text)) return null
  let exception = false
  if (text.startsWith('@@')) {
    exception = true
    text = text.slice(2)
  }
  let pattern = text
  let options: string[] = []
  const dollar = lastOptionSeparator(text)
  if (dollar !== -1) {
    pattern = text.slice(0, dollar)
    options = text.slice(dollar + 1).split(',')
  }

  const cond: DnrRule['condition'] = {}
  let important = false
  let matchCase = false
  const types: DnrResourceType[] = []
  const notTypes: DnrResourceType[] = []
  for (const raw of options) {
    const opt = raw.trim()
    if (!opt) continue
    const negated = opt.startsWith('~')
    const [key, value] = splitOption(negated ? opt.slice(1) : opt)
    const k = key.toLowerCase()
    if (k === 'important') important = true
    else if (k === 'match-case') matchCase = true
    else if (k === 'badfilter') return skip(skipped, 'badfilter (handled before conversion)')
    else if (k === 'third-party' || k === '3p') cond.domainType = negated ? 'firstParty' : 'thirdParty'
    else if (k === 'first-party' || k === '1p') cond.domainType = negated ? 'thirdParty' : 'firstParty'
    else if (k === 'domain' || k === 'from') {
      const inc: string[] = []
      const exc: string[] = []
      for (const d of (value ?? '').split('|')) {
        const dom = d.trim().toLowerCase()
        if (!dom) continue
        const isNeg = dom.startsWith('~')
        const name = isNeg ? dom.slice(1) : dom
        if (!HOST.test(name)) return skip(skipped, 'domain= with a pattern DNR cannot express (entities, regex)')
        ;(isNeg ? exc : inc).push(name)
      }
      if (inc.length) cond.initiatorDomains = inc
      if (exc.length) cond.excludedInitiatorDomains = exc
    } else if (k === 'denyallow') {
      const list = (value ?? '').split('|').map((d) => d.trim().toLowerCase()).filter(Boolean)
      if (list.some((d) => !HOST.test(d))) return skip(skipped, 'denyallow= with a pattern DNR cannot express')
      cond.excludedRequestDomains = list
    } else if (k === 'method') {
      const methods = (value ?? '').split('|').map((m) => m.trim().toUpperCase()).filter((m) => m && !m.startsWith('~'))
      if (!methods.length) return skip(skipped, 'method= with only exclusions')
      cond.requestMethods = methods.map((m) => m.toLowerCase())
    } else if (TYPES[k]) (negated ? notTypes : types).push(TYPES[k])
    else if (UNSUPPORTED.includes(k)) return skip(skipped, `$${k}`)
    else return skip(skipped, `unknown option $${k}`)
  }

  let rest = pattern
  if (rest.length > 1 && rest.startsWith('/') && rest.endsWith('/')) {
    // A regular expression rule. DNR uses RE2, which has no lookaround or back-references.
    const source = rest.slice(1, -1)
    if (/\(\?[=!<]|\\[1-9]/.test(source) || source.length > 200 || /[^\x20-\x7e]/.test(source)) return skip(skipped, 'regular expression DNR cannot run')
    cond.regexFilter = source
  } else {
    if (/[^\x20-\x7e]/.test(rest)) return skip(skipped, 'non-ASCII pattern')
    // ABP allows a trailing "^" after "|" oddities; DNR's syntax is the same as ABP's for || | ^ *, so it is passed through.
    if (rest === '' || rest === '*' || rest === '|' || rest === '||') {
      if (!cond.initiatorDomains && !types.length) return skip(skipped, 'rule that matches everything')
      rest = ''
    }
    if (rest) cond.urlFilter = rest
  }
  if (!cond.urlFilter && !cond.regexFilter && !cond.initiatorDomains && !cond.requestMethods) return skip(skipped, 'rule without a pattern')
  cond.isUrlFilterCaseSensitive = matchCase

  // $document on an exception switches the blocker off for the whole page (the "@@||site^$document" idiom).
  let action: DnrRule['action']['type'] = exception ? 'allow' : 'block'
  if (exception && types.includes('main_frame')) {
    action = 'allowAllRequests'
    cond.resourceTypes = ['main_frame', 'sub_frame']
  } else if (types.length) {
    if (!exception && types.includes('main_frame')) return skip(skipped, 'blocking a whole page ($document)')
    cond.resourceTypes = [...new Set(types)]
  } else if (notTypes.length) cond.excludedResourceTypes = [...new Set(notTypes)]

  const priority = exception ? (important ? 4 : 3) : important ? 5 : 1
  const functionalOnly = !cond.resourceTypes ? true : cond.resourceTypes.every((t) => FUNCTIONAL.includes(t))
  // Generic: not anchored to a host and not limited to sites; these are the rules blocker.ts's isUncertain() gives Standard leeway on.
  const generic = !exception && !pattern.startsWith('||') && !cond.initiatorDomains && !cond.regexFilter
  return { rule: { priority, action: { type: action }, condition: cond }, generic, functionalOnly }
}

/** Where the options of a rule start: the last "$" that is followed by something that looks like options. */
function lastOptionSeparator(text: string): number {
  const i = text.lastIndexOf('$')
  if (i === -1) return -1
  const tail = text.slice(i + 1)
  return /^[~a-z0-9_-]+(=[^,]*)?(,[~a-z0-9_-]+(=[^,]*)?)*$/i.test(tail) ? i : -1
}

function splitOption(opt: string): [string, string | undefined] {
  const eq = opt.indexOf('=')
  return eq === -1 ? [opt, undefined] : [opt.slice(0, eq), opt.slice(eq + 1)]
}

/**
 * All the network rules in one list. `badfilter` lines cancel the rule they name (the same text without the option), as in
 * uBlock Origin. Duplicates are dropped. Regex rules are capped because DNR limits them.
 */
export function convertList(text: string, options: { maxRegex?: number } = {}): Converted {
  const skipped: Record<string, number> = {}
  const lines = text.split('\n').map((l) => l.trim())
  const cancelled = new Set<string>()
  for (const l of lines) {
    if (!l.includes('badfilter')) continue
    const m = /^(.*?)[$,]badfilter(?:,(.*))?$/i.exec(l)
    if (m) cancelled.add(normalizeBad(m[1], m[2]))
  }
  const standard: Omit<DnrRule, 'id'>[] = []
  const strictExtra: Omit<DnrRule, 'id'>[] = []
  const seen = new Set<string>()
  let regex = 0
  let total = 0
  for (const l of lines) {
    if (!l || l.startsWith('!') || l.startsWith('[')) continue
    const key = normalizeBad(l.replace(/\$.*$/, ''), l.includes('$') ? l.slice(l.lastIndexOf('$') + 1) : undefined)
    if (cancelled.has(key) && !l.includes('badfilter')) {
      skip(skipped, 'cancelled by $badfilter')
      continue
    }
    const converted = convertLine(l, skipped)
    if (!converted) continue
    total++
    const { rule, generic, functionalOnly } = converted
    if (rule.condition.regexFilter && ++regex > (options.maxRegex ?? 900)) {
      skip(skipped, 'regular expression over the DNR limit')
      continue
    }
    const signature = JSON.stringify(rule)
    if (seen.has(signature)) continue
    seen.add(signature)
    // Standard leaves a site's own scripts/XHR/frames alone when only a generic rule matches; Strict blocks them too.
    if (generic && functionalOnly && !rule.condition.domainType) {
      standard.push({ ...rule, condition: { ...rule.condition, domainType: 'thirdParty' } })
      strictExtra.push({ ...rule, condition: { ...rule.condition, domainType: 'firstParty' } })
    } else standard.push(rule)
  }
  return { standard, strictExtra, skipped, total }
}

function normalizeBad(pattern: string, options: string | undefined): string {
  const opts = (options ?? '').split(',').filter((o) => o && o.toLowerCase() !== 'badfilter').sort().join(',')
  return `${pattern}$${opts}`
}

/** Numbers the rules from `start`, as DNR needs. */
export function withIds(rules: Omit<DnrRule, 'id'>[], start: number): DnrRule[] {
  return rules.map((r, i) => ({ id: start + i, ...r }))
}
