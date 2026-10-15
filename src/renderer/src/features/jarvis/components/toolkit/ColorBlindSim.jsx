import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, readFileAsDataURL, downloadBlob } from './shared';

const SAMPLE = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&q=75';

const MATRICES = {
  protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
  tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
  achromatopsia: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
};

const SWATCHES = [
  ['#ef4444', 'red'], ['#f97316', 'orange'], ['#facc15', 'yellow'], ['#22c55e', 'green'],
  ['#14b8a6', 'teal'], ['#3b82f6', 'blue'], ['#8b5cf6', 'violet'], ['#ec4899', 'pink'],
  ['#78716c', 'stone'], ['#0ea5e9', 'sky'], ['#84cc16', 'lime'], ['#f43f5e', 'rose'],
];

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const simulate = (rgb, matrix, severity) => {
  const [r, g, b] = rgb;
  const mix = severity / 100;
  const out = [
    matrix[0] * r + matrix[1] * g + matrix[2] * b,
    matrix[3] * r + matrix[4] * g + matrix[5] * b,
    matrix[6] * r + matrix[7] * g + matrix[8] * b,
  ];
  return out.map((v, i) => Math.max(0, Math.min(255, Math.round(rgb[i] * (1 - mix) + v * mix))));
};

const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

export default function ColorBlindSim() {
  const [src, setSrc] = useState(SAMPLE);
  const [name, setName] = useState('sample.jpg');
  const [type, setType] = useState('deuteranopia');
  const [severity, setSeverity] = useState(100);
  const [error, setError] = useState('');

  const originalRef = useRef(null);
  const simRef = useRef(null);
  const imageRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageRef.current = img; render(); };
    img.onerror = () => setError('That image could not be loaded.');
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => { render(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type, severity]);

  function render() {
    const img = imageRef.current;
    const original = originalRef.current;
    const simulated = simRef.current;
    if (!img || !original || !simulated) return;
    const width = Math.min(720, img.width);
    const height = Math.round((img.height / img.width) * width);
    [original, simulated].forEach((canvas) => { canvas.width = width; canvas.height = height; });
    const ctx = original.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const simCtx = simulated.getContext('2d');
    try {
      const data = ctx.getImageData(0, 0, width, height);
      const matrix = MATRICES[type];
      const pixels = data.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = simulate([pixels[i], pixels[i + 1], pixels[i + 2]], matrix, severity);
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
      }
      simCtx.putImageData(data, 0, 0);
      setError('');
    } catch {
      setError('This image could not be read pixel by pixel — try one from your device.');
    }
  }

  const download = () => {
    const canvas = simRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${(name || 'image').replace(/\.[^.]+$/, '')}-${type}.png`); }, 'image/png');
  };

  const matrix = MATRICES[type];

  return (
    <ToolShell
      toolId="color-blind"
      icon={Eye}
      title="Colour Blindness Simulator"
      desc="See a picture the way different colour vision types do — per pixel, with severity you control."
      state={{ type, severity, name }}
      onRestore={(saved) => {
        if (saved.type) setType(saved.type);
        setSeverity(saved.severity ?? 100);
      }}
      exportText={`${name} · ${type} · ${severity}% severity`}
      exportName="simulation.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Choose an image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setName(file.name);
              setSrc(await readFileAsDataURL(file));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => { setSrc(SAMPLE); setName('sample.jpg'); }}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50"
        >
          Use the sample
        </button>
        <span className="text-[11px] text-muted-foreground">{name}</span>
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">As you see it</div>
          <canvas ref={originalRef} className="w-full rounded-lg border border-border/70" />
        </Panel>
        <Panel className="!p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-cyan-j">{type} · {severity}%</div>
          <canvas ref={simRef} className="w-full rounded-lg border border-cyan-j/40" />
        </Panel>
      </div>

      <Field label="Vision type">
        <Seg
          value={type}
          onChange={setType}
          options={[
            { value: 'protanopia', label: 'Protan' },
            { value: 'deuteranopia', label: 'Deutan' },
            { value: 'tritanopia', label: 'Tritan' },
            { value: 'achromatopsia', label: 'Mono' },
          ]}
        />
      </Field>

      <Field label={`Severity · ${severity}%`}>
        <input type="range" min={0} max={100} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <Panel>
        <div className="mb-2 text-xs font-medium">Common colours, simulated</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SWATCHES.map(([hex, label]) => {
            const simulated = toHex(simulate(hexToRgb(hex), matrix, severity));
            return (
              <div key={hex} className="flex items-center gap-2 rounded-lg border border-border/60 p-1.5">
                <span className="h-8 w-8 shrink-0 rounded-md border border-black/20" style={{ background: hex }} />
                <span className="h-8 w-8 shrink-0 rounded-md border border-black/20" style={{ background: simulated }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px]">{label}</span>
                  <span className="block font-mono-j text-[10px] text-muted-foreground">{simulated}</span>
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Type" value={type.replace('anopia', '')} />
        <Stat label="Severity" value={`${severity}%`} mono />
        <Stat label="Swatches" value={String(SWATCHES.length)} />
      </div>

      <button
        type="button"
        onClick={download}
        className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-2 text-xs font-medium text-cyan-j transition hover:bg-cyan-j/20"
      >
        Download the simulated image
      </button>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Around one in twelve men and one in two hundred women see colour differently, most often confusing red with green.
          If two elements of your design only differ by red versus green, this is the check that catches it. Simulated colours here are an approximation
          of how the cones respond, not a clinical test.
        </p>
      </Panel>
    </ToolShell>
  );
}