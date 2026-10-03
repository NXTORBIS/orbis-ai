import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { firstLine, placeBar, type Rect } from '../../../shared/selectionPlacement'
import { readSelection, RISK_REASON } from '../../../shared/selectionText'
import { buildShare, shareSaid, shareText } from '../../../shared/selectionShare'
import { copyText } from '../lib/utils'
import type { NoticeKind } from '../lib/notices'

/**
 * Three things to do with something you highlighted in the chat.
 *
 * The browser has its own contextual orb for selections on a web page, and this is deliberately not that: the chat is
 * Orbis's own window, the text in it is Orion's own words or your own, and the three things anybody wants from a
 * passage they have just read are to understand it, find it, or hand it on.
 *
 * Three rules it shares with the browser's one, for the same reasons:
 *
 * **Selecting sends nothing anywhere.** The bar appears and waits. Every one of the three needs a press, which is the
 * whole of the privacy model -- a surface that acted on a selection would be reading over somebody's shoulder.
 *
 * **Nothing is offered for text that must not leave.** A selection that looks like a key, a token or a card number
 * loses Ask Orion and keeps the two that stay on this machine, and says why.
 *
 * **It belongs to the selection.** It goes when the words go, and it never covers them: above where they start, or
 * below when there is no room above.
 */
export default function ChatSelectionBar({
  scopeSelector,
  onAsk,
  onNotify
}: {
  /** Only selections inside this count. The composer and the sidebar are not passages to act on. */
  scopeSelector: string
  /** Asks Orion about the passage, in the conversation it was selected in. */
  onAsk(text: string): void
  onNotify(text: string, kind?: NoticeKind): void
}): ReactElement | null {
  const [shown, setShown] = useState<{ text: string; risk: string | null; at: { x: number; y: number; from: 'above' | 'below' } } | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  /** Set while a press is being handled, so the selection going does not take the bar away mid-click. */
  const acting = useRef(false)

  const measure = useCallback((): void => {
    if (acting.current) return
    const selection = document.getSelection()
    const raw = selection?.toString() ?? ''
    if (!selection || raw.trim() === '' || selection.rangeCount === 0) return setShown(null)

    // Only inside the conversation. A selection in the composer is something being written, not something to act on.
    const range = selection.getRangeAt(0)
    const within = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    if (!within?.closest(scopeSelector)) return setShown(null)
    if (within.closest('textarea, input, [contenteditable="true"]')) return setShown(null)

    const rects: Rect[] = [...range.getClientRects()].map((one) => ({ x: one.x, y: one.y, width: one.width, height: one.height }))
    const line = firstLine(rects)
    if (!line) return setShown(null)

    const reading = readSelection(raw)
    const box = bar.current?.getBoundingClientRect()
    const at = placeBar(line, { width: Math.ceil(box?.width ?? 0) || 300, height: Math.ceil(box?.height ?? 0) || 34 }, { width: window.innerWidth, height: window.innerHeight })
    setShown({ text: reading.raw, risk: reading.risk === 'none' ? null : RISK_REASON[reading.risk], at })
  }, [scopeSelector])

  useEffect(() => {
    // Measured after the selection settles rather than on every change, so it does not chase the pointer mid-drag.
    let timer = 0
    const later = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(measure, 150)
    }
    document.addEventListener('selectionchange', later)
    window.addEventListener('resize', later)
    // Scrolling moves the words; the bar has to move with them or it is pointing at nothing.
    window.addEventListener('scroll', later, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', later)
      window.removeEventListener('resize', later)
      window.removeEventListener('scroll', later, true)
    }
  }, [measure])

  if (!shown) return null

  /** Runs one, then gets out of the way. The guard stops the click's own selection change taking the bar first. */
  const press = (run: () => void): void => {
    acting.current = true
    try {
      run()
    } finally {
      setShown(null)
      window.setTimeout(() => (acting.current = false), 200)
    }
  }

  const search = (): void => {
    // The real Orbis Search, through the one capability that opens the browser's own pages. Not a second search box.
    void window.api
      .executeControl({ capability: 'surface.open', params: { name: 'orbis-search', at: `#q=${encodeURIComponent(shown.text.slice(0, 300))}`, newTab: true }, target: {}, source: 'user' })
      .then((done) => {
        if (!done.ok) onNotify(done.error?.message ?? 'Orbis Search could not be opened.', 'error')
      })
      .catch(() => onNotify('Orbis Search could not be opened.', 'error'))
  }

  const share = (): void => {
    const built = buildShare({ text: shown.text })
    void copyText(shareText(built.payload)).then(
      // "Copied", never "Shared": nothing left this computer.
      () => onNotify(shareSaid('copied', built.shortened)),
      () => onNotify(shareSaid('failed'), 'error')
    )
  }

  return (
    <div
      ref={bar}
      className="chat-sel-bar"
      role="toolbar"
      aria-label="What to do with the selected text"
      data-from={shown.at.from}
      style={{ left: shown.at.x, top: shown.at.y }}
      // Down, not click: taking the pointer before the browser clears the selection keeps the words highlighted.
      onPointerDown={(event) => event.preventDefault()}
    >
      {shown.risk === null && (
        <>
          <button type="button" className="chat-sel-act" title="Ask Orion about the selected text" onClick={() => press(() => onAsk(shown.text))}>
            Ask Orion
          </button>
          <span className="chat-sel-line" />
        </>
      )}
      <button type="button" className="chat-sel-act" title="Search Orbis for the selected text" onClick={() => press(search)}>
        Search in Orbis
      </button>
      <span className="chat-sel-line" />
      <button type="button" className="chat-sel-act" title="Copy the selected text, with where it came from" onClick={() => press(share)}>
        Share highlighted
      </button>
      {shown.risk !== null && <span className="chat-sel-why">{shown.risk}</span>}
    </div>
  )
}
