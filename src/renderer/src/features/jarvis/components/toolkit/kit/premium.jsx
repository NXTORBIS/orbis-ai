import React from 'react';

const TONES = {
  cyan: { text: 'text-cyan-j', border: 'border-cyan-j/40', bar: 'from-cyan-j/30 to-cyan-j', stroke: 'hsl(189 100% 50%)', soft: 'bg-cyan-j/10' },
  violet: { text: 'text-violet-400', border: 'border-violet-500/40', bar: 'from-violet-500/30 to-violet-400', stroke: 'hsl(265 85% 68%)', soft: 'bg-violet-500/10' },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/40', bar: 'from-emerald-500/30 to-emerald-400', stroke: 'hsl(160 84% 52%)', soft: 'bg-emerald-500/10' },
  amber: { text: 'text-amber-400', border: 'border-amber-500/40', bar: 'from-amber-500/30 to-amber-400', stroke: 'hsl(38 92% 55%)', soft: 'bg-amber-500/10' },
  rose: { text: 'text-rose-400', border: 'border-rose-500/40', bar: 'from-rose-500/30 to-rose-400', stroke: 'hsl(350 89% 60%)', soft: 'bg-rose-500/10' },
};

/** Big single readout — the headline number of a tool. */
export function Hero({ label, value, unit, sub, tone = 'cyan', children }) {
  const t = TONES[tone] || TONES.cyan;
  return (
    <div className={`tk-card tk-depth tk-glow-ring relative overflow-hidden rounded-xl border ${t.border} bg-gradient-to-br ${t.soft} to-transparent p-4 text-center`}>
      <span aria-hidden className="tk-shine pointer-events-none absolute inset-0" />
      <span aria-hidden className="pointer-events-none absolute inset-x-6 -top-10 h-20 rounded-full bg-cyan-j/10 blur-2xl" />
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className={`tk-title-glow mt-1 font-mono-j text-4xl font-semibold ${t.text}`}>
        {value}
        {unit ? <span className="text-lg"> {unit}</span> : null}
      </div>
      {sub ? <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">{sub}</div> : null}
      {children}
    </div>
  );
}

/** Circular progress ring with the value in the middle. */
export function Ring({ value = 0, max = 100, size = 148, thickness = 11, label, sub, unit, tone = 'cyan' }) {
  const t = TONES[tone] || TONES.cyan;
  const ratio = max ? Math.max(0, Math.min(1, value / max)) : 0;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="tk-card tk-glass-panel flex flex-col items-center rounded-xl p-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth={thickness} opacity="0.55" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={t.stroke}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <div className={`font-mono-j text-2xl font-semibold ${t.text}`}>{Math.round(ratio * 100)}%</div>
          {unit ? <div className="font-mono-j text-[10px] text-muted-foreground">{unit}</div> : null}
        </div>
      </div>
      {label ? <div className="mt-2 text-xs font-medium">{label}</div> : null}
      {sub ? <div className="text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Semicircular gauge — good for rates, scores and intensities. */
export function Gauge({ value = 0, min = 0, max = 100, label, unit = '', bands = [], caption }) {
  const ratio = max - min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const size = 190;
  const radius = 78;
  const centre = size / 2;
  const startAngle = -180;
  const angle = startAngle + ratio * 180;
  const polar = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return [centre + r * Math.cos(rad), centre + r * Math.sin(rad)];
  };
  const arc = (from, to, r) => {
    const [x1, y1] = polar(from, r);
    const [x2, y2] = polar(to, r);
    const large = to - from > 180 ? 1 : 0;
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };
  const [nx, ny] = polar(angle, radius - 4);
  const active = bands.find((band) => value >= band.min && value <= band.max);
  return (
    <div className="tk-card tk-glass-panel flex flex-col items-center rounded-xl p-3">
      <svg viewBox={`0 0 ${size} ${size / 1.7}`} className="w-full max-w-[15rem]">
        <path d={arc(-180, 0, radius)} fill="none" stroke="hsl(var(--border))" strokeWidth="12" strokeLinecap="round" opacity="0.6" />
        {bands.map((band) => {
          const from = -180 + ((band.min - min) / (max - min)) * 180;
          const to = -180 + ((band.max - min) / (max - min)) * 180;
          return <path key={band.label} d={arc(from, to, radius)} fill="none" stroke={band.stroke || 'hsl(189 100% 50%)'} strokeWidth="12" strokeLinecap="butt" opacity="0.85" />;
        })}
        {!bands.length && <path d={arc(-180, angle, radius)} fill="none" stroke="hsl(189 100% 50%)" strokeWidth="12" strokeLinecap="round" />}
        <line x1={centre} y1={centre} x2={nx} y2={ny} stroke="hsl(var(--foreground))" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={centre} cy={centre} r="6" fill="hsl(var(--foreground))" />
        <text x={centre} y={centre - 16} textAnchor="middle" fontFamily="monospace" fontSize="20" fill="hsl(var(--cyan))">{value}{unit}</text>
      </svg>
      {label ? <div className="-mt-1 text-xs font-medium">{label}</div> : null}
      {caption || active ? <div className="text-[10px] text-muted-foreground">{active ? active.label : caption}</div> : null}
    </div>
  );
}

/** Compact bar chart for monthly / yearly breakdowns. */
export function Bars({ data = [], height = 116, suffix = '', format = (v) => v, highlightLast = false }) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 0.0001);
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((item, index) => {
          const isLast = highlightLast && index === data.length - 1;
          return (
            <div key={`${item.label}-${index}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="font-mono-j text-[9px] text-muted-foreground opacity-0 transition group-hover:opacity-100">{format(item.value)}{suffix}</span>
              <div
                className={`w-full rounded-t ${item.tone === 'rose' ? 'bg-gradient-to-t from-rose-500/30 to-rose-400 shadow-[0_0_18px_-8px] shadow-rose-500/80' : isLast ? 'bg-gradient-to-t from-violet-500/30 to-violet-400 shadow-[0_0_18px_-8px] shadow-violet-500/80' : 'bg-gradient-to-t from-cyan-j/30 to-cyan-j shadow-[0_0_18px_-8px] shadow-cyan-j/80'}`}
                style={{ height: `${Math.max(3, (Math.abs(item.value) / max) * 100)}%` }}
                title={`${item.label}: ${format(item.value)}${suffix}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {data.map((item, index) => (
          <div key={`${item.label}-label-${index}`} className="flex-1 truncate text-center font-mono-j text-[9px] text-muted-foreground">{item.label}</div>
        ))}
      </div>
    </div>
  );
}

/** Tiny inline sparkline for trend panels. */
export function Spark({ data = [], width = 240, height = 48, tone = 'cyan' }) {
  if (data.length < 2) return null;
  const t = TONES[tone] || TONES.cyan;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-12 w-full">
      <polyline points={points.join(' ')} fill="none" stroke={t.stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A row of small labelled chips. */
export function Pills({ items = [] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item.label} className={`rounded-lg border px-2 py-1 font-mono-j text-[10px] ${item.tone === 'rose' ? 'border-rose-500/40 bg-rose-500/10 text-rose-400' : item.tone === 'amber' ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' : 'border-border/60 text-muted-foreground'}`}>
          {item.label}
          {item.value !== undefined ? <span className="ml-1 text-cyan-j">{item.value}</span> : null}
        </span>
      ))}
    </div>
  );
}