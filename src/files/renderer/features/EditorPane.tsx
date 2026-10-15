import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { openDialog } from '../state/app';
import { navigate, type Pane as PaneT } from '../state/workspace';
import {
  attachView, checkDisk, editorUi, editReadOnlyAnyway, ensureSession, reloadFromDisk, reopenWithEncoding, save, saveAs, setIndent, setLanguage, setPreview, setSaveFormat, setWrap,
  textOf, viewOf, type EditorUi,
} from '../state/editor';
import { openFile } from '../actions';
import { keyLabel, shortcutFor } from '../commands';
import { Button, EmptyState, ErrorState, IconButton, Loading, SEP, useMenu, type MenuItem } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes } from '../ui/format';
import { Markdown } from './Preview';
import { EDITOR_LANGUAGES, EOL_LABEL, languageById, type EolKind } from '../../shared/editor';
import type { TextEncodingName } from '../../shared/docTools';

/**
 * A pane showing one file in the built-in editor: toolbar, banners (read-only,
 * changed on disk, mixed line endings), CodeMirror, an optional Markdown
 * preview beside it, and a status bar with the cursor, indentation, encoding,
 * line endings, language, word count and the unsaved-changes dot.
 */

export const ENCODING_SHORT: Record<TextEncodingName, string> = { utf8: 'UTF-8', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE', windows1252: 'Windows-1252', latin1: 'Latin-1' };
export const encodingLabel = (encoding: TextEncodingName, bom: boolean) => `${ENCODING_SHORT[encoding]}${bom && encoding === 'utf8' ? ' with BOM' : ''}`;

export function EditorPane({ pane, path }: { pane: PaneT; path: string }) {
  useEffect(() => ensureSession(pane.id, path), [pane.id, path]);
  const ui = useStore(editorUi, (s) => s[pane.id]);
  if (!ui || ui.status === 'loading') return <Loading label={`Opening ${path.split(/[\\/]/).pop()}…`} />;
  if (ui.status === 'error') {
    return (
      <ErrorState title="This file could not be opened" body={ui.error?.message} errorId={ui.error?.errorId}>
        <Button onClick={() => void reloadFromDisk(pane.id)}>Try again</Button>
        <Button onClick={() => void navigate(pane.id, { kind: 'fs', path })}>Show in folder</Button>
      </ErrorState>
    );
  }
  if (ui.status === 'refused') {
    return (
      <EmptyState icon="fileText" title={ui.refusal?.reason === 'too-large' ? 'Too large for the built-in editor' : 'Not opened in the editor'} body={<>{ui.refusal?.message}{ui.refusal?.size !== undefined ? ` (${formatBytes(ui.refusal.size)})` : ''}</>}>
        <Button variant="primary" icon="openWith" onClick={() => void openFile(path)}>Open with default app</Button>
        <Button onClick={() => void navigate(pane.id, { kind: 'fs', path })}>Show in folder</Button>
      </EmptyState>
    );
  }
  return <EditorReady pane={pane} ui={ui} />;
}

function EditorReady({ pane, ui }: { pane: PaneT; ui: EditorUi }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [mixedSeen, setMixedSeen] = useState(false);
  const meta = ui.meta!;
  const isMarkdown = ui.language === 'markdown';
  const showPreview = isMarkdown && ui.preview;

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    return attachView(pane.id, el);
  }, [pane.id]);

  // Approximate scroll sync: the preview follows the editor's scroll position as a fraction.
  useEffect(() => {
    if (!showPreview) return;
    const v = viewOf(pane.id);
    const pv = previewRef.current;
    if (!v || !pv) return;
    const onScroll = () => {
      const s = v.scrollDOM;
      const max = s.scrollHeight - s.clientHeight;
      pv.scrollTop = max > 0 ? (s.scrollTop / max) * (pv.scrollHeight - pv.clientHeight) : 0;
    };
    v.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => v.scrollDOM.removeEventListener('scroll', onScroll);
  }, [pane.id, showPreview]);

  const tb = (id: string) => shortcutFor(id);
  const more = useMenu();
  const moreItems = (): MenuItem[] => [
    { label: 'Reload from disk', icon: 'refresh', run: () => void reloadFromDisk(pane.id) },
    { label: 'Compare with the file on disk', icon: 'diff', run: () => openDialog('editorDiff', { paneId: pane.id }) },
    { label: 'Reopen with encoding', icon: 'textFix', submenu: (Object.keys(ENCODING_SHORT) as TextEncodingName[]).map((e) => ({ label: ENCODING_SHORT[e], checked: meta.encoding === e, run: () => void reopenWithEncoding(pane.id, e) })) },
    SEP,
    { label: 'Show in folder', icon: 'folderOpen', run: () => void navigate(pane.id, { kind: 'fs', path: meta.requestedPath }) },
    { label: 'Open with default app', icon: 'openWith', run: () => void openFile(meta.path) },
  ];

  return (
    <div className="editor-view" ref={rootRef} data-editor-pane={pane.id}>
      <div className="editor-toolbar" role="toolbar" aria-label="Editor">
        <IconButton icon="save" label={meta.readOnly && !ui.editAnyway ? 'Save (read-only file: saves as a new file)' : 'Save'} shortcut={tb('editor.save')} disabled={ui.saving} onClick={() => void save(pane.id)} />
        <IconButton icon="exportFile" label="Save as…" shortcut={tb('editor.saveAs')} onClick={() => void saveAs(pane.id)} />
        <span className="tb-sep" role="separator" aria-orientation="vertical" />
        <IconButton icon="undo" label="Undo" shortcut={keyLabel('Mod+Z')} disabled={!ui.canUndo} onClick={() => viewOf(pane.id)?.undo()} />
        <IconButton icon="redo" label="Redo" shortcut={keyLabel('Mod+Shift+Z')} disabled={!ui.canRedo} onClick={() => viewOf(pane.id)?.redo()} />
        <span className="tb-sep" role="separator" aria-orientation="vertical" />
        <IconButton icon="replace" label="Find and replace" shortcut={keyLabel('Mod+F')} onClick={() => viewOf(pane.id)?.openSearch()} />
        <IconButton icon="gotoLine" label="Go to line…" shortcut={tb('editor.gotoLine')} onClick={() => viewOf(pane.id)?.gotoLine()} />
        <IconButton icon="textFix" label="Soft wrap" shortcut={tb('editor.toggleWrap')} active={ui.wrap} onClick={() => setWrap(pane.id, !ui.wrap)} />
        {isMarkdown && <IconButton icon="eye" label="Markdown preview" shortcut={tb('editor.togglePreview')} active={ui.preview} onClick={() => setPreview(pane.id, !ui.preview)} />}
        <span className="tb-flex" />
        {ui.saving && <span className="editor-saving muted small" role="status">Saving…</span>}
        <IconButton icon="more" label="More editor actions" aria-haspopup="menu" onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          more.open(moreItems(), r.right, r.bottom + 4, 'right');
        }} />
        {more.node}
      </div>
      <EditorBanners pane={pane} ui={ui} mixedSeen={mixedSeen} onMixedSeen={() => setMixedSeen(true)} />
      <div className={`editor-main ${showPreview ? 'with-preview' : ''}`}>
        <div className="editor-host" ref={hostRef} />
        {ui.notice && (
          <div className={`editor-notice tone-${ui.notice.tone}`} aria-hidden>
            <Icon name={ui.notice.tone === 'success' ? 'success' : ui.notice.tone === 'warning' ? 'warning' : 'info'} size={14} />
            {ui.notice.text}
          </div>
        )}
        {showPreview && <MarkdownPreview paneId={pane.id} version={ui.version} ref={previewRef} />}
      </div>
      <EditorStatusBar pane={pane} ui={ui} />
      <div className="sr-only" aria-live="polite">{ui.notice?.text ?? ''}</div>
    </div>
  );
}

