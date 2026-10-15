// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../../api';
import { toast, toastError, prompt as promptDialog } from '../../state/app';
import { useStore } from '../../state/store';
import { ws, activePane, selectedEntries } from '../../state/workspace';
import { Button, EmptyState } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes } from '../../ui/format';
import type { HexViewData, HexSearchResult } from '../../../shared/hexEditor';

const BYTES_PER_ROW = 16;
const CHUNK_SIZE = 4096; // bytes per loaded chunk
const VISIBLE_ROWS = 32;

interface EditedByte {
  value: number;
}

export function HexEditorView() {
  const pane = useStore(ws, activePane);
  const sel = selectedEntries(pane.id);
  const filePath = useMemo(() => {
    const f = sel.find((e) => e.kind === 'file');
    return f?.path ?? null;
  }, [sel]);

  const [data, setData] = useState<Uint8Array>(new Uint8Array(0));
  const [viewOffset, setViewOffset] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selStart, setSelStart] = useState<number | null>(null);
  const [_selEnd, setSelEnd] = useState<number | null>(null);
  const [edits, setEdits] = useState<Map<number, EditedByte>>(new Map());
  const [editingNibble, setEditingNibble] = useState<'high' | 'low' | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchPattern, setSearchPattern] = useState('');
  const [searchMode, setSearchMode] = useState<'hex' | 'text'>('text');
  const [searchResults, setSearchResults] = useState<HexSearchResult | null>(null);
  const [searchIdx, setSearchIdx] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadChunk = useCallback(async (path: string, offset: number) => {
    try {
      const result = await call<HexViewData>('hex:read', { path, offset, length: CHUNK_SIZE });
      const bytes = Uint8Array.from(atob(result.bytes), (c) => c.charCodeAt(0));
      setData(bytes);
      setViewOffset(result.offset);
      setTotalSize(result.totalSize);
      setLoadedPath(path);
    } catch (err) {
      toastError(err, 'Failed to read file');
    }
  }, []);

  useEffect(() => {
    if (filePath && filePath !== loadedPath) {
      setEdits(new Map());
      setCursor(0);
      setSelStart(null);
      setSelEnd(null);
      setEditingNibble(null);
      void loadChunk(filePath, 0);
    }
  }, [filePath, loadedPath, loadChunk]);

  const getByteAt = useCallback((offset: number): number | null => {
    const edit = edits.get(offset);
    if (edit) return edit.value;
    const localIdx = offset - viewOffset;
    if (localIdx < 0 || localIdx >= data.length) return null;
    return data[localIdx] ?? null;
  }, [data, viewOffset, edits]);

  const _totalRows = Math.ceil(totalSize / BYTES_PER_ROW);
  const _startRow = Math.floor(viewOffset / BYTES_PER_ROW);
  const rowsInView = Math.ceil(data.length / BYTES_PER_ROW);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!filePath) return;
    const el = e.currentTarget;
    const scrollRatio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    const targetOffset = Math.floor(scrollRatio * totalSize / BYTES_PER_ROW) * BYTES_PER_ROW;
    const clampedOffset = Math.max(0, Math.min(targetOffset, Math.max(0, totalSize - CHUNK_SIZE)));
    if (Math.abs(clampedOffset - viewOffset) > BYTES_PER_ROW * 4) {
      void loadChunk(filePath, clampedOffset);
    }
  }, [filePath, totalSize, viewOffset, loadChunk]);

  const handleByteClick = useCallback((offset: number, e: React.MouseEvent) => {
    if (e.shiftKey && selStart !== null) {
      setSelEnd(offset);
    } else {
      setCursor(offset);
      setSelStart(offset);
      setSelEnd(null);
    }
    setEditingNibble(null);
  }, [selStart]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!filePath) return;

    if (e.key === 'g' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void goToOffset();
      return;
    }
    if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSearchVisible((v) => !v);
      return;
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void saveEdits();
      return;
    }

    // Navigation
    if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); moveCursor(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(BYTES_PER_ROW); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-BYTES_PER_ROW); }

    // Hex editing
    if (/^[0-9a-fA-F]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const nibbleVal = parseInt(e.key, 16);
      const currentByte = getByteAt(cursor) ?? 0;
      let newVal: number;
      if (editingNibble === null || editingNibble === 'low') {
        // Start editing high nibble
        newVal = (nibbleVal << 4) | (currentByte & 0x0F);
        setEditingNibble('high');
      } else {
        // Edit low nibble, move to next byte
        newVal = (currentByte & 0xF0) | nibbleVal;
        setEditingNibble(null);
        moveCursor(1);
      }
      setEdits((prev) => new Map(prev).set(cursor, { value: newVal }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, cursor, editingNibble, getByteAt]);

  const moveCursor = (delta: number) => {
    setCursor((c) => {
      const next = Math.max(0, Math.min(totalSize - 1, c + delta));
      // Load new chunk if needed
      if (filePath && (next < viewOffset || next >= viewOffset + data.length)) {
        const newOffset = Math.max(0, Math.floor(next / BYTES_PER_ROW) * BYTES_PER_ROW - CHUNK_SIZE / 2);
        void loadChunk(filePath, newOffset);
      }
      return next;
    });
    setEditingNibble(null);
  };

  const goToOffset = async () => {
    const input = await promptDialog({ title: 'Go to offset', label: 'Offset (decimal or 0x hex)', initial: '0', confirmLabel: 'Go' });
    if (!input || !filePath) return;
    let offset: number;
    if (input.startsWith('0x') || input.startsWith('0X')) {
      offset = parseInt(input, 16);
    } else {
      offset = parseInt(input, 10);
    }
    if (isNaN(offset) || offset < 0) { toast({ level: 'warning', title: 'Invalid offset' }); return; }
    offset = Math.min(offset, totalSize - 1);
    setCursor(offset);
    const chunkStart = Math.max(0, offset - CHUNK_SIZE / 2);
    void loadChunk(filePath, chunkStart);
  };

  const saveEdits = async () => {
    if (!filePath || edits.size === 0) return;
    const editOps = Array.from(edits.entries()).map(([offset, edit]) => ({
      offset,
      bytes: btoa(String.fromCharCode(edit.value)),
    }));
    try {
      await call('hex:write', { path: filePath, edits: editOps });
      toast({ level: 'success', title: `Saved ${edits.size} byte${edits.size > 1 ? 's' : ''}` });
      setEdits(new Map());
      void loadChunk(filePath, viewOffset);
    } catch (err) {
      toastError(err, 'Failed to save');
    }
  };

  const doSearch = async () => {
    if (!filePath || !searchPattern) return;
    try {
      const result = await call<HexSearchResult>('hex:search', { path: filePath, pattern: searchPattern, mode: searchMode, fromOffset: 0 });
      setSearchResults(result);
      setSearchIdx(0);
      if (result.matches.length > 0) {
        const off = result.matches[0]!.offset;
        setCursor(off);
        void loadChunk(filePath, Math.max(0, off - CHUNK_SIZE / 2));
      } else {
        toast({ level: 'info', title: 'No matches found' });
      }
    } catch (err) {
      toastError(err, 'Search failed');
    }
  };

  const nextSearchResult = () => {
    if (!searchResults || !filePath || searchResults.matches.length === 0) return;
    const next = (searchIdx + 1) % searchResults.matches.length;
    setSearchIdx(next);
    const off = searchResults.matches[next]!.offset;
    setCursor(off);
    void loadChunk(filePath, Math.max(0, off - CHUNK_SIZE / 2));
  };

  // Data inspector for current cursor position
  const inspectorData = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    const b0 = getByteAt(cursor);
    if (b0 === null) return items;

    const byte0 = b0;
    items.push({ label: 'uint8', value: String(byte0) });
    items.push({ label: 'int8', value: String(byte0 > 127 ? byte0 - 256 : byte0) });

    const b1 = getByteAt(cursor + 1);
    if (b1 !== null) {
      const u16le = byte0 | (b1 << 8);
      const u16be = (byte0 << 8) | b1;
      items.push({ label: 'uint16 LE', value: String(u16le) });
      items.push({ label: 'uint16 BE', value: String(u16be) });
      const i16le = u16le > 32767 ? u16le - 65536 : u16le;
      items.push({ label: 'int16 LE', value: String(i16le) });
    }

    const bytes4: number[] = [];
    for (let i = 0; i < 4; i++) { const bv = getByteAt(cursor + i); if (bv !== null) bytes4.push(bv); else break; }
    if (bytes4.length === 4) {
      const abuf = new ArrayBuffer(4);
      const dv = new DataView(abuf);
      bytes4.forEach((bv, i) => dv.setUint8(i, bv));
      items.push({ label: 'uint32 LE', value: String(dv.getUint32(0, true)) });
      items.push({ label: 'float32 LE', value: dv.getFloat32(0, true).toPrecision(7) });
    }

    const bytes8: number[] = [];
    for (let i = 0; i < 8; i++) { const bv = getByteAt(cursor + i); if (bv !== null) bytes8.push(bv); else break; }
    if (bytes8.length === 8) {
      const abuf = new ArrayBuffer(8);
      const dv = new DataView(abuf);
      bytes8.forEach((bv, i) => dv.setUint8(i, bv));
      items.push({ label: 'float64 LE', value: dv.getFloat64(0, true).toPrecision(15) });
    }

    // UTF-8 string (up to 16 bytes)
    const strBytes: number[] = [];
    for (let i = 0; i < 16; i++) { const b = getByteAt(cursor + i); if (b !== null && b >= 32 && b < 127) strBytes.push(b); else break; }
    if (strBytes.length > 0) {
      items.push({ label: 'ASCII', value: String.fromCharCode(...strBytes) });
    }

    return items;
  }, [cursor, getByteAt]);

  const isInSelection = (offset: number) => {
    if (selStart === null) return false;
    const end = _selEnd ?? selStart;
    const lo = Math.min(selStart, end);
    const hi = Math.max(selStart, end);
    return offset >= lo && offset <= hi;
  };

  if (!filePath) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Hex Editor</h1></header>
        <EmptyState icon="binary" title="Select a file" body="Select a file in the file list to view and edit its binary content." />
      </div>
    );
  }

  const rows: React.ReactNode[] = [];
  for (let r = 0; r < rowsInView && r < VISIBLE_ROWS; r++) {
    const rowOffset = viewOffset + r * BYTES_PER_ROW;
    if (rowOffset >= totalSize) break;

    const hexCells: React.ReactNode[] = [];
    const asciiCells: React.ReactNode[] = [];
    for (let c = 0; c < BYTES_PER_ROW; c++) {
      const byteOffset = rowOffset + c;
      if (byteOffset >= totalSize) {
        hexCells.push(<span key={c} className="hex-byte hex-empty">  </span>);
        asciiCells.push(<span key={c} className="hex-ascii-char"> </span>);
        continue;
      }
      const byteVal = getByteAt(byteOffset);
      const isEdited = edits.has(byteOffset);
      const isCur = byteOffset === cursor;
      const isSel = isInSelection(byteOffset);
      const hexStr = byteVal !== null ? byteVal.toString(16).padStart(2, '0') : '??';
      const ascii = byteVal !== null && byteVal >= 32 && byteVal < 127 ? String.fromCharCode(byteVal) : '.';

      let cls = 'hex-byte';
      if (isCur) cls += ' hex-cursor';
      if (isSel) cls += ' hex-selected';
      if (isEdited) cls += ' hex-edited';

      hexCells.push(
        <span key={c} className={cls} onClick={(e) => handleByteClick(byteOffset, e)}>
          {hexStr}
        </span>,
      );
      asciiCells.push(
        <span key={c} className={`hex-ascii-char${isCur ? ' hex-cursor' : ''}${isSel ? ' hex-selected' : ''}${isEdited ? ' hex-edited' : ''}`}
          onClick={(e) => handleByteClick(byteOffset, e)}>
          {ascii}
        </span>,
      );
    }

    rows.push(
      <div key={rowOffset} className="hex-row">
        <span className="hex-offset">{rowOffset.toString(16).padStart(8, '0')}</span>
        <span className="hex-bytes">{hexCells}</span>
        <span className="hex-ascii">{asciiCells}</span>
      </div>,
    );
  }

  return (
    <div className="tool-view hex-editor-view" tabIndex={0} onKeyDown={handleKeyDown} ref={containerRef}>
      <header className="view-header">
        <h1>Hex Editor</h1>
        <div className="view-actions">
          {edits.size > 0 && <Button size="sm" variant="primary" onClick={saveEdits}><Icon name="save" size={14} /> Save {edits.size} change{edits.size > 1 ? 's' : ''}</Button>}
          <Button size="sm" onClick={() => setSearchVisible((v) => !v)} title="Find (Ctrl+F)"><Icon name="search" size={14} /></Button>
          <Button size="sm" onClick={goToOffset} title="Go to offset (Ctrl+G)"><Icon name="target" size={14} /></Button>
          <Button size="sm" onClick={() => setInspectorOpen((v) => !v)}><Icon name="info" size={14} /></Button>
        </div>
      </header>

      {searchVisible && (
        <div className="hex-search-bar">
          <select value={searchMode} onChange={(e) => setSearchMode(e.target.value as 'hex' | 'text')} className="hex-search-mode">
            <option value="text">Text</option>
            <option value="hex">Hex</option>
          </select>
          <input className="input" value={searchPattern} onChange={(e) => setSearchPattern(e.target.value)} placeholder={searchMode === 'hex' ? 'FF 00 AB...' : 'Search text...'} onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }} />
          <Button size="sm" onClick={doSearch}><Icon name="search" size={14} /></Button>
          {searchResults && searchResults.matches.length > 0 && (
            <>
              <span className="hex-search-count">{searchIdx + 1}/{searchResults.matches.length}{searchResults.truncated ? '+' : ''}</span>
              <Button size="sm" onClick={nextSearchResult}><Icon name="chevronDown" size={14} /></Button>
            </>
          )}
        </div>
      )}

      <div className="hex-main-layout">
        <div className="hex-grid" onScroll={handleScroll}>
          <div className="hex-row hex-header-row">
            <span className="hex-offset">Offset</span>
            <span className="hex-bytes">{Array.from({ length: BYTES_PER_ROW }, (_, i) => (
              <span key={i} className="hex-byte hex-col-header">{i.toString(16).padStart(2, '0')}</span>
            ))}</span>
            <span className="hex-ascii">ASCII</span>
          </div>
          {rows}
          {totalSize > CHUNK_SIZE && (
            <div className="hex-load-more">
              <Button size="sm" disabled={viewOffset === 0} onClick={() => filePath && loadChunk(filePath, Math.max(0, viewOffset - CHUNK_SIZE))}>
                <Icon name="chevronUp" size={14} /> Previous
              </Button>
              <Button size="sm" disabled={viewOffset + data.length >= totalSize}
                onClick={() => filePath && loadChunk(filePath, Math.min(totalSize - 1, viewOffset + CHUNK_SIZE))}>
                Next <Icon name="chevronDown" size={14} />
              </Button>
            </div>
          )}
        </div>

        {inspectorOpen && (
          <aside className="hex-inspector">
            <h3>Data Inspector</h3>
            <div className="hex-inspector-items">
              {inspectorData.map((item) => (
                <div key={item.label} className="hex-inspector-row">
                  <span className="hex-inspector-label">{item.label}</span>
                  <span className="hex-inspector-value">{item.value}</span>
                </div>
              ))}
              {inspectorData.length === 0 && <span className="text-secondary">No data at cursor</span>}
            </div>
          </aside>
        )}
      </div>

      <footer className="hex-status-bar">
        <span>Offset: 0x{cursor.toString(16).toUpperCase()}</span>
        <span>({cursor})</span>
        {selStart !== null && _selEnd !== null && selStart !== _selEnd && (
          <span>Selection: {Math.abs(_selEnd - selStart) + 1} bytes</span>
        )}
        <span className="hex-status-right">Size: {formatBytes(totalSize)}</span>
        {edits.size > 0 && <span className="hex-status-modified">{edits.size} modified</span>}
      </footer>
    </div>
  );
}
