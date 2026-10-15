// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useEffect, useRef, useState, useCallback } from 'react';
import { call } from '../../api';
import { Icon } from '../../ui/Icon';
import { IconButton, Loading } from '../../ui/components';
import { useStore } from '../../state/store';
import {
  comicViewer, closeComic, setComicPage, toggleComicDoublePage,
  toggleMangaMode, toggleComicThumbnails, setComicFitMode,
} from '../../state/viewers';

export function ComicViewer() {
  const state = useStore(comicViewer, (s) => s.open);
  if (!state) return null;
  return <ComicViewerInner key={state.path} />;
}

function ComicViewerInner() {
  const state = useStore(comicViewer, (s) => s.open)!;
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [page2Url, setPage2Url] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Map<number, string>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(async (idx: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = state.manifest.pages[idx];
      if (!page) throw new Error(`Page ${idx + 1} not found.`);
      const result = await call<{ path: string; url: string }>('comic:page', { path: state.path, entry: page.entry });
      setPageUrl(result.url);

      // Load second page for double-page spread
      if (state.doublePage && idx + 1 < state.manifest.pageCount) {
        const page2 = state.manifest.pages[idx + 1];
        if (page2) {
          const result2 = await call<{ path: string; url: string }>('comic:page', { path: state.path, entry: page2.entry });
          setPage2Url(result2.url);
        } else {
          setPage2Url(null);
        }
      } else {
        setPage2Url(null);
      }

      // Save position
      void call('comic:savePosition', { path: state.path, index: idx });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [state.path, state.doublePage, state.manifest]);

  useEffect(() => {
    void loadPage(state.pageIndex);
  }, [state.pageIndex, loadPage]);

  // Load thumbnails when strip is shown
  useEffect(() => {
    if (!state.showThumbnails) return;
    const loadThumbs = async () => {
      const newUrls = new Map(thumbUrls);
      // Load a window of thumbnails around current page
      // NOTE: Known performance limitation - comic:page IPC does not support
      // a size/quality parameter, so thumbnails load full-size images.
      // A thumbnail-specific parameter would reduce memory and improve scroll perf.
      const start = Math.max(0, state.pageIndex - 10);
      const end = Math.min(state.manifest.pageCount, state.pageIndex + 20);
      for (let i = start; i < end; i++) {
        if (newUrls.has(i)) continue;
        const page = state.manifest.pages[i];
        if (!page) continue;
        try {
          const result = await call<{ path: string; url: string }>('comic:page', { path: state.path, entry: page.entry });
          newUrls.set(i, result.url);
        } catch {
          // Skip failed thumbnails
        }
      }
      setThumbUrls(newUrls);
    };
    void loadThumbs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.showThumbnails, state.pageIndex, state.manifest, state.path]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const step = state.doublePage ? 2 : 1;
      const prev = state.mangaMode ? 'ArrowRight' : 'ArrowLeft';
      const next = state.mangaMode ? 'ArrowLeft' : 'ArrowRight';

      if (e.key === prev || e.key === 'PageUp') {
        e.preventDefault();
        if (state.pageIndex > 0) setComicPage(state.pageIndex - step);
      } else if (e.key === next || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        if (state.pageIndex < state.manifest.pageCount - 1) setComicPage(state.pageIndex + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setComicPage(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setComicPage(state.manifest.pageCount - 1);
      } else if (e.key === 'Escape') {
        closeComic();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.pageIndex, state.manifest.pageCount, state.doublePage, state.mangaMode]);

  const prevPage = () => {
    const step = state.doublePage ? 2 : 1;
    if (state.pageIndex > 0) setComicPage(state.pageIndex - step);
  };

  const nextPage = () => {
    const step = state.doublePage ? 2 : 1;
    if (state.pageIndex < state.manifest.pageCount - 1) setComicPage(state.pageIndex + step);
  };

  const fitClass = `comic-fit-${state.fitMode}`;

  return (
    <div className="comic-viewer">
      {/* Toolbar */}
      <div className="comic-toolbar">
        <div className="comic-toolbar-left">
          <IconButton icon="x" label="Close" onClick={closeComic} />
          <span className="muted tabular small">{state.pageIndex + 1} / {state.manifest.pageCount}</span>
        </div>
        <div className="comic-toolbar-center">
          <IconButton icon={state.mangaMode ? 'arrowRight' : 'arrowLeft'} label="Previous page" onClick={prevPage} disabled={state.pageIndex === 0} />
          <IconButton icon={state.mangaMode ? 'arrowLeft' : 'arrowRight'} label="Next page" onClick={nextPage} disabled={state.pageIndex >= state.manifest.pageCount - 1} />
        </div>
        <div className="comic-toolbar-right">
          <button type="button" className={`btn btn-ghost btn-sm ${state.fitMode === 'width' ? 'is-active' : ''}`} onClick={() => setComicFitMode('width')}>Width</button>
          <button type="button" className={`btn btn-ghost btn-sm ${state.fitMode === 'height' ? 'is-active' : ''}`} onClick={() => setComicFitMode('height')}>Height</button>
          <button type="button" className={`btn btn-ghost btn-sm ${state.fitMode === 'page' ? 'is-active' : ''}`} onClick={() => setComicFitMode('page')}>Fit</button>
          <IconButton icon="columns" label="Double page spread" onClick={toggleComicDoublePage} active={state.doublePage} />
          <IconButton icon="arrowLeftRight" label="Manga mode (right-to-left)" onClick={toggleMangaMode} active={state.mangaMode} />
          <IconButton icon="grid" label="Thumbnail strip" onClick={toggleComicThumbnails} active={state.showThumbnails} />
        </div>
      </div>

      <div className="comic-body">
        {/* Thumbnail strip */}
        {state.showThumbnails && (
          <div className="comic-thumbstrip scroll-y">
            {state.manifest.pages.map((page, i) => (
              <button
                key={i}
                type="button"
                className={`comic-thumb ${i === state.pageIndex ? 'is-active' : ''}`}
                onClick={() => setComicPage(i)}
              >
                {thumbUrls.has(i) ? (
                  <img src={thumbUrls.get(i)} alt={`Page ${i + 1}`} draggable={false} />
                ) : (
                  <span className="comic-thumb-num">{i + 1}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Page display */}
        <div className={`comic-page-area ${fitClass}`} ref={containerRef}>
          {/* Click zones for navigation */}
          <div className="comic-click-prev" onClick={prevPage} />
          <div className="comic-click-next" onClick={nextPage} />

          {loading && <div className="comic-loading"><Loading label="Loading page…" /></div>}
          {error && <div className="comic-error"><Icon name="alert" size={20} /><span>{error}</span></div>}
          {!loading && !error && pageUrl && (
            <div className={`comic-pages ${state.doublePage ? 'double' : 'single'} ${state.mangaMode ? 'rtl' : 'ltr'}`}>
              <img
                src={pageUrl}
                alt={`Page ${state.pageIndex + 1}`}
                draggable={false}
                className="comic-page-img"
              />
              {state.doublePage && page2Url && (
                <img
                  src={page2Url}
                  alt={`Page ${state.pageIndex + 2}`}
                  draggable={false}
                  className="comic-page-img"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
