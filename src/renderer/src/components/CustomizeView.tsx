import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Check, Copy, Download, FileUp, History, Image, LayoutGrid, Paintbrush, Palette, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Undo2, Zap } from 'lucide-react'
import type { AppearanceConfig, ExperienceConfig } from '../../../shared/experience'
import { defaultConfig, describeConfig, diffConfig, isDefaultConfig } from '../../../shared/experience'
import { widgetById } from '../../../shared/widgets'
import { useExperience, type Experience } from '../lib/experience'
import type { NoticeKind } from '../App'
import type { StoredTheme } from '../../../shared/themes'
import { BUILT_IN_THEMES, copyOfBuiltIn, MAX_THEMES, newTheme, readability, THEME_TOKENS, themeTokens } from '../../../shared/themes'
import type { StoredPreset } from '../../../shared/presets'
import type { PresetCategory } from '../../../shared/presets'
import { applyPreset, BUILT_IN_PRESETS, copyOfPreset, MAX_PRESETS, presetFromConfig } from '../../../shared/presets'
import { RulesEditor } from './RulesEditor'
import { Button, Surface } from '../ui'

type Category = 'presets' | 'appearance' | 'themes' | 'newTab' | 'widgets' | 'notify' | 'accessibility' | 'performance' | 'privacy' | 'advanced'

const CATEGORIES: { id: Category; label: string; icon: typeof Paintbrush }[] = [
  // First, because it is the one choice that answers the whole question. Everything below it is for afterwards.
  { id: 'presets', label: 'Presets', icon: Sparkles },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush },
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'newTab', label: 'New tab', icon: Sparkles },
  { id: 'widgets', label: 'Widgets', icon: LayoutGrid },
  { id: 'notify', label: 'Tell me when', icon: Bell },
  { id: 'accessibility', label: 'Accessibility', icon: Check },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'advanced', label: 'Advanced', icon: History }
]

/**
 * What belongs to the browser's start page: its widgets, the sets of them saved by name, and what it remembers
 * about them.
 *
 * This screen used to edit widgets and no longer does. They are added, moved and set up on the start page, and by
 * Orion, and both go through one set of actions. But a draft here is the whole of the personalisation, widgets
 * included, and a draft is held for as long as somebody is choosing a colour. Saved as it was, it would put the
 * widgets back to how they were when the choosing began -- a note typed on the start page in the meantime would be
 * gone, and nobody would have asked for that. So these are never taken from a draft: whatever this screen shows or
 * saves, they are what is stored now.
 */
const startPageOf = (
  config: ExperienceConfig
): Pick<ExperienceConfig, 'widgets' | 'dashboards' | 'activeDashboardId' | 'widgetFavourites' | 'widgetRecent' | 'widgetsAdopted'> => ({
  widgets: config.widgets,
  dashboards: config.dashboards,
  activeDashboardId: config.activeDashboardId,
  widgetFavourites: config.widgetFavourites,
  widgetRecent: config.widgetRecent,
  widgetsAdopted: config.widgetsAdopted
})

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
/**
 * How Orbis looks.
 *
 * It was a row in the feature dropdown, which made appearance a screen you navigated to rather than a setting. It is a
 * setting, so it lives in Settings now -- and `embedded` is how: the same component, without the overlay it used to be.
 * Nothing about what it does changed, only where it is.
 */
