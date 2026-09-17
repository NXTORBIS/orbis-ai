import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Download, FileUp, History, Image, LayoutGrid, Paintbrush, Palette, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Undo2, X, Zap } from 'lucide-react'
import type { AppearanceConfig, ExperienceConfig } from '../../../shared/experience'
import { defaultConfig, describeConfig, diffConfig, isDefaultConfig } from '../../../shared/experience'
import type { Experience } from '../lib/experience'
import type { NoticeKind } from '../App'
import type { WidgetCategory, WidgetInstance, WidgetSize, ZoneName } from '../../../shared/widgets'
import { MAX_WIDGETS, newWidgetInstance, permissionsOf, placeWidget, searchWidgets, widgetById, widgetsInZone, ZONES } from '../../../shared/widgets'
import type { StoredTheme } from '../../../shared/themes'
import { BUILT_IN_THEMES, copyOfBuiltIn, MAX_THEMES, newTheme, readability, THEME_TOKENS, themeTokens } from '../../../shared/themes'
import type { Dashboard } from '../../../shared/dashboards'
import { MAX_DASHBOARDS, newDashboard, rememberWidgets, removeDashboard, switchTo } from '../../../shared/dashboards'

type Category = 'appearance' | 'themes' | 'newTab' | 'widgets' | 'accessibility' | 'performance' | 'privacy' | 'advanced'

const CATEGORIES: { id: Category; label: string; icon: typeof Paintbrush }[] = [
  { id: 'appearance', label: 'Appearance', icon: Paintbrush },
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'newTab', label: 'New tab', icon: Sparkles },
  { id: 'widgets', label: 'Widgets', icon: LayoutGrid },
  { id: 'accessibility', label: 'Accessibility', icon: Check },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'advanced', label: 'Advanced', icon: History }
]

const WIDGET_GROUPS: { id: WidgetCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'time', label: 'Time' },
  { id: 'productivity', label: 'Your things' },
  { id: 'browser', label: 'Browser' },
  { id: 'information', label: 'Information' },
  { id: 'utility', label: 'Handy' }
]

const ZONE_WORDS: Record<ZoneName, string> = { top: 'Top', left: 'Left', centre: 'Middle', right: 'Right', bottom: 'Bottom' }

