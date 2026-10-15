import { useMemo, useState } from 'react';
import { Bookmark, BookmarkPlus, Check, Copy, Download, ExternalLink, History as HistoryIcon, Printer, RefreshCw, Share2, Star, Trash2, X } from 'lucide-react';
import { cn } from '@jarvis/lib/utils';
import { downloadBlob } from '../shared';
import TableExportActions from './TableExportActions';
import { buildShareUrl, usePinnedTools } from './hooks';

const CHIP = 'inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground active:scale-[0.97]';

const timeAgo = (stamp) => {
  const seconds = Math.round((Date.now() - stamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
};

export default function ToolActions({ toolId, onReload, state, onRestore, exportText, exportName = 'result.txt', exportMime = 'text/plain', history, presets, setPresets }) {
  const [panel, setPanel] = useState(null);
  const { isPinned, toggle: togglePin } = usePinnedTools();
  const pinned = toolId ? isPinned(toolId) : false;
  const [name, setName] = useState('');
  const [done, setDone] = useState('');

  const shareUrl = useMemo(() => buildShareUrl(state, toolId), [state, toolId]);

  const flash = (key) => {
    setDone(key);
    setTimeout(() => setDone(''), 1500);
  };

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(key);
    } catch {
      flash('failed');
    }
  };

  const toggle = (which) => setPanel((current) => (current === which ? null : which));

  const savePreset = () => {
    const label = name.trim() || `Preset ${presets.length + 1}`;
    setPresets([{ id: `${Date.now()}`, name: label, state, at: Date.now() }, ...presets].slice(0, 12));
    setName('');
    flash('saved');
  };

  const restore = (entry) => {
    onRestore?.(entry.state);
    flash('restored');
  };

  return (
    <div className="w-full space-y-2 lg:w-auto">
      <div className="tk-actions tk-depth flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-card/50 p-1.5">
        <button type="button" onClick={() => toggle('presets')} className={cn(CHIP, panel === 'presets' && 'border-cyan-j/60 text-cyan-j')}>
          <BookmarkPlus className="h-3.5 w-3.5" /> {done === 'saved' ? 'Saved' : 'Presets'}{presets.length ? ` · ${presets.length}` : ''}
        </button>
        <button type="button" onClick={() => toggle('history')} className={cn(CHIP, panel === 'history' && 'border-cyan-j/60 text-cyan-j')}>
          <HistoryIcon className="h-3.5 w-3.5" /> History{history.items.length ? ` · ${history.items.length}` : ''}
        </button>
        {exportText ? (
          <>
            <button type="button" onClick={() => copyText(exportText, 'copy')} className={cn(CHIP, done === 'copy' && 'border-cyan-j/60 text-cyan-j')}>
              {done === 'copy' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done === 'copy' ? 'Copied' : 'Copy result'}
            </button>
            <button type="button" onClick={() => { downloadBlob(new Blob([exportText], { type: exportMime }), exportName); flash('download'); }} className={cn(CHIP, done === 'download' && 'border-cyan-j/60 text-cyan-j')}>
              {done === 'download' ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} Download
            </button>
          </>
        ) : null}
        <TableExportActions toolId={toolId} />
        <button type="button" onClick={() => window.print()} className={CHIP} title="Print a clean copy of this tool">
          <Printer className="h-3.5 w-3.5" /> Print
        </button>
        <button type="button" onClick={() => { copyText(shareUrl, 'share'); toggle('share'); }} className={cn(CHIP, done === 'share' && 'border-cyan-j/60 text-cyan-j')}>
          {done === 'share' ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />} {done === 'share' ? 'Link copied' : 'Share'}
        </button>
        {toolId && (
          <button type="button" onClick={() => togglePin(toolId)} className={cn(CHIP, pinned && 'border-cyan-j/60 text-cyan-j')}>
            <Star className={cn('h-3.5 w-3.5', pinned && 'fill-current')} /> {pinned ? 'Pinned' : 'Pin'}
          </button>
        )}
        {onReload && (
          <button type="button" onClick={onReload} className={CHIP}>
            <RefreshCw className="h-3.5 w-3.5" /> Start over
          </button>
        )}
        {toolId && (
          <a href={`${window.location.origin}${window.location.pathname}?tab=toolkit&tool=${toolId}`} target="_blank" rel="noreferrer" className={CHIP}>
            <ExternalLink className="h-3.5 w-3.5" /> New tab
          </a>
        )}
      </div>

      {panel === 'presets' && (
        <div className="tk-card tk-depth rounded-xl border border-border/70 bg-card/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Saved presets</span>
            <button type="button" onClick={() => setPanel(null)} className="text-muted-foreground transition hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
              placeholder="Name this setup…"
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
            />
            <button type="button" onClick={savePreset} className={cn(CHIP, 'border-cyan-j/50 text-cyan-j')}>
              <BookmarkPlus className="h-3.5 w-3.5" /> Save
            </button>
          </div>
          <div className="mt-2 max-h-52 space-y-1 overflow-auto scrollbar-thin">
            {presets.map((preset) => (
              <div key={preset.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
                <Bookmark className="h-3.5 w-3.5 shrink-0 text-cyan-j" />
                <span className="min-w-0 flex-1 truncate text-xs">{preset.name}</span>
                <button type="button" onClick={() => restore(preset)} className="text-[11px] text-cyan-j transition hover:underline">Load</button>
                <button type="button" onClick={() => setPresets(presets.filter((p) => p.id !== preset.id))} className="text-muted-foreground transition hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {!presets.length && <p className="py-3 text-center text-[11px] text-muted-foreground">Nothing saved yet — set something up and save it here.</p>}
          </div>
        </div>
      )}

      {panel === 'history' && (
        <div className="tk-card tk-depth rounded-xl border border-border/70 bg-card/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Recent results</span>
            <div className="flex items-center gap-2">
              {history.items.length > 0 && <button type="button" onClick={history.clear} className="text-[11px] text-muted-foreground transition hover:text-red-500">Clear</button>}
              <button type="button" onClick={() => setPanel(null)} className="text-muted-foreground transition hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="max-h-52 space-y-1 overflow-auto scrollbar-thin">
            {history.items.map((entry) => (
              <div key={entry.at} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono-j text-[11px] text-muted-foreground">{entry.preview || 'no output'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(entry.at)}</span>
                <button type="button" onClick={() => restore(entry)} className="text-[11px] text-cyan-j transition hover:underline">Restore</button>
              </div>
            ))}
            {!history.items.length && <p className="py-3 text-center text-[11px] text-muted-foreground">Your results will collect here as you work.</p>}
          </div>
        </div>
      )}

      {panel === 'share' && (
        <div className="tk-card tk-depth rounded-xl border border-border/70 bg-card/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Shareable link</span>
            <button type="button" onClick={() => setPanel(null)} className="text-muted-foreground transition hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-[10px]" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Opens this tool with the same setup already filled in.</span>
            <button type="button" onClick={() => copyText(shareUrl, 'share')} className={cn(CHIP, 'border-cyan-j/50 text-cyan-j')}>
              {done === 'share' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}