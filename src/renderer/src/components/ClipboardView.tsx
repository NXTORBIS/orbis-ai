import { useEffect, useRef, useState } from 'react'
import { Check, Clipboard, Code2, Image as ImageIcon, Link2, Palette, Pause, Pin, Play, ShieldCheck, Trash2, X } from 'lucide-react'
import { SearchBox, Segmented, Surface } from '../ui'
import type { ClipboardSettings, ClipItem, ClipKind } from '../../../shared/clipboardHistory'
import { DEFAULT_CLIPBOARD_SETTINGS } from '../../../shared/clipboardHistory'
import type { NoticeKind } from '../lib/notices'

const KINDS: { id: ClipKind | 'all' | 'pinned'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Kept' },
  { id: 'text', label: 'Text' },
  { id: 'link', label: 'Links' },
  { id: 'code', label: 'Code' },
  { id: 'color', label: 'Colours' },
  { id: 'image', label: 'Images' }
]

const ICONS: Record<ClipKind, typeof Clipboard> = { text: Clipboard, link: Link2, code: Code2, color: Palette, image: ImageIcon }

const when = (time: number): string => {
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(time).toLocaleDateString()
}

/**
 * Clipboard history: what you have copied while Orbis was in front, ready to copy again. Passwords, card numbers and
 * keys are never recorded, nor is anything copied in a private tab, and everything here can be cleared.
 */