/** Backgrounds Orbis paints itself. Nothing is downloaded, so these work with no connection and carry no tracking. */
const GRADIENTS: { name: string; source: string }[] = [
  { name: 'Deep space', source: 'radial-gradient(120% 120% at 50% 0%, #17213a 0%, #070910 60%, #000 100%)' },
  { name: 'Aurora', source: 'linear-gradient(160deg, #06202a 0%, #0a3a3a 45%, #05131a 100%)' },
  { name: 'Dusk', source: 'linear-gradient(180deg, #2a1730 0%, #140d1c 55%, #05040a 100%)' },
  { name: 'Ember glow', source: 'radial-gradient(110% 110% at 30% 10%, #2e1509 0%, #140905 55%, #000 100%)' },
  { name: 'Morning', source: 'linear-gradient(180deg, #eef3f8 0%, #dbe5f0 60%, #c9d6e6 100%)' }
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
  const [editingTheme, setEditingTheme] = useState<string | null>(null)
  const [widgetSearch, setWidgetSearch] = useState('')
  const [widgetGroup, setWidgetGroup] = useState<WidgetCategory | 'all'>('all')
  const [draft, setDraft] = useState<ExperienceConfig>(experience.config)
  const [snapshots, setSnapshots] = useState<{ id: string; reason: string; takenAt: number; summary: string[] }[]>([])
  const [health, setHealth] = useState<{ ok: boolean; problems: string[]; repairs: string[]; snapshots: number } | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const savedConfig = useRef(experience.config)

  // The draft follows what is saved until the user starts changing things. A change made elsewhere — by Orion, or in
  // another window — shows here too, so applying never quietly puts back an older draft over someone else's change.
  useEffect(() => {
    if (experience.loading) return
    const wasSaved = savedConfig.current
    savedConfig.current = experience.saved
    setDraft((current) => (isSame(current, wasSaved) ? experience.saved : current))
  }, [experience.loading, experience.saved])

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

  // ---- themes ----
  const useTheme = (themeId: string | null): void => change({ ...draft, themeId })
  const addTheme = (theme: StoredTheme): void => {
    if (draft.themes.length >= MAX_THEMES) return onNotify(`That is as many themes as one Orbis can hold (${MAX_THEMES})`, 'error')
    change({ ...draft, themes: [...draft.themes, theme], themeId: theme.id })
    setEditingTheme(theme.id)
  }
  const patchTheme = (id: string, patch: Partial<StoredTheme>): void =>
    change({ ...draft, themes: draft.themes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const deleteTheme = (id: string): void =>
    change({ ...draft, themes: draft.themes.filter((t) => t.id !== id), themeId: draft.themeId === id ? null : draft.themeId })

  const addWallpaper = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) return onNotify('That file is not a picture', 'error')
    if (file.size > 6_000_000) return onNotify('That picture is too large — 6 MB is the most Orbis keeps', 'error')
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('unreadable'))
      reader.readAsDataURL(file)
    }).catch(() => null)
    if (!source) return onNotify('That picture could not be read', 'error')
    const wallpaper = { id: `wall-${Date.now().toString(36)}`, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Wallpaper', source, kind: 'image' as const, addedAt: Date.now() }
    change({ ...draft, wallpapers: [...draft.wallpapers, wallpaper], newTab: { ...draft.newTab, wallpaperId: wallpaper.id } })
  }
  const addGradient = (gradient: { name: string; source: string }): void => {
    const wallpaper = { id: `wall-${Date.now().toString(36)}`, name: gradient.name, source: gradient.source, kind: 'gradient' as const, addedAt: Date.now() }
    change({ ...draft, wallpapers: [...draft.wallpapers, wallpaper], newTab: { ...draft.newTab, wallpaperId: wallpaper.id } })
  }
  const removeWallpaper = (id: string): void =>
    change({ ...draft, wallpapers: draft.wallpapers.filter((w) => w.id !== id), newTab: { ...draft.newTab, wallpaperId: draft.newTab.wallpaperId === id ? null : draft.newTab.wallpaperId } })

  // ---- dashboards ----
  const saveAsDashboard = (): void => {
    if (draft.dashboards.length >= MAX_DASHBOARDS) return onNotify(`That is as many dashboards as one Orbis can hold (${MAX_DASHBOARDS})`, 'error')
    const dashboard = newDashboard(`Dashboard ${draft.dashboards.length + 1}`, draft.widgets)
    change({ ...draft, dashboards: [...draft.dashboards, dashboard], activeDashboardId: dashboard.id })
  }
  const openDashboard = (id: string): void => {
    const next = switchTo(draft.dashboards, draft.activeDashboardId, draft.widgets, id)
    if (next) change({ ...draft, dashboards: next.dashboards, activeDashboardId: next.activeId, widgets: next.widgets })
  }
  const renameDashboard = (id: string, name: string): void =>
    change({ ...draft, dashboards: draft.dashboards.map((d: Dashboard) => (d.id === id ? { ...d, name: name.slice(0, 60) } : d)) })
  const dropDashboard = (id: string): void => {
    const next = removeDashboard(draft.dashboards, draft.activeDashboardId, id)
    change({ ...draft, dashboards: next.dashboards, activeDashboardId: next.activeId })
  }

  // ---- widgets ----
  // While a dashboard is in use, the widgets on screen are that dashboard's, so a change here is a change to it.
  const setWidgets = (widgets: WidgetInstance[]): void =>
    change({ ...draft, widgets, dashboards: rememberWidgets(draft.dashboards, draft.activeDashboardId, widgets) })
  const addWidget = (widget: string): void => {
    if (draft.widgets.length >= MAX_WIDGETS) return onNotify(`That is as many widgets as one Orbis can hold (${MAX_WIDGETS})`, 'error')
    const instance = newWidgetInstance(widget, 'centre', draft.widgets.filter((w) => w.zone === 'centre').length)
    if (instance) setWidgets([...draft.widgets, instance])
  }
  const patchWidget = (id: string, patch: Partial<WidgetInstance>): void => setWidgets(draft.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  const widgetSetting = (instance: WidgetInstance, name: string, value: string | number | boolean): void =>
    patchWidget(instance.id, { settings: { ...instance.settings, [name]: value } })

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

          {category === 'themes' && (
            <>
              <div className="cz-section-head">
                <h3>Themes</h3>
                <button type="button" className="queue-btn small" onClick={() => void resetSection('themes', 'Themes')}>
                  <RotateCcw size={12} /> Reset this
                </button>
              </div>
              <p className="view-muted cz-note">
                A theme changes the colours Orbis paints itself with, and nothing else. Orbis's own colours are always one click away, and a light theme turns on the light Orbis
                already has rather than repainting a dark one.
              </p>

              <div className="cz-theme-grid">
                <button type="button" className={`cz-theme${draft.themeId === null ? ' on' : ''}`} onClick={() => useTheme(null)}>
                  <span className="cz-theme-swatches">
                    {['#0e1013', '#ededef', '#3fd8ff'].map((colour) => (
                      <i key={colour} style={{ background: colour }} />
                    ))}
                  </span>
                  <b>Orbis</b>
                  <small className="view-muted">The colours Orbis has always used.</small>
                  {draft.themeId === null && <span className="cz-theme-on">In use</span>}
                </button>
                {BUILT_IN_THEMES.map((theme) => (
                  <button key={theme.id} type="button" className={`cz-theme${draft.themeId === theme.id ? ' on' : ''}`} onClick={() => useTheme(theme.id)}>
                    <span className="cz-theme-swatches">
                      {[theme.tokens['bg-center'], theme.tokens.text, theme.tokens.cyan ?? '#3fd8ff'].map((colour, i) => (
                        <i key={i} style={{ background: colour }} />
                      ))}
                    </span>
                    <b>{theme.name}</b>
                    <small className="view-muted">{theme.description}</small>
                    {draft.themeId === theme.id && <span className="cz-theme-on">In use</span>}
                  </button>
                ))}
              </div>

              <div className="cz-section-head">
                <h4>Your themes</h4>
                <span className="cz-row-actions">
                  <button type="button" className="queue-btn small" onClick={() => addTheme(newTheme('My theme', 'dark', themeTokens(draft.themeId, draft.themes)))}>
                    <Plus size={12} /> From what is on screen
                  </button>
                  {draft.themeId && BUILT_IN_THEMES.some((t) => t.id === draft.themeId) && (
                    <button type="button" className="queue-btn small" onClick={() => addTheme(copyOfBuiltIn(BUILT_IN_THEMES.find((t) => t.id === draft.themeId)!))}>
                      <Copy size={12} /> Copy this one
                    </button>
                  )}
                </span>
              </div>
              {draft.themes.length === 0 && <p className="view-muted cz-note">None yet. Start from what is on screen, and change whichever colours you like.</p>}
              {draft.themes.map((theme) => {
                const notes = readability(theme.tokens)
                const open = editingTheme === theme.id
                return (
                  <div key={theme.id} className="cz-widget-row">
                    <div className="cz-widget-top">
                      <input
                        className="cz-name"
                        value={theme.name}
                        aria-label={`Name of ${theme.name}`}
                        onChange={(e) => patchTheme(theme.id, { name: e.target.value.slice(0, 60) })}
                      />
                      <select value={theme.base} aria-label={`${theme.name}: light or dark`} onChange={(e) => patchTheme(theme.id, { base: e.target.value as 'dark' | 'light' })}>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                      </select>
                      <button type="button" className="queue-btn small" onClick={() => useTheme(theme.id)} disabled={draft.themeId === theme.id}>
                        {draft.themeId === theme.id ? 'In use' : 'Use'}
                      </button>
                      <button type="button" className="queue-btn small" onClick={() => setEditingTheme(open ? null : theme.id)}>
                        {open ? 'Done' : 'Colours'}
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Copy ${theme.name}`} onClick={() => addTheme(newTheme(`${theme.name} (copy)`, theme.base, theme.tokens))}>
                        <Copy size={14} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${theme.name}`} onClick={() => deleteTheme(theme.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {notes.length > 0 && (
                      <p className="cz-readability" role="status">
                        {notes.map((note) => `${note.label} is ${note.severity === 'hard' ? 'hard to read' : 'a little tight'} on this background (${note.ratio}:1)`).join('. ')}.
                      </p>
                    )}
                    {open && (
                      <div className="cz-widget-settings">
                        {['Background', 'Text', 'Accent', 'Surfaces'].map((group) => (
                          <div key={group}>
                            <span className="hud-label">{group}</span>
                            {THEME_TOKENS.filter((t) => t.group === group).map((spec) => (
                              <label key={spec.name} className="cz-row">
                                <span>{spec.label}</span>
                                <input
                                  type="text"
                                  className="cz-token"
                                  aria-label={`${theme.name}: ${spec.label}`}
                                  placeholder={spec.orbis}
                                  value={theme.tokens[spec.name] ?? ''}
                                  onChange={(e) => {
                                    const tokens = { ...theme.tokens }
                                    if (e.target.value.trim()) tokens[spec.name] = e.target.value.trim()
                                    else delete tokens[spec.name]
                                    patchTheme(theme.id, { tokens })
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        ))}
                        <p className="view-muted cz-note">Leave one empty to keep Orbis's own colour for it.</p>
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="cz-section-head">
                <h4>Wallpaper</h4>
              </div>
              <p className="view-muted cz-note">Shown behind an empty tab. Pictures stay on this computer, and the patterns below are drawn by Orbis rather than fetched.</p>
              <div className="cz-theme-grid">
                <button type="button" className={`cz-theme${draft.newTab.wallpaperId === null ? ' on' : ''}`} onClick={() => change({ ...draft, newTab: { ...draft.newTab, wallpaperId: null } })}>
                  <span className="cz-wall-preview" />
                  <b>None</b>
                  <small className="view-muted">The Orbis background.</small>
                </button>
                {draft.wallpapers.map((wallpaper) => (
                  <div key={wallpaper.id} className={`cz-theme${draft.newTab.wallpaperId === wallpaper.id ? ' on' : ''}`}>
                    <button type="button" className="cz-wall-choose" aria-label={`Use ${wallpaper.name}`} onClick={() => change({ ...draft, newTab: { ...draft.newTab, wallpaperId: wallpaper.id } })}>
                      <span className="cz-wall-preview" style={wallpaper.kind === 'image' ? { backgroundImage: `url(${wallpaper.source})` } : { background: wallpaper.source }} />
                      <b>{wallpaper.name}</b>
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${wallpaper.name}`} onClick={() => removeWallpaper(wallpaper.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="cz-chips">
                <label className="queue-btn small cz-file">
                  <Image size={12} /> Add a picture
                  <input type="file" accept="image/*" aria-label="Add a wallpaper picture" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void addWallpaper(file) }} />
                </label>
                {GRADIENTS.map((gradient) => (
                  <button key={gradient.name} type="button" className="queue-btn small" onClick={() => addGradient(gradient)}>
                    <Plus size={12} /> {gradient.name}
                  </button>
                ))}
              </div>
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
                The new tab is the Orbis one unless you choose otherwise. Turn widgets on here and choose them under Widgets. Other modes and wallpapers arrive with the next part of this work; what is here now is what works today.
              </p>
              {toggle('Greeting', draft.newTab.greeting, (greeting) => change({ ...draft, newTab: { ...draft.newTab, greeting } }))}
              {toggle('Shortcuts', draft.newTab.shortcuts, (shortcuts) => change({ ...draft, newTab: { ...draft.newTab, shortcuts } }))}
              {toggle('Widgets', draft.newTab.widgets, (widgets) => change({ ...draft, newTab: { ...draft.newTab, widgets } }), 'Shows the widgets you have chosen on an empty tab')}
            </>
          )}

          {category === 'widgets' && (
            <>
              <div className="cz-section-head">
                <h3>Widgets</h3>
                <button type="button" className="queue-btn small" onClick={() => void resetSection('widgets', 'Widgets')}>
                  <RotateCcw size={12} /> Reset this
                </button>
              </div>
              <p className="view-muted cz-note">
                Small panels on an empty tab, showing things Orbis already holds. Nothing is added unless you add it, each one says what it reads before you do, and one that stops
                working is set aside on its own rather than taking the browser with it.
                {!draft.newTab.widgets && ' They are switched off for the new tab at the moment \u2014 turn them on under New tab.'}
              </p>

              <div className="cz-section-head">
                <h4>Dashboards</h4>
                <span className="cz-row-actions">
                  <button type="button" className="queue-btn small" onClick={saveAsDashboard}>
                    <Plus size={12} /> Save these as a dashboard
                  </button>
                </span>
              </div>
              {draft.dashboards.length === 0 ? (
                <p className="view-muted cz-note">
                  None yet. A dashboard is a named set of widgets you can switch between — one for work, one for reading. With none, the new tab simply shows the widgets below, as
                  it does today.
                </p>
              ) : (
                <div className="cz-widgets-chosen">
                  {draft.dashboards.map((dashboard: Dashboard) => (
                    <div key={dashboard.id} className="cz-widget-row">
                      <div className="cz-widget-top">
                        <input className="cz-name" value={dashboard.name} aria-label={`Name of ${dashboard.name}`} onChange={(e) => renameDashboard(dashboard.id, e.target.value)} />
                        <small className="view-muted">
                          {dashboard.widgets.length} widget{dashboard.widgets.length === 1 ? '' : 's'}
                        </small>
                        <button type="button" className="queue-btn small" disabled={draft.activeDashboardId === dashboard.id} onClick={() => openDashboard(dashboard.id)}>
                          {draft.activeDashboardId === dashboard.id ? 'In use' : 'Open'}
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Delete ${dashboard.name}`} onClick={() => dropDashboard(dashboard.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="cz-section-head">
                <h4>{draft.activeDashboardId ? `Widgets in ${draft.dashboards.find((d: Dashboard) => d.id === draft.activeDashboardId)?.name ?? 'this dashboard'}` : 'Your widgets'}</h4>
              </div>
              {draft.widgets.length > 0 && (
                <div className="cz-widgets-chosen">
                  {/*
                    * Listed in the order they appear on the new tab, zone by zone, so this reads as the page reads.
                    * A list in a different order to the thing it edits makes people move the wrong widget.
                    */}
                  {ZONES.flatMap((zone) => widgetsInZone(draft.widgets, zone))
                    .concat(draft.widgets.filter((w) => w.disabled))
                    .map((instance) => {
                    const definition = widgetById(instance.widget)
                    if (!definition) return null
                    const siblings = widgetsInZone(draft.widgets, instance.zone)
                    const at = siblings.findIndex((w) => w.id === instance.id)
                    return (
                      <div key={instance.id} className="cz-widget-row">
                        <div className="cz-widget-top">
                          <b>{definition.name}</b>
                          {/* Buttons rather than dragging, so the order can be changed from the keyboard too. */}
                          <span className="cz-widget-order">
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Move ${definition.name} earlier`}
                              disabled={at <= 0}
                              onClick={() => setWidgets(placeWidget(draft.widgets, instance.id, instance.zone, at - 1))}
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Move ${definition.name} later`}
                              disabled={at === -1 || at >= siblings.length - 1}
                              onClick={() => setWidgets(placeWidget(draft.widgets, instance.id, instance.zone, at + 1))}
                            >
                              <ChevronDown size={14} />
                            </button>
                          </span>
                          <select value={instance.zone} aria-label={`Where ${definition.name} sits`} onChange={(e) => patchWidget(instance.id, { zone: e.target.value as ZoneName })}>
                            {ZONES.map((zone) => (
                              <option key={zone} value={zone}>
                                {ZONE_WORDS[zone]}
                              </option>
                            ))}
                          </select>
                          <select value={instance.size} aria-label={`How big ${definition.name} is`} onChange={(e) => patchWidget(instance.id, { size: e.target.value as WidgetSize })}>
                            {definition.sizes.map((size) => (
                              <option key={size} value={size}>
                                {size === 'small' ? 'Small' : size === 'medium' ? 'Medium' : 'Large'}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="icon-btn" aria-label={`Remove ${definition.name}`} onClick={() => setWidgets(draft.widgets.filter((w) => w.id !== instance.id))}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {definition.settings.length > 0 && (
                          <div className="cz-widget-settings">
                            {definition.settings.map((setting) => {
                              const value = instance.settings[setting.name] ?? setting.default
                              const label = `${definition.name}: ${setting.label}`
                              if (setting.type === 'boolean') {
                                return (
                                  <label key={setting.name} className="cz-row">
                                    <span>{setting.label}</span>
                                    <input type="checkbox" aria-label={label} checked={Boolean(value)} onChange={(e) => widgetSetting(instance, setting.name, e.target.checked)} />
                                  </label>
                                )
                              }
                              if (setting.type === 'choice') {
                                return (
                                  <label key={setting.name} className="cz-row">
                                    <span>{setting.label}</span>
                                    <select aria-label={label} value={String(value)} onChange={(e) => widgetSetting(instance, setting.name, e.target.value)}>
                                      {setting.choices?.map((choice) => (
                                        <option key={choice.value} value={choice.value}>
                                          {choice.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )
                              }
                              return (
                                <label key={setting.name} className="cz-row">
                                  <span>{setting.label}</span>
                                  <input
                                    type={setting.type === 'number' ? 'number' : 'text'}
                                    aria-label={label}
                                    min={setting.min}
                                    max={setting.max}
                                    value={String(value)}
                                    onChange={(e) => widgetSetting(instance, setting.name, setting.type === 'number' ? Number(e.target.value) : e.target.value)}
                                  />
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="cz-section-head">
                <h3>Add a widget</h3>
              </div>
              <input className="cz-search" value={widgetSearch} placeholder="Search widgets" aria-label="Search widgets" onChange={(e) => setWidgetSearch(e.target.value)} />
              <div className="cz-chips">
                {WIDGET_GROUPS.map((group) => (
                  <button key={group.id} type="button" className={`queue-btn small${widgetGroup === group.id ? ' primary' : ''}`} onClick={() => setWidgetGroup(group.id)}>
                    {group.label}
                  </button>
                ))}
              </div>
              <div className="cz-widget-catalogue">
                {searchWidgets(widgetSearch, widgetGroup).map((definition) => {
                  const reads = permissionsOf(definition)
                  const count = draft.widgets.filter((w) => w.widget === definition.id).length
                  return (
                    <div key={definition.id} className="cz-widget-card">
                      <b>{definition.name}</b>
                      <small className="view-muted">{definition.description}</small>
                      <small className="view-muted">{reads.length ? reads.join(' \u00b7 ') : 'Reads nothing of yours'}</small>
                      <button type="button" className="queue-btn small" onClick={() => addWidget(definition.id)}>
                        <Plus size={12} /> Add{count ? ` another (${count})` : ''}
                      </button>
                    </div>
                  )
                })}
                {searchWidgets(widgetSearch, widgetGroup).length === 0 && <p className="view-muted">No widget matches that.</p>}
              </div>
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
