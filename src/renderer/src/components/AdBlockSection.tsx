import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, RotateCcw, X } from 'lucide-react'
import type { AdBlockCategories, AdBlockCategory, AdBlockEntry, AdBlockLevel, AdBlockPageReport, AdBlockState } from '../../../shared/types'

interface Props {
  /** The active tab's page id, for its blocking results (null without a page). */
  getWebContentsId(): number | null
  pageUrl: string
}

const CATEGORY_LABELS: Record<AdBlockCategory, string> = {
  ads: 'Ads',
  trackers: 'Trackers',
  annoyances: 'Overlays & anti-adblock',
  popups: 'Popups',
  redirects: 'Ad redirects'
}
const SHORT: Record<AdBlockCategory, [string, string]> = {
  ads: ['ad', 'ads'],
  trackers: ['tracker', 'trackers'],
  annoyances: ['overlay', 'overlays'],
  popups: ['popup', 'popups'],
  redirects: ['redirect', 'redirects']
}
const LEVELS: { id: AdBlockLevel; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'Strong blocking with the best site compatibility' },
  { id: 'strict', label: 'Strict', hint: 'Also overlays, anti-adblock walls, uncertain matches and third-party popups' },
  { id: 'custom', label: 'Custom', hint: 'Choose what to block' }
]

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