function EditorBanners({ pane, ui, mixedSeen, onMixedSeen }: { pane: PaneT; ui: EditorUi; mixedSeen: boolean; onMixedSeen: () => void }) {
  const meta = ui.meta!;
  return (
    <>
      {ui.external === 'changed' && (
        <div className="editor-banner warning" role="alert">
          <Icon name="warning" size={16} />
          <span className="editor-banner-text">Another program changed this file on disk. Your unsaved changes here are kept; saving will ask which version to keep.</span>
          <span className="editor-banner-actions">
            <Button size="sm" onClick={() => openDialog('editorDiff', { paneId: pane.id })}>Compare</Button>
            <Button size="sm" onClick={() => void reloadFromDisk(pane.id)}>Reload theirs</Button>
          </span>
        </div>
      )}
      {ui.external === 'deleted' && (
        <div className="editor-banner warning" role="alert">
          <Icon name="warning" size={16} />
          <span className="editor-banner-text">This file was deleted or moved by another program. Saving asks whether to create it again; Save as… keeps your text elsewhere.</span>
          <span className="editor-banner-actions">
            <Button size="sm" onClick={() => void checkDisk(pane.id)}>Check again</Button>
          </span>
        </div>
      )}
      {meta.readOnly && (
        <div className="editor-banner" role="note">
          <Icon name="lock" size={16} />
          <span className="editor-banner-text">
            <strong>Read-only.</strong> {meta.readOnlyReason} {ui.editAnyway ? 'Your changes are saved to a new file with Save as….' : ''}
          </span>
          {!ui.editAnyway && (
            <span className="editor-banner-actions">
              <Button size="sm" onClick={() => editReadOnlyAnyway(pane.id)}>Edit and save as a copy</Button>
            </span>
          )}
        </div>
      )}
      {meta.mixedEol && !mixedSeen && (
        <div className="editor-banner" role="note">
          <Icon name="info" size={16} />
          <span className="editor-banner-text">This file mixes line endings. Saving writes {EOL_LABEL[ui.save.eol]} everywhere (change it in the status bar).</span>
          <span className="editor-banner-actions"><Button size="sm" onClick={onMixedSeen}>OK</Button></span>
        </div>
      )}
    </>
  );
}

