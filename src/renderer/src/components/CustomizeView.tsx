import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, FileUp, History, Paintbrush, RotateCcw, ShieldCheck, Sparkles, Undo2, X, Zap } from 'lucide-react'
import type { AppearanceConfig, ExperienceConfig } from '../../../shared/experience'
import { defaultConfig, describeConfig, diffConfig, isDefaultConfig } from '../../../shared/experience'
import type { Experience } from '../lib/experience'
import type { NoticeKind } from '../App'

type Category = 'appearance' | 'newTab' | 'accessibility' | 'performance' | 'privacy' | 'advanced'

const CATEGORIES: { id: Category; label: string; icon: typeof Paintbrush }[] = [
  { id: 'appearance', label: 'Appearance', icon: Paintbrush },
  { id: 'newTab', label: 'New tab', icon: Sparkles },
  { id: 'accessibility', label: 'Accessibility', icon: Check },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'advanced', label: 'Advanced', icon: History }
]

const ACCENTS = ['', '#3fd8ff', '#3ee58a', '#ffbe4d', '#ff4d6d', '#a78bfa', '#f472b6', '#60a5fa']

const when = (time: number): string => {
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : new Date(time).toLocaleString()
}

/**
 * The Customize centre: everything optional about Orbis, in one place. Changes are shown as they are made and are only
 * kept when applied; every part can be put back on its own, and the whole customisation layer can be undone at once
 * without touching tabs, bookmarks, notes, tasks, workflows or settings.
 */