const shortUrl = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname.length > 1 ? u.pathname : ''}`
  } catch {
    return url
  }
}

/** Real counts from the blocking engine, e.g. "18 ads · 7 trackers · 1 popup blocked". */
function statLine(counts: Record<AdBlockCategory, number>): string {
  const parts = (Object.keys(counts) as AdBlockCategory[]).filter((c) => counts[c] > 0 || c === 'ads' || c === 'trackers').map((c) => `${counts[c]} ${SHORT[c][counts[c] === 1 ? 0 : 1]}`)
  return `${parts.join(' · ')} blocked on this page`
}

/**
 * Ad blocking controls inside the browser's ⋮ menu: on/off, the current page's real results, strength, a site
 * exception, the blocked resources (each can be allowed), and the filter lists with update and rollback.
 */
export default function AdBlockSection({ getWebContentsId, pageUrl }: Props): React.JSX.Element {
  const [state, setState] = useState<AdBlockState | null>(null)
  const [report, setReport] = useState<AdBlockPageReport | null>(null)
  const [panel, setPanel] = useState<'none' | 'blocked' | 'filters'>('none')
  const idRef = useRef<number | null>(null)
  idRef.current = getWebContentsId()

  const refresh = useCallback(() => {
    const id = idRef.current
    if (id === null) return setReport(null)
    void window.api.getAdBlockReport(id).then(setReport)
  }, [])

  useEffect(() => {
    void window.api.getAdBlockState().then(setState)
    refresh()
    return window.api.onAdBlockEvent((event) => {
      if (event.type === 'state') {
        setState(event.state)
        refresh()
      } else if (event.type === 'stats' && event.webContentsId === idRef.current) refresh()
    })
  }, [refresh])

  const apply = (change: Promise<AdBlockState | null>): void => {
    void change.then((next) => {
      if (next) setState(next)
      refresh()
    })
  }

  if (!state) {
    return (
      <div className="adblock-section">
        <div className="adblock-row">
          <span className="adblock-title">Ad blocking</span>
          <small>Starting…</small>
        </div>
      </div>
    )
  }

  const settings = state.settings
  const host = hostOf(pageUrl)
  const siteAllowed = Boolean(host) && settings.siteExceptions.some((site) => host === site || host.endsWith(`.${site}`))
  const entries: AdBlockEntry[] = report?.recent ?? []
  const blockedCount = entries.filter((e) => e.action === 'blocked' || e.action === 'redirected').length
  const rules = state.lists.reduce((n, l) => n + l.rules, 0)
  const lastUpdate = state.updatedAt ? new Date(state.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'unknown'
  const exceptions = [...settings.siteExceptions.map((value) => ({ kind: 'site' as const, value })), ...settings.resourceExceptions.map((value) => ({ kind: 'resource' as const, value }))]

  return (
    <div className="adblock-section">
      <div className="adblock-row">
        <span className="adblock-title">Ad blocking</span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Ad blocking"
          className={`adblock-switch${settings.enabled ? ' on' : ''}`}
          onClick={() => apply(window.api.updateAdBlockSettings({ enabled: !settings.enabled }))}
        >
          <span />
        </button>
      </div>

      {settings.enabled && (
        <p className="adblock-stats" role="status">
          {!state.ready
            ? 'Loading filter lists…'
            : !host
              ? 'Open a page to see what gets blocked'
              : siteAllowed
                ? `Nothing is blocked on ${host} (allowed)`
                : report
                  ? `${statLine(report.counts)}${report.hidingRules ? ` · ${report.hidingRules} hiding rules` : ''}`
                  : 'Nothing recorded for this page yet (reload to record)'}
        </p>
      )}

      <div className="adblock-levels" role="radiogroup" aria-label="Blocking strength">
        {LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            role="radio"
            aria-checked={settings.level === level.id}
            title={level.hint}
            disabled={!settings.enabled}
            className={settings.level === level.id ? 'selected' : undefined}
            onClick={() => apply(window.api.updateAdBlockSettings({ level: level.id }))}
          >
            {level.label}
          </button>
        ))}
      </div>

      {settings.enabled && settings.level === 'custom' && (
        <div className="adblock-categories">
          {(Object.keys(CATEGORY_LABELS) as (keyof AdBlockCategories)[]).map((category) => (
            <label key={category} className="adblock-check">
              <input
                type="checkbox"
                checked={settings.custom[category]}
                onChange={(e) => apply(window.api.updateAdBlockSettings({ custom: { ...settings.custom, [category]: e.target.checked } }))}
              />
              {CATEGORY_LABELS[category]}
            </label>
          ))}
        </div>
      )}

      {host && (
        <label className="adblock-check">
          <input type="checkbox" checked={siteAllowed} disabled={!settings.enabled} onChange={(e) => apply(window.api.setAdBlockSite(host, e.target.checked))} />
          Allow ads on {host}
        </label>
      )}

      <div className="adblock-links">
        <button type="button" aria-expanded={panel === 'blocked'} disabled={!host} onClick={() => setPanel(panel === 'blocked' ? 'none' : 'blocked')}>
          <ChevronDown size={12} className={panel === 'blocked' ? 'open' : undefined} />
          Blocked resources ({blockedCount})
        </button>
        <button type="button" aria-expanded={panel === 'filters'} onClick={() => setPanel(panel === 'filters' ? 'none' : 'filters')}>
          <ChevronDown size={12} className={panel === 'filters' ? 'open' : undefined} />
          Filters & exceptions
        </button>
      </div>

      {panel === 'blocked' && (
        <ol className="adblock-list" aria-label="Blocked resources on this page">
          {entries.length === 0 && <li className="adblock-empty">Nothing blocked on this page.</li>}
          {entries.slice(0, 80).map((entry, i) => (
            <li key={`${entry.at}-${i}`} title={`${entry.url}\nType: ${entry.type}${entry.rule ? `\nRule: ${entry.rule}` : ''}`}>
              <span className={`adblock-cat ${entry.category}`}>{SHORT[entry.category][0]}</span>
              <span className="truncate">{shortUrl(entry.url)}</span>
              {entry.action === 'blocked' || entry.action === 'redirected' ? (
                <button type="button" onClick={() => apply(window.api.allowAdBlockResource(entry.url))} title="Always allow this resource (everything else stays blocked)">
                  Allow
                </button>
              ) : (
                <small>{entry.action === 'uncertain' ? 'kept' : 'allowed'}</small>
              )}
            </li>
          ))}
        </ol>
      )}

      {panel === 'filters' && (
        <div className="adblock-filters">
          <p>
            {state.lists.length} lists · {rules.toLocaleString()} rules · updated {lastUpdate}
          </p>
          {state.notice && <p className="adblock-notice">{state.notice}</p>}
          <div className="adblock-links">
            <button type="button" disabled={state.updating} onClick={() => apply(window.api.updateAdBlockFilters())}>
              {state.updating ? 'Updating…' : 'Update filters'}
            </button>
            <button type="button" disabled={!state.canRollback || state.updating} onClick={() => apply(window.api.rollbackAdBlockFilters())}>
              <RotateCcw size={11} />
              Roll back
            </button>
          </div>
          <p className="adblock-subhead">Exceptions</p>
          <ul className="adblock-list">
            {exceptions.length === 0 && <li className="adblock-empty">No exceptions.</li>}
            {exceptions.map((ex) => (
              <li key={`${ex.kind}:${ex.value}`}>
                <span className="adblock-cat">{ex.kind}</span>
                <span className="truncate" title={ex.value}>
                  {ex.value}
                </span>
                <button type="button" aria-label={`Remove exception for ${ex.value}`} onClick={() => apply(window.api.removeAdBlockException(ex.kind, ex.value))}>
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