export default function CustomizeView({
  experience: given,
  onClose,
  onNotify,
  embedded = false
}: {
  experience?: Experience
  onClose?: () => void
  onNotify?: (message: string, kind?: NoticeKind) => void
  embedded?: boolean
}): React.JSX.Element {
  // Settings does not hold the experience, so when it is not handed one it reads the same source the window does.
  const loaded = useExperience()
  const experience = given ?? loaded
  /**
   * Somewhere for a message to go when nothing is listening.
   *
   * Embedded in Settings there is no toast stack to reach, and every call site here is a real thing happening -- a
   * theme applied, an import refused. Making each one optional at the call site would be forty `?.` and one of them
   * eventually forgotten; one fallback is the same answer said once.
   */
  const say = onNotify ?? ((): void => undefined)
  const [category, setCategory] = useState<Category>('appearance')
  const [editingTheme, setEditingTheme] = useState<string | null>(null)
  const [presetSearch, setPresetSearch] = useState('')
  const [presetGroup, setPresetGroup] = useState<PresetCategory | 'all'>('all')
  const [draft, setDraft] = useState<ExperienceConfig>(experience.config)
  /**
   * What is really on the browser's start page.
   *
   * Read from what is saved, never from this screen's draft: the widgets are not edited here, and a draft of them
   * would be a list nobody can change from this screen.
   */
  const onStartPage = startPageOf(experience.saved)
  const [snapshots, setSnapshots] = useState<{ id: string; reason: string; takenAt: number; summary: string[] }[]>([])
  const [health, setHealth] = useState<{ ok: boolean; problems: string[]; repairs: string[]; snapshots: number } | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const savedConfig = useRef(experience.config)

  // The draft follows what is saved until the user starts changing things. A change made elsewhere — by Orion, or in
  // another window — shows here too, so applying never quietly puts back an older draft over someone else's change.
  // Once they have started, the draft is theirs, except for the start page's widgets: those are changed on the start
  // page while this screen is open, so the draft takes them as they now are.
  useEffect(() => {
    if (experience.loading) return
    const wasSaved = savedConfig.current
    savedConfig.current = experience.saved
    setDraft((current) => (isSame(current, wasSaved) ? experience.saved : { ...current, ...startPageOf(experience.saved) }))
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

  /**
   * The presets to show.
   *
   * Searched by name and by description, because somebody looking for "glass" and somebody looking for "see-through"
   * are looking for the same preset and only one of them knows what it is called.
   */
  const shownPresets = useMemo(() => {
    const q = presetSearch.trim().toLowerCase()
    return [...BUILT_IN_PRESETS, ...draft.presets].filter((p) => {
      if (presetGroup !== 'all' && p.category !== presetGroup) return false
      if (!q) return true
      return `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q)
    })
  }, [draft.presets, presetGroup, presetSearch])

  const changes = useMemo(() => diffConfig(savedConfig.current, draft), [draft])
  const dirty = changes.length > 0

  /**
   * Every change previews at once, so the user sees what they are choosing before keeping it.
   *
   * Whatever is being changed, the start page's widgets are not: they are laid back over the draft as they are stored.
   */
  const change = (next: ExperienceConfig): void => {
    const kept = { ...next, ...startPageOf(savedConfig.current) }
    setDraft(kept)
    experience.preview(kept)
  }
  const changeAppearance = (patch: Partial<AppearanceConfig>): void => change({ ...draft, appearance: { ...draft.appearance, ...patch } })

  const apply = async (): Promise<void> => {
    // The widgets as they are at this moment, in case the start page changed them after the last thing chosen here.
    const next = { ...draft, ...startPageOf(savedConfig.current) }
    await experience.save(next, `Changed ${[...new Set(changes.map((c) => c.path.split('.')[0]))].join(', ')}`)
    savedConfig.current = next
    await loadHistory()
    say('Your changes are saved')
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
    say(`${label} is back to how Orbis has it`)
  }

  const restoreOriginal = async (): Promise<void> => {
    const { wasDefault } = await window.api.restoreOriginalExperience()
    setConfirmRestore(false)
    const config = await window.api.getExperience()
    savedConfig.current = config
    setDraft(config)
    experience.preview(null)
    await loadHistory()
    say(wasDefault ? 'Orbis was already as it comes' : 'Orbis is back to how it comes')
  }

  const exportFile = async (): Promise<void> => {
    const file = await window.api.exportExperience()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
    link.download = 'orbis-personalisation.json'
    link.click()
    URL.revokeObjectURL(link.href)
    say('Your personalisation is saved to a file')
  }

  const importFile = async (file: File): Promise<void> => {
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      return say('That file could not be read', 'error')
    }
    const checked = await window.api.checkExperienceImport(raw)
    if (!checked.ok) return say(checked.problems[0] ?? 'That file cannot be used', 'error')
    const { config } = await window.api.importExperience(raw, 'replace')
    savedConfig.current = config
    setDraft(config)
    experience.preview(null)
    await loadHistory()
    say(`Brought in: ${checked.summary.slice(0, 3).join(', ')}`)
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
    if (draft.themes.length >= MAX_THEMES) return say(`That is as many themes as one Orbis can hold (${MAX_THEMES})`, 'error')
    change({ ...draft, themes: [...draft.themes, theme], themeId: theme.id })
    setEditingTheme(theme.id)
  }
  const patchTheme = (id: string, patch: Partial<StoredTheme>): void =>
    change({ ...draft, themes: draft.themes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const deleteTheme = (id: string): void =>
    change({ ...draft, themes: draft.themes.filter((t) => t.id !== id), themeId: draft.themeId === id ? null : draft.themeId })

  const addWallpaper = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) return say('That file is not a picture', 'error')
    if (file.size > 6_000_000) return say('That picture is too large — 6 MB is the most Orbis keeps', 'error')
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('unreadable'))
      reader.readAsDataURL(file)
    }).catch(() => null)
    if (!source) return say('That picture could not be read', 'error')
    const wallpaper = { id: `wall-${Date.now().toString(36)}`, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Wallpaper', source, kind: 'image' as const, addedAt: Date.now() }
    change({ ...draft, wallpapers: [...draft.wallpapers, wallpaper], newTab: { ...draft.newTab, wallpaperId: wallpaper.id } })
  }
  const addGradient = (gradient: { name: string; source: string }): void => {
    const wallpaper = { id: `wall-${Date.now().toString(36)}`, name: gradient.name, source: gradient.source, kind: 'gradient' as const, addedAt: Date.now() }
    change({ ...draft, wallpapers: [...draft.wallpapers, wallpaper], newTab: { ...draft.newTab, wallpaperId: wallpaper.id } })
  }
  const removeWallpaper = (id: string): void =>
    change({ ...draft, wallpapers: draft.wallpapers.filter((w) => w.id !== id), newTab: { ...draft.newTab, wallpaperId: draft.newTab.wallpaperId === id ? null : draft.newTab.wallpaperId } })

  const toggle =(label: string, value: boolean, onChange: (value: boolean) => void, hint?: string) => (
    <label className="cz-row">
      <span>
        {label}
        {hint && <small className="view-muted">{hint}</small>}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )

  /*
    Apply and Cancel belong to the whole screen, so they are the header's actions both ways round -- hiding them
    when embedded would strand a change somebody had made.
  */
  const actions = dirty ? (
    <>
      <span className="cz-dirty">
        {changes.length} change{changes.length === 1 ? '' : 's'} being shown
      </span>
      <Button onClick={cancel}>
        Cancel
      </Button>
      <Button kind="primary" icon={<Check size={14} />} onClick={() => void apply()}>
        Apply
      </Button>
    </>
  ) : null

  // Named rather than inlined, because the two frames below put the same body inside different things.
  const body = (
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
          {category === 'notify' && <RulesEditor draft={draft} change={change} say={say} />}

          {category === 'presets' && (
            <>
              <div className="cz-section-head">
                <h3>Presets</h3>
                {/*
                  How Orbis looks goes back to how it comes; what you made is kept. Your presets and themes are named
                  here. Your widgets are kept by `change`, which never lets go of them, and whether they are shown is
                  kept with them: putting the look back should not take the widgets off the start page.
                */}
                <Button
                  size="small"
                  icon={<RotateCcw size={12} />}
                  onClick={() => {
                    const fresh = defaultConfig()
                    change({ ...fresh, presets: draft.presets, themes: draft.themes, newTab: { ...fresh.newTab, widgets: draft.newTab.widgets } })
                  }}
                >
                  Back to Orbis
                </Button>
              </div>
              <p className="view-muted">
                A preset sets the palette, how solid the panels are, how tight the layout is and how much Orbis moves.
                Choosing one shows it straight away; nothing is kept until you say so.
              </p>

              {/*
                Thirty-odd presets is too many to read as one wall, so the collection is narrowed by name, or by the
                kind of thing you are after. Nothing is hidden -- "All" with an empty box is the whole collection.
              */}
              <input
                className="cz-search"
                value={presetSearch}
                placeholder="Search presets"
                aria-label="Search presets"
                onChange={(e) => setPresetSearch(e.target.value)}
              />
              <div className="cz-chips">
                {(['all', 'Orbis', 'Calm', 'Dark', 'Light', 'Vivid', 'Work'] as const).map((group) => (
                  <Button
                    key={group}
                    size="small"
                    // The lit one in this row has always been `primary`, not `on`, so `kind` says that and
                    // `aria-pressed` is passed through exactly as it was.
                    kind={presetGroup === group ? 'primary' : 'normal'}
                    aria-pressed={presetGroup === group}
                    onClick={() => setPresetGroup(group)}
                  >
                    {group === 'all' ? 'All' : group}
                  </Button>
                ))}
              </div>

              <div className="cz-presets">
                {shownPresets.length === 0 && <p className="view-muted">Nothing matches that.</p>}
                {shownPresets.map((p) => {
                  const worn = draft.activePresetId === p.id
                  return (
                    <div key={p.id} className={`cz-preset${worn ? ' on' : ''}`}>
                      <button
                        type="button"
                        className="cz-preset-face"
                        aria-pressed={worn}
                        title={p.description}
                        onClick={() => change({ ...applyPreset(draft, p), activePresetId: p.id })}
                      >
                        <span
                          className="cz-preset-swatch"
                          style={p.background.kind === 'gradient' && p.background.value ? { background: p.background.value } : undefined}
                        >
                          <span className="cz-preset-dot" style={p.appearance.accent ? { background: p.appearance.accent } : undefined} />
                        </span>
                        <span className="cz-preset-name">{p.name}</span>
                        <span className="cz-preset-why">{p.description}</span>
                      </button>
                      <div className="cz-preset-acts">
                        {/* Orbis's own are read-only, so starting from one makes a copy and leaves the original alone. */}
                        <button
                          type="button"
                          className="sb-row-action"
                          title={`Make my own from ${p.name}`}
                          aria-label={`Make my own from ${p.name}`}
                          disabled={draft.presets.length >= MAX_PRESETS}
                          onClick={() => change({ ...draft, presets: [...draft.presets, copyOfPreset(p)] })}
                        >
                          <Copy size={13} />
                        </button>
                        {!p.builtIn && (
                          <button
                            type="button"
                            className="sb-row-action danger"
                            title={`Delete ${p.name}`}
                            aria-label={`Delete ${p.name}`}
                            onClick={() =>
                              change({
                                ...draft,
                                presets: draft.presets.filter((mine: StoredPreset) => mine.id !== p.id),
                                // Deleting what is being worn leaves the look in place and simply stops calling it by that name.
                                activePresetId: draft.activePresetId === p.id ? null : draft.activePresetId
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="cz-row">
                <span>Keep how Orbis looks now</span>
                <Button
                  size="small"
                  icon={<Plus size={12} />}
                  disabled={draft.presets.length >= MAX_PRESETS}
                  onClick={() => {
                    const mine = presetFromConfig(draft, 'My preset')
                    change({ ...draft, presets: [...draft.presets, mine], activePresetId: mine.id })
                  }}
                >
                  Save as preset
                </Button>
              </div>
            </>
          )}
          {category === 'appearance' && (
            <>
              <div className="cz-section-head">
                <h3>Appearance</h3>
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => void resetSection('appearance', 'Appearance')}>
                  Reset this
                </Button>
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
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => void resetSection('themes', 'Themes')}>
                  Reset this
                </Button>
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
                  <Button size="small" icon={<Plus size={12} />} onClick={() => addTheme(newTheme('My theme', 'dark', themeTokens(draft.themeId, draft.themes)))}>
                    From what is on screen
                  </Button>
                  {draft.themeId && BUILT_IN_THEMES.some((t) => t.id === draft.themeId) && (
                    <Button size="small" icon={<Copy size={12} />} onClick={() => addTheme(copyOfBuiltIn(BUILT_IN_THEMES.find((t) => t.id === draft.themeId)!))}>
                      Copy this one
                    </Button>
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
                      <Button size="small" onClick={() => useTheme(theme.id)} disabled={draft.themeId === theme.id}>
                        {draft.themeId === theme.id ? 'In use' : 'Use'}
                      </Button>
                      <Button size="small" onClick={() => setEditingTheme(open ? null : theme.id)}>
                        {open ? 'Done' : 'Colours'}
                      </Button>
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
                  <Button key={gradient.name} size="small" icon={<Plus size={12} />} onClick={() => addGradient(gradient)}>
                    {gradient.name}
                  </Button>
                ))}
              </div>
            </>
          )}

          {category === 'newTab' && (
            <>
              <div className="cz-section-head">
                <h3>New tab</h3>
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => void resetSection('newTab', 'New tab')}>
                  Reset this
                </Button>
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
              </div>
              <p className="view-muted cz-note">
                Widgets are the cards on the browser&rsquo;s start page: the time, the weather, what is due today, a price you follow. They are chosen
                where they are shown &mdash; open a new tab in the browser and press <b>Widgets</b>. Every one of them is drawn there first, at the size
                it will be, so you can see what you are adding before you add it.
              </p>
              <p className="view-muted cz-note">
                They belong to this profile, with the rest of what is personal, and Orion can add, move and set them when you ask it to.
              </p>
              <div className="cz-section-head">
                <h4>On the start page now</h4>
              </div>
              <p className="view-muted cz-note">
                {onStartPage.widgets.length === 0
                  ? 'None yet.'
                  : `${onStartPage.widgets.length} widget${onStartPage.widgets.length === 1 ? '' : 's'}: ${[...new Set(onStartPage.widgets.map((one) => widgetById(one.widget)?.name ?? one.widget))].join(', ')}.`}
                {!draft.newTab.widgets && ' They are switched off for the start page at the moment \u2014 turn them on under New tab.'}
              </p>
              {onStartPage.dashboards.length > 0 && (
                <p className="view-muted cz-note">
                  Saved layouts: {onStartPage.dashboards.map((dashboard) => dashboard.name).join(', ')}. These are kept, and switched between,
                  on the start page while you are arranging it.
                </p>
              )}
            </>
          )}

          {category === 'accessibility' && (
            <>
              <div className="cz-section-head">
                <h3>Accessibility</h3>
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => void resetSection('accessibility', 'Accessibility')}>
                  Reset this
                </Button>
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
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => void resetSection('performance', 'Performance')}>
                  Reset this
                </Button>
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
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => void resetSection('privacy', 'Privacy')}>
                  Reset this
                </Button>
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
                  <Button size="small" onClick={() => void loadHistory()}>
                    Check again
                  </Button>
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
                    <Button
                      size="small"
                      icon={<Undo2 size={12} />}
                      onClick={() =>
                        void window.api.restoreExperienceSnapshot(snapshot.id).then(async (config) => {
                          savedConfig.current = config
                          setDraft(config)
                          experience.preview(null)
                          await loadHistory()
                          say('Went back to how it was')
                        })
                      }
                    >
                      Go back to this
                    </Button>
                  </div>
                ))}
                {!snapshots.length && <p className="view-muted">Nothing has been changed yet.</p>}
              </div>

              <div className="cz-section-head">
                <h4>Your personalisation as a file</h4>
              </div>
              <div className="og-inline">
                <Button icon={<Download size={14} />} onClick={() => void exportFile()}>
                  Save to a file
                </Button>
                <Button icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
                  Bring in from a file
                </Button>
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
                  <Button kind="danger" onClick={() => void restoreOriginal()}>
                    Yes, restore the original Orbis
                  </Button>
                  <Button onClick={() => setConfirmRestore(false)}>
                    Keep my personalisation
                  </Button>
                </div>
              ) : (
                <Button icon={<RotateCcw size={14} />} onClick={() => setConfirmRestore(true)}>
                  Restore the original Orbis experience
                </Button>
              )}
              <p className="view-muted cz-note">This puts back only what you personalised. Your tabs, bookmarks, history, notes, tasks, boards, workflows, extensions and settings are untouched.</p>
            </>
          )}
        </section>
      </div>
  )

  /*
    Embedded in Settings this is not a screen of its own: Settings has already said the title, and the close button
    belongs to the overlay rather than to this. So the embedded half keeps exactly the frame it had -- no `.view`, no
    heading, no close -- and is not a Surface, because a Surface insists on both of the things this half deliberately
    does without. Only the standalone half, which was already `.view customize-view` with its own `view-head`, an
    `h2` and a close button, becomes one.
  */
  if (embedded) {
    return (
      <div className="customize-view is-embedded" role="region" aria-label="Customize Orbis">
        <header className="view-head">
          <div className="view-actions">{actions}</div>
        </header>
        {body}
      </div>
    )
  }

  return (
    <Surface
      title="Customize"
      /* The region has always been called the longer thing, while the heading has always been the one word. */
      label="Customize Orbis"
      className="customize-view"
      actions={actions}
      closeLabel="Close customize"
      onClose={() => {
        if (dirty) cancel()
        onClose?.()
      }}
    >
      {body}
    </Surface>
  )
}

const isSame = (a: ExperienceConfig, b: ExperienceConfig): boolean => diffConfig(a, b).length === 0

export { defaultConfig }