export default function CustomizeView({ experience, onClose, onNotify }: { experience: Experience; onClose(): void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [category, setCategory] = useState<Category>('appearance')
  const [draft, setDraft] = useState<ExperienceConfig>(experience.config)
  const [snapshots, setSnapshots] = useState<{ id: string; reason: string; takenAt: number; summary: string[] }[]>([])
  const [health, setHealth] = useState<{ ok: boolean; problems: string[]; repairs: string[]; snapshots: number } | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const savedConfig = useRef(experience.config)

  // The draft follows what is saved until the user starts changing things.
  useEffect(() => {
    if (!experience.loading) {
      savedConfig.current = experience.config
      setDraft((current) => (isSame(current, experience.config) ? experience.config : current))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experience.loading])

  const loadHistory = async (): Promise<void> => {
    const [list, state] = await Promise.all([window.api.experienceSnapshots(), window.api.experienceHealth()])
    setSnapshots(list)
    setHealth(state)
  }

  useEffect(() => {
    void loadHistory()
    return window.api.onExperienceChanged(() => void loadHistory())
  }, [])

  const changes = useMemo(() => diffConfig(savedConfig.current, draft), [draft])
  const dirty = changes.length > 0

  /** Every change previews at once, so the user sees what they are choosing before keeping it. */
  const change = (next: ExperienceConfig): void => {
    setDraft(next)
    experience.preview(next)
  }
  const changeAppearance = (patch: Partial<AppearanceConfig>): void => change({ ...draft, appearance: { ...draft.appearance, ...patch } })

  const apply = async (): Promise<void> => {
    await experience.save(draft, `Changed ${[...new Set(changes.map((c) => c.path.split('.')[0]))].join(', ')}`)
    savedConfig.current = draft
    await loadHistory()
    onNotify('Your changes are saved')
  }

  const cancel = (): void => {
    setDraft(savedConfig.current)
    experience.cancelPreview()
  }

  const resetSection = async (section: keyof ExperienceConfig, label: string): Promise<void> => {
    const config = await window.api.resetExperienceSection(String(section))
    savedConfig.current = config
    setDraft(config)
    experience.preview(null)
    await loadHistory()
    onNotify(`${label} is back to how Orbis has it`)
  }

  const restoreOriginal = async (): Promise<void> => {
    const { wasDefault } = await window.api.restoreOriginalExperience()
    setConfirmRestore(false)
    const config = await window.api.getExperience()
    savedConfig.current = config
    setDraft(config)
    experience.preview(null)
    await loadHistory()
    onNotify(wasDefault ? 'Orbis was already as it comes' : 'Orbis is back to how it comes')
  }

  const exportFile = async (): Promise<void> => {
    const file = await window.api.exportExperience()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
    link.download = 'orbis-personalisation.json'
    link.click()
    URL.revokeObjectURL(link.href)
    onNotify('Your personalisation is saved to a file')
  }

  const importFile = async (file: File): Promise<void> => {
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      return onNotify('That file could not be read', 'error')
    }
    const checked = await window.api.checkExperienceImport(raw)
    if (!checked.ok) return onNotify(checked.problems[0] ?? 'That file cannot be used', 'error')
    const { config } = await window.api.importExperience(raw, 'replace')
    savedConfig.current = config
    setDraft(config)
    experience.preview(null)
    await loadHistory()
    onNotify(`Brought in: ${checked.summary.slice(0, 3).join(', ')}`)
  }

  const slider = (label: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void, format: (value: number) => string) => (
    <label className="cz-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <small>{format(value)}</small>
    </label>
  )

  const toggle = (label: string, value: boolean, onChange: (value: boolean) => void, hint?: string) => (
    <label className="cz-row">
      <span>
        {label}
        {hint && <small className="view-muted">{hint}</small>}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )

  return (
    <div className="view customize-view" role="region" aria-label="Customize Orbis">
      <header className="view-head">
        <h2>Customize</h2>
        <div className="view-actions">
          {dirty && (
            <>
              <span className="cz-dirty">
                {changes.length} change{changes.length === 1 ? '' : 's'} being shown
              </span>
              <button type="button" className="queue-btn" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="queue-btn primary" onClick={() => void apply()}>
                <Check size={14} /> Apply
              </button>
            </>
          )}
          <button type="button" className="icon-btn" aria-label="Close customize" onClick={() => (dirty ? cancel() : undefined, onClose())}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="cz-body">
        <nav className="cz-nav" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" className={`tasks-nav${category === c.id ? ' on' : ''}`} onClick={() => setCategory(c.id)}>
              <c.icon size={14} /> {c.label}
            </button>
          ))}
          <div className="cz-state">
            {isDefaultConfig(savedConfig.current) ? (
              <p className="view-muted">This is Orbis exactly as it comes.</p>
            ) : (
              <>
                <p className="view-muted">You have personalised:</p>
                <ul>
                  {describeConfig(savedConfig.current).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </nav>

        <section className="cz-panel" aria-label={CATEGORIES.find((c) => c.id === category)?.label}>
          {category === 'appearance' && (
            <>
              <div className="cz-section-head">
                <h3>Appearance</h3>
                <button type="button" className="queue-btn small" onClick={() => void resetSection('appearance', 'Appearance')}>
                  <RotateCcw size={12} /> Reset this
                </button>
              </div>
              <div className="cz-row">
                <span>Accent colour</span>
                <div className="cz-accents">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent || 'orbis'}
                      type="button"
                      className={`board-color${draft.appearance.accent === accent ? ' on' : ''}${accent ? '' : ' cz-accent-default'}`}
                      style={accent ? { background: accent } : undefined}
                      aria-label={accent ? `Accent ${accent}` : 'The Orbis accent'}
                      onClick={() => changeAppearance({ accent })}
                    >
                      {accent ? '' : 'Orbis'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="cz-row">
                <span>Spacing</span>
                <select value={draft.appearance.density} onChange={(e) => changeAppearance({ density: e.target.value as AppearanceConfig['density'] })}>
                  <option value="comfortable">Comfortable (as Orbis comes)</option>
                  <option value="cosy">Cosy</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
              {slider('Text and controls', draft.appearance.fontScale, 0.85, 1.4, 0.05, (fontScale) => changeAppearance({ fontScale }), (v) => `${Math.round(v * 100)}%`)}
              {slider('Corner rounding', draft.appearance.cornerRadius, 0, 24, 2, (cornerRadius) => changeAppearance({ cornerRadius }), (v) => (v ? `${v}px` : 'as Orbis has it'))}
              {slider('Panel see-through', draft.appearance.transparency, 0.5, 1.5, 0.05, (transparency) => changeAppearance({ transparency }), (v) => (v === 1 ? 'as Orbis has it' : `${Math.round(v * 100)}%`))}
              {slider('Background blur', draft.appearance.blur, 0, 2, 0.1, (blur) => changeAppearance({ blur }), (v) => (v === 1 ? 'as Orbis has it' : `${Math.round(v * 100)}%`))}
              <label className="cz-row">
                <span>Movement</span>
                <select value={draft.appearance.reducedMotion} onChange={(e) => changeAppearance({ reducedMotion: e.target.value as AppearanceConfig['reducedMotion'] })}>
                  <option value="system">Follow the system</option>
                  <option value="on">Keep movement to a minimum</option>
                  <option value="off">Full movement</option>
                </select>
              </label>
            </>
          )}

          {category === 'newTab' && (
            <>
              <div className="cz-section-head">
                <h3>New tab</h3>
                <button type="button" className="queue-btn small" onClick={() => void resetSection('newTab', 'New tab')}>
                  <RotateCcw size={12} /> Reset this
                </button>
              </div>
              <p className="view-muted cz-note">
                The new tab is the Orbis one unless you choose otherwise. Other modes, widgets and wallpapers arrive with the next part of this work; what is here now is what works today.
              </p>
              {toggle('Greeting', draft.newTab.greeting, (greeting) => change({ ...draft, newTab: { ...draft.newTab, greeting } }))}
              {toggle('Shortcuts', draft.newTab.shortcuts, (shortcuts) => change({ ...draft, newTab: { ...draft.newTab, shortcuts } }))}
            </>
          )}

          {category === 'accessibility' && (
            <>
              <div className="cz-section-head">
                <h3>Accessibility</h3>
                <button type="button" className="queue-btn small" onClick={() => void resetSection('accessibility', 'Accessibility')}>
                  <RotateCcw size={12} /> Reset this
                </button>
              </div>
              {toggle('High contrast', draft.accessibility.highContrast, (highContrast) => change({ ...draft, accessibility: { ...draft.accessibility, highContrast } }), 'Stronger text and edges')}
              {toggle('Larger text', draft.accessibility.largerText, (largerText) => change({ ...draft, accessibility: { ...draft.accessibility, largerText } }), 'At least 115%')}
              {toggle('Always show focus', draft.accessibility.alwaysShowFocus, (alwaysShowFocus) => change({ ...draft, accessibility: { ...draft.accessibility, alwaysShowFocus } }), 'Shows where the keyboard is, even when using the mouse')}
            </>
          )}

          {category === 'performance' && (
            <>
              <div className="cz-section-head">
                <h3>Performance</h3>
                <button type="button" className="queue-btn small" onClick={() => void resetSection('performance', 'Performance')}>
                  <RotateCcw size={12} /> Reset this
                </button>
              </div>
              <label className="cz-row">
                <span>Mode</span>
                <select value={draft.performance.mode} onChange={(e) => change({ ...draft, performance: { ...draft.performance, mode: e.target.value as ExperienceConfig['performance']['mode'] } })}>
                  <option value="balanced">Balanced (as Orbis comes)</option>
                  <option value="performance">Maximum performance</option>
                  <option value="visual">Visual</option>
                  <option value="battery">Battery saver</option>
                </select>
              </label>
              {toggle('Rest unused widgets', draft.performance.suspendIdleWidgets, (suspendIdleWidgets) => change({ ...draft, performance: { ...draft.performance, suspendIdleWidgets } }))}
              {toggle('Data saver', draft.performance.dataSaver, (dataSaver) => change({ ...draft, performance: { ...draft.performance, dataSaver } }), 'Refresh remote things less often')}
              <p className="view-muted cz-note">Maximum performance and battery saver also keep movement to a minimum.</p>
            </>
          )}

          {category === 'privacy' && (
            <>
              <div className="cz-section-head">
                <h3>Privacy</h3>
                <button type="button" className="queue-btn small" onClick={() => void resetSection('privacy', 'Privacy')}>
                  <RotateCcw size={12} /> Reset this
                </button>
              </div>
              {toggle('Do not personalise', draft.privacy.doNotPersonalize, (doNotPersonalize) => change({ ...draft, privacy: { ...draft.privacy, doNotPersonalize } }), 'Nothing about how you use Orbis is learnt or kept')}
              {toggle('Keep personalisation out of private tabs', draft.privacy.keepOutOfPrivate, (keepOutOfPrivate) => change({ ...draft, privacy: { ...draft.privacy, keepOutOfPrivate } }))}
              <label className="cz-row">
                <span>Keep usage information for</span>
                <select value={draft.privacy.keepUsageDays} onChange={(e) => change({ ...draft, privacy: { ...draft.privacy, keepUsageDays: Number(e.target.value) } })}>
                  <option value={0}>Do not keep it</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={365}>A year</option>
                </select>
              </label>
            </>
          )}

          {category === 'advanced' && (
            <>
              <div className="cz-section-head">
                <h3>Advanced</h3>
              </div>
              {health && (
                <div className={`cz-health${health.ok ? '' : ' bad'}`}>
                  <b>{health.ok ? 'Personalisation is healthy' : 'Something needed attention'}</b>
                  {health.problems.map((problem) => (
                    <p key={problem}>{problem}</p>
                  ))}
                  {health.repairs.map((repair) => (
                    <p key={repair} className="view-muted">
                      {repair}
                    </p>
                  ))}
                  <button type="button" className="queue-btn small" onClick={() => void loadHistory()}>
                    Check again
                  </button>
                </div>
              )}

              <div className="cz-section-head">
                <h4>Recent changes</h4>
              </div>
              <div className="cz-snapshots">
                {snapshots.map((snapshot) => (
                  <div key={snapshot.id} className="cz-snapshot">
                    <span>
                      <b>{snapshot.reason}</b>
                      <small className="view-muted">{when(snapshot.takenAt)}</small>
                    </span>
                    <button
                      type="button"
                      className="queue-btn small"
                      onClick={() =>
                        void window.api.restoreExperienceSnapshot(snapshot.id).then(async (config) => {
                          savedConfig.current = config
                          setDraft(config)
                          experience.preview(null)
                          await loadHistory()
                          onNotify('Went back to how it was')
                        })
                      }
                    >
                      <Undo2 size={12} /> Go back to this
                    </button>
                  </div>
                ))}
                {!snapshots.length && <p className="view-muted">Nothing has been changed yet.</p>}
              </div>

              <div className="cz-section-head">
                <h4>Your personalisation as a file</h4>
              </div>
              <div className="og-inline">
                <button type="button" className="queue-btn" onClick={() => void exportFile()}>
                  <Download size={14} /> Save to a file
                </button>
                <button type="button" className="queue-btn" onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} /> Bring in from a file
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void importFile(file)
                  }}
                />
              </div>

              <div className="cz-section-head">
                <h4>Start again</h4>
              </div>
              {confirmRestore ? (
                <div className="og-inline">
                  <button type="button" className="queue-btn danger" onClick={() => void restoreOriginal()}>
                    Yes, restore the original Orbis
                  </button>
                  <button type="button" className="queue-btn" onClick={() => setConfirmRestore(false)}>
                    Keep my personalisation
                  </button>
                </div>
              ) : (
                <button type="button" className="queue-btn" onClick={() => setConfirmRestore(true)}>
                  <RotateCcw size={14} /> Restore the original Orbis experience
                </button>
              )}
              <p className="view-muted cz-note">This puts back only what you personalised. Your tabs, bookmarks, history, notes, tasks, boards, workflows, extensions and settings are untouched.</p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

const isSame = (a: ExperienceConfig, b: ExperienceConfig): boolean => diffConfig(a, b).length === 0

export { defaultConfig }
