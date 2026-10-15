import { useCallback, useMemo, useRef, useState } from 'react';
import { call, runJob, type JobHandle } from '../../api';
import { toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { ws, activePane, currentLocation, navigate } from '../../state/workspace';
import { Button, EmptyState } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import type { ContentSearchMatch, ContentSearchProgress } from '../../../shared/contentSearch';
// import { JobPauseButton } from './common';

export function ContentSearchView() {
  const pane = useStore(ws, activePane);
  const location = currentLocation(pane);
  const dir = location.kind === 'fs' ? location.path : null;

  const [pattern, setPattern] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [running, setRunning] = useState(false);
  const [matches, setMatches] = useState<ContentSearchMatch[]>([]);
  const [filesSearched, setFilesSearched] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const jobRef = useRef<JobHandle<ContentSearchMatch[]> | null>(null);

  const startSearch = useCallback(async () => {
    if (!pattern.trim() || !dir) return;
    setRunning(true);
    setMatches([]);
    setFilesSearched(0);
    setCurrentFile('');

    const job = runJob<ContentSearchMatch[]>(
      (jobId) => call('content:search', { dir, pattern, isRegex, caseSensitive, fileFilter, maxResults: 5000, jobId }),
      (p) => {
        const progress = p as ContentSearchProgress;
        setFilesSearched(progress.filesSearched);
        setCurrentFile(progress.currentFile);
        if (progress.matches.length > 0) {
          setMatches((prev) => [...prev, ...progress.matches]);
        }
      },
      'Searching files...',
    );
    jobRef.current = job;

    try {
      const { value, cancelled } = await job.promise;
      if (!cancelled && value) {
        // Final matches are already accumulated from progress events
      }
    } catch (err) {
      toastError(err, 'Search failed');
    } finally {
      setRunning(false);
      jobRef.current = null;
    }
  }, [pattern, isRegex, caseSensitive, fileFilter, dir]);

  const stopSearch = useCallback(() => {
    jobRef.current?.cancel();
  }, []);

  const openFile = useCallback((match: ContentSearchMatch) => {
    navigate(pane.id, { kind: 'editor', path: match.path });
  }, [pane.id]);

  // Group matches by file
  const grouped = useMemo(() => {
    const map = new Map<string, ContentSearchMatch[]>();
    for (const m of matches) {
      const arr = map.get(m.path);
      if (arr) arr.push(m);
      else map.set(m.path, [m]);
    }
    return Array.from(map.entries());
  }, [matches]);

  const highlightMatch = (lineText: string, matchText: string, column: number) => {
    const before = lineText.slice(0, column);
    const matched = lineText.slice(column, column + matchText.length);
    const after = lineText.slice(column + matchText.length);
    return (
      <>
        <span>{before}</span>
        <mark className="content-search-highlight">{matched}</mark>
        <span>{after}</span>
      </>
    );
  };

  return (
    <div className="tool-view content-search-view">
      <header className="view-header">
        <h1>Content Search</h1>
      </header>

      <div className="content-search-controls">
        <div className="content-search-input-row">
          <input
            className="input text-field"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Search pattern..."
            onKeyDown={(e) => { if (e.key === 'Enter') startSearch(); }}
          />
          <button
            className={`content-search-toggle${isRegex ? ' active' : ''}`}
            onClick={() => setIsRegex((v) => !v)}
            title="Use regex"
          >.*</button>
          <button
            className={`content-search-toggle${caseSensitive ? ' active' : ''}`}
            onClick={() => setCaseSensitive((v) => !v)}
            title="Case sensitive"
          >Aa</button>
        </div>
        <div className="content-search-filter-row">
          <input
            className="input text-field"
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
            placeholder="File filter (e.g. *.ts)"
          />
          {running ? (
            <Button size="sm" onClick={stopSearch}><Icon name="close" size={14} /> Stop</Button>
          ) : (
            <Button size="sm" variant="primary" onClick={startSearch} disabled={!pattern.trim() || !dir}>
              <Icon name="search" size={14} /> Search
            </Button>
          )}
        </div>
        {!dir && <div className="content-search-warning">Navigate to a folder first to search its contents.</div>}
      </div>

      {(running || matches.length > 0) && (
        <div className="content-search-status">
          <span>{matches.length} match{matches.length !== 1 ? 'es' : ''} in {grouped.length} file{grouped.length !== 1 ? 's' : ''}</span>
          <span>{filesSearched} files searched</span>
          {running && currentFile && <span className="content-search-scanning">Scanning: {currentFile.split(/[\\/]/).pop()}</span>}
        </div>
      )}

      <div className="content-search-results scroll-y">
        {!running && matches.length === 0 && pattern && dir && (
          <EmptyState icon="search" title="No matches" body="Try a different pattern or file filter." />
        )}
        {grouped.map(([filePath, fileMatches]) => {
          const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
          const dirName = filePath.slice(0, filePath.length - fileName.length - 1);
          return (
            <div key={filePath} className="content-search-file-group">
              <div className="content-search-file-header" onClick={() => { if (fileMatches[0]) openFile(fileMatches[0]); }}>
                <Icon name="file" size={14} />
                <span className="content-search-filename">{fileName}</span>
                <span className="content-search-dirpath">{dirName}</span>
                <span className="content-search-match-count">{fileMatches.length}</span>
              </div>
              <div className="content-search-lines">
                {fileMatches.slice(0, 50).map((m, i) => (
                  <div key={`${m.line}-${m.column}-${i}`} className="content-search-line" onClick={() => openFile(m)}>
                    <span className="content-search-line-num">{m.line}</span>
                    <span className="content-search-line-text">
                      {highlightMatch(m.lineText.trimStart(), m.matchText, m.column - (m.lineText.length - m.lineText.trimStart().length))}
                    </span>
                  </div>
                ))}
                {fileMatches.length > 50 && (
                  <div className="content-search-more">...and {fileMatches.length - 50} more matches</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
