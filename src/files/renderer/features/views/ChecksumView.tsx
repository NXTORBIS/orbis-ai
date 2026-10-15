import { useCallback, useMemo, useRef, useState } from 'react';
import { call, runJob, type JobHandle } from '../../api';
import { toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { ws, activePane, selectedEntries } from '../../state/workspace';
import { Button, EmptyState, Pill, ProgressBar, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes } from '../../ui/format';
import { JobPauseButton } from './common';

/**
 * Checksum / Hash tool view: compute and verify file checksums.
 */

type Algorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

interface HashResult {
  path: string;
  hash: string;
  size: number;
}

interface Progress {
  index: number;
  total: number;
  file: string;
  done: number;
  fileTotal: number;
}

export function ChecksumView() {
  const pane = useStore(ws, activePane);
  const sel = selectedEntries(pane.id);
  const paths = useMemo(() => sel.filter((e) => e.kind === 'file').map((e) => e.path), [sel]);

  const [algorithm, setAlgorithm] = useState<Algorithm>('sha256');
  const [results, setResults] = useState<HashResult[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [verifyHash, setVerifyHash] = useState('');
  const [verifyMode, setVerifyMode] = useState(false);
  const jobRef = useRef<JobHandle<HashResult[]> | null>(null);

  const compute = useCallback(async () => {
    if (!paths.length) return;
    setRunning(true);
    setResults([]);
    setProgress(null);

    const job = runJob<HashResult[]>(
      (jobId) => call('hash:compute', { paths, algorithm, jobId }),
      (p) => setProgress(p as Progress),
      `Hashing ${paths.length} file${paths.length > 1 ? 's' : ''}`,
    );
    jobRef.current = job;

    try {
      const { value, cancelled } = await job.promise;
      if (!cancelled && value) {
        setResults(value);
      }
    } catch (err) {
      toastError(err, 'Hash computation failed');
    } finally {
      setRunning(false);
      setProgress(null);
      jobRef.current = null;
    }
  }, [paths, algorithm]);

  const cancel = useCallback(() => {
    jobRef.current?.cancel();
  }, []);

  const copyHash = useCallback((hash: string) => {
    void call('fs:copyText', { text: hash });
    toast({ level: 'success', title: 'Hash copied to clipboard' });
  }, []);

  const copyAll = useCallback(() => {
    const text = results.map((r) => `${r.hash}  ${r.path.split(/[\\/]/).pop()}`).join('\n');
    void call('fs:copyText', { text });
    toast({ level: 'success', title: `Copied ${results.length} hash${results.length !== 1 ? 'es' : ''}` });
  }, [results]);

  const verifyMatch = useMemo(() => {
    if (!verifyHash.trim() || !results.length) return null;
    const normalized = verifyHash.trim().toLowerCase();
    return results.find((r) => r.hash.toLowerCase() === normalized) ?? false;
  }, [verifyHash, results]);

  if (!paths.length && !results.length) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Checksum</h1></header>
        <EmptyState icon="verify" title="Select files to hash" body="Select one or more files in the file list, then choose an algorithm and compute their checksums." />
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y checksum-view">
      <header className="view-header">
        <h1>Checksum</h1>
        {paths.length > 0 && <Pill>{paths.length} file{paths.length !== 1 ? 's' : ''}</Pill>}
      </header>

      <section className="checksum-controls">
        <div className="checksum-algo-row">
          <label className="checksum-label">Algorithm</label>
          <div className="checksum-algo-group">
            {(['md5', 'sha1', 'sha256', 'sha512'] as const).map((alg) => (
              <button key={alg} type="button" className={`btn btn-sm ${algorithm === alg ? 'btn-primary' : 'btn-default'}`} onClick={() => setAlgorithm(alg)}>
                {alg.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="checksum-action-row">
          {!running ? (
            <Button variant="primary" disabled={!paths.length} onClick={compute}>
              <Icon name="verify" size={14} /> Compute {algorithm.toUpperCase()}
            </Button>
          ) : (
            <>
              <Button variant="default" onClick={cancel}>Cancel</Button>
              <JobPauseButton jobId={jobRef.current?.jobId} size="sm" />
            </>
          )}
          {results.length > 0 && (
            <Button variant="default" onClick={copyAll}>
              <Icon name="copy" size={14} /> Copy all
            </Button>
          )}
        </div>

        {running && progress && (
          <div className="checksum-progress">
            <p className="small muted">Hashing {progress.file} ({progress.index + 1} of {progress.total})</p>
            <ProgressBar value={progress.fileTotal > 0 ? progress.done / progress.fileTotal : undefined} label={`Hashing ${progress.file}`} />
          </div>
        )}
      </section>

      {results.length > 0 && (
        <>
          <section className="checksum-verify">
            <div className="checksum-verify-row">
              <TextField
                id="cs-verify"
                label="Verify: paste expected hash"
                value={verifyHash}
                maxLength={256}
                onChange={(e) => { setVerifyHash(e.target.value); setVerifyMode(true); }}
                placeholder="Paste hash to compare…"
              />
              {verifyMode && verifyHash.trim() && (
                <div className="checksum-verify-result">
                  {verifyMatch === null ? null : verifyMatch ? (
                    <span className="success-text"><Icon name="check" size={14} /> Match found: {(verifyMatch as HashResult).path.split(/[\\/]/).pop()}</span>
                  ) : (
                    <span className="error-text"><Icon name="warning" size={14} /> No matching hash</span>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="checksum-results">
            <div className="checksum-table" role="table">
              <div className="checksum-thead" role="row">
                <span role="columnheader">File</span>
                <span role="columnheader">Size</span>
                <span role="columnheader">{algorithm.toUpperCase()}</span>
                <span role="columnheader" />
              </div>
              <div className="checksum-tbody">
                {results.map((r) => {
                  const name = r.path.split(/[\\/]/).pop() ?? r.path;
                  const isMatch = verifyMode && verifyHash.trim() && r.hash.toLowerCase() === verifyHash.trim().toLowerCase();
                  const isMismatch = verifyMode && verifyHash.trim() && !isMatch;
                  return (
                    <div key={r.path} className={`checksum-row ${isMatch ? 'is-match' : ''} ${isMismatch ? 'is-mismatch' : ''}`} role="row">
                      <span className="checksum-file" role="cell" title={r.path}>{name}</span>
                      <span className="checksum-size tabular" role="cell">{formatBytes(r.size)}</span>
                      <span className="checksum-hash mono" role="cell" title={r.hash}>
                        {r.hash || <span className="muted">error</span>}
                      </span>
                      <span className="checksum-copy" role="cell">
                        {r.hash && (
                          <button type="button" className="btn btn-ghost btn-xs" title="Copy hash" onClick={() => copyHash(r.hash)}>
                            <Icon name="copy" size={12} />
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