export default function ClipboardView({ onClose, onNotify }: { onClose(): void; onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<ClipKind | 'all' | 'pinned'>('all')
  const [settings, setSettings] = useState<ClipboardSettings>(DEFAULT_CLIPBOARD_SETTINGS)
  const [paused, setPaused] = useState(false)
  const [skipped, setSkipped] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const blockedRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    const [list, current, state] = await Promise.all([window.api.clipboardHistory(query, kind), window.api.clipboardSettings(), window.api.clipboardPaused()])
    setItems(list)
    setSettings(current)
    setPaused(state.paused)
    setSkipped(state.lastSkipped)
  }

  useEffect(() => {
    void load()
    return window.api.onClipboardChanged(() => void load())
  }, [query, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const use = async (item: ClipItem): Promise<void> => {
    await window.api.useClip(item.id)
    setCopiedId(item.id)
    window.setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1200)
  }

  const setSetting = <K extends keyof ClipboardSettings>(key: K, value: ClipboardSettings[K]): void => void window.api.updateClipboardSettings({ [key]: value } as Partial<ClipboardSettings>).then(setSettings)

  return (
    <Surface
      className="clips-view"
      title="Clipboard"
      label="Clipboard history"
      closeLabel="Close clipboard history"
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className={`queue-btn${paused ? ' on' : ''}`}
            aria-pressed={paused}
            title={paused ? 'Start remembering copies again' : 'Stop remembering copies'}
            onClick={() => void window.api.clipboardPaused(!paused).then((s) => setPaused(s.paused))}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Paused' : 'Recording'}
          </button>
          <button type="button" className={`queue-btn${showSettings ? ' on' : ''}`} aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
          {confirmClear ? (
            <>
              <button type="button" className="queue-btn danger" onClick={() => void window.api.clearClipboardHistory(false).then((n) => (setConfirmClear(false), onNotify(`Cleared ${n} entr${n === 1 ? 'y' : 'ies'}`)))}>
                Clear unkept
              </button>
              <button type="button" className="queue-btn danger" onClick={() => void window.api.clearClipboardHistory(true).then((n) => (setConfirmClear(false), onNotify(`Cleared everything (${n})`)))}>
                Clear everything
              </button>
              <button type="button" className="queue-btn" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="queue-btn" onClick={() => setConfirmClear(true)}>
              <Trash2 size={14} /> Clear
            </button>
          )}
        </>
      }
    >

      {showSettings && (
        <section className="clips-settings" aria-label="Clipboard settings">
          <label className="clips-setting">
            <span>Remember what I copy</span>
            <input type="checkbox" checked={settings.enabled} onChange={(e) => setSetting('enabled', e.target.checked)} />
          </label>
          <label className="clips-setting">
            <span>Keep at most</span>
            <input type="number" min={10} max={2000} value={settings.limit} onChange={(e) => setSetting('limit', Number(e.target.value))} />
          </label>
          <label className="clips-setting">
            <span>Forget after</span>
            <select value={settings.keepDays} onChange={(e) => setSetting('keepDays', Number(e.target.value))}>
              <option value={0}>Never</option>
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <label className="clips-setting">
            <span>Include images</span>
            <input type="checkbox" checked={settings.captureImages} onChange={(e) => setSetting('captureImages', e.target.checked)} />
          </label>
          <label className="clips-setting">
            <span>Skip private tabs</span>
            <input type="checkbox" checked={settings.skipPrivate} onChange={(e) => setSetting('skipPrivate', e.target.checked)} />
          </label>
          <label className="clips-setting">
            <span>Skip passwords and keys</span>
            <input type="checkbox" checked={settings.skipSecrets} onChange={(e) => setSetting('skipSecrets', e.target.checked)} />
          </label>
          <div className="clips-setting wide">
            <span>Never record from</span>
            <div className="clips-blocked">
              {settings.blockedSites.map((site) => (
                <button key={site} type="button" className="note-tag" title={`Stop excluding ${site}`} onClick={() => setSetting('blockedSites', settings.blockedSites.filter((s) => s !== site))}>
                  {site} <X size={11} />
                </button>
              ))}
              <input
                ref={blockedRef}
                placeholder="add a site, e.g. bank.com"
                aria-label="Add a site to never record from"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const value = e.currentTarget.value.trim().toLowerCase()
                  if (!value) return
                  setSetting('blockedSites', [...settings.blockedSites, value])
                  e.currentTarget.value = ''
                }}
              />
            </div>
          </div>
        </section>
      )}

      <div className="clips-toolbar">
        <SearchBox value={query} onChange={setQuery} label="Search clipboard history" placeholder="Search what you copied" />
        <Segmented
          className="clips-kinds"
          optionClass="note-tag"
          label="Which kind of copy to show"
          value={kind}
          options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
          onChange={setKind}
        />
      </div>

      {skipped && (
        <p className="clips-skipped">
          <ShieldCheck size={13} /> The last copy wasn’t kept: {skipped}
        </p>
      )}

      <div className="clips-items">
        {items.map((item) => {
          const Icon = ICONS[item.kind]
          return (
            <div key={item.id} className={`clip-row clip-${item.kind}`}>
              <button type="button" className="clip-main" title="Copy this again" onClick={() => void use(item)}>
                <span className="clip-icon">{copiedId === item.id ? <Check size={14} /> : <Icon size={14} />}</span>
                {item.kind === 'image' ? (
                  /*
                   * A picture that will not load shows what it was, not a broken-image box.
                   *
                   * Clips kept before the data url stopped being trimmed at the byte limit are damaged on disk and
                   * cannot be recovered. Leaving them as the browser's broken-image glyph made the whole row look
                   * like a fault in Orbis; "Image 1920×1080" is at least true about what is there.
                   */
                  <img
                    className="clip-image"
                    src={item.content}
                    alt={item.preview}
                    onError={(event) => {
                      const img = event.currentTarget
                      img.replaceWith(Object.assign(document.createElement('span'), { className: 'clip-preview', textContent: item.preview }))
                    }}
                  />
                ) : (
                  <span className="clip-preview">{item.preview}</span>
                )}
                {item.kind === 'color' && <span className="clip-swatch" style={{ background: item.content.trim() }} aria-hidden="true" />}
                <span className="clip-meta">
                  {when(item.copiedAt)}
                  {item.times > 1 ? ` · copied ${item.times} times` : ''}
                  {item.source?.url ? ` · ${new URL(item.source.url).host}` : ''}
                </span>
              </button>
              <div className="clip-actions">
                <button type="button" className={`icon-btn${item.pinned ? ' on' : ''}`} aria-pressed={item.pinned} title={item.pinned ? 'Stop keeping this' : 'Keep this'} onClick={() => void window.api.pinClip(item.id, !item.pinned)}>
                  <Pin size={14} />
                </button>
                <button type="button" className="icon-btn danger" aria-label="Remove this entry" onClick={() => void window.api.removeClip(item.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
        {!items.length && (
          <p className="view-empty">
            {query ? 'Nothing matches.' : settings.enabled ? 'Nothing copied yet. Copy something while Orbis is in front and it appears here.' : 'Clipboard history is off. Turn it on in Settings above.'}
          </p>
        )}
      </div>
    </Surface>
  )
}
