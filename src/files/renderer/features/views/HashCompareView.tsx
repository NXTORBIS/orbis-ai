import React, { useCallback, useMemo, useState } from 'react';
import { call } from '../../api';
import { useStore } from '../../state/store';
import { ws, activePane, selectedEntries } from '../../state/workspace';
import { Button, EmptyState, ProgressBar, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes } from '../../ui/format';
import { HASH_ALGORITHMS, type HashAlgorithm, type HashCompareResult } from '../../../shared/hashCompare';

/**
 * HashCompareView: compare two files by computing and comparing their
 * cryptographic hashes (MD5, SHA-1, SHA-256, SHA-512).
 * Supports drag-and-drop file selection and shows match/mismatch.
 */

interface Progress {
  phase: 'A' | 'B';
  done: number;
  total: number;
}

export function HashCompareView() {
  const pane = useStore(ws, activePane);
  const sel = selectedEntries(pane.id);
  const files = useMemo(() => sel.filter((e) => e.kind === 'file').map((e) => e.path), [sel]);

  const [algorithm, setAlgorithm] = useState<HashAlgorithm>('sha256');
  const [pathA, setPathA] = useState(files[0] ?? '');
  const [pathB, setPathB] = useState(files[1] ?? '');
  const [result, setResult] = useState<HashCompareResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill from selection when it changes.
  React.useEffect(() => {
    if (files.length >= 1 && !pathA) setPathA(files[0]!);
    if (files.length >= 2 && !pathB) setPathB(files[1]!);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on selection change
  }, [files]);

  const handleDrop = useCallback((e: React.DragEvent, target: 'A' | 'B') => {
    e.preventDefault();
    const dropped = e.dataTransfer.getData('text/plain');
    if (dropped) {
      if (target === 'A') setPathA(dropped);
      else setPathB(dropped);
    }
    // Also handle file drops from the OS.
    // NOTE: file.path was removed in Electron 32+. For Electron 32+, an IPC-based
    // approach (e.g., webUtils.getPathForFile or a main-process handler) is needed
    // to retrieve the native file path from dropped File objects.
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]!;
      // In older Electron versions the path property is available on File objects.
      const filePath = (file as File & { path?: string }).path;
      if (filePath) {
        if (target === 'A') setPathA(filePath);
        else setPathB(filePath);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const compare = useCallback(async () => {
    if (!pathA.trim() || !pathB.trim()) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress(null);
    try {
      const r = await call<HashCompareResult>('hashCompare:compare', {
        pathA: pathA.trim(),
        pathB: pathB.trim(),
        algorithm,
        jobId: `hc-${Date.now()}`,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [pathA, pathB, algorithm]);

  const clear = useCallback(() => {
    setPathA('');
    setPathB('');
    setResult(null);
    setError(null);
    setProgress(null);
  }, []);

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>File Hash Comparator</h1>
      </header>

      {/* Algorithm selector */}
      <div className="hash-compare-algo">
        <label className="small muted">Algorithm</label>
        <div className="hash-algo-buttons">
          {HASH_ALGORITHMS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`hash-algo-btn ${algorithm === a.id ? 'active' : ''}`}
              onClick={() => setAlgorithm(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* File dropzones */}
      <div className="hash-compare-files">
        <div
          className="hash-dropzone"
          onDrop={(e) => handleDrop(e, 'A')}
          onDragOver={handleDragOver}
        >
          <label className="small muted">File A</label>
          <TextField
            value={pathA}
            onChange={(e) => setPathA(e.currentTarget.value)}
            placeholder="Drop a file here or enter a path..."
            mono
          />
          {result && (
            <div className="hash-result-value mono small">{result.hashA}</div>
          )}
        </div>
        <div
          className="hash-dropzone"
          onDrop={(e) => handleDrop(e, 'B')}
          onDragOver={handleDragOver}
        >
          <label className="small muted">File B</label>
          <TextField
            value={pathB}
            onChange={(e) => setPathB(e.currentTarget.value)}
            placeholder="Drop a file here or enter a path..."
            mono
          />
          {result && (
            <div className="hash-result-value mono small">{result.hashB}</div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="hash-compare-actions">
        <Button
          variant="primary"
          disabled={!pathA.trim() || !pathB.trim() || running}
          onClick={() => void compare()}
        >
          {running ? 'Computing...' : 'Compare'}
        </Button>
        <Button variant="ghost" onClick={clear}>Clear</Button>
        {files.length >= 2 && (
          <Button
            variant="ghost"
            onClick={() => { setPathA(files[0]!); setPathB(files[1]!); }}
          >
            Use selected files
          </Button>
        )}
      </div>

      {/* Progress */}
      {running && progress && (
        <ProgressBar
          value={progress.total > 0 ? progress.done / progress.total : undefined}
          label={`Hashing file ${progress.phase}...`}
        />
      )}

      {/* Error */}
      {error && (
        <div className="hash-compare-error">
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`hash-compare-result ${result.match ? 'match' : 'mismatch'}`}>
          <div className="hash-result-indicator">
            <Icon name={result.match ? 'check' : 'close'} size={24} />
            <span className="hash-result-label">
              {result.match ? 'Files match' : 'Files differ'}
            </span>
          </div>
          <div className="hash-result-details">
            <table className="table">
              <tbody>
                <tr>
                  <td className="muted">Algorithm</td>
                  <td>{result.algorithm.toUpperCase()}</td>
                </tr>
                <tr>
                  <td className="muted">File A size</td>
                  <td>{formatBytes(result.sizeA)}</td>
                </tr>
                <tr>
                  <td className="muted">File B size</td>
                  <td>{formatBytes(result.sizeB)}</td>
                </tr>
                <tr>
                  <td className="muted">File A hash</td>
                  <td className="mono small" style={{ wordBreak: 'break-all' }}>{result.hashA}</td>
                </tr>
                <tr>
                  <td className="muted">File B hash</td>
                  <td className="mono small" style={{ wordBreak: 'break-all' }}>{result.hashB}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!result && !running && !error && (
        <EmptyState
          icon="verify"
          title="Compare files by hash"
          body="Select two files, drag and drop them, or enter their paths above. The tool computes their cryptographic hashes and tells you whether they are identical."
        />
      )}
    </div>
  );
}
