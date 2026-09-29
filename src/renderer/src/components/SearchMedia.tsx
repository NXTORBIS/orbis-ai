import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Globe, Link2, Loader, Share2, X } from 'lucide-react'
import type { SpecializedResult } from '../../../shared/searchProviders'
import { saidCount, saidDuration } from '../../../shared/searchProviders'
import type { NoticeKind } from '../App'
import { isOrbisPage } from '../../../shared/orbisSearch'

/**
 * Looking at what a search found, without leaving the search.
 *
 * Clicking a picture should show you the picture, not send you to the page it happens to sit on; the same goes for a
 * video. The viewer opens over the results, keeps the whole set to hand so you can walk through them, and closes back
 * to exactly where you were.
 *
 * Everything shown is what the result actually carried. The source is always named and always one click away, because
 * these are somebody else's pictures and somebody else's videos.
 */

/** A site's own icon, asked of the site itself. Falls back to a plain mark rather than to a wrong one. */
export function SiteIcon({ url, size = 16 }: { url: string; size?: number }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const origin = (() => {
    try {
      return new URL(url).origin
    } catch {
      return null
    }
  })()

  // An Orbis Page is not a website and has no icon to show. Nothing is drawn for it -- not a globe, which would say
  // it came from somewhere on the web, and not a badge, which would be Orbis marking its own results out.
  if (isOrbisPage(url)) return <></>
  if (!origin || failed) return <Globe className="osearch-favicon" size={size} aria-hidden="true" />
  return <img className="osearch-favicon" src={`${origin}/favicon.ico`} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
}

