import { useEffect } from 'react'
import { Download, Images, MessageSquare, Pencil, X } from 'lucide-react'
import type { GalleryImage } from '../lib/imageEditor'
import type { NoticeKind } from '../App'

interface Props {
  images: GalleryImage[]
  onClose(): void
  onOpenChat(conversationId: string): void
  onEdit(image: GalleryImage): void
  onNotify(text: string, kind?: NoticeKind): void
}

export default function ImagesView({ images, onClose, onOpenChat, onEdit, onNotify }: Props): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // The editor opened from here handles its own Escape.
      if (e.key === 'Escape' && !document.querySelector('.image-editor')) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <section className="images-view" aria-label="Images">
      <header className="images-head">
        <div>
          <h2>Images</h2>
          <span className="hud-label">
            {images.length} {images.length === 1 ? 'image' : 'images'} created
          </span>
        </div>
        <button type="button" className="sb-icon" aria-label="Close images" title="Close (Esc)" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      {images.length === 0 ? (
        <div className="images-empty">
          <Images size={30} />
          <p>Images you create will appear here.</p>
          <small>Try asking Orbis to “draw a lighthouse at dusk”.</small>
        </div>
      ) : (
        <div className="images-grid">
          {images.map((image) => (
            <figure key={image.key} className="images-card">
              <img src={image.src} alt={image.prompt} loading="lazy" decoding="async" draggable={false} onClick={() => onEdit(image)} />
              <figcaption>
                <span className="truncate" title={image.prompt}>
                  {image.prompt}
                </span>
                <div className="images-actions">
                  <button type="button" aria-label="Edit image" title="Edit" onClick={() => onEdit(image)}>
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Download image"
                    title="Download"
                    onClick={() => void window.api.saveImage(image.src, image.prompt || 'orbis-image').then((ok) => ok && onNotify('Image saved.'))}
                  >
                    <Download size={14} />
                  </button>
                  <button type="button" aria-label="Open chat" title={`Open “${image.conversationTitle}”`} onClick={() => onOpenChat(image.conversationId)}>
                    <MessageSquare size={14} />
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}
