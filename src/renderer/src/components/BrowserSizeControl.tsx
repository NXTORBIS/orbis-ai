import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Maximize2, PictureInPicture2 } from 'lucide-react'
import { useDismiss } from '../lib/useDismiss'
import { BROWSER_SIZE_PRESETS, MIN_BROWSER_HEIGHT, MIN_BROWSER_WIDTH, clampBrowserSize, describeBrowserSize, maxBrowserSize } from '../lib/browserSize'
import type { Bounds, BrowserSizePref } from '../lib/browserSize'

interface Props {
  pref: BrowserSizePref
  /** The space a browser window opens in, for the custom size limits. */
  bounds: Bounds
  onChange(pref: BrowserSizePref): void
  /** Where the control sits; the toolbar version is more compact. */
  variant?: 'strip' | 'toolbar'
}

/** "Browser size: Full ▾" with Full, Large, Medium, Small and Custom (width × height). The choice is remembered. */
export default function BrowserSizeControl({ pref, bounds, onChange, variant = 'strip' }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(String(pref.width))
  const [height, setHeight] = useState(String(pref.height))
  const ref = useRef<HTMLDivElement>(null)
  const name = useId()
  useDismiss(ref, open, () => setOpen(false))
  const max = maxBrowserSize(bounds)

  useEffect(() => {
    setWidth(String(pref.width))
    setHeight(String(pref.height))
  }, [pref.width, pref.height])

  /** Applies the typed custom size, fitted to what the window allows. */
  const applyCustom = (): void => {
    const size = clampBrowserSize(Number(width), Number(height), bounds)
    setWidth(String(size.width))
    setHeight(String(size.height))
    onChange({ preset: 'custom', ...size })
  }

  const full = pref.preset === 'full'
  return (
    <div className={`browser-size ${variant}`} ref={ref}>
      <button
        type="button"
        className="browser-size-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={full ? 'Browser opens as a full page. Change the size' : `Browser opens as a ${describeBrowserSize(pref)} window. Change the size`}
        onClick={() => setOpen((o) => !o)}
      >
        {full ? <Maximize2 size={13} /> : <PictureInPicture2 size={13} />}
        {variant === 'strip' && <span className="browser-size-label">Browser size:</span>}
        <b>{describeBrowserSize(pref)}</b>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="popover glass browser-size-menu" role="dialog" aria-label="Browser size">
          <div className="browser-size-title">Browser size</div>
          <div role="radiogroup" aria-label="Browser size">
            {BROWSER_SIZE_PRESETS.map((preset) => (
              <label key={preset.id} className={`browser-size-option${pref.preset === preset.id ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name={name}
                  value={preset.id}
                  checked={pref.preset === preset.id}
                  onChange={() => (preset.id === 'custom' ? applyCustom() : onChange({ ...pref, preset: preset.id }))}
                />
                <span>
                  <b>{preset.label}</b>
                  <small>{preset.hint}</small>
                </span>
              </label>
            ))}
          </div>
          <form
            className={`browser-size-custom${pref.preset === 'custom' ? '' : ' inactive'}`}
            onSubmit={(e) => {
              e.preventDefault()
              applyCustom()
            }}
          >
            <label>
              Width
              <input
                type="number"
                inputMode="numeric"
                min={MIN_BROWSER_WIDTH}
                max={max.width}
                step={10}
                value={width}
                aria-label="Custom width in pixels"
                onChange={(e) => setWidth(e.target.value)}
                onBlur={() => pref.preset === 'custom' && applyCustom()}
              />
              <span>px</span>
            </label>
            <label>
              Height
              <input
                type="number"
                inputMode="numeric"
                min={MIN_BROWSER_HEIGHT}
                max={max.height}
                step={10}
                value={height}
                aria-label="Custom height in pixels"
                onChange={(e) => setHeight(e.target.value)}
                onBlur={() => pref.preset === 'custom' && applyCustom()}
              />
              <span>px</span>
            </label>
            <button type="submit" className="browser-size-apply">
              Use custom size
            </button>
            <small>
              Up to {max.width} × {max.height} in this window.
            </small>
          </form>
        </div>
      )}
    </div>
  )
}