/** Sharing a result: its address, copied or handed to whatever else is on this machine. */
export function ShareButton({ url, title, onNotify }: { url: string; title?: string; onNotify?(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const share = async (): Promise<void> => {
    const shareable = navigator as Navigator & { share?: (data: { title?: string; url: string }) => Promise<void> }
    try {
      if (shareable.share) {
        await shareable.share({ url, ...(title ? { title } : {}) })
        return
      }
      await navigator.clipboard.writeText(url)
      onNotify?.('Link copied.')
    } catch {
      // Somebody closing the share sheet is not a failure worth saying anything about.
    }
  }
  return (
    <button type="button" className="osearch-share" aria-label={`Share ${title ?? url}`} title="Share this link" onClick={(e) => (e.stopPropagation(), void share())}>
      <Share2 size={13} />
    </button>
  )
}

export interface MediaViewerProps {
  /** Everything the search found, so next and previous walk the results rather than searching again. */
  results: SpecializedResult[]
  /** Which one is open. */
  index: number
  onIndex(index: number): void
  onClose(): void
  /** Opens an address in the browser around this page. */
  onOpen(url: string): void
  onNotify?(message: string, kind?: NoticeKind): void
}

/**
 * The picture or the video, big, with the rest of the results beside it.
 *
 * Arrow keys and the buttons move through the set that was already found; nothing is searched again to go to the next
 * one. Escape closes it and the results are exactly as they were, scrolled where they were.
 */
export default function MediaViewer({ results, index, onIndex, onClose, onOpen, onNotify }: MediaViewerProps): React.JSX.Element | null {
  const result = results[index]
  const railRef = useRef<HTMLDivElement>(null)

  const go = useCallback(
    (by: number) => {
      const next = index + by
      if (next >= 0 && next < results.length) onIndex(next)
    },
    [index, results.length, onIndex]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose])

  // The one being looked at is kept in view in the strip, however it was reached.
  useEffect(() => {
    railRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [index])

  if (!result) return null

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(result.url)
      onNotify?.('Link copied.')
    } catch {
      onNotify?.('The link could not be copied.', 'warn')
    }
  }

  // Put where the whole window can see it: inside the browser's page area the address bar would draw over it.
  return createPortal(
    <div className="omedia" role="dialog" aria-modal="true" aria-label={result.title}>
      <header className="omedia-head">
        <span className="omedia-query truncate">{result.title}</span>
        <span className="omedia-source">
          <SiteIcon url={result.url} />
          <span className="truncate">{result.site}</span>
        </span>
        <span className="omedia-actions">
          <button type="button" aria-label="Open the page it came from" title="Open source page" onClick={() => onOpen(result.url)}>
            <ExternalLink size={15} />
          </button>
          {result.image && (
            <button type="button" aria-label="Open the full-size picture" title="Open the original" onClick={() => onOpen(result.image!)}>
              <Download size={15} />
            </button>
          )}
          <button type="button" aria-label="Copy the link" title="Copy link" onClick={() => void copyLink()}>
            <Link2 size={15} />
          </button>
          <ShareButton url={result.url} title={result.title} onNotify={onNotify} />
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </span>
      </header>

      <div className="omedia-body">
        <button type="button" className="omedia-step" aria-label="Previous" title="Previous (←)" disabled={index === 0} onClick={() => go(-1)}>
          <ChevronLeft size={22} />
        </button>

        <div className="omedia-stage">{result.kind === 'videos' ? <VideoStage result={result} onOpen={onOpen} /> : <ImageStage result={result} />}</div>

        <button type="button" className="omedia-step" aria-label="Next" title="Next (→)" disabled={index === results.length - 1} onClick={() => go(1)}>
          <ChevronRight size={22} />
        </button>

        {/* The rest of what was found, so moving through them never means going back and starting again. */}
        <div className="omedia-rail" ref={railRef}>
          {results.map((other, i) => (
            <button
              key={other.url}
              type="button"
              data-on={i === index}
              className={`omedia-thumb${i === index ? ' on' : ''}`}
              aria-label={other.title}
              aria-current={i === index}
              onClick={() => onIndex(i)}
            >
              <img src={other.thumbnail ?? other.image} alt="" loading="lazy" />
              {other.durationSec ? <em>{saidDuration(other.durationSec)}</em> : null}
            </button>
          ))}
        </div>
      </div>

      <footer className="omedia-foot">
        <span className="truncate">
          {[result.author, saidCount(result.views) ? `${saidCount(result.views)} views` : null, result.published, result.width && result.height ? `${result.width}×${result.height}` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span>
          {index + 1} of {results.length}
        </span>
      </footer>
    </div>,
    document.body
  )
}

/** The picture, at the size it really is, loaded only when it is looked at. */
function ImageStage({ result }: { result: SpecializedResult }): React.JSX.Element {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading')
  const full = result.image ?? result.thumbnail
  useEffect(() => setState('loading'), [full])

  if (!full) return <p className="omedia-none">There is no picture to show for this result.</p>
  return (
    <>
      {state === 'loading' && (
        <span className="omedia-loading">
          <Loader size={22} className="spin" aria-hidden="true" />
        </span>
      )}
      {state === 'failed' ? (
        <p className="omedia-none">
          The picture could not be loaded from {result.site}. It may have been moved or may not allow being shown here.
        </p>
      ) : (
        <img
          className="omedia-image"
          src={full}
          alt={result.title}
          hidden={state !== 'shown'}
          onLoad={() => setState('shown')}
          onError={() => setState('failed')}
        />
      )}
    </>
  )
}

/**
 * The video.
 *
 * Played here when the source offers a player of its own, which is the only way that is both technically possible and
 * allowed. When it does not, the picture and what is known about it are shown and the source is one click away —
 * rather than a player that would not play, or a claim that it could.
 */
function VideoStage({ result, onOpen }: { result: SpecializedResult; onOpen(url: string): void }): React.JSX.Element {
  const [playing, setPlaying] = useState(false)
  useEffect(() => setPlaying(false), [result.url])

  if (playing && result.embed) {
    return (
      <iframe
        className="omedia-video"
        src={result.embed}
        title={result.title}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    )
  }

  return (
    <div className="omedia-poster">
      {result.thumbnail ? <img src={result.thumbnail} alt={result.title} /> : <span className="omedia-none">No picture for this video.</span>}
      {result.embed ? (
        <button type="button" className="omedia-play" aria-label={`Play ${result.title}`} onClick={() => setPlaying(true)}>
          ▶
        </button>
      ) : (
        <div className="omedia-elsewhere">
          <p>{result.site} does not offer a player Orbis can use, so this one plays on its own site.</p>
          <button type="button" onClick={() => onOpen(result.url)}>
            <ExternalLink size={14} /> Watch on {result.site}
          </button>
        </div>
      )}
      <span className="omedia-caption truncate">
        {result.author ? `${result.author} · ` : ''}
        {saidDuration(result.durationSec) ?? ''}
      </span>
    </div>
  )
}

export { Copy }
