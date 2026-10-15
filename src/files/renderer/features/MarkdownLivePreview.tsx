import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/components';
import type { MarkdownRenderResult } from '../../shared/markdown';

/* ---------------------------------------------------------------- Main */

export function MarkdownLivePreview({ initialSource }: { path: string; initialSource: string }) {
  const [source, setSource] = useState(initialSource);
  const [html, setHtml] = useState('');
  const [rendering, setRendering] = useState(true);
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Render markdown on source change (debounced)
  useEffect(() => {
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      setRendering(true);
      call<MarkdownRenderResult>('markdown:render', { content: source })
        .then((r) => setHtml(r.html))
        .catch(() => setHtml('<p class="error">Render error</p>'))
        .finally(() => setRendering(false));
    }, 150);
    return () => { if (renderTimer.current) clearTimeout(renderTimer.current); };
  }, [source]);

  // Initial render
  useEffect(() => {
    call<MarkdownRenderResult>('markdown:render', { content: initialSource })
      .then((r) => { setHtml(r.html); setRendering(false); })
      .catch(() => setRendering(false));
  }, [initialSource]);

  // Synchronized scrolling
  const syncScroll = useCallback((from: 'editor' | 'preview') => {
    if (syncing.current) return;
    syncing.current = true;
    const a = from === 'editor' ? editorRef.current : previewRef.current;
    const b = from === 'editor' ? previewRef.current : editorRef.current;
    if (a && b) {
      const ratio = a.scrollTop / (a.scrollHeight - a.clientHeight || 1);
      b.scrollTop = ratio * (b.scrollHeight - b.clientHeight);
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  // Toolbar insertions
  const insert = useCallback((before: string, after: string = '') => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = source.slice(start, end);
    const replacement = `${before}${selected || 'text'}${after}`;
    const next = source.slice(0, start) + replacement + source.slice(end);
    setSource(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + (selected || 'text').length;
    });
  }, [source]);

  const insertTable = useCallback(() => {
    const ta = editorRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const table = '\n| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n';
    setSource(source.slice(0, pos) + table + source.slice(pos));
  }, [source]);

  return (
    <div className="md-live-preview">
      <div className="md-toolbar">
        <div className="md-toolbar-actions">
          <IconButton icon="bold" label="Bold" onClick={() => insert('**', '**')} />
          <IconButton icon="italic" label="Italic" onClick={() => insert('*', '*')} />
          <span className="md-toolbar-sep" />
          <IconButton icon="type" label="Heading" onClick={() => insert('## ')} />
          <IconButton icon="link" label="Link" onClick={() => insert('[', '](url)')} />
          <IconButton icon="image" label="Image" onClick={() => insert('![', '](url)')} />
          <IconButton icon="code" label="Code" onClick={() => insert('`', '`')} />
          <IconButton icon="list" label="Table" onClick={insertTable} />
        </div>
        <div className="segmented" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>Edit</button>
          <button type="button" role="radio" aria-checked={mode === 'split'} className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>Split</button>
          <button type="button" role="radio" aria-checked={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Preview</button>
        </div>
      </div>
      <div className={`md-content md-mode-${mode}`}>
        {mode !== 'preview' && (
          <textarea
            ref={editorRef}
            className="md-editor"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onScroll={() => syncScroll('editor')}
            spellCheck={false}
            aria-label="Markdown source"
          />
        )}
        {mode !== 'edit' && (
          <div
            ref={previewRef}
            className="md-rendered markdown"
            onScroll={() => syncScroll('preview')}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
      {rendering && <div className="md-rendering-indicator"><Icon name="loader" size={12} /> Rendering...</div>}
    </div>
  );
}