const MarkdownPreview = React.forwardRef<HTMLDivElement, { paneId: string; version: number }>(function MarkdownPreview({ paneId, version }, ref) {
  const [text, setText] = useState(() => textOf(paneId));
  useEffect(() => {
    const t = setTimeout(() => setText(textOf(paneId)), text.length > 200_000 ? 600 : 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, version]);
  return (
    <div className="editor-preview" ref={ref} tabIndex={0} role="region" aria-label="Markdown preview">
      <Markdown source={text} />
    </div>
  );
});

function EditorStatusBar({ pane, ui }: { pane: PaneT; ui: EditorUi }) {
  const menu = useMenu();
  const meta = ui.meta!;
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open(items, r.left, r.top - 4, 'left');
  };
  const c = ui.cursor;
  const sel = c.selectedChars ? ` (${c.selectedChars} selected${c.selections > 1 ? ` in ${c.selections}` : ''})` : c.selections > 1 ? ` (${c.selections} cursors)` : '';
  const encodingItems = (): MenuItem[] => [
    { label: 'Save with encoding', disabled: true, reason: 'Choose below; the file is converted when you save.', run: () => undefined },
    ...([['utf8', false], ['utf8', true], ['utf16le', true], ['utf16be', true], ['windows1252', false], ['latin1', false]] as Array<[TextEncodingName, boolean]>).map(([e, bom]) => ({
      label: e === 'utf16le' || e === 'utf16be' ? `${ENCODING_SHORT[e]} (with BOM)` : encodingLabel(e, bom),
      checked: ui.save.encoding === e && (e !== 'utf8' || ui.save.bom === bom),
      run: () => setSaveFormat(pane.id, { encoding: e, bom }),
    })),
    SEP,
    { label: 'Reopen with encoding', icon: 'refresh', submenu: (Object.keys(ENCODING_SHORT) as TextEncodingName[]).map((e) => ({ label: ENCODING_SHORT[e], checked: meta.encoding === e, run: () => void reopenWithEncoding(pane.id, e) })) },
  ];
  const eolItems = (): MenuItem[] => (['lf', 'crlf', ...(meta.eol === 'cr' ? ['cr' as const] : [])] as EolKind[]).map((eol) => ({
    label: eol === 'lf' ? 'LF (Linux, macOS)' : eol === 'crlf' ? 'CRLF (Windows)' : 'CR (classic Mac OS)',
    checked: ui.save.eol === eol,
    run: () => setSaveFormat(pane.id, { eol }),
  }));
  const indentItems = (): MenuItem[] => [
    { label: 'Indent with spaces', checked: !ui.useTabs, run: () => setIndent(pane.id, false, ui.tabSize) },
    { label: 'Indent with tabs', checked: ui.useTabs, run: () => setIndent(pane.id, true, ui.tabSize) },
    SEP,
    ...[2, 3, 4, 8].map((n) => ({ label: `Tab size ${n}`, checked: ui.tabSize === n, run: () => setIndent(pane.id, ui.useTabs, n) })),
  ];
  const languageItems = (): MenuItem[] => EDITOR_LANGUAGES.map((l) => ({ label: l.label, checked: ui.language === l.id, run: () => setLanguage(pane.id, l.id) }));
  const encChanged = ui.save.encoding !== meta.encoding || (ui.save.bom !== meta.bom && ui.save.encoding === 'utf8');
  const eolChanged = ui.save.eol !== meta.eol;
  return (
    <div className="editor-status" role="group" aria-label="Editor status">
      <span className="es-item tabular" title={`${c.lines} lines`}>Ln {c.line}, Col {c.col}{sel}</span>
      <button type="button" className="es-item es-btn es-indent" aria-haspopup="menu" aria-label={`Indentation: ${ui.useTabs ? 'tabs' : 'spaces'}, size ${ui.tabSize}. Change`} onClick={(e) => open(e, indentItems())}>{ui.useTabs ? 'Tabs' : 'Spaces'}: {ui.tabSize}</button>
      <button type="button" className={`es-item es-btn ${encChanged ? 'is-changed' : ''}`} aria-haspopup="menu" aria-label={`Encoding: ${encodingLabel(ui.save.encoding, ui.save.bom)}${encChanged ? ` (file is ${encodingLabel(meta.encoding, meta.bom)}; converted when saved)` : ''}. Change`}
        title={encChanged ? `The file is ${encodingLabel(meta.encoding, meta.bom)}; it is saved as ${encodingLabel(ui.save.encoding, ui.save.bom)}.` : meta.encodingSource === 'bom' ? 'Found from the byte-order mark' : meta.encodingSource === 'chosen' ? 'Chosen by you (Reopen with encoding)' : 'Detected from the contents'}
        onClick={(e) => open(e, encodingItems())}>{encodingLabel(ui.save.encoding, ui.save.bom)}</button>
      <button type="button" className={`es-item es-btn ${eolChanged ? 'is-changed' : ''}`} aria-haspopup="menu" aria-label={`Line endings: ${EOL_LABEL[ui.save.eol]}${meta.mixedEol ? ' (the file mixes line endings)' : ''}. Change`} title={meta.mixedEol ? `The file mixes line endings; saving writes ${EOL_LABEL[ui.save.eol]} everywhere.` : undefined} onClick={(e) => open(e, eolItems())}>
        {EOL_LABEL[ui.save.eol]}{meta.mixedEol && !eolChanged ? '*' : ''}
      </button>
      <button type="button" className="es-item es-btn es-lang" aria-haspopup="menu" aria-label={`Language: ${languageById(ui.language).label}. Change`} onClick={(e) => open(e, languageItems())}>{languageById(ui.language).label}</button>
      {ui.words && <span className="es-item es-words tabular" title={`${ui.words.chars.toLocaleString()} characters`}>{ui.words.words.toLocaleString()} {ui.words.words === 1 ? 'word' : 'words'}</span>}
      <span className="es-flex" />
      {meta.readOnly && <span className="es-item es-ro"><Icon name="lock" size={12} /> Read-only</span>}
      <span className={`es-item es-dirty ${ui.dirty ? 'on' : ''}`} role="img" aria-label={ui.dirty ? 'Unsaved changes' : 'All changes saved'} title={ui.dirty ? 'Unsaved changes' : 'All changes saved'} />
      {menu.node}
    </div>
  );
}
