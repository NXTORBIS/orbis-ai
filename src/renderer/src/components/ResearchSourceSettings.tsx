import { useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { readSourcePreferences, SOURCE_KIND_LABELS, SOURCE_KINDS, type SourceKind, type SourcePreferences } from '../../../shared/researchSources'
import type { Settings } from '../../../shared/types'

/**
 * Settings → Browsing → which sources research should use.
 *
 * Research ranked pages on how well they matched and how recent they were, and that was all. Somebody who knew the
 * good answer lived in the documentation had no way to say so, and somebody who knew a site was rubbish had to watch
 * it come back every time.
 *
 * The wording on screen is careful about what a preference can do. Preferring academic sources cannot produce an
 * academic source for a question that has none; it decides the order among pages that were really found. Blocking is
 * the only absolute here, and what it leaves out is said under the answer.
 */
export default function ResearchSourceSettings({
  settings,
  onChange
}: {
  settings: Settings | null
  onChange(update: { researchSources: SourcePreferences }): void
}): ReactElement {
  const [adding, setAdding] = useState('')
  if (!settings) return <p className="setting-note">Loading…</p>
  const prefs = readSourcePreferences(settings.researchSources)

  const set = (patch: Partial<SourcePreferences>): void => onChange({ researchSources: readSourcePreferences({ ...prefs, ...patch }) })

  const choose = (kind: SourceKind, want: 'prefer' | 'avoid' | 'none'): void =>
    set({
      prefer: want === 'prefer' ? [...prefs.prefer.filter((one) => one !== kind), kind] : prefs.prefer.filter((one) => one !== kind),
      avoid: want === 'avoid' ? [...prefs.avoid.filter((one) => one !== kind), kind] : prefs.avoid.filter((one) => one !== kind)
    })

  const block = (): void => {
    const site = adding.trim().toLowerCase()
    if (!site) return
    set({ blocked: [...prefs.blocked, site] })
    setAdding('')
  }

  return (
    <div className="skills-settings">
      <p className="setting-note">
        Which sources research leans towards. A preference decides the order among the pages Orbis really found — it cannot
        produce a kind of source a question does not have.
      </p>

      {SOURCE_KINDS.map((kind) => (
        <div key={kind} className="skills-row">
          <span>
            {SOURCE_KIND_LABELS[kind].label}
            <small className="skill-meta"> · {SOURCE_KIND_LABELS[kind].blurb}</small>
          </span>
          <select
            value={prefs.prefer.includes(kind) ? 'prefer' : prefs.avoid.includes(kind) ? 'avoid' : 'none'}
            aria-label={SOURCE_KIND_LABELS[kind].label}
            onChange={(e) => choose(kind, e.target.value as 'prefer' | 'avoid' | 'none')}
          >
            <option value="none">No preference</option>
            <option value="prefer">Prefer</option>
            <option value="avoid">Put last</option>
          </select>
        </div>
      ))}

      <h4 className="setting-subhead">Sites never to read</h4>
      <p className="setting-note">
        These are not read at all. When one would have been a result, the answer says how many were left out rather than
        quietly showing you fewer.
      </p>
      <div className="setting-row-inline">
        <input
          value={adding}
          placeholder="example.com, or *.example.com"
          aria-label="A site research should never read"
          maxLength={120}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && block()}
        />
        <button type="button" className="queue-btn small" onClick={block} disabled={!adding.trim()}>
          Block
        </button>
      </div>
      {prefs.blocked.length > 0 && (
        <ul className="blocked-list">
          {prefs.blocked.map((site) => (
            <li key={site}>
              <span>{site}</span>
              <button type="button" className="icon-btn" aria-label={`Stop blocking ${site}`} onClick={() => set({ blocked: prefs.blocked.filter((one) => one !== site) })}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
