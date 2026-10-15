import { useState } from 'react';
import { ExternalLink, Printer, RefreshCw, Star } from 'lucide-react';
import { cn } from '@jarvis/lib/utils';
import { ToolHeader } from '../shared';
import TableExportActions from './TableExportActions';
import { usePinnedTools } from './hooks';

/**
 * The standard stage every toolkit tool renders inside.
 *
 * Tools built on the shared shell already draw their own header and action bar (presets,
 * history, export, share, pin); this stage only supplies the frame for them. The older
 * tools get the same header and the universal actions injected here, so the whole
 * toolkit reads as one product without touching each file.
 */

const LEGACY_TOOLS = new Set([
  'screen-ruler', 'color-picker', 'compass', 'level', 'gps', 'speedometer', 'altitude', 'sensors',
  'qr-scanner', 'device-info', 'dns', 'subnet', 'port-checker', 'multi-timer',
  'audio-recorder', 'screen-recorder', 'webcam-recorder', 'video-downloader', 'voice-dictation',
  'compressor', 'resizer', 'inspector', 'contrast', 'image-base64', 'image-filters',
  'hash', 'metadata', 'zip-create', 'zip-extract',
  'json', 'base64', 'jwt', 'uuid', 'hash-gen', 'regex', 'diff', 'dup-lines',
  'equation', 'matrix', 'ohms', 'kinematics', 'percentage', 'statistics', 'prime-factor', 'gcd-lcm', 'combinatorics',
  'algorithm', 'csv', 'word-scrambler', 'caesar-cipher',
  'case-converter', 'word-counter', 'lorem-ipsum', 'text-reverser', 'slug-generator', 'line-sorter',
  'find-replace', 'whitespace-cleaner', 'markdown-preview', 'url-encoder', 'read-aloud',
  'number-words', 'roman', 'base-converter', 'timestamp', 'timezone', 'color-converter', 'data-size',
  'gradient', 'shadow', 'radius', 'palette', 'emoji-picker',
  'password-strength', 'password-gen', 'text-encryptor',
  'random-number', 'random-picker', 'team-splitter', 'fake-data', 'qr-code',
  'bmi', 'age', 'date-diff', 'tip-splitter', 'loan-emi', 'compound-interest', 'profit-margin', 'sleep-cycle',
]);

const CHIP = 'inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground active:scale-[0.97]';

export default function ToolStage({ tool, children }) {
  const { isPinned, toggle } = usePinnedTools();
  const [nonce, setNonce] = useState(0);
  const legacy = tool ? LEGACY_TOOLS.has(tool.id) : false;
  const pinned = tool ? isPinned(tool.id) : false;

  const actions = legacy ? (
    <div className="tk-actions tk-depth flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-card/50 p-1.5">
      <button
        type="button"
        onClick={() => toggle(tool.id)}
        className={cn(CHIP, pinned && 'border-cyan-j/60 text-cyan-j')}
      >
        <Star className={cn('h-3.5 w-3.5', pinned && 'fill-current')} /> {pinned ? 'Pinned' : 'Pin'}
      </button>
      <button type="button" onClick={() => setNonce((n) => n + 1)} className={CHIP}>
        <RefreshCw className="h-3.5 w-3.5" /> Start over
      </button>
      <button type="button" onClick={() => window.print()} className={CHIP} title="Print a clean copy of this tool">
        <Printer className="h-3.5 w-3.5" /> Print
      </button>
      <TableExportActions toolId={tool.id} />
      <a
        href={`${window.location.origin}${window.location.pathname}?tab=toolkit&tool=${tool.id}`}
        target="_blank"
        rel="noreferrer"
        className={CHIP}
      >
        <ExternalLink className="h-3.5 w-3.5" /> Open in a tab
      </a>
    </div>
  ) : null;

  return (
    <div className="tk-frame tk-shell tk-rise relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <div aria-hidden className="tk-aurora" />
      <div aria-hidden className="tk-grain" />
      {legacy && (
        <div className="relative mb-5">
          <ToolHeader icon={tool.icon} title={tool.label} desc={tool.desc} actions={actions} />
          <div aria-hidden className="mt-4 h-px bg-gradient-to-r from-cyan-j/40 via-border/60 to-transparent" />
        </div>
      )}
      <div key={nonce} className="relative">{children}</div>
    </div>
  );
}