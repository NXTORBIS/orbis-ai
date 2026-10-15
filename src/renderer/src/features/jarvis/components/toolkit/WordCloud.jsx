import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Download } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow, downloadBlob } from './shared';

const STOP = new Set('the a an and or but if then than that this these those of to in on at by for with from as is are was were be been being it its it\'s i you he she they we me my your our their his her them us not no do does did done have has had will would can could should may might must about into over under again very just also more most some such only own same so too now here there when where why how all any both each few other'.split(/\s+/));

const PALETTES = [
  { id: 'aurora', label: 'Aurora', colors: ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa'] },
  { id: 'ink', label: 'Ink', colors: ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8'] },
  { id: 'sunset', label: 'Sunset', colors: ['#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#f59e0b', '#dc2626'] },
  { id: 'forest', label: 'Forest', colors: ['#065f46', '#047857', '#059669', '#10b981', '#84cc16', '#facc15'] },
];

const SAMPLE = `Mark32 brings notes, tasks, files and knowledge into one intelligent workspace.

A good workspace removes friction: capture quickly, organise automatically, find instantly. Notes stay linked to the tasks they belong to,
files sit beside the projects that need them, and every search reaches across all of it. That is the whole idea — less hunting, more doing.
A calm workspace is a productive workspace, and productivity compounds quietly every single day.`;

const tokenize = (text, { keepStop, minLength }) =>
  (String(text).toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || [])
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ''))
    .filter((w) => w.length >= Math.max(2, Number(minLength) || 3) && (keepStop || !STOP.has(w)));

export default function WordCloud() {
  const [text, setText] = useState(SAMPLE);
  const [maxWords, setMaxWords] = useState(38);
  const [minLength, setMinLength] = useState(4);
  const [keepStop, setKeepStop] = useState(false);
  const [palette, setPalette] = useState('aurora');
  const [rotate, setRotate] = useState(true);
  const [dark, setDark] = useState(true);
  const canvasRef = useRef(null);

  const deferredText = useDeferredValue(text);
  const colours = (PALETTES.find((p) => p.id === palette) || PALETTES[0]).colors;

  const ranked = useMemo(() => {
    const counts = new Map();
    tokenize(deferredText, { keepStop, minLength }).forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
    return [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  }, [deferredText, keepStop, minLength]);

  const limited = useMemo(() => ranked.slice(0, Math.max(5, Number(maxWords) || 38)), [ranked, maxWords]);
  const totalWords = ranked.reduce((sum, r) => sum + r.count, 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = dark ? '#0b1120' : '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (!limited.length) return;

    const max = limited[0].count || 1;
    const placed = [];
    limited.forEach((entry, index) => {
      const size = Math.max(13, Math.round(15 + (entry.count / max) * (W / 22)));
      const angle = rotate && index % 5 === 3 ? -Math.PI / 2 : 0;
      ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
      const metrics = ctx.measureText(entry.word);
      const boxW = angle ? size * 1.05 : metrics.width + 6;
      const boxH = angle ? metrics.width + 6 : size * 1.12;
      for (let attempt = 0; attempt < 900; attempt += 1) {
        const radius = 5 * Math.sqrt(attempt) * (W / 130);
        const theta = attempt * 0.45;
        const x = W / 2 + radius * Math.cos(theta) - boxW / 2;
        const y = H / 2 + radius * Math.sin(theta) * 0.62 - boxH / 2;
        if (x < 6 || y < 6 || x + boxW > W - 6 || y + boxH > H - 6) continue;
        if (placed.some((p) => !(x + boxW < p.x || x > p.x + p.w || y + boxH < p.y || y > p.y + p.h))) continue;
        placed.push({ x, y, w: boxW, h: boxH, entry, size, angle });
        break;
      }
    });

    placed.forEach((item, index) => {
      ctx.save();
      ctx.translate(item.x + item.w / 2, item.y + item.h / 2);
      if (item.angle) ctx.rotate(item.angle);
      ctx.font = `700 ${item.size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colours[index % colours.length];
      ctx.fillText(item.entry.word, 0, 0);
      ctx.restore();
    });
  }, [limited, colours, rotate, dark]);

  const savePng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, 'word-cloud.png'); }, 'image/png');
  };

  const csv = ['word,count', ...ranked.map((r) => `"${r.word}",${r.count}`)].join('\n');

  return (
    <ToolShell
      toolId="word-cloud"
      icon={Cloud}
      title="Word Cloud Generator"
      desc="Turn any text into a weighted word cloud — stopwords removed, biggest words for the words that dominate — then export it as a PNG."
      state={{ text, maxWords, minLength, keepStop, palette, rotate, dark }}
      onRestore={(restored) => {
        if (typeof restored.text === 'string') setText(restored.text);
        if (restored.maxWords) setMaxWords(restored.maxWords);
        if (restored.minLength) setMinLength(restored.minLength);
        if (typeof restored.keepStop === 'boolean') setKeepStop(restored.keepStop);
        if (restored.palette) setPalette(restored.palette);
        if (typeof restored.rotate === 'boolean') setRotate(restored.rotate);
        if (typeof restored.dark === 'boolean') setDark(restored.dark);
      }}
      exportText={csv}
      exportName="word-cloud.csv"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={palette} onChange={setPalette} options={PALETTES.map((p) => ({ value: p.id, label: p.label }))} />
        <button type="button" onClick={savePng} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Download className="h-3.5 w-3.5" /> Save PNG
        </button>
        <CopyBtn value={csv} label="Copy list" />
      </div>

      <Field label="Your text">
        <Area value={text} onChange={setText} rows={7} placeholder="Paste an article, a review set, your notes…" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Words shown · ${maxWords}`}>
          <input type="range" min={10} max={90} value={maxWords} onChange={(e) => setMaxWords(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Shortest word · ${minLength} letters`}>
          <input type="range" min={2} max={12} value={minLength} onChange={(e) => setMinLength(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="space-y-2">
          <ToggleRow label="Allow tilted words" checked={rotate} onChange={setRotate} />
          <ToggleRow label="Dark canvas" checked={dark} onChange={setDark} />
        </div>
      </div>

      <ToggleRow label="Keep common filler words" checked={keepStop} onChange={setKeepStop} hint="the, and, of, is …" />

      <canvas ref={canvasRef} width={1000} height={620} className="tk-card tk-depth w-full rounded-xl border border-border/70" />

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Words in canvas" value={String(limited.length)} mono />
        <Stat label="Different words" value={String(ranked.length)} mono />
        <Stat label="Words counted" value={String(totalWords)} mono />
        <Stat label="Top word" value={ranked[0]?.word || '—'} sub={ranked[0] ? `${ranked[0].count}×` : ''} />
      </div>

      <Field label="Most used words">
        <div className="tk-card tk-depth max-h-56 overflow-auto rounded-xl border border-border/70 bg-card/50 p-3">
          <div className="flex flex-wrap gap-1.5">
            {limited.slice(0, 40).map((entry, index) => (
              <span key={entry.word} className="rounded-lg border border-border/60 px-2 py-1 text-[11px]" style={{ color: colours[index % colours.length] }}>
                {entry.word} <span className="text-muted-foreground">· {entry.count}</span>
              </span>
            ))}
            {!limited.length && <span className="text-[11px] text-muted-foreground">Add a few lines of text to see the ranking.</span>}
          </div>
        </div>
      </Field>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Words are counted locally, sized by how often they appear, and packed into a spiral so nothing overlaps — the canvas redraws as you type.
          Switch off “common filler words” when you want the raw picture, and on when you want the theme to jump out.
        </p>
      </Panel>
    </ToolShell>
  );
}