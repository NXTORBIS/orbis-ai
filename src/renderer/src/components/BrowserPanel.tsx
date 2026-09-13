import { useState } from 'react'
import { ArrowLeft, ArrowRight, X, Maximize2 } from 'lucide-react'

interface Props {
  onClose(): void
}

export default function BrowserPanel({ onClose }: Props): React.JSX.Element {
  const [url, setUrl] = useState('https://www.google.com')
  const [inputValue, setInputValue] = useState(url)

  const handleNavigate = (newUrl: string): void => {
    let finalUrl = newUrl.trim()
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl
    }
    setUrl(finalUrl)
    setInputValue(finalUrl)
  }

  return (
    <div className="browser-panel">
      <div className="browser-header">
        <div className="browser-controls">
          <button className="browser-btn" title="Back" onClick={() => {
            const iframe = document.querySelector('iframe') as HTMLIFrameElement
            if (iframe?.contentWindow?.history) {
              iframe.contentWindow.history.back()
            }
          }}>
            <ArrowLeft size={16} />
          </button>
          <button className="browser-btn" title="Forward" onClick={() => {
            const iframe = document.querySelector('iframe') as HTMLIFrameElement
            if (iframe?.contentWindow?.history) {
              iframe.contentWindow.history.forward()
            }
          }}>
            <ArrowRight size={16} />
          </button>
        </div>

        <input
          type="text"
          className="browser-address-bar"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleNavigate(inputValue)
            }
          }}
          placeholder="Enter URL..."
        />

        <div className="browser-actions">
          <button className="browser-btn" title="Fullscreen">
            <Maximize2 size={16} />
          </button>
          <button className="browser-btn close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      <iframe
        src={url}
        className="browser-content"
        title="Browser"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-pointer-lock"
      />
    </div>
  )
}
