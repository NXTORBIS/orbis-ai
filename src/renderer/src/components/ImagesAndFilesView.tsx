import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, Globe, Images, MessageSquare, Pencil } from 'lucide-react'
import type { GalleryImage } from '../lib/imageEditor'
import type { NoticeKind } from '../lib/notices'
import { useSurface } from '../lib/surfaces'
import { filesViewSurface } from './filesSurfaces'
import { EmptyState } from '../ui'

const FilesHost = lazy(() => import('../features/files/FilesHost'))

type Tab = 'created' | 'files' | 'universe'

interface Props {
  images: GalleryImage[]
  /** A Files page to land on, e.g. 'settings' or 'universeExplorer'. */
  openTool?: string
  onClose(): void
  onOpenChat(conversationId: string): void
  onEdit(image: GalleryImage): void
  onNotify(text: string, kind?: NoticeKind): void
}

export default function ImagesAndFilesView({ images, openTool, onClose, onOpenChat, onEdit, onNotify }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>(openTool === 'universeExplorer' ? 'universe' : 'files')

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.image-editor')) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const selectTab = useCallback((t: Tab) => setTab(t), [])

  /*
   * What Orbis may work on this screen.
   *
   * Only the tab strip, because that is all this screen owns: everything that can be done to files is inside the
   * frame, and the frame declares it itself (see `FilesHost`). Setting the tab to `files` is also the route there,
   * which is why it is a control rather than three buttons.
   */
  useSurface(
    filesViewSurface({
      tab: () => tab,
      setTab: (id) => selectTab(id as Tab),
      made: () => images.length,
      close: onClose
    })
  )

  return (
    <section className="images-view files-fullscreen" aria-label="Files">
      <header className="images-head">
        <button type="button" className="files-back" onClick={onClose} title="Back to chat (Esc)">
          <ArrowLeft size={16} /> Back to chat
        </button>
        <div className="files-tabs">
          <button
            type="button"
            className={`files-tab${tab === 'files' ? ' active' : ''}`}
            onClick={() => selectTab('files')}
          >
            Files
          </button>
          <button
            type="button"
            className={`files-tab${tab === 'created' ? ' active' : ''}`}
            onClick={() => selectTab('created')}
          >
            <Images size={15} /> Created
            {images.length > 0 && <span className="files-tab-count">{images.length}</span>}
          </button>
          <button
            type="button"
            className={`files-tab${tab === 'universe' ? ' active' : ''}`}
            onClick={() => selectTab('universe')}
          >
            <Globe size={15} /> Universe
          </button>
        </div>
      </header>

      {tab === 'created' && (
        <>
          {images.length === 0 ? (
            <EmptyState>No images yet. Ask Orbis to draw something — “a lighthouse at dusk”.</EmptyState>
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
                      <button type="button" aria-label="Open chat" title={`Open "${image.conversationTitle}"`} onClick={() => onOpenChat(image.conversationId)}>
                        <MessageSquare size={14} />
                      </button>
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'files' && (
        <div className="files-content">
          <Suspense fallback={<p className="view-empty">Loading Orbis Files…</p>}>
            <FilesHost tool={openTool && openTool !== 'universeExplorer' ? openTool : undefined} />
          </Suspense>
        </div>
      )}

      {tab === 'universe' && (
        <div className="files-content">
          <Suspense fallback={<p className="view-empty">Loading Universe…</p>}>
            <FilesHost tool="universeExplorer" />
          </Suspense>
        </div>
      )}
    </section>
  )
}
