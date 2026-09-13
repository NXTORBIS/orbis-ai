import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from 'lucide-react'

interface Props {
  onClose(): void
}

type Webview = HTMLElement & {
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  getURL(): string
  loadURL(url: string): Promise<void>
}

const HOME = 'https://duckduckgo.com'

function toUrl(input: string): string {
  const text = input.trim()
  if (/^https?:\/\//i.test(text)) return text
  if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) return `https://${text}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`
}

export default function BrowserPanel({ onClose }: Props): React.JSX.Element {
  const viewRef = useRef<Webview | null>(null)
  const [address, setAddress] = useState(HOME)
  const [nav, setNav] = useState({ back: false, forward: false, loading: true })

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const sync = (): void => {
      setAddress(view.getURL())
      setNav((n) => ({ ...n, back: view.canGoBack(), forward: view.canGoForward() }))
    }
    const startLoading = (): void => setNav((n) => ({ ...n, loading: true }))
    const stopLoading = (): void => setNav((n) => ({ ...n, loading: false }))
    view.addEventListener('did-navigate', sync)
    view.addEventListener('did-navigate-in-page', sync)
    view.addEventListener('did-start-loading', startLoading)
    view.addEventListener('did-stop-loading', stopLoading)
    return () => {
      view.removeEventListener('did-navigate', sync)
      view.removeEventListener('did-navigate-in-page', sync)
      view.removeEventListener('did-start-loading', startLoading)
      view.removeEventListener('did-stop-loading', stopLoading)
    }
  }, [])

  const go = (input: string): void => {
    const url = toUrl(input)
    setAddress(url)
    void viewRef.current?.loadURL(url)
  }

  return (
    <div className="browser-panel">
      <div className="browser-header">
        <div className="browser-controls">
          <button className="browser-btn" title="Back" disabled={!nav.back} onClick={() => viewRef.current?.goBack()}>
            <ArrowLeft size={16} />
          </button>
          <button className="browser-btn" title="Forward" disabled={!nav.forward} onClick={() => viewRef.current?.goForward()}>
            <ArrowRight size={16} />
          </button>
          <button className={`browser-btn${nav.loading ? ' spinning' : ''}`} title="Reload" onClick={() => viewRef.current?.reload()}>
            <RotateCw size={16} />
          </button>
        </div>

        <input
          type="text"
          className="browser-address-bar"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(address)
          }}
          placeholder="Search or enter a URL"
        />

        <div className="browser-actions">
          <button className="browser-btn" title="Open in your browser" onClick={() => void window.api.openExternal(address)}>
            <ExternalLink size={16} />
          </button>
          <button className="browser-btn close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      <webview ref={viewRef as React.Ref<HTMLWebViewElement>} src={HOME} partition="persist:browser" className="browser-content" />
    </div>
  )
}
