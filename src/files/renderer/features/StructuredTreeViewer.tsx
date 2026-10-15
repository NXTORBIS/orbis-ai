import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import { Icon } from '../ui/Icon';
import { Loading } from '../ui/components';
import { formatBytes } from '../ui/format';
import type { TreeNode, StructuredParseResult, NodeType } from '../../shared/structured';

/* ---------------------------------------------------------------- Main */

export function StructuredTreeViewer({ path }: { path: string }) {
  const [result, setResult] = useState<StructuredParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'tree' | 'raw'>('tree');
  const [rawText, setRawText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call<StructuredParseResult>('structured:parse', { path })
      .then((r) => live && setResult(r))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [path]);

  const loadRaw = useCallback(() => {
    if (rawText !== null) { setMode('raw'); return; }
    interface TextRead { text: string; binary: boolean; encoding: string; totalBytes: number; offset: number; nextOffset?: number }
    call<TextRead>('fs:readText', { path, maxBytes: 1_000_000 })
      .then((d) => { setRawText(d.text); setMode('raw'); })
      .catch(() => setMode('raw'));
  }, [path, rawText]);

  if (error) return <div className="structured-error"><Icon name="alert-circle" size={20} /><p>{error}</p></div>;
  if (!result) return <Loading label="Parsing..." />;

  return (
    <div className="structured-viewer">
      <div className="preview-tools">
        <div className="segmented" role="radiogroup" aria-label="Display">
          <button type="button" role="radio" aria-checked={mode === 'tree'} className={mode === 'tree' ? 'on' : ''} onClick={() => setMode('tree')}>Tree</button>
          <button type="button" role="radio" aria-checked={mode === 'raw'} className={mode === 'raw' ? 'on' : ''} onClick={loadRaw}>Raw</button>
        </div>
        {mode === 'tree' && (
          <div className="find-box">
            <Icon name="search" size={13} />
            <input value={search} placeholder="Filter nodes..." aria-label="Filter nodes" onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        <span className="muted small">{result.format.toUpperCase()}</span>
        <span className="muted small">{formatBytes(result.bytesRead)}</span>
      </div>
      {result.error && <p className="structured-parse-error"><Icon name="alert-triangle" size={14} /> Parse error: {result.error}</p>}
      {result.truncated && <p className="preview-note">File was truncated; only the first 5 MB is shown.</p>}
      {mode === 'tree' ? (
        <div className="structured-tree preview-scroll">
          <TreeNodeView node={result.root} depth={0} search={search.toLowerCase()} defaultOpen />
        </div>
      ) : (
        <div className="preview-scroll">
          <pre className="code-view">{rawText ?? 'Loading...'}</pre>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Tree Node */

const TYPE_COLORS: Record<NodeType, string> = {
  string: 'var(--st-string)',
  number: 'var(--st-number)',
  boolean: 'var(--st-boolean)',
  null: 'var(--st-null)',
  object: 'var(--text-secondary)',
  array: 'var(--text-secondary)',
};

function nodeMatches(node: TreeNode, search: string): boolean {
  if (!search) return true;
  if (node.key.toLowerCase().includes(search)) return true;
  if (node.value !== undefined && node.value !== null && String(node.value).toLowerCase().includes(search)) return true;
  if (node.children) return node.children.some((c) => nodeMatches(c, search));
  return false;
}

function TreeNodeView({ node, depth, search, defaultOpen }: { node: TreeNode; depth: number; search: string; defaultOpen?: boolean }) {
  const autoExpand = defaultOpen || depth < 1 || (node.childCount !== undefined && node.childCount < 20);
  const [open, setOpen] = useState(autoExpand);
  const [copied, setCopied] = useState(false);

  const visible = useMemo(() => {
    if (!search || !node.children) return node.children;
    return node.children.filter((c) => nodeMatches(c, search));
  }, [node.children, search]);

  const copyPath = useCallback(() => {
    void navigator.clipboard.writeText(node.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [node.path]);

  if (search && !nodeMatches(node, search)) return null;

  const hasChildren = visible && visible.length > 0;
  const isLeaf = !node.children || node.children.length === 0;
  const bracket = node.type === 'array' ? `[${node.children?.length ?? 0}]` : node.type === 'object' ? `{${node.children?.length ?? 0}}` : '';

  return (
    <div className="tree-node" style={{ '--depth': depth } as React.CSSProperties}>
      <div className="tree-row" onClick={hasChildren ? () => setOpen(!open) : undefined} role={hasChildren ? 'button' : undefined} tabIndex={hasChildren ? 0 : undefined} onKeyDown={hasChildren ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } } : undefined}>
        {hasChildren ? (
          <span className={`tree-toggle ${open ? 'open' : ''}`}><Icon name="chevron-right" size={12} /></span>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <span className="tree-key">{node.key}</span>
        {isLeaf ? (
          <span className="tree-value" style={{ color: TYPE_COLORS[node.type] }}>
            {node.type === 'string' ? `"${truncateValue(String(node.value ?? ''), 120)}"` : String(node.value ?? 'null')}
          </span>
        ) : (
          <span className="tree-bracket muted">{bracket}</span>
        )}
        <button type="button" className="tree-copy" onClick={(e) => { e.stopPropagation(); copyPath(); }} title={`Copy path: ${node.path}`} aria-label={`Copy path ${node.path}`}>
          <Icon name={copied ? 'check' : 'copy'} size={11} />
        </button>
      </div>
      {open && hasChildren && (
        <div className="tree-children">
          {visible!.map((child) => (
            <TreeNodeView key={child.path || child.key} node={child} depth={depth + 1} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function truncateValue(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '...';
}
