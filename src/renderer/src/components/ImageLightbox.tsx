import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Download, Pencil, X } from 'lucide-react'
import { CheckIcon } from './Icons'

interface Props {
  src: string
  alt: string
  saved?: boolean
  onClose(): void
  onDownload(): void
  onEdit?: () => void
}

/** Full-size preview of a generated image over the chat. Closes with Esc, the close button, or a click outside the image. */
export default function ImageLightbox({ src, alt, saved, onClose, onDownload, onEdit }: Props): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Captured before the message box sees it, so Esc closes the preview without also stopping a reply.
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus()
    }
  }, [])

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `Preview: ${alt}` : 'Image preview'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="lightbox-bar">
        <span className="truncate" title={alt}>
          {alt}
        </span>
        {onEdit && (
          <button type="button" className="lightbox-btn" onClick={onEdit}>
            <Pencil size={14} />
            Edit
          </button>
        )}
        <button type="button" className="lightbox-btn" onClick={onDownload}>
          {saved ? <CheckIcon size={14} /> : <Download size={14} />}
          {saved ? 'Saved' : 'Download'}
        </button>
        <button ref={closeRef} type="button" className="lightbox-close" aria-label="Close preview" title="Close (Esc)" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <img className="lightbox-image" src={src} alt={alt} draggable={false} />
    </div>,
    document.body
  )
}
