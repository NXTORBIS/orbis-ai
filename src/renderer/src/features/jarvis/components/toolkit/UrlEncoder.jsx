import { useState } from 'react';
import { Globe } from 'lucide-react';
import { ToolHeader, Area, Out, Seg } from './shared';

const MODES = {
  url: { label: 'URL encode', fn: (s) => encodeURIComponent(s) },
  urld: { label: 'URL decode', fn: (s) => decodeURIComponent(s) },
  html: { label: 'HTML escape', fn: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') },
  htmld: { label: 'HTML unescape', fn: (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') },
  query: { label: 'Query → JSON', fn: (s) => { const q = s.includes('?') ? s.split('?')[1] : s; const o = {}; new URLSearchParams(q).forEach((v, k) => { o[k] = v; }); return JSON.stringify(o, null, 2); } },
};

export default function UrlEncoder() {
  const [text, setText] = useState('https://base44.com/search?q=mark32 & tools=50');
  const [mode, setMode] = useState('url');
  let err = null;
  let out = '';
  try { out = MODES[mode].fn(text); } catch (e) { err = e.message; }

  return (
    <div className="space-y-4">
      <ToolHeader icon={Globe} title="URL & HTML Encoder" desc="Escape text for URLs and HTML, decode it back, or read a query string as JSON." />
      <Area value={text} onChange={setText} rows={4} mono placeholder="Paste a URL, query string or HTML…" />
      <Seg value={mode} onChange={setMode} options={Object.entries(MODES).map(([value, m]) => ({ value, label: m.label }))} />
      <Out label={MODES[mode].label} value={out}>
        <span className="whitespace-pre-wrap break-all font-mono-j text-xs">{err ? <span className="text-red-500">{err}</span> : out || '—'}</span>
      </Out>
    </div>
  );
}