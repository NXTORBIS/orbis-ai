import { useEffect, useRef, useState, useCallback } from 'react';
import { call } from '../../api';
import { Icon } from '../../ui/Icon';
import { IconButton, Loading } from '../../ui/components';
import { useStore } from '../../state/store';
import {
  ebookViewer, closeEbook, setEbookChapter, setEbookFontSize, toggleEbookDarkMode,
} from '../../state/viewers';
import type { EbookChapter } from '../../../shared/viewers';

const FONT_SIZES = [12, 14, 16, 18, 20, 22, 24, 28, 32];

/**
 * Prefix all CSS selectors in raw CSS text with a scoping selector so that
 * ebook chapter styles cannot leak out and affect the rest of the app.
 */
function scopeEbookCss(css: string, scope: string): string {
  if (!css) return '';
  // Replace selectors before each { with scoped versions.
  // We handle @-rules (e.g. @media, @font-face, @keyframes) by leaving them intact
  // and only scoping the selectors inside rule blocks.
  return css.replace(
    /([^{}@]+)(\{)/g,
    (_match, selectors: string, brace: string) => {
      const scoped = selectors
        .split(',')
        .map((sel: string) => {
          const trimmed = sel.trim();
          if (!trimmed) return sel;
          // Don't scope selectors that are already inside @-rules definitions
          // (like property declarations) or are empty
          if (trimmed.includes(':') && !trimmed.includes(':root') && !trimmed.includes('::') && !trimmed.includes(':hover') && !trimmed.includes(':focus') && !trimmed.includes(':active') && !trimmed.includes(':first') && !trimmed.includes(':last') && !trimmed.includes(':nth') && !trimmed.includes(':not')) {
            return sel;
          }
          // Replace body/html selectors with the scope itself
          if (/^(html|body)$/i.test(trimmed)) {
            return ` ${scope}`;
          }
          return ` ${scope} ${trimmed}`;
        })
        .join(',');
      return scoped + brace;
    },
  );
}

export function EbookViewer() {
  const state = useStore(ebookViewer, (s) => s.open);
  if (!state) return null;
  return <EbookViewerInner key={state.path} />;
}

function EbookViewerInner() {
  const state = useStore(ebookViewer, (s) => s.open)!;
  const [chapter, setChapter] = useState<EbookChapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadChapter = useCallback(async (idx: number) => {
    setLoading(true);
    setError(null);
    try {
      const ch = await call<EbookChapter>('ebook:chapter', { path: state.path, spineIndex: idx });
      setChapter(ch);
      // Save position
      void call('ebook:savePosition', { path: state.path, index: idx });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [state.path]);

  useEffect(() => {
    void loadChapter(state.chapterIndex);
  }, [state.chapterIndex, loadChapter]);

  // Scroll to top on chapter change
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [state.chapterIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        if (state.chapterIndex > 0) setEbookChapter(state.chapterIndex - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        if (state.chapterIndex < state.manifest.spineCount - 1) setEbookChapter(state.chapterIndex + 1);
      } else if (e.key === 'Escape') {
        closeEbook();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.chapterIndex, state.manifest.spineCount]);

  const prevChapter = () => {
    if (state.chapterIndex > 0) setEbookChapter(state.chapterIndex - 1);
  };

  const nextChapter = () => {
    if (state.chapterIndex < state.manifest.spineCount - 1) setEbookChapter(state.chapterIndex + 1);
  };

  const bgClass = state.darkMode ? 'ebook-dark' : 'ebook-light';

  return (
    <div className={`ebook-viewer ${bgClass}`}>
      {/* Header toolbar */}
      <div className="ebook-toolbar">
        <div className="ebook-toolbar-left">
          <IconButton icon="x" label="Close" onClick={closeEbook} />
          <IconButton icon="list" label="Table of contents" onClick={() => setShowToc(!showToc)} active={showToc} />
          <span className="ebook-title ellipsis">{state.manifest.metadata.title ?? 'Untitled'}</span>
        </div>
        <div className="ebook-toolbar-center">
          <IconButton icon="arrowLeft" label="Previous chapter" onClick={prevChapter} disabled={state.chapterIndex === 0} />
          <span className="muted tabular small">{state.chapterIndex + 1} / {state.manifest.spineCount}</span>
          <IconButton icon="arrowRight" label="Next chapter" onClick={nextChapter} disabled={state.chapterIndex >= state.manifest.spineCount - 1} />
        </div>
        <div className="ebook-toolbar-right">
          <IconButton icon="zoomOut" label="Decrease font size" onClick={() => {
            const idx = FONT_SIZES.indexOf(state.fontSize);
            if (idx > 0) setEbookFontSize(FONT_SIZES[idx - 1]!);
          }} />
          <span className="muted tabular small">{state.fontSize}px</span>
          <IconButton icon="zoomIn" label="Increase font size" onClick={() => {
            const idx = FONT_SIZES.indexOf(state.fontSize);
            if (idx < FONT_SIZES.length - 1) setEbookFontSize(FONT_SIZES[idx + 1]!);
          }} />
          <IconButton icon={state.darkMode ? 'sun' : 'moon'} label="Toggle dark mode" onClick={toggleEbookDarkMode} />
        </div>
      </div>

      <div className="ebook-body">
        {/* TOC sidebar */}
        {showToc && (
          <div className="ebook-toc">
            <div className="ebook-toc-header">
              <strong>Contents</strong>
            </div>
            <div className="ebook-toc-list scroll-y">
              {state.manifest.toc.map((entry, i) => (
                <button
                  key={i}
                  type="button"
                  className={`ebook-toc-item ${entry.spineIndex === state.chapterIndex ? 'is-active' : ''}`}
                  style={{ paddingLeft: `${12 + entry.depth * 16}px` }}
                  onClick={() => {
                    setEbookChapter(entry.spineIndex);
                    setShowToc(false);
                  }}
                >
                  {entry.label}
                </button>
              ))}
              {state.manifest.toc.length === 0 && (
                <div className="ebook-toc-empty muted small">No table of contents available.</div>
              )}
            </div>
          </div>
        )}

        {/* Chapter content */}
        <div className="ebook-content scroll-y" ref={contentRef}>
          {loading && <div className="ebook-loading"><Loading label="Loading chapter…" /></div>}
          {error && <div className="ebook-error"><Icon name="alert" size={20} /><span>{error}</span></div>}
          {!loading && !error && chapter && (
            <div className="ebook-chapter ebook-chapter-content" style={{ fontSize: `${state.fontSize}px` }}>
              <style>{scopeEbookCss(chapter.css, '.ebook-chapter-content')}</style>
              <div dangerouslySetInnerHTML={{ __html: chapter.html }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
