import { useEffect, useRef, useState } from 'react'
import { EllipsisVertical, LoaderCircle, Pin, PinOff, Puzzle, RefreshCw, Settings, ShoppingBag, Store, Trash2, X } from 'lucide-react'
import type { InstalledExtension } from '../../../shared/types'
import type { NoticeKind } from '../App'
import { useDismiss } from '../lib/useDismiss'

const WEB_STORE_URL = 'https://chromewebstore.google.com/category/extensions'

interface Props {
  /** chrome.action.openPopup from an extension: open that extension's popup. */
  requestedPopup: string | null
  onPopupShown(): void
  onOpenTab(url: string): void
  onNotify(message: string, kind?: NoticeKind): void
}

const rgba = (c?: [number, number, number, number]): string | undefined => (c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] / 255})` : undefined)

function ExtensionIcon({ extension, size = 16 }: { extension: InstalledExtension; size?: number }): React.JSX.Element {
  return extension.icon ? (
    <img className="ext-icon" src={extension.icon} alt="" width={size} height={size} draggable={false} />
  ) : (
    <span className="ext-icon ext-icon-letter" style={{ width: size, height: size }} aria-hidden="true">
      {extension.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Badge({ extension }: { extension: InstalledExtension }): React.JSX.Element | null {
  const text = extension.action?.badgeText
  if (!text) return null
  return (
    <span className="ext-badge" style={{ background: rgba(extension.action?.badgeBackgroundColor) ?? '#d93025', color: rgba(extension.action?.badgeTextColor) ?? '#fff' }}>
      {text}
    </span>
  )
}

/** An extension's popup page, sized by its own content, under the toolbar. */
function ExtensionPopup({ url, onClose }: { url: string; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLElement | null>(null)
  useDismiss(ref, true, onClose)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // window.close() inside the popup closes it, as in Chrome.
    const close = (): void => onClose()
    view.addEventListener('close', close)
    return () => view.removeEventListener('close', close)
  }, [onClose])
  return (
    <div className="popover glass ext-popup" ref={ref} role="dialog" aria-label="Extension">
      <webview
        ref={viewRef as React.Ref<HTMLWebViewElement>}
        src={url}
        partition="persist:browser"
        {...({ autosize: 'on', minwidth: '25', minheight: '25', maxwidth: '800', maxheight: '600' } as object)}
      />
    </div>
  )
}

/**
 * The browser toolbar's extensions: pinned extensions' buttons (with their live badge and icon) and the puzzle-piece
 * menu to turn extensions on or off, pin them, open their options, remove them, check for updates and get more from
 * the Chrome Web Store.
 */
export default function ExtensionsToolbar({ requestedPopup, onPopupShown, onOpenTab, onNotify }: Props): React.JSX.Element {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [itemMenu, setItemMenu] = useState<string | null>(null)
  const [popup, setPopup] = useState<{ id: string; url: string } | null>(null)
  const [updating, setUpdating] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, menuOpen, () => {
    setMenuOpen(false)
    setItemMenu(null)
  })

  useEffect(() => {
    void window.api.getExtensions().then(setExtensions)
    return window.api.onExtensionsChanged(setExtensions)
  }, [])

  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify
  useEffect(
    () =>
      window.api.onExtensionInstalled(({ name, error }) =>
        notifyRef.current(error ? `Couldn't add ${name}: ${error}` : `Added ${name}. Find it under the puzzle icon.`, error ? 'error' : 'info')
      ),
    []
  )

  const run = (action: Promise<unknown>, failure: string): void => {
    void action.catch((err: unknown) => onNotify(err instanceof Error && err.message ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : failure, 'error'))
  }

  const activate = async (extension: InstalledExtension): Promise<void> => {
    setMenuOpen(false)
    if (!extension.enabled) return
    try {
      const { popup: url } = await window.api.clickExtensionAction(extension.id)
      if (url) setPopup({ id: extension.id, url })
    } catch {
      onNotify(`${extension.name} didn't respond.`, 'error')
    }
  }

  useEffect(() => {
    if (!requestedPopup) return
    onPopupShown()
    const extension = extensions.find((e) => e.id === requestedPopup)
    if (extension) void activate(extension)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPopup])

  const pinned = extensions.filter((e) => e.pinned && e.enabled && e.hasAction)

  return (
    <div className="ext-toolbar">
      {pinned.map((extension) => (
        <button
          key={extension.id}
          type="button"
          className={`b-icon ext-action${popup?.id === extension.id ? ' active' : ''}`}
          title={extension.action?.title || extension.name}
          aria-label={extension.action?.title || extension.name}
          disabled={extension.action?.enabled === false}
          onClick={() => void activate(extension)}
        >
          <ExtensionIcon extension={extension} />
          <Badge extension={extension} />
        </button>
      ))}
      <div className="browser-menu-anchor" ref={menuRef}>
        <button type="button" className={`b-icon${menuOpen ? ' active' : ''}`} aria-label="Extensions" aria-haspopup="menu" aria-expanded={menuOpen} title="Extensions" onClick={() => setMenuOpen((o) => !o)}>
          <Puzzle size={16} />
        </button>
        {menuOpen && (
          <div className="popover glass browser-menu ext-menu" role="menu" aria-label="Extensions">
            <div className="ext-menu-title">Extensions</div>
            {extensions.length === 0 && <p className="ext-empty">No extensions yet. Add them from the Chrome Web Store.</p>}
            {extensions.map((extension) => (
              <div key={extension.id} className={`ext-row${extension.enabled ? '' : ' off'}`}>
                <button type="button" className="ext-row-main" disabled={!extension.enabled || !extension.hasAction} onClick={() => void activate(extension)} title={extension.description || extension.name}>
                  <ExtensionIcon extension={extension} size={18} />
                  <span className="ext-row-text">
                    <b>{extension.name}</b>
                    <small>{extension.enabled ? `Version ${extension.version}` : 'Turned off'}</small>
                  </span>
                </button>
                {extension.hasAction && extension.enabled && (
                  <button type="button" className="b-icon ext-row-btn" aria-label={extension.pinned ? `Unpin ${extension.name}` : `Pin ${extension.name}`} title={extension.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'} onClick={() => run(window.api.setExtensionPinned(extension.id, !extension.pinned), "Couldn't change the pin.")}>
                    {extension.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                )}
                <label className="ext-switch" title={extension.enabled ? 'Turn off' : 'Turn on'}>
                  <input type="checkbox" checked={extension.enabled} aria-label={`${extension.name} ${extension.enabled ? 'on' : 'off'}`} onChange={(e) => run(window.api.setExtensionEnabled(extension.id, e.target.checked), "Couldn't change the extension.")} />
                  <span aria-hidden="true" />
                </label>
                <div className="ext-row-more">
                  <button type="button" className="b-icon ext-row-btn" aria-label={`More for ${extension.name}`} aria-haspopup="menu" aria-expanded={itemMenu === extension.id} onClick={() => setItemMenu((m) => (m === extension.id ? null : extension.id))}>
                    <EllipsisVertical size={14} />
                  </button>
                  {itemMenu === extension.id && (
                    <div className="popover glass ext-item-menu" role="menu">
                      {extension.optionsUrl && extension.enabled && (
                        <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenuOpen(false), onOpenTab(extension.optionsUrl!))}>
                          <Settings size={14} />
                          Options
                        </button>
                      )}
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenuOpen(false), onOpenTab(extension.homepageUrl))}>
                        <ShoppingBag size={14} />
                        View in Chrome Web Store
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item danger"
                        onClick={() => {
                          setItemMenu(null)
                          if (popup?.id === extension.id) setPopup(null)
                          run(window.api.removeExtension(extension.id).then(() => onNotify(`Removed ${extension.name}.`)), `Couldn't remove ${extension.name}.`)
                        }}
                      >
                        <Trash2 size={14} />
                        Remove from Orbis
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {extensions.length > 0 && extensions.some((e) => e.warnings.length) && <div className="menu-sep" role="separator" />}
            <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenuOpen(false), onOpenTab(WEB_STORE_URL))}>
              <Store size={14} />
              Get extensions from the Chrome Web Store
            </button>
            {extensions.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={updating}
                onClick={() => {
                  setUpdating(true)
                  void window.api
                    .updateExtensions()
                    .then(({ updated }) => onNotify(updated ? `Updated ${updated} extension${updated === 1 ? '' : 's'}.` : 'Your extensions are up to date.'))
                    .catch(() => onNotify("Couldn't check for extension updates. Try again later.", 'error'))
                    .finally(() => setUpdating(false))
                }}
              >
                {updating ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
                {updating ? 'Checking for updates…' : 'Update extensions'}
              </button>
            )}
          </div>
        )}
      </div>
      {popup && (
        <ExtensionPopup key={popup.url} url={popup.url} onClose={() => setPopup(null)} />
      )}
      {popup && (
        <button type="button" className="ext-popup-close" aria-label="Close extension popup" onClick={() => setPopup(null)}>
          <X size={12} />
        </button>
      )}
    </div>
  )
}
